import { useEffect, useState } from 'react'
import { X, RotateCw, Sparkles } from 'lucide-react'
import { useUIStore } from '@/stores/ui'
import { useGameStore } from '@/stores/game'
import { useSessionStore } from '@/stores/session'
import { CharacterSprite } from '@/components/CharacterSprite'
import { recipeFor, type SpriteRecipe } from '@/utils/lpcSprite'

const DIRECTIONS = [
  { id: 'down', label: '正面' },
  { id: 'left', label: '左' },
  { id: 'right', label: '右' },
  { id: 'up', label: '背面' },
]

/**
 * 立绘面板 —— 点开 **NPC** 看他的全身像素立绘。
 *
 * 为什么只有 NPC：
 *  主角曾经也有立绘、还能上传自定义头像。但那两条路都不成立 ——
 *   1. 主角的像素立绘是从名字随机生成的，与玩家填的「外貌」描述无关，
 *      玩家看到的是一个跟他设定毫无关系的陌生人；
 *   2. 上传自定义头像与这里的像素风格完全冲突（一张真人照片放进像素界面），
 *      而且它只影响状态栏一个小方块，投入与收益不成比例。
 *  所以主角不再有立绘 —— 主角是玩家自己，用文字描述即可。
 *
 * NPC 立绘则相反：它是 AI 生成的角色，玩家没有别的渠道"看见"他们，
 * 立绘是这些人唯一的形象。
 */
export function PortraitPanel() {
  const characterId = useUIStore(s => s.portraitCharacterId)
  const setPortraitCharacterId = useUIStore(s => s.setPortraitCharacterId)
  const characters = useGameStore(s => s.characters)
  const world = useSessionStore(s => s.world)
  const [dir, setDir] = useState('down')
  const [recipe, setRecipe] = useState<SpriteRecipe | null>(null)

  const char = characters.find(c => c.id === characterId)

  // 换角色时回到正面，避免"上次转到背面，这次一打开也是背面"
  useEffect(() => { setDir('down') }, [characterId])

  // 取配方（用于展示部件构成，也便于自查是否照描述画了）
  useEffect(() => {
    if (!char) { setRecipe(null); return }
    setRecipe(recipeFor(char.id, {
      // 部件级显式外观优先；profile 只补没写的字段
      look: char.look,
      profile: {
        name: char.name,
        description: char.description,
        relationship: char.relationship,
        scenario: char.prompt,
      },
    }))
  }, [char])

  if (!characterId || !char) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={() => setPortraitCharacterId(null)}
    >
      <div
        className="w-full max-w-2xl bg-background border border-text-muted/25 rounded-lg overflow-hidden shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-text-muted/20">
          <div className="min-w-0">
            <div className="text-sm font-serif text-text-primary truncate">{char.name}</div>
            <div className="text-[10px] text-text-muted truncate">
              {[char.relationship, world?.title].filter(Boolean).join(' · ')}
            </div>
          </div>
          <button
            onClick={() => setPortraitCharacterId(null)}
            className="p-1.5 text-text-muted hover:text-text-primary transition-colors shrink-0"
            title="关闭"
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid md:grid-cols-[16rem_1fr] gap-4 p-4">
          {/* 立绘 */}
          <div className="space-y-3">
            {/*
              容器用**竖长**比例（4:5）。
              之前是正方形 256×256 —— 而角色画在 64×64 帧里、
              上下本来就留白，放进正方形后人物显得又小又空。
              竖长容器能把人物撑满，也更像一张"立绘"。
            */}
            <div className="w-64 h-80 mx-auto rounded border border-text-muted/20 bg-gradient-to-b from-black/40 to-black/10 flex items-center justify-center overflow-hidden">
              <CharacterSprite
                name={char.name}
                id={char.id}
                /* 部件级显式外观优先；profile 只补没写的字段 */
                look={char.look}
                profile={{
                  name: char.name,
                  description: char.description,
                  relationship: char.relationship,
                  scenario: char.prompt,
                }}
                direction={dir}
                scale={5}
                className="w-64 h-80"
              />
            </div>

            {/* 方向切换 */}
            <div className="flex items-center justify-center gap-1.5">
              <RotateCw size={12} className="text-text-muted mr-1" />
              {DIRECTIONS.map(d => (
                <button
                  key={d.id}
                  onClick={() => setDir(d.id)}
                  className={`px-2 py-1 text-[10px] rounded border transition-colors
                    ${dir === d.id
                      ? 'bg-accent-lantern/15 border-accent-lantern/50 text-accent-lantern'
                      : 'border-text-muted/25 text-text-muted hover:border-text-muted/50'}`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {/* 描述 */}
          <div className="space-y-3 min-w-0">
            {char.description && (
              <p className="text-xs text-text-secondary leading-relaxed font-serif whitespace-pre-wrap">
                {char.description}
              </p>
            )}

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-text-muted">
              {char.status && <span>状态：{char.status}</span>}
              {char.location && <span>位置：{char.location}</span>}
              {char.relationship && <span>关系：{char.relationship}</span>}
            </div>

            {recipe && (
              <details className="text-[10px]">
                <summary className="cursor-pointer text-text-muted hover:text-text-secondary flex items-center gap-1">
                  <Sparkles size={10} /> 这套立绘是怎么定的
                </summary>
                <div className="mt-2 space-y-1 text-text-muted font-mono leading-relaxed">
                  <div>部件：{recipe.parts.join(' · ')}</div>
                  <div>发色：{recipe.colors.hair || '默认'}　肤色：{recipe.colors.body || '默认'}</div>
                  <div>衣色：{recipe.colors.cloth || '默认'}　瞳色：{recipe.colors.eye || '默认'}</div>
                </div>
                <p className="mt-2 text-text-muted/70 leading-relaxed">
                  部件与配色由角色的**描述、身份、年龄**推断而来 ——
                  描述里写了「黑发束成马尾的管家」，立绘就会照着画。
                  同一个角色 id 永远得到同一张脸。
                </p>
              </details>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** 供关系栏调用的小工具组件：一个可点的立绘入口（仅 NPC） */
export function PortraitTrigger({
  characterId,
  children,
}: {
  characterId: string
  children: React.ReactNode
}) {
  const setPortraitCharacterId = useUIStore(s => s.setPortraitCharacterId)
  return (
    <button
      onClick={e => { e.stopPropagation(); setPortraitCharacterId(characterId) }}
      className="shrink-0 rounded border border-text-muted/25 hover:border-accent-lantern/60 transition-colors overflow-hidden"
      title="查看全身立绘"
    >
      {children}
    </button>
  )
}
