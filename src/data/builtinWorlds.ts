import type { WorldCard } from '@/types/cards'
import { deepcore } from '@/data/worlds/deepcore'
import { greatchen } from '@/data/worlds/greatchen'
import { westfantasy } from '@/data/worlds/westfantasy'

/**
 * 内置世界总表。
 *
 * ## 2026-10 重构：9 个世界 → 3 个深度世界
 *
 * 原先的九张内置卡（灰烬回响 / 霓虹雨季 / 星海拾遗 / 银冠之下 /
 * 被召唤的第七天 / 问剑帖 / 凌晨三点的便利店 / 长安十二年 / 雨没有停过）
 * 每张的世界观正文只有几百到一千多字 —— 铺得广而浅，玩起来"太空、太杂"：
 * AI 拿到一千字的设定，撑不住二十轮，很快就会自己编世界。
 *
 * 现在整合为**三个深度世界**，每个世界观正文 ≥3 万字（全卡 ≥5 万字）：
 *
 *   1. 《深核集团·地渊之下》—— 后末日反乌托邦巨型企业。
 *      吸收霓虹雨季（义体与记忆产业）、凌晨三点的便利店（夜班劳工）、
 *      雨没有停过（灾后日常）、灰烬回响（废墟与信仰）的质感，
 *      统一收进"喜马拉雅地下三千米、100 层的垂直企业都市"这一个框架。
 *   2. 《大晟会典》—— 虚构的中式古风王朝，**无超自然力量**。
 *      只有武力、智谋、权力与阴谋；盛世万国来朝的阴影下暗流涌动。
 *      吸收长安十二年（财政与党争）与问剑帖（江湖与规矩）的质感，
 *      但**彻底去掉仙侠成分**。
 *   3. 《三邦纪年》—— 经典西方奇幻。
 *      帝国 / 王国 / 联邦三大政治体，人类 / 精灵 / 矮人 / 兽人 / 龙五个种族。
 *      吸收银冠之下（王位空悬）与被召唤的第七天（异乡人的处境）的质感。
 *
 * ## 达标情况怎么核对
 *
 *   node scripts/check-worlds.mjs
 *
 * 它会客观核对：每世界中文字数 ≥5 万、worldLore ≥3 万、结构完整性、
 * `startingItems` 等引用是否指向真实存在的 id、题材禁用词、
 * 以及角色卡是否写清性别线索（引擎靠它推断立绘性别）。
 */

/**
 * 给内置世界卡指定头像风格，让程序化生成的人物头像贴合各自题材。
 * 同一套几何造型在不同风格下观感差别很大，所以三张题材完全不同的卡
 * 复用同一套生成算法也不会互相违和。
 */
const AVATAR_STYLE_BY_WORLD: Record<string, { style: WorldCard['avatarStyle']; tone: string }> = {
  builtin_deepcore: { style: 'ink', tone: '#4a5568' },          // 地渊：水墨 + 冷灰（压迫、金属、地下）
  builtin_greatchen: { style: 'parchment', tone: '#8b1a1a' },   // 大晟：羊皮纸 + 朱（典章、宫墙）
  builtin_westfantasy: { style: 'parchment', tone: '#2f4f4f' }, // 三邦：羊皮纸 + 深绿（古地图、森林）
}

function withAvatarStyle(world: WorldCard): WorldCard {
  const preset = AVATAR_STYLE_BY_WORLD[world.id]
  if (!preset) return world
  return { ...world, avatarStyle: preset.style, avatarTone: preset.tone }
}

export const BUILTIN_WORLDS: WorldCard[] = [
  deepcore,
  greatchen,
  westfantasy,
].map(withAvatarStyle)

export default BUILTIN_WORLDS
