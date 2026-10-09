import { describe, it, expect } from 'vitest'
import {
  MEMORY_BUDGET,
  TIMELINE_KEEP,
  appendTimelineBeat,
  emptyMemory,
  mergeMemory,
  normalizeMemory,
  renderMemoryForPrompt,
  type StoryMemory,
} from '@/utils/memory'

/**
 * 三层长期记忆的纯逻辑测试（A1）
 *
 * ## 为什么这一层值得单独钉死
 *
 * 它出错的**表现是"AI 忘了"**，而不是报错。玩家会说"它不记得我们见过"，
 * 而日志里一切正常 —— 这类 bug 没有断言根本无法回归。
 * 最容易错的三处：
 *
 *  1. **合并被写成替换**：模型漏写一层，就把攒了二十轮的关系清空了。
 *  2. **折叠丢内容**：时间线超长时把旧拍子直接丢掉，而没有折进 earlierSummary ——
 *     "更早发生过什么"于是凭空断掉，正是要修的那个问题。
 *  3. **渲染无上限**：三层全塞进提示词，token 成本失控（C9 那边刚加的成本可见
 *     会立刻显示出来，但那时已经花了钱）。
 */

const mk = (over: Partial<StoryMemory> = {}): StoryMemory => ({ ...emptyMemory(), ...over })

describe('mergeMemory · 增量合并不是替换', () => {
  it('★ 补丁没提到的层必须原样保留（模型漏写一层不能让它消失）', () => {
    const old = mk({
      bonds: [{ who: '裴无咎', state: '欠他一枚铜钱未还' }],
      threads: [{ id: 'missing_ledger', text: '账本缺了七页' }],
      timeline: [{ turn: 3, text: '在渡口见到了裴无咎' }],
      updatedAtTurn: 3,
    })

    // 这一轮只提到了新的线索，完全没提关系与时间线
    const next = mergeMemory(old, { threads: [{ id: 'seal', text: '那枚私印是谁刻的' }] })

    expect(next.bonds).toEqual(old.bonds)
    expect(next.timeline).toEqual(old.timeline)
    expect(next.threads.map(t => t.id).sort()).toEqual(['missing_ledger', 'seal'])
  })

  it('★ 同一个人只保留一条最新关系（欠人情 → 结仇，不能新旧并存）', () => {
    const old = mk({ bonds: [{ who: '裴无咎', state: '欠他人情' }] })
    const next = mergeMemory(old, { bonds: [{ who: '裴无咎', state: '已经结仇' }] })
    expect(next.bonds).toHaveLength(1)
    expect(next.bonds[0].state).toBe('已经结仇')
  })

  it('人名比对忽略空白与大小写（模型常多写一个空格）', () => {
    const next = mergeMemory(
      mk({ bonds: [{ who: '裴无咎', state: '同桌喝酒' }] }),
      { bonds: [{ who: ' 裴无咎 ', state: '翻脸' }] },
    )
    expect(next.bonds).toHaveLength(1)
    expect(next.bonds[0].state).toBe('翻脸')
  })

  it('没写"谁"的关系被丢弃（对模型没有指代价值）', () => {
    const next = mergeMemory(emptyMemory(), { bonds: [{ who: '', state: '一个神秘人' }] })
    expect(next.bonds).toHaveLength(0)
  })

  it('线索按 id 或正文去重，重复提交只更新措辞', () => {
    const old = mk({ threads: [{ id: 'ledger', text: '账本缺页' }] })
    const next = mergeMemory(old, { threads: [{ id: 'ledger', text: '账本缺了七页，且在最后一页被人撕过' }] })
    expect(next.threads).toHaveLength(1)
    expect(next.threads[0].text).toContain('撕过')
  })

  it('同一轮次的时间线是覆盖而不是追加（模型可能对同一拍给出更准的写法）', () => {
    const old = mk({ timeline: [{ turn: 4, text: '粗糙的记录' }] })
    const next = mergeMemory(old, { timeline: [{ turn: 4, text: '更准确的记录' }] })
    expect(next.timeline).toHaveLength(1)
    expect(next.timeline[0].text).toBe('更准确的记录')
  })

  it('乱序给出的时间线按轮次排序（"最近 N 拍"必须按轮次算）', () => {
    const next = mergeMemory(emptyMemory(), {
      timeline: [{ turn: 7, text: '七' }, { turn: 2, text: '二' }, { turn: 5, text: '五' }],
    })
    expect(next.timeline.map(b => b.turn)).toEqual([2, 5, 7])
  })
})

