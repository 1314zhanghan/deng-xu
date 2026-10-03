import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { StoryState } from '@/types/story'
import type { AttributeDef, ResourceDef, WorldCard } from '@/types/cards'

/**
 * 运行时存档
 *
 * 原版的 aspects / resources 是写死的字段（8 种性相 + 资金/健康/理智）。
 * 现在改成由世界卡定义的动态字典，key 就是定义里的 id。
 */
export type AspectState = Record<string, number>
export type ResourceMap = Record<string, number>

export interface Item {
  id: string
  name: string
  description: string
  tags: string[]
}

export interface Lore {
  id: string
  name: string
  description: string
  principle: string
  level: number
}

export interface Rite {
  id: string
  name: string
  description: string
  requirements: string[]
}

export interface Language {
  id: string
  name: string
  description: string
  script: string
}

export interface Character {
  id: string
  name: string
  description: string
  relationship: string
  status: string
  location?: string
  stats?: Partial<AspectState>
  /** 角色卡的完整提示词资料，注入叙事 AI 用 */
  prompt?: string
  /** 头像（data URL 或 URL）：角色卡自带，优先级最高 */
  avatar?: string
  /**
   * 素材库头像 id。AI 在角色登场时从清单里挑一个，
   * 由 resolveAvatar() 解析成实际图片；avatar 存在时不使用。
   */
  avatarId?: string
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp?: number
}

export interface GameTime {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

export interface Fact {
  id: string
  name: string
  description: string
}

export interface LocationInfo {
  id: string
  name: string
  description: string
  isUnlocked: boolean
}

export interface GameState {
  // —— 世界卡定义的快照（用于渲染与结算）——
  /** 属性定义，含显示名与颜色 */
  attributeDefs: AttributeDef[]
  /** 资源定义，含显示名与上限 */
  resourceDefs: ResourceDef[]

  resources: ResourceMap
  aspects: AspectState
  inventory: Item[]
  lores: Lore[]
  rites: Rite[]
  languages: Language[]
  characters: Character[]
  locations: LocationInfo[]
  unlockedDoors: string[]
  stage: string
  location: string
  /**
   * 当前场景背景 id（来自 SCENE_CATALOG）。
   * AI 在场景明显切换时通过 SET_SCENE 更新它，叙事区据此换背景图。
   */
  sceneId?: string
  time: GameTime
  identity: string
  history: ChatMessage[]
  summary: string
  tags: string[]
  story: StoryState
  currentOptions: any[]
  isGameStarted: boolean
  knownFacts: string[]
  facts: Fact[]
  readBooks: string[]
  masteredLores: string[]

  // Player Profile
  playerName: string
  playerGender: string
  playerAppearance: string
  /**
   * 玩家头像（data URL）。
   * 之前它只存在于 session store 里，游戏界面从来没读过 ——
   * 于是「上传了头像但游戏里看不到」。这里存一份供状态栏渲染。
   */
  playerAvatar?: string

  // Anti-Railroading
  turnsSinceLastMajorEvent: number

  // Actions
  /** 用世界卡初始化数值体系；开局前调用 */
  initFromWorld: (world: WorldCard) => void
  setPlayerProfile: (name: string, gender: string, appearance: string, avatar?: string) => void
  incrementTurnCounter: () => void
  resetTurnCounter: () => void

  setResources: (resources: ResourceMap) => void
  modifyResource: (key: string, amount: number) => void
  setAspects: (aspects: AspectState) => void
  addItem: (item: Item) => void
  removeItem: (itemId: string) => void
  addCharacter: (character: Character) => void
  updateCharacter: (id: string, updates: Partial<Character>) => void
  addLocationInfo: (location: LocationInfo) => void
  addRite: (rite: Rite) => void
  addLanguage: (language: Language) => void
  unlockDoor: (door: string) => void
  addTag: (tag: string) => void
  setLocation: (location: string) => void
  /** 切换场景背景；传 undefined 表示回到默认（无背景） */
  setScene: (sceneId?: string) => void
  setTime: (time: Partial<GameTime>) => void
  advanceTime: (minutes: number) => void
  setIdentity: (identity: string) => void
  addHistory: (message: ChatMessage) => void
  /** 清空对话历史（换卡重开用） */
  clearHistory: () => void
  updateSummary: (summary: string) => void
  startGame: () => void
  resetGame: () => void
  returnToTitle: () => void

  // Story Actions
  setStoryState: (state: Partial<StoryState>) => void
  completeEvent: (eventId: string) => void
  setOrigin: (origin: string | null) => void
  addFact: (fact: string | Fact) => void
  markBookAsRead: (bookId: string) => void
  markLoreAsMastered: (lore: string | Lore) => void
  setCurrentOptions: (options: any[]) => void

