/**
 * 看一眼 —— 一条命令截图并用 markdown 输出可读路径。
 *
 * ## 为什么需要它
 *
 * 这个项目一半以上的返工，都是"我以为我看过了，其实我看的是错的信号"。
 * 交接文档自述误报 15+ 次，全部属于这一类：
 *   · 量 `<img>` 的固有尺寸，却以为在量大立绘实际显示尺寸
 *   · 用"不透明像素比例"猜哪件衣服露躯干，结论和肉眼完全相反
 *   · 卡片编辑器里点错了元素，却断言"功能坏了"
 *
 * 而现在 agent 已经能**直接读图**（read_image）。所以正确的做法不是
 * 继续设计更聪明的间接指标，而是**把图直接拿来看**。
 *
 * 以前要看一眼得走三步：起 dev server → 起 Edge + CDP → 手动 captureScreenshot，
 * 还得记得「改完源码必须重启 dev server，否则 HMR 对 CDP 动态 import 不生效」。
 * 这个脚本把这三步收成一条命令，并**直接把可读路径打出来**。
 *
 * ## 用法
 *
 *   node scripts/see.mjs                                  # 首页，桌面视口
 *   node scripts/see.mjs --path=/                    # 同上
 *   node scripts/see.mjs --mobile                     # 手机视口 390×844
 *   node scripts/see.mjs --viewport=1280x720
 *   node scripts/see.mjs --wait=.action-input         # 等某个元素出现再截
 *   node scripts/see.mjs --settle=4000                # 额外多等 4 秒（等生成动画）
 *   node scripts/see.mjs --full                       # 整页（含滚动区域）
 *   node scripts/see.mjs --name=after-fix             # 指定输出文件名
 *   node scripts/see.mjs --action="__navStore && __navStore.push({name:'game'})"
 *   node scripts/see.mjs --url=http://localhost:5199/  # 覆盖 SITE
 *   node scripts/see.mjs --fresh                      # 先清空本地存储再加载（看"新玩家首屏"）
 *
 * ## ⚠️ 两个会误导你的坑（都踩过）
 *
 *   1. **残留状态**：localStorage 里可能留着 `isGameStarted: true`、
 *      或某个浮层是开着的，于是截图看起来像"页面坏了"。
 *      要复现新玩家首屏，加 `--fresh`。
 *   2. **改了源码没生效**：dev server 的模块缓存 + HMR 对 CDP 动态 import 不生效。
 *      本脚本每次都用**全新的浏览器 profile**，但**不会重启 dev server** ——
 *      如果你改了源码，先重启 dev server 再用它截图。
 *
 * 输出示例：
 *
 *   ✓ 截图已保存
 *      D:\工作区\pale-notes-web\playtest-shots\see-20261006-2130.png
 *   （在回答里这样引用：![截图](pale-notes-web/playtest-shots/see-20261006-2130.png)）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch, sleep, waitForServer, outDir, profileDir, removeProfile } from './checks/_browser.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')

// ── 参数 ──
const argv = process.argv.slice(2)
const argVal = (name, dflt = undefined) => {
  const hit = argv.find(a => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : dflt
}
const has = name => argv.includes(`--${name}`) || argv.some(a => a.startsWith(`--${name}=`))

const SITE = argVal('url', process.env.SITE || 'http://localhost:5199/')
const MOBILE = has('mobile')
const viewportArg = argVal('viewport')
const VIEWPORT = viewportArg
  ? (() => {
      const m = viewportArg.match(/^(\d+)x(\d+)$/)
      if (!m) { console.error('✗ --viewport 格式应为 宽x高，例如 390x844'); process.exit(1) }
      return { width: +m[1], height: +m[2] }
    })()
  : MOBILE ? { width: 390, height: 844 } : { width: 1280, height: 900 }
const WAIT_SELECTOR = argVal('wait')
const SETTLE = Number(argVal('settle', '1200'))
const FULL_PAGE = has('full')
const ACTION = argVal('action')
const FRESH = has('fresh')
const PATH_SUFFIX = argVal('path', '')
const CDP_PORT = Number(argVal('port', '9960'))

const OUT = outDir()

function stamp() {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}
const NAME = argVal('name') || `see-${stamp()}`
const OUT_FILE = path.join(OUT, NAME.endsWith('.png') ? NAME : `${NAME}.png`)

// ── 1) 先确认目标可达 ──
/*
  默认目标是本地 dev server，所以先探测一下、失败时给出"怎么起 dev server"的提示
  ——那是这个工具最常见的失败原因。

  但**如果用户显式给了 --url**（例如线上站点），就不该再要求本地 5199 活着：
  第一版没有区分这两种情况，结果 `--url=https://...` 仍然去探测 localhost，
  硬生生报"dev server 没响应"——**探测目标和实际目标不一致**，
  又是一个"探针本身写错"的例子。
*/
console.log(`\n=== 看一眼 ===\n`)
console.log(`  目标：${SITE}${PATH_SUFFIX}`)
console.log(`  视口：${VIEWPORT.width}×${VIEWPORT.height}${MOBILE ? '（手机模式）' : ''}`)

