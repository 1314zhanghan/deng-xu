/**
 * 从角色描述里推断外貌特征，用于挑选像素立绘的部件与配色。
 *
 * 为什么需要这个：
 *  原先 `recipeFor()` **只看 `gender` 一个字段**，其余部件与颜色全靠随机数 ——
 *  于是「黑发束成马尾、戴单片眼镜」的管家和「红发守卫队长」抽到的立绘
 *  与描述毫无关系，而且所有人长得都差不多。这就是"匹配度不足"的根因。
 *
 * 这里把角色卡里能拿到的所有文本（描述、性格、身份、名字）合并后做关键词匹配，
 * 提取出发型 / 发色 / 衣着 / 年龄 / 体型 / 配饰等特征，交给 `recipeFor()` 使用。
 *
 * 设计原则：
 *  1. **只做有把握的推断**。命中不了就返回 undefined，让 recipeFor 回退到随机 ——
 *     乱猜比随机更糟，那会让"匹配"变成"错误的确定性"。
 *  2. 中文与英文都认（角色卡可能来自 SillyTavern）。
 *  3. 优先级：明确写出的 > 从身份推断的。
 */

import type { Material } from '@/utils/lpcSprite'

/** 从文本推断出的外貌特征 */
export interface AppearanceTraits {
  /** 发色（对应 LPC hair 调色板名） */
  hairColor?: string
  /** 发型关键词（用于在部件 id 里模糊匹配） */
  hairStyle?: string[]
  /** 肤色（LPC body 调色板名） */
  skin?: string
  /** 衣色（LPC cloth 调色板名） */
  cloth?: string
  /** 瞳色（LPC eye 调色板名） */
  eye?: string
  /** 年龄气质 */
  age?: 'child' | 'young' | 'adult' | 'elder'
  /** 性别气质 */
  gender?: 'male' | 'female'
  /** 体型 */
  build?: 'slim' | 'average' | 'broad' | 'muscular'
  /** 身份关键词，用于挑衣着（例如"守卫"→盔甲） */
  role?: string[]
  /** 是否戴帽/头盔 */
  headwear?: string[]
  /** 是否有胡须 */
  beard?: boolean
  /**
   * 是否有裙装。
   * 上游的 dress 部件**覆盖整个下半身**（zPos 30，在腿 20 之上），
   * 所以穿裙子时必须**不再叠腿部件** —— 否则裤腿会从裙摆里穿出来。
   */
  skirt?: boolean
  /** 匹配到的原文片段，便于调试与向玩家解释 */
  evidence: string[]
}

// ============================================================================
// 词表
// ============================================================================

/**
 * 发色词表。
 *
 * ⚠️ 每条都必须**明确指向头发**。第一版这里写了裸的 `/white hair|silver hair/`
 * 之类，结果「白手套上永远残留墨痕」里的 white 被当成发色，
 * 管家于是得到一头白发。凡是修饰"发"的规则，就不能匹配别的白色物件。
 */
const HAIR_COLORS: [RegExp, string][] = [
  [/乌黑|漆黑|墨黑|纯黑|黑(色)?(的)?(长)?(发|头发)|raven hair|jet.?black|black hair/i, 'black'],
  [/深棕|暗棕|褐发|棕发|栗色(的)?发|栗发|brown hair|chestnut hair|brunette/i, 'dark_brown'],
  [/金发|淡金|铂金(色)?(的)?发|金(色)?(的)?(长)?发|blond|blonde|golden hair|platinum blond/i, 'blonde'],
  [/银发|银白(色)?(的)?(长)?发|霜白(的)?发|银丝|silver hair|white hair|grey hair|gray hair/i, 'silver'],
  [/花白(的)?(头)?发|灰白(的)?(头)?发|斑白/i, 'silver'],
  [/红发|赤发|火红(的)?(长)?发|姜红(的)?发|red hair|ginger hair|auburn/i, 'red'],
  [/橙(色)?(的)?发|橘(色)?(的)?发|orange hair/i, 'orange'],
  [/蓝(色)?(的)?(长)?发|靛蓝(的)?发|blue hair/i, 'blue'],
  [/绿(色)?(的)?(长)?发|翠绿(的)?发|green hair/i, 'green'],
  [/紫(色)?(的)?(长)?发|紫罗兰(色)?(的)?发|薰衣草(色)?(的)?发|purple hair|violet hair|lavender hair/i, 'purple'],
  [/粉(色)?(的)?(长)?发|桃粉(的)?发|pink hair/i, 'pink'],
]

