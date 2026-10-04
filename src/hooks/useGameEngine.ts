import { useState } from 'react'
import { useGameStore, type GameState } from '@/stores/game'
import { useSessionStore } from '@/stores/session'
import { useUIStore } from '@/stores/ui'
import { useMetaStore } from '@/stores/meta'
import { llmChat, extractContent, parseSseLine, type ChatMessage } from '@/api/llm'
import { parseModelJson } from '@/api/jsonRepair'
import {
  buildNarrativeSystemPrompt,
  buildDataSystemPrompt,
  buildOpeningInstruction,
  buildSummaryPrompt
} from '@/constants/prompts'
import { storySystem } from '@/systems/StorySystem'
import { pickAvatarId } from '@/utils/avatarArt'
import { isKnownSceneId } from '@/utils/sceneArt'
import { LlmError, classifyLlmError } from '@/api/llmErrors'
import type { LLMConfig, WorldCard } from '@/types/cards'
import { detectTruncation } from '@/utils/truncation'
import {
  needsArchive,
  isHistoryPressureHigh,
  archiveOldMessages,
  type HistoryMessage,
} from '@/utils/historyArchive'

/**
 * 按需把较旧的叙事归档到 IndexedDB，让 localStorage 里的热数据保持有界。
 *
 * 触发条件有三个，任一满足就动手：
 *  - 条数超过阈值（常规滚动）
 *  - 估算**体积**已偏高（提前抢救，不等配额真的写满）
 *
 * 为什么要同时看条数和体积：
 * 只按条数会漏 —— 某些模型一次就吐两三千字，120 条热数据能有 3MB+，
 * 照样撞上 localStorage 的 5MB 配额。体积才是真正的约束，
 * 条数只是"别让数组无限长"的粗略护栏。
 */
async function maybeArchiveHistory(): Promise<void> {
  const st = useGameStore.getState()
  const history = st.history as HistoryMessage[]
  if (!history?.length) return

  const pressure = isHistoryPressureHigh(history)
  const tooMany = needsArchive(history, pressure)
  if (!pressure && !tooMany) return

  const { hot, archived, ok } = await archiveOldMessages(history, pressure)
  if (!ok) {
    console.warn('[archive] 归档写入失败，保持历史不裁剪以免丢数据')
    return
  }
  if (archived > 0) {
    useGameStore.setState({ history: hot })
    console.info(`[archive] 已归档 ${archived} 条旧叙事，热数据保留 ${hot.length} 条`)
  }
}

/**
 * 叙事被截断时，请求模型**接着写完**，再与已写的部分拼接。
 *
 * 为什么用"续写"而不是"重新生成"：
 *  重新生成会把已经写好、玩家可能已经读了一半的内容全部作废 ——
 *  对于长段落，这个代价太大。续写只补最后那一小段。
 *
 * 拼接时会做重叠去重：模型往往会把已经写过的最后一句再重复一遍，
 * 直接拼接会出现"他推开门。他推开门。"这种重复。
 *
 * 失败（网络错、返回空、也抛错）时返回 null，让调用方退回"提示玩家"的路径。
 */
async function tryContinueNarrative(
  partial: string,
  config: LLMConfig,
  world: WorldCard | null | undefined
): Promise<string | null> {
  try {
    const tail = partial.slice(-600)   // 只把结尾交给模型，避免上下文翻倍
    const res = await llmChat({
      messages: [
        {
          role: 'system',
          content: '你是一个续写助手。用户会给你一段被截断的小说正文，'
            + '请**接着最后一个字继续写完**。'
            + '要求：不要重复已写的内容；不要写任何解释、标题或标记；'
            + '不要另起一段重讲；直接输出接下来的文字，直到这一段自然结束。',
        },
        {
          role: 'user',
          content: `以下正文在结尾处被截断了，请接着写完：\n\n---\n${tail}\n---`,
        },
      ],
      config,
      model: config.narrativeModel,
      stream: false,
      temperature: 0.6,
    })

    const text: string = res?.choices?.[0]?.message?.content || ''
    const clean = String(text).trim()
    if (!clean) return null

    return mergeContinuation(partial, clean, world)
  } catch (e) {
    console.warn('[continue] 续写失败，退回提示路径', e)
    return null
  }
}

