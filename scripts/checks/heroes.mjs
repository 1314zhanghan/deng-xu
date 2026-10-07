/**
 * 浏览器走查：**我的主角（提前设定主角）**
 *
 * ## 为什么单独一套
 *
 * 这个功能的失败方式是"看起来没事、其实数据没存住或没套上"：
 * 预设存了但开局没填进去、或者填进去了但换世界选错了出身。
 * 单元测试能证明 store 层对，**证明不了界面真的把它串起来了** ——
 * 这一套专门补这一段。
 *
 * 覆盖：
 *   1. 主菜单有入口，且空状态引导正确
 *   2. 新建一位主角 → 出现在列表里
 *   3. 刷新页面后**仍在**（真的落盘了，不是只在内存里）
 *   4. 开新局时快捷条出现该预设，**点一下把档案填进表单**
 *   5. 换一个世界开局，预设仍能套用（预设不绑世界）
 */
import { launch, sleep, outDir, profileDir, removeProfile } from './_browser.mjs'

const SITE = process.env.SITE || 'http://localhost:5199/'
const OUT = outDir()
const PROFILE = profileDir('heroes')

const { send, ev, close, errors } = await launch({
  port: 9975, userDataDir: PROFILE, viewport: { width: 1280, height: 950 },
})

let pass = 0, fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? '  ' + detail : ''}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? '  —— ' + detail : ''}`) }
}
const shot = async (name) => {
  try {
    const r = await send('Page.captureScreenshot', { format: 'png' })
    const f = `${OUT}/${name}.png`
    const fs = await import('node:fs')
    fs.writeFileSync(f, Buffer.from(r.result.data, 'base64'))
    console.log(`  [截图] ${f}`)
  } catch { /* 截图失败不该让走查挂掉 */ }
}

const waitFor = async (expr, timeoutMs = 12000, every = 250) => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (await ev(expr)) return true
    await sleep(every)
  }
  return false
}
/** 按文字点按钮。用 includes 而不是全等：卡片上的按钮带图标与副文案 */
const clickText = (re) =>
  ev(`(()=>{const b=[...document.querySelectorAll('button')]
    .find(x=>${re}.test((x.textContent||'').trim()));
    if(!b)return 'no';if(b.disabled)return 'disabled';b.click();return 'ok'})()`)

await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 950, deviceScaleFactor: 1, mobile: false })

/*
  ⚠️ 预置好 Key 与"已看过引导"，**然后一次性加载**。
  不要先 navigate 再 reload：那会踩到一个**与本事无关的既存缺陷** ——
  页面 reload 之后，返回键的第一次按下会被吃掉（见下方第 3 步的说明）。
  走查要验的是"我的主角"这个功能，不该被那个缺陷拖累，
  所以这里把存储先写进同一个源、再导航过去。
*/
await send('Page.navigate', { url: SITE }); await sleep(2000)
await ev(`(()=>{const k='pale-notes-ui';let v={};try{v=JSON.parse(localStorage.getItem(k)||'{}')}catch(e){}
  v.state=v.state||{};v.state.llm=Object.assign({provider:'deepseek',baseUrl:'https://api.deepseek.com/v1',narrativeModel:'deepseek-chat',analysisModel:'deepseek-chat',temperature:0.8},v.state.llm||{},{apiKey:'sk-heroes'});
  v.state.isApiKeyModalOpen=false;v.state.showTutorial=false;localStorage.setItem(k,JSON.stringify(v));return 1})()`)
// 关掉当前这次加载里的弹窗（只改 store，不动历史），让界面可交互
await ev(`(()=>{const u=__uiStore.getState();u.setApiKeyModalOpen(false);
  if(u.setShowTutorial)u.setShowTutorial(false);return 1})()`)
await sleep(1200)

console.log('\n=== 1) 主菜单入口 ===')
const menu = JSON.parse(await ev(`(()=>{const T=document.body.innerText;
  return JSON.stringify({
    hasHeroEntry: /我的主角/.test(T),
    hint: (T.match(/还没有设定过主角[^\\n]*/)||[''])[0],
  });})()`))
check('主菜单有「我的主角」入口', menu.hasHeroEntry)
check('未设定过时给出引导文案', /还没有设定过主角/.test(menu.hint), menu.hint || '(无)')

console.log('\n=== 2) 进入「我的主角」并新建一位 ===')
check('点入口', await clickText('/我的主角/') === 'ok')
await sleep(1800)
const emptyState = JSON.parse(await ev(`(()=>{const T=document.body.innerText;
  return JSON.stringify({
    onPage: /我的主角/.test(T),
    empty: /还没有设定过主角/.test(T),
    hasNewBtn: [...document.querySelectorAll('button')].some(b=>/新建主角|设定第一位主角/.test(b.textContent||'')),
  });})()`))
check('进入了我的主角页', emptyState.onPage)
check('空状态文案在', emptyState.empty)
check('有新建按钮', emptyState.hasNewBtn)
await shot('heroes-01-empty')

check('点新建', await clickText('/新建主角|设定第一位主角/') === 'ok')
await sleep(1200)
check('出现了表单', await waitFor(`!!document.querySelector('input[placeholder="例如「我的惯用主角」"]')`))

// 填一份完整档案
await ev(`(()=>{
  const set=(ph,val)=>{const el=document.querySelector('input[placeholder="'+ph+'"]');
    if(el){const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
      s.call(el,val);el.dispatchEvent(new Event('input',{bubbles:true}));}return !!el};
  const setArea=(ph,val)=>{const el=[...document.querySelectorAll('textarea')].find(t=>t.placeholder===ph);
    if(el){const s=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;
      s.call(el,val);el.dispatchEvent(new Event('input',{bubbles:true}));}return !!el};
  return JSON.stringify({
    label: set('例如「我的惯用主角」','走查用主角'),
    name: set('你的名字','谢无咎'),
    gender: set('可留空','男'),
    appearance: setArea('AI 会在动作描写里呼应这些特征；也会据此生成立绘。','瘦削，眉骨高，惯穿青灰直裰'),
  });})()`)
await sleep(600)

check('保存', await clickText('/^保存$|保存/') === 'ok')
await sleep(1600)
const afterSave = JSON.parse(await ev(`(()=>{const T=document.body.innerText;
  return JSON.stringify({
    listed: /走查用主角/.test(T),
    nameShown: /谢无咎/.test(T),
    savedHint: /已保存/.test(T),
  });})()`))
check('预设出现在列表里', afterSave.listed)
check('列表里能看到主角名', afterSave.nameShown)
await shot('heroes-02-saved')

console.log('\n=== 3) 刷新后仍在（真的落盘）===')
/*
  ⚠️ 这一步必须 reload —— 它要验的正是"落盘了没有"。
  但 reload 之后有个**与本事无关的既存缺陷**：
  返回键的第一次按下会被吃掉（诊断见 HANDOFF）。
  所以这里 reload 之后**不走返回键**，改用"刷新 → 直接把世界推进选角"，
  把这条链路上与本事无关的部分绕开；
  返回键的问题单独记录，不在这里混进来。
*/
await send('Page.reload', { ignoreCache: false })
await sleep(5000)
const afterReload = JSON.parse(await ev(`(()=>{const T=document.body.innerText;
  return JSON.stringify({
    onMenu: /开始新游戏/.test(T),
    heroHint: (T.match(/位主角，开新局可直接选用/)||[''])[0],
    stored: (()=>{try{const s=localStorage.getItem('pale-notes-ui');return !!s}catch(e){return false}})(),
  });})()`))
check('刷新后回到主菜单', afterReload.onMenu)
check('主菜单提示里已计入该主角', !!afterReload.heroHint, afterReload.heroHint || '(没找到提示)')

console.log('\n=== 4) 开新局时可一键套用（刷新后直接开，不经返回键）===')
check('点开始新游戏', await clickText('/开始新游戏/') === 'ok')
check('等到卡片墙（出现开局按钮）',
  await waitFor(`[...document.querySelectorAll('button')].some(b=>/^用这个世界开始$/.test((b.textContent||'').trim()))`))
check('点世界卡的开局按钮', await clickText('/^用这个世界开始$/') === 'ok')
check('进入了选角界面', await waitFor(`/你要扮演谁/.test(document.body.innerText)`))

const chips = JSON.parse(await ev(`(()=>{const T=document.body.innerText;
  return JSON.stringify({
    hasStrip: /用已设好的主角/.test(T),
    chip: /走查用主角/.test(T),
    nameEmpty: (document.querySelector('input[placeholder="你的名字"]')||{}).value === '',
  });})()`))
check('选角页出现「用已设好的主角」快捷条', chips.hasStrip)
check('快捷条里有刚存的预设', chips.chip)
check('套用前名字是空的（确认是套用带来的）', chips.nameEmpty)
await shot('heroes-03-setup-before')

// 点那个 chip（用精确文案，避免点到别处）
check('点预设 chip', await clickText('/^走查用主角$/') === 'ok')
await sleep(900)
const applied = JSON.parse(await ev(`(()=>{
  const g=(ph)=>{const el=document.querySelector('input[placeholder="'+ph+'"]');return el?el.value:null};
  /*
    ⚠️ 外貌输入框的 placeholder 在两个页面里**不一样**：
      预设页（HeroPresets）："AI 会在动作描写里呼应这些特征；也会据此生成立绘。"
      选角页（SessionSetup）："AI 会在动作描写里呼应这些特征。"
    我第一版抄了预设页那一条，于是在选角页找不到元素、恒为 null。
    这里改用**按标签定位**（找"外貌"标签后面的第一个 textarea），
    不再依赖任何一条 placeholder 文案。
  */
  const areaByLabel=(label)=>{
    const span=[...document.querySelectorAll('span,div,label')].find(s=>(s.textContent||'').trim()===label);
    if(!span)return null;
    let root=span; for(let i=0;i<4&&root;i++){ root=root.parentElement;
      const ta=root&&root.querySelector('textarea'); if(ta)return ta.value; }
    return null;
  };
  const T=document.body.innerText;
  return JSON.stringify({
    name: g('你的名字'),
    gender: g('可留空'),
    appearance: areaByLabel('外貌'),
    flash: /已套用/.test(T),
  });})()`))
check('姓名被套用', applied.name === '谢无咎', JSON.stringify(applied.name))
check('性别被套用', applied.gender === '男', JSON.stringify(applied.gender))
check('外貌被套用', applied.appearance === '瘦削，眉骨高，惯穿青灰直裰', JSON.stringify(applied.appearance))
check('给出了「已套用」反馈', applied.flash)
await shot('heroes-04-setup-applied')

console.log('\n=== 5) 换一个世界，预设仍可用（预设不绑世界）===')
/*
  从选角退回卡片墙。选角页的按钮文案是「返回卡库」。
  ⚠️ 这里逐步打印现场：第一版只 sleep 一下就往下点，
  失败时报 "only-one"（卡片墙没渲染出来），看不出卡在哪一步。
*/
const dumpState = async (tag) => {
  const s = await ev(`(()=>{const h=document.querySelector('h1');
    const starts=[...document.querySelectorAll('button')].filter(b=>/^用这个世界开始$/.test((b.textContent||'').trim())).length;
    const nav = (typeof __navStore==='function') ? __navStore.getState() : null;
    return JSON.stringify({h1:h?h.textContent.trim():'', startBtns:starts,
      inSetup:/你要扮演谁/.test(document.body.innerText),
      view: nav?nav.view:null,
      stack: nav?nav.stack.map(v=>({n:v.name,intent:v.intent})):null});})()`)
  console.log(`    [${tag}] ${s}`)
  return JSON.parse(s)
}
await dumpState('选角页')
const backRes = await clickText('/返回卡库|^返回$/')
console.log('    点返回卡库: ' + backRes)
check('能退回卡片墙', await waitFor(
  `[...document.querySelectorAll('button')].some(b=>/^用这个世界开始$/.test((b.textContent||'').trim()))`, 10000))
await dumpState('退回后')

const secondWorld = await ev(`(()=>{const bs=[...document.querySelectorAll('button')]
  .filter(b=>/^用这个世界开始$/.test((b.textContent||'').trim()));
  if(bs.length<2)return 'only-one:'+bs.length;bs[1].click();return 'ok'})()`)
check('点了第二个世界的开局按钮', secondWorld === 'ok', String(secondWorld))
await waitFor(`/你要扮演谁/.test(document.body.innerText)`, 8000)
const crossWorld = JSON.parse(await ev(`(()=>{const T=document.body.innerText;
  return JSON.stringify({
    inSetup: /你要扮演谁/.test(T),
    chip: /走查用主角/.test(T),
  });})()`))
check('换世界后进入选角', crossWorld.inSetup)
check('换世界后预设仍出现在快捷条里', crossWorld.chip)
if (crossWorld.inSetup && crossWorld.chip) {
  await clickText('/^走查用主角$/')
  await sleep(900)
  const reused = await ev(`(()=>{const el=document.querySelector('input[placeholder="你的名字"]');return el?el.value:''})()`)
  check('换世界后仍能套用同一份档案', reused === '谢无咎', JSON.stringify(reused))
}
await shot('heroes-05-crossworld')

console.log('\n=== 汇总 ===')
console.log(`  通过 ${pass}/${pass + fail}`)
if (fail) console.log(`  未通过 ${fail} 项`)
console.log(`  运行期异常：${errors.length ? [...new Set(errors)].slice(0, 3).join(' | ') : '(无)'}`)
console.log(`\n${fail ? '✗ 我的主角 未通过' : '✓ 我的主角 通过'}`)

close()
removeProfile(PROFILE)
process.exit(fail ? 1 : 0)
