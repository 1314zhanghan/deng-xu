import { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { ApiKeyModal } from '@/components/ApiKeyModal'
import { ChoicePanel } from '@/components/ChoicePanel'
import { StatusPanel } from '@/components/StatusPanel'
import { GameMenuActions } from '@/components/GameMenuActions'
import { MobileTabBar, type MobileTab } from '@/components/MobileTabBar'
import { MobileSheet } from '@/components/MobileSheet'
import { recordPlay } from '@/utils/recentPlays'
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
import { X, AlertTriangle } from 'lucide-react'
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
  const { history, resources, resourceDefs, isGameStarted, playerName, location } = useGameStore()
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
    lastError,
    truncationWarning,
    clearTruncationWarning
  } = useGameEngine()

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [rightPanelTab, setRightPanelTab] = useState<'inventory' | 'relationships'>('inventory')
  /**
   * 手机端当前打开的面板抽屉；null = 都关着。
   *
   * 原先这个状态只有"全屏菜单"在消费，底栏改了它却没人渲染内容，
   * 于是点底栏什么都不出现（玩家反馈「底栏无效」）。
   * 现在它直接驱动 MobileSheet。
   */
  const [mobileTab, setMobileTab] = useState<MobileTab | null>(null)

  const hasInitialized = useRef(false)

  /**
   * 手机返回键 / 浏览器后退键 → **退回上一级界面**，而不是退出网站。
   *
   * 为什么需要：手机上从浏览器打开时按系统返回键会直接离开页面回到主页，
   * 玩家以为"退出到上一级"，结果整个游戏没了。
   *
   * 做法：打开浮层时压入一条**哨兵历史记录**，返回键先消费它。
   *
   * 这个功能我改了四版才对，把踩过的坑留在这里：
   *  1. 用 `history.state?.__dxOverlay` 判断"栈顶是不是我的哨兵" ——
   *     React effect 与 popstate 的时序交错时这个判断不可靠。
   *  2. 让"切换页签"先关旧抽屉再开新的，而关旧抽屉里调了 `history.back()`
   *     —— popstate 异步到达，把刚打开的新抽屉也关了。
   *  3. 用一个"忽略自己发起的回退"的计数器，结果把**用户真正按的返回**
   *     也当成自己的（我先加计数再调 back，用户的 popstate 永远被吞）。
   *  4. **打开的动作必须是同步的**：如果压哨兵放在 effect 里，
   *     用户（或测试）在 effect 执行前按返回，就会直接离开页面。
   *
   * 最终形态：**打开与关闭都在事件处理里同步改历史**，
   * effect 只保留一个兜底（浮层通过其它路径被关掉时把哨兵收回来）。
   */
  /** 当前栈里是否有我们压的哨兵 */
  const sentinelRef = useRef(false)
  /** 当前浮层是靠弹栈关掉的（用于避免关闭时再弹一次） */
  const closedByPopRef = useRef(false)

  const openOverlay = useCallback((next: { tab?: MobileTab | null; menu?: boolean }) => {
    if (!sentinelRef.current) {
      sentinelRef.current = true
      window.history.pushState({ __dxOverlay: true }, '')
    }
    closedByPopRef.current = false
    if (next.tab !== undefined) setMobileTab(next.tab)
    if (next.menu !== undefined) setIsMobileMenuOpen(next.menu)
  }, [])

  const closeOverlay = useCallback(() => {
    const wasOpen = sentinelRef.current
    sentinelRef.current = false
    closedByPopRef.current = false
    setMobileTab(null)
    setIsMobileMenuOpen(false)
    // 浮层是我们自己关的 → 把哨兵收回来，保持历史栈干净
    if (wasOpen) window.history.back()
  }, [])

  useEffect(() => {
    const onPop = () => {
      if (!sentinelRef.current) return
      // 浏览器已经帮我们弹掉了哨兵 → 只需关掉浮层，不要再 back 一次
      sentinelRef.current = false
      closedByPopRef.current = true
      setMobileTab(null)
      setIsMobileMenuOpen(false)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

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

  /**
   * 记录「最近玩过」。
   *
   * 只在**游戏真正开始时**与**每轮叙事结束后**写一次 —— 不是每次渲染都写，
   * 否则会疯狂访问 localStorage。
   * 放在 App 里而不是引擎里：引擎不关心"历史列表"这种事，
   * 而且这样世界卡被删掉后记录仍在（条目会标灰）。
   */
  useEffect(() => {
    if (!isGameStarted || !world) return
    recordPlay({
      worldId: world.id,
      title: world.title,
      playerName,
      turns: history.length,
      location: location || '',
    })
  }, [isGameStarted, world, playerName, history.length, location])

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

        {/*
          Mobile Header。
          去掉了右上角的汉堡按钮：它和底栏的「更多」是同一个入口，
          两个入口摆在屏幕上显得杂乱；资源速览保留，因为它要常驻可见。
        */}
        <header className="md:hidden h-14 border-b border-text-muted/30 flex items-center px-4 justify-between bg-surface/80 backdrop-blur z-20">
          <span className="font-serif text-accent-lantern font-bold truncate max-w-[9rem]">
            {world?.title || '冒险'}
          </span>
          <div className="flex gap-3 text-xs font-mono text-text-secondary">
            {quickResources.map(def => (
              <span key={def.id} title={def.name} style={{ color: def.color }}>
                {resources[def.id] ?? 0}
              </span>
            ))}
          </div>
        </header>

        {/*
          「更多」菜单。
          只放**设置类**操作 —— 状态/物品/人物三个面板已经由底栏的
          MobileSheet 抽屉承担，这里再放一套页签就是重复入口，
          玩家会不知道该点哪个。
        */}
        {isMobileMenuOpen && (
          <div className="md:hidden fixed inset-0 bg-background/95 z-50 flex flex-col animate-fade-in">
            <div className="h-14 border-b border-text-muted/30 flex items-center px-4 justify-between bg-surface/80 backdrop-blur">
              <span className="font-serif text-accent-lantern font-bold">菜单</span>
              <button
                onClick={closeOverlay}
                className="p-2 hover:bg-text-muted/20 rounded text-text-muted hover:text-text-primary"
                aria-label="关闭菜单"
              >
                <X size={24} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <GameMenuActions />
            </div>
          </div>
        )}

        {/*
          截断提示。
          与错误条分开：这一轮是**成功生成**的，只是可能没写完 ——
          用琥珀色警告而不是红色错误，并且可以关掉（玩家可能觉得这段没问题）。
        */}
        {truncationWarning && !lastError && (
          <div className="flex items-start gap-2 px-4 py-2 text-xs bg-amber-900/20 border-b border-amber-900/40 text-amber-300">
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
            <span className="leading-relaxed flex-1 min-w-0">
              {truncationWarning}
            </span>
            <button
              onClick={() => retryLastAction()}
              disabled={isProcessing}
              className="shrink-0 px-2 py-0.5 text-[10px] border border-amber-400/40 rounded hover:bg-amber-500/15 transition-colors disabled:opacity-40"
            >
              {isProcessing ? '处理中…' : '重新生成'}
            </button>
            <button
              onClick={() => clearTruncationWarning()}
              className="shrink-0 p-0.5 text-amber-400/70 hover:text-amber-200 transition-colors"
              title="忽略"
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* 错误提示 */}
        {lastError && (
          <div className="flex items-start gap-2 px-4 py-2 text-xs bg-red-900/20 border-b border-red-900/40 text-red-300">
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
            <span className="leading-relaxed flex-1 min-w-0">{lastError}</span>
            {/*
              加一个重试出口。
              之前这里只有文字：生成失败后玩家知道了原因，却没有任何可点的动作 ——
              只能自己重新输入一遍行动。而 retryLastAction 早就存在、只是没接到这里。
            */}
            <button
              onClick={() => retryLastAction()}
              disabled={isProcessing}
              className="shrink-0 px-2 py-0.5 text-[10px] border border-red-400/40 rounded hover:bg-red-500/15 transition-colors disabled:opacity-40"
            >
              {isProcessing ? '处理中…' : '重试'}
            </button>
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

        {/*
          手机端底部标签栏。
          之前要切"物品/人物"必须先点右上角打开全屏菜单 —— 每看一次背包
          就损失一次与叙事区的视线连接，来回两步。改成常驻底栏一键直达。
          「更多」里放频率低的操作（模型设置 / 返回标题 / 素材署名）。
        */}
        <MobileTabBar
          tab={mobileTab}
          onTab={t => {
            // 再点一次已打开的页签 → 收起（符合移动端惯例）
            if (mobileTab === t) closeOverlay()
            else openOverlay({ tab: t, menu: false })
          }}
          onOpenMore={() => {
            if (isMobileMenuOpen) closeOverlay()
            else openOverlay({ menu: true, tab: null })
          }}
          moreActive={isMobileMenuOpen}
        />
      </main>

      {/*
        手机端面板抽屉：底栏点哪个就弹哪个。
        `bottom` 是底栏自己上报的高度（CSS 变量 --dx-tabbar-h），
        所以抽屉与遮罩都**不会盖住底栏** —— 底栏始终可点，
        玩家可以在三个面板之间直接切换，不用先关再开。
      */}
      {mobileTab && (
        <MobileSheet
          tab={mobileTab}
          onClose={closeOverlay}
        />
      )}

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
