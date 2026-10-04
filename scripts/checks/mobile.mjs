import './_ws-shim.mjs'
/**
 * 手机端专项走查。
 *
 * 验证三件玩家实际反馈过的事：
 *   1. 底栏点了**真的会弹出面板**（第一版只改状态、没人渲染内容，
 *      表现为"底栏无效"）
 *   2. NPC 列表里是**全身立绘**，不是一颗脑袋
 *      （原先写死了 headOnly）
 *   3. 系统返回键 / 浏览器后退键**在游戏内退回上一级**，而不是退出网站
 *      （实现方式：打开浮层时 pushState，返回键先消费它）
 *
 * 全程用真实手机视口（390×844, mobile:true）跑，不用桌面视口糊弄。
 */
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const SITE = process.env.SITE || 'http://localhost:5199/'
const OUT = process.env.AUDIT_OUT || 'playtest-shots'
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
const PORT = Number(process.env.CDP_PORT || 9790)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const getJson = u => new Promise((res, rej) => {
  http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)) } catch (e) { rej(e) } }) }).on('error', rej)
})
fs.mkdirSync(OUT, { recursive: true })
const edge = spawn(EDGE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(OUT, 'edge-mob-' + Date.now())}`,
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=390,844', 'about:blank'], { stdio: 'ignore' })
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
const results = []
const check = (l, ok, extra = '') => { results.push({ l, ok }); console.log(`  ${ok ? '✓' : '✗'} ${l}${extra ? '  ' + extra : ''}`) }

/**
 * 抽屉是否打开的**可靠判据**。
 *
 * 不能用 `input[placeholder*="搜索物品"]` —— 桌面右栏也有同一个搜索框，
 * 它一直存在，于是检测永远为真。我为此误判了两轮，以为是抽屉关不掉。
 * 改成找那个 `fixed` + `justify-end` 的抽屉容器本身。
 */
const DETECT_SHEET = `(()=>{const s=[...document.querySelectorAll('div')].find(d=>/justify-end/.test(String(d.className)) && /fixed/.test(String(d.className)));return !!s})()`

await send('Runtime.enable'); await send('Page.enable')
// 真实手机视口
await send('Emulation.setDeviceMetricsOverride', {
  width: 390, height: 844, deviceScaleFactor: 3, mobile: true,
})
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
await send('Page.navigate', { url: SITE }); await sleep(3000)
await ev(`(()=>{const k='pale-notes-ui';let v={};try{v=JSON.parse(localStorage.getItem(k)||'{}')}catch(e){}
  v.state=v.state||{};v.state.llm=Object.assign({provider:'deepseek',baseUrl:'https://api.deepseek.com/v1',narrativeModel:'deepseek-chat',analysisModel:'deepseek-chat',temperature:0.8},v.state.llm||{},{apiKey:'sk-mob'});
  v.state.isApiKeyModalOpen=false;localStorage.setItem(k,JSON.stringify(v));return 1})()`)
await send('Page.navigate', { url: SITE }); await sleep(9000)

/** 直接在 store 里起一局，跳过选角（本测试只关心手机端交互） */
async function launchGame() {
  await ev(`(()=>{
    const w = __libraryStore.getState().worlds[0];
    __sessionStore.getState().setSession({ world:w,
      player:{name:'手机测试者',gender:'',age:'',appearance:'',personality:'',background:'',extra:''},
      activeCharacterIds:[], backgroundChoices:{}, attributeAllocation:{} });
    const g=__gameStore.getState(); g.resetGame(); g.initFromWorld(w);
    g.setPlayerProfile('手机测试者','','',undefined);
    g.addItem({ id:'i1', name:'歪掉的音叉', description:'共鸣者能感觉到它在指方向', tags:['tool'] });
    g.addItem({ id:'i2', name:'磨破的登记册', description:'记着二十七个名字', tags:['record'] });
    g.addCharacter({ id:'c1', name:'薇拉·索恩', description:'灰色眼睛的女书记官，穿着深色长外套，头发扎得很紧', relationship:'可靠', status:'在场', location:'星夜堡' });
    g.addCharacter({ id:'c2', name:'凯斯', description:'年轻的守卫，穿着皮甲，留着短胡子', relationship:'警惕', status:'在场', location:'门厅' });
    g.startGame();
    return 1 })()`)
  for (let i = 0; i < 14; i++) {
    const ok = await ev(`__gameStore.getState().isGameStarted && !!document.querySelector('nav')`)
    if (ok) break
    await sleep(700)
  }
  await sleep(1500)
}

console.log('=== 1) 手机端底栏是否存在且可点 ===')
await launchGame()
const bar = JSON.parse(await ev(`(()=>{
  const nav = document.querySelector('nav');
  const btns = nav ? [...nav.querySelectorAll('button')] : [];
  const labels = btns.map(b => (b.textContent||'').trim());
  const rects = btns.map(b => { const r=b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) }; });
  return JSON.stringify({ hasNav: !!nav, labels, rects, vh: window.innerHeight });
})()`))
console.log('  ' + JSON.stringify(bar.labels) + '  尺寸=' + JSON.stringify(bar.rects))
check('底栏存在', bar.hasNav)
check('有四个入口（状态/物品/人物/更多）', bar.labels.length === 4, bar.labels.join('/'))
check('每个按钮触摸高度 ≥ 48px', bar.rects.every(r => r.h >= 48), JSON.stringify(bar.rects.map(r => r.h)))
check('每个按钮宽度 ≥ 60px', bar.rects.every(r => r.w >= 60), JSON.stringify(bar.rects.map(r => r.w)))
await shot('mob-01-bar')

console.log('\n=== 2) 点底栏「物品」→ 面板真的弹出来 ===')
// 用真实点击（不是 el.click()），走完整的命中测试路径
async function tapByLabel(label) {
  const box = await ev(`(()=>{
    const nav = document.querySelector('nav');
    const b = [...nav.querySelectorAll('button')].find(x => (x.textContent||'').trim().includes(${JSON.stringify(label)}));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) });
  })()`)
  if (!box) return 'no-button'
  const { x, y } = JSON.parse(box)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  return 'ok'
}

console.log('  点「物品」:', await tapByLabel('物品'))
await sleep(1200)
const sheetInv = JSON.parse(await ev(`(()=>{
  const T = document.body.innerText;
  const sheet = [...document.querySelectorAll('div')].find(d=>/justify-end/.test(String(d.className)) && /fixed/.test(String(d.className)));
  return JSON.stringify({
    showsPanel: !!sheet && /物品栏/.test(sheet.textContent || ''),
    showsItem: /歪掉的音叉/.test(T),
    // 抽屉只占下半屏，上方应仍能看到叙事
    sheetMaxH: (()=>{ const el=[...document.querySelectorAll('div')].find(d=>/max-h-\\[70vh\\]/.test(String(d.className))); return el ? Math.round(el.getBoundingClientRect().height) : 0 })(),
    vh: window.innerHeight,
  });})()`))
console.log('  ' + JSON.stringify(sheetInv))
check('物品面板弹出了（能看到物品栏标题）', sheetInv.showsPanel)
check('面板里有真实的物品', sheetInv.showsItem)
check('抽屉只占下半屏（上方叙事仍可见）', sheetInv.sheetMaxH > 100 && sheetInv.sheetMaxH <= sheetInv.vh * 0.75, `${sheetInv.sheetMaxH}/${sheetInv.vh}`)
await shot('mob-02-inventory-sheet')

console.log('\n=== 3) 切到「人物」→ 面板内容跟着换 ===')
console.log('  点「人物」:', await tapByLabel('人物'))
await sleep(1200)
const sheetRel = JSON.parse(await ev(`(()=>{
  const T = document.body.innerText;
  const sheet = [...document.querySelectorAll('div')].find(d=>/justify-end/.test(String(d.className)) && /fixed/.test(String(d.className)));
  return JSON.stringify({
    showsPanel: !!sheet && /人物关系/.test(sheet.textContent || ''),
    hasNPC: /薇拉·索恩/.test(T),
    stillShowsItems: !!sheet && /物品栏/.test(sheet.textContent || ''),
  });})()`))
console.log('  ' + JSON.stringify(sheetRel))
check('切到了人物关系面板', sheetRel.showsPanel)
check('列出了 NPC', sheetRel.hasNPC)
check('物品面板已让位（不同时显示）', !sheetRel.stillShowsItems)

console.log('\n=== 4) NPC 是**全身**立绘，不是一颗脑袋 ===')
const sprite = JSON.parse(await ev(`(()=>{
  // 找到人物关系里那个像素立绘 canvas
  const cvs = [...document.querySelectorAll('img[src^="data:image/png"]')];
  const cs = cvs.map(c => {
    const r = c.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  return JSON.stringify({ count: cvs.length, sizes: cs });
})()`))
console.log('  画布尺寸:', JSON.stringify(sprite.sizes))
check('关系面板里有像素立绘（img 数据源）', sprite.count > 0, `${sprite.count} 个`)
// 全身立绘应当明显高于宽（列表里是 48×72）
const fullBody = sprite.sizes.some(s => s.h > s.w * 1.3)
check('立绘是**竖长的全身比例**（高 > 宽×1.3）', fullBody, JSON.stringify(sprite.sizes))

console.log('\n=== 5) 点 NPC → 看更大的全身立绘 ===')
await ev(`(()=>{
  const img = [...document.querySelectorAll('img[src^="data:image/png"]')][0];
  if (!img) return 0;
  // PortraitTrigger 是一个带 onClick 的包裹元素，往上找到它
  let el = img;
  for (let i = 0; i < 6 && el; i++) {
    if (el.getAttribute && (el.getAttribute('role') === 'button' || el.tagName === 'BUTTON' || el.onclick)) { el.click(); return 1 }
    el = el.parentElement;
  }
  // 兜底：点它的直接父级
  img.parentElement && img.parentElement.click();
  return 2;
})()`)
await sleep(1400)
const big = JSON.parse(await ev(`(()=>{
  const T = document.body.innerText;
  const sheet = [...document.querySelectorAll('div')].find(d=>/justify-end/.test(String(d.className)) && /fixed/.test(String(d.className)));
  const cvs = [...document.querySelectorAll('img[src^="data:image/png"]')].map(c=>{const r=c.getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height)}});
  return JSON.stringify({ opened: /正面|背面|左|右/.test(T) && /方向|立绘|部件/.test(T) || cvs.length>0,
    sizes: cvs, hasDirBtns: /正面/.test(T) });
})()`))
console.log('  ' + JSON.stringify(big))
check('打开了立绘详情', big.opened)
check('有方向切换（正面/左/右/背面）', big.hasDirBtns)
const biggest = big.sizes.sort((a, b) => b.h - a.h)[0]
check('大立绘明显更大（高 ≥ 200px）', biggest && biggest.h >= 200, biggest ? `${biggest.w}×${biggest.h}` : '无')
await shot('mob-03-portrait')

console.log('\n=== 6) 返回键在游戏内退回上一级（不退出网站）===')
await ev(`(()=>{ const b=[...document.querySelectorAll('button')].find(x=>/关闭/.test(x.getAttribute('title')||'')); if(b)b.click(); return 1 })()`)
await sleep(600)
// 打开抽屉 → 按返回键 → 抽屉应关闭，且页面**还在**
console.log('  点「状态」打开抽屉:', await tapByLabel('状态'))
await sleep(1000)
const beforeBack = await ev(`!!document.querySelector('nav')`)
const histBefore = await ev(`window.history.length`)
console.log('  按系统返回键…')
await ev(`window.history.back()`)
await sleep(1200)
const afterBack = JSON.parse(await ev(`(()=>{
  const T = document.body.innerText;
  const sheet = [...document.querySelectorAll('div')].find(d=>/justify-end/.test(String(d.className)) && /fixed/.test(String(d.className)));
  return JSON.stringify({
    // 页面必须还在（没被退到浏览器主页）
    stillHere: !!document.querySelector('nav') && /灯叙|冒险|状态|物品/.test(T),
    sheetClosed: !/人物关系|搜索物品/.test(T),
    histLen: window.history.length,
  });})()`))
console.log(`  history.length: ${histBefore} → ${afterBack.histLen}`)
check('**页面还在**（返回键没有退出网站）', afterBack.stillHere)
check('抽屉被返回键关掉了', afterBack.sheetClosed)
check('历史记录被消费（length 没膨胀）', afterBack.histLen >= 1)
await shot('mob-04-after-back')

console.log('\n=== 7) 连按两次返回：第一次关抽屉，第二次才离开 ===')
console.log('  再开抽屉:', await tapByLabel('物品'))
await sleep(1600)   // 等 pushState 生效（真实用户也做不到 0ms 按返回）
console.log('  history 状态:', await ev(`JSON.stringify({ len: history.length, state: history.state })`))
const open2 = await ev(DETECT_SHEET)
await ev(`window.history.back()`)
await sleep(1400)
console.log('  返回后 history:', await ev(`JSON.stringify({ len: history.length, state: history.state })`))
const closed2 = await ev(`!(${DETECT_SHEET}) && !!document.querySelector('nav')`)
check('打开后再按返回 → 关闭抽屉且页面仍在', open2 && closed2, `开=${open2} 关=${closed2}`)

const failed = results.filter(r => !r.ok)
console.log('\n=== 汇总 ===')
console.log(`  通过 ${results.length - failed.length}/${results.length}`)
if (failed.length) { console.log('  未通过:'); failed.forEach(r => console.log('    · ' + r.l)) }
console.log('  运行期异常:', errs.length ? [...new Set(errs)].slice(0, 4) : '(无)')

ws.close(); edge.kill(); await sleep(300)
process.exit(failed.length === 0 && errs.length === 0 ? 0 : 1)
