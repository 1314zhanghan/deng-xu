# 交接文档 · 灯叙（deng-xu）

> **给下一个会话的 AI**：这份文档是自包含的。读完它你应当能直接继续开发，
> 不需要回看任何历史对话。所有路径都是绝对路径，所有命令都可直接粘贴执行。
>
> 最后更新：2026-10-06（当前 HEAD `55ee31c`，工作区含本次未提交的走查工具修复）

---

## 1. 这个项目是什么

**灯叙**是一个**题材无关的 AI 文字冒险引擎**（改造自开源项目 `pale-notes`）。
玩家挑一张「世界卡」，设定自己的身份，然后由 AI 持续生成叙事。

- **线上地址**：https://fyjsj-zh.github.io/deng-xu/
- **仓库**：https://github.com/FyJsJ-ZH/deng-xu （public，GitHub Pages，source = `workflow`）
- **许可证**：GPL-3.0-only（**必须保持** —— 见第 8 节）
- **完全免费、不商用**（用户明确要求）

### 核心机制：两阶段 LLM 管线

```
玩家输入
   ↓
① 叙事 AI  → 生成散文（正文）
   ↓
② 数据 AI  → 生成 JSON（stateChanges + options）→ 应用到 store
```

这两个阶段在 `src/hooks/useGameEngine.ts` 里串起来。

---

## 2. 目录结构与两个副本

