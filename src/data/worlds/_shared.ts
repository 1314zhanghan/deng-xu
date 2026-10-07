/**
 * 世界卡工厂 —— 三个整合世界的公共工具。
 *
 * ## 为什么单独一个文件
 *
 * `CharacterCard` 有 16 个字段，其中 10 个是必填的（SillyTavern V2 兼容字段：
 * firstMessage / messageExamples / creatorNotes / systemPrompt /
 * postHistoryInstructions / alternateGreetings / tags / creator / characterVersion …）。
 *
 * 本作不使用 SillyTavern 的 `firstMessage` 与示例对话，一律留空字符串。
 * 手写角色卡时逐个补这些默认值**必然漏**（原 `builtinWorldsThemed.ts`
 * 就是为此先写了 `char()`）。三个世界各写一份会重复三遍，
 * 所以抽到这里共用。
 *
 * ## 内容标准（三个世界统一遵守）
 *
 * · **术语表**：给 AI 一套明确的专有名词，避免它自由发挥出戏
 * · **禁止词汇**：写清"什么不可能"，比堆形容词更能防跑题
 * · **机制与题材匹配**：现代题材不用"法力"，古代题材不用"接口"
 * · **至少 6 名角色卡**：让关系面板一开局就有内容
 * · **开场已在进行中**：主角不是"刚醒"，而是已经在做事
 */
import type { CharacterCard } from '@/types/cards'

/** 补全 CharacterCard 的必填默认值；只需给出 id / name / description */
export function char(
  c: Partial<CharacterCard> & Pick<CharacterCard, 'id' | 'name' | 'description'>
): CharacterCard {
  return {
    personality: '',
    firstMessage: '',
    messageExamples: '',
    creatorNotes: '',
    systemPrompt: '',
    postHistoryInstructions: '',
    alternateGreetings: [],
    tags: [],
    creator: '灯叙内置世界',
    characterVersion: '1.0',
    ...c,
  } as CharacterCard
}

/**
 * 内置世界统一使用"构建时确定"的时间戳。
 *
 * 不用 `Date.now()`：那会让每次构建产生不同的 `createdAt`，
 * 于是 `official-worldbook.json` 的产物每次都变 —— 不利于比对与缓存。
 */
export const BUILTIN_TIMESTAMP = 1735689600000   // 2025-01-01T00:00:00Z
