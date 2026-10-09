/**
 * 构建版本探测 —— 根治「部署了新版本，浏览器还显示旧版」。
 *
 * ## 问题（用户反馈）
 * 「似乎每次更新都要清除浏览器缓存，不然显示旧版」
 *
 * 根因不是这个项目写错了什么，而是 **GitHub Pages 这类静态托管改不了响应头**：
 * 它给 `index.html` 发 `Cache-Control: max-age=600`。于是部署后的十分钟内，
 * 浏览器**根本不发请求**就已经用上了旧 `index.html`；而旧 `index.html` 引用的旧 JS
 * 又从磁盘缓存命中 —— **不报错、不白屏，就是显示旧版**。
 *
 * ⚠️ 项目里那段白屏守卫（`index.html` 底部）救不了这种情况：
 * 它监听的是脚本 **404**（旧 JS 已从 CDN 消失），而"旧 JS 从缓存拿到"根本不报错。
 * 这也解释了为什么用户感觉"只能清缓存"。
 *
 * ## 做法（三层，缺一不可）
 *
 * 1. **构建时**给 `index.html` 注入 `window.__DX_BUILD__`（本次构建的唯一标识），
 *    同时写一份 `dist/version.json`（同一个标识）。
 * 2. **运行后**主动去问 `version.json`：线上标识 ≠ 本地标识 ⇒ 说明有新版。
 *    探测必须带**随机查询串** + `cache: 'no-store'` —— 否则 `version.json` 自己也被缓存，
 *    那就永远探测不到新版本（这是这类方案最常见的失败原因）。
 * 3. **带查询串重载**：`?_v=<build>` 会让浏览器把这次导航当成**新 URL**，
 *    从而绕开 `index.html` 的 10 分钟缓存。
 *
 * ## 防死循环（很重要）
 * 如果 CDN 一直返回旧 `index.html`（内嵌旧标识）而 `version.json` 已是新的，
 * 朴素的实现会**无限刷新**，用户就卡死了。所以：
 * 用 `sessionStorage` 记下"为哪个版本重载过"，同一个目标版本只刷一次；
 * 已经刷过还是不一致，就安静放弃（宁可显示旧版，也不能让人打不开）。
 *
 * ## 时机
 * 加载后延迟一小段（别和首屏抢带宽）探一次；之后每次页面**重新可见**时再探一次
 * —— 用户切回标签页是很自然的"该看看有没有更新"的时刻。
 */
import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

/** 本次构建的标识：时间戳 + 随机串（无需依赖 git，也不怕 CI 里没有 .git） */
function makeBuildId(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp =
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  const rand = Math.random().toString(36).slice(2, 8)
  return `${stamp}-${rand}`
}

export function buildVersionProbe(): Plugin {
  // ⚠️ 在插件创建时就算好，保证 transformIndexHtml 与 closeBundle 用的是同一个值
  const buildId = makeBuildId()
  let outDir = 'dist'

  return {
    name: 'dx-build-version-probe',
    apply: 'build',

    configResolved(cfg) {
      outDir = cfg.build.outDir || 'dist'
    },

    /**
     * 往 `</head>` 前注入两段：
     *  ① `window.__DX_BUILD__` —— 这个页面"代表"哪个构建
     *  ② 探测脚本 —— 主动问线上是不是有新版
     *
     * 为什么要内联而不是放一个 `public/version-probe.js`：
     * `public/` 下的文件**不带 hash**，同样会被缓存十分钟。
     * 探测脚本自己都被缓存，那这套机制就白做了。
     */
    transformIndexHtml(html: string) {
      const probe = `
    <script>
      /*
        构建版本探测（由 scripts/vite-plugin-build-version.ts 注入）。
        为什么需要它，以及防死循环的细节，见那个文件的头部注释。
      */
      window.__DX_BUILD__ = ${JSON.stringify(buildId)};
      (function () {
        var BUILD = ${JSON.stringify(buildId)};
        var RELOAD_KEY = 'dengxu:build-reload';

        function alreadyTried(target) {
          try { return sessionStorage.getItem(RELOAD_KEY) === target } catch (e) { return false }
        }
        function markTried(target) {
          try { sessionStorage.setItem(RELOAD_KEY, target) } catch (e) {}
        }

        function check() {
          if (!BUILD) return;
          // 随机查询串 + no-store：version.json 自己绝不能被缓存，否则永远探测不到新版
          fetch('./version.json?t=' + Date.now(), { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null })
            .then(function (v) {
              if (!v || !v.build || v.build === BUILD) return;
              if (alreadyTried(v.build)) return;      // 为这个版本刷过了，别再刷（防死循环）
              markTried(v.build);
              console.info('[build] 检测到新版本 ' + v.build + '（当前 ' + BUILD + '），正在重载…');
              var u = location.pathname + '?_v=' + encodeURIComponent(v.build) + location.hash;
              location.replace(u);
            })
            .catch(function () { /* 探测失败无所谓，绝不能影响正常使用 */ });
        }

        // 首屏加载完再探，别和关键资源抢带宽
        setTimeout(check, 2000);
        // 切回标签页时再探一次 —— 这是很自然的"该看看有没有更新"的时刻
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'visible') check();
        });
      })();
    </script>
  </head>`
      return html.replace('</head>', probe)
    },

    /**
     * 写 `dist/version.json`。
     *
     * ⚠️ 用 `closeBundle` 而不是 `generateBundle`：后者写进 bundle 的资产会被
     * 加上 hash 前缀，反而不方便按固定名字取。直接落盘最直白。
     * `make-404.mjs` 随后会把 index.html 复制成 404.html / 200.html，
     * 所以那两个入口自动带上同一份探测脚本。
     */
    closeBundle() {
      const dir = path.resolve(process.cwd(), outDir)
      if (!fs.existsSync(dir)) return
      fs.writeFileSync(
        path.join(dir, 'version.json'),
        JSON.stringify({ build: buildId, time: new Date().toISOString() }, null, 2),
        'utf8',
      )
      console.log(`  [build-version] version.json → ${buildId}`)
    },
  }
}
