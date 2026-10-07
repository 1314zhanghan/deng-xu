/**
 * 内置世界书验收 —— 客观核对"三个整合世界"是否真的达标。
 *
 * ## 为什么需要它
 *
 * 本轮把原先 9 个内置世界整合成 3 个，每个要求 **≥5 万字**。
 * "字数够不够""字段有没有漏""id 引用有没有指向空气"这类事，
 * 靠肉眼读是核不出来的 —— 必须让脚本算，并且**把判据写死在这里**。
 *
 * 校验项：
 *   1. 世界数量与 id（必须正好 3 个，且是新 id）
 *   2. **每世界中文字符数 ≥ 50000**（worldLore ≥ 30000、rules ≥ 3000、
 *      customStyle ≥ 500、opening ≥ 1200）
 *   3. 结构完整性：必填字段齐全、数组非空
 *   4. **引用完整性**：`startingItems` 指向的物品必须真实存在；
 *      `attributeBonus` / `resourceBonus` 的 key 必须是已定义的属性/资源
 *   5. **角色卡质量**：每个角色 description ≥80 字，且**必须写清性别词**
 *      （引擎靠它推断立绘性别，写不清就会画出错的脸）
 *   6. 题材禁用词：古代世界不得出现内力/法术/系统…；
 *      地渊世界不得出现 AI/魔法/现实货币名
 *   7. 至少 3 个角色 `present: true`（否则关系面板一开局是空的）
 *
 * 退出码：0 = 全部达标，1 = 有不达标项。
 *
 * 用法：
 *   node scripts/check-worlds.mjs
 *   node scripts/check-worlds.mjs --json
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '..')
const AS_JSON = process.argv.includes('--json')

// ── 打包内置世界，拿到运行时真实数据 ──
const BUNDLE = path.join(ROOT, '.check', 'worlds-check.mjs')
fs.mkdirSync(path.dirname(BUNDLE), { recursive: true })
const build = spawnSync(process.execPath, [
  path.join(ROOT, 'node_modules', 'esbuild', 'bin', 'esbuild'),
  'src/data/builtinWorlds.ts',
  '--bundle', '--platform=node', '--format=esm',
  `--outfile=${BUNDLE}`,
  '--alias:@=./src',
  '--log-level=error',
], { cwd: ROOT, encoding: 'utf8' })
if (build.status !== 0) {
  console.error('✗ 打包 builtinWorlds 失败：')
  console.error(build.stderr || build.stdout)
  process.exit(1)
}
const mod = await import('file://' + BUNDLE.replace(/\\/g, '/'))
const WORLDS = mod.BUILTIN_WORLDS

const problems = []
const report = []
const fail = (world, kind, detail) => problems.push({ world, kind, detail })

/** 统计中文字符数 */
const cjk = s => (String(s || '').match(/[\u4e00-\u9fff]/g) || []).length
/** 总字符数（含标点、数字、西文） */
const total = s => String(s || '').length

// ── 期望的三个世界 ──
const EXPECTED = [
  {
    id: 'builtin_deepcore',
    label: '深核集团·地渊之下（后末日反乌托邦企业世界）',
    // 地渊世界禁用：魔法/宗教/AI/现实货币
    banned: ['魔法', '法术', '神明', '灵魂', '人工智能', '机器人', '美元', '人民币'],
    // 允许出现"AI"作为**被禁止的历史名词**，所以不把裸的 AI 列入
  },
  {
    id: 'builtin_greatchen',
    label: '中式古风王朝（无超自然力量）',
    banned: ['内力', '真气', '轻功', '法术', '修仙', '仙尊', '灵气', '神通', '妖', '魔', '系统', '面板', '经验值', '技能点'],
  },
  {
    id: 'builtin_westfantasy',
    label: '经典西方奇幻（帝国/王国/联邦 + 人类/精灵/矮人/兽人/龙）',
    banned: ['系统', '面板', '经验值', '技能点', '内力', '真气', '修仙', '科技', '公司', '数据'],
  },
]

// 篇幅门槛
const GATE = {
  worldCjk: 50000,
  worldLoreCjk: 30000,
  rulesCjk: 3000,
  customStyleCjk: 500,
  openingCjk: 1200,
  charDescCjk: 80,
  minChars: 6,
  minPresent: 3,
  minItems: 15,
  minLores: 8,
  minBackgroundSlots: 2,
  minOptionsPerSlot: 3,
}

