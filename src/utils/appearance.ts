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
  /** 衣色（LPC cloth 调色板名）—— 描述里最靠前的那一种（通常是外衣） */
  cloth?: string
  /**
   * 描述里提到的**全部**衣色，按出现位置排序。
   *
   * 为什么要全部：NPC 描述常写「黑色燕尾服，纯白的衬衫」这类多色搭配，
   * 只取第一个会丢掉"白衬衫"，立绘就与描述不像。
   * 配方用它来挑打底层（外层深色 + 内层浅色，层次才对）。
   */
  clothAll?: string[]
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
 * ⚠️ 两条必须遵守的规则：
 *
 * 1) 每条都必须**明确指向头发**。第一版这里写了裸的 `/white hair|silver hair/`
 *    之类，结果「白手套上永远残留墨痕」里的 white 被当成发色，
 *    管家于是得到一头白发。凡是修饰"发"的规则，就不能匹配别的白色物件。
 *
 * 2) 描述里的发色常常不是标准色名 ——「浅亚麻色」「月白」「麦色」「栗棕」
 *    这类说法在中文角色卡里非常普遍。原先只认"金发/银发/棕发"这些标准词，
 *    于是大量角色推断不出颜色 → 退回随机 → 立绘与描述不符。
 *    下面用 `hairRe()` 把**程度修饰词**（浅/深/淡/暗/亮/银/亚麻/麦…）
 *    系统地组合进去，而不是逐个打补丁。
 */
const HAIR_NOUN = '(?:色)?(?:的)?(?:(?:长|短|直|卷|波浪|蓬松|细软|柔顺)的?)*(?:头发|发丝|长发|短发|卷发|发)'
/** 程度修饰词：允许出现在颜色词之前（"浅亚麻色长发"）或之后（"亚麻色浅发"） */
const DEG = '(?:浅|淡|深|暗|亮|浓|浅色|深色|亚麻|麦|麦色|银|灰|金|蜜|焦糖|奶茶)'
/**
 * 构造发色正则。
 * @param body 颜色主体（可能含多个同义说法，用 `|` 分隔）
 * @param withDeg 是否允许程度修饰词 —— 用于区分"浅X"与"X"对应不同调色板
 */
const hairRe = (body: string, withDeg = false) =>
  new RegExp(
    withDeg
      ? `${DEG}?(?:${body})${HAIR_NOUN}|${DEG}(?:${body})|(?:${body})${HAIR_NOUN}`
      : `(?:${body})${HAIR_NOUN}|(?:${body})`,
    'i'
  )

const ENGLISH_NOUN = 'hair'

