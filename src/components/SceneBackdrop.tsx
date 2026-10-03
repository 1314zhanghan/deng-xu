import { useMemo } from 'react'
import { useGameStore } from '@/stores/game'
import { useSessionStore } from '@/stores/session'
import { generateScene, getSceneAsset } from '@/utils/sceneArt'

/**
 * 叙事区背景。
 *
 * 由 AI 通过 SET_SCENE 切换场景 id，渲染成一张图
 * （程序化生成，或素材表里指定的真实图片）。
 *
 * ⚠️ 这里踩过一个坑，改法记下来免得再犯：
 *   第一版用「图片 opacity 0.28 + 上面盖 from-background/70 via-background/80 to-background」，
 *   而 background 是 #0c0c0c。底部完全不透明 ⇒ 最终亮度约
 *   0.28×0.3 + 0.72×0.05 ≈ 0.12，整块就是纯黑，等于没画。
 *   教训：验证"背景显示了没"不能只看 DOM 里有没有 <img>，必须看**渲染后的像素**。
 *
 * 现在改成：图片保持较高可见度，只用一层**上下重、中间透**的渐变压边，
 * 既让场景看得清，又保证正文压在上面仍然能读。
 */
export function SceneBackdrop({ className = '' }: { className?: string }) {
  const sceneId = useGameStore(s => s.sceneId)
  const world = useSessionStore(s => s.world)

  const scene = useMemo(() => {
    if (!sceneId) return null
    return generateScene(sceneId, world?.avatarStyle, world?.avatarTone, getSceneAsset(sceneId))
  }, [sceneId, world?.avatarStyle, world?.avatarTone])

  if (!scene) return null

  return (
    <div className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`} aria-hidden="true">
      {/* 场景图：保持接近全不透明。压暗交给下面的渐变，而不是把图本身调透明 */}
      <img
        src={scene.dataUrl}
        alt=""
        className="w-full h-full object-cover opacity-100 transition-opacity duration-[1200ms]"
      />

      {/*
        可读性遮罩。
        这里的关键是**别把遮罩做厚**：第一版 middle 用了 0.45 的不透明黑，
        加上图本身 opacity 0.28，最终亮度只剩约 0.12×原图 —— 等于没画。
        实测原始场景图亮度约 30–60/255，遮罩超过 ~0.5 就几乎看不见了。
        现在：顶端/底端重（压住状态栏与输入框），中间最轻（0.22）。
      */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to bottom, rgba(12,12,12,0.9) 0%, rgba(12,12,12,0.3) 22%, rgba(12,12,12,0.32) 58%, rgba(12,12,12,0.93) 100%)',
        }}
      />

      {/* 左右轻微收边，避免图片边缘生硬 */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to right, rgba(12,12,12,0.5) 0%, rgba(12,12,12,0) 12%, rgba(12,12,12,0) 88%, rgba(12,12,12,0.5) 100%)',
        }}
      />

      {/* 右上角标出当前场景，便于确认 AI 切对了 */}
      <div className="absolute top-2 right-3 text-[10px] font-mono text-text-muted/70 select-none">
        {getSceneAsset(sceneId)?.label || ''}
      </div>
    </div>
  )
}
