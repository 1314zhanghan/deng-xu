# 从这里开始（下一个会话）

> 新会话的 AI：**先读 `D:\工作区\HANDOFF.md`**（自包含交接文档）。
> 这个文件只是一份"最短路径"清单，方便你快速恢复上下文。

---

## 30 秒恢复上下文

```powershell
$node = "C:\Users\28254\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
& $node "D:\工作区\resume.mjs"
```

它会：
1. 校验 `$node` / 仓库 / git-home 路径是否存在
2. 显示当前提交与工作区是否干净
3. 校验 `pale-notes-local` 的 `src` 与主仓库是否一致
4. 跑 `tsc --noEmit`（应 0 错误）
5. 跑单元测试（应 **239 条通过**）
6. 启动 dev server 在 5199 端口

> **为什么是 `.mjs` 而不是 `.ps1`**：本机 PowerShell 的 ExecutionPolicy
> 禁止运行脚本（`& script.ps1` 报 SecurityError）。项目本来就依赖 node，
> 写成 `.mjs` 就完全绕开了这个配置问题。
>
> 脚本有**两份**：`D:\工作区\resume.mjs`（入口）与
> `D:\工作区\pale-notes-web\scripts\resume.mjs`（版本控制）。
> 两份内容相同，路径会**自动向上查找仓库根**，从哪跑都行。

然后你可以：

```powershell
# 跑全部浏览器走查（8 套 154 项）
$env:SITE = "http://localhost:5199/"
& $node "D:\工作区\pale-notes-web\scripts\checks\all.mjs"
```

---

## 交接文件一览

| 文件 | 用途 |
|---|---|
| `D:\工作区\HANDOFF.md` | **主交接文档**（自包含，22 KB）。也可在仓库里找到同一份 |
| `D:\工作区\接下来.md` | 本文件，最短路径清单 |
| `D:\工作区\resume.mjs` | 一键环境恢复 + 健康检查 |
| `pale-notes-web\ROADMAP.md` | 已完成 51 项 + 待办清单 + 方法论 |
| `pale-notes-web\NOTICE.md` | 许可证说明（**GPL-3.0-only，不能改**） |

---

## 事实速查

| 项 | 值 |
|---|---|
| 线上地址 | https://fyjsj-zh.github.io/deng-xu/ |
| 仓库 | https://github.com/FyJsJ-ZH/deng-xu |
| 主开发目录 | `D:\工作区\pale-notes-web` |
| 本地副本 | `D:\工作区\pale-notes-local`（非 git） |
| 当前 HEAD | `11f3ed0`（CI #33 成功，已部署） |
| 许可证 | **GPL-3.0-only（不能改）** |
| 单元测试 | **239 条 / 11 文件** |
| 浏览器走查 | **8 套 / 154 项** |
| 像素部件 | 246 个 |
| 内置世界 | 9 个 |

---

## 建议的第一个任务

**把 RPG 地图再提升一档**（玩家盯着看最久的画面）：

1. 先跑 `scripts/checks/map-gallery.mjs`，**打开 `playtest-shots/map-gallery.png` 看图**
2. 读 `src/utils/rpgMap.ts` 的 `drawTile()` 与 `buildLayout()`
3. 加**地形过渡**（草地→石板的边缘）
4. 加**装饰物**（芦苇、指示牌、杂物、阴影），密度用 seed 控制
5. 每改一步都重跑画廊并看图

详见 `HANDOFF.md` 第 9、10 节。

---

## 五条最容易踩的坑（详见 HANDOFF 第 6 节）

1. **绝不用 PowerShell 改源码** —— 反引号是转义符，会弄坏文件。用 read/edit/write 工具。
2. **改完源码必须重启 dev server** —— HMR 对我通过 CDP 动态 import 的模块不生效。
3. **断言失败时先怀疑断言** —— 这个项目里探针误报过 15 次以上。
4. **看不清就画出来看** —— 别用间接指标（像素覆盖率之类）猜。
5. **git commit message 不能含英文双引号** —— 会截断参数。

---

## 提交前必做

```powershell
$node = "C:\Users\28254\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
$git  = "D:\工作区\.tools\git\cmd\git.exe"
$gh   = "D:\工作区\.tools\git-home"
Set-Location "D:\工作区\pale-notes-web"

# 1. 类型 + 测试
& $node "node_modules/typescript/bin/tsc" --noEmit -p tsconfig.json
& $node "node_modules/vitest/vitest.mjs" run

# 2. 构建
& $node "node_modules/vite/bin/vite.js" build
& $node "scripts/make-404.mjs"

# 3. 同步本地副本
robocopy "D:\工作区\pale-notes-web\src" "D:\工作区\pale-notes-local\src" /MIR /NFL /NDL /NJH /NJS

# 4. 推送（记得设 HOME）
$env:HOME = $gh; $env:USERPROFILE = $gh; $env:GIT_CONFIG_GLOBAL = "$gh\.gitconfig"
& $git add -A
& $git commit -m "无引号的提交信息"
& $git push origin main

# 5. 盯 CI（约 3-5 分钟）
& $node "D:\工作区\.tools\watch-ci.mjs"
```
