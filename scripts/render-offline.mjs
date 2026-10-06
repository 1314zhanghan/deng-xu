/**
 * 离线渲染器 —— **不依赖浏览器**直接出 PNG。
 *
 * ## 为什么需要它
 *
 * 项目里所有视觉验证都得经 Edge + CDP（`scripts/checks/*.mjs`）。
 * 这条链路带来三类反复出现的成本：
 *
 *   1. **环境**：本地要有 Edge，CI 要装浏览器；沙箱还要允许 Chromium
 *      创建命名管道（本机受限模式下 `mojo` 直接崩，表现为"端口未就绪"）。
 *   2. **缓存**：改了源码必须重启 dev server，否则看到的是旧代码 ——
 *      这个坑让上一轮白排查过很久。
 *   3. **慢**：每次要启动浏览器、导航、等页面、截图。
 *
 * 而这个项目的渲染其实是**纯计算**：地图是逐像素画进 `RgbCanvas`，
 * 立绘是把 LPC 部件按 zPos 叠起来换色。只要有 canvas 的替身就能算，
 * PNG 也能用 zlib 直接写。于是同一份渲染代码可以在 Node 里跑，
 * 出图给读图能力看 —— 这也正是 HANDOFF 第 10.5 节推荐的"离线 Node 渲染器"。
 *
 * ## 用法
 *
 *   # 地图对照图（9 地形 × 4 时段 + 3 套布局），输出一张大图
 *   node scripts/render-offline.mjs map
 *
 *   # 只看某几种地形
 *   node scripts/render-offline.mjs map --archetypes=forest,coast
 *
 *   # 瓦片预览：每种地形的单格放大 N 倍（改 drawTile 时必用，
 *   # 因为一格只有 16px，在整张地图上根本看不出画得对不对）
 *   node scripts/render-offline.mjs tiles --kinds=tree --scale=14
 *
 *   # 放大对比：同一张图 1× / 2× / 3× 并排（最左才是玩家实际看到的尺寸）
 *   node scripts/render-offline.mjs zoom --archetype=forest
 *
 *   # 立绘对照图（用一组真实角色描述）
 *   node scripts/render-offline.mjs sprites
 *
 *   # 单个角色、放大、只取头
 *   node scripts/render-offline.mjs sprite --desc="银白色长发编成辫子的精灵游侠" --scale=4
 *
 *   # 检查渲染环境是否可用（不做浏览器，只验证垫片与打包）
 *   node scripts/render-offline.mjs selftest
 *
 *   # 与浏览器结果交叉验证（需 dev server；比较 recipeFor 选出的部件与配色）
 *   node scripts/render-offline.mjs xcheck
 *
 * 输出目录默认 `playtest-shots/`（与走查脚本一致，便于对照）。
 * 命令会打印**可直接引用的 markdown 路径**。
 */
import fs from 'node:fs'
import path from 'node:path'
import * as esbuild from 'esbuild'
import { installDomShim, encodePng, decodePng } from './lib/canvas-shim.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.resolve(process.env.OUT_DIR || path.join(ROOT, 'playtest-shots'))
fs.mkdirSync(OUT, { recursive: true })

