import { describe, it, expect } from 'vitest'
import { inferTraits, resolvePaletteName } from '@/utils/appearance'

/**
 * 外貌推断。
 *
 * 这是「立绘和角色描述对不上」的修复核心，所以断言要贴着真实角色卡写 ——
 * 下面这些描述都是这个项目里会真实出现的样子（含管家、守卫队长这类具体身份）。
 */
describe('外貌推断 · 发色', () => {
  const cases: [string, string][] = [
    ['星夜堡的管家，黑发束成笔直的马尾，戴单片眼镜', 'black'],
    ['一头银白的长发垂至腰际', 'silver'],
    ['金发碧眼的年轻女子', 'blonde'],
    ['红发艾拉是北门最凶的守卫', 'red'],
    ['深棕色的短发，看起来很干练', 'dark_brown'],
    ['she had raven hair and pale skin', 'black'],
  ]
  for (const [text, want] of cases) {
    it(`「${text.slice(0, 18)}…」→ ${want}`, () => {
      expect(inferTraits({ description: text }).hairColor).toBe(want)
    })
  }

  it('名字里的外貌词优先级最高', () => {
    // 名字说红发，描述里又提到"黑色的靴子" —— 应当以名字为准
    const t = inferTraits({ name: '红发艾拉', description: '穿着黑色的靴子' })
    expect(t.hairColor).toBe('red')
  })

  it('没有任何发色线索时不乱猜', () => {
    expect(inferTraits({ description: '一个沉默的人' }).hairColor).toBeUndefined()
  })
})

describe('外貌推断 · 发型', () => {
  it('马尾 → 命中马尾相关部件关键词', () => {
    const t = inferTraits({ description: '黑发束成笔直的马尾' })
    expect(t.hairStyle).toContain('ponytail')
  })
  it('光头', () => {
    expect(inferTraits({ description: '光头的中年男人' }).hairStyle).toContain('bald')
  })
  it('长发 + 卷发可以叠加', () => {
    const t = inferTraits({ description: '一头卷曲的长发' })
    expect(t.hairStyle).toContain('long')
    expect(t.hairStyle).toContain('curly')
  })
})

describe('外貌推断 · 年龄与体型', () => {
  it('老者', () => {
    expect(inferTraits({ description: '年迈的老者，白发苍苍' }).age).toBe('elder')
  })
  it('少年', () => {
    expect(inferTraits({ description: '一个瘦弱的少年' }).age).toBe('child')
  })
  it('瘦弱', () => {
    expect(inferTraits({ description: '瘦弱的身形' }).build).toBe('slim')
  })
  it('魁梧', () => {
    expect(inferTraits({ description: '魁梧的壮汉' }).build).toBe('muscular')
  })
})

describe('外貌推断 · 身份暗示衣着', () => {
  /*
    断言检查的是**真实部件 id**，不再是抽象词。
    第一版这里写的是 `toContain('armour')`、`toContain('robe')` 之类，
    而我后来把关键词换成了实际 id（`torso_armour_plate` 等）——
    抽象词根本不存在于库里，那样的断言等于在验证一个假接口。
    「关键词必须指向真实部件」这件事由 spritePool.test.ts 统一守着。
  */
  it('守卫队长 → 盔甲部件', () => {
    const t = inferTraits({ description: '北门哨塔的守卫队长' })
    expect(t.role!.some(k => k.startsWith('torso_armour_'))).toBe(true)
  })
  it('管家 → 正装外套', () => {
    const t = inferTraits({ description: '星夜堡的管家' })
    expect(t.role!.some(k => k.startsWith('torso_jacket_'))).toBe(true)
  })
  it('法师 → 长袍', () => {
    const t = inferTraits({ description: '塔里的老法师' })
    expect(t.role).toContain('torso_clothes_robe')
  })
  it('铁匠 → 皮围裙（不是工装裤）', () => {
    const t = inferTraits({ description: '镇上的铁匠' })
    expect(t.role![0]).toMatch(/^torso_aprons_apron/)
  })
  it('身份可以叠加（守卫 + 队长）', () => {
    const t = inferTraits({ description: '巡逻队长与他的守卫' })
    expect(t.role!.length).toBeGreaterThanOrEqual(1)
  })
})

