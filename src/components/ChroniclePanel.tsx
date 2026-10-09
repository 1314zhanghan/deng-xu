import { useEffect, useMemo, useRef, useState } from 'react'
import { ScrollText, X } from 'lucide-react'
import { useGameStore, type ChatMessage, type GameState } from '@/stores/game'
import { loadArchive } from '@/utils/historyArchive'

/**
 * 编年史 —— 按**轮次**回看「我到底都干了什么」。
 *
 * ## 为什么需要它
 *
 * 叙事区是一条只会变长的流水：玩到 40 轮之后，想回顾自己做过哪些决定，
 * 只能在几百屏文字里一路往上滚，滚两下就不知道看到哪了。
 * 编年史把同一份历史按轮次压成"一行一轮"，需要细节时再展开。
 *
 * ## 数据从哪来（为什么不去加新字段）
 *
 * 直接读 `useGameStore.history` —— 这是引擎**已有**的唯一叙事历史来源
 * （`useGameEngine` 每轮把叙事 `addHistory({role:'assistant'})`，
 * 数据结算后的状态变更 `addHistory({role:'system'})`）。
 * 编年史是**只读投影**：不新增 store 字段、不写回任何状态，
 * 因此它永远不可能与叙事区显示的内容不一致。
 *
 * ## 配对与折叠策略
 *
 * 见 `buildChronicleTurns` 与 `INITIAL_TURNS` 的注释。
 */

/** 默认只铺开最近这么多轮；长局一次铺开几百轮既卡又没法看 */
const INITIAL_TURNS = 10

/** 每次「展开更早」往前多放多少轮 —— 比首屏多一点，少点几下 */
const TURNS_PER_PAGE = 20

/** 一句话摘要的字数上限。再长就不是"摘要"而是正文了 */
const SUMMARY_MAX = 44

export interface ChronicleTurn {
  /**
   * 该轮叙事在 `history` 里的下标。
   * 跳转时用它对齐叙事区的第几段 —— 不存文案，因为文案可能被重新生成。
   * -1 表示这一轮还没有叙事（玩家刚点了行动、模型还在写）。
   */
  narrativeIndex: number
  /** 玩家这一轮的行动文本（引擎目前不把行动写进 history，多数轮为空） */
  action: string
  /** 该轮的完整叙事正文 */
  narrative: string
  /** 该轮结算出的状态变更（引擎在叙事之后追加的 system 条目） */
  changes: string[]
}

/**
 * 把扁平的 `history` 配成"轮"。
 *
 * ⚠️ **锚点是 assistant（叙事）而不是 user（行动）**。
 * 引擎目前**不把玩家行动写进 history** —— 行动只作为 prompt 的 context 发给模型
 * （见 `useGameEngine.buildContext` 与 `narrativeMessages`），
 * history 里实际只有 assistant 与 system 两种条目。
 * 所以：
 *
 *   · 一条 assistant = 一轮（这是唯一可靠的轮边界）；
 *   · 其后的 system（状态变更）归入**上一轮** —— 引擎正是先写叙事、
 *     数据结算完成后再追加状态变更，顺序上必然紧跟；
 *   · user 条目若存在（旧存档、调试面板注入、将来引擎改了）就先记下来，
 *     配给紧随其后的那条叙事，而不是自成一轮（否则一轮会被拆成两条）。
 */
export function buildChronicleTurns(history: ChatMessage[]): ChronicleTurn[] {
  const turns: ChronicleTurn[] = []
  let pendingAction: string | null = null

  history.forEach((msg, index) => {
    if (msg.role === 'user') {
      pendingAction = msg.content
      return
    }

    if (msg.role === 'assistant') {
      turns.push({
        narrativeIndex: index,
        action: pendingAction ?? '',
        narrative: msg.content,
        changes: [],
      })
      pendingAction = null
      return
    }

    // system：状态变更。没有对应叙事时（极少数：开场前的系统条目）直接忽略。
    const last = turns[turns.length - 1]
    if (last) last.changes.push(msg.content)
  })

  // 尾部还没配到叙事的行动 = 正在生成中的一轮。
  // 也要显示：玩家刚点的行动如果"消失"了，会以为没点上。
  if (pendingAction) {
    turns.push({ narrativeIndex: -1, action: pendingAction, narrative: '', changes: [] })
  }

  return turns
}

