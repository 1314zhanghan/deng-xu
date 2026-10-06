/**
 * RPG 地图式场景背景。
 *
 * 为什么要重做：
 *  原来的场景是"远景剪影"（天空 + 远山 + 中景 + 近景三层色块），
 *  它适合当插画背景，但玩家反馈「割裂且意义不明」—— 因为色块之间没有
 *  可辨认的语义：看不出那是路、那是屋顶、那是水。而且它不随游戏内时间变化，
 *  想知道"现在是白天还是夜里"必须打开上边栏看钟。
 *
 * 现在改成 **RPG 俯瞰瓦片地图**：
 *  - 一格一格的草地/道路/水面/屋顶/树干，形状可辨认（玩家一眼知道在什么地形）
 *  - **白天/夜晚两套材质色**：夜里整体压暗偏蓝紫 + 窗户与路灯亮起暖光，
 *    不用看钟就能感到时间变化
 *  - 同一 archetype 用不同 seed 生成不同布局（每次进同一类场景不会一模一样）
 *
 * 实现上用**瓦片贴图缓存**：每种地形先生成 1 张 16×16 的贴图（含 3 个变体），
 * 再按地图铺上去。直接逐像素画整张图会慢十几倍，而在 React 里重绘会卡。
 */
import type { RGB } from '@/utils/sceneArt'
import { paletteForPhase, phaseLightsOn, dayPhase, phaseLabel, type DayPhase, shade, glow, type MapPalette, type MaterialRamp } from '@/utils/mapPalette'

/** 转出时段接口，调用方不必再从 mapPalette 单独 import */
export { dayPhase, phaseLabel, type DayPhase }

/** 一格 16px，整图 20×12 格 = 320×192，再整数放大 */
export const TILE = 16
export const MAP_COLS = 20
export const MAP_ROWS = 12
const W = TILE * MAP_COLS
const H = TILE * MAP_ROWS

// ============================================================================
// 直接存 RGB 的画布（场景色板是材质色，不属于任何一条索引斜坡）
// ============================================================================

class RgbCanvas {
  readonly w: number
  readonly h: number
  private buf: Uint8ClampedArray

  constructor(w: number, h: number) {
    this.w = w; this.h = h
    this.buf = new Uint8ClampedArray(w * h * 3)
  }

  set(x: number, y: number, c: RGB) {
    const xi = x | 0, yi = y | 0
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return
    const i = (yi * this.w + xi) * 3
    this.buf[i] = c[0]; this.buf[i + 1] = c[1]; this.buf[i + 2] = c[2]
  }

  get(x: number, y: number): RGB {
    const i = ((y | 0) * this.w + (x | 0)) * 3
    return [this.buf[i], this.buf[i + 1], this.buf[i + 2]] as unknown as RGB
  }