const HAIR_COLORS: [RegExp, string][] = [
  // ── 浅色系（放在深色前面：颜色词的匹配顺序决定"浅X"不会被"X"抢走）──
  [new RegExp(`${DEG}?亚麻(?:色)?|亚麻${HAIR_NOUN}|(?:浅|淡)金|浅亚麻|flaxen|linen ${ENGLISH_NOUN}`, 'i'), 'sandy'],
  [new RegExp(`(?:浅|淡|亮)褐|浅棕|浅栗|焦糖|奶茶色|light brown ${ENGLISH_NOUN}`, 'i'), 'light_brown'],

  // ── 金 / 铂 ──
  /*
    ⚠️ 顺序规则：**具体色名必须排在泛化色名之前**。
    「草莓金」原本排在「金」后面，于是被 `金发` 先匹配成 blonde ——
    这类"被更泛的规则抢走"的问题会随着词表变大而变多，所以把
    有专名的（草莓金/铂金/麦金）统一放到最前面。
  */
  [new RegExp(`草莓(?:金|色)|strawberry`, 'i'), 'strawberry'],
  [new RegExp(`铂金|白金色?|(?:银白|霜白)金|platinum`, 'i'), 'platinum'],
  [new RegExp(`麦(?:色|浪|穗)|麦金色|wheat|honey ${ENGLISH_NOUN}`, 'i'), 'gold'],
  [new RegExp(`稻草色|干草色|straw`, 'i'), 'sandy'],
  [new RegExp(`金${HAIR_NOUN}|金发|(?:金|蜜)色(?:的)?${HAIR_NOUN}|黄金|blond|blonde|golden ${ENGLISH_NOUN}`, 'i'), 'blonde'],

  // ── 银 / 白 / 灰 ──
  [new RegExp(`银${HAIR_NOUN}|银发|银白|霜白|月白|银丝|silver|white ${ENGLISH_NOUN}|grey ${ENGLISH_NOUN}|gray ${ENGLISH_NOUN}`, 'i'), 'silver'],
  [new RegExp(`花白|灰白|斑白|salt.?and.?pepper`, 'i'), 'silver'],
  [new RegExp(`炭灰|烟灰|深灰${HAIR_NOUN}|charcoal ${ENGLISH_NOUN}`, 'i'), 'dark_gray'],
  [new RegExp(`灰${HAIR_NOUN}|灰发| ash ${ENGLISH_NOUN}|grey|gray`, 'i'), 'gray'],
  [new RegExp(`灰烬色|ash(?:en)?`, 'i'), 'ash'],
  [new RegExp(`纯白|雪白|素白|white`, 'i'), 'white'],

  // ── 黑 ──
  [new RegExp(`乌黑|漆黑|墨黑|墨色|纯黑|鸦羽|raven|jet.?black|black ${ENGLISH_NOUN}`, 'i'), 'raven'],
  [new RegExp(`黑${HAIR_NOUN}|黑发|黑色(?:的)?${HAIR_NOUN}|black`, 'i'), 'black'],

  // ── 棕 / 褐 / 栗 ──
  [new RegExp(`栗色|栗棕|板栗|chestnut|maroon ${ENGLISH_NOUN}`, 'i'), 'chestnut'],
  [new RegExp(`(?:深|暗)棕|深褐|咖啡色|巧克力色|dark brown|espresso`, 'i'), 'dark_brown'],
  [new RegExp(`棕${HAIR_NOUN}|棕发|褐色${HAIR_NOUN}|褐发|茶色|蜜褐|brown ${ENGLISH_NOUN}|brunette`, 'i'), 'brown'],

  // ── 红 / 橙 ──
  [new RegExp(`姜红|姜黄|ginger|carrot|cinnamon`, 'i'), 'ginger'],
  [new RegExp(`酒红|暗红|赤褐|auburn`, 'i'), 'redhead'],
  [new RegExp(`红${HAIR_NOUN}|红发|赤发|火红|绯红|red ${ENGLISH_NOUN}|redhead`, 'i'), 'red'],
  [new RegExp(`橙${HAIR_NOUN}|橘${HAIR_NOUN}|橙色|橘色|orange ${ENGLISH_NOUN}`, 'i'), 'orange'],

  // ── 其他 ──
  [hairRe('蓝|靛蓝|海蓝|藏青|blue|navy'), 'blue'],
  [hairRe('绿|翠绿|墨绿|green'), 'green'],
  [hairRe('紫|紫罗兰|薰衣草|violet|purple|lavender'), 'purple'],
  [hairRe('粉|桃粉|樱花|rose|pink'), 'pink'],
  [new RegExp(`玫瑰色|玫红`, 'i'), 'rose'],
]

/**
 * 发型关键词。**按优先级排列：越靠前越先被采用。**
 *
 * ⚠️ 两条踩过的坑：
 *
 * 1) 原来写的是 `利落.*发` —— `.*` 会**跨越整个句子**。管家描述是
 *    「他有着一头乌黑锃亮的长发……利落地向后束成一条及腰的马尾」，
 *    "利落" 与句首的 "发" 被 `.*` 连起来，于是判定成"短发"；
 *    而库里没有 `hair_short*`，回退随机时**拿到了光头部件** ——
 *    玩家看到的是一个秃头管家。
 *    修法：用 `[^。；，\n]{0,6}` 限定距离，绝不让 `.*` 跨句。
 *
 * 2) 原先只取**第一个命中**的发型项，所以"长发"（命中及腰）会被排在
 *    更前面的"短发"（误命中）覆盖。现在由调用方收集全部并按本表顺序
 *    保留优先级：具体款式（马尾/发髻）优先于泛泛的"短发"。
 */
