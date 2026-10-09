import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { CharacterCard, PlayerCard, WorldCard } from '@/types/cards'

/**
 * 「真正发给模型的那一整段提示词」的端到端回归测试（C11）。
 *
 * ## 为什么需要它（这个项目里已经错了三次）
 *
 * `src/constants/prompts.test.ts` 测的是**组装函数**：给 `buildOpeningInstruction`
 * 正确的入参，它确实吐出正确的字符串。但线上出问题的地方从来不是那个函数，
 * 而是**引擎到底把什么传了进去**：
 *
 *  1. 「选角页挑了半天的背景，开场却一模一样」→ 引擎压根没把 `backgroundChoices`
 *     传给开场指令（函数本身是对的，没人给它数据）。
 *  2. 「处境素材被当成了硬剧本」→ 引擎把素材当作第一幕的唯一依据。
 *  3. 「自设主角是刑部正四品，开局却固定有俩仓部上司」→ 提示词里出现了
 *     替玩家认亲的措辞，而玩家是自己发现的。
 *
 * 三次都是**纯函数测试绿着、玩家读着出戏**。所以这一层要断言的不是函数返回值，
 * 而是 `llmChat` 实际收到的 `messages` —— 从引擎入口一路走到 API 边界。
 *
 * ## 这个测试怎么跑起来的（读之前先看这段，否则会觉得下面全是黑魔法）
 *
 * `useGameEngine` 是个 React hook，而本项目**没有** jsdom / @testing-library /
 * react-test-renderer（`vitest.config.ts` 里 environment 是 node），
 * 装不了 DOM 也不该为了一个测试去改依赖。于是这里把三件事替换掉：
 *
 *  · `@/api/llm` 的 `llmChat` —— 拦住请求并把 messages 抄下来（这才是被测对象）；
 *  · `@/stores/{game,session}` 的 **hook 形式** —— 换成直接读 `getState()`。
 *    引擎里这些 hook 只是"订阅重渲染"的糖，真正的读写早就走 `getState()`；
 *    在测试里不需要重渲染，所以换成普通函数即可，**store 本体与真实逻辑完全不变**；
 *  · `react` 的 `useState` —— 换成内存槽位，让 `useGameEngine()` 能被当普通函数调用。
 *
 * 也就是说：**引擎代码、store 逻辑、提示词组装一行都没改**，
 * 被换掉的只有"渲染"与"网络"这两层外壳。
 */

/** 捕获到的全部 LLM 调用（按发生顺序） */
const llm = vi.hoisted(() => ({ calls: [] as { stream: boolean; messages: { role: string; content: string }[] }[] }))

/** React hook 替身：内存槽位 + 每次调用引擎前复位 */
const hooks = vi.hoisted(() => ({ reset: () => {} }))

vi.mock('react', () => {
  const slots: unknown[] = []
  let cursor = 0
  hooks.reset = () => {
    cursor = 0
    slots.length = 0
  }
  const React = {
    useState: (init: unknown) => {
      const i = cursor++
      if (!(i in slots)) slots[i] = typeof init === 'function' ? (init as () => unknown)() : init
      return [slots[i], (next: unknown) => { slots[i] = typeof next === 'function' ? (next as (p: unknown) => unknown)(slots[i]) : next }]
    },
    useRef: (init: unknown) => {
      const i = cursor++
      if (!(i in slots)) slots[i] = { current: init }
      return slots[i]
    },
    useEffect: () => {},
    useLayoutEffect: () => {},
    useMemo: (fn: () => unknown) => fn(),
    useCallback: (fn: unknown) => fn,
    useDebugValue: () => {},
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
    createElement: () => null,
    Fragment: Symbol('Fragment'),
  }
  return { default: React, ...React, __esModule: true }
})

