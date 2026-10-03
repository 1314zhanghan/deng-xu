/**
 * 世界包（整包导出 / 导入）
 *
 * 为什么需要：
 * 卡片编辑器早就能导出**单张卡**，但创作往往是成套的 ——
 * 一个世界卡 + 若干张配套角色卡，甚至还要带上正在进行的存档。
 * 逐张导出再逐张导入，既麻烦又容易漏。
 *
 * 这里做「世界包」：一个 JSON 装下世界卡、配套角色卡，以及（可选）当前存档。
 *
 * 与「导出存档」的区别：
 *  - 存档导出 = 备份**进度**（game/session/ui + 归档），用于换设备继续玩
 *  - 世界包   = 备份/分享**创作**（世界卡 + 角色卡），用于复用与分发
 * 两者职责不同，不要混在一起 —— 分享创作时不该把自己的游玩进度也发给别人。
 */

import { downloadFile, safeFilename, timestampSuffix } from '@/utils/files'
import { SAVE_FORMAT, type SaveFile } from '@/utils/saveFile'
import type { WorldCard, CharacterCard } from '@/types/cards'

export const PACK_FORMAT = 'deng-xu-worldpack'
export const PACK_VERSION = 1

export interface WorldPack {
  format: typeof PACK_FORMAT
  version: number
  exportedAt: string
  /** 便于在文件列表里辨认 */
  meta: {
    /** 包含几个世界 */
    worldCount: number
    /** 包含几张角色卡 */
    characterCount: number
    /** 世界名（最多列 3 个） */
    worldTitles: string[]
    /** 是否附带了存档 */
    hasSave: boolean
  }
  /** 选中的世界卡 */
  worlds: WorldCard[]
  /**
   * 配套角色卡。
   * 只包含**被选中世界里引用到的**角色 —— 整库导出会把别人的卡也打进去，
   * 那是分享者通常不想要的。
   */
  characters: CharacterCard[]
  /** 可选：附带存档，用于"连进度一起搬家" */
  save?: SaveFile
}

// ============================================================================
// 导出
// ============================================================================

export interface BuildPackOptions {
  worlds: WorldCard[]
  /** 全量角色卡库；函数内部只挑被选中世界引用到的 */
  allCharacters: CharacterCard[]
  /** 附带当前存档 */
  save?: SaveFile
}

/**
 * 组装世界包。
 *
 * 角色卡的筛选规则：世界卡里如果有 `characterIds`（或卡片自带的 characters）
 * 就按它筛；筛不出就退回"把全库都带上"，避免因为字段缺失而导出空角色。
 */
export function buildPack(opts: BuildPackOptions): WorldPack {
  const { worlds, allCharacters, save } = opts

  const wanted = new Set<string>()
  let referenced = 0
  for (const w of worlds) {
    // 世界卡上的 characters 是它自带的角色卡
    for (const c of (w as any).characters || []) {
      if (c?.id) { wanted.add(c.id); referenced++ }
    }
    for (const id of (w as any).characterIds || []) {
      if (typeof id === 'string') { wanted.add(id); referenced++ }
    }
  }

  // 有引用就按引用筛；一个都筛不出就带上全部（宁可多带，也别导出空包）
  const characters = referenced > 0
    ? allCharacters.filter(c => wanted.has(c.id))
    : allCharacters

  return {
    format: PACK_FORMAT,
    version: PACK_VERSION,
    exportedAt: new Date().toISOString(),
    meta: {
      worldCount: worlds.length,
      characterCount: characters.length,
      worldTitles: worlds.slice(0, 3).map(w => w.title),
      hasSave: !!save,
    },
    worlds,
    characters,
    ...(save ? { save } : {}),
  }
}

export function exportPack(opts: BuildPackOptions): { bytes: number; filename: string } {
  const pack = buildPack(opts)
  const json = JSON.stringify(pack, null, 2)
  const bytes = new Blob([json]).size
  const base = pack.meta.worldTitles.join('-') || '世界包'
  const filename = `${safeFilename(base)}-${timestampSuffix()}.dengxupack.json`
  downloadFile(filename, pack)
  return { bytes, filename }
}

// ============================================================================
// 导入
// ============================================================================

export interface PackImportResult {
  ok: boolean
  error?: string
  /** 导入后可直接合并进卡片库的部分 */
  worlds?: WorldCard[]
  characters?: CharacterCard[]
  /** 附带的存档（若有） */
  save?: SaveFile
  note?: string
}

