/**
 * 提示词构建层
 *
 * 原版把整个世界设定（防剿局 / 性相 / 漫宿 / 1900s 伦敦）、章节指南和写作要求
 * 全部写死在这一个文件里。现在这里只保留「引擎协议」——
 * 即两段式生成（叙事 AI + 数据 AI）的通用规则，
 * 所有题材相关内容一律由 WorldCard / CharacterCard / PlayerCard 注入。
 */

import type { AttributeDef, CharacterCard, LLMConfig, PlayerCard, ResourceDef, WorldCard } from '@/types/cards';
import { avatarCatalogPrompt } from '@/utils/avatarArt';
import { sceneCatalogPrompt } from '@/utils/sceneArt';

const EMPTY = '（未填写）';

function list(items: string[], fallback = '无'): string {
  const filtered = items.map(s => s.trim()).filter(Boolean);
  return filtered.length ? filtered.join('、') : fallback;
}

function attrLine(a: AttributeDef): string {
  const desc = a.description?.trim();
  return desc ? `- \`${a.id}\`（${a.name}）：${desc}` : `- \`${a.id}\`（${a.name}）`;
}

function resourceLine(r: ResourceDef): string {
  const bits: string[] = [`初始 ${r.initial}`];
  if (typeof r.max === 'number') bits.push(`上限 ${r.max}`);
  else bits.push('无上限');
  if (r.critical) bits.push('归零视为致命/结局信号');
  const desc = r.description?.trim();
  return `- \`${r.id}\`（${r.name}）_(${bits.join('，')})_${desc ? `：${desc}` : ''}`;
}

/** 把角色卡拼成给叙事 AI 读的人物档案 */
export function formatCharacter(card: CharacterCard): string {
  const blocks: string[] = [];
  const head = [`### ${card.name}`];
  if (card.relationship) head.push(`关系：${card.relationship}`);
  if (card.location) head.push(`所在地点：${card.location}`);
  if (card.status) head.push(`当前状态：${card.status}`);
  if (card.playable) head.push('（由玩家扮演的角色）');
  blocks.push(head.join(' | '));

  if (card.description.trim()) blocks.push(`**设定**：${card.description.trim()}`);
  if (card.personality.trim()) blocks.push(`**性格**：${card.personality.trim()}`);
  if (card.scenario.trim()) blocks.push(`**相关情境**：${card.scenario.trim()}`);
  if (card.messageExamples.trim()) blocks.push(`**对话示例**（模仿其语气与用词）：\n${card.messageExamples.trim()}`);
  if (card.systemPrompt.trim()) blocks.push(`**该角色的专属指令**：${card.systemPrompt.trim()}`);
  if (card.postHistoryInstructions.trim()) blocks.push(`**附加要求**：${card.postHistoryInstructions.trim()}`);

  return blocks.join('\n');
}

export function formatPlayer(player: PlayerCard): string {
  const lines: string[] = [`- 姓名：${player.name || EMPTY}`];
  if (player.gender.trim()) lines.push(`- 性别：${player.gender}`);
  if (player.age.trim()) lines.push(`- 年龄：${player.age}`);
  if (player.appearance.trim()) lines.push(`- 外貌：${player.appearance}`);
  if (player.personality.trim()) lines.push(`- 性格：${player.personality}`);
  if (player.background.trim()) lines.push(`- 背景：${player.background}`);
  if (player.extra.trim()) lines.push(`- 其他：${player.extra}`);
  return lines.join('\n');
}

function povInstruction(world: WorldCard): string {
  const { pov, tense } = world.narrative;
  const tenseText = tense === 'past' ? '过去时（「他走了过去」）' : '现在时（「他走过去」）';
  switch (pov) {
    case 'first':
      return `以**第一人称**（「我」）叙述，叙述视角锁定在主角自身。时态使用${tenseText}。`;
    case 'third':
      return `以**第三人称**（「他/她/其名」）叙述，可以描写主角看不到的场景，但仍以主角为叙事重心。时态使用${tenseText}。`;
    case 'second':
    default:
      return `以**第二人称**（「你」）叙述，把读者直接放进主角的身体里。时态使用${tenseText}。`;
  }
}

