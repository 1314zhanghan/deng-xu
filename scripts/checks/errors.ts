/**
 * 错误分类验证：用**真实 HTTP 响应**跑一遍分类器。
 * 分类器对着真数据工作才算数，纯 mock 只能验证我自己的假设。
 */
import { classifyLlmError, LlmError } from '@/api/llmErrors'

let fails = 0
const check = (l: string, ok: boolean, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${l}${extra ? '  ' + extra : ''}`)
  if (!ok) fails++
}

console.log('=== 1) 真实服务商错误体的分类 ===')
// 这些 JSON 结构照抄 DeepSeek / OpenAI / OpenRouter 的真实返回
const CASES: [string, number | undefined, string, string, boolean][] = [
  ['Key 无效', 401, '{"error":{"message":"Authentication Fails, Your api key is invalid","type":"authentication_error"}}', 'auth', false],
  ['无权限', 403, '{"error":{"message":"You do not have access to this resource"}}', 'auth', false],
  ['余额不足(402)', 402, '{"error":{"message":"Insufficient Balance"}}', 'quota', false],
  ['余额不足(401 里说明)', 401, '{"error":{"message":"Insufficient balance, please top up"}}', 'quota', false],
  ['限流(429)', 429, '{"error":{"message":"Rate limit reached for requests"}}', 'rate_limit', true],
  ['额度用尽(429)', 429, '{"error":{"message":"You exceeded your current quota"}}', 'quota', false],
  ['服务端 500', 500, '{"error":{"message":"internal server error"}}', 'server', true],
  ['网关 502', 502, '<html><body>502 Bad Gateway</body></html>', 'server', true],
  ['上下文超长 400', 400, '{"error":{"message":"This model maximum context length is 65536 tokens"}}', 'bad_request', false],
  ['模型名错 400', 400, '{"error":{"message":"The model `gpt-9` does not exist"}}', 'bad_request', false],
  ['普通 400', 400, '{"error":{"message":"invalid request format"}}', 'bad_request', false],
]

for (const [name, status, body, wantKind, wantRetry] of CASES) {
  const info = classifyLlmError(status, body)
  const ok = info.kind === wantKind && info.retryable === wantRetry
  check(name, ok, `kind=${info.kind}(期望${wantKind}) retryable=${info.retryable}(期望${wantRetry})`)
  if (ok) console.log(`      → 「${info.message}」${info.hint ? ' / ' + info.hint : ''}`)
}

console.log('\n=== 2) 网络层错误 ===')
const net = classifyLlmError(undefined, '', new Error('Failed to fetch'))
check('断网 → network 且可重试', net.kind === 'network' && net.retryable === true, net.kind)

const to = classifyLlmError(undefined, '', new Error('request timed out after 30000ms'))
check('超时 → timeout 且可重试', to.kind === 'timeout' && to.retryable === true, to.kind)

const ab = classifyLlmError(undefined, '', Object.assign(new Error('aborted'), { name: 'AbortError' }))
check('用户取消 → aborted 且不重试', ab.kind === 'aborted' && ab.retryable === false, ab.kind)

console.log('\n=== 3) 界面文案必须是中文人话，不能漏出原始 JSON ===')
const all = [
  ...CASES.map(([, s, b]) => classifyLlmError(s, b)),
  net, to,
]
let leaked = 0
for (const info of all) {
  if (/[{}]|"error"|statusCode/i.test(info.message)) {
    console.log(`    ✗ 文案漏出原始结构：${info.message}`)
    leaked++
  }
}
check('所有错误文案都不含原始 JSON', leaked === 0, `${leaked} 条泄漏`)

const noHint = all.filter(i => i.kind !== 'aborted' && !i.hint)
check('可操作的错误都带处理建议', noHint.length === 0, noHint.map(i => i.kind).join(','))

console.log('\n=== 4) LlmError 包装后仍是 Error（可被 catch/instanceof 识别）===')
const wrapped = new LlmError(classifyLlmError(429, '{"error":{"message":"rate limited"}}'))
check('是 Error 实例', wrapped instanceof Error)
check('name 为 LlmError', wrapped.name === 'LlmError')
check('可读出分类信息', wrapped.info.kind === 'rate_limit', wrapped.info.kind)

console.log('\n=== 5) 真实打一次错误端点（验证 fetch 层也能被正确分类）===')
try {
  const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sk-invalid-key-for-test' },
    body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] }),
  })
  const body = await r.text().catch(() => '')
  const info = classifyLlmError(r.status, body)
  console.log(`  HTTP ${r.status}  →  kind=${info.kind}  retryable=${info.retryable}`)
  console.log(`      文案：「${info.message}」`)
  console.log(`      建议：「${info.hint || '(无)'}」`)
  check('真实 401 被识别为 auth 且不重试', info.kind === 'auth' && info.retryable === false, info.kind)
} catch (e) {
  console.log('  （网络不通，跳过真实请求验证）:', (e as Error).message)
}

console.log('\n' + (fails === 0 ? '全部通过' : `${fails} 项未通过`))
process.exit(fails === 0 ? 0 : 1)
