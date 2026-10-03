import { create } from 'zustand';
import { BUILTIN_WORLDS } from '@/data/builtinWorlds';
import type { WorldCard } from '@/types/cards';
import { makeId } from '@/utils/files';
import { createKVStore, isIdbAvailable } from '@/utils/idb';

/**
 * 卡片库为什么落在 IndexedDB 而不是 localStorage：
 * 角色卡可以内嵌 base64 头像、世界卡可以带封面，几张卡就能顶破 localStorage 的 5MB；
 * 而且 persist 每次变更都要整体序列化写盘，大对象下会明显卡主线程。
 * 这里自己按「读一次 / 整体写回」的方式管理，写入不经过 React 渲染。
 */

/** 整个卡片库存成一个 JSON 字符串：单键写入天然原子，不会读到写了一半的数组 */
const WORLDS_KEY = 'worlds';

const kv = createKVStore('pale-notes', 'kv');

/**
 * 深拷贝：store 里保存的对象不能和外部共享引用，
 * 否则调用方拿到 `saveWorld` 的入参后随手一改，就把 store 里的状态也改了（还不会触发重渲染）。
 * structuredClone 不可用（老浏览器）时退回 JSON 往返。
 */
function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // 含函数/Proxy 等不可克隆成员，退回 JSON
    }
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

/** 降级提示文案：区分「本来就没有 IndexedDB」和「本来好好的、刚刚写失败了」 */
function idbDownMessage(wasAvailable: boolean): string {
  return wasAvailable
    ? 'IndexedDB 写入失败，已降级为内存存储：本次改动刷新页面后会丢失。'
    : 'IndexedDB 不可用，世界卡只保存在内存中：刷新页面后会丢失。';
}

/**
 * 模块级 in-flight Promise。
 * React StrictMode 会把 effect 跑两遍，而两次调用都发生在第一次 await 之前，
 * 只靠 state.loaded 去重是拦不住的，所以用同一个 Promise 让它们共享这次载入。
 */
let loadInFlight: Promise<void> | null = null;

/**
 * 写回串行化：并发整体写回会互相覆盖，
 * 而每次都读「当前」状态再写，串成一条链后最后一次写一定是最新数据。
 */
let writeChain: Promise<void> = Promise.resolve();

export interface LibraryState {
  worlds: WorldCard[];
  /** 是否已完成首次载入（区分「库里是空的」和「还没读」） */
  loaded: boolean;
  loadError: string | null;

  /** 从 IndexedDB 载入全部世界卡；首次运行会写入内置示例卡 */
  loadWorlds: () => Promise<void>;
  /** 新增或整体替换（按 id 匹配） */
  saveWorld: (world: WorldCard) => Promise<void>;
  /** 局部更新，自动刷新 updatedAt */
  updateWorld: (id: string, patch: Partial<WorldCard>) => Promise<void>;
  deleteWorld: (id: string) => Promise<void>;
  duplicateWorld: (id: string) => Promise<WorldCard | null>;
  getWorld: (id: string) => WorldCard | undefined;
  /** 导出用：所有世界卡的快照 */
  exportAll: () => WorldCard[];
  /** 导入一批世界卡（id 冲突时重新分配 id），返回导入进来的卡 */
  importWorlds: (worlds: WorldCard[]) => Promise<WorldCard[]>;
}

