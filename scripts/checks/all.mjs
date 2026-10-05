/**
 * 一次跑完所有浏览器走查。
 *
 * 为什么要一个总入口：CI 里一个个 `node scripts/checks/xxx.mjs` 写四遍，
 * 而且它们共用同一个 dev server 和 Edge —— 分散调用容易漏掉某个，
 * 也不好统一汇总"到底哪一项挂了"。
 *
 * 每个走查用**独立的 CDP 端口**：串行跑时端口复用会偶发
 * "浏览器未就绪"（上一个进程还没退干净），我为此白排查过一次。
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { waitForServer } from './_browser.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const SITE = process.env.SITE || 'http://localhost:5199/'
const OUT = process.env.AUDIT_OUT || path.join(ROOT, 'playtest-shots')

const CHECKS = [
  { name: '主菜单', file: 'main-menu.mjs', port: 9870 },
  { name: '玩家体验', file: 'playtest.mjs', port: 9871 },
  { name: '出错路径', file: 'error-paths.mjs', port: 9872 },
  { name: '手机端', file: 'mobile.mjs', port: 9873 },
  { name: '返回键层级', file: 'back-nav.mjs', port: 9874 },
  { name: '地图昼夜', file: 'map-gallery.mjs', port: 9875 },
  { name: 'NPC 贴合度', file: 'npc-fidelity.mjs', port: 9876 },
]

const only = process.argv.slice(2)
const todo = only.length ? CHECKS.filter(c => only.some(o => c.file.includes(o) || c.name.includes(o))) : CHECKS

console.log(`等待 dev server：${SITE}`)
if (!(await waitForServer(SITE))) {
  console.error('✗ dev server 没起来。先运行 `pnpm dev`（CI 里是 build 后 preview）。')
  process.exit(1)
}
console.log('✓ dev server 就绪\n')

const results = []
for (const c of todo) {
  console.log('─'.repeat(60))
  console.log(`▶ ${c.name}（${c.file}）`)
  console.log('─'.repeat(60))
  const ok = await new Promise(res => {
    const p = spawn(process.execPath, [path.join(HERE, c.file)], {
      stdio: 'inherit',
      env: { ...process.env, SITE, AUDIT_OUT: OUT, CDP_PORT: String(c.port) },
    })
    p.on('exit', code => res(code === 0))
  })
  results.push({ ...c, ok })
  if (!ok) console.log(`✗ ${c.name} 未通过`)
  console.log('')
}

console.log('═'.repeat(60))
console.log('浏览器走查总览')
console.log('═'.repeat(60))
for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}`)
const failed = results.filter(r => !r.ok)
console.log(`\n  ${results.length - failed.length}/${results.length} 套走查通过`)
if (failed.length) console.log('  失败：' + failed.map(r => r.name).join('、'))
console.log(`  截图目录：${OUT}`)
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true })

process.exit(failed.length ? 1 : 0)
