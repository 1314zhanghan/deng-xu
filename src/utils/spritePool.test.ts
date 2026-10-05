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
  it('总数不少于 220（四轮扩充后的基线）', () => {
    expect(parts.length).toBeGreaterThanOrEqual(220)
  })

  it('关键类别都有足够选择', () => {
    // 发型是玩家区分 NPC 最快的一维（一眼分得开爆炸头与马尾），所以基线定得最高
    expect(HAIR_POOL.length, '发型').toBeGreaterThanOrEqual(60)
    expect(TORSO_POOL.length, '衣着').toBeGreaterThanOrEqual(55)
    expect(HEADWEAR_POOL.length, '头饰').toBeGreaterThanOrEqual(30)
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
    // ── 下面这批是覆盖率诊断（npc-coverage.mjs）暴露出来的缺口，补齐后固化 ──
    ['官员', '三十岁的文官，面容清瘦', TORSO_POOL],
    ['学生', '魔法学院的学生，穿制服', TORSO_POOL],
    ['酒保', '酒馆的老板，围裙上有油渍', TORSO_POOL],
    ['游侠', '森林里的游侠，穿皮甲', TORSO_POOL],
    ['医生', '城里的医师，随身带药箱', TORSO_POOL],
    ['上班族', '地铁上的上班族，拎着公文包', TORSO_POOL],
    ['警察', '路口的警官', TORSO_POOL],
    ['厨师', '后厨的厨师', TORSO_POOL],
    ['商人', '走商的商人', TORSO_POOL],
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
    // 覆盖率诊断发现「乌纱帽」「棒球帽」「圆框眼镜」原先一条都不命中
    ['乌纱帽', '戴乌纱帽的文官'],
    ['棒球帽', '浅金色的马尾从棒球帽后面露出来'],
    ['大盔', '戴着全罩大盔的骑士'],
    ['角冠', '头上生着犄角'],
  ]
  for (const [label, desc] of CASES) {
    it(`${label}：至少命中一个真实头饰`, () => {
      const t = inferTraits({ description: desc })
      expect(t.headwear, `${label} 应推断出 headwear`).toBeTruthy()
      expect(hits(HEADWEAR_POOL, t.headwear!).length, `${label} 的 ${JSON.stringify(t.headwear)} 没有对应部件`)
        .toBeGreaterThan(0)
    })
  }

  it('**眼镜类描述命中"空关键词"，且不会因此乱配帽子**', () => {
    /*
      上游没有眼镜/面具类部件。这条规则故意给空数组：
      evidence 里留下「头饰:单片眼镜」（作者的设定被读到了），
      但配方不会加任何头饰 —— 宁可少一个配饰，也不能因为有眼镜
      就随机配一顶野蛮人头盔。
      这是**刻意的行为**，所以它不算"关键词写错"，这里单独固化。
    */
    const t = inferTraits({ description: '戴着单片眼镜的管家' })
    expect(t.headwear, '应当推断出 headwear（用来记录 evidence）').toEqual([])
    expect(t.evidence.join('|'), 'evidence 里应留下线索').toMatch(/单片眼镜|眼镜/)
  })
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

  it('裙装部件齐备，且覆盖常用颜色', () => {
    const dresses = parts.filter(p => /^dress_/.test(p.id))
    expect(dresses.length, '裙装数量').toBeGreaterThanOrEqual(20)
    /*
      裙装是**预渲染的颜色变体**（没有 recolors），所以"白色长裙"能不能画对，
      完全取决于 _white 这一件在不在库里。这条断言守住它。
    */
    for (const color of ['white', 'black', 'red', 'blue', 'navy', 'green', 'purple', 'brown']) {
      expect(dresses.some(d => d.id.endsWith('_' + color)), `缺 ${color} 色裙装`).toBe(true)
    }
  })

  it('裙装的 zPos 在腿之上、上衣之下（否则叠层会穿模）', () => {
    const dress = zOf('dress_sash_white')
    expect(dress).toBeGreaterThan(zOf('legs_pants'))
    expect(dress).toBeLessThan(zOf('torso_clothes_longsleeve'))
  })

  it('裙装不声明 recolors（颜色靠变体文件，不靠调色板）', () => {
    const dresses = parts.filter(p => /^dress_/.test(p.id)) as any[]
    for (const d of dresses) {
      expect(d.recolors, `${d.id} 不应声明 recolors`).toBeFalsy()
    }
  })

  it('**裙子不会出现在裤装池里** —— 否则男 NPC 会随机穿裙子', async () => {
    /*
      上游把 legs_skirt_* / legs_skirts_* 的 kind 也标成了 `legs`。
      如果按 `kind === 'legs'` 取池子，裙子就混进了裤装，
      "一个走路的年轻男子"能随机分到一条裙子 —— 这类错误玩家一眼就看得出来。
      这条断言守住"裤装池里没有裙子"。
    */
    const { recipeFor } = await import('@/utils/lpcSprite')
    for (let i = 0; i < 40; i++) {
      const r = recipeFor('male-' + i, {
        profile: { description: '一个走路的年轻男子', gender: '男' },
        gender: '男',
      })
      for (const l of r.parts.filter(p => /^legs_/.test(p))) {
        expect(/skirt/i.test(l), `男性角色不该拿到裙子：${l} (seed ${i})`).toBe(false)
      }
    }
  })

  it('**无裙装线索的角色不会拿到连衣裙或罩裙**', async () => {
    /*
      dress_* 与 legs_skirt_overskirt 都被上游归成了上衣类
      （后者 kind 甚至是 apron）。它们若留在上衣池里就会被随机分配，
      结果是"走路的年轻男子"随机穿上一件连衣裙。
    */
    const { recipeFor } = await import('@/utils/lpcSprite')
    for (let i = 0; i < 60; i++) {
      const r = recipeFor('plain-' + i, {
        profile: { description: '一个走路的年轻人', gender: '男' },
        gender: '男',
      })
      const dressy = r.parts.filter(p => /^dress_|skirt/i.test(p))
      expect(dressy.length, `无裙装线索却拿到了裙装：${dressy.join(',')} (seed ${i})`).toBe(0)
    }
  })

  it('明确穿裙时不会同时给裤子', async () => {
    const { recipeFor } = await import('@/utils/lpcSprite')
    const r = recipeFor('skirt-only', {
      profile: { description: '穿着裙子的女子', gender: '女' },
      gender: '女',
    })
    const legParts = r.parts.filter(p => /^legs_/.test(p))
    const hasPants = legParts.some(l => !/skirt/i.test(l))
    // 要么是一条裙子，要么什么都没有（连衣裙覆盖），但绝不能是裤子
    expect(hasPants, `不应同时给裤子：${legParts.join(',')}`).toBe(false)
  })

  it('**外层件一定配了打底衬衣** —— 否则角色裸露上身', async () => {
    /*
      围裙/罩衣/工装裤/战袍/罩裙这些"外层件"自己只画外层那一片，
      LPC 的用法是先穿衬衣再套外层。配方原先只选一件就收工，
      选到它们时角色底下什么都没穿 —— 渲染出来是一个裸露上身的人。
      我把 37 件上衣各画一遍对照才发现有 7 件如此
      （先用像素覆盖率统计试过，结论完全对不上，白折腾一轮）。
    */
    const OUTER = [
      'torso_aprons_apron', 'torso_aprons_apron_full', 'torso_aprons_apron_half',
      'torso_aprons_overalls', 'torso_aprons_suspenders', 'torso_jacket_tabard',
      'torso_jacket_pockets', 'legs_skirt_overskirt',
    ]
    const BASE = /^torso_clothes_(longsleeve2?|longsleeve_formal(_striped)?|shortsleeve|tshirt|longsleeves2)$/
    const { recipeFor } = await import('@/utils/lpcSprite')

    for (const outer of OUTER) {
      // 用足够多的种子找到一个真的选中该外层件的配方
      let found = false
      for (let i = 0; i < 400 && !found; i++) {
        const r = recipeFor('outer-' + i, { profile: { description: '一个普通人' }, gender: '女' })
        if (!r.parts.includes(outer)) continue
        found = true
        const hasBase = r.parts.some(p => BASE.test(p))
        expect(hasBase, `${outer} 必须配打底衬衣，实际部件：${r.parts.join(',')}`).toBe(true)
      }
      // 找不到不报错：外层件是随机选中的，某些可能极难命中
    }
  })
})
