import type { WorldCard } from '@/types/cards'
import { EXTRA_BUILTIN_WORLDS } from '@/data/builtinWorldsExtra'

/**
 * 内置示例世界卡
 *
 * 这些不是「官方设定」，而是三个**完全不同题材**的演示样本，
 * 用来证明引擎本身不再绑定任何特定世界观：
 *  - 灰烬回响：暗黑奇幻（自定义 5 属性 + 3 资源 + 2 个章节卡事件）
 *  - 霓虹雨季：赛博朋克（4 属性，风格更冷硬）
 *  - 星海拾遗：太空歌剧（关闭机制层 → 退化成纯叙事角色扮演）
 *
 * 玩家可以任意复制、修改它们，或全部删除后从零写自己的世界观。
 */

const now = Date.now()

const ashenEcho: WorldCard = {
  id: 'builtin_ashen_echo',
  title: '灰烬回响',
  tagline: '在神明死后留下的废墟上，替死者把话说完',
  worldLore: `**世界背景**

三百年前，「共鸣纪元」在一场名为「大静默」的灾变中终结。维系世界的六座共鸣塔同时熄灭，从此天空被一层不落的灰云覆盖，太阳只剩下一个模糊的白斑。

灰烬从天上持续落下，像永远下不完的雪。

**共鸣**
少数人身上残留着塔的余韵，称为「共鸣者」。他们能在接触旧时代的遗物时，听见死者留下的最后一段情绪——不是语言，而是纯粹的痛、渴、恐惧或爱。共鸣者因此成为这个时代最被需要、也最被厌恶的人。

**势力**
- **拾音人**：游走在废墟间的共鸣者行会。表面上替人「读取」遗物以了却心愿，实际上靠贩卖死者的秘密牟利。
- **静默教团**：认为共鸣是亵渎，主张让所有遗物彻底沉默。他们烧毁遗物，也烧毁共鸣者。
- **塔务司**：旧秩序的残骸，一群固执的官僚，仍在登记早已不存在的六座塔的维护记录。

**日常**
城镇建在塔的阴影里。居民靠挖掘旧时代的金属与陶器为生，用「烛」作为货币——一种从灰里提炼的可燃晶石。夜里没人出门，因为灰里的东西会循着活人的呼吸聚集。`,
  rules: `1. **共鸣有代价**：每次使用共鸣读取遗物，都会让共鸣者暂时承受死者的情绪。这不是「扣血」那么简单，请具体描写它如何扭曲当事人的判断、语气和身体反应。
2. **死者不会说谎，但不会说全**：遗物里的情绪是真实的，但它只保留了临终那一刻。误解与拼凑是常态。
3. **灰是危险的**：长时间暴露在灰中会让人逐渐失声，最后连内心独白都消失。所有户外行动都应体现这一点。
4. **没有魔法**：这里没有火球与咒语。超自然仅限于「共鸣」，且永远是听觉与情绪层面的。
5. **称呼规范**：使用「共鸣者」「拾音人」「遗物」「烛」「灰」等本世界术语。不要出现现代科技词汇。`,
  attributes: [
    { id: 'force', name: '体魄', description: '体力、搏斗与承受痛苦的能力', color: '#ef4444' },
    { id: 'insight', name: '洞察', description: '推理、观察与解读线索的能力', color: '#3b82f6' },
    { id: 'resonance', name: '共鸣', description: '与遗物和死者情绪连接的天赋强度', color: '#a855f7' },
    { id: 'empathy', name: '共情', description: '理解、安抚与影响他人的能力', color: '#22c55e' },
    { id: 'stealth', name: '隐匿', description: '潜行、伪装与躲过危险的本事', color: '#64748b' }
  ],
  resources: [
    { id: 'health', name: '生命', description: '肉体能承受的伤害', initial: 6, max: 6, color: '#ef4444', critical: true },
    {
      id: 'spirit',
      name: '心神',
      description: '精神稳定度。归零后会被死者的情绪吞没，成为「空壳」',
      initial: 6,
      max: 6,
      color: '#a855f7',
      critical: true
    },
    { id: 'candle', name: '烛', description: '本世界的通货，由灰中提炼', initial: 8, color: '#eab308' }
  ],
  backgrounds: [
    {
      label: '来处',
      options: [
        {
          id: 'guild',
          title: '拾音人学徒',
          description: '你在行会长大，学会了如何在别人的悲痛里保持手稳。',
          attributeBonus: { resonance: 2, empathy: 1 },
          resourceBonus: { candle: 6 },
          startingItems: ['tuning_fork', 'worn_ledger']
        },
        {
          id: 'silent',
          title: '静默教团叛徒',
          description: '你曾亲手烧毁遗物。直到某件遗物喊出了你母亲的名字。',
          attributeBonus: { force: 1, stealth: 2 },
          startingItems: ['ash_mask', 'flint_knife']
        },
        {
          id: 'clerk',
          title: '塔务司文书',
          description: '你一辈子都在登记六座不存在的塔。你知道档案在说谎。',
          attributeBonus: { insight: 3 },
          resourceBonus: { candle: 12 },
          startingItems: ['tower_ledger']
        },
        {
          id: 'nobody',
          title: '灰里的野孩子',
          description: '没人教过你规矩。你在废墟里活到今天，靠的是跑得快。',
          attributeBonus: { stealth: 2, force: 1 },
          resourceBonus: { health: 1 }
        }
      ]
    },
    {
      label: '牵挂',
      options: [
        {
          id: 'promise',
          title: '一个没说完的承诺',
          description: '有人在你面前死了，而他最后一句话你至今没听懂。',
          attributeBonus: { resonance: 1, empathy: 1 },
          startingItems: ['cracked_locket']
        },
        {
          id: 'debt',
          title: '一笔还不清的债',
          description: '行会替你付过一次「静默费」。他们随时可以来收。',
          resourceBonus: { candle: 15 },
          attributeBonus: { insight: 1 }
        },
        {
          id: 'silence',
          title: '你怕自己会失声',
          description: '你已经连续三天在灰里待太久了。',
          resourceBonus: { spirit: -1 },
          attributeBonus: { stealth: 1, force: 1 }
        }
      ]
    }
  ],
  attributePoints: 4,
  items: [
    { id: 'tuning_fork', name: '歪掉的音叉', description: '敲响时不会发出声音，但共鸣者能感觉到它在「指方向」。', tags: ['tool', 'resonance'] },
    { id: 'worn_ledger', name: '磨破的登记册', description: '记着三十七个名字与他们的遗物。其中二十九个名字后面画了叉。', tags: ['tool', 'record'] },
    { id: 'ash_mask', name: '浸蜡的灰罩', description: '蒙住口鼻的粗布，浸过蜡，能挡一阵子灰。戴着说话很闷。', tags: ['tool', 'survival'] },
    { id: 'flint_knife', name: '燧石短刀', description: '刃口参差，但没有更好的了。', tags: ['weapon', 'force'] },
    { id: 'tower_ledger', name: '第六塔维护簿', description: '官方记录显示这座塔不存在。但这本簿子上的字迹是你上司的。', tags: ['clue', 'insight'] },
    { id: 'cracked_locket', name: '裂开的怀盒', description: '里面本该有张画像。现在只有一层薄灰，碰一下就会飘起来。', tags: ['keepsake', 'resonance'] }
  ],
  lores: [
    { id: 'lore_resonance_basics', name: '共鸣残响', description: '你学会了分辨遗物里情绪的「方向」——那是死者临终时刻面朝的地方。', attribute: 'resonance', level: 1 },
    { id: 'lore_ash_sickness', name: '失声症的三个阶段', description: '沙哑、忘词、内心无声。你知道自己现在在第几阶段。', attribute: 'insight', level: 1 }
  ],
  story: {
    opening:
      '开场设定在**灰港**，一座建在第三塔断裂基座上的城镇。时间是一个下着灰的傍晚。\n\n主角刚接下第一份正式委托：去城东的「慢钟旅店」取一件遗物——一只据说会自己变暖的铜铃，委托人是个不肯露面的老人。\n\n写作要点：\n- 先用几个细节把「灰」的质感写出来：落在肩上、钻进领口、在灯下像浮尘。\n- 让主角此刻**已经在路上**，而不是刚起床。\n- 在旅店门口安排一个不祥的预兆（比如门上的铃铛被人摘掉了）。\n- 结尾停在主角推门之前，等玩家决定怎么做。',
    mainQuest: '查清「会变暖的铜铃」到底录下了谁的最后时刻，以及为什么委托人宁可花掉全部积蓄也要拿到它。',
    enableStages: true,
    stages: [
      {
        id: 'stage_first_relic',
        title: '慢钟旅店的铜铃',
        chapterId: 1,
        isStatic: false,
        text: '旅店二楼最里间的门锁着，但门缝下渗出一线温热。老板说那间房三个月前就租给了一个「不爱说话的人」，之后再没人见他出来过。铜铃就在里面。',
        triggers: [{ type: 'chapter_start', chapterId: 1 }],
        options: [
          { id: 'break_in', text: '撞开房门', style: 'force' },
          { id: 'pick_lock', text: '撬锁进去', style: 'stealth' },
          { id: 'ask_owner', text: '先盘问旅店老板', style: 'empathy' },
          { id: 'listen', text: '贴在门上听里面的动静', style: 'insight' }
        ],
        onEnter: [
          { type: 'ADD_LOCATION', value: { id: 'slow_clock_inn', name: '慢钟旅店', description: '灰港东侧的老旅店，招牌上的钟停了很多年。', isUnlocked: true } }
        ]
      },
      {
        id: 'stage_silent_raid',
        title: '静默教团的火把',
        chapterId: 2,
        isStatic: false,
        text: '当夜，三条街外同时亮起火把。静默教团开始清街了——他们挨家挨户地搜遗物，然后烧掉。火把的路线正朝着主角藏身的地方收拢。',
        triggers: [{ type: 'has_item', itemId: 'cracked_locket' }],
        options: [
          { id: 'run', text: '带铃铛冲出去', style: 'stealth' },
          { id: 'hide', text: '把铃铛藏起来，装作普通人', style: 'insight' },
          { id: 'confront', text: '正面拦住他们', style: 'force' },
          { id: 'talk', text: '试着说服领队', style: 'empathy' }
        ],
        onEnter: [
          { type: 'MODIFY_RESOURCE', target: 'spirit', value: -1 }
        ]
      }
    ],
    enableChoices: true,
    urgencyAfterTurns: 4
  },
  narrative: {
    pov: 'second',
    tense: 'present',
    replyLength: 650,
    customStyle: '文风阴冷克制，多用具体感官细节，避免华丽辞藻。死亡要写得安静，而不是血腥。'
  },
  characters: [
    {
      id: 'char_vera',
      name: '薇拉·索恩',
      description:
        '拾音人行的资深成员，四十岁上下，右耳后面有一道旧烧伤。她说话时习惯先停顿半拍，像是在听什么。',
      personality:
        '务实、寡言、对情绪极度不信任。对新人表面上冷漠，实际上会偷偷替他们兜底。厌恶静默教团，但也厌恶行会里的贪婪。她坚信每个遗物都该被听完，然后放下。',
      scenario: '她受行会指派来确认主角是否「够格」。第一次见面时她并不友善。',
      firstMessage: '「你带了音叉？」她没抬头，「收起来。在这儿亮那玩意儿，等于在灰里点灯。」',
      messageExamples:
        '<START>\n{{user}}: 我该先做什么？\n{{char}}: 她终于看了你一眼。「先学会闭嘴。遗物不认嗓门大的。」\n<START>\n{{user}}: 你怕静默教团吗？\n{{char}}: 「怕。」她把烟摁灭在鞋底。「但更怕有一天我不再怕。」',
      creatorNotes: '本作为通用引擎的示例角色。',
      systemPrompt: '薇拉绝不主动解释自己的过去，被追问时用一句反问带过。',
      postHistoryInstructions: '',
      alternateGreetings: [],
      tags: ['拾音人', '导师', '示例'],
      creator: '内置示例',
      characterVersion: '1.0',
      present: true,
      location: '灰港',
      relationship: '行会前辈 / 观察者',
      status: '健康'
    },
    {
      id: 'char_kess',
      name: '凯斯',
      description: '慢钟旅店的老板，五十多岁，左手少了三根手指。他擦杯子的动作永远停不下来。',
      personality: '话多、胆小、贪财，但底线还在。他不愿意承认自己知道二楼那位房客的事。',
      scenario: '',
      firstMessage: '「住店？最后一间在二楼最里头。」他擦杯子的手顿了一下，「那间……有点热。」',
      messageExamples: '',
      creatorNotes: '',
      systemPrompt: '凯斯会不停绕圈子，除非被逼到墙角，否则不会承认自己收了封口费。',
      postHistoryInstructions: '',
      alternateGreetings: [],
      tags: ['旅店老板', 'NPC'],
      creator: '内置示例',
      characterVersion: '1.0',
      present: true,
      location: '灰港 · 慢钟旅店',
      relationship: '陌生人',
      status: '紧张'
    }
  ],
  enableMechanics: true,
  createdAt: now,
  updatedAt: now,
  builtin: true
}

/**
 * 给内置世界卡指定头像风格，让程序化生成的人物头像贴合各自题材。
 * 同一套几何造型在不同风格下观感差别很大，所以这三张题材完全不同的示例卡
 * 复用同一套生成算法也不会互相违和。
 */
const AVATAR_STYLE_BY_WORLD: Record<string, { style: WorldCard['avatarStyle']; tone: string }> = {
  builtin_ashen_echo: { style: 'ink', tone: '#f59e0b' },      // 暗黑奇幻：水墨 + 烛火橙
  builtin_neon_rain: { style: 'neon', tone: '#22d3ee' },      // 赛博朋克：霓虹 + 青
  builtin_star_drifter: { style: 'holo', tone: '#5eead4' },   // 太空歌剧：全息 + 荧绿
}

function withAvatarStyle(world: WorldCard): WorldCard {
  const preset = AVATAR_STYLE_BY_WORLD[world.id]
  if (!preset) return world
  return { ...world, avatarStyle: preset.style, avatarTone: preset.tone }
}

export const BUILTIN_WORLDS: WorldCard[] = [ashenEcho, ...EXTRA_BUILTIN_WORLDS].map(withAvatarStyle)

export default BUILTIN_WORLDS
