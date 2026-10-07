import { describe, it, expect } from 'vitest'
import { buildOpeningInstruction, describeBackgroundChoices } from '@/constants/prompts'
import type { CharacterCard, PlayerCard, WorldCard } from '@/types/cards'

/**
 * 开场指令的回归测试。
 *
 * ## 为什么值得单独测
 *
 * 玩家反馈过："选角页挑了半天的背景，开场却一模一样，很影响代入感。"
 * 根因是 `buildOpeningInstruction` **压根没有收到背景选择** ——
 * 它只拿到（世界、主角、在场角色），于是不管选哪个出身，
 * 送进提示词的都是同一段 `story.opening`。
 *
 * 这类缺陷**不会报错、不会崩**，只表现为"玩了才发现没区别"，
 * 所以必须用断言钉住：**不同背景必须产出不同的开场指令**。
 */

const mkWorld = (over: Partial<WorldCard> = {}): WorldCard => ({
  id: 'w1', title: '测试世界', tagline: '',
  worldLore: '', rules: '',
  attributes: [], resources: [],
  backgrounds: [
    {
      label: '出身',
      options: [
        { id: 'poor', title: '穷苦出身', description: '在码头长大', startingItems: ['rope'] },
        { id: 'noble', title: '世家子弟', description: '自小读书', startingItems: ['seal'] },
      ],
    },
    {
      label: '牵挂',
      options: [
        { id: 'sister', title: '有个妹妹', description: '她还在等你', startingItems: [] },
        { id: 'none', title: '无牵无挂', description: '走得快', startingItems: [] },
      ],
    },
  ],
  attributePoints: 0,
  items: [
    { id: 'rope', name: '一捆麻绳', description: '', tags: [] },
    { id: 'seal', name: '家传印章', description: '', tags: [] },
  ],
  lores: [],
  story: {
    opening: '黄昏，铁桥桥头的客栈。桥下有兵在收过桥粮。',
    mainQuest: '',
    enableStages: false, stages: [], enableChoices: true, urgencyAfterTurns: 0,
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

describe('开场指令 · 背景必须真的影响第一幕', () => {
  it('没有背景选择时，仍然给出场景骨架（不崩、不空）', () => {
    const out = buildOpeningInstruction(mkWorld(), player, noChars, {})
    expect(out).toContain('铁桥桥头')
    // 没有背景时不该出现"背景如下"那一段
    expect(out).not.toContain('主角开局选定的背景如下')
  })

  it('★ 不同背景产出**不同**的开场指令（这就是本次修复的核心）', () => {
    const w = mkWorld()
    const a = buildOpeningInstruction(w, player, noChars, { 出身: 'poor', 牵挂: 'none' })
    const b = buildOpeningInstruction(w, player, noChars, { 出身: 'noble', 牵挂: 'sister' })
    expect(a).not.toBe(b)
    expect(a).toContain('穷苦出身')
    expect(b).toContain('世家子弟')
    expect(a).not.toContain('世家子弟')
    expect(b).not.toContain('穷苦出身')
  })

  it('只换一个槽位也要有差异（不必所有槽位都不同）', () => {
    const w = mkWorld()
    const a = buildOpeningInstruction(w, player, noChars, { 出身: 'poor', 牵挂: 'sister' })
    const b = buildOpeningInstruction(w, player, noChars, { 出身: 'noble', 牵挂: 'sister' })
    expect(a).not.toBe(b)
  })

  it('把开局携带物写进指令 —— 让"手上有东西"成为开场抓手', () => {
    const out = buildOpeningInstruction(mkWorld(), player, noChars, { 出身: 'poor' })
    expect(out).toContain('一捆麻绳')
    expect(out).toContain('开局随身')
  })

  it('明确要求背景落到可见细节上，并禁止"只提一句"', () => {
    const out = buildOpeningInstruction(mkWorld(), player, noChars, { 出身: 'poor' })
    expect(out).toContain('他为什么此刻在这个场景里')
    expect(out).toContain('不要')
    expect(out).toContain('同一段话换了几个词')
  })

  it('场景骨架仍然是世界卡里的那一段（舞台不跑偏）', () => {
    const out = buildOpeningInstruction(mkWorld(), player, noChars, { 出身: 'noble' })
    expect(out).toContain('桥下有兵在收过桥粮')
  })

  it('世界卡为某个选项写了开场指引时，优先带上它', () => {
    const w = mkWorld()
    w.story.openingByBackground = {
      出身: { poor: '你是被人从码头叫醒的，麻绳还缠在手腕上。' },
    }
    const out = buildOpeningInstruction(w, player, noChars, { 出身: 'poor' })
    expect(out).toContain('麻绳还缠在手腕上')
    // 没写指引的那个选项不应凭空带上别人的
    const out2 = buildOpeningInstruction(w, player, noChars, { 出身: 'noble' })
    expect(out2).not.toContain('麻绳还缠在手腕上')
  })

  it('开场指引按选项标题写也认（兼容两种写法）', () => {
    const w = mkWorld()
    w.story.openingByBackground = { 出身: { 世家子弟: '你穿着不该出现在这里的好衣裳。' } }
    const out = buildOpeningInstruction(w, player, noChars, { 出身: 'noble' })
    expect(out).toContain('不该出现在这里的好衣裳')
  })

  it('背景槽位里没有的选项 id 不会造成异常', () => {
    const out = buildOpeningInstruction(mkWorld(), player, noChars, { 出身: '不存在', 牵挂: 'none' })
    expect(typeof out).toBe('string')
    expect(out).toContain('铁桥桥头')
  })

  it('世界卡没有 backgrounds 时也不崩', () => {
    const out = buildOpeningInstruction(mkWorld({ backgrounds: [] }), player, noChars, { 出身: 'poor' })
    expect(typeof out).toBe('string')
  })

  it('describeBackgroundChoices 会解析出分类/选项/说明/携带物', () => {
    const picked = describeBackgroundChoices(mkWorld(), { 出身: 'poor', 牵挂: 'sister' })
    expect(picked).toHaveLength(2)
    expect(picked[0]).toMatchObject({ label: '出身', id: 'poor', title: '穷苦出身' })
    expect(picked[0].items).toEqual(['一捆麻绳'])
    // 没选中的槽位不该出现
    const onlyOne = describeBackgroundChoices(mkWorld(), { 出身: 'noble' })
    expect(onlyOne).toHaveLength(1)
  })
})
