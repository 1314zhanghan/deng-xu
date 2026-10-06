/**
 * NPC 词表覆盖诊断。
 *
 * 目的：**用数据找出词表缺口**，而不是凭印象补词。
 * 做法是拿一批真实风格的角色描述（涵盖各种题材与身份），
 * 统计每条能推断出哪些维度；某个维度大面积推断不出来，
 * 就说明那张词表缺词。
 *
 * 这类"覆盖率"统计只用来**定位缺口**，不用来判断"像不像" ——
 * 像不像必须画出来看（见 npc-fidelity.mjs）。
 */
import './_ws-shim.mjs'
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { outDir, profileDir, removeProfile } from './_browser.mjs'

const SITE = process.env.SITE || 'http://localhost:5199/'
// 必须绝对路径：--user-data-dir 用相对路径时 Chromium 会静默失败（见 _browser.mjs 的 outDir）
const OUT = outDir()
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
const PORT = Number(process.env.CDP_PORT || 9830)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const getJson = u => new Promise((res, rej) => {
  http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)) } catch (e) { rej(e) } }) }).on('error', rej)
})
fs.mkdirSync(OUT, { recursive: true })
const PROFILE = profileDir('cov')
const edge = spawn(EDGE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'], { stdio: 'ignore' })
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

await send('Runtime.enable')
await send('Page.navigate', { url: SITE }); await sleep(9000)

/**
 * 覆盖面刻意铺开：不同题材、不同身份、不同描述详细程度。
 * 前若干条来自玩家实际截图与反馈，后面覆盖常见职业与题材。
 */
const CASES = [
  // 现代 / 都市
  ['便利店夜班店员', '二十四岁，穿蓝色条纹的便利店制服，头发染成栗色，眼下有黑眼圈', '男'],
  ['地铁上的上班族', '穿深灰色西装，白衬衫打领带，手里拎着公文包，面容疲惫', '男'],
  ['咖啡店女店员', '二十出头，围着棕色围裙，浅金色的马尾从棒球帽后面露出来', '女'],
  ['街头混混', '染成亮橙色的莫西干头，穿破洞牛仔外套，脸上有疤', '男'],
  // 西幻
  ['酒馆老板', '矮胖的中年男人，秃顶，围着沾满油渍的皮围裙，笑起来缺两颗牙', '男'],
  ['精灵游侠', '银白色长发编成辫子，尖耳朵，穿墨绿色皮甲，肩披灰绿斗篷', '女'],
  ['矮人铁匠', '红褐色的大胡子编成两股辫，手臂粗壮，穿深棕色皮革工装', '男'],
  ['亡灵法师', '苍白到发青的皮肤，灰白的长发披散，穿漆黑的长袍，眼窝深陷', '男'],
  ['圣殿骑士', '金色短发，穿银色板甲，肩披白色披风，手持长剑', '男'],
  ['刺客', '全身黑色紧身衣，蒙面只露一双灰眼，头发扎成紧髻', '女'],
  // 中式仙侠
  ['青云宗女弟子', '一袭月白长裙，青丝用一支木簪挽起，腰悬长剑', '女'],
  ['魔道长老', '一头赤红长发扬起，穿玄色长袍，面容阴鸷', '男'],
  ['药铺掌柜', '灰白头发的老者，留山羊胡，穿靛蓝布袍', '男'],
  // 日式异世界
  ['骑士团女团长', '金色长发束成高马尾，穿亮银色胸甲，腰间佩剑', '女'],
  ['魔法学院学生', '深紫色短发，戴圆框眼镜，穿黑色学院制服斗篷', '女'],
  ['兽人战士', '绿皮肤，红棕色乱发，獠牙外露，穿粗制的皮革护甲', '男'],
  // 后末日
  ['水塔守', '四十岁，短发花白，穿反光条外套，手上有冻疮', '男'],
  ['拾荒者少女', '十六岁，瘦小，用布条把黑色长发扎在脑后，穿拼凑的防水衣', '女'],
  // 架空历史
  ['户部小吏', '三十岁的文官，戴乌纱帽，穿青色官袍，面容清瘦', '男'],
  ['将军', '五十岁，花白胡须，穿玄色铠甲，肩披猩红战袍', '男'],
  // 边缘情况
  ['无描述的路人', '', '男'],
  ['只有名字', '', '女'],
]

const built = await ev(`(async () => {
  const ap = await import('/src/utils/appearance.ts');
  const cases = ${JSON.stringify(CASES)};
  const out = [];
  for (const [name, desc, gender] of cases) {
    const tr = ap.inferTraits({ name, description: desc });
    out.push({
      name, desc, gender,
      hairColor: tr.hairColor || null,
      hairStyle: tr.hairStyle || null,
      skin: tr.skin || null,
      cloth: tr.cloth || null,
      eye: tr.eye || null,
      age: tr.age || null,
      build: tr.build || null,
      role: tr.role || null,
      headwear: tr.headwear || null,
      beard: tr.beard || false,
    });
  }
  return JSON.stringify(out);
})()`)
if (String(built).startsWith('THREW')) { console.log('推断失败:', built); ws.close(); edge.kill(); process.exit(1) }
const arr = JSON.parse(built)

const DIMS = ['hairColor', 'hairStyle', 'skin', 'cloth', 'eye', 'age', 'build', 'role', 'headwear']
const withDesc = arr.filter(a => a.desc && a.desc.length > 6)

console.log(`=== 词表覆盖率（${withDesc.length} 条有实际描述的角色）===`)
const report = []
for (const d of DIMS) {
  const hit = withDesc.filter(a => {
    const v = a[d]
    return Array.isArray(v) ? v.length > 0 : !!v
  }).length
  const pct = Math.round((hit / withDesc.length) * 100)
  report.push({ dim: d, hit, total: withDesc.length, pct })
  const bar = '█'.repeat(Math.round(pct / 5)).padEnd(20, '·')
  console.log(`  ${d.padEnd(11)} ${bar} ${String(pct).padStart(3)}%  (${hit}/${withDesc.length})`)
}

console.log('\n=== 推断不出来的具体条目（这就是要补的词）===')
for (const d of DIMS) {
  const miss = withDesc.filter(a => {
    const v = a[d]
    return Array.isArray(v) ? v.length === 0 : !v
  })
  if (!miss.length) continue
  console.log(`\n  【缺 ${d}】`)
  for (const m of miss) console.log(`    · ${m.name}：${m.desc.slice(0, 46)}`)
}

/* 只断言"**描述里确实提到了**该维度时能推断出来"，而不是全局百分比。
   理由：全局百分比受样本影响极大 —— `skin`/`eye` 只有 10% 并不是词表缺陷，
   而是这批描述里多数根本没写肤色瞳色（这时随机取值完全没问题，玩家不会察觉）。
   拿固定阈值当门槛会逼着我去堆无意义的词，属于**用错误的指标驱动工作**。 */
const results = []
const check = (l, ok, extra = '') => { results.push({ l, ok }); console.log(`  ${ok ? '✓' : '✗'} ${l}${extra ? '  ' + extra : ''}`) }

console.log('\n=== 提到即应推断出（正确的判据）===')
/** 描述里出现了该维度的关键词时，必须能推断出来 */
const SHOULD_INFER = [
  ['发色', /发|hair/i, 'hairColor'],
  ['衣色', /穿|着|衣|袍|裙|甲|服|披|围|dress|coat|robe/i, 'cloth'],
  ['年龄', /\d+ ?岁|年轻|中年|老|少年|少女|孩童|child|young|elder/i, 'age'],
  /*
    ⚠️ 判据要**只列真正的身份词**。
    我第一版在这里放了裸的 `剑|甲$`，结果「腰悬长剑」「穿皮甲」也算成
    "提到了身份"，于是把 dress 描述误报成"身份没推出来" ——
    断言写得比被测量对象还宽，只会制造假失败。
  */
  ['身份', /守卫|骑士|法师|术士|管家|贵族|领主|铁匠|刺客|游侠|水手|船员|官员|文官|官吏|学生|学徒|老板|店主|商人|医师|医生|护士|上班族|警官|警察|厨师|弟子|修士|长老|掌门|战士|佣兵|精灵|矮人|兽人|亡灵|农民|村民|盗贼|猎人|艺人|店员|侍者|女仆|国王|女王|公主|王子|拾荒|水塔守|祭司|牧师/i, 'role'],
  ['头饰', /头盔|兜帽|头巾|王冠|帽|冠|角|面甲|兜鍪|涂/i, 'headwear'],
]
for (const [label, re, dim] of SHOULD_INFER) {
  const relevant = withDesc.filter(a => re.test(a.desc))
  if (!relevant.length) { check(`${label}：样本里有相关描述`, false, '样本不足'); continue }
  const hit = relevant.filter(a => {
    const v = a[dim]
    return Array.isArray(v) ? v.length > 0 : !!v
  })
  const pct = Math.round((hit.length / relevant.length) * 100)
  check(`${label}：描述提到时能推断出`, pct >= 70,
    `${pct}% (${hit.length}/${relevant.length})` +
    (pct < 70 ? '  漏: ' + relevant.filter(a => !hit.includes(a)).map(a => a.name).join('、') : ''))
}

/* 已知缺口的回归锚点：这些都是诊断中发现并已修好的，防止以后回退 */
console.log('\n=== 已知缺口的回归锚点 ===')
const ANCHOR_CASES = [
  ['乌纱帽能推出头饰', '戴乌纱帽的文官', 'headwear'],
  ['棒球帽能推出头饰', '浅金色的马尾从棒球帽后面露出来', 'headwear'],
  ['文官能推出身份', '三十岁的文官，面容清瘦', 'role'],
  ['学生能推出身份', '穿黑色学院制服斗篷的学生', 'role'],
  ['酒馆老板能推出身份', '围着沾满油渍的皮围裙的酒馆老板', 'role'],
  ['兽人能推出绿肤色', '绿皮肤的兽人战士', 'skin'],
  ['亡灵能推出灰肤色', '亡灵法师，眼窝深陷', 'skin'],
  ['五十岁被判为老者', '五十岁的老者', 'age'],
]
const anchorFacts = JSON.parse(await ev(`(async () => {
  const ap = await import('/src/utils/appearance.ts');
  const cases = ${JSON.stringify(ANCHOR_CASES.map(c => [c[0], c[1], c[2]]))};
  const out = [];
  for (const [label, desc, dim] of cases) {
    const tr = ap.inferTraits({ description: desc });
    out.push({ label, dim, value: tr[dim] ?? null });
  }
  return JSON.stringify(out);
})()`))
for (const f of anchorFacts) {
  const ok = Array.isArray(f.value) ? f.value.length > 0 : !!f.value
  check(f.label, ok, `${f.dim}=${JSON.stringify(f.value)}`)
}

fs.writeFileSync(path.join(OUT, 'coverage-report.json'), JSON.stringify({ report, cases: arr, anchors: anchorFacts }, null, 2), 'utf8')
console.log(`\n报告已写入 ${path.join(OUT, 'coverage-report.json')}`)

const failed = results.filter(r => !r.ok)
console.log('\n=== 汇总 ===')
console.log(`  通过 ${results.length - failed.length}/${results.length}`)
if (failed.length) failed.forEach(r => console.log('    · ' + r.l))
ws.close(); edge.kill(); await sleep(300); removeProfile(PROFILE)
process.exit(failed.length === 0 ? 0 : 1)
