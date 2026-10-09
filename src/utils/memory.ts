/**
 * 长期记忆的分层模型（A1）
 *
 * ## 为什么要把记忆拆成三层
 *
 * 在这之前，引擎的记忆只有 `summary` 一个字符串（见 buildSummaryPrompt）。
 * 它是**一整块被反复改写的散文**，于是玩到二十轮以后会出现一个必然的衰减：
 *
 *  - **人物关系最先丢**。摘要的容量是固定的 300 字，新剧情不断挤进来，
 *    挤掉的往往是最早那几轮里"谁欠了他、他得罪了谁"。而这几条恰恰是
 *    后续所有对话的前提 —— 模型不知道对方欠过他人情，就会把他当陌生人写。
 *  - **悬而未决的线索会凭空消失**。承诺、债务、威胁这类东西在"发生了什么"的
 *    叙述里毫不起眼，可它们是玩家心里记着的事。摘要压缩一次就没了。
 *  - **时间线会被压成没有轮次的印象**。玩家问"我们之前干过什么"时，
 *    模型只能给出模糊的氛围概括，说不出第几轮发生过什么。
 *
 * 三层的**衰减速度完全不同**，这才是它们必须分开维护的理由：
 *
 *  | 层 | 语义 | 衰减方式 |
 *  |---|---|---|
 *  | `bonds` | 关系**现状** | 只保留最新状态（谁欠谁），旧的覆盖新的 |
 *  | `threads` | 悬而未决 | 只有"了结"才移除，否则一直留着 |
 *  | `timeline` | 按轮次的事实 | 最近的逐条保留，更早的折成一句话 |
 *
 * 混在一段散文里时，三者会按同一个速度衰减 —— 于是最不能丢的那层
 * （关系）反而最先被挤掉。
 *
 * ## 字数上限
 *
 * 三层全部注入提示词，所以必须有一道硬上限：见 `MEMORY_BUDGET`。
 * 超限时**只压缩时间线**（折进 earlierSummary），
 * 因为关系与线索是"丢了就伤"的层 —— 宁可少记几轮发生过什么，
 * 也不能让模型忘记玩家和谁是什么关系。
 */

/** 主角与某个关键角色的关系现状 */
export interface Bond {
  /** 谁（人名或称呼；模型给的原文，不强行归一化） */
  who: string
  /** 关系状态：欠人情 / 敌意 / 盟友 / 猜疑… */
  state: string
}

/** 未结线索：谜题、承诺、债务、威胁 */
export interface Thread {
  id: string
  text: string
}

/** 时间线的一拍：某一轮发生了什么（一句话） */
export interface TimelineBeat {
  turn: number
  text: string
}

/**
 * 三层记忆的完整形态。
 *
 * `summary` 仍然保留：它承载"这一路的经过"的连贯叙述，
 * 是三层结构化记忆**替代不了**的东西（模型读散文比读条目更容易接住语气）。
 * 三层解决的是"要点丢失"，不是"叙述丢失"。
 */
export interface StoryMemory {
  /** 第一层：人物关系现状 */
  bonds: Bond[]
  /** 第二层：未结线索 */
  threads: Thread[]
  /** 第三层：按轮次索引的事件 */
  timeline: TimelineBeat[]
  /**
   * 已被折叠的早期时间线（一句话）。
   *
   * 每次折叠都会把被丢掉的那些拍**压进这里**，所以时间线是有界的，
   * 而"更早发生过什么"这件事仍然有一句可读的交代。
   */
  earlierSummary: string
  /** 最近一次更新的轮次；0 表示还没更新过 */
  updatedAtTurn: number
}

/** 数据 AI 给出的增量补丁（prompt 里也按这个名字叫） */
export interface MemoryPatch {
  bonds?: Bond[]
  threads?: Thread[]
  timeline?: TimelineBeat[]
  earlierSummary?: string
}

