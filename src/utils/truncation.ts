/**
 * 叙事截断检测
 *
 * 为什么需要：
 * 模型有时会在句子中间被截断 —— 可能是 max_tokens 用尽、也可能是流被中断。
 * 返回的既不是空串（那条路径已经处理了），也不是错误，而是一段**看起来正常
 * 但停在半句**的文本。它会照原样进入历史、进入下一轮的上下文，
 * 于是故事里凭空出现一个断句，而且玩家不知道发生了什么。
 *
 * 这里做启发式判断，把可疑情况标出来让玩家决定是否重新生成。
 *
 * 设计原则：**宁可漏报，不可误报**。
 * 误报会让玩家以为正常输出有问题、反复重新生成，比漏报更烦人。
 * 所以只在证据比较明确时才判定为截断。
 */

export interface TruncationCheck {
  /** 是否疑似截断 */
  truncated: boolean
  /** 判定理由（中文，可直接显示给玩家） */
  reason?: string
  /** 置信度：high 用于强证据，low 用于弱证据（界面可以区别对待） */
  confidence?: 'high' | 'low'
}

/** 结尾出现这些符号说明句子/段落是收住的 */
const CLOSING = /[。！？…～”』」）)】》\."'\]}!?]\s*$/

/** 结尾停在这些词上，几乎可以确定是被切断 */
const DANGLING_TAIL = /(因为|所以|但是|可是|然而|不过|而且|并且|如果|虽然|即使|当|在|把|被|对|从|向|与|和|或|是|的|了|着|过|就|都|也|还|很|太|更|最|一|这|那|他|她|它|我|你|们|然后|接着|于是|此外|另外|例如|比如)\s*$/

/** 结尾是未闭合的成对符号 */
const OPEN_PAIRS: [RegExp, RegExp, string][] = [
  [/「/g, /」/g, '「」'],
  [/『/g, /』/g, '『』'],
  [/“/g, /”/g, '“”'],
  [/（/g, /）/g, '（）'],
  [/\(/g, /\)/g, '()'],
  [/【/g, /】/g, '【】'],
  [/《/g, /》/g, '《》'],
]

/** 结尾是逗号/顿号等未完待续的标点 */
const MID_PUNCT = /[，、：；,;:]\s*$/

/**
 * 检测一段叙事是否被截断。
 *
 * @param text          模型返回的叙事正文
 * @param expectedChars 该世界配置的期望字数（用于判断"明显偏短"）
 */
export function detectTruncation(text: string, expectedChars?: number): TruncationCheck {
  const t = (text || '').trim()
  if (!t) return { truncated: false }   // 空串由另一条路径处理

  // —— 强证据 ——

  // 1. 成对符号没闭合
  for (const [open, close, label] of OPEN_PAIRS) {
    const o = (t.match(open) || []).length
    const c = (t.match(close) || []).length
    if (o > c) {
      return {
        truncated: true,
        confidence: 'high',
        reason: `结尾的${label}没有闭合，这段叙事可能被截断了`,
      }
    }
  }

  // 2. 结尾停在明显的连接词上
  if (DANGLING_TAIL.test(t)) {
    return {
      truncated: true,
      confidence: 'high',
      reason: '结尾停在一个连接词上，这段叙事可能被截断了',
    }
  }

  // —— 弱证据 ——

  // 3. 结尾没有收束标点
  const noClosing = !CLOSING.test(t)
  // 4. 结尾是句中标点
  const midPunct = MID_PUNCT.test(t)
  // 5. 明显短于配置的期望长度（八成以上差距才算，避免误报）
  const tooShort = typeof expectedChars === 'number' && expectedChars > 0
    && t.length < expectedChars * 0.35

  if (noClosing && (midPunct || tooShort)) {
    return {
      truncated: true,
      confidence: 'low',
      reason: midPunct
        ? '结尾停在逗号或冒号上，这段叙事可能没有写完'
        : `这段只有约 ${t.length} 字，明显短于设定的篇幅，可能被截断了`,
    }
  }

  return { truncated: false }
}
