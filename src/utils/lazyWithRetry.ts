import { lazy } from 'react'

/**
 * 抗传输中断的模块加载。
 *
 * 背景：surge 免费 CDN 会在大文件传输中途掐断连接。
 * 实测同一份产物反复抓取：
 *   - 810 KB 单文件：8 次失败 5 次（ERR_CONNECTION_RESET）
 *   - 284 KB chunk ：6 次失败 1 次
 *   - ≤232 KB chunk：6 次全成功
 * 浏览器对模块加载失败**不做任何重试**，一次抖动就是一块内容永远出不来。
 *
 * 对策分两层：
 *  1. 原地重试 1 次 —— 覆盖极短抖动（不需要重新下载其它 chunk）；
 *  2. 仍失败则整页重载一次 —— 重新拉取全部资源。
 *     用 sessionStorage 计数，最多 2 次，避免网络彻底不通时陷入刷新死循环。
 *
 * 为什么不用「给 URL 加 ?r=N 重试」这种常见技巧：
 * 它确实能绕过浏览器的模块失败缓存，但带 query 的模块解析会破坏
 * Vite 静态 import 到带哈希 chunk 的映射关系，风险高于收益。
 * 整页重载更笨，但确定可用。
 */

const RELOAD_KEY = 'dengxu:chunk-reload-count'
const MAX_RELOADS = 2

function readReloadCount(): number {
  try {
    return Number(sessionStorage.getItem(RELOAD_KEY) || '0')
  } catch {
    return 0
  }
}

function bumpReloadCount(): void {
  try {
    sessionStorage.setItem(RELOAD_KEY, String(readReloadCount() + 1))
  } catch {
    /* 隐私模式下 sessionStorage 可能不可用，忽略即可 */
  }
}

/** 加载成功后清零计数，让下一次真正的新故障还能享受重载机会 */
export function clearChunkReloadCount(): void {
  try {
    sessionStorage.removeItem(RELOAD_KEY)
  } catch {
    /* 忽略 */
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function importWithRetry<T>(
  loader: () => Promise<T>,
  maxRetries = 1
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await loader()
    } catch (err) {
      lastErr = err
      if (attempt < maxRetries) await sleep(400)
    }
  }
  throw lastErr
}

/** 懒加载 + 重试 + 受控整页重载的组件工厂 */
export function lazyWithRetry<T extends { default: React.ComponentType<any> }>(
  loader: () => Promise<T>
) {
  return lazy(async () => {
    try {
      return await importWithRetry(loader)
    } catch (err) {
      const used = readReloadCount()
      if (used < MAX_RELOADS) {
        bumpReloadCount()
        console.warn(`[chunk] 加载失败，第 ${used + 1} 次自动重载页面`, err)
        window.location.reload()
        // 重载期间挂起，避免返回一个无效模块
        await new Promise(() => {})
      }
      // 已经重载过多次，交给 ChunkErrorBoundary 显示手动重试按钮
      throw err
    }
  })
}

/**
 * 判断这次页面加载是否还算"刚开始"。
 * 用来决定要不要把重载计数归零：只有在应用整体渲染成功、且距加载足够久
 * （说明该出来的 chunk 都出来了）时才归零。若在重载循环里，计数必须保留 ——
 * 否则每次重载都清零，就会变成无限刷新。
 */
export function appLoadedCleanly(): void {
  try {
    if (readReloadCount() === 0) return
    if (performance.now() > 8000) {
      // 页面已经跑了 8 秒还没触发模块失败 → 认定这次是好的
      sessionStorage.removeItem(RELOAD_KEY)
    }
  } catch {
    /* 忽略 */
  }
}
