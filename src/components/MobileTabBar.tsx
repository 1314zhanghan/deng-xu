import { User, Package, Users, MoreHorizontal } from 'lucide-react'
import { useGameStore } from '@/stores/game'

export type MobileTab = 'status' | 'inventory' | 'relationships'

/**
 * 手机端底部标签栏。
 *
 * 为什么需要它：
 *  在这之前，手机端想看一眼背包必须：点右上角汉堡 → 打开全屏菜单 → 切页签 → 关闭。
 *  每看一次物品就断一次与叙事区的视线连接，来回四步。
 *  而"我现在有什么、谁在旁边"是**高频**操作（几乎每轮都想确认），
 *  高频操作不该藏在菜单里。
 *
 *  所以把三个高频页签做成常驻底栏，一键直达；
 *  低频率的（模型设置 / 返回标题）留在「更多」里。
 */
export function MobileTabBar({
  tab, setTab, onOpenMore, moreActive,
}: {
  tab: MobileTab
  setTab: (t: MobileTab) => void
  onOpenMore: () => void
  moreActive: boolean
}) {
  // 在标签上显示两个计数，让玩家不进面板就知道有没有新东西
  const inventoryCount = useGameStore(s => s.inventory.length)
  const characterCount = useGameStore(s => s.characters.length)

  const tabs: { id: MobileTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'status', label: '状态', icon: <User size={18} /> },
    { id: 'inventory', label: '物品', icon: <Package size={18} />, badge: inventoryCount },
    { id: 'relationships', label: '人物', icon: <Users size={18} />, badge: characterCount },
  ]

  return (
    <nav
      className="md:hidden shrink-0 z-30 border-t border-text-muted/25 bg-surface/90 backdrop-blur"
      /*
        pb-[env(safe-area-inset-bottom)] 处理 iPhone 的底部横条：
        不加的话最后一排按钮会被系统手势区盖住，点不到。
      */
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex">
        {tabs.map(t => {
          const active = tab === t.id && !moreActive
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 relative transition-colors
                ${active ? 'text-accent-lantern' : 'text-text-muted'}`}
            >
              <span className="relative">
                {t.icon}
                {!!t.badge && t.badge > 0 && (
                  <span className="absolute -top-1 -right-2 min-w-[14px] h-[14px] px-0.5 rounded-full bg-accent-lantern text-black text-[9px] font-bold flex items-center justify-center leading-none">
                    {t.badge > 99 ? '99+' : t.badge}
                  </span>
                )}
              </span>
              <span className="text-[10px]">{t.label}</span>
              {active && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-accent-lantern rounded-full" />}
            </button>
          )
        })}
        <button
          onClick={onOpenMore}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 relative transition-colors
            ${moreActive ? 'text-accent-lantern' : 'text-text-muted'}`}
        >
          <MoreHorizontal size={18} />
          <span className="text-[10px]">更多</span>
          {moreActive && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-accent-lantern rounded-full" />}
        </button>
      </div>
    </nav>
  )
}