describe('时间线折叠 · 被折掉的拍子必须留下痕迹', () => {
  it(`★ 超过 ${TIMELINE_KEEP} 拍时折叠，且内容进入 earlierSummary`, () => {
    const beats = Array.from({ length: TIMELINE_KEEP + 3 }, (_, i) => ({
      turn: i + 1,
      text: `第${i + 1}轮的事`,
    }))
    const next = mergeMemory(emptyMemory(), { timeline: beats })

    expect(next.timeline).toHaveLength(TIMELINE_KEEP)
    // 保留的是**最近**的那些
    expect(next.timeline[0].turn).toBe(4)
    expect(next.timeline[next.timeline.length - 1].turn).toBe(TIMELINE_KEEP + 3)
    // 被折掉的三轮，一句话都不能丢
    expect(next.earlierSummary).toContain('第1轮的事')
    expect(next.earlierSummary).toContain('第3轮的事')
  })

  it('反复合并不产生重复的折叠记录（幂等）', () => {
    let mem = emptyMemory()
    for (let turn = 1; turn <= TIMELINE_KEEP + 4; turn++) {
      mem = mergeMemory(mem, { timeline: [{ turn, text: `第${turn}轮` }] })
    }
    const once = mem.earlierSummary
    const again = mergeMemory(mem, {})
    expect(again.earlierSummary).toBe(once)
  })

  it('模型给出的 earlierSummary 会被保留并拼接', () => {
    const next = mergeMemory(mk({ earlierSummary: '更早：他从北边来' }), { earlierSummary: '又及：他带了封信' })
    expect(next.earlierSummary).toContain('他从北边来')
    expect(next.earlierSummary).toContain('他带了封信')
  })
})

describe('normalizeMemory · 模型与旧存档的坏数据都要能接住', () => {
  it('字符串/数字/null 等非法结构一律不崩，退化成空记忆', () => {
    for (const bad of ['张三欠我钱', 42, null, undefined, [], { bonds: '不是数组' }]) {
      const m = normalizeMemory(bad)
      expect(Array.isArray(m.bonds)).toBe(true)
      expect(Array.isArray(m.threads)).toBe(true)
      expect(Array.isArray(m.timeline)).toBe(true)
    }
  })

  it('轮次写成"第3轮"这类非数字时按 0（未知轮次）处理，而不是 NaN', () => {
    const m = normalizeMemory({ timeline: [{ turn: '第3轮', text: '某事' }] })
    expect(m.timeline[0].turn).toBe(0)
    expect(Number.isNaN(m.timeline[0].turn)).toBe(false)
  })

  it('缺 text 的拍子被丢弃，缺 id 的线索用正文兜底', () => {
    const m = normalizeMemory({
      timeline: [{ turn: 1, text: '' }, { turn: 2, text: '有效' }],
      threads: [{ text: '没有 id 的线索' }],
    })
    expect(m.timeline).toHaveLength(1)
    expect(m.threads[0].id).toBe('没有 id 的线索')
  })

  it('★ 旧存档（完全没有记忆字段）读出来是合法的空记忆', () => {
    const m = normalizeMemory({ summary: '旧存档只有摘要' })
    expect(m).toMatchObject({ bonds: [], threads: [], timeline: [], earlierSummary: '' })
  })
})

