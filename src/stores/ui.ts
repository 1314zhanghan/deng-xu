import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LLMConfig, SetupSeed } from '@/types/cards'
import { DEFAULT_LLM_CONFIG, getPreset } from '@/api/llm'

interface UIState {
  /** 模型服务配置（服务商 / 地址 / 密钥 / 模型） */
  llm: LLMConfig
  setLlm: (patch: Partial<LLMConfig>) => void

  isApiKeyModalOpen: boolean
  setApiKeyModalOpen: (isOpen: boolean) => void
  showTutorial: boolean
  setShowTutorial: (show: boolean) => void
  statusMessage: string | null
  setStatusMessage: (msg: string | null) => void

  /** 卡片编辑器是否打开 */
  isCardEditorOpen: boolean
  setCardEditorOpen: (open: boolean) => void
  /** 正在编辑的世界卡 id（null 表示新建） */
  editingWorldId: string | null
  setEditingWorldId: (id: string | null) => void

  /**
   * 从编辑器「保存并开始」时，把已保存的世界卡直接带进开局配置。
   * 不靠卡片库按 id 反查，避免尚未持久化的新卡查不到而卡住界面。
   */
  pendingSetup: SetupSeed | null
  setPendingSetup: (seed: SetupSeed | null) => void

  /**
   * 立绘面板：点开某个角色时显示他的全身像素立绘。
   *
   * 存 id 而不是角色对象：角色数据在 gameStore 里会持续更新（关系、状态、位置），
   * 面板要跟着变；存快照就会显示过期信息。
   */
  portraitCharacterId: string | null
  setPortraitCharacterId: (id: string | null) => void

  /**
   * 手机端面板抽屉当前显示的页签；null = 没打开。
   *
   * 放在 store 里而不是 App 的 useState：
   *  `useBackNavigation` 需要订阅"有没有浮层打开"才能给每个浮层压一条历史。
   *  浮层状态藏在组件内部时，hook 看不到它，于是打开抽屉后按返回
   *  会把整页退掉（实测出现过 `alive:false`）。
   */
  mobileSheet: 'status' | 'inventory' | 'relationships' | null
  setMobileSheet: (t: 'status' | 'inventory' | 'relationships' | null) => void
  /** 手机端「更多」菜单是否打开（设置类操作的容器） */
  mobileMenuOpen: boolean
  setMobileMenuOpen: (open: boolean) => void
}

/** 切换服务商时同步默认地址与模型 */
export function applyProviderPreset(current: LLMConfig, provider: LLMConfig['provider']): LLMConfig {
  const preset = getPreset(provider);
  if (!preset) return { ...current, provider };
  return {
    ...current,
    provider,
    baseUrl: preset.baseUrl || current.baseUrl,
    // 只在当前模型不属于新服务商时才替换，避免覆盖用户手填的模型名
    narrativeModel: preset.models.includes(current.narrativeModel)
      ? current.narrativeModel
      : (preset.models[0] || current.narrativeModel),
    analysisModel: preset.models.includes(current.analysisModel)
      ? current.analysisModel
      : (preset.models[0] || current.analysisModel)
  };
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      llm: { ...DEFAULT_LLM_CONFIG },
      setLlm: (patch) => set((state) => ({ llm: { ...state.llm, ...patch } })),

      isApiKeyModalOpen: false,
      setApiKeyModalOpen: (isOpen) => set({ isApiKeyModalOpen: isOpen }),
      showTutorial: false,
      setShowTutorial: (show) => set({ showTutorial: show }),
      statusMessage: null,
      setStatusMessage: (msg) => set({ statusMessage: msg }),

      isCardEditorOpen: false,
      setCardEditorOpen: (open) => set({ isCardEditorOpen: open }),
      editingWorldId: null,
      setEditingWorldId: (id) => set({ editingWorldId: id }),

      pendingSetup: null,
      setPendingSetup: (seed) => set({ pendingSetup: seed }),

      portraitCharacterId: null,
      setPortraitCharacterId: (id) => set({ portraitCharacterId: id }),

      mobileSheet: null,
      setMobileSheet: (t) => set({ mobileSheet: t }),
      mobileMenuOpen: false,
      setMobileMenuOpen: (open) => set({ mobileMenuOpen: open }),
    }),
    {
      name: 'pale-notes-ui',
      // statusMessage / 编辑器开关属于瞬时状态，不落盘
      partialize: (state) => ({ llm: state.llm }),
      version: 2,
      migrate: (persisted: any) => {
        // 兼容旧版本存的裸 apiKey 字段
        if (persisted && typeof persisted.apiKey === 'string' && !persisted.llm) {
          return { llm: { ...DEFAULT_LLM_CONFIG, apiKey: persisted.apiKey } };
        }
        return persisted;
      }
    }
  )
)
