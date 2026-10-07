import { describe, it, expect } from 'vitest'
import { buildOpeningInstruction, describeBackgroundChoices, resolveOpeningScene } from '@/constants/prompts'
import type { CharacterCard, PlayerCard, WorldCard } from '@/types/cards'

/**
 * 开场指令的回归测试。
 *
 * ## 这段逻辑被玩家打回过**两次**，两次的错法都值得记住
 *
 * 第一次："选角页挑了半天的背景，开场却一模一样。"
 *   → 根因：`buildOpeningInstruction` 压根没收到背景选择。
 *
 * 第二次（本次）："我要的是**同一个世界观里，各不相同的开场为各不相同的背景服务**，
 *   而不是一样的开场因不一样的背景而略有改变。这么多三六九等的人
 *   却在干同一个枯燥的工作，完全背离了沙盒。"
 *   → 根因：我只做了"同一场景 + 按背景换视角"（旧 `openingByBackground`），
 *     于是官、军、商、江湖、罪犯全挤在同一间值房里。
 *
 * 所以下面最要紧的两条是：
 *   · **不同开场处境 ⇒ 不同场景**（不是同一场景换词）
 *   · **其余背景只加质感，不得把场景挪走**
 */

const mkWorld = (over: Partial<WorldCard> = {}): WorldCard => ({
  id: 'w1', title: '测试世界', tagline: '',
  worldLore: '', rules: '',
  attributes: [], resources: [],
  backgrounds: [
    {
      label: '开局处境',
      options: [
        { id: 'office', title: '在值房核账', description: '你是个小吏', startingItems: ['ledger'] },
        { id: 'frontier', title: '在边镇守烽', description: '你是个队正', startingItems: ['saber'] },
        { id: 'shop', title: '在城南开店', description: '你是个商人', startingItems: ['abacus'] },
      ],
    },
    {
      label: '出身',
      options: [
        { id: 'hanmen', title: '寒门', description: '家里没钱', startingItems: [] },
        { id: 'xungui', title: '勋贵', description: '家里有功', startingItems: ['seal'] },
      ],
    },
  ],
  attributePoints: 0,
  items: [
    { id: 'ledger', name: '一本点验簿', description: '', tags: [] },
    { id: 'saber', name: '一把横刀', description: '', tags: [] },
    { id: 'abacus', name: '一副算盘', description: '', tags: [] },
    { id: 'seal', name: '家传印', description: '', tags: [] },
  ],
  lores: [],
  story: {
    opening: '（兜底）度支司的值房，申时三刻。',
    mainQuest: '',
    enableStages: false, stages: [], enableChoices: true, urgencyAfterTurns: 0,
    openerSlot: '开局处境',
    sceneByOption: {
      开局处境: {
        office: '汴梁度支司值房，你面前摊着含嘉仓的点验簿，裴无咎站在门口问你看完了没有。',
        frontier: '云中镇外第三烽，风把火盆里的炭吹得发红，你手下的十个人等着你决定今夜点不点火。',
        shop: '城南州桥边你的铺子刚卸下一船货，牙人堵在门口要你签一张三个月后付的契。',
      },
    },
  },
  narrative: { pov: 'second', tense: 'present', replyLength: 500, customStyle: '' },
  characters: [], enableMechanics: true,
  avatarStyle: 'ink', avatarTone: '#000',
  createdAt: 0, updatedAt: 0, builtin: true,
  ...over,
})

const player: PlayerCard = {
  name: '沈砚', gender: '男', age: '三十', appearance: '', personality: '', background: '', extra: '',
}
const noChars: CharacterCard[] = []