export const useLibraryStore = create<LibraryState>()((set, get) => {
  /**
   * 把当前内存状态写回 IndexedDB。永不 reject：
   * 写失败只落到 loadError（UI 能提示），绝不把异常丢给调用方，
   * 否则一个「保存」按钮的点击就会变成未捕获的 Promise 异常。
   */
  async function persist(): Promise<void> {
    const wasAvailable = isIdbAvailable();
    try {
      // 在这里才取 state：写入排队期间状态可能又变了，取最新的才是对的
      await kv.set(WORLDS_KEY, JSON.stringify(get().worlds));
      if (!isIdbAvailable()) {
        // kv 层已经把失败的 IndexedDB 降级掉了，如实告诉用户「这次没落盘」
        set({ loadError: idbDownMessage(wasAvailable) });
      } else if (get().loadError) {
        set({ loadError: null }); // 这次写成功了，上次的错误提示可以撤掉
      }
    } catch (err) {
      set({ loadError: `世界卡写回失败：${describeError(err)}` });
    }
  }

  function queuePersist(): Promise<void> {
    writeChain = writeChain.then(persist);
    return writeChain;
  }

  /** 所有改动都走这里：先同步改内存（UI 立刻响应），再异步写回 */
  async function commitWorlds(worlds: WorldCard[]): Promise<void> {
    set({ worlds });
    await queuePersist();
  }

  /** 新增或就地替换一张卡；新卡放最前面，列表天然按最近保存排序 */
  async function commitWorld(next: WorldCard): Promise<void> {
    const current = get().worlds;
    const index = current.findIndex((w) => w.id === next.id);
    if (index === -1) {
      await commitWorlds([next, ...current]);
      return;
    }
    const worlds = current.slice();
    worlds[index] = next;
    await commitWorlds(worlds);
  }

  return {
    worlds: [],
    loaded: false,
    loadError: null,

    loadWorlds: async () => {
      if (get().loaded) return;
      if (loadInFlight) return loadInFlight;
      loadInFlight = (async () => {
        let worlds: WorldCard[] | null = null;
        let error: string | null = null;
        try {
          const raw = await kv.get<unknown>(WORLDS_KEY);
          if (typeof raw === 'string' && raw.trim()) {
            const parsed: unknown = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              worlds = parsed as WorldCard[];
            } else {
              error = '世界卡存档格式不正确（不是数组），已回退到内置示例卡。';
            }
          } else if (Array.isArray(raw)) {
            // 容错：万一有旧版本直接把对象塞进 kv，而不是 JSON 字符串
            worlds = raw as WorldCard[];
          }
          // raw 缺失 / 空字符串 = 首次运行，交给下面播入内置卡
        } catch (err) {
          error = `读取世界卡库失败：${describeError(err)}`;
        }

        // 注意：读到空数组不算「首次运行」。用户自己删光了卡，
        // 再把内置卡塞回去会显得删除操作没生效。
        let needSeed = false;
        if (worlds === null) {
          worlds = deepClone(BUILTIN_WORLDS);
          needSeed = true;
        }

        set({ worlds, loaded: true, loadError: error });
        if (needSeed) await queuePersist();
      })();

      try {
        await loadInFlight;
      } finally {
        loadInFlight = null;
      }
    },

    saveWorld: async (world) => {
      await commitWorld(deepClone(world));
    },

    updateWorld: async (id, patch) => {
      const current = get().worlds.find((w) => w.id === id);
      if (!current) return; // 卡已不在（可能刚被删），静默忽略，别把脏数据写回去
      const safePatch = deepClone(patch);
      await commitWorld({
        ...current,
        ...safePatch,
        // id / createdAt 不接受 patch 覆盖，updatedAt 一律刷新
        id: current.id,
        createdAt: current.createdAt,
        updatedAt: Date.now(),
      });
    },

    deleteWorld: async (id) => {
      const before = get().worlds;
      const worlds = before.filter((w) => w.id !== id);
      if (worlds.length === before.length) return; // 没删到东西就不必整体写回
      await commitWorlds(worlds);
    },

    duplicateWorld: async (id) => {
      const source = get().worlds.find((w) => w.id === id);
      if (!source) return null;
      const now = Date.now();
      const copy = deepClone(source);
      copy.id = makeId('world');
      copy.title = `${source.title} 副本`;
      copy.createdAt = now;
      copy.updatedAt = now;
      copy.builtin = false; // 副本是用户自己的卡，不该继续显示成内置只读卡
      await commitWorld(copy);
      // 返回副本的拷贝而不是 store 里那一个：调用方改返回值不能影响库里的卡
      return deepClone(copy);
    },

    /**
     * 读取单张卡。这里刻意返回 store 内的引用（不拷贝）：
     * 它常被用在渲染路径上，而卡片可能带几百 KB 的 base64，
     * 每次渲染都深拷贝一次会直接卡住列表。请当只读用；
     * 需要可安全改动的副本用 duplicateWorld 或 exportAll。
     */
    getWorld: (id) => get().worlds.find((w) => w.id === id),

    exportAll: () => deepClone(get().worlds),

    importWorlds: async (worlds) => {
      if (!Array.isArray(worlds) || worlds.length === 0) return [];
      const used = new Set(get().worlds.map((w) => w.id));
      const now = Date.now();
      const imported: WorldCard[] = [];

      for (const raw of worlds) {
        if (!raw || typeof raw !== 'object') continue;
        const title = typeof raw.title === 'string' ? raw.title.trim() : '';
        if (!title) continue; // 没有标题的卡在列表里无法区分，直接丢弃

        const card = deepClone(raw);
        // 缺 id，或与本库已有 id 撞车，都换新 id：
        // 导入包来自别人的库，id 撞了会让两张卡互相覆盖。
        if (typeof card.id !== 'string' || !card.id.trim() || used.has(card.id)) {
          card.id = makeId('world');
        }
        used.add(card.id);
        card.title = title;
        card.createdAt = typeof card.createdAt === 'number' ? card.createdAt : now;
        card.updatedAt = typeof card.updatedAt === 'number' ? card.updatedAt : now;
        card.builtin = card.builtin === true; // 只认明确的 true，否则算用户自己的卡（可自由编辑）
        imported.push(card);
      }

      if (imported.length === 0) return [];
      await commitWorlds([...imported, ...get().worlds]);
      return imported.map((card) => deepClone(card));
    },
  };
});