/** 发型 → 部件 id 里可能出现的关键词 */
const HAIR_STYLES: [RegExp, string[]][] = [
  [/马尾|束起|扎起|ponytail|bound back/i, ['ponytail', 'long', 'bob']],
  [/双马尾|twin.?tail|pigtail/i, ['pig', 'ponytail', 'bangs']],
  [/发髻|盘发|丸子头|bun|updo/i, ['bun', 'updo']],
  [/光头|秃|bald|shaven/i, ['bald', 'balding']],
  [/短寸|寸头|板寸|buzz/i, ['buzz', 'short', 'balding']],
  [/短发|利落.*发|干练.*发|short hair/i, ['short', 'bangs', 'bob']],
  // 「长直发」这种连写要单独列 —— 只写「长发」匹配不到它（词表漏过）
  [/长直发|直发|长直|straight hair/i, ['long', 'long_straight', 'relm_xlong']],
  [/长发|披肩|垂至|及腰|long hair/i, ['long', 'ponytail', 'bangslong', 'relm_xlong']],
  [/卷发|波浪|卷曲|curly|wavy|wavy hair/i, ['curly', 'wavy', 'long']],
  [/刘海|齐刘海|bangs|fringe/i, ['bangs', 'bangsshort', 'bangslong']],
  [/爆炸头|蓬松.*发|afro/i, ['afro', 'curly']],
  [/脏辫|辫子|braid|dreadlock/i, ['braid', 'dread', 'long']],
  [/莫西干|mohawk/i, ['mohawk']],
  [/蓬乱|凌乱|乱蓬|未打理|unkempt|messy|bedhead/i, ['bedhead', 'messy', 'long']],
]

/** 肤色 → LPC body 调色板名 */
const SKINS: [RegExp, string][] = [
  [/苍白|惨白|白得|病态.*白|瓷白|pale|porcelain|fair skin/i, 'light'],
  [/白皙|白净|浅肤|fair|light skin/i, 'light'],
  [/小麦|古铜|健康.*肤|tan|bronze|olive skin/i, 'olive'],
  [/深肤|黑肤|黝黑|dark skin|brown skin|ebony/i, 'dark'],
  [/灰肤|灰色.*肤|亡灵|尸|undead|ashen skin/i, 'grey'],
  [/绿肤|绿皮|orc|goblin/i, 'green'],
]

/**
 * 衣色。
 * ⚠️ 右侧写法要能覆盖"白色长裙""红色长袍"这类**颜色+衣物**的组合，
 * 不能只写"白衣/白袍" —— 我第一版就是这样漏掉了「白色长裙」，
 * 于是莉莉安的裙子被随机配成石板灰。
 */
const CLOTH_COLORS: [RegExp, string][] = [
  [/白(色|衣|袍|裙|衫|服|斗篷|披风)|素白|皎白|雪白|white\b/i, 'white'],
  [/黑(色|衣|袍|裙|衫|服|斗篷|披风|甲)|玄色|墨色|漆黑|black\b/i, 'black'],
  [/灰(色|衣|袍|裙|衫|服|斗篷|披风)|灰袍|grey\b|gray\b/i, 'gray'],
  [/深蓝|藏青|靛蓝|navy|dark blue/i, 'navy'],
  [/蓝(色|衣|袍|裙|衫|服|斗篷|披风)|blue\b/i, 'blue'],
  [/红(色|衣|袍|裙|衫|服|斗篷|披风)|绯红|猩红|red\b/i, 'red'],
  [/酒红|暗红|栗红|maroon|burgundy/i, 'maroon'],
  [/绿(色|衣|袍|裙|衫|服|斗篷|披风)|墨绿|翠绿|green\b/i, 'green'],
  [/森林绿|深绿|forest green/i, 'forest'],
  [/棕(色|衣|袍|裙|衫|服)|褐(色|衣|袍)|皮革|皮甲|皮衣|brown\b|leather/i, 'brown'],
  [/紫(色|衣|袍|裙|衫|服|斗篷)|purple\b|violet\b/i, 'purple'],
  [/薰衣草|淡紫|lavender/i, 'lavender'],
  [/粉(色|衣|袍|裙)|桃粉|pink\b|rose\b/i, 'pink'],
  [/金(色|袍|衣|甲)|金黄|gold\b/i, 'yellow'],
  [/黄(色|衣|袍|裙)|土黄|yellow\b/i, 'yellow'],
  [/橙(色|衣|袍|裙)|orange\b/i, 'orange'],
  [/青(色|衣|袍)|蓝绿|teal\b/i, 'teal'],
  [/天蓝|sky blue/i, 'sky'],
  [/木炭|炭黑|charcoal/i, 'charcoal'],
  [/石板|slate/i, 'slate'],
]

