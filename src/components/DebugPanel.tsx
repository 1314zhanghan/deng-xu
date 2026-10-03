import { useState } from 'react'
import { useGameStore } from '@/stores/game'
import { useSessionStore } from '@/stores/session'
import { useUIStore } from '@/stores/ui'
import { Bug, Plus, Trash2 } from 'lucide-react'

interface DebugPanelProps {
  dataInput?: string | null
  dataOutput?: string | null
}

/**
 * 调试面板
 *
 * 原版的作弊按钮硬编码了密教题材的物品 id（book_dream_v1、tool_knife），
 * 现在改为通用操作：直接操作当前世界卡定义的资源与属性，以及注入测试叙事。
 */
export function DebugPanel({ dataInput, dataOutput }: DebugPanelProps) {
  const { modifyResource, setAspects, aspects, resourceDefs, attributeDefs, addHistory } = useGameStore()
  const world = useSessionStore(s => s.world)
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'cheats' | 'data-ai'>('cheats')

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 p-2 bg-red-900/50 text-red-200 rounded-full hover:bg-red-900 z-50 border border-red-700"
        title="打开调试面板"
      >
        <Bug size={20} />
      </button>
    )
  }

  return (
    <div className="fixed bottom-4 right-4 w-80 bg-surface border border-red-900/50 rounded-lg shadow-2xl z-50 p-4 text-xs font-mono">
      <div className="flex justify-between items-center mb-4 border-b border-red-900/30 pb-2">
        <h3 className="text-red-400 font-bold flex items-center gap-2">
          <Bug size={14} /> 调试面板
        </h3>
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('cheats')}
            className={`text-xs px-2 py-1 rounded ${activeTab === 'cheats' ? 'bg-red-900/50 text-white' : 'text-text-muted hover:text-white'}`}
          >
            操作
          </button>
          <button
            onClick={() => setActiveTab('data-ai')}
            className={`text-xs px-2 py-1 rounded ${activeTab === 'data-ai' ? 'bg-red-900/50 text-white' : 'bg-transparent text-text-muted hover:text-white'}`}
          >
            结算 AI
          </button>
          <button onClick={() => setIsOpen(false)} className="text-text-muted hover:text-text-primary ml-2">
            关闭
          </button>
        </div>
      </div>

      <div className="space-y-4 max-h-96 overflow-y-auto">
        {activeTab === 'cheats' ? (
          <>
            <div className="space-y-2">
              <h4 className="text-text-secondary">当前世界</h4>
              <p className="text-[10px] text-text-muted break-all">
                {world ? `${world.title}（${world.attributes.length} 属性 / ${world.resources.length} 资源）` : '未加载世界卡'}
              </p>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => {
                    localStorage.removeItem('hasSeenTutorial')
                    useUIStore.getState().setShowTutorial(true)
                  }}
                  className="px-2 py-1 bg-background border border-text-muted rounded hover:border-accent-lantern text-accent-lantern"
                >
                  重看引导
                </button>
              </div>
            </div>

            {/* 资源：按世界卡定义动态生成 */}
            <div className="space-y-2">
              <h4 className="text-text-secondary">资源</h4>
              {resourceDefs.length === 0 && <p className="text-[10px] text-text-muted">未定义资源</p>}
              <div className="flex flex-col gap-1.5">
                {resourceDefs.map(def => (
                  <div key={def.id} className="flex items-center gap-2">
                    <span className="text-[10px] text-text-secondary w-20 truncate" title={def.id}>{def.name}</span>
                    <button
                      onClick={() => modifyResource(def.id, 1)}
                      className="px-2 py-0.5 bg-background border border-text-muted rounded hover:border-accent-lantern"
                    >
                      +1
                    </button>
                    <button
                      onClick={() => modifyResource(def.id, -1)}
                      className="px-2 py-0.5 bg-background border border-text-muted rounded hover:border-accent-grail"
                    >
                      -1
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* 属性：按世界卡定义动态生成 */}
            <div className="space-y-2">
              <h4 className="text-text-secondary">属性</h4>
              {attributeDefs.length === 0 && <p className="text-[10px] text-text-muted">未定义属性</p>}
              <div className="grid grid-cols-2 gap-1.5">
                {attributeDefs.map(def => (
                  <button
                    key={def.id}
                    onClick={() => setAspects({ [def.id]: (aspects[def.id] || 0) + 5 })}
                    className="px-2 py-1 bg-background border border-text-muted rounded hover:border-accent-lantern text-left truncate"
                    title={def.id}
                  >
                    +5 {def.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-text-secondary">模拟</h4>
              <button
                onClick={() => addHistory({
                  role: 'assistant',
                  content: '***[调试]*** 这是一条测试叙事消息。你感到一股**调试**的力量流过全身。',
                  timestamp: Date.now()
                })}
                className="w-full flex items-center justify-center gap-2 px-2 py-1 bg-background border border-text-muted rounded hover:border-accent-winter"
              >
                <Plus size={12} /> 注入一条叙事
              </button>
              <button
                onClick={() => useGameStore.getState().clearHistory()}
                className="w-full flex items-center justify-center gap-2 px-2 py-1 bg-background border border-text-muted rounded hover:border-red-500"
              >
                <Trash2 size={12} /> 清空对话历史
              </button>
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <div>
              <h4 className="text-text-secondary mb-1">上次结算输入</h4>
              <pre className="bg-black/50 p-2 rounded text-[10px] overflow-x-auto whitespace-pre-wrap text-green-400/80 max-h-40">
                {dataInput || '暂无记录。'}
              </pre>
            </div>
            <div>
              <h4 className="text-text-secondary mb-1">上次结算输出</h4>
              <pre className="bg-black/50 p-2 rounded text-[10px] overflow-x-auto whitespace-pre-wrap text-blue-400/80 max-h-40">
                {dataOutput || '暂无记录。'}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
