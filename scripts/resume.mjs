/**
 * 灯叙项目 · 一键恢复上下文
 *
 * 为什么用 Node 而不是 .ps1：
 *   本机 PowerShell 的 ExecutionPolicy 禁止运行 .ps1 脚本
 *   （`& script.ps1` 会报 SecurityError），必须先改策略或用
 *   `-ExecutionPolicy Bypass`，对新会话来说是个多余的坑。
 *   项目本来就依赖 node，所以直接写成 .mjs，一次都不用配置。
 *
 * 用法（两种位置都能跑，路径自适应）：
 *   node D:\工作区\resume.mjs
 *   node D:\工作区\pale-notes-web\scripts\resume.mjs
 *   node D:\工作区\resume.mjs --skip-tests    # 只起服务
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 这份脚本有两个副本：工作区根目录（入口）与仓库 scripts/（版本控制）。
 * 所以仓库根要**从自身位置向上查找**（找带 package.json 且名为 pale-notes-web 的目录），
 * 不能只查一层 —— 放在 scripts/ 里时上一层才是仓库根。
 */
function findRepoRoot(start) {
  let dir = start
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'src', 'App.tsx'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  // 兜底：按约定路径
  return 'D:\\工作区\\pale-notes-web'
}
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = findRepoRoot(HERE)
const LOCAL = path.resolve(ROOT, '..', 'pale-notes-local')

const NODE = process.execPath
const GIT = 'D:\\工作区\\.tools\\git\\cmd\\git.exe'
const GH = 'D:\\工作区\\.tools\\git-home'
const PORT = Number(process.env.PORT || 5199)
const SKIP_TESTS = process.argv.includes('--skip-tests')

const sleep = ms => new Promise(r => setTimeout(r, ms))
const C = { g: s => `\x1b[32m${s}\x1b[0m`, y: s => `\x1b[33m${s}\x1b[0m`, r: s => `\x1b[31m${s}\x1b[0m`, c: s => `\x1b[36m${s}\x1b[0m` }

const gitEnv = { ...process.env, HOME: GH, USERPROFILE: GH, GIT_CONFIG_GLOBAL: `${GH}\\.gitconfig`, GIT_TERMINAL_PROMPT: '0' }
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts })

console.log('\n' + C.c('=== 灯叙 · 环境恢复 ==='))

// ── 1. 校验工具链 ──
const missing = [NODE, ROOT, GH].filter(p => !fs.existsSync(p))
if (missing.length) {
  console.log(C.r('✗ 以下路径不存在：'))
  missing.forEach(p => console.log('    ' + p))
  console.log(C.y('  项目可能被移动过，请先检查。'))
  process.exit(1)
}
console.log(C.g('✓ 工具链路径正常'))

// ── 2. 仓库状态 ──
const head = run(GIT, ['log', '--oneline', '-1'], { cwd: ROOT, env: gitEnv }).stdout?.trim()
const dirty = (run(GIT, ['status', '--short'], { cwd: ROOT, env: gitEnv }).stdout || '').trim()
console.log(`  当前提交: ${head}`)
if (dirty) {
  const n = dirty.split('\n').length
  console.log(C.y(`  ⚠ 有 ${n} 个未提交的改动`))
} else {
  console.log(C.g('  ✓ 工作区干净'))
}

// ── 3. 两个副本是否一致 ──
const dirBytes = d => {
  let total = 0
  const walk = p => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const fp = `${p}\\${e.name}`
      if (e.isDirectory()) walk(fp)
      else total += fs.statSync(fp).size
    }
  }
  if (fs.existsSync(d)) walk(d)
  return total
}
if (fs.existsSync(`${LOCAL}\\src`)) {
  const a = dirBytes(`${ROOT}\\src`)
  const b = dirBytes(`${LOCAL}\\src`)
  console.log(a === b ? C.g('  ✓ 本地副本 src 与主仓库一致') : C.y('  ⚠ 本地副本 src 不一致，需要 robocopy 同步'))
}

// ── 4. 类型检查 ──
if (!SKIP_TESTS) {
  console.log('\n' + C.c('=== 类型检查 ==='))
  const tsc = run(NODE, ['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.json'], { cwd: ROOT })
  const out = ((tsc.stdout || '') + (tsc.stderr || '')).trim()
  if (out) console.log(out.split('\n').slice(0, 12).join('\n'))
  console.log(tsc.status === 0 ? C.g('✓ tsc 无错误') : C.r('✗ tsc 有错误（见上）'))

  // ── 5. 单元测试 ──
  console.log('\n' + C.c('=== 单元测试（期望 239 条通过）==='))
  const vt = run(NODE, ['node_modules/vitest/vitest.mjs', 'run'], { cwd: ROOT })
  const vout = ((vt.stdout || '') + (vt.stderr || ''))
  for (const line of vout.split('\n')) {
    if (/Test Files|Tests |FAIL|×/.test(line)) console.log('  ' + line.trim())
  }
}

// ── 6. 起 dev server ──
console.log('\n' + C.c('=== 启动 dev server ==='))
const probe = () => new Promise(res => {
  const req = http.get(`http://localhost:${PORT}/`, r => { r.resume(); res(r.statusCode === 200) })
  req.on('error', () => res(false))
  req.setTimeout(3000, () => { req.destroy(); res(false) })
})

if (await probe()) {
  console.log(C.y(`  端口 ${PORT} 已有服务在跑，直接复用`))
} else {
  spawn(NODE, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true,
  }).unref()
  let ok = false
  for (let i = 0; i < 40; i++) { await sleep(1000); if (await probe()) { ok = true; break } }
  console.log(ok ? C.g(`  ✓ dev server 就绪：http://localhost:${PORT}/`) : C.r('  ✗ dev server 启动失败'))
}

// ── 7. 下一步 ──
console.log('\n' + C.c('=== 下一步 ==='))
console.log(`
  跑全部浏览器走查（8 套 154 项）：
    $env:SITE = 'http://localhost:${PORT}/'
    & '${NODE}' '${ROOT}\\scripts\\checks\\all.mjs'

  只跑某一套（例如地图）：
    & '${NODE}' '${ROOT}\\scripts\\checks\\map-gallery.mjs'

  对照图输出在： ${ROOT}\\playtest-shots\\

  先读： D:\\工作区\\HANDOFF.md（自包含交接文档）
`)
