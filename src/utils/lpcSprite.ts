/**
 * LPC 像素立绘合成器
 *
 * 素材来自 Universal LPC Spritesheet Character Generator（见 ./CREDITS.md）。
 * 那些素材是 64×64 的全身行走图，4 个方向各一行（up / left / down / right）。
 *
 * 为什么要按 zPos 排序叠层：LPC 的每个部件 JSON 里有 zPos，
 * 例如 body=10 < legs=20 < feet=25 < torso=35 < armour=60 < nose=105 < hair=120。
 * 顺序错了就会出现「头发盖住脸」这种问题（我第一版就是这样）。
 *
 * 关键约束：**像素画必须整数倍缩放**，非整数倍会让像素糊掉。
 * 所以这里一律按整数 factor 放大，绝不使用浏览器默认的平滑缩放。
 */

import runtime from '@/assets/lpc/runtime.json'
import paletteData from '@/assets/lpc/palettes.json'

// ============================================================================
// 换色（LPC 的 palette recolor）
// ============================================================================

/**
 * 各部件的「源色阶」——按亮度升序。
 *
 * 为什么要写死这些常量而不是从 PNG 里读：
 * LPC 的换色本质是「按亮度排名的第 k 色 → 目标调色板第 k 色」，
 * 源色阶是**共享的材质基准色**（所有发型都用同一套 orange 色阶绘制）。
 * 写死之后运行期不需要再解析 PNG 调色板，也避免了真彩色部件无法分析的问题。
 * 这些值是我从素材里实测出来的（见 .lpc/fetch-palettes.mjs 的输出）。
 */
const RAMP = {
  /** 肤色基准（body / nose 用它） */
  skin: ['#271920', '#99423c', '#cc8665', '#e4a47c', '#f9d5ba', '#faece7'],
  /** 头发基准（所有 hair_* 用它） */
  hair: ['#260d14', '#6a1108', '#a42600', '#bf4000', '#e55600', '#ff8a00'],
  /** 眉毛基准 */
  brow: ['#6a1108', '#a42600', '#bf4000'],
  /** 裤装基准 */
  legs: ['#281820', '#4d4a5d', '#958080', '#c4b59f', '#e5e6c7', '#ffffff'],
  /** 头部里属于「眼」的部分（眼白 + 虹膜） */
  eyeWhite: '#f2f7f8',
  iris: ['#5686ae', '#57cee4'],
  /** 头部里属于「发」的部分（发际线 + 眉） */
  browInHead: '#2a3c49',
} as const

const PALETTES = paletteData.palettes as Record<string, Record<string, string[]>>

export type Material = 'hair' | 'body' | 'cloth' | 'eye' | 'metal' | 'wood'

export function paletteNames(material: Material): string[] {
  return Object.keys(PALETTES[material] || {})
}

/** 按亮度排序，保证调色板方向一致 */
function byLuminance(list: readonly string[]): string[] {
  const lum = (h: string) => {
    const n = parseInt(h.slice(1), 16)
    return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)
  }
  return [...list].sort((a, b) => lum(a) - lum(b))
}

const hexToRgb = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const rgbToHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')

/**
 * 由源色阶与目标调色板构造「颜色 → 颜色」映射表。
 *
 * 映射规则：按排名比例对应，而不是简单的第 k 对第 k。
 * 因为源色阶和目标调色板长度可能不同（眉毛只有 3 色，目标是 6 色），
 * 直接按索引对会让眉毛只用上前半段颜色；按比例对应才能铺满整个明度范围。
 */
function buildMap(source: readonly string[], target: readonly string[]): Map<string, string> {
  const map = new Map<string, string>()
  if (!source.length || !target.length) return map
  const t = byLuminance(target)
  for (let i = 0; i < source.length; i++) {
    const ratio = source.length === 1 ? 0.5 : i / (source.length - 1)
    const idx = Math.round(ratio * (t.length - 1))
    map.set(source[i].toLowerCase(), t[idx].toLowerCase())
  }
  return map
}

export interface RecolorSpec {
  /** 发色调色板名（hair_ulpc 里的键） */
  hair?: string
  /** 肤色调色板名（body_ulpc 里的键） */
  body?: string
  /** 衣色调色板名（cloth_ulpc 里的键） */
  cloth?: string
  /** 瞳色调色板名（eye_ulpc 里的键） */
  eye?: string
}