  rect(x: number, y: number, w: number, h: number, c: RGB) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c)
  }

  /** 4×4 Bayer 抖动填充：像素画用它做局部过渡，而不是渐变 */
  dither(x: number, y: number, w: number, h: number, a: RGB, b: RGB, ratio = 0.5) {
    const BAY = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const t = BAY[(yy - y) & 3][(xx - x) & 3] / 16
        this.set(xx, yy, t < ratio ? a : b)
      }
    }
  }

  /** 复制另一张画布的某个区域到本画布，并整体变暗（用于夜间压暗） */
  blitFrom(src: RgbCanvas, sx: number, sy: number, dx: number, dy: number, w: number, h: number, tint?: { c: RGB; k: number }) {
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const c = src.get(sx + xx, sy + yy)
        this.set(dx + xx, dy + yy, tint ? shade(c, tint.c, tint.k) : c)
      }
    }
  }

  toDataUrl(): string {
    const cv = document.createElement('canvas')
    cv.width = this.w; cv.height = this.h
    const ctx = cv.getContext('2d')!
    const img = ctx.createImageData(this.w, this.h)
    for (let i = 0, j = 0; i < this.buf.length; i += 3, j += 4) {
      img.data[j] = this.buf[i]; img.data[j + 1] = this.buf[i + 1]
      img.data[j + 2] = this.buf[i + 2]; img.data[j + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    return cv.toDataURL('image/png')
  }
}

// ============================================================================
// 随机数（可复现：同一个 seed 永远同一张图）
// ============================================================================

function hashSeed(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h >>> 0
}
function makeRng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ============================================================================
// 地形格
// ============================================================================

export type TileKind =
  | 'grass' | 'grass2' | 'path' | 'water' | 'stone' | 'wall'
  | 'roof' | 'tree' | 'fence' | 'floor' | 'sand' | 'rock'

/** 每种地形的主题色（从 MapPalette 取） */
function rampOf(kind: TileKind, p: MapPalette): MaterialRamp {
  switch (kind) {
    case 'path': case 'floor': case 'sand': return p.path
    case 'water': return p.water
    case 'stone': case 'wall': case 'rock': return p.stone
    case 'roof': return p.roof
    case 'tree': return p.leaf
    case 'fence': return p.wood
    default: return p.ground
  }
}

/**
 * 生成一块 16×16 的瓦片贴图。
 *
 * 每块贴图用"底色 + 几粒噪点 + 边缘受光"构成 ——
 * 关键是**不能是纯色**：纯色铺满会变成一整块糊的色板，
 * 玩家认不出那是草地还是石头（这正是旧背景"意义不明"的原因之一）。
 */
function drawTile(kind: TileKind, p: MapPalette, rng: () => number): RgbCanvas {
  const c = new RgbCanvas(TILE, TILE)
  const r = rampOf(kind, p)

  c.rect(0, 0, TILE, TILE, r.mid)

  const speck = (n: number, col: RGB) => {
    for (let i = 0; i < n; i++) c.set(Math.floor(rng() * TILE), Math.floor(rng() * TILE), col)
  }

  /**
   * 一簇草/一朵花 —— 2~4 像素的**水平短线**，而不是单个像素。
   *
   * 为什么要成簇：单像素点在 16px 的瓦片里只是一个脏点，密铺之后看不出
   * "这里有簇草"，只觉得画面有噪点。凑成短线才有"一撮"的形状。
   * 这也是本轮"装饰物"的核心 —— **一格只有 16px，独立的小物件根本画不下**，
   * 装饰必须做进瓦片本身的纹理里。
   */
  const tuft = (col: RGB, lenMin = 2, lenMax = 4) => {
    const x = 1 + Math.floor(rng() * (TILE - 5))
    const y = 1 + Math.floor(rng() * (TILE - 3))
    const len = lenMin + Math.floor(rng() * (lenMax - lenMin + 1))
    c.rect(x, y, len, 1, col)
    // 半数情况再多一层，形成"小三角"而不是一根横杠
    if (rng() < 0.5) c.rect(x + 1, y + 1, Math.max(1, len - 1), 1, col)
  }

  /** 撒若干装饰（成簇） */
  const tufts = (n: number, col: RGB) => { for (let i = 0; i < n; i++) tuft(col) }

  /**
   * 变体分档。
   * ⚠️ 旧版所有变体只随机"噪点位置"，图案一模一样 ——
   * 于是同一地形铺出来毫无节奏（`grass`/`path`/`floor`/`sand` 的三套变体几乎不可分辨）。
   * 现在先摇一档，**改变装饰的密度与种类**，而不只是位置。
   */
  const tier = rng()

  switch (kind) {
    case 'grass': case 'grass2': {
      // 三档：稀疏草皮 / 密集草丛 / 带小花的草 —— 密度本身就有变化
      const dense = kind === 'grass2' || tier > 0.55
      tufts(dense ? 5 : 2, r.light)
      tufts(2, r.dark)
      speck(dense ? 6 : 3, r.dark)
      /*
        偶发小花。必须**低频**（每档只给约两成瓦片加），
        否则密铺之后整片草地像撒了糖霜 —— 点缀的关键是"少"。
      */
      if (rng() < 0.22) {
        const flower: RGB = p.lamp
        c.set(4 + Math.floor(rng() * 8), 4 + Math.floor(rng() * 8), flower)
      }
      break
    }
    case 'path': {
      if (tier < 0.34) {
        // 车辙：两条纵向浅痕
        const lx = 3 + Math.floor(rng() * 4)
        c.rect(lx, 0, 1, TILE, r.dark)
        c.rect(lx + 7, 0, 1, TILE, r.dark)
      } else if (tier < 0.67) {
        // 碎石：几粒高光碎石
        tufts(4, r.hi)
      } else {
        // 蹄印/坑洼：小暗坑
        tufts(3, r.dark)
      }
      speck(6, r.dark)
      speck(4, r.hi)
      break
    }
    case 'floor': {
      /*
        室内地板：给一条**板缝**，让它读起来是"铺过的地面"而不是"土路"。
        路径和地板原本用同一套画法（都是 speck），在俯瞰图里几乎分不清。
      */
      c.rect(0, 0, TILE, 1, r.light)
      c.rect(0, 0, 1, TILE, r.light)
      c.rect(0, 7, TILE, 1, r.dark)
      speck(5, r.dark)
      speck(3, r.hi)
      break
    }
    case 'sand': {
      // 沙：横向风纹（一层层的），比噪点更能表达"沙面"
      for (let i = 0; i < 3; i++) {
        const y = 3 + Math.floor(rng() * (TILE - 6))
        const x = Math.floor(rng() * 6)
        c.rect(x, y, 5 + Math.floor(rng() * 6), 1, r.light)
      }
      // 三档里有一档掺碎石
      if (tier > 0.7) tufts(2, r.dark)
      speck(5, r.dark)
      break
    }
    case 'water': {
      speck(4, r.dark)
      // 波纹：几条横向亮线，比噪点更能表达"这是水"
      for (let i = 0; i < 3; i++) {
        const y = 2 + Math.floor(rng() * (TILE - 4))
        const x = Math.floor(rng() * (TILE - 8))
        c.rect(x, y, 6, 1, r.hi)
      }
      // 一档加碎波：短亮线，让水面的疏密也有变化
      if (tier > 0.6) {
        for (let i = 0; i < 3; i++) {
          const y = 1 + Math.floor(rng() * (TILE - 2))
          const x = Math.floor(rng() * (TILE - 3))
          c.rect(x, y, 2, 1, r.light)
        }
      }
      break
    }
    case 'stone': {
      // 砌石：分格 + 缝隙（人工铺装）
      c.rect(0, 0, TILE, 1, r.dark)
      c.rect(0, 0, 1, TILE, r.dark)
      c.rect(0, 7, TILE, 1, r.dark)
      c.rect(7, 0, 1, 8, r.dark)
      c.rect(3, 8, 1, 8, r.dark)
      speck(6, r.light)
      break
    }
    case 'rock': {
      /*
        岩层：与砌石**分开画**。
        旧版 stone 和 rock 共用一套画法，结果"石墙"和"山岩"在俯瞰图里长得一样。
        岩层用随机走向的裂缝 + 大块明暗，读起来是天然岩面。
      */
      c.rect(0, 0, TILE, TILE, r.mid)
      // 两三块大面，做出天然岩块的明暗
      for (let i = 0; i < 3; i++) {
        const x = Math.floor(rng() * 8)
        const y = Math.floor(rng() * 8)
        const w = 4 + Math.floor(rng() * 6)
        const h = 3 + Math.floor(rng() * 5)
        c.rect(x, y, w, h, rng() < 0.5 ? r.dark : r.light)
      }
      // 裂缝：斜向短线
      for (let i = 0; i < 3; i++) {
        let x = Math.floor(rng() * TILE)
        let y = Math.floor(rng() * TILE)
        for (let k = 0; k < 5; k++) {
          c.set(x, y, r.dark)
          x += rng() < 0.5 ? 1 : 0
          y += 1
          if (x >= TILE || y >= TILE) break
        }
      }
      speck(5, r.hi)
      break
    }
    case 'wall': {
      c.rect(0, 0, TILE, TILE, r.mid)
      // 砖缝
      c.rect(0, 5, TILE, 1, r.dark)
      c.rect(0, 11, TILE, 1, r.dark)
      c.rect(5, 0, 1, 5, r.dark)
      c.rect(11, 6, 1, 5, r.dark)
      c.rect(5, 12, 1, 4, r.dark)
      c.rect(0, 0, TILE, 1, r.light)
      break
    }
    case 'roof': {
      // 瓦片：一条条横向排列，右端留高光
      c.rect(0, 0, TILE, TILE, r.mid)
      for (let y = 0; y < TILE; y += 4) {
        c.rect(0, y, TILE, 1, r.dark)
        c.rect(0, y + 1, TILE, 1, r.light)
      }
      speck(4, r.dark)
      break
    }
    case 'tree': {
      /*
        树冠。
        
        ⚠️ 旧版是"按到中心的距离分 4 档上色" —— 画出来是一个**正圆bullseye**，
        密铺之后整片森林像一串珠子/圆环，完全没有树的感觉
        （这是森林场景最主要的观感短板，靠 `render-offline.mjs tiles`
        把单格放大 7 倍才看清）。
        
        改成**轮廓扰动的不规则团块**：先按角度定一圈半径，再按半径分档上色，
        这样外形是手绘感的、不是几何圆。要点：
          · 半径差异要够大（0.60~1.0），否则扰动看不出来，还是圆
          · 底边压暗 + 右侧偏亮 —— 与地图统一的"右上受光"一致
          · 加树干，让"这是树"而不是"这是灌木丛"更明确
          · 三套变体在**大小**上也要分档，否则同一地形铺出来毫无节奏
      */
      c.rect(0, 0, TILE, TILE, p.ground.mid)

      const tier = rng()
      /*
        三套变体按"树形"分档，而不是只改半径 ——
        只改半径的话三棵树看起来仍是同一棵（第一版就是这样，三种轮廓几乎重合）。
        这里给三种明显不同的形状：圆冠小树 / 高冠大树 / 扁冠矮树。
      */
      const shape = tier < 0.34
        ? { baseR: 4.4, cy: 7.0, squash: 1.0, trunkTop: 10 }
        : tier < 0.68
          ? { baseR: 6.2, cy: 6.6, squash: 1.0, trunkTop: 10 }
          : { baseR: 4.8, cy: 7.8, squash: 1.35, trunkTop: 10 }

      const ANG = 20
      const raw: number[] = []
      for (let i = 0; i < ANG; i++) raw.push(shape.baseR * (0.72 + 0.28 * rng()))
      /*
        平滑两轮。
        不平滑的话每个角度独立取半径，轮廓会到处冒 1 像素的尖刺
        （第一版就是这样：远看像毛球而不是树冠）。平滑之后是"几个圆弧拼成的团块"。
      */
      const radii = raw.slice()
      for (let pass = 0; pass < 2; pass++) {
        const prev = radii.slice()
        for (let i = 0; i < ANG; i++) radii[i] = (prev[(i - 1 + ANG) % ANG] + prev[i] * 2 + prev[(i + 1) % ANG]) / 4
      }

      // 树下投影：统一偏右下，和地图的受光方向一致
      c.dither(4, 12, 9, 3, p.ground.mid, p.ground.dark, 0.45)

      /** 抖动边的阈值 —— 与角度分档粗细挂钩，分得越细每档越窄 */
      const dsp = (1 - Math.cos(Math.PI / ANG)) / 3

      const top = Math.max(0, Math.floor(shape.cy - shape.baseR * 1.15))
      for (let y = top; y < shape.trunkTop + 1; y++) {
        for (let x = 1; x < TILE - 1; x++) {
          const dx = x - 7.5
          const dy = (y - shape.cy) / shape.squash
          const d = Math.hypot(dx, dy)
          let a = Math.atan2(dy, dx)
          if (a < 0) a += Math.PI * 2
          const R = radii[Math.floor((a / (Math.PI * 2)) * ANG) % ANG]
          if (d > R) continue
          // 左侧压暗、右侧点亮，底边再压一档 —— 像素画靠这几档做出体积
          let col: RGB
          if (d > R - 1.25) col = r.dark
          else if (dy > 0.9 && d > R * 0.6) col = r.dark
          else if (d > R * 0.7) col = r.mid
          else if (dx < -1.2) col = r.light
          else col = (dx > 1.2 ? r.hi : r.light)
          // 抖动边：等值线附近按 Bayer 矩阵替换成邻近色，消掉硬邦邦的边缘
          if (d > R - 1.15 && dsp > ((x + y * 3) % 4) / 4) col = r.mid
          c.set(x, y, col)
        }
      }
      // 树干：树冠下缘再画 2 格深木色，让它在草地/石地上都立得住
      c.rect(7, shape.trunkTop, 2, 3, p.wood.dark)
      c.set(7, shape.trunkTop, p.wood.mid)
      break
    }
    case 'fence': {
      c.rect(0, 0, TILE, TILE, p.ground.mid)
      c.rect(2, 3, TILE - 4, 2, r.mid)
      c.rect(2, 9, TILE - 4, 2, r.mid)
      c.rect(3, 1, 2, TILE - 2, r.light)
      c.rect(11, 1, 2, TILE - 2, r.light)
      c.rect(1, 2, 1, TILE - 4, r.dark)
      break
    }
  }
  return c
}

// ============================================================================
// archetype → 地图布局
// ============================================================================

export type MapArchetype =
  | 'interior' | 'street' | 'forest' | 'mountain'
  | 'coast' | 'ruins' | 'underground' | 'sky' | 'night'

/** 把布局描述成"每格是什么" */
type Layout = TileKind[][]

function blank(kind: TileKind): Layout {
  return Array.from({ length: MAP_ROWS }, () => Array.from({ length: MAP_COLS }, () => kind))
}

/** 铺一片矩形 */
function fillRect(m: Layout, x: number, y: number, w: number, h: number, k: TileKind) {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      if (yy >= 0 && yy < MAP_ROWS && xx >= 0 && xx < MAP_COLS) m[yy][xx] = k
    }
  }
}

