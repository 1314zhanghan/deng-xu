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
  tagline: '三个深度世界：后末日企业、中式古风王朝、经典西幻',
  description: [
    '这本世界书里的三个世界**题材互不相干**，是刻意安排的 ——',
    '它们要说明的是：这个引擎不绑定任何题材，世界观完全由卡片决定。',
    '',
    '· 《深核集团·地渊之下》—— 后末日反乌托邦。喜马拉雅山脉地下三千米的',
    '  垂直企业都市「地渊」，100 层、一亿两千万人。贡献点经济、技术分层、',
    '  七人董事会、十二部门、12 级职级。**设定核心之一是禁用强人工智能。**',
    '· 《大晟会典》—— 虚构的中式古风王朝，立国三百余年。**没有任何超自然力量**，',
    '  只有武力、智谋、权力与阴谋。太平盛世、万国来朝的阴影下暗流涌动。',
    '· 《三邦纪年》—— 经典西方奇幻。帝国 / 王国 / 联邦三政体，',
    '  人类 / 精灵 / 矮人 / 兽人 / 龙五族。低魔：术有材料、准备与寿命代价。',
    '',
    '每个世界的世界观正文都在三万字以上（全卡五万字以上），足以支撑长线游玩。',
    '想自己写世界？把这份 JSON 下载下来改，或者直接在卡片编辑器里新建。',
    '字段含义见 README 的「核心概念」。',
  ].join('\n'),
  author: '灯叙项目',
  revision: '2.0',
  tags: ['官方', '深度世界', '多题材'],
  chapters: [
    {
      title: '本辑三个世界',
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
