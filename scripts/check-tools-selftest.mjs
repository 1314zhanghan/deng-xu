/**
 * 工具自检：证明这些"守卫/校验器"**看见坏东西会报警、看见好东西不误报**。
 *
 * 为什么必须写它：本项目最贵的教训是「探针比被测代码更容易错」
 * （交接文档自述误报 15+ 次，ROADMAP 另记 9 次）。一个只会打印
 * "全部通过"的检测器毫无价值 —— 它可能因为自身逻辑写错而永远通过。
 *
 * 做法：**污染测试**。往真实仓库里临时塞进构造好的坏文件，
 * 跑守卫，断言它被抓到；再删掉，断言仓库恢复干净。
 * 关键是这些坏文件放在**真实语料环境**里跑 —— 上一版自检把夹具放进
 * 沙箱目录，语料只剩 346 个字，统计判据直接失效（假阴性）。
 *
 * 用法：node scripts/check-tools-selftest.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '..')
const NODE = process.execPath

let failures = 0
const check = (label, ok, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? '  ' + extra : ''}`)
  if (!ok) failures++
}

/** 造真实乱码：UTF-8 字节按 GBK 解码 */
const gbkMojibake = t => new TextDecoder('gbk').decode(Buffer.from(t, 'utf8'))
/** 造真实乱码：UTF-8 字节按 Latin-1 解码 */
const latin1Mojibake = t => Buffer.from(t, 'utf8').toString('latin1')

/** 跑编码守卫，拿 JSON 结果 */
function runEncodingGuard() {
  const r = spawnSync(NODE, [path.join(ROOT, 'scripts', 'check-encoding.mjs'), '--json'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  })
  const out = (r.stdout || '').trim()
  const jsonStart = out.indexOf('{')
  if (jsonStart === -1) return { bad: [], raw: out, status: r.status }
  try {
    return { ...JSON.parse(out.slice(jsonStart)), status: r.status }
  } catch (e) {
    return { bad: [], raw: out, status: r.status, parseError: e.message }
  }
}

// ── 0) 基线：真实仓库必须是干净的 ──
console.log('\n=== 0) 基线：真实仓库应当干净 ===\n')
{
  const r = runEncodingGuard()
  check('编码守卫生成 JSON 且判定干净', r.status === 0 && Array.isArray(r.bad) && r.bad.length === 0,
    r.parseError ? '解析失败：' + r.parseError : `checked=${r.checked} bad=${(r.bad || []).length}`)
}

// ── 1) 污染测试：塞坏文件进去，守卫必须抓到 ──
console.log('\n=== 1) 污染测试：坏文件必须被抓到 ===\n')

const FIXTURES = [
  {
    name: '__fixture-gbk-mojibake.md',
    content: gbkMojibake('玩家输入行动，角色回应。这是一段正常的中文叙事文本，用于测试乱码检测。'),
    why: 'UTF-8→GBK 乱码',
  },
  {
    name: '__fixture-latin1-mojibake.md',
    content: latin1Mojibake('玩家输入行动，角色回应。（括号）与省略号……'),
    why: 'UTF-8→Latin-1 乱码',
  },
  // 关键：**大段**乱码，用来验证统计判据（占比 ≥0.30）真的会触发
  {
    name: '__fixture-bulk-mojibake.md',
    content: '# ' + gbkMojibake('灯叙是一个题材无关的 AI 文字冒险引擎。玩家挑一张世界卡，设定自己的身份，'
      + '然后由 AI 持续生成叙事。这是两阶段管线：叙事 AI 生成散文，数据 AI 生成 JSON。'
      + '像素立绘由 LPC 部件合成，地图是俯瞰瓦片，昼夜四档。'),
    why: '大段 GBK 乱码（验证统计判据）',
  },
  { name: '__fixture-pua.md', content: '正常开头，混入私用区字符 \uE18D 与 \uE757。', why: '私用区字符' },
  { name: '__fixture-replacement.md', content: '解码失败留下的 \uFFFD 字符。', why: 'U+FFFD' },
]

const written = []
for (const f of FIXTURES) {
  const p = path.join(ROOT, 'scripts', f.name)
  fs.writeFileSync(p, f.content, 'utf8')
  written.push(p)
}
// 非法 UTF-8 必须按字节写
{
  const p = path.join(ROOT, 'scripts', '__fixture-invalid-bytes.md')
  fs.writeFileSync(p, Buffer.concat([
    Buffer.from('# 非法 UTF-8\n中文前缀 ', 'utf8'), Buffer.from([0xff, 0xfe, 0x80]), Buffer.from('\n', 'utf8'),
  ]))
  written.push(p)
  FIXTURES.push({ name: '__fixture-invalid-bytes.md', why: '非法 UTF-8 字节序列' })
}

try {
  const r = runEncodingGuard()
  const flagged = new Set((r.bad || []).map(b => path.basename(b.file)))
  console.log(`      守卫报了 ${flagged.size} 个文件\n`)
  for (const f of FIXTURES) {
    const hit = flagged.has(f.name)
    check(`${f.why} → 应报警`, hit, hit ? '已报警' : '未报警（假阴性！）')
  }
} finally {
  for (const p of written) fs.rmSync(p, { force: true })
}

// ── 2) 清理后必须恢复干净（证明污染测试本身没留下痕迹）──
console.log('\n=== 2) 清理后仓库必须恢复干净 ===\n')
{
  const r = runEncodingGuard()
  check('污染文件已全部删除', written.every(p => !fs.existsSync(p)))
  check('仓库恢复干净', r.status === 0 && (r.bad || []).length === 0,
    (r.bad || []).map(b => b.file).join(', ') || '')
}

// ── 3) 正常中文**绝不**误报（这是上一版真正翻车的地方）──
console.log('\n=== 3) 正常中文绝不误报（最重要的一条）===\n')
{
  // 历史误报的三个具体内容，逐个验证
  const tricky = [
    ['世界名「澪汀」；城市基础设施叫「潮务处」', '含「汀」的正常文案'],
    ['一张停用的卡，你留着但没插回去过', '含「町」的正常文案'],
    ['凌晨一点，雨量从「中雨」跳成「暴雨」，脑髓雨警报第一次响起。', '霓虹雨季正文'],
    ['玩家输入行动，角色回应。这是一段正常的中文叙事文本。', '普通中文'],
    ['UTF-8→GBK 乱码的**双字节特征对**（如 锛?、鈥?、銆?）：', '文档里刻意举的乱码例子'],
  ]
  for (const [text, label] of tricky) {
    const p = path.join(ROOT, 'scripts', '__fixture-normal.md')
    fs.writeFileSync(p, '# 测试\n\n' + text + '\n', 'utf8')
    const r = runEncodingGuard()
    const hit = (r.bad || []).some(b => path.basename(b.file) === '__fixture-normal.md')
    check(`${label} → 不应报警`, !hit, hit ? '**误报了！**' : '未报警')
    fs.rmSync(p, { force: true })
  }
  fs.rmSync(path.join(ROOT, 'scripts', '__fixture-normal.md'), { force: true })
}

console.log('\n=== 汇总 ===')
console.log(`  ${failures === 0 ? '全部通过' : failures + ' 项未通过'}`)
process.exit(failures === 0 ? 0 : 1)
