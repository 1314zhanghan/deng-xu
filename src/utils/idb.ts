/**
 * 极简 IndexedDB 键值封装（Promise 风格，零依赖）。
 *
 * 为什么用 IndexedDB 而不是 localStorage：世界卡里的角色头像/封面是 base64 data URL，
 * 一张卡上兆很常见，localStorage 的 5MB 配额顶不住；IndexedDB 按磁盘配额算，
 * 而且本身用结构化克隆存储，不必像 localStorage 那样把一切压成字符串。
 *
 * 为什么自己写：这里只需要 get/set/del/keys/clear 五件事，不值得为它引一个库。
 *
 * 降级策略：隐私模式、企业策略禁用、配额写满、多标签页版本升级互锁等情况下，
 * IndexedDB 的调用会直接抛错。存档功能不该因此白屏，所以这里把错误兜住并退回
 * 进程内 Map —— 数据只活在本次会话（刷新即丢），但 UI 和逻辑都能继续跑。
 * 上层可以通过 idbAvailable / isIdbAvailable() 判断当前是否真的在持久化。
 */

const DEFAULT_DB_NAME = 'pale-notes';
const DEFAULT_STORE_NAME = 'kv';

/**
 * 是否真的用上了 IndexedDB。false = 已降级到内存 Map（数据不跨会话）。
 * 初始值只是「能力探测」，真正打开/读写失败后会被置为 false。
 */
export let idbAvailable = typeof indexedDB !== 'undefined';

export function isIdbAvailable(): boolean {
  return idbAvailable;
}

export interface KVStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
}

/** 把回调式的 IDBRequest 包成 Promise，并把真实错误（DOMException）原样抛出去 */
function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败'));
  });
}

/**
 * 写操作必须等事务 complete 才算成功：
 * 单个请求 success 只说明「已写进事务队列」，事务仍可能整体回滚（配额、中断）。
 */
function transactionToPromise(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 事务失败'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 事务被中止'));
  });
}

/** 抛出的一律是 Error：IDB 有时只给字符串或 null，统一一下便于上层展示 */
function toError(value: unknown, fallback: string): Error {
  if (value instanceof Error) return value;
  if (typeof value === 'string' && value) return new Error(value);
  return new Error(fallback);
}

/**
 * 内存后端必须自己拷贝一次：否则调用方拿到的是同一个对象引用，
 * 外部改一下就把「已经存进库里的数据」一起改了（IndexedDB 是结构化克隆，天然隔离）。
 */
function cloneValue<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // 含函数/Proxy 等不可克隆成员，退回 JSON
    }
  }
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    // 连 JSON 都处理不了（循环引用）：只能存引用，
    // 之后真正写 IndexedDB 会失败并触发降级，不会静默出错。
    return value;
  }
}

