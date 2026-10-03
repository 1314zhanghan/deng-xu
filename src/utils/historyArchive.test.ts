import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * 历史归档测试。
 *
 * 这是「存档静默丢失」的防线，值得单独测：
 * localStorage 配额耗尽时 zustand 的 persist 不会把错误冒到界面上，
 * 所以必须在写到满之前**主动**把旧叙事挪走。
 */

// 用一个内存 Map 假装 IndexedDB（node 环境没有 indexedDB）
const mem = new Map<string, unknown>()
vi.mock('@/utils/idb', () => ({
  createKVStore: () => ({
    get: async (k: string) => mem.get(k),
    set: async (k: string, v: unknown) => { mem.set(k, v) },
    del: async (k: string) => { mem.delete(k) },
    keys: async () => [...mem.keys()],
    clear: async () => { mem.clear() },
  }),
  idbAvailable: true,
  isIdbAvailable: () => true,
}))

const {
  HOT_HISTORY_LIMIT,
  needsArchive,
  archiveOldMessages,
  loadArchive,
  estimateHistoryBytes,
  isHistoryPressureHigh,
} = await import('@/utils/historyArchive')

function mkHistory(n: number, contentLen = 10) {
  return Array.from({ length: n }, (_, i) => ({
    role: (i % 2 === 0 ? 'assistant' : 'user') as 'assistant' | 'user',
    content: `第${i}轮-` + 'x'.repeat(contentLen),
    timestamp: i,
  }))
}

beforeEach(() => { mem.clear() })

describe('历史归档', () => {
  it('条数不足时不归档', async () => {
    const h = mkHistory(HOT_HISTORY_LIMIT)
    expect(needsArchive(h)).toBe(false)
    const r = await archiveOldMessages(h)
    expect(r.archived).toBe(0)
    expect(r.hot).toBe(h)          // 原数组直接返回，不做无谓拷贝
  })

  it('超过两倍阈值时归档，热数据被压到上限', async () => {
    const h = mkHistory(HOT_HISTORY_LIMIT * 3)
    expect(needsArchive(h)).toBe(true)
    const r = await archiveOldMessages(h)
    expect(r.ok).toBe(true)
    expect(r.archived).toBe(HOT_HISTORY_LIMIT * 2)
    expect(r.hot).toHaveLength(HOT_HISTORY_LIMIT)
  })

  it('归档内容 = 被裁掉的那一段，顺序不变（不能丢历史）', async () => {
    const h = mkHistory(HOT_HISTORY_LIMIT * 2)
    const r = await archiveOldMessages(h)
    const a = await loadArchive()
    expect(a.messages).toHaveLength(HOT_HISTORY_LIMIT)
    // 归档的应是**最早**的那些
    expect(a.messages[0].content).toBe(h[0].content)
    expect(a.messages.at(-1)!.content).toBe(h[HOT_HISTORY_LIMIT - 1].content)
    // 热数据接在后面
    expect(r.hot[0].content).toBe(h[HOT_HISTORY_LIMIT].content)
    // 拼起来必须等于原始序列
    expect([...a.messages, ...r.hot].map(m => m.content)).toEqual(h.map(m => m.content))
  })

  it('多次归档会累加，而不是互相覆盖', async () => {
    await archiveOldMessages(mkHistory(HOT_HISTORY_LIMIT * 2))
    await archiveOldMessages(mkHistory(HOT_HISTORY_LIMIT * 3))
    const a = await loadArchive()
    expect(a.messages).toHaveLength(HOT_HISTORY_LIMIT + HOT_HISTORY_LIMIT * 2)
  })

  it('体积压力检测：正常对话不该触发', () => {
    expect(isHistoryPressureHigh(mkHistory(100, 500))).toBe(false)
  })

  it('体积压力检测：超长历史应触发（提前抢救，不等配额写满）', () => {
    // 2.5MB 阈值 ≈ 约 130 万字符
    const huge = mkHistory(3000, 1000)
    expect(estimateHistoryBytes(huge)).toBeGreaterThan(2.5 * 1024 * 1024)
    expect(isHistoryPressureHigh(huge)).toBe(true)
  })
})

describe('体积吃紧时的裁剪力度', () => {
  it('平时按条数阈值触发', () => {
    expect(needsArchive(mkHistory(HOT_HISTORY_LIMIT))).toBe(false)
    expect(needsArchive(mkHistory(HOT_HISTORY_LIMIT * 2))).toBe(false)
    expect(needsArchive(mkHistory(HOT_HISTORY_LIMIT * 2 + 1))).toBe(true)
  })

  it('force=true 时门槛降到一半（体积吃紧就不再等条数）', () => {
    expect(needsArchive(mkHistory(HOT_HISTORY_LIMIT / 2), true)).toBe(false)
    expect(needsArchive(mkHistory(HOT_HISTORY_LIMIT / 2 + 1), true)).toBe(true)
  })

  it('pressure 时把热数据压到一半 —— 否则按体积触发却只裁几条，下一轮马上又触发', async () => {
    const h = mkHistory(HOT_HISTORY_LIMIT * 3)
    const normal = await archiveOldMessages(h, false)
    expect(normal.hot).toHaveLength(HOT_HISTORY_LIMIT)

    mem.clear()
    const urgent = await archiveOldMessages(h, true)
    expect(urgent.hot.length).toBeLessThan(normal.hot.length)
    expect(urgent.hot).toHaveLength(Math.floor(HOT_HISTORY_LIMIT / 2))
    // 而且不能丢内容
    expect(urgent.hot.length + urgent.archived).toBe(h.length)
  })

  it('pressure 但条数很少时不动（没东西可裁）', async () => {
    const h = mkHistory(10, 1000)
    const r = await archiveOldMessages(h, true)
    expect(r.archived).toBe(0)
    expect(r.hot).toBe(h)
  })
})

describe('归档失败时的安全性（最重要的一条）', () => {
  it('IndexedDB 写失败 → 不裁剪，历史原样保留', async () => {
    // 让 set 抛错
    const bad = new Map<string, unknown>()
    vi.resetModules()
    vi.doMock('@/utils/idb', () => ({
      createKVStore: () => ({
        get: async (k: string) => bad.get(k),
        set: async () => { throw new Error('quota exceeded') },
        del: async () => {}, keys: async () => [], clear: async () => {},
      }),
      idbAvailable: true, isIdbAvailable: () => true,
    }))
    const mod = await import('@/utils/historyArchive')
    const h = mkHistory(mod.HOT_HISTORY_LIMIT * 3)
    const r = await mod.archiveOldMessages(h)
    expect(r.ok).toBe(false)
    expect(r.archived).toBe(0)
    // 关键：不能因为归档写失败就把玩家的历史丢掉
    expect(r.hot).toHaveLength(h.length)
    expect(r.hot).toBe(h)
  })
})
