import type { StoryEvent, StoryOption, StoryTrigger } from '@/types/story'
import type { GameState, Item } from '@/stores/game'
import type { ItemTemplate } from '@/types/cards'

/**
 * 章节卡（原 Scripted Story）引擎
 *
 * 原版把 STORY_EVENTS 写死成密教模拟器的序章剧本，并且从全局 ITEM_REGISTRY
 * 里查物品。现在事件表与物品模板都来自世界卡：
 *  - 没有章节卡时这套系统自动静默，故事完全由 AI 自由驱动；
 *  - 物品模板通过 setEvents 一并装载，不再有全局密教物品表。
 */
function templateToItem(t: ItemTemplate): Item {
  return { id: t.id, name: t.name, description: t.description, tags: [...t.tags] }
}

export class StorySystem {
  private events: Map<string, StoryEvent> = new Map()
  private itemTemplates: Map<string, ItemTemplate> = new Map()
  /** 记录当前装载的是哪张世界卡，避免重复 setEvents 造成无谓重置 */
  private sourceKey: string | null = null

  /** 装载某个世界的章节卡与物品模板 */
  public setEvents(events: StoryEvent[], itemTemplates: ItemTemplate[] = [], sourceKey?: string): void {
    const key = sourceKey ?? `${events.length}:${itemTemplates.length}`
    if (this.sourceKey === key) return
    this.sourceKey = key
    this.events = new Map(events.map(e => [e.id, e]))
    this.itemTemplates = new Map(itemTemplates.map(t => [t.id, t]))
  }

  public get all(): StoryEvent[] {
    return Array.from(this.events.values())
  }

  public getEvent(id: string): StoryEvent | undefined {
    return this.events.get(id)
  }

  public findTriggeredEvent(gameState: GameState): StoryEvent | null {
    // 已完成的事件不再触发
    const availableEvents = this.all.filter(e =>
      !gameState.story.completedEvents.includes(e.id)
    )

    for (const event of availableEvents) {
      if (this.checkTriggers(event.triggers, gameState)) {
        return event
      }
    }

    return null
  }

  public isOptionAvailable(option: StoryOption, gameState: GameState): boolean {
    if (!option.requires || option.requires.length === 0) return true
    return this.checkTriggers(option.requires, gameState)
  }

  public checkTriggers(triggers: StoryTrigger[], gameState: GameState): boolean {
    if (!triggers || triggers.length === 0) return false

    return triggers.every(trigger => {
      switch (trigger.type) {
        case 'chapter_start':
          return gameState.story.currentChapter === trigger.chapterId
        case 'origin_is':
          return gameState.story.origin === trigger.origin
        case 'has_tag':
          return gameState.tags.includes(trigger.tag)
        case 'resource_threshold': {
          const resVal = gameState.resources[trigger.resource] || 0
          switch (trigger.operator) {
            case '>': return resVal > trigger.value
            case '<': return resVal < trigger.value
            case '>=': return resVal >= trigger.value
            case '<=': return resVal <= trigger.value
            default: return false
          }
        }
        case 'aspect_threshold': {
          const aspectVal = gameState.aspects[trigger.aspect] || 0
          switch (trigger.operator) {
            case '>': return aspectVal > trigger.value
            case '<': return aspectVal < trigger.value
            case '>=': return aspectVal >= trigger.value
            case '<=': return aspectVal <= trigger.value
            default: return false
          }
        }
        case 'has_item':
          return gameState.inventory.some(i => i.id === trigger.itemId)
        case 'has_lore':
          return gameState.lores.some(l => l.id === trigger.loreId)
        case 'has_fact':
          return gameState.knownFacts.includes(trigger.factId)
        case 'location_enter':
          return gameState.location === trigger.locationId
        default:
          return false
      }
    })
  }

  public processEffects(effects: any[], store: GameState) {
    if (!effects) return

    effects.forEach(effect => {
      switch (effect.type) {
        case 'SET_ORIGIN':
          store.setOrigin(effect.value)
          break
        case 'MODIFY_RESOURCE':
          store.modifyResource(effect.target, effect.value)
          break
        case 'MODIFY_ASPECT':
          store.setAspects({ [effect.target]: (store.aspects[effect.target] || 0) + effect.value })
          break
        case 'UNLOCK_LOCATION':
          store.setLocation(effect.value)
          break
        case 'ADD_TAG':
          store.addTag(effect.value)
          break
        case 'ADD_FACT':
          store.addFact(effect.value)
          break
        case 'ADD_ITEM': {
          if (typeof effect.value === 'string') {
            // 章节卡用字符串引用物品时，从世界卡的物品模板里查
            const template = this.itemTemplates.get(effect.value)
            if (template) store.addItem(templateToItem(template))
          } else if (effect.value && typeof effect.value === 'object') {
            store.addItem(effect.value)
          }
          break
        }
        case 'REMOVE_ITEM':
          store.removeItem(effect.value)
          break
        case 'CHAPTER_COMPLETE':
          store.setStoryState({ currentChapter: effect.value + 1 })
          break
        case 'SET_CHAPTER':
          store.setStoryState({ currentChapter: effect.value })
          break
        case 'SET_IDENTITY':
          store.setIdentity(effect.value)
          break
        case 'ADD_CHARACTER':
          store.addCharacter(effect.value)
          break
        case 'UPDATE_CHARACTER':
          store.updateCharacter(effect.value.id, effect.value.updates)
          break
        case 'ADD_RITE':
          store.addRite(effect.value)
          break
        case 'ADD_LORE': {
          const template = this.itemTemplates.get(effect.value)
          if (template) {
            const principle = template.tags.find(t => t !== 'lore' && !t.startsWith('level_')) || 'neutral'
            store.markLoreAsMastered({
              id: template.id,
              name: template.name,
              description: template.description,
              principle,
              level: 1
            })
          }
          break
        }
        case 'ADD_LANGUAGE':
          store.addLanguage(effect.value)
          break
      }
    })
  }
}

export const storySystem = new StorySystem()
