import { useGameStore } from '@/stores/game';
import { useSessionStore } from '@/stores/session';
import { GameMenuActions } from '@/components/GameMenuActions';
import {
  Sparkles,
  Zap,
  Shield,
  Eye,
  Flame,
  Droplet,
  Star,
  Gauge,
  Compass,
  ScrollText,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** 通用图标池：属性名由世界卡自定义，所以只按索引轮换图标 */
const ATTRIBUTE_ICONS: LucideIcon[] = [Sparkles, Zap, Shield, Eye, Flame, Droplet, Star, Gauge];
const RESOURCE_ICONS: LucideIcon[] = [Gauge, Sparkles, Shield, Droplet, Star, Flame, Zap, Eye];

/** 身份标签的字数上限。玩家填的是自由文本（可能一整段自述），标签只取开头那一小截 */
const IDENTITY_LABEL_MAX = 14;

/**
 * 把玩家的**自设背景**（`PlayerCard.background`）压成一个短身份标签。
 *
 * 为什么需要它：
 *  选角页让玩家认真写了「刑部正四品，掌刑名」这类自述，而它原先**只进了提示词**，
 *  界面上一个字都看不到 —— 玩家感觉自己的设定没被承认，代入感不闭环。
 *  但整段背景（常常上百字）铺在状态栏/角色卡里又太长，所以只取
 *  **第一句 → 第一个分句**，并剥掉「我是…」这类口语前缀。
 *
 * 为什么不直接用 AI 给出的 `identity`：那个是剧情推进中变化的**当前身份**，
 *  开局时是空的（要等第一轮 SET_IDENTITY）。玩家自己想的那一版不能等 AI。
 */
export function shortIdentityLabel(background: string, max = IDENTITY_LABEL_MAX): string {
  const first = String(background || '')
    .split(/[\n。；;]/)[0]          // 只取第一句
    .split(/[，,、]/)[0]            // 再取第一个分句
    // ⚠️ 量词必须跟在前缀**同一个正则**里：写成 "我是|我是一名" 的并列时，
    // 正则按顺序先命中 `我是`，结果留下孤零零的「一名……」（探针实测抓到过）。
    .replace(/^(?:我是|本人是|我乃|我叫)(?:一名|一位|一个)?\s*/, '')
    .trim();
  if (!first) return '';
  return first.length > max ? `${first.slice(0, max)}…` : first;
}

interface StatusPanelProps {
  className?: string;
  /**
   * 打开编年史。
   * 可选：手机端的状态抽屉（MobileSheet）不传它 —— 手机端走「更多」菜单的入口，
   * 面板里就没有必要再放一个。桌面左栏由 App 传入。
   */
  onOpenChronicle?: () => void;
}

export function StatusPanel({ className = '', onOpenChronicle }: StatusPanelProps) {
  const { resources, resourceDefs, aspects, attributeDefs, playerName, playerGender, playerAppearance, identity } = useGameStore();
  const world = useSessionStore(s => s.world);
  const playerBackground = useSessionStore(s => s.player?.background ?? '');
  const selfIdentity = shortIdentityLabel(playerBackground);
  /** AI 在剧情里给出的"当前身份"（开局为空，随 SET_IDENTITY 变化） */
  const currentIdentity = identity;
  return (
    <div className={`h-full p-4 space-y-6 overflow-y-auto bg-surface/30 border-r border-text-muted/20 backdrop-blur-sm flex flex-col ${className}`}>
      {/*
        玩家档案 —— **不放立绘**。
        主角就是玩家自己，不需要引擎替他生成一张脸：那张脸是从名字随机来的，
        与玩家填的「外貌」描述无关，等于展示一个陌生人。
        上传自定义头像也已移除（与像素风格冲突，且只影响一个小方块）。
        这里改为一个中性的印记，保持版式不塌。
      */}
      <section className="space-y-3">
        <h3 className="text-xs font-serif text-text-muted uppercase tracking-[0.2em] border-b border-text-muted/20 pb-2">角色</h3>
        <div className="flex items-center gap-3 p-3 bg-black/20 rounded-sm border border-text-muted/10">
          <div
            className="w-12 h-12 shrink-0 rounded-sm border border-accent-lantern/25 bg-gradient-to-br from-accent-lantern/10 to-transparent flex items-center justify-center"
            aria-hidden="true"
          >
            <Compass size={20} className="text-accent-lantern/70" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-serif text-text-primary truncate" title={playerName}>
              {playerName || '未命名'}
            </div>
            <div className="text-[10px] text-text-muted truncate">
              {[playerGender, world?.title].filter(Boolean).join(' · ') || '—'}
            </div>
          </div>
        </div>
        {/*
          身份标签。
          ⚠️ 这里刻意**不显示整段自设背景**（可能上百字）：一段长文字铺在窄栏里
          既挤掉下面的资源条，玩家也读不出重点。只给一个短标签，
          完整自述挂在 title 上（想看再悬停）。
        */}
        {(selfIdentity || currentIdentity) && (
          <div className="flex items-center gap-2 flex-wrap text-[11px]" title={playerBackground || undefined}>
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-accent-lantern/30 bg-accent-lantern/5 text-accent-lantern/90 font-serif max-w-full">
              <span className="text-[10px] text-accent-lantern/60 shrink-0">身份</span>
              <span className="truncate">{selfIdentity || currentIdentity}</span>
            </span>
            {selfIdentity && currentIdentity && currentIdentity !== selfIdentity && (
              <span className="text-[10px] text-text-muted truncate" title="剧情推进中由 AI 更新的当前身份">
                当前 · {currentIdentity}
              </span>
            )}
          </div>
        )}

        {playerAppearance && (
          <p className="text-[11px] text-text-secondary leading-relaxed line-clamp-3 font-serif" title={playerAppearance}>
            {playerAppearance}
          </p>
        )}

        {/*
          编年史入口。
          放"角色"这一节而不是最底部：长局里"我做过什么"和"我是谁"是同一类回看需求，
          而底部已经被 GameMenuActions 占据（返回标题 / 模型设置）。
        */}
        {onOpenChronicle && (
          <button
            onClick={onOpenChronicle}
            className="w-full flex items-center justify-center gap-2 p-2 text-xs text-text-muted hover:text-accent-lantern hover:bg-accent-lantern/10 border border-text-muted/20 hover:border-accent-lantern/30 rounded-sm transition-all"
          >
            <ScrollText size={13} />
            <span>编年史</span>
          </button>
        )}
      </section>

      {/* 资源 */}
      <section className="space-y-3">
        <h3 className="text-xs font-serif text-text-muted uppercase tracking-[0.2em] border-b border-text-muted/20 pb-2">资源</h3>

        {resourceDefs.length === 0 ? (
          <p className="text-xs text-text-muted italic">当前世界未定义任何资源。</p>
        ) : (
          <div className="space-y-2">
            {resourceDefs.map((def, index) => {
              const Icon = RESOURCE_ICONS[index % RESOURCE_ICONS.length];
              const value = resources[def.id] ?? 0;
              const color = def.color || '#a3a3a3';
              const hasMax = typeof def.max === 'number' && def.max > 0;
              // 关键资源见底时给出警示
              const isLow = def.critical === true && hasMax && value <= (def.max as number) * 0.3;
              const percent = hasMax ? Math.max(0, Math.min(100, (value / (def.max as number)) * 100)) : 100;

              return (
                <div
                  key={def.id}
                  title={def.description}
                  className={`p-3 bg-black/20 rounded-sm border transition-colors group ${
                    isLow ? 'border-accent-grail/50' : 'border-text-muted/10 hover:border-text-muted/30'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 text-text-secondary transition-colors">
                      <Icon size={16} className="opacity-70" style={{ color }} />
                      <span className="text-sm font-serif">{def.name}</span>
                      {isLow && (
                        <span className="text-[10px] px-1 py-0.5 rounded-sm border border-accent-grail/40 text-accent-grail animate-pulse">
                          告急
                        </span>
                      )}
                    </div>
                    <span
                      className={`font-mono ${isLow ? 'text-accent-grail animate-pulse' : ''}`}
                      style={isLow ? undefined : { color }}
                    >
                      {hasMax ? `${value} / ${def.max}` : value}
                    </span>
                  </div>
                  {hasMax && (
                    <div className="mt-2 h-1 w-full bg-black/40 rounded-sm overflow-hidden">
                      <div
                        className="h-full transition-all duration-300"
                        style={{ width: `${percent}%`, backgroundColor: isLow ? '#ef4444' : color }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 属性 */}
      <section className="space-y-3">
        <h3 className="text-xs font-serif text-text-muted uppercase tracking-[0.2em] border-b border-text-muted/20 pb-2">属性</h3>

        {attributeDefs.length === 0 ? (
          <p className="text-xs text-text-muted italic">当前世界未定义任何属性。</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {attributeDefs.map((def, index) => {
              const Icon = ATTRIBUTE_ICONS[index % ATTRIBUTE_ICONS.length];
              const value = aspects[def.id] ?? 0;
              const color = def.color || '#a3a3a3';

              return (
                <div
                  key={def.id}
                  title={def.description}
                  className="flex items-center gap-2 p-2 bg-black/20 rounded-sm border border-text-muted/10 hover:border-text-muted/30 transition-colors"
                >
                  <span
                    className="w-8 h-8 flex items-center justify-center rounded-sm border border-white/5 shrink-0"
                    style={{ backgroundColor: `${color}1a`, color }}
                  >
                    <Icon size={16} className="opacity-90" />
                  </span>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[10px] tracking-wider text-text-muted truncate" title={def.name}>
                      {def.name}
                    </span>
                    <span className="text-sm font-mono font-bold" style={{ color }}>{value}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/*
        全局操作抽成了 GameMenuActions。
        原先「返回标题 / 模型设置」写在这里的最底部（mt-auto 之后），
        手机端因为 StatusPanel 被放进菜单的滚动容器，
        玩家要滚过所有属性才看得到 —— 于是"没有返回主菜单"成了真实反馈。
      */}
      <GameMenuActions className="pt-6 mt-auto border-t border-text-muted/20" />
    </div>
  );
}
