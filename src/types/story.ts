/**
 * 通用剧情引擎类型定义
 *
 * 原版项目把「序章 / 章节 / 出身」写死成密教模拟器的剧本。
 * 这里把它们抽象成可选的「章节卡（StageCard）」，
 * 世界卡可以完全不提供章节卡 —— 那样故事就完全由 AI 自由驱动。
 */

export type StoryTrigger =
  | { type: 'chapter_start'; chapterId: number }
  | { type: 'resource_threshold'; resource: string; value: number; operator: '>' | '<' | '>=' | '<=' }
  | { type: 'aspect_threshold'; aspect: string; value: number; operator: '>' | '<' | '>=' | '<=' }
  | { type: 'has_tag'; tag: string }
  | { type: 'has_item'; itemId: string }
  | { type: 'has_lore'; loreId: string }
  | { type: 'has_fact'; factId: string }
  | { type: 'location_enter'; locationId: string }
  | { type: 'origin_is'; origin: string };

export interface StoryOption {
  id: string;
  text: string;
  /** 风格标签，对应世界卡里定义的 attributes 之一，或 neutral */
  style?: string;
  requires?: StoryTrigger[];
  effects?: any[]; // JSON state changes
  nextEventId?: string; // If this choice leads directly to another event
}

export interface StoryEvent {
  id: string;
  title?: string;
  text: string; // Can be a prompt for the LLM or static text
  isStatic?: boolean; // If true, use text directly. If false, use text as prompt.
  options: StoryOption[];
  triggers: StoryTrigger[];
  onEnter?: any[]; // Effects when event starts
  chapterId?: number;
  principleGuide?: string; // Optional guide for LLM tone
}

export interface StoryState {
  currentChapter: number;
  completedEvents: string[];
  activeEventId: string | null;
  flags: Record<string, boolean>;
  /** 玩家背景 id（来自世界卡的 backgrounds，原版是 'rich' | 'doctor' | 'detective'） */
  origin: string | null;
  childhood: string | null;
  uniqueTrait: string | null;
}
