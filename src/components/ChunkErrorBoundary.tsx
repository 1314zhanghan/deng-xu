import { Component, type ReactNode, type ErrorInfo } from 'react'

/**
 * 局部错误边界。
 *
 * 用途：懒加载的 chunk 万一多次重试都失败，只让那一块显示"重新加载"，
 * 而不是整个应用崩成白屏。对纯前端站点来说，用户被丢在一个没有出口的白屏
 * 是最糟的结果 —— 至少要让 TA 有按钮可点。
 */
interface Props {
  children: ReactNode
  /** 出错时显示的标题，例如「叙事区加载失败」 */
  label?: string
}

interface State {
  error: Error | null
}

export class ChunkErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[boundary] 渲染出错：', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="max-w-sm text-center space-y-3">
          <div className="text-sm text-accent-forge font-bold">
            {this.props.label || '这部分内容加载失败'}
          </div>
          <p className="text-xs text-text-muted leading-relaxed">
            通常是网络传输中断造成的。重新加载即可，进度不会丢。
          </p>
          <code className="block text-[10px] font-mono text-text-muted/70 break-all">
            {String(error?.message || error).slice(0, 160)}
          </code>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 text-xs border border-accent-lantern/50 text-accent-lantern rounded hover:bg-accent-lantern/15 transition-colors"
          >
            重新加载
          </button>
        </div>
      </div>
    )
  }
}
