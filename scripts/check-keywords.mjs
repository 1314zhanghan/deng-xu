/**
 * 关键词 / 资源全量校验器 —— 专治「静默失效」。
 *
 * ## 为什么需要它
 *
 * `appearance.ts` 的 `ROLES` / `HEADWEAR` / `HAIR_STYLES` 里写的是
 * **部件 id 片段**。写错一个片段的代价是：
 *
 *   · 不报错、不抛异常、编译通过、测试通过
 *   · 只是匹配不到任何部件 → 退化成**随机**
 *
 * 结果就是「铁匠穿工装裤」「管家戴野蛮人头盔」「秃头管家」这类
 * 说不上哪里错、但一眼就不对的立绘。ROADMAP 第 3、48、51 项反复在修它，
 * 每次靠人肉发现。根治办法只有一个：**拿真实资源反查每一个片段**。
 *
 * ## 严重性分级（很重要，不这么分就会淹死在噪音里）
 *
 * 本项目的关键机制：`lpcSprite.ts` 的 `pickByKeywords` 会**遍历**候选片段，
 * 跳过匹配不到的那个、继续试下一个。所以一个死片段的影响取决于它身后
 * 还有没有替补（这部分是读源码确认的，不是猜的）：
 *
 *   · **缺陷（defect）** —— 整条规则一个片段都匹配不到，或片段是该关键词的
 *     **唯一**候选。这时关键词命中后照样拿不到部件，只能退化成随机：
 *     玩家写了「莫西干头」，立绘却是随机发型。
 *   · **噪音（warning）** —— 前面还有能匹配的候选，所以**行为是对的**，
 *     只是这条死片段永远轮不到、白白误导后来人（例如
 *     `['topknot','bun','updo']` 里后两个库里根本没有）。
 *   · **已知缺口（gap）** —— 空数组 `[]`。这是**有意为之**：
 *     `HEADWEAR` 里「眼镜/面具」的条目就是空的，因为上游素材确实没有，
 *     留空是为了让 `evidence` 仍记录「作者写了单片眼镜」。
 *     这不是 bug，脚本只把它列出来，不计入失败。
 *
 * ## 校验项
 *
 *   1. 部件片段存在性（ROLES / HEADWEAR / HAIR_STYLES）
 *   2. 调色板名可解析性：每个色名经 `resolvePaletteName` 必须能落到
 *      真实存在的调色板颜色上（`grey` → `gray` 这类走 ALIASES 也算通过）
 *   3. 有序表顺序违例：泛化色名排在具体色名之前（ROADMAP 第 44 项规则）
 *
 * ## 用法
 *
 *   node scripts/check-keywords.mjs            # 全量校验
 *   node scripts/check-keywords.mjs --json     # 机器可读
 *   node scripts/check-keywords.mjs --strict   # 把噪音也算作失败
 *
 * 退出码：0 = 无缺陷，1 = 有缺陷（或 --strict 下有噪音）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '..')
const AS_JSON = process.argv.includes('--json')
const STRICT = process.argv.includes('--strict')

// ── 1) 打包 appearance.ts 供 Node 使用 ──
// 直接让 Node 剥类型不行：源码用了 `@/` 别名，Node 不知道它指向哪。
const BUNDLE = path.join(ROOT, '.check', 'appearance.mjs')
fs.mkdirSync(path.dirname(BUNDLE), { recursive: true })

const build = spawnSync(process.execPath, [
  path.join(ROOT, 'node_modules', 'esbuild', 'bin', 'esbuild'),
  'src/utils/appearance.ts',
  '--bundle', '--platform=node', '--format=esm',
  `--outfile=${BUNDLE}`,
  '--alias:@=./src',
  '--log-level=error',
], { cwd: ROOT, encoding: 'utf8' })

if (build.status !== 0) {
  console.error('✗ esbuild 打包 appearance.ts 失败：')
  console.error(build.stderr || build.stdout)
  process.exit(1)
}

const mod = await import('file://' + BUNDLE.replace(/\\/g, '/'))
const T = mod.__tablesForValidation
if (!T) {
  console.error('✗ appearance.ts 没有导出 __tablesForValidation —— 校验器无法工作。')
  process.exit(1)
}
const { resolvePaletteName } = mod

// ── 2) 读真实资源 ──
const runtime = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/assets/lpc/runtime.json'), 'utf8'))
const palettesFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/assets/lpc/palettes.json'), 'utf8'))
const PART_IDS = runtime.parts.map(p => p.id)

/**
 * ⚠️ palettes.json 的形状是 `{ palettes: { hair: {...}, body: {...} }, partRamps: {...} }`。
 * 第一版我直接遍历顶层，于是把 `palettes` / `partRamps` / `note` 当成了颜色名，
 * 而真正的 `hair` / `body` 一个都没收集到 —— 校验器把 `grey` 这些
 * **其实能正常解析**的色名报成"不存在"。**校验器自己写错会制造假缺陷。**
 */
