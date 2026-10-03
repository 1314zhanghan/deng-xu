/**
 * 模块化人物素材库（Humaaans 式思路）
 *
 * ─────────────────────────────────────────────────────────────
 * 这一版重做的原因（记下来免得再走回头路）：
 *
 * 上一版"看起来粗糙"，根因是**规模判断错了**：
 * 我既想画细节（眉毛、鼻子、眼白、胡须分片），又要在 32–44px 显示，
 * 结果落进"半细节"陷阱 —— 放大看哪儿都不对，缩小看全是脏点。
 *
 * 正确做法是：**为大图形设计，缩小时自然成立**。
 *   1. 每个部件都是「一整块清晰剪影」，不画靠细线才能看出的结构；
 *   2. 五官用大而高对比的实心形状，不用白色眼球 + 细描边；
 *   3. 色彩走「明度阶梯」而不是"同色系微微变暗"，否则缩到 32px 全糊成一坨；
 *   4. 头部要占据足够大的画布比例 —— 小脸在大画布里必然显得粗糙。
 * ─────────────────────────────────────────────────────────────
 */

/** 画布：正方形，圆形裁切安全 */
export const FIG_W = 96
export const FIG_H = 96

export interface PartCtx {
  skin: string
  /** 明显更暗的肤色，用于下颌/鼻影/耳内 */
  skinDark: string
  /** 头发主色 */
  hair: string
  /** 头发暗部（比主色明显暗一档） */
  hairDark: string
  cloth: string
  clothDark: string
  /** 衣服高光/亮部 */
  clothLight: string
  accent: string
  stroke: string
  lw: number
  cx: number
  cy: number
  rx: number
  ry: number
  jawW: number
  chinY: number
}

/** 描边统一样式：低透明度，只用来"压边"，不参与造型 */
const st = (c: PartCtx) => `stroke="${c.stroke}" stroke-width="${c.lw}" stroke-opacity="0.35"`

// ============================================================================
// 服装 / 躯干
// ============================================================================

export const CLOTHING = ['tunic', 'coat', 'armor', 'robe', 'jacket', 'rags'] as const
export type Clothing = (typeof CLOTHING)[number]

/**
 * 躯干 + 脖子 + 肩线。
 *
 * 关键改动：脖子与肩膀**连成一笔**画出，告别上一版"脖子是个矩形、
 * 肩膀是个梯形，两块颜色不接"的拼贴感。衣领依服装类型变化。
 */