/**
 * 三层写入提示词的**硬上限**（字符数）。
 *
 * 为什么是字符数而不是 token：估算 token 需要分词器，而三种中文分词结果
 * 相差不大（中文大致 1 字 ≈ 1 token），字符数是**不需要依赖**的稳定近似。
 * 取 900 —— 加上"前情摘要"（300 字）后整块记忆约 1200 字，
 * 相对每轮几千字的叙事正文是可以接受的固定开销。
 */
export const MEMORY_BUDGET = 900

/**
 * 时间线保留的"逐条拍数"。
 *
 * 超过就折叠最旧的一拍（压进 earlierSummary）。
 * 取值理由：玩家的指代通常是"刚才""上次""前几天"，
 * 12 拍足以覆盖这个范围；再多就要和关系、线索抢预算了。
 */
export const TIMELINE_KEEP = 12

/** 折叠进 earlierSummary 的累计上限（超出只保留最近的） */
export const EARLIER_SUMMARY_LIMIT = 200

/** 渲染时每层最多输出几行 */
const MAX_BOND_LINES = 8
const MAX_THREAD_LINES = 8
/** 单行裁剪长度（超长关系/线索对模型没有额外价值，只吃预算） */
const MAX_BOND_CHARS = 34
const MAX_THREAD_CHARS = 30

export function emptyMemory(): StoryMemory {
  return { bonds: [], threads: [], timeline: [], earlierSummary: '', updatedAtTurn: 0 }
}

/**
 * 把任意来源（旧存档、模型输出）的值收敛成合法的 StoryMemory。
 *
 * 为什么要有这一步：记忆会被写进 localStorage 并被导入导出（saveFile.ts），
 * 旧存档里没有这三个字段；而模型给的永远不能信 —— 它可能给出
 * `bonds: "张三欠我钱"`（字符串而不是数组）、`turn: "第3轮"`、
 * 缺 id 的线索。这里统一滤掉，宁可少几条，也不要让渲染层对着坏数据崩掉。
 *
 * ⚠️ **这个函数不做折叠**（时间线可能超过 TIMELINE_KEEP 条）。
 * 折叠是**有损**操作：它把最旧的几拍压进 `earlierSummary`。
 * 曾经把折叠放在这里，结果合并路径上先被归一化折掉一次、又被合并逻辑
 * 当成"已经折过了"而跳过，`earlierSummary` 直接变成空串 ——
 * 也就是最不该丢的东西丢了（memory.test.ts 里钉着这个回归）。
 * 折叠只发生在两处：`mergeMemory`（写入）与 `renderMemoryForPrompt`（渲染）。
 */
