import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ChevronLeft, Pencil, Play, Users, Boxes, MapPin, ScrollText,
  Sparkles, Compass, BookOpen, Swords, Package, Settings as Settings2,
} from 'lucide-react'
import type { WorldCard } from '@/types/cards'
import { CharacterSprite } from '@/components/CharacterSprite'

/**
 * 世界书预览 —— **只读地**看一个世界的全部设定。
 *
 * 为什么需要它：
 *  在这之前，想知道一张世界卡里写了什么，唯一的办法是**打开卡片编辑器**。
 *  编辑器是"改"的地方，不是"读"的地方：它满屏输入框、按钮是保存/删除，
 *  只想看看设定的人会不知所措，也容易误改。
 *
 *  预览页按**读的顺序**组织：
 *    它是什么 → 你要扮演谁 → 有什么规则 → 有哪些人 → 世界长什么样 → 开场
 *  最后才是「用这个世界开始」或「去编辑」。
 */
export function WorldbookPreview({
  world,
  onBack,
  onEdit,
  onStart,
  isBuiltin,
}: {
  world: WorldCard
  onBack: () => void
  onEdit?: () => void
  onStart: () => void
  isBuiltin?: boolean
}) {
  const [tab, setTab] = useState<'overview' | 'people' | 'world'>('overview')

  const tabs = useMemo(() => ([
    { id: 'overview' as const, label: '概览', icon: <ScrollText size={13} /> },
    { id: 'people' as const, label: `人物 (${world.characters?.length || 0})`, icon: <Users size={13} /> },
    { id: 'world' as const, label: '设定', icon: <Compass size={13} /> },
  ]), [world.characters])

  return (
    <div className="max-w-4xl mx-auto w-full px-6 py-8">
      {/* 顶栏 */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-text-muted/40 rounded hover:border-accent-lantern/50 hover:text-accent-lantern transition-colors"
        >
          <ChevronLeft size={14} /> 返回
        </button>
        <div className="flex items-center gap-2">
          {onEdit && (
            <button
              onClick={onEdit}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-text-muted/40 rounded hover:border-accent-lantern/50 hover:text-accent-lantern transition-colors"
            >
              <Pencil size={13} /> 编辑
            </button>
          )}
          <button
            onClick={onStart}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold bg-accent-lantern text-black rounded hover:bg-accent-lantern/90 transition-colors"
          >
            <Play size={13} /> 用这个世界开始
          </button>
        </div>
      </div>

      {/* 头部：封面 + 标题 + 一句话简介 */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="mb-6"
      >
        <div className="flex flex-col sm:flex-row gap-5">
          {world.cover && (
            <img src={world.cover} alt=""
              className="w-full sm:w-52 h-32 object-cover rounded border border-text-muted/30 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              {isBuiltin && (
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-accent-forge/50 text-accent-forge">
                  内置示例
                </span>
              )}
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                world.enableMechanics
                  ? 'border-accent-lantern/40 text-accent-lantern'
                  : 'border-text-muted/40 text-text-muted'
              }`}>
                {world.enableMechanics ? '机制向' : '纯叙事'}
              </span>
            </div>
            <h1 className="font-serif font-bold text-2xl text-text-primary mb-2">{world.title}</h1>
            {world.tagline && (
              <p className="text-sm text-text-secondary leading-relaxed font-serif italic">
                {world.tagline}
              </p>
            )}
          </div>
        </div>
      </motion.div>

      {/* 分页 */}
      <div className="flex border-b border-text-muted/20 mb-6">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs transition-colors border-b-2 -mb-px ${
              tab === t.id
                ? 'text-accent-lantern border-accent-lantern'
                : 'text-text-muted border-transparent hover:text-text-secondary'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ── 概览 ── */}
      {tab === 'overview' && (
        <div className="space-y-6">
          {world.story?.mainQuest && (
            /*
              ⚠️ 标签不能叫「主线目标」。
              内置的三个世界是**沙盒**：这些内容是"若干宏大宽泛的可选方向"，
              不是必须推进的主线。叫"主线目标"会让玩家以为有通关路线，
              也会让作者照着"写一个任务"来填这个字段。
            */
            <Panel icon={<Swords size={14} />} title="长期目标（可选）" hint="沙盒里可以追求的方向，不是必须做的事">
              <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">{world.story.mainQuest}</p>
            </Panel>
          )}

          {world.enableMechanics && (
            <div className="grid sm:grid-cols-2 gap-4">
              <Panel icon={<Sparkles size={14} />} title={`属性（${world.attributes.length}）`} hint={`开局可分配 ${world.attributePoints} 点`}>
                {world.attributes.length === 0
                  ? <Empty>这个世界没有定义属性</Empty>
                  : (
                    <div className="space-y-1.5">
                      {world.attributes.map(a => (
                        <div key={a.id} className="flex items-baseline gap-2">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5" style={{ background: a.color }} />
                          <span className="text-xs text-text-primary shrink-0">{a.name}</span>
                          {a.description && <span className="text-[10px] text-text-muted truncate">{a.description}</span>}
                        </div>
                      ))}
                    </div>
                  )}
              </Panel>
              <Panel icon={<Boxes size={14} />} title={`资源（${world.resources.length}）`}>
                {world.resources.length === 0
                  ? <Empty>这个世界没有定义资源</Empty>
                  : (
                    <div className="space-y-1.5">
                      {world.resources.map(r => (
                        <div key={r.id} className="flex items-baseline gap-2">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5" style={{ background: r.color }} />
                          <span className="text-xs text-text-primary shrink-0">{r.name}</span>
                          <span className="text-[10px] text-text-muted font-mono">
                            初始 {r.initial}{typeof r.max === 'number' ? ` / 上限 ${r.max}` : ''}
                            {r.critical ? ' · 归零即结局' : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
              </Panel>
            </div>
          )}

          {world.backgrounds.length > 0 && (
            <Panel icon={<Compass size={14} />} title="开局背景" hint="决定你的出身与初始加成">
              <div className="space-y-3">
                {world.backgrounds.map(slot => (
                  <div key={slot.label}>
                    <div className="text-[10px] text-accent-lantern/80 mb-1.5">{slot.label}</div>
                    <div className="grid sm:grid-cols-2 gap-2">
                      {slot.options.map(o => (
                        <div key={o.id} className="p-2.5 rounded border border-text-muted/20 bg-black/20">
                          <div className="text-xs text-text-primary mb-0.5">{o.title}</div>
                          {o.description && <div className="text-[10px] text-text-muted leading-relaxed">{o.description}</div>}
                          {o.attributeBonus && Object.keys(o.attributeBonus).length > 0 && (
                            <div className="text-[10px] text-accent-lantern/70 font-mono mt-1">
                              {Object.entries(o.attributeBonus).map(([k, v]) => {
                                const def = world.attributes.find(a => a.id === k)
                                return `${def?.name || k}${v >= 0 ? '+' : ''}${v}`
                              }).join('　')}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {world.items.length > 0 && (
            <Panel icon={<Package size={14} />} title={`预置物品（${world.items.length}）`} hint="背景会决定你开局携带哪几件">
              <div className="grid sm:grid-cols-2 gap-2">
                {world.items.map(i => (
                  <div key={i.id} className="p-2.5 rounded border border-text-muted/20 bg-black/20">
                    <div className="text-xs text-text-primary mb-0.5">{i.name}</div>
                    <div className="text-[10px] text-text-muted leading-relaxed">{i.description}</div>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {world.story?.opening && (
            <Panel icon={<BookOpen size={14} />} title="开场">
              <Prose text={world.story.opening} />
            </Panel>
          )}
        </div>
      )}

      {/* ── 人物 ── */}
      {tab === 'people' && (
        <div className="space-y-4">
          {(world.characters?.length || 0) === 0 ? (
            <Empty>这张世界卡没有内置角色卡，游戏里的 NPC 会由 AI 依据世界观生成。</Empty>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {world.characters.map(c => (
                <div key={c.id} className="flex gap-3 p-3 rounded border border-text-muted/20 bg-black/20">
                  <CharacterSprite
                    name={c.name}
                    id={c.id}
                    profile={{ name: c.name, description: c.description, personality: c.personality, scenario: c.scenario }}
                    headOnly
                    scale={4}
                    className="w-14 h-14 rounded bg-black/30 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-text-primary font-serif mb-1">{c.name}</div>
                    {c.description && (
                      <p className="text-[10px] text-text-muted leading-relaxed line-clamp-4">{c.description}</p>
                    )}
                    {c.personality && (
                      <p className="text-[10px] text-text-muted/70 leading-relaxed line-clamp-2 mt-1">
                        性格：{c.personality}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 设定 ── */}
      {tab === 'world' && (
        <div className="space-y-6">
          {world.worldLore && (
            <Panel icon={<MapPin size={14} />} title="世界观">
              <Prose text={world.worldLore} />
            </Panel>
          )}
          {world.rules && (
            <Panel icon={<ScrollText size={14} />} title="世界规则" hint="写给 AI 的硬性约束">
              <Prose text={world.rules} />
            </Panel>
          )}
          {world.lores.length > 0 && (
            <Panel icon={<BookOpen size={14} />} title={`知识条目（${world.lores.length}）`}>
              <div className="space-y-2">
                {world.lores.map(l => (
                  <div key={l.id}>
                    <div className="text-xs text-text-primary">{l.name}</div>
                    <div className="text-[10px] text-text-muted leading-relaxed">{l.description}</div>
                  </div>
                ))}
              </div>
            </Panel>
          )}
          {world.narrative?.customStyle && (
            <Panel icon={<Sparkles size={14} />} title="叙事文风" hint="写给叙事 AI 的写作要求">
              <Prose text={world.narrative.customStyle} />
            </Panel>
          )}
          <Panel icon={<Settings2 size={14} />} title="叙事参数">
            <div className="text-[11px] text-text-muted font-mono space-y-0.5">
              <div>人称：{world.narrative?.pov === 'second' ? '第二人称' : world.narrative?.pov === 'first' ? '第一人称' : '第三人称'}</div>
              <div>时态：{world.narrative?.tense === 'present' ? '现在时' : '过去时'}</div>
              <div>期望篇幅：约 {world.narrative?.replyLength || 500} 字</div>
              <div>机制层：{world.enableMechanics ? '开启' : '关闭'}</div>
              <div>章节卡事件：{world.story?.enableStages ? '开启' : '关闭'}</div>
            </div>
          </Panel>

          {/* 世界书下载入口：想照着做自己世界的人会需要 */}
          <div className="p-4 rounded border border-text-muted/20 bg-black/20">
            <div className="text-xs text-text-secondary mb-2">想照着写自己的世界？</div>
            <a href="./official-worldbook.json" download
              className="inline-flex items-center gap-1.5 text-[11px] text-accent-lantern hover:underline decoration-dotted">
              <ScrollText size={12} /> 下载官方世界书（含全部内置世界，可直接导入回来）
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 小组件 ───

function Panel({
  icon, title, hint, children,
}: { icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="p-4 rounded border border-text-muted/20 bg-surface/20">
      <div className="flex items-baseline gap-2 mb-3 flex-wrap">
        <span className="text-accent-lantern/80 shrink-0">{icon}</span>
        <h2 className="text-sm font-serif font-bold text-text-primary">{title}</h2>
        {hint && <span className="text-[10px] text-text-muted">{hint}</span>}
      </div>
      {children}
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-text-muted/70 italic leading-relaxed">{children}</p>
}

/**
 * 世界观正文的渲染。
 * 原文用 `**加粗**` 与空行分段，这里做一个最简渲染：
 * 不引入 markdown 依赖（预览页不值得再拉一个 chunk）。
 */
function Prose({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/)
  return (
    <div className="space-y-3">
      {blocks.map((b, i) => (
        <p key={i} className="text-xs text-text-secondary leading-relaxed font-serif whitespace-pre-wrap">
          {b.split(/(\*\*[^*]+\*\*)/).map((seg, j) =>
            /^\*\*[^*]+\*\*$/.test(seg)
              ? <strong key={j} className="text-text-primary">{seg.slice(2, -2)}</strong>
              : <span key={j}>{seg}</span>
          )}
        </p>
      ))}
    </div>
  )
}
