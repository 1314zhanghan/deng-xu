import { useEffect, useRef, useState } from 'react'
import { Download, Upload, HardDrive, AlertTriangle, Check, X } from 'lucide-react'
import {
  exportSave, importSaveFile, measureUsage, canStillWrite, type UsageInfo,
} from '@/utils/saveFile'

/**
 * 存档管理：导出 / 导入 / 容量警告。
 *
 * 这是「数据安全」入口 —— 存档只在本机，没有它就等于没有自救手段。
 * 容量警告不是装饰：localStorage 配额耗尽后写入会**静默失败**，
 * 用户会以为还在存档。所以这里主动探测并把风险摆在明面上。
 */
export function SaveManager({ compact = false }: { compact?: boolean }) {
  const [usage, setUsage] = useState<UsageInfo | null>(null)
  const [writable, setWritable] = useState(true)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = () => {
    setUsage(measureUsage())
    setWritable(canStillWrite())
  }

  // 打开时测一次；执行导入后再测一次（导入会改变占用）
  useEffect(() => { refresh() }, [])

  const handleExport = () => {
    try {
      const { bytes, filename } = exportSave()
      setMsg({ kind: 'ok', text: `已导出 ${filename}（${Math.round(bytes / 1024)} KB）` })
    } catch (e) {
      setMsg({ kind: 'err', text: `导出失败：${(e as Error)?.message || e}` })
    }
  }

  const handleImport = async (file: File | undefined) => {
    if (!file) return
    const r = await importSaveFile(file)
    if (!r.ok) {
      setMsg({ kind: 'err', text: r.error || '导入失败' })
      return
    }
    setMsg({ kind: 'ok', text: '导入成功，正在重新载入…' })
    // 各 store 的内存状态还是旧的，必须重载页面才一致
    setTimeout(() => window.location.reload(), 900)
  }

  const danger = !writable || usage?.dangerous
  const warn = !danger && usage?.nearLimit

  return (
    <div className={`${compact ? '' : 'p-4 bg-surface/20 border border-text-muted/20 rounded'} space-y-3`}>
      {!compact && (
        <div className="flex items-center justify-between">
          <span className="text-xs font-serif text-text-muted uppercase tracking-[0.2em]">存档</span>
          {usage && (
            <span className="text-[10px] text-text-muted font-mono flex items-center gap-1">
              <HardDrive size={10} /> {usage.human}
            </span>
          )}
        </div>
      )}

      {compact && usage && (
        <div className="flex items-center gap-1 text-[10px] text-text-muted font-mono">
          <HardDrive size={10} /> 存档占用 {usage.human}
        </div>
      )}

      {/* 容量警告：配额耗尽后写入会静默失败，必须显式告知 */}
      {danger && (
        <div className="flex items-start gap-2 p-2 bg-red-500/10 border border-red-500/30 rounded text-[10px] text-red-300 leading-relaxed">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>
            <b>本机存储已满，存档可能已停止保存。</b>
            {usage && usage.perStore[0] && (
              <> 占用最大的是「{usage.perStore[0].key}」（{Math.round(usage.perStore[0].bytes / 1024)} KB）。</>
            )}
            <br />
            请立刻<button onClick={handleExport} className="underline hover:text-red-200">导出存档</button>备份，
            然后返回标题开始新游戏或清理旧数据。
          </span>
        </div>
      )}
      {warn && (
        <div className="flex items-start gap-2 p-2 bg-amber-500/10 border border-amber-500/25 rounded text-[10px] text-amber-300 leading-relaxed">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>
            存档已接近浏览器上限（多数浏览器约 5 MB）。长局建议先导出备份，
            避免继续游玩时写入被拒绝而丢失进度。
          </span>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleExport}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-text-muted/40 rounded hover:border-accent-lantern/50 hover:text-accent-lantern transition-colors"
        >
          <Download size={12} /> 导出存档
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-text-muted/40 rounded hover:border-accent-lantern/50 hover:text-accent-lantern transition-colors"
        >
          <Upload size={12} /> 导入存档
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={e => { handleImport(e.target.files?.[0]); e.target.value = '' }}
        />
      </div>

      {msg && (
        <div className={`flex items-start gap-1.5 text-[10px] leading-relaxed ${msg.kind === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>
          {msg.kind === 'ok' ? <Check size={11} className="mt-0.5 shrink-0" /> : <X size={11} className="mt-0.5 shrink-0" />}
          <span>{msg.text}</span>
        </div>
      )}

      {!compact && (
        <p className="text-[10px] text-text-muted leading-relaxed">
          存档保存在本机浏览器里，不会上传到任何服务器。换设备或清理缓存前请先导出。
        </p>
      )}
    </div>
  )
}
