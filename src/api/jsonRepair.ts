/**
 * 模型输出的容错 JSON 解析
 *
 * 背景：数据结算 AI 的输出经常不是合法 JSON —— 中文引号、值里未转义的双引号、
 * 尾逗号、单引号、缺右括号、`{key: value}` 这种裸键……都会出现。
 *
 * 原项目用「逐行正则」修补，但那条正则要求**整行恰好**是 `"key": "value"`，
 * 而模型实际输出几乎总是单行压缩的 JSON，所以修补从未真正生效。
 * 这里改为字符级扫描：真正的字符串状态机 + 上下文判断引号是开还是闭，
 * 遇到明显的结构错误就修复，完全无法修复时才抛错。
 */

export interface ParseAttempt {
  label: string
  ok: boolean
  error?: string
}

export interface TolerantParseResult {
  value: unknown
  /** 实际成功的那一步，用于调试展示 */
  strategy: string
  /** 每一步的尝试记录，便于排查模型输出问题 */
  attempts: ParseAttempt[]
}

const DELIMITER_AFTER = new Set([',', '}', ']', ':', '', undefined])
const WS = new Set([' ', '\t', '\n', '\r'])

/** 直接解析，顺带把尾逗号去掉（模型最常见的错误） */
function plainParse(input: string): unknown {
  const stripped = input.replace(/,(\s*[}\]])/g, '$1')
  return JSON.parse(stripped)
}

/** 遇到第一个 `{` 或 `[` 作为起点，尽量只截出 JSON 主体 */
function withoutProse(input: string): string {
  let text = input.trim()

  // 去掉 markdown 代码块围栏
  const fence = text.match(/```(?:json|JSON)?\s*([\s\S]*?)\s*```/)
  if (fence) text = fence[1].trim()

  const firstObj = text.indexOf('{')
  const firstArr = text.indexOf('[')
  let start = -1
  if (firstObj === -1) start = firstArr
  else if (firstArr === -1) start = firstObj
  else start = Math.min(firstObj, firstArr)

  if (start > 0) text = text.slice(start)
  return text.trim()
}

