import { describe, it, expect } from 'vitest'
import { inferTraits } from '@/utils/appearance'
import runtime from '@/assets/lpc/runtime.json'

/**
 * 「外观关键词必须指向真实存在的部件」—— 这条测试是为了防住一类**静默失效**。
 *
 * 背景：我第一版凭想象给身份写了 `chainmail` / `plate` / `formal` / `suit` /
 * `leather.?apron` 这些关键词，而素材库里根本没有对应的 id。
 * 关键词匹配是"命中才用"，写错的代价是**不报错、悄悄退化成随机** ——
 * 于是铁匠穿上工装裤、管家戴上野蛮人头盔、法师穿着 T 恤。
 *
 * 这个 bug 靠肉眼评审发现不了（代码看起来完全合理），
 * 只能拿真实部件库来核对。所以这里把两边接起来测。
 */
const parts = (runtime as any).parts as { id: string; kind: string }[]
const poolOf = (kinds: string[]) => parts.filter(p => kinds.includes(p.kind)).map(p => p.id)

const TORSO_POOL = poolOf(['clothes', 'armour', 'apron'])
const HEADWEAR_POOL = poolOf(['hat'])
const HAIR_POOL = poolOf(['hair'])
const BEARD_POOL = poolOf(['beard'])
const CAPE_POOL = poolOf(['cape'])
const ARMS_POOL = poolOf(['arms'])

/** 复刻 lpcSprite 的匹配规则 */
const hits = (pool: string[], keywords: string[]) =>
  keywords.filter(kw => pool.some(id => id.toLowerCase().includes(kw.toLowerCase())))

describe('部件库规模（扩大后的基线）', () => {
  it('总数不少于 160（原为 60）', () => {
    expect(parts.length).toBeGreaterThanOrEqual(160)
  })

  it('关键类别都有足够选择', () => {
    expect(HAIR_POOL.length, '发型').toBeGreaterThanOrEqual(40)
    expect(TORSO_POOL.length, '衣着').toBeGreaterThanOrEqual(25)
    expect(HEADWEAR_POOL.length, '头饰').toBeGreaterThanOrEqual(20)
    expect(BEARD_POOL.length, '胡须').toBeGreaterThanOrEqual(10)
    expect(CAPE_POOL.length, '披风').toBeGreaterThanOrEqual(3)
    expect(ARMS_POOL.length, '护臂').toBeGreaterThanOrEqual(5)
  })

  it('所有部件都有 id、kind、zPos，且尺寸是 128 宽的 idle 表', () => {
    for (const p of parts as any[]) {
      expect(typeof p.id, JSON.stringify(p).slice(0, 80)).toBe('string')
      expect(typeof p.kind).toBe('string')
      expect(typeof p.zPos).toBe('number')
      expect(p.w, `${p.id} 宽度应为 128`).toBe(128)
    }
  })
})

describe('身份关键词必须命中真实部件（这是本测试的核心）', () => {
  /** 每个身份的代表性描述 + 它必须能匹配到的部件类别 */
  const ROLES: [string, string, string[]][] = [
    ['守卫队长', '北门哨塔的守卫队长，穿铠甲', TORSO_POOL],
    ['骑士', '一名重装骑士', TORSO_POOL],
    ['法师', '塔里的老法师，穿长袍', TORSO_POOL],
    ['管家', '星夜堡的管家，衣着整洁', TORSO_POOL],
    ['贵族', '举止优雅的贵族领主', TORSO_POOL],
    ['铁匠', '镇上的铁匠，戴皮围裙', TORSO_POOL],
    ['刺客', '身披黑斗篷的刺客', TORSO_POOL],
    ['水手', '港口的水手', TORSO_POOL],
  ]

  for (const [label, desc, pool] of ROLES) {
    it(`${label}：至少命中一个真实部件`, () => {
      const t = inferTraits({ description: desc })
      expect(t.role, `${label} 应推断出 role`).toBeTruthy()
      expect(hits(pool, t.role!), `${label} 的关键词 ${JSON.stringify(t.role)} 在池里一个都不存在`)
        .not.toHaveLength(0)
    })
  }
})

describe('头饰关键词必须命中真实部件', () => {
  const CASES: [string, string][] = [
    ['头盔', '戴着铁头盔的守卫'],
    ['兜帽', '披着兜帽的旅人'],
    ['头巾', '扎着红头巾的海盗'],
    ['王冠', '头戴王冠的女王'],
    ['皮帽', '戴一顶皮帽子'],
  ]
  for (const [label, desc] of CASES) {
    it(`${label}：至少命中一个真实头饰`, () => {
      const t = inferTraits({ description: desc })
      expect(t.headwear, `${label} 应推断出 headwear`).toBeTruthy()
      expect(hits(HEADWEAR_POOL, t.headwear!).length, `${label} 的 ${JSON.stringify(t.headwear)} 没有对应部件`)
        .toBeGreaterThan(0)
    })
  }
})

describe('发型关键词必须命中真实发型', () => {
  const CASES: [string, string][] = [
    ['马尾', '黑发束成马尾'],
    ['光头', '一个光头男人'],
    ['卷发', '棕色卷发'],
    ['长直发', '一头长直发'],
    ['辫子', '编着辫子的女孩'],
    ['爆炸头', '一头爆炸头'],
    ['短发', '利落的短发'],
  ]
  for (const [label, desc] of CASES) {
    it(`${label}：至少命中一个真实发型`, () => {
      const t = inferTraits({ description: desc })
      expect(t.hairStyle, `${label} 应推断出 hairStyle`).toBeTruthy()
      expect(hits(HAIR_POOL, t.hairStyle!).length, `${label} 的 ${JSON.stringify(t.hairStyle)} 没有对应发型`)
        .toBeGreaterThan(0)
    })
  }
})

describe('zPos 层级必须符合 LPC 约定（叠错层会画出穿模）', () => {
  const zOf = (id: string) => (parts.find(p => p.id === id) as any)?.zPos ?? -1

  it('胡须在头部之上、头发之下', () => {
    const beard = zOf('beards_beard')
    const head = zOf('heads_human_male')
    const hair = zOf('hair_bob')
    expect(beard).toBeGreaterThan(head)
    expect(beard).toBeLessThan(hair)
  })

  it('头发在头部之上（否则头发被脸盖住）', () => {
    expect(zOf('hair_bob')).toBeGreaterThan(zOf('heads_human_male'))
  })

  it('帽子在头发之上', () => {
    expect(zOf('hat_helmet_nasal')).toBeGreaterThan(zOf('hair_bob'))
  })

  it('披风在盔甲之上、头之下', () => {
    const cape = zOf('cape_solid')
    expect(cape).toBeGreaterThan(zOf('torso_armour_leather'))
    expect(cape).toBeLessThan(zOf('heads_human_male'))
  })

  it('鞋子在腿之上（否则裤腿把鞋整个盖住，看起来像光脚）', () => {
    const legs = zOf('legs_pants')
    for (const id of ['feet_shoes_basic', 'feet_boots_basic', 'feet_socks_ankle']) {
      expect(zOf(id), `${id} 应不低于腿`).toBeGreaterThanOrEqual(legs)
    }
  })

  it('身份关键部件都在库里', () => {
    for (const id of ['torso_armour_leather', 'torso_armour_plate', 'torso_clothes_robe',
      'torso_jacket_collared', 'torso_aprons_apron', 'hat_helmet_nasal',
      'hat_hood_cloth', 'hat_formal_crown', 'cape_solid', 'beards_beard']) {
      expect(parts.some(p => p.id === id), `缺部件 ${id}`).toBe(true)
    }
  })
})
