import { describe, it, expect } from 'vitest'
import {
  buildPack, validatePack, mergeInto, describeMerge,
  PACK_FORMAT, PACK_VERSION,
} from '@/utils/worldPack'
import type { WorldCard, CharacterCard } from '@/types/cards'

const world = (id: string, title: string, characterIds?: string[]): WorldCard => ({
  id, title, characters: [], characterIds,
} as unknown as WorldCard)

const char = (id: string, name: string): CharacterCard => ({ id, name } as unknown as CharacterCard)

describe('世界包 · 组装', () => {
  it('只带上被世界引用的角色，而不是整库', () => {
    const w = world('w1', '灰烬回响', ['c1', 'c2'])
    const all = [char('c1', 'A'), char('c2', 'B'), char('c3', '别人的卡')]
    const pack = buildPack({ worlds: [w], allCharacters: all })
    expect(pack.characters.map(c => c.id)).toEqual(['c1', 'c2'])
    expect(pack.meta.characterCount).toBe(2)
  })

  it('世界卡自带 characters 时也能筛出来', () => {
    const w = { id: 'w1', title: 'T', characters: [char('c9', 'X')] } as unknown as WorldCard
    const pack = buildPack({ worlds: [w], allCharacters: [char('c9', 'X'), char('c8', 'Y')] })
    expect(pack.characters.map(c => c.id)).toEqual(['c9'])
  })

  it('一个引用都没有时退回带上全部（宁可多带也别导出空包）', () => {
    const w = world('w1', 'T')
    const all = [char('c1', 'A'), char('c2', 'B')]
    const pack = buildPack({ worlds: [w], allCharacters: all })
    expect(pack.characters).toHaveLength(2)
  })

  it('meta 信息可用于在文件列表里辨认', () => {
    const pack = buildPack({
      worlds: [world('w1', '甲'), world('w2', '乙'), world('w3', '丙'), world('w4', '丁')],
      allCharacters: [],
    })
    expect(pack.meta.worldCount).toBe(4)
    expect(pack.meta.worldTitles).toEqual(['甲', '乙', '丙'])   // 最多 3 个
    expect(pack.format).toBe(PACK_FORMAT)
    expect(pack.version).toBe(PACK_VERSION)
  })

  it('不附存档时不写 save 字段（分享创作不该带上自己的进度）', () => {
    const pack = buildPack({ worlds: [world('w1', 'T')], allCharacters: [] })
    expect(pack.save).toBeUndefined()
    expect(pack.meta.hasSave).toBe(false)
  })
})

describe('世界包 · 校验', () => {
  it('非对象被拒', () => {
    expect(validatePack('nope').ok).toBe(false)
  })

  it('format 不对时提示改用对应入口', () => {
    const r = validatePack({ format: 'deng-xu-save', version: 1, data: {} })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('世界包')
    expect(r.error).toContain('对应的导入入口')
  })

  it('版本过高被拒', () => {
    const r = validatePack({ format: PACK_FORMAT, version: 99, worlds: [world('w', 'T')] })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('版本')
  })

  it('空包被拒', () => {
    const r = validatePack({ format: PACK_FORMAT, version: 1, worlds: [], characters: [] })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('既没有世界卡也没有角色卡')
  })

  it('世界卡缺 id/标题被拒', () => {
    const r = validatePack({ format: PACK_FORMAT, version: 1, worlds: [{ id: 'w' }] })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('损坏的世界卡')
  })

  it('角色卡缺 id/名字被拒', () => {
    const r = validatePack({ format: PACK_FORMAT, version: 1, worlds: [], characters: [{ id: 'c' }] })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('损坏的角色卡')
  })

  it('合法包通过并原样返回内容', () => {
    const w = world('w1', 'T', ['c1'])
    const c = char('c1', 'A')
    const r = validatePack({ format: PACK_FORMAT, version: 1, worlds: [w], characters: [c] })
    expect(r.ok).toBe(true)
    expect(r.worlds).toHaveLength(1)
    expect(r.characters).toHaveLength(1)
  })
})

describe('世界包 · 合并冲突策略', () => {
  const local = {
    worlds: [world('w1', '本地世界')],
    characters: [char('c1', '本地角色')],
  }
  const incoming = {
    worlds: [world('w1', '同 id 世界'), world('w2', '新世界')],
    characters: [char('c1', '同 id 角色'), char('c2', '新角色')],
  }

  it('skip（默认）：同 id 跳过，新的加入', () => {
    const { worlds, characters, result } = mergeInto(local, incoming, 'skip')
    expect(worlds).toHaveLength(2)
    expect(worlds.find(w => w.id === 'w1')!.title).toBe('本地世界')  // 未被覆盖
    expect(characters.find(c => c.id === 'c1')!.name).toBe('本地角色')
    expect(result.worldsAdded).toBe(1)
    expect(result.worldsSkipped).toBe(1)
    expect(result.charsSkipped).toBe(1)
  })

  it('overwrite：同 id 被包里的覆盖', () => {
    const { worlds, characters, result } = mergeInto(local, incoming, 'overwrite')
    expect(worlds.find(w => w.id === 'w1')!.title).toBe('同 id 世界')
    expect(characters.find(c => c.id === 'c1')!.name).toBe('同 id 角色')
    expect(result.worldsUpdated).toBe(1)
    expect(result.charsUpdated).toBe(1)
  })

  it('duplicate：都留下，副本改 id 与名字（不能出现同 id）', () => {
    const { worlds, result } = mergeInto(local, incoming, 'duplicate')
    expect(worlds).toHaveLength(3)
    const ids = worlds.map(w => w.id)
    expect(new Set(ids).size).toBe(ids.length)          // id 必须唯一
    expect(worlds.some(w => w.title.includes('（副本）'))).toBe(true)
    expect(result.worldsAdded).toBe(2)
  })

  it('摘要文案可读', () => {
    const { result } = mergeInto(local, incoming, 'skip')
    const s = describeMerge(result)
    expect(s).toMatch(/新增世界 1/)
    expect(s).toMatch(/跳过世界 1/)
  })

  it('没有变化时给出明确说法（而不是空串）', () => {
    const { result } = mergeInto(local, { worlds: [], characters: [] })
    expect(describeMerge(result)).toBe('没有任何变化')
  })

  it('不修改传入的数组（zustand 需要新引用才会触发更新）', () => {
    const before = local.worlds.length
    mergeInto(local, incoming, 'skip')
    expect(local.worlds).toHaveLength(before)
  })
})
