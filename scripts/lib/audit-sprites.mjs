/**
 * 全量立绘审计：拿**所有内置世界的角色卡**跑一遍，找出"立绘与描述矛盾"的角色。
 *
 * ## 为什么需要它
 *
 * "立绘和描述对不上"这类反馈，如果只修玩家截到的那两个例子，
 * 剩下的同类问题还会继续冒出来 —— 因为根因在词表覆盖不足，
 * 而词表缺什么**只有拿全量语料跑一遍才看得出来**。
 *
 * 这个脚本做两件事：
 *   1. **可机检的矛盾**：描述推断出的性别/年龄与最终部件互相打脸
 *      （推断为女性却选了 male 头、没推断出胡须却长了胡子…）→ 计数，可作为门槛
 *   2. **可视化**：把全部角色渲染成对照图，人工一眼扫过去
 *      （"像不像"必须看，机检只能抓硬矛盾）
 *
 * ## 用法
 *
 *   node scripts/lib/audit-sprites.mjs            # 打印报告 + 出对照图
 *   node scripts/lib/audit-sprites.mjs --quiet    # 只打印汇总
 */
import fs from 'node:fs'
import path from 'node:path'
import * as esbuild from 'esbuild'
import { installDomShim, decodePng, encodePng } from './canvas-shim.mjs'

const ROOT = 'D:/工作区/pale-notes-web'
const QUIET = process.argv.includes('--quiet')
const out = path.join(ROOT, '.check', 'render-audit.mjs')

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

// ── 收集全部角色卡 ──
const chars = []
for (const w of M.BUILTIN_WORLDS) {
  for (const c of (w.characters || [])) {
    chars.push({ world: w.title || w.id, id: c.id, name: c.name, card: c })
  }
}
console.log(`\n=== 全量立绘审计 ===`)
console.log(`  内置世界 ${M.BUILTIN_WORLDS.length} 个，角色卡 ${chars.length} 张\n`)

/**
 * 可机检的矛盾规则。
 * 只写"客观打脸"的，不写审美判断 ——
 * 审美必须靠下面的对照图人工看。
 */
function contradictions(traits, recipe) {
  const bad = []
  const has = re => recipe.parts.some(p => re.test(p))

  // 1. 推断为女性，却选了 male 头（且没有 female 头）
  if (traits.gender === 'female') {
    if (has(/heads_human_male|heads_human_.*_male/) && !has(/heads_human_female/)) {
      bad.push('推断为女性，却用了男性头部部件')
    }
    // 女性不该长胡子
    if (has(/beards_/)) bad.push('推断为女性，却配了胡须')
  }
  // 2. 推断为男性，却只有 female 头
  if (traits.gender === 'male') {
    if (has(/heads_human_female|heads_human_.*_female/) && !has(/heads_human_male/)) {
      bad.push('推断为男性，却用了女性头部部件')
    }
  }
  // 3. 推断为 child/young，却拿了 elderly 头
  if (traits.age === 'child' || traits.age === 'young') {
    if (has(/elderly/)) bad.push(`推断为${traits.age}，却用了老年头部部件`)
  }
  // 4. 推断为 elder，却拿了 _small（幼儿）头
  if (traits.age === 'elder') {
    if (has(/heads_human_.*_small/)) bad.push('推断为老者，却用了幼童头部部件')
  }
  // 5. 没推断出胡须却配了胡子 —— 不算错（可能是刻画），只统计
  return bad
}

const rows = []
let nBad = 0
for (const c of chars) {
  const profile = {
    name: c.card.name,
    description: c.card.description,
    personality: c.card.personality,
    scenario: c.card.scenario,
    relationship: c.card.relationship,
    age: c.card.age,
    gender: c.card.gender,
  }
  const traits = M.inferTraits(profile)
  const recipe = M.recipeForDiag(c.id, { profile, gender: c.card.gender })
  const bad = contradictions(traits, recipe)
  if (bad.length) nBad++
  rows.push({ ...c, traits, recipe, bad })
}

