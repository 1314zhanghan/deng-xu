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
 * 每套都遵守同一条规则：索引 0 最暗（暗角/剪影）→ 12 最亮，
 * 13/14 是暖色点缀（灯火），15 是冷色点缀（水/夜）。
 * 保持索引语义一致，`sceneArt.ts` 才能对四套色板用同一套绘制逻辑。
 */
export const WORLD_TONES: Record<WorldTone, WorldToneDef> = {
  ink: {
    id: 'ink',
    label: '水墨',
    hint: '冷灰基调，适合奇幻、悬疑、写实题材',
    ramp: [
      [10, 10, 14], [20, 20, 28], [30, 30, 42], [42, 42, 58],
      [56, 56, 74], [72, 74, 92], [90, 94, 112], [110, 116, 132],
      [132, 140, 152], [156, 164, 176], [180, 188, 198], [206, 212, 220],
      [232, 236, 242],
      [180, 140, 90], [220, 180, 110], [90, 130, 140],
    ],
  },
  neon: {
    id: 'neon',
    label: '霓虹',
    hint: '深蓝紫基底 + 青粉点缀，适合赛博朋克、都市夜景',
    ramp: [
      [8, 10, 22], [16, 18, 38], [24, 26, 54], [34, 34, 74],
      [46, 44, 96], [62, 58, 122], [82, 76, 150], [104, 98, 178],
      [130, 124, 200], [158, 154, 218], [186, 184, 232], [212, 212, 242],
      [238, 238, 252],
      [214, 92, 168], [120, 226, 240], [150, 110, 240],
    ],
  },
  holo: {
    id: 'holo',
    label: '全息',
    hint: '青绿偏冷，适合科幻、太空、实验室、数据空间',
    ramp: [
      [6, 14, 16], [12, 26, 28], [18, 40, 42], [26, 56, 58],
      [36, 74, 76], [48, 94, 96], [64, 116, 118], [84, 140, 142],
      [108, 166, 168], [136, 192, 194], [168, 216, 218], [200, 234, 236],
      [232, 250, 250],
      [230, 176, 78], [150, 240, 226], [110, 200, 255],
    ],
  },
  parchment: {
    id: 'parchment',
    label: '羊皮纸',
    hint: '暖褐基调，适合历史、武侠、蒸汽朋克、回忆场景',
    ramp: [
      [16, 11, 8], [30, 21, 14], [46, 33, 22], [64, 47, 32],
      [84, 63, 43], [106, 82, 57], [130, 104, 74], [154, 128, 94],
      [178, 154, 118], [200, 180, 146], [220, 204, 174], [236, 224, 200],
      [248, 242, 228],
      [172, 116, 54], [226, 176, 96], [126, 132, 120],
    ],
  },
}

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
