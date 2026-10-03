import { useState, useEffect, useRef, Suspense } from 'react'
import { ApiKeyModal } from '@/components/ApiKeyModal'
import { ChoicePanel } from '@/components/ChoicePanel'
import { StatusPanel } from '@/components/StatusPanel'
import { PortraitPanel } from '@/components/PortraitPanel'
import { InventoryPanel } from '@/components/InventoryPanel'
import { RelationshipPanel } from '@/components/RelationshipPanel'
import { DebugPanel } from '@/components/DebugPanel'
import { StartScreen } from '@/components/StartScreen'
import { StatusBar } from '@/components/StatusBar'
import { ChapterOverlay } from '@/components/ChapterOverlay'
import { useGameStore } from '@/stores/game'
import { useSessionStore } from '@/stores/session'
import { useUIStore } from '@/stores/ui'
import { useGameEngine } from '@/hooks/useGameEngine'
import { Menu, X, AlertTriangle } from 'lucide-react'
import { lazyWithRetry, appLoadedCleanly } from '@/utils/lazyWithRetry'
import { ChunkErrorBoundary } from '@/components/ChunkErrorBoundary'
import { SceneBackdrop } from '@/components/SceneBackdrop'

/**
 * 叙事区懒加载。
 * 它会把 react-markdown + rehype-raw 那一整块（284 KB）拉进来，
 * 而卡库首页完全用不到。拆出去后首屏的 index chunk 能压到安全线以下，
 * 进入游戏时再多取一块 —— 每块都小到能在超时前传完。
 */
const NarrativeView = lazyWithRetry(() =>
  import('@/components/NarrativeView').then(m => ({ default: m.NarrativeView }))
)