export function normalizeMemory(raw: unknown): StoryMemory {
  const m = (raw && typeof raw === 'object' ? raw : {}) as Partial<StoryMemory>

  const bonds: Bond[] = []
  if (Array.isArray(m.bonds)) {
    for (const b of m.bonds) {
      if (!b || typeof b !== 'object') continue
      const who = str((b as Bond).who)
      const state = str((b as Bond).state)
      if (!who && !state) continue
      bonds.push({ who, state })
    }
  }

  const threads: Thread[] = []
  if (Array.isArray(m.threads)) {
    for (const t of m.threads) {
      if (!t || typeof t !== 'object') continue
      const text = str((t as Thread).text)
      if (!text) continue
      const id = str((t as Thread).id) || text
      threads.push({ id, text })
    }
  }

  const timeline: TimelineBeat[] = []
  if (Array.isArray(m.timeline)) {
    for (const b of m.timeline) {
      if (!b || typeof b !== 'object') continue
      const text = str((b as TimelineBeat).text)
      if (!text) continue
      const rawTurn = Number((b as TimelineBeat).turn)
      // 轮次必须是**正整数**：0 / NaN / 负数都说明模型没按协议写，
      // 与其放进时间线让回溯找不到落点，不如按 0 处理（= 未知轮次）
      const turn = Number.isFinite(rawTurn) && rawTurn > 0 ? Math.floor(rawTurn) : 0
      timeline.push({ turn, text })
    }
  }

  // 排序但不折叠：渲染与合并都按轮次读，乱序会让"最近 N 拍"取错
  timeline.sort((a, b) => a.turn - b.turn)

  return {
    bonds,
    threads,
    timeline,
    earlierSummary: str(m.earlierSummary).slice(0, EARLIER_SUMMARY_LIMIT),
    updatedAtTurn: Number.isFinite(Number(m.updatedAtTurn))
      ? Math.max(0, Math.floor(Number(m.updatedAtTurn)))
      : 0,
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** 按显示宽度裁剪（中文按 1 计；ASCII 也不特殊处理 —— 这条路径只用于中文剧情） */
function clip(s: string, max: number): string {
  const t = (s || '').trim()
  return t.length <= max ? t : t.slice(0, Math.max(0, max - 1)) + '…'
}

/** 大小写与空白不敏感的查重键：模型常把「张三」写成「张三 」或「 张三」 */
function key(s: string): string {
  return (s || '').replace(/\s+/g, '').toLowerCase()
}

/**
 * 合并模型给的记忆补丁。
 *
 * ## 为什么是"合并"而不是"替换"
 *
 * 数据 AI 每轮只看到最近的一段剧情与当前记忆（见 buildSummaryPrompt），
 * 它**看不到更早的轮次**。如果让它整体覆盖，那么任何一次输出不完整
 * （模型漏写 bonds、被 max_tokens 截断、返回半个 JSON）都会让
 * 前面积累的关系与线索**永久消失** —— 而那正是这一层存在的意义。
 *
 * 所以规则是：
 *  - 关系/线索：**并集**。同名同文的合并，谁都没提到的东西继续留着。
 *  - 时间线：同轮次覆盖（模型可能对同一拍给出更准的写法），不同轮次追加。
 *
 * 单条上限（`MAX_BOND_LINES` 等）只在**渲染**时生效，不在存储层裁 ——
 * 裁掉就再也回不来了，而渲染超限只是这一轮少显示几行。
 */
export function mergeMemory(old: StoryMemory | undefined, patch: MemoryPatch | undefined): StoryMemory {
  const base = normalizeMemory(old)

  const incomingBonds = normalizeMemory({ bonds: patch?.bonds }).bonds
  const bonds = [...base.bonds]
  for (const b of incomingBonds) {
    if (key(b.who) === '') {
      // 没写"谁"的关系对模型没有指代价值，直接丢
      continue
    }
    const idx = bonds.findIndex(x => key(x.who) === key(b.who))
    if (idx >= 0) {
      /*
        同一个人只保留一条**最新状态**：关系会变（欠人情 → 结仇），
        两条并存会让模型看见互相矛盾的现状，而它通常会挑更早的那条写 ——
        那恰好是玩家已经推翻的旧关系。

        位置保留在原处（不挪到末尾）：渲染时取的是**最后 N 条**，
        让刚提到的人浮到末尾是有意义的信号（那是当下最相关的关系）。
      */
      bonds[idx] = b
    } else {
      bonds.push(b)
    }
  }

  const incomingThreads = normalizeMemory({ threads: patch?.threads }).threads
  const threads = [...base.threads]
  for (const t of incomingThreads) {
    const dup = threads.findIndex(x => key(x.id) === key(t.id) || key(x.text) === key(t.text))
    if (dup >= 0) threads[dup] = t
    else threads.push(t)
  }

  // 时间线：先并集（同轮次覆盖），再折叠超出的部分
  const byTurn = new Map<number, TimelineBeat>()
  const order: number[] = []
  const incoming = normalizeMemory({ timeline: patch?.timeline }).timeline
  for (const b of [...base.timeline, ...incoming]) {
    if (!byTurn.has(b.turn)) order.push(b.turn)
    byTurn.set(b.turn, b)
  }
  const merged = order.map(t => byTurn.get(t)!)

  const folded = foldTimeline(merged)
  /*
    被折掉的拍子必须**压进 earlierSummary**：时间线可以只留最近 N 拍，
    但"更早发生过什么"不能就此消失 —— 那正是玩家抱怨的那种遗忘。
    这里用 joinClauses 做幂等拼接（重复调用不会翻倍）。
  */
  const foldedText = folded.dropped.length ? foldBeatsIntoSummary(folded.dropped) : ''
  const extraSummary = str(patch?.earlierSummary)
  const earlierSummary = clip(
    joinClauses(joinClauses(base.earlierSummary, foldedText), extraSummary),
    EARLIER_SUMMARY_LIMIT,
  )

  const lastTurn = folded.timeline.reduce((n, b) => Math.max(n, b.turn), 0)

  return {
    bonds,
    threads,
    timeline: folded.timeline,
    earlierSummary,
    updatedAtTurn: Math.max(base.updatedAtTurn, lastTurn),
  }
}

/**
 * 时间线有界化：超出 `TIMELINE_KEEP` 时，返回被折掉的拍子（由调用方写进摘要）。
 *
 * 返回 `dropped` 而不是直接丢弃，是这一层唯一容易被写错的地方：
 * 折叠**必须留下痕迹**，否则"更早发生过什么"会凭空断掉。
 */
function foldTimeline(beats: TimelineBeat[]): { timeline: TimelineBeat[]; dropped: TimelineBeat[] } {
  // 先按轮次排序：模型可能乱序给出，而"最近 N 拍"必须按轮次算
  const sorted = [...beats].sort((a, b) => (a.turn || 0) - (b.turn || 0))
  if (sorted.length <= TIMELINE_KEEP) {
    return { timeline: sorted, dropped: [] }
  }
  const cut = sorted.length - TIMELINE_KEEP
  return { timeline: sorted.slice(cut), dropped: sorted.slice(0, cut) }
}

/** 用「；」把两段话接起来，并去掉完全重复的前缀 */
function joinClauses(a: string, b: string): string {
  const x = (a || '').trim()
  const y = (b || '').trim()
  if (!x) return y
  if (!y) return x
  if (x.includes(y)) return x
  if (y.includes(x)) return y
  return `${x}；${y}`
}

/**
 * 把某拍时间线压成一句可读的短语（用于折叠进 earlierSummary）。
 *
 * 之所以要单独一个函数：折叠几乎是唯一会让玩家觉得"AI 又忘了"的路径，
 * 所以它的行为要有测试钉住（见 memory.test.ts）。
 */
export function foldBeatsIntoSummary(beats: TimelineBeat[], limit = EARLIER_SUMMARY_LIMIT): string {
  const text = beats
    .map(b => (b.turn ? `第${b.turn}轮：${b.text}` : b.text))
    .join('；')
  return clip(text, limit)
}

/**
 * 记录"这一轮发生了什么"。
 *
 * 这是**不需要 LLM 参与**的机械记账：摘要更新每 6 轮才跑一次
 * （token 成本太高），而时间线必须是每轮都有的 ——
 * 否则第 5 轮玩家点回溯时会发现时间线上根本没有第 3 轮。
 *
 * 模型之后可以在摘要阶段把同一拍改写得更好（同轮次覆盖），
 * 但在那之前这里已经保证时间线是完整的。
 */
export function appendTimelineBeat(
  memory: StoryMemory | undefined,
  turn: number,
  text: string,
): StoryMemory {
  const t = str(text)
  if (!t) return normalizeMemory(memory)
  const beat: TimelineBeat = { turn: Math.max(1, Math.floor(turn) || 1), text: clip(t, 80) }
  return mergeMemory(memory, { timeline: [beat] })
}

/**
 * 把三层记忆渲染成注入提示词的文本。
 *
 * 返回空串表示三层都是空的（开局前几轮）—— 调用方据此**完全不注入**，
 * 不要给模型塞一个只有标题、没有内容的空区块，那只会浪费 token
 * 并让它以为记忆丢了。
 *
 * 裁剪顺序是**有意**的：先裁时间线，再裁线索，最后才动关系行数。
 * 理由是三层"丢了有多伤"不同（关系 > 线索 > 时间线），
 * 而 `MEMORY_SOFT_LIMIT` 只在极端情况下才会逼到最后一步。
 */
export function renderMemoryForPrompt(memory: StoryMemory | undefined): string {
  const raw = normalizeMemory(memory)
  // 渲染是只读的：这里折叠不影响存储，但能让提示词里的时间线有界
  const folded = foldTimeline(raw.timeline)
  const earlierSummary = folded.dropped.length
    ? joinClauses(raw.earlierSummary, foldBeatsIntoSummary(folded.dropped))
    : raw.earlierSummary
  const m = { ...raw, timeline: folded.timeline, earlierSummary }

  const hasAnything = m.bonds.length || m.threads.length || m.timeline.length || m.earlierSummary
  if (!hasAnything) return ''

  const lines: string[] = []

  if (m.bonds.length) {
    lines.push('### 人物关系（当前状态，不是历史）')
    for (const b of m.bonds.slice(-MAX_BOND_LINES)) {
      lines.push(`- ${clip(b.who, MAX_BOND_CHARS)}：${clip(b.state, MAX_BOND_CHARS)}`)
    }
  }

  if (m.threads.length) {
    lines.push('### 未结线索（谜题 / 承诺 / 债务 / 威胁）')
    for (const t of m.threads.slice(-MAX_THREAD_LINES)) {
      lines.push(`- ${clip(t.text, MAX_THREAD_CHARS)}`)
    }
  }

  if (m.earlierSummary || m.timeline.length) {
    lines.push('### 事件时间线（按轮次）')
    if (m.earlierSummary) {
      // 更早的轮次已经被折叠成一句话：明确标出来，避免模型把它当成刚发生的事
      lines.push(`- 更早的经过：${m.earlierSummary}`)
    }
    for (const b of m.timeline) {
      lines.push(`- 第${b.turn}轮：${b.text}`)
    }
  }

  return enforceBudget(lines)
}

/**
 * 逐层收紧到预算内。
 *
 * 做法是"按行丢"而不是"按字符截断"：
 * 截断会产生半句话（"张三对他有戒心，因"），
 * 而模型对半句话的处理比少一条更糟 —— 它可能顺着半句编下去。
 *
 * 每层都留一个**下限**（时间线至少 2 拍、线索至少 2 条、关系至少 1 条）：
 * 把某一层清空等于告诉模型"关系/线索一概没有"，
 * 那比超一点预算坏得多。
 */
function enforceBudget(lines: string[]): string {
  const out = [...lines]
  const total = () => out.reduce((n, l) => n + l.length + 1, 0)

  let guard = out.length + 8   // 兜底，防逻辑写错时死循环
  while (total() > MEMORY_BUDGET && guard-- > 0) {
    // 从**时间线的最旧一拍**开始丢（"更早的经过"那一行更值钱，留到最后）
    const tl = linesStartingWith(out, /^- 第\d+轮：/)
    if (tl.length > 2) {
      out.splice(tl[0], 1)
      continue
    }

    const threads = sectionBody(out, '### 未结线索')
    if (threads.length > 2) {
      out.splice(threads[0], 1)
      continue
    }

    const bonds = sectionBody(out, '### 人物关系')
    if (bonds.length > 1) {
      out.splice(bonds[0], 1)
      continue
    }

    break   // 全部触底：宁可略超预算，也不要把某一层清空
  }

  return out.join('\n')
}

/** 所有匹配 `re` 的行下标（升序） */
function linesStartingWith(lines: string[], re: RegExp): number[] {
  const out: number[] = []
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) out.push(i)
  return out
}

/** 某个区块（标题 → 下一个标题之前）里所有正文行的下标（升序） */
function sectionBody(lines: string[], heading: string): number[] {
  const head = lines.findIndex(l => l.startsWith(heading))
  if (head < 0) return []
  const out: number[] = []
  for (let i = head + 1; i < lines.length; i++) {
    if (lines[i].startsWith('###')) break
    if (lines[i].startsWith('- ')) out.push(i)
  }
  return out
}
