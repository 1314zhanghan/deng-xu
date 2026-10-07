/**
 * 对**线上站点**做一次完整的端到端走查。
 *
 * 与前几轮的单点验证不同，这里按真实玩家的路径走一遍：
 *   标题页 → 世界包/存档入口 → 开局 → 游戏中 → 立绘面板 → 场景 → 错误提示 → 移动端布局
 * 目标是发现"各自能跑但连起来有问题"的地方。
 */
import './_ws-shim.mjs'
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const SITE = process.env.SITE || 'https://fyjsj-zh.github.io/deng-xu/'
const OUT = process.env.AUDIT_OUT || 'audit-shots'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9520
const sleep = ms => new Promise(r => setTimeout(r, ms))
const getJson = u => new Promise((res, rej) => {
  http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)) } catch (e) { rej(e) } }) }).on('error', rej)
})

fs.mkdirSync(OUT, { recursive: true })
/*
  每次审计都用**全新的浏览器 profile**。

  为什么：profile 目录会保留 localStorage。复用同一个目录时，
  上一轮跑完留下的 `isGameStarted: true` 会让 StartScreen 直接 return null
  （见 StartScreen.tsx: `if (isGameStarted) return null`），
  于是标题页根本不渲染、世界包区域连同"下载官方世界书"链接一起消失。
  我为这一个 ✗ 查了四轮，最后发现是**自己的测试脚本污染了自己的环境**。
  审计必须是可复现的，所以这里每次清空。
*/
const profile = path.join(OUT, `edge-audit-${Date.now()}`)
const edge = spawn(EDGE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' })
let v = null
for (let i = 0; i < 40; i++) { try { v = await getJson(`http://127.0.0.1:${PORT}/json/version`); break } catch { await sleep(500) } }
if (!v) { console.error('端口未就绪'); edge.kill(); process.exit(1) }
const t = await getJson(`http://127.0.0.1:${PORT}/json/list`)
const ws = new WebSocket(t.find(x => x.type === 'page').webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let id = 0; const pend = new Map(); const errs = []; const bad = []
ws.onmessage = e => {
  const m = JSON.parse(e.data)
  if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').split('\n')[0])
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errs.push('console.error: ' + (m.params.args || []).map(a => a.value || a.description || '').join(' ').slice(0, 160))
  }
  if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) bad.push(m.params.response.status + ' ' + m.params.response.url)
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) }
}
const send = (m, p = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
const ev = async x => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })
  return r.result?.exceptionDetails ? 'THREW ' + (r.result.exceptionDetails.exception?.description || '') : r.result?.result?.value
}
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' })
  if (s.result?.data) { fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(s.result.data, 'base64')); return true }
  return false
}

