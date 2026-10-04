import { useGameStore } from '@/stores/game';
import { useSessionStore } from '@/stores/session';
import { MapPin, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { CharacterAvatar } from '@/components/CharacterAvatar'
import { CharacterSprite } from '@/components/CharacterSprite'
import { PortraitTrigger } from '@/components/PortraitPanel';

interface RelationshipPanelProps {
  className?: string;
}

export function RelationshipPanel({ className = '' }: RelationshipPanelProps) {
  const { characters } = useGameStore();
  const world = useSessionStore(s => s.world);
  const [expandedCharId, setExpandedCharId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedCharId(expandedCharId === id ? null : id);
  };

  return (
    <div className={`h-full p-4 space-y-6 overflow-y-auto bg-surface/50 border-l border-text-muted/30 ${className}`}>
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-serif text-text-secondary uppercase tracking-wider">人物关系 (Relationships)</h3>
        </div>
        
        {characters.length === 0 ? (
          <div className="text-xs text-text-muted italic text-center py-8">
            尚未遇到任何角色。
          </div>
        ) : (
          <div className="space-y-2">
            {characters.map((char) => {
              const isExpanded = expandedCharId === char.id;
              const hasTags = Boolean(char.relationship) || Boolean(char.status) || Boolean(char.location);
              return (
                <div 
                  key={char.id} 
                  onClick={() => toggleExpand(char.id)}
                  className={`p-3 bg-background/50 rounded border transition-all duration-300 cursor-pointer group
                    ${isExpanded ? 'border-accent-grail/50 bg-background/80' : 'border-text-muted/20 hover:border-accent-grail/50'}`}
                >
                  <div className="flex items-start gap-3">
                    {/*
                      用 LPC 像素立绘替换原来的 36px 圆形几何头像。
                      立绘的信息量大得多（服装、发型、体型、姿态都能表达），
                      而且素材是 64×64 原生像素、按整数倍放大，缩小时依然锐利。
                      角色卡若自带图片，仍以自带图片优先 —— 那代表作者的明确意图。
                    */}
                    {char.avatar ? (
                      <PortraitTrigger characterId={char.id}>
                        <CharacterAvatar
                          name={char.name}
                          id={char.id}
                          avatar={char.avatar}
                          avatarId={char.avatarId}
                          style={world?.avatarStyle}
                          tone={world?.avatarTone}
                          size={48}
                        />
                      </PortraitTrigger>
                    ) : (
                      <PortraitTrigger characterId={char.id}>
                        <CharacterSprite
                          name={char.name}
                          id={char.id}
                          scale={3}
                          /*
                            把角色资料传进去，立绘才会**照着描述**画
                            （黑发马尾就画黑发马尾，守卫队长就穿甲）。
                            不传的话 recipeFor 只能随机挑部件 ——
                            那正是"立绘和角色描述毫无关联"的原因。
                          */
                          profile={{
                            name: char.name,
                            description: char.description,
                            relationship: char.relationship,
                            scenario: char.prompt,
                          }}
                          /* 48px 显示，3 倍合成源（192px）在 2x/3x 屏上都够锐 */
                          className="w-12 h-12 bg-black/30"
                          headOnly
                        />
                      </PortraitTrigger>
                    )}
                    <div className="flex-1">
                      <div className="flex justify-between items-start">
                          <h4 className="text-sm font-medium text-text-primary">{char.name}</h4>
                          <div className="flex items-center gap-2">
                            {char.relationship && (
                              <span className="text-[10px] px-1.5 py-0.5 bg-surface rounded text-accent-grail border border-accent-grail/20">
                                  {char.relationship}
                              </span>
                            )}
                            {isExpanded ? <ChevronUp size={12} className="text-text-muted" /> : <ChevronDown size={12} className="text-text-muted" />}
                          </div>
                      </div>
                      
                      <p className={`text-xs text-text-secondary mt-1 transition-all ${isExpanded ? 'whitespace-pre-wrap' : 'line-clamp-2'}`}>
                        {char.description}
                      </p>
                      
                      {hasTags && (
                        <div className="flex gap-2 mt-2 text-[10px] text-text-muted flex-wrap">
                            {char.location && (
                                <span className="flex items-center gap-1 px-1.5 py-0.5 bg-surface rounded border border-text-muted/20">
                                    <MapPin size={10} /> {char.location}
                                </span>
                            )}
                            {char.status && (
                              <span className="px-1.5 py-0.5 bg-surface rounded border border-text-muted/20">
                                  {char.status}
                              </span>
                            )}
                            {isExpanded && char.stats && Object.entries(char.stats).map(([key, val]) => (
                               <span key={key} className="px-1.5 py-0.5 bg-surface rounded border border-text-muted/20 uppercase">
                                  {key}: {val}
                               </span>
                            ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
