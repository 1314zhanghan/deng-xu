import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, ArrowRight, Play, Users, Upload, Check } from 'lucide-react'
import type { PlayerCard, WorldCard } from '@/types/cards'
import { useSessionStore } from '@/stores/session'
import { useGameStore } from '@/stores/game'
import { useUIStore } from '@/stores/ui'
import { readFileAsDataURL } from '@/utils/files'

/**
 * 开局配置
 *
 * 原版的「角色创建」写死了三个出身、三个童年、三个特质，以及八种性相的加点规则。
 * 现在这里完全由世界卡驱动：槽位、选项、属性、资源、点数上限都来自卡片。
 */

interface SessionSetupProps {
  world: WorldCard
  onCancel: () => void
  onLaunch: () => void
}

const STEPS = [
  { id: 'persona', label: '扮演角色', hint: '你是谁' },
  { id: 'cast', label: '出场角色', hint: '谁会登场' },
  { id: 'background', label: '背景', hint: '你的来处' },
  { id: 'attributes', label: '属性', hint: '你的所长' }
] as const

type StepId = typeof STEPS[number]['id']

const inputCls =
  'w-full bg-black/30 border border-text-muted/30 rounded px-2 py-1.5 text-sm text-text-primary ' +
  'placeholder:text-text-muted/50 focus:border-accent-lantern outline-none'

const areaCls = `${inputCls} resize-y leading-relaxed font-serif`