const isLocalTarget = /^https?:\/\/(localhost|127\.0\.0\.1)\b/i.test(SITE)
if (isLocalTarget) {
  if (!(await waitForServer(SITE, 3))) {
    console.error(`\n✗ dev server 没响应：${SITE}`)
    console.error(`
  怎么起来（后台，端口 5199）：
    $node = "C:\\Users\\28254\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\node\\bin\\node.exe"
    Set-Location "${ROOT}"
    Start-Process -FilePath $node -ArgumentList "node_modules/vite/bin/vite.js","--port","5199","--strictPort" -WindowStyle Hidden

  ⚠️ 改完源码**必须重启 dev server** —— HMR 对通过 CDP 动态 import 的模块不生效，
     不重启就会看到改动前的旧代码，从而误判"改了没生效"。
`)
    process.exit(1)
  }
  console.log('  ✓ dev server 就绪')
} else {
  console.log('  （远端目标，跳过本地探测）')
}

// ── 2) 起浏览器并导航 ──
const url = PATH_SUFFIX
  ? new URL(PATH_SUFFIX.replace(/^\/*/, '/'), SITE).toString()
  : SITE

const PROFILE = profileDir('see')
const { send, ev, close, errors } = await launch({
  port: CDP_PORT,
  userDataDir: PROFILE,
  viewport: VIEWPORT,
  mobile: MOBILE,
})

const consoleErrors = []
try {
  await send('Page.navigate', { url })
  // 等页面 load 完成（比死等固定秒数可靠）
  await new Promise(resolve => {
    let done = false
    const finish = () => { if (!done) { done = true; resolve() } }
    // launch 里已经 Page.enable，这里用轮询 document.readyState 兜底
    const poll = async () => {
      for (let i = 0; i < 60; i++) {
        const rs = await ev('document.readyState')
        if (rs === 'complete') return finish()
        await sleep(250)
      }
      finish()
    }
    poll()
    setTimeout(finish, 20000)
  })
  console.log('  ✓ 页面已加载')

  if (FRESH) {
    // 先清空存储，再重新加载 —— 否则本地残留的 isGameStarted / 浮层状态
    // 会让截图看起来像"页面坏了"（这个项目里因此误判过多次）
    const before = await ev(`JSON.stringify({ n: localStorage.length, top: Object.keys(localStorage).slice(0,6) })`)
    await ev(`localStorage.clear(); sessionStorage.clear()`)
    await ev(`(async () => {
      try { const dbs = await indexedDB.databases(); for (const d of dbs) if (d.name) indexedDB.deleteDatabase(d.name) } catch {}
    })()`)
    console.log(`  ✓ 已清空本地存储（清前：${String(before).slice(0, 120)}），重新加载`)
    await send('Page.reload', { ignoreCache: true })
    for (let i = 0; i < 60; i++) {
      if (await ev('document.readyState') === 'complete') break
      await sleep(250)
    }
    await sleep(600)
  }

  if (WAIT_SELECTOR) {
    let found = false
    for (let i = 0; i < 80; i++) {
      if (await ev(`!!document.querySelector(${JSON.stringify(WAIT_SELECTOR)})`)) { found = true; break }
      await sleep(250)
    }
    console.log(`  ${found ? '✓' : '⚠'} 等待元素 ${WAIT_SELECTOR}：${found ? '已出现' : '超时未出现（仍然截图）'}`)
  }

  if (ACTION) {
    const r = await ev(ACTION)
    console.log(`  ✓ 已执行 --action，返回：${typeof r === 'string' ? r.slice(0, 120) : JSON.stringify(r)?.slice(0, 120)}`)
  }

  if (SETTLE > 0) await sleep(SETTLE)

  // 整页截图走 captureBeyondViewport（CDP 原生支持，比滚动拼接可靠）
  const cap = await send('Page.captureScreenshot', FULL_PAGE
    ? { format: 'png', captureBeyondViewport: true }
    : { format: 'png' })
  if (!cap.result?.data) throw new Error('captureScreenshot 没有返回数据')
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true })
  fs.writeFileSync(OUT_FILE, Buffer.from(cap.result.data, 'base64'))
} finally {
  consoleErrors.push(...errors)
  close()
  removeProfile(PROFILE)
}

if (!fs.existsSync(OUT_FILE)) {
  console.error('\n✗ 截图没有写出来（Page.captureScreenshot 失败）')
  process.exit(1)
}

const size = fs.statSync(OUT_FILE).size
const rel = path.relative(ROOT, OUT_FILE).replace(/\\/g, '/')

console.log(`\n  ✓ 截图已保存（${(size / 1024).toFixed(1)} KB，整页=${FULL_PAGE}）`)
console.log(`\n      ${OUT_FILE}`)
console.log(`\n  在回答里引用它：`)
console.log(`      ![截图](${rel})`)
console.log(`  或直接把上面的绝对路径交给读图能力。`)

if (consoleErrors.length) {
  console.log(`\n  ⚠ 页面运行期报错 ${consoleErrors.length} 条：`)
  for (const e of [...new Set(consoleErrors)].slice(0, 5)) console.log('      ' + e)
} else {
  console.log('\n  ✓ 页面无运行期报错')
}
console.log('')
