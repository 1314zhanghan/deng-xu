import { useEffect, useState } from 'react'
import { Accessibility } from 'lucide-react'
import { recipeFor, renderSprite, type SpriteRecipe, type AppearanceProfile } from '@/utils/lpcSprite'
import type { SpriteLook } from '@/types/cards'

/**
 * LPC 像素立绘（方形/竖版）。
 *
 * 与 CharacterAvatar（36px 圆形几何头像）的分工：
 *  - 这个组件用**真实像素素材**，特征表达强，用于人物关系栏这类有空间的位置；
 *  - CharacterAvatar 是零依赖的程序化兜底，用于极小的位置（状态栏等）。
 *
 * 素材是 64×64 全身图，这里按整数倍放大（默认 3 倍 = 192px 画布），
 * 保证像素锐利；显示尺寸由 CSS 控制、用 pixelated 渲染再次兜底。
 *
 * ## 外观的两个来源（优先级）
 *
 *  1. **`look`（推荐）** —— 卡里显式写好的结构化外观（部件级）。有它就不猜。
 *  2. **`profile`（兜底）** —— 从自由文本描述里用关键词推断。
 *     ⚠️ 这条路的天花板很低（中文表述空间无穷，正则表有限），
 *     只该用于没写 `look` 的卡（例如导入的第三方卡）。
 */
export function CharacterSprite({
  name,
  id,
  gender,
  build,
  seed,
  profile,
  look,
  direction = 'down',
  scale = 3,
  className = '',
  /** 是否只显示头肩（用于紧凑位置） */
  headOnly = false,
}: {
  name: string
  id?: string
  gender?: string
  build?: string
  /** 覆盖确定性种子（不传则用 id/name） */
  seed?: string
  /**
   * 角色资料。传了才会**按描述**挑部件与配色（黑发马尾就画黑发马尾）；
   * 不传就退回随机，那正是"立绘和描述对不上"的原因。
   */
  profile?: AppearanceProfile
  /**
   * 卡里显式写好的结构化外观（部件级）。**有它就以它为准**，
   * `profile` 只用来补 `look` 里没写的字段。
   */
  look?: SpriteLook
  direction?: string
  scale?: number
  className?: string
  headOnly?: boolean
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  /*
    依赖用 profile 的**各个字段**而不是 profile 对象本身：
    调用方每次渲染都可能新建一个对象字面量，直接依赖它会导致无限重绘
    （每次都是新引用 → effect 重跑 → setState → 再渲染）。
  */
  const pName = profile?.name
  const pDesc = profile?.description
  const pPers = profile?.personality
  const pScen = profile?.scenario
  const pRel = profile?.relationship
  const pAge = profile?.age
  const pGender = profile?.gender

  /*
    `look` 同理不能直接进依赖数组（调用方多半是内联字面量），
    所以序列化成字符串当依赖 —— 内容变了才重算，引用变了不算。
  */
  const lookKey = look ? JSON.stringify(look) : ''

  useEffect(() => {
    let cancelled = false
    const merged: AppearanceProfile | undefined = profile
      ? { name: pName, description: pDesc, personality: pPers, scenario: pScen, relationship: pRel, age: pAge, gender: pGender || gender }
      : undefined
    /*
      种子只用 id/name（**不含描述**）：描述会随剧情更新，
      若把它算进种子，同一个角色每次改描述就换一张脸。
      ⚠️ `look` 同样**不进种子** —— 它只覆盖"画什么"，
      不该改变"这个角色的脸是哪一张"。
    */
    const recipe: SpriteRecipe = recipeFor(seed || id || name, {
      gender, build, profile: merged,
      // 反序列化回来：依赖项是字符串，用的时候要还原成对象
      look: lookKey ? (JSON.parse(lookKey) as SpriteLook) : undefined,
    })
    renderSprite(recipe, { direction, scale, headOnly })
      .then(u => { if (!cancelled) setUrl(u) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, id, name, gender, build, direction, scale, headOnly, pName, pDesc, pPers, pScen, pRel, pAge, pGender, lookKey])

  if (failed) {
    // 素材加载失败不该留空 —— 给一个可辨认的占位
    return (
      <div className={`bg-surface/60 border border-text-muted/25 flex items-center justify-center ${className}`}>
        <Accessibility size={16} className="text-text-muted" />
      </div>
    )
  }

  if (!url) {
    // 合成很快（几十毫秒），给个同尺寸占位避免布局跳动
    return <div className={`bg-black/25 ${className}`} />
  }

  return (
    <img
      src={url}
      alt={name}
      style={{ imageRendering: 'pixelated' }}
      className={className}
    />
  )
}
