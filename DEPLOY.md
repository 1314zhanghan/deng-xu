# 部署信息 · 灯叙 - Z测试版

---

## 素材来源与授权（重要）

本站**不包含任何第三方美术素材**。所有人物头像与场景背景都是
`src/utils/avatarParts.ts` / `avatarArt.ts` / `sceneArt.ts` 里程序化绘制的 SVG。

### 🔑 访问素材站需要开代理

本机装有 **AdGuard VPN**（`C:\Program Files\AdGuardVpn\`）。
只启动服务是不够的 —— **必须让客户端连上隧道**，否则它只是后台服务，
根本没有虚拟网卡，素材站全部超时。

```powershell
# 启动客户端（它会自动连上上次的节点）
Start-Process "C:\Program Files\AdGuardVpn\AdGuardVpn.exe"
# 确认隧道已建立（应看到 "AdGuard VPN Tunnel  Up"）
Get-NetAdapter | Where-Object InterfaceDescription -like "*AdGuard*"
```

未开代理时：itch.io / gum.co / lemmasoft **全部超时**。
开启后：**itch.io 正常**，gum.co 仍不稳定。

### 已评估的素材源与结论

| 源 | 授权 | 结论 |
|---|---|---|
| **[Humaaans](https://www.humaaans.com/)**（Pablo Stanley） | 官网明确 **CC0 公共领域**，可商用可修改 | 分发包在 Gumroad（`gum.co/humaaans`），**即使开了代理仍超时**；GitHub 上 13 个镜像授权标注互相矛盾（MIT / CC-BY-4.0），CC0 作品不该被镜像成 CC-BY。**未采用** |
| **[Potat0Master · Hiyori](https://potat0master.itch.io/free-character-sprite-for-visual-novels-hiyori)** | Royalty-Free：**可商用、可修改、免署名**；**不可**把素材本身当独立文件或素材包再分发 | 授权很友好，但**形态不对**：它是「**1 个**完整女性角色立绘」（3 套校服 + 25 表情），1080p PNG 就 25 MB。用同一张立绘当所有女性 NPC 比现在更糟。**未采用** |
| Potat0Master · Starter Bundle | —— | 给定链接 **404**。未采用 |
| **[cellinlab/spritecook-free-game-assets](https://github.com/cellinlab/spritecook-free-game-assets)** | **CC0-1.0**，可商用可再分发 ✓ | 25 个包，23 个是**像素风**（与本站衬线排版文风冲突）；`detailed-characters-anime` 是 **16 张独立整图**（龟武僧/蘑菇德鲁伊…）共 21 MB，只有奇幻题材，且**不是可拼接部件**；`detailed-splash-art` 仅 3 张、单张 3 MB、同样只有奇幻题材。**未采用** |
| BOOTH / Lemma Soft Forums | 逐项不同 | BOOTH 可访问但条款需逐项核验；Lemma Soft 站点不通。**未采用** |

### 为什么最终走程序化路线（而不是找更好的素材）

关键区分：**视觉小说立绘 ≠ 模块化头像**。

立绘是「一个角色一张完整站姿大图」，配合背景做合成，角色池是固定的。
而本站的核心需求是「**自由输入世界观与角色卡**」，要能**任意生成**角色、
在 **36px 圆形**里显示、并按世界风格换配色、还要**接入 AI 分配**。
把立绘接进来只能把角色写死成几个固定人物 —— 那等于砍掉核心需求。

所以程序化部件库在这个约束下不是"凑合的替代品"，而是唯一自洽的方案。
如果将来要做固定角色的剧情向作品，上表里 Potat0Master 的授权是可以直接用的。

### 想换成真实美术素材时怎么接

改数据即可，不用动组件：

- **头像**：`src/utils/avatarArt.ts` 的 `AssetEntry` 加 `image` 字段，
  `resolveAvatar()` 会优先用它，跳过程序化绘制。
- **背景**：`src/utils/sceneArt.ts` 的 `SceneAsset` 加 `image` 字段，
  `generateScene()` 检测到就直接返回该图片。
- 优先级链已经封好：**角色卡自带图片 > 素材 id/image > 程序化生成**，
  最后一级永远不会失败，所以永远不会出现裂图。

⚠️ 引入外部素材时请**逐个核验授权**（是否要求署名、是否允许再分发、是否限非商业），
并在此处补充来源与条款 —— 不要只凭"网上写着免费"就打包。

---

## 线上地址（已发布）

# 🎮 https://fyjsj-zh.github.io/deng-xu/

（旧地址 https://ai-rp-engine.surge.sh 仍在，但 surge 免费版会掐断大文件传输、
且连接复用会失效，已改为 GitHub Pages 为主。）

任何人打开这个网址就能用。首次打开会弹「模型设置」，填自己的 API Key 即可开始。

| 项 | 值 |
|---|---|
| 应用名 | 灯叙 - Z测试版 |
| 托管平台 | surge.sh（免费版） |
| 正式域名 | `ai-rp-engine.surge.sh` |
| 账号邮箱 | `2825470443@qq.com` |
| 账号密码 | `ss3344520-zh` |
| 本次部署内容 | 6 个文件，约 836 KB（`dist/`） |

> ⚠️ **这个文件含明文密码，不要提交到公开仓库。**
> 想改密码：登录 <https://surge.sh> 或用 `surge` 重新注册。
> surge 的登录令牌存在用户目录（`~/.netrc` / `%USERPROFILE%\.netrc`），本文件只是为了你自己备忘。

---

## ⚠️ surge 免费版会掐断大文件传输（已修复，但要知道原因）

**现象**：页面显示「脚本 xxx.js 加载失败」，控制台 `net::ERR_CONNECTION_RESET`。
清缓存、换浏览器、换设备都无效 —— 因为根本不是缓存问题。

**根因**：surge 免费 CDN 传输较大文件时会在约 12 秒后重置连接。
实测同一份产物反复抓取：

| 单个文件大小 | 成功率 |
|---|---|
| 810 KB（最早的单文件产物） | **3/8** |
| 284 KB | 5/6 |
| ≤ 232 KB | 6/6 |

而且浏览器对**模块加载失败不做任何重试** —— 关键路径上任一文件被重置，整页就白屏。

**已经做的四件事**：

1. **代码分割**（`vite.config.ts` 的 `manualChunks`）
   把产物拆成 entry / vendor / motion / icons / markdown，
   并让 `NarrativeView`（markdown 那块）与 `CardEditor` **懒加载** ——
   卡库首页不再需要下载 280 KB 的 markdown 解析链。
2. **去掉外部字体**
   原 `index.html` 引 Google Fonts 的 Noto Serif SC（中文字体按分片拉上百个文件），
   冷启动会并发约 20 个 woff2 请求，把连接预算耗光。
   改成系统字体栈后：0 个外部请求。中文观感基本不变。
3. **守卫自动重载自愈**（`index.html`）
   检测到脚本 / modulepreload 失败或首屏 20 秒未挂载时，**自动重载**（最多 2 次，
   计数存 sessionStorage，避免死循环）；用尽后才显示手动界面。
   应用成功跑起来 8 秒后计数清零。
4. **懒加载 chunk 的重试 + 局部错误边界**
   `src/utils/lazyWithRetry.ts` 原地重试 1 次，再失败则整页重载；
   `ChunkErrorBoundary` 保证单块失败只影响那一块，不会整页崩。

**效果**：首屏挂载成功率从 **1/8 提升到 8/8**，冷启动挂载耗时从 ~13 秒降到 ~4 秒。

**如果哪天又出现白屏**：页面会自己重试两次；仍不行时手动点「重新加载」。
连续多次不行，说明 surge 正在限流（同一出口 IP 频繁访问会被限），
等几分钟或换网络即可 —— 或者换更稳的托管（见下方 GitHub Pages / Netlify / Vercel）。

---

## 关于「改了代码但访客还看到旧版」

每次构建，JS/CSS 的文件名都会带上新的内容哈希（如 `index-CFdJUiuV.js`）。
如果访客的浏览器缓存了**旧版 index.html**，它引用的还是旧文件名，而那个文件在新部署里已不存在 → 404 → 白屏。

surge 的缓存策略是 CDN 统一管理的（文档 `/docs/platform/`：只支持
`CNAME` / `.surgeignore` / `200.html` / `404.html` / `ROUTER` / `AUTH` / `CORS` 这些控制文件，
**没有**自定义 `Cache-Control` 的机制），所以没办法从服务端强制 HTML 不缓存。

应对办法已经做进站点本身：`index.html` 里的白屏守卫会

1. 监听脚本的 `error` 事件，**立刻**发现是哪个文件没加载成功；
2. 显示「页面没能加载出来（脚本 xxx.js 加载失败）」；
3. 给出一个**「重新加载」按钮**，点击会在网址后附加 `?_r=<时间戳>` 绕过缓存。

访客遇到时点一下即可；实在不行用无痕窗口打开一定能看到最新版。

`dist/200.html` 是按 surge 的 SPA 约定生成的（未匹配的路径返回应用外壳而不是 404）。

---

## 重新发布（改完代码后）

`pale-notes-web` 目录下：

```bash
pnpm install          # 首次
pnpm build            # 生成 dist/
npx surge dist ai-rp-engine.surge.sh
```

第一次会让你输入邮箱和密码（就是上表那两个），之后本机会记住登录状态。

或者用 package.json 里备好的脚本（域名随机会变，不推荐用于更新已有站点）：

```bash
pnpm deploy:surge
```

### 换成自己的域名

```bash
npx surge dist 你的域名.surge.sh
```

想用完全自定义的域名（如 `rp.example.com`），在 surge 里先把域名的 CNAME 指向
`na-west1.surge.sh`，然后 `npx surge dist rp.example.com`。

---

## 更新上线后怎么确认成功

```bash
curl -I https://ai-rp-engine.surge.sh/
```

应返回 `HTTP/2 200`。JS/CSS 带内容哈希，文件名变了就说明是新版本。

---

## 注意

- **不要**把 API Key 写进代码再发布 —— 访客各自填自己的
- 世界卡存在**访客自己的浏览器**（IndexedDB），不会在访客之间共享。
  想让大家用你的设定，把世界卡导出成 JSON 一起发布
- 免费版 surge 没有流量统计面板；要看访问量得自己接第三方统计
