import { describe, it, expect, afterEach } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { llmChat } from '@/api/llm'
import { LlmError } from '@/api/llmErrors'
import type { LLMConfig } from '@/types/cards'

/**
 * 重试行为测试。
 *
 * 用**本地假服务商**而不是 mock fetch：这样连真实 HTTP 往返、退避计时、
 * 中止信号一起验了。mock fetch 只能验证我自己的假设。
 */
function makeServer(plan: { status: number; body: string }[]) {
  let calls = 0
  const server = http.createServer((_req, res) => {
    const step = plan[Math.min(calls, plan.length - 1)]
    calls++
    res.writeHead(step.status, { 'Content-Type': 'application/json' })
    res.end(step.body)
  })
  return {
    get calls() { return calls },
    listen: () => new Promise<number>((r) =>
      server.listen(0, '127.0.0.1', () => r((server.address() as AddressInfo).port))),
    close: () => new Promise<void>((r) => server.close(() => r())),
  }
}

const OK = '{"choices":[{"message":{"content":"hello"}}]}'
const servers: ReturnType<typeof makeServer>[] = []

function cfg(port: number): LLMConfig {
  return {
    provider: 'custom', baseUrl: `http://127.0.0.1:${port}`, apiKey: 'k',
    narrativeModel: 'm', analysisModel: 'm', temperature: 0.7, showReasoning: false,
  }
}

async function start(plan: { status: number; body: string }[]) {
  const m = makeServer(plan)
  servers.push(m)
  const port = await m.listen()
  return { m, config: cfg(port) }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(s => s.close()))
})

describe('LLM 重试', () => {
  it('连续两次 429 后成功 → 自动重试并成功，且确实退避过', async () => {
    const { m, config } = await start([
      { status: 429, body: '{"error":{"message":"Rate limit reached"}}' },
      { status: 429, body: '{"error":{"message":"Rate limit reached"}}' },
      { status: 200, body: OK },
    ])
    const t0 = Date.now()
    const r: any = await llmChat({ messages: [{ role: 'user', content: 'hi' }], config, model: 'm', stream: false })
    expect(r.choices[0].message.content).toBe('hello')
    expect(m.calls).toBe(3)
    // 第一次退避就有 700ms 基数，两次必然超过 700ms
    expect(Date.now() - t0).toBeGreaterThan(700)
  })

  it('401 Key 无效 → 不重试（重试只是浪费配额）', async () => {
    const { m, config } = await start([{ status: 401, body: '{"error":{"message":"your api key is invalid"}}' }])
    await expect(
      llmChat({ messages: [{ role: 'user', content: 'hi' }], config, model: 'm', stream: false })
    ).rejects.toBeInstanceOf(LlmError)
    expect(m.calls).toBe(1)
  })

  it('402 余额不足 → 不重试', async () => {
    const { m, config } = await start([{ status: 402, body: '{"error":{"message":"Insufficient Balance"}}' }])
    let caught: unknown
    try {
      await llmChat({ messages: [{ role: 'user', content: 'hi' }], config, model: 'm', stream: false })
    } catch (e) { caught = e }
    expect((caught as LlmError).info.kind).toBe('quota')
    expect(m.calls).toBe(1)
  })

  it('一直 500 → 重试到上限后放弃（不能无限重试）', async () => {
    const { m, config } = await start([{ status: 500, body: '{"error":{"message":"boom"}}' }])
    let caught: unknown
    try {
      await llmChat({ messages: [{ role: 'user', content: 'hi' }], config, model: 'm', stream: false })
    } catch (e) { caught = e }
    expect((caught as LlmError).info.kind).toBe('server')
    expect(m.calls).toBe(3)
  })

  it('流式请求不自动重试（SSE 已吐字，重试会导致内容重复）', async () => {
    const { m, config } = await start([
      { status: 429, body: '{"error":{"message":"Rate limit reached"}}' },
      { status: 200, body: OK },
    ])
    await expect(
      llmChat({ messages: [{ role: 'user', content: 'hi' }], config, model: 'm', stream: true })
    ).rejects.toBeInstanceOf(LlmError)
    expect(m.calls).toBe(1)
  })
})