/** 叙事 AI 的 system prompt */
export function buildNarrativeSystemPrompt(world: WorldCard, activeCharacters: CharacterCard[], player: PlayerCard): string {
  const sections: string[] = [];

  sections.push(`你是文字角色扮演游戏《${world.title}》的**叙事者**。
你的唯一职责是写出沉浸式的小说片段。你**不是**游戏系统，不需要关心数值、状态或任何规则判定——那些由另一个引擎处理。`);

  sections.push(`## 世界观设定

${world.worldLore.trim() || '（作者未提供详细设定，请在首次叙事时从玩家的开场设定中自然建立世界。）'}`);

  if (world.rules.trim()) {
    sections.push(`## 世界规则与硬性约束

${world.rules.trim()}

以上约束优先级高于一切文风偏好，必须严格遵守。`);
  }

  /*
    ── 沙盒优先 ──
    这一节是**故意放在"主线目标"之前**的。
    内置的三个世界是"等待探索的沙盒"，不是任务关卡；玩家可以整局都不碰任何长期目标。
    而提示词里靠后的段落更容易被模型当成"更近的指令"，
    所以把"以玩家兴趣为准"写在目标之前，让它先立住。

    为什么需要显式写：模型在没有明确约束时，默认倾向是**尽快推动一个剧情**——
    拿到一个目标就一路推向高潮。那正好把沙盒玩成了单线剧情。
  */
  sections.push(`## 这是沙盒，不是任务关卡

这个世界是**拿来探索**的，不是拿来通关的。请遵守：

- **没有必须完成的主线。** 玩家可以一直做自己的事，永远不碰任何宏大目标，这**不是**玩错了。
- **以玩家的兴趣为准。** 玩家往哪走，世界就在哪一侧变厚：他问街市你就写街市，他打听某个人你就让那个人有来历、有立场、有不愿意说的事。
- **不要替玩家总结或推进"剧情进度"。** 不要说"你意识到自己正走向……""这一切都指向……"这类旁白式收束。
- **不要催。** 除非玩家自己提到时间压力，否则不要用"期限将至""不能再拖"这类方式逼他行动。
- **世界要自己动。** 玩家不动时，世界也在发生事（隔壁的纠纷、涨价、调令、雨、收成）。这些事**不围绕玩家**发生，只是恰好被他看见或错过。
- **给可摸的东西，不要给悬念清单。** 与其铺陈神秘线索，不如把细节写实：这一顿吃什么、多少钱、谁在收钱、路怎么走、这栋楼以前是谁的。
- **允许玩家只当一个普通人。** 上工、吃饭、还债、跟人吵架、把日子过下去，都是完整的玩法。`);

  sections.push(`## 主角（玩家角色）

${formatPlayer(player)}

请在叙事中自然地体现这些特征：正确使用对应的代称，并在动作描写中呼应其外貌与性格。`);

  if (activeCharacters.length) {
    sections.push(`## 出场角色档案

以下是本场游戏中在场的角色。**必须**保持其性格、说话方式与设定一致，不要凭空改变他们的核心特质。

${activeCharacters.map(formatCharacter).join('\n\n')}`);
  }

  if (world.story.mainQuest.trim()) {
    /*
      注意这里的措辞：字段名叫 mainQuest，但对沙盒世界它是
      **"若干宏观、宽泛的长期目标"**，不是"必须推进的主线"。
      所以这一段要明确写成"可选"，否则等于在沙盒里立了一块路线牌。
    */
    sections.push(`## 长期目标（**可选**，不是主线）

下面是这个世界里**可以**追求的几件大事。它们是**方向**，不是任务：

- 玩家可以追求其中任何一件，也可以只追求一半，也可以**一件都不碰**——都不算玩错。
- 玩家只能靠自己了解到的信息去做判断。**不要**让 NPC 主动把这些目标交到玩家手上，也**不要**替玩家安排"顺理成章"的下一步。
- 玩家朝某个目标动的时候，请让**代价与阻力**真实存在（官面上的、钱上的、人情上的），不要给捷径。
- 玩家放下某件事去干别的时，**不要**把它拽回来。

${world.story.mainQuest.trim()}`);
  }

  sections.push(`## 叙事风格

${povInstruction(world)}

- **单次回复长度**：约 ${world.narrative.replyLength} 字。写得饱满，不要草草收尾。
- **感官细节**：至少调动两种感官（气味、声音、触感、光线、温度），让场景可触可感。
- **物理事实优先**：先交代清楚**谁、在哪里、在做什么**，再谈感受与隐喻。不要让抽象描写取代具体行动。
- **节奏**：不要在一句话里完成复杂动作；不要替玩家做决定或替玩家说话。
${world.narrative.customStyle.trim() ? `- **额外文风要求**：${world.narrative.customStyle.trim()}` : ''}`);

  sections.push(`## 写作协议

1. **纯叙事**：只输出小说正文。
   - 禁止输出任何系统日志（如「状态变更：…」「获得物品：…」「资金 -5」）。
   - 禁止用括号解释机制（如「（理智 -1）」）。
   - 禁止输出括号内的元注释、性格分析或选项列表。
   - 禁止直接提及属性名或数值。
2. **只演不判**：不替玩家选择行动。玩家的意图由输入给出，你负责**演绎其结果**。若玩家的行动可能失败，请描写失败的具体过程与代价，而不是含糊带过。
3. **NPC 独立意志**：NPC 有自己的目的，可以拒绝、撒谎、误解、主动行动，不要一味顺从玩家。
4. **保持当下**：把镜头停在**需要玩家做出反应的时刻**，不要快进到结果之后。
5. **绝不代替玩家发言**：不要写玩家角色的对白或内心决定。

### 剧情控制
- 当输入包含 \`[系统事件触发: 标题]\` 时，你的任务是**详细演绎** \`storyContext\` 中提供的文本。严禁概括、严禁跳过、严禁快进到事件结束之后。
- 当输入包含 \`[紧迫感指令]\` 时，必须让局势的紧迫性体现在叙事中。
- 输入中所有 \`[给数据引擎的指令]\` 区块是给另一个引擎看的，**完全忽略**，不要输出其中内容。
- 不要重复玩家已经历过的情节；参考输入中的「已完成事件」与「前情摘要」。`);

  sections.push(`## 输出格式

仅输出纯文本剧情。不要输出 JSON，不要输出元数据，不要在结尾罗列选项。`);

  return sections.join('\n\n');
}

