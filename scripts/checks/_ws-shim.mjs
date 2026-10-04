/**
 * 让走查脚本在 Node 20 上也能用 WebSocket。
 *
 * 为什么需要：Node 的全局 `WebSocket`（WHATWG 标准）在 **Node 21** 才稳定，
 * Node 20 上根本没有。我本地用 Node 24 跑全部走查都是绿的，
 * 但 CI 的 `setup-node` 装的是 Node 20 —— 一上去就
 * `ReferenceError: WebSocket is not defined`，而且四套走查全挂。
 *
 * 这类"本地好、CI 挂"的问题最难猜，所以这里做显式兜底：
 * 只在缺少全局实现时才从 `ws` 包补一个，Node 22+ 上则用内置的（不用额外依赖）。
 *
 * 用法：在走查脚本**最顶部** `import './_ws-shim.mjs'`。
 * 必须是第一个 import —— ESM 的 import 会被提升，写在后面就来不及了。
 */
if (typeof globalThis.WebSocket === 'undefined') {
  const { WebSocket } = await import('ws')
  globalThis.WebSocket = WebSocket
}
