/**
 * 最小 2D canvas / PNG 垫片，让渲染代码能**在纯 Node 里跑**。
 *
 * ## 为什么需要它
 *
 * `rpgMap.ts` 与 `lpcSprite.ts` 都直接依赖浏览器：
 *   · `document.createElement('canvas')` + `getContext('2d')`
 *   · `ctx.createImageData` / `putImageData` / `getImageData` / `drawImage`
 *   · `new Image()` 异步加载 PNG
 *   · `canvas.toDataURL('image/png')`
 *
 * 于是所有视觉验证都得先起 Edge + CDP（`scripts/checks/*.mjs`）。
 * 那条链路的代价：CI 上要装浏览器、本地要装 Edge、还要反复踩
 * "改了源码但 dev server 没重启" 和 "--user-data-dir 用了相对路径" 的坑。
 *
 * 这个垫片把上面那些 API 用**纯 JS + zlib** 实现出来，于是同一份
 * 渲染代码可以脱离浏览器直接出 PNG 给读图能力看。
 *
 * ## 实现要点（都是被逼出来的）
 *
 *   · **ImageData 用普通对象**，不用 `Uint8ClampedArray`：
 *     `rpgMap.ts` 里会把 `img.data[j] = ...` 写进去，普通数组同样支持，
 *     而且省掉了跨 realm 的类型问题。
 *   · **`toDataURL` 返回 `data:image/png;base64,...`**：渲染函数就是这么
 *     往外给图的，垫片要顺着它的契约，而不是逼它改。
 *   · **PNG 只实现解码/编码够用的子集**：8 位 RGB/RGBA、非隔行。
 *     LPC 部件图正好都是这个格式（本项目自己生成的图和官方素材都是）。
 *     遇到不支持的格式**明确报错**，不静默出一张黑图 ——
 *     "静默出黑图"正是这个项目历史上最贵的一类 bug。
 */
import fs from 'node:fs'
import zlib from 'node:zlib'

// ============================================================================
// PNG 编解码
// ============================================================================

/** CRC32（PNG 每个 chunk 都要） */
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0)
  return Buffer.concat([len, td, crc])
}

/** RGBA → PNG Buffer */
export function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0                       // filter: none
    rgba.copy
      ? rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
      : Buffer.from(rgba.buffer || rgba).copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0   // 8bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** PNG Buffer → {width, height, rgba: Buffer}。支持 1/2/4/8 位、颜色类型 0/2/3/4/6、非隔行 */
export function decodePng(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG')
  let off = 8
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0
  const idat = []
  let plte = null, trns = null

  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4)
      bitDepth = data[8]; colorType = data[9]; interlace = data[12]
    } else if (type === 'PLTE') plte = Buffer.from(data)
    else if (type === 'tRNS') trns = Buffer.from(data)
    else if (type === 'IDAT') idat.push(Buffer.from(data))
    else if (type === 'IEND') break
    off += 12 + len
  }

  if (interlace !== 0) throw new Error('隔行 PNG 不支持')
  if (![1, 2, 4, 8].includes(bitDepth)) throw new Error(`PNG 位深 ${bitDepth} 不支持`)

  /**
   * 每个像素占多少**位**。
   *
   * ⚠️ 这里第一版写错了：我按"每通道 8 位"假设，直接拿 `bitDepth` 当字节数，
   * 于是 LPC 素材里那些 **索引色 2 位 / 4 位** 的 PNG（胡须、部分腿部件）
   * 全部解码失败。而失败被 `loadImage` 的 `onerror` 包装成一句
   * "部件图加载失败" —— 完全看不出是解码器不支持位深。
   * **错误信息丢失原因，等于没有错误信息。**
   */
  const bitsPerPixel = { 0: bitDepth, 2: bitDepth * 3, 3: bitDepth, 4: bitDepth * 2, 6: bitDepth * 4 }[colorType]
  if (!bitsPerPixel) throw new Error(`PNG 颜色类型 ${colorType} 不支持`)

  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = Math.ceil(width * bitsPerPixel / 8)   // 每行**字节数**（含不足一字节的填充）
  const bpp = Math.max(1, Math.ceil(bitsPerPixel / 8)) // 滤波用的"每像素字节数"
  const out = Buffer.alloc(stride * height)

  // 反滤波（PNG 的 5 种 filter）—— 作用在**打包后的字节**上，与位深无关
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)]
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    const dst = out.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? dst[x - bpp] : 0
      const b = prev ? prev[x] : 0
      const c = prev && x >= bpp ? prev[x - bpp] : 0
      let v = src[x]
      if (ft === 1) v += a
      else if (ft === 2) v += b
      else if (ft === 3) v += (a + b) >> 1
      else if (ft === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      dst[x] = v & 0xff
    }
  }

  /** 从打包行里取第 i 个样本（支持 1/2/4/8 位） */
  const sampleAt = (row, i, channelsPerPixel) => {
    const bitIndex = i * channelsPerPixel * bitDepth
    const byte = row[bitIndex >> 3]
    if (bitDepth === 8) return byte
    const shift = 8 - bitDepth - (bitIndex & 7)
    const mask = (1 << bitDepth) - 1
    return (byte >> shift) & mask
  }
  /** 子字节位深要按"最大取值"拉伸到 0..255（PNG 规范：1→0/255，2→×85，4→×17） */
  const scale = v => bitDepth === 8 ? v : Math.round(v * 255 / ((1 << bitDepth) - 1))

  const rgba = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    const row = out.subarray(y * stride, (y + 1) * stride)
    for (let x = 0; x < width; x++) {
      let r, g, b, a = 255
      if (colorType === 6) {
        const o = x * 4
        r = row[o]; g = row[o + 1]; b = row[o + 2]; a = row[o + 3]
      } else if (colorType === 2) {
        const o = x * 3
        r = row[o]; g = row[o + 1]; b = row[o + 2]
      } else if (colorType === 0) {
        r = g = b = scale(sampleAt(row, x, 1))
      } else if (colorType === 4) {
        const o = x * 2
        r = g = b = row[o]; a = row[o + 1]
      } else { // 索引色
        const idx = sampleAt(row, x, 1)
        if (!plte) throw new Error('索引色 PNG 缺少 PLTE 块')
        r = plte[idx * 3]; g = plte[idx * 3 + 1]; b = plte[idx * 3 + 2]
        if (trns && idx < trns.length) a = trns[idx]
      }
      const d = (y * width + x) * 4
      rgba[d] = r; rgba[d + 1] = g; rgba[d + 2] = b; rgba[d + 3] = a
    }
  }

  return { width, height, rgba }
}

