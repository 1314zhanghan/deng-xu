import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { CharacterCard, PlayerCard, WorldCard } from '@/types/cards'

/**
 * 本局会话 store
 *
 * 保存「正在玩哪张世界卡、玩家扮演谁、哪些角色在场」。
 * 之所以把整张世界卡快照存进来，是因为：
 *  1. 引擎每次组提示词都要读它，同步读比异步查 IndexedDB 简单得多；
 *  2. 即使玩家之后去卡片库改了那张卡，进行中的存档也不会莫名其妙变样。
 */
interface SessionState {
  /** 当前世界卡快照 */
  world: WorldCard | null
  /** 当前玩家卡快照 */
  player: PlayerCard | null
  /** 在场角色卡 id（对应 world.characters） */
  activeCharacterIds: string[]
  /** 各背景槽选中的 option id */
  backgroundChoices: Record<string, string>
  /** 玩家分配的属性点 */
  attributeAllocation: Record<string, number>

  setSession: (payload: {
    world: WorldCard
    player: PlayerCard
    activeCharacterIds: string[]
    backgroundChoices: Record<string, string>
    attributeAllocation: Record<string, number>
  }) => void
  /** 存档进行中时更新世界卡快照（例如开场被覆写） */
  patchWorld: (patch: Partial<WorldCard>) => void
  setPlayer: (player: PlayerCard) => void
  setActiveCharacters: (ids: string[]) => void
  clearSession: () => void

  /** 取在场的角色卡对象 */
  getActiveCharacters: () => CharacterCard[]
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      world: null,
      player: null,
      activeCharacterIds: [],
      backgroundChoices: {},
      attributeAllocation: {},

      setSession: ({ world, player, activeCharacterIds, backgroundChoices, attributeAllocation }) => set({
        // 存快照而不是引用，避免卡片库后续编辑影响进行中的存档
        world: JSON.parse(JSON.stringify(world)),
        player: JSON.parse(JSON.stringify(player)),
        activeCharacterIds: [...activeCharacterIds],
        backgroundChoices: { ...backgroundChoices },
        attributeAllocation: { ...attributeAllocation }
      }),

      patchWorld: (patch) => set((state) => (
        state.world ? { world: { ...state.world, ...patch } } : state
      )),

      setPlayer: (player) => set({ player }),
      setActiveCharacters: (ids) => set({ activeCharacterIds: [...ids] }),
      clearSession: () => set({
        world: null,
        player: null,
        activeCharacterIds: [],
        backgroundChoices: {},
        attributeAllocation: {}
      }),

      getActiveCharacters: () => {
        const { world, activeCharacterIds } = get();
        if (!world) return [];
        const ids = new Set(activeCharacterIds);
        return world.characters.filter(c => ids.has(c.id));
      }
    }),
    {
      name: 'pale-notes-session',
      storage: createJSONStorage(() => localStorage)
    }
  )
)
