import './_ws-shim.mjs'
﻿import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
const EDGE='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT=9750
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const getJson=u=>new Promise((res,rej)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}})}).on('error',rej)})
const OUT='D:/工作区/.tools/shots'
fs.mkdirSync(OUT,{recursive:true})
const edge=spawn(EDGE,[`--remote-debugging-port=${PORT}`,`--user-data-dir=D:/工作区/.tools/edge-gal-${Date.now()}`,'--headless=new','--no-first-run','--no-default-browser-check','--disable-gpu','--window-size=1500,760','about:blank'],{stdio:'ignore'})
let v=null
for(let i=0;i<40;i++){try{v=await getJson(`http://127.0.0.1:${PORT}/json/version`);break}catch{await sleep(500)}}
const t=await getJson(`http://127.0.0.1:${PORT}/json/list`)
const ws=new WebSocket(t.find(x=>x.type==='page').webSocketDebuggerUrl)
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej})
let id=0;const pend=new Map()
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id)}}
const send=(m,p={})=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:p}))})
const ev=async x=>{const r=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});
  return r.result?.exceptionDetails?'THREW '+(r.result.exceptionDetails.exception?.description||''):r.result?.result?.value}
await send('Runtime.enable')
await send('Page.navigate',{url:'http://localhost:5199/'}); await sleep(8000)

// 在页面里画一个画廊：12 个不同设定，前视全身 + 头像一个
const built = await ev(`(async () => {
  const lp = await import('/src/utils/lpcSprite.ts');
  const chars = [
    ['男·正装中介','穿深色正装外套的男子，戴领带','男'],
    ['女·和服少女','穿红色和服的少女，黑发','女'],
    ['男·皮甲守卫','穿皮甲的守卫，留胡子','男'],
    ['女·白裙女子','穿白色长裙的金发女子','女'],
    ['男·普通旅人','一个走路的年轻人','男'],
    ['女·现代学生','穿制服短裙的女学生','女'],
    ['男·法师','穿长袍的老年法师，白胡子','男'],
    ['女·短发佣兵','穿短上衣的短发女子','女'],
    ['男·农民','穿旧衣服的农民','男'],
    ['男·骑士','穿板甲的骑士，戴头盔','男'],
    ['女·贵妇','穿紫色礼服的高贵女性','女'],
    ['男·商人','穿外套的商人','男'],
  ];
  const out = [];
  for (let i=0;i<chars.length;i++) {
    const [tag, desc, gender] = chars[i];
    const r = lp.recipeFor('gal'+i, { profile:{ name:tag, description:desc }, gender });
    const full = await lp.renderSprite(r, 'down', 3);
    const head = await lp.renderSprite(r, 'down', 4, { x:14, y:2, size:36 });
    out.push({ tag, desc, torso:r.clothing, full, head,
      dressy: r.parts.filter(p=>/dress_|skirt/i.test(p)).join(',') || '-' });
  }
  return JSON.stringify(out);
})()`)
const arr = JSON.parse(built)

// 用 canvas 拼成一张对照图
const html = `<!doctype html><html><body style="margin:0;background:#111;font-family:sans-serif">
<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:2px;padding:6px">` +
arr.map(c => `<div style="text-align:center">
  <img src="${c.full}" style="width:96px;height:192px;image-rendering:pixelated;background:#1a1a1a;border-radius:4px">
  <div style="color:#f5b942;font-size:10px;margin-top:2px">${c.tag}</div>
  <div style="color:#888;font-size:8px">${c.torso}</div>
  <div style="color:${c.dressy==='-'?'#444':'#ff6b6b'};font-size:8px">裙装:${c.dressy}</div>
</div>`).join('') + `</div></body></html>`
fs.writeFileSync(OUT+'/gallery.html', html, 'utf8')

// 截这张图
await send('Page.navigate',{url:'file:///'+OUT+'/gallery.html'}); await sleep(2500)
const shot = await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})
fs.writeFileSync(OUT+'/sprites-gallery.png', Buffer.from(shot.result.data,'base64'))
console.log('画廊已生成。道具/裙装归属：')
for (const c of arr) console.log('  ' + c.tag.padEnd(14) + ' 上衣=' + c.torso.padEnd(34) + ' 裙装=' + c.dressy)
ws.close();edge.kill();await sleep(300);process.exit(0)
