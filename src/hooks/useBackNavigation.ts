import { useEffect, useLayoutEffect, useRef } from 'react'
import { useNavStore, isRootView } from '@/stores/nav'
import { useUIStore } from '@/stores/ui'

/**
 * 手机返回键 / 浏览器后退键 → **应用内逐级后退**。
 *
 * 目标行为：
 *   1. 每一次返回只退**一级**（先关浮层 → 再退界面层级）
 *   2. 最多退到**主菜单**
 *   3. 在主菜单上**必须按两次**返回才真的离开，避免误触直接退出游戏
 *
 * ─────────────────────────────────────────────────────────────
 * 这个功能被反馈了三次。把每一版的病根记下来，免得再犯：
 *
 *  a) 只在"浮层打开"时压哨兵 → 从游戏界面本身按返回时栈里没有我们的记录，
 *     浏览器直接退出。
 *  b) 用 `useEffect` 去 pushState → effect 是异步的（绘制后才跑），
 *     用户在它之前按返回就穿透。改用 `useLayoutEffect`。
 *  c) 自己用 `depthRef` 记账数哨兵 → React StrictMode 的
 *     "挂载→卸载→再挂载"会让这个计数与真实历史栈不一致，
 *     栈顶堆了好几条没人消费的哨兵，返回键先空转几步。
 *     表现：**第一次按返回没反应，第二次一下退两级**。
 *  d) 加了一句"不在哨兵上说明已在栈底 → 直接放行"的守卫。
 *     但切层级后 effect 未跑完时 `history.state` 本来就是 null，
 *     于是**第一次返回被误判成栈底而放行**，症状与 c 一模一样。
 *
 * 现在：**不自己记账，用 `history.state` 当唯一真相**；
 * "是否已在栈底"只由 `isRootView` 判断，不靠 history 状态推断。
 *
 * 还有一个排查中发现的关键点：**新手引导弹窗会先吃掉一次返回**。
 * 我第一次测试时它开着，于是"第一次返回没反应"，
 * 我差点又一次误判成历史逻辑的问题。浮层优先级必须显式写在最前面。
 * ─────────────────────────────────────────────────────────────
 */
