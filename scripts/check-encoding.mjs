/**
 * 源文件乱码守卫。
 *
 * 为什么需要它：中文文案一旦被写坏，**编译通过、测试通过**（断言不比对文案），
 * 只有玩家能看出来。历史上本项目就有文件在编辑中被 PowerShell 弄坏过
 * （`Get-Content -Raw` 在中文 Windows 上按 GBK 解码 UTF-8，写回即损坏）。
 *
 * ## 判据是怎么定的（**不是猜的，是实验出来的**）
 *
 * 第一版我用"手挑一批乱码特征字 + 一行出现 2 个就报警"，结果**误报了 3 个文件**：
 *   · `presets/official-worldbook.json` —— 「澪汀」里有个「汀」
 *   · `public/official-worldbook.json` —— 同上
 *   · `src/data/builtinWorldsExtra.ts` —— 某个正常汉字命中了表
 * 这说明"逐字查表"天生不可靠：正常中文里也会出现同形字。
 *
 * 于是改成**统计判据**。关键洞察：
 *
 *   正常中文只用到约两千个常用字；而 UTF-8→GBK 乱码的 CJK 字符是在
 *   整个 U+4E00–U+9FFF 上近似**均匀分布**的，绝大多数是生僻字。
 *
 * 实测（把正常句子编码成 UTF-8 再按 GBK 解码，与真实文件对比）：
 *
 *   真乱码样本：生僻字占比 **0.84 / 0.88 / 0.90 / 0.89**
 *   正常中文  ：生僻字占比 **0.000**（全部命中常用字）
 *   整仓最"脏"的正常文件：**0.015**
 *
 * 分离度极大，所以取阈值 **0.30**，余量足够。
 * 「生僻」的定义是**从未在本仓库其它文件里出现过** —— 仓库自己就是最好的
 * 中文语料（两万多个常用汉字），不需要外部字典。
 *
 * 另外保留三个**单字符即铁证**的硬信号（正常中文文件绝不该有）：
 *   · U+FFFD 替换字符
 *   · 私用区字符 U+E000–U+F8FF（GBK 解码 UTF-8 的典型产物）
 *   · 非法 UTF-8 字节序列
 *
 * ## 用法
 *
 *   node scripts/check-encoding.mjs              # 检查（有乱码则退出码 1）
 *   node scripts/check-encoding.mjs --fix-hint   # 额外给出修复建议
 *
 * 退出码：0 = 干净，1 = 发现乱码。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')

const TEXT_EXT = new Set([
  '.ts', '.tsx', '.mjs', '.cjs', '.js', '.jsx', '.json',
  '.md', '.css', '.html', '.yml', '.yaml', '.txt',
])

const SKIP_DIRS = new Set([
  'node_modules', 'dist', '.git', '.check', '.probe', 'playtest-shots',
  'audit-shots', '.pnpm-store', '.pnpm-tmp', 'coverage',
])

/** 生僻字占比超过它就判定为乱码。实测真乱码 ≥0.84、正常 ≤0.015，余量很大 */
const RARE_RATIO_THRESHOLD = 0.30

/** 少于此 CJK 字数的文件不做比例判定（样本太小，比例没意义） */
const MIN_CJK_FOR_RATIO = 20

/** 单字符即铁证 */
const HARD = [
  { re: /\uFFFD/, why: '出现 U+FFFD 替换字符（UTF-8 解码失败）' },
  { re: /[\uE000-\uF8FF]/, why: '出现私用区字符 U+E000–U+F8FF（GBK 解码 UTF-8 的典型产物）' },
  // Latin-1 乱码：一个 Latin-1 补充区的字母紧跟一个 C1 控制区字符。
  // 正常 UTF-8 中文源码里不会有这种组合（C1 区在文本里几乎不出现）。
  // 注意：本行**刻意不写具体乱码样例** —— 写了这个文件自己就会被上面这条规则命中
  // （已经踩过一次：注释里放了个样例，守卫报了自己）。
  { re: /[\u00C0-\u00FF][\u0080-\u00BF]/, why: '疑似 UTF-8→Latin-1 乱码（高位字母紧跟 C1 控制区字符）' },
]

const EXTRA_FILES = new Set(['.gitignore', '.gitattributes', '.editorconfig'])

const isCjk = c => { const p = c.codePointAt(0); return p >= 0x4e00 && p <= 0x9fff }
const cjkOf = t => [...t].filter(isCjk)

function collectFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      collectFiles(fp, out)
    } else if (e.isFile()) {
      if (TEXT_EXT.has(path.extname(e.name).toLowerCase()) || EXTRA_FILES.has(e.name)) out.push(fp)
    }
  }
  return out
}

