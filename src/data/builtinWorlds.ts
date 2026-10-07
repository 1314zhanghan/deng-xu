import type { WorldCard } from '@/types/cards'
import { deepcore } from '@/data/worlds/deepcore'
import { greatchen } from '@/data/worlds/greatchen'
import { westfantasy } from '@/data/worlds/westfantasy'
import { veil } from '@/data/worlds/veil'

/**
 * 内置世界总表（**4 个深度世界**，每个 ≥5 万字设定）。
 *
 * ## 沿革
 *
 * - 最早是九张浅卡（灰烬回响 / 霓虹雨季 / …），每张只有几百到一千多字，
 *   玩起来"太空、太杂"：AI 拿一千字设定撑不住二十轮，很快就自己编世界。
 * - 于是整合成**三个深度世界**（深核 / 大晟 / 三邦）＋**三个举一反三**
 *   （大洋 / 蒸汽 / 青铜），每个世界观正文 ≥3 万字。
 * - 再后来按用户要求收敛为**四个**：
 *   · 删掉《大洋纪年》—— 海世界的题材本质单一（洋流、季风、港口法度），
 *     铺到五万字靠的是同一个母题反复变奏，边际收益低。
 *   · 删掉《青铜纪年》—— 不符合用户审美。
 *   · 《蒸汽纪年》**整体重做**为《帷幕纪年》：主题从"工业革命的社会史"
 *     换成**维多利亚式神秘学**（优雅神秘、危险恐怖、奢靡压抑）。
 *     工业只是舞台，真正的内容是帷幕、相、遗物与结社。
 *
 * ## 四个世界
 *
 *   1. 《深核集团·地渊之下》—— 后末日反乌托邦巨型企业。
 *      喜马拉雅地下三千米、100 层的垂直企业都市，**禁用强人工智能**。
 *   2. 《大晟会典》—— 虚构的中式古风王朝，**无超自然力量**。
 *      只有武力、智谋、权力与阴谋。
 *   3. 《三邦纪年》—— 经典西方奇幻。三大政治体、五族之外还有八个族裔，
 *      低魔且有代价。
 *   4. 《帷幕纪年》—— 维多利亚式工业都城 + 神秘学。
 *      煤气灯与电报之下，现实与"另一侧"之间隔着一层**帷幕**，而它正在变薄。
 *
 * 四个世界**共用同一套设计法**：
 *
 *  1. **先立框架，再向下长**：先把"文明/族裔""意识形态""政体形态""生活方式"
 *     各铺开若干种（且彼此有结构性矛盾），再只挑一两处写死具体的人、钱与规矩。
 *     反过来做（围着一个城市写五万字）会"堆砌细节而 world 很窄"。
 *  2. **长期目标是模糊的大方向**，不是任务：每个方向内部都容得下
 *     好人、坏人与中间人。
 *  3. **明确留白**：`rules` 里都有一条"世界比这更大"——已写的只是下限。
 *  4. **沙盒优先**：都有一条独立的沙盒条款（不要催、没有必须做的事、
 *     世界自己动、允许玩家只当普通人）。见 `constants/prompts.ts`。
 *  5. **开场由"开局处境"决定**：每个世界的 `story.openerSlot` 指向一个
 *     专门的槽位，其每个选项对应一段**完整、彼此不同**的第一幕 ——
 *     而不是"同一个场景因背景不同而略有改变"。
 *
 * 达标情况由 `node scripts/check-worlds.mjs` 客观核对。
 */

/**
 * 给内置世界卡指定头像风格，让程序化生成的人物头像贴合各自题材。
 * 同一套几何造型在不同风格下观感差别很大，所以题材完全不同的卡
 * 复用同一套生成算法也不会互相违和。
 */
const AVATAR_STYLE_BY_WORLD: Record<string, { style: WorldCard['avatarStyle']; tone: string }> = {
  builtin_deepcore: { style: 'ink', tone: '#4a5568' },          // 地渊：水墨 + 冷灰（压迫、金属、地下）
  builtin_greatchen: { style: 'parchment', tone: '#8b1a1a' },   // 大晟：羊皮纸 + 朱（典章、宫墙）
  builtin_westfantasy: { style: 'parchment', tone: '#2f4f4f' }, // 三邦：羊皮纸 + 深绿（古地图、森林）
  builtin_veil: { style: 'ink', tone: '#5d4370' },              // 帷幕：水墨 + 雾紫（煤气灯、天鹅绒、另一侧）
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
  veil,
].map(withAvatarStyle)

export default BUILTIN_WORLDS
