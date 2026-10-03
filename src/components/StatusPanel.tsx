import { useGameStore } from '@/stores/game';
import { useUIStore } from '@/stores/ui';
import { useSessionStore } from '@/stores/session';
import { CharacterAvatar } from '@/components/CharacterAvatar';
import {
  Sparkles,
  Zap,
  Shield,
  Eye,
  Flame,
  Droplet,
  Star,
  Gauge,
  LogOut,
  Settings,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** 通用图标池：属性名由世界卡自定义，所以只按索引轮换图标 */
const ATTRIBUTE_ICONS: LucideIcon[] = [Sparkles, Zap, Shield, Eye, Flame, Droplet, Star, Gauge];
const RESOURCE_ICONS: LucideIcon[] = [Gauge, Sparkles, Shield, Droplet, Star, Flame, Zap, Eye];

interface StatusPanelProps {
  className?: string;
}

export function StatusPanel({ className = '' }: StatusPanelProps) {
  const { resources, resourceDefs, aspects, attributeDefs, returnToTitle, playerName, playerGender, playerAppearance, playerAvatar } = useGameStore();
  const { setApiKeyModalOpen } = useUIStore();
  const world = useSessionStore(s => s.world);

  // 生成头像的种子必须派生自「开局时定下的身份」，不能用 playerAvatar 之类的可变字段，
  // 否则换装备/改状态也会换一张脸。名字与性别在整局里是稳定的。
  const playerAvatarSeed = `player:${playerName || 'hero'}:${playerGender || 'x'}`;

  return (
    <div className={`h-full p-4 space-y-6 overflow-y-auto bg-surface/30 border-r border-text-muted/20 backdrop-blur-sm flex flex-col ${className}`}>
      {/*
        玩家档案。之前这里只有资源/属性，玩家上传的头像在游戏内完全没有出口
        （session 里存着，但没有任何组件读它），所以「上传了却看不到」。
      */}
      <section className="space-y-3">
        <h3 className="text-xs font-serif text-text-muted uppercase tracking-[0.2em] border-b border-text-muted/20 pb-2">角色</h3>
        <div className="flex items-center gap-3 p-3 bg-black/20 rounded-sm border border-text-muted/10">
          <CharacterAvatar
            name={playerName || '主角'}
            id={playerAvatarSeed}
            avatar={playerAvatar}
            style={world?.avatarStyle}
            tone={world?.avatarTone}
            size={44}
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-serif text-text-primary truncate" title={playerName}>
              {playerName || '未命名'}
            </div>
            <div className="text-[10px] text-text-muted truncate">
              {[playerGender, world?.title].filter(Boolean).join(' · ') || '—'}
            </div>
          </div>
        </div>
        {playerAppearance && (
          <p className="text-[11px] text-text-secondary leading-relaxed line-clamp-3 font-serif" title={playerAppearance}>
            {playerAppearance}
          </p>
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

      <div className="pt-6 mt-auto border-t border-text-muted/20 space-y-2">
        <button
          onClick={() => setApiKeyModalOpen(true)}
          className="w-full flex items-center justify-center gap-2 p-2 text-sm text-text-muted hover:text-accent-lantern hover:bg-accent-lantern/10 border border-transparent hover:border-accent-lantern/30 rounded transition-all"
        >
          <Settings size={14} />
          <span>模型设置</span>
        </button>
        <button
          onClick={returnToTitle}
          className="w-full flex items-center justify-center gap-2 p-2 text-sm text-text-muted hover:text-accent-lantern hover:bg-accent-lantern/10 border border-transparent hover:border-accent-lantern/30 rounded transition-all"
        >
          <LogOut size={14} />
          <span>返回标题</span>
        </button>
      </div>
    </div>
  );
}
