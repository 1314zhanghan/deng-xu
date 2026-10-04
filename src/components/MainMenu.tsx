import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Play, BookOpen, Library, Settings, ChevronRight, ScrollText, Sparkles,
} from 'lucide-react'
import { useGameStore } from '@/stores/game'
import { useSessionStore } from '@/stores/session'
import { useLibraryStore } from '@/stores/library'
import { useUIStore } from '@/stores/ui'

/**
 * 主菜单 —— 打开网站后的第一屏。
 *
 * 为什么要有它：
 *  之前打开网站**直接就是世界书卡片墙**，一种"门户大开"的感觉：
 *  玩家一眼看到九张卡、一堆导入导出按钮，却不知道从哪开始，
 *  也不知道自己上次玩到哪了。卡片墙是"资料库"，不该当门厅用。
 *
 *  主菜单只回答三个问题：**继续玩 / 开新局 / 看设定**，
 *  其余（卡库管理、导入导出、世界包、存档）都收进二级入口。
 */
export interface MainMenuProps {
  onContinue: () => void
  onNewGame: () => void
  onWorldbook: () => void
  onLibrary: () => void
  onOpenSettings: () => void
}

export function MainMenu({
  onContinue, onNewGame, onWorldbook, onLibrary, onOpenSettings,
}: MainMenuProps) {
  const world = useSessionStore(s => s.world)
  const history = useGameStore(s => s.history)
  const characters = useGameStore(s => s.characters)
  const playerName = useGameStore(s => s.playerName)
  const worlds = useLibraryStore(s => s.worlds)
  const loaded = useLibraryStore(s => s.loaded)
  const llm = useUIStore(s => s.llm)

  const needsKey = !llm.apiKey && llm.provider !== 'ollama'
  const hasProgress = history.length > 0
  const canContinue = !!world && (hasProgress || characters.length > 0)

  /** 上次玩到的最后一句话，用作"继续游戏"卡片的预览 */
  const [lastLine, setLastLine] = useState('')
  useEffect(() => {
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].role === 'assistant' && history[i].content.trim()) {
        setLastLine(history[i].content.replace(/[#*`>]/g, '').trim().slice(-70))
        return
      }
    }
    setLastLine('')
  }, [history])

  return (
    <div className="max-w-3xl mx-auto w-full px-6 py-10 md:py-16">
      {/* 标题 */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="text-center mb-10"
      >
        <h1 className="font-serif font-bold tracking-[0.35em] text-3xl md:text-4xl text-accent-lantern mb-3">
          灯叙
        </h1>
        <p className="text-xs text-text-muted leading-relaxed">
          题材无关的 AI 文字冒险引擎
          <span className="mx-2 text-text-muted/40">·</span>
          世界观与角色卡完全自定义
        </p>
      </motion.div>

      {/* 未配置模型时的提示 —— 这是新玩家最容易卡住的地方，放在最显眼处 */}
      {needsKey && (
        <button
          onClick={onOpenSettings}
          className="w-full mb-4 flex items-start gap-3 p-4 rounded-lg border border-accent-forge/50 bg-accent-forge/[0.07] text-left hover:bg-accent-forge/[0.12] transition-colors"
        >
          <Settings size={18} className="text-accent-forge mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-sm text-accent-forge font-bold mb-0.5">先配置模型，才能开始游戏</div>
            <p className="text-[11px] text-text-muted leading-relaxed">
              需要填入你自己的 API Key（支持 DeepSeek / OpenAI / 硅基流动 / OpenRouter / 本地 Ollama）。
              Key 只保存在你的浏览器里，不经过任何第三方服务器。
            </p>
          </div>
          <ChevronRight size={16} className="text-accent-forge/60 mt-0.5 shrink-0" />
        </button>
      )}

      {/* 继续游戏 —— 有进度时放在最上面，这是回头玩家最想要的 */}
      {canContinue && (
        <motion.button
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.05 }}
          onClick={onContinue}
          className="w-full mb-3 p-5 rounded-lg border border-accent-lantern/50 bg-accent-lantern/[0.08] hover:bg-accent-lantern/[0.14] transition-colors text-left group"
        >
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 rounded-full bg-accent-lantern/15 border border-accent-lantern/40 flex items-center justify-center shrink-0">
              <Play size={18} className="text-accent-lantern translate-x-[1px]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-lantern/20 text-accent-lantern border border-accent-lantern/40">
                  {hasProgress ? '进行中' : '尚未开场'}
                </span>
                <span className="font-serif font-bold text-base text-text-primary truncate">
                  {world?.title}
                </span>
              </div>
              <div className="text-[11px] text-text-muted font-mono truncate">
                {playerName && <>扮演 {playerName}　·　</>}
                {hasProgress ? `已记录 ${history.length} 条` : '开场还没生成'}
              </div>
              {lastLine && (
                <p className="text-[11px] text-text-secondary leading-relaxed line-clamp-1 font-serif mt-1">
                  …{lastLine}
                </p>
              )}
            </div>
            <ChevronRight size={18} className="text-accent-lantern/50 shrink-0 group-hover:translate-x-0.5 transition-transform" />
          </div>
        </motion.button>
      )}

      {/* 主要入口 */}
      <div className="grid sm:grid-cols-2 gap-3 mb-3">
        <MenuCard
          icon={<Sparkles size={18} className="text-accent-lantern" />}
          title="开始新游戏"
          desc="挑一个世界，设定你的身份，然后开讲"
          onClick={onNewGame}
          primary
          delay={0.1}
        />
        <MenuCard
          icon={<BookOpen size={18} className="text-accent-lantern" />}
          title="世界书"
          desc={`${loaded ? worlds.length : '…'} 个世界可预览、导入、导出`}
          onClick={onWorldbook}
          delay={0.15}
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <MenuCard
          icon={<Library size={18} className="text-text-muted" />}
          title="卡片库"
          desc="管理世界卡与角色卡，导入导出与备份"
          onClick={onLibrary}
          delay={0.2}
        />
        <MenuCard
          icon={<Settings size={18} className="text-text-muted" />}
          title="模型设置"
          desc={needsKey ? '尚未配置，点此填写' : `${llm.narrativeModel}`}
          onClick={onOpenSettings}
          warn={needsKey}
          delay={0.25}
        />
      </div>

      {/* 底部说明 */}
      <div className="mt-10 pt-6 border-t border-text-muted/15 text-[10px] text-text-muted/70 leading-relaxed text-center space-y-1">
        <p>进度与卡片都保存在你自己的浏览器里，不会上传到任何服务器。</p>
        <p>像素素材来自 Universal LPC Spritesheet Generator，署名见「卡片库 → 素材署名」。</p>
      </div>
    </div>
  )
}