describe('开场指令 · 不同处境必须是不同场面（沙盒，不是同一工位）', () => {
  it('★ 三个开局处境产出三段互不相同的场景（核心断言）', () => {
    const w = mkWorld()
    const a = buildOpeningInstruction(w, player, noChars, { 开局处境: 'office' })
    const b = buildOpeningInstruction(w, player, noChars, { 开局处境: 'frontier' })
    const c = buildOpeningInstruction(w, player, noChars, { 开局处境: 'shop' })
    expect(a).not.toBe(b)
    expect(b).not.toBe(c)
    expect(a).not.toBe(c)
    // 各自带出各自的场面 —— 三段互不包含，是三个地方
    expect(a).toContain('度支司值房')
    expect(a).not.toContain('云中镇外第三烽')
    expect(b).toContain('云中镇外第三烽')
    expect(b).not.toContain('州桥边')
    expect(c).toContain('州桥边')
    expect(c).not.toContain('度支司值房')
  })

  it('★ 非开场槽位的随身物会被带进指令（给场面加质感）', () => {
    // 开场槽位自己的物品写在场景正文里；这里验的是**别的槽位**的物品
    const a = buildOpeningInstruction(mkWorld(), player, noChars, { 开局处境: 'office', 出身: 'xungui' })
    expect(a).toContain('家传印')
    expect(a).toContain('开局随身')
  })

  it('★ 有专属场景时**不再拼接兜底 opening**（否则两幕揉成一幕）', () => {
    const out = buildOpeningInstruction(mkWorld(), player, noChars, { 开局处境: 'frontier' })
    expect(out).toContain('云中镇外第三烽')
    expect(out).not.toContain('（兜底）度支司的值房')
  })

  it('★ 其余背景只加质感，不得把场景挪走', () => {
    const w = mkWorld()
    const poor = buildOpeningInstruction(w, player, noChars, { 开局处境: 'frontier', 出身: 'hanmen' })
    const noble = buildOpeningInstruction(w, player, noChars, { 开局处境: 'frontier', 出身: 'xungui' })
    // 场面仍然只有边镇那一个
    expect(poor).toContain('云中镇外第三烽')
    expect(noble).toContain('云中镇外第三烽')
    // 但两者的"质感"不同（出身被带进去了）
    expect(poor).toContain('寒门')
    expect(noble).toContain('勋贵')
    // 并且明确禁止"因为别的背景把场景挪走"
    expect(noble).toContain('场景已经由上面的开场处境定死了')
  })

  it('该处境没写场景时，退回兜底 opening 而不是崩掉', () => {
    const w = mkWorld()
    w.story.sceneByOption = { 开局处境: {} }
    const out = buildOpeningInstruction(w, player, noChars, { 开局处境: 'office' })
    expect(out).toContain('（兜底）度支司的值房')
  })

  it('世界卡没配 openerSlot 时，用兜底 opening', () => {
    const w = mkWorld()
    delete (w.story as { openerSlot?: string }).openerSlot
    const out = buildOpeningInstruction(w, player, noChars, { 开局处境: 'office' })
    expect(out).toContain('（兜底）度支司的值房')
  })

  it('既没场景也没兜底 opening 时给出自拟指令，不崩', () => {
    const base = mkWorld()
    const w = mkWorld({ story: { ...base.story, opening: '', sceneByOption: {} } })
    const out = buildOpeningInstruction(w, player, noChars, {})
    expect(out).toContain('自行设计')
  })

  it('选了一个不存在的处境 id 不会造成异常', () => {
    const out = buildOpeningInstruction(mkWorld(), player, noChars, { 开局处境: '不存在' })
    expect(typeof out).toBe('string')
    expect(out).toContain('（兜底）')
  })

  it('resolveOpeningScene 能解析出槽位/选项/场景', () => {
    const r = resolveOpeningScene(mkWorld(), { 开局处境: 'shop' })
    expect(r).toMatchObject({ slot: '开局处境', id: 'shop', title: '在城南开店' })
    expect(r?.scene).toContain('州桥边')
    expect(resolveOpeningScene(mkWorld(), {})).toBeNull()
  })

  it('describeBackgroundChoices 解析出分类/选项/说明/携带物', () => {
    const picked = describeBackgroundChoices(mkWorld(), { 开局处境: 'frontier', 出身: 'hanmen' })
    expect(picked).toHaveLength(2)
    expect(picked[0]).toMatchObject({ label: '开局处境', id: 'frontier', title: '在边镇守烽' })
    expect(picked[0].items).toEqual(['一把横刀'])
  })
})
