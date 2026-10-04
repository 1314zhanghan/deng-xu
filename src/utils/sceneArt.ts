/**
 * 程序化**像素风**场景背景
 *
 * 为什么重做：
 *  之前是矢量扁平风（SVG 多边形 + 径向渐变），而人物立绘是**像素风**（LPC 素材）。
 *  两者同屏时风格割裂 —— 这是整个界面最后一块明显不协调的地方。
 *
 * 像素画的关键不是"分辨率低"，而是：
 *  1. **分辨率真的低** —— 这里用 160×90，只有 14400 个像素，然后整数倍放大
 *  2. **限色板** —— 所有场景共用一套 16 色，颜色少才有像素画的统一感；
 *     矢量那种连续渐变必须换成**有序抖动（ordered dithering）**来过渡
 *  3. **硬边** —— 放大时绝不插值（imageSmoothingEnabled = false）
 *
 * 输出格式仍是 data URL，所以 SceneBackdrop 不需要改。
 */

import { getWorldTone, type WorldTone } from '@/utils/worldTone'

/** 逻辑分辨率：16:9，且 160×90 的整数倍正好是 640×360（放大 4 倍） */
const W = 160
const H = 90

export type SceneArchetype =
  | 'interior' | 'street' | 'forest' | 'mountain' | 'coast'
  | 'ruins' | 'underground' | 'sky' | 'night'

export interface SceneAsset {
  id: string
  label: string
  archetype: SceneArchetype
  /** 可选：真实图片路径。填了就优先用它，不再程序化生成 */
  image?: string
}

const ARCHETYPE_LABEL: Record<SceneArchetype, string> = {
  interior: '室内',
  street: '城镇街道',
  forest: '森林林地',
  mountain: '山岭旷野',
  coast: '海岸水边',
  ruins: '废墟遗迹',
  underground: '地下洞窟',
  sky: '高空星海',
  night: '夜晚户外',
}

export function buildSceneCatalog(): SceneAsset[] {
  const out: SceneAsset[] = []
  const archetypes = Object.keys(ARCHETYPE_LABEL) as SceneArchetype[]
  const variants = ['', '·黄昏', '·深夜']
  let i = 0
  for (const archetype of archetypes) {
    for (const v of variants) {
      out.push({ id: `s${String(i + 1).padStart(2, '0')}`, label: `${ARCHETYPE_LABEL[archetype]}${v}`, archetype })
      i++
    }
  }
  return out
}

export const SCENE_CATALOG: SceneAsset[] = buildSceneCatalog()
const SCENE_BY_ID = new Map(SCENE_CATALOG.map(s => [s.id, s]))

export function isKnownSceneId(id?: string): boolean {
  return !!id && SCENE_BY_ID.has(id)
}
export function getSceneAsset(id?: string): SceneAsset | undefined {
  return id ? SCENE_BY_ID.get(id) : undefined
}
export function sceneCatalogPrompt(): string {
  return SCENE_CATALOG.map(s => `${s.id}=${s.label}`).join('；')
}

// ============================================================================
// 限色板
// ============================================================================

/**
 * 共享色板的**默认值**。
 *
 * 注意：这里不再是唯一色板 —— 真正用的是「世界色调」提供的那一套
 * （`worldTone.ts` 的 `ramp`）。每个世界可以有自己的色调，
 * 同一张场景在不同色调下观感差别很大，这是刻意的。
 * 这个常量只作为兜底（色调数据缺失时）。
 */
export type RGB = readonly [number, number, number]

const DEFAULT_RAMP: readonly RGB[] = [
  [10, 10, 14],    // 0  最暗（暗角/剪影）
  [20, 20, 28],    // 1
  [30, 30, 42],    // 2
  [42, 42, 58],    // 3
  [56, 56, 74],    // 4
  [72, 74, 92],    // 5
  [90, 94, 112],   // 6
  [110, 116, 132], // 7
  [132, 140, 152], // 8
  [156, 164, 176], // 9
  [180, 188, 198], // 10
  [206, 212, 220], // 11
  [232, 236, 242], // 12 最亮
  [180, 140, 90],  // 13 暖（灯火）
  [220, 180, 110], // 14 暖亮
  [90, 130, 140],  // 15 冷（水/夜）
]

/** 有序抖动矩阵（4×4 Bayer）。像素画用抖动来过渡明暗，而不是渐变 */
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
]