// ============================================================================
// 最小 2D 上下文
// ============================================================================

/**
 * 只实现渲染代码真正用到的那部分 API。
 *
 * 刻意**不**实现 `fillRect` / `arc` / 文字之类 —— 一旦某个渲染函数偷偷
 * 用了没实现的 API，会立刻抛错暴露出来，而不是静默画出空白。
 * "缺什么就报什么" 比 "什么都接受但结果是错的" 好得多。
 */
export class Ctx2D {
  constructor(canvas) {
    this.canvas = canvas
    this.imageSmoothingEnabled = true
    this._fill = [0, 0, 0, 255]
  }

  _ensure() {
    const c = this.canvas
    if (!c._px) c._px = Buffer.alloc(c.width * c.height * 4)
    return c._px
  }

  createImageData(w, h) {
    return { width: w, height: h, data: new Array(w * h * 4).fill(0) }
  }

  /** 构造 ImageData（sceneArt 用的是全局 `new ImageData(...)`，见下面的垫片） */
  static imageData(w, h, data) {
    return { width: w, height: h, data: data || new Array(w * h * 4).fill(0) }
  }

  putImageData(img, dx, dy) {
    const px = this._ensure()
    const c = this.canvas
    for (let y = 0; y < img.height; y++) {
      const ty = dy + y
      if (ty < 0 || ty >= c.height) continue
      for (let x = 0; x < img.width; x++) {
        const tx = dx + x
        if (tx < 0 || tx >= c.width) continue
        const s = (y * img.width + x) * 4
        const d = (ty * c.width + tx) * 4
        px[d] = img.data[s]; px[d + 1] = img.data[s + 1]
        px[d + 2] = img.data[s + 2]; px[d + 3] = img.data[s + 3]
      }
    }
  }

