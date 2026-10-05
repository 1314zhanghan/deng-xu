import { useMemo } from 'react'
import { useGameStore } from '@/stores/game'
import { useSessionStore } from '@/stores/session'
import { getSceneAsset } from '@/utils/sceneArt'
import { generateMap, ARCHETYPE_TO_MAP, isNightHour, timeOfDayLabel, type MapArchetype } from '@/utils/rpgMap'

/**
 * 叙事区背景 —— **RPG 俯瞰瓦片地图**，随游戏内时间切换昼夜。
 *
 * 为什么重做（玩家反馈「割裂且意义不明」+「时间变化看不出来」）：
 *  旧版是"天空/远山/中景/近景"四层横向色块。两个问题：
 *   1. 色块没有可辨认的语义 —— 看不出那是路、是屋顶、还是水；
 *      而且每个场景都是同一种"三条横带"构图，像同一张图换了颜色。
 *   2. 完全不随游戏内时间变化，想知道白天黑夜必须打开上边栏看钟。
 *
 *  现在改成 16×16 一格的俯瞰地图：草地/道路/水面/屋顶/树干形状可辨认；
 *  并且 **19:00 后自动换夜景配色**（整体压暗偏蓝紫 + 窗户与路灯亮起暖光），
 *  不用看钟就能感到时间在走。
 *
 * ⚠️ 保留上一版的一个教训：
 *  曾经用「图片 opacity 0.28 + 上面盖不透明渐变」，最终亮度只剩约 0.12 —— 等于没画。
 *  验证"背景显示了没"不能只看 DOM 里有没有 <img>，必须看**渲染后的像素**。
 *  所以图保持接近全不透明，压暗交给遮罩，且遮罩中间最轻（0.22）。
 */
export function SceneBackdrop({ className = '' }: { className?: string }) {
  const sceneId = useGameStore(s => s.sceneId)
  const hour = useGameStore(s => s.time.hour)
  const world = useSessionStore(s => s.world)

  const night = isNightHour(hour)

  const map = useMemo(() => {
    const asset = getSceneAsset(sceneId)
    // 没有场景 id 时用街景兜底，而不是什么都不画 —— 空背景更"意义不明"
    const arche: MapArchetype = (asset && ARCHETYPE_TO_MAP[asset.archetype]) || 'street'
    // seed 用场景 id + 色调，保证同一场景稳定，不会每次渲染都换一张图
    const seed = `${sceneId || 'default'}:${world?.avatarStyle || 'ink'}`
    return generateMap(arche, seed, night)
  }, [sceneId, world?.avatarStyle, night])

  return (
    <div className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`} aria-hidden="true">
      <img
        src={map.dataUrl}
        alt=""
        /* 像素图必须关闭插值，否则放大后糊成一片 */
        style={{ imageRendering: 'pixelated' }}
        className="w-full h-full object-cover opacity-100 transition-opacity duration-[1200ms]"
      />

      {/*
        夜景再叠一层冷色，加强"天黑了"的观感。
        不透明度压得很低，只是染色，不参与"能不能看清"的问题。
      */}
      {night && (
        <div className="absolute inset-0" style={{ background: 'rgba(30,40,90,0.16)' }} />
      )}

      {/*
        可读性遮罩。
        关键是**别把遮罩做厚**：middle 超过 ~0.5 就几乎看不见图了。
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

      {/*
        右上角标出当前场景与昼夜。
        昼夜主要靠画面本身表达，这里只做很克制的补充。
      */}
      <div className="absolute top-2 right-3 text-[10px] font-mono text-text-muted/70 select-none flex items-center gap-1.5">
        <span>{night ? '🌙' : '☀'}</span>
        <span>{getSceneAsset(sceneId)?.label || ''}</span>
        <span className="text-text-muted/40">{timeOfDayLabel(hour)}</span>
      </div>
    </div>
  )
}