if (!QUIET) {
  console.log('角色逐条（只列有矛盾或推断字段偏少的）:')
  for (const r of rows) {
    const t = r.traits
    const got = ['gender', 'age', 'hairColor', 'cloth'].filter(k => t[k] !== undefined)
    if (!r.bad.length && got.length >= 2) continue
    console.log(`\n  【${r.name}】(${r.world})`)
    console.log(`     ${(r.card.description || '').slice(0, 70)}`)
    console.log(`     推断: gender=${t.gender ?? '-'} age=${t.age ?? '-'} hair=${t.hairColor ?? '-'} cloth=${t.cloth ?? '-'} role=${t.role ? t.role.length + '项' : '-'}`)
    if (r.bad.length) for (const b of r.bad) console.log(`     ✗ ${b}`)
  }
}

// ── 推断覆盖率（词表缺口的客观指标）──
const cov = { gender: 0, age: 0, hairColor: 0, hairStyle: 0, cloth: 0, skin: 0, role: 0, headwear: 0 }
for (const r of rows) {
  for (const k of Object.keys(cov)) if (r.traits[k] !== undefined) cov[k]++
}
console.log(`\n=== 推断覆盖率（${rows.length} 张角色卡）===`)
for (const [k, v] of Object.entries(cov)) {
  const pct = Math.round(v / rows.length * 100)
  const bar = '█'.repeat(Math.round(pct / 5)).padEnd(20, '·')
  console.log(`  ${k.padEnd(10)} ${bar} ${String(pct).padStart(3)}%  (${v}/${rows.length})`)
}

console.log(`\n=== 机检矛盾 ===`)
console.log(`  ${nBad} / ${rows.length} 张角色卡存在"描述与部件打脸"`)
if (nBad) {
  const byKind = new Map()
  for (const r of rows) for (const b of r.bad) byKind.set(b, (byKind.get(b) || 0) + 1)
  for (const [k, v] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(v).padStart(3)} × ${k}`)
  }
}

// ── 对照图 ──
const cells = []
for (const r of rows) {
  const url = await M.spriteDataUrl(r.id, r.card.description || '', { scale: 3, ...{ gender: r.card.gender } })
  cells.push({ src: url })
}
const cols = 6
const cellW = 176, cellH = 176, gap = 5
const gridRows = Math.ceil(cells.length / cols)
const W = cols * cellW + (cols + 1) * gap
const H = gridRows * cellH + (gridRows + 1) * gap
const px = Buffer.alloc(W * H * 4)
for (let i = 0; i < W * H; i++) { px[i * 4] = 26; px[i * 4 + 1] = 26; px[i * 4 + 2] = 30; px[i * 4 + 3] = 255 }
cells.forEach((cell, i) => {
  const col = i % cols, row = Math.floor(i / cols)
  const ox = col * cellW + (col + 1) * gap + Math.floor((cellW - 192) / 2)
  const oy = row * cellH + (row + 1) * gap + Math.floor((cellH - 192) / 2)
  const { width, height, rgba } = decodePng(Buffer.from(cell.src.slice(cell.src.indexOf(',') + 1), 'base64'))
  const scale = Math.min(cellW / width, cellH / height)
  const dw = Math.round(width * scale), dh = Math.round(height * scale)
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const s = (Math.min(height - 1, Math.floor(y * height / dh)) * width + Math.min(width - 1, Math.floor(x * width / dw))) * 4
      const tx = ox + x, ty = oy + y
      if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue
      const d = (ty * W + tx) * 4
      const a = rgba[s + 3] / 255
      px[d] = Math.round(rgba[s] * a + px[d] * (1 - a))
      px[d + 1] = Math.round(rgba[s + 1] * a + px[d + 1] * (1 - a))
      px[d + 2] = Math.round(rgba[s + 2] * a + px[d + 2] * (1 - a))
      px[d + 3] = 255
    }
  }
})
const file = path.join(ROOT, 'playtest-shots', 'audit-builtin-chars.png')
fs.mkdirSync(path.dirname(file), { recursive: true })
fs.writeFileSync(file, encodePng(W, H, px))

console.log(`\n=== 对照图（${cols} 列）===`)
const listing = []
rows.forEach((r, i) => {
  const row = Math.floor(i / cols) + 1, col = (i % cols) + 1
  listing.push(`  ${String(row).padStart(2)}行${String(col).padStart(2)}列  ${r.name}（${r.world}）${r.bad.length ? '  ✗ ' + r.bad.join('；') : ''}`)
})
console.log(listing.join('\n'))
console.log(`\n  ✓ ${file}`)
console.log(`  引用：![审计](playtest-shots/audit-builtin-chars.png)\n`)
