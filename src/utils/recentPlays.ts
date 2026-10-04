/**
 * 「最近玩过」记录。
 *
 * 为什么要单独存一份：
 *  存档本身（session + game store）只保留**当前这一局** —— 开新局就会覆盖。
 *  但玩家想知道的是"我玩过哪些世界"，这是一个跨局的历史，
 *  单局存档回答不了。主菜单上给出这条历史，回头玩家就不用翻卡片库找。
 *
 * 只存**元信息**（世界 id / 标题 / 主角名 / 进度 / 时间），
 * 不存存档本体 —— 那会让 localStorage 迅速膨胀，而且真正的存档已经在别处。
 * 没有现存档时条目仍可点击（会进入选角重新开局），所以是"曾玩过"而不是"可读档"。
 *
 * 刻意不做成 zustand store：它只在两个地方被写（进入游戏时、
 * 每轮叙事结束时）和一个地方被读（主菜单），用 store 反而要处理
 * 订阅与重渲染，不如直接读写 localStorage 简单可控。
 */

const KEY = 'pale-notes-recent'
const MAX = 8

export interface RecentPlay {
  worldId: string
  title: string
  playerName: string
  /** 已记录的叙事条数，用来显示"玩到第几轮" */
  turns: number
  location: string
  /** 最后一次游玩时间戳 */
  at: number
  /** 这张世界卡当前是否还在卡库里（被删掉的历史条目要标灰） */
  available?: boolean
}

function read(): RecentPlay[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter(x => x && typeof x.worldId === 'string') : []
  } catch {
    return []
  }
}

function write(list: RecentPlay[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)))
  } catch {
    // 配额满等情况不该影响游戏流程，静默忽略
  }
}

/** 记录/更新一次游玩。同一个世界只保留一条，时间戳刷新并移到最前。 */
export function recordPlay(entry: Omit<RecentPlay, 'at'>): void {
  if (!entry.worldId) return
  const list = read().filter(x => x.worldId !== entry.worldId)
  list.unshift({ ...entry, at: Date.now() })
  write(list)
}

/** 按最近时间排序的游玩历史 */
export function listRecent(): RecentPlay[] {
  return read().sort((a, b) => b.at - a.at)
}

/** 删除一条历史 */
export function forgetPlay(worldId: string): void {
  write(read().filter(x => x.worldId !== worldId))
}

/** 清空历史 */
export function clearRecent(): void {
  write([])
}

/** 把"多久以前"说成人话 */
export function relativeTime(at: number): string {
  const d = Date.now() - at
  if (d < 60_000) return '刚刚'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} 分钟前`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} 小时前`
  if (d < 7 * 86_400_000) return `${Math.floor(d / 86_400_000)} 天前`
  return new Date(at).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}
