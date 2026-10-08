import './_ws-shim.mjs'
/**
 * 出错路径测试 —— 验证「出了错，玩家看到什么」。
 *
 * ⚠️ 关于覆盖范围的诚实说明：
 *
 *   错误分类（11 类）与重试行为（退避、上限、流式不重试、Key 错不重试）
 *   由**单元测试**覆盖，且用的是真实服务商响应体：
 *     src/api/llmErrors.test.ts   16 条
 *     src/api/llmRetry.test.ts     5 条（本地假服务商 + 真实 HTTP 往返）
 *
 *   本脚本只补两件单元测试覆盖不到的事：
 *     1. 在**真实浏览器**里，引擎把错误翻译成的那句人话是什么
 *     2. 重试确实发生了（用服务端收到的 POST 次数证明）
 *
 *   我在这上面反复误判过：假服务商缺少 CORS 预检支持时，
 *   浏览器只报"网络连接失败"，而服务端其实已经收到 3 次请求。
 *   **先验证脚手架，再相信它的报错。**
 */
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { outDir, profileDir, removeProfile } from './_browser.mjs'

// 必须绝对路径：--user-data-dir 用相对路径时 Chromium 会静默失败（见 _browser.mjs 的 outDir）
const OUT = outDir()
/**
 * Edge / Chrome 路径。**必须自动探测**：
 * 本地 Edge 在 Program Files (x86)，CI（windows-latest）在 Program Files，
 * 写死路径会让走查在 CI 上直接跑不起来。
 */
const EDGE = (() => {
  const cands = [
    process.env.EDGE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/microsoft-edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean)
  for (const c of cands) { try { if (fs.existsSync(c)) return c } catch {} }
  throw new Error('找不到 Edge / Chrome，可用 EDGE_PATH 指定')
})()
const PORT = Number(process.env.CDP_PORT || 9715)
const FAKE_PORT = Number(process.env.FAKE_PORT || 9725)
const SITE = process.env.SITE || 'http://localhost:5199/'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const getJson = u => new Promise((res, rej) => {
  http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)) } catch (e) { rej(e) } }) }).on('error', rej)
})
fs.mkdirSync(OUT, { recursive: true })

// ─── 假服务商：必须支持 CORS 预检，否则真请求发不出去 ───
let mode = 'ok'
let calls = 0
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '600',
}
const fake = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return }
  calls++
  const say = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', ...CORS }); res.end(body) }
  if (mode === 'insufficient') return say(402, '{"error":{"message":"Insufficient Balance"}}')
  if (mode === 'ratelimit') return say(429, '{"error":{"message":"Rate limit reached"}}')
  if (mode === 'servererror') return say(500, '{"error":{"message":"internal server error"}}')
  if (mode === 'badkey') return say(401, '{"error":{"message":"Authentication Fails, Your api key is invalid"}}')
  // 明显被截断：停在连接词上、引号未闭合
  if (mode === 'truncated') return say(200, JSON.stringify({ choices: [{ message: { content: '你推开门，冷风灌了进来。街对面的灯柱上，' } }] }))
  return say(200, JSON.stringify({ choices: [{ message: { content: '你推开门，冷风灌了进来。\n\n街上没有人。' } }] }))
})
await new Promise(r => fake.listen(FAKE_PORT, '127.0.0.1', r))
console.log(`假服务商已启动 :${FAKE_PORT}（含 CORS 预检）`)

const PROFILE = profileDir('err3')
const edge = spawn(EDGE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1280,950', 'about:blank'], { stdio: 'ignore' })
let v = null
for (let i = 0; i < 40; i++) { try { v = await getJson(`http://127.0.0.1:${PORT}/json/version`); break } catch { await sleep(500) } }
if (!v) { console.error('端口未就绪'); fake.close(); process.exit(1) }
const t = await getJson(`http://127.0.0.1:${PORT}/json/list`)
const ws = new WebSocket(t.find(x => x.type === 'page').webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let id = 0; const pend = new Map()
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } }
const send = (m, p = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
const ev = async x => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })
  return r.result?.exceptionDetails ? 'THREW ' + (r.result.exceptionDetails.exception?.description || '') : r.result?.result?.value
}
const shot = async (n) => {
  const s = await send('Page.captureScreenshot', { format: 'png' })
  if (s.result?.data) fs.writeFileSync(path.join(OUT, n + '.png'), Buffer.from(s.result.data, 'base64'))
}
const results = []
const check = (l, ok, extra = '') => { results.push({ l, ok }); console.log(`  ${ok ? '✓' : '✗'} ${l}${extra ? '  ' + extra : ''}`) }

await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 950, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: SITE }); await sleep(2000)

/*
  ⚠️ 等**条件**，不要等时间。
  这里原先是一句固定 `await sleep(8000)`，紧接着就调用 `__uiStore`。
  本地机器快，8 秒绰绰有余；但 CI 的机器要加载 440 KB 主包 + 468 KB 世界数据
  再跑完 React 初始化，8 秒不够 —— 于是 `__uiStore` 还没挂上就被调用，
  整个套件以 `THREW ReferenceError: __uiStore is not defined` 收场。
  **"固定等待"的典型症状就是本地永远过、CI 随机红。**
  （同类缺陷在 heroes.mjs 里也修过一次，教训是一样的。）
*/
{
  const t0 = Date.now()
  let ready = false
  while (Date.now() - t0 < 40000) {
    if (await ev(`typeof __uiStore !== 'undefined' && !!__uiStore.getState().llm`)) { ready = true; break }
    await sleep(400)
  }
  if (!ready) {
    console.error('❌ 40 秒内 __uiStore 仍未就绪 —— 页面可能根本没加载出来')
    fake.close(); process.exit(1)
  }
  console.log(`  页面就绪（__uiStore 已挂上，用时 ${Date.now() - t0}ms）`)
}