| 路径 | 说明 |
|---|---|
| `D:\工作区\pale-notes-web` | **主仓库**。git 仓库，推到 GitHub Pages。**所有开发在这里做** |
| `D:\工作区\pale-notes-local` | 本地部署副本。**不是 git 仓库**，只用于本地跑。改完主仓库后用 robocopy 同步过去 |
| `D:\工作区\.lpc\` | LPC 素材抓取/合并脚本（不参与构建） |
| `D:\工作区\.tools\` | git、git-home、watch-ci 等工具 |

**两个副本的 `src/` 必须字节一致**（用 robocopy `/MIR` 同步）。当前已验证一致。

### 关键源码位置

```
src/
├─ hooks/
│  ├─ useGameEngine.ts        # 两阶段管线、截断续写、错误处理
│  └─ useBackNavigation.ts    # 手机返回键层级（改过 5 版，见第 7 节）
├─ utils/
│  ├─ lpcSprite.ts            # 像素立绘合成器（LPC 部件 + 调色板换色）
│  ├─ appearance.ts           # 从角色描述推断外貌（词表都在这里）
│  ├─ rpgMap.ts               # RPG 俯瞰瓦片地图生成
│  ├─ mapPalette.ts           # 地图材质色 + 昼夜四档
│  ├─ sceneArt.ts             # 旧场景生成（仍被 CardEditor 用于封面）
│  ├─ worldTone.ts            # 四套世界色调
│  ├─ truncation.ts           # 截断检测
│  ├─ worldPack.ts            # 世界包导入导出
│  └─ recentPlays.ts          # 主菜单「最近玩过」
├─ stores/
│  ├─ game.ts                 # 玩家档案、属性、资源、物品、角色、时间
│  ├─ ui.ts                   # 浮层状态、LLM 配置、手机抽屉
│  ├─ nav.ts                  # 应用层级（返回键的基础）
│  ├─ library.ts              # 世界卡库
│  ├─ session.ts              # 当前会话（世界卡 + 玩家设定）
│  └─ meta.ts                 # 跨局元数据
├─ components/
│  ├─ StartScreen.tsx         # 首页（主菜单/卡片库/世界书 三层）
│  ├─ MainMenu.tsx            # 主菜单
│  ├─ WorldbookPreview.tsx    # 世界书只读预览
│  ├─ SessionSetup.tsx        # 选角（4 步）
│  ├─ App.tsx                 # 游戏主界面（在 src/App.tsx）
│  ├─ MobileTabBar.tsx        # 手机底栏
│  ├─ MobileSheet.tsx         # 手机面板抽屉
│  ├─ GlobalToast.tsx         # 全局提示（主菜单上也能看到）
│  ├─ SceneBackdrop.tsx       # 叙事区背景（RPG 地图 + 昼夜）
│  ├─ CharacterSprite.tsx     # 像素立绘组件
│  ├─ PortraitPanel.tsx       # 立绘详情（四方向）
│  └─ RelationshipPanel.tsx   # 人物关系（列表里是全身立绘）
├─ data/
│  ├─ builtinWorlds.ts        # 内置世界**聚合入口**（只做 import + 头像风格映射）
│  └─ worlds/                 # 三个深度世界（每个 ≥5 万字，见第 4.5 节）
│     ├─ _shared.ts           # char() 角色卡工厂 + 时间戳常量
│     ├─ deepcore.ts          # 深核集团·地渊之下
│     ├─ greatchen.ts         # 大晟会典
│     └─ westfantasy.ts       # 三邦纪年
└─ assets/lpc/
   ├─ runtime.json            # 246 个部件的元数据（由脚本生成，勿手改）
   ├─ palettes.json           # LPC 官方调色板
   └─ parts/*.png             # 246 个部件 PNG
```

---

## 3. 环境与命令（**必须照抄，否则会踩坑**）

### 工具链路径（本机没有全局 node/git/pnpm）

```powershell
$node = "C:\Users\28254\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
$pnpm = "C:\Users\28254\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs"
$git  = "D:\工作区\.tools\git\cmd\git.exe"
$gh   = "D:\工作区\.tools\git-home"
```

**pnpm 必须带 `--store-dir`**：

```powershell
& $node $pnpm install --store-dir "D:\工作区\.pnpm-store"
```

### git 需要显式 HOME（凭据存在 git-home）

```powershell
$env:HOME = $gh; $env:USERPROFILE = $gh; $env:GIT_CONFIG_GLOBAL = "$gh\.gitconfig"; $env:GIT_TERMINAL_PROMPT = "0"
Set-Location "D:\工作区\pale-notes-web"
& $git add -A; & $git commit -m "..."; & $git push origin main
```

### 测试与验证

```powershell
Set-Location "D:\工作区\pale-notes-web"
$node = "C:\Users\28254\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"

# 类型检查（必须 0 错误）
& $node "node_modules/typescript/bin/tsc" --noEmit -p tsconfig.json

# 单元测试（当前 239 条）
& $node "node_modules/vitest/vitest.mjs" run

# 完整构建（= pnpm build）
& $node "node_modules/typescript/bin/tsc"
& "node_modules/.bin/esbuild.cmd" "src/data/builtinWorlds.ts" --bundle --platform=node --format=esm --outfile=".check/worlds.mjs" --alias:@="./src" --log-level=error
& $node "scripts/gen-worldbook.mjs" "public" ".check/worlds.mjs"
& $node "scripts/gen-credits.mjs"
& $node "node_modules/vite/bin/vite.js" build
& $node "scripts/make-404.mjs"
```

### 浏览器走查（8 套 154 项）

需要一个 dev server 或 preview server 在 5199 端口：

```powershell
# 启动 dev server（后台）
Start-Process -FilePath $node -ArgumentList "node_modules/vite/bin/vite.js","--port","5199","--strictPort" -WorkingDirectory "D:\工作区\pale-notes-web" -WindowStyle Hidden
Start-Sleep -Seconds 16

# 跑全部走查
$env:SITE = "http://localhost:5199/"
& $node "scripts/checks/all.mjs"
```

**⚠️ 改完源码后必须重启 dev server**。Vite 的 HMR 对我通过 CDP 动态 import 的模块不生效，
我因此多次误判"改了没生效"，白排查很久。

---

## 4. 已完成的全部工作（46 项，见 ROADMAP.md）

`ROADMAP.md` 里有完整表格。这里只列**会影响你后续开发**的关键决定。

### 4.1 玩家反馈驱动修的问题（这些是真实痛点）

| 反馈 | 根因 | 修法 |
|---|---|---|
| 「没有返回主菜单」 | 按钮塞在 StatusPanel 最底部，手机端要滚过所有属性才看到 | 提取 `GameMenuActions`，桌面固定左栏底、手机固定菜单底 |
| 「主角立绘和上传头像多余」 | 主角立绘由名字随机生成，与描述无关 | **主角不设立绘**，用 `Compass` 图标占位 |
| 「手机底栏点了没反应」 | 抽屉遮罩 `fixed inset-0` **盖住底栏**，点击全落在遮罩上 | 底栏把自身高度写成 CSS 变量，抽屉 `bottom: var(--dx-tabbar-h)` |
| 「NPC 没有全身立绘」 | 关系面板里写死 `headOnly` | 改成 48×72 竖长全身；详情 254×320 + 四方向 |
| 「返回键直接退出浏览器」 | 层级与浏览器历史**没有一一对应** | 见第 7 节 |
| 「背景割裂且意义不明」 | 旧版是四层横向色块，无可辨认语义 | 改成 RPG 俯瞰瓦片地图 + 昼夜四档 |
| 「预设数值/物品没带进游戏」 | `resetGame()` 在写入**之后**执行，全清空了 | 移到 `beginSetup()`（进入选角前） |
| 男主穿裙子 | 按 `kind === 'legs'` 取池，而裙子 kind 也是 `legs` | 按 id 排除 `skirt`；`dress_*` 也从上衣池排除 |
| 角色露躯干 | 围裙/工装裤等"外层件"自己只画外层那一片 | 加打底层（`OUTER_LAYERS` → `BASE_SHIRTS`） |

### 4.2 像素立绘系统（`lpcSprite.ts`）

- **LPC 部件 246 个**（从 60 扩充来的），`FRAME_SIZE = 64`，idle 表 128×256（2 帧 × 4 方向）
- **换色用调色板 ramp**：`palettes.json` 里每种颜色是 6 级明暗
- **`RecolorSpec` 只有 4 个色**（hair/body/cloth/eye），**所有衣服共用 `cloth`** ——
  **做不到"外层黑、内层白"这种分别配色**（要改整个合成管线才能支持）
- 但 `torso_clothes_longsleeve_formal` 等部件**声明了空 `recolors`**，保持固有颜色，
  所以打底层能自然形成层次 —— 优先用这些
- **zPos 决定叠层顺序**，合成器已按 zPos 升序排序（`lpcSprite.ts` 约 604 行）
- **`headOnly`** 是裁头部（`HEAD_CROP = { x: 14, y: 2, size: 36 }`）

### 4.3 外貌推断（`appearance.ts`）—— NPC 贴合度的核心

**词表都在这个文件里**。改这里是提升 NPC 贴合度的主要手段。

```ts
HAIR_COLORS   // 发色（有序！具体色名必须在前）
HAIR_STYLES   // 发型（有序！具体款式在前，"短发"放最后）
SKINS         // 肤色（含种族推断）
CLOTH_COLORS  // 衣色（用 clothRe() 生成，别手写窄列表）
AGES          // 年龄（"老"要在"中年"之后 —— 先判很老的表述）
BUILDS        // 体型
ROLES         // 身份 → 衣着（关键词必须是真实存在的 id 片段！）
HEADWEAR      // 头饰
BEARD_RE / SKIRT_RE
```

**三条必须遵守的规则**（都是踩过坑总结的）：

1. **修饰外貌的词必须绑定对象**。裸的 `white` 会命中「白手套」、
   裸的 `银丝` 会命中「银丝眼镜框」→ 必须写 `白发` / `银发`。
2. **有序表的顺序就是优先级**，具体色名/款式名要放在泛化名之前
   （「草莓金」否则被「金」抢走、「马尾」否则被「短发」抢走）。
3. **`ROLES` / `HEADWEAR` 的关键词必须是素材库里真实存在的 id 片段**。
   写错**不报错、只是静默失效**（退化成随机）。有测试守着这一点。

**正则里的 `.*` 绝不能跨句** —— `利落.*发` 曾把「一头乌黑锃亮的长发……利落地向后束成马尾」
判成"短发"，而库里没有 `hair_short*`，回退随机后**拿到光头部件**（秃头管家）。
用 `[^。；，\n]{0,6}` 限定距离。

### 4.4 地图背景（`rpgMap.ts` + `mapPalette.ts`）

- 逻辑尺寸 **320×192**（20×12 格，每格 16px），`imageRendering: pixelated`
- **9 种地形 × 4 档时段 × 3 套布局**
- 时段分界在 `mapPalette.ts` 的 `dayPhase()`：
  `05–07 清晨 / 07–17 白天 / 17–20 黄昏 / 其余夜`
- **亮度已在测试里客观验证**：白天 110.7 > 黄昏 90 > 夜 71.6
- 夜间会**点亮窗户与路灯**（暖色光晕）—— 这是"时间感"的主要来源
- 瓦片贴图有缓存（`bank`），逐个格子现画会慢十几倍

### 4.5 内置世界（**6 个深度世界**）

> 演变：原先是 **9 个"广而浅"**的世界（每张世界观正文仅 444～1382 字，
> AI 撑不住二十轮就自己编世界）→ 整合为 **3 个深度世界** →
> 用户进一步要求"**必须向外扩展，不要五万字都堆砌在一个范围内**"，
> 于是三个世界各自向外扩展（补族裔/信仰/政体/活法），
> 并**举一反三新增三个世界**，共 6 个。

| id | 标题 | 题材 | 世界观正文 | 全卡中文字 | 角色 |
|---|---|---|---|---|---|
| `builtin_deepcore` | 深核集团·地渊之下 | 后末日反乌托邦巨型企业 | 52,401 | **72,680** | 9 |
| `builtin_greatchen` | 大晟会典 | 虚构中式古风王朝（**无超自然力量**） | 57,074 | **78,335** | 10 |
| `builtin_westfantasy` | 三邦纪年 | 经典西幻（三政体、13 族裔） | 68,075 | **87,145** | 13 |
| `builtin_oceanic` | 大洋纪年 | 大航海 / 海洋文明（无魔法） | 35,144 | **57,355** | 12 |
| `builtin_steam` | 蒸汽纪年 | 工业革命 / 蒸汽与钢铁（无魔法） | 36,436 | **60,731** | 13 |
| `builtin_bronze` | 青铜纪年 | 青铜时代 / 神话尚未退场 | 35,533 | **56,280** | 13 |

**源码布局**（`src/data/worlds/`）：

```
_shared.ts        # char() 角色卡工厂 + BUILTIN_TIMESTAMP（六世界共用）
deepcore.ts       # 深核集团·地渊之下     greatchen.ts   # 大晟会典
westfantasy.ts    # 三邦纪年              oceanic.ts     # 大洋纪年
steam.ts          # 蒸汽纪年              bronze.ts      # 青铜纪年
```
聚合入口仍是 `src/data/builtinWorlds.ts`（只做 import + 头像风格映射）。

#### 六个世界共用的设计法（**这是内容质量的关键，改内容时请遵守**）

1. **先立框架，再向下长** —— 每个世界先把"文明/族裔""意识形态""政体形态"
   "生活方式"各铺开 **7-8 种以上**，且彼此有结构性矛盾；**然后**只挑一两处
   写死具体的人、具体的钱、具体的规矩。
   反过来做（围着一个城市写五万字）就是用户批评的"堆砌细节而世界很窄"。
   例：三邦纪年有 **13 个族裔**、9 套信念、10 种政体、7 类活法；
   青铜纪年有 **18 个族裔**、17 套信仰、8 种政体、14 类活法。
2. **长期目标是模糊的大方向，不是任务** —— `story.mainQuest` 写 **8 个方向**，
   每个方向内部都容得下好人、坏人与中间人（可做能臣，也可做"狼子野心的奸臣"；
   可靠暴力或魅力开后宫；也可只想安稳过日子）。**不写期限、不写步骤。**
3. **明确留白** —— `rules` 里都有一条「世界比这更大」：已写的只是**下限**，
   没提到的部分允许按世界逻辑**自行合理扩展**，但不得引入禁用词；
   并明确「**不要因为设定里没写就说这里没有**」。
4. **沙盒优先** —— 都有一条独立的沙盒条款（不要催、没有必须做的事、
   世界自己动、允许玩家只当普通人）。配合 `constants/prompts.ts` 的
   「这是沙盒，不是任务关卡」一节。

**验收脚本**：`pnpm check:worlds` —— 两张表：
① 篇幅与结构（中文字数、worldLore、rules、角色/物品/lore 数量、
`startingItems`/`attributeBonus` 等**引用是否指向真实 id**、题材禁用词、
角色卡是否写清性别线索）；
② **沙盒内容**（地理/势力/生活三类各 ≥3000 字、长期目标 ≥700 字且不含
任务书措辞、rules 里必须有独立沙盒条款）。
门槛写死在脚本里，改内容后跑一遍就知道有没有退化。CI 已接入这一项。

**⚠️ 校验脚本自身的两个坑（都已修，但改脚本时要记得）**：
- 禁用词检查必须**先剪掉"禁令清单"所在的行**，并**放过"描述其不存在"的句子** ——
  否则"不得出现『数据』"这条规则会被自己举报，而"没有马镫"这种负责任的
  世界边界描写也会被判违规。
- 沙盒三类内容**只按行首 `**第X章 标题**` 切段，且标题词表要够宽**。
  第一版只认「舆图/势力/日常」几个词，于是三个新世界明明写了同类内容却全判 0 分；
  更糟的是第一版按"任意成对星号"切段，害得作者**删掉了正文里所有加粗**
  去迁就脚本 —— **校验器的缺陷反过来破坏了内容质量**，这是最不该发生的一类问题。

**⚠️ 动态 import 是硬要求**：三个世界的正文合计约 580 KB 源码。
`src/stores/library.ts` 里**必须**用
`await import('@/data/builtinWorlds')`（而不是静态 import）——
静态 import 会让主包从 472 KB 涨到 647 KB（gzip 198 → 408 KB），
手机上首屏要多下 200 KB。改成动态 import 后 Vite 自动拆成独立 chunk，
主包反而更小（431 KB / gzip 152 KB），且内置卡**只在首次运行时才需要**。

**每个世界都必须有**：术语表 + 禁止词汇 + 与题材匹配的机制 + 6 张以上角色卡
+ `startingItems` 指向真实物品 id。「写清什么不可能」比堆形容词更能防跑题。

**角色卡工厂**：`src/data/worlds/_shared.ts` 里的 `char()` 函数补默认值 ——
`CharacterCard` 有 9 个必填字段，手写 14 遍必然漏。

### 4.6 「我的主角」——提前设定主角（2026-10 新增）

**要解决的问题**：原先选好世界进选角后，**每一局都要从空白手填**名字、性别、
年龄、外貌、性格、背景，再逐槽选出身。玩第二局时几乎一模一样却要重填一遍。

**做法**：新增主角预设（`HeroPreset`），主菜单多了「我的主角」入口。

| 位置 | 作用 |
|---|---|
| 主菜单「我的主角」 | 新建/编辑/复制/删除主角档案 |
| 选角页顶部「用已设好的主角」 | 点一下把整份档案灌进表单（含出身与加点） |
| 选角页「存为我的主角」 | 填完就地存下来，下次任何世界开局都能套用 |

**四个关键设计决定**（都有理由，改之前请先看）：

1. **预设不绑定世界** —— 同一个主角可以拿去任何世界开局（"我每次都演同一个人"）。
2. **世界相关的选择另存一层**：`HeroPreset.choices = { default, byWorld }`。
   出身/际遇的**选项 id 是每个世界自己定义的**，拿 A 世界的选择去开 B 世界会
   选中一个不存在的选项 → 属性加成与开局物品取空。
   所以套用时**逐槽校验**（槽位名对得上、选项 id 在本世界真实存在），对不上退回默认。
   属性点同理，只认本世界定义过的属性且不超额度。见 `SessionSetup.resolveSeed`。
3. **存在独立的 kv 键 `heroPresets`**，与 `worlds` 分开 ——
   你清空卡片库、导入别人的世界包时，不会把设好的主角一起清掉。
   （测试里专门断言了"写预设不会碰 worlds 键"。）
4. **不复用 `CharacterCard`**：那个类型带 9 个 SillyTavern 兼容字段
   （firstMessage / systemPrompt / messageExamples…），塞主角档案会多出一堆
   永远为空的字段。所以新建了 `HeroPreset`。

**验证**：`src/stores/heroPresets.test.ts`（13 条存储层）+
`scripts/checks/heroes.mjs`（30 项端到端，含"刷新后仍在""换世界仍能套用"）。
两者都进了 `all.mjs` 与 CI。

### 4.6b 背景槽位与开场（2026-10 新增，**玩家的核心诉求**）

> 玩家原话：「游戏开场过于固定，且与背景槽位的关联性堪称没有 —— 不然选了半天
> 背景，发现还是一模一样的开场，很影响代入感。与此同时，**背景槽位也得像游戏目标
> 一样多元化**。」

#### 问题一：开场与背景的关系 —— **这里我改错过一次，务必看清**

玩家前后反馈了**两次**，两次的错法不同，第二次比第一次更根本：

**第一版（错法一）：开场写死，背景根本没进提示词。**
`buildOpeningInstruction(world, player, activeCharacters)` 压根收不到背景选择 ——
玩家挑的出身/际遇/秘密只被送进**结算阶段**（当掉落依据），与开场无关。

**第二版（错法二）：改成"同一场景 + 按背景换视角"，仍然不是沙盒。**
我加了 `openingByBackground`，让 272 个背景各自写一段"切入角度"。
但**场景骨架始终是同一个**（大晟是度支司值房、深核是第 41 层闸机队、
三邦是铁砧酒馆门口）。玩家原话：

> 我想要的是**同一个世界观里，各不相同的开场为各不相同的背景服务**，
> 而不是**一样的开场因不一样的背景而略有改变**。比如那个中式世界书，
> **这么多三六九等的人却在干同一个枯燥的工作**，这是完全背离了沙盒拓展玩法、
> AI 文字游戏高自由度、以及**主角可善可恶**的理念的。

他说得对：状元、节度使、盐枭、和尚、逃户全站在同一间屋里看同一本点验簿 ——
那不是沙盒，是同一个工位。

**最终版（正确做法）：开场处境本身就是一个可选槽位。**

1. **数据层**：
   - 新增 `StorySettings.openerSlot?: string` —— **哪个背景槽位决定"你在哪、在做什么"**；
   - 新增 `StorySettings.sceneByOption?: Record<槽位label, Record<选项id, 文本>>`
     —— 逐选项的**完整开场场景**；
   - **删除** `openingByBackground`（旧语义整体废弃）；
   - `story.opening` **降级为"兜底示例"**（只在没选处境 / 该处境没配场景时用）。
2. **引擎层**（`constants/prompts.ts` 的 `resolveOpeningScene` + `buildOpeningInstruction`）：
   - 命中 `openerSlot` 的那段场景 = **第一幕的唯一依据**；
   - ⚠️ **不再拼接 `story.opening`** —— 两段一起给，模型会把两幕揉成一幕；
   - 其余背景槽位**只用来加质感**，并写死一条禁令：
     「不要因为"他是商人"就把场景改成商号，因为"他是军人"就改成军营 ——
     **场景已经由开场处境定死了**」。
3. **内容层**：六个世界各新增一个 label 为 **`开局处境`** 的槽位（10 项），
   每项一段 **350–578 字的完整开场**（时间地点 + 正在做什么 + 有名有姓的在场者 +
   一件正在发生的麻烦 + 结尾钩子）。共 **60 段互不相同的第一幕**。

**⚠️ 一条必须守住的约束：处境 ≠ 道德立场。**
不要写"清廉的县官 / 贪酷的县官"，只写"在外任州县做官"。
他是善是恶由剧情与「官场立场」「信什么」这类槽位决定 ——
这正是玩家强调的「**主角可善可恶**」。校验脚本里也写了这条。

**UI 让它可见**：
- 选角页最后一步显示**所选处境的那整段开场**，并标注「换一个「开局处境」，第一幕就换一个地方」；
- 世界书预览新增「**开场：开局处境（N 种互不相同的开局）**」，把每一段都摊开供浏览。

#### 问题二：背景槽位太窄

原门槛是 `2 槽 / 每槽 3 选项` —— 等于没约束。现在六个世界共：

| 世界 | 槽位数 | 背景选项 | 开场槽位 | 互不相同的开场 |
|---|---|---|---|---|
| 深核集团·地渊之下 | 5（+开局处境） | 52 | 开局处境 | 10 |
| 大晟会典 | 6（+开局处境） | 67 | 开局处境 | 10 |
| 三邦纪年 | 5（+开局处境） | 50 | 开局处境 | 10 |
| 大洋纪年 | 5（+开局处境） | 50 | 开局处境 | 10 |
| 蒸汽纪年 | 6（+开局处境） | 63 | 开局处境 | 10 |
| 青铜纪年 | 5（+开局处境） | 50 | 开局处境 | 10 |
| **合计** | **31** | **332** | — | **60** |

每个槽位都刻意**容得下"不好"的活法**：做奸臣、做酷吏、做过线人、
烧过粮栈、把偷来的牛卖到三座城之外、铜铸神像蒙混过关、压过一份制动报告…
「多元」不只是在同类里多加几个，而是覆盖面拉开。

#### 校验（`check:worlds`，这些以前完全没人管）

- 槽位 ≥4、每槽选项 ≥8、每选项 description ≥100 汉字
- **必须有 `openerSlot`**，且该槽位的**每个选项**都有一段完整开场（≥260 汉字）
- **开场之间不得雷同**：二元组 Jaccard 相似度必须 **< 72%** ——
  这条专门用来抓"同一段换几个词"，是第二版错法的自动防线
- 槽位 `label` 与选项 `id` 不得重复（都是**对象 key**，重复会静默互相覆盖）
- `story.opening` 的长度门槛**分情况**：配了 `openerSlot` 只要求 ≥60 字（它是兜底），
  没配才要求 ≥1200 字。**门槛与设计打架时，错的是门槛** ——
  原先无条件要求 1200 字，逼得三个写对了（写短）的世界被判不达标
- 首轮这套门槛一次性抓出 **51 项**缺口，其中包括深核 `startingItems`
  指向 10+ 个未定义物品 id 的静默失效

**回归测试**：`src/constants/prompts.test.ts`（9 条）。最要紧的两条是
**「不同开局处境必须产出不同场景」**（而不是同一场景换词）与
**「其余背景只加质感、不得把场景挪走」** —— 分别对应上面两次错法。

### 4.7 主页四个入口各司其职

**原来的 bug**：主菜单「开始新游戏 / 世界书 / 卡片库」三个入口
**点进去是同一个界面** —— 因为三者都 push 了同一个 `{ name: 'library' }`：

```ts
onNewGame={() => navPush({ name: 'library', worldbookMode: false })}
onWorldbook={() => navPush({ name: 'library', worldbookMode: true })}
onLibrary={() => navPush({ name: 'library', worldbookMode: false })}   // ← 与 onNewGame 完全相同
```

现在 `View.library` 带 `intent: 'play' | 'worldbook' | 'library'`：

| 入口 | 标题 | 主按钮 |
|---|---|---|
| 开始新游戏 | 开始新游戏 | 「用这个世界开始」 |
| 我的主角 | 我的主角 | 「开局」→ 去选世界 |
| 世界书 | 世界书 | 「看详情」（只读设定集，不给开局入口） |
| 卡片库 | 卡片库 | 「看详情」+ 编辑/复制 |

**⚠️ `setup` 那一层也必须带 intent**。从选角按「返回卡库」时走的是
`nav.back()` → `history.back()`，那是**异步**的；而 `setSetupWorldId(null)`
是同步的。于是有一瞬间 **DOM 已经渲染成卡片墙、而 `nav.view` 还停在 setup** ——
这时若只读 `view.name === 'library'` 判断用途，就会拿到默认值，
**标题从「开始新游戏」错闪成「卡片库」**（实测就是这个现象）。
把 intent 存在 setup 自己身上就不依赖这个时序了。

`main-menu.mjs` 里补了一条断言专门盯这件事：
逐个点三个入口、比对 `h1` 标题必须互不相同。

### 4.8 主页四个入口各司其职 — 附：一个**未修复的既存缺陷**

> **先说结论：这不是本次改动引入的，我没有修，因为它不属于本次范围且没查透。**
>
> **现象**：**页面刷新（reload）之后，第一次按返回没有反应，要按第二次。**
> 不刷新时一次就退，行为正确。
>
> **复现**（`navdiag9.mjs` 的两种模式对比）：
> ```
> 单次加载（不 reload）：push heroes → history.back() → view=menu   ✓
> 加载后 reload        ：push heroes → history.back() → view=heroes ✗（被吃掉一次）
> ```
> 两种模式下 `history.state`、`view`、`stack` 起始状态**完全一致**，
> 唯一差别是中间有没有 reload。
>
> **已查明**：popstate 处理器**确实被调用**（`popEntered=1, popResult=ok`），
> 但它在最前面的 `if (allowExitRef.current) { allowExitRef.current = false; return }`
> 就返回了 —— 也就是说这个"放行退出"的一次性标记在 reload 之后**处于 true**。
> 已排除：不是浮层分支（portrait/apiKey/tutorial 全 false）、
> 不是 `backSilent` 返回 false（`stack.length=1`）、不是"再按一次退出"分支
> （`statusMessage` 为 null，说明没走到那里）。
>
> **试过但无效**：加"换层就失效"的守卫（记录竖旗时的层级，层级不同就不认旗）——
> 无效，已**完全还原**，没有留下未经验证的改动。
> 说明这个标记被置位的时机比我推断的更早或更隐蔽。
>
> **为什么没继续**：这是返回键逻辑的既存问题，而该逻辑作者自己标注过
> "被反馈了三次"，改动风险高；本次任务范围是"主角预设 + 主页入口去重"。
> 8 套既有走查（含专门的「返回键层级」）全部通过，说明常规路径没问题。
>
> **若要修**：建议下一步直接在该 hook 里把 `allowExitRef` 的值暴露到
> `window`（或在设置处 nudge 一个全局计数），实测它到底何时变 true；
> 不要靠推理。注意别用"刷新后按返回"这种流程去测它 —— 会很自然地被这个缺陷带偏。

---

## 5. 测试体系（**9 套走查** + **405** 单元测试 + 5 个独立工具）

```
scripts/
├─ see.mjs               # 【工具1】看一眼：一条命令截图 + 打印可读路径
├─ check-keywords.mjs    # 【工具3】词表 × 真实资源 全量校验（查静默失效）
├─ check-encoding.mjs    # 【工具5】乱码 / 非法 UTF-8 守卫
├─ check-tools-selftest.mjs  # 上面两个守卫的**污染测试**（证明它们真的会报警）
├─ render-offline.mjs    # 【工具4】离线渲染：不经浏览器直接出 PNG
│  └─ lib/
│     ├─ canvas-shim.mjs   # 最小 canvas + PNG 编解码（Node 用）
│     ├─ render-entry.ts   # 给 esbuild 的打包入口
│     └─ xcheck-offline.mjs # 离线 vs 浏览器 配方一致性对比
└─ checks/
   ├─ _browser.mjs        # 公共工具（Edge 自动探测、CDP 封装、outDir/profileDir）
   ├─ _ws-shim.mjs        # Node 20 的 WebSocket 兜底（CI 用它）
   ├─ all.mjs             # 【工具2】总入口：全套 / --only-failed / --list / 按名筛选
   ├─ main-menu.mjs       # 29 项
   ├─ playtest.mjs        # 34 项（新玩家首次游玩路径）
   ├─ error-paths.mjs     # 21 项（自带支持 CORS 的假服务商）
   ├─ mobile.mjs          # 19 项（真实手机视口 390×844）
   ├─ back-nav.mjs        # 21 项（返回键层级）
   ├─ map-gallery.mjs     # 7 项（地形×时段×布局 + 亮度递减）
   ├─ npc-fidelity.mjs    # 10 项（真实角色描述 → 对照图）
   ├─ npc-coverage.mjs    # 13 项（词表覆盖率诊断）
   └─ sprite-gallery.mjs  # 立绘对照图
```

### 五个工具怎么用（详见第 10.5 节）

| 命令 | 用途 |
|---|---|
| `pnpm see` | 截一张图并打印路径；`--fresh` 清存储、`--mobile` 手机视口 |
| `pnpm check:failed` | 只重跑上次失败的走查（实测 206s → 13.5s） |
| `pnpm check:keywords` | 查"关键词指向不存在的部件"这类**静默失效** |
| `pnpm check:encoding` | 查乱码与非法 UTF-8 |
| `pnpm check:tools` | 证明上面两个守卫**不会假阴性也不会假阳性** |
| `node scripts/render-offline.mjs map` | **不用浏览器**出地图/立绘对照图（几秒） |
| `node scripts/render-offline.mjs xcheck` | 离线与浏览器渲染结果一致性（需 dev server） |

### 走查写在"画廊"里的部分

`map-gallery.mjs` / `npc-fidelity.mjs` / `sprite-gallery.mjs` 会**渲染对照图**到
`playtest-shots/*.png`。**这些图必须自己看** —— 断言只能测客观部分
（尺寸、亮度、部件归属），"像不像"必须画出来看。

### CI

`.github/workflows/deploy.yml`，`windows-latest`（预装 Edge）：

```
typecheck → test
  → check:encoding   （乱码 / 非法 UTF-8）
  → check:keywords   （词表指向不存在的部件）
  → check:tools      （用污染测试证明上面两个守卫真会报警）
  → build
  → 在 preview 上跑 main-menu（产物冒烟）
  → 在 dev server 上跑全套（功能验证）
  → 部署 GitHub Pages
```

**三道新增的静态守卫都很快**（各一两秒、不需要浏览器），
拦住的正是"编译通过、测试通过、只有玩家看得出来"的那一类缺陷。

**为什么走查要分两步**：走查需要用 `__gameStore` 之类的调试钩子准备游戏状态，
而这些钩子在生产构建里被 `import.meta.env.DEV` 守卫剔除了（有意为之）。
全套只能在 dev 上跑。

---

## 6. 这个项目积累的「坑」（**必读，能省你几小时**）

这些都是真实踩过并记录下来的，按类别整理。

### 6.1 工具类

1. **绝不用 PowerShell 改源码** —— 反引号是转义符，`` `t `` 会变成制表符。
   我用它弄坏过 4 个文件。**用 read + edit/write 工具**。
2. **绝不用 `Set-Content -Encoding UTF8` 写 `package.json`** —— 会加 BOM，
   导致 CI 的 `pnpm/action-setup` JSON 解析失败。
   用 `[System.IO.File]::WriteAllText($p, $c, (New-Object System.Text.UTF8Encoding($false)))`。
3. **git commit message 不能含英文双引号** —— 会截断参数，报 `pathspec did not match`。
4. **`Get-Process node | Stop-Process` 会杀掉 runner 自身**（在 CI 里）。
   记下 PID 只杀自己启动的那个。
5. **PowerShell 的 `-replace` 对多行字符串不可靠**（行尾差异）。
   复杂替换用 Node 脚本。
6. **本地无全局 git**：用 `D:\工作区\.tools\git\cmd\git.exe` + 显式 HOME。
7. **git push 偶发 `Connection was reset`** —— 重试 3 次即可。

### 6.2 验证类（**最重要的一类**）

> **断言失败时，先怀疑断言；探测不到现象时，先验证探测手段。**

我在这个项目里**误报超过 15 次**，全部是探针的问题：

| 误报 | 真相 |
|---|---|
| 「手机底栏无效」以为是 z-index | 是**遮罩命中测试**（同层也会被盖）。靠 `__tabClicks` 探针才找到 |
| 抽屉「关不掉」 | 检测用的 `input[placeholder*="搜索物品"]` **桌面右栏也有**，永远为真 |
| 「大立绘还是 48×72」 | 量的是 `<img>`，它的固有尺寸固定 128×256，**必须量容器** |
| 「主菜单走查失败」（本地全绿） | 生产构建没有 `__navStore`，断言要回退 DOM 判断 |
| 「改了没生效」 | dev server 的**模块缓存**；或 `file://` 的**图片缓存** |
| 「隐藏文案元素拿不到文本」 | API Key 弹窗遮住标题页，`innerText` 对不可见元素返回空 |
| 「重试逻辑坏了」 | 假服务商**缺 CORS 预检**，浏览器报网络失败，实际服务端收到 3 次请求 |
| 「进度没被清掉」（假失败） | 用假 API Key，开场生成必然失败，`history` 本来就是 0 |
| 覆盖率门槛不达标 | **门槛本身是错判据** —— `skin` 只有 10% 不是缺陷，是样本没写肤色 |

**而且：看不清就画出来看。** 我曾用"躯干区域不透明像素比例"统计判断哪件衣服露躯干，
结果把 `jacket_pockets` 量成 0%、正式衬衫量成 58%，与肉眼完全对不上。
最后把 37 件上衣各渲染一张拼成对照图，一眼就看清有 7 件露躯干。

### 6.3 代码类

8. **`'wood' as TileKind` 这种断言会骗过编译器**。`'wood'` 不是合法地形类型，
   `bank.get('wood')` 是 `undefined`，铺出来全黑 → 视觉上"海被切断"。
   **别用 `as` 绕过联合类型**，它换来的编译通过正好掩盖"贴图不存在"。
9. **上游 LPC 的 kind 标注有错**：`legs_skirt_*` 标成 `legs`、
   `dress_*` 与 `legs_skirt_overskirt` 标成上衣类（后者 kind 竟是 `apron`）。
   一律**按 id 判断**，不要只信 kind。
10. **两份词表不一致会静默失效**：`GARMENT` 常量里有「围裙」，
    但 `brown` 那条正则手写成窄列表（没有围裙）→ 「棕色围裙」推不出衣色。
    不报错，只是悄悄失效。
11. **React StrictMode 会双挂载 effect** → 重复绑定 `popstate` 监听器。
    用模块级标志位去重（且卸载时**不要**摘监听器，否则重新挂载又绑一个）。
12. **`--user-data-dir` 必须是绝对路径** —— 传相对路径时 Chromium **静默失败**：
    进程照常起来（PID 有效、`exitCode` 为 null），但既不创建 profile 目录、
    也不绑定调试端口，脚本只能看到「端口未就绪」，完全猜不到是路径问题。
    **只有单独跑某一套走查时才会踩到**：`all.mjs` 传给子进程的 `AUDIT_OUT`
    本来就是绝对路径，所以 CI 一直是绿的，而 `pnpm check:map` / `check:npc`
    这类直接调用**全部必挂**（本地实测 7 套全挂）。
    已修：`scripts/checks/_browser.mjs` 新增 `outDir()` 统一解析成绝对路径。
    **教训同 6.2 节 —— 「端口未就绪」先怀疑路径，别去查 Edge 装没装。**
13. **`Get-Content -Raw` 会按 ANSI 解码 UTF-8**（本机 PowerShell 5.1 默认 GBK），
    中文注释全变乱码，写回去就把文件永久弄坏。
    `scripts/verify-render.mjs` 现在就是一堆乱码注释（**注释部分，能正常跑**）。
    **不只是"别用 PowerShell 改源码"，读取也一样 —— 一律用 read/edit/write 工具。**

---

## 7. 返回键的最终设计（改过 5 版，别轻易动）

**文件**：`src/stores/nav.ts` + `src/hooks/useBackNavigation.ts`

### 核心原则：**层级与浏览器历史必须一一对应**

前几版都错在这里 —— `nav.stack` 在涨、`history` 不涨，于是深层级只占一条历史，
按一次返回就跨过好几层直接退出页面。**证据是日志里 `history.length` 只有 2~3。**

```
nav.push(v)   →  set state + history.pushState()   ← 同步
popstate      →  nav.backSilent()                  ← 浏览器已弹过，不能再弹
每层浮层       →  也算一层（打开时 pushState）
```

### 层级顺序

```
game → setup → worldbook → library → menu
```

### 行为

| 场景 | 返回键 |
|---|---|
| 浮层打开（抽屉/立绘/弹窗/引导） | 只关它，页面不动 |
| 游戏内 | 退回上一级界面 |
| 卡片库 | 退回主菜单 |
| **主菜单** | **第一次只提示「再按一次返回即退出游戏」，第二次才退出** |

### 哨兵管理

- `ensureSentinel()` 用 **`replaceState`** 打标（**不新增条目**）。
  用 `pushState` 会让每次换层级都新增历史 → 累积 → "多按几次返回都不动"。
- 唯一需要真正 `pushState` 的地方是**退出确认**。
- 用 `useLayoutEffect` 而不是 `useEffect`：effect 是异步的，
  用户在它之前按返回就穿透。

### 浮层状态放在 `ui` store

`mobileSheet` / `mobileMenuOpen` / `portraitCharacterId` / `isApiKeyModalOpen` / `showTutorial`
**必须在 store 里**，因为 hook 要订阅它们才能给每层压历史。
藏在组件 `useState` 里时 hook 看不到 → 打开抽屉后按返回会把整页退掉。

---

## 8. 许可证（**不能改**）

- 项目是 **GPL-3.0-only**
- 原因：像素素材里有 **CC-BY-SA 3.0**（48 件）与 **GPL 3.0**（67 件），
  CC-BY-SA 3.0 与 GPL-3.0 兼容，**强制整体 GPL-3.0**
- 上游 `pale-notes` **没有 LICENSE** → `NOTICE.md` 说明 GPL-3.0 只覆盖自撰部分
- **署名是授权要求，不是可选项**：`public/CREDITS.md` 由 `scripts/gen-credits.mjs`
  从 `runtime.json` 自动生成（当前 36 位作者 / 205 件需署名）。
  **不要手改 `CREDITS.md`**，改 `runtime.json` 后重跑脚本。
- 页面底部与「卡片库」里都有署名入口

---

## 9. 当前未完成的工作与优先级

`ROADMAP.md` 的「待办」章节有完整列表。按我的判断排序：

### 优先级 1：地图再提升一档（**我推荐先做这个**）
地图是玩家盯着看最久的画面。现在每种地形 3 套程序化构图，但：
- 地形之间**没有过渡**（草地突然变石板，缺少边缘处理）
- **装饰物密度单一**（没有稀疏/密集的变化）
- 缺少 RPG 地图的经典元素：**道路交叉口的指示牌、水边的芦苇、墙角的杂物、地上的阴影**
- `coast` 的岸线目前是逐列随机，可以做成**贝塞尔曲线式的平滑岸线**

### 优先级 2：发色顺序规则需要维护
词表变成"有序表"后，以后加具体色名必须记得放前面。
测试能挡住一部分（`appearance.test.ts` 有非标准色名用例），但不能自动推导顺序。
**可以考虑**给色名加一个"具体度"分数（长度/是否含修饰词），按分数排序而不是靠人工顺序。

### 优先级 3：`eye` 覆盖率低
瞳色几乎没人写，且不影响玩法，所以无害。
但若要立绘更精细，可补一张瞳色同义词表（8 种：blue/green/purple/red/orange/yellow/brown/gray）。

### 优先级 4：上游素材边界
**上游没有眼镜 / 面具 / 棒球帽 / 无檐帽**。
「戴单片眼镜的管家」「戴棒球帽的店员」只能不加或退到皮帽。
要真正解决需要**另找素材源**（注意许可证兼容性，见第 8 节）。

### 其他（ROADMAP 里的）
- 存档体积仍无硬上限（已有自动裁剪，但没有硬限制）
- 章节切换 overlay、结局画面仍是纯文字（可加立绘）
- 「星海拾遗」是刻意留的纯叙事范例（0 属性/0 资源），**不是半成品**

---

## 10. 下一步该做什么（具体动作）

如果你（下一个会话的 AI）要做**优先级 1（地图提升）**，建议这样开始：

1. 先跑一次 `scripts/checks/map-gallery.mjs`，**打开 `playtest-shots/map-gallery.png` 看图**，
   建立对当前地图的直观认识。
2. 读 `src/utils/rpgMap.ts` 的 `drawTile()`（每种地形的瓦片画法）与
   `buildLayout()`（三套布局）。
3. 加地形过渡：在 `generateMap` 铺完瓦片后，遍历**相邻格类型不同**的边界，
   画一圈过渡瓦片（比如草地→石板画半格草边）。
4. 加装饰物：新建一个 `scatterDecor()` 函数，按地形撒芦苇/指示牌/杂物/阴影，
   密度用 seed 控制。
5. 每改一步都**重跑画廊并看图** —— 不要只信断言。

**通用建议**：
- 动手前先跑 `tsc --noEmit` 和 `vitest run`，确认起点是绿的（当前 239 条通过）。
- 改完源码**重启 dev server** 再跑走查。
- 提交前跑完整 `scripts/checks/all.mjs`（8 套）。
- 推送后可以用 `D:\工作区\.tools\watch-ci.mjs` 盯 CI（约 3-5 分钟）。

---

## 10.5 工具建设（**已全部完成** —— 2026-10-06）

这一节原本是"还缺哪些工具 / 怎么减少工作量"的分析。
**五个工具都已实现并验证**，所以下面既是清单也是使用说明。

### 核心判断（这次被验证了）

上一轮的结论是"提升空间在美术"，但**真正的瓶颈不在美术，而在缺少反馈回路**：
这个项目**一半以上的工作量花在「确认现象是真的」而不是「修」上**
（交接文档自述误报 15+ 次，ROADMAP 另记 9 次）。

这次动手时又验证了一遍 —— 下面每个工具都当场抓到了真问题。

### 已交付的五个工具

| 工具 | 命令 | 作用 | 当场抓到的问题 |
|---|---|---|---|
| **1. 看一眼** | `pnpm see` / `node scripts/see.mjs` | 一条命令截图 + 打印可读路径；`--fresh` 清存储、`--mobile` 手机视口、`--wait=<选择器>`、`--action=<js>`、`--full` 整页 | 截图立刻暴露「首屏被模型设置弹窗占满」（见下方待确认项） |
| **2. 只重跑失败** | `pnpm check:failed` | `all.mjs --only-failed` / `--list` / 按名筛选，失败清单落盘 `.check/last-failed.json` | 实测把迭代从 **206s 降到 13.5s** |
| **3. 关键词校验** | `pnpm check:keywords` | 用真实 `runtime.json` + `palettes.json` 反查**每一张词表** | **3 处真实静默失效**（见下） |
| **4. 离线渲染** | `node scripts/render-offline.mjs map\|sprites\|sprite\|selftest\|xcheck` | **不依赖浏览器**直接出 PNG（自带 PNG 编解码 + canvas 垫片） | LPC 素材其实是 **4 种格式混用**（见下） |
| **5. 编码守卫** | `pnpm check:encoding` | 抓 UTF-8→GBK / Latin-1 乱码与非法字节 | 证明 `verify-render.mjs` **并没有坏**（见下） |

### 工具 3 当场查出的三处静默失效（已修）

| 位置 | 问题 | 后果 |
|---|---|---|
| `HAIR_STYLES` 的 `/莫西干\|mohawk/` | 值写成 `['mohawk']`，而库里的莫西干部件叫 **`hair_shorthawk`** | 唯一候选是空气 →「莫西干头」**退化成随机发型**。已改成 `['shorthawk','spiked']` |
| `ROLES` 的「学生」 | 含 `'torso_clothes_vest'`，**库里没有 vest 类部件** | 靠前一个片段兜住，行为正确但死片段永远轮不到。已删 |
| `HAIR_STYLES` 的 `/发髻\|bun\|updo/` | `bun` / `updo` 库里都没有 | 同上。已删 |

**并补了 CI 级回归**：`spritePool.test.ts` 新增「整张词表不得有指向空气的片段」，
逐条逐片段核对（原来只测"至少命中一个"，正好漏掉这类缺陷）。
单测从 239 条涨到 **353 条**。

### 工具 4 当场查出的问题

**LPC 素材是 4 种 PNG 格式混用**：

```
位深8/类型6（RGBA）×175   位深4/类型3（索引色）×54
位深2/类型3（索引色）×7   位深8/类型3（索引色）×10
```

第一版 PNG 解码器只支持 8 位，于是**索引色 2/4 位的 61 张全解不了**
（胡须、部分腿部件），而失败被包装成一句"部件图加载失败"，
完全看不出是位深问题。已支持全部四种。

另外：`torso_clothes_shortsleeve_cardigan.png` 是 **128×320**
（其余 245 张都是 128×256，`runtime.json` 也如实标注了）。
合成器只取前 4 行方向帧，多出的行不参与，**不是缺陷**。

**离线结果与浏览器的一致性已客观验证**（`render-offline.mjs xcheck`）：
8 个角色的 `recipeFor` 部件与配色 **8/8 完全一致**。

### 工具 5 的一个反直觉结论

`scripts/verify-render.mjs` 的注释在 PowerShell 里显示成乱码，但
**文件本身是干净的** —— 那是 PowerShell 控制台按 GBK 解码 UTF-8 的显示问题。
用统计判据实测：真乱码的生僻字占比 **0.84~0.90**，而该文件只有 **0.015**。
**「控制台显示乱码」≠「文件坏了」**，别急着"修"。

### 判据是怎么定的（方法论，值得复用）

第一版编码守卫我用"手挑乱码特征字 + 一行出现 2 个就报警"，
结果**误报了 3 个文件**（`official-worldbook.json` 里的「澪汀」、
`src/data/worlds/deepcore.ts` 里的正常汉字）。教训：

> **逐字查表天生不可靠** —— 正常中文里也会出现同形字。

改成统计判据后分离度极大，因为：正常中文只用约两千个常用字，
而乱码的 CJK 字符在整个 U+4E00–U+9FFF 上近似均匀分布。
**仓库自己就是最好的中文语料**，不需要外部字典。

同理，校验器写错会**制造假缺陷**：我第一版把 `palettes.json` 的嵌套结构
（`{palettes:{hair:{...}}}`）当成平铺，于是把 `grey` 这类其实能正常解析的
色名报成"不存在"。**校验器本身也要被校验** —— 这就是
`scripts/check-tools-selftest.mjs` 存在的原因：它用**污染测试**证明
守卫"看见坏东西会报警、看见好东西不误报"。

### 待确认的产品问题（截图发现的）

**新玩家首屏被「模型设置」弹窗占满**，看不到主菜单。

`ApiKeyModal.tsx:22`：`shouldShow = isApiKeyModalOpen || (!llm.apiKey && llm.provider !== 'ollama')`
—— 没配 Key 就**无条件强制显示**，且 `canDismiss` 为 false 时**连右上角的 ✕ 都不渲染**。

也就是说 ROADMAP 第 21 项写的"未配置模型时在最显眼处提示"，
实际实现成了一个**必须先填 Key 才能进入**的门。
对一个"挑一张世界卡就能看设定"的应用，这可能挡住新玩家。
**这是产品取向，不是 bug，所以留给用户决定**（见 ROADMAP 待办 0.1）。

### 另外记一笔：沙箱与浏览器

受限沙箱下 Chromium **无法创建 mojo 命名管道**，Edge 起来即崩
（`FATAL: platform_channel.cc Check failed: 拒绝访问`），表现为"端口未就绪"。
放开为 `danger-full-access` 后一切正常。
**这也正是离线渲染器（工具 4）的价值** —— 它完全不碰浏览器。

---

### 顺带修掉的走查基础设施问题

| 改动 | 收益 |
|---|---|
| `_browser.mjs` 新增 `outDir()` | 修掉"单独跑走查必挂"（7 套），并让路径问题变成显式断言 |
| `_browser.mjs` 新增 `profileDir()` / `removeProfile()` | Edge profile 从截图目录移到系统临时目录并在结束时删除 —— 之前会在 `playtest-shots/` 堆 23 个几十 MB 的目录，还被 CI 当产物上传 |
| `npc-fidelity.mjs` 不再重复写时间戳截图 | 之前每次跑多留一个 144 KB 的同名副本 |
| 走查失败时的报错补上路径提示 | "端口未就绪"现在会提示"常见原因：--user-data-dir 不是绝对路径" |

### 地图美术的具体改进依据（读图所得，非推测）

读了 `playtest-shots/map-gallery.png`（现在也可用离线渲染器出图）后，
客观可见的问题是：

1. **地形之间没有过渡** —— 草地→石板、沙→水都是硬边。`coast` 的岸线是逐列 ±1 随机，
   看起来仍是方块台阶，不是平滑岸线。
2. **`tree` 瓦片是同心圆**（`rpgMap.ts` 约 210 行：按到中心的距离分 4 档上色），
   密铺后像"珠子/圆环"而不像树冠 —— 这是森林场景最主要的观感短板。
   改法：给树冠加**不规则轮廓**（按角度扰动半径）+ 每格随机取 2~3 种树形，
   而不是所有格子同一张圆心图案。
3. **装饰密度完全均匀** —— 没有稀疏/密集对比，缺少 RPG 地图该有的
   路牌、水边芦苇、墙角杂物、地面阴影。
4. **`interior` 的墙是细线**（`wall` 只画 1px 砖缝），俯瞰下像"空心房间"，
   认不出是墙。
5. **画面偏灰**：九种地形的色调都压在相近的明度带里（`sky` / `underground` / `mountain`
   尤其接近），缺少"一眼能分辨这是哪个场景"的强色彩特征。

> 改法都写在 `rpgMap.ts` 的 `drawTile()`（每种地形的瓦片画法）与 `buildLayout()`（三套布局）。
> **每改一步都要出图并看图**，不要只看断言：
> 快速看 —— `node scripts/render-offline.mjs map`（不用浏览器，几秒出图）；
> 全量核对 —— `pnpm check:map`（含亮度递减等断言）。

### 立绘的两个具体问题（读图所得，待复核）

1. **「银叶精灵」发色与肤色几乎同色**（浅黄发 + 米色皮肤），轮廓糊在一起。
   注意：项目已有 `pickContrastingCloth`（衣色 vs 肤色亮度差 < 45 就排除），
   **但没有发色 vs 肤色的同类检查** —— 应该复用同一个函数思路。
2. **管家（白发黑袍）腿部疑似有白色絮状残片**。
   ⚠️ 这条**尚未用可靠方式复核**：当时看的是被拉伸过的拼图，
   而后来用包围盒与 8/8 配方对比证明渲染本身是忠实的。
   **复核方法**：`node scripts/render-offline.mjs sprite --desc="星夜堡的管家，衣着整洁，乌黑长发束成马尾" --scale=4`
   再看图；若仍有残片，把配方里每个部件各渲染一张来定位。

---

## 11. 一句话总结现状

**项目是完整可玩、测试充分、已上线、免费、GPL-3.0 的状态。**
246 个像素部件、**3 个深度内置世界（各 ≥5 万字）**、**388 条单元测试**、8 套 154 项浏览器走查全绿，
CI #33 成功，线上哈希与本地一致。

**2026-10-06 补上了五个体检工具**（看一眼 / 只重跑失败 / 词表校验 /
离线渲染 / 编码守卫）—— 它们直接砍掉了这个项目里最大的一块工作量：
"确认现象是真的"。工具当场就查出了 3 处静默失效并已修。

**下一步提升空间在美术表现（地图与立绘的精细度），而不是功能。**
具体问题清单见第 10.5 节，已按"读图所得"列明。
