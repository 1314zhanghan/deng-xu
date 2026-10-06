/**
 * 同一批角色描述，在**离线 Node** 与**浏览器**两处分别跑一遍，
 * 比较 `recipeFor` 选出的部件是否完全一致。
 *
 * 为什么需要：离线渲染器是"同一份渲染代码换个宿主"，但宿主不同就可能
 * 行为不同（`import.meta.glob` 被替换过、Image 加载路径不同、随机数种子
 * 来源可能有差异）。如果两边选出的部件不一样，那么离线出的图和
 * 浏览器看到的图就不是一回事，用它做美术判断会得出错误结论。
 *
 * 用法：
 *   node scripts/lib/xcheck-offline.mjs                 # 只打印离线侧结果
 *   SITE=http://localhost:5199/ node scripts/lib/xcheck-offline.mjs   # 两边对比
 */
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import * as esbuild from 'esbuild'
import { spawn } from 'node:child_process'
import { installDomShim, decodePng } from './canvas-shim.mjs'

const ROOT = 'D:/工作区/pale-notes-web'
const SITE = process.env.SITE || ''

/** 与走查脚本 npc-fidelity.mjs 用同一批描述，便于三方对照 */
export const CASES = [
  ['管家', '星夜堡的管家，衣着整洁，右眼佩戴着一枚镶有银丝的单片眼镜，乌黑长发束成马尾'],
  ['和服少女', '穿着红色和服的少女，黑发，齐刘海'],
  ['板甲骑士', '穿板甲的骑士，戴着全罩大盔，白色披风'],
  ['银叶精灵', '森林精灵，浅金色长发用木簪挽起，穿绿色皮甲'],
  ['独眼茶摊老板', '独眼茶摊老板，棕色围裙，四十来岁，男人'],
  ['现代学生', '穿着深蓝色制服的学生，戴圆框眼镜'],
  ['莫西干混混', '染成亮橙色的莫西干头，穿破洞牛仔外套'],
  ['亡灵法师', '苍白到发青的皮肤，灰白的长发披散，穿漆黑的长袍'],
]

// ── 离线侧 ──
const out = path.join(ROOT, '.check', 'render-xcheck.mjs')
const lpcPartsPlugin = {
  name: 'lpc-parts',
  setup(build) {
    build.onResolve({ filter: /^virtual:lpc-parts$/ }, () => ({ path: 'lpc-parts', namespace: 'lpc-parts' }))
    build.onLoad({ filter: /.*/, namespace: 'lpc-parts' }, () => {
      const dir = path.join(ROOT, 'src', 'assets', 'lpc', 'parts')
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort()
      const entries = files.map(f => `  ${JSON.stringify('./parts/' + f)}: ${JSON.stringify(path.join(dir, f))},`)
      return { contents: `export default {\n${entries.join('\n')}\n}\n`, loader: 'js' }
    })
  },
}
const globReplacePlugin = {
  name: 'replace-import-meta-glob',
  setup(build) {
    build.onLoad({ filter: /lpcSprite\.ts$/ }, args => {
      let src = fs.readFileSync(args.path, 'utf8')
      let replaced = false
      src = src.replace(/import\.meta\.glob\(\s*['"][^'"]*parts\/\*\.png['"][\s\S]*?\)/m,
        () => { replaced = true; return 'LPC_PART_URLS' })
      if (!replaced) return { contents: src, loader: 'ts' }
      return { contents: `import LPC_PART_URLS from 'virtual:lpc-parts'\n${src}`, loader: 'ts', resolveDir: path.dirname(args.path) }
    })
  },
}
await esbuild.build({
  entryPoints: [path.join(ROOT, 'scripts', 'lib', 'render-entry.ts')],
  bundle: true, platform: 'node', format: 'esm', outfile: out,
  alias: { '@': path.join(ROOT, 'src') },
  loader: { '.json': 'json', '.png': 'file' },
  plugins: [lpcPartsPlugin, globReplacePlugin], logLevel: 'error',
})
installDomShim()
const M = await import('file://' + out.replace(/\\/g, '/'))

const offline = []
for (const [label, desc] of CASES) {
  const d = await M.spriteDetail(label, desc, { scale: 1 })
  const png = Buffer.from(d.dataUrl.slice(d.dataUrl.indexOf(',') + 1), 'base64')
  const { width, height, rgba } = decodePng(png)
  // 包围盒
  let minX = width, minY = height, maxX = -1, maxY = -1, count = 0
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (rgba[(y * width + x) * 4 + 3] > 8) {
      count++
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
    }
  }
  offline.push({
    label, desc,
    parts: d.recipe.parts,
    colors: d.recipe.colors,
    bbox: { x: [minX, maxX], y: [minY, maxY], w: maxX - minX + 1, h: maxY - minY + 1, count },
  })
}