export function drawTorso(c: PartCtx, clothing: string): string {
  const { cx, cloth, clothDark, clothLight, accent, skin, skinDark } = c
  const parts: string[] = []

  const neckTop = c.chinY - 6
  const shoulderY = FIG_H - 34

  // 脖子（带一点斜方肌收束，不是一个直筒矩形）
  parts.push(
    `<path d="M${cx - 8} ${neckTop} L${cx + 8} ${neckTop} L${cx + 9} ${shoulderY - 2} L${cx - 9} ${shoulderY - 2} Z" fill="${skinDark}"/>`
  )

  // 躯干：肩线平滑外扩，底部略微外张（半身像的收尾）
  const shoulder = 31
  parts.push(
    `<path d="M${cx - 9} ${shoulderY - 3} ` +
    `C${cx - 15} ${shoulderY - 1} ${cx - shoulder + 4} ${shoulderY + 3} ${cx - shoulder} ${shoulderY + 11} ` +
    `L${cx - shoulder - 1} ${FIG_H + 4} L${cx + shoulder + 1} ${FIG_H + 4} ` +
    `L${cx + shoulder} ${shoulderY + 11} ` +
    `C${cx + shoulder - 4} ${shoulderY + 3} ${cx + 15} ${shoulderY - 1} ${cx + 9} ${shoulderY - 3} Z" ` +
    `fill="${cloth}" ${st(c)}/>`
  )

  // 领口（共有），先挖出来再叠各自细节
  parts.push(
    `<path d="M${cx - 9} ${shoulderY - 3} C${cx - 5} ${shoulderY + 5} ${cx + 5} ${shoulderY + 5} ${cx + 9} ${shoulderY - 3} ` +
    `C${cx + 5} ${shoulderY - 6} ${cx - 5} ${shoulderY - 6} ${cx - 9} ${shoulderY - 3} Z" fill="${skin}"/>`
  )

  switch (clothing) {
    case 'coat':
      parts.push(
        `<path d="M${cx - 9} ${shoulderY - 3} L${cx - 24} ${shoulderY + 8} L${cx - 19} ${FIG_H + 4} L${cx - 8} ${FIG_H + 4} L${cx - 11} ${shoulderY + 12} Z" fill="${clothDark}"/>` +
        `<path d="M${cx + 9} ${shoulderY - 3} L${cx + 24} ${shoulderY + 8} L${cx + 19} ${FIG_H + 4} L${cx + 8} ${FIG_H + 4} L${cx + 11} ${shoulderY + 12} Z" fill="${clothDark}"/>` +
        `<path d="M${cx - 11} ${shoulderY + 12} L${cx + 11} ${shoulderY + 12} L${cx + 13} ${FIG_H + 4} L${cx - 13} ${FIG_H + 4} Z" fill="${clothLight}"/>`
      )
      break
    case 'armor':
      parts.push(
        `<path d="M${cx - 22} ${shoulderY + 9} C${cx - 12} ${shoulderY + 5} ${cx + 12} ${shoulderY + 5} ${cx + 22} ${shoulderY + 9} ` +
        `L${cx + 17} ${FIG_H + 4} L${cx - 17} ${FIG_H + 4} Z" fill="${clothDark}" ${st(c)}/>` +
        `<path d="M${cx} ${shoulderY + 8} L${cx} ${FIG_H + 4}" stroke="${clothLight}" stroke-width="1.6" opacity="0.55"/>` +
        `<circle cx="${cx - 13}" cy="${shoulderY + 15}" r="2.6" fill="${accent}"/>` +
        `<circle cx="${cx + 13}" cy="${shoulderY + 15}" r="2.6" fill="${accent}"/>`
      )
      break
    case 'robe':
      parts.push(
        `<path d="M${cx - 11} ${shoulderY - 3} L${cx} ${shoulderY + 11} L${cx + 11} ${shoulderY - 3}" fill="none" stroke="${clothDark}" stroke-width="2.4"/>` +
        `<rect x="${cx - 26}" y="${FIG_H - 17}" width="52" height="7" fill="${accent}"/>`
      )
      break
    case 'jacket':
      parts.push(
        `<path d="M${cx - 10} ${shoulderY - 4} L${cx - 5} ${shoulderY + 6} L${cx + 5} ${shoulderY + 6} L${cx + 10} ${shoulderY - 4} ` +
        `C${cx + 5} ${shoulderY - 1} ${cx - 5} ${shoulderY - 1} ${cx - 10} ${shoulderY - 4} Z" fill="${clothDark}"/>` +
        `<line x1="${cx}" y1="${shoulderY + 6}" x2="${cx}" y2="${FIG_H + 4}" stroke="${clothLight}" stroke-width="2" opacity="0.6"/>`
      )
      break
    case 'rags':
      parts.push(
        `<path d="M${cx - 31} ${FIG_H - 10} L${cx - 22} ${FIG_H + 4} L${cx - 13} ${FIG_H - 12} L${cx - 3} ${FIG_H + 4} ` +
        `L${cx + 7} ${FIG_H - 11} L${cx + 17} ${FIG_H + 4} L${cx + 31} ${FIG_H - 8} L${cx + 31} ${FIG_H + 4} L${cx - 31} ${FIG_H + 4} Z" fill="${clothDark}"/>` +
        `<path d="M${cx - 14} ${shoulderY + 12} L${cx + 4} ${FIG_H - 14}" stroke="${clothDark}" stroke-width="3.4" opacity="0.75"/>`
      )
      break
    default:
      parts.push(
        `<path d="M${cx - 11} ${shoulderY - 3} L${cx + 4} ${shoulderY + 13} L${cx + 11} ${shoulderY - 3}" fill="none" stroke="${clothDark}" stroke-width="2.6"/>`
      )
  }
  return parts.join('')
}

// ============================================================================
// 头发
// ============================================================================

export const HAIRS = ['bald', 'crop', 'short', 'bob', 'long', 'bun', 'ponytail', 'mohawk', 'topknot', 'curly'] as const
export type Hair = (typeof HAIRS)[number]

/**
 * 后发层（画在头之前）。
 * 一律用整块剪影，且**比头明显宽**，这样缩小时靠外轮廓就能认出发型。
 */
