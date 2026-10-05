import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { useUIStore } from './stores/ui'

// 告诉 index.html 里的白屏守卫：应用已经挂载成功，不要再显示「页面没有渲染出来」。
// @ts-ignore
window.__APP_MOUNTED__ = true

// 应用真的跑起来了 → 清掉守卫的"自动重载"计数，
// 这样以后（比如半小时后 surge 又抽风）还能再享受自愈机会。
// 延迟 8 秒：确保懒加载的 chunk 都已经拉完，而不是刚挂上就遇上它们失败。
setTimeout(() => {
  try {
    sessionStorage.removeItem('dengxu:guard-retry')
    sessionStorage.removeItem('dengxu:chunk-reload-count')
  } catch {
    /* 隐私模式下可能不可用 */
  }
}, 8000)

// 保留少量调试入口，方便排查配置问题。
// 注意：模型配置现在是 llm 对象（支持多服务商），不再是单一的 apiKey 字段。
// @ts-ignore
window.openSettings = () => useUIStore.getState().setApiKeyModalOpen(true)
// @ts-ignore
window.resetLlmSettings = () => useUIStore.getState().setLlm({ apiKey: '' })
// @ts-ignore
window.clearAllData = () => {
  localStorage.clear()
  // IndexedDB 里存着世界卡，清数据时一并删掉，否则会以为删干净了
  indexedDB.deleteDatabase('pale-notes')
  console.log('已清空 localStorage 与 world 卡片库，即将刷新。')
  window.location.reload()
}

// 仅开发模式：把 store 挂到 window，便于自动化测试驱动界面。
// import.meta.env.DEV 在生产构建里是常量 false，整个分支会被摇树掉，
// 所以线上产物里不会出现这些入口。动态 import 也保证 store 不进主 chunk。
if (import.meta.env.DEV) {
  Promise.all([
    import('./stores/ui'),
    import('./stores/game'),
    import('./stores/session'),
    import('./stores/library'),
    import('./stores/nav'),
  ]).then(([ui, game, session, library, nav]) => {
    Object.assign(window, {
      __uiStore: ui.useUIStore,
      __gameStore: game.useGameStore,
      __sessionStore: session.useSessionStore,
      __libraryStore: library.useLibraryStore,
      __navStore: nav.useNavStore,
    })
    console.log('[dev] store 已挂到 window：__uiStore / __gameStore / __sessionStore / __libraryStore / __navStore')
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