  // Snapshot Actions
  lastStateSnapshot: any | null
  saveSnapshot: () => void
  restoreSnapshot: () => void
}

/** 没有任何世界卡时的兜底数值体系（保证 UI 不会空掉） */
export const FALLBACK_ATTRIBUTES: AttributeDef[] = [
  { id: 'might', name: '武力', description: '体魄、搏斗与威慑', color: '#ef4444' },
  { id: 'wits', name: '智识', description: '推理、学识与观察', color: '#3b82f6' },
  { id: 'charm', name: '魅力', description: '言辞、共情与影响力', color: '#a855f7' },
]

export const FALLBACK_RESOURCES: ResourceDef[] = [
  { id: 'health', name: '生命', initial: 5, max: 5, color: '#ef4444', critical: true },
  { id: 'energy', name: '精力', initial: 5, max: 5, color: '#eab308' },
]

function emptyMap(defs: { id: string }[]): Record<string, number> {
  return defs.reduce<Record<string, number>>((acc, d) => {
    acc[d.id] = 0
    return acc
  }, {})
}

function resourceMap(defs: ResourceDef[]): ResourceMap {
  return defs.reduce<ResourceMap>((acc, d) => {
    acc[d.id] = d.initial
    return acc
  }, {})
}

const INITIAL_STATE = {
  attributeDefs: FALLBACK_ATTRIBUTES,
  resourceDefs: FALLBACK_RESOURCES,
  resources: resourceMap(FALLBACK_RESOURCES),
  aspects: emptyMap(FALLBACK_ATTRIBUTES),
  inventory: [],
  lores: [],
  rites: [],
  languages: [],
  characters: [],
  locations: [],
  unlockedDoors: [],
  stage: 'init',
  location: '',
  sceneId: undefined,
  time: {
    year: 1,
    month: 1,
    day: 1,
    hour: 9,
    minute: 0
  },
  identity: '',
  history: [],
  summary: '',
  tags: [],
  isGameStarted: false,
  currentOptions: [],
  knownFacts: [],
  facts: [],
  readBooks: [],
  masteredLores: [],
  lastStateSnapshot: null,
  story: {
    currentChapter: 1,
    completedEvents: [],
    activeEventId: null,
    flags: {},
    origin: null,
    childhood: null,
    uniqueTrait: null
  },
  playerName: '',
  playerGender: '',
  playerAppearance: '',
  playerAvatar: undefined,
  turnsSinceLastMajorEvent: 0
}

export const useGameStore = create<GameState>()(
  persist(
    (set) => ({
      ...INITIAL_STATE,

      initFromWorld: (world) => set(() => {
        const attributeDefs = world.attributes.length ? world.attributes : FALLBACK_ATTRIBUTES;
        const resourceDefs = world.resources.length ? world.resources : FALLBACK_RESOURCES;
        return {
          attributeDefs,
          resourceDefs,
          aspects: emptyMap(attributeDefs),
          resources: resourceMap(resourceDefs)
        };
      }),

      setPlayerProfile: (name, gender, appearance, avatar) => set({ playerName: name, playerGender: gender, playerAppearance: appearance, playerAvatar: avatar }),
      incrementTurnCounter: () => set((state) => ({ turnsSinceLastMajorEvent: state.turnsSinceLastMajorEvent + 1 })),
      resetTurnCounter: () => set({ turnsSinceLastMajorEvent: 0 }),

      setResources: (res) => set((state) => ({ resources: { ...state.resources, ...res } })),
      modifyResource: (key, amount) => set((state) => {
        const def = state.resourceDefs.find(d => d.id === key);
        let next = (state.resources[key] ?? 0) + amount;
        // 有上限的资源不允许溢出；下限统一为 0
        if (def && typeof def.max === 'number') next = Math.min(next, def.max);
        next = Math.max(0, next);
        return { resources: { ...state.resources, [key]: next } };
      }),
      setAspects: (aspects) => set((state) => ({ aspects: { ...state.aspects, ...aspects } })),

      addItem: (item) => set((state) => {
        const existingItemIndex = state.inventory.findIndex(i => i.id === item.id);
        if (existingItemIndex >= 0) {
          const newInventory = [...state.inventory];
          newInventory[existingItemIndex] = item;
          return { inventory: newInventory };
        }
        return { inventory: [...state.inventory, item] };
      }),
      removeItem: (itemId) => set((state) => ({ inventory: state.inventory.filter(i => i.id !== itemId) })),
      addCharacter: (char) => set((state) => {
        // 同一个角色可能被 AI 反复 ADD_CHARACTER，按 id 合并而不是堆重复条目
        const idx = state.characters.findIndex(c => c.id === char.id);
        if (idx >= 0) {
          const next = [...state.characters];
          next[idx] = { ...next[idx], ...char };
          return { characters: next };
        }
        return { characters: [...state.characters, char] };
      }),
      updateCharacter: (id, updates) => set((state) => ({
        characters: state.characters.map(c => c.id === id ? { ...c, ...updates } : c)
      })),
      addLocationInfo: (loc) => set((state) => {
        const existingIndex = state.locations.findIndex(l => l.id === loc.id);
        if (existingIndex >= 0) {
          const newLocations = [...state.locations];
          newLocations[existingIndex] = { ...newLocations[existingIndex], ...loc };
          return { locations: newLocations };
        }
        return { locations: [...state.locations, loc] };
      }),
      addRite: (rite) => set((state) => ({ rites: [...state.rites, rite] })),
      addLanguage: (lang) => set((state) => ({ languages: [...state.languages, lang] })),
      unlockDoor: (door) => set((state) => ({ unlockedDoors: [...state.unlockedDoors, door] })),
      addTag: (tag) => set((state) => ({
        tags: state.tags.includes(tag) ? state.tags : [...state.tags, tag]
      })),
      setLocation: (loc) => set({ location: loc }),
      setScene: (sceneId) => set({ sceneId }),
      setTime: (time) => set((state) => ({ time: { ...state.time, ...time } })),
      advanceTime: (minutes) => set((state) => {
        const newTime = { ...state.time };
        newTime.minute += minutes;
        while (newTime.minute >= 60) {
          newTime.minute -= 60;
          newTime.hour += 1;
        }
        while (newTime.minute < 0) {
          newTime.minute += 60;
          newTime.hour -= 1;
        }
        while (newTime.hour >= 24) {
          newTime.hour -= 24;
          newTime.day += 1;
        }
        while (newTime.hour < 0) {
          newTime.hour += 24;
          newTime.day -= 1;
        }
        // 简化历法：按 30 天一个月推进（世界卡可自行定义纪元，这里只保证单调递增）
        while (newTime.day > 30) {
          newTime.day -= 30;
          newTime.month += 1;
        }
        while (newTime.day < 1) {
          newTime.day += 30;
          newTime.month -= 1;
        }
        while (newTime.month > 12) {
          newTime.month -= 12;
          newTime.year += 1;
        }
        while (newTime.month < 1) {
          newTime.month += 12;
          newTime.year -= 1;
        }
        return { time: newTime };
      }),
      setIdentity: (identity) => set({ identity }),
      addHistory: (msg) => set((state) => ({ history: [...state.history, msg] })),
      clearHistory: () => set({ history: [], summary: '', currentOptions: [] }),
      updateSummary: (summary) => set({ summary }),
      startGame: () => set({ isGameStarted: true }),
      resetGame: () => set({ ...INITIAL_STATE }),
      returnToTitle: () => set({ isGameStarted: false }),

      setStoryState: (storyUpdate) => set((state) => ({ story: { ...state.story, ...storyUpdate } })),
      completeEvent: (eventId) => set((state) => ({
        story: {
          ...state.story,
          completedEvents: state.story.completedEvents.includes(eventId)
            ? state.story.completedEvents
            : [...state.story.completedEvents, eventId],
          activeEventId: null
        }
      })),
      setOrigin: (origin) => set((state) => ({ story: { ...state.story, origin } })),
      addFact: (fact) => set((state) => {
        const factId = typeof fact === 'string' ? fact : fact.id;
        if (state.knownFacts.includes(factId)) {
          // 已知线索但这次带来了更完整的对象 → 更新描述
          if (typeof fact !== 'string') {
            const idx = state.facts.findIndex(f => f.id === factId);
            if (idx >= 0) {
              const next = [...state.facts];
              next[idx] = { ...next[idx], ...fact };
              return { facts: next };
            }
            return { facts: [...state.facts, fact] };
          }
          return state;
        }

        const newFacts = typeof fact === 'string' ? state.facts : [...state.facts, fact];

        return {
          knownFacts: [...state.knownFacts, factId],
          facts: newFacts
        };
      }),
      markBookAsRead: (bookId) => set((state) => {
        if (state.readBooks.includes(bookId)) return state;
        return { readBooks: [...state.readBooks, bookId] };
      }),
      markLoreAsMastered: (lore) => set((state) => {
        const loreId = typeof lore === 'string' ? lore : lore.id;
        if (state.masteredLores.includes(loreId)) return state;

        const newLores = typeof lore === 'string' ? state.lores : [...state.lores, lore];

        return {
          masteredLores: [...state.masteredLores, loreId],
          lores: newLores
        };
      }),
      setCurrentOptions: (options) => set({ currentOptions: options }),

      saveSnapshot: () => set((state) => {
        const snapshot = {
          resources: state.resources,
          aspects: state.aspects,
          inventory: state.inventory,
          lores: state.lores,
          rites: state.rites,
          languages: state.languages,
          characters: state.characters,
          locations: state.locations,
          unlockedDoors: state.unlockedDoors,
          stage: state.stage,
          location: state.location,
          time: state.time,
          identity: state.identity,
          history: state.history,
          summary: state.summary,
          tags: state.tags,
          story: state.story,
          currentOptions: state.currentOptions,
          isGameStarted: state.isGameStarted,
          knownFacts: state.knownFacts,
          facts: state.facts,
          readBooks: state.readBooks,
          masteredLores: state.masteredLores
        };
        return { lastStateSnapshot: JSON.parse(JSON.stringify(snapshot)) };
      }),

      restoreSnapshot: () => set((state) => {
        if (!state.lastStateSnapshot) return state;
        return { ...state.lastStateSnapshot, lastStateSnapshot: null };
      })
    }),
    {
      name: 'pale-notes-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => {
        // 不持久化 isGameStarted，保证刷新后总是回到标题页；世界卡配置由 session store 从 IndexedDB 恢复
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { isGameStarted, lastStateSnapshot, ...rest } = state
        return rest
      }
    }
  )
)
