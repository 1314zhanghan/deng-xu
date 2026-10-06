/**
 * 离线渲染入口 —— 给 Node 用的渲染门面。
 *
 * 让 esbuild 把 `rpgMap` / `lpcSprite` / `appearance` 打包成一个新模块，
 * 再在**没装 DOM 垫片的情况下**导入这里的函数调用。
 *
 * 为什么要一个单独的门面，而不是让脚本直接 import 那两个模块：
 *   1. `rpgMap.ts` / `lpcSprite.ts` 用了 `@/` 别名，Node 解析不了 ——
 *      必须经 esbuild 打包，所以需要一个明确的打包入口。
 *   2. 打包后的产物里带 `import.meta.glob` 之类的 Vite 记号，
 *      由构建脚本的插件替换掉（见 `scripts/render-offline.mjs`）。
 *   3. 门面把"要渲染什么"和"怎么渲染"分开：调用方只关心
 *      "我要一张地图/一个立绘"，不关心 canvas 垫片与资源路径。
 *
 * ⚠️ 这个文件**不要**在浏览器代码里 import —— 它是构建期入口。
 */

import { generateMap, ARCHETYPE_TO_MAP, timeOfDayLabel } from '@/utils/rpgMap'
import { recipeFor, renderSprite, FRAME_SIZE, DIRECTIONS } from '@/utils/lpcSprite'
import { inferTraits } from '@/utils/appearance'
import { dayPhase, phaseLabel } from '@/utils/mapPalette'

/** 九种地形（与地图走查脚本保持一致，方便对照） */
export const ARCHETYPES = [
  'interior', 'street', 'forest', 'mountain', 'coast', 'ruins', 'underground', 'sky', 'night',
]
/** 四档时段 */
export const PHASES = ['dawn', 'day', 'dusk', 'night']

/** 渲染一张地图，返回 dataURL */
export function mapDataUrl(archetype, seed, phase) {
  return generateMap(archetype, seed, phase).dataUrl
}

/** 地图的纯像素数据（不经 base64，给需要逐像素分析的场景用） */
export function mapInfo(archetype, seed, phase) {
  const g = generateMap(archetype, seed, phase)
  return { archetype, seed, phase, width: g.width, height: g.height, dataUrl: g.dataUrl }
}

/**
 * 渲染一个角色立绘，返回 dataURL。
 *
 * @param key        随机种子（同 key 同形象）
 * @param description 角色描述 —— 外貌推断的主要输入
 * @param opts       gender / headOnly / scale / direction
 */
export async function spriteDataUrl(key, description, opts = {}) {
  const profile = { description, gender: opts.gender }
  const recipe = recipeFor(key, { profile, gender: opts.gender })
  return renderSprite(recipe, {
    headOnly: opts.headOnly,
    scale: opts.scale,
    direction: opts.direction,
  })
}

/** 立绘详情：配方 + 推断结果，供"为什么画成这样"的诊断 */
export async function spriteDetail(key, description, opts = {}) {
  const profile = { description, gender: opts.gender }
  const recipe = recipeFor(key, { profile, gender: opts.gender })
  const traits = inferTraits({ description })
  const url = await renderSprite(recipe, {
    headOnly: opts.headOnly, scale: opts.scale, direction: opts.direction,
  })
  return { key, description, traits, recipe, dataUrl: url }
}

export { FRAME_SIZE, DIRECTIONS, ARCHETYPE_TO_MAP, timeOfDayLabel, dayPhase, phaseLabel, inferTraits }
