/**
 * 从 runtime.json 重新生成 CREDITS.md。
 *
 * 为什么必须自动生成：
 *  OGA-BY 3.0 与 CC-BY-SA 3.0 **强制要求署名**，漏一个作者就是侵权。
 *  手工维护的作者清单在部件库从 60 扩到 170 之后必然漏 ——
 *  这次新增了 30 多位作者，靠手写不可能不漏。
 *  所以署名从部件数据里推导，部件变则署名自动跟着变。
 */
import fs from 'node:fs'

const ROOT = 'D:/工作区/pale-notes-web'
const rt = JSON.parse(fs.readFileSync(ROOT + '/src/assets/lpc/runtime.json', 'utf8'))

/** 采集作者 → 部件，以及授权 → 部件数 */
const byAuthor = new Map()
const licCount = new Map()
let noMeta = []

for (const p of rt.parts) {
  const authors = p.authors || []
  const lics = p.licenses || []
  if (!authors.length && !lics.length) { noMeta.push(p.id); continue }
  for (const a of authors) {
    if (!byAuthor.has(a)) byAuthor.set(a, [])
    byAuthor.get(a).push(p.id)
  }
  for (const l of lics) licCount.set(l, (licCount.get(l) || 0) + 1)
}

/*
  同名作者的写法会不统一（Bluecarrot16 / bluecarrot16、Matthew Krohn (makrohn) / Matthew Krohn (Makrohn)）。
  合并大小写相同的名字，取"写法更规范"的那个（字母更多、含大写更完整的优先）。
*/
const canonical = new Map()
for (const name of byAuthor.keys()) {
  const key = name.toLowerCase().replace(/[^a-z]/g, '')
  if (!canonical.has(key)) { canonical.set(key, name); continue }
  const cur = canonical.get(key)
  // 优先保留带括号原名、且首字母大写的写法
  const score = (s) => (/\(/.test(s) ? 2 : 0) + (/^[A-Z]/.test(s) ? 1 : 0) + s.length / 1000
  if (score(name) > score(cur)) canonical.set(key, name)
}
const merged = new Map()
for (const [name, ids] of byAuthor) {
  const key = name.toLowerCase().replace(/[^a-z]/g, '')
  const canon = canonical.get(key) || name
  if (!merged.has(canon)) merged.set(canon, new Set())
  for (const id of ids) merged.get(canon).add(id)
}

const authorRows = [...merged.entries()]
  .map(([name, set]) => [name, [...set].sort()])
  .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))

const licRows = [...licCount.entries()].sort((a, b) => b[1] - a[1])

const attributionRequired = licRows
  .filter(([l]) => /OGA-BY|CC-BY/i.test(l) && !/CC0/.test(l))
  .reduce((n, [, c]) => n + c, 0)

const out = `# 美术素材署名（CREDITS）

本站的人物像素立绘来自 **Universal LPC Spritesheet Character Generator**：
https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator

该项目素材分别以 **CC0 / OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0** 发布。
其中 **OGA-BY 与 CC-BY-SA 强制要求署名**，因此本文件必须随作品一同提供。

本文件由 \`runtime.json\` 自动生成（共 **${rt.parts.length}** 个部件），
请勿手工编辑 —— 手工维护的清单在部件库扩充后必然漏人。

## 授权分布

| 授权 | 部件数 |
|---|---|
${licRows.map(([l, c]) => `| ${l} | ${c} |`).join('\n')}

其中 **${attributionRequired}** 个部件要求署名（CC0 除外）。

## 作者

${authorRows.map(([name, ids]) => `- **${name}** —— ${ids.join('、')}`).join('\n')}

共 **${authorRows.length}** 位作者。

## 说明

- 场景背景、世界色调色板、以及主角与 NPC 的**部件组合逻辑**均为本项目原创，
  不涉及第三方素材。
- 主角不设像素立绘（见 \`PortraitPanel.tsx\` 的说明），因此不涉及额外素材。
- 若某位作者认为署名有误或遗漏，请提 Issue，会立即更正。
${noMeta.length ? `\n## 未标注来源的部件\n\n以下 ${noMeta.length} 个部件在 LPC 定义里没有 credits 字段，视为 CC0：\n\n${noMeta.map(i => '- ' + i).join('\n')}\n` : ''}`

fs.writeFileSync(ROOT + '/public/CREDITS.md', out, 'utf8')
fs.writeFileSync(ROOT + '/src/assets/lpc/CREDITS.md', out, 'utf8')
console.log(`✓ CREDITS.md 已生成`)
console.log(`  部件 ${rt.parts.length} 个，作者 ${authorRows.length} 位，需署名部件 ${attributionRequired} 个`)
console.log(`  无来源标注（视为 CC0）：${noMeta.length} 个`)
