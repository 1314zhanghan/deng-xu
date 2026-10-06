/**
 * 把玩家反馈过的两个具体角色渲染出来，用于人工核对"修好没有"。
 *
 * 这两个描述来自玩家截图（人物关系面板）：
 *   · 玛尔塔·魏斯 —— 描述是「约莫四十出头的妇人…深灰色素面长裙」，
 *     原来画成一张**留胡子的男脸**（性别推断漏了"妇人"）
 *   · 卢卡斯·魏斯 —— 描述是「约莫十七八岁的少年…法师塔学徒」，
 *     原来画成粉发长裙、且一度拿到老人脸
 *
 * 单独一个脚本、而不是并入 audit：这两个是**回归锚点**，
 * 每次改推断逻辑都该能一眼看到它们对不对。
 */
import fs from 'node:fs'
import path from 'node:path'
import * as esbuild from 'esbuild'
import { installDomShim, decodePng, encodePng } from './canvas-shim.mjs'

const ROOT = 'D:/工作区/pale-notes-web'
const out = path.join(ROOT, '.check', 'render-cases.mjs')
const lpcPartsPlugin = {
  name: 'lpc-parts',
  setup(build) {
    build.onResolve({ filter: /^virtual:lpc-parts$/ }, () => ({ path: 'lpc-parts', namespace: 'lpc-parts' }))
    build.onLoad({ filter: /.*/, namespace: 'lpc-parts' }, () => {
      const dir = path.join(ROOT, 'src', 'assets', 'lpc', 'parts')
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort()
      const entries = files.map(f => `  ${JSON.stringify('./parts/' + f)}: ${JSON.stringify(path.join(dir, f))},`)
      return { contents: `export default {\n${entries.join('\n')}\n}\n`, loader: 'js' }
    })
  },
}
const globReplacePlugin = {
  name: 'replace-import-meta-glob',
  setup(build) {
    build.onLoad({ filter: /lpcSprite\.ts$/ }, args => {
      let src = fs.readFileSync(args.path, 'utf8')
      let replaced = false
      src = src.replace(/import\.meta\.glob\(\s*['"][^'"]*parts\/\*\.png['"][\s\S]*?\)/m,
        () => { replaced = true; return 'LPC_PART_URLS' })
      if (!replaced) return { contents: src, loader: 'ts' }
      return { contents: `import LPC_PART_URLS from 'virtual:lpc-parts'\n${src}`, loader: 'ts', resolveDir: path.dirname(args.path) }
    })
  },
}
await esbuild.build({
  entryPoints: [path.join(ROOT, 'scripts', 'lib', 'render-entry.ts')],
  bundle: true, platform: 'node', format: 'esm', outfile: out,
  alias: { '@': path.join(ROOT, 'src') },
  loader: { '.json': 'json', '.png': 'file' },
  plugins: [lpcPartsPlugin, globReplacePlugin], logLevel: 'error',
})
installDomShim()
const M = await import('file://' + out.replace(/\\/g, '/'))

const CASES = [
  ['玛尔塔·魏斯', 'npc_marta', '约莫四十出头的妇人，魏斯家当家主母。深灰色素面长裙堆在腰侧，脖颈上系着一条黑色丝巾。', 'female'],
  ['卢卡斯·魏斯', 'npc_lucas', '约莫十七八岁的少年，魏斯家独子，月谷城法师塔学徒。赤裸趴伏地毯上，脊背单薄。', 'male'],
]

const cells = []
console.log('\n=== 玩家反馈的两个角色 · 复核 ===\n')
for (const [label, id, desc, wantGender] of CASES) {
  const t = M.inferTraits({ name: label, description: desc })
  const r = M.recipeForDiag(id, { profile: { name: label, description: desc } })
  const url = await M.spriteDataUrl(id, desc, { scale: 6 })
  cells.push({ src: url })
  const head = r.parts.find(p => /heads_/.test(p))
  const beard = r.parts.filter(p => /beards_/.test(p))
  const nose = r.parts.find(p => /head_nose/.test(p))
  console.log(`【${label}】`)
  console.log(`  描述: ${desc}`)
  console.log(`  推断: gender=${t.gender}(期望${wantGender}) age=${t.age} cloth=${t.cloth} skirt=${t.skirt}`)
  console.log(`  证据: ${t.evidence.join(' / ')}`)
  console.log(`  头部: ${head}   鼻子: ${nose}   胡须: ${beard.length ? beard.join(',') : '(无)'}`)
  const isMaleHead = /heads_human_male/.test(head || '')   // 注意 female 里也含 "male" 子串
  const isFemaleHead = /heads_human_female/.test(head || '')
  const genderOk = t.gender === wantGender
  const headOk = wantGender === 'female' ? isFemaleHead : isMaleHead
  console.log(`  性别推断: ${genderOk ? '✓' : '✗'}   头部部件: ${headOk ? '✓' : '✗'}`)
  console.log('')
}

// 拼一张 1×2 的对照图（放大 6 倍 = 384px）
const scale = 6, cell = 64 * scale, W = cell * 2 + 24, H = cell + 16
const px = Buffer.alloc(W * H * 4)
for (let i = 0; i < W * H; i++) { px[i * 4] = 26; px[i * 4 + 1] = 26; px[i * 4 + 2] = 30; px[i * 4 + 3] = 255 }
cells.forEach((c, i) => {
  const { width, height, rgba } = decodePng(Buffer.from(c.src.slice(c.src.indexOf(',') + 1), 'base64'))
  const ox = 8 + i * (cell + 8), oy = 8
  for (let y = 0; y < cell; y++) {
    for (let x = 0; x < cell; x++) {
      const s = (Math.min(height - 1, Math.floor(y * height / cell)) * width + Math.min(width - 1, Math.floor(x * width / cell))) * 4
      const a = rgba[s + 3] / 255
      if (a === 0) continue
      const d = ((oy + y) * W + (ox + x)) * 4
      px[d] = Math.round(rgba[s] * a + px[d] * (1 - a))
      px[d + 1] = Math.round(rgba[s + 1] * a + px[d + 1] * (1 - a))
      px[d + 2] = Math.round(rgba[s + 2] * a + px[d + 2] * (1 - a))
      px[d + 3] = 255
    }
  }
})
const file = path.join(ROOT, 'playtest-shots', 'reported-cases.png')
fs.writeFileSync(file, encodePng(W, H, px))
console.log(`  对照图（左=玛尔塔·魏斯，右=卢卡斯·魏斯）：`)
console.log(`    ${file}`)
console.log(`    ![复核](playtest-shots/reported-cases.png)\n`)
