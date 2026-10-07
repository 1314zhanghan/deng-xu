import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { PlayerCard } from '@/types/cards'

/**
 * 主角预设（「提前设定主角」）的存储层测试。
 *
 * ## 为什么值得单独测
 *
 * 这一层出错的表现是**静默的**：
 *  · 预设没落盘 → 玩家下次打开发现"我设的主角不见了"，而界面上一切正常；
 *  · 写入没深拷贝 → 在界面上改一处草稿，库里的存档跟着变；
 *  · 预设与世界卡共用键 → 玩家清空卡片库时把精心设的主角一起清掉。
 * 三种都不会抛异常，只有用户能发现。所以这里把它们钉成断言。
 */

/**
 * 内存版 kv。
 *
 * ⚠️ 断言里要**直接看键名**，所以这里保留原始 Map ——
 * "预设存在 `heroPresets` 键、不碰 `worlds` 键"是这一层的核心契约之一。
 */
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

const { useLibraryStore } = await import('@/stores/library')

const S = () => useLibraryStore.getState()

const basePlayer = (over: Partial<PlayerCard> = {}): PlayerCard => ({
  name: '沈砚',
  gender: '男',
  age: '三十岁',
  appearance: '瘦高，左眉有疤',
  personality: '寡言',
  background: '边军出身',
  extra: '',
  ...over,
})

describe('主角预设 · 存储与增删改查', () => {
  beforeEach(() => {
    mem.clear()
    useLibraryStore.setState({ heroPresets: [], worlds: [], loaded: false, loadError: null })
  })

  it('初始没有预设', () => {
    expect(S().heroPresets).toEqual([])
  })

  it('新建后能在列表里查到，且内嵌档案完整', async () => {
    const created = await S().createHeroPreset('测试主角', basePlayer())
    expect(created.id).toBeTruthy()
    expect(S().heroPresets).toHaveLength(1)
    expect(S().getHeroPreset(created.id)?.player.name).toBe('沈砚')
  })

  it('落盘到 heroPresets 键，且**不碰** worlds 键', async () => {
    await S().createHeroPreset('测试主角', basePlayer())
    expect(typeof mem.get('heroPresets')).toBe('string')
    expect(String(mem.get('heroPresets'))).toContain('沈砚')
    // 这条是"清空卡片库不该弄丢主角"的防线
    expect(mem.has('worlds')).toBe(false)
  })

  it('写入时深拷贝：之后改传入对象不影响库里', async () => {
    const input = basePlayer({ name: '陆青' })
    const created = await S().createHeroPreset('深拷贝测试', input)
    input.name = '被外部改坏了'
    expect(S().getHeroPreset(created.id)?.player.name).toBe('陆青')
  })

  it('saveHeroPreset 也深拷贝（更新路径同样）', async () => {
    const created = await S().createHeroPreset('深拷贝测试', basePlayer({ name: '陆青' }))
    const patched = basePlayer({ name: '陆青' })
    await S().saveHeroPreset({ ...created, player: patched })
    patched.name = '又被改坏了'
    expect(S().getHeroPreset(created.id)?.player.name).toBe('陆青')
  })

  it('同名保存走更新而不是新增', async () => {
    const created = await S().createHeroPreset('测试主角', basePlayer())
    await S().saveHeroPreset({ ...created, label: '改名了' })
    expect(S().heroPresets).toHaveLength(1)
    expect(S().heroPresets[0].label).toBe('改名了')
  })

  it('更新内嵌档案', async () => {
    const created = await S().createHeroPreset('测试主角', basePlayer())
    await S().updateHeroPresetPlayer(created.id, basePlayer({ name: '沈砚之' }))
    expect(S().getHeroPreset(created.id)?.player.name).toBe('沈砚之')
  })

  it('复制生成新 id 且名字带「副本」', async () => {
    const created = await S().createHeroPreset('测试主角', basePlayer())
    const dup = await S().duplicateHeroPreset(created.id)
    expect(dup).not.toBeNull()
    expect(dup!.id).not.toBe(created.id)
    expect(dup!.label).toContain('副本')
    expect(S().heroPresets).toHaveLength(2)
  })

  it('删除生效并落盘', async () => {
    const created = await S().createHeroPreset('测试主角', basePlayer())
    const dup = await S().duplicateHeroPreset(created.id)
    await S().deleteHeroPreset(dup!.id)
    expect(S().heroPresets).toHaveLength(1)
    expect(S().getHeroPreset(dup!.id)).toBeUndefined()
    expect(JSON.parse(String(mem.get('heroPresets')))).toHaveLength(1)
  })

  it('查不到时返回 undefined，不抛异常', () => {
    expect(S().getHeroPreset('nope')).toBeUndefined()
  })

  it('标签与名字都为空时兜底为「未命名主角」', async () => {
    const p = await S().createHeroPreset('   ', basePlayer({ name: '' }))
    expect(p.label).toBe('未命名主角')
  })

  it('保存时刷新 updatedAt，但保留 createdAt', async () => {
    const created = await S().createHeroPreset('测试主角', basePlayer())
    const created2 = await S().createHeroPreset('第二个', basePlayer({ name: '乙' }))
    expect(created2.createdAt).toBeGreaterThanOrEqual(created.createdAt)
    const before = S().getHeroPreset(created.id)!
    await S().saveHeroPreset({ ...before, label: '改名' })
    const after = S().getHeroPreset(created.id)!
    expect(after.createdAt).toBe(before.createdAt)
    expect(after.updatedAt).toBeGreaterThanOrEqual(before.updatedAt)
  })

  it('新预设排在最前（列表按最近保存排序）', async () => {
    await S().createHeroPreset('先建的', basePlayer({ name: '甲' }))
    await S().createHeroPreset('后建的', basePlayer({ name: '乙' }))
    expect(S().heroPresets[0].label).toBe('后建的')
  })
})
