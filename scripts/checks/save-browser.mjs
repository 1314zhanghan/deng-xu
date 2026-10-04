/** 验证存档导出/导入：真实取一次存档 → 校验 → 写入 → 读回一致 */
import { spawn } from 'node:child_process'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = process.cwd().replace(/\\\\/g, '/')
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9500
const SITE = process.env.SITE || 'http://localhost:5199/'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const getJson = (u) => new Promise((res, rej) => { http.get(u, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}}) }).on('error', rej) })

const profile = path.join(root, '.probe', 'edge-save')
const edge = spawn(EDGE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
  '--no-first-run','--no-default-browser-check','--disable-gpu','--window-size=1200,900','about:blank'], { stdio: 'ignore' })
let v=null
for(let i=0;i<40;i++){try{v=await getJson(`http://127.0.0.1:${PORT}/json/version`);break}catch{await sleep(500)}}
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

await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride',{width:1200,height:900,deviceScaleFactor:1,mobile:false})
await send('Page.navigate',{url:SITE})
await sleep(5500)

console.log('=== 建立一局，写入可识别的数据 ===')
await ev(`(()=>{ __uiStore.getState().setLlm({apiKey:'sk-x'}); __uiStore.getState().setApiKeyModalOpen(false);
  __uiStore.getState().setShowTutorial(false); localStorage.setItem('hasSeenTutorial','true'); return 1 })()`)
await sleep(600)
await ev(`(()=>{
  const w=__libraryStore.getState().worlds[0];
  __sessionStore.getState().setSession({world:w,player:{name:'存档测试',gender:'女',age:'',appearance:'标记文本ABC',personality:'',background:'',extra:''},
    activeCharacterIds:w.characters.map(c=>c.id),backgroundChoices:{},attributeAllocation:{}});
  const g=__gameStore.getState(); g.initFromWorld(w); g.setPlayerProfile('存档测试','女','标记文本ABC');
  g.addHistory({role:'assistant',content:'第一轮叙事内容-可识别标记-42',timestamp:Date.now()});
  g.addHistory({role:'user',content:'第二轮',timestamp:Date.now()});
  g.startGame(); return 1 })()`)
await sleep(3000)

const mod = `await import('/src/utils/saveFile.ts')`
console.log('\n=== 导出 ===')
const exp = await ev(`(async () => {
  const m = ${mod};
  const save = m.collectSave();
  const usage = m.measureUsage();
  const v = m.validateSave(save);
  return JSON.stringify({
    format: save.format, version: save.version,
    meta: save.meta,
    storeKeys: Object.keys(save.data),
    validateOk: v.ok,
    usage: usage.human,
    perStore: usage.perStore,
    writable: m.canStillWrite(),
    bytes: JSON.stringify(save).length,
  });
})()`)
console.log('  ' + exp)
const e = JSON.parse(exp)
check('导出 format 正确', e.format === 'deng-xu-save')
check('导出含版本号', e.version === 1)
check('导出包含 game store', e.storeKeys.includes('pale-notes-storage'), e.storeKeys.join(','))
check('导出的存档自校验通过', e.validateOk === true)
check('元信息抓到主角名', e.meta.playerName === '存档测试', String(e.meta.playerName))
check('元信息抓到叙事条数', e.meta.messageCount === 2, String(e.meta.messageCount))
check('容量统计可用', /KB|MB/.test(e.usage), e.usage)
check('当前可写入', e.writable === true)

console.log('\n=== 篡改存档 → 导入 → 读回，验证往返一致 ===')
const round = await ev(`(async () => {
  const m = ${mod};
  const save = m.collectSave();
  // 篡改：把主角名与叙事内容改掉，模拟"另一台设备上的不同进度"
  const g = save.data['pale-notes-storage'];
  g.state.playerName = '改过的名字';
  g.state.history = [{ role:'assistant', content:'导入后的内容-XYZ', timestamp: 1 }];
  const applyResult = m.applySave(save);
  // 直接从 localStorage 读回
  const raw = JSON.parse(localStorage.getItem('pale-notes-storage'));
  const sessRaw = JSON.parse(localStorage.getItem('pale-notes-session'));
  return JSON.stringify({
    applyOk: applyResult.ok,
    restored: applyResult.restored,
    readBackName: raw.state.playerName,
    readBackMsg: raw.state.history[0].content,
    sessionWorld: sessRaw.state.world.title,
  });
})()`)
console.log('  ' + round)
const r = JSON.parse(round)
check('导入成功', r.applyOk === true)
check('主角名已写入并可读回', r.readBackName === '改过的名字', r.readBackName)
check('叙事内容已写入并可读回', r.readBackMsg === '导入后的内容-XYZ', r.readBackMsg)
check('session 世界卡一并恢复', !!r.sessionWorld, r.sessionWorld)

console.log('\n=== 非法存档应被明确拒绝（而不是静默崩掉）===')
const bad = await ev(`(async () => {
  const m = ${mod};
  const cases = [
    ['非对象', 'not an object'],
    ['错误 format', { format:'other', version:1, data:{} }],
    ['缺版本号', { format:'deng-xu-save', data:{} }],
    ['版本过高', { format:'deng-xu-save', version:99, data:{ 'pale-notes-storage':{} } }],
    ['无可识别数据', { format:'deng-xu-save', version:1, data:{ 'nope':1 } }],
  ];
  return JSON.stringify(cases.map(([name, input]) => {
    const r = m.validateSave(input);
    return { name, ok: r.ok, err: r.error };
  }));
})()`)
for (const c of JSON.parse(bad)) {
  console.log(`  ${c.name}: ok=${c.ok}  ${c.err || ''}`)
  check(`拒绝「${c.name}」并给出原因`, c.ok === false && !!c.err)
}

console.log('\n=== 界面上的存档管理入口（先回标题页）===')
await ev(`(()=>{ __gameStore.getState().returnToTitle(); return 1 })()`)
await sleep(2000)
const ui = await ev(`(()=>{
  const t = document.body.innerText;
  return { hasExport: /导出存档/.test(t), hasImport: /导入存档/.test(t), hasUsage: /存档占用/.test(t) };
})()`)
console.log('  ' + JSON.stringify(ui))
check('标题界面有导出按钮', ui.hasExport === true)
check('标题界面有导入按钮', ui.hasImport === true)

console.log('\n  异常:', errs.length?errs.slice(0,3):'(无)')
console.log(fails===0?'\n全部通过':`\n${fails} 项未通过`)
ws.close(); edge.kill(); await sleep(400)
process.exit(fails===0?0:1)