export function drawHairBack(c: PartCtx, hair: string): string {
  const { cx, cy, rx, ry, hair: hc, hairDark } = c
  const parts: string[] = []

  switch (hair) {
    case 'long':
      parts.push(
        `<path d="M${cx - rx - 3} ${cy - 6} C${cx - rx - 11} ${cy + 26} ${cx - rx - 8} ${FIG_H - 26} ${cx - rx + 2} ${FIG_H - 22} ` +
        `L${cx + rx - 2} ${FIG_H - 22} C${cx + rx + 8} ${FIG_H - 26} ${cx + rx + 11} ${cy + 26} ${cx + rx + 3} ${cy - 6} Z" ` +
        `fill="${hairDark}"/>`
      )
      break
    case 'bob':
      parts.push(
        `<path d="M${cx - rx - 2} ${cy - 4} C${cx - rx - 7} ${cy + 18} ${cx - rx - 1} ${cy + 28} ${cx - rx + 6} ${cy + 27} ` +
        `L${cx + rx - 6} ${cy + 27} C${cx + rx + 1} ${cy + 28} ${cx + rx + 7} ${cy + 18} ${cx + rx + 2} ${cy - 4} Z" ` +
        `fill="${hairDark}"/>`
      )
      break
    case 'ponytail':
      parts.push(
        `<path d="M${cx + rx - 2} ${cy - 8} C${cx + rx + 14} ${cy + 4} ${cx + rx + 20} ${cy + 30} ${cx + rx + 8} ${cy + 44} ` +
        `C${cx + rx + 2} ${cy + 32} ${cx + rx + 2} ${cy + 10} ${cx + rx - 8} ${cy + 2} Z" fill="${hairDark}"/>`
      )
      break
    case 'curly':
      for (let i = 0; i < 13; i++) {
        const a = (Math.PI * 2 * i) / 13
        const bxx = cx + Math.cos(a) * (rx + 7) * 0.9
        const byy = cy - 5 + Math.sin(a) * (ry + 6) * 0.92
        parts.push(`<circle cx="${bxx.toFixed(1)}" cy="${byy.toFixed(1)}" r="${(9 + (i % 3) * 1.5).toFixed(1)}" fill="${i % 2 ? hairDark : hc}"/>`)
      }
      break
    case 'bun':
      parts.push(`<circle cx="${cx}" cy="${cy - ry - 6}" r="10" fill="${hairDark}"/>`)
      break
    case 'topknot':
      parts.push(`<circle cx="${cx}" cy="${cy - ry - 9}" r="7.5" fill="${hairDark}"/>`)
      break
  }
  return parts.join('')
}

/** 前发层（画在头之后）：整块发帘，边缘干净 */
export function drawHairFront(c: PartCtx, hair: string): string {
  const { cx, cy, rx, ry, hair: hc, hairDark, accent } = c
  const top = cy - ry
  const parts: string[] = []

  switch (hair) {
    case 'bald':
      parts.push(
        `<path d="M${cx - rx + 2} ${cy - 8} C${cx - rx + 1} ${top + 10} ${cx - rx + 9} ${top + 4} ${cx - rx + 13} ${top + 8}" ` +
        `fill="none" stroke="${hc}" stroke-width="4" stroke-linecap="round"/>` +
        `<path d="M${cx + rx - 2} ${cy - 8} C${cx + rx - 1} ${top + 10} ${cx + rx - 9} ${top + 4} ${cx + rx - 13} ${top + 8}" ` +
        `fill="none" stroke="${hc}" stroke-width="4" stroke-linecap="round"/>`
      )
      break
    case 'crop':
      parts.push(
        `<path d="M${cx - rx + 1} ${cy - 9} A${rx} ${ry} 0 0 1 ${cx + rx - 1} ${cy - 9} ` +
        `C${cx + rx - 6} ${top + 9} ${cx - rx + 6} ${top + 9} ${cx - rx + 1} ${cy - 9} Z" fill="${hc}"/>`
      )
      break
    case 'mohawk':
      parts.push(
        `<path d="M${cx - 8} ${top + 6} C${cx - 6} ${top - 22} ${cx + 6} ${top - 22} ${cx + 8} ${top + 6} ` +
        `C${cx + 3} ${top + 2} ${cx - 3} ${top + 2} ${cx - 8} ${top + 6} Z" fill="${hc}"/>` +
        `<path d="M${cx - rx + 4} ${cy - 10} A${rx - 3} ${ry - 3} 0 0 1 ${cx + rx - 4} ${cy - 10}" fill="none" stroke="${hc}" stroke-width="3"/>`
      )
      break
    case 'topknot':
      parts.push(
        `<path d="M${cx - rx} ${cy - 10} A${rx} ${ry + 2} 0 0 1 ${cx + rx} ${cy - 10} ` +
        `C${cx + rx - 5} ${cy - 22} ${cx - rx + 5} ${cy - 22} ${cx - rx} ${cy - 10} Z" fill="${hc}"/>` +
        `<rect x="${cx - 9}" y="${top - 3}" width="18" height="5" rx="2.5" fill="${accent}"/>`
      )
      break
    case 'bun':
      parts.push(
        `<path d="M${cx - rx} ${cy - 10} A${rx} ${ry + 2} 0 0 1 ${cx + rx} ${cy - 10} ` +
        `C${cx + rx - 5} ${cy - 24} ${cx - rx + 5} ${cy - 24} ${cx - rx} ${cy - 10} Z" fill="${hc}"/>`
      )
      break
    case 'curly':
      parts.push(
        `<path d="M${cx - rx + 1} ${cy - 12} C${cx - rx + 3} ${top + 4} ${cx + rx - 3} ${top + 4} ${cx + rx - 1} ${cy - 12} ` +
        `C${cx + 10} ${top + 2} ${cx - 10} ${top + 2} ${cx - rx + 1} ${cy - 12} Z" fill="${hc}"/>`
      )
      break
    case 'long':
      parts.push(
        `<path d="M${cx - rx - 1} ${cy - 8} A${rx + 1} ${ry + 3} 0 0 1 ${cx + rx + 1} ${cy - 8} ` +
        `C${cx + rx - 3} ${cy - 20} ${cx + 3} ${cy - 24} ${cx - 1} ${cy - 21} ` +
        `C${cx - 6} ${cy - 24} ${cx - rx + 3} ${cy - 20} ${cx - rx - 1} ${cy - 8} Z" fill="${hc}"/>` +
        `<path d="M${cx - rx - 1} ${cy - 10} L${cx - rx + 1} ${cy + 22} L${cx - rx + 10} ${cy + 20} L${cx - rx + 7} ${cy - 12} Z" fill="${hc}"/>` +
        `<path d="M${cx + rx + 1} ${cy - 10} L${cx + rx - 1} ${cy + 22} L${cx + rx - 10} ${cy + 20} L${cx + rx - 7} ${cy - 12} Z" fill="${hc}"/>`
      )
      break
    default:
      parts.push(
        `<path d="M${cx - rx - 1} ${cy - 8} A${rx + 1} ${ry + 3} 0 0 1 ${cx + rx + 1} ${cy - 8} ` +
        `C${cx + rx - 2} ${cy - 22} ${cx + rx * 0.35} ${cy - 26} ${cx - rx + 2} ${cy - 8} Z" fill="${hc}"/>`
      )
  }
  void hairDark
  return parts.join('')
}