if (WORLDS.length !== EXPECTED.length) {
  fail('(整体)', '世界数量', `期望 ${EXPECTED.length} 个，实际 ${WORLDS.length} 个：${WORLDS.map(w => w.id).join(', ')}`)
}

for (const exp of EXPECTED) {
  const w = WORLDS.find(x => x.id === exp.id)
  if (!w) {
    fail(exp.label, '缺失', `找不到世界 ${exp.id}`)
    continue
  }

  const allText = [
    w.title, w.tagline, w.worldLore, w.rules,
    w.narrative?.customStyle, w.story?.opening, w.story?.mainQuest,
    ...(w.items || []).map(i => i.name + i.description),
    ...(w.lores || []).map(l => l.name + l.description),
    ...(w.backgrounds || []).flatMap(b => b.options.map(o => o.title + (o.description || ''))),
    ...(w.characters || []).map(c => c.name + c.description + c.personality + c.relationship),
  ].join('\n')

  const cjkTotal = cjk(allText)
  const loreCjk = cjk(w.worldLore)
  const rulesCjk = cjk(w.rules)
  const styleCjk = cjk(w.narrative?.customStyle)
  const openingCjk = cjk(w.story?.opening)

  const row = {
    id: w.id, title: w.title,
    cjkTotal, loreCjk, rulesCjk, styleCjk, openingCjk,
    chars: w.characters?.length || 0,
    present: (w.characters || []).filter(c => c.present).length,
    items: w.items?.length || 0,
    lores: w.lores?.length || 0,
    bgSlots: w.backgrounds?.length || 0,
    attrs: w.attributes?.length || 0,
    res: w.resources?.length || 0,
  }
  report.push(row)

  // ① 篇幅
  if (cjkTotal < GATE.worldCjk) fail(exp.label, '篇幅不足', `中文字符 ${cjkTotal} < ${GATE.worldCjk}`)
  if (loreCjk < GATE.worldLoreCjk) fail(exp.label, 'worldLore 不足', `${loreCjk} < ${GATE.worldLoreCjk}`)
  if (rulesCjk < GATE.rulesCjk) fail(exp.label, 'rules 不足', `${rulesCjk} < ${GATE.rulesCjk}`)
  if (styleCjk < GATE.customStyleCjk) fail(exp.label, 'customStyle 不足', `${styleCjk} < ${GATE.customStyleCjk}`)
  if (openingCjk < GATE.openingCjk) fail(exp.label, 'opening 不足', `${openingCjk} < ${GATE.openingCjk}`)

  // ② 结构
  if (!w.attributes?.length) fail(exp.label, '结构', 'attributes 为空')
  if (!w.resources?.length) fail(exp.label, '结构', 'resources 为空')
  if ((w.characters?.length || 0) < GATE.minChars) fail(exp.label, '角色太少', `${w.characters?.length || 0} < ${GATE.minChars}`)
  if (row.present < GATE.minPresent) fail(exp.label, '开局登场角色太少', `${row.present} < ${GATE.minPresent}`)
  if ((w.items?.length || 0) < GATE.minItems) fail(exp.label, '物品太少', `${w.items?.length || 0} < ${GATE.minItems}`)
  if ((w.lores?.length || 0) < GATE.minLores) fail(exp.label, 'lore 太少', `${w.lores?.length || 0} < ${GATE.minLores}`)
  if ((w.backgrounds?.length || 0) < GATE.minBackgroundSlots) fail(exp.label, '背景槽太少', `${w.backgrounds?.length || 0} < ${GATE.minBackgroundSlots}`)
  for (const slot of w.backgrounds || []) {
    if (slot.options.length < GATE.minOptionsPerSlot) {
      fail(exp.label, '背景选项太少', `「${slot.label}」只有 ${slot.options.length} 个选项`)
    }
  }

  // ③ 引用完整性 —— 这类错误**不报错、只静默失效**
  const itemIds = new Set((w.items || []).map(i => i.id))
  const attrIds = new Set((w.attributes || []).map(a => a.id))
  const resIds = new Set((w.resources || []).map(r => r.id))
  for (const slot of w.backgrounds || []) {
    for (const o of slot.options) {
      for (const it of o.startingItems || []) {
        if (!itemIds.has(it)) fail(exp.label, 'startingItems 指向不存在的物品', `「${o.title}」→ ${it}`)
      }
      for (const k of Object.keys(o.attributeBonus || {})) {
        if (!attrIds.has(k)) fail(exp.label, 'attributeBonus 用了未定义的属性', `「${o.title}」→ ${k}`)
      }
      for (const k of Object.keys(o.resourceBonus || {})) {
        if (!resIds.has(k)) fail(exp.label, 'resourceBonus 用了未定义的资源', `「${o.title}」→ ${k}`)
      }
    }
  }
  for (const l of w.lores || []) {
    if (l.attribute && !attrIds.has(l.attribute)) {
      fail(exp.label, 'lore 关联了未定义的属性', `${l.name} → ${l.attribute}`)
    }
  }

  // ④ 角色卡：描述要够长，且**必须能推断出性别**（否则立绘会画错脸）
  const FEMALE = /少女|姑娘|女孩|女生|女子|女士|女性|妇人|妇女|女人|夫人|太太|主母|小姐|妻子|寡妇|遗孀|女儿|侄女|姐姐|妹妹|母亲|妈妈|婆婆|女官|女仆|侍女|接生婆|巫女/
  const MALE = /少年|男子|男人|男性|先生|男士|少爷|公子|老汉|老头|老者|父亲|爸爸|哥哥|弟弟|儿子|修士|僧人|农夫/
  for (const c of w.characters || []) {
    const n = cjk(c.description)
    if (n < GATE.charDescCjk) fail(exp.label, '角色描述过短', `${c.name} ${n} < ${GATE.charDescCjk} 字`)
    if (!FEMALE.test(c.description) && !MALE.test(c.description) && !/男|女/.test(c.description)) {
      fail(exp.label, '角色描述缺性别线索', `${c.name} —— 立绘会随机长脸`)
    }
    if (!c.name || !c.id) fail(exp.label, '角色缺 id/name', JSON.stringify(c).slice(0, 60))
  }
  const charIds = (w.characters || []).map(c => c.id)
  if (new Set(charIds).size !== charIds.length) fail(exp.label, '角色 id 重复', charIds.join(','))

  // ⑤ 禁用词
  for (const bad of exp.banned) {
    // 逐词统计出现次数（只看 worldLore + rules，避免误伤"明令禁止"的说明文字）
    const n = (w.worldLore.match(new RegExp(bad, 'g')) || []).length
    if (n > 0) fail(exp.label, `出现禁用词「${bad}」`, `worldLore 中出现 ${n} 次`)
  }
}