/** 逐个材质构造映射（合并成一张总表，供像素级替换） */
function buildMaps(spec: RecolorSpec) {
  const skinMap = spec.body && PALETTES.body?.[spec.body] ? buildMap(RAMP.skin, PALETTES.body[spec.body]) : null
  const hairMap = spec.hair && PALETTES.hair?.[spec.hair] ? buildMap(RAMP.hair, PALETTES.hair[spec.hair]) : null
  const browMap = spec.hair && PALETTES.hair?.[spec.hair] ? buildMap(RAMP.brow, PALETTES.hair[spec.hair]) : null
  const legsMap = spec.cloth && PALETTES.cloth?.[spec.cloth] ? buildMap(RAMP.legs, PALETTES.cloth[spec.cloth]) : null
  const eyeMap = spec.eye && PALETTES.eye?.[spec.eye]
    ? buildMap(RAMP.iris, PALETTES.eye[spec.eye])
    : null
  return { skinMap, hairMap, browMap, legsMap, eyeMap }
}

/**
 * 对一张已合成的像素数据做换色。
 *
 * 做法：先算出「这个像素原本属于哪个材质」，再查对应的映射表。
 * 头部的处理最麻烦 —— 它同时含肤色、眼白/虹膜、发际线三种材质，
 * 所以先按精确颜色把眼与眉挑出来，剩下的才当肤色处理。
 */
function recolor(
  data: Uint8ClampedArray,
  kind: string,
  mat: string | null,
  maps: ReturnType<typeof buildMaps>
): void {
  const { skinMap, hairMap, browMap, legsMap, eyeMap } = maps

  // 该部件的主材质映射
  let primary: Map<string, string> | null = null
  if (mat === 'hair') primary = hairMap
  else if (mat === 'body') primary = skinMap
  else if (mat === 'cloth') primary = legsMap
  else if (mat === 'metal') primary = null   // 金属不换色（武器/铠甲保持原色更自然）

  const isHead = kind === 'head' || /^heads_/.test(kind)

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    const hex = rgbToHex(data[i], data[i + 1], data[i + 2]).toLowerCase()

    // 头部：先处理眼与发际，再兜底当肤色
    if (isHead) {
      if (hex === RAMP.eyeWhite) continue                       // 眼白不动
      if (eyeMap?.has(hex)) { setPx(data, i, eyeMap.get(hex)!); continue }
      if (hex === RAMP.browInHead || hairMap?.has(hex)) {
        const to = browMap?.get(hex) || hairMap?.get(hex)
        if (to) setPx(data, i, to)
        continue
      }
      if (skinMap?.has(hex)) { setPx(data, i, skinMap.get(hex)!); continue }
      continue
    }

    if (primary?.has(hex)) setPx(data, i, primary.get(hex)!)
  }
}

function setPx(data: Uint8ClampedArray, i: number, hex: string) {
  const [r, g, b] = hexToRgb(hex)
  data[i] = r; data[i + 1] = g; data[i + 2] = b
}

export interface LpcPart {
  id: string
  kind: string
  zPos: number
  file: string
  w: number
  h: number
  recolors: string | null
  matchBodyColor: boolean
}

export const FRAME_SIZE = runtime.frameSize // 64
export const DIRECTIONS = runtime.directions as string[] // up, left, down, right

const PARTS: LpcPart[] = runtime.parts as LpcPart[]
const BY_ID = new Map(PARTS.map(p => [p.id, p]))