// ============================================================================
// 头饰
// ============================================================================

export const HEADWEAR = ['none', 'hood', 'hat', 'helm', 'circlet', 'bandana', 'crown', 'goggles'] as const
export type Headwear = (typeof HEADWEAR)[number]

export function drawHeadwear(c: PartCtx, headwear: string, _hairColor: string): string {
  const { cx, cy, rx, ry, accent, clothDark, clothLight } = c
  const top = cy - ry
  const parts: string[] = []

  switch (headwear) {
    case 'hood':
      parts.push(
        `<path d="M${cx - rx - 7} ${cy + 14} C${cx - rx - 13} ${top - 14} ${cx + rx + 13} ${top - 14} ${cx + rx + 7} ${cy + 14} ` +
        `C${cx + rx + 1} ${cy - 8} ${cx - rx - 1} ${cy - 8} ${cx - rx - 7} ${cy + 14} Z" fill="${clothDark}" ${st(c)}/>`
      )
      break
    case 'hat':
      parts.push(
        `<ellipse cx="${cx}" cy="${top + 8}" rx="${rx + 18}" ry="6" fill="${clothDark}" ${st(c)}/>` +
        `<path d="M${cx - rx + 4} ${top + 8} C${cx - rx + 5} ${top - 14} ${cx + rx - 5} ${top - 14} ${cx + rx - 4} ${top + 8} Z" fill="${clothDark}"/>` +
        `<rect x="${cx - rx + 3}" y="${top + 3}" width="${(rx - 3) * 2}" height="4.5" fill="${accent}"/>`
      )
      break
    case 'helm':
      parts.push(
        `<path d="M${cx - rx - 2} ${cy + 2} A${rx + 2} ${ry + 3} 0 0 1 ${cx + rx + 2} ${cy + 2} L${cx + rx + 2} ${cy + 9} L${cx - rx - 2} ${cy + 9} Z" fill="${clothDark}" ${st(c)}/>` +
        `<path d="M${cx} ${top - 3} L${cx} ${cy - 14}" stroke="${clothLight}" stroke-width="3" stroke-linecap="round"/>` +
        `<rect x="${cx - rx - 2}" y="${cy - 1}" width="${(rx + 2) * 2}" height="4.5" fill="${accent}"/>`
      )
      break
    case 'circlet':
      parts.push(
        `<path d="M${cx - rx + 2} ${top + 15} Q${cx} ${top + 7} ${cx + rx - 2} ${top + 15}" fill="none" stroke="${accent}" stroke-width="3" stroke-linecap="round"/>` +
        `<circle cx="${cx}" cy="${top + 9}" r="3.4" fill="${accent}"/>`
      )
      break
    case 'bandana':
      parts.push(
        `<path d="M${cx - rx - 1} ${cy - 13} Q${cx} ${top - 4} ${cx + rx + 1} ${cy - 13} Q${cx} ${cy - 5} ${cx - rx - 1} ${cy - 13} Z" fill="${accent}"/>` +
        `<path d="M${cx + rx - 1} ${cy - 13} L${cx + rx + 13} ${cy - 4} L${cx + rx + 10} ${cy + 5} L${cx + rx - 3} ${cy - 8} Z" fill="${accent}" opacity="0.85"/>`
      )
      break
    case 'crown':
      parts.push(
        `<path d="M${cx - rx + 2} ${top + 10} L${cx - rx + 6} ${top - 7} L${cx - rx / 2} ${top + 3} L${cx} ${top - 11} ` +
        `L${cx + rx / 2} ${top + 3} L${cx + rx - 6} ${top - 7} L${cx + rx - 2} ${top + 10} Z" fill="${accent}" ${st(c)}/>`
      )
      break
    case 'goggles':
      parts.push(
        `<path d="M${cx - rx - 2} ${cy - 15} Q${cx} ${top - 4} ${cx + rx + 2} ${cy - 15}" fill="none" stroke="${clothDark}" stroke-width="8" stroke-linecap="round"/>` +
        `<circle cx="${cx - rx * 0.45}" cy="${cy - 14}" r="8" fill="${accent}" ${st(c)}/>` +
        `<circle cx="${cx + rx * 0.45}" cy="${cy - 14}" r="8" fill="${accent}" ${st(c)}/>` +
        `<circle cx="${cx - rx * 0.45}" cy="${cy - 14}" r="3" fill="${clothDark}"/>` +
        `<circle cx="${cx + rx * 0.45}" cy="${cy - 14}" r="3" fill="${clothDark}"/>`
      )
      break
  }
  return parts.join('')
}