/** 瞳色 */
const EYE_COLORS: [RegExp, string][] = [
  [/蓝眼|碧眼|蓝眸|blue eyes?/i, 'blue'],
  [/绿眼|翠眸|green eyes?/i, 'green'],
  [/灰眼|灰眸|grey eyes?|gray eyes?/i, 'grey'],
  [/棕眼|褐眸|brown eyes?/i, 'brown'],
  [/金眼|琥珀.*眼|金瞳|amber eyes?|golden eyes?/i, 'gold'],
  [/红眼|赤瞳|血瞳|red eyes?/i, 'red'],
  [/紫眼|紫瞳|violet eyes?|purple eyes?/i, 'purple'],
  [/黑眼|黑眸|black eyes?/i, 'black'],
]

/** 年龄 */
const AGES: [RegExp, 'child' | 'young' | 'adult' | 'elder'][] = [
  [/孩童|幼童|小孩|少年|少女|child|kid|young boy|young girl|\b1[0-6] ?岁/i, 'child'],
  [/青年|年轻|少年郎|rookie|young man|young woman|youth|\b(1[7-9]|2[0-9]) ?岁/i, 'young'],
  [/中年|壮年|middle.?aged|\b(4[0-9]|5[0-9]) ?岁/i, 'adult'],
  [/老|年迈|白发苍苍|古稀|花甲|elder|elderly|old man|old woman|aged|\b[6-9][0-9] ?岁/i, 'elder'],
]

/** 体型 */
const BUILDS: [RegExp, 'slim' | 'average' | 'broad' | 'muscular'][] = [
  [/瘦|纤细|单薄|削瘦|孱弱|slim|thin|slender|gaunt|frail/i, 'slim'],
  [/魁梧|高大|壮硕|虎背|健壮|肌肉|muscular|burly|broad.?shouldered|hulking/i, 'muscular'],
  [/敦实|结实|壮实|stocky|sturdy|plump|heavy.?set/i, 'broad'],
]

/**
 * 身份 → 暗示的衣着类型。
 *
 * ⚠️ 右侧的关键词必须是**素材库里真实存在的 id 片段**。
 * 我第一版凭想象写了 `chainmail` / `plate` / `formal` / `suit` / `leather.?apron`，
 * 结果：库里没有 chainmail 和 formal，`leather.?apron` 又匹配不到
 * `torso_aprons_apron`（它的 id 里没有 "leather"）——
 * 于是铁匠穿上了 overalls（工装裤）、管家穿上了长袖 T 恤。
 * 关键词筛选是"命中才用"，**写错的代价是静默失效**，不会报错。
 *
 * 下面的关键词都对着 lpcSprite.ts 里实际存在的 id 核对过。
 */