const PALETTE_BY_MATERIAL = palettesFile.palettes
const PALETTE_NAMES = new Set()
for (const m of Object.values(PALETTE_BY_MATERIAL)) {
  if (m && typeof m === 'object') for (const k of Object.keys(m)) PALETTE_NAMES.add(k)
}

/** 片段 → 真实部件（匹配规则与 pickByKeywords 一致：id 包含该片段，忽略大小写） */
const fragHits = frag => PART_IDS.filter(id => id.toLowerCase().includes(frag.toLowerCase()))

const defects = []
const warnings = []
const gaps = []

const defect = (kind, where, detail) => defects.push({ kind, where, detail })
const warn = (kind, where, detail) => warnings.push({ kind, where, detail })

// ── 3.1 ROLES / HEADWEAR / HAIR_STYLES 的片段存在性 ──
function auditFragmentRule(tableName, re, frags, kindHint) {
  if (!Array.isArray(frags)) return
  if (frags.length === 0) {
    gaps.push({ table: tableName, pattern: re.source, kind: kindHint })
    return
  }
  const alive = frags.filter(f => fragHits(f).length > 0)
  const dead = frags.filter(f => fragHits(f).length === 0)

  if (!alive.length) {
    defect(kindHint, `${tableName} /${re.source}/`,
      `全部片段都匹配不到真实部件（${frags.join(', ')}）—— 命中这个关键词后只会退化成随机`)
    return
  }
  for (const d of dead) {
    warn('死片段（有替补，行为仍正确）', `${tableName} /${re.source}/`,
      `"${d}" 匹配不到任何部件；因为还有 ${alive.join('/')} 兜着，行为不受影响，但建议删掉以免误导`)
  }
}

for (const [tableName, table, kindHint] of [
  ['ROLES', T.ROLES, '身份 → 衣着'],
  ['HEADWEAR', T.HEADWEAR, '头饰'],
  ['HAIR_STYLES', T.HAIR_STYLES, '发型'],
]) {
  for (const [re, frags] of table) auditFragmentRule(tableName, re, frags, kindHint)
}

// ── 3.2 调色板名必须能解析到真实颜色 ──
const ALL_PALETTE_NAMES = [...PALETTE_NAMES]
for (const [tableName, table] of [
  ['HAIR_COLORS', T.HAIR_COLORS],
  ['SKINS', T.SKINS],
  ['CLOTH_COLORS', T.CLOTH_COLORS],
]) {
  for (const [re, color] of table) {
    if (typeof color !== 'string') continue
    if (/[\\^$*+?()[\]{}|]/.test(color)) continue      // 正则源，跳过
    // 用真实调色板名集合去解析 —— 这就是运行时会走的路径
    const resolved = resolvePaletteName(color, ALL_PALETTE_NAMES)
    if (!resolved) {
      defect('色名无法解析', `${tableName} /${re.source}/`,
        `"${color}" 既不在调色板里、也走不通 ALIASES → 换色静默失效，退化成随机`)
    } else if (resolved !== color && !PALETTE_NAMES.has(color)) {
      warn('色名靠别名兜底', `${tableName} /${re.source}/`, `"${color}" 不在调色板里，靠别名落到 "${resolved}"`)
    }
  }
}