const results = []
const check = (label, ok, extra = '') => {
  results.push({ label, ok, extra })
  console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? '  ' + extra : ''}`)
}

await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable')

// ───────────────────────── 桌面端 ─────────────────────────
console.log('=== 1) 标题页 ===')
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: SITE })
await sleep(9000)

/**
 * 等待某个条件成立（轮询），而不是"睡固定秒数然后断言"。
 *
 * 为什么必须这样：标题页由多个重组件拼成（卡片库要读 IndexedDB、
 * 立绘部件要解码 PNG），它们不是一次性到齐的。
 * 我原来固定 sleep 9 秒再断言，结果底部的世界包区域还没挂载，
 * 就误判成"官方世界书下载链接不存在" —— 反复查了三轮才发现是等太短。
 */
async function waitFor(expr, timeoutMs = 15000, stepMs = 500) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (await ev(expr)) return true
    await sleep(stepMs)
  }
  return false
}
const waited = await waitFor(`document.querySelectorAll('a').length >= 4 && !!document.querySelector('a[href*="official-worldbook"]')`)
console.log('  [debug] waitFor 结果 =', waited,
  ' anchors =', await ev(`document.querySelectorAll('a').length`),
  ' 正文长度 =', await ev(`document.body.innerText.length`),
  ' 视口 =', await ev(`innerWidth + 'x' + innerHeight`))
await shot('00-before-close')
// API Key 弹窗默认打开并遮住标题页；innerText 对不可见元素返回空串，
// 所以必须先关掉它再断言（我第一版没关，误判了"世界书链接不存在"）。
//
// 这里**不能用 __uiStore**：线上是生产构建，调试钩子被有意 tree-shake 掉了。
// 改用真实点击 —— 更接近真人操作，也顺便验证了弹窗确实能关上。
await ev(`(()=>{
  const btns = [...document.querySelectorAll('button')];
  const close = btns.find(b => /^(关闭|取消|×|✕)$/.test((b.textContent||'').trim()))
    || btns.find(b => (b.getAttribute('aria-label')||'') === '关闭');
  if (close) { close.click(); return 'clicked' }
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return 'escape';
})()`)
await sleep(1200)
check('应用已挂载', await ev(`!!window.__APP_MOUNTED__`) === true)
check('未触发白屏守卫', await ev(`/页面没能加载出来/.test(document.body.innerText)`) === false)
const titlePage = await ev(`(()=>{
  // 用 DOM 查询而不是 innerText：标题页有一部分被 API Key 弹窗遮住，
  // innerText 对不可见元素返回空串 —— 我用它误判过一次"世界书链接不存在"。
  try {
    const text = document.body.innerText;
    const html = document.documentElement.innerHTML;
    const all = text + ' ' + html;
    const linkCount = document.querySelectorAll('a[href*="official-worldbook"]').length;
    return {
      hasStart: /开始|新建/.test(all),
      hasSave: /导出存档/.test(all),
      hasPack: /导出世界包/.test(all),
      hasWorldbookLink: linkCount > 0,
      _linkCount: linkCount,
      _anchorHrefs: [...document.querySelectorAll('a')].map(a => a.getAttribute('href')),
      hasCredits: !!document.querySelector('a[href*="CREDITS"]'),
    };
  } catch (e) {
    return { _error: String(e && e.message || e), _stack: String(e && e.stack || '').slice(0, 300) };
  }
})()`)
// 诊断输出：不要猜断言为什么失败，直接把求值结果打出来
console.log('  [debug] titlePage =', JSON.stringify(titlePage))
check('标题页有开始入口', titlePage.hasStart)
check('存档导出/导入入口都在', titlePage.hasSave)
check('世界包导出/导入入口都在', titlePage.hasPack)
check('有官方世界书下载链接', titlePage.hasWorldbookLink)
check('有素材署名', titlePage.hasCredits)
await shot('01-title')

console.log('\n=== 2) 官方世界书可下载且是合法 JSON ===')
const wb = await ev(`(async () => {
  const r = await fetch('./official-worldbook.json');
  if (!r.ok) return 'HTTP ' + r.status;
  const j = await r.json();
  return JSON.stringify({ ok: true, format: j.format, title: j.title, worlds: j.worlds.length,
    chapters: (j.chapters||[]).length, tags: (j.tags||[]).length });
})()`)
console.log('  ' + wb)
check('世界书可访问且格式正确', typeof wb === 'string' && wb.includes('"format":"deng-xu-worldbook"'))

// 生产构建里调试钩子被有意 tree-shake 掉了（见 src/main.tsx 的 import.meta.env.DEV 分支），
// 所以游戏内走查只能在 dev 下做。这不是缺陷，是设计。
const HAS_HOOKS = await ev("typeof __libraryStore !== 'undefined'")
if (!HAS_HOOKS) {
  console.log('\n=== 3-7) 游戏内走查 ===')
  console.log('  跳过：线上是生产构建，调试钩子被有意 tree-shake 掉（这是设计，不是缺陷）')
  console.log('  游戏内部分请对 dev server 运行（SITE=http://localhost:5199/）')
  console.log('\n=== 汇总 ===')
  const f0 = results.filter(r => !r.ok)
  console.log(`  通过 ${results.length - f0.length}/${results.length}（仅标题页与资源）`)
  if (errs.length) { console.log('  运行期异常:'); [...new Set(errs)].slice(0,6).forEach(e=>console.log('    '+e)) }
  else console.log('  无运行期异常 ✓')
  if (bad.length) { console.log('  4xx/5xx:'); [...new Set(bad)].slice(0,4).forEach(b=>console.log('    '+b)) }
  ws.close(); edge.kill(); await sleep(300)
  process.exit(f0.length === 0 && errs.length === 0 ? 0 : 1)
}

console.log('\n=== 3) 进入一局 ===')
await ev(`(()=>{ __uiStore.getState().setLlm({apiKey:'sk-x'}); __uiStore.getState().setApiKeyModalOpen(false);
  __uiStore.getState().setShowTutorial(false); localStorage.setItem('hasSeenTutorial','true'); return 1 })()`)
await sleep(800)
const started = await ev(`(()=>{
  const w = __libraryStore.getState().worlds[0];
  if (!w) return 'no-world';
  const slot = w.backgrounds?.[0], opt = slot?.options?.[0];
  const bg = {}; if (slot && opt) bg[slot.label] = opt.id;
  __sessionStore.getState().setSession({ world: w,
    player: { name:'审计主角', gender:'女', age:'', appearance:'左手戴着皮手套', personality:'', background:'', extra:'' },
    activeCharacterIds: w.characters.map(c=>c.id), backgroundChoices: bg, attributeAllocation: {} });
  const g = __gameStore.getState();
  g.initFromWorld(w); g.setPlayerProfile('审计主角','女','左手戴着皮手套');
  g.addHistory({ role:'assistant', content:'你推开旅店后门，冷灰扑面。', timestamp: Date.now() });
  g.addCharacter({ id:'npc1', name:'薇拉·索恩', description:'拾音人行的资深成员', relationship:'同行', status:'正常', location:'慢钟旅店' });
  g.addCharacter({ id:'npc2', name:'凯斯', description:'旅店老板', relationship:'中立', status:'正常' });
  g.setScene('s04');
  g.startGame();
  return 'ok';
})()`)
console.log('  开局:', started)
await sleep(3000)
check('开局成功', started === 'ok')
await shot('02-game')

console.log('\n=== 4) 游戏内元素 ===')
const inGame = await ev(`(()=>{
  const imgs = [...document.querySelectorAll('img')];
  const png = imgs.filter(i => (i.src||'').startsWith('data:image/png'));
  const svg = imgs.filter(i => (i.src||'').startsWith('data:image/svg'));
  return {
    pngSprites: png.length,
    pngLoaded: png.every(i => i.complete && i.naturalWidth > 0),
    sceneBackdrop: !!document.querySelector('img[alt=""]'),
    sceneH: (()=>{ const i=document.querySelector('img[alt=""]'); return i ? Math.round(i.getBoundingClientRect().height) : 0; })(),
    playerName: __gameStore.getState().playerName,
    sceneId: __gameStore.getState().sceneId,
    hasAriaLive: !!document.querySelector('[aria-live]'),
    hasRetryBtn: /重试|重新生成/.test(document.body.innerText),
  };
})()`)
console.log('  ' + JSON.stringify(inGame))
check('像素立绘已渲染', inGame.pngSprites >= 1 && inGame.pngLoaded, `${inGame.pngSprites} 张`)
check('场景背景有真实高度', inGame.sceneH > 100, `${inGame.sceneH}px`)
check('主角名正确写入（不是"未命名"）', inGame.playerName === '审计主角', inGame.playerName)
check('场景 id 已写入', !!inGame.sceneId, String(inGame.sceneId))
check('叙事区有 aria-live（读屏可用）', inGame.hasAriaLive)

console.log('\n=== 5) 立绘面板 ===')
const opened = await ev(`(()=>{
  const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='人物');
  if(b) b.click(); return 1 })()`)
await sleep(1600)
const clicked = await ev(`(()=>{
  const btn=[...document.querySelectorAll('button[title="查看全身立绘"]')];
  if(!btn.length) return 0; btn[0].click(); return btn.length; })()`)
await sleep(2200)
const panel = await ev(`(()=>{
  const t=document.body.innerText;
  return {
    hasDirs: ['正面','左','右','背面'].every(d=>t.includes(d)),
    hasParts: /这套立绘由哪些部件组成/.test(t),
    fullBody: [...document.querySelectorAll('img')].filter(i=>(i.src||'').startsWith('data:image/png'))
      .some(i=>i.naturalWidth>=200),
  };
})()`)
check('立绘入口可点', clicked >= 1, `${clicked} 个`)
check('面板有四方向切换', panel.hasDirs)
check('面板显示部件构成', panel.hasParts)
check('面板显示全身（源图 ≥200px）', panel.fullBody)
await shot('03-portrait')

console.log('\n=== 6) 移动端布局 ===')
await ev(`(()=>{ __uiStore.getState().setPortraitCharacterId(null); return 1 })()`)
await sleep(600)
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2.6, mobile: true })
await sleep(2500)
const mobile = await ev(`(()=>{
  const de = document.documentElement;
  const overflow = de.scrollWidth - de.clientWidth;
  const wide = [...document.querySelectorAll('*')]
    .filter(el => el.getBoundingClientRect().width > de.clientWidth + 2)
    .slice(0, 3).map(el => el.tagName + '.' + String(el.className).split(' ')[0]);
  /*
    不要用 innerText.length 当"渲染正常"的判据 —— 我用它误判过。
    innerText 只统计**可见**文本，而手机端很多内容在折叠面板里，
    长度自然很小（实测只有 46 字），但界面其实完全正常。
    改成检查真实存在的关键元素。
  */
  const hasInput = !!document.querySelector('input[type="text"], textarea');
  const hasSprite = [...document.querySelectorAll('img')].some(i => (i.src||'').startsWith('data:image/png'));
  const hasScene = [...document.querySelectorAll('img')].some(i => {
    const r = i.getBoundingClientRect(); return r.height > 100 && r.width > 100;
  });
  const hasHeader = !!document.querySelector('header') || /灰烬回响|状态|章节/.test(document.body.innerText);
  return { overflow, wide, hasInput, hasSprite, hasScene, hasHeader, bodyLen: document.body.innerText.length };
})()`)
console.log('  ' + JSON.stringify(mobile))
check('手机端无横向溢出', mobile.overflow <= 2, `溢出 ${mobile.overflow}px`)
check('手机端输入框存在', mobile.hasInput)
check('手机端立绘已渲染', mobile.hasSprite)
check('手机端场景背景可见', mobile.hasScene)
check('手机端标题栏可见', mobile.hasHeader)
await shot('04-mobile')

console.log('\n=== 7) 回到标题页后存档/世界包入口 ===')
await ev(`(()=>{ __gameStore.getState().returnToTitle(); return 1 })()`)
await sleep(2500)
const back = await ev(`(()=>{
  const t = document.body.innerText;
  return { hasSave: /导出存档/.test(t), hasPack: /导出世界包/.test(t), hasUsage: /KB|MB/.test(t) };
})()`)
check('回标题页后存档入口可用', back.hasSave)
check('回标题页后世界包入口可用', back.hasPack)

console.log('\n=== 汇总 ===')
const failed = results.filter(r => !r.ok)
console.log(`  通过 ${results.length - failed.length}/${results.length}`)
if (bad.length) { console.log('  4xx/5xx 资源:'); [...new Set(bad)].slice(0, 5).forEach(b => console.log('    ' + b)) }
if (errs.length) { console.log('  运行期异常:'); [...new Set(errs)].slice(0, 8).forEach(e => console.log('    ' + e)) }
if (!bad.length && !errs.length) console.log('  无 4xx/5xx、无运行期异常 ✓')

ws.close(); edge.kill(); await sleep(300)
process.exit(failed.length === 0 && errs.length === 0 ? 0 : 1)
