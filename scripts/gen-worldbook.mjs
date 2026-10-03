/**
 * 从内置世界生成官方世界书 JSON。
 *
 * 用法：先由 esbuild 把 src/data/builtinWorlds.ts 打成一个 .mjs（见 package.json 的 gen:worldbook），
 * 本脚本再读那个产物 —— Node 无法直接 import .ts，所以必须分两步。
 *
 * 为什么要有这一步：
 *  内置世界原本只以 TypeScript 对象的形式存在（builtinWorlds*.ts），
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
  title: '灯叙 · 官方示例世界集',
  tagline: '三个题材完全不同的世界，用来展示这套引擎能跑什么',
  description: [
    '这本世界书里的三个世界**题材互不相干**，是刻意安排的 ——',
    '它们要说明的是：这个引擎不绑定任何题材，世界观完全由卡片决定。',
    '',
    '· 《灰烬回响》—— 暗黑奇幻。5 个自定义属性、3 条资源、章节卡事件，机制最完整。',
    '· 《霓虹雨季》—— 赛博朋克。记忆擦除与档案交易，说明机制可以换成完全不同的题材皮。',
    '· 《星海拾遗》—— 太空歌剧，但**关闭了机制层**。它存在的意义是证明：',
    '  同一个引擎也能跑纯叙事的对话游戏，不需要任何数值。',
    '',
    '想自己写世界？把这份 JSON 下载下来改，或者直接在卡片编辑器里新建。',
    '字段含义见 README 的「核心概念」。',
  ].join('\n'),
  author: '灯叙项目',
  revision: '1.0',
  tags: ['示例', '官方', '多题材'],
  chapters: [
    {
      title: '机制向',
      note: '带属性、资源、物品与线索结算',
      worldIds: BUILTIN_WORLDS.filter(w => w.enableMechanics).map(w => w.id),
    },
    {
      title: '纯叙事向',
      note: '关闭数值系统，只做对话与关系',
      worldIds: BUILTIN_WORLDS.filter(w => !w.enableMechanics).map(w => w.id),
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