// ============================================================================
// 像素画布
// ============================================================================

class PxCanvas {
  readonly w: number
  readonly h: number
  /** 当前使用的限色板（由世界色调决定） */
  private ramp: readonly RGB[]
  private buf: Int16Array   // 存调色板索引，-1 = 透明

  constructor(w: number, h: number, fill = 0, ramp: readonly RGB[] = DEFAULT_RAMP) {
    this.w = w
    this.h = h
    this.ramp = ramp
    this.buf = new Int16Array(w * h).fill(fill)
  }

  /** 色板长度，用于绘制时做边界裁剪 */
  get size(): number {
    return this.ramp.length
  }

  /** 取色（索引越界时夹到边界，避免读到 undefined） */
  color(ci: number): RGB {
    const i = Math.max(0, Math.min(this.ramp.length - 1, ci))
    return this.ramp[i]
  }

  set(x: number, y: number, ci: number) {
    const xi = x | 0, yi = y | 0
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return
    this.buf[yi * this.w + xi] = ci
  }

  get(x: number, y: number): number {
    const xi = x | 0, yi = y | 0
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return -1
    return this.buf[yi * this.w + xi]
  }

  /** 矩形填充 */
  rect(x: number, y: number, w: number, h: number, ci: number) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, ci)
  }

  /**
   * 抖动竖向渐变：在 y0..y1 之间从 c0 过渡到 c1。
   * 像素画不画连续渐变 —— 用 Bayer 抖动混合两个索引色来造成"过渡"的错觉。
   */
  ditherV(x: number, y0: number, y1: number, w: number, c0: number, c1: number) {
    const span = Math.max(1, y1 - y0)
    for (let y = y0; y < y1; y++) {
      const t = (y - y0) / span
      for (let xx = x; xx < x + w; xx++) {
        const threshold = (BAYER[(y & 3)][(xx + (x & 3)) & 3] + 0.5) / 16
        this.set(xx, y, t > threshold ? c1 : c0)
      }
    }
  }

  /** 画一条山脊/地形线：给定每列高度，填到指定基线 */
  terrainFromProfile(profile: (x: number) => number, baselineY: number, ci: number) {
    for (let x = 0; x < this.w; x++) {
      const top = Math.max(0, Math.min(baselineY, profile(x) | 0))
      for (let y = top; y < baselineY; y++) this.set(x, y, ci)
    }
  }

  /** 转成 ImageData（查当前色板） */
  toImageData(): ImageData {
    const data = new Uint8ClampedArray(this.w * this.h * 4)
    for (let i = 0; i < this.buf.length; i++) {
      const ci = this.buf[i]
      const o = i * 4
      if (ci < 0) { data[o + 3] = 0; continue }
      const c = this.color(ci)
      data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255
    }
    return new ImageData(data, this.w, this.h)
  }
}

// ============================================================================
// 场景绘制
// ============================================================================