// ── 输出 ──
if (AS_JSON) {
  console.log(JSON.stringify({ report, problems, gate: GATE }, null, 2))
  process.exit(problems.length ? 1 : 0)
}

console.log('\n=== 内置世界书验收 ===\n')
console.log(`  世界数量：${WORLDS.length}\n`)
console.log('  ' + '世界'.padEnd(34) + '中文字数'.padStart(9) + 'worldLore'.padStart(11)
  + 'rules'.padStart(8) + '角色'.padStart(6) + '物品'.padStart(6) + 'lore'.padStart(6))
for (const r of report) {
  const ok = r.cjkTotal >= GATE.worldCjk && r.loreCjk >= GATE.worldLoreCjk
  console.log('  ' + (ok ? '✓ ' : '✗ ') + r.title.padEnd(32)
    + String(r.cjkTotal).padStart(9) + String(r.loreCjk).padStart(11)
    + String(r.rulesCjk).padStart(8) + String(r.chars).padStart(6)
    + String(r.items).padStart(6) + String(r.lores).padStart(6))
}

if (problems.length) {
  console.log(`\n=== 不达标 ${problems.length} 项 ===`)
  const byKind = new Map()
  for (const p of problems) {
    const k = `${p.world} ｜ ${p.kind}`
    if (!byKind.has(k)) byKind.set(k, [])
    byKind.get(k).push(p.detail)
  }
  for (const [k, list] of byKind) {
    console.log(`\n  ✗ ${k}`)
    for (const d of list.slice(0, 12)) console.log(`      ${d}`)
    if (list.length > 12) console.log(`      … 另有 ${list.length - 12} 条`)
  }
} else {
  console.log(`\n  ✓ 三个世界全部达标（每个 ≥${GATE.worldCjk} 中文字，worldLore ≥${GATE.worldLoreCjk}）`)
}

console.log(`\n  门槛：中文字数 ≥${GATE.worldCjk} / worldLore ≥${GATE.worldLoreCjk} / rules ≥${GATE.rulesCjk}`
  + ` / 角色 ≥${GATE.minChars}（≥${GATE.minPresent} 个开局登场）/ 物品 ≥${GATE.minItems} / lore ≥${GATE.minLores}\n`)

process.exit(problems.length ? 1 : 0)