// ── 参数 ──
const argv = process.argv.slice(2)
const argVal = (n, d) => {
  const hit = argv.find(a => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : d
}
const has = n => argv.includes(`--${n}`)
const positional = argv.filter(a => !a.startsWith('--'))
const COMMAND = positional[0] || 'map'

// ============================================================================
// 构建：把 render-entry.ts 打包成 Node 能 import 的模块
// ============================================================================

/**
 * 把 Vite 的 `import.meta.glob('@/assets/lpc/parts/*.png', ...)` 换成
 * "这一份打包产物专属"的加载器。
 *
 * 为什么要换成绝对文件路径而不是 dataURL：246 张部件图，
 * 若内联成 base64 会把打包产物撑到十几 MB，每次构建都要几秒且吃内存。
 * 给绝对路径后 `Image` 垫片直接 `fs.readFileSync`，干净又快。
 */
const lpcPartsPlugin = {
  name: 'lpc-parts',
  setup(build) {
    build.onResolve({ filter: /^virtual:lpc-parts$/ }, () => ({ path: 'lpc-parts', namespace: 'lpc-parts' }))
    build.onLoad({ filter: /.*/, namespace: 'lpc-parts' }, () => {
      const dir = path.join(ROOT, 'src', 'assets', 'lpc', 'parts')
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort()
      // 键的形状必须与 Vite 的 glob 一致：'./parts/xxx.png' → 这样 lpcSprite 的
      // `k.endsWith('/' + file)` 才能匹配上
      const entries = files.map(f => `  ${JSON.stringify('./parts/' + f)}: ${JSON.stringify(path.join(dir, f))},`)
      const src = `export default {\n${entries.join('\n')}\n}\n`
      return { contents: src, loader: 'js' }
    })
  },
}

/**
 * 把源码里的 `import.meta.glob(...)` 调用整体替换成对虚拟模块的静态 import。
 *
 * 注意：**不要**试图用 `await import()` —— 那会把整个模块图变成异步，
 * 而 `lpcSprite.ts` 的顶层是个普通常量赋值，`import.meta.glob` 的结果
 * 必须在模块求值时就拿到。用静态 import 最稳。
 */
const globReplacePlugin = {
  name: 'replace-import-meta-glob',
  setup(build) {
    build.onLoad({ filter: /lpcSprite\.ts$/ }, args => {
      let src = fs.readFileSync(args.path, 'utf8')
      let replaced = false
      src = src.replace(
        /import\.meta\.glob\(\s*['"][^'"]*parts\/\*\.png['"][\s\S]*?\)/m,
        () => { replaced = true; return 'LPC_PART_URLS' },
      )
      if (!replaced) return { contents: src, loader: 'ts' }
      return {
        contents: `import LPC_PART_URLS from 'virtual:lpc-parts'\n${src}`,
        loader: 'ts',
        resolveDir: path.dirname(args.path),
      }
    })
  },
}

let _entryCache = null
async function buildEntry() {
  if (_entryCache) return _entryCache
  const out = path.join(ROOT, '.check', 'render-entry.mjs')
  fs.mkdirSync(path.dirname(out), { recursive: true })
  try {
    await esbuild.build({
      entryPoints: [path.join(ROOT, 'scripts', 'lib', 'render-entry.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: out,
      alias: { '@': path.join(ROOT, 'src') },
      loader: { '.json': 'json', '.png': 'file' },
      plugins: [lpcPartsPlugin, globReplacePlugin],
      logLevel: 'warning',
    })
  } catch (e) {
    console.error('✗ 打包渲染入口失败：')
    console.error(e.message || e)
    process.exit(1)
  }
  _entryCache = out
  return out
}

let _modCache = null
/** 打包并 import 渲染入口（已装好 DOM 垫片） */
async function loadRender() {
  if (_modCache) return _modCache
  const out = await buildEntry()
  installDomShim()
  _modCache = await import('file://' + out.replace(/\\/g, '/'))
  return _modCache
}

/** dataURL → PNG 文件 */
function writeDataUrl(dataUrl, file) {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  fs.writeFileSync(file, Buffer.from(b64, 'base64'))
  return fs.statSync(file).size
}

/**
 * 把若干 dataURL 拼成一张对照图（纯像素拼接，不依赖 canvas 的文字能力）。
 *
 * ⚠️ **必须保持长宽比**。第一版我直接把图拉伸填满格子，而格子的
 * 高宽比与图不同（192×192 的立绘塞进 192×384 的格子），于是画面被
 * 纵向拉伸 2 倍 —— 我因此一度以为"离线渲染的立绘被压扁/缺了下半身"，
 * 差点去查渲染代码。**拼图工具本身出错，会制造出假的视觉缺陷。**
 */
function contactSheet(cells, { cols, cellW, cellH, gap = 4, bg = [24, 24, 28] }) {
  const rows = Math.ceil(cells.length / cols)
  const W = cols * cellW + (cols + 1) * gap
  const H = rows * cellH + (rows + 1) * gap
  const px = Buffer.alloc(W * H * 4)
  for (let i = 0; i < W * H; i++) {
    px[i * 4] = bg[0]; px[i * 4 + 1] = bg[1]; px[i * 4 + 2] = bg[2]; px[i * 4 + 3] = 255
  }
  cells.forEach((cell, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const cx0 = col * cellW + (col + 1) * gap
    const cy0 = row * cellH + (row + 1) * gap
    const b64 = cell.src.slice(cell.src.indexOf(',') + 1)
    const { width, height, rgba } = decodePng(Buffer.from(b64, 'base64'))

    // 等比缩放（取较小的那个比例，保证完整显示），并居中
    const scale = Math.min(cellW / width, cellH / height)
    const dw = Math.max(1, Math.round(width * scale))
    const dh = Math.max(1, Math.round(height * scale))
    const ox = cx0 + Math.floor((cellW - dw) / 2)
    const oy = cy0 + Math.floor((cellH - dh) / 2)

    for (let y = 0; y < dh; y++) {
      const sy = Math.min(height - 1, Math.floor(y * height / dh))
      for (let x = 0; x < dw; x++) {
        const sx = Math.min(width - 1, Math.floor(x * width / dw))
        const s = (sy * width + sx) * 4
        const a = rgba[s + 3]
        if (a === 0) continue
        const ty = oy + y, tx = ox + x
        if (ty < 0 || ty >= H || tx < 0 || tx >= W) continue
        const d = (ty * W + tx) * 4
        const k = a / 255
        px[d] = Math.round(rgba[s] * k + px[d] * (1 - k))
        px[d + 1] = Math.round(rgba[s + 1] * k + px[d + 1] * (1 - k))
        px[d + 2] = Math.round(rgba[s + 2] * k + px[d + 2] * (1 - k))
        px[d + 3] = 255
      }
    }
  })
  return encodePng(W, H, px)
}

function report(file, extra = '') {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/')
  console.log(`\n  ✓ 已写出：${file}`)
  if (extra) console.log(`      ${extra}`)
  console.log(`\n  引用：![图](${rel})`)
}

// ============================================================================
// 命令
// ============================================================================

async function cmdMap() {
  const M = await loadRender()
  const only = argVal('archetypes')
  const list = only ? only.split(',') : M.ARCHETYPES

  const cells = []
  for (const a of list) {
    for (const ph of M.PHASES) cells.push({ src: M.mapDataUrl(a, 'offline', ph) })
    // 三套布局（换 seed 换 variant）
    for (let v = 0; v < 3; v++) cells.push({ src: M.mapDataUrl(a, 'variant' + v, 'day') })
  }

  const file = path.join(OUT, 'offline-map.png')
  // 每行 4 档时段 + 3 套布局 = 7 列；地图逻辑尺寸 320×192
  fs.writeFileSync(file, contactSheet(cells, { cols: 7, cellW: 480, cellH: 288 }))
  console.log(`\n=== 离线地图对照图 ===`)
  console.log(`  ${list.length} 种地形 × ${M.PHASES.length} 档时段 + 每种 3 套布局 = ${cells.length} 张`)
  report(file, `行=地形（${list.join(', ')}）  列=dawn/day/dusk/night + 布局A/B/C`)
}

async function cmdSprites() {
  const M = await loadRender()

  // 用一组**真实风格**的角色描述 —— 与走查脚本 npc-fidelity.mjs 的取材一致，
  // 这样离线结果可以和浏览器结果互相印证
  const CASES = [
    ['管家', '星夜堡的管家，衣着整洁，右眼佩戴着一枚镶有银丝的单片眼镜，乌黑长发束成马尾'],
    ['和服少女', '穿着红色和服的少女，黑发，齐刘海'],
    ['板甲骑士', '穿板甲的骑士，戴着全罩大盔，白色披风'],
    ['银叶精灵', '森林精灵，浅金色长发用木簪挽起，穿绿色皮甲'],
    ['独眼茶摊老板', '独眼茶摊老板，棕色围裙，四十来岁，男人'],
    ['现代学生', '穿着深蓝色制服的学生，戴圆框眼镜'],
    ['莫西干混混', '染成亮橙色的莫西干头，穿破洞牛仔外套'],
    ['亡灵法师', '苍白到发青的皮肤，灰白的长发披散，穿漆黑的长袍'],
  ]

  const cells = []
  const rows = []
  const details = []
  for (const [label, desc] of CASES) {
    const d = await M.spriteDetail(label, desc, { headOnly: false, scale: 3 })
    cells.push({ src: d.dataUrl })
    rows.push(label)
    details.push({ label, desc, parts: d.recipe.parts.length, headwear: d.traits.headwear, hairStyle: d.traits.hairStyle })
  }
  const file = path.join(OUT, 'offline-sprites.png')
  fs.writeFileSync(file, contactSheet(cells, { cols: 4, cellW: 224, cellH: 224 }))
  console.log(`\n=== 离线立绘对照图 ===`)
  console.log(`  ${CASES.length} 个角色（顺序：${rows.join(', ')}）`)
  report(file)
  console.log('\n  配方摘要（用于核对"关键词真的生效了"）：')
  for (const d of details) {
    console.log(`    ${d.label.padEnd(7)} 部件 ${String(d.parts).padStart(2)} 个  发型=${(d.hairStyle || []).join('/') || '-'}  头饰=${(d.headwear || []).join('/') || '-'}`)
  }
}

async function cmdSprite() {
  const M = await loadRender()
  const desc = argVal('desc', '黑发束成马尾的管家，戴单片眼镜')
  const scale = Number(argVal('scale', '4'))
  const headOnly = has('head-only')
  const detail = await M.spriteDetail('offline-single', desc, { scale, headOnly })
  const file = path.join(OUT, 'offline-sprite.png')
  writeDataUrl(detail.dataUrl, file)
  console.log(`\n=== 单个立绘 ===`)
  console.log(`  描述：${desc}`)
  console.log(`  推断：${JSON.stringify(detail.traits)}`)
  console.log(`  部件：${detail.recipe.parts.join(', ')}`)
  report(file, `scale=${scale} headOnly=${headOnly}`)
}

async function cmdSelftest() {
  console.log('\n=== 离线渲染器自检 ===\n')
  let bad = 0
  const check = (label, ok, extra = '') => {
    console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? '  ' + extra : ''}`)
    if (!ok) bad++
  }

  // 1) PNG 编解码往返
  {
    const w = 3, h = 2
    const rgba = Buffer.alloc(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      rgba[i * 4] = i * 10; rgba[i * 4 + 1] = 255 - i * 10; rgba[i * 4 + 2] = i * 3
      rgba[i * 4 + 3] = i % 2 ? 255 : 128
    }
    const png = encodePng(w, h, rgba)
    const back = decodePng(png)
    check('PNG 往返尺寸一致', back.width === w && back.height === h)
    check('PNG 往返像素一致', back.rgba.equals(rgba),
      back.rgba.equals(rgba) ? '' : `${back.rgba.subarray(0, 8).toString('hex')} vs ${rgba.subarray(0, 8).toString('hex')}`)
  }

  // 2) 解码**全部**真实素材 —— 不是抽样
  /*
    这条断言必须覆盖全部 246 张。第一版我只抽了 8 张，正好都是 8 位的，
    于是"索引色 2 位/4 位解不了"这个缺陷被漏掉，直到渲染立绘时才炸。
    **素材格式不统一时，抽样测试等于没测。**
  */
  {
    const dir = path.join(ROOT, 'src', 'assets', 'lpc', 'parts')
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.png'))
    const fails = []
    const formats = new Map()
    for (const f of files) {
      try {
        const buf = fs.readFileSync(path.join(dir, f))
        const bd = buf[24], ct = buf[25]
        formats.set(`位深${bd}/类型${ct}`, (formats.get(`位深${bd}/类型${ct}`) || 0) + 1)
        const { width, height, rgba } = decodePng(buf)
        // 宽度必须 128（idle 表：2 帧 × 64）；高度至少 256（4 方向 × 64）。
        // 实测有 1 张是 128×320（runtime.json 也如实标注了），
        // 而合成器只取前 4 行方向帧，多出来的行不参与，所以不算缺陷。
        if (width !== 128 || height < 256 || rgba.length !== width * height * 4) {
          fails.push(`${f}:${width}x${height}`)
        }
      } catch (e) { fails.push(`${f}:${e.message}`) }
    }
    check(`能解码全部 ${files.length} 张 LPC 部件`, fails.length === 0,
      fails.length ? `${fails.length} 张失败：${fails.slice(0, 5).join(' | ')}` : '')
    console.log(`      素材格式分布：${[...formats.entries()].map(([k, v]) => `${k}×${v}`).join('  ')}`)
  }

  // 3) 构建 + 渲染
  let M
  try {
    M = await loadRender()
    check('esbuild 打包渲染入口成功', true)
  } catch (e) {
    check('esbuild 打包渲染入口成功', false, e.message)
    console.log(`\n  ${bad} 项未通过\n`)
    process.exit(1)
  }

  const url = M.mapDataUrl('forest', 'selftest', 'day')
  check('离线生成地图 dataURL', typeof url === 'string' && url.startsWith('data:image/png'), `${url.length} 字符`)
  const info = M.mapInfo('forest', 'selftest', 'day')
  check('地图尺寸 320×192', info.width === 320 && info.height === 192, `${info.width}×${info.height}`)

  const surl = await M.spriteDataUrl('selftest', '黑发束成马尾的管家，穿黑色燕尾服', { scale: 2 })
  check('离线生成立绘 dataURL', typeof surl === 'string' && surl.startsWith('data:image/png'), `${surl.length} 字符`)
  const { width, height } = decodePng(Buffer.from(surl.slice(surl.indexOf(',') + 1), 'base64'))
  check('立绘尺寸 = 64×scale', width === 128 && height === 128, `${width}×${height}`)

  // 4) 与浏览器结果对照的锚点：莫西干必须真的拿到 shorthawk
  const mo = await M.spriteDetail('mohawk', '染成亮橙色的莫西干头', { scale: 1 })
  check('莫西干头真的命中了 shorthawk 部件',
    mo.recipe.parts.some(p => /hawk|spiked/.test(p)),
    mo.recipe.parts.filter(p => /hair_/.test(p)).join(',') || '(没有发型部件)')

  console.log(`\n  ${bad === 0 ? '全部通过' : bad + ' 项未通过'}\n`)
  process.exit(bad ? 1 : 0)
}

/**
 * 与浏览器交叉验证：同一批描述，离线与 Edge/CDP 两处各跑一遍，
 * 比较 `recipeFor` 选出的**部件与配色**是否完全一致。
 *
 * 这一步是离线渲染器的"信任基石"：宿主不同（`import.meta.glob` 被替换、
 * Image 走文件系统、无 DOM），行为就可能不同。若两边选出的部件不一样，
 * 离线出的图就不是浏览器里的图，用它做美术判断会得出错误结论。
 *
 * 需要 dev server 在跑；没设 SITE 时只打印离线侧结果。
 * 实现在 `scripts/lib/xcheck-offline.mjs`（那边有完整的两侧逻辑）。
 */
async function cmdXcheck() {
  const { spawnSync } = await import('node:child_process')
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lib', 'xcheck-offline.mjs')], {
    cwd: ROOT, stdio: 'inherit',
    env: { ...process.env, SITE: argVal('site', process.env.SITE || '') },
  })
  process.exit(r.status ?? 1)
}

/**
 * 瓦片预览：把每种地形的**单个瓦片**放大排开。
 *
 * 为什么必须有它：地图 320×192、一格只有 16px，缩略之后细节全糊成
 * "一片绿"，根本判断不出某块瓦片画得好不好。而 `drawTile()` 改的
 * 正是这 16×16 —— 把它放大 8 倍单独看，问题一眼就出来。
 *
 * 每行 = 一种地形；每行 3 格 = 该地形的三套变体。
 */
async function cmdTiles() {
  const M = await loadRender()
  const only = argVal('kinds')
  const kinds = only ? only.split(',') : M.TILE_KINDS
  const scale = Number(argVal('scale', '6'))
  const phase = argVal('phase', 'day')

  const cells = []
  for (const k of kinds) {
    for (const url of M.tileVariantUrls(k, phase, scale)) cells.push({ src: url })
  }

  const size = 16 * scale
  const file = path.join(OUT, 'offline-tiles.png')
  fs.writeFileSync(file, contactSheet(cells, { cols: 3, cellW: size, cellH: size, gap: 6 }))
  console.log(`\n=== 瓦片预览（单格放大 ${scale} 倍，时段 ${phase}）===`)
  console.log(`  ${kinds.length} 种地形 × 3 套变体 = ${cells.length} 格`)
  console.log(`  行 = ${kinds.join(', ')}`)
  report(file, '每行 3 格是同一地形的三套变体 —— 应当能看出随机差异，但不能像三种不同材质')
  void phase
}

/**
 * 放大对比：把同一张地图按 1× / 2× / 3× 并排输出。
 *
 * 为什么要并排：只看放大图会被骗（放大后细节都看得见，容易高估效果），
 * 只看 1:1 又看不清细节。而地图逻辑分辨率就是 320×192 ——
 * **最左边那格才是玩家实际看到的尺寸**，任何改动都要在那里站得住。
 */
async function cmdZoom() {
  const M = await loadRender()
  const arch = argVal('archetype', 'forest')
  const phase = argVal('phase', 'day')
  const url = M.mapDataUrl(arch, argVal('seed', 'zoom-check'), phase)
  const { width, height, rgba } = decodePng(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'))

  const SCALES = [1, 2, 3]
  const gap = 8
  const cols = SCALES.map(s => ({ s, w: width * s, h: height * s }))
  const maxH = Math.max(...cols.map(c => c.h))
  const W = cols.reduce((n, c) => n + c.w, 0) + gap * (cols.length - 1)
  const H = maxH
  const px = Buffer.alloc(W * H * 4)
  for (let i = 0; i < W * H; i++) { px[i * 4] = 24; px[i * 4 + 1] = 24; px[i * 4 + 2] = 28; px[i * 4 + 3] = 255 }

  let x0 = 0
  for (const c of cols) {
    const y0 = Math.floor((maxH - c.h) / 2)
    for (let y = 0; y < c.h; y++) {
      for (let x = 0; x < c.w; x++) {
        const s = (Math.floor(y / c.s) * width + Math.floor(x / c.s)) * 4
        const tx = x0 + x, ty = y0 + y
        if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue
        const d = (ty * W + tx) * 4
        px[d] = rgba[s]; px[d + 1] = rgba[s + 1]; px[d + 2] = rgba[s + 2]; px[d + 3] = 255
      }
    }
    x0 += c.w + gap
  }

  const file = path.join(OUT, `zoom-${arch}.png`)
  fs.writeFileSync(file, encodePng(W, H, px))
  console.log(`\n=== 放大对比（${arch} / ${phase}）===`)
  console.log(`  ${cols.map(c => `${c.s}×（${c.w}×${c.h}）`).join('  ')}`)
  report(file, `最左 = 玩家实际看到的尺寸（地图逻辑分辨率 ${width}×${height}）`)
}

/**
 * 全量立绘审计：把**所有内置世界的角色卡**跑一遍，出对照图 + 可机检矛盾计数。
 *
 * 用途：玩家反馈"立绘和描述对不上"时，**不要只修他截到的那两个**——
 * 根因通常在词表覆盖不足，只修个例还会继续冒出来。
 * 拿全量语料跑一遍才能看出覆盖面（实现在 scripts/lib/audit-sprites.mjs）。
 */
async function cmdAudit() {
  const { spawnSync } = await import('node:child_process')
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lib', 'audit-sprites.mjs')], {
    cwd: ROOT, stdio: 'inherit',
  })
  process.exit(r.status ?? 1)
}

const CMDS = {
  map: cmdMap, sprites: cmdSprites, sprite: cmdSprite,
  selftest: cmdSelftest, xcheck: cmdXcheck, tiles: cmdTiles, zoom: cmdZoom,
  audit: cmdAudit,
}

if (!CMDS[COMMAND]) {
  console.error(`✗ 未知命令：${COMMAND}`)
  console.error(`  可用：${Object.keys(CMDS).join(' / ')}`)
  process.exit(1)
}
await CMDS[COMMAND]()
