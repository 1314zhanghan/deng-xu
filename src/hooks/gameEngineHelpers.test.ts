import { describe, it, expect } from 'vitest'
import {
  estimateMissingCompletion,
  estimateTokens,
  formatHistoryWithTurns,
  parseSseUsage,
  usageFromResponse,
} from '@/hooks/useGameEngine'

/**
 * C9（成本可见）与 A1（时间线轮次编号）里那几个**纯函数**的测试。
 *
 * 为什么拆出这个文件而不是塞进 prompts.test.ts / memory.test.ts：
 * 被测的对象在 `useGameEngine.ts` 里 —— 那个模块会 import React。
 * 直接 import 在 node 环境是安全的（只有调用 hook 才需要渲染器），
 * 但**一旦有人在这个模块顶层加一句 hook 调用**，这里就会崩；
 * 所以把它单独放一个文件，崩的时候一眼能看出是哪一层的问题。
 *
 * 这里只测不需要渲染的部分：轮次格式化、usage 提取与估算。
 * 端到端的提示词内容由 `useGameEngine.prompt.test.ts` 负责（那边搭了 hook 替身）。
 */

describe('formatHistoryWithTurns · 给摘要 AI 的轮次编号', () => {
  const h = [
    { role: 'user', content: '推开那扇门' },
    { role: 'assistant', content: '门后是一间账房。' },
    { role: 'user', content: '翻开账本' },
    { role: 'assistant', content: '缺了七页。' },
  ]

  it('叙事算一轮，玩家行动归到同一轮里（轮次编号是回溯的落点，不能错位）', () => {
    const text = formatHistoryWithTurns(h, 1)
    expect(text).toContain('[第1轮 · 玩家行动] 推开那扇门')
    expect(text).toContain('[第1轮 · 叙事] 门后是一间账房。')
    expect(text).toContain('[第2轮 · 玩家行动] 翻开账本')
    expect(text).toContain('[第2轮 · 叙事] 缺了七页。')
  })

  it('起始轮次可指定（切片窗口从第 7 轮开始时编号就从 7 起）', () => {
    const text = formatHistoryWithTurns(h, 7)
    expect(text).toContain('[第7轮 · 叙事]')
    expect(text).toContain('[第8轮 · 叙事]')
  })

  it('system 消息不产生编号（状态变更日志不该被算成一轮）', () => {
    const text = formatHistoryWithTurns(
      [{ role: 'system', content: '> **状态变更**' }, { role: 'assistant', content: '第一个叙事' }],
      1,
    )
    expect(text).not.toContain('状态变更')
    expect(text).toContain('[第1轮 · 叙事] 第一个叙事')
  })
})

describe('parseSseUsage · 从流里抠出真实用量', () => {
  it('末个 chunk 带 usage 时能读到（很多服务商只在这个位置给）', () => {
    const line = `data: ${JSON.stringify({
      choices: [{ delta: {} }],
      usage: { prompt_tokens: 1200, completion_tokens: 800, total_tokens: 2000 },
    })}`
    expect(parseSseUsage(line)).toEqual({
      promptTokens: 1200,
      completionTokens: 800,
      totalTokens: 2000,
      estimated: false,
    })
  })

  it('没有 usage / [DONE] / 普通正文行 / 坏 JSON 一律返回 null（走估算路径）', () => {
    expect(parseSseUsage('data: [DONE]')).toBeNull()
    expect(parseSseUsage(`data: ${JSON.stringify({ choices: [{ delta: { content: '正文' } }] })}`)).toBeNull()
    expect(parseSseUsage('data: {{{')).toBeNull()
    expect(parseSseUsage(': keep-alive')).toBeNull()
  })

  it('total_tokens 自己算，不信服务商给的（有些端点会漏或算错）', () => {
    const line = `data: ${JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 9999 } })}`
    expect(parseSseUsage(line)?.totalTokens).toBe(15)
  })
})

describe('usageFromResponse · 拿不到 usage 就诚实估算', () => {
  const messages = [{ role: 'user' as const, content: '一'.repeat(150) }]

  it('接口回了 usage → estimated=false，用真实数字', () => {
    const u = usageFromResponse(
      { usage: { prompt_tokens: 100, completion_tokens: 50 } },
      messages,
      '输出',
    )
    expect(u.promptTokens).toBe(100)
    expect(u.completionTokens).toBe(50)
    expect(u.totalTokens).toBe(150)
    expect(u.estimated).toBe(false)
  })

  it('接口没回 usage → estimated=true，按输入输出字符数估（不能显示成真实值）', () => {
    const u = usageFromResponse(null, messages, '二'.repeat(30))
    expect(u.estimated).toBe(true)
    expect(u.promptTokens).toBe(estimateTokens('一'.repeat(150)))
    expect(u.completionTokens).toBe(estimateTokens('二'.repeat(30)))
    expect(u.totalTokens).toBe(u.promptTokens + u.completionTokens)
  })

  it('只回了一半 usage 时，缺的那一半按估算补，整体仍标为**非**估算', () => {
    const u = usageFromResponse({ usage: { prompt_tokens: 200 } }, messages, '二'.repeat(30))
    expect(u.promptTokens).toBe(200)
    expect(u.completionTokens).toBeGreaterThan(0)
  })

  it('空输入不产生 0 token 的假记录之外的东西（估算至少给 0）', () => {
    expect(estimateTokens('')).toBe(0)
    const u = usageFromResponse(null, [], '')
    expect(u.totalTokens).toBe(0)
  })
})

describe('estimateMissingCompletion · 只补缺的那一半', () => {
  it('completion 为 0 时按输出补上', () => {
    const u = estimateMissingCompletion(
      { promptTokens: 300, completionTokens: 0, totalTokens: 300, estimated: false },
      '三'.repeat(60),
    )
    expect(u.completionTokens).toBe(estimateTokens('三'.repeat(60)))
    expect(u.totalTokens).toBe(300 + u.completionTokens)
    // prompt 是真实值，整体就不能标成估算 —— 否则界面会把真数也写成"约"
    expect(u.estimated).toBe(false)
  })

  it('已经拿到真实 completion 时原样返回', () => {
    const u = { promptTokens: 1, completionTokens: 2, totalTokens: 3, estimated: false }
    expect(estimateMissingCompletion(u, 'x')).toEqual(u)
  })
})