console.log('\n=== 离线（Node）渲染 ===\n')
for (const o of offline) {
  console.log(`  【${o.label}】 部件 ${o.parts.length} 个  包围盒 ${o.bbox.w}×${o.bbox.h}（y ${o.bbox.y[0]}..${o.bbox.y[1]}）像素 ${o.bbox.count}`)
  console.log(`      ${o.parts.join(', ')}`)
}

if (!SITE) {
  console.log('\n（未设置 SITE，跳过浏览器侧对比）')
  console.log('  对比用法：SITE=http://localhost:5199/ node scripts/lib/xcheck-offline.mjs\n')
  process.exit(0)
}

// ── 浏览器侧 ──
const getJson = u => new Promise((res, rej) => {
  http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)) } catch (e) { rej(e) } }) }).on('error', rej)
})
const sleep = ms => new Promise(r => setTimeout(r, ms))

const EDGE = (() => {
  const cands = [
    process.env.EDGE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean)
  for (const c of cands) { try { if (fs.existsSync(c)) return c } catch { /* 忽略 */ } }
  throw new Error('找不到 Edge')
})()

const PORT = 9971
const profile = path.join(process.env.TEMP || '/tmp', 'dx-xcheck-' + Date.now())
fs.mkdirSync(profile, { recursive: true })
const edge = spawn(EDGE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'], { stdio: 'ignore' })

let v = null
for (let i = 0; i < 60; i++) { try { v = await getJson(`http://127.0.0.1:${PORT}/json/version`); break } catch { await sleep(500) } }
if (!v) { console.error('✗ 浏览器未就绪'); edge.kill(); process.exit(1) }

const list = await getJson(`http://127.0.0.1:${PORT}/json/list`)
const ws = new WebSocket(list.find(x => x.type === 'page').webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let id = 0
const pend = new Map()
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } }
const send = (m, p = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
const ev = async x => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })
  return r.result?.exceptionDetails ? 'THREW ' + (r.result.exceptionDetails.exception?.description || '') : r.result?.result?.value
}
await send('Runtime.enable')
await send('Page.navigate', { url: SITE })
await sleep(9000)

const browserRaw = await ev(`(async () => {
  const m = await import('/src/utils/lpcSprite.ts');
  const cases = ${JSON.stringify(CASES)};
  const out = [];
  for (const [label, desc] of cases) {
    const r = m.recipeFor(label, { profile: { description: desc } });
    out.push({ label, parts: r.parts, colors: r.colors });
  }
  return JSON.stringify(out);
})()`)

ws.close(); edge.kill()
try { fs.rmSync(profile, { recursive: true, force: true }) } catch { /* 忽略 */ }

if (typeof browserRaw === 'string' && browserRaw.startsWith('THREW')) {
  console.error('✗ 浏览器侧执行失败：', browserRaw)
  process.exit(1)
}
const browser = JSON.parse(browserRaw)

console.log('\n=== 浏览器（Edge/CDP）渲染 ===\n')
for (const b of browser) console.log(`  【${b.label}】 ${b.parts.join(', ')}`)

console.log('\n=== 对比 ===\n')
let same = 0
for (let i = 0; i < offline.length; i++) {
  const a = offline[i], b = browser[i]
  const eq = JSON.stringify(a.parts) === JSON.stringify(b.parts)
  const ceq = JSON.stringify(a.colors) === JSON.stringify(b.colors)
  const ok = eq && ceq
  if (ok) same++
  console.log(`  ${ok ? '✓' : '✗'} ${a.label}${ok ? ' 部件与配色完全一致' : ''}`)
  if (!eq) {
    const onlyOff = a.parts.filter(p => !b.parts.includes(p))
    const onlyBr = b.parts.filter(p => !a.parts.includes(p))
    console.log(`      仅离线有：${onlyOff.join(', ') || '(无)'}`)
    console.log(`      仅浏览器有：${onlyBr.join(', ') || '(无)'}`)
  }
  if (!ceq) console.log(`      配色不同 离线=${JSON.stringify(a.colors)} 浏览器=${JSON.stringify(b.colors)}`)
}
console.log(`\n  ${same}/${offline.length} 个角色两边一致\n`)
process.exit(same === offline.length ? 0 : 1)