export function useBackNavigation() {
  const view = useNavStore(s => s.view)
  /*
    订阅所有浮层状态。
    每个浮层也算**一层历史** —— 打开时压一条、关闭时弹掉一条。
    不这样做的话，游戏界面只占一条历史，打开抽屉后按返回会直接把页面退掉
    （实测日志里出现过 `alive:false`：抽屉关了、页面也没了）。
  */
  const overlayOpen = useUIStore(s =>
    !!s.mobileSheet || s.mobileMenuOpen || !!s.portraitCharacterId || s.isApiKeyModalOpen || s.showTutorial
  )

  /** 已经提醒过一次退出，下一次按返回就放行 */
  const exitArmedRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 这次 popstate 是我们自己发起的"放行退出"，不再拦截 */
  const allowExitRef = useRef(false)
  /** 上一次观察到的浮层状态，用来判断"刚打开"还是"刚关闭" */
  const prevOverlayRef = useRef(false)

  /** 栈顶是不是我们的哨兵 */
  const atSentinel = () => !!(window.history.state && window.history.state.__dxNav)

  /**
   * 保证栈顶是哨兵。
   *
   * ⚠️ 用 `replaceState` 而**不是** `pushState`。
   * 之前用 pushState，于是每次"换层级"都会**新增一条历史**；
   * 而按返回时浏览器会弹掉一条，代码又补一条 —— 净效果是历史条目不断累积，
   * 表现就是"多按几次返回都不动"（每次都在弹我们自己压的哨兵）。
   * 换成 replaceState：只给当前条目打标，栈深度不变。
   * 唯一需要真正 push 的场合是"退出确认"（见下面第 ③ 步）。
   */
  const ensureSentinel = () => {
    if (!atSentinel()) window.history.replaceState({ __dxNav: true }, '')
  }

  /**
   * 层级或浮层变化 → 保证哨兵在位。
   * 浮层也算一层：打开时压一条历史，让它有东西可退。
   */
  useLayoutEffect(() => {
    exitArmedRef.current = false
    if (overlayOpen && !prevOverlayRef.current) {
      // 浮层刚打开：压一条，返回键就能只关它、不动页面
      window.history.pushState({ __dxNav: true }, '')
    }
    prevOverlayRef.current = overlayOpen
    ensureSentinel()
  }, [view, overlayOpen])

  useEffect(() => {
    /*
      挂载时把当前条目标成哨兵。
      用 `replaceState` 而**不是** pushState —— StrictMode 会挂载两次，
      用 pushState 就会压出两条哨兵，正是"第一次返回空转"的病根。
    */
    if (!atSentinel()) window.history.replaceState({ __dxNav: true }, '')

    /*
      防止重复绑定监听器。StrictMode 会把 effect 跑两遍，
      两个监听器共用同一份状态，表现是"一次返回退两级"。
    */
    if ((window as any).__dxBackNavBound) return
    ;(window as any).__dxBackNavBound = true

    const onPop = () => {
      /*
        判据完全以 `history.state` 为准，不用自己的计数器。
        走到这里说明浏览器已经弹掉了一条 —— 我们只关心
        "现在这条是不是我们的哨兵"，以及"该退到哪一层"。
      */
      if (allowExitRef.current) {
        allowExitRef.current = false
        return
      }

      const ui = useUIStore.getState()

      /*
        ① 最深的一层是各种浮层，先关它们。
        新手引导曾在这里吃掉一次返回，而我误判成历史逻辑的问题 ——
        所以它必须显式列出，不能靠"应该没开吧"。
      */
      if (ui.portraitCharacterId) { ui.setPortraitCharacterId(null); ensureSentinel(); return }
      if (ui.isApiKeyModalOpen) { ui.setApiKeyModalOpen(false); ensureSentinel(); return }
      if (ui.showTutorial) { ui.setShowTutorial(false); ensureSentinel(); return }

      // ② 再退界面层级。
      //    用 backSilent：浏览器**已经**弹掉了一条历史，
      //    再由 nav.back() 去弹一次就会连退两级。
      const nav = useNavStore.getState()
      if (nav.backSilent()) { ensureSentinel(); return }

      // ③ 已经在主菜单 —— 要按两次才退出
      if (isRootView(nav.view)) {
        if (!exitArmedRef.current) {
          /*
            第一次按返回**不放行**：补一条哨兵把这次后退顶回去，
            并给一个可见提示（GlobalToast 渲染，主菜单上也能看到）。
            唯一需要真正 pushState 的地方就是这里。
          */
          exitArmedRef.current = true
          window.history.pushState({ __dxNav: true }, '')
          ui.setStatusMessage('再按一次返回即退出游戏')
          if (timerRef.current) clearTimeout(timerRef.current)
          timerRef.current = setTimeout(() => {
            exitArmedRef.current = false
            useUIStore.getState().setStatusMessage(null)
          }, 2500)
          return
        }
        // 第二次：放行
        exitArmedRef.current = false
        allowExitRef.current = true
        if (timerRef.current) clearTimeout(timerRef.current)
        ui.setStatusMessage(null)
        window.history.back()
        return
      }

      /*
        ④ 兜底：既没浮层可关、也没层级可退，但仍在某个非主菜单层级上
        （例如 state 不是哨兵的边缘情况）—— 补一条挡回去，避免直接退出。
      */
      ensureSentinel()
    }

    window.addEventListener('popstate', onPop)
    return () => {
      /*
        卸载时不摘监听器、也不清标志位。
        StrictMode 的"挂载→卸载→再挂载"会走这里；若摘掉并允许重新绑定，
        第二次挂载又会绑一个（重复监听）。整页刷新时浏览器自然清理。
      */
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])
}
