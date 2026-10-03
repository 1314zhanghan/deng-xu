import { describe, it, expect } from 'vitest'
import { buildWorldbook, parseWorldbook, worldbookToPack, WORLDBOOK_FORMAT } from '@/utils/worldbook'
import type { WorldCard } from '@/types/cards'

const world = (id: string, title: string, mechanics = true, chars = 0): WorldCard => ({
  id, title, enableMechanics: mechanics,
  characters: Array.from({ length: chars }, (_, i) => ({ id: `${id}-c${i}`, name: `角色${i}` })),
} as unknown as WorldCard)

describe('世界书 · 组装', () => {
  it('自动分章按「机制向 / 纯叙事向」划分', () => {
    const book = buildWorldbook({
      title: '官方示例集',
      worlds: [world('a', '甲', true), world('b', '乙', true), world('c', '丙', false)],
      autoChapters: true,
    })
    expect(book.chapters).toHaveLength(2)
    expect(book.chapters![0].title).toBe('机制向')
    expect(book.chapters![0].worldIds).toEqual(['a', 'b'])
    expect(book.chapters![1].title).toBe('纯叙事向')
    expect(book.chapters![1].worldIds).toEqual(['c'])
  })

  it('只有一个世界时不生成章节（分章没意义）', () => {
    const book = buildWorldbook({ title: '单本', worlds: [world('a', '甲')], autoChapters: true })
    expect(book.chapters).toBeUndefined()
  })

  it('只有一种机制形态时只生成一章', () => {
    const book = buildWorldbook({
      title: 'T', worlds: [world('a', '甲', true), world('b', '乙', true)], autoChapters: true,
    })
    expect(book.chapters).toHaveLength(1)
    expect(book.chapters![0].title).toBe('机制向')
  })

  it('format 与 version 被正确写入', () => {
    const book = buildWorldbook({ title: 'T', worlds: [world('a', '甲')] })
    expect(book.format).toBe(WORLDBOOK_FORMAT)
    expect(book.version).toBe(1)
  })
})

describe('世界书 · 校验', () => {
  it('非对象被拒', () => {
    expect(parseWorldbook('nope').ok).toBe(false)
  })

  it('导入世界包时提示去正确的入口（而不是笼统报错）', () => {
    const r = parseWorldbook({ format: 'deng-xu-worldpack', version: 1, worlds: [] })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('世界包')
    expect(r.error).toContain('导入世界包')
  })

  it('导入存档时提示去正确的入口', () => {
    const r = parseWorldbook({ format: 'deng-xu-save', version: 1, data: {} })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('存档')
    expect(r.error).toContain('导入存档')
  })

  it('版本过高被拒', () => {
    const r = parseWorldbook({ format: WORLDBOOK_FORMAT, version: 99, title: 'T', worlds: [world('a', '甲')] })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('版本')
  })

  it('缺标题被拒', () => {
    const r = parseWorldbook({ format: WORLDBOOK_FORMAT, version: 1, worlds: [world('a', '甲')] })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('标题')
  })

  it('没有世界卡被拒', () => {
    const r = parseWorldbook({ format: WORLDBOOK_FORMAT, version: 1, title: 'T', worlds: [] })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('没有世界卡')
  })

  it('世界卡损坏被拒', () => {
    const r = parseWorldbook({ format: WORLDBOOK_FORMAT, version: 1, title: 'T', worlds: [{ id: 'x' }] })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('损坏的世界卡')
  })

  it('章节引用了不存在的世界 id 时剔除该章节（不显示空章节）', () => {
    const r = parseWorldbook({
      format: WORLDBOOK_FORMAT, version: 1, title: 'T',
      worlds: [world('a', '甲')],
      chapters: [
        { title: '有效', worldIds: ['a'] },
        { title: '悬空', worldIds: ['nope'] },
      ],
    })
    expect(r.ok).toBe(true)
    expect(r.book!.chapters).toHaveLength(1)
    expect(r.book!.chapters![0].title).toBe('有效')
  })

  it('摘要能反映机制向与纯叙事向的数量', () => {
    const r = parseWorldbook({
      format: WORLDBOOK_FORMAT, version: 1, title: '示例集',
      worlds: [world('a', '甲', true), world('b', '乙', false)],
    })
    expect(r.ok).toBe(true)
    expect(r.summary).toContain('2 个世界')
    expect(r.summary).toContain('1 个机制向')
  })
})

describe('世界书 → 世界包（复用已有导入通道）', () => {
  it('转换后 format 与结构符合 worldPack 的期望', () => {
    const book = buildWorldbook({
      title: 'T', worlds: [world('a', '甲', true, 2), world('b', '乙', false, 1)],
    })
    const pack = worldbookToPack(book)
    expect(pack.format).toBe('deng-xu-worldpack')
    expect(pack.worlds).toHaveLength(2)
    expect(pack.meta.worldCount).toBe(2)
    expect(pack.meta.characterCount).toBe(3)   // 内嵌角色卡被统计进来
    expect(pack.meta.hasSave).toBe(false)      // 世界书不带存档
  })

  it('转换结果能被 worldPack 校验通过（两条路径真的互通）', async () => {
    const { validatePack } = await import('@/utils/worldPack')
    const book = buildWorldbook({ title: 'T', worlds: [world('a', '甲')] })
    const r = validatePack(worldbookToPack(book))
    expect(r.ok).toBe(true)
  })
})