export function SessionSetup({ world, onCancel, onLaunch }: SessionSetupProps) {
  const setSession = useSessionStore(s => s.setSession)
  const initFromWorld = useGameStore(s => s.initFromWorld)
  const [step, setStep] = useState<StepId>('persona')

  /**
   * 玩家档案初值**必须来自 pendingSetup**。
   *
   * 之前这里是硬编码空值，于是从「卡片编辑器 → 保存并开始」进入时，
   * player.name 是空串 → 存档里主角叫「未命名」，且所有档案字段被空值覆盖，
   * 上传的头像也一起丢了。这是 ui.pendingSetup 这个字段一直没被消费的后果。
   */
  const [player, setPlayer] = useState<PlayerCard>(() => {
    const seed = useUIStore.getState().pendingSetup?.player
    return {
      name: seed?.name || '',
      gender: seed?.gender || '',
      age: seed?.age || '',
      appearance: seed?.appearance || '',
      personality: seed?.personality || '',
      background: seed?.background || '',
      extra: seed?.extra || '',
      // 头像必须一起带过来，否则开局选的脸进不了 gameStore
      ...(seed?.avatar ? { avatar: seed.avatar } : {}),
    }
  })

  // 默认把所有标记为「在场」的角色卡都选上
  const [activeIds, setActiveIds] = useState<string[]>(
    () => world.characters.filter(c => c.present).map(c => c.id)
  )

  // 每个背景槽位默认选第一个；没有槽位时为空对象
  const [backgroundChoices, setBackgroundChoices] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    world.backgrounds.forEach(slot => {
      if (slot.options[0]) init[slot.label] = slot.options[0].id
    })
    return init
  })

  const [allocation, setAllocation] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {}
    world.attributes.forEach(a => { init[a.id] = 0 })
    return init
  })

  const patchPlayer = (p: Partial<PlayerCard>) => setPlayer(prev => ({ ...prev, ...p }))

  const totalAllocated = useMemo(
    () => Object.values(allocation).reduce((a, b) => a + b, 0),
    [allocation]
  )
  const remaining = world.attributePoints - totalAllocated

  /** 汇总最终数值：属性点 + 背景加成；资源 = 初始值 + 背景加成 */
  const finalStats = useMemo(() => {
    const attributes: Record<string, number> = { ...allocation }
    const resources: Record<string, number> = {}
    world.resources.forEach(r => { resources[r.id] = r.initial })

    world.backgrounds.forEach(slot => {
      const chosenId = backgroundChoices[slot.label]
      const option = slot.options.find(o => o.id === chosenId)
      if (!option) return
      Object.entries(option.attributeBonus || {}).forEach(([k, v]) => {
        if (k in attributes) attributes[k] += v
      })
      Object.entries(option.resourceBonus || {}).forEach(([k, v]) => {
        if (k in resources) resources[k] += v
      })
    })

    // 资源上下限夹取，避免背景加成把上限撑破
    world.resources.forEach(r => {
      resources[r.id] = Math.max(0, resources[r.id])
      if (typeof r.max === 'number') resources[r.id] = Math.min(resources[r.id], r.max)
    })

    return { attributes, resources }
  }, [allocation, backgroundChoices, world])

  /** 背景带来的开局物品 */
  const startingItems = useMemo(() => {
    const ids = new Set<string>()
    world.backgrounds.forEach(slot => {
      const option = slot.options.find(o => o.id === backgroundChoices[slot.label])
      option?.startingItems?.forEach(id => ids.add(id))
    })
    return world.items.filter(i => ids.has(i.id))
  }, [backgroundChoices, world])

  const stepIndex = STEPS.findIndex(s => s.id === step)
  const activeCharacters = world.characters.filter(c => activeIds.includes(c.id))

  const canLaunch = world.enableMechanics ? remaining >= 0 : true

  const handleLaunch = () => {
    // 1. 装载数值体系（定义属性与资源）
    initFromWorld(world)

    // 2. 写入玩家档案（头像也要一起带进 gameStore，否则游戏界面读不到）
    useGameStore.getState().setPlayerProfile(
      player.name.trim() || '无名者',
      player.gender,
      player.appearance,
      player.avatar
    )

    // 3. 应用属性、资源与背景
    useGameStore.getState().setAspects(finalStats.attributes)
    useGameStore.getState().setResources(finalStats.resources)

    // 4. 记录背景选择到 story 状态
    const [firstSlot, ...restSlots] = world.backgrounds
    const firstChoice = firstSlot ? backgroundChoices[firstSlot.label] : null
    useGameStore.getState().setStoryState({
      origin: firstChoice,
      childhood: restSlots[0] ? backgroundChoices[restSlots[0].label] : null,
      uniqueTrait: restSlots[1] ? backgroundChoices[restSlots[1].label] : null
    })

    // 5. 开局物品
    startingItems.forEach(item => {
      useGameStore.getState().addItem({ ...item, tags: [...item.tags] })
    })

    // 6. 在场角色写进关系面板，并带上角色卡提示词
    activeCharacters.forEach(card => {
      useGameStore.getState().addCharacter({
        id: card.id,
        name: card.name,
        description: card.description,
        relationship: card.relationship || '未知',
        status: card.status || '正常',
        location: card.location,
        avatar: card.avatar,
        // 把角色卡的核心资料压成一段提示词，引擎会注入叙事 AI
        prompt: [card.personality, card.scenario, card.messageExamples]
          .filter(Boolean)
          .join('\n')
      })
    })

    // 7. 起始时间与地点：世界卡没有定义纪元，用中性默认值
    useGameStore.getState().setTime({ year: 1, month: 1, day: 1, hour: 9, minute: 0 })
    const firstCharacterLocation = activeCharacters.find(c => c.location)?.location
    useGameStore.getState().setLocation(firstCharacterLocation || world.title)

    // 8. 建立会话
    setSession({
      world,
      player: player.name.trim() ? player : { ...player, name: '无名者' },
      activeCharacterIds: activeIds,
      backgroundChoices,
      attributeAllocation: allocation
    })

    onLaunch()
  }

  const handleAvatarUpload = async (file: File | undefined) => {
    if (!file) return
    patchPlayer({ avatar: await readFileAsDataURL(file) })
  }

  return (
    <div className="min-h-screen min-h-[100dvh] w-full bg-background text-text-primary flex flex-col">
      {/* 顶栏 */}
      <header className="flex items-center justify-between gap-4 px-6 py-4 border-b border-text-muted/20">
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 text-xs text-text-muted hover:text-accent-lantern transition-colors"
        >
          <ArrowLeft size={14} /> 返回卡库
        </button>
        <div className="text-center min-w-0">
          <h1 className="font-serif font-bold text-accent-lantern truncate">{world.title}</h1>
          <p className="text-[10px] text-text-muted font-mono truncate">{world.tagline || '角色创建'}</p>
        </div>
        <div className="w-20" />
      </header>

      {/* 步骤指示 */}
      <div className="flex items-center justify-center gap-2 py-4 border-b border-text-muted/10">
        {STEPS.map((s, i) => (
          <button
            key={s.id}
            onClick={() => setStep(s.id)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs transition-colors
              ${step === s.id
                ? 'bg-accent-lantern/15 border border-accent-lantern/40 text-accent-lantern'
                : i < stepIndex
                  ? 'text-text-secondary hover:text-accent-lantern'
                  : 'text-text-muted hover:text-text-secondary'}`}
          >
            <span className="font-mono opacity-60">{i + 1}</span>
            <span className="hidden sm:inline">{s.label}</span>
            {i < stepIndex && <Check size={12} className="text-accent-lantern/70" />}
          </button>
        ))}
      </div>

      {/* 内容 */}
      <main className="flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-4xl mx-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.25 }}
              className="space-y-6"
            >
              {/* ==== 扮演角色 ==== */}
              {step === 'persona' && (
                <>
                  <div>
                    <h2 className="font-serif text-2xl font-bold">你要扮演谁？</h2>
                    <p className="text-xs text-text-muted mt-1">
                      这些信息会注入提示词，AI 会据此使用正确的代称并呼应你的外貌与性格。
                    </p>
                  </div>

                  <div className="grid md:grid-cols-[10rem_1fr] gap-6">
                    <div className="space-y-2">
                      {player.avatar
                        ? <img src={player.avatar} alt="" className="w-40 h-40 rounded object-cover border border-text-muted/30" />
                        : <div className="w-40 h-40 rounded border border-dashed border-text-muted/30 flex items-center justify-center text-text-muted text-xs">
                          无头像
                        </div>}
                      <label className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs border border-text-muted/40 rounded hover:border-accent-lantern/50 hover:text-accent-lantern transition-colors cursor-pointer">
                        <Upload size={13} /> 上传头像
                        <input type="file" accept="image/*" className="hidden"
                          onChange={e => handleAvatarUpload(e.target.files?.[0])} />
                      </label>
                      {player.avatar && (
                        <button onClick={() => patchPlayer({ avatar: undefined })}
                          className="w-full text-[10px] text-text-muted hover:text-red-400 transition-colors">
                          移除头像
                        </button>
                      )}
                    </div>

                    <div className="space-y-4">
                      {/* 手机上单列堆叠：「性别 / 代称」这类标签在三列窄格里会折行 */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <label className="block space-y-1 min-w-0">
                          <span className="block text-xs text-text-secondary whitespace-nowrap">姓名</span>
                          <input className={`${inputCls} min-w-0`} value={player.name}
                            onChange={e => patchPlayer({ name: e.target.value })} placeholder="你的名字" />
                        </label>
                        <label className="block space-y-1 min-w-0">
                          <span className="block text-xs text-text-secondary whitespace-nowrap">性别 / 代称</span>
                          <input className={`${inputCls} min-w-0`} value={player.gender}
                            onChange={e => patchPlayer({ gender: e.target.value })} placeholder="可留空" />
                        </label>
                        <label className="block space-y-1 min-w-0">
                          <span className="block text-xs text-text-secondary whitespace-nowrap">年龄</span>
                          <input className={`${inputCls} min-w-0`} value={player.age}
                            onChange={e => patchPlayer({ age: e.target.value })} placeholder="可留空" />
                        </label>
                      </div>

                      <label className="block space-y-1">
                        <span className="text-xs text-text-secondary">外貌</span>
                        <textarea className={`${areaCls} h-20`} value={player.appearance}
                          onChange={e => patchPlayer({ appearance: e.target.value })}
                          placeholder="AI 会在动作描写里呼应这些特征。" />
                      </label>

                      <label className="block space-y-1">
                        <span className="text-xs text-text-secondary">性格</span>
                        <textarea className={`${areaCls} h-16`} value={player.personality}
                          onChange={e => patchPlayer({ personality: e.target.value })} />
                      </label>

                      <label className="block space-y-1">
                        <span className="text-xs text-text-secondary">背景故事</span>
                        <textarea className={`${areaCls} h-20`} value={player.background}
                          onChange={e => patchPlayer({ background: e.target.value })}
                          placeholder="你的经历、身份、为何出现在这里。" />
                      </label>

                      <label className="block space-y-1">
                        <span className="text-xs text-text-secondary">其他补充</span>
                        <textarea className={`${areaCls} h-14`} value={player.extra}
                          onChange={e => patchPlayer({ extra: e.target.value })}
                          placeholder="任何希望 AI 知道的事。" />
                      </label>
                    </div>
                  </div>
                </>
              )}

              {/* ==== 出场角色 ==== */}
              {step === 'cast' && (
                <>
                  <div>
                    <h2 className="font-serif text-2xl font-bold">谁会登场？</h2>
                    <p className="text-xs text-text-muted mt-1">
                      选中的角色会作为「出场角色档案」注入提示词，并在关系面板里出现。
                    </p>
                  </div>

                  {world.characters.length === 0 ? (
                    <div className="p-8 text-center text-sm text-text-muted border border-dashed border-text-muted/20 rounded">
                      这个世界卡还没有角色卡。你可以直接开始，让 AI 自行生成 NPC；
                      <br />
                      也可以返回卡库编辑世界卡，导入 SillyTavern 角色卡。
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-3 text-xs">
                        <button
                          onClick={() => setActiveIds(world.characters.map(c => c.id))}
                          className="text-accent-lantern hover:underline"
                        >
                          全选
                        </button>
                        <span className="text-text-muted">|</span>
                        <button onClick={() => setActiveIds([])} className="text-text-muted hover:text-text-secondary">
                          全不选
                        </button>
                        <span className="ml-auto text-text-muted">已选 {activeIds.length} / {world.characters.length}</span>
                      </div>

                      <div className="grid sm:grid-cols-2 gap-3">
                        {world.characters.map(card => {
                          const on = activeIds.includes(card.id)
                          return (
                            <button
                              key={card.id}
                              onClick={() => setActiveIds(prev =>
                                on ? prev.filter(id => id !== card.id) : [...prev, card.id]
                              )}
                              className={`text-left p-3 rounded border transition-colors flex gap-3
                                ${on
                                  ? 'bg-accent-lantern/10 border-accent-lantern/40'
                                  : 'bg-black/20 border-text-muted/20 hover:border-text-muted/40 opacity-70'}`}
                            >
                              {card.avatar
                                ? <img src={card.avatar} alt="" className="w-12 h-12 rounded-full object-cover flex-shrink-0" />
                                : <div className="w-12 h-12 rounded-full bg-surface flex items-center justify-center flex-shrink-0 text-text-muted">
                                  <Users size={18} />
                                </div>}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm text-text-primary truncate">{card.name}</span>
                                  {on && <Check size={12} className="text-accent-lantern flex-shrink-0" />}
                                </div>
                                {card.relationship && (
                                  <div className="text-[10px] text-text-muted truncate">{card.relationship}</div>
                                )}
                                <p className="text-xs text-text-secondary mt-1 line-clamp-2 leading-relaxed">
                                  {card.description || card.personality || '（暂无描述）'}
                                </p>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    </>
                  )}
                </>
              )}

              {/* ==== 背景 ==== */}
              {step === 'background' && (
                <>
                  <div>
                    <h2 className="font-serif text-2xl font-bold">你的来处</h2>
                    <p className="text-xs text-text-muted mt-1">
                      由世界卡定义的背景槽位，会带来属性与资源加成，也可能决定开局物品。
                    </p>
                  </div>

                  {world.backgrounds.length === 0 ? (
                    <div className="p-8 text-center text-sm text-text-muted border border-dashed border-text-muted/20 rounded">
                      这个世界卡没有定义背景槽位，直接进入下一步即可。
                    </div>
                  ) : (
                    <div className="space-y-8">
                      {world.backgrounds.map(slot => (
                        <div key={slot.label} className="space-y-3">
                          <h3 className="text-sm font-bold text-accent-lantern border-b border-text-muted/20 pb-2">
                            {slot.label}
                          </h3>
                          <div className="grid sm:grid-cols-2 gap-3">
                            {slot.options.map(option => {
                              const on = backgroundChoices[slot.label] === option.id
                              return (
                                <button
                                  key={option.id}
                                  onClick={() => setBackgroundChoices(prev => ({ ...prev, [slot.label]: option.id }))}
                                  className={`text-left p-3 rounded border transition-colors
                                    ${on
                                      ? 'bg-accent-lantern/10 border-accent-lantern/40'
                                      : 'bg-black/20 border-text-muted/20 hover:border-text-muted/40'}`}
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-bold text-text-primary">{option.title}</span>
                                    {on && <Check size={12} className="text-accent-lantern" />}
                                  </div>
                                  {option.description && (
                                    <p className="text-xs text-text-secondary mt-1 leading-relaxed">{option.description}</p>
                                  )}
                                  <div className="flex flex-wrap gap-2 mt-2">
                                    {Object.entries(option.attributeBonus || {}).map(([k, v]) => {
                                      const def = world.attributes.find(a => a.id === k)
                                      if (!def || !v) return null
                                      return (
                                        <span key={k} className="text-[10px] px-1.5 py-0.5 rounded border"
                                          style={{ color: def.color, borderColor: `${def.color}55` }}>
                                          {def.name} {v > 0 ? '+' : ''}{v}
                                        </span>
                                      )
                                    })}
                                    {Object.entries(option.resourceBonus || {}).map(([k, v]) => {
                                      const def = world.resources.find(r => r.id === k)
                                      if (!def || !v) return null
                                      return (
                                        <span key={k} className="text-[10px] px-1.5 py-0.5 rounded border"
                                          style={{ color: def.color, borderColor: `${def.color}55` }}>
                                          {def.name} {v > 0 ? '+' : ''}{v}
                                        </span>
                                      )
                                    })}
                                  </div>
                                </button>
                              )
                            })}
                            {slot.options.length === 0 && (
                              <div className="text-xs text-text-muted italic">该槽位暂无选项。</div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* ==== 属性 ==== */}
              {step === 'attributes' && (
                <>
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <h2 className="font-serif text-2xl font-bold">
                        {world.enableMechanics ? '你的所长' : '属性分配'}
                      </h2>
                      <p className="text-xs text-text-muted mt-1">
                        {world.enableMechanics
                          ? `可自由分配 ${world.attributePoints} 点。属性会影响 AI 对你行动风格的判断。`
                          : '这个世界卡关闭了机制层，数值不会生效。'}
                      </p>
                    </div>
                    {world.enableMechanics && (
                      <div className="text-right flex-shrink-0">
                        <div className="text-[10px] text-text-muted">剩余点数</div>
                        <div className={`text-2xl font-mono font-bold ${remaining === 0 ? 'text-green-500' : remaining < 0 ? 'text-red-400' : 'text-accent-lantern'}`}>
                          {remaining}
                        </div>
                      </div>
                    )}
                  </div>

                  {world.enableMechanics && (
                    <>
                      <div className="grid sm:grid-cols-2 gap-3">
                        {world.attributes.map(def => {
                          const value = finalStats.attributes[def.id] ?? 0
                          const manual = allocation[def.id] ?? 0
                          return (
                            <div key={def.id} className="p-3 rounded border border-text-muted/20 bg-black/20 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="font-bold" style={{ color: def.color }}>{def.name}</span>
                                <span className="font-mono text-xl" style={{ color: def.color }}>{value}</span>
                              </div>
                              {def.description && (
                                <p className="text-[10px] text-text-secondary leading-relaxed">{def.description}</p>
                              )}
                              <div className="flex items-center gap-2 pt-1">
                                <button
                                  onClick={() => setAllocation(prev => ({ ...prev, [def.id]: Math.max(0, (prev[def.id] || 0) - 1) }))}
                                  disabled={manual === 0}
                                  className="flex-1 py-1 text-sm bg-surface/40 rounded hover:bg-surface/60 disabled:opacity-20"
                                >
                                  −
                                </button>
                                <span className="text-[10px] text-text-muted w-16 text-center font-mono">
                                  已加 {manual}
                                </span>
                                <button
                                  onClick={() => setAllocation(prev => ({ ...prev, [def.id]: (prev[def.id] || 0) + 1 }))}
                                  disabled={remaining <= 0}
                                  className="flex-1 py-1 text-sm bg-surface/40 rounded hover:bg-surface/60 disabled:opacity-20"
                                >
                                  +
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>

                      {/* 资源预览 */}
                      <div className="pt-4 border-t border-text-muted/20 space-y-3">
                        <h3 className="text-sm font-bold text-accent-lantern">开局数值</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          {world.resources.map(def => {
                            const value = finalStats.resources[def.id] ?? 0
                            const pct = typeof def.max === 'number' && def.max > 0
                              ? Math.min(100, (value / def.max) * 100)
                              : 100
                            return (
                              <div key={def.id} className="p-3 rounded border border-text-muted/20 bg-black/20 space-y-1.5">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-text-secondary">{def.name}</span>
                                  <span className="font-mono" style={{ color: def.color }}>
                                    {value}{typeof def.max === 'number' ? ` / ${def.max}` : ''}
                                  </span>
                                </div>
                                {typeof def.max === 'number' && (
                                  <div className="h-1.5 bg-surface/40 rounded-full overflow-hidden">
                                    <div className="h-full rounded-full transition-all"
                                      style={{ width: `${pct}%`, backgroundColor: def.color }} />
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>

                      {/* 开局物品 */}
                      {startingItems.length > 0 && (
                        <div className="pt-4 border-t border-text-muted/20 space-y-3">
                          <h3 className="text-sm font-bold text-accent-lantern">开局携带</h3>
                          <div className="grid sm:grid-cols-2 gap-2">
                            {startingItems.map(item => (
                              <div key={item.id} className="p-2 rounded border border-text-muted/20 bg-black/20">
                                <div className="text-xs text-text-primary">{item.name}</div>
                                <div className="text-[10px] text-text-muted mt-0.5 leading-relaxed">{item.description}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* 开场预览 */}
                  {world.story.opening && (
                    <div className="pt-4 border-t border-text-muted/20 space-y-2">
                      <h3 className="text-sm font-bold text-accent-lantern">开场</h3>
                      <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap font-serif">
                        {world.story.opening}
                      </p>
                    </div>
                  )}
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* 底部导航 */}
      <footer className="flex items-center justify-between gap-4 px-6 py-4 border-t border-text-muted/20">
        <button
          onClick={() => setStep(STEPS[Math.max(0, stepIndex - 1)].id)}
          disabled={stepIndex === 0}
          className="flex items-center gap-1.5 px-4 py-2 text-sm border border-text-muted/40 rounded hover:text-accent-lantern hover:border-accent-lantern/40 transition-colors disabled:opacity-30 disabled:hover:text-text-muted"
        >
          <ArrowLeft size={14} /> 上一步
        </button>

        <div className="flex items-center gap-3">
          {!canLaunch && (
            <span className="text-xs text-red-400">还有 {Math.abs(remaining)} 点未分配完</span>
          )}
          {stepIndex < STEPS.length - 1 ? (
            <button
              onClick={() => setStep(STEPS[stepIndex + 1].id)}
              className="flex items-center gap-1.5 px-5 py-2 text-sm bg-accent-lantern/15 border border-accent-lantern/40 text-accent-lantern rounded hover:bg-accent-lantern/25 transition-colors"
            >
              下一步 <ArrowRight size={14} />
            </button>
          ) : (
            <button
              onClick={handleLaunch}
              disabled={!canLaunch}
              className="flex items-center gap-1.5 px-6 py-2 text-sm bg-accent-lantern text-black font-bold rounded hover:bg-accent-lantern/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Play size={14} /> 开始故事
            </button>
          )}
        </div>
      </footer>
    </div>
  )
}

export default SessionSetup
