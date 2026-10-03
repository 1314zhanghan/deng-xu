/**
 * 程序化场景背景生成
 *
 * 为什么不用现成图片素材：
 *  和头像同理 —— Lemma Soft Forums、OpenGameArt 之类站点上的"免费背景图"，
 *  授权条款逐个不同（有的要求署名、有的禁止再分发、有的仅限非商业），
 *  在不逐条核验的情况下打包进产物会把授权风险转嫁给使用者。
 *  而几十张 1280×720 的位图还会让这个纯前端站点多出好几 MB。
 *
 * 所以按「场景类型 + 世界风格」程序化生成 SVG 背景：
 *  - 确定性：同一场景 id 永远得到同一张图
 *  - 零版权、可离线、单张约 1–2 KB
 *  - 通过 sceneStyle（复用 avatarStyle）让同一套几何语言换配色
 *
 * 想换成真实图片素材：把 SceneAsset 的 `image` 填成图片路径即可，
 * 渲染层优先用 image，没有才走程序化生成 —— 不用改任何组件代码。
 */

import { getAvatarStyle, type AvatarStyle } from '@/utils/avatarArt'

/** 场景原型：决定几何构图 */
export type SceneArchetype =
  | 'interior'    // 室内：窗、桌、灯
  | 'street'      // 街道：楼影、路灯、路
  | 'forest'      // 林地：树干、雾
  | 'mountain'    // 山野：层叠山脊
  | 'coast'       // 海岸：水面、地平线
  | 'ruins'       // 废墟：断柱、残垣
  | 'underground' // 地下：洞穴拱顶
  | 'sky'         // 高空/太空：星、云、星球
  | 'night'       // 夜景：月亮、屋影

export interface SceneAsset {
  id: string
  /** 给 AI 看的场景描述 */
  label: string
  archetype: SceneArchetype
  /** 可选：真实图片路径。填了就优先用它，不再程序化生成 */
  image?: string
}

