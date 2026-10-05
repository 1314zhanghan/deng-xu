/**
 * RPG 地图素材色。
 *
 * 为什么需要单独一套：
 *  世界色调（`worldTone.ts`）给的是**一条从最暗到最亮的去饱和斜坡** ——
 *  它适合远景色块与 UI，但拿它画俯瞰地图就会"什么都一个颜色"：
 *  草地、石板、屋顶、水面全是同一族的灰。这正是玩家反馈
 *  「背景割裂且意义不明」的根源 —— 看不出那些色块在画什么。
 *
 *  地图需要的是**材质色相差异**：草偏黄绿、土偏褐、石偏青灰、水偏蓝、
 *  木偏暖褐、瓦偏砖红。相差异比明度差异更能让玩家一眼认出"这是什么"。
 *
 * 昼夜两套：
 *  同一份形状，只换材质色。夜晚整体压暗并偏蓝紫，同时**灯火用暖色提亮** ——
 *  这是 RPG 里表达"天黑了"最直观的方式，玩家不用打开状态栏看时间。
 *
 * 每个材质给 4 档：`dark / mid / light / hi`。
 * 画格子时按"受光方向"取档，地图才有立体感（左下暗、右上亮）。
 */
import type { RGB } from '@/utils/sceneArt'

export interface MaterialRamp {
  dark: RGB
  mid: RGB
  light: RGB
  hi: RGB
}

export interface MapPalette {
  /** 白天的天空（地图外围的"画框"） */
  sky: RGB
  /** 草地/地表的基底 */
  ground: MaterialRamp
  /** 道路/泥地 */
  path: MaterialRamp
  /** 石墙/岩层 */
  stone: MaterialRamp
  /** 水 */
  water: MaterialRamp
  /** 木质（树干、木墙、栅栏） */
  wood: MaterialRamp
  /** 屋顶/瓦片 */
  roof: MaterialRamp
  /** 树冠 */
  leaf: MaterialRamp
  /** 灯火（窗、路灯、火把）—— 夜晚才亮 */
  lamp: RGB
  /** 阴影叠加（把整幅压暗用） */
  shadow: RGB
  /** 是夜晚 */
  night: boolean
}

/** 白天 */
export const MAP_DAY: Omit<MapPalette, 'night'> = {
  sky: [126, 176, 214],
  ground: { dark: [58, 82, 44], mid: [88, 122, 60], light: [118, 156, 76], hi: [152, 186, 100] },
  path:   { dark: [104, 82, 56], mid: [142, 114, 76], light: [176, 148, 104], hi: [204, 180, 138] },
  stone:  { dark: [72, 74, 84], mid: [106, 108, 118], light: [140, 142, 152], hi: [178, 180, 190] },
  water:  { dark: [28, 62, 110], mid: [42, 92, 150], light: [74, 132, 186], hi: [132, 190, 220] },
  wood:   { dark: [66, 44, 30], mid: [104, 70, 44], light: [142, 100, 62], hi: [180, 138, 92] },
  roof:   { dark: [92, 40, 36], mid: [140, 62, 50], light: [176, 92, 72], hi: [206, 130, 104] },
  leaf:   { dark: [30, 58, 32], mid: [46, 84, 42], light: [66, 112, 52], hi: [96, 146, 70] },
  lamp: [255, 214, 122],
  shadow: [18, 20, 30],
}

/** 夜晚：整体压暗偏蓝紫，材质色相保留（否则认不出是什么） */
export const MAP_NIGHT: Omit<MapPalette, 'night'> = {
  sky: [26, 30, 58],
  /*
    夜景的亮度是有意抬高的。
    第一版把地面压到 [20,30,26] 这种接近黑的值，结果整张图"糊成一团黑"，
    只有几个亮点，玩家反而看不出地形 —— 而"看得出是什么地形"比
    "显得很黑"更重要。真正的"天黑感"由**灯火暖光 + 冷色调**表达，
    不靠把画面压到看不见。
  */
  ground: { dark: [46, 62, 56], mid: [64, 84, 66], light: [82, 104, 78], hi: [104, 128, 92] },
  path:   { dark: [70, 62, 58], mid: [92, 80, 68], light: [114, 100, 84], hi: [138, 122, 100] },
  stone:  { dark: [58, 60, 76], mid: [80, 82, 100], light: [102, 104, 124], hi: [128, 130, 152] },
  water:  { dark: [28, 48, 88], mid: [42, 70, 122], light: [60, 94, 154], hi: [88, 128, 186] },
  wood:   { dark: [54, 42, 34], mid: [76, 60, 46], light: [100, 80, 62], hi: [126, 102, 78] },
  roof:   { dark: [72, 40, 40], mid: [100, 56, 52], light: [128, 74, 66], hi: [156, 96, 84] },
  leaf:   { dark: [32, 50, 38], mid: [46, 70, 52], light: [62, 90, 64], hi: [80, 114, 78] },
  lamp: [255, 222, 140],
  shadow: [14, 16, 34],
}

export function mapPalette(night: boolean): MapPalette {
  return night ? { ...MAP_NIGHT, night: true } : { ...MAP_DAY, night: false }
}

/**
 * 把某一档与阴影混合，用来做"夜晚压暗"或"阴影叠加"。
 * `k` 越大越暗。
 */
export function shade(c: RGB, shadow: RGB, k: number): RGB {
  return [
    Math.round(c[0] * (1 - k) + shadow[0] * k),
    Math.round(c[1] * (1 - k) + shadow[1] * k),
    Math.round(c[2] * (1 - k) + shadow[2] * k),
  ] as unknown as RGB
}

/** 朝灯火方向提亮（窗户、灯柱的光晕） */
export function glow(c: RGB, lamp: RGB, k: number): RGB {
  return [
    Math.round(c[0] * (1 - k) + lamp[0] * k),
    Math.round(c[1] * (1 - k) + lamp[1] * k),
    Math.round(c[2] * (1 - k) + lamp[2] * k),
  ] as unknown as RGB
}
