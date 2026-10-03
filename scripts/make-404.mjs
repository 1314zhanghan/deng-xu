/**
 * 为 GitHub Pages 生成 404.html
 *
 * Pages 对不存在的路径会返回 404 页面，而不会自动回退到 index.html。
 * 把 index.html 复制一份成 404.html，访问任意路径时页面本身仍能正常加载，
 * 之后由前端自己接管（本项目是单页无路由，效果等价于 SPA 回退）。
 *
 * 其他平台（Netlify / Vercel / surge）用各自的重写规则处理，不需要这个文件，
 * 多出来一个 404.html 也没有副作用。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(projectRoot, 'dist')
const indexHtml = path.join(distDir, 'index.html')
const notFoundHtml = path.join(distDir, '404.html')

if (!fs.existsSync(indexHtml)) {
  console.error('[404] 找不到 dist/index.html，请先执行构建')
  process.exit(1)
}

fs.copyFileSync(indexHtml, notFoundHtml)

// 顺便放一个 .nojekyll：GitHub Pages 默认用 Jekyll 处理站点，
// 会忽略以下划线开头的文件/目录。我们的资源带哈希不会以下划线开头，
// 但加上这个文件可以彻底避免 Jekyll 带来的意外行为。
fs.writeFileSync(path.join(distDir, '.nojekyll'), '')

// surge 的 SPA 约定：未匹配的 URL 用 200.html 作为应用外壳返回 200 而不是 404
// （见 surge 文档 platform/spa-routing）。本项目是单页无路由，
// 效果等价于「任何路径都能打开首页」。
fs.copyFileSync(indexHtml, path.join(distDir, '200.html'))

const kb = (fs.statSync(notFoundHtml).size / 1024).toFixed(1)
console.log(`[404] 已生成 dist/404.html (${kb} kB)、dist/200.html 与 dist/.nojekyll`)
