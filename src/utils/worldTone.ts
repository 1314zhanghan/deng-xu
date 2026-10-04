/**
 * 世界色调（WorldTone）
 *
 * 历史与正名：
 *  这个字段原本叫 `avatarStyle`，用来切换**几何头像**的配色方案。
 *  但自从人物立绘改为 LPC 像素素材（`lpcSprite.ts`）之后，
 *  立绘的配色由 LPC 自己的调色板决定，`avatarStyle` **对头像已经没有任何作用** ——
 *  它现在真正影响的是**像素场景背景**的配色（见 `sceneArt.ts`）。
 *
 *  所以这里把它正名为「世界色调」，并让它名副其实：
 *  每种色调提供一套**完整的 16 色限色板**，真正驱动场景的明暗与冷暖。
 *
 *  为什么不直接删掉这个选项：
 *  它对场景配色是有真实效果的（同一张山岭，冷色调和暖色调观感差别很大），
 *  而且旧卡片里已经存了 'ink' 等取值 —— 删掉会让这些卡失去配色。
 *
 * 字段名 `avatarStyle` / `avatarTone` 保持不变，避免破坏已保存的世界卡；
 * 但界面文案与预览都已改为"色调"语义。
 */

import type { RGB } from '@/utils/sceneArt'

/** 保留旧 id，保证已存在的世界卡仍然有效 */
export type WorldTone = 'ink' | 'neon' | 'holo' | 'parchment'
export type AvatarStyle = WorldTone   // 兼容旧名

export interface WorldToneDef {
  id: WorldTone
  label: string
  /** 一句话说明这个色调适合什么题材 */
  hint: string
  /** 完整 16 色限色板，按「最暗 → 最亮」排列 */
  ramp: readonly RGB[]
  /** 冷色调场景使用冷色点缀（灯火不应当是暖橙） */
  cool?: boolean
}

/**
 * 四套色调。
 *
 * 结构上刻意分成两段：
 *  - `base`：14 档**从最暗到最亮**的基底，`sceneArt` 的天空/地面/远近景都取自这里。
 *    「0 最暗、13 最亮」这个约定必须被每一套遵守，否则同一套绘制逻辑会在
 *    某套色调下画出不可读的画面（有测试守着这一点）。
 *  - `accent`：2 个点缀色 [暖, 冷]，合并后正好构成 16 档。
 *    单独拆出来是因为**点缀色应当因色调而异**：
 *    第一版让霓虹和全息共用同一个冷点缀，两者看上去就没有区别了。
 *
 * 最终 `ramp` = base(14) + accent(2) = 16 档，索引 14/15 分别是暖/冷点缀。
 */
interface ToneSpec {
  id: WorldTone
  label: string
  hint: string
  base: readonly RGB[]
  /** [暖点缀, 冷点缀] */
  accent: readonly [RGB, RGB]
  /**
   * 冷色调。标记为 true 时，场景里的"灯火"改用冷点缀而不是暖点缀 ——
   * 暖橙灯火压在蓝紫基底上会显得很脏。
   */
  cool?: boolean
}

const TONE_SPECS: Record<WorldTone, ToneSpec> = {
  ink: {
    id: 'ink',
    label: '水墨',
    hint: '冷灰基调，适合奇幻、悬疑、写实题材',
    base: [
      [10, 10, 14], [20, 20, 28], [30, 30, 42], [42, 42, 58],
      [56, 56, 74], [72, 74, 92], [90, 94, 112], [110, 116, 132],
      [132, 140, 152], [156, 164, 176], [180, 188, 198], [206, 212, 220],
      [232, 236, 242], [244, 246, 250],
    ],
    accent: [[200, 152, 92], [126, 176, 190]],
  },
  neon: {
    id: 'neon',
    label: '霓虹',
    hint: '深蓝紫基底 + 青粉点缀，适合赛博朋克、都市夜景',
    base: [
      [8, 10, 22], [16, 18, 38], [24, 26, 54], [34, 34, 74],
      [46, 44, 96], [62, 58, 122], [82, 76, 150], [104, 98, 178],
      [130, 124, 200], [158, 154, 218], [186, 184, 232], [212, 212, 242],
      [238, 238, 252], [250, 250, 255],
    ],
    // 粉 + 青，赛博朋克的经典对撞
    accent: [[240, 96, 176], [96, 228, 246]],
    cool: true,
  },
  holo: {
    id: 'holo',
    label: '全息',
    hint: '青绿偏冷，适合科幻、太空、实验室、数据空间',
    base: [
      [6, 14, 16], [12, 26, 28], [18, 40, 42], [26, 56, 58],
      [36, 74, 76], [48, 94, 96], [64, 116, 118], [84, 140, 142],
      [108, 166, 168], [136, 192, 194], [168, 216, 218], [200, 234, 236],
      [232, 250, 250], [244, 254, 254],
    ],
    // 琥珀 + 蓝，仪表盘与全息投影的观感
    accent: [[226, 176, 86], [104, 194, 255]],
    cool: true,
  },
  parchment: {
    id: 'parchment',
    label: '羊皮纸',
    hint: '暖褐基调，适合历史、武侠、蒸汽朋克、回忆场景',
    base: [
      [16, 11, 8], [30, 21, 14], [46, 33, 22], [64, 47, 32],
      [84, 63, 43], [106, 82, 57], [130, 104, 74], [154, 128, 94],
      [178, 154, 118], [200, 180, 146], [220, 204, 174], [236, 224, 200],
      [248, 242, 228], [253, 250, 242],
    ],
    // 焦糖 + 灰绿（旧地图上的植被色）
    accent: [[178, 118, 52], [122, 140, 118]],
  },
}

/** 把 base(14) 与 accent(2) 合成完整的 16 档，索引 14/15 分别是暖/冷点缀 */
function assemble(spec: ToneSpec): readonly RGB[] {
  return [...spec.base, spec.accent[0], spec.accent[1]]
}

export const WORLD_TONES: Record<WorldTone, WorldToneDef> = Object.fromEntries(
  (Object.keys(TONE_SPECS) as WorldTone[]).map(id => {
    const s = TONE_SPECS[id]
    return [id, {
      id: s.id,
      label: s.label,
      hint: s.hint,
      ramp: assemble(s),
      cool: s.cool,
    }]
  })
) as Record<WorldTone, WorldToneDef>

export const WORLD_TONE_IDS = Object.keys(WORLD_TONES) as WorldTone[]

export function getWorldTone(id?: string): WorldToneDef {
  return WORLD_TONES[(id as WorldTone)] || WORLD_TONES.ink
}

/** RGB → #rrggbb，用于 <input type="color"> 的默认值 */
export function rgbToHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
}

/**
 * 色调自带的点缀色（取色板里的亮暖/亮冷那一档）。
 * 用作「点缀色」输入框的默认值 —— 以前这里取的是几何头像风格的 accent 字段，
 * 那条路径已经不用了，改成从色板本身推导，语义更直接。
 */
export function toneAccent(id?: string): string {
  return rgbToHex(getWorldTone(id).ramp[14])
}

/** 兼容旧类型名（cards.ts 曾用 AvatarStyle；保留导出以免外部引用报错） */
export type { WorldTone as AvatarStyleAlias }
