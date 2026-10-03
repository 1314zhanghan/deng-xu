import { useEffect, useState } from 'react'
import { X, RotateCw, Upload, Sparkles } from 'lucide-react'
import { useUIStore } from '@/stores/ui'
import { useGameStore } from '@/stores/game'
import { useSessionStore } from '@/stores/session'
import { CharacterSprite } from '@/components/CharacterSprite'
import { recipeFor, playerSpriteSeed, type SpriteRecipe } from '@/utils/lpcSprite'
import { readFileAsDataURL } from '@/utils/files'

const DIRECTIONS = [
  { id: 'down', label: '正面' },
  { id: 'left', label: '左' },
  { id: 'right', label: '右' },
  { id: 'up', label: '背面' },
]

/**
 * 立绘面板 —— 点开角色看他的**全身**像素立绘。
 *
 * 为什么要有这个：素材是 64×64 的全身行走图，而关系栏只能放一个 48px 的方框，
 * 服装、姿态、体型这些信息全被裁掉了。这里用 4 倍整数放大（256px）展示全身，
 * 并且可以转方向 —— 那种「同一张图转一圈」正是像素素材的价值所在。
 */
export function PortraitPanel() {
  const characterId = useUIStore(s => s.portraitCharacterId)
  const setPortraitCharacterId = useUIStore(s => s.setPortraitCharacterId)
  const characters = useGameStore(s => s.characters)
  const playerName = useGameStore(s => s.playerName)
  const playerGender = useGameStore(s => s.playerGender)
  const playerAppearance = useGameStore(s => s.playerAppearance)
  const playerAvatar = useGameStore(s => s.playerAvatar)
  const world = useSessionStore(s => s.world)
  const [dir, setDir] = useState('down')
  const [recipe, setRecipe] = useState<SpriteRecipe | null>(null)

  const isPlayer = characterId === '__player__'
  const char = isPlayer ? null : characters.find(c => c.id === characterId)

  // 换角色时回到正面，避免"上次转到背面，这次一打开也是背面"
  useEffect(() => { setDir('down') }, [characterId])

  // 取配方（用于展示部件构成，也便于自查）
  useEffect(() => {
    if (!characterId) { setRecipe(null); return }
    if (isPlayer) setRecipe(recipeFor(playerSpriteSeed(playerName, playerGender), { gender: playerGender }))
    else if (char) setRecipe(recipeFor(char.id))
  }, [characterId, isPlayer, char, playerName, playerGender])

  const handleAvatarUpload = async (file: File | undefined) => {
    if (!file || !isPlayer) return
    try {
      const url = await readFileAsDataURL(file)
      useGameStore.getState().setPlayerProfile(
        playerName || '主角', playerGender, playerAppearance, url
      )
    } catch { /* 读取失败就保持原样 */ }
  }

  if (!characterId) return null
  const open = isPlayer || !!char
  if (!open) return null

  const name = isPlayer ? (playerName || '主角') : char!.name
  const desc = isPlayer ? playerAppearance : char!.description
  const rel = isPlayer ? null : char!.relationship

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
            <div className="text-sm font-serif text-text-primary truncate">{name}</div>
            <div className="text-[10px] text-text-muted truncate">
              {[rel, world?.title].filter(Boolean).join(' · ') || world?.title || ''}
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
            <div className="w-64 h-64 mx-auto rounded border border-text-muted/20 bg-gradient-to-b from-black/40 to-black/10 flex items-center justify-center overflow-hidden">
              {isPlayer && playerAvatar ? (
                <img src={playerAvatar} alt={name} className="w-64 h-64 object-cover" />
              ) : (
                <CharacterSprite
                  name={name}
                  id={isPlayer ? undefined : char!.id}
                  seed={isPlayer ? playerSpriteSeed(playerName, playerGender) : undefined}
                  gender={isPlayer ? playerGender : undefined}
                  direction={dir}
                  scale={4}
                  className="w-64 h-64"
                />
              )}
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

            {isPlayer && (
              <label className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs border border-text-muted/40 rounded hover:border-accent-lantern/50 hover:text-accent-lantern transition-colors cursor-pointer">
                <Upload size={12} /> {playerAvatar ? '更换自定义头像' : '上传自定义头像'}
                <input type="file" accept="image/*" className="hidden"
                  onChange={e => handleAvatarUpload(e.target.files?.[0])} />
              </label>
            )}
            {isPlayer && playerAvatar && (
              <button
                onClick={() => useGameStore.getState().setPlayerProfile(playerName || '主角', playerGender, playerAppearance, undefined)}
                className="w-full text-[10px] text-text-muted hover:text-red-400 transition-colors"
              >
                移除自定义头像，用像素立绘
              </button>
            )}
          </div>

          {/* 描述 */}
          <div className="space-y-3 min-w-0">
            {desc && (
              <p className="text-xs text-text-secondary leading-relaxed font-serif whitespace-pre-wrap">
                {desc}
              </p>
            )}

            {!isPlayer && char && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-text-muted">
                {char.status && <span>状态：{char.status}</span>}
                {char.location && <span>位置：{char.location}</span>}
              </div>
            )}

            {recipe && (
              <details className="text-[10px]">
                <summary className="cursor-pointer text-text-muted hover:text-text-secondary flex items-center gap-1">
                  <Sparkles size={10} /> 这套立绘由哪些部件组成
                </summary>
                <div className="mt-2 space-y-1 text-text-muted font-mono leading-relaxed">
                  <div>部件：{recipe.parts.join(' · ')}</div>
                  <div>发色：{recipe.colors.hair || '默认'}　肤色：{recipe.colors.body || '默认'}</div>
                  <div>衣色：{recipe.colors.cloth || '默认'}　瞳色：{recipe.colors.eye || '默认'}</div>
                </div>
                <p className="mt-2 text-text-muted/70 leading-relaxed">
                  同一个角色 id 永远得到同一套外观与配色（确定性生成）。
                </p>
              </details>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** 供关系栏/状态栏调用的小工具组件：一个可点的头像入口 */
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