/**
 * 每个 archetype 的布局。
 *
 * `variant` 用来在同一地形里换不同构图：同一个世界反复进"街道"时，
 * 如果每次都是同一张图，玩家很快就会看出"这不就是那张背景吗"。
 * 具体用哪一版由 seed 决定（`variant = hash % 套数`），
 * 所以同一个场景 id 仍然稳定，不同场景/不同世界会得到不同布局。
 *
 * 布局刻意**不对称、不居中**：旧的远景图之所以"割裂"，
 * 一部分原因是所有场景都是"天空/山/地"三条横带，看起来像同一张图换了颜色。
 * 俯瞰地图用建筑位置、道路走向、水面形状来区分场景。
 */
function buildLayout(a: MapArchetype, rng: () => number, variant: number): Layout {
  const m = blank('grass')
  const v = ((variant % 3) + 3) % 3

  switch (a) {
    case 'street': {
      if (v === 0) {
        // 主街贯通 + 两侧房屋
        fillRect(m, 8, 0, 4, MAP_ROWS, 'path')
        fillRect(m, 0, 6, MAP_COLS, 3, 'path')
        for (const [x, y, w, h] of [[1, 1, 5, 4], [13, 2, 6, 3], [2, 9, 5, 2], [14, 9, 5, 2]] as const) {
          fillRect(m, x, y, w, h, 'roof')
          fillRect(m, x, y + h - 1, w, 1, 'wall')
        }
        m[5][7] = 'tree'; m[5][12] = 'tree'; m[10][7] = 'tree'
        m[5][6] = 'fence'
      } else if (v === 1) {
        // 十字路口 + 广场
        fillRect(m, 6, 0, 5, MAP_ROWS, 'path')
        fillRect(m, 0, 4, MAP_COLS, 4, 'path')
        fillRect(m, 7, 4, 3, 4, 'stone')          // 广场铺石
        for (const [x, y, w, h] of [[1, 1, 4, 2], [1, 9, 4, 2], [15, 1, 4, 2], [15, 9, 4, 2]] as const) {
          fillRect(m, x, y, w, h, 'roof')
          fillRect(m, x, y + h - 1, w, 1, 'wall')
        }
        m[4][9] = 'tree'; m[8][10] = 'tree'
      } else {
        // 沿河街道：一侧是水
        fillRect(m, 0, 8, MAP_COLS, 4, 'water')
        fillRect(m, 0, 6, MAP_COLS, 2, 'path')
        for (const [x, y, w, h] of [[2, 1, 4, 4], [8, 2, 5, 3], [15, 1, 4, 4]] as const) {
          fillRect(m, x, y, w, h, 'roof')
          fillRect(m, x, y + h - 1, w, 1, 'wall')
        }
        fillRect(m, 7, 6, 2, 3, 'fence')            // 小码头
        m[5][14] = 'tree'
      }
      break
    }
    case 'forest': {
      const pathStart = v === 0 ? 2 : v === 1 ? 16 : 9
      let x = pathStart
      for (let y = 0; y < MAP_ROWS; y++) {
        fillRect(m, x, y, 3, 1, 'path')
        x += Math.round((rng() - 0.5) * 2)
        x = Math.max(1, Math.min(MAP_COLS - 4, x))
      }
      // v1 是林间空地：中间少放树
      const clearing = v === 1
      for (let y = 0; y < MAP_ROWS; y++) {
        for (let xx = 0; xx < MAP_COLS; xx++) {
          if (m[y][xx] === 'path') continue
          if (clearing && Math.hypot(xx - 10, (y - 6) * 1.4) < 4.5) continue
          if (rng() < (v === 2 ? 0.68 : 0.55)) m[y][xx] = 'tree'
        }
      }
      if (v === 2) { m[9][4] = 'rock'; m[3][15] = 'rock' }
      break
    }
    case 'mountain': {
      fillRect(m, 0, 0, MAP_COLS, MAP_ROWS, 'rock')
      if (v === 0) {
        fillRect(m, 2, 10, 6, 2, 'path'); fillRect(m, 6, 6, 2, 6, 'path')
        fillRect(m, 8, 4, 6, 2, 'path'); fillRect(m, 12, 1, 2, 5, 'path')
      } else if (v === 1) {
        // 环形盘山道
        fillRect(m, 3, 3, 14, 2, 'path'); fillRect(m, 3, 8, 14, 2, 'path')
        fillRect(m, 3, 3, 2, 7, 'path'); fillRect(m, 16, 3, 1, 7, 'path')
        fillRect(m, 9, 5, 2, 3, 'path')
      } else {
        // 山谷：中间一条河，两侧是路
        fillRect(m, 9, 0, 3, MAP_ROWS, 'water')
        fillRect(m, 5, 0, 3, MAP_ROWS, 'path')
        fillRect(m, 13, 0, 3, MAP_ROWS, 'path')
      }
      for (let i = 0; i < 16; i++) {
        const rx = Math.floor(rng() * MAP_COLS), ry = Math.floor(rng() * MAP_ROWS)
        if (m[ry][rx] === 'rock') m[ry][rx] = 'stone'
      }
      m[3][16] = 'tree'; m[8][3] = 'tree'; m[1][5] = 'tree'
      break
    }
    case 'coast': {
      fillRect(m, 0, 0, MAP_COLS, MAP_ROWS, 'sand')
      const shore = v === 0 ? 7 : v === 1 ? 5 : 9
      fillRect(m, 0, shore, MAP_COLS, MAP_ROWS - shore, 'water')
      for (let xx = 0; xx < MAP_COLS; xx++) {
        const j = Math.round(rng() * 2) - 1
        if (j < 0) m[shore][xx] = 'sand'
        else if (j > 0 && shore > 0) m[shore - 1][xx] = 'water'
      }
      if (v === 0) {
        fillRect(m, 9, shore - 1, 2, 4, 'fence')
        fillRect(m, 4, 2, 4, 3, 'roof'); fillRect(m, 4, 4, 4, 1, 'wall')
      } else if (v === 1) {
        // 渔村：一排小屋 + 晒网
        for (const [x, y, w, h] of [[2, 1, 4, 2], [8, 1, 4, 2], [15, 1, 4, 2]] as const) {
          fillRect(m, x, y, w, h, 'roof'); fillRect(m, x, y + h - 1, w, 1, 'wall')
        }
        fillRect(m, 6, 4, 3, 1, 'fence'); fillRect(m, 12, 4, 3, 1, 'fence')
      } else {
        // 礁石海岸
        for (let i = 0; i < 14; i++) {
          const rx = Math.floor(rng() * MAP_COLS), ry = shore + Math.floor(rng() * (MAP_ROWS - shore))
          if (m[ry] && m[ry][rx] === 'water') m[ry][rx] = 'rock'
        }
        m[2][15] = 'tree'
      }
      break
    }
    case 'ruins': {
      fillRect(m, 0, 0, MAP_COLS, MAP_ROWS, 'grass2')
      if (v === 0) {
        fillRect(m, 3, 2, 12, 1, 'wall'); fillRect(m, 3, 2, 1, 7, 'wall')
        fillRect(m, 14, 2, 1, 5, 'wall'); fillRect(m, 3, 8, 7, 1, 'wall')
        fillRect(m, 8, 4, 5, 4, 'floor')
      } else if (v === 1) {
        // 倒塌的塔基：环形断墙
        for (let a2 = 0; a2 < 32; a2++) {
          const ang = (a2 / 32) * Math.PI * 2
          const rx = Math.round(10 + Math.cos(ang) * 6), ry = Math.round(6 + Math.sin(ang) * 4)
          if (rx >= 0 && rx < MAP_COLS && ry >= 0 && ry < MAP_ROWS) {
            if (a2 % 7 !== 0) m[ry][rx] = 'wall'      // 留缺口，显得破败
          }
        }
        fillRect(m, 8, 5, 5, 3, 'floor')
      } else {
        // 废弃市集：零散摊位
        for (const [x, y] of [[4, 3], [10, 2], [15, 4], [6, 7], [12, 8]] as const) {
          fillRect(m, x, y, 3, 1, 'wall'); m[y + 1][x + 1] = 'stone'
        }
        fillRect(m, 8, 5, 4, 3, 'floor')
      }
      for (let i = 0; i < 20; i++) {
        const rx = 2 + Math.floor(rng() * 16), ry = 1 + Math.floor(rng() * 9)
        if (m[ry][rx] === 'grass2') m[ry][rx] = 'stone'
      }
      m[1][17] = 'tree'; m[10][2] = 'tree'
      break
    }
    case 'interior': {
      fillRect(m, 0, 0, MAP_COLS, MAP_ROWS, 'floor')
      fillRect(m, 0, 0, MAP_COLS, 1, 'wall')
      fillRect(m, 0, MAP_ROWS - 1, MAP_COLS, 1, 'wall')
      fillRect(m, 0, 0, 1, MAP_ROWS, 'wall')
      fillRect(m, MAP_COLS - 1, 0, 1, MAP_ROWS, 'wall')
      if (v === 0) {
        m[0][9] = 'floor'; m[0][10] = 'floor'
        fillRect(m, 3, 3, 3, 2, 'stone'); fillRect(m, 14, 3, 3, 2, 'stone')
        fillRect(m, 3, 8, 4, 1, 'stone'); fillRect(m, 15, 8, 2, 2, 'stone')
        fillRect(m, 8, 5, 4, 2, 'roof')            // 地毯
      } else if (v === 1) {
        // 长厅：两侧列柱 + 尽头高台
        m[0][6] = 'floor'; m[MAP_ROWS - 1][14] = 'floor'
        for (let yy = 3; yy < 9; yy += 2) { m[yy][5] = 'stone'; m[yy][14] = 'stone' }
        fillRect(m, 15, 4, 4, 4, 'roof')
        fillRect(m, 8, 5, 4, 2, 'roof')
      } else {
        // 居所：多个小房间
        m[0][3] = 'floor'; m[0][15] = 'floor'
        fillRect(m, 9, 1, 1, 5, 'wall'); fillRect(m, 9, 8, 1, 3, 'wall')
        fillRect(m, 2, 5, 5, 1, 'wall'); fillRect(m, 12, 5, 6, 1, 'wall')
        fillRect(m, 3, 2, 2, 2, 'stone'); fillRect(m, 15, 2, 2, 2, 'stone')
        fillRect(m, 3, 8, 3, 2, 'stone'); fillRect(m, 14, 8, 3, 2, 'stone')
      }
      break
    }
    case 'underground': {
      fillRect(m, 0, 0, MAP_COLS, MAP_ROWS, 'rock')
      const cx0 = v === 0 ? 10 : v === 1 ? 6 : 14
      for (let y = 1; y < MAP_ROWS - 1; y++) {
        for (let x = 1; x < MAP_COLS - 1; x++) {
          const d = Math.hypot(x - cx0, (y - 6) * 1.4)
          if (d < 6.5 + rng() * 1.2) m[y][x] = 'floor'
        }
      }
      if (v === 0) fillRect(m, 2, 9, 4, 2, 'water')
      else if (v === 1) fillRect(m, 14, 2, 4, 3, 'water')
      else { fillRect(m, 3, 3, 3, 2, 'water'); fillRect(m, 14, 8, 3, 2, 'water') }
      for (let i = 0; i < 10; i++) m[1 + Math.floor(rng() * 10)][1 + Math.floor(rng() * 18)] = 'stone'
      break
    }
    case 'sky': {
      fillRect(m, 0, 0, MAP_COLS, MAP_ROWS, 'rock')
      if (v === 0) {
        fillRect(m, 3, 4, 14, 4, 'stone')
        fillRect(m, 5, 3, 3, 1, 'wall'); fillRect(m, 12, 3, 3, 1, 'wall')
        fillRect(m, 8, 8, 4, 2, 'wall')
      } else if (v === 1) {
        // 环形空间站
        for (let a2 = 0; a2 < 40; a2++) {
          const ang = (a2 / 40) * Math.PI * 2
          const rx = Math.round(10 + Math.cos(ang) * 7), ry = Math.round(6 + Math.sin(ang) * 4)
          if (rx >= 0 && rx < MAP_COLS && ry >= 0 && ry < MAP_ROWS) m[ry][rx] = 'stone'
        }
        fillRect(m, 9, 5, 3, 3, 'wall')
      } else {
        // 长条形舰体
        fillRect(m, 2, 5, 16, 3, 'stone')
        fillRect(m, 4, 4, 3, 1, 'wall'); fillRect(m, 13, 4, 3, 1, 'wall')
        fillRect(m, 9, 8, 3, 2, 'wall')
      }
      for (let i = 0; i < 30; i++) {
        const rx = Math.floor(rng() * MAP_COLS), ry = Math.floor(rng() * MAP_ROWS)
        if (m[ry][rx] === 'rock') m[ry][rx] = rng() < 0.5 ? 'floor' : 'stone'
      }
      break
    }
    case 'night': {
      fillRect(m, 0, 0, MAP_COLS, MAP_ROWS, 'grass2')
      if (v === 0) {
        fillRect(m, 0, 7, MAP_COLS, 3, 'path')
        for (const [x, y, w, h] of [[2, 2, 5, 4], [9, 1, 6, 4], [15, 3, 4, 3], [3, 10, 5, 2], [12, 10, 6, 2]] as const) {
          fillRect(m, x, y, w, h, 'roof'); fillRect(m, x, y + h - 1, w, 1, 'wall')
        }
      } else if (v === 1) {
        // 夜里的小巷：窄而密
        fillRect(m, 4, 0, 2, MAP_ROWS, 'path'); fillRect(m, 13, 0, 2, MAP_ROWS, 'path')
        for (const [x, y, w, h] of [[0, 1, 4, 4], [6, 2, 7, 3], [15, 1, 5, 4], [6, 8, 7, 3], [0, 8, 4, 3]] as const) {
          fillRect(m, x, y, w, h, 'roof'); fillRect(m, x, y + h - 1, w, 1, 'wall')
        }
      } else {
        // 野外的篝火营地
        fillRect(m, 6, 4, 8, 5, 'path')
        for (const [x, y] of [[3, 2], [16, 3], [4, 9], [15, 9]] as const) {
          fillRect(m, x, y, 2, 2, 'roof'); fillRect(m, x, y + 1, 2, 1, 'wall')
        }
        m[6][10] = 'stone'; m[6][11] = 'stone'
      }
      m[2][6] = 'tree'; m[9][6] = 'tree'; m[1][15] = 'tree'
      break
    }
  }
  return m
}

