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

  switch (kind) {
    case 'grass': case 'grass2': {
      speck(kind === 'grass' ? 8 : 12, r.dark)
      speck(6, r.light)
      break
    }
    case 'path': case 'floor': case 'sand': {
      speck(10, r.dark)
      speck(5, r.hi)
      // 右上受光：地图的立体感来自"统一的受光方向"
      c.rect(TILE - 1, 0, 1, TILE, r.light)
      c.rect(0, 0, TILE, 1, r.light)
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
      break
    }
    case 'stone': case 'rock': {
      // 石块：分格 + 缝隙
      c.rect(0, 0, TILE, 1, r.dark)
      c.rect(0, 0, 1, TILE, r.dark)
      c.rect(0, 7, TILE, 1, r.dark)
      c.rect(7, 0, 1, 8, r.dark)
      c.rect(3, 8, 1, 8, r.dark)
      speck(6, r.light)
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
      // 树冠：中间亮、边缘暗的团块，比纯色圆更像树
      c.rect(0, 0, TILE, TILE, p.ground.mid)   // 树下的地
      const cx = TILE / 2, cy = TILE / 2
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const d = Math.hypot(x - cx + 0.5, y - cy + 0.5)
          if (d < 3.2) c.set(x, y, r.hi)
          else if (d < 5) c.set(x, y, r.light)
          else if (d < 6.6) c.set(x, y, r.mid)
          else if (d < 7.4) c.set(x, y, r.dark)
        }
      }
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

  for (let y = 0; y < MAP_ROWS; y++) {
    for (let x = 0; x < MAP_COLS; x++) {
      const kind = layout[y][x]
      const arr = bank.get(kind)!
      const tex = arr[Math.floor(rng() * variants) % variants]
      canvas.blitFrom(tex, 0, 0, x * TILE, y * TILE, TILE, TILE)
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