/** 抹掉 markdown 记号 —— 摘要是给列表看的，不需要粗体、标题、引用符号占位置 */
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[\s>*+-]+/gm, '')
    .replace(/[#*_`~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 一句话摘要：优先取**第一句**（中文句末标点为止），
 * 取不到就截断到 max 字。
 *
 * 为什么不取整段再 CSS 截断：`line-clamp` 还是会把两三句话铺在列表里，
 * 一轮占三行、十轮就翻不到底，"扫一眼"的目的就没了。
 */
export function summarizeTurn(text: string, max = SUMMARY_MAX): string {
  const plain = stripMarkdown(text)
  if (!plain) return ''
  const sentence = plain.match(/^.{1,60}?[。！？!?…]/)?.[0] ?? plain
  return sentence.length > max ? `${sentence.slice(0, max)}…` : sentence
}

/**
 * 展开时用的正文净化：**保留段落换行**，只去掉 markdown 记号。
 *
 * 为什么不直接上 `ReactMarkdown`：它带着 rehype-raw 那一整块（284 KB），
 * App 里正是为了把它挪出首屏才把叙事区做成懒加载的
 * （见 App.tsx 顶部注释）—— 编年史在主 chunk 里，不能把它拖回来。
 */
function cleanNarrative(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '· ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** system 条目的固定前缀，叙事区也是这么剥的（见 NarrativeView） */
function stripChangePrefix(content: string): string {
  return content.replace(/^> \*\*状态变更\*\*: \n?/, '').trim()
}

/**
 * 跳到叙事区的那一段。
 *
 * ⚠️ 为什么用**下标 + DOM 顺序**而不是给每条叙事加锚点 id：
 * `NarrativeView` 不在本次改动范围内。而它的 `messages` 就是 App 过滤后的
 * `history`（assistant/user/system 三种 role 全保留、顺序不变），
 * `role="log"` 容器里的第 i 个子元素正好对应 `messages[i]`，
 * 所以下标是可靠的 —— 代价是它依赖"顺序一致"这个前提，
 * 一旦 NarrativeView 变了排序，这里要跟着改（找不到元素就只提示、不报错）。
 */
function scrollToNarrative(index: number): boolean {
  if (index < 0) return false
  const log = document.querySelector('[role="log"][aria-label="叙事内容"]')
  const target = log?.children[index] as HTMLElement | undefined
  if (!target) return false

  target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  // 用 Web Animations 做一次高亮：不动 DOM 属性，React 重渲染也不会打架
  if (typeof target.animate === 'function') {
    target.animate(
      [{ backgroundColor: 'rgba(245, 158, 11, 0.16)' }, { backgroundColor: 'transparent' }],
      { duration: 1400, easing: 'ease-out' }
    )
  }
  return true
}

interface ChroniclePanelProps {
  open: boolean
  onClose: () => void
}

export function ChroniclePanel({ open, onClose }: ChroniclePanelProps) {
  /*
    只订阅 history：编年史是纯回看，不该因为资源/属性每轮跳动而重渲染整棵列表。
    选择器**显式标注 GameState**：store 的类型推断一旦被别处的循环引用拖崩，
    这里会以 any 的形式静默通过，问题却要等到运行时才暴露。
  */
  const history = useGameStore((s: GameState) => s.history)
  const turns = useMemo(() => buildChronicleTurns(history), [history])

  const [visible, setVisible] = useState(INITIAL_TURNS)
  /** 展开的是哪一轮（存叙事下标，避免用序号做 key 时被折叠误伤） */
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)
  const [jumpHint, setJumpHint] = useState<string | null>(null)
  /** 归档里还有多少条更早的叙事 —— 长局里热存档会被裁剪，不说明会让轮号骗人 */
  const [archivedCount, setArchivedCount] = useState(0)

  // 每次重新打开都回到"最近 10 轮"：否则上次翻了 200 轮的阅读位置会被记住，
  // 下次打开又要滚很久才能看到最新一轮。
  useEffect(() => {
    if (!open) return
    setVisible(INITIAL_TURNS)
    setExpandedIndex(null)
    setJumpHint(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    let alive = true
    // 归档在 IndexedDB 里，读不到就当没有（loadArchive 自己吞异常）
    loadArchive().then(a => {
      if (alive) setArchivedCount(a.messages.length)
    })
    return () => { alive = false }
  }, [open])

  /*
    Esc 关闭。
    这个浮层的开关状态在 App 的 useState 里（本次不改 ui store），
    `useBackNavigation` 因此看不到它 —— 手机系统返回键不会关它。
    桌面上必须补一个键盘出口，否则只能去点右上角的叉。

    onClose 走 ref：App 传的是内联箭头函数，每帧都是新引用，
    而 App 在流式生成时**每帧都会重渲染** —— 直接依赖它就会每帧重绑一次监听器。
  */
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  /** 最近的在前 —— 打开时先看到"我刚干了什么"，往下翻才是更早 */
  const newestFirst = useMemo(() => [...turns].reverse(), [turns])
  const shown = newestFirst.slice(0, visible)
  const remaining = turns.length - shown.length

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-stretch md:items-center justify-center bg-background/85 backdrop-blur-sm animate-fade-in p-0 md:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="编年史"
    >
      {/* 点击空白处关闭（面板本身在下面，是独立的一层，不会误触） */}
      <button type="button" aria-label="关闭编年史" onClick={onClose} className="absolute inset-0" />

      <div className="relative w-full md:max-w-2xl h-full md:h-auto md:max-h-[85vh] flex flex-col bg-surface border-0 md:border border-accent-lantern/20 rounded-none md:rounded-sm shadow-2xl overflow-hidden">
        <header className="h-12 shrink-0 flex items-center justify-between px-4 border-b border-text-muted/20">
          <div className="flex items-center gap-2 min-w-0">
            <ScrollText size={15} className="text-accent-lantern shrink-0" />
            <span className="font-serif font-bold text-sm text-accent-lantern">编年史</span>
            <span className="text-[10px] font-mono text-text-muted truncate">
              共 {turns.length} 轮 · 显示最近 {shown.length} 轮
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭编年史面板"
            className="p-1.5 -mr-1.5 rounded text-text-muted hover:text-text-primary hover:bg-text-muted/15 transition-colors"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto overscroll-contain p-3 md:p-4">
          {turns.length === 0 ? (
            <p className="text-xs text-text-muted italic font-serif py-8 text-center leading-relaxed">
              还没有任何叙事。
              <br />
              开始游戏后，这里会按轮次记下你做过什么。
            </p>
          ) : (
            <ol className="space-y-1.5">
              {shown.map((turn, k) => {
                // 倒序展示，所以轮号要倒着数回去
                const turnNo = turns.length - k
                const isOpen = expandedIndex === turn.narrativeIndex
                const summary = summarizeTurn(turn.narrative)

                return (
                  <li key={turn.narrativeIndex}>
                    <button
                      type="button"
                      onClick={() => {
                        setExpandedIndex(isOpen ? null : turn.narrativeIndex)
                        setJumpHint(null)
                      }}
                      className={`w-full text-left p-2.5 rounded-sm border transition-colors ${
                        isOpen
                          ? 'bg-black/25 border-accent-lantern/40'
                          : 'bg-black/15 border-text-muted/15 hover:border-accent-lantern/30 hover:bg-black/25'
                      }`}
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="text-[10px] font-mono text-accent-lantern/70 shrink-0">
                          第 {turnNo} 轮
                        </span>
                        <span className="text-xs font-serif text-text-secondary leading-relaxed flex-1 min-w-0 break-words">
                          {turn.action && (
                            <span className="text-text-muted italic">你的行动：{turn.action}　</span>
                          )}
                          {summary || (turn.narrative ? '' : '（这一轮还在生成中…）')}
                        </span>
                      </div>

                      {turn.changes.length > 0 && !isOpen && (
                        <div className="mt-1 text-[10px] font-mono text-accent-lantern/50 truncate">
                          ✦ {stripChangePrefix(turn.changes[0]).split('\n')[0]}
                          {turn.changes.length > 1 || stripChangePrefix(turn.changes[0]).includes('\n') ? ' …' : ''}
                        </div>
                      )}
                    </button>

                    {isOpen && (
                      <div className="mt-1 ml-2 pl-3 border-l border-accent-lantern/20 space-y-2">
                        {turn.narrative ? (
                          /*
                            完整叙事。用独立的滚动框而不是随列表铺开：
                            单轮叙事经常上千字，铺开会把"翻更早的轮次"推得老远。
                          */
                          <div className="max-h-[38vh] overflow-y-auto overscroll-contain p-2.5 bg-black/25 rounded-sm">
                            <p className="text-xs font-serif leading-relaxed text-text-primary/85 whitespace-pre-wrap">
                              {cleanNarrative(turn.narrative)}
                            </p>
                          </div>
                        ) : (
                          <p className="text-[11px] text-text-muted italic">这一轮的叙事还没写出来。</p>
                        )}

                        {turn.changes.length > 0 && (
                          <div className="p-2 bg-black/20 rounded-sm border border-text-muted/10">
                            <div className="text-[10px] font-mono text-accent-lantern/60 mb-1">状态变更</div>
                            <div className="text-[11px] font-mono text-text-muted leading-relaxed whitespace-pre-wrap">
                              {turn.changes.map(stripChangePrefix).join('\n')}
                            </div>
                          </div>
                        )}

                        {turn.narrativeIndex >= 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              // 先滚动再关闭：关掉浮层是让玩家能看见那一段，
                              // scrollIntoView 是命令式的，不受卸载影响
                              const ok = scrollToNarrative(turn.narrativeIndex)
                              if (ok) onClose()
                              else setJumpHint('叙事区里找不到对应的那一段（可能已被归档或还没渲染）')
                            }}
                            className="px-2 py-1 text-[11px] font-mono rounded-sm border border-accent-lantern/30 text-accent-lantern/80 hover:bg-accent-lantern/10 transition-colors"
                          >
                            跳到叙事区这一段
                          </button>
                        )}

                        {jumpHint && (
                          <p className="text-[10px] text-accent-forge/80 leading-relaxed">{jumpHint}</p>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ol>
          )}

          {remaining > 0 ? (
            <button
              type="button"
              onClick={() => setVisible(v => v + TURNS_PER_PAGE)}
              className="w-full mt-3 py-2 text-[11px] font-mono text-text-muted hover:text-accent-lantern border border-text-muted/20 hover:border-accent-lantern/30 rounded-sm transition-colors"
            >
              展开更早的 {Math.min(TURNS_PER_PAGE, remaining)} 轮
            </button>
          ) : (
            turns.length > INITIAL_TURNS && (
              <p className="mt-3 text-[10px] font-mono text-text-muted/60 text-center">已到最早一轮</p>
            )
          )}

          {archivedCount > 0 && (
            <p className="mt-3 text-[10px] font-mono text-text-muted/60 text-center leading-relaxed">
              另有 {archivedCount} 条更早的叙事已归档到本机（长局会自动裁剪热存档），不在此列出。
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
