import { describe, it, expect } from 'vitest'

/**
 * 截断续写的拼接逻辑。
 *
 * 这段代码看着简单，但它是"自动续写"能不能用的关键：
 * 模型接到"接着写完"的指令后，**几乎总会把已写的最后一句再重复一遍**，
 * 直接拼接就会得到「他推开门。他推开门。屋里很冷。」
 *
 * 所以这里从长到短试探重叠并去重。放在单独文件里是为了能直接测 ——
 * useGameEngine.ts 会 import 一堆 store，在 node 环境里跑不起来。
 */

/**
 * 与 useGameEngine 中的实现保持一致（同步修改时两边都要改）。
 *
 * 合并时要把模型**重复已写内容**的部分去掉。两种情况都要处理：
 *   A. 续写从整句之后接上 → 原文的结尾是续写的前缀
 *      「他推开门。」 + 「他推开门。屋里很冷。」
 *   B. 续写从半句之后接上 → 原文的结尾**被包含在**续写里
 *      「他推开门，看见」 + 「看见桌上放着一封信。」
 * 第一版只做了 A 的正向 `startsWith`，B 完全没覆盖；
 * 而且把最小重叠长度写成 6，导致只有 5 个字符的「他推开门。」被直接滤掉。
 */
export function mergeContinuation(original: string, continuation: string): string {
  const a = original.replace(/\s+$/, '')
  const b = continuation.trim()
  if (!b) return a
  // 续写完全被原文包含 → 视为没有新增
  if (a.endsWith(b)) return a

  /*
    在原文结尾与续写开头之间找**最大重叠**。
    重叠 = 原文结尾的一段 == 续写开头的一段（两段完全相同的字符串）。
    长度上界取 min(a.length, b.length)，下界 4 个字（太短会误删真实内容）。
  */
  const max = Math.min(a.length, b.length)
  for (let len = max; len >= 4; len--) {
    const tail = a.slice(a.length - len)
    const head = b.slice(0, len)
    if (tail === head) return a + b.slice(len)
  }

  // 无重叠：直接拼接。中文之间不加空格，西文之间补一个。
  const needSpace = /[A-Za-z0-9,.;:'"]$/.test(a) && /^[A-Za-z0-9]/.test(b)
  return a + (needSpace ? ' ' : '') + b
}

describe('截断续写的拼接', () => {
  it('无重叠时直接接上', () => {
    expect(mergeContinuation('他推开门。', '屋里很冷。')).toBe('他推开门。屋里很冷。')
  })

  it('模型重复了整句 → 去掉重复', () => {
    expect(mergeContinuation('他推开门。', '他推开门。屋里很冷。')).toBe('他推开门。屋里很冷。')
  })

  it('半句重叠只有 2 字时**不去重** —— 太短的重叠去重会误删真实内容', () => {
    /*
      原文结尾「看见」与续写开头「看见」重叠，但只有 2 个字。
      这种短重叠既可能是模型重复，也可能只是巧合（"看见"本身是常用词），
      去掉的风险大于收益 —— 宁可留一点重复，也不能把正文吃掉。
      所以最小重叠长度定为 4 个字。
    */
    expect(mergeContinuation('他推开门，看见', '看见桌上放着一封信。'))
      .toBe('他推开门，看见看见桌上放着一封信。')
  })

  it('重叠达到 4 字以上时才去重', () => {
    // 「桌上放着」4 字重叠 → 去重
    expect(mergeContinuation('他推开门，看见桌上放着', '桌上放着一封信。'))
      .toBe('他推开门，看见桌上放着一封信。')
  })

  it('模型重复了很长一段（跨句）→ 去掉重复', () => {
    const a = '她抬头看了一眼窗外。雨还在下，敲在铁皮上。她忽然想起很多年前的一个下午'
    const b = '雨还在下，敲在铁皮上。她忽然想起很多年前的一个下午，那时候雨也是这么大。'
    const out = mergeContinuation(a, b)
    expect(out).toBe('她抬头看了一眼窗外。雨还在下，敲在铁皮上。她忽然想起很多年前的一个下午，那时候雨也是这么大。')
  })

  it('续写完全被原文包含 → 视为没有新增（不重复输出）', () => {
    const a = '这是一段完整的话，后面还有内容。'
    expect(mergeContinuation(a, '后面还有内容。')).toBe(a)
  })

  it('西文之间补一个空格', () => {
    expect(mergeContinuation('The door opened.', 'Nobody was there.'))
      .toBe('The door opened. Nobody was there.')
  })

  it('中文之间不补空格', () => {
    const out = mergeContinuation('门开了。', '没有人。')
    expect(out).toBe('门开了。没有人。')
    expect(out).not.toMatch(/\s/)
  })

  it('结尾空白被清掉（避免拼出换行空洞）', () => {
    expect(mergeContinuation('门开了。   \n\n', '没有人。')).toBe('门开了。没有人。')
  })

  it('短于 6 字的偶然重合不去重（避免误删真实内容）', () => {
    // "了。" 只有 2 字，不该当成重叠
    const out = mergeContinuation('他走。', '了。')
    expect(out).toBe('他走。了。')
  })

  it('续写为空时原样返回', () => {
    expect(mergeContinuation('原文。', '')).toBe('原文。')
    expect(mergeContinuation('原文。', '   ')).toBe('原文。')
  })

  it('结果是幂等的：拼接后再拼同一段不会继续变长', () => {
    const a = '他推开门。'
    const b = '他推开门。屋里很冷。'
    const once = mergeContinuation(a, b)
    expect(mergeContinuation(once, b)).toBe(once)
  })
})