// ============================================================================
// 五官
// ============================================================================

export const EYES = ['plain', 'wide', 'narrow', 'sleepy', 'sharp', 'closed', 'glow'] as const
export const BROWS = ['neutral', 'thick', 'thin', 'angry', 'raised', 'none'] as const

/**
 * 眼睛 + 眉毛。
 *
 * 关键改动：不再画"白色眼白 + 细描边 + 小瞳孔"。
 * 那种做法在 32px 下会糊成两个脏点。改成**实心深色形状**，
 * 形状差异（圆 / 扁 / 斜 / 闭）本身就承担表情，缩小时依然干净。
 */
export function drawEyes(c: PartCtx, eyes: string, brows: string, eyeColor: string): string {
  const { cx, cy, rx, hair, accent, skinDark } = c
  const eyeY = cy + 1
  const dx = Math.round(rx * 0.42)
  const parts: string[] = []

  if (brows !== 'none') {
    const w = brows === 'thick' ? 4 : brows === 'thin' ? 2.2 : 3
    const lift = brows === 'raised' ? -3 : 0
    const tilt = brows === 'angry' ? 3.2 : 0
    for (const s of [-1, 1]) {
      const x1 = cx + s * (dx + 6)
      const x2 = cx + s * (dx - 4)
      const y1 = eyeY - 11 + lift + (brows === 'angry' ? -tilt : 0)
      const y2 = eyeY - 11 + lift + (brows === 'angry' ? tilt : 0)
      parts.push(
        `<line x1="${x1}" y1="${brows === 'raised' ? y1 - 1 : y1}" x2="${x2}" y2="${brows === 'raised' ? y2 + 1 : y2}" ` +
        `stroke="${hair}" stroke-width="${w}" stroke-linecap="round"/>`
      )
    }
  }

  for (const s of [-1, 1]) {
    const ex = cx + s * dx
    switch (eyes) {
      case 'closed':
        parts.push(`<path d="M${ex - 5} ${eyeY} Q${ex} ${eyeY + 3.5} ${ex + 5} ${eyeY}" fill="none" stroke="${eyeColor}" stroke-width="2.4" stroke-linecap="round"/>`)
        break
      case 'glow':
        parts.push(
          `<ellipse cx="${ex}" cy="${eyeY}" rx="4.6" ry="3.4" fill="${accent}"/>` +
          `<ellipse cx="${ex}" cy="${eyeY}" rx="8" ry="6" fill="${accent}" opacity="0.22"/>`
        )
        break
      case 'wide':
        parts.push(`<ellipse cx="${ex}" cy="${eyeY}" rx="4.2" ry="4.8" fill="${eyeColor}"/>`)
        break
      case 'narrow':
        parts.push(`<path d="M${ex - 5.5} ${eyeY} Q${ex} ${eyeY + 3} ${ex + 5.5} ${eyeY} Q${ex} ${eyeY - 2.6} ${ex - 5.5} ${eyeY} Z" fill="${eyeColor}"/>`)
        break
      case 'sleepy':
        parts.push(
          `<ellipse cx="${ex}" cy="${eyeY + 1}" rx="4.4" ry="2.8" fill="${eyeColor}"/>` +
          `<path d="M${ex - 5} ${eyeY - 2} Q${ex} ${eyeY - 4.5} ${ex + 5} ${eyeY - 2}" fill="none" stroke="${skinDark}" stroke-width="2" stroke-linecap="round"/>`
        )
        break
      case 'sharp':
        parts.push(`<path d="M${ex - 5.5} ${eyeY + 1.6} L${ex + 5.5} ${eyeY - 3.4} L${ex + 5} ${eyeY + 2.6} Z" fill="${eyeColor}"/>`)
        break
      default:
        parts.push(`<ellipse cx="${ex}" cy="${eyeY}" rx="4" ry="3.8" fill="${eyeColor}"/>`)
    }
  }
  return parts.join('')
}

