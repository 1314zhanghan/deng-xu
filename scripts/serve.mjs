/**
 * 零依赖静态文件服务器
 *
 * 用途：把 pnpm build 产出的 dist/ 用 HTTP 托管起来，
 * 让浏览器像访问普通网站那样直接打开 http://localhost:端口 就能玩。
 *
 * 为什么不能直接双击 dist/index.html：
 *   构建产物是 ES module（<script type="module">），浏览器的 file:// 协议
 *   会按同源策略拦掉模块加载，页面上什么都不会出现。必须走 HTTP。
 *
 * 用法：
 *   node scripts/serve.mjs [--port 5173] [--root dist] [--host 0.0.0.0] [--open]
 */

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

// ---------- 参数 ----------
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const hasFlag = (name) => process.argv.includes(`--${name}`)

const PORT = Number(arg('port', 5173))
const HOST = arg('host', '0.0.0.0')
const ROOT = path.resolve(projectRoot, arg('root', 'dist'))

// ---------- MIME ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
}

function contentType(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
}

/**
 * 把请求路径映射到 ROOT 下的真实文件，并保证不会越出 ROOT。
 * 返回 null 表示不存在（交给调用方决定是否回退到 index.html）。
 */
function resolveSafe(urlPath) {
  let decoded
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0])
  } catch {
    return null
  }
  // 归一化后拼接，再用前缀校验挡住 ../ 穿越
  const normalized = path.normalize(decoded).replace(/^([/\\])+/, '')
  const full = path.resolve(ROOT, normalized)
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null
  return full
}

function statFile(p) {
  try {
    const st = fs.statSync(p)
    return st.isFile() ? st : null
  } catch {
    return null
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Method Not Allowed')
    return
  }

  let target = resolveSafe(req.url || '/')
  if (!target) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Bad Request')
    return
  }

  let st = statFile(target)

  // 目录 → 目录下的 index.html
  if (!st && fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    const indexPath = path.join(target, 'index.html')
    if (statFile(indexPath)) {
      target = indexPath
      st = statFile(target)
    }
  }

  // 单页应用回退：找不到的路径统一交给 index.html
  if (!st) {
    const fallback = path.join(ROOT, 'index.html')
    const fbStat = statFile(fallback)
    if (!fbStat) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('404 Not Found —— 请先执行 pnpm build 生成 dist/')
      return
    }
    target = fallback
    st = fbStat
  }

  const ext = path.extname(target).toLowerCase()
  const rel = path.relative(ROOT, target)

  // 带内容指纹的构建产物可以长期缓存；入口 HTML 必须每次都校验，
  // 否则重新构建后浏览器还在跑旧版本。
  const headers = {
    'Content-Type': contentType(target),
    'X-Content-Type-Options': 'nosniff',
  }
  if (rel === 'index.html' || ext === '.html') {
    headers['Cache-Control'] = 'no-cache'
  } else if (/[.-][A-Za-z0-9_-]{8,}\.(js|css)$/.test(rel)) {
    headers['Cache-Control'] = 'public, max-age=31536000, immutable'
  } else {
    headers['Cache-Control'] = 'no-cache'
  }

  // 优先发送预压缩产物（如果构建时生成了 .gz），省 CPU
  const acceptEncoding = String(req.headers['accept-encoding'] || '')
  let sendPath = target
  if (acceptEncoding.includes('gzip')) {
    const gz = target + '.gz'
    if (statFile(gz)) {
      sendPath = gz
      headers['Content-Encoding'] = 'gzip'
      headers['Vary'] = 'Accept-Encoding'
    }
  }

  const sendStat = statFile(sendPath) || st
  headers['Content-Length'] = String(sendStat.size)
  headers['Last-Modified'] = sendStat.mtime.toUTCString()

  res.writeHead(200, headers)
  if (req.method === 'HEAD') {
    res.end()
    return
  }

  const stream = fs.createReadStream(sendPath)
  stream.on('error', () => {
    if (!res.headersSent) res.writeHead(500)
    res.end()
  })
  stream.pipe(res)
})

/**
 * 检查 dist 是否是**完整**的构建产物。
 * 只看 index.html 不够：构建中途被打断（比如窗口被关掉）时会留下
 * 一个只有 public/ 静态文件的残缺目录，此时页面能打开但资源全 404，
 * 用户只会看到白屏，完全猜不到原因。这里提前把情况说清楚。
 */
function inspectDist() {
  const indexHtml = path.join(ROOT, 'index.html')
  if (!statFile(indexHtml)) {
    return { ok: false, reason: `找不到 ${path.relative(projectRoot, indexHtml)}` }
  }
  const assetsDir = path.join(ROOT, 'assets')
  let js = null
  let css = null
  try {
    const files = fs.readdirSync(assetsDir)
    js = files.find((f) => f.endsWith('.js')) || null
    css = files.find((f) => f.endsWith('.css')) || null
  } catch {
    // assets 不存在
  }
  if (!js) {
    return {
      ok: false,
      reason: `${path.relative(projectRoot, assetsDir)} 里没有 JS 产物，构建可能只完成了一半`,
    }
  }
  return { ok: true, js, css }
}

const distState = inspectDist()
if (!distState.ok) {
  console.error('')
  console.error('  [x] dist 不是完整的构建产物，无法启动。')
  console.error(`      原因：${distState.reason}`)
  console.error('')
  console.error('  请重新构建后重试：')
  console.error('      pnpm build')
  console.error('  或者直接重新运行 start.bat（它会自动重新构建）。')
  console.error('')
  process.exit(1)
}
console.log(`[serve] asset=${distState.js}${distState.css ? `, ${distState.css}` : ''}`)

// 端口被占用时自动往后找，避免因为一个端口冲突就启动失败
async function listen(port, attempts = 30) {
  for (let i = 0; i < attempts; i++) {
    const current = port + i
    const ok = await new Promise((resolve) => {
      const onError = (err) => {
        server.removeListener('listening', onListening)
        if (err.code === 'EADDRINUSE' || err.code === 'EACCES') resolve(false)
        else {
          console.error('[serve] 启动失败：', err.message)
          process.exit(1)
        }
      }
      const onListening = () => {
        server.removeListener('error', onError)
        resolve(true)
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(current, HOST)
    })
    if (ok) return current
  }
  return null
}

// 供 start.ps1 读取实际端口：同时写一行机器可读的输出
const finalPort = await listen(PORT)
if (finalPort === null) {
  console.error(`[serve] 从 ${PORT} 起连续 30 个端口都被占用`)
  process.exit(1)
}

console.log(`[serve] root=${path.relative(projectRoot, ROOT) || '.'} host=${HOST} port=${finalPort}`)
console.log(`SERVE_READY ${finalPort}`)

if (hasFlag('open')) {
  const url = `http://localhost:${finalPort}/`
  const cmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  import('node:child_process').then(({ spawn }) => {
    spawn(cmd, [url], { shell: process.platform === 'win32', detached: true, stdio: 'ignore' }).unref()
  })
}

const shutdown = () => {
  server.close(() => process.exit(0))
  // 长连接（SSE 之类）不会自己断，给个兜底
  setTimeout(() => process.exit(0), 500).unref()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
