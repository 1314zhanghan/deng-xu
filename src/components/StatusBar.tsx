import { useState } from 'react';
import { useGameStore } from '@/stores/game';
import { useUIStore } from '@/stores/ui';
import { MapPin, Clock, User, BookOpen, Loader2, ChevronDown, ChevronUp } from 'lucide-react';

export function StatusBar() {
  const { location, time, identity, story } = useGameStore();
  const { statusMessage } = useUIStore();
  const [isExpanded, setIsExpanded] = useState(false);

  const formatTime = (t: typeof time) => {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${t.year}-${pad(t.month)}-${pad(t.day)} ${pad(t.hour)}:${pad(t.minute)}`;
  };

  return (
    <div className="w-full bg-zinc-900 border-b border-zinc-800 text-xs font-mono text-zinc-400 select-none relative z-30">
      {/*
        ⚠️ 手机端折叠行原先**只显示"就绪"两个字**，白白占掉一整行高度（h-10）——
        而"我在哪、现在什么时候"恰恰是玩家最常需要的信息，却要点开才能看到。
        现在：
          · 正在生成 → 显示状态消息（那时它最重要）
          · 空闲     → 显示「位置 · 时间」，把这一行用起来
        展开后仍是完整的四项（位置/时间/身份/章节）。
      */}
      <div className="md:hidden flex items-center justify-between px-4 h-9 gap-2">
        {statusMessage ? (
          <div className="flex items-center gap-2 text-amber-500 animate-pulse min-w-0">
            <Loader2 className="w-3 h-3 animate-spin shrink-0" />
            <span className="truncate">{statusMessage}</span>
          </div>
        ) : (
          <div className="flex items-center gap-3 min-w-0 text-zinc-500">
            <span className="flex items-center gap-1.5 min-w-0">
              <MapPin className="w-3 h-3 shrink-0" />
              <span className="text-zinc-300 truncate">{location || '未知之处'}</span>
            </span>
            <span className="flex items-center gap-1.5 shrink-0">
              <Clock className="w-3 h-3" />
              <span>{formatTime(time)}</span>
            </span>
          </div>
        )}

        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-1 hover:bg-zinc-800 rounded text-zinc-500 shrink-0"
          aria-label={isExpanded ? '收起状态栏' : '展开状态栏'}
        >
          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {/* Expanded / Desktop View */}
      <div className={`${isExpanded ? 'flex' : 'hidden'} md:flex flex-col md:flex-row items-start md:items-center justify-between p-4 md:p-2 gap-4 md:gap-0 bg-zinc-900 md:bg-transparent absolute md:relative w-full border-b md:border-none border-zinc-800 shadow-xl md:shadow-none`}>
        <div className="flex flex-col md:flex-row items-start md:items-center gap-2 md:gap-6 w-full md:w-auto">
          <div className="flex items-center gap-2" title="当前位置">
            <MapPin className="w-3 h-3 text-zinc-500" />
            <span className="text-zinc-300">{location}</span>
          </div>
          
          <div className="flex items-center gap-2" title="日期与时间">
            <Clock className="w-3 h-3 text-zinc-500" />
            <span>{formatTime(time)}</span>
          </div>
        </div>

        {statusMessage && (
          <div className="hidden md:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 items-center gap-2 text-amber-500 animate-pulse">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>{statusMessage}</span>
          </div>
        )}

        <div className="flex flex-col md:flex-row items-start md:items-center gap-2 md:gap-6 w-full md:w-auto">
          <div className="flex items-center gap-2" title="身份">
            <User className="w-3 h-3 text-zinc-500" />
            <span className="text-zinc-300">{identity}</span>
          </div>

          <div className="flex items-center gap-2" title="当前章节">
            <BookOpen className="w-3 h-3 text-zinc-500" />
            <span>章节 {story.currentChapter}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