const HAIR_STYLES: [RegExp, string[]][] = [
  [/双马尾|twin.?tail|pigtail/i, ['pig', 'ponytail', 'bangs']],
  [/马尾|ponytail|束成|扎成/i, ['ponytail', 'long', 'bob']],
  [/发髻|盘发|丸子头|bun|updo/i, ['topknot', 'bun', 'updo']],
  [/光头|秃顶|bald|shaven head/i, ['bald', 'balding']],
  [/长直发|直发|长直|straight hair/i, ['long', 'long_straight', 'relm_xlong']],
  [/长发|披肩|垂至|及腰|long hair/i, ['long', 'ponytail', 'bangslong', 'relm_xlong']],
  [/卷发|波浪|卷曲|curly|wavy/i, ['curly', 'wavy', 'long']],
  [/脏辫|辫子|braid|dreadlock/i, ['braid', 'dread', 'long']],
  [/刘海|齐刘海|bangs|fringe/i, ['bangs', 'bangsshort', 'bangslong']],
  [/爆炸头|蓬松[^。；，\n]{0,4}发|afro/i, ['afro', 'curly']],
  [/莫西干|mohawk/i, ['mohawk']],
  [/蓬乱|凌乱|乱蓬|未打理|unkempt|messy|bedhead/i, ['bedhead', 'messy', 'long']],
  [/短寸|寸头|板寸|buzz/i, ['buzz', 'balding']],
  // 「短发」放最后：它是兜底描述，具体款式应当优先（见上面坑 2）
  [/短发|short hair|利落[^。；，\n]{0,4}发|干练[^。；，\n]{0,4}发/i, ['short', 'bangs', 'bob']],
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
/**
 * 衣物名词 —— 出现在颜色之后（可隔着"的"）。
 *
 * 抽出来是因为原来的模式写成 `白(色|衣|袍|裙|衫|服|斗篷|披风)`：
 * 这种"颜色字 + 单字衣物"的写法匹配不了**双字衣物名**，
 * 于是「纯白的衬衫」「黑色的燕尾服」全都漏掉 ——
 * 玩家反馈的"立绘与描述不像"有一部分就是这里漏的。
 * （之前只补过"长裙"这一个特例，属于打补丁而不是修根因。）
 */
const GARMENT = '(?:色)?(?:的)?(?:长|短|厚|薄)?' +
  '(?:衣|袍|裙|衫|服|甲|斗篷|披风|外套|大衣|风衣|正装|礼服|燕尾服|衬衫|衬衣|上衣|' +
  '马甲|背心|制服|军装|长袍|罩袍|围裙|皮甲|铠甲|胸甲|锁甲|板甲|和服|浴衣|旗袍|' +
  'tunic|shirt|coat|cloak|robe|armou?r|jacket|vest|dress|skirt)'

const clothRe = (color: string) => new RegExp(`${color}${GARMENT}|${color}`, 'i')

const CLOTH_COLORS: [RegExp, string][] = [
  [new RegExp(`(?:白${GARMENT}|纯白|素白|皎白|雪白|银白|white\\b)`, 'i'), 'white'],
  [new RegExp(`(?:黑${GARMENT}|玄色|墨色|漆黑|乌黑|black\\b)`, 'i'), 'black'],
  [new RegExp(`(?:灰${GARMENT}|灰袍|grey\\b|gray\\b)`, 'i'), 'gray'],
  [/深蓝|藏青|靛蓝|navy|dark blue/i, 'navy'],
  [clothRe('蓝'), 'blue'],
  [clothRe('红'), 'red'],
  [/酒红|暗红|栗红|maroon|burgundy/i, 'maroon'],
  [clothRe('绿'), 'green'],
  [/森林绿|深绿|forest green/i, 'forest'],
  [/棕(?:色)?(?:的)?(?:衣|袍|裙|衫|服|甲|外套|大衣)|褐色|皮革|皮甲|皮衣|brown\b|leather/i, 'brown'],
  [clothRe('紫'), 'purple'],
  [/薰衣草|淡紫|lavender/i, 'lavender'],
  [clothRe('粉'), 'pink'],
  [/金(?:色)?(?:的)?(?:袍|衣|甲|冠)|金黄|gold\b/i, 'yellow'],
  [new RegExp(`(?:黄${GARMENT}|土黄|yellow\\b)`, 'i'), 'yellow'],
  [new RegExp(`(?:橙${GARMENT}|orange\\b)`, 'i'), 'orange'],
  [new RegExp(`(?:青${GARMENT}|蓝绿|teal\\b)`, 'i'), 'teal'],
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
 * 按**在原文里出现的位置**收集命中项。
 *
 * 与 `allHits` 的区别：那个按词表顺序返回，这个按文本顺序。
 * 对衣色很重要 —— 「黑色燕尾服，纯白的衬衫」里黑色在前，
 * 它才是外衣（最显眼的那个）；按词表顺序可能先命中"白"，
 * 于是立绘给一件白外套，与描述正相反。
 */
function hitsInOrder<T>(text: string, table: [RegExp, T][]): { value: T; evidence: string; at: number }[] {
  const out: { value: T; evidence: string; at: number }[] = []
  for (const [re, value] of table) {
    // 用全局匹配找出该模式在文本里最早的位置
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
    const m = g.exec(text)
    if (m) out.push({ value, evidence: m[0], at: m.index })
  }
  return out.sort((a, b) => a.at - b.at)
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

  /*
    衣色：**收集全部**，不只取第一个。
    描述里常常写了多种颜色（「黑色燕尾服，纯白的衬衫」「棕色皮甲配绿色束腰」），
    只取第一个会丢掉后面的信息 —— 那正是"立绘和描述不像"的常见原因。
    按出现位置排序，`cloth` 取最靠前的（通常是外衣，最显眼），
    其余放进 `clothAll` 供配方挑打底层。
  */
  const clothHits = hitsInOrder(text, CLOTH_COLORS)
  if (clothHits.length) {
    out.cloth = clothHits[0].value
    out.clothAll = [...new Set(clothHits.map(h => h.value))]
    out.evidence.push(`衣色:${clothHits.map(h => h.evidence).join('/')}`)
  }

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