function App() {
  const { history, resources, resourceDefs, isGameStarted } = useGameStore()
  const { llm } = useUIStore()
  const world = useSessionStore(s => s.world)
  const {
    handleAction,
    retryLastAction,
    isProcessing,
    isAnalyzingData,
    currentOptions,
    streamingContent,
    streamingReasoning,
    debugDataInput,
    debugDataOutput,
    isInputAllowed,
    lastError
  } = useGameEngine()

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [rightPanelTab, setRightPanelTab] = useState<'inventory' | 'relationships'>('inventory')
  const [mobileTab, setMobileTab] = useState<'status' | 'inventory' | 'relationships'>('status')

  const hasInitialized = useRef(false)

  // 应用成功跑起来 8 秒后，把「模块加载失败自动重载」的计数归零，
  // 这样下次真的遇到网络故障时还能享受自动重载。
  // 放在 App 里而不是各 chunk 里：单个 chunk 成功不代表整页健康，
  // 若在重载循环中提前归零就会变成无限刷新。
  useEffect(() => {
    const t = setTimeout(() => appLoadedCleanly(), 8000)
    return () => clearTimeout(t)
  }, [])

  // 会话切换（换了世界卡）时允许重新初始化
  useEffect(() => {
    hasInitialized.current = false
  }, [world?.id])

  // Reset initialization flag when API key changes, allowing retry
  useEffect(() => {
    if (llm.apiKey && isGameStarted && history.length === 0) {
      hasInitialized.current = false
    }
  }, [llm.apiKey, isGameStarted, history.length])

  // 开始游戏后如果还没有历史，触发生成第一幕
  useEffect(() => {
    const ready = llm.apiKey || llm.provider === 'ollama'
    if (isGameStarted && history.length === 0 && !isProcessing && !hasInitialized.current && ready) {
      hasInitialized.current = true
      handleAction('init', '开始故事').catch(() => {
        console.error('Initialization failed.')
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGameStarted, history.length, isProcessing, llm.apiKey, llm.provider])

  const narrativeMessages = history
    .filter(h => h.role === 'assistant' || h.role === 'user' || h.role === 'system')
    .map(h => ({ role: h.role, content: h.content }))

  // 一致性守卫：进了游戏界面但会话里没有世界卡（会话被清、换了浏览器、
  // 存档损坏等）时，绝不能停在游戏界面发一堆「尚未选择世界卡」——
  // 玩家没有任何按钮可点。这里直接退回卡库，让流程重新开始。
  //
  // 注意：必须顺手把 isGameStarted 置回 false。
  // 否则 StartScreen 自己的 `if (isGameStarted) return null` 会让它渲染空内容，
  // 结果是整页全白 —— 比原来的死胡同更难排查（没有报错、没有任何可点的东西）。
  if (isGameStarted && !world) {
    useGameStore.getState().returnToTitle()
    return null
  }

  if (!isGameStarted) {
    return <StartScreen />
  }

  // 主界面顶部资源速览：只取前三个资源，避免自定义资源过多时挤爆
  const quickResources = resourceDefs.slice(0, 3)

  return (
    <div className="flex h-screen h-[100dvh] w-full bg-background text-text-primary overflow-hidden relative">
      <div className="absolute inset-0 bg-neutral-900 opacity-[0.03] pointer-events-none z-0 mix-blend-overlay" />
      <div className="absolute inset-0 bg-radial-gradient from-transparent via-background/50 to-background pointer-events-none z-0" />

      <ApiKeyModal />
      {/* 全身立绘面板（点角色头像打开） */}
      <PortraitPanel />

      {/* Desktop Left Panel (Status) */}
      <aside className="hidden md:block w-64 flex-shrink-0 z-10 relative border-r border-text-muted/30">
        <StatusPanel />
      </aside>

      {/* Main Game Area */}
      <main className="flex-1 flex flex-col min-w-0 relative z-10">
        <ChapterOverlay />
        <StatusBar />

        {/* Mobile Header */}
        <header className="md:hidden h-14 border-b border-text-muted/30 flex items-center px-4 justify-between bg-surface/80 backdrop-blur z-20">
          <span className="font-serif text-accent-lantern font-bold truncate max-w-[8rem]">
            {world?.title || '冒险'}
          </span>
          <div className="flex items-center gap-4">
            <div className="flex gap-3 text-xs font-mono text-text-secondary">
              {quickResources.map(def => (
                <span key={def.id} title={def.name} style={{ color: def.color }}>
                  {resources[def.id] ?? 0}
                </span>
              ))}
            </div>
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="p-1 hover:bg-text-muted/20 rounded"
            >
              {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </header>

        {/* Mobile Menu Overlay */}
        {isMobileMenuOpen && (
          <div className="md:hidden fixed inset-0 bg-background/95 z-50 flex flex-col animate-fade-in">
            <div className="h-14 border-b border-text-muted/30 flex items-center px-4 justify-between bg-surface/80 backdrop-blur">
              <span className="font-serif text-accent-lantern font-bold">菜单</span>
              <button
                onClick={() => setIsMobileMenuOpen(false)}
                className="p-2 hover:bg-text-muted/20 rounded text-text-muted hover:text-text-primary"
              >
                <X size={24} />
              </button>
            </div>

            <div className="flex border-b border-text-muted/20 bg-surface/50">
              {([
                { id: 'status', label: '状态' },
                { id: 'inventory', label: '物品' },
                { id: 'relationships', label: '关系' }
              ] as const).map(t => (
                <button
                  key={t.id}
                  onClick={() => setMobileTab(t.id)}
                  className={`flex-1 py-3 text-xs font-medium uppercase tracking-wider transition-colors ${mobileTab === t.id ? 'text-accent-lantern border-b-2 border-accent-lantern bg-white/5' : 'text-text-muted'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-4 pb-20">
              {mobileTab === 'status' && (
                <StatusPanel className="h-auto overflow-visible border-none p-0 bg-transparent" />
              )}
              {mobileTab === 'inventory' && (
                <InventoryPanel className="h-auto overflow-visible border-none p-0 bg-transparent" />
              )}
              {mobileTab === 'relationships' && (
                <RelationshipPanel className="h-auto overflow-visible border-none p-0 bg-transparent" />
              )}
            </div>
          </div>
        )}

        {/* 错误提示 */}
        {lastError && (
          <div className="flex items-start gap-2 px-4 py-2 text-xs bg-red-900/20 border-b border-red-900/40 text-red-300">
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
            <span className="leading-relaxed">{lastError}</span>
          </div>
        )}

        {/* Narrative Scroll Area */}
        <div className="flex-1 relative min-h-0 overflow-hidden">
          {/*
            场景背景放在**这个不滚动**的容器里，它才有真实高度。
            （放进 NarrativeView 的滚动容器里会被 h-0 压成 0 高，等于没画 —— 踩过一次。）
          */}
          <SceneBackdrop />
          <ChunkErrorBoundary label="叙事区加载失败">
            <Suspense
              fallback={
                <div className="h-full flex items-center justify-center text-xs text-text-muted font-mono">
                  正在载入叙事区…
                </div>
              }
            >
              <NarrativeView
                messages={narrativeMessages}
                isTyping={isProcessing}
                isAnalyzingData={isAnalyzingData}
                streamingContent={streamingContent}
                streamingReasoning={streamingReasoning}
              />
            </Suspense>
          </ChunkErrorBoundary>
        </div>

        {/* Choice Area */}
        <div className="flex-shrink-0 z-10 bg-background relative">
          {!isProcessing && history.length > 1 && (
            <div className="absolute -top-10 right-6 z-20">
              <button
                onClick={retryLastAction}
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono text-text-muted hover:text-accent-lantern border border-text-muted/30 hover:border-accent-lantern/50 rounded bg-background/80 backdrop-blur transition-all"
                title="重新生成本次回应"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 16h5v5" /></svg>
                重新生成
              </button>
            </div>
          )}

          <ChoicePanel
            options={currentOptions}
            disabled={isProcessing}
            isInputAllowed={isInputAllowed}
            onCustomAction={(text) => handleAction('custom_action', text)}
            onSelect={(id) => {
              const opt = currentOptions.find((o: any) => o.id === id)
              handleAction(id, opt?.text || id)
            }}
          />
        </div>
      </main>

      {/* Desktop Right Panel */}
      <aside className="hidden md:flex flex-col w-72 flex-shrink-0 z-10 border-l border-text-muted/30 bg-surface/30">
        <div className="flex border-b border-text-muted/30">
          <button
            onClick={() => setRightPanelTab('inventory')}
            className={`flex-1 py-2 text-xs font-medium uppercase tracking-wider transition-colors ${rightPanelTab === 'inventory' ? 'bg-background text-accent-lantern border-b-2 border-accent-lantern' : 'text-text-muted hover:text-text-primary'}`}
          >
            物品与线索
          </button>
          <button
            onClick={() => setRightPanelTab('relationships')}
            className={`flex-1 py-2 text-xs font-medium uppercase tracking-wider transition-colors ${rightPanelTab === 'relationships' ? 'bg-background text-accent-grail border-b-2 border-accent-grail' : 'text-text-muted hover:text-text-primary'}`}
          >
            人物
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          {rightPanelTab === 'inventory' ? <InventoryPanel /> : <RelationshipPanel />}
        </div>
        <DebugPanel
          dataInput={debugDataInput}
          dataOutput={debugDataOutput}
        />
      </aside>
    </div>
  )
}

export default App
