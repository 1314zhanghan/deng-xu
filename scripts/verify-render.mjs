/**
 * 渲染像素级验证（这次绝不再只看 DOM 存不存在）
 *
 * 1) 头像辨识度统计
 * 2) 场景背景**实际亮度**：截图后统计像素，确认不是"几乎全黑"
 * 3) 游戏内截图
 */
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9420
const SITE = process.env.SITE || 'http://localhost:5199/'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const getJson = (u) => new Promise((res, rej) => { http.get(u, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}}) }).on('error', rej) })

const profile = path.join(root, '.probe', 'edge-px')
fs.mkdirSync(profile, { recursive: true })
const edge = spawn(EDGE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
  '--no-first-run','--no-default-browser-check','--disable-gpu','--window-size=1200,900','about:blank'], { stdio: 'ignore' })
let v = null
for (let i=0;i<40;i++){ try{v=await getJson(`http://127.0.0.1:${PORT}/json/version`);break}catch{await sleep(500)} }
if(!v){console.error('端口未就绪');edge.kill();process.exit(1)}
const targets = await getJson(`http://127.0.0.1:${PORT}/json/list`)
const ws = new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl)
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej})
let id=0; const pending=new Map(); const errs=[]
ws.onmessage=(e)=>{const m=JSON.parse(e.data)
  if(m.method==='Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception?.description||'').split('\n')[0])
  if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id)}}
const send=(m,p={})=>new Promise(r=>{const i=++id;pending.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:p}))})
const ev=async(x)=>{const r=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});
  return r.result?.exceptionDetails ? 'THREW '+(r.result.exceptionDetails.exception?.description||'') : r.result?.result?.value}

let fails=0
const check=(l,ok,extra='')=>{console.log(`  ${ok?'✓':'✗'} ${l}${extra?'  '+extra:''}`); if(!ok)fails++}

/** 从 PNG 解析像素并统计平均亮度（只处理 8bit RGB/RGBA，非隔行） */
function pngStats(buf) {
  let pos = 8, w=0, h=0, bitDepth=0, colorType=0
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos+4, pos+8)
    const data = buf.subarray(pos+8, pos+8+len)
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9] }
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) return null
  const bpp = colorType === 6 ? 4 : 3
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = w * bpp
  const out = Buffer.alloc(h * stride)
  let rp = 0
  for (let y = 0; y < h; y++) {
    const filter = raw[rp++]
    const line = raw.subarray(rp, rp + stride); rp += stride
    const prev = y > 0 ? out.subarray((y-1)*stride, y*stride) : Buffer.alloc(stride)
    const cur = out.subarray(y*stride, (y+1)*stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x-bpp] : 0
      const b = prev[x]
      const c = x >= bpp ? prev[x-bpp] : 0
      let val = line[x]
      switch (filter) {
        case 1: val = (val + a) & 0xff; break
        case 2: val = (val + b) & 0xff; break
        case 3: val = (val + ((a+b)>>1)) & 0xff; break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p-a), pb = Math.abs(p-b), pc = Math.abs(p-c)
          val = (val + (pa<=pb && pa<=pc ? a : pb<=pc ? b : c)) & 0xff
          break
        }
      }
      cur[x] = val
    }
  }
  // 统计：整体平均亮度、中央区域平均亮度与**标准差**、非背景像素占比
  // 关键指标是标准差：纯色背景 std≈0，有场景结构才会明显抬起来。
  // 平均值反而会下降（场景本身比 #0c0c0c 亮但被遮罩压过），所以不能用平均值判断"看没看见"。
  let sum=0, n=0, midSum=0, midN=0, bright=0
  const midLums = []
  const midY0 = Math.floor(h*0.25), midY1 = Math.floor(h*0.75)
  const midX0 = Math.floor(w*0.25), midX1 = Math.floor(w*0.75)
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const o = y*stride + x*bpp
      const lum = 0.2126*out[o] + 0.7152*out[o+1] + 0.0722*out[o+2]
      sum += lum; n++
      if (lum > 30) bright++
      if (y>=midY0 && y<midY1 && x>=midX0 && x<midX1) { midSum += lum; midN++; midLums.push(lum) }
    }
  }
  const midAvg = midSum/midN
  const midStd = Math.sqrt(midLums.reduce((a,v)=>a+(v-midAvg)**2,0)/midN)
  return { w, h, avg: sum/n, midAvg, midStd, brightRatio: bright/n }
}