function hashSeed(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) { h ^= input.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h >>> 0
}
function makeRng(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

/**
 * 各原型的明暗基调（在共享色板里选哪几档）。
 *
 * ⚠️ 这里踩过一个坑，别再犯：
 * 第一版把所有原型都压在 0–4 档（例如 sky:[1,2] far:2 mid:3 near:4），
 * 而调色板 0–4 档是 [10,10,14]→[56,56,74]，在屏幕上几乎是同一个颜色 ——
 * 结果山、树、楼、柱全糊成一块灰，9 个原型看起来一模一样。
 *
 * 规则：**同一个场景内，至少要有 5 档以上的明度跨度**，
 * 而且"远/中/近"三层要能一眼分开（远最亮、近最暗，形成空气透视）。
 */
const TONE: Record<SceneArchetype, { sky: [number, number]; far: number; mid: number; near: number }> = {
  // 室内：墙中等亮、地板暗，靠窗光提对比
  interior: { sky: [1, 3], far: 4, mid: 6, near: 3 },
  // 街道：远景楼比地面亮（远处有雾气/灯光），近地面压暗
  street: { sky: [0, 3], far: 3, mid: 7, near: 4 },
  // 森林：树冠中等偏暗，近处树干压到最暗
  forest: { sky: [2, 5], far: 5, mid: 4, near: 2 },
  // 山：典型的空气透视 —— 远山最亮，近山最暗
  mountain: { sky: [1, 5], far: 8, mid: 5, near: 3 },
  // 海岸：天最亮，水面中等
  coast: { sky: [2, 6], far: 7, mid: 15, near: 4 },
  // 废墟：石柱偏亮，地面暗
  ruins: { sky: [2, 5], far: 6, mid: 8, near: 3 },
  // 地下：整体最暗，只有微光一处亮
  underground: { sky: [0, 1], far: 4, mid: 2, near: 1 },
  // 高空：星空最暗，行星中亮，舰体剪影最暗
  sky: { sky: [0, 2], far: 5, mid: 7, near: 1 },
  // 夜晚：天最暗，楼中等，屋顶剪影压黑
  night: { sky: [0, 1], far: 3, mid: 5, near: 1 },
}

function drawScene(
  archetype: SceneArchetype,
  seed: number,
  accentWarm: boolean,
  ramp: readonly RGB[]
): PxCanvas {
  const rng = makeRng(seed)
  const px = new PxCanvas(W, H, 0, ramp)
  const t = TONE[archetype]
  const horizon = Math.round(H * (0.55 + rng() * 0.1))

  /*
    天空：**主体用实色**，只在接近地平线的一小段做抖动过渡。
    第一版把整个天空都 ditherV（0→horizon），结果满屏网点、什么形状都看不见 ——
    像素画的抖动是**局部过渡技巧**，不是大面积填充手段。
  */
  px.rect(0, 0, W, horizon, t.sky[0])
  const bandTop = Math.max(0, horizon - 14)
  px.ditherV(0, bandTop, horizon, W, t.sky[0], t.sky[1])

  const lit = accentWarm ? 14 : 15

  const drawMountains = (ci: number, base: number, amp: number) => {
    const step = 7 + Math.floor(rng() * 7)
    const heights: number[] = []
    let y = base - amp * 0.7
    for (let x = 0; x < W; x++) {
      if (x % step === 0) y = base - amp * (0.4 + rng() * 0.9)
      heights.push(y)
    }
    for (let i = 1; i < W - 1; i++) heights[i] = (heights[i - 1] + heights[i] * 2 + heights[i + 1]) / 4
    px.terrainFromProfile(x => heights[x], H, ci)
    return heights
  }

  const drawTrees = (ci: number, base: number, count: number, scale: number) => {
    for (let i = 0; i < count; i++) {
      const x = Math.round((W / count) * (i + 0.5) + (rng() - 0.5) * 8)
      const h = Math.round((16 + rng() * 16) * scale)
      px.rect(x, base - h, 2, h, ci)
      const r = Math.round((5 + rng() * 4) * scale)
      for (let dy = -r; dy <= r; dy += 1) {
        const span = Math.round(Math.sqrt(Math.max(0, r * r - dy * dy)))
        for (let dx = -span; dx <= span; dx += 1) px.set(x + dx, base - h + dy - 2, ci)
      }
    }
  }

  const drawBuildings = (ci: number, base: number, count: number, windows: boolean) => {
    for (let i = 0; i < count; i++) {
      const bw = Math.floor(W / count)
      const x = i * bw
      const bh = Math.round(20 + rng() * 30)
      px.rect(x, base - bh, bw - 2, bh, ci)
      px.rect(x, base - bh, bw - 2, 1, Math.max(0, ci - 1))   // 顶沿高光
      if (windows) {
        for (let k = 0; k < 7; k++) {
          if (rng() < 0.5) {
            px.set(x + 1 + Math.floor(rng() * Math.max(1, bw - 4)),
                   base - bh + 3 + Math.floor(rng() * Math.max(1, bh - 5)), lit)
          }
        }
      }
    }
  }

  const drawStars = (count: number) => {
    for (let i = 0; i < count; i++) {
      px.set(Math.floor(rng() * W), Math.floor(rng() * horizon * 0.85), rng() < 0.3 ? 12 : 10)
    }
  }

  const disc = (cx: number, cy: number, r: number, ci: number) => {
    for (let dy = -r; dy <= r; dy++) {
      const span = Math.round(Math.sqrt(Math.max(0, r * r - dy * dy)))
      for (let dx = -span; dx <= span; dx++) px.set(cx + dx, cy + dy, ci)
    }
  }

  switch (archetype) {
    case 'interior': {
      // 后墙 + 地板（两段实色，靠交界线区分）
      px.rect(0, 0, W, horizon, t.mid)
      px.rect(0, horizon, W, H - horizon, t.near)
      px.rect(0, horizon, W, 1, Math.min(px.size - 1, t.mid + 2))  // 墙脚线
      // 窗（带光）
      const wx = 14 + Math.floor(rng() * 18), wy = 16 + Math.floor(rng() * 8)
      const ww = 26 + Math.floor(rng() * 12), wh = 22 + Math.floor(rng() * 8)
      px.rect(wx, wy, ww, wh, t.sky[1])
      px.rect(wx + Math.floor(ww / 2), wy, 1, wh, t.far)
      px.rect(wx, wy + Math.floor(wh / 2), ww, 1, t.far)
      // 光斑：只在窗下方一小块做抖动
      px.ditherV(wx - 4, wy + wh, Math.min(H - 1, wy + wh + 12), ww + 8, t.near, accentWarm ? 13 : 5)
      // 前景桌沿
      px.rect(Math.round(W * 0.52), H - 16, Math.round(W * 0.42), 4, t.far)
      break
    }
    case 'street': {
      px.rect(0, horizon, W, H - horizon, t.near)
      drawBuildings(t.mid, horizon, 5, true)
      px.rect(0, horizon + 1, W, 1, Math.max(0, t.near - 1))
      // 路灯 + 光晕（小范围抖动）
      const lx = 18 + Math.floor(rng() * 28)
      px.rect(lx, horizon - 34, 1, 34, t.far)
      px.set(lx, horizon - 35, lit)
      px.set(lx - 1, horizon - 35, lit)
      px.ditherV(lx - 7, horizon - 35, horizon + 4, 15, t.near, lit)
      break
    }
    case 'forest': {
      drawTrees(t.mid, horizon + 4, 7, 1)
      drawTrees(t.near, H + 6, 4, 1.7)
      // 雾带只在一条窄缝里
      px.ditherV(0, horizon - 8, horizon + 4, W, t.sky[1], t.mid)
      break
    }
    case 'mountain': {
      drawMountains(t.far, horizon - 4, 30)
      drawMountains(t.mid, horizon + 10, 22)
      drawMountains(t.near, H + 6, 14)
      break
    }
    case 'coast': {
      px.rect(0, horizon, W, H - horizon, t.mid)
      // 水面：稀疏短横线当波纹
      for (let i = 0; i < 30; i++) {
        const y = horizon + 2 + Math.floor(rng() * (H - horizon - 4))
        px.rect(Math.floor(rng() * W), y, 2 + Math.floor(rng() * 7), 1, rng() < 0.5 ? 9 : 5)
      }
      const mx = Math.round(W * 0.74), my = horizon - 12
      disc(mx, my, 5, 12)
      // 月光在水面的一条反光（窄且短）
      px.ditherV(mx - 7, my + 4, horizon + 14, 15, t.mid, 8)
      break
    }
    case 'ruins': {
      px.rect(0, horizon, W, H - horizon, t.near)
      for (let i = 0; i < 5; i++) {
        const x = 10 + i * 30 + Math.floor((rng() - 0.5) * 10)
        const h = 18 + Math.floor(rng() * 28)
        px.rect(x, horizon - h, 7, h, t.mid)
        px.rect(x - 2, horizon - h - 3, 11, 3, t.far)   // 柱头
        px.rect(x, horizon - h, 7, 1, Math.max(0, t.mid - 1))
      }
      break
    }
    case 'underground': {
      px.rect(0, 0, W, H, 1)
      // 拱顶：整块实色，边缘留一圈更暗的
      px.terrainFromProfile(x => {
        const dx = (x - W / 2) / (W / 2)
        return Math.round(horizon - 22 * Math.cos(dx * 1.15))
      }, H, t.mid)
      px.rect(0, H - 18, W, 1, t.near)
      px.rect(0, H - 17, W, 17, Math.max(0, t.near - 1))
      // 石笋
      for (let i = 0; i < 5; i++) {
        const x = 12 + i * 30 + Math.floor(rng() * 10)
        const h = 10 + Math.floor(rng() * 16)
        for (let dy = 0; dy < h; dy++) {
          const wdt = Math.max(1, Math.round(4 * (1 - dy / h)))
          px.rect(x, H - 17 - dy, wdt, 1, t.far)
        }
      }
      disc(Math.round(W / 2), horizon + 4, 7, accentWarm ? 13 : 15)
      break
    }
    case 'sky': {
      px.rect(0, 0, W, H, t.sky[0])
      drawStars(90)
      const cx = Math.round(W * (0.25 + rng() * 0.45)), cy = 34 + Math.floor(rng() * 14)
      const r = 16 + Math.floor(rng() * 10)
      disc(cx, cy, r, t.mid)
      px.rect(cx - r - 4, cy, (r + 4) * 2, 1, 15)      // 行星环
      px.rect(cx - r - 2, cy + 1, (r + 2) * 2, 1, 15)
      px.rect(0, H - 12, W, 12, t.near)                 // 舰体剪影
      break
    }
    case 'night': {
      px.rect(0, 0, W, H, t.sky[0])
      drawStars(60)
      const mx = Math.round(W * 0.76), my = 18 + Math.floor(rng() * 8)
      disc(mx, my, 5, 12)
      px.rect(mx - 4, my - 5, 3, 1, 12)
      drawBuildings(t.mid, H, 6, true)
      // 屋顶剪影压在最前
      px.rect(0, H - 10, W, 10, 0)
      break
    }
  }

  /*
    暗角：**范围要小、只压一档**。
    第一版 d > 0.72 且乘 0.42，而对角距离能到 √2 ≈ 1.41，
    等于大半个画面都被压黑。第二版改成只压最外圈、且只降一档色阶 ——
    降一档在 0–4 区间几乎看不出来，在 5–8 区间才有效果，
    所以它只对中等亮度的场景有意义（这正是想要的：亮场景有暗角、暗场景不再糊）。
  */
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x - W / 2) / (W / 2), dy = (y - H / 2) / (H / 2)
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d < 1.0) continue
      const th = (BAYER[y & 3][x & 3] + 0.5) / 16
      if ((d - 1.0) / 0.4 > th) {
        const cur = px.get(x, y)
        if (cur > 0) px.set(x, y, cur - 1)
      }
    }
  }

  return px
}