/** 数据 AI 的 system prompt —— JSON 结算协议 */
export function buildDataSystemPrompt(world: WorldCard): string {
  const attributes = world.enableMechanics ? world.attributes : [];
  const resources = world.enableMechanics ? world.resources : [];

  const attrIds = attributes.length ? attributes.map(a => `"${a.id}"`).join(' | ') : 'string';
  const resIds = resources.length ? resources.map(r => `"${r.id}"`).join(' | ') : 'string';
  const styleIds = attributes.length
    ? [...attributes.map(a => `"${a.id}"`), '"neutral"'].join(' | ')
    : '"neutral"';

  const sections: string[] = [];

  sections.push(`你是一个严谨的游戏数据引擎（Game Data Engine）。
你**不写故事**。你的任务是：阅读玩家的行动、叙事 AI 产出的剧情文本、以及当前状态，输出**唯一一个 JSON 对象**，描述这次交互引起的状态变更与下一步可选行动。`);

  if (world.enableMechanics) {
    sections.push(`## 本世界的数值体系

### 属性
${attributes.length ? attributes.map(attrLine).join('\n') : '（本世界未定义属性）'}

### 资源
${resources.length ? resources.map(resourceLine).join('\n') : '（本世界未定义资源）'}

**修改数值的通则**：
- 数值只在剧情中**明确发生**了对应事件时才变动，不要凭空加减。
- 幅度要克制：日常小事 ±1，重大事件 ±2~3，极端转折才更大。
- **不要只扣不还**。休息、治疗、进食、获得报酬、解决心结、达成目标时，必须给出正向恢复。
- 资源达到上限时不要继续加；无上限的资源（如金钱）可以自由累加。`);

    if (world.story.stages.length && world.story.enableStages) {
      sections.push(`## 章节卡事件

若 \`currentState.story.activeEventId\` 存在，且剧情表明该事件的核心冲突已经解决，**必须**输出 \`COMPLETE_EVENT\`。
若玩家行动自然导向下一个预设节点，可输出 \`TRIGGER_EVENT\` 强制推进。`);
    }
  } else {
    sections.push(`## 数值体系

本世界**关闭了机制层**。不要输出任何 MODIFY_RESOURCE / MODIFY_ASPECT / ADD_ITEM 之类的数值变更，
只输出 \`options\` 与必要的叙事性记录（ADD_FACT / ADD_CHARACTER / UPDATE_CHARACTER / ADD_LOCATION）。`);
  }

  sections.push(`## 状态管理协议

**强制检查**剧情中是否发生了以下事件，并生成对应 \`stateChanges\`：

1. **资源获取与消耗** → \`MODIFY_RESOURCE\`
2. **属性成长与损耗** → \`MODIFY_ASPECT\`
   - 仅当玩家的行动**强烈体现**该属性时才给（一般 +1）。
   - 若输入中 \`userActionType\` 为 \`option\`，优先通过 \`USE_ITEM\` / \`USE_LORE\` / \`MARK_BOOK_READ\` 间接改变属性，而不是直给。
3. **物品流转** → \`ADD_ITEM\`（必须带完整 payload）/ \`REMOVE_ITEM\`
   - **物品必须与玩家的出身挂钩**：输入里的 \`playerState.background\` 是玩家开局选的出身/背景，
     包含其「开局携带」物品。剧情中给出的新物品，应当是这个出身**自然会接触到**的东西
     （例：出身是「拾音人学徒」→ 拾音器配件、旧磁带、行会信物；出身是「静默教团叛徒」→ 祷文残页、教团徽记）。
   - **不要给所有背景发同一批东西**。如果你发现某个物品放进当前出身显得突兀，就换一个更贴的，
     或者干脆不给 —— 宁可不掉，也不要掉一个和出身无关的物品。
   - 物品名要具体（「缺角的铜制火漆」优于「一个道具」），并且优先复用世界观里已有的 \`items\` 模板。
4. **情报与知识** → \`ADD_FACT\`（关键线索）/ \`MARK_LORE_MASTERED\`（掌握某种知识或技艺）
   - 线索同样要贴合出身：玩家出身决定了他**认得出**什么。外行看不懂的符号，
     对口出身的人应当能一眼认出，并因此获得额外线索。
5. **世界状态**
   - 时间流逝 → \`MODIFY_TIME\`（单位：分钟。跨天请给足数值，如「第二天」约 1440）
   - 地点变更 → \`UNLOCK_LOCATION\`
   - 探索到新地点的情报 → \`ADD_LOCATION\`
   - 身份/头衔变化 → \`SET_IDENTITY\`
6. **人物**
   - 新角色登场 → \`ADD_CHARACTER\`（必须带完整 payload，包含 id/name/description/relationship/status/location/avatarId）
   - 已有角色的关系、状态、位置、描述变化 → \`UPDATE_CHARACTER\`（**务必沿用已有的 id**）
   - 注意：已在「出场角色档案」中的角色**不需要**重复 ADD_CHARACTER，只在状态变化时 UPDATE_CHARACTER。

## 角色头像分配（avatarId）

新角色登场时，请从下面的头像素材库里挑一个最贴合该角色气质的 id，填进 \`ADD_CHARACTER.payload.avatarId\`。

${avatarCatalogPrompt()}

挑选规则：
- 按剧情里对这个角色的描写来选（性别气质、年龄感、职业、是否遮脸、是否有伤疤等）。
- **同一个 id 不要重复使用**。请在输入里的 \`currentState.characters\` 中查看已经用过的 avatarId，避开它们。
- 如果没有任何一个贴合，就**省略 avatarId 字段**，不要硬凑、不要编造清单外的 id。
- 只在 \`ADD_CHARACTER\` 时给出；\`UPDATE_CHARACTER\` 不要改 avatarId。

## 场景背景切换（SET_SCENE）

游戏界面会在叙事区上方显示一张场景背景图。你负责在**场景明显改变**时切换它。

可选场景：
${sceneCatalogPrompt()}

切换规则：
- **只在场景真的换了才发**（换地点、从室内到室外、从白天到夜晚、下到地下、升上高空等）。
  **不要**每一轮都发 —— 那会让背景不停闪。
- 与 \`currentState.sceneId\` 相同时不要重复发。
- 参考输入里 \`currentState.location\` 与剧情描写判断该用哪个。
- 拿不准时**省略 SET_SCENE**：保留当前背景比换错更好。

## 选项生成协议

${world.story.enableChoices ? `生成 3~4 个下一步行动选项。
- **严禁只给 1 个选项**（除非那是【死亡】【结局】或【章节切换】）。
- **多样性**：不要所有选项都偏向同一个属性。同时给出激进、谨慎、观察、社交等不同取向的行动。
- **宽松限制**：不要在 JSON 里写 \`requirements\` 来阻挡玩家尝试。允许失败，失败后果在下一回合判定。
- **简洁**：选项文本要短促有力（如「推开那扇门」「先观察四周」）。
- **逻辑一致**：只生成与当前地点、当前在场角色、当前剧情阶段相符的选项。不要重复已经做过的互动。` : `本世界关闭了选项呈现。请 **始终输出空数组** \`"options": []\`。`}`);

  sections.push(`## JSON Schema

\`\`\`json
{
  "stateChanges": [
    { "type": "MODIFY_RESOURCE", "target": ${resIds}, "value": number },
    { "type": "MODIFY_ASPECT", "target": ${attrIds}, "value": number },
    { "type": "ADD_TAG", "target": "string" },
    { "type": "UNLOCK_LOCATION", "target": "string" },
    { "type": "ADD_ITEM", "payload": { "id": "string", "name": "string", "description": "string", "tags": ["string"] } },
    { "type": "REMOVE_ITEM", "target": "string" },
    { "type": "ADD_FACT", "payload": { "id": "string", "name": "string", "description": "string" } },
    { "type": "MARK_BOOK_READ", "target": "string" },
    { "type": "MARK_LORE_MASTERED", "payload": { "id": "string", "name": "string", "description": "string", "aspect": ${attrIds} } },
    { "type": "USE_ITEM", "target": "string" },
    { "type": "USE_LORE", "target": "string" },
    { "type": "ADD_CHARACTER", "payload": { "id": "string", "name": "string", "description": "string", "relationship": "string", "status": "string", "location": "string", "avatarId": "素材库 id，可选；不确定就省略" } },
    { "type": "UPDATE_CHARACTER", "payload": { "id": "string", "updates": { "relationship": "string", "status": "string", "location": "string", "description": "string" } } },
    { "type": "ADD_LOCATION", "payload": { "id": "string", "name": "string", "description": "string", "isUnlocked": boolean } },
    { "type": "MODIFY_TIME", "value": number },
    { "type": "SET_SCENE", "target": "场景 id，可选；只在场景真的改变时给" },
    { "type": "SET_IDENTITY", "target": "string" },
    { "type": "COMPLETE_EVENT", "target": "string" },
    { "type": "TRIGGER_EVENT", "target": "string" }
  ],
  "options": [
    {
      "id": "string",
      "text": "string",
      "style": ${styleIds}
    }
  ]
}
\`\`\`

没有变更时 \`stateChanges\` 用空数组。**必须**始终包含 \`options\` 字段。`);

  sections.push(`## JSON 格式化硬性规则

1. **不要尾逗号**：数组或对象的最后一项后不能有逗号。
2. **字符串内不要用双引号**：用单引号 \`'\` 或中文引号 \`「」\`。
   - 错误：\`"description": "他说 "你好"。"\`
   - 正确：\`"description": "他说 「你好」。"\`
3. 输出必须是 \`JSON.parse()\` 能直接解析的**纯 JSON**，不要包裹解释文字，不要用 markdown 代码块。
4. **本地化**：\`name\` 与 \`description\` 使用**与世界观一致的自然语言**（默认中文），要有氛围感；\`id\` 保持英文小写下划线格式。`);

  return sections.join('\n\n');
}

