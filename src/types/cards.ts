/**
 * 世界卡 / 角色卡 / 玩家卡
 *
 * 设计目标：把原项目里硬编码的「1900 年代伦敦 + 防剿局 + 八种性相」
 * 全部外置成用户可编辑的数据。字段命名尽量贴近 SillyTavern V2 角色卡规范，
 * 以便直接导入现成的酒馆卡。
 */

import type { StoryEvent } from './story';
import type { WorldTone } from '@/utils/worldTone';

/** 数值属性（原 AspectState：灯/铸/刃/冬/心/杯/蛾/启） */
export interface AttributeDef {
  /** 稳定 id，AI 结算时用它，形如 `lantern` / `strength` */
  id: string;
  /** 显示名，如「灯」「力量」 */
  name: string;
  /** 说明，注入提示词，告诉 AI 这个属性代表什么 */
  description?: string;
  /** UI 强调色，十六进制 */
  color?: string;
}

/** 资源条（原 resources：资金/健康/理智） */
export interface ResourceDef {
  id: string;
  name: string;
  description?: string;
  /** 初始值 */
  initial: number;
  /** 上限；留空 = 无上限（如金钱） */
  max?: number;
  color?: string;
  /** 归零时是否做为「失败/结局」信号提示 AI */
  critical?: boolean;
}

/** 开局背景选项（原 ORIGINS / CHILDHOODS / TRAITS） */
export interface BackgroundOption {
  id: string;
  title: string;
  description?: string;
  /** 属性加成 */
  attributeBonus?: Record<string, number>;
  /** 资源加成 */
  resourceBonus?: Record<string, number>;
  /** 开局携带物品 id 列表 */
  startingItems?: string[];
}

export interface BackgroundSlot {
  /** 槽位名，如「出身」「童年」「特质」 */
  label: string;
  options: BackgroundOption[];
}

/** 预置物品/线索/知识模板 */
export interface ItemTemplate {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

export interface LoreTemplate {
  id: string;
  name: string;
  description: string;
  /** 关联的属性 id */
  attribute?: string;
  level?: number;
}

/** 一个角色卡（NPC 或可扮演角色） */
export interface CharacterCard {
  id: string;
  name: string;
  /** 头像：data URL 或 http(s) URL */
  avatar?: string;
  /**
   * 素材库头像 id（由 AI 或用户从清单里挑）。
   * 优先级低于 avatar：卡里自带图片时用图片。
   */
  avatarId?: string;

  // —— SillyTavern V2 兼容字段 ——
  description: string;
  personality: string;
  scenario: string;
  firstMessage: string;
  messageExamples: string;
  creatorNotes: string;
  systemPrompt: string;
  postHistoryInstructions: string;
  alternateGreetings: string[];
  tags: string[];
  creator: string;
  characterVersion: string;

  /** 是否在开局就登场 */
  present: boolean;
  /** 初始所处地点 */
  location?: string;
  /** 与玩家的初始关系 */
  relationship?: string;
  /** 初始状态，如「健康」「受伤」 */
  status?: string;
  /** 是否由玩家扮演（用于多主角/组队跑团） */
  playable?: boolean;

  /** 原卡里未识别的字段，原样保留以免导入导出丢数据 */
  extensions?: Record<string, unknown>;
}

export type NarrativePov = 'second' | 'first' | 'third';
export type NarrativeTense = 'past' | 'present';

export interface NarrativeStyle {
  /** 人称：第二人称「你」/ 第一人称「我」/ 第三人称 */
  pov: NarrativePov;
  /** 时态 */
  tense: NarrativeTense;
  /** 单次回复目标字数 */
  replyLength: number;
  /** 自由补充的文风要求 */
  customStyle: string;
}

export interface StorySettings {
  /** 开场设定，AI 据此写第一幕 */
  opening: string;
  /** 主线目标，可为空 = 纯沙盒 */
  mainQuest: string;
  /** 是否启用章节卡（原 prologue / chapter_1 那套脚本事件） */
  enableStages: boolean;
  /** 章节卡 */
  stages: StoryEvent[];
  /** 是否启用「选项呈现」模式（关闭后只剩自由输入） */
  enableChoices: boolean;
  /**
   * 防轨道化：连续多少回合未推进关键节点就催促 AI。
   * 0 = 关闭。原版写死为 4/5。
   */
  urgencyAfterTurns: number;
}

/** 世界卡 —— 一个完整的可玩设定 */
export interface WorldCard {
  id: string;
  /** 世界/剧本名 */
  title: string;
  /** 一句话简介 */
  tagline: string;
  /** 封面图：data URL 或 URL */
  cover?: string;

