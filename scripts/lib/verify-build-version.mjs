/**
 * 端到端验证「版本探测自动重载」真的工作。
 *
 * ## 场景怎么造（第一版我造错了）
 *
 * 第一版我直接改页面里的 `window.__DX_BUILD__`，结果不触发 ——
 * 因为探测脚本用的是**闭包常量** `BUILD`（这正是它该有的样子：页面"代表"哪个构建，
 * 在页面加载时就定死了）。改一个全局变量当然影响不了它。
 *
 * 正确的造法是把**线上那一侧**换掉：
 *   ① 打开页面（内嵌 build A）
 *   ② 把 `dist/version.json` 改成 build B —— 这等价于"线上已经部署了新版"
 *   ③ 逼旧页面探测 → 它应当发现 B ≠ A 并带 `?_v=B` 重载
 *   ④ 重载后 `index.html` 内嵌的**仍是 A**（文件本身没变）→ 它还会探测到不一致，
 *      但 `sessionStorage` 标记必须拦住第二次重载 —— 否则用户会陷入刷新循环打不开页面
 *
 * 第④步是这个方案最危险的地方，所以测试必须覆盖它。
 */
import '../checks/_ws-shim.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { launch, sleep, profileDir, removeProfile } from '../checks/_browser.mjs'

const SITE = process.env.PREVIEW || 'http://localhost:4173/'
const VERSION_FILE = path.resolve(process.cwd(), 'dist/version.json')
const PROFILE = profileDir('verprobe')
const { send, ev, close, errors } = await launch({ port: 9997, userDataDir: PROFILE, viewport: { width: 900, height: 700 } })

let pass = 0, fail = 0
const check = (n, ok, x = '') => { console.log(`  ${ok ? '✓' : '✗'} ${n}${x ? '   —— ' + x : ''}`); ok ? pass++ : fail++ }
const waitFor = async (e, t = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < t) { if (await ev(e)) return true; await sleep(200) } return false }

const originalVersion = fs.readFileSync(VERSION_FILE, 'utf8')
const restore = () => { try { fs.writeFileSync(VERSION_FILE, originalVersion, 'utf8') } catch {} }

try {
  await send('Runtime.enable'); await send('Page.enable')
  await send('Page.navigate', { url: SITE })
  await waitFor(`typeof window.__DX_BUILD__ === 'string' && window.__DX_BUILD__.length > 0`, 20000)

  console.log('\n=== ① 页面标识 = 线上 version.json（此时不该重载）===')
  const a = JSON.parse(await ev(`(async () => {
    const v = await (await fetch('./version.json?t=' + Date.now(), { cache: 'no-store' })).json();
    return JSON.stringify({ page: window.__DX_BUILD__, remote: v.build });
  })()`))
  check('页面注入了 __DX_BUILD__', !!a.page, a.page)
  check('version.json 与页面一致（干净状态）', a.page === a.remote, `page=${a.page} remote=${a.remote}`)
  await sleep(2500)
  check('一致时不会无故重载', !/_v=/.test(String(await ev(`location.search`))))

  console.log('\n=== ② 把线上换成"新版本"（改 dist/version.json）===')
  const NEW = 'TEST-NEW-' + Date.now()
  fs.writeFileSync(VERSION_FILE, JSON.stringify({ build: NEW, time: new Date().toISOString() }), 'utf8')
  // 直接向服务器确认它已经在返回新值（否则后面的失败会归因错地方）
  const served = JSON.parse(await (await fetch(SITE + 'version.json?t=' + Date.now())).text())
  check('服务器已在返回新版本号', served.build === NEW, served.build)

  console.log('\n=== ③ 逼旧页面探测 → 应当自动重载到新版 ===')
  await ev(`(() => { try { sessionStorage.removeItem('dengxu:build-reload') } catch (e) {} document.dispatchEvent(new Event('visibilitychange')); return 1 })()`)
  const reloaded = await waitFor(`/_v=/.test(location.search)`, 12000)
  check('★ 检测到版本不一致后自动重载（带 ?_v=）', reloaded, reloaded ? String(await ev(`location.search`)) : '超时未重载')

  console.log('\n=== ④ 防死循环：不该反复重载 ===')
  await sleep(4000)
  const marker = await ev(`sessionStorage.getItem('dengxu:build-reload')`)
  check('留下了"已为该版本重载过"的标记', marker === NEW, String(marker))
  // 再逼两次；每次都会探到不一致，但标记必须拦住它
  for (let i = 0; i < 2; i++) {
    await ev(`(() => { document.dispatchEvent(new Event('visibilitychange')); return 1 })()`)
    await sleep(2000)
  }
  const navs = await ev(`performance.getEntriesByType('navigation').length`)
  check('★ 没有陷入刷新循环（导航次数可控）', Number(navs) <= 2, `navigation entries=${navs}`)
  const stillAlive = await ev(`!!document.querySelector('#root')`)
  check('页面仍然可用（没有被刷成白屏）', !!stillAlive)
} finally {
  restore()
}

console.log(`\n=== 汇总 ===\n  通过 ${pass}/${pass + fail}`)
console.log('  运行期报错: ' + (errors.length ? [...new Set(errors)].slice(0, 3).join(' | ') : '(无)'))
close(); removeProfile(PROFILE)
process.exit(fail ? 1 : 0)