export function validatePack(input: unknown): PackImportResult {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: '文件内容不是有效的 JSON 对象' }
  }
  const p = input as Partial<WorldPack>
  if (p.format !== PACK_FORMAT) {
    return {
      ok: false,
      error: `这不是「灯叙」的世界包（format=${String(p.format) || '缺失'}）。`
        + '如果你导入的是单张卡或存档，请改用对应的导入入口。',
    }
  }
  if (typeof p.version !== 'number') return { ok: false, error: '世界包缺少版本号' }
  if (p.version > PACK_VERSION) {
    return { ok: false, error: `世界包版本 ${p.version} 比当前程序（${PACK_VERSION}）新，请先更新页面` }
  }
  const worlds = Array.isArray(p.worlds) ? p.worlds : []
  const characters = Array.isArray(p.characters) ? p.characters : []
  if (worlds.length === 0 && characters.length === 0) {
    return { ok: false, error: '这个包里既没有世界卡也没有角色卡' }
  }
  // 最低限度的形状校验：世界卡必须有 id 与标题
  const badWorld = worlds.find(w => !w || typeof (w as any).id !== 'string' || typeof (w as any).title !== 'string')
  if (badWorld) return { ok: false, error: '包里有损坏的世界卡（缺少 id 或标题）' }
  const badChar = characters.find(c => !c || typeof (c as any).id !== 'string' || typeof (c as any).name !== 'string')
  if (badChar) return { ok: false, error: '包里有损坏的角色卡（缺少 id 或名字）' }

  return { ok: true, worlds, characters, save: p.save }
}

export async function importPackFile(file: File): Promise<PackImportResult> {
  let text: string
  try {
    text = await file.text()
  } catch (e) {
    return { ok: false, error: `读取文件失败：${(e as Error)?.message || e}` }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    return { ok: false, error: `文件不是合法 JSON：${(e as Error)?.message || e}` }
  }
  const r = validatePack(parsed)
  if (!r.ok) return r

  // 如果包里带了存档，提示调用方（是否应用由用户决定，不擅自覆盖进度）
  const note = r.save
    ? `包内附带了存档（${r.save.meta?.worldTitle || '未知世界'}）。导入卡片不会覆盖你当前的进度。`
    : undefined
  return { ...r, note }
}

/** 冲突处理策略：id 已存在时怎么办 */
export type MergeStrategy = 'skip' | 'overwrite' | 'duplicate'

export interface MergeResult {
  worldsAdded: number
  worldsUpdated: number
  worldsSkipped: number
  charsAdded: number
  charsUpdated: number
  charsSkipped: number
}

/**
 * 把包里的卡合并进现有库。
 *
 * 冲突是必然的：同一个世界包导入两次、或从别人那里拿到你已有的卡。
 * 三种策略都由用户选，不替他决定：
 *  - skip      跳过（保守，默认）
 *  - overwrite 用包里的覆盖本地
 *  - duplicate 都留下，给新副本改 id 与名字
 */
export function mergeInto(
  existing: { worlds: WorldCard[]; characters: CharacterCard[] },
  incoming: { worlds?: WorldCard[]; characters?: CharacterCard[] },
  strategy: MergeStrategy = 'skip'
): { worlds: WorldCard[]; characters: CharacterCard[]; result: MergeResult } {
  const result: MergeResult = {
    worldsAdded: 0, worldsUpdated: 0, worldsSkipped: 0,
    charsAdded: 0, charsUpdated: 0, charsSkipped: 0,
  }

  const worlds = [...existing.worlds]
  const chars = [...existing.characters]

  const suffix = () => `-copy-${Math.random().toString(36).slice(2, 7)}`

  for (const w of incoming.worlds || []) {
    const i = worlds.findIndex(x => x.id === w.id)
    if (i === -1) { worlds.push(w); result.worldsAdded++; continue }
    if (strategy === 'skip') { result.worldsSkipped++; continue }
    if (strategy === 'overwrite') { worlds[i] = w; result.worldsUpdated++; continue }
    // duplicate
    worlds.push({ ...w, id: w.id + suffix(), title: w.title + '（副本）' })
    result.worldsAdded++
  }

  for (const c of incoming.characters || []) {
    const i = chars.findIndex(x => x.id === c.id)
    if (i === -1) { chars.push(c); result.charsAdded++; continue }
    if (strategy === 'skip') { result.charsSkipped++; continue }
    if (strategy === 'overwrite') { chars[i] = c; result.charsUpdated++; continue }
    chars.push({ ...c, id: c.id + suffix(), name: c.name + '（副本）' })
    result.charsAdded++
  }

  return { worlds, characters: chars, result }
}

/** 供界面显示的一句话摘要 */
export function describeMerge(r: MergeResult): string {
  const bits: string[] = []
  if (r.worldsAdded) bits.push(`新增世界 ${r.worldsAdded}`)
  if (r.worldsUpdated) bits.push(`覆盖世界 ${r.worldsUpdated}`)
  if (r.worldsSkipped) bits.push(`跳过世界 ${r.worldsSkipped}`)
  if (r.charsAdded) bits.push(`新增角色 ${r.charsAdded}`)
  if (r.charsUpdated) bits.push(`覆盖角色 ${r.charsUpdated}`)
  if (r.charsSkipped) bits.push(`跳过角色 ${r.charsSkipped}`)
  return bits.length ? bits.join('，') : '没有任何变化'
}

/** 让 TS 知道 SAVE_FORMAT 被用到了（存档校验在 saveFile 里做，这里只做类型约束） */
export const PACK_ACCEPTS_SAVE = SAVE_FORMAT