/** 鼻子 + 嘴 + 胡须 */
export function drawMouth(c: PartCtx, mood: string, beard: string, beardColor: string): string {
  const { cx, cy, jawW, chinY, skinDark } = c
  const parts: string[] = []
  const eyeY = cy + 1

  // 鼻子：朝下的小三角阴影，比线描更经得起缩小
  parts.push(
    `<path d="M${cx - 2.4} ${eyeY + 8} L${cx + 2.4} ${eyeY + 8} L${cx} ${eyeY + 11.5} Z" fill="${skinDark}" opacity="0.55"/>`
  )

  const mouthY = chinY - 8
  const mw = 5.5
  switch (mood) {
    case 'smile':
      parts.push(`<path d="M${cx - mw} ${mouthY - 1.5} Q${cx} ${mouthY + 4} ${cx + mw} ${mouthY - 1.5}" fill="none" stroke="${skinDark}" stroke-width="2.2" stroke-linecap="round"/>`)
      break
    case 'frown':
      parts.push(`<path d="M${cx - mw} ${mouthY + 2.5} Q${cx} ${mouthY - 2.5} ${cx + mw} ${mouthY + 2.5}" fill="none" stroke="${skinDark}" stroke-width="2.2" stroke-linecap="round"/>`)
      break
    case 'open':
      parts.push(`<ellipse cx="${cx}" cy="${mouthY}" rx="3.8" ry="3" fill="${skinDark}"/>`)
      break
    case 'smirk':
      parts.push(`<path d="M${cx - mw} ${mouthY + 1} Q${cx + 1} ${mouthY + 3.5} ${cx + mw + 1} ${mouthY - 3.5}" fill="none" stroke="${skinDark}" stroke-width="2.2" stroke-linecap="round"/>`)
      break
    default:
      parts.push(`<line x1="${cx - 4.5}" y1="${mouthY}" x2="${cx + 4.5}" y2="${mouthY}" stroke="${skinDark}" stroke-width="2.2" stroke-linecap="round"/>`)
  }

  if (beard !== 'none') {
    const bc = beardColor
    if (beard === 'stubble') {
      parts.push(
        `<path d="M${cx - jawW + 1} ${cy + 13} C${cx - jawW} ${chinY + 1} ${cx + jawW} ${chinY + 1} ${cx + jawW - 1} ${cy + 13} ` +
        `C${cx + 10} ${chinY - 4} ${cx - 10} ${chinY - 4} ${cx - jawW + 1} ${cy + 13} Z" fill="${bc}" opacity="0.28"/>`
      )
    } else if (beard === 'mustache') {
      parts.push(
        `<path d="M${cx - 10} ${chinY - 12} Q${cx} ${chinY - 17} ${cx + 10} ${chinY - 12} ` +
        `Q${cx + 4} ${chinY - 7} ${cx} ${chinY - 10.5} Q${cx - 4} ${chinY - 7} ${cx - 10} ${chinY - 12} Z" fill="${bc}"/>`
      )
    } else if (beard === 'goatee') {
      parts.push(
        `<path d="M${cx - 9} ${chinY - 12} Q${cx} ${chinY - 17} ${cx + 9} ${chinY - 12} Q${cx} ${chinY - 7} ${cx - 9} ${chinY - 12} Z" fill="${bc}"/>` +
        `<path d="M${cx - 6} ${chinY - 3} Q${cx} ${chinY + 10} ${cx + 6} ${chinY - 3} Z" fill="${bc}"/>`
      )
    } else {
      parts.push(
        `<path d="M${cx - jawW + 1} ${cy + 6} C${cx - jawW - 1} ${chinY + 3} ${cx - 9} ${chinY + 8} ${cx} ${chinY + 8} ` +
        `C${cx + 9} ${chinY + 8} ${cx + jawW + 1} ${chinY + 3} ${cx + jawW - 1} ${cy + 6} ` +
        `C${cx + 11} ${chinY - 9} ${cx - 11} ${chinY - 9} ${cx - jawW + 1} ${cy + 6} Z" fill="${bc}"/>` +
        `<path d="M${cx - 10} ${chinY - 12} Q${cx} ${chinY - 17} ${cx + 10} ${chinY - 12} ` +
        `Q${cx + 4} ${chinY - 7} ${cx} ${chinY - 10.5} Q${cx - 4} ${chinY - 7} ${cx - 10} ${chinY - 12} Z" fill="${bc}"/>`
      )
    }
  }
  return parts.join('')
}

