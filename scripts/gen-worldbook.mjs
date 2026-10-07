/**
 * 从内置世界生成官方世界书 JSON。
 *
 * 用法：先由 esbuild 把 src/data/builtinWorlds.ts 打成一个 .mjs（见 package.json 的 gen:worldbook），
 * 本脚本再读那个产物 —— Node 无法直接 import .ts，所以必须分两步。
 *
 * 为什么要有这一步：
 *  内置世界只以 TypeScript 对象的形式存在（`src/data/worlds/*.ts`，约 580 KB），
 *  用户看得到、却**拿不走**。生成一份 JSON 之后：
 *   - 用户可以在标题页下载它，作为格式范例照着写自己的世界书；
 *   - 也可以改一改再导入回去，当作"从内置世界派生出自己的世界"的起点；
 *   - 世界书格式因此有了一个真实存在的参考实现，而不是只写在文档里。
 *
 * 产物：
 *   public/official-worldbook.json   （随站点发布，可直接下载）
 *   presets/official-worldbook.json  （留在仓库里，便于 diff 与审阅）
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const out = process.argv[2] || 'public'
const bundled = process.argv[3] || '.check/worlds.mjs'

const abs = path.isAbsolute(bundled) ? bundled : path.join(root, bundled)
if (!fs.existsSync(abs)) {
  console.error(`找不到打包产物 ${abs}\n请先运行 npm run gen:worldbook（它会先 esbuild 再执行本脚本）`)
  process.exit(1)
}

const mod = await import(pathToFileURL(abs).href)
const BUILTIN_WORLDS = mod.BUILTIN_WORLDS
if (!Array.isArray(BUILTIN_WORLDS) || !BUILTIN_WORLDS.length) {
  console.error('打包产物里没有 BUILTIN_WORLDS')
  process.exit(1)
}

const book = {
  format: 'deng-xu-worldbook',
  version: 1,
  title: '灯叙 · 官方世界集',
  tagline: '六个深度世界：后末日企业、中式王朝、经典西幻、大航海、蒸汽工业、青铜上古',
  description: [
    '这本世界书里六个世界**题材互不相干**，是刻意安排的 ——',
    '它们要说明的是：这个引擎不绑定任何题材，世界观完全由卡片决定。',
    '',
    '每个世界都用同一套设计法：',
    '· **先立框架，再向下长** —— 文明/族裔、意识形态、政体形态、生活方式',
    '  各铺开七八种以上，且彼此有结构性矛盾；然后只挑一两处写死具体的人、钱与规矩。',
    '  这样世界才有"宏大活人感"，而不是围着一个城市堆五万字细节。',
    '· **长期目标是模糊的大方向，不是任务** —— 每个方向内部都容得下好人、',
    '  坏人与中间人；你可以做能臣，也可以做狼子野心的奸臣；可以只想安稳过日子。',
    '· **明确留白** —— rules 里都有一条"世界比这更大"：已写的只是下限，',
    '  没提到的部分允许按世界逻辑自行扩展。',
    '· **沙盒优先** —— 没有必须完成的主线，不催进度，允许玩家只当一个普通人。',
    '',
    '· 《深核集团·地渊之下》—— 后末日反乌托邦。喜马拉雅山脉地下三千米的',
    '  垂直企业都市「地渊」，100 层、一亿两千万人。**设定核心之一是禁用强人工智能。**',
    '· 《大晟会典》—— 虚构的中式古风王朝，立国三百余年。**没有任何超自然力量**，',
    '  只有武力、智谋、权力与阴谋。',
    '· 《三邦纪年》—— 经典西方奇幻。三政体、五族之外还有八个族裔；低魔且有代价。',
    '· 《大洋纪年》—— 大航海。以海为常态：季风、洋流、沉船与港口法度。无魔法。',
    '· 《蒸汽纪年》—— 工业革命。煤、铁、电报、工厂法、工会与投机泡沫。无魔法。',
    '· 《青铜纪年》—— 青铜时代。神庙、战车、泥板与正在从多神走向一神的痛苦过程；',
    '  神永远不现身，任何"灵验"都有两种解释。',
    '',
    '每个世界的世界观正文都在三万字以上（全卡五万字以上）。',
    '想自己写世界？把这份 JSON 下载下来改，或者直接在卡片编辑器里新建。',
    '字段含义见 README 的「核心概念」。',
  ].join('\n'),
  author: '灯叙项目',
  revision: '3.0',
  tags: ['官方', '深度世界', '沙盒', '多题材'],
  chapters: [
    {
      title: '本辑六个世界',
      note: '每个世界约五万字设定，机制层全开',
      worldIds: BUILTIN_WORLDS.map(w => w.id),
    },
  ].filter(c => c.worldIds.length > 0),
  worlds: BUILTIN_WORLDS,
}

const json = JSON.stringify(book, null, 2)
const dir = path.join(root, out)
fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(path.join(dir, 'official-worldbook.json'), json, 'utf8')

fs.mkdirSync(path.join(root, 'presets'), { recursive: true })
fs.writeFileSync(path.join(root, 'presets/official-worldbook.json'), json, 'utf8')

const sizeKb = (Buffer.byteLength(json) / 1024).toFixed(1)
console.log(`✓ 官方世界书已生成：${book.worlds.length} 个世界，${sizeKb} KB`)
console.log(`  ${out}/official-worldbook.json`)
console.log(`  presets/official-worldbook.json`)
for (const w of book.worlds) {
  console.log(`  · ${w.title}  机制层=${w.enableMechanics ? '开' : '关'}  角色=${(w.characters || []).length}  属性=${(w.attributes || []).length}  资源=${(w.resources || []).length}`)
}
for (const c of book.chapters) {
  console.log(`  章节「${c.title}」：${c.worldIds.length} 个世界`)
}