const ROLES: [RegExp, string[]][] = [
  // 守卫/骑士/士兵 → 盔甲
  [/守卫|卫兵|骑士|士兵|武士|巡逻|队长|guard|knight|soldier|warrior|sentry|watchman/i,
    ['torso_armour_plate', 'torso_armour_legion', 'torso_armour_leather']],
  // 法师/学者 → 长袍
  [/法师|术士|巫师|学者|研究|mage|wizard|sorcer|scholar|warlock/i,
    ['torso_clothes_robe']],
  // 管家/仆从/贵族 → 正装外套
  [/管家|仆从|侍者|女仆|butler|servant|maid|steward/i,
    ['torso_jacket_collared', 'torso_jacket_pockets', 'torso_jacket_frock']],
  // 商人/店主 → 马甲/外套
  [/商人|店主|掌柜|merchant|shopkeep|trader/i,
    ['torso_jacket_pockets', 'torso_clothes_longsleeve2_buttoned']],
  // 盗贼/刺客/游侠 → 皮甲或无袖（便于行动）
  [/盗贼|刺客|游侠|猎|rogue|thief|assassin|ranger|hunter/i,
    ['torso_armour_leather', 'torso_clothes_sleeveless1']],
  // 贵族/领主/王 → 礼服
  [/贵族|领主|国王|女王|王|noble|lord|lady|king|queen|prince|princess/i,
    ['torso_jacket_tabard', 'torso_jacket_iverness', 'torso_jacket_frock']],
  // 铁匠/工匠/矿工 → 皮围裙
  [/铁匠|工匠|矿工|smith|blacksmith|miner|craftsman/i,
    ['torso_aprons_apron', 'torso_aprons_apron_half']],
  // 农民/农妇/村民 → 长袖或工装
  [/农民|农妇|农夫|farmer|peasant|villager/i,
    ['torso_clothes_longsleeve', 'torso_aprons_overalls']],
  // 船员/水手/船长 → 束袖长衫
  [/船员|水手|船长|sailor|captain|pirate/i,
    ['torso_clothes_longsleeves_cuffed', 'torso_clothes_longsleeve']],
]

/**
 * 头饰 → 关键词。
 * 同样必须对应真实 id。注意：**上游没有眼镜/面具类部件**
 * （我原以为有，写了 glasses/monocle，结果"戴单片眼镜的管家"匹配不到任何东西）。
 * 匹配不到时配方会**不加头饰**而不是随机加一个 —— 见 lpcSprite 的说明。
 */
const HEADWEAR: [RegExp, string[]][] = [
  [/头盔|盔|helm|helmet/i, ['hat_helmet_nasal', 'hat_helmet_barbuta_simple', 'hat_helmet_flattop', 'hat_helmet_legion']],
  [/兜帽|连帽|hood/i, ['hat_hood_cloth', 'hat_hood_hijab']],
  [/头巾|包头|turban|headband|头带|发带/i, ['hat_headband_thick', 'hat_headband_tied', 'hat_bandana']],
  [/王冠|冠冕|crown|coronet/i, ['hat_formal_crown']],
  [/三角帽|海盗帽|tricorne|bicorne/i, ['hat_bicorne_athwart_admiral', 'hat_tricorne_captain_skull', 'hat_bicorne_foreaft_commodore']],
  [/帽子|礼帽|hat|cap/i, ['hat_cap_leather', 'hat_cap_bonnie_tilt', 'hat_cap_bonnie']],
  /*
    眼镜/单片眼镜/眼罩/面具：**上游没有这类部件**（我在 LPC 定义树里搜过，
    hat_glasses_* / hat_eyepatch / hat_mask_* 都不存在）。
    但仍然保留这条规则并给出**空关键词列表**，理由是：
      - 关键词列表为空 ⇒ 配方不会加任何头饰（正确的行为：宁可少一个配饰，
        也不能因为"戴眼镜"就随机配一顶野蛮人头盔）；
      - 同时 evidence 里会留下「头饰:单片眼镜」，说明作者的设定被读到了。
    将来如果补了眼镜素材，只需把 id 填进这个数组即可。
  */
  [/单片眼镜|眼镜|眼罩|面具|面罩|glasses|monocle|eyepatch|mask|visor/i, []],
]

/** 胡须 */
const BEARD_RE = /胡须|胡子|大胡|络腮|山羊胡|髭|beard|moustache|mustache|whisker/i

