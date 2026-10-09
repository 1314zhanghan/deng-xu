/**
 * 立绘一致性审计 —— `pnpm check:sprites`
 *
 * ## 为什么需要这个脚本
 *
 * 2026-10 玩家反馈：「人物立绘与描述的匹配程度仍然堪忧，**仅仅只是靠关键词来
 * 临时构筑人物立绘的错误率高到不必多说**」。
 *
 * 根因是方法论：原先走「中文描述 →291 个正则抽特征 → 从部件池里挑部件」两步猜测，
 * 而中文表述空间无穷、正则表有限，**错误率天生下不来**。
 *
 * 修法是让角色卡直接写**部件级**的外观（`CharacterCard.look` / `PlayerCard.look`），
 * 推断退化为兜底。但显式数据带来一个新风险：**写错的部件 id 不会报错，只会被静默忽略**，
 * 于是"我明明写了束发，怎么画出来是爆炸头"这类问题会重新出现 —— 只是更难查。
 *
 * 所以这个脚本专门盯住那类**静默失效**：
 *
 *  1. `look` 里的**部件 id 是否真实存在**（对着 runtime.json 的 246 个部件查）
 *  2. **颜色键是否真实存在**（对着 palettes.json 查）
 *  3. **`look` 与 `note` 是否自相矛盾** —— 例如 note 写"女子"而 head 填了 male、
 *     note 写"光头"却填了发型、note 写"胡须"却把 beard 写成空串
 *  4. **覆盖率** —— 哪些角色还没写 `look`（那些仍走关键词猜测，是"匹配度差"的高发区）
 *
 * 用法：
 *   node scripts/check-sprites.mjs            # 全部世界
 *   node scripts/check-sprites.mjs --json     # 机器可读
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const asJson = process.argv.includes('--json')

/*
  ── 自己打包世界数据 ──
  这个脚本要在 CI 里独立跑，不能指望"别人先跑过 check:worlds"。
  ⚠️ `stdio: 'ignore'` 是必须的：在受限环境里用管道捕获 esbuild 输出会 EPERM
  （命名管道被禁），症状是 esbuild 明明能跑却报错 —— 这个坑项目里踩过（见 check-worlds.mjs 的注释）。
*/
const BUNDLE = path.join(root, '.check', 'worlds-check.mjs')
{
  const esbuild = path.join(root, 'node_modules', 'esbuild', 'bin', 'esbuild')
  const r = spawnSync(process.execPath, [
    esbuild, 'src/data/builtinWorlds.ts',
    '--bundle', '--platform=node', '--format=esm',
    `--outfile=${path.relative(root, BUNDLE)}`,
    '--alias:@=./src', '--log-level=error',
  ], { cwd: root, stdio: 'ignore' })
  if (r.status !== 0 || !fs.existsSync(BUNDLE)) {
    console.error('esbuild 打包失败 —— 世界数据可能有语法错误。请先跑 `pnpm typecheck`。')
    process.exit(1)
  }
}

// ── 载入素材目录（部件池 + 调色板）──
const runtime = JSON.parse(fs.readFileSync(path.join(root, 'src/assets/lpc/runtime.json'), 'utf8'))
const PARTS = runtime.parts || runtime.default?.parts || []
const PART_IDS = new Set(PARTS.map(p => p.id))
const PART_KIND = new Map(PARTS.map(p => [p.id, p.kind]))

const palettes = JSON.parse(fs.readFileSync(path.join(root, 'src/assets/lpc/palettes.json'), 'utf8')).palettes
const COLOR_KEYS = Object.fromEntries(
  Object.entries(palettes).map(([mat, map]) => [mat, new Set(Object.keys(map))]),
)

/** `look` 的每个字段应当指向哪一类部件（用于查"头发字段填了裤子 id"这种错） */
const FIELD_KIND = {
  head: 'head',
  hair: 'hair',
  torso: null,          // 上装可以是 clothes / armour / apron
  legs: 'legs',
  feet: 'shoes',
  hat: 'hat',
  beard: 'beard',
  cape: 'cape',
  arms: 'arms',
  brows: 'eyebrows',
  nose: 'nose',
  belt: null,           // accessory（belt_*）
}
/** 颜色字段 → 材质 */
const FIELD_MATERIAL = { skin: 'body', hairColor: 'hair', clothColor: 'cloth', eye: 'eye' }

const problems = []
const warnings = []