/** dbName 默认 'pale-notes'；storeName 默认 'kv' */
export function createKVStore(dbName: string = DEFAULT_DB_NAME, storeName: string = DEFAULT_STORE_NAME): KVStore {
  /** 降级后的存储，也是降级期间唯一可信的「最新值」 */
  const memory = new Map<string, unknown>();
  /** 降级期间删过的键：内存删掉了但 IndexedDB 里可能还有旧值，不能让它被读回来 */
  const tombstones = new Set<string>();
  let dbPromise: Promise<IDBDatabase> | null = null;
  /** 曾成功打开过连接 → 即使之后写入失败，读操作仍值得再试一次 */
  let dbOpened = false;
  let degraded = false;
  /** 降级期间 clear() 过 → 不再回读 IndexedDB 的历史数据 */
  let wiped = false;

  /** 一旦降级就保持降级：会话中途 IndexedDB 半死不活时反复重试只会让每次操作都变慢 */
  function degrade(reason: unknown): void {
    if (degraded) return;
    degraded = true;
    idbAvailable = false;
    console.warn(`[idb] ${dbName}/${storeName} 不可用，已降级为内存存储（刷新页面会丢失）：`, reason);
  }

  /** 惰性打开：首次调用才真的开库，之后复用同一个连接 Promise */
  function openDatabase(): Promise<IDBDatabase> {
    if (!dbPromise) {
      dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
          reject(new Error('当前环境不支持 IndexedDB'));
          return;
        }
        let request: IDBOpenDBRequest;
        try {
          request = indexedDB.open(dbName, 1);
        } catch (err) {
          reject(toError(err, '打开 IndexedDB 失败'));
          return;
        }
        // 只在升级时建表：store 已存在时再 create 会抛错
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
        };
        request.onsuccess = () => {
          const db = request.result;
          dbOpened = true;
          // 别的标签页要升级版本时先让路，否则会把对方一直卡在 blocked 上
          db.onversionchange = () => db.close();
          resolve(db);
        };
        request.onerror = () => reject(request.error ?? new Error('打开 IndexedDB 失败'));
        request.onblocked = () => reject(new Error('IndexedDB 升级被其它标签页阻塞'));
      });
    }
    return dbPromise;
  }

  async function readValue<T>(key: string): Promise<T | undefined> {
    const db = await openDatabase();
    const tx = db.transaction(storeName, 'readonly');
    const value = await requestToPromise<unknown>(tx.objectStore(storeName).get(key));
    return value === undefined ? undefined : (value as T);
  }

  async function writeValue(key: string, value: unknown): Promise<void> {
    const db = await openDatabase();
    const tx = db.transaction(storeName, 'readwrite');
    // 不可结构化克隆的值这里会同步抛 DataCloneError，交给调用处降级处理
    tx.objectStore(storeName).put(value, key);
    await transactionToPromise(tx);
  }

  async function deleteValue(key: string): Promise<void> {
    const db = await openDatabase();
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    await transactionToPromise(tx);
  }

  async function clearAll(): Promise<void> {
    const db = await openDatabase();
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).clear();
    await transactionToPromise(tx);
  }

  return {
    async get<T>(key: string): Promise<T | undefined> {
      // 降级期间写进内存的一定是最新值，优先读它
      if (memory.has(key)) return cloneValue(memory.get(key) as T);
      if (tombstones.has(key) || wiped) return undefined;
      // 没降级，或降级前连接是好的（例如只是配额写满）→ 读还有机会成功，
      // 这样同会话内其它 store 的旧数据不会被误判成「首次运行」而覆盖
      if (!degraded || dbOpened) {
        try {
          return await readValue<T>(key);
        } catch (err) {
          degrade(err);
        }
      }
      return undefined;
    },

    async set<T>(key: string, value: T): Promise<void> {
      tombstones.delete(key); // 重新写入即撤销墓碑
      if (!degraded) {
        try {
          await writeValue(key, value);
          return;
        } catch (err) {
          degrade(err);
        }
      }
      // 已经用不了 IndexedDB：至少把本次改动留在内存里，当前会话还能正常用
      memory.set(key, cloneValue(value));
    },

    async del(key: string): Promise<void> {
      memory.delete(key);
      tombstones.add(key);
      if (!degraded) {
        try {
          await deleteValue(key);
        } catch (err) {
          degrade(err);
        }
      }
    },

    async keys(): Promise<string[]> {
      if (wiped) return [...memory.keys()];
      let fromIdb: string[] = [];
      if (!degraded || dbOpened) {
        try {
          const db = await openDatabase();
          const tx = db.transaction(storeName, 'readonly');
          const raw = await requestToPromise<IDBValidKey[]>(tx.objectStore(storeName).getAllKeys());
          fromIdb = raw.map((k) => String(k));
        } catch (err) {
          degrade(err);
        }
      }
      const merged = new Set<string>(fromIdb);
      for (const key of tombstones) merged.delete(key);
      for (const key of memory.keys()) merged.add(key);
      return [...merged];
    },

    async clear(): Promise<void> {
      memory.clear();
      tombstones.clear();
      if (!degraded) {
        try {
          await clearAll();
          return;
        } catch (err) {
          degrade(err);
        }
      }
      // 已经清不动 IndexedDB 了：记下「已清空」，避免之后又把旧数据读回来
      wiped = true;
    },
  };
}