describe('外貌推断 · 头饰与胡须', () => {
  it('头盔 → 真实头盔部件', () => {
    const t = inferTraits({ description: '戴着铁头盔' })
    expect(t.headwear!.some(k => k.startsWith('hat_helmet_'))).toBe(true)
  })
  it('兜帽 → 兜帽部件（库里确实有 hat_hood_cloth）', () => {
    const t = inferTraits({ description: '披着兜帽的旅人' })
    expect(t.headwear!.some(k => k.startsWith('hat_hood_'))).toBe(true)
  })
  it('王冠 → 王冠部件', () => {
    const t = inferTraits({ description: '头戴王冠的女王' })
    expect(t.headwear).toContain('hat_formal_crown')
  })
  it('单片眼镜：读到了设定，但因为没有素材而不加任何头饰', () => {
    /*
      有意为之的行为。上游**没有**眼镜类部件，所以这条规则的匹配关键词是空数组：
        - headwear 是空数组 ⇒ 配方不加头饰（而不是随机给一顶头盔）；
        - evidence 里仍留下「头饰:单片眼镜」⇒ 作者的设定被读到了。
      将来补了眼镜素材，把 id 填进 appearance.ts 那条规则即可。
    */
    const t = inferTraits({ description: '戴单片眼镜的管家' })
    expect(t.headwear).toBeDefined()
    expect(t.headwear).toHaveLength(0)
    expect(t.evidence.some(e => e.includes('单片眼镜'))).toBe(true)
  })
  it('胡须', () => {
    expect(inferTraits({ description: '留着络腮胡的铁匠' }).beard).toBe(true)
  })
  it('没有胡须线索时不设值', () => {
    expect(inferTraits({ description: '一个年轻人' }).beard).toBeUndefined()
  })
})

describe('外貌推断 · 性别', () => {
  it('显式 gender 字段优先', () => {
    expect(inferTraits({ gender: '女', description: '他站在那里' }).gender).toBe('female')
  })
  it('没有字段时从代词推断', () => {
    expect(inferTraits({ description: '她推开门' }).gender).toBe('female')
  })
  it('年长者默认按男性取头部部件（避免抽到少女脸）', () => {
    expect(inferTraits({ description: '年迈的老者' }).gender).toBe('male')
  })
})

describe('外貌推断 · evidence 可解释', () => {
  it('每个推断都留下原文依据', () => {
    const t = inferTraits({
      description: '黑发束成马尾的管家，戴单片眼镜，年迈',
    })
    expect(t.evidence.length).toBeGreaterThanOrEqual(3)
    for (const e of t.evidence) expect(e).toMatch(/[\u4e00-\u9fa5]/)
  })

  it('完全无特征时 evidence 为空数组（不是 undefined）', () => {
    expect(inferTraits({ description: '……' }).evidence).toEqual([])
  })
})

describe('调色板名解析', () => {
  const pal = ['black', 'dark_brown', 'blonde', 'silver', 'red', 'blue', 'green']

  it('精确命中', () => {
    expect(resolvePaletteName('black', pal)).toBe('black')
  })
  it('语义色 → 调色板里的实际名字', () => {
    expect(resolvePaletteName('silver', pal)).toBe('silver')
    expect(resolvePaletteName('blonde', pal)).toBe('blonde')
  })
  it('找不到候选时返回 undefined（让调用方回退到随机）', () => {
    expect(resolvePaletteName('chartreuse', pal)).toBeUndefined()
    expect(resolvePaletteName(undefined, pal)).toBeUndefined()
  })
  it('别名映射：调色板里没有该色时退到最近的一个', () => {
    // cloth 调色板里确有 white，所以直接命中
    expect(resolvePaletteName('white', ['white', 'black'])).toBe('white')
    // 只有 silver 的调色板里，white 退到 light
    expect(resolvePaletteName('white', ['silver', 'light'])).toBe('light')
  })
  it('大小写不敏感', () => {
    expect(resolvePaletteName('BLACK', ['Black', 'Red'])).toBe('Black')
  })
})