/**
 * 裙装。
 * LPC 的 dress 部件覆盖整个下半身，所以命中它就要**去掉腿部件**，
 * 否则裤腿会从裙摆里透出来（比不穿裙子更难看）。
 *
 * ⚠️ 这里踩过一个隐蔽的坑：第一版写了 `robe-like`，
 * 而正则里的 `-` 是普通字符、`e` 由 `-` 修饰成了"零或多个"，
 * 于是 `rob-?like` 实际匹配了 `torso_clothes_shortsleeve` 里的 "robe"！
 * 结果"村里的年轻人"被判成穿裙装，拿到一件没有颜色变体的和服、
 * 而且腿部件与裙子同时出现。
 * 凡是写"可选的连字符"，必须转义：`robe\-like`。
 */
const SKIRT_RE = /长?裙|连衣裙|裙装|裙摆|裙裾|礼服|晚礼服|和服|浴衣|旗袍|\bdress\b|\bskirt\b|\bkimono\b|\bgown\b/i

// ============================================================================
// 提取
// ============================================================================

/** 在文本里找第一个命中的词表项 */
function firstHit<T>(text: string, table: [RegExp, T][]): { value: T; evidence: string } | undefined {
  for (const [re, value] of table) {
    const m = text.match(re)
    if (m) return { value, evidence: m[0] }
  }
  return undefined
}

/** 收集所有命中的词表项（用于身份/头饰这类可叠加的特征） */
function allHits<T>(text: string, table: [RegExp, T][]): { values: T[]; evidence: string[] } {
  const values: T[] = []
  const evidence: string[] = []
  for (const [re, value] of table) {
    const m = text.match(re)
    if (m) { values.push(value); evidence.push(m[0]) }
  }
  return { values, evidence }
}

/**
 * 从角色信息里推断外貌特征。
 *
 * @param input 把角色卡里所有可用文本都传进来 —— 描述、性格、身份、名字都能提供线索。
 *              例如名字叫「红发艾拉」时，光看名字就足以定下发色。
 */
export function inferTraits(input: {
  name?: string
  description?: string
  personality?: string
  scenario?: string
  relationship?: string
  gender?: string
  age?: string
}): AppearanceTraits {
  // 名字权重最高：出现在名字里的外貌词几乎一定是刻意的（「红发艾拉」「独眼杰克」）。
  // 这里不做加权计算，而是把名字放在最前 —— 因为 firstHit 取第一个命中，
  // 顺序本身就是优先级。
  const text = [
    input.name || '',
    input.age || '',
    input.description || '',
    input.personality || '',
    input.scenario || '',
    input.relationship || '',
    input.gender || '',
  ].filter(Boolean).join(' \n ')

  const out: AppearanceTraits = { evidence: [] }

  const hair = firstHit(text, HAIR_COLORS)
  if (hair) { out.hairColor = hair.value; out.evidence.push(`发色:${hair.evidence}`) }

  const styleHits = allHits(text, HAIR_STYLES)
  if (styleHits.values.length) {
    out.hairStyle = [...new Set(styleHits.values.flat())]
    out.evidence.push(`发型:${styleHits.evidence.join('/')}`)
  }

  const skin = firstHit(text, SKINS)
  if (skin) { out.skin = skin.value; out.evidence.push(`肤色:${skin.evidence}`) }

  const cloth = firstHit(text, CLOTH_COLORS)
  if (cloth) { out.cloth = cloth.value; out.evidence.push(`衣色:${cloth.evidence}`) }

  const eye = firstHit(text, EYE_COLORS)
  if (eye) { out.eye = eye.value; out.evidence.push(`瞳色:${eye.evidence}`) }

  const age = firstHit(text, AGES)
  if (age) { out.age = age.value; out.evidence.push(`年龄:${age.evidence}`) }

  const build = firstHit(text, BUILDS)
  if (build) { out.build = build.value; out.evidence.push(`体型:${build.evidence}`) }

  const roles = allHits(text, ROLES)
  if (roles.values.length) {
    out.role = [...new Set(roles.values.flat())]
    out.evidence.push(`身份:${roles.evidence.join('/')}`)
  }

  const headwear = allHits(text, HEADWEAR)
  if (headwear.values.length) {
    out.headwear = [...new Set(headwear.values.flat())]
    out.evidence.push(`头饰:${headwear.evidence.join('/')}`)
  }

  if (BEARD_RE.test(text)) {
    out.beard = true
    out.evidence.push('胡须')
  }

  if (SKIRT_RE.test(text)) {
    out.skirt = true
    out.evidence.push('裙装')
  }

  // 性别：显式字段优先，否则从文本里找
  const g = (input.gender || '').toLowerCase()
  if (/女|female|woman|girl/.test(g)) out.gender = 'female'
  else if (/男|male|man|boy/.test(g)) out.gender = 'male'
  else if (/她|少女|女子|女士|女王|女仆|she\b|her\b/i.test(text)) out.gender = 'female'
  else if (/他|少年|男子|先生|国王|butler\b|he\b|his\b/i.test(text)) out.gender = 'male'

  // 老者优先：年龄特征往往比性别更能决定头部部件
  if (out.age === 'elder' && !out.gender) out.gender = 'male'

  return out
}