export interface GeneratedScene {
  dataUrl: string
  svg: string
  archetype: SceneArchetype
}

/** 缓存：同一场景 + 风格只画一次 */
const cache = new Map<string, GeneratedScene>()

export function generateScene(
  id: string,
  style: WorldTone | string = 'ink',
  tone?: string,
  asset?: SceneAsset
): GeneratedScene {
  /*
    id 是场景 id，但**光靠 id 无法确定 archetype** ——
    调用方不传 asset 时会退回 interior。所以缓存键必须把 archetype 也算进去，
    否则「先不传 asset 调一次」就会把 interior 的结果缓存住，
    之后再怎么传正确的 asset 都只会拿到那个缓存。
    （我正是在这里栽过一次：画廊脚本不传 asset，结果 9 个原型全显示成室内。）
  */
  const resolved = asset ?? getSceneAsset(id)
  const archetype = resolved?.archetype || 'interior'

  if (resolved?.image) {
    return { dataUrl: resolved.image, svg: '', archetype }
  }

  const key = `${id}|${style}|${tone || ''}|${archetype}`
  const hit = cache.get(key)
  if (hit) return hit

  const def = getWorldTone(style)
  const seed = hashSeed(`${def.id}::${id}`)
  // 冷色调（霓虹/全息）用暖橙点缀会显得脏，改用该色调自带的冷色
  const accentWarm = !def.cool

  const px = drawScene(archetype, seed, accentWarm, def.ramp)

  // 放大到 640×360（整数 4 倍），关掉插值保证硬边
  const SCALE = 4
  const canvas = document.createElement('canvas')
  canvas.width = W * SCALE
  canvas.height = H * SCALE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法获取 canvas 上下文')
  ctx.imageSmoothingEnabled = false

  // 先画到 1:1 的小画布，再放大 —— 避免直接把 ImageData 放大时的插值
  const small = document.createElement('canvas')
  small.width = W
  small.height = H
  const sctx = small.getContext('2d')
  if (!sctx) throw new Error('无法获取 canvas 上下文')
  sctx.putImageData(px.toImageData(), 0, 0)
  ctx.drawImage(small, 0, 0, W, H, 0, 0, W * SCALE, H * SCALE)

  const out: GeneratedScene = {
    dataUrl: canvas.toDataURL('image/png'),
    svg: '',   // 像素版不再有 SVG（保留字段是为了不改调用方）
    archetype,
  }
  cache.set(key, out)
  return out
}
