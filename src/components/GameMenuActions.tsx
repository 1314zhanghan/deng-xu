import { useState } from 'react'
import { LogOut, Settings, BookOpen, X, Check } from 'lucide-react'
import { useGameStore } from '@/stores/game'
import { useUIStore } from '@/stores/ui'
import { useSessionStore } from '@/stores/session'

/**
 * 游戏内的全局操作（返回标题 / 模型设置 / 世界信息）。
 *
 * 为什么单独做成组件：
 *  这三个操作原先塞在 `StatusPanel` 的最底部（`pt-6 mt-auto` 之后）。
 *  桌面端还好，但手机端的 `StatusPanel` 是放在菜单的**滚动容器**里 ——
 *  于是「返回标题」要一路滚过所有属性、资源、装备才能看到，
 *  玩家（以及我自己的审计）都以为"没有返回主菜单这个功能"。
 *
 *  这类"全局导航"不该依赖某个面板的渲染位置。抽出来之后：
 *   - 桌面端固定在左栏底部
 *   - 手机端固定在菜单底部（不随内容滚动）
 *
 * 返回前加一层确认：不是因为会丢数据（进度每轮都已写入本机），
 * 而是玩家在游戏里点"返回"时会本能地担心丢进度 —— 一次确认比一句说明更让人放心。
 */
export function GameMenuActions({ className = '' }: { className?: string }) {
  const returnToTitle = useGameStore(s => s.returnToTitle)
  const setApiKeyModalOpen = useUIStore(s => s.setApiKeyModalOpen)
  const world = useSessionStore(s => s.world)
  const playerName = useGameStore(s => s.playerName)
  const [confirming, setConfirming] = useState(false)

  return (
    <div className={`space-y-1.5 ${className}`}>
      {world && (
        <div className="px-2 pb-2 mb-1 border-b border-text-muted/20">
          <div className="text-[10px] text-text-muted/70 uppercase tracking-[0.2em]">当前世界</div>
          <div className="text-xs font-serif text-text-secondary truncate flex items-center gap-1.5">
            <BookOpen size={11} className="shrink-0 text-accent-lantern/60" />
            <span className="truncate">{world.title}</span>
          </div>
          {playerName && (
            <div className="text-[10px] text-text-muted truncate mt-0.5">扮演：{playerName}</div>
          )}
        </div>
      )}

      <button
        onClick={() => setApiKeyModalOpen(true)}
        className="w-full flex items-center justify-center gap-2 p-2 text-sm text-text-muted hover:text-accent-lantern hover:bg-accent-lantern/10 border border-transparent hover:border-accent-lantern/30 rounded transition-all"
      >
        <Settings size={14} />
        <span>模型设置</span>
      </button>

      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          className="w-full flex items-center justify-center gap-2 p-2 text-sm text-text-muted hover:text-accent-lantern hover:bg-accent-lantern/10 border border-transparent hover:border-accent-lantern/30 rounded transition-all"
        >
          <LogOut size={14} />
          <span>返回标题</span>
        </button>
      ) : (
        <div className="p-2.5 rounded border border-accent-lantern/40 bg-accent-lantern/5 space-y-2">
          <div className="text-[11px] text-text-secondary leading-relaxed">
            返回标题后，本局进度仍然保留，
            <br />
            可以随时「继续游戏」接着玩。
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { setConfirming(false); returnToTitle() }}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] rounded bg-accent-lantern text-black font-bold hover:bg-accent-lantern/90 transition-colors"
            >
              <Check size={11} /> 确认返回
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] rounded border border-text-muted/40 text-text-secondary hover:border-text-muted/70 transition-colors"
            >
              <X size={11} /> 继续玩
            </button>
          </div>
        </div>
      )}

      <p className="text-[10px] text-text-muted/60 text-center leading-relaxed pt-1">
        进度已自动保存在本机
      </p>
    </div>
  )
}