/** 主菜单上的一张入口卡 */
function MenuCard({
  icon, title, desc, onClick, primary = false, warn = false, delay = 0,
}: {
  icon: React.ReactNode
  title: string
  desc: string
  onClick: () => void
  primary?: boolean
  warn?: boolean
  delay?: number
}) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
      onClick={onClick}
      className={`p-4 rounded-lg border text-left transition-colors group
        ${warn
          ? 'border-accent-forge/50 bg-accent-forge/[0.06] hover:bg-accent-forge/[0.12]'
          : primary
            ? 'border-accent-lantern/40 bg-accent-lantern/[0.06] hover:bg-accent-lantern/[0.12]'
            : 'border-text-muted/25 bg-black/20 hover:border-text-muted/50'}`}
    >
      <div className="flex items-center gap-2.5 mb-1.5">
        <span className="shrink-0">{icon}</span>
        <span className="font-serif font-bold text-sm text-text-primary">{title}</span>
        <ChevronRight size={14} className="ml-auto text-text-muted/50 shrink-0 group-hover:translate-x-0.5 transition-transform" />
      </div>
      <p className="text-[11px] text-text-muted leading-relaxed">{desc}</p>
    </motion.button>
  )
}

/** 供主菜单之外复用的"返回主菜单"按钮 */
export function BackToMenuButton({ onClick, label = '返回主菜单' }: { onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-text-muted/40 rounded hover:border-accent-lantern/50 hover:text-accent-lantern transition-colors"
    >
      <ScrollText size={14} /> {label}
    </button>
  )
}

/** 卡片库页顶部的小统计条 */
export function LibraryStats() {
  const worlds = useLibraryStore(s => s.worlds)
  const chars = worlds.reduce((n, w) => n + (w.characters?.length || 0), 0)
  return (
    <span className="text-[10px] text-text-muted font-mono">
      {worlds.length} 个世界
      <span className="mx-1 text-text-muted/40">·</span>
      {chars} 张角色卡
    </span>
  )
}
