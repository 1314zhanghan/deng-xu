/**
 * 重试机制验证：起一个会先失败后成功的本地服务器，
 * 确认 llmChat 真的按「可重试错误才重试」的规则工作。
 */
import http from 'node:http'
import { llmChat } from '@/api/llm'
import { LlmError } from '@/api/llmErrors'
import type { LLMConfig } from '@/types/cards'

let fails = 0
const check = (l: string, ok: boolean, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${l}${extra ? '  ' + extra : ''}`)
  if (!ok) fails++
}

/** 可编程的假服务商 */
function makeServer(plan: { status: number; body: string }[]) {
  let calls = 0
  const server = http.createServer((req, res) => {
    const step = plan[Math.min(calls, plan.length - 1)]
    calls++
    res.writeHead(step.status, { 'Content-Type': 'application/json' })
    res.end(step.body)
  })
  return {
    server,
    get calls() { return calls },
    listen: () => new Promise<number>((r) => server.listen(0, '127.0.0.1', () => r((server.address() as any).port))),
    close: () => new Promise<void>((r) => server.close(() => r())),
  }
}

const OK = '{"choices":[{"message":{"content":"hello"}}]}'

console.log('=== 1) 连续两次 429，第三次成功 → 应自动重试并成功 ===')
{
  const m = makeServer([
    { status: 429, body: '{"error":{"message":"Rate limit reached"}}' },
    { status: 429, body: '{"error":{"message":"Rate limit reached"}}' },
    { status: 200, body: OK },
  ])
  const port = await m.listen()
  const config: LLMConfig = {
    provider: 'custom', baseUrl: `http://127.0.0.1:${port}`, apiKey: 'k',
    narrativeModel: 'm', analysisModel: 'm', temperature: 0.7, showReasoning: false,
  }
  const t0 = Date.now()
  try {
    const r: any = await llmChat({ messages: [{ role: 'user', content: 'hi' }], config, model: 'm', stream: false })
    const ok = r?.choices?.[0]?.message?.content === 'hello'
    check('最终成功', ok, `耗时 ${Date.now() - t0}ms`)
    check('一共请求了 3 次', m.calls === 3, `${m.calls} 次`)
    check('确实等待了（退避生效）', Date.now() - t0 > 700, `${Date.now() - t0}ms`)
  } catch (e) {
    check('最终成功', false, (e as Error).message)
  }
  await m.close()
}

console.log('\n=== 2) 401 Key 无效 → 不应重试（重试只是浪费配额）===')
{
  const m = makeServer([{ status: 401, body: '{"error":{"message":"your api key is invalid"}}' }])
  const port = await m.listen()
  const config: LLMConfig = {
    provider: 'custom', baseUrl: `http://127.0.0.1:${port}`, apiKey: 'bad',
    narrativeModel: 'm', analysisModel: 'm', temperature: 0.7, showReasoning: false,
  }
  let caught: unknown = null
  try {
    await llmChat({ messages: [{ role: 'user', content: 'hi' }], config, model: 'm', stream: false })
  } catch (e) { caught = e }
  check('抛出 LlmError', caught instanceof LlmError, (caught as Error)?.name)
  check('分类为 auth', caught instanceof LlmError && caught.info.kind === 'auth')
  check('只请求 1 次（未重试）', m.calls === 1, `${m.calls} 次`)
  /*
    注意断言写法：不能直接 /Key|密钥|权限/ 去撞 message ——
    服务商原文「your api key is invalid」里本来就有 "key"，
    那样写会把正确行为判成失败（我第一版就是这么错的）。
    正确的检查是：**必须带中文建议**，且不让玩家看到原始 JSON 结构。
  */
  const info = caught instanceof LlmError ? caught.info : null
  check('带中文处理建议', !!info?.hint && /[\u4e00-\u9fa5]/.test(info.hint), info?.hint || '')
  check('文案不含原始 JSON 结构', !info || !/[{}]|"error"/.test(info.message), info?.message || '')
  await m.close()
}

console.log('\n=== 3) 402 余额不足 → 不重试 ===')
{
  const m = makeServer([{ status: 402, body: '{"error":{"message":"Insufficient Balance"}}' }])
  const port = await m.listen()
  const config: LLMConfig = {
    provider: 'custom', baseUrl: `http://127.0.0.1:${port}`, apiKey: 'k',
    narrativeModel: 'm', analysisModel: 'm', temperature: 0.7, showReasoning: false,
  }
  let caught: unknown = null
  try {
    await llmChat({ messages: [{ role: 'user', content: 'hi' }], config, model: 'm', stream: false })
  } catch (e) { caught = e }
  check('分类为 quota', caught instanceof LlmError && caught.info.kind === 'quota', caught instanceof LlmError ? caught.info.kind : '')
  check('只请求 1 次', m.calls === 1, `${m.calls} 次`)
  await m.close()
}

console.log('\n=== 4) 一直 500 → 重试到上限后放弃（不能无限重试）===')
{
  const m = makeServer([{ status: 500, body: '{"error":{"message":"boom"}}' }])
  const port = await m.listen()
  const config: LLMConfig = {
    provider: 'custom', baseUrl: `http://127.0.0.1:${port}`, apiKey: 'k',
    narrativeModel: 'm', analysisModel: 'm', temperature: 0.7, showReasoning: false,
  }
  let caught: unknown = null
  const t0 = Date.now()
  try {
    await llmChat({ messages: [{ role: 'user', content: 'hi' }], config, model: 'm', stream: false })
  } catch (e) { caught = e }
  check('最终抛出错误', caught instanceof LlmError)
  check('分类为 server', caught instanceof LlmError && caught.info.kind === 'server')
  check('请求次数 = 3（有上限）', m.calls === 3, `${m.calls} 次，耗时 ${Date.now() - t0}ms`)
  await m.close()
}

console.log('\n=== 5) 流式请求不在此处重试（SSE 已吐字，重试会重复）===')
{
  const m = makeServer([
    { status: 429, body: '{"error":{"message":"Rate limit reached"}}' },
    { status: 200, body: OK },
  ])
  const port = await m.listen()
  const config: LLMConfig = {
    provider: 'custom', baseUrl: `http://127.0.0.1:${port}`, apiKey: 'k',
    narrativeModel: 'm', analysisModel: 'm', temperature: 0.7, showReasoning: false,
  }
  let caught: unknown = null
  try {
    await llmChat({ messages: [{ role: 'user', content: 'hi' }], config, model: 'm', stream: true })
  } catch (e) { caught = e }
  check('流式失败立即抛出', caught instanceof LlmError)
  check('只请求 1 次（流式不自动重试）', m.calls === 1, `${m.calls} 次`)
  await m.close()
}

console.log('\n' + (fails === 0 ? '全部通过' : `${fails} 项未通过`))
process.exit(fails === 0 ? 0 : 1)