// ── 3.3 有序表顺序违例（ROADMAP 第 44 项）──
const GENERIC_HEADS = ['金', '银', '棕', '红', '蓝', '绿', '黑', '白', '灰', '紫', '橙', '粉', '黄']
for (const tableName of ['HAIR_COLORS', 'CLOTH_COLORS']) {
  const table = T[tableName]
  table.forEach(([re, color], i) => {
    if (typeof color !== 'string') return
    const head = GENERIC_HEADS.find(h => color.startsWith(h))
    if (!head || color === head) return
    for (let j = 0; j < i; j++) {
      const [preRe, preColor] = table[j]
      if (preColor === head) {
        defect('有序表顺序违例', `${tableName} 第 ${j + 1} 条 vs 第 ${i + 1} 条`,
          `泛化名 "${head}"（${preRe.source}）排在具体名 "${color}"（${re.source}）之前 —— 具体名永远抢不到`)
      }
    }
  })
}

// ── 4) 输出 ──
const summary = {
  parts: PART_IDS.length,
  paletteNames: PALETTE_NAMES.size,
  tables: {
    HAIR_COLORS: T.HAIR_COLORS.length, HAIR_STYLES: T.HAIR_STYLES.length,
    SKINS: T.SKINS.length, CLOTH_COLORS: T.CLOTH_COLORS.length,
    AGES: T.AGES.length, BUILDS: T.BUILDS.length,
    ROLES: T.ROLES.length, HEADWEAR: T.HEADWEAR.length,
  },
  defects, warnings, gaps,
}

if (AS_JSON) {
  console.log(JSON.stringify(summary, null, 2))
  process.exit(defects.length ? 1 : 0)
}

console.log(`\n=== 关键词 / 资源全量校验 ===\n`)
console.log(`  真实部件：${PART_IDS.length} 个`)
console.log(`  调色板颜色名：${PALETTE_NAMES.size} 个`)
console.log(`  词表：ROLES ${T.ROLES.length} / HEADWEAR ${T.HEADWEAR.length} / HAIR_STYLES ${T.HAIR_STYLES.length}`
  + ` / HAIR_COLORS ${T.HAIR_COLORS.length} / CLOTH_COLORS ${T.CLOTH_COLORS.length} / SKINS ${T.SKINS.length}`)

if (defects.length) {
  const byKind = new Map()
  for (const p of defects) {
    if (!byKind.has(p.kind)) byKind.set(p.kind, [])
    byKind.get(p.kind).push(p)
  }
  console.log('')
  for (const [kind, list] of byKind) {
    console.log(`  ✗ ${kind}（${list.length} 处）`)
    for (const p of list) console.log(`      ${p.where}\n          ${p.detail}`)
  }
}

if (warnings.length) {
  console.log(`\n  ⚠ 噪音 ${warnings.length} 处（行为正确，但建议清理）：`)
  for (const p of warnings) console.log(`      ${p.where}\n          ${p.detail}`)
}

if (gaps.length) {
  console.log(`\n  ○ 已知缺口 ${gaps.length} 处（**有意留空**，上游没有这类素材，不计入失败）：`)
  for (const g of gaps) console.log(`      ${g.table} /${g.pattern}/   （${g.kind}）`)
}

if (!defects.length && !warnings.length && !gaps.length) {
  console.log('\n  ✓ 没有任何"指向不存在资源"的关键词\n')
} else {
  console.log(`\n  缺陷 ${defects.length} / 噪音 ${warnings.length} / 已知缺口 ${gaps.length}\n`)
}

process.exit(defects.length || (STRICT && warnings.length) ? 1 : 0)
