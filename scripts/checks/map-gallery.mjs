/**
 * RPG 地图画廊：把每种地形画成白天/夜晚两张对照图。
 *
 * 用途：
 *  1. 确认地图真的画出了可辨认的地形（不是一片糊色）
 *  2. 确认昼夜两套配色差别明显（玩家不看钟也能感到时间变化）
 *
 * 这类"看一眼就知道对不对"的东西必须**画出来看**。
 * 上一轮我用像素覆盖率统计判断"哪件衣服露躯干"，结论完全对不上，
 * 最后是靠渲染 37 张对照图才看清的。
 */
import './_ws-shim.mjs'
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
    '/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium',
  ].filter(Boolean)
  for (const c of cands) { try { if (fs.existsSync(c)) return c } catch { /* 忽略 */ } }
  throw new Error('找不到 Edge / Chrome，可用 EDGE_PATH 指定')
})()
const PORT = Number(process.env.CDP_PORT || 9840)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const getJson = u => new Promise((res, rej) => {
  http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)) } catch (e) { rej(e) } }) }).on('error', rej)
})
fs.mkdirSync(OUT, { recursive: true })
const edge = spawn(EDGE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(OUT, 'edge-map-' + Date.now())}`,
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' })
let v = null
for (let i = 0; i < 60; i++) { try { v = await getJson(`http://127.0.0.1:${PORT}/json/version`); break } catch { await sleep(500) } }
if (!v) { console.error('端口未就绪'); process.exit(1) }
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
const results = []
const check = (l, ok, extra = '') => { results.push({ l, ok }); console.log(`  ${ok ? '✓' : '✗'} ${l}${extra ? '  ' + extra : ''}`) }

await send('Runtime.enable')
await send('Page.navigate', { url: SITE }); await sleep(9000)

const ARCHES = ['interior', 'street', 'forest', 'mountain', 'coast', 'ruins', 'underground', 'sky', 'night']

const built = await ev(`(async () => {
  const m = await import('/src/utils/rpgMap.ts');
  const out = [];
  for (const a of ${JSON.stringify(ARCHES)}) {
    const day = m.generateMap(a, 'gallery', false);
    const night = m.generateMap(a, 'gallery', true);
    out.push({ a, day: day.dataUrl, night: night.dataUrl, w: day.width, h: day.height });
  }
  return JSON.stringify(out);
})()`)
if (String(built).startsWith('THREW')) { console.log('生成失败:', built); ws.close(); edge.kill(); process.exit(1) }
const arr = JSON.parse(built)

console.log('=== 1) 每张图都能生成且尺寸一致 ===')
check('九种地形都有白天与夜晚两张', arr.length === ARCHES.length && arr.every(x => x.day && x.night), `${arr.length} 组`)
check('尺寸一致（320×192）', arr.every(x => x.w === 320 && x.h === 192), `${arr[0].w}×${arr[0].h}`)

console.log('\n=== 2) 昼夜两张图**确实不同**（不能是同一张） ===')
const identical = arr.filter(x => x.day === x.night).map(x => x.a)
check('没有任何地形昼夜同图', identical.length === 0, identical.join(',') || '(全部不同)')

const html = `<!doctype html><html><body style="margin:0;background:#111;font-family:sans-serif;padding:10px">
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
${arr.map(x => `<div style="text-align:center">
  <div style="color:#f5b942;font-size:12px;margin-bottom:4px">${x.a}</div>
  <div style="display:flex;gap:4px">
    <img src="${x.day}" style="width:100%;image-rendering:pixelated;border:1px solid #333">
    <img src="${x.night}" style="width:100%;image-rendering:pixelated;border:1px solid #f5b942">
  </div>
  <div style="color:#888;font-size:9px;margin-top:2px">左=白天　右=夜晚（暖色边框）</div>
</div>`).join('')}
</div></body></html>`
fs.writeFileSync(path.join(OUT, 'map-gallery.html'), html, 'utf8')

await send('Page.navigate', { url: 'file:///' + path.join(OUT, 'map-gallery.html').replace(/\\/g, '/') })
await sleep(2500)
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
fs.writeFileSync(path.join(OUT, 'map-gallery.png'), Buffer.from(shot.result.data, 'base64'))
console.log(`\n画廊已写入 ${path.join(OUT, 'map-gallery.png')}`)

const failed = results.filter(r => !r.ok)
console.log('\n=== 汇总 ===')
console.log(`  通过 ${results.length - failed.length}/${results.length}`)
if (failed.length) failed.forEach(r => console.log('    · ' + r.l))
ws.close(); edge.kill(); await sleep(300)
process.exit(failed.length === 0 ? 0 : 1)