  getImageData(sx, sy, w, h) {
    const px = this._ensure()
    const c = this.canvas
    const out = new Array(w * h * 4).fill(0)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const srcX = sx + x, srcY = sy + y
        const d = (y * w + x) * 4
        if (srcX < 0 || srcY < 0 || srcX >= c.width || srcY >= c.height) continue
        const s = (srcY * c.width + srcX) * 4
        out[d] = px[s]; out[d + 1] = px[s + 1]; out[d + 2] = px[s + 2]; out[d + 3] = px[s + 3]
      }
    }
    return { width: w, height: h, data: out }
  }

  clearRect(x, y, w, h) {
    const px = this._ensure()
    const c = this.canvas
    for (let yy = y; yy < y + h; yy++) {
      if (yy < 0 || yy >= c.height) continue
      for (let xx = x; xx < x + w; xx++) {
        if (xx < 0 || xx >= c.width) continue
        const d = (yy * c.width + xx) * 4
        px[d] = px[d + 1] = px[d + 2] = px[d + 3] = 0
      }
    }
  }

  /**
   * 最近邻缩放绘制 —— **必须**是最近邻。
   * 像素画用双线性会糊成一团，而 `imageSmoothingEnabled = false` 正是
   * 渲染代码在表达这个意图，垫片要照着实现。
   */
  drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh) {
    if (sw === undefined) { sx = 0; sy = 0; sw = src.width; sh = src.height; dx = arguments[1]; dy = arguments[2]; dw = sw; dh = sh }
    if (dw === undefined) { dw = sw; dh = sh }
    const px = this._ensure()
    const c = this.canvas
    const smooth = this.imageSmoothingEnabled
    for (let y = 0; y < dh; y++) {
      const ty = (dy | 0) + y
      if (ty < 0 || ty >= c.height) continue
      const fy = smooth ? (sh - 1) * (y / Math.max(1, dh - 1)) : Math.floor(sy + sh * (y / dh))
      for (let x = 0; x < dw; x++) {
        const tx = (dx | 0) + x
        if (tx < 0 || tx >= c.width) continue
        const fx = smooth ? (sw - 1) * (x / Math.max(1, dw - 1)) : Math.floor(sx + sw * (x / dw))
        const ssx = Math.min(src.width - 1, Math.max(0, fx | 0))
        const ssy = Math.min(src.height - 1, Math.max(0, fy | 0))
        const s = (ssy * src.width + ssx) * 4
        const d = (ty * c.width + tx) * 4
        const a = src._px ? src._px[s + 3] : 255
        if (a === 0) continue
        if (a === 255) {
          px[d] = src._px[s]; px[d + 1] = src._px[s + 1]; px[d + 2] = src._px[s + 2]; px[d + 3] = 255
        } else {
          // 简单的 source-over 合成
          const k = a / 255
          px[d] = Math.round(src._px[s] * k + px[d] * (1 - k))
          px[d + 1] = Math.round(src._px[s + 1] * k + px[d + 1] * (1 - k))
          px[d + 2] = Math.round(src._px[s + 2] * k + px[d + 2] * (1 - k))
          px[d + 3] = Math.max(px[d + 3], a)
        }
      }
    }
  }
}

class Canvas {
  constructor() { this.width = 0; this.height = 0; this._px = null; this._ctx = null }
  getContext(kind) {
    if (kind !== '2d') throw new Error(`只支持 2d 上下文，收到 ${kind}`)
    if (!this._ctx) this._ctx = new Ctx2D(this)
    return this._ctx
  }
  toDataURL(type = 'image/png') {
    if (!/png/.test(type)) throw new Error(`只支持 PNG 输出，收到 ${type}`)
    const px = this._px || Buffer.alloc(this.width * this.height * 4)
    return 'data:image/png;base64,' + encodePng(this.width, this.height, px).toString('base64')
  }
  /** 便利方法（非标准）：直接拿 PNG Buffer，省掉一次 base64 往返 */
  toPngBuffer() {
    const px = this._px || Buffer.alloc(this.width * this.height * 4)
    return encodePng(this.width, this.height, px)
  }
}

/** 浏览器 Image 的最小替身：赋值 src 后异步触发 onload */
class Img {
  constructor() {
    this.width = 0; this.height = 0; this._px = null
    this.onload = null; this.onerror = null
    this._src = ''
  }
  set src(v) {
    this._src = v
    // 同步读完再异步回调 —— 渲染代码靠 onload 驱动，语义保持一致
    try {
      let buf
      if (v.startsWith('data:')) buf = Buffer.from(v.slice(v.indexOf(',') + 1), 'base64')
      else if (v.startsWith('file://')) buf = fs.readFileSync(new URL(v))
      else buf = fs.readFileSync(v)
      const { width, height, rgba } = decodePng(buf)
      // LPC 部件与 canvas 的取像素路径都期望 _px 是 RGBA Buffer
      this.width = width; this.height = height
      this._px = rgba
      queueMicrotask(() => this.onload && this.onload())
    } catch (e) {
      queueMicrotask(() => this.onerror ? this.onerror(e) : (() => { throw e })())
    }
  }
  get src() { return this._src }
}

// ============================================================================
// 安装到全局
// ============================================================================

let installed = false

/**
 * 把 `document` / `Image` / `ImageData` 装到全局。
 * 必须在 import 渲染模块**之前**调用。
 */
export function installDomShim() {
  if (installed) return
  installed = true

  globalThis.ImageData = class ImageData {
    constructor(w, h, data) {
      // 支持 new ImageData(data, w, h) 与 (w, h) 两种签名
      if (Array.isArray(w) || (w && w.length !== undefined && typeof w !== 'number')) {
        this.data = w; this.width = h; this.height = data
      } else {
        this.width = w; this.height = h
        this.data = data || new Array(w * h * 4).fill(0)
      }
    }
  }

  globalThis.Image = Img

  globalThis.document = {
    createElement(tag) {
      if (tag === 'canvas') return new Canvas()
      // 非 canvas 元素给一个最小替身，避免渲染代码里的边角分支炸掉
      return { tagName: tag.toUpperCase(), style: {}, appendChild() {}, removeChild() {}, click() {}, setAttribute() {} }
    },
    body: { appendChild() {}, removeChild() {} },
  }

  // 渲染代码可能顺手读 devicePixelRatio
  if (globalThis.devicePixelRatio === undefined) globalThis.devicePixelRatio = 1

  return { Canvas, Img }
}
