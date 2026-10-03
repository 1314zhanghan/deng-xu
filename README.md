# AI 角色扮演引擎 · 公网部署版

一个**不绑定任何题材**的 AI 文字角色扮演 / 跑团引擎。可自由输入世界观与角色卡，
兼容导入 SillyTavern 角色卡，机制层（属性 / 资源 / 物品 / 线索）全部可自定义。

> 本项目是开源项目 [pale-notes（苍白卷宗）](https://github.com/luyu14039/pale-notes) 的改造版。
> 原版把世界观写死成《密教模拟器》二创（1900 年代伦敦 + 防剿局 + 八种性相）。
> 改造后**引擎本身不含任何设定**，一切由用户的世界卡决定。

**这是「公网部署」版本**（`pale-notes-web`）。
如果只是想在本地玩、需要一键启动和手机扫码，请用 **`pale-notes-local`** 版本。

---

## 它是纯前端应用 —— 所以能直接托管到公网

所有逻辑都跑在浏览器里，浏览器**直连你填的模型服务商**（DeepSeek / OpenAI / 硅基流动 /
OpenRouter / 本地 Ollama / 任意 OpenAI 兼容端点），**不需要任何后端服务器**。

这意味着：把 `dist/` 丢到任何静态托管上，就得到一个可以分享给别人的网址。

---

## 部署方式

### 方式一：surge.sh（最快，一条命令）

```bash
pnpm install
pnpm deploy:surge
```

首次运行会提示输入邮箱和密码（用于注册 surge 账号，密码不回显），
之后会自动分配一个免费网址，形如：

```
https://<子域名>.surge.sh
```

指定子域名：

```bash
npx surge dist <你想要的子域名>.surge.sh
```

### 方式二：Netlify

```bash
pnpm install
pnpm deploy:netlify
```

或把 `dist/` 目录直接拖到 <https://app.netlify.com/drop>。
仓库里已有 `netlify.toml`，重写规则会自动生效。

### 方式三：Vercel

```bash
npm i -g vercel
vercel --prod
```

仓库里已有 `vercel.json`；也可在 Vercel 面板导入 Git 仓库，它会自动识别 Vite。

### 方式四：GitHub Pages

仓库里已配好 `.github/workflows/deploy.yml`：

1. 把项目推到你自己的 GitHub 仓库
2. 仓库 **Settings → Pages → Source** 选 **GitHub Actions**
3. 推送到 `main` 分支，等 Actions 跑完
4. 访问 `https://<用户名>.github.io/<仓库名>/`

`vite.config.ts` 里 `base: './'` 用的是相对路径，放子路径下也能正常加载资源。
构建时会额外生成 `dist/404.html`（Pages 对未知路径返回 404 页面，不会自动回退到 index.html）
与 `dist/.nojekyll`。

### 方式五：自己的服务器 / 对象存储

```bash
pnpm build          # 产出 dist/
```

把 **`dist/` 整个目录**上传到 OSS / COS / S3 / 自己的 Nginx 即可。

Nginx 示例：

```nginx
server {
    listen 80;
    root /path/to/dist;
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

> 对象存储记得开启静态网站托管，并把「错误文档」指向 `index.html`。

---

## 部署前请确认这几件事

| 事项 | 说明 |
|---|---|
| **不要**硬编码 API Key | Key 存在访客自己的浏览器 localStorage 里。写进代码再公开部署，等于把 Key 送给全网 |
| 跨域（CORS） | 浏览器直接请求模型服务商。主流服务商（DeepSeek / OpenAI / 硅基流动 / OpenRouter）都允许浏览器直连；若某家不支持，需要自建转发 |
| HTTPS | 公网基本都走 HTTPS，没问题。本地 `http://localhost` 也在浏览器安全上下文白名单里 |
| 世界卡不会共享 | 世界卡存在**每个访客自己的浏览器**里（IndexedDB）。想让别人用你的设定，得把世界卡导出成 JSON 随项目一起发布 |
| 访客要自备 Key | 部署后第一次打开会弹「模型设置」，访客需填自己的 API Key 才能玩 |

---

## 本地预览（部署前自测）

虽然这是公网版，本地也能跑起来确认没问题：

```bash
pnpm install
pnpm build
pnpm serve          # 构建 + 起本地静态服务 + 打开浏览器
```

或直接双击 `start.bat`（走生产构建）。改代码时用 `start-dev.bat`（热更新）。

**不要直接双击 `index.html` 或 `dist/index.html`。** 前者是 Vite 入口模板
（引用的 `/src/main.tsx` 是 TypeScript，未经编译无法运行）；后者是 ES module，
`file://` 协议下会被浏览器拦截。两者都会白屏，必须走 HTTP。

---

## 核心概念

### 世界卡（WorldCard）
一个完整的可玩设定：

- **世界观正文** —— AI 最重要的依据
- **世界规则** —— 写清「什么不可能」和「必须用什么术语」，比堆砌形容词更能防跑题
- **属性** —— 任意维度，带显示名、说明、颜色
- **资源** —— 任意条数、可设上限；标记「致命」的资源归零时 AI 会把故事引向结局
- **背景槽位** —— 类似「出身 / 童年 / 特质」，选项可带属性与资源加成
- **预置物品与知识**
- **章节卡事件**（可选）—— 你亲手写的固定剧情节点，带触发条件与选项
- **叙事文风** —— 人称、时态、回复字数、额外文风要求

### 角色卡（CharacterCard）
字段与 **SillyTavern V2** 规范对齐，支持：

- **导入**酒馆的 `.png`（读取 `tEXt`/`iTXt` 里的 `chara`/`ccv3` 数据块）与 `.json`
- **导出**为标准 `chara_card_v2`，可反向给酒馆用
- 未识别字段保留在 `extensions.__unknown`，导入导出不丢数据

### 两段式生成引擎
1. **叙事 AI** —— 只写小说正文，完全不知道数值存在（避免「理智-1」这类出戏文本）
2. **结算 AI** —— 读剧情，输出 JSON 描述状态变更与下一步选项

两个模型可分开配置：用便宜快速的模型做结算，用擅长写作的模型写剧情。

### 内置示例世界（三张，题材完全不同）
- **《灰烬回响》** 暗黑奇幻 —— 5 自定义属性、3 资源、2 个章节卡事件
- **《霓虹雨季》** 赛博朋克 —— 4 属性、无上限货币
- **《星海拾遗》** 太空歌剧 —— 关闭机制层，演示纯叙事角色扮演

---

## 数据存放位置

| 数据 | 存放处 |
|---|---|
| 世界卡（含角色卡与头像） | **IndexedDB**（`pale-notes` 库）。容量大于 localStorage，且写入不阻塞渲染 |
| 游戏存档 / 对话历史 | `localStorage` → `pale-notes-storage` |
| 当前会话 | `localStorage` → `pale-notes-session` |
| 模型设置 | `localStorage` → `pale-notes-ui` |

> ⚠️ 数据在**浏览器本地**。换设备、换浏览器、清缓存都会丢。
> 重要世界卡请用卡库右上角「导出全部」备份成 JSON。

---

## 项目结构

```
src/
  types/     cards.ts（世界卡/角色卡/LLM配置）  story.ts（章节卡与触发条件）
  api/       llm.ts（OpenAI 兼容封装+服务商预设）  jsonRepair.ts（模型 JSON 容错解析）
  stores/    library.ts（IndexedDB 卡片库）  session.ts  game.ts  ui.ts  meta.ts
  constants/ prompts.ts（提示词构建层，不含任何题材内容）
  data/      builtinWorlds.ts  builtinWorldsExtra.ts（三张示例世界）
  systems/   StorySystem.ts（章节卡事件引擎）
  hooks/     useGameEngine.ts（两段式生成主循环）
  components/ StartScreen  SessionSetup  CardEditor  ApiKeyModal  NarrativeView
              ChoicePanel  StatusPanel  InventoryPanel  RelationshipPanel
              StatusBar  ChapterOverlay  DebugPanel  TutorialModal
  utils/     cardIO.ts（酒馆卡解析）  idb.ts  files.ts
scripts/
  serve.mjs      零依赖本地静态服务器（含残缺构建检测、目录穿越防护）
  make-404.mjs   为 GitHub Pages 生成 404.html 与 .nojekyll
  qrterm.py      终端二维码（本地启动时扫码用）
start.bat / start-dev.bat / start.ps1    本地启动脚本
netlify.toml / vercel.json               托管平台配置
```

---

## 常见问题

**部署后打开是白屏？**
先按 F12 看控制台。若报模块加载失败，多半是服务器的 MIME 类型或路径配置不对
（比如站点放在子目录却没配 `base`，本项目已用相对路径规避）。

**访客打不开、提示 API Key 错误？**
这是预期行为 —— 部署的站点不带 Key，每个访客要填自己的。第一次打开会自动弹设置窗。

**手机能玩吗？**
能。界面做了移动端适配（抽屉菜单、`dvh` 高度、输入框 16px 防缩放）。

**想改世界观但不想改代码？**
打开站点 → 卡库 → 复制一张示例卡 → 在编辑器里改。所有设定都在卡片里，不用碰源码。

---

## 许可与致谢

- 原项目：[luyu14039/pale-notes](https://github.com/luyu14039/pale-notes)（二创许可，仅供非商业交流）
- 原项目是 **Weather Factory**《司辰之书》《密教模拟器》的二创。
  **本改造版已移除其全部美术素材与世界观文本**，不含任何 Weather Factory 版权内容。