/** LPC 调色板名解析：把"语义色"映射到调色板里实际存在的名字 */
export interface PaletteLookup {
  (material: Material): string[]
}

/**
 * 把语义颜色名解析为调色板里真实存在的名字。
 *
 * 调色板里的命名不完全统一（black / dark_brown / blonde…），
 * 所以这里用"包含匹配 + 候选顺序"来找，而不是硬编码一一对应 ——
 * 万一上游调色板改了名字，也只会退化成"找不到就用随机"，不会崩。
 */
export function resolvePaletteName(
  want: string | undefined,
  available: string[]
): string | undefined {
  if (!want) return undefined
  // 两侧都要转小写：available 转了但 want 没转的话，'BLACK' 就匹配不上 'black'
  const w = want.toLowerCase()
  const lower = available.map(a => a.toLowerCase())

  // 1. 精确
  const exact = lower.indexOf(w)
  if (exact >= 0) return available[exact]

  // 2. 语义色的候选顺序（第一个命中的就用）
  /*
    ⚠️ 候选名要对应**调色板里真实存在的名字**（见 palettes.json）：
      hair: 26 个  body: 22 个  cloth: 24 个  eye: 8 个
    第一版我写了 olive 之类的名字，而 body 调色板里其实是 taupe —— 找不到就退化成随机，
    于是"健康的小麦色皮肤"变成随便一个肤色。
  */
  const ALIASES: Record<string, string[]> = {
    black: ['black', 'raven', 'charcoal'],
    dark_brown: ['dark_brown', 'chestnut', 'light_brown', 'brown'],
    brown: ['brown', 'chestnut', 'light_brown', 'walnut'],
    blonde: ['blonde', 'sandy', 'gold', 'yellow'],
    silver: ['silver', 'white', 'gray', 'platinum', 'ash'],
    red: ['red', 'redhead', 'ginger', 'maroon'],
    orange: ['orange', 'carrot', 'ginger'],
    blue: ['blue', 'navy', 'sky', 'teal'],
    green: ['green', 'forest', 'bright_green', 'dark_green'],
    purple: ['purple', 'violet', 'lavender'],
    pink: ['pink', 'rose'],
    // 肤色：body 调色板用的是 light / amber / olive / taupe / bronze / brown / black
    light: ['light', 'pale_green'],
    olive: ['olive', 'taupe', 'amber'],
    dark: ['black', 'brown', 'bronze'],
    grey: ['taupe', 'gray', 'slate'],
    white: ['white', 'light'],
    navy: ['navy', 'blue'],
    gold: ['gold', 'yellow', 'amber'],
    yellow: ['yellow', 'gold'],
    gray: ['gray', 'slate', 'charcoal'],
    teal: ['teal', 'sky', 'blue'],
    sky: ['sky', 'teal'],
    maroon: ['maroon', 'red'],
    lavender: ['lavender', 'purple'],
    forest: ['forest', 'green'],
    charcoal: ['charcoal', 'gray'],
    slate: ['slate', 'gray'],
  }
  const cands = ALIASES[w] || [w]
  for (const c of cands) {
    const i = lower.findIndex(n => n === c)
    if (i >= 0) return available[i]
  }
  for (const c of cands) {
    const i = lower.findIndex(n => n.includes(c))
    if (i >= 0) return available[i]
  }
  return undefined
}