  /** 世界观设定正文 —— 替代原来的硬编码世界设定 */
  worldLore: string;
  /** 额外规则：世界运作法则、禁止事项、称呼规范等 */
  rules: string;

  /** 可自由定义的属性维度（原为写死的八种性相） */
  attributes: AttributeDef[];
  /** 可自由定义的资源条（原为写死的资金/健康/理智） */
  resources: ResourceDef[];
  /** 背景槽位（原为写死的出身/童年/特质） */
  backgrounds: BackgroundSlot[];
  /** 开局点数，用于属性分配 */
  attributePoints: number;

  /** 预置物品与知识模板 */
  items: ItemTemplate[];
  lores: LoreTemplate[];

  /** 剧情设置 */
  story: StorySettings;

  /** 叙事风格 */
  narrative: NarrativeStyle;

  /** 角色卡名册 */
  characters: CharacterCard[];

  /** 是否启用机制层（属性/资源/物品/线索结算） */
  enableMechanics: boolean;

  /**
   * **世界色调**。决定本世界的像素场景背景用哪套 16 色限色板。
   *
   * 注意：它**不影响人物立绘** —— 立绘是 LPC 像素素材，配色由 LPC 自己的
   * 调色板决定（见 lpcSprite.ts）。这个字段原本叫 avatarStyle 并用于几何头像，
   * 但那条渲染路径已退化为"角色卡没自带图片时的极小兜底"，
   * 因此这里保留旧字段名以免破坏已保存的卡片，语义已改为场景色调。
   */
  avatarStyle?: WorldTone;
  /** 场景点缀色；留空则用色调自带色 */
  avatarTone?: string;

  createdAt: number;
  updatedAt: number;
  /** 内置示例卡标记 */
  builtin?: boolean;
}

/** 玩家卡 —— 玩家自己扮演的角色（原 playerName / playerGender / playerAppearance） */
export interface PlayerCard {
  name: string;
  /** 自由文本，不再是 'male' | 'female' | 'other' */
  gender: string;
  age: string;
  appearance: string;
  personality: string;
  background: string;
  /** 其他自定义字段 */
  extra: string;
  /** 头像 */
  avatar?: string;
}

/** 一次开局前的完整配置 */
export interface StartConfig {
  worldId: string;
  player: PlayerCard;
  /** 各背景槽位选中的 option id，key 为槽位 label */
  backgroundChoices: Record<string, string>;
  /** 玩家分配的属性点 */
  attributeAllocation: Record<string, number>;
  /** 参战/在场的角色卡 id */
  activeCharacterIds: string[];
  /** 开场覆写，留空则用 world.story.opening */
  openingOverride?: string;
}

export interface LLMConfig {
  /** 预设服务商标识，'custom' 表示手填 baseUrl */
  provider: 'deepseek' | 'openai' | 'siliconflow' | 'openrouter' | 'ollama' | 'custom';
  baseUrl: string;
  apiKey: string;
  /** 叙事模型（建议用擅长写作的模型） */
  narrativeModel: string;
  /** 数据结算模型（需要稳定 JSON 输出，可用更便宜/更快的模型） */
  analysisModel: string;
  temperature: number;
  /** 为支持思维链的模型开启，用于渲染「思维链」折叠区 */
  showReasoning: boolean;
}

export interface CardBundle {
  format: 'pale-notes-bundle';
  version: 1;
  exportedAt: string;
  world?: WorldCard;
  characters?: CharacterCard[];
  player?: PlayerCard;
}

/**
 * 从卡片编辑器直接「保存并开始」时传给开局配置界面的种子。
 *
 * 为什么需要它：编辑器里的卡在点保存之前只存在于组件内存里，卡片库中还查不到。
 * 若这时直接进开局配置、按 id 去库里查，会拿到 undefined 导致界面卡死。
 * 所以把保存后的世界卡对象本身一起传过去，不依赖库里能查到。
 */
export interface SetupSeed {
  world: WorldCard;
  player?: PlayerCard;
}

