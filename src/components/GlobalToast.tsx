import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Info } from 'lucide-react'
import { useUIStore } from '@/stores/ui'

/**
 * 全局提示条。
 *
 * 为什么要单独做一个：
 *  `statusMessage` 原先只在 `StatusBar` 里渲染，而 `StatusBar` 是**游戏界面**的组件。
 *  于是主菜单上设的提示玩家根本看不到 —— 最典型的场景就是
 *  "在主菜单按返回键 → 我们拦下并提示『再按一次返回即退出游戏』，
 *   但那个提示渲染在一个当前不存在的组件里"，
 *  玩家看到的就是**按键没反应**。
 *
 *  这个组件挂在 App 顶层，任何层级都能显示。
 *  游戏进行中的忙碌提示（"正在结算…"）仍由 StatusBar 承担，
 *  两者互不冲突：这里只在消息变化时短暂浮出。
 */
export function GlobalToast() {
  const statusMessage = useUIStore(s => s.statusMessage)
  const [shown, setShown] = useState<string | null>(null)

  useEffect(() => {
    if (!statusMessage) { setShown(null); return }
    setShown(statusMessage)
    // 游戏内的忙碌提示是持续的（由 StatusBar 显示），这里只做短暂浮层
    const t = setTimeout(() => setShown(null), 2600)
    return () => clearTimeout(t)
  }, [statusMessage])

  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ duration: 0.2 }}
          /*
            位置在屏幕底部但**避开手机底栏**（--dx-tabbar-h）与 iOS 安全区，
            否则提示会被底栏压住 —— 那就又变成"看不见的提示"。
          */
          className="fixed left-1/2 -translate-x-1/2 z-[95] max-w-[90vw] pointer-events-none"
          style={{ bottom: 'calc(var(--dx-tabbar-h, 0px) + 1rem)' }}
        >
          <div className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-black/90 border border-accent-lantern/40 text-accent-lantern text-xs shadow-xl backdrop-blur">
            <Info size={13} className="shrink-0" />
            <span className="leading-relaxed">{shown}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
