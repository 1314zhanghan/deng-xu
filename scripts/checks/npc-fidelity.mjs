/**
 * NPC 立绘与描述贴合度对照图。
 *
 * 用**真实角色描述**（含玩家反馈过的那几个）渲染立绘，
 * 每张下面标注：描述 → 推断出的特征 → 实际选中的部件。
 *
 * 为什么必须画出来看：贴合度是主观判断，靠断言测不出来。
 * 上一轮我用像素覆盖率统计判断"哪件衣服露躯干"完全失败，
 * 最后就是靠渲染对照图才看清的。
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
const PORT = Number(process.env.CDP_PORT || 9850)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const getJson = u => new Promise((res, rej) => {
  http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)) } catch (e) { rej(e) } }) }).on('error', rej)
})
fs.mkdirSync(OUT, { recursive: true })
const edge = spawn(EDGE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(OUT, 'edge-npc-' + Date.now())}`,
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1500,1000', 'about:blank'], { stdio: 'ignore' })
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

/** 真实角色描述 —— 前三个来自玩家截图，其余覆盖常见搭配 */
const CASES = [
  ['管家', '巴斯蒂安是一位年龄成谜的男性精灵，岁月没有在他脸上留下沧桑，反而沉淀出一种醇酒般的古典优雅。他有着一头乌黑锃亮的长发，每日用特制精油打理得一丝不苟，利落地向后束成一条及腰的马尾。他的右眼佩戴着一枚镶有银丝的精致单片眼镜，深邃的暗绿色眼眸透过镜片观察着一切。他身着一丝不苟的黑色燕尾服，纯白的衬衫上没有一丝褶皱，领口系着暗藏荆棘纹的领结，手上永远戴着不染纤尘的白手套。他身形修长挺拔，走路时几乎没有声响，就像一道优雅的黑色阴影。', '男'],
  ['挑书的浅发女子', '约莫二十出头的年轻女子，浅亚麻色长发编成一条辫子垂在肩前，皮肤白净，穿着一件洗得发软的旧裙子', '女'],
  ['搬箱子的少年', '约莫十五六岁的黑发少年，瘦，穿洗得发白的粗布短衫，袖口卷到肘上', '男'],
  ['闻香料的银叶精灵', '男性森林精灵，银叶王庭出身，浅金色长发用木簪松松挽着，穿月白亚麻长衫', '男'],
  ['独眼茶摊老板', '月桂街街角茶摊的老板，独眼，沉默寡言，穿深褐色粗布短打', '男'],
  ['陌生佣兵', '三名穿皮甲、腰挂佩刀的男人', '男'],
  ['和服少女', '穿红色和服的少女，黑发，齐刘海', '女'],
  ['板甲骑士', '穿板甲的骑士，戴着全罩头盔，肩披白色披风', '男'],
  ['白裙贵妇', '穿白色长裙的贵妇，一头金发盘起，戴金色头冠', '女'],
  ['现代学生', '穿深蓝色制服短裙的女学生，黑发扎双马尾', '女'],
]

const built = await ev(`(async () => {
  const lp = await import('/src/utils/lpcSprite.ts');
  const ap = await import('/src/utils/appearance.ts');
  const cases = ${JSON.stringify(CASES)};
  const out = [];
  for (let i = 0; i < cases.length; i++) {
    const [tag, desc, gender] = cases[i];
    const profile = { name: tag, description: desc };
    const traits = ap.inferTraits(profile);
    const r = lp.recipeFor('npc' + i, { profile, gender });
    const img = await lp.renderSprite(r, 'down', 3);
    out.push({
      tag, desc,
      cloth: traits.cloth || '(未推断)',
      clothAll: (traits.clothAll || []).join('/') || '-',
      role: (traits.role || []).join('/') || '-',
      headwear: (traits.headwear || []).join('/') || '-',
      torso: r.clothing,
      parts: r.parts.join(' '),
      img,
    });
  }
  return JSON.stringify(out);
})()`)
if (String(built).startsWith('THREW')) { console.log('生成失败:', built); ws.close(); edge.kill(); process.exit(1) }
const arr = JSON.parse(built)

console.log('=== 每个角色的推断与实际选件 ===')
for (const c of arr) {
  console.log(`\n  【${c.tag}】`)
  console.log(`    推断衣色: ${c.cloth}   全部衣色: ${c.clothAll}`)
  console.log(`    推断身份: ${c.role}   头饰: ${c.headwear}`)
  console.log(`    实际上衣: ${c.torso}`)
}