/** 需要给窗户点灯的格子（夜间） */
function windowTiles(m: Layout): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let y = 0; y < MAP_ROWS; y++) {
    for (let x = 0; x < MAP_COLS; x++) {
      if (m[y][x] !== 'wall') continue
      // 墙上每隔几格开一扇亮窗
      if ((x + y) % 3 === 0) out.push([x, y])
    }
  }
  return out
}

// ============================================================================
// 对外
// ============================================================================

export interface GeneratedMap {
  dataUrl: string
  width: number
  height: number
  night: boolean
  /** 时段（清晨/白天/黄昏/夜）—— 决定材质配色与是否点灯 */
  phase: DayPhase
  /** 画的是哪种地形，便于调试与自动化测试 */
  archetype: MapArchetype
}

const MAP_CACHE = new Map<string, GeneratedMap>()

/**
 * 生成（或取缓存）一张 RPG 地图背景。
 *
 * @param archetype 地形
 * @param seed      布局种子（同一个 id 每次同一张图）
 * @param phase     时段 —— 决定材质配色与是否点灯
 */
export function generateMap(archetype: MapArchetype, seed: string, phase: DayPhase): GeneratedMap {
  const key = `${archetype}|${seed}|${phase}`
  const hit = MAP_CACHE.get(key)
  if (hit) return hit

  const p = paletteForPhase(phase)
  const night = phase === 'night'
  const lightsOn = phaseLightsOn(phase)
  const rng = makeRng(hashSeed(key))
  // 布局版本由 seed 决定：同一场景稳定，不同场景/世界会换构图
  const variant = hashSeed(`v:${seed}`) % 3
  const layout = buildLayout(archetype, rng, variant)

  /*
    瓦片贴图缓存：每种地形先画 3 个变体，再按地图铺。
    逐个格子现画会让整图生成慢十几倍（20×12=240 格 × 256 像素），
    而这是在 React 渲染路径里跑的。
  */
  const variants = 3
  const bank = new Map<string, RgbCanvas[]>()
  const kinds = new Set<TileKind>()
  for (const row of layout) for (const k of row) kinds.add(k)
  // 栅栏/码头用到的 wood 也补上
  kinds.add('fence')
  for (const k of kinds) {
    const arr: RgbCanvas[] = []
    for (let v = 0; v < variants; v++) arr.push(drawTile(k, p, makeRng(hashSeed(`${k}#${v}`))))
    bank.set(k, arr)
  }

  const canvas = new RgbCanvas(W, H)

  /*
    铺底：用**地表色**而不是天空色。
    地图是俯瞰视图，没有"天空"这种东西；外围露出天蓝色会让人以为
    地图被裁掉了一块（我第一版就是天空色，看起来像图片损坏）。
    天空色只留给 `sky`（高空/太空）那一个地形。
  */
  const baseKind: TileKind = archetype === 'sky' ? 'rock' : 'grass'
  canvas.rect(0, 0, W, H, archetype === 'sky' ? p.stone.dark : rampOf(baseKind, p).dark)

  /*
    铺底。
    `chosen` 记下每格实际用了哪一个变体 —— 后面重新叠物件时必须用**同一个**变体，
    否则轮廓会与底下的那一次不一致（出现"半个树冠"）。
  */
  const chosen: number[][] = []
  for (let y = 0; y < MAP_ROWS; y++) {
    chosen.push([])
    for (let x = 0; x < MAP_COLS; x++) {
      const kind = layout[y][x]
      const arr = bank.get(kind)!
      const v = Math.floor(rng() * variants) % variants
      chosen[y].push(v)
      canvas.blitFrom(arr[v], 0, 0, x * TILE, y * TILE, TILE, TILE)
    }
  }

  /*
    ── 地形过渡 ──
    铺完之后，相邻两种地形直接相接是一条硬边（"草地突然变石板"），
    这是上一版读图时最扎眼的问题之一。

    做法：给每一对相邻地形预生成一面"过渡条"贴图 ——
    在 5px 内用 4×4 抖动把 A 逐渐换成 B，然后把两格相接处的这一条
    叠上去。抖动而不是渐变，是因为像素画里渐变会糊成一条脏边。

    两个要点：
      1. **只给"地表"做过渡**。树/墙/屋顶/栅栏/岩石是**立体物件**，
         不是地表 —— 给它们做过渡会让"树"沿着草地边缘糊成一片绿色，
         物体轮廓反而没了。所以 TR_BLENDABLE 只列平面材质。
      2. 过渡必须在**所有底格铺完之后**统一叠加，否则后面的格子会把
         前面画好的过渡边盖掉。
  */
  const TR_BLENDABLE: ReadonlySet<TileKind> = new Set<TileKind>([
    'grass', 'grass2', 'path', 'floor', 'sand', 'water', 'stone',
  ])
  const TR_DEPTH = 5
  const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]
  const trCache = new Map<string, RgbCanvas>()
  /**
   * 从 a、b 两格的交界处取一条过渡：dir 决定"b 从哪一侧侵入 a"。
   *
   * ⚠️ 必须**先把 A 整格铺满**，再往上盖 B 的抖动边。
   * 第一版我只写了 "命中抖动就 set(b)"，而 RgbCanvas 的缓冲区是零填充的，
   * `blitFrom` 又是**无条件整格复制** —— 于是没命中抖动的像素写进去全是
   * 纯黑，地图上沿着水岸出现一排排黑色方块。**"没写"不等于"透明"。**
   */
  const transitionStrip = (a: TileKind, b: TileKind, dir: 'n' | 's' | 'w' | 'e') => {
    const key = `${a}>${b}|${dir}`
    const hit = trCache.get(key)
    if (hit) return hit
    const ta = drawTile(a, p, makeRng(hashSeed(`tr:${a}>${b}`)))
    const tb = drawTile(b, p, makeRng(hashSeed(`tr:${a}>${b}`)))
    const out = new RgbCanvas(TILE, TILE)
    out.blitFrom(ta, 0, 0, 0, 0, TILE, TILE)
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        // dd = 该像素距离交界边的深度
        const dd = dir === 'n' ? y : dir === 's' ? TILE - 1 - y : dir === 'w' ? x : TILE - 1 - x
        if (dd >= TR_DEPTH) continue
        // 越靠近交界，越倾向于显示 B
        const keepB = (TR_DEPTH - dd) / TR_DEPTH
        if (keepB > BAYER[y & 3][x & 3] / 16) out.set(x, y, tb.get(x, y))
      }
    }
    trCache.set(key, out)
    return out
  }

  for (let y = 0; y < MAP_ROWS; y++) {
    for (let x = 0; x < MAP_COLS; x++) {
      const a = layout[y][x]
      if (!TR_BLENDABLE.has(a)) continue
      const at = (xx: number, yy: number): TileKind | null =>
        yy < 0 || yy >= MAP_ROWS || xx < 0 || xx >= MAP_COLS ? null : layout[yy][xx]
      const paint = (b: TileKind | null, dir: 'n' | 's' | 'w' | 'e') => {
        if (!b || b === a || !TR_BLENDABLE.has(b)) return
        canvas.blitFrom(transitionStrip(a, b, dir), 0, 0, x * TILE, y * TILE, TILE, TILE)
      }
      paint(at(x, y - 1), 'n')
      paint(at(x, y + 1), 's')
      paint(at(x - 1, y), 'w')
      paint(at(x + 1, y), 'e')
    }
  }

  /*
    把**立体物件**重新盖回它自己的那一格。
    过渡条只在 5px 内混色，但它会碰到同一格里属于物件的那部分像素
    （例如树干在下方 5px 内）。重新叠一次物件贴图即可保证轮廓干净。
  */
  for (let y = 0; y < MAP_ROWS; y++) {
    for (let x = 0; x < MAP_COLS; x++) {
      const kind = layout[y][x]
      if (TR_BLENDABLE.has(kind)) continue
      const arr = bank.get(kind)!
      canvas.blitFrom(arr[chosen[y][x]], 0, 0, x * TILE, y * TILE, TILE, TILE)
    }
  }

  /*
    按**时段**调整整体明暗。
    四档而不是两档：玩家从白天直接跳到夜里是突变，而真实感受是逐渐暗下去。
    加一档黄昏之后，时间流动才有过程感。
      dawn  清晨：略压暗（天刚亮，还残留一点夜色）
      day   白天：不处理
      dusk  黄昏：压一点暗 + 偏暖（斜照的暖光）
      night 夜：压得最多 + 偏蓝紫
  */
  const dim = night ? 0.14 : phase === 'dusk' ? 0.10 : phase === 'dawn' ? 0.08 : 0
  if (dim > 0) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        canvas.set(x, y, shade(canvas.get(x, y), p.shadow, dim))
      }
    }
  }

  /*
    点灯。黄昏刚点起、清晨还亮着、白天熄灯、夜里最亮。
    为什么要"压暗 + 点灯"两件事一起做：
      只压暗会变成"白天图调暗"，没有时间感；
      亮点暖光才让人一眼看出"天黑了，屋里有人"。
  */
  if (lightsOn) {
    // 黄昏/清晨的灯比夜里含蓄一些（灯刚点起/快熄了）
    const strength = night ? 1 : 0.6
    const wins = windowTiles(layout)
    for (const [tx, ty] of wins) {
      const cx = tx * TILE + 8, cy = ty * TILE + 8
      /*
        3×3 亮窗 + 两圈光晕。
        第一版只给 2×2 + 四个点，放大到玩家屏幕后几乎看不见 ——
        场景是缩放显示的（320×192 铺满上千像素），
        单像素的光点会被插值抹掉，必须给足尺寸。
      */
      canvas.rect(cx - 1, cy - 1, 3, 3, p.lamp)
      const halo = glow(p.stone.light, p.lamp, 0.72 * strength)
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const d = Math.max(Math.abs(dx), Math.abs(dy))
          if (d === 2) canvas.set(cx + dx, cy + dy, halo)
          else if (d === 3) canvas.set(cx + dx, cy + dy, glow(p.stone.mid, p.lamp, 0.42 * strength))
          else if (d === 4) canvas.set(cx + dx, cy + dy, glow(p.stone.dark, p.lamp, 0.26 * strength))
        }
      }
    }
    // 路灯：路面上几盏，带一片地面光斑
    const lampCount = night ? 7 : 4
    for (let i = 0; i < lampCount; i++) {
      const lx = 2 + Math.floor(rng() * (MAP_COLS - 4))
      const ly = 1 + Math.floor(rng() * (MAP_ROWS - 2))
      if (!/path|floor|grass/.test(layout[ly][lx])) continue
      const cx = lx * TILE + 8, cy = ly * TILE + 8
      canvas.rect(cx, cy, 2, 2, p.lamp)
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const d = Math.max(Math.abs(dx), Math.abs(dy))
          if (d === 2) canvas.set(cx + dx, cy + dy, glow(p.path.mid, p.lamp, 0.55))
          else if (d === 3) canvas.set(cx + dx, cy + dy, glow(p.path.dark, p.lamp, 0.32))
        }
      }
    }
  }

  const out: GeneratedMap = {
    dataUrl: canvas.toDataUrl(),
    width: W,
    height: H,
    night,
    phase,
    archetype,
  }
  MAP_CACHE.set(key, out)
  return out
}