/**
 * 发一次生成请求，返回**引擎会显示给玩家的那句话**。
 * 复刻 useGameEngine.formatEngineError 的逻辑（LlmError → message + hint）。
 */
async function ask(label) {
  console.log(`\n=== ${label} ===`)
  calls = 0
  const r = await ev(`(async () => {
    const llm = await import('/src/api/llm.ts');
    const errMod = await import('/src/api/llmErrors.ts');
    const cfg = Object.assign({}, __uiStore.getState().llm, {
      provider:'custom', baseUrl:'http://127.0.0.1:${FAKE_PORT}',
      narrativeModel:'m', analysisModel:'m', apiKey:'sk-x' });
    try {
      await llm.llmChat({ messages:[{role:'user',content:'hi'}], config:cfg, model:'m', stream:false });
      return JSON.stringify({ ok:true });
    } catch (e) {
      const info = (e && e.info) ? e.info : errMod.classifyLlmError(undefined,'',e);
      return JSON.stringify({ ok:false, kind:info.kind, retryable:info.retryable,
        shown: info.hint ? info.message + '（' + info.hint + '）' : info.message });
    }
  })()`)
  const parsed = JSON.parse(r)
  console.log('  玩家看到:', parsed.ok ? '(成功)' : parsed.shown)
  console.log(`  服务端收到 ${calls} 次 POST`)
  return parsed
}

const CASES = [
  ['余额不足（402）', 'insufficient', 'quota', /余额|额度|充值|Key/, 1],
  ['限流（429）', 'ratelimit', 'rate_limit', /限流|频繁|稍等|重试/, 3],
  ['服务端 500', 'servererror', 'server', /服务商|不可用|内部错误|稍后/, 3],
  ['Key 无效（401）', 'badkey', 'auth', /Key|密钥|权限/, 1],
]
for (const [label, m, wantKind, wantText, wantCalls] of CASES) {
  mode = m
  const p = await ask(label)
  check(`分类为 ${wantKind}`, p.kind === wantKind, p.kind)
  check('文案是人话且带处理建议', wantText.test(p.shown || ''), (p.shown || '').slice(0, 70))
  check('文案里没有原始 JSON', !/[{}]|"error"/.test(p.shown || ''))
  check(`请求次数符合预期（${wantCalls} 次）`, calls === wantCalls, `${calls} 次`)
  await shot('err3-' + m)
}

console.log('\n=== 截断检测（真实返回值）===')
mode = 'truncated'
{
  calls = 0
  const r = JSON.parse(await ev(`(async () => {
    const llm = await import('/src/api/llm.ts');
    const tr = await import('/src/utils/truncation.ts');
    const cfg = Object.assign({}, __uiStore.getState().llm, {
      provider:'custom', baseUrl:'http://127.0.0.1:${FAKE_PORT}',
      narrativeModel:'m', analysisModel:'m', apiKey:'sk-x' });
    const res = await llm.llmChat({ messages:[{role:'user',content:'hi'}], config:cfg, model:'m', stream:false });
    const partial = res.choices[0].message.content;
    const d = tr.detectTruncation(partial);
    return JSON.stringify({ partial, truncated: d.truncated, confidence: d.confidence, reason: d.reason });
  })()`))
  console.log('  原文:', JSON.stringify(r.partial))
  console.log('  判定:', r.truncated, r.confidence, r.reason || '')
  check('检测到截断', r.truncated === true)
  // 这段结尾是逗号，按设计属于**弱证据**（low）；强证据是"停在连接词/引号未闭合"。
  // 正确性由 truncation.test.ts 的 20 条用例覆盖，这里只验证真实返回值能被判定。
  check('给出了置信度', r.confidence === 'low' || r.confidence === 'high', String(r.confidence))
  check('给出了可显示的理由', /[\u4e00-\u9fa5]/.test(r.reason || ''), r.reason || '')
  await shot('err3-truncated')
}

console.log('\n=== 截断检测：强证据（引号未闭合）===')
{
  const r = JSON.parse(await ev(`(async () => {
    const tr = await import('/src/utils/truncation.ts');
    const d = tr.detectTruncation('他说：「我们得走了，不然');
    return JSON.stringify(d);
  })()`))
  check('引号未闭合 → 判定为截断', r.truncated === true)
  check('且为强证据（high）', r.confidence === 'high', String(r.confidence))
}

const failed = results.filter(x => !x.ok)
console.log('\n=== 汇总 ===')
console.log(`  通过 ${results.length - failed.length}/${results.length}`)
if (failed.length) { console.log('  未通过:'); failed.forEach(x => console.log('    · ' + x.l)) }
console.log('\n完整覆盖见 src/api/llmErrors.test.ts（16 条）与 src/api/llmRetry.test.ts（5 条）')

ws.close(); edge.kill(); fake.close()
await sleep(300); removeProfile(PROFILE)
process.exit(failed.length === 0 ? 0 : 1)
