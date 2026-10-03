/**
 * 叙事历史的归档与裁剪
 *
 * 问题（真实会发生，而且静默）：
 *  localStorage 配额约 5MB，而 `game` store 的 `history` 是**全量**持久化的。
 *  长局（几百轮）必然撞上限；撞上之后 `setItem` 抛 QuotaExceededError，
 *  而 zustand 的 persist 中间件**不会把它冒到界面上** ——
 *  表现为「存档突然不再更新」，玩家以为还在存，实际早就没存了。
 *
 *  上一版只加了「接近上限就警告」，那只是把问题告诉用户，没解决问题。
 *  这里做真正的处理：**把较旧的叙事归档到 IndexedDB**，localStorage 只留最近的一段。
 *
 *  为什么是"归档"而不是"删除"：
 *  玩家玩了 300 轮，前面 250 轮是这段故事的组成部分。直接丢掉等于销毁他的创作。
 *  IndexedDB 的配额按磁盘算（通常几百 MB 起），放这些文本绰绰有余。
 */

import { createKVStore } from '@/utils/idb'

/** 专用一个 KV store，避免与卡片库互相干扰 */
const archiveStore = createKVStore('deng-xu-archive', 'history')

/** 热数据保留的条数：localStorage 里只留最近这么多轮 */
export const HOT_HISTORY_LIMIT = 120

/** 单条消息超过这个长度就认为是大块叙事，算配额时按实际长度计 */
const ARCHIVE_KEY = 'history-archive'

export interface HistoryMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp?: number
}

export interface ArchiveState {
  /** 已归档的消息（按时间升序，接在热数据之前） */
  messages: HistoryMessage[]
  /** 归档时间 */
  archivedAt: number
}

/** 读取归档（读不到就返回空，不抛错） */
export async function loadArchive(): Promise<ArchiveState> {
  try {
    const v = await archiveStore.get<ArchiveState>(ARCHIVE_KEY)
    if (v && Array.isArray(v.messages)) return v
  } catch {
    /* IndexedDB 不可用（隐私模式等）——退回空归档 */
  }
  return { messages: [], archivedAt: 0 }
}

/** 写入归档 */
export async function saveArchive(archive: ArchiveState): Promise<boolean> {
  try {
    await archiveStore.set(ARCHIVE_KEY, archive)
    return true
  } catch {
    return false
  }
}

export async function clearArchive(): Promise<void> {
  try {
    await archiveStore.set(ARCHIVE_KEY, { messages: [], archivedAt: Date.now() })
  } catch {
    /* 忽略 */
  }
}

/**
 * 判断是否需要归档。
 * @param history 当前热历史
 * @param force   忽略条数阈值，直接归档（用于配额已经告急时抢救）
 */
export function needsArchive(history: HistoryMessage[], force = false): boolean {
  if (force) return history.length > HOT_HISTORY_LIMIT
  return history.length > HOT_HISTORY_LIMIT * 2
}

/**
 * 执行归档：把超出 HOT_HISTORY_LIMIT 的旧消息移进归档。
 *
 * 返回新的热历史与归档结果。**不修改传入数组**（zustand 要引用变化）。
 */
export async function archiveOldMessages(
  history: HistoryMessage[]
): Promise<{ hot: HistoryMessage[]; archived: number; ok: boolean }> {
  if (history.length <= HOT_HISTORY_LIMIT) {
    return { hot: history, archived: 0, ok: true }
  }

  const cut = history.length - HOT_HISTORY_LIMIT
  const toArchive = history.slice(0, cut)
  const hot = history.slice(cut)

  const prev = await loadArchive()
  const merged: ArchiveState = {
    messages: [...prev.messages, ...toArchive],
    archivedAt: Date.now(),
  }

  const ok = await saveArchive(merged)
  if (!ok) {
    // 归档失败就**不要裁剪** —— 否则等于直接销毁玩家的历史。
    // 宁可继续撑在 localStorage 里，让容量警告去提示用户导出备份。
    return { hot: history, archived: 0, ok: false }
  }

  return { hot, archived: toArchive.length, ok: true }
}

/**
 * 估算把历史写进 localStorage 的体积（UTF-16，约等于字符数 × 2）。
 * 用于在真正触发配额错误之前就先动手归档。
 */
export function estimateHistoryBytes(history: HistoryMessage[]): number {
  try {
    return JSON.stringify(history).length * 2
  } catch {
    return 0
  }
}

/** 当前存档占用是否已经危险（需要立刻归档） */
export function isHistoryPressureHigh(history: HistoryMessage[]): boolean {
  // 单 history 字段超过 2.5MB 就该动手了（总配额 5MB，还有别的 store 要写）
  return estimateHistoryBytes(history) > 2.5 * 1024 * 1024
}