/** 场景 id → 地图地形（旧场景 id 仍然可用，只是换了画法） */
export const ARCHETYPE_TO_MAP: Record<string, MapArchetype> = {
  interior: 'interior',
  street: 'street',
  forest: 'forest',
  mountain: 'mountain',
  coast: 'coast',
  ruins: 'ruins',
  underground: 'underground',
  sky: 'sky',
  night: 'night',
}

/**
 * 时间的一句话描述，用于 UI 与测试断言。
 * 直接复用 `dayPhase` 的分界，避免两处各写一套阈值后不一致。
 */
export function timeOfDayLabel(hour: number): string {
  return phaseLabel(dayPhase(hour))
}

/** 全部地形种类（供调试工具遍历，避免工具自己维护一份可能过时的列表） */
export const TILE_KINDS: TileKind[] = [
  'grass', 'grass2', 'path', 'water', 'stone', 'wall',
  'roof', 'tree', 'fence', 'floor', 'sand', 'rock',
]

/**
 * 单格瓦片预览 —— **调试用**。
 *
 * 为什么需要它：地图是 320×192、一格只有 16px，在整张图上看
 * "某块瓦片画得对不对"根本看不出来（缩略后只剩一片颜色）。
 * 而 `drawTile()` 是逐格画的，改的正是这 16×16。
 *
 * 它走的是**和 `generateMap` 完全相同的绘制路径**（同一个 `drawTile`、
 * 同一个 `variants` 数、同一个调色板），所以预览里看到的
 * 就是真实地图里那一格的样子 —— 不是另写一份"预览专用画法"。
 *
 * @param kind  要预览的地形
 * @param phase 时段
 * @param scale 放大倍数（像素画必须整数倍）
 * @param variant 取第几个变体（0..2，与地图里的三变体一致）
 */
export function renderTilePreview(
  kind: TileKind,
  phase: DayPhase,
  scale = 8,
  variant = 0
): string {
  const p = paletteForPhase(phase)
  const v = ((variant % 3) + 3) % 3
  const tile = drawTile(kind, p, makeRng(hashSeed(`${kind}#${v}`)))

  const s = Math.max(1, Math.round(scale))
  const out = new RgbCanvas(TILE * s, TILE * s)
  for (let y = 0; y < TILE * s; y++) {
    for (let x = 0; x < TILE * s; x++) {
      out.set(x, y, tile.get(Math.floor(x / s), Math.floor(y / s)))
    }
  }
  return out.toDataUrl()
}

/** 一次性拿到某种地形三套变体的预览（便于比较"同一地形是不是长得太像"） */
export function renderTileVariants(kind: TileKind, phase: DayPhase, scale = 8): string[] {
  return [0, 1, 2].map(v => renderTilePreview(kind, phase, scale, v))
}