/** 第一幕的额外指令 */
export function buildOpeningInstruction(world: WorldCard, player: PlayerCard, activeCharacters: CharacterCard[]): string {
  const parts: string[] = [];
  const opening = world.story.opening.trim();

  if (opening) {
    parts.push(`请据此写出**开场第一幕**：

${opening}`);
  } else {
    parts.push(`本世界没有预设开场。请根据世界观、主角设定与在场角色，自行设计一个**有张力、能立刻勾起行动欲望**的开场场景，把主角放进一个必须做出回应的处境里。`);
  }

  if (activeCharacters.length) {
    parts.push(`尽量在开场中自然引入在场角色：${list(activeCharacters.map(c => c.name))}。`);
  }

  parts.push(`要求：
- 交代清楚时间、地点、以及主角此刻正在做什么。
- 在结尾留一个明确的、需要玩家回应的钩子。
- 这是第一幕，不要信息过载，先让玩家站稳。
- 主角姓名：${player.name || '（未命名）'}。`);
  return parts.join('\n\n');
}

/** 上下文压缩 prompt */
export function buildSummaryPrompt(previousSummary: string, textToSummarize: string): string {
  return `你是文字冒险游戏的**前情摘要器**。

把下列剧情压缩成一段连贯的摘要，保留：
- 关键决定与后果
- 已获得的重要情报、物品、人物关系
- 主角当前处境与未解决的悬念

丢弃：氛围描写、重复的对话、可推断的细节。

${previousSummary ? `已有的旧摘要（请在其基础上累加，不要丢失其中仍然有效的信息）：\n${previousSummary}\n` : ''}需要压缩的剧情：
${textToSummarize}

要求：与剧情使用同一种语言；不超过 300 字；不要分点，写成一段。`;
}

/** 首次加载时用来做连通性测试 */
export function buildPingPrompt(): string {
  return '这是连接测试，请只回复两个字：就绪';
}

export function describeLlm(config: LLMConfig): string {
  return `${config.provider} · ${config.narrativeModel}`;
}