describe('renderMemoryForPrompt · 注入文本', () => {
  it('空记忆返回空串（调用方据此完全不注入，避免只塞一个空标题）', () => {
    expect(renderMemoryForPrompt(emptyMemory())).toBe('')
    expect(renderMemoryForPrompt(undefined)).toBe('')
  })

  it('三层都有内容时，三个区块与轮次编号都在', () => {
    const text = renderMemoryForPrompt(mk({
      bonds: [{ who: '裴无咎', state: '欠他一枚铜钱未还' }],
      threads: [{ id: 'ledger', text: '账本缺了七页' }],
      timeline: [{ turn: 9, text: '在渡口见到了裴无咎' }],
      earlierSummary: '更早：他从北边来',
    }))
    expect(text).toContain('### 人物关系')
    expect(text).toContain('裴无咎')
    expect(text).toContain('### 未结线索')
    expect(text).toContain('账本缺了七页')
    expect(text).toContain('### 事件时间线')
    expect(text).toContain('第9轮')
    expect(text).toContain('更早的经过')
  })

  it(`★ 三层加起来不超过 ${MEMORY_BUDGET} 字（token 成本必须有硬上限）`, () => {
    const text = renderMemoryForPrompt(mk({
      // 故意给一堆很长的条目把预算撑爆
      bonds: Array.from({ length: 20 }, (_, i) => ({ who: `人物${i}`, state: '关系说明'.repeat(6) })),
      threads: Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, text: '线索内容'.repeat(6) })),
      timeline: Array.from({ length: 30 }, (_, i) => ({ turn: i + 1, text: '发生过的事情'.repeat(4) })),
      earlierSummary: '更早的经过'.repeat(10),
    }))
    expect(text.length).toBeLessThanOrEqual(MEMORY_BUDGET)
  })

  it('★ 超预算时优先砍时间线，关系与线索尽量留住（丢了最伤的是关系）', () => {
    const text = renderMemoryForPrompt(mk({
      bonds: [{ who: '裴无咎', state: '欠他一枚铜钱未还' }],
      threads: [{ id: 'ledger', text: '账本缺了七页' }],
      timeline: Array.from({ length: 40 }, (_, i) => ({ turn: i + 1, text: '发生过的事情'.repeat(4) })),
    }))
    expect(text).toContain('裴无咎')
    expect(text).toContain('账本缺了七页')
  })

  it('某一层的条目单独超长时会被裁剪，不会把整块撑爆', () => {
    const text = renderMemoryForPrompt(mk({
      bonds: [{ who: '裴无咎', state: '关系'.repeat(200) }],
    }))
    expect(text.length).toBeLessThan(200)
  })
})

describe('appendTimelineBeat · 每轮的机械记账（不依赖 LLM）', () => {
  it('追加一拍，并把轮次规整为正整数', () => {
    const m = appendTimelineBeat(emptyMemory(), 3, '在渡口见到了裴无咎')
    expect(m.timeline).toEqual([{ turn: 3, text: '在渡口见到了裴无咎' }])
  })

  it('空文本不产生拍子（不要往时间线里塞空行）', () => {
    expect(appendTimelineBeat(emptyMemory(), 3, '   ').timeline).toHaveLength(0)
  })

  it('同一轮重复记账是覆盖（重试同一轮不会出现两条）', () => {
    let m = appendTimelineBeat(emptyMemory(), 3, '第一次的结果')
    m = appendTimelineBeat(m, 3, '重试后的结果')
    expect(m.timeline).toHaveLength(1)
    expect(m.timeline[0].text).toBe('重试后的结果')
  })

  it('轮次非法（0 / 负数 / NaN）时退到第 1 轮，而不是写进一个取不回来的格子', () => {
    expect(appendTimelineBeat(emptyMemory(), 0, 'x').timeline[0].turn).toBe(1)
    expect(appendTimelineBeat(emptyMemory(), -5, 'x').timeline[0].turn).toBe(1)
    expect(appendTimelineBeat(emptyMemory(), NaN, 'x').timeline[0].turn).toBe(1)
  })

  it('updatedAtTurn 跟着最新轮次前进（下一次摘要据此知道进度）', () => {
    const m = appendTimelineBeat(emptyMemory(), 8, '第八轮')
    expect(m.updatedAtTurn).toBe(8)
  })
})