// ============================================================================
// 配件
// ============================================================================

export const ACCESSORIES = [
  'none', 'glasses', 'roundspecs', 'shades', 'visor', 'eyepatch', 'monocle',
  'mask', 'scar', 'facepaint', 'earring', 'headset', 'pipe', 'pendant',
] as const
export type Accessory = (typeof ACCESSORIES)[number]

export function drawAccessory(c: PartCtx, acc: string): string {
  const { cx, cy, rx, ry, jawW, chinY, accent, skinDark, clothDark, hair } = c
  const eyeY = cy + 1
  const dx = Math.round(rx * 0.42)
  const parts: string[] = []

  switch (acc) {
    case 'glasses':
      parts.push(
        `<rect x="${cx - dx - 8}" y="${eyeY - 6.5}" width="16" height="13" rx="2.5" fill="none" stroke="${accent}" stroke-width="2.6"/>` +
        `<rect x="${cx + dx - 8}" y="${eyeY - 6.5}" width="16" height="13" rx="2.5" fill="none" stroke="${accent}" stroke-width="2.6"/>` +
        `<line x1="${cx - dx + 8}" y1="${eyeY}" x2="${cx + dx - 8}" y2="${eyeY}" stroke="${accent}" stroke-width="2.2"/>`
      )
      break
    case 'roundspecs':
      parts.push(
        `<circle cx="${cx - dx}" cy="${eyeY}" r="8" fill="none" stroke="${accent}" stroke-width="2.6"/>` +
        `<circle cx="${cx + dx}" cy="${eyeY}" r="8" fill="none" stroke="${accent}" stroke-width="2.6"/>` +
        `<line x1="${cx - dx + 8}" y1="${eyeY}" x2="${cx + dx - 8}" y2="${eyeY}" stroke="${accent}" stroke-width="2.2"/>`
      )
      break
    case 'shades':
      parts.push(
        `<path d="M${cx - rx - 2} ${eyeY - 7} L${cx + rx + 2} ${eyeY - 7} L${cx + rx - 2} ${eyeY + 6} ` +
        `L${cx + 2} ${eyeY + 6} L${cx} ${eyeY - 1} L${cx - 2} ${eyeY + 6} L${cx - rx + 2} ${eyeY + 6} Z" fill="#15151a"/>` +
        `<line x1="${cx - rx - 2}" y1="${eyeY - 7}" x2="${cx + rx + 2}" y2="${eyeY - 7}" stroke="${accent}" stroke-width="2"/>`
      )
      break
    case 'visor':
      parts.push(
        `<rect x="${cx - rx - 2}" y="${eyeY - 8}" width="${(rx + 2) * 2}" height="14" rx="4" fill="${accent}"/>` +
        `<rect x="${cx - rx - 2}" y="${eyeY - 8}" width="${(rx + 2) * 2}" height="14" rx="4" fill="none" stroke="${clothDark}" stroke-width="1.6"/>`
      )
      break
    case 'eyepatch':
      parts.push(
        `<path d="M${cx - dx - 9} ${eyeY - 8} Q${cx - dx} ${eyeY - 11} ${cx - dx + 9} ${eyeY - 8} ` +
        `Q${cx - dx + 7} ${eyeY + 9} ${cx - dx} ${eyeY + 10} Q${cx - dx - 7} ${eyeY + 9} ${cx - dx - 9} ${eyeY - 8} Z" fill="#1c1c20"/>` +
        `<path d="M${cx - dx - 8} ${eyeY - 9} L${cx - rx - 5} ${eyeY - 3}" stroke="#1c1c20" stroke-width="2.2"/>`
      )
      break
    case 'monocle':
      parts.push(
        `<circle cx="${cx + dx}" cy="${eyeY}" r="9.5" fill="${accent}" opacity="0.18"/>` +
        `<circle cx="${cx + dx}" cy="${eyeY}" r="9.5" fill="none" stroke="${accent}" stroke-width="2.8"/>` +
        `<path d="M${cx + dx + 8} ${eyeY + 6} L${cx + dx + 13} ${cy + 20}" stroke="${accent}" stroke-width="1.8"/>`
      )
      break
    case 'mask':
      parts.push(
        `<path d="M${cx - rx + 3} ${chinY - 19} Q${cx} ${chinY - 11} ${cx + rx - 3} ${chinY - 19} ` +
        `L${cx + rx - 4} ${chinY + 1} Q${cx} ${chinY + 6} ${cx - rx + 4} ${chinY + 1} Z" fill="${accent}"/>` +
        `<line x1="${cx - 11}" y1="${chinY - 8}" x2="${cx + 11}" y2="${chinY - 8}" stroke="${clothDark}" stroke-width="1.4" opacity="0.6"/>`
      )
      break
    case 'scar':
      parts.push(
        `<line x1="${cx + dx + 5}" y1="${cy - 14}" x2="${cx + dx + 9}" y2="${cy + 12}" stroke="${skinDark}" stroke-width="3" stroke-linecap="round"/>` +
        `<line x1="${cx + dx + 1}" y1="${cy - 7}" x2="${cx + dx + 13}" y2="${cy - 7}" stroke="${skinDark}" stroke-width="1.6" stroke-linecap="round"/>` +
        `<line x1="${cx + dx + 1}" y1="${cy + 1}" x2="${cx + dx + 13}" y2="${cy + 1}" stroke="${skinDark}" stroke-width="1.6" stroke-linecap="round"/>`
      )
      break
    case 'facepaint':
      parts.push(
        `<rect x="${cx - rx + 2}" y="${cy + 1}" width="11" height="3" rx="1.5" fill="${accent}"/>` +
        `<rect x="${cx - rx + 2}" y="${cy + 7}" width="11" height="3" rx="1.5" fill="${accent}"/>` +
        `<line x1="${cx - 8}" y1="${cy + 16}" x2="${cx + 8}" y2="${cy + 16}" stroke="${accent}" stroke-width="2.4" stroke-linecap="round"/>`
      )
      break
    case 'earring':
      parts.push(
        `<circle cx="${cx + rx + 2}" cy="${cy + 9}" r="3.4" fill="${accent}"/>` +
        `<circle cx="${cx + rx + 2}" cy="${cy + 17}" r="2.6" fill="${accent}" opacity="0.9"/>` +
        `<circle cx="${cx - rx - 2}" cy="${cy + 9}" r="2.8" fill="${accent}" opacity="0.9"/>`
      )
      break
    case 'headset':
      parts.push(
        `<path d="M${cx - rx - 3} ${cy - 8} A${rx + 5} ${ry + 5} 0 0 1 ${cx + rx + 3} ${cy - 8}" fill="none" stroke="${accent}" stroke-width="3.6" stroke-linecap="round"/>` +
        `<rect x="${cx - rx - 10}" y="${cy - 7}" width="8" height="14" rx="3" fill="${accent}"/>` +
        `<rect x="${cx + rx + 2}" y="${cy - 7}" width="8" height="14" rx="3" fill="${accent}"/>` +
        `<path d="M${cx - rx - 6} ${cy + 8} Q${cx - rx + 3} ${cy + 24} ${cx - 6} ${cy + 25}" fill="none" stroke="${accent}" stroke-width="2"/>` +
        `<circle cx="${cx - 5}" cy="${cy + 26}" r="2.4" fill="${accent}"/>`
      )
      break
    case 'pipe':
      parts.push(
        `<path d="M${cx + 4} ${chinY - 9} Q${cx + 15} ${chinY - 6} ${cx + 17} ${chinY + 5}" fill="none" stroke="${clothDark}" stroke-width="2.8" stroke-linecap="round"/>` +
        `<ellipse cx="${cx + 18}" cy="${chinY + 7}" rx="4.5" ry="3.4" fill="${clothDark}"/>`
      )
      break
    case 'pendant':
      parts.push(
        `<path d="M${cx - 11} ${FIG_H - 40} Q${cx} ${FIG_H - 30} ${cx + 11} ${FIG_H - 40}" fill="none" stroke="${hair}" stroke-width="1.6" opacity="0.55"/>` +
        `<circle cx="${cx}" cy="${FIG_H - 27}" r="4.4" fill="${accent}"/>`
      )
      break
  }
  void jawW
  return parts.join('')
}

/** 颜色工具（与 avatarArt 各自留一份，避免循环依赖） */
export function shadeHex(hex: string, percent: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const amt = Math.round(2.55 * percent)
  const cl = (v: number) => Math.max(0, Math.min(255, v))
  const r = cl(((n >> 16) & 0xff) + amt)
  const g = cl(((n >> 8) & 0xff) + amt)
  const b = cl((n & 0xff) + amt)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}