/**
 * 把续写片段拼到原文后面，并去掉模型常见的"重复已写内容"。
 *
 * 两种情况都要处理：
 *   A. 续写从整句之后接上 → 原文的结尾是续写的前缀
 *      「他推开门。」 + 「他推开门。屋里很冷。」
 *   B. 续写从半句之后接上 → 原文的结尾**被包含在**续写里
 *      「他推开门，看见」 + 「看见桌上放着一封信。」
 *
 * 第一版只做了 A 的正向 `startsWith`，B 完全没覆盖；而且把最小重叠长度
 * 写成 6，导致只有 5 个字符的「他推开门。」被直接滤掉 —— 去重反而失效。
 * 现在改成**在两侧之间找最大重叠**，长度下界 4 个字（太短会误删真实内容）。
 *
 * 实现与 `src/utils/continuation.test.ts` 里的副本保持一致（那边有测试）。
 */
export function mergeContinuation(original: string, continuation: string, _world?: unknown): string {
  const a = original.replace(/\s+$/, '')
  const b = continuation.trim()
  if (!b) return a
  if (a.endsWith(b)) return a

  const max = Math.min(a.length, b.length)
  for (let len = max; len >= 4; len--) {
    const tail = a.slice(a.length - len)
    const head = b.slice(0, len)
    if (tail === head) return a + b.slice(len)
  }

  const needSpace = /[A-Za-z0-9,.;:'"]$/.test(a) && /^[A-Za-z0-9]/.test(b)
  return a + (needSpace ? ' ' : '') + b
}

/**
 * 把引擎里抛出的任何错误转成**玩家能看懂的一句话**。
 *
 * 之前直接把 error.message 显示出来，于是界面上出现的是
 * 「429 Too Many Requests - {"error":{"message":"Rate limit reached..."}}」
 * 这种原始串 —— 玩家分不清是余额不足、Key 写错还是被限流，
 * 而这三者的处理方式完全不同。
 */
function formatEngineError(error: unknown): string {
  if (error instanceof LlmError) {
    const { message, hint } = error.info
    return hint ? `${message}（${hint}）` : message
  }
  // 非 LLM 错误（例如我们自己抛的"模型返回了空内容"）保留原文，
  // 那些句子本来就是写给玩家看的
  const raw = (error as Error)?.message
  if (raw) return raw
  const info = classifyLlmError(undefined, '', error)
  return info.message
}
import { useLibraryStore } from '@/stores/library'

interface GameEngineReturn {
  handleAction: (actionId: string, actionText: string) => Promise<void>
  retryLastAction: () => Promise<void>
  isProcessing: boolean
  isAnalyzingData: boolean
  lastError: string | null
  /** 疑似截断的提示（非错误，可关闭） */
  truncationWarning: string | null
  clearTruncationWarning: () => void
  currentOptions: any[]
  streamingContent: string | null
  streamingReasoning: string | null
  debugDataInput: string | null
  debugDataOutput: string | null
  isInputAllowed: boolean
}

export function useGameEngine(): GameEngineReturn {
  // @ts-ignore 用于触发 UI 重渲染，实际读写都走 getState()
  const store = useGameStore()

  const [isProcessing, setIsProcessing] = useState(false)
  const [isAnalyzingData, setIsAnalyzingData] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  /**
   * 截断提示。
   * 与 lastError 分开：这不是"失败"，这一轮是成功生成的，
   * 只是可能没写完 —— 用警告样式而不是错误样式，可关闭。
   */
  const [truncationWarning, setTruncationWarning] = useState<string | null>(null)
  const [streamingContent, setStreamingContent] = useState<string | null>(null)
  const [streamingReasoning, setStreamingReasoning] = useState<string | null>(null)
  const [turnCount, setTurnCount] = useState(0)
  const [lastAction, setLastAction] = useState<{ id: string; text: string } | null>(null)
  const [debugDataInput, setDebugDataInput] = useState<string | null>(null)
  const [debugDataOutput, setDebugDataOutput] = useState<string | null>(null)

  const { story, turnsSinceLastMajorEvent } = store
  const world = useSessionStore(s => s.world)

  // 关键节点拖延过久时，强制玩家从事件选项里做出选择
  const urgencyAfter = world?.story.urgencyAfterTurns || 5
  let isInputAllowed = true
  if (story.activeEventId) {
    const event = storySystem.getEvent(story.activeEventId)
    if (event && event.options && event.options.length > 0 && turnsSinceLastMajorEvent >= urgencyAfter) {
      isInputAllowed = false
    }
  }

  const getDominantAspect = (aspects: Record<string, number>) => {
    let max = 0
    let dominant = 'neutral'
    for (const key in aspects) {
      if (aspects[key] > max) {
        max = aspects[key]
        dominant = key
      }
    }
    return max > 0 ? dominant : 'neutral'
  }

  /** 把当前存档投影成给模型看的 JSON 上下文 */
  const buildContext = (actionText: string, currentState: GameState, storyContext?: string) => {
    const {
      resources, aspects, inventory, location, tags, story, knownFacts, readBooks,
      masteredLores, rites, languages, characters, unlockedDoors, time, identity,
      summary, playerName, playerGender, playerAppearance, turnsSinceLastMajorEvent,
      attributeDefs, resourceDefs
    } = currentState

    const attributes = Object.fromEntries(
      attributeDefs.map(d => [d.id, aspects[d.id] ?? 0])
    )
    const resourcesNamed = Object.fromEntries(
      resourceDefs.map(d => [d.id, { 名称: d.name, 当前: resources[d.id] ?? 0, 上限: d.max ?? null }])
    )

    // 把开局选定的背景（出身）解析成可读文本，交给 AI 作为"掉落与线索的依据"。
    const world = useSessionStore.getState().world
    const choices = useSessionStore.getState().backgroundChoices
    const bgLines = world
      ? world.backgrounds
          .map(slot => {
            const opt = slot.options.find(o => o.id === choices[slot.label])
            if (!opt) return null
            const bonusBits = [
              ...Object.entries(opt.attributeBonus || {}).map(([k, v]) => {
                const d = attributeDefs.find(a => a.id === k)
                return `${d?.name || k}${v >= 0 ? '+' : ''}${v}`
              }),
              ...Object.entries(opt.resourceBonus || {}).map(([k, v]) => {
                const d = resourceDefs.find(r => r.id === k)
                return `${d?.name || k}${v >= 0 ? '+' : ''}${v}`
              }),
            ]
            const carried = (opt.startingItems || [])
              .map(id => world.items.find(i => i.id === id)?.name)
              .filter(Boolean)
            return {
              分类: slot.label,
              选择: opt.title,
              说明: opt.description || '',
              数值加成: bonusBits,
              开局携带: carried,
            }
          })
          .filter(Boolean)
      : []

    const backgroundOfPlayer = {
      title: bgLines.map((b: any) => b.选择).join(' / ') || '（未设定）',
      description: bgLines.map((b: any) => `${b.分类}：${b.说明}`).filter((s: string) => !s.endsWith('：')).join('；'),
      bonus: bgLines.flatMap((b: any) => b.数值加成),
      items: bgLines.flatMap((b: any) => b.开局携带),
    }

    return JSON.stringify({
      playerState: {
        profile: {
          name: playerName,
          gender: playerGender,
          appearance: playerAppearance
        },
        /**
         * 玩家在开局选的出身 / 背景。
         *
         * 这两项以前**完全没有传给 AI** —— 所以无论玩家选什么背景，
         * AI 发物品、给线索、写外貌时都看不到，开局拿到的东西自然千篇一律。
         * 补上之后 AI 才有依据做"与出身相关"的内容。
         */
        background: {
          标题: backgroundOfPlayer.title,
          描述: backgroundOfPlayer.description,
          数值加成: backgroundOfPlayer.bonus,
          开局携带: backgroundOfPlayer.items
        },
        attributes,
        dominantAttribute: getDominantAspect(aspects),
        resources: resourcesNamed,
        inventory: inventory.map(i => ({ id: i.id, name: i.name })),
        tags,
        story: {
          chapter: story.currentChapter,
          activeEventId: story.activeEventId
        },
        knownFacts,
        readBooks,
        masteredLores,
        rites,
        languages,
        relationships: characters,
        unlockedDoors
      },
      worldState: {
        location,
        // 当前场景背景，让 AI 知道"要不要换"（相同就不发 SET_SCENE）
        sceneId: currentState.sceneId,
        time,
        identity,
        turnsSinceLastMajorEvent
      },
      userAction: actionText,
      storyContext: storyContext || undefined,
      previousSummary: summary || undefined
    })
  }

  /**
   * 应用数据 AI 给出的状态变更
   */
  const handleStateChanges = (changes: any[]) => {
    if (!Array.isArray(changes)) return

    const {
      modifyResource, setAspects, addTag, setLocation, addItem, removeItem,
      addFact, addCharacter, updateCharacter, addRite, addLanguage,
      markBookAsRead, markLoreAsMastered, setStoryState, advanceTime, setIdentity,
      addHistory, addLocationInfo, completeEvent
    } = useGameStore.getState()

    const summaryLines: string[] = []

    changes.forEach(change => {
      if (!change || typeof change.type !== 'string') return

      switch (change.type) {
        case 'MODIFY_RESOURCE':
          modifyResource(change.target, change.value)
          summaryLines.push(`${change.target} ${change.value > 0 ? '+' : ''}${change.value}`)
          break

        case 'MODIFY_ASPECT': {
          const current = useGameStore.getState().aspects
          setAspects({ [change.target]: (current[change.target] || 0) + change.value })
          summaryLines.push(`属性 ${change.target} ${change.value > 0 ? '+' : ''}${change.value}`)
          break
        }

        case 'ADD_TAG':
          addTag(change.target)
          break

        case 'UNLOCK_LOCATION':
          setLocation(change.target)
          summaryLines.push(`地点：${change.target}`)
          break

        case 'ADD_ITEM': {
          const payload = change.payload
          if (payload && payload.name) {
            addItem({
              id: payload.id || payload.name,
              name: payload.name,
              description: payload.description || '',
              tags: Array.isArray(payload.tags) ? payload.tags : []
            })
            summaryLines.push(`获得物品：${payload.name}`)
          } else if (typeof change.target === 'string') {
            // 没有 payload 时，从世界卡的物品模板里找
            const template = useLibraryStore.getState().getWorld(useSessionStore.getState().world?.id || '')
              ?.items.find(i => i.id === change.target)
            if (template) {
              addItem({ ...template, tags: [...template.tags] })
              summaryLines.push(`获得物品：${template.name}`)
            }
          }
          break
        }

        case 'REMOVE_ITEM':
          removeItem(change.target)
          summaryLines.push(`失去物品：${change.target}`)
          break

        case 'ADD_FACT': {
          const payload = change.payload
          if (payload && payload.name) {
            addFact({
              id: payload.id || payload.name,
              name: payload.name,
              description: payload.description || ''
            })
            summaryLines.push(`获得线索：${payload.name}`)
          } else if (typeof change.target === 'string') {
            addFact(change.target)
          }
          break
        }

        case 'ADD_CHARACTER':
          if (change.payload && change.payload.name) {
            const cid = change.payload.id || change.payload.name
            addCharacter({
              id: cid,
              name: change.payload.name,
              description: change.payload.description || '',
              relationship: change.payload.relationship || '未知',
              status: change.payload.status || '正常',
              location: change.payload.location,
              // 头像 id 必须校验：模型可能给出清单外的值，也可能和别人撞车。
              // 非法或重复就丢掉，由 resolveAvatar 退回按 id 哈希生成，绝不出现裂图。
              avatarId: pickAvatarId(
                change.payload.avatarId,
                cid,
                useGameStore.getState().characters.map(c => (c.id === cid ? undefined : c.avatarId))
              ),
            })
            summaryLines.push(`登场人物：${change.payload.name}`)
          }
          break

        case 'UPDATE_CHARACTER':
          if (change.payload?.id) {
            updateCharacter(change.payload.id, change.payload.updates || {})
            summaryLines.push(`人物更新：${change.payload.id}`)
          }
          break

        case 'ADD_LOCATION':
          if (change.payload && change.payload.name) {
            addLocationInfo({
              id: change.payload.id || change.payload.name,
              name: change.payload.name,
              description: change.payload.description || '',
              isUnlocked: change.payload.isUnlocked !== false
            })
            summaryLines.push(`地点记录：${change.payload.name}`)
          }
          break

        case 'ADD_RITE':
          if (change.payload?.name) {
            addRite(change.payload)
            summaryLines.push(`习得：${change.payload.name}`)
          }
          break

        case 'ADD_LANGUAGE':
          if (change.payload?.name) {
            addLanguage(change.payload)
            summaryLines.push(`习得语言：${change.payload.name}`)
          }
          break

        case 'MARK_BOOK_READ':
          markBookAsRead(change.target)
          break

        case 'USE_LORE':
          summaryLines.push(`使用知识：${change.target}`)
          break

        case 'USE_ITEM':
          summaryLines.push(`使用物品：${change.target}`)
          break

        case 'MARK_LORE_MASTERED': {
          const payload = change.payload
          if (payload && payload.name) {
            markLoreAsMastered({
              id: payload.id || payload.name,
              name: payload.name,
              description: payload.description || '',
              principle: payload.aspect || 'neutral',
              level: payload.level || 1
            })
            summaryLines.push(`掌握知识：${payload.name}`)
          } else if (typeof change.target === 'string') {
            markLoreAsMastered(change.target)
          }
          break
        }

        case 'SET_CHAPTER': {
          const oldChapter = useGameStore.getState().story.currentChapter
          const newChapter = change.value
          setStoryState({ currentChapter: newChapter })
          useMetaStore.getState().updateMaxChapter(newChapter)
          if (oldChapter === 0 && newChapter === 1) {
            const origin = useGameStore.getState().story.origin
            if (origin) useMetaStore.getState().markOriginComplete(origin)
          }
          break
        }

        case 'MODIFY_TIME':
          if (typeof change.value === 'number') advanceTime(change.value)
          break

        case 'SET_SCENE':
          // 校验 id：模型可能编造清单外的值，非法就忽略（保留当前背景，
          // 比切到一张空图要好）。相同值也跳过，避免无谓重渲染。
          if (isKnownSceneId(change.target) && useGameStore.getState().sceneId !== change.target) {
            useGameStore.getState().setScene(change.target)
          }
          break

        case 'SET_IDENTITY':
          setIdentity(change.target)
          summaryLines.push(`身份变更：${change.target}`)
          break

        case 'COMPLETE_EVENT':
          completeEvent(change.target)
          if (useGameStore.getState().story.activeEventId === change.target) {
            setStoryState({ activeEventId: null })
          }
          break

        case 'TRIGGER_EVENT':
          setStoryState({ activeEventId: change.target })
          useMetaStore.getState().addKeyEvent(change.target)
          break
      }
    })

    // 防轨道化：单个选项视为关键节点，选完重置计数
    const options = useGameStore.getState().currentOptions
    if (options && options.length === 1) {
      useGameStore.getState().resetTurnCounter()
    } else {
      useGameStore.getState().incrementTurnCounter()
    }

    if (summaryLines.length > 0) {
      addHistory({
        role: 'system',
        content: `> **状态变更**: \n${summaryLines.join('\n')}`,
        timestamp: Date.now()
      })
    }
  }

  /** 历史压缩 */
  const summarizeHistory = async () => {
    const { history, summary, updateSummary } = useGameStore.getState()
    if (history.length < 12) return

    const olderHistory = history.slice(0, -12)
    const textToSummarize = olderHistory
      .filter(h => h.role !== 'system')
      .map(h => `${h.role === 'user' ? '玩家' : '叙事'}：${h.content}`)
      .join('\n')
    if (!textToSummarize.trim()) return

    const config = useUIStore.getState().llm
    try {
      const response = await llmChat({
        messages: [{ role: 'user', content: buildSummaryPrompt(summary, textToSummarize) }],
        config,
        model: config.analysisModel,
        stream: false,
        temperature: 0.3
      })
      const newSummary = extractContent(response)
      if (newSummary) updateSummary(newSummary)
    } catch (e) {
      // 摘要失败不该打断游戏
      console.warn('Summarization failed', e)
    }
  }

  /** 一轮交互：叙事生成 → 数据结算 */
  const processTurn = async (actionText: string, actionType: 'option' | 'custom' | 'init' = 'option') => {
    const config = useUIStore.getState().llm
    const session = useSessionStore.getState()
    const activeWorld = session.world
    const player = session.player

    if (!activeWorld || !player) {
      setLastError('尚未选择世界卡，请回到标题页新建或选择一张卡。')
      return
    }
    if (!config.baseUrl) {
      setLastError('尚未配置模型接口地址。')
      return
    }
    if (!config.apiKey && config.provider !== 'ollama') {
      setLastError('尚未配置 API Key。')
      return
    }

    setIsProcessing(true)
    setLastError(null)
    setStreamingContent('')
    setStreamingReasoning('')

    if (turnCount > 0 && turnCount % 6 === 0) summarizeHistory()
    setTurnCount(prev => prev + 1)

    try {
      // —— 装载章节卡，保证事件表与当前世界一致 ——
      storySystem.setEvents(
        activeWorld.story.enableStages ? activeWorld.story.stages : [],
        activeWorld.items,
        `${activeWorld.id}:${activeWorld.updatedAt}`
      )

      const activeCharacters = session.getActiveCharacters()
      const updatedStore = useGameStore.getState()

      let currentStoryContext: string | undefined
      let pendingKeyOptions: any[] = []

      // —— 章节卡事件检查 ——
      let activeEvent = null
      if (activeWorld.story.enableStages) {
        if (updatedStore.story.activeEventId) {
          activeEvent = storySystem.getEvent(updatedStore.story.activeEventId) || null
        }
        if (!activeEvent) {
          activeEvent = storySystem.findTriggeredEvent(updatedStore)
          if (activeEvent) {
            updatedStore.setStoryState({ activeEventId: activeEvent.id })
            useMetaStore.getState().addKeyEvent(activeEvent.id)
            useGameStore.getState().resetTurnCounter()
            if (activeEvent.onEnter) {
              storySystem.processEffects(activeEvent.onEnter, useGameStore.getState())
            }
          }
        }
      }

      if (activeEvent) {
        currentStoryContext = `[系统事件触发: ${activeEvent.title || activeEvent.id}]\n${activeEvent.text}`
        const currentTurns = useGameStore.getState().turnsSinceLastMajorEvent
        if (currentTurns >= activeWorld.story.urgencyAfterTurns) {
          currentStoryContext += `\n[紧迫感指令]: 玩家已在此场景逗留 ${currentTurns} 回合。必须在叙事中体现局势的紧迫与时间的流逝，暗示不可再拖延。`
        }
        if (activeEvent.options?.length) {
          pendingKeyOptions = activeEvent.options.map(opt => ({
            id: opt.id,
            text: opt.text,
            style: 'neutral'
          }))
        }
      } else {
        const completed = updatedStore.story.completedEvents
        if (completed.length > 0) {
          const titles = completed
            .map(id => storySystem.getEvent(id)?.title || id)
            .filter(Boolean)
            .join('、')
          currentStoryContext = `[已完成事件]: ${titles}。不要重复这些情节，聚焦新的探索。`
        }
      }

      // 开场第一幕
      const isOpening = actionType === 'init' || updatedStore.history.filter(h => h.role === 'assistant').length === 0
      if (isOpening && !activeEvent) {
        const opening = buildOpeningInstruction(activeWorld, player, activeCharacters)
        currentStoryContext = currentStoryContext ? `${currentStoryContext}\n\n${opening}` : opening
      }

      // —— 第一阶段：叙事 ——
      useUIStore.getState().setStatusMessage('正在生成叙事…')
      const context = buildContext(actionText, useGameStore.getState(), currentStoryContext)

      const narrativeMessages: ChatMessage[] = [
        { role: 'system', content: buildNarrativeSystemPrompt(activeWorld, activeCharacters, player) },
        ...(updatedStore.summary ? [{ role: 'system' as const, content: `[前情摘要]\n${updatedStore.summary}` }] : []),
        ...updatedStore.history
          .slice(-12)
          .filter(h => h.role !== 'system')
          .map(h => ({ role: h.role as 'user' | 'assistant', content: h.content })),
        { role: 'user', content: context }
      ]

      const streamResponse = await llmChat({
        messages: narrativeMessages,
        config,
        model: config.narrativeModel,
        stream: true
      }) as Response

      const reader = streamResponse.body?.getReader()
      if (!reader) throw new Error('无法读取模型响应流')

      const decoder = new TextDecoder()
      let fullNarrative = ''
      let fullReasoning = ''
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        // 最后一行可能被截断，留到下次
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const chunk = parseSseLine(line.trim())
          if (!chunk) continue
          if (chunk.reasoning) {
            fullReasoning += chunk.reasoning
            setStreamingReasoning(fullReasoning)
          }
          if (chunk.content) {
            fullNarrative += chunk.content
            setStreamingContent(fullNarrative)
          }
        }
      }
      // 处理残留缓冲
      const tail = parseSseLine(buffer.trim())
      if (tail?.content) {
        fullNarrative += tail.content
        setStreamingContent(fullNarrative)
      }

      if (!fullNarrative.trim()) throw new Error('模型返回了空内容，请检查模型名称与接口地址。')

      /*
        截断检测。
        模型可能在句子中间被切断（max_tokens 用尽、流被中断），
        返回的既不是空串也不是错误，而是一段"看起来正常但停在半句"的文本 ——
        它会照原样进入历史与下一轮上下文，故事里凭空多一个断句，
        而玩家完全不知道为什么。这里标出来让他决定要不要重新生成。
      */
      /*
        截断检测与**自动续写**。

        模型可能在句子中间被切断（max_tokens 用尽、流被中断），
        返回的既不是空串也不是错误，而是一段"看起来正常但停在半句"的文本。

        上一版只做提示，玩家要自己点重新生成 —— 而重生成会把已经写好的
        那半段整体作废，代价太大。这里改成**自动请求补全**：
        把已写的部分作为前缀交给模型，请它接着写完，再拼起来。

        只续一次。续写也可能再次被截断，第二次就直接提示玩家 ——
        否则会陷入"无限续写"，既费 token 又永远停不下来。
      */
      let finalNarrative = fullNarrative
      let trunc = detectTruncation(finalNarrative, activeWorld?.narrative?.replyLength)
      if (trunc.truncated) {
        const continued = await tryContinueNarrative(finalNarrative, config, activeWorld)
        if (continued) {
          finalNarrative = continued
          trunc = detectTruncation(finalNarrative, activeWorld?.narrative?.replyLength)
          if (!trunc.truncated) {
            // 续写成功：明确告诉玩家发生了什么，而不是静默拼上
            useUIStore.getState().setStatusMessage('这段叙事曾被截断，已自动补全')
            setTimeout(() => useUIStore.getState().setStatusMessage(null), 2500)
          }
        }
      }

      if (trunc.truncated) {
        setTruncationWarning(trunc.reason || '这段叙事可能没有写完')
      } else {
        setTruncationWarning(null)
      }

      useGameStore.getState().addHistory({ role: 'assistant', content: finalNarrative, timestamp: Date.now() })
      setStreamingContent(null)
      setStreamingReasoning(null)

      // 归档检查放在每轮叙事之后：这是 history 唯一增长的地方，
      // 在这里查一次就能保证 localStorage 里的热数据始终有界，
      // 不会等撞到 5MB 配额、写入静默失败之后才发现。
      void maybeArchiveHistory()

      // —— 第二阶段：数据结算 ——
      useUIStore.getState().setStatusMessage('正在结算世界状态…')
      setIsAnalyzingData(true)

      const afterNarrative = useGameStore.getState()
      const dataAnalysisContext = JSON.stringify({
        userAction: actionText,
        userActionType: actionType,
        narrativeOutput: fullNarrative,
        storyContext: currentStoryContext,
        currentState: {
          attributes: Object.fromEntries(
            afterNarrative.attributeDefs.map(d => [d.id, afterNarrative.aspects[d.id] ?? 0])
          ),
          resources: Object.fromEntries(
            afterNarrative.resourceDefs.map(d => [
              d.id,
              { 名称: d.name, 当前: afterNarrative.resources[d.id] ?? 0, 上限: d.max ?? null }
            ])
          ),
          inventory: afterNarrative.inventory,
          facts: afterNarrative.facts,
          story: afterNarrative.story,
          characters: afterNarrative.characters,
          location: afterNarrative.location,
          sceneId: afterNarrative.sceneId,
          time: afterNarrative.time
        }
      })
      setDebugDataInput(dataAnalysisContext)

      const dataResponse = await llmChat({
        messages: [
          { role: 'system', content: buildDataSystemPrompt(activeWorld) },
          { role: 'user', content: dataAnalysisContext }
        ],
        config,
        model: config.analysisModel,
        stream: false,
        temperature: 0.2,
        jsonMode: true
      })

      const dataContent = extractContent(dataResponse)
      setDebugDataOutput(dataContent)

      try {
        const parsed = parseModelJson(dataContent).value as any
        if (!parsed || typeof parsed !== 'object') {
          throw new Error('解析结果不是对象')
        }

        // 章节卡的关键选项按拖延程度注入
        if (pendingKeyOptions.length > 0) {
          const currentTurns = useGameStore.getState().turnsSinceLastMajorEvent
          if (currentTurns >= activeWorld.story.urgencyAfterTurns) {
            parsed.options = pendingKeyOptions
          } else if (currentTurns >= 2) {
            const existingIds = new Set((parsed.options || []).map((o: any) => o.id))
            parsed.options = [
              ...(parsed.options || []),
              ...pendingKeyOptions.filter(o => !existingIds.has(o.id))
            ]
          }
        }

        handleStateChanges(parsed.stateChanges)

        const options = activeWorld.story.enableChoices ? (parsed.options || []) : []
        useGameStore.getState().setCurrentOptions(options)
      } catch (e) {
        console.error('Failed to parse Data AI response', e)
        setLastError('数据结算返回的内容无法解析为 JSON（已重试截断解析）。可点开右下角调试面板查看原始输出。')
      }

      setIsAnalyzingData(false)
    } catch (error: any) {
      console.error('Game Engine Error:', error)
      setLastError(formatEngineError(error))
      setIsAnalyzingData(false)
    } finally {
      setIsProcessing(false)
      setStreamingContent(null)
      setStreamingReasoning(null)
      useUIStore.getState().setStatusMessage(null)
    }
  }

  const handleAction = async (actionId: string, actionText: string) => {
    const currentStore = useGameStore.getState()

    currentStore.saveSnapshot()
    useUIStore.getState().setStatusMessage('处理行动中…')

    // 如果玩家点的是章节卡事件选项，先结算事件效果
    if (currentStore.story.activeEventId) {
      const event = storySystem.getEvent(currentStore.story.activeEventId)
      const selectedOption = event?.options?.find(o => o.id === actionId)
      if (selectedOption) {
        if (selectedOption.effects) {
          storySystem.processEffects(selectedOption.effects, useGameStore.getState())
        }
        useGameStore.getState().completeEvent(currentStore.story.activeEventId)
        useGameStore.getState().setStoryState({
          activeEventId: selectedOption.nextEventId || null
        })
      }
    }

    // 选项自带的风格标签 → 对应属性 +1
    const option = useGameStore.getState().currentOptions.find((o: any) => o.id === actionId)
    const world = useSessionStore.getState().world
    if (option?.style && world && world.enableMechanics) {
      const valid = world.attributes.some(a => a.id === option.style)
      if (valid) {
        const aspects = useGameStore.getState().aspects
        useGameStore.getState().setAspects({ [option.style]: (aspects[option.style] || 0) + 1 })
      }
    }

    setLastAction({ id: actionId, text: actionText })
    const actionType = actionId === 'custom_action' ? 'custom' : (actionId === 'init' ? 'init' : 'option')
    return processTurn(actionText, actionType)
  }

  const retryLastAction = async () => {
    if (!lastAction) return
    const currentStore = useGameStore.getState()
    if (currentStore.lastStateSnapshot) {
      currentStore.restoreSnapshot()
    }
    useUIStore.getState().setStatusMessage('重新生成中…')
    return handleAction(lastAction.id, lastAction.text)
  }

  return {
    handleAction,
    retryLastAction,
    isProcessing,
    isAnalyzingData,
    lastError,
    truncationWarning,
    clearTruncationWarning: () => setTruncationWarning(null),
    currentOptions: store.currentOptions,
    streamingContent,
    streamingReasoning,
    debugDataInput,
    debugDataOutput,
    isInputAllowed
  }
}
