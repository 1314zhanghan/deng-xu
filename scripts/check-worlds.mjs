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
  /* ── 沙盒改造（2026-10）追加的门槛 ── */
  // 长期目标必须是"若干宏大宽泛的可选项"，不是一句话任务书
  mainQuestCjk: 700,
  // 明确写出"这是沙盒"的规则块必须存在
  sandboxRuleCjk: 300,
  // 地理/势力/生活三类内容必须**都**在 worldLore 里真的写到一定篇幅
  geoCjk: 3000,
  factionCjk: 3000,
  lifeCjk: 3000,
  charDescCjk: 80,
  minChars: 6,
  minPresent: 3,
  minItems: 15,
  minLores: 8,
  minBackgroundSlots: 2,
  minOptionsPerSlot: 3,
}

/**
 * 沙盒内容的识别正则。
 *
 * ⚠️ 判据只能看**章节标题**，不能去正文里全文搜关键词 ——
 * 正文里出现"地图"两个字不代表真的写了地图（很可能是"没有地图"）。
 * 所以这里匹配 `**...**` 形式的标题，要求标题本身点明该主题。
 */
const SANDBOX_SECTIONS = {
  geo: /舆图|地图|地理|疆域|行旅|层志|区域|方位|交通|路线|坊市|城内|街/,
  faction: /势力|派系|党争|阵营|家族|行会|地盘|控制|藩镇|部族|范围/,
  life: /日常|生活|物价|饮食|市井|民生|作息|婚|娱乐|闲暇|风俗|语言|称谓/,
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

  /*
    ②.5 沙盒要求（2026-10 用户反馈："要像等待探索的沙盒，不要太拘泥于详细目标"）
    这三项都是"声称做了"和"真的做了"很容易混淆的地方，所以逐项量化：
      · 地理 / 势力 / 生活 三类内容必须各有**足够篇幅**（按命中标题下的正文算）
      · 长期目标必须是"若干宽泛选项"（字数下限），而不是一句话任务书
      · rules 里必须有明确的"这是沙盒"条款
  */
  {
    /*
      ⚠️ 只把**行首的** `**第X章 标题**` 当成章节标题。
      第一版我按"任意成对星号"切段 —— 于是正文里任何
      **加粗强调**都会被当成一个"标题"，章节索引整体错位，
      统计出来的三类内容字数全是错的（地理 260 / 势力 210 / 生活 340）。
      作者为了迁就这个 bug，被迫把 worldLore 正文里的加粗**全部删掉** ——
      **校验器的缺陷反过来破坏了内容质量**，这是最不该发生的一类问题。
      现在改成逐行扫描、只认行首的章节标题。
    */
    const lines = String(w.worldLore).split('\n')
    const HEAD_RE = /^\s*\*\*(.+?)\*\*\s*$/
    /** 收集所有 (标题, 标题下正文) 段 */
    const segs = []
    let cur = null
    for (const ln of lines) {
      const m = ln.match(HEAD_RE)
      if (m) {
        cur = { title: m[1], body: [] }
        segs.push(cur)
      } else if (cur) {
        cur.body.push(ln)
      }
    }
    const sectionCjk = (re) => {
      let n = 0, hits = 0
      for (const s of segs) {
        if (!re.test(s.title)) continue
        hits++
        n += cjk(s.body.join('\n'))
      }
      return { n, hits }
    }
    const geo = sectionCjk(SANDBOX_SECTIONS.geo)
    const fac = sectionCjk(SANDBOX_SECTIONS.faction)
    const life = sectionCjk(SANDBOX_SECTIONS.life)
    row.geo = geo.n; row.faction = fac.n; row.life = life.n; row.sections = segs.length
    if (geo.n < GATE.geoCjk) fail(exp.label, '地理/地图内容不足', `命中标题下共 ${geo.n} 字（${geo.hits} 节）< ${GATE.geoCjk}`)
    if (fac.n < GATE.factionCjk) fail(exp.label, '势力范围内容不足', `命中标题下共 ${fac.n} 字（${fac.hits} 节）< ${GATE.factionCjk}`)
    if (life.n < GATE.lifeCjk) fail(exp.label, '生活气息内容不足', `命中标题下共 ${life.n} 字（${life.hits} 节）< ${GATE.lifeCjk}`)

    const mqCjk = cjk(w.story?.mainQuest)
    row.mqCjk = mqCjk
    if (mqCjk < GATE.mainQuestCjk) {
      fail(exp.label, '长期目标太窄', `mainQuest ${mqCjk} 字 < ${GATE.mainQuestCjk}（沙盒里应是"几个宽泛的可选方向"）`)
    }
    // 目标里不该出现硬期限/命令式措辞
    const mq = String(w.story?.mainQuest || '')
    for (const bad of [/硬期限/, /\d+\s*天[内之]/, /必须完成/, /任务书/]) {
      if (bad.test(mq)) fail(exp.label, '长期目标写得像任务书', `匹配到 ${bad}`)
    }

    // rules 里必须有一**条**明确的沙盒定性（这是让 AI 不把沙盒玩成单线的关键约束）。
    // 不能只搜关键词 —— "探索"这种词本来就会散落在别处，那样等于没检查。
    // 所以要求：某一条（按编号/换行切分）同时提到"沙盒/可选/不是任务"这类定性
    // 与"不要催/没有必须"这类行为约束，且有一定长度。
    const ruleBlocks = String(w.rules || '')
      .split(/\n(?=\s*(?:\d+[.、]|[一二三四五六七八九十]+[、.]))/)
      .map(s => s.trim())
    const sandboxClause = ruleBlocks.find(b =>
      /沙盒|不是任务|可选/.test(b) && /不要催|没有必须|不必|不要强行|自由/.test(b) && cjk(b) >= GATE.sandboxRuleCjk
    )
    if (!sandboxClause) {
      fail(exp.label, 'rules 缺少沙盒条款',
        `需要一条独立规则（≥${GATE.sandboxRuleCjk} 字）同时说明"这是沙盒/目标可选"与"不要催进度/没有必须做的事"`)
    } else {
      row.sandboxRule = cjk(sandboxClause)
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
console.log('  ' + '世界'.padEnd(30) + '中文字数'.padStart(9) + 'worldLore'.padStart(10)
  + 'rules'.padStart(7) + '角色'.padStart(5) + '物品'.padStart(5) + 'lore'.padStart(5))
for (const r of report) {
  const ok = r.cjkTotal >= GATE.worldCjk && r.loreCjk >= GATE.worldLoreCjk
  console.log('  ' + (ok ? '✓ ' : '✗ ') + r.title.padEnd(28)
    + String(r.cjkTotal).padStart(9) + String(r.loreCjk).padStart(10)
    + String(r.rulesCjk).padStart(7) + String(r.chars).padStart(5)
    + String(r.items).padStart(5) + String(r.lores).padStart(5))
}

console.log('\n  —— 沙盒内容（用户要求：地图 / 势力范围 / 生活气息 / 可选目标）——')
console.log('  ' + '世界'.padEnd(30) + '地理'.padStart(8) + '势力'.padStart(8)
  + '生活'.padStart(8) + '长期目标'.padStart(10) + '沙盒条款'.padStart(10))
for (const r of report) {
  const ok = (r.geo || 0) >= GATE.geoCjk && (r.faction || 0) >= GATE.factionCjk
    && (r.life || 0) >= GATE.lifeCjk && (r.mqCjk || 0) >= GATE.mainQuestCjk
  console.log('  ' + (ok ? '✓ ' : '✗ ') + r.title.padEnd(28)
    + String(r.geo ?? '-').padStart(8) + String(r.faction ?? '-').padStart(8)
    + String(r.life ?? '-').padStart(8) + String(r.mqCjk ?? '-').padStart(10)
    + String(r.sandboxRule ?? '缺失').padStart(10))
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
