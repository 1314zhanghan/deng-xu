import { describe, it, expect } from 'vitest'
import { WORLD_TONES, WORLD_TONE_IDS, getWorldTone, rgbToHex, toneAccent } from '@/utils/worldTone'

/**
 * 世界色调。
 *
 * 这些断言不是走形式 —— 色板索引的**语义约定**是场景绘制代码的前提：
 * `sceneArt.ts` 对四套色板用同一套绘制逻辑，靠的就是
 * 「0 最暗、12 最亮、13/14 暖点缀、15 冷点缀」这个约定。
 * 哪一套色板破坏了这个约定，某个场景就会在某套色调下变得不可读。
 */
describe('世界色调', () => {
  it('四套色调都有唯一 id 与中文标签', () => {
    expect(WORLD_TONE_IDS).toHaveLength(4)
    for (const id of WORLD_TONE_IDS) {
      const t = WORLD_TONES[id]
      expect(t.id).toBe(id)
      expect(t.label).toMatch(/[\u4e00-\u9fa5]/)
      expect(t.hint).toMatch(/[\u4e00-\u9fa5]/)
    }
  })

  it('每套都是完整的 16 色', () => {
    for (const id of WORLD_TONE_IDS) {
      expect(WORLD_TONES[id].ramp, id).toHaveLength(16)
    }
  })

  it('索引语义约定：0 最暗、12 最亮（sceneArt 依赖这个约定）', () => {
    const lum = ([r, g, b]: readonly [number, number, number]) => 0.299 * r + 0.587 * g + 0.114 * b
    for (const id of WORLD_TONE_IDS) {
      const ramp = WORLD_TONES[id].ramp
      // 前 13 档必须单调不减 —— 这是"从最暗到最亮"的定义
      for (let i = 1; i < 13; i++) {
        expect(lum(ramp[i]), `${id} 第 ${i} 档应不暗于第 ${i - 1} 档`).toBeGreaterThanOrEqual(lum(ramp[i - 1]) - 1)
      }
      expect(lum(ramp[0])).toBeLessThan(lum(ramp[12]))
    }
  })

  it('每档颜色都不重复（否则"过渡"会变成色带断裂）', () => {
    for (const id of WORLD_TONE_IDS) {
      const keys = WORLD_TONES[id].ramp.map(c => c.join(','))
      expect(new Set(keys).size, id).toBe(16)
    }
  })

  it('暖点缀（13/14）在非冷色调里确实偏暖', () => {
    for (const id of WORLD_TONE_IDS) {
      const t = WORLD_TONES[id]
      if (t.cool) continue
      const [r, , b] = t.ramp[14]
      expect(r, `${id} 的暖点缀应偏红`).toBeGreaterThan(b + 20)
    }
  })

  it('冷色调（霓虹/全息）被正确标记 —— 它们不能用暖橙点缀', () => {
    expect(WORLD_TONES.neon.cool).toBe(true)
    expect(WORLD_TONES.holo.cool).toBe(true)
    expect(WORLD_TONES.ink.cool).toBeFalsy()
    expect(WORLD_TONES.parchment.cool).toBeFalsy()
  })

  it('色调之间主色确实不同（否则这个选项没有意义）', () => {
    const mids = WORLD_TONE_IDS.map(id => WORLD_TONES[id].ramp[6].join(','))
    expect(new Set(mids).size).toBe(4)
  })

  it('点缀色也因色调而异 —— 共用点缀会让两套色调看不出区别', () => {
    // 第一版让霓虹和全息共用同一个冷点缀 [90,130,140]，两者观感就没有差别了。
    // 这条断言守住"每套色调有自己的点缀色"。
    for (const idx of [14, 15]) {
      const accents = WORLD_TONE_IDS.map(id => WORLD_TONES[id].ramp[idx].join(','))
      expect(new Set(accents).size, `索引 ${idx} 的点缀色应四套各不相同`).toBe(4)
    }
  })

  it('冷色调的冷点缀比暖点缀更蓝（否则 cool 标记没有意义）', () => {
    for (const id of WORLD_TONE_IDS) {
      const t = WORLD_TONES[id]
      if (!t.cool) continue
      const [, , warmB] = t.ramp[14]
      const [, , coolB] = t.ramp[15]
      expect(coolB, `${id} 的冷点缀应比暖点缀更蓝`).toBeGreaterThan(warmB)
    }
  })

  it('getWorldTone 对未知 id 回退到水墨', () => {
    expect(getWorldTone('nope').id).toBe('ink')
    expect(getWorldTone(undefined).id).toBe('ink')
  })

  it('rgbToHex 补零正确', () => {
    expect(rgbToHex([0, 0, 0])).toBe('#000000')
    expect(rgbToHex([255, 255, 255])).toBe('#ffffff')
    expect(rgbToHex([8, 10, 22])).toBe('#080a16')   // 个位数必须补零
  })

  it('toneAccent 返回合法的 #rrggbb', () => {
    for (const id of WORLD_TONE_IDS) {
      expect(toneAccent(id)).toMatch(/^#[0-9a-f]{6}$/)
    }
    // 不同色调的点缀色应当不同
    expect(new Set(WORLD_TONE_IDS.map(toneAccent)).size).toBe(4)
  })
})