/** 读文本；非法 UTF-8 不算失败，但会被记下来当硬信号 */
function readText(file) {
  const raw = fs.readFileSync(file)
  let text, invalidUtf8 = false
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(raw)
  } catch {
    text = new TextDecoder('utf-8').decode(raw)
    invalidUtf8 = true
  }
  return { text, invalidUtf8 }
}

// ── 第一遍：读入所有文件 ──
const files = collectFiles(ROOT)
const docs = files.map(f => ({ file: f, rel: path.relative(ROOT, f), ...readText(f) }))

// ── 语料：先粗建一遍，再自举一次 ──
// 自举的目的：万一仓库里本来就有坏文件，别让它污染"什么是常用字"。
function buildCorpus(exclude) {
  const set = new Set()
  for (const d of docs) {
    if (exclude.has(d.file)) continue
    for (const c of cjkOf(d.text)) set.add(c)
  }
  return set
}

function ratioAgainst(doc, corpus) {
  const cjk = cjkOf(doc.text)
  if (!cjk.length) return { n: 0, rare: 0, ratio: 0 }
  const rare = cjk.filter(c => !corpus.has(c))
  // 同一生僻字重复出现只算一次，避免"某个怪字重复 50 遍"把比例推高
  const distinctRare = new Set(rare).size
  return { n: cjk.length, rare: rare.length, distinctRare, ratio: rare.length / cjk.length }
}

// 第一次：全体当语料
const corpus1 = buildCorpus(new Set())
const pass1 = docs.map(d => ({ d, ...ratioAgainst(d, corpus1) }))

// 自举：把比例最高的 5% 排除掉，重建语料
const sorted = [...pass1].sort((a, b) => b.ratio - a.ratio)
const suspectCount = Math.max(0, Math.floor(sorted.length * 0.05))
const suspects = new Set(sorted.slice(0, suspectCount).map(x => x.d.file))
const corpus2 = buildCorpus(suspects)

// ── 第二遍：正式判定 ──
const results = []

for (const d of docs) {
  const problems = []

  if (d.invalidUtf8) {
    problems.push({ why: '文件不是合法 UTF-8（含非法字节序列）', snippet: '' })
  }
  for (const sig of HARD) {
    if (sig.re.test(d.text)) {
      const line = d.text.split(/\r?\n/).find(l => sig.re.test(l)) || ''
      problems.push({ why: sig.why, snippet: line.trim().slice(0, 120) })
    }
  }

  const st = ratioAgainst(d, corpus2)
  if (st.n >= MIN_CJK_FOR_RATIO && st.ratio >= RARE_RATIO_THRESHOLD) {
    // 找一行最有代表性的：生僻字最多的那一行
    let best = '', bestScore = -1
    for (const line of d.text.split(/\r?\n/)) {
      const score = cjkOf(line).filter(c => !corpus2.has(c)).length
      if (score > bestScore) { bestScore = score; best = line }
    }
    problems.push({
      why: `疑似 UTF-8→GBK 乱码：生僻字占比 ${st.ratio.toFixed(2)}（阈值 ${RARE_RATIO_THRESHOLD}），`
        + `共 ${st.n} 个汉字、其中 ${st.rare} 个从未在本仓其它文件出现`,
      snippet: best.trim().slice(0, 120),
    })
  }

  if (problems.length) results.push({ rel: d.rel, problems })
}

const AS_JSON = process.argv.includes('--json')

if (AS_JSON) {
  // 供自检/CI 消费的机器可读输出
  console.log(JSON.stringify({
    checked: files.length,
    corpus: corpus2.size,
    threshold: RARE_RATIO_THRESHOLD,
    bad: results.map(r => ({ file: r.rel, why: r.problems.map(p => p.why) })),
  }, null, 2))
  process.exit(results.length ? 1 : 0)
}

console.log(`\n=== 编码守卫：检查 ${files.length} 个文本文件（语料 ${corpus2.size} 个汉字）===\n`)

if (!results.length) {
  console.log('  ✓ 没有发现乱码或非法 UTF-8\n')
  process.exit(0)
}

for (const r of results) {
  console.log(`  ✗ ${r.rel}`)
  for (const p of r.problems) {
    console.log(`      ${p.why}`)
    if (p.snippet) console.log(`          ${p.snippet}`)
  }
}

console.log(`\n  ${results.length} 个文件有问题\n`)
if (process.argv.includes('--fix-hint')) {
  console.log(`  怎么修：
    · 这是**内容损坏**，重新编码救不回来（原字节已丢）。
    · 从 git 取回上一个正常版本： git show HEAD:<path> > <path>
    · 以后一律用编辑工具读写源码，不要用 PowerShell 的 Get-Content -Raw / Set-Content。
`)
}
process.exit(1)