/** 用 Vite 的 glob 拿到所有部件图的 URL（构建时会带 hash 并被正确打包） */
const PART_URLS = import.meta.glob('@/assets/lpc/parts/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

function urlOf(file: string): string | undefined {
  for (const [k, v] of Object.entries(PART_URLS)) {
    if (k.endsWith('/' + file)) return v
  }
  return undefined
}

export interface SpriteRecipe {
  /** 部件 id 列表（会按 zPos 自动排序） */
  parts: string[]
  hair: string
  clothing: string
  /** 换色方案 */
  colors: RecolorSpec
}

export interface RecipeOptions {
  gender?: string
  build?: string
  /** 显式指定颜色（不传则按 key 确定性挑选） */
  colors?: RecolorSpec
}

// —— 配方池 ——
const HAIRS = PARTS.filter(p => p.kind === 'hair').map(p => p.id)
const TORSOS = PARTS.filter(p => p.kind === 'clothes' || p.kind === 'armour').map(p => p.id)
const LEGS = PARTS.filter(p => p.kind === 'legs').map(p => p.id)
const FEET = PARTS.filter(p => p.kind === 'shoes' || p.kind === 'feet').map(p => p.id)
const NOSES = PARTS.filter(p => p.kind === 'nose').map(p => p.id)
const BROWS = PARTS.filter(p => p.kind === 'eyebrows').map(p => p.id)
const HEADS = PARTS.filter(p => p.kind === 'head').map(p => p.id)

/** 只用成年人头（小号/儿童头与身体比例不搭） */
const HEADS_ADULT = HEADS.filter(h => !/_small$|_child$/.test(h))
const HEADS_MALEISH = HEADS_ADULT.filter(h => /male|elderly/.test(h) && !/female/.test(h))
const HEADS_FEMALEISH = HEADS_ADULT.filter(h => /female/.test(h))

/**
 * 由稳定标识确定性地生成一套「配方」。
 * 同一个角色 id 永远得到同一套穿着、外貌与配色。
 *
 * 换色是让立绘「看起来不是同一个人」的关键 ——
 * 在接入调色板之前，所有角色都是橙发，同屏观感极差。
 */
/**
 * 主角立绘的稳定种子。
 *
 * 必须由所有展示主角的地方**共用** —— 选角界面、状态栏、以后的立绘面板
 * 如果各自算种子，同一个人会得到不同的脸（之前几何头像就踩过这个坑，
 * 所以把它抽出来当唯一来源）。
 *
 * 刻意**不含头像本身**：那个是可变的（用户可能上传/移除），
 * 用它当种子会导致换个头像就换一张脸。
 */
export function playerSpriteSeed(name?: string, gender?: string): string {
  return `player:${name || 'hero'}:${gender || 'x'}`
}

export function recipeFor(key: string, opts?: RecipeOptions): SpriteRecipe {
  const rng = makeRng(hashSeed(key))
  const g = (opts?.gender || '').toLowerCase()
  const isFemale = /女|female|woman|girl|f\b/.test(g)
  const isElder = /老|elder|old|年长/.test(g)
  const build = (opts?.build || '').toLowerCase()
  const isBroad = /壮|broad|muscular|魁/.test(build)

  // 头部：按性别气质挑，老者优先用老年头
  let head: string
  if (isElder) {
    head = pick(rng, HEADS_ADULT.filter(h => /elderly/.test(h)).concat(HEADS_ADULT))
  } else if (isFemale) {
    head = pick(rng, HEADS_FEMALEISH.length ? HEADS_FEMALEISH : HEADS_ADULT)
  } else if (isBroad) {
    head = pick(rng, HEADS_MALEISH.filter(h => /plump|gaunt/.test(h)).concat(HEADS_MALEISH))
  } else {
    head = pick(rng, HEADS_MALEISH.length && rng() < 0.5 ? HEADS_MALEISH : HEADS_FEMALEISH)
  }

  const hair = pick(rng, HAIRS.length ? HAIRS : ['hair_bob'])
  const torso = pick(rng, TORSOS.length ? TORSOS : ['torso_clothes_longsleeve'])
  const legs = pick(rng, LEGS.length ? LEGS : ['legs_pants'])
  const shoes = pick(rng, FEET.length ? FEET : ['feet_shoes_basic'])
  const nose = pick(rng, NOSES.length ? NOSES : ['head_nose_straight'])
  const brows = pick(rng, BROWS.length ? BROWS : ['eyebrows_thick'])

  // —— 配色：这是差异化的主要来源 ——
  const hairNames = paletteNames('hair')
  const bodyNames = paletteNames('body').filter(n => !/^fur_|zombie|green|blue|lavender/.test(n))
  const clothNames = paletteNames('cloth')
  const eyeNames = paletteNames('eye')

  const colors: RecolorSpec = opts?.colors || {
    hair: pick(rng, hairNames),
    body: pick(rng, bodyNames.length ? bodyNames : paletteNames('body')),
    cloth: pick(rng, clothNames),
    eye: pick(rng, eyeNames),
  }

  return {
    parts: ['body', head, nose, brows, hair, legs, shoes, torso],
    hair,
    clothing: torso,
    colors,
  }
}

function hashSeed(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h >>> 0
}
function makeRng(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const pick = <T,>(rng: () => number, list: T[]): T => list[Math.floor(rng() * list.length) % list.length]

// —— 图片缓存 ——
const imgCache = new Map<string, HTMLImageElement>()
const imgPromise = new Map<string, Promise<HTMLImageElement>>()

function loadImage(file: string): Promise<HTMLImageElement> {
  const hit = imgCache.get(file)
  if (hit) return Promise.resolve(hit)
  const pending = imgPromise.get(file)
  if (pending) return pending

  const url = urlOf(file)
  if (!url) return Promise.reject(new Error('找不到部件图：' + file))

  const p = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => { imgCache.set(file, img); resolve(img) }
    img.onerror = () => reject(new Error('部件图加载失败：' + file))
    img.src = url
  })
  imgPromise.set(file, p)
  return p
}

/** 数据 URL 缓存：同一配方只合成一次 */
const dataUrlCache = new Map<string, string>()