function checkLook(worldTitle, who, look) {
  const at = `${worldTitle} ／ ${who}`
  for (const [field, value] of Object.entries(look)) {
    if (field === 'note' || value === undefined || value === null) continue

    // ① 颜色字段
    if (FIELD_MATERIAL[field]) {
      const mat = FIELD_MATERIAL[field]
      if (value === '') continue
      if (!COLOR_KEYS[mat]?.has(value)) {
        problems.push(`${at} ｜ ${field}="${value}" 不是 ${mat} 调色板里的键（见 .check/LPC-PARTS.md）`)
      }
      continue
    }

    // ② 部件字段
    if (!(field in FIELD_KIND)) {
      warnings.push(`${at} ｜ look 里有未知字段 "${field}" —— 它不会生效（是不是想写别的名字？）`)
      continue
    }
    if (value === '') continue          // 空串是"明确不要这件"，合法
    if (!PART_IDS.has(value)) {
      problems.push(`${at} ｜ ${field}="${value}" 这个部件不存在（写错的 id 会被静默忽略）`)
      continue
    }
    // ③ 字段与部件类别是否对得上
    const want = FIELD_KIND[field]
    const kind = PART_KIND.get(value)
    if (want && kind !== want) {
      problems.push(`${at} ｜ ${field}="${value}" 是 ${kind} 类部件，但这个字段要的是 ${want}`)
    }
    if (field === 'torso' && !['clothes', 'armour', 'apron', 'legs'].includes(kind)) {
      problems.push(`${at} ｜ torso="${value}" 是 ${kind}，不能当上装`)
    }
    if (field === 'belt' && !/^belt_/.test(value)) {
      warnings.push(`${at} ｜ belt="${value}" 看着不像腰带（部件池里的腰带都是 belt_*）`)
    }
  }

  // ④ look 与 note 的自相矛盾 —— 这是"描述与立绘对不上"在**数据层**的残留
  const note = String(look.note || '')
  if (note) {
    const headKind = look.head ? PART_KIND.get(look.head) : undefined
    const headIsFemale = /female/.test(String(look.head))
    const headIsElder = /elder/.test(String(look.head))
    if (/女子|女性|妇人|姑娘|少女|女人|女士/.test(note) && look.head && !headIsFemale) {
      problems.push(`${at} ｜ note 写"${note}"，但 head="${look.head}" 不是女性头部 —— 立绘会画成男的`)
    }
    if (/男子|男性|男人|汉子|青年|少年/.test(note) && headIsFemale) {
      problems.push(`${at} ｜ note 写"${note}"，但 head="${look.head}" 是女性头部`)
    }
    if (/老|年迈|花甲|白发|苍老/.test(note) && look.head && !headIsElder) {
      warnings.push(`${at} ｜ note 提到年老，但 head="${look.head}" 不是 _elderly 变体`)
    }
    if (/光头|秃/.test(note) && look.hair && !/bald|shaved/i.test(look.hair)) {
      problems.push(`${at} ｜ note 写"${note}"，但 hair="${look.hair}" 不是光头/秃顶件`)
    }
    if (/胡须|胡子|髯|络腮/.test(note) && look.beard === '') {
      problems.push(`${at} ｜ note 写有胡须，但 beard 是空串（明确不要胡子）`)
    }
    if (/无胡|没有胡|净面|不留胡/.test(note) && look.beard && look.beard !== '') {
      warnings.push(`${at} ｜ note 说没胡子，但 beard="${look.beard}"`)
    }
  }
}

// ── 载入内置世界（上面已经打好包）──
const { BUILTIN_WORLDS } = await import('file://' + BUNDLE.replace(/\\/g, '/'))

const coverage = []
for (const w of BUILTIN_WORLDS) {
  const chars = w.characters || []
  let withLook = 0
  for (const c of chars) {
    if (c.look) { withLook++; checkLook(w.title, c.name, c.look) }
    else warnings.push(`${w.title} ／ ${c.name} 没有 look —— 仍走关键词猜测（匹配度最不稳的那条路）`)
  }
  coverage.push({ world: w.title, chars: chars.length, withLook })
}
if (BUILTIN_WORLDS[0]?.story && BUILTIN_WORLDS[0].story.__playerLook) {
  checkLook('(玩家)', 'player', BUILTIN_WORLDS[0].story.__playerLook)
}

if (asJson) {
  console.log(JSON.stringify({ coverage, problems, warnings }, null, 2))
} else {
  console.log('\n=== 立绘一致性审计（check:sprites）===\n')
  console.log('  世界                        角色   已写 look   覆盖率')
  for (const c of coverage) {
    const pct = c.chars ? Math.round((c.withLook / c.chars) * 100) : 0
    const mark = c.withLook === c.chars ? '✓' : '·'
    console.log(`  ${mark} ${c.world.padEnd(22)} ${String(c.chars).padStart(4)} ${String(c.withLook).padStart(9)}   ${String(pct).padStart(3)}%`)
  }
  const total = coverage.reduce((n, c) => n + c.chars, 0)
  const done = coverage.reduce((n, c) => n + c.withLook, 0)
  console.log(`\n  合计：${done}/${total} 张卡写了结构化外观`)
  console.log(`  部件池 ${PART_IDS.size} 件；调色板 ${Object.entries(COLOR_KEYS).map(([k, v]) => `${k}=${v.size}`).join(' ')}`)
}

if (problems.length) {
  console.log(`\n=== ✗ 硬错误 ${problems.length} 项（这些会让立绘画错或静默忽略）===`)
  for (const p of problems.slice(0, 40)) console.log('  ' + p)
  if (problems.length > 40) console.log(`  …另有 ${problems.length - 40} 项`)
}
if (warnings.length) {
  console.log(`\n=== ⚠ 提示 ${warnings.length} 项（不一定是错，但值得看一眼）===`)
  for (const w of warnings.slice(0, 20)) console.log('  ' + w)
  if (warnings.length > 20) console.log(`  …另有 ${warnings.length - 20} 项`)
}

if (!problems.length && !warnings.length) console.log('\n✓ 全部通过\n')
process.exit(problems.length ? 1 : 0)
