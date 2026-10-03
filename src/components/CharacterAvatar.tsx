import { useState } from 'react'
import { Users } from 'lucide-react'
import { resolveAvatar } from '@/utils/avatarArt'

/**
 * 头像组件（人物关系栏、状态栏共用）
 *
 * 解析优先级交给 resolveAvatar：
 *   角色卡自带图片 > 指定素材 id > 按稳定标识程序化生成
 * 最后一种永远能算出来，所以即使世界卡没配任何素材，
 * 每个角色也会有一张稳定且互不相同的头像，而不是清一色的通用图标。
 *
 * 注意 key 必须用**稳定标识**（角色 id），不能只用渲染文本：
 * 用名字当种子的话，改个名字就会换一张脸。
 */
export function CharacterAvatar({
  name,
  id,
  avatar,
  avatarId,
  style,
  tone,
  size = 32,
  className = '',
}: {
  name: string
  /** 稳定标识，决定生成出的长相；缺省时退回用名字 */
  id?: string
  /** 角色卡自带图片 */
  avatar?: string
  /** 素材库 id（AI 选的） */
  avatarId?: string
  /** 世界卡头像风格 */
  style?: string
  /** 世界卡点缀色 */
  tone?: string
  /** 边长（像素） */
  size?: number
  className?: string
}) {
  // 只有「卡里自带的图片」可能加载失败；生成出来的 SVG 不会失败
  const [cardImageBroken, setCardImageBroken] = useState(false)

  const useCardImage = Boolean(avatar) && !cardImageBroken

  const src = resolveAvatar({
    key: `${id || name}#${avatarId || ''}`,
    label: name,
    image: useCardImage ? avatar : undefined,
    avatarId,
    style,
    tone,
  })

  return (
    <img
      src={src}
      alt={name}
      width={size}
      height={size}
      loading="lazy"
      onError={() => { if (useCardImage) setCardImageBroken(true) }}
      style={{ width: size, height: size }}
      className={`rounded-full object-cover border border-text-muted/30 shrink-0 bg-black/30 ${className}`}
    />
  )
}

/** 兜底用的通用人物图标（只在明确要图标而非头像时使用） */
export function FallbackAvatarIcon({ size = 16 }: { size?: number }) {
  return (
    <div className="p-2 bg-surface rounded-full text-text-secondary shrink-0">
      <Users size={size} />
    </div>
  )
}