/** 场景原型的中文说明（给 AI 判断用） */
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
  // 每个原型给 3 个变体（不同时间/氛围），够 AI 挑且不至于让清单膨胀
  const variants = ['', '·黄昏', '·深夜']
  let i = 0
  for (const archetype of archetypes) {
    for (const v of variants) {
      out.push({
        id: `s${String(i + 1).padStart(2, '0')}`,
        label: `${ARCHETYPE_LABEL[archetype]}${v}`,
        archetype,
      })
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

/** 给 AI 用的场景清单文本 */
export function sceneCatalogPrompt(): string {
  return SCENE_CATALOG.map(s => `${s.id}=${s.label}`).join('；')
}

/**
 * 画布 640×360（16:9）。
 * 之前是 480×270 —— 渲染到叙事区（约 656×676）时被放大 1.4 倍以上，
 * 线条会发虚。提高到 640×360 后同尺寸下基本 1:1，观感干净得多，
 * 单张 SVG 也只从约 1.5 KB 涨到约 2 KB。
 */
const W = 640
const H = 360

function hashSeed(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
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

/** 每个原型一套配色（深底 + 远/中/近三层），与头像风格叠加 */
const ARCHETYPE_PALETTE: Record<SceneArchetype, { sky: [string, string]; far: string; mid: string; near: string }> = {
  interior: { sky: ['#20201d', '#2a2723'], far: '#3a342c', mid: '#4a4238', near: '#5c5245' },
  street: { sky: ['#1c2028', '#262b34'], far: '#2e3440', mid: '#3a4150', near: '#474e5e' },
  forest: { sky: ['#161d19', '#1e2a23'], far: '#25352c', mid: '#2f4437', near: '#3b5544' },
  mountain: { sky: ['#1b2026', '#28303a'], far: '#2c3642', mid: '#38434f', near: '#46525f' },
  coast: { sky: ['#131e26', '#1d2c36'], far: '#24333d', mid: '#2d4049', near: '#384e57' },
  ruins: { sky: ['#221d1a', '#2e2724'], far: '#3a302a', mid: '#493c33', near: '#5a4a3e' },
  underground: { sky: ['#141414', '#1c1a1a'], far: '#262220', mid: '#332d29', near: '#413934' },
  sky: { sky: ['#0d1220', '#151d33'] as [string, string], far: '#1c2540', mid: '#26314f', near: '#333f60' },
  night: { sky: ['#12141f', '#1b1f2e'], far: '#232838', mid: '#2d3348', near: '#3a425a' },
}

export interface GeneratedScene {
  dataUrl: string
  svg: string
  archetype: SceneArchetype
}

/**
 * 生成场景背景。
 * @param id    场景 id（决定构图随机性）
 * @param style 世界风格（复用头像风格，保持同一世界观感一致）
 * @param tone  世界点缀色
 * @param asset 可选：带 image 的素材则直接返回该图片
 */
export function generateScene(
  id: string,
  style: AvatarStyle | string = 'ink',
  tone?: string,
  asset?: SceneAsset
): GeneratedScene {
  const archetype = asset?.archetype || 'interior'

  // 有真实图片就用它 —— 这是替换成外部素材的唯一入口
  if (asset?.image) {
    return { dataUrl: asset.image, svg: '', archetype }
  }

  const styleDef = getAvatarStyle(style)
  const pal = ARCHETYPE_PALETTE[archetype]
  const accent = tone || styleDef.accent
  const rng = makeRng(hashSeed(`${styleDef.id}::${id}`))
  const parts: string[] = []

  // 天空/背景渐变
  parts.push(`<defs><linearGradient id="sky${hashSeed(id)}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="${pal.sky[0]}"/><stop offset="100%" stop-color="${pal.sky[1]}"/>` +
    `</linearGradient></defs>`)
  parts.push(`<rect width="${W}" height="${H}" fill="url(#sky${hashSeed(id)})"/>`)

  const horizon = H * (0.55 + rng() * 0.12)

  const drawMountains = (color: string, base: number, amp: number, steps: number) => {
    let d = `M0 ${H} L0 ${base}`
    for (let i = 1; i <= steps; i++) {
      const x = (W / steps) * i
      const y = base - amp * (0.4 + rng() * 0.9)
      d += ` L${x.toFixed(1)} ${y.toFixed(1)}`
    }
    d += ` L${W} ${H} Z`
    parts.push(`<path d="${d}" fill="${color}"/>`)
  }

  const drawTrees = (color: string, base: number, count: number, scale: number) => {
    for (let i = 0; i < count; i++) {
      const x = (W / count) * (i + 0.5) + (rng() - 0.5) * 20
      const h = (26 + rng() * 30) * scale
      parts.push(`<rect x="${(x - 2 * scale).toFixed(1)}" y="${(base - h).toFixed(1)}" width="${(4 * scale).toFixed(1)}" height="${h.toFixed(1)}" fill="${color}"/>`)
      parts.push(`<ellipse cx="${x.toFixed(1)}" cy="${(base - h).toFixed(1)}" rx="${(11 * scale).toFixed(1)}" ry="${(15 * scale).toFixed(1)}" fill="${color}"/>`)
    }
  }

  const drawBuildings = (color: string, base: number, count: number, lit: boolean) => {
    for (let i = 0; i < count; i++) {
      const bw = W / count
      const x = bw * i
      const bh = 40 + rng() * 70
      parts.push(`<rect x="${x.toFixed(1)}" y="${(base - bh).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${bh.toFixed(1)}" fill="${color}"/>`)
      if (lit) {
        // 零星亮着的窗
        for (let k = 0; k < 5; k++) {
          if (rng() < 0.45) {
            const wx = x + 4 + rng() * Math.max(2, bw - 12)
            const wy = base - bh + 6 + rng() * Math.max(2, bh - 14)
            parts.push(`<rect x="${wx.toFixed(1)}" y="${wy.toFixed(1)}" width="3" height="4" fill="${accent}" opacity="${(0.35 + rng() * 0.5).toFixed(2)}"/>`)
          }
        }
      }
    }
  }

  const drawStars = (count: number) => {
    for (let i = 0; i < count; i++) {
      const x = rng() * W
      const y = rng() * horizon * 0.85
      parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(0.5 + rng() * 1.1).toFixed(2)}" fill="#ffffff" opacity="${(0.25 + rng() * 0.6).toFixed(2)}"/>`)
    }
  }

  switch (archetype) {
    case 'interior': {
      // 地板 + 后墙 + 一扇窗（窗里透光）
      parts.push(`<rect x="0" y="${horizon.toFixed(1)}" width="${W}" height="${(H - horizon).toFixed(1)}" fill="${pal.near}"/>`)
      parts.push(`<rect x="0" y="0" width="${W}" height="${horizon.toFixed(1)}" fill="${pal.mid}"/>`)
      const wx = 60 + rng() * 100
      const wy = 40 + rng() * 20
      const ww = 90 + rng() * 50
      const wh = 70 + rng() * 30
      parts.push(`<rect x="${wx.toFixed(1)}" y="${wy.toFixed(1)}" width="${ww.toFixed(1)}" height="${wh.toFixed(1)}" fill="${pal.sky[1]}" stroke="${pal.far}" stroke-width="2"/>`)
      parts.push(`<line x1="${(wx + ww / 2).toFixed(1)}" y1="${wy.toFixed(1)}" x2="${(wx + ww / 2).toFixed(1)}" y2="${(wy + wh).toFixed(1)}" stroke="${pal.far}" stroke-width="2"/>`)
      // 一盏暖光
      parts.push(`<circle cx="${(wx + ww / 2).toFixed(1)}" cy="${wy.toFixed(1)}" r="${(ww * 0.7).toFixed(1)}" fill="${accent}" opacity="0.07"/>`)
      // 前景桌子
      parts.push(`<rect x="${(W * 0.55).toFixed(1)}" y="${(H - 40).toFixed(1)}" width="${(W * 0.4).toFixed(1)}" height="10" fill="${pal.far}"/>`)
      break
    }
    case 'street': {
      parts.push(`<rect x="0" y="${horizon.toFixed(1)}" width="${W}" height="${(H - horizon).toFixed(1)}" fill="${pal.near}"/>`)
      drawBuildings(pal.mid, horizon, 5, true)
      // 路面反光
      parts.push(`<rect x="0" y="${(horizon + 22).toFixed(1)}" width="${W}" height="3" fill="${accent}" opacity="0.12"/>`)
      // 路灯
      const lx = 70 + rng() * 60
      parts.push(`<rect x="${lx.toFixed(1)}" y="${(horizon - 70).toFixed(1)}" width="2" height="70" fill="${pal.far}"/>`)
      parts.push(`<circle cx="${lx.toFixed(1)}" cy="${(horizon - 72).toFixed(1)}" r="4" fill="${accent}" opacity="0.9"/>`)
      parts.push(`<circle cx="${lx.toFixed(1)}" cy="${(horizon - 72).toFixed(1)}" r="22" fill="${accent}" opacity="0.09"/>`)
      break
    }
    case 'forest': {
      drawTrees(pal.mid, horizon + 10, 9, 1)
      drawTrees(pal.near, H - 6, 5, 1.5)
      // 雾带
      parts.push(`<rect x="0" y="${(horizon - 6).toFixed(1)}" width="${W}" height="20" fill="${pal.sky[1]}" opacity="0.35"/>`)
      break
    }
    case 'mountain': {
      drawMountains(pal.far, horizon - 20, 46, 7)
      drawMountains(pal.mid, horizon + 6, 34, 5)
      drawMountains(pal.near, H - 30, 22, 4)
      break
    }
    case 'coast': {
      parts.push(`<rect x="0" y="${horizon.toFixed(1)}" width="${W}" height="${(H - horizon).toFixed(1)}" fill="${pal.mid}"/>`)
      // 波纹
      for (let i = 0; i < 14; i++) {
        const y = horizon + 6 + rng() * (H - horizon - 10)
        const x = rng() * W
        parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(10 + rng() * 40).toFixed(1)}" height="1.2" fill="${accent}" opacity="${(0.08 + rng() * 0.14).toFixed(2)}"/>`)
      }
      parts.push(`<circle cx="${(W * 0.72).toFixed(1)}" cy="${(horizon - 18).toFixed(1)}" r="11" fill="${accent}" opacity="0.5"/>`)
      break
    }
    case 'ruins': {
      parts.push(`<rect x="0" y="${horizon.toFixed(1)}" width="${W}" height="${(H - horizon).toFixed(1)}" fill="${pal.near}"/>`)
      // 断柱
      for (let i = 0; i < 6; i++) {
        const x = 20 + i * 76 + (rng() - 0.5) * 16
        const h = 30 + rng() * 60
        parts.push(`<rect x="${x.toFixed(1)}" y="${(horizon - h).toFixed(1)}" width="14" height="${h.toFixed(1)}" fill="${pal.mid}"/>`)
        parts.push(`<rect x="${(x - 3).toFixed(1)}" y="${(horizon - h - 5).toFixed(1)}" width="20" height="5" fill="${pal.far}"/>`)
      }
      break
    }
    case 'underground': {
      // 拱顶
      parts.push(`<path d="M0 ${H} L0 ${horizon} Q${W / 2} ${horizon - 80} ${W} ${horizon} L${W} ${H} Z" fill="${pal.mid}"/>`)
      parts.push(`<path d="M0 ${H} L0 ${H - 40} Q${W / 2} ${H - 90} ${W} ${H - 40} L${W} ${H} Z" fill="${pal.near}"/>`)
      // 石笋
      for (let i = 0; i < 5; i++) {
        const x = 30 + i * 100 + rng() * 30
        const h = 20 + rng() * 45
        parts.push(`<path d="M${x.toFixed(1)} ${H} L${(x + 7).toFixed(1)} ${(H - h).toFixed(1)} L${(x + 14).toFixed(1)} ${H} Z" fill="${pal.far}"/>`)
      }
      // 微光
      parts.push(`<circle cx="${(W * 0.5).toFixed(1)}" cy="${(horizon + 20).toFixed(1)}" r="50" fill="${accent}" opacity="0.06"/>`)
      break
    }
    case 'sky': {
      drawStars(70)
      // 行星/巨物
      const px = W * (0.2 + rng() * 0.6)
      const py = 50 + rng() * 60
      parts.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${(26 + rng() * 22).toFixed(1)}" fill="${pal.mid}"/>`)
      parts.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${(26 + rng() * 22).toFixed(1)}" fill="none" stroke="${accent}" stroke-width="1.5" opacity="0.5"/>`)
      parts.push(`<rect x="0" y="${(H - 26).toFixed(1)}" width="${W}" height="26" fill="${pal.near}" opacity="0.85"/>`)
      break
    }
    case 'night': {
      drawStars(45)
      parts.push(`<circle cx="${(W * 0.78).toFixed(1)}" cy="${(34 + rng() * 16).toFixed(1)}" r="14" fill="#e8e4d8" opacity="0.85"/>`)
      drawBuildings(pal.mid, horizon + 20, 6, true)
      parts.push(`<rect x="0" y="${(horizon + 20).toFixed(1)}" width="${W}" height="${(H - horizon - 20).toFixed(1)}" fill="${pal.near}"/>`)
      break
    }
  }

  // 统一的暗角，让文字压在上面也能读
  parts.push(
    `<radialGradient id="vig${hashSeed(id)}" cx="50%" cy="50%" r="75%">` +
    `<stop offset="45%" stop-color="#000000" stop-opacity="0"/>` +
    `<stop offset="100%" stop-color="#000000" stop-opacity="0.55"/>` +
    `</radialGradient>` +
    `<rect width="${W}" height="${H}" fill="url(#vig${hashSeed(id)})"/>`
  )

  // 风格化的扫描线
  if (styleDef.scanlines) {
    const lines: string[] = []
    for (let y = 0; y < H; y += 4) {
      lines.push(`<rect x="0" y="${y}" width="${W}" height="1" fill="${styleDef.stroke}" opacity="0.035"/>`)
    }
    parts.push(lines.join(''))
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice">` +
    parts.join('') +
    `</svg>`

  return {
    dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    svg,
    archetype,
  }
}