/** 把字符串里的换行、控制字符转义成合法 JSON */
function sanitizeStringBody(body: string): string {
  return body
    .replace(/\\/g, '\u0000')                                   // 先保护已有转义，避免下面重复转义
    .replace(/\u0000([\\/"bfnrtu])/g, '\\$1')                   // 还原合法转义
    .replace(/\u0000/g, '\\\\')                                 // 其余反斜杠转义
    .replace(/\r?\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/[\u0000-\u001f]/g, '')
}

export function parseModelJson(raw: string): TolerantParseResult {
  const attempts: ParseAttempt[] = []

  const tryStrategy = (label: string, fn: () => unknown): { value: unknown; strategy: string } | null => {
    try {
      const value = fn()
      // undefined 不算解析成功：模型返回空或全是噪声时，
      // 宁可走后续策略或最终抛错，也不要让调用方拿到 undefined 再崩在别处。
      if (value === undefined) throw new Error('解析结果为空')
      attempts.push({ label, ok: true })
      return { value, strategy: label }
    } catch (e) {
      attempts.push({ label, ok: false, error: e instanceof Error ? e.message : String(e) })
      return null
    }
  }

  const trimmed = (raw ?? '').trim()
  if (!trimmed) {
    // 与其它失败路径保持一致：要么给出可用结果，要么抛错。
    // 返回 undefined 会让调用方在别处莫名其妙地崩掉。
    attempts.push({ label: 'input', ok: false, error: '模型返回空内容' })
    throw new Error('无法解析模型返回的 JSON：内容为空。')
  }

  // ① 原样
  let r = tryStrategy('direct', () => plainParse(trimmed))
  if (r) return { ...r, attempts }

  // ② 剥掉散文与代码块围栏
  const stripped = withoutProse(trimmed)
  if (stripped !== trimmed) {
    r = tryStrategy('strip-prose', () => plainParse(stripped))
    if (r) return { ...r, attempts }
  }

  // ③ 字符级修复
  const repaired = repairJson(stripped)
  r = tryStrategy('repair', () => plainParse(repaired))
  if (r) return { ...r, attempts }

  // ④ 修复后仍然被截断：补齐未闭合的结构
  r = tryStrategy('repair+close', () => plainParse(balanceJson(repaired)))
  if (r) return { ...r, attempts }

  throw new Error(
    `无法解析模型返回的 JSON。已尝试：${attempts.map(a => (a.ok ? '✓' : '✗') + a.label).join('、')}`
  )
}

/** 扫描字符串字面量：正确处理嵌套引号，并返回结束位置 */
function scanString(src: string, quoteIndex: number, isKey: boolean): { raw: string; nextIndex: number } {
  const quote = src[quoteIndex]
  let i = quoteIndex + 1

  if (quote === "'") {
    // 单引号字符串：模型偶尔会用；内部不再嵌套单引号
    const end = src.indexOf("'", i)
    const raw = end === -1 ? src.slice(i) : src.slice(i, end)
    return { raw: JSON.stringify(raw).slice(1, -1), nextIndex: end === -1 ? src.length : end + 1 }
  }

  let body = ''
  while (i < src.length) {
    const ch = src[i]

    if (ch === '\\') {
      // 已经是合法转义就保留，否则当作普通反斜杠
      const nx = src[i + 1]
      if (nx !== undefined && /[\\/"bfnrtu]/.test(nx)) {
        body += ch + nx
        i += 2
        continue
      }
      body += '\\\\'
      i += 1
      continue
    }

    if (ch === '"') {
      // 判断这是闭合引号还是内容里未转义的引号：
      // 值里的 `"` 后面通常还跟着内容字符，而闭合引号后面只会是分隔符。
      let j = i + 1
      while (j < src.length && WS.has(src[j])) j += 1
      const after = j < src.length ? src[j] : ''

      if (isKey || DELIMITER_AFTER.has(after)) {
        return {
          raw: sanitizeStringBody(body),
          nextIndex: i + 1
        }
      }
      // 内容里的引号 → 换成中文引号，保证语义不丢且 JSON 合法
      body += '\u300c'
      i += 1
      continue
    }

    if (ch === '\n' || ch === '\r' || ch === '\t') {
      body += ch === '\t' ? '\\t' : '\\n'
      i += 1
      continue
    }

    body += ch
    i += 1
  }

  return { raw: sanitizeStringBody(body), nextIndex: src.length }
}

/**
 * 字符级修复扫描器。
 * 处理：裸键、单引号字符串、值内未转义引号、缺失逗号、尾逗号、控制字符。
 */
function repairJson(src: string): string {
  let out = ''
  let i = 0
  /** 只有紧跟在 { 或 , 之后的字符串才可能是键 */
  let expectKey = false
  /** 括号深度：回到 0 说明顶层结构已经完整，后面的都是散文 */
  let depth = 0
  let sawContainer = false

  // 判断前面是否已经有内容（用于决定缺失逗号时是否需要补）
  const lastNonWs = (): string => {
    for (let k = out.length - 1; k >= 0; k--) {
      if (!WS.has(out[k])) return out[k]
    }
    return ''
  }

  while (i < src.length) {
    const ch = src[i]

    // 顶层容器已闭合，剩余内容是模型附带的解释文字，直接忽略。
    // 否则它们会被当成 JSON 记号拼进去，反而把结构弄坏。
    if (sawContainer && depth === 0) break

    if (WS.has(ch)) {
      // 丢弃原有空白：下面按结构自行补空白，避免换行留进字符串
      i += 1
      continue
    }

    if (ch === '"' || ch === "'") {
      const isKey = expectKey
      const { raw, nextIndex } = scanString(src, i, isKey)
      const token = `"${raw}"`

      const prev = lastNonWs()
      // `{"a":1 "b":2}` 这种缺逗号的情况
      if (prev !== '' && prev !== '{' && prev !== '[' && prev !== ':' && prev !== ',') {
        out += ','
      }

      out += token
      i = nextIndex

      // 键之后期待冒号；值之后不再是键
      let j = i
      while (j < src.length && WS.has(src[j])) j += 1
      if (src[j] === ':') {
        out += ':'
        i = j + 1
        expectKey = false
      } else {
        expectKey = false
      }
      continue
    }

    if (ch === '{' || ch === '[') {
      out += ch
      depth += 1
      sawContainer = true
      expectKey = ch === '{'
      i += 1
      continue
    }

    if (ch === '}' || ch === ']') {
      // 去掉尾逗号
      if (lastNonWs() === ',') out = out.slice(0, out.lastIndexOf(','))
      out += ch
      depth = Math.max(0, depth - 1)
      expectKey = false
      i += 1
      continue
    }

    if (ch === ':') {
      out += ':'
      expectKey = false
      i += 1
      continue
    }

    if (ch === ',') {
      if (lastNonWs() === ',' || lastNonWs() === '{' || lastNonWs() === '[') {
        i += 1
        continue
      }
      out += ','
      expectKey = true
      i += 1
      continue
    }

    // 裸键：{ key: 1 } → { "key": 1 }
    if (expectKey && /[A-Za-z_$]/.test(ch)) {
      let word = ''
      let j = i
      while (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) {
        word += src[j]
        j += 1
      }
      let k = j
      while (k < src.length && WS.has(src[k])) k += 1
      if (src[k] === ':') {
        out += `"${word}":`
        i = k + 1
        expectKey = false
        continue
      }
      // 不是键，当作普通裸值
      out += `"${word}"`
      i = j
      continue
    }

    out += ch
    expectKey = false
    i += 1
  }

  return out
}

/** 补齐未闭合的字符串与括号（处理被 max_tokens 截断的输出） */
function balanceJson(src: string): string {
  let out = ''
  const stack: string[] = []
  let inString = false
  let escaped = false

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]

    if (inString) {
      if (escaped) { escaped = false; out += ch; continue }
      if (ch === '\\') { escaped = true; out += ch; continue }
      if (ch === '"') { inString = false; out += ch; continue }
      out += ch
      continue
    }

    if (ch === '"') { inString = true; out += ch; continue }
    if (ch === '{' || ch === '[') stack.push(ch)
    if (ch === '}' || ch === ']') stack.pop()
    out += ch
  }

  if (inString) out += '"'

  // 去掉因截断留下的半截键值，例如 `..."text":` 或 `..., `
  out = out.replace(/,\s*$/, '')
  out = out.replace(/:\s*$/, ':null')

  // 闭合仍未结束的容器
  while (stack.length) {
    const open = stack.pop()
    out += open === '{' ? '}' : ']'
  }

  return out
}