export interface RenderOptions {
  /** 方向，默认 down（正面朝下，适合当立绘） */
  direction?: string
  /** 放大倍数，必须是正整数 —— 像素画非整数倍会糊 */
  scale?: number
  /**
   * 只取头肩区域（用于紧凑位置）。
   * 在**合成阶段**裁剪，而不是靠 CSS object-fit ——
   * CSS 裁法一旦 objectFit 设成 none 就会既不缩放也不居中，
   * 192px 的图塞进 48px 框里只露出一个角（踩过）。
   */
  headOnly?: boolean
}

/** 头肩裁切范围（源 64×64 帧内）。头在 y≈6..26，取到 32 带走一点肩。 */
const HEAD_CROP = { x: 14, y: 2, size: 36 }

/**
 * 合成一个角色，返回 PNG data URL。
 * 合成在离屏 canvas 上做，按 zPos 升序叠层。
 */
export async function renderSprite(recipe: SpriteRecipe, opts: RenderOptions = {}): Promise<string> {
  const direction = opts.direction || 'down'
  const row = Math.max(0, DIRECTIONS.indexOf(direction))
  const crop = opts.headOnly
    ? HEAD_CROP
    : { x: 0, y: 0, size: FRAME_SIZE }
  // 头肩默认 4 倍：源 36px 的窗口放大到 128px，在 48px 显示时是 2.67 倍下采样，仍够锐
  const scale = Math.max(1, Math.round(opts.scale || (opts.headOnly ? 4 : 3)))
  // 缓存键必须包含配色 —— 否则换了颜色还会命中旧图
  const c = recipe.colors || {}
  const cacheKey = `${recipe.parts.join('|')}#${c.hair || ''},${c.body || ''},${c.cloth || ''},${c.eye || ''}#${direction}#${scale}#${crop.size}@${crop.x},${crop.y}`
  const hit = dataUrlCache.get(cacheKey)
  if (hit) return hit

  const layers = recipe.parts
    .map(id => BY_ID.get(id))
    .filter((p): p is LpcPart => !!p)
    .sort((a, b) => a.zPos - b.zPos)
  const size = crop.size * scale

  const finalCanvas = document.createElement('canvas')
  finalCanvas.width = size
  finalCanvas.height = size
  const finalCtx = finalCanvas.getContext('2d')
  if (!finalCtx) throw new Error('无法获取 canvas 上下文')
  finalCtx.imageSmoothingEnabled = false

  const maps = buildMaps(recipe.colors || {})

  if (maps.skinMap || maps.hairMap || maps.legsMap || maps.eyeMap) {
    /*
      有配色：必须**逐层**换色。
      做法是每层单独画到一张 64×64 的中转画布上取像素 ——
      不能把整张合成图一次取出来，因为那样无从判断某个像素属于哪一层，
      头部的肤色/眼/眉就没法分开处理。
    */
    const stage = document.createElement('canvas')
    stage.width = FRAME_SIZE
    stage.height = FRAME_SIZE
    const sctx = stage.getContext('2d', { willReadFrequently: true })
    if (!sctx) throw new Error('无法获取 canvas 上下文')
    sctx.imageSmoothingEnabled = false

    for (const layer of layers) {
      const img = await loadImage(layer.file)
      sctx.clearRect(0, 0, FRAME_SIZE, FRAME_SIZE)
      sctx.drawImage(img, 0, row * FRAME_SIZE, FRAME_SIZE, FRAME_SIZE, 0, 0, FRAME_SIZE, FRAME_SIZE)
      const id = sctx.getImageData(0, 0, FRAME_SIZE, FRAME_SIZE)
      recolor(id.data, layer.kind, layer.recolors, maps)
      sctx.putImageData(id, 0, 0)
      // 换好色的这一层接着叠到最终画布（同时完成裁剪与整数放大）
      finalCtx.drawImage(stage, crop.x, crop.y, crop.size, crop.size, 0, 0, size, size)
    }
  } else {
    // 无配色：直接按 zPos 叠层 + 裁剪 + 放大
    for (const layer of layers) {
      const img = await loadImage(layer.file)
      finalCtx.drawImage(img, crop.x, row * FRAME_SIZE + crop.y, crop.size, crop.size, 0, 0, size, size)
    }
  }

  const url = finalCanvas.toDataURL('image/png')
  dataUrlCache.set(cacheKey, url)
  return url
}

/** 预热：提前把某个配方的部件图加载好 */
export function preloadRecipe(recipe: SpriteRecipe): Promise<unknown> {
  return Promise.all(
    recipe.parts.map(id => BY_ID.get(id)).filter(Boolean).map(p => loadImage((p as LpcPart).file))
  )
}
