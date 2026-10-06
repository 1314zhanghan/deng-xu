# 交接文档 · 灯叙（deng-xu）

> **给下一个会话的 AI**：这份文档是自包含的。读完它你应当能直接继续开发，
> 不需要回看任何历史对话。所有路径都是绝对路径，所有命令都可直接粘贴执行。
>
> 最后更新：2026-01（当前 HEAD `11f3ed0`，CI #33 成功，线上已部署）

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
│  ├─ builtinWorlds.ts        # 内置世界卡聚合（9 个）
│  ├─ builtinWorldsExtra.ts   # 原有 2 个（霓虹雨季、星海拾遗）
│  └─ builtinWorldsThemed.ts  # 题材包 6 个
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

### 4.5 内置世界（9 个）

| id | 标题 | 题材 | 机制 |
|---|---|---|---|
| `builtin_ashen_echo` | 灰烬回响 | 暗黑奇幻 | 开 |
| `builtin_neon_rain` | 霓虹雨季 | 赛博朋克 | 开 |
| `builtin_star_drifter` | 星海拾遗 | 太空歌剧 | **关**（纯叙事范例） |
| `builtin_silver_crown` | 银冠之下 | 经典西幻 | 开 |
| `builtin_seventh_day` | 被召唤的第七天 | 日式异世界 | 开 |
| `builtin_asking_sword` | 问剑帖 | 中式仙侠 | 开 |
| `builtin_three_am` | 凌晨三点的便利店 | 现代都市 | 开 |
| `builtin_changan_twelve` | 长安十二年 | 架空历史 | 开 |
| `builtin_rain_never_stopped` | 雨没有停过 | 后末日 | 开 |

每个世界卡都有：**术语表 + 禁止词汇 + 与题材匹配的机制 + 2-3 张角色卡**。
「写清什么不可能」比堆形容词更能防跑题。

**角色卡工厂**：`builtinWorldsThemed.ts` 里的 `char()` 函数补默认值 ——
`CharacterCard` 有 9 个必填字段，手写 14 遍必然漏。

---

## 5. 测试体系（8 套走查 154 项 + 239 单元测试）

```
scripts/checks/
├─ _browser.mjs        # 公共工具（Edge 自动探测、CDP 封装）
├─ _ws-shim.mjs        # Node 20 的 WebSocket 兜底（CI 用它）
├─ all.mjs             # 总入口，一次跑全部
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

### 走查写在"画廊"里的部分

`map-gallery.mjs` / `npc-fidelity.mjs` / `sprite-gallery.mjs` 会**渲染对照图**到
`playtest-shots/*.png`。**这些图必须自己看** —— 断言只能测客观部分
（尺寸、亮度、部件归属），"像不像"必须画出来看。

### CI

`.github/workflows/deploy.yml`，`windows-latest`（预装 Edge）：

```
typecheck → test → build
  → 在 preview 上跑 main-menu（产物冒烟）
  → 在 dev server 上跑全套（功能验证）
  → 部署 GitHub Pages
```

**为什么分两步**：走查需要用 `__gameStore` 之类的调试钩子准备游戏状态，
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

## 11. 一句话总结现状

**项目是完整可玩、测试充分、已上线、免费、GPL-3.0 的状态。**
246 个像素部件、9 个内置世界、239 条单元测试、8 套 154 项浏览器走查全绿，
CI #33 成功，线上哈希与本地一致。

**下一步的提升空间主要在美术表现（地图与立绘的精细度），而不是功能。**