console.log('\n=== 自动断言（客观可测的部分）===')
// 管家：描述明确写"黑色燕尾服"，上衣不该是随机的怪东西
const butler = arr.find(c => c.tag === '管家')
check('管家推断出黑色', butler.cloth === 'black', butler.cloth)
check('管家收集到黑+白两种衣色', butler.clothAll.includes('black') && butler.clothAll.includes('white'), butler.clothAll)

// 和服少女：应拿到和服类部件
const kimono = arr.find(c => c.tag === '和服少女')
check('和服少女拿到和服类部件', /dress_.*kimono|dress_sash|dress_bodice/.test(kimono.torso), kimono.torso)

// 板甲骑士：应拿到盔甲
const knight = arr.find(c => c.tag === '板甲骑士')
check('板甲骑士拿到盔甲/披风', /armour|cape/.test(knight.parts), knight.parts.split(' ').filter(p => /armour|cape/.test(p)).join(','))

// 女性角色不应拿到裤子（当描述有裙装时）
for (const c of arr) {
  if (!/裙|和服|礼服/.test(c.desc)) continue
  const pants = c.parts.split(' ').filter(p => /^legs_/.test(p) && !/skirt/i.test(p))
  check(`${c.tag} 穿裙装时没有裤子`, pants.length === 0, pants.join(',') || '(无)')
}

// 没有角色应该裸露躯干（外层件必须配打底）
for (const c of arr) {
  const outer = ['torso_aprons_apron', 'torso_aprons_apron_full', 'torso_aprons_apron_half',
    'torso_aprons_overalls', 'torso_jacket_tabard', 'torso_jacket_pockets', 'legs_skirt_overskirt']
  const hit = outer.find(o => c.parts.includes(o))
  if (!hit) continue
  const base = c.parts.split(' ').some(p => /^torso_clothes_(longsleeve|shortsleeve|tshirt)/.test(p))
  check(`${c.tag} 外层件(${hit})配了打底`, base, c.parts)
}

const html = `<!doctype html><html><body style="margin:0;background:#0e0e0e;font-family:sans-serif;padding:12px">
<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px">
${arr.map(c => `<div style="background:#171717;border:1px solid #2a2a2a;border-radius:6px;padding:6px;text-align:center">
  <img src="${c.img}" style="width:100%;image-rendering:pixelated;background:#101010;border-radius:4px">
  <div style="color:#f5b942;font-size:11px;margin-top:4px;font-weight:bold">${c.tag}</div>
  <div style="color:#8ab;font-size:9px;margin-top:2px">衣色:${c.cloth} (${c.clothAll})</div>
  <div style="color:#8ab;font-size:9px">身份:${c.role}</div>
  <div style="color:#c96;font-size:9px">上衣:${c.torso.replace('torso_', '')}</div>
  <div style="color:#666;font-size:8px;margin-top:3px;text-align:left;line-height:1.3">${c.desc.slice(0, 90)}…</div>
</div>`).join('')}
</div></body></html>`
fs.writeFileSync(path.join(OUT, 'npc-gallery.html'), html, 'utf8')
/*
  加时间戳参数破坏缓存。
  `file://` 下的图片会被浏览器缓存，同一个文件名第二次打开时
  拿到的还是旧图 —— 我因此看着"没变化"的截图排查了很久。
*/
const bust = `?t=${Date.now()}`
await send('Page.navigate', { url: 'file:///' + path.join(OUT, 'npc-gallery.html').replace(/\\/g, '/') + bust })
await sleep(2500)
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
fs.writeFileSync(path.join(OUT, `npc-gallery-${Date.now()}.png`), Buffer.from(shot.result.data, 'base64'))
fs.writeFileSync(path.join(OUT, 'npc-gallery.png'), Buffer.from(shot.result.data, 'base64'))
console.log(`\n对照图已写入 ${path.join(OUT, 'npc-gallery.png')}`)

const failed = results.filter(r => !r.ok)
console.log('\n=== 汇总 ===')
console.log(`  通过 ${results.length - failed.length}/${results.length}`)
if (failed.length) failed.forEach(r => console.log('    · ' + r.l))
ws.close(); edge.kill(); await sleep(300)
process.exit(failed.length === 0 ? 0 : 1)
