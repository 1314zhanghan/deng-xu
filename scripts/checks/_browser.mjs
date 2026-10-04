/**
 * 浏览器走查的公共工具。
 *
 * 抽出来的原因：主菜单 / 玩家体验 / 出错路径 / 手机端四个走查
 * 都要做同一件事 —— 找到一个 Edge、开 CDP、连上去、发命令。
 * 各自抄一份的话，改 Edge 路径要改四处。
 *
 * **Edge 路径必须自动探测**：本地装在 `Program Files (x86)`，
 * 而 CI（windows-latest）装在 `Program Files`，还可能是别的版本目录。
 * 写死路径会让走查在 CI 上直接跑不起来。
 */
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const CANDIDATES = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)

export function findBrowser() {
  for (const c of CANDIDATES) {
    try { if (fs.existsSync(c)) return c } catch { /* 忽略 */ }
  }
  throw new Error('找不到 Edge / Chrome。可用 EDGE_PATH 环境变量指定。')
}

export const sleep = ms => new Promise(r => setTimeout(r, ms))

export const getJson = u => new Promise((res, rej) => {
  http.get(u, r => {
    let d = ''
    r.on('data', c => d += c)
    r.on('end', () => { try { res(JSON.parse(d)) } catch (e) { rej(e) } })
  }).on('error', rej)
})

/**
 * 启动浏览器并通过 CDP 连上第一个页面。
 *
 * 返回一组操作句柄。用 `--headless=new`：CI 没有显示器，
 * 而新版 headless 与真实渲染路径一致（老 `--headless` 会漏掉一些布局行为，
 * 我第一版用它时 `getBoundingClientRect` 拿到的尺寸和真机不一样）。
 */
export async function launch({ port, userDataDir, viewport, mobile = false, extraArgs = [] }) {
  const bin = findBrowser()
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    `--window-size=${viewport?.width || 1280},${viewport?.height || 900}`,
    ...extraArgs,
    'about:blank',
  ]
  fs.mkdirSync(userDataDir, { recursive: true })
  const proc = spawn(bin, args, { stdio: 'ignore' })

  let ready = false
  for (let i = 0; i < 60; i++) {
    try { await getJson(`http://127.0.0.1:${port}/json/version`); ready = true; break } catch { await sleep(500) }
  }
  if (!ready) { try { proc.kill() } catch { /* 忽略 */ } ; throw new Error(`浏览器未在端口 ${port} 就绪`) }

  const list = await getJson(`http://127.0.0.1:${port}/json/list`)
  const page = list.find(x => x.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

  let id = 0
  const pend = new Map()
  const errors = []
  ws.onmessage = e => {
    const m = JSON.parse(e.data)
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').split('\n')[0])
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      const txt = (m.params.args || []).map(a => a.value || a.description || '').join(' ')
      // 已知无害的噪音：扩展连接失败、探针用假 Key 触发的鉴权失败
      if (!/Could not establish connection|Authentication|api key|Game Engine Error/i.test(txt)) {
        errors.push('console.error: ' + txt.slice(0, 140))
      }
    }
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) }
  }
  const send = (method, params = {}) => new Promise(r => {
    const i = ++id; pend.set(i, r)
    ws.send(JSON.stringify({ id: i, method, params }))
  })
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    return r.result?.exceptionDetails
      ? 'THREW ' + (r.result.exceptionDetails.exception?.description || '')
      : r.result?.result?.value
  }

  await send('Runtime.enable')
  await send('Page.enable')
  if (viewport) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width, height: viewport.height,
      deviceScaleFactor: viewport.dsf || 1, mobile,
    })
  }
  if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })

  const shot = async (file) => {
    const s = await send('Page.captureScreenshot', { format: 'png' })
    if (s.result?.data) {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, Buffer.from(s.result.data, 'base64'))
    }
  }

  const close = () => {
    try { ws.close() } catch { /* 忽略 */ }
    try { proc.kill() } catch { /* 忽略 */ }
  }

  return { send, ev, shot, close, errors, page }
}

/** 一套简单的断言收集器，四个走查共用同一套输出格式 */
export function makeChecker() {
  const results = []
  const check = (label, ok, extra = '') => {
    results.push({ label, ok: !!ok })
    console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? '  ' + extra : ''}`)
  }
  const summary = (errors = []) => {
    const failed = results.filter(r => !r.ok)
    console.log('\n=== 汇总 ===')
    console.log(`  通过 ${results.length - failed.length}/${results.length}`)
    if (failed.length) {
      console.log('  未通过:')
      failed.forEach(r => console.log('    · ' + r.label))
    }
    console.log('  运行期异常:', errors.length ? [...new Set(errors)].slice(0, 4) : '(无)')
    return failed.length === 0 && errors.length === 0
  }
  return { check, summary, results }
}

/** 等 dev server 起来（CI 里 build 之后要等它监听端口） */
export async function waitForServer(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      await new Promise((res, rej) => {
        const req = http.get(url, r => { r.resume(); res(r.statusCode) })
        req.on('error', rej)
        req.setTimeout(3000, () => { req.destroy(); rej(new Error('timeout')) })
      })
      return true
    } catch { await sleep(1000) }
  }
  return false
}
