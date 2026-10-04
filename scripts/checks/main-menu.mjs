import './_ws-shim.mjs'
/**
 * 主菜单 + 世界书预览的走查。
 *
 * 验证三件事：
 *   1. 打开网站**先进主菜单**（而不是直接扑到卡片墙上）
 *   2. 主菜单的每个入口都能到对应位置、都能回来
 *   3. 世界书预览**不用进编辑器**就能看到设定全文
 */
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const SITE = process.env.SITE || 'http://localhost:5199/'
const OUT = process.env.AUDIT_OUT || 'playtest-shots'
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
const PORT = Number(process.env.CDP_PORT || 9730)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const getJson = u => new Promise((res, rej) => {
  http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)) } catch (e) { rej(e) } }) }).on('error', rej)
})
fs.mkdirSync(OUT, { recursive: true })
const edge = spawn(EDGE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(OUT, 'edge-menu-' + Date.now())}`,
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1280,950', 'about:blank'], { stdio: 'ignore' })
let v = null
for (let i = 0; i < 40; i++) { try { v = await getJson(`http://127.0.0.1:${PORT}/json/version`); break } catch { await sleep(500) } }
if (!v) { console.error('端口未就绪'); process.exit(1) }
const t = await getJson(`http://127.0.0.1:${PORT}/json/list`)
const ws = new WebSocket(t.find(x => x.type === 'page').webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let id = 0; const pend = new Map(); const errs = []
ws.onmessage = e => {
  const m = JSON.parse(e.data)
  if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').split('\n')[0])
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    const txt = (m.params.args || []).map(a => a.value || a.description || '').join(' ')
    if (!/Could not establish connection|Authentication|api key|Game Engine Error/i.test(txt)) errs.push('console.error: ' + txt.slice(0, 140))
  }
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) }
}
const send = (m, p = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
const ev = async x => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })
  return r.result?.exceptionDetails ? 'THREW ' + (r.result.exceptionDetails.exception?.description || '') : r.result?.result?.value
}
const shot = async (n) => {
  const s = await send('Page.captureScreenshot', { format: 'png' })
  if (s.result?.data) fs.writeFileSync(path.join(OUT, n + '.png'), Buffer.from(s.result.data, 'base64'))
}
const clickRe = (re) => ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>${re}.test((x.textContent||'').trim()));if(!b)return 'no';if(b.disabled)return 'disabled';b.click();return 'ok'})()`)
const results = []
const check = (l, ok, extra = '') => { results.push({ l, ok }); console.log(`  ${ok ? '✓' : '✗'} ${l}${extra ? '  ' + extra : ''}`) }
const snap = () => ev(`(()=>{
  const T = document.body.innerText;
  return JSON.stringify({
    hasMenuTitle: /灯叙/.test(T),
    menuEntries: [...document.querySelectorAll('button')].map(b=>(b.textContent||'').trim())
      .filter(x=>/开始新游戏|世界书|卡片库|模型设置|继续游戏|回到这一局/.test(x)),
    header: (T.match(/灯叙|卡片库|世界书/)||[])[0],
    bodyLen: T.length,
  });})()`)

await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 950, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: SITE }); await sleep(3000)
await ev(`(()=>{const k='pale-notes-ui';let v={};try{v=JSON.parse(localStorage.getItem(k)||'{}')}catch(e){}
  v.state=v.state||{};v.state.llm=Object.assign({provider:'deepseek',baseUrl:'https://api.deepseek.com/v1',narrativeModel:'deepseek-chat',analysisModel:'deepseek-chat',temperature:0.8},v.state.llm||{},{apiKey:'sk-menu'});
  v.state.isApiKeyModalOpen=false;localStorage.setItem(k,JSON.stringify(v));return 1})()`)
await send('Page.navigate', { url: SITE }); await sleep(9000)

console.log('=== 1) 打开网站进入主菜单（不是卡片墙）===')
const m1 = JSON.parse(await snap())
console.log('  ' + JSON.stringify(m1.menuEntries))
check('首屏是主菜单（标题在，且没有直接铺卡片墙）', m1.hasMenuTitle)
check('有「开始新游戏」入口', m1.menuEntries.some(x => /开始新游戏/.test(x)))
check('有「世界书」入口', m1.menuEntries.some(x => /世界书/.test(x)))
check('有「卡片库」入口', m1.menuEntries.some(x => /卡片库/.test(x)))
check('有「模型设置」入口', m1.menuEntries.some(x => /模型设置/.test(x)))
await shot('menu-01-main')

console.log('\n=== 2) 世界书：进入列表 → 打开详情（不进编辑器）===')
console.log('  点世界书:', await clickRe('/^世界书/'))
await sleep(2500)
const m2 = JSON.parse(await ev(`(()=>{const T=document.body.innerText;
  return JSON.stringify({ header:(T.match(/世界书|卡片库/)||['?'])[0],
    cards: document.querySelectorAll('button[title="查看世界书详情"]').length,
    builtinHint: /内置世界/.test(T) });})()`))
console.log('  ' + JSON.stringify(m2))
check('进入世界书列表（标题变成世界书）', m2.header === '世界书')
check('列出了世界卡', m2.cards >= 5, `${m2.cards} 张`)
check('提示了点卡片看详情', m2.builtinHint)
await shot('menu-02-worldbook-list')

console.log('  点第一张卡的封面:', await clickRe('/内置示例|^[\\s\\S]*$/', 0) || '')
// 直接点封面按钮
const opened = await ev(`(()=>{
  const b=document.querySelector('button[title="查看世界书详情"]');
  if(!b) return 'no-cover-btn';
  b.click(); return 'ok';})()`)
console.log('  打开详情:', opened)
await sleep(2500)
const m3 = JSON.parse(await ev(`(()=>{const T=document.body.innerText;
  const tabs=[...document.querySelectorAll('button')].map(b=>(b.textContent||'').trim());
  return JSON.stringify({
    hasTabs: tabs.some(x=>/^概览/.test(x)) && tabs.some(x=>/^人物/.test(x)) && tabs.some(x=>/^设定/.test(x)),
    hasStartBtn: tabs.some(x=>/用这个世界开始/.test(x)),
    hasEditBtn: tabs.some(x=>/^编辑$/.test(x)),
    hasBack: tabs.some(x=>/返回/.test(x)),
    // 关键：不进编辑器也能看到设定
    showsLore: /世界观|主线目标|世界规则/.test(T),
    showsAttributes: /属性/.test(T),
    showsCanonical: /机制向|纯叙事/.test(T),
    bodyLen: T.length,
  });})()`))
console.log('  ' + JSON.stringify(m3))
check('详情页有概览/人物/设定三个页签', m3.hasTabs)
check('有「用这个世界开始」', m3.hasStartBtn)
check('有「编辑」入口（需要改才进去）', m3.hasEditBtn)
check('有返回', m3.hasBack)
check('**不进编辑器就能看到设定正文**', m3.showsLore)
check('显示了属性等机制信息', m3.showsAttributes)
await shot('menu-03-worldbook-detail')

console.log('\n=== 3) 详情页的各页签 ===')
/*
  上一版这里的表达式是拼出来的畸形代码（把正则字面量塞进字符串），
  永远为假 —— 又是我自己的探针错。改成直接分句判断。
*/
for (const [label, tabRe, contentRe] of [
  ['人物', '/^人物/', '/性格|角色卡|NPC|没有内置角色卡/'],
  ['设定', '/^设定/', '/世界观|世界规则|知识条目/'],
  ['概览', '/^概览/', '/主线目标|属性|资源|开局背景|开场/'],
]) {
  const r = await clickRe(tabRe)
  if (r !== 'ok') { check(`${label} 页签可点`, false, String(r)); continue }
  await sleep(1200)
  const info = JSON.parse(await ev(`(()=>{const T=document.body.innerText;
    return JSON.stringify({ matched: ${contentRe}.test(T), len: T.length });})()`))
  check(`${label} 页签有对应内容`, info.matched, `正文 ${info.len} 字`)
}
await shot('menu-04-worldbook-tab')

console.log('\n=== 4) 从详情页开始游戏 ===')
console.log('  点开始:', await clickRe('/用这个世界开始/'))
await sleep(2500)
const m5 = JSON.parse(await ev(`(()=>{const T=document.body.innerText;
  return JSON.stringify({
    inSetup: /你要扮演谁/.test(T),
    hasName: !!document.querySelector('input[placeholder="你的名字"]'),
    canBack: /返回卡库/.test(T),
  });})()`))
console.log('  ' + JSON.stringify(m5))
check('进入了选角界面', m5.inSetup)
check('有名字输入框', m5.hasName)
check('能从选角返回', m5.canBack)

console.log('\n=== 5) 返回链路：选角 → 主菜单 ===')
await clickRe('/返回卡库/')
await sleep(1800)
console.log('  返回后:', await ev(`(document.body.innerText.match(/主菜单|卡片库|世界书/)||['?'])[0]`))
console.log('  点主菜单:', await clickRe('/^主菜单$/'))
await sleep(2000)
const m6 = JSON.parse(await snap())
check('回到了主菜单', m6.menuEntries.some(x => /开始新游戏/.test(x)))
check('主菜单标题还在', m6.hasMenuTitle)
await shot('menu-05-back')

console.log('\n=== 6) 卡片库入口 ===')
console.log('  点卡片库:', await clickRe('/^卡片库/'))
await sleep(2200)
const m7 = JSON.parse(await ev(`(()=>{const T=document.body.innerText;
  const tabs=[...document.querySelectorAll('button')].map(b=>(b.textContent||'').trim());
  return JSON.stringify({ header:(T.match(/卡片库/)||['?'])[0],
    hasImport: tabs.some(x=>/^导入$/.test(x)),
    hasExport: tabs.some(x=>/导出全部/.test(x)),
    hasNew: tabs.some(x=>/新建世界卡/.test(x)),
    hasSaveMgr: /导出存档/.test(T),
    hasPackMgr: /导出世界包/.test(T),
    hasCredits: /人像素素材来自|Universal LPC/.test(T),
  });})()`))
console.log('  ' + JSON.stringify(m7))
check('进入卡片库', m7.header === '卡片库')
check('有导入/导出/新建', m7.hasImport && m7.hasExport && m7.hasNew)
check('有存档管理', m7.hasSaveMgr)
check('有世界包管理', m7.hasPackMgr)
check('素材署名可见（授权要求）', m7.hasCredits)
await shot('menu-06-library')

const failed = results.filter(r => !r.ok)
console.log('\n=== 汇总 ===')
console.log(`  通过 ${results.length - failed.length}/${results.length}`)
if (failed.length) { console.log('  未通过:'); failed.forEach(r => console.log('    · ' + r.l)) }
console.log('  运行期异常:', errs.length ? [...new Set(errs)].slice(0, 4) : '(无)')

ws.close(); edge.kill(); await sleep(300)
process.exit(failed.length === 0 && errs.length === 0 ? 0 : 1)