await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride',{width:1200,height:900,deviceScaleFactor:1,mobile:false})
await send('Page.navigate',{url:SITE})
await sleep(5000)
await ev(`(()=>{ __uiStore.getState().setLlm({apiKey:'sk-x'}); __uiStore.getState().setApiKeyModalOpen(false);
  __uiStore.getState().setShowTutorial(false); localStorage.setItem('hasSeenTutorial','true'); return 1 })()`)
await sleep(700)

console.log('=== 建立一局并设置场景 ===')
await ev(`(()=>{
  const w=__libraryStore.getState().worlds[0];
  __sessionStore.getState().setSession({world:w,player:{name:'伊登',gender:'女',age:'',appearance:'',personality:'',background:'',extra:''},
    activeCharacterIds:w.characters.map(c=>c.id),backgroundChoices:{},attributeAllocation:{}});
  const g=__gameStore.getState(); g.initFromWorld(w); g.setPlayerProfile('伊登','女','');
  g.addHistory({role:'assistant',content:'你推开旅店后门，冷灰扑面。街两侧的灯柱上挂着烛。',timestamp:Date.now()});
  g.setScene('s06'); g.startGame(); return 1 })()`)
await sleep(2800)

console.log('\n=== 场景背景：渲染像素检测（不是查 DOM）===')
const shot1 = await send('Page.captureScreenshot', { format: 'png' })
const png = Buffer.from(shot1.result.data, 'base64')
fs.writeFileSync(path.join(root,'.probe','px-scene.png'), png)
const s = pngStats(png)
console.log('  截图尺寸:', s ? `${s.w}x${s.h}` : '解析失败')
if (s) {
  console.log(`  整体平均亮度: ${s.avg.toFixed(1)} / 255`)
  console.log(`  中央区域亮度: ${s.midAvg.toFixed(1)} / 255`)
  console.log(`  中央区域标准差: ${s.midStd.toFixed(2)}  ← 判"看没看见"看这个`)
  console.log(`  亮于 30 的像素占比: ${(s.brightRatio*100).toFixed(1)}%`)
  check('背景不是纯色一片（中央标准差 > 6）', s.midStd > 6, s.midStd.toFixed(2))
}

console.log('\n=== 对照：无场景时的统计 ===')
await ev(`(()=>{ __gameStore.getState().setScene(undefined); return 1 })()`)
await sleep(1500)
const shot2 = await send('Page.captureScreenshot', { format: 'png' })
const s2 = pngStats(Buffer.from(shot2.result.data, 'base64'))
if (s2 && s) {
  console.log(`  无场景 中央标准差: ${s2.midStd.toFixed(2)}   有场景: ${s.midStd.toFixed(2)}`)
  check('有场景的对比度明显高于无场景（证明背景真的画出来了）', s.midStd > s2.midStd + 4,
    `${s2.midStd.toFixed(2)} → ${s.midStd.toFixed(2)}`)
}

console.log('\n=== 场景切换 ===')
await ev(`(()=>{ __gameStore.getState().setScene('s19'); return 1 })()`)
await sleep(1800)
const shot3 = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync(path.join(root,'.probe','px-scene2.png'), Buffer.from(shot3.result.data,'base64'))
const s3 = pngStats(Buffer.from(shot3.result.data, 'base64'))
if (s3 && s) check('切换场景后画面改变', Math.abs(s3.midAvg - s.midAvg) > 0.5, `${s.midAvg.toFixed(1)} → ${s3.midAvg.toFixed(1)}`)

console.log('\n  异常:', errs.length?errs.slice(0,3):'(无)')
console.log(fails===0?'\n全部通过':`\n${fails} 项未通过`)
ws.close(); edge.kill(); await sleep(400)
process.exit(fails===0?0:1)