vi.mock('@/api/llm', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/llm')>()

  /** 假叙事：收得住尾（以句号结尾）且够长，免得触发"截断→自动续写"那条支线 */
  const NARRATIVE = '秋雨落在檐角，院里的水缸满了。你在廊下站了一会儿，听见里头有人翻卷宗。'.repeat(12)
  const DATA_JSON = JSON.stringify({
    stateChanges: [],
    options: [{ id: 'o1', text: '推门进去', style: 'neutral' }],
  })

  const sseResponse = (text: string): Response => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`))
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    return new Response(body)
  }

  return {
    ...mod,
    llmChat: async (opts: { stream?: boolean; messages: { role: string; content: string }[] }) => {
      llm.calls.push({ stream: !!opts.stream, messages: opts.messages })
      if (opts.stream) return sseResponse(NARRATIVE)
      return { choices: [{ message: { content: DATA_JSON } }] }
    },
  }
})

/**
 * 把 store 的 hook 形式换成"读快照"。
 *
 * ⚠️ 不是 mock 掉 store：`getState()` / `setState()` 以及全部 action 都来自真实模块，
 * 这里只把 `useStore(selector)` 这个"订阅"入口降级成一次性读取。
 */
function readSnapshot(mod: Record<string, unknown>, name: string) {
  const api = mod[name] as unknown as { getState: () => unknown } & Record<string, unknown>
  const hook = ((selector?: (s: unknown) => unknown) =>
    selector ? selector(api.getState()) : api.getState()) as unknown as Record<string, unknown>
  Object.assign(hook, api)
  return hook
}

vi.mock('@/stores/game', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>()
  return { ...mod, useGameStore: readSnapshot(mod, 'useGameStore') }
})

vi.mock('@/stores/session', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>()
  return { ...mod, useSessionStore: readSnapshot(mod, 'useSessionStore') }
})

const { useGameEngine } = await import('@/hooks/useGameEngine')
const { useGameStore } = await import('@/stores/game')
const { useSessionStore } = await import('@/stores/session')
const { useUIStore } = await import('@/stores/ui')

// ────────────────────────────── 测试夹具 ──────────────────────────────

/** 玩家亲手写的自设 —— 提示词里必须原样出现，且排在最高优先级 */
const PLAYER_BACKGROUND = '刑部正四品，掌一司刑名，惯穿青灰直裰'

/**
 * 角色卡要**填齐全部必填字段**：`formatCharacter` 直接读 `card.personality.trim()`，
 * 缺字段会在组提示词时抛 undefined.trim（真实卡片走 `data/worlds/_shared.ts` 的 `char()` 补全，
 * 夹具也得照办，否则测的是夹具的残缺而不是引擎）。
 */
const mkChar = (c: { id: string; name: string; description: string; relationship?: string }): CharacterCard => ({
  personality: '',
  scenario: '',
  firstMessage: '',
  messageExamples: '',
  creatorNotes: '',
  systemPrompt: '',
  postHistoryInstructions: '',
  alternateGreetings: [],
  tags: [],
  creator: '测试夹具',
  characterVersion: '1.0',
  present: true,
  ...c,
})

const mkWorld = (): WorldCard => ({
  id: 'w_st', title: '测试王朝', tagline: '一句话简介',
  worldLore: [
    '**舆图**',
    '「汴梁」是都城，城外有「漕渠」通着南边的粮仓。',
    '「提刑司」与「转运司」分掌刑名与钱粮，互不统属。',
    '「漕渠」沿岸的「雁门驿」是北上的第一站。',
  ].join('\n'),
  rules: '这是一条硬性约束：不得出现"系统"与"面板"这类游戏术语。',
  attributes: [{ id: 'force', name: '武略' }, { id: 'insight', name: '刑名' }],
  resources: [{ id: 'health', name: '体魄', initial: 5, max: 5 }],
  backgrounds: [
    {
      label: '开局处境',
      options: [
        { id: 'court', title: '在朝中当权', description: '要害位置上的人', startingItems: ['seal'] },
        { id: 'local', title: '在外任做官', description: '一方守土', startingItems: ['zhouyin'] },
        { id: 'jianghu', title: '在江湖上混', description: '没有官身', startingItems: ['saber'] },
      ],
    },
    {
      label: '官场立场',
      options: [
        { id: 'genghua', title: '更化派', description: '主张变法', startingItems: [] },
        { id: 'chizhong', title: '持重派', description: '主张守成', startingItems: [] },
      ],
    },
  ],
  attributePoints: 0,
  items: [
    { id: 'seal', name: '一枚印', description: '', tags: [] },
    { id: 'zhouyin', name: '州印', description: '', tags: [] },
    { id: 'saber', name: '一把刀', description: '', tags: [] },
  ],
  lores: [
    { id: 'l1', name: '提刑司', description: '掌一路刑名。' },
    { id: 'l2', name: '转运司', description: '掌一路钱粮。' },
  ],
  story: {
    atmosphere: '（基调）汴梁的秋天来得比漕渠开闸早。',
    mainQuest: '可选的方向：在朝中站住脚、查清一桩旧案、或是回地方做一方守土。',
    enableStages: false, stages: [], enableChoices: true, urgencyAfterTurns: 0,
    openerSlot: '开局处境',
    openingSeeds: {
      court: '朝中的日常是案牍、奏对与同僚之间的分寸；消息在廊下比在公文里走得快。',
      local: '外任要面对的是一方的钱粮、讼案与胥吏的默契；上头的考课悬在头顶。',
      jianghu: '没有官身的人靠规矩和拳头吃饭；同行之间讲义气也讲价钱。',
    },
  },
  narrative: { pov: 'second', tense: 'present', replyLength: 500, customStyle: '文风克制，多用短句。' },
  characters: [
    mkChar({ id: 'c1', name: '裴无咎', description: '男子，提刑司的旧吏。', relationship: '提刑司书吏' }),
    mkChar({ id: 'c2', name: '柳明远', description: '男子，转运司的判官。', relationship: '转运司判官' }),
    mkChar({ id: 'c3', name: '沈砚舟', description: '女子，漕渠上的船主。', relationship: '漕渠船主' }),
  ],
  enableMechanics: true,
  avatarStyle: 'ink', avatarTone: '#000',
  createdAt: 0, updatedAt: 0, builtin: false,
})

const mkPlayer = (over: Partial<PlayerCard> = {}): PlayerCard => ({
  name: '沈砚', gender: '男', age: '三十', appearance: '瘦削，眉骨高',
  personality: '寡言', background: PLAYER_BACKGROUND, extra: '',
  ...over,
})

const setup = (over: { world?: WorldCard; player?: PlayerCard; backgroundChoices?: Record<string, string> } = {}) => {
  const world = over.world ?? mkWorld()
  const player = over.player ?? mkPlayer()

  useGameStore.getState().resetGame()
  useGameStore.getState().initFromWorld(world)
  useGameStore.getState().setPlayerProfile(player.name, player.gender, player.appearance)

  useSessionStore.getState().setSession({
    world, player,
    activeCharacterIds: world.characters.map(c => c.id),
    backgroundChoices: over.backgroundChoices ?? { 开局处境: 'court', 官场立场: 'genghua' },
    attributeAllocation: {},
  })

  useUIStore.getState().setLlm({
    provider: 'custom',
    baseUrl: 'http://localhost:1/v1',
    apiKey: 'test-key',
    narrativeModel: 'test-model',
    analysisModel: 'test-model',
    temperature: 0.8,
    showReasoning: false,
  })
}

/** 跑一轮开局，返回真正发出去的两段提示词 */
const runOpening = async () => {
  llm.calls.length = 0
  hooks.reset()
  const engine = useGameEngine()
  await engine.handleAction('init', '（开局）')
  const narrativeCall = llm.calls.find(c => c.stream)
  const dataCall = llm.calls.find(c => !c.stream)
  return {
    calls: llm.calls,
    system: narrativeCall?.messages.find(m => m.role === 'system')?.content ?? '',
    user: narrativeCall?.messages.find(m => m.role === 'user')?.content ?? '',
    dataSystem: dataCall?.messages.find(m => m.role === 'system')?.content ?? '',
    all: (narrativeCall?.messages ?? []).map(m => m.content).join('\n\n'),
  }
}

beforeEach(() => {
  setup()
})

describe('开局这一轮：真正发给模型的提示词', () => {
  it('引擎确实把 messages 发给了 LLM（自检，防止断言全部作用在空串上）', async () => {
    const out = await runOpening()
    /*
      排查回归时的救命开关：`DUMP_PROMPT=1 npx vitest run src/hooks/useGameEngine.prompt.test.ts`
      会把这一轮真正发出去的 system / user 原样打出来。
      断言失败时最需要的就是"看到的到底是哪一句话"，而不是去猜组装函数。
    */
    if (process.env.DUMP_PROMPT) {
      console.log('=== SYSTEM ===\n' + out.system)
      console.log('=== USER ===\n' + out.user)
    }
    expect(out.calls.length).toBeGreaterThanOrEqual(2)
    expect(out.system).toContain('测试王朝')
    expect(out.user.length).toBeGreaterThan(200)
  })

  it('★ 玩家自设的 background 原文出现在提示词里（不是被背景槽位顶掉）', async () => {
    const out = await runOpening()
    expect(out.system).toContain(PLAYER_BACKGROUND)
    expect(out.user).toContain(PLAYER_BACKGROUND)
  })

  it('★ 主角自设被标为最高优先级，且排在处境素材之前', async () => {
    const out = await runOpening()
    expect(out.user).toContain('最高优先级')
    const selfAt = out.user.indexOf(PLAYER_BACKGROUND)
    const seedAt = out.user.indexOf('案牍')
    expect(selfAt).toBeGreaterThan(-1)
    expect(seedAt).toBeGreaterThan(-1)
    expect(selfAt).toBeLessThan(seedAt)
  })

  it('★ 处境素材被标成"素材"，而不是"第一幕就发生在这个场面"', async () => {
    const out = await runOpening()
    expect(out.user).toContain('案牍')
    expect(out.user).toContain('这是素材，不是剧本')
    expect(out.user).toContain('附加参考')
    expect(out.user).not.toContain('第一幕就发生在下面这个场面')
    expect(out.user).not.toContain('请以它为准')
  })

  it('★ 不含替玩家认亲的措辞', async () => {
    const out = await runOpening()
    for (const phrase of ['你的上司', '你的上峰', '你的同僚', '你的上官', '你的顶头上司']) {
      expect(out.all).not.toContain(phrase)
    }
  })

  it('★ 含"不要凭空给他安上司"这条禁令', async () => {
    const out = await runOpening()
    expect(out.user).toContain('不要凭空给他安上司、下属、同僚或亲戚')
    expect(out.user).toContain('也不要给他加一个他没写过的上司')
  })

  it('★ 含世界的专名清单（collectWorldProperNouns 的产物）', async () => {
    const out = await runOpening()
    expect(out.user).toContain('这个世界真实存在的名字')
    for (const noun of ['汴梁', '漕渠', '提刑司', '转运司', '裴无咎']) {
      expect(out.user).toContain(noun)
    }
  })

  it('世界观与硬性约束进的是 system（叙事 AI 读得到），不在 user 里另抄一份', async () => {
    const out = await runOpening()
    expect(out.system).toContain('提刑司')
    expect(out.system).toContain('不得出现"系统"与"面板"')
    // 数据引擎读的是另一段 system：它不该看到叙事文风要求
    expect(out.dataSystem).toContain('游戏数据引擎')
    expect(out.dataSystem).not.toContain('这是素材，不是剧本')
  })

  it('玩家没填自设背景时，提示词明确说明"可以更大程度充当依据"，而不是假装有自设', async () => {
    setup({ player: mkPlayer({ background: '' }) })
    const out = await runOpening()
    expect(out.user).toContain('主角没有自述背景')
    expect(out.user).not.toContain(PLAYER_BACKGROUND)
  })

  it('换一个自设背景 ⇒ 发出去的提示词真的不同（自设确实参与了组装）', async () => {
    const a = await runOpening()
    setup({ player: mkPlayer({ background: '工部营缮司主事，管着城里的营造' }) })
    const b = await runOpening()
    expect(a.user).not.toBe(b.user)
    expect(b.user).toContain('工部营缮司主事')
    expect(a.user).not.toContain('工部营缮司主事')
  })
})
