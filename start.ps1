<#
  一键启动：AI 角色扮演引擎

  默认以「静态网址」方式启动：先构建出 dist/，再用本地 HTTP 服务托管，
  然后直接把浏览器打开到那个网址。体验和访问一个普通网站完全一样。
  好处是跑的是生产构建（加载更快、手机更省电），而且不需要一直开着开发服务器。

  做五件事：
    1. 检查 node 是否可用
    2. 首次运行时自动安装依赖
    3. 构建生产产物（源码没变就跳过，第二次启动只需一两秒）
    4. 找一个没被占用的端口，启动静态服务
    5. 打印本机与局域网网址（含二维码），并自动打开浏览器

  用法：
    .\start.ps1              # 构建 + 起静态服务 + 打开浏览器（默认）
    .\start.ps1 -Dev         # 改用开发服务器（改代码即时热更新，适合开发）
    .\start.ps1 -NoBrowser   # 只启动，不开浏览器
    .\start.ps1 -Port 6000   # 指定端口
    .\start.ps1 -Rebuild     # 强制重新构建

  局域网访问（手机 / 平板）：
    服务监听 0.0.0.0，用脚本打印的「局域网」地址即可访问。
    Android 需要和电脑在同一个 Wi-Fi 下；Windows 首次会弹防火墙授权，选「允许」。

  两种模式的区别见 README.md 的「两种启动方式对比」。
#>

param(
  [int]$Port = 5173,
  [switch]$NoBrowser,
  [switch]$Dev,
  [switch]$Rebuild
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$ProjectRoot = $PSScriptRoot

# 模式：默认静态网址（跑生产构建），-Dev 则用开发服务器
$Mode = if ($Dev) { 'dev' } else { 'serve' }
$ModeLabel = if ($Dev) { '开发模式（热更新）' } else { '静态网址（生产构建）' }

function Write-Head {
  Write-Host ''
  Write-Host '  ============================================' -ForegroundColor DarkYellow
  Write-Host '        AI 角色扮演引擎  ·  一键启动' -ForegroundColor Yellow
  Write-Host "        模式：$ModeLabel" -ForegroundColor DarkGray
  Write-Host '  ============================================' -ForegroundColor DarkYellow
  Write-Host ''
}

function Write-Step($msg) { Write-Host "  [*] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  [v] $msg" -ForegroundColor Green }
function Write-Warn2($msg){ Write-Host "  [!] $msg" -ForegroundColor Yellow }
function Write-Err2($msg) { Write-Host "  [x] $msg" -ForegroundColor Red }

Write-Head

# ---------- 1. 检查 node ----------
Write-Step '检查运行环境…'

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Err2 '没有找到 Node.js。'
  Write-Host ''
  Write-Host '  请先安装 Node.js（建议 20 或更高版本，LTS 即可）：' -ForegroundColor Gray
  Write-Host '    https://nodejs.org/zh-cn/download' -ForegroundColor Gray
  Write-Host ''
  Write-Host '  安装时保持默认选项即可，装完关掉这个窗口重新运行 start.bat。' -ForegroundColor Gray
  Write-Host ''
  if (-not $NoBrowser) { Start-Process 'https://nodejs.org/zh-cn/download' }
  Read-Host '  按回车键退出'
  exit 1
}

$nodeVersion = (& node --version) 2>$null
$major = 0
if ($nodeVersion -match 'v(\d+)') { $major = [int]$matches[1] }
if ($major -lt 18) {
  Write-Err2 "Node.js 版本过低（当前 $nodeVersion），本项目需要 18 以上。"
  Read-Host '  按回车键退出'
  exit 1
}
Write-Ok "Node.js $nodeVersion"

# ---------- 2. 检查依赖 ----------
$nodeModules = Join-Path $ProjectRoot 'node_modules'
$viteBin = Join-Path $ProjectRoot 'node_modules\vite\bin\vite.js'

if (-not (Test-Path $viteBin)) {
  Write-Warn2 '依赖尚未安装或不完整，开始安装（首次大约需要 1~2 分钟）…'
  Write-Host ''

  $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
  $installed = $false

  if ($pnpm) {
    & pnpm install --dir $ProjectRoot
    if ($LASTEXITCODE -eq 0) { $installed = $true }
  }

  if (-not $installed) {
    # 没有 pnpm 就退回 npm（npm 随 Node 一起安装，基本一定有）
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if ($npm) {
      Write-Warn2 '使用 npm 安装依赖…'
      Push-Location $ProjectRoot
      & npm install
      if ($LASTEXITCODE -eq 0) { $installed = $true }
      Pop-Location
    }
  }

  if (-not $installed -or -not (Test-Path $viteBin)) {
    Write-Err2 '依赖安装失败。'
    Write-Host ''
    Write-Host '  常见原因：网络无法访问 npm 源。可以试试切换镜像后重试：' -ForegroundColor Gray
    Write-Host '    npm config set registry https://registry.npmmirror.com' -ForegroundColor DarkCyan
    Write-Host ''
    Read-Host '  按回车键退出'
    exit 1
  }
  Write-Ok '依赖安装完成'
} else {
  Write-Ok '依赖已就绪'
}

# ---------- 2.5 二维码支持（可选，失败也不影响启动） ----------
$qrReady = $false
if (Get-Command python -ErrorAction SilentlyContinue) {
  try {
    & python -c "import qrcode" 2>$null
    if ($LASTEXITCODE -eq 0) {
      $qrReady = $true
    } else {
      Write-Step '安装二维码组件（一次性）…'
      & python -m pip install qrcode --quiet --disable-pip-version-check 2>$null
      & python -c "import qrcode" 2>$null
      if ($LASTEXITCODE -eq 0) { $qrReady = $true }
    }
  } catch {
    $qrReady = $false
  }
}
if ($qrReady) { Write-Ok '二维码组件已就绪' }
else { Write-Warn2 '没有检测到 Python，手机扫码将改用在线二维码（需要联网）' }

# ---------- 2.7 构建生产产物（仅静态网址模式）----------
# 只要源码比 dist 新就重新构建；没变化就跳过，这样第二次启动一两秒就能开。
if ($Mode -eq 'serve') {
  $distIndex = Join-Path $ProjectRoot 'dist\index.html'
  $needBuild = $Rebuild -or -not (Test-Path $distIndex)

  if (-not $needBuild) {
    $distTime = (Get-Item $distIndex).LastWriteTimeUtc
    # 只看参与构建的目录，避免 node_modules 之类的噪音
    $watchDirs = @('src', 'public') | ForEach-Object { Join-Path $ProjectRoot $_ }
    $watchFiles = @('index.html', 'package.json', 'vite.config.ts', 'tailwind.config.js', 'postcss.config.js') |
      ForEach-Object { Join-Path $ProjectRoot $_ }

    $newer = $null
    foreach ($d in $watchDirs) {
      if (-not (Test-Path $d)) { continue }
      $newer = Get-ChildItem $d -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTimeUtc -gt $distTime } |
        Select-Object -First 1
      if ($newer) { break }
    }
    if (-not $newer) {
      foreach ($f in $watchFiles) {
        if ((Test-Path $f) -and (Get-Item $f).LastWriteTimeUtc -gt $distTime) { $newer = Get-Item $f; break }
      }
    }
    if ($newer) { $needBuild = $true }
  }

  if ($needBuild) {
    Write-Step '构建生产版本…（首次约 10~30 秒）'
    Push-Location $ProjectRoot
    & node (Join-Path $ProjectRoot 'node_modules\vite\bin\vite.js') build 2>&1 | Out-Null
    $buildCode = $LASTEXITCODE
    Pop-Location

    if ($buildCode -ne 0 -or -not (Test-Path $distIndex)) {
      Write-Err2 '构建失败。'
      Write-Host ''
      Write-Host '  正在改用开发服务器启动（-Dev 模式），功能一样，只是加载稍慢。' -ForegroundColor Gray
      Write-Host ''
      $Mode = 'dev'
    } else {
      Write-Ok '生产版本构建完成'
    }
  } else {
    Write-Ok '生产版本已是最新（源码未改动）'
  }
}

# ---------- 3. 找可用端口 ----------
function Test-PortFree([int]$p) {
  try {
    # 只要能连上就说明被占用了
    $client = New-Object System.Net.Sockets.TcpClient
    $client.Connect('127.0.0.1', $p)
    $client.Close()
    return $false
  } catch {
    return $true
  }
}

$requested = $Port
$tries = 0
while (-not (Test-PortFree $Port) -and $tries -lt 30) {
  $Port++
  $tries++
}
if ($tries -ge 30) {
  Write-Err2 "从 $requested 起连续 30 个端口都被占用，请用 -Port 指定一个空闲端口。"
  Read-Host '  按回车键退出'
  exit 1
}
if ($Port -ne $requested) {
  Write-Warn2 "端口 $requested 已被占用，改用 $Port"
}
Write-Ok "使用端口 $Port"

# ---------- 4. 取局域网地址 ----------
function Get-LanIp {
  $candidates = @()

  # 首选：Python 枚举网卡最可靠，且能通过连外网的方式定位到真正在用的那块网卡
  # （多网卡时 Get-NetIPAddress 的顺序经常不是实际出口）
  if (Get-Command python -ErrorAction SilentlyContinue) {
    try {
      $pyIp = & python -c @"
import socket
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
try:
    s.connect(('8.8.8.8', 80))
    print(s.getsockname()[0])
except Exception:
    print('')
finally:
    s.close()
"@ 2>$null
      if ($pyIp -and $pyIp.Trim() -match '^\d+\.\d+\.\d+\.\d+$') {
        return $pyIp.Trim()
      }
    } catch { }
  }

  try {
    $candidates = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
      Where-Object {
        $_.IPAddress -notlike '127.*' -and
        $_.IPAddress -notlike '169.254.*' -and
        $_.PrefixOrigin -ne 'WellKnown'
      } |
      Sort-Object -Property SkipAsSource, InterfaceIndex |
      Select-Object -ExpandProperty IPAddress
  } catch {
    # 老系统或权限不足时退回 .NET 枚举
    try {
      $candidates = [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) |
        Where-Object { $_.AddressFamily -eq 'InterNetwork' } |
        ForEach-Object { $_.IPAddressToString } |
        Where-Object { $_ -notlike '127.*' -and $_ -notlike '169.254.*' }
    } catch { $candidates = @() }
  }

  # 优先返回 192.168 / 10. / 172.16-31 这类典型内网地址
  $preferred = $candidates | Where-Object {
    $_ -like '192.168.*' -or $_ -like '10.*' -or $_ -match '^172\.(1[6-9]|2\d|3[01])\.'
  } | Select-Object -First 1

  if ($preferred) { return $preferred }
  return ($candidates | Select-Object -First 1)
}

$lanIp = Get-LanIp
$localUrl = "http://localhost:$Port/"
$lanUrl = if ($lanIp) { "http://${lanIp}:$Port/" } else { $null }

# ---------- 5. 二维码 ----------
function Show-Qr([string]$text) {
  # 首选：本地 Python + qrcode 直接算矩阵。
  # 不联网、无延迟，断网 / 纯内网环境也能出码。
  $qrScript = Join-Path $ProjectRoot 'scripts\qrterm.py'
  if ((Test-Path $qrScript) -and (Get-Command python -ErrorAction SilentlyContinue)) {
    try {
      $raw = & python $qrScript $text 2>$null
      $lines = @($raw) | ForEach-Object { [string]$_ } | Where-Object { $_.Trim().Length -gt 0 }
      if ($lines.Count -ge 21) {
        Write-Host '  手机扫码直接打开（安卓 / iOS 都可以）：' -ForegroundColor Gray
        Write-Host ''
        $block = [string][char]0x2588 + [string][char]0x2588
        foreach ($line in $lines) {
          $sb = New-Object System.Text.StringBuilder
          foreach ($ch in $line.ToCharArray()) {
            # 亮块用黑底白块、暗块用白底黑块，保证黑白对比足够扫码
            if ($ch -eq '#') { [void]$sb.Append($block) } else { [void]$sb.Append('  ') }
          }
          Write-Host $sb.ToString() -ForegroundColor Black -BackgroundColor White
        }
        Write-Host ''
        return
      }
    } catch {
      # 出问题就落到下面的在线方案
    }
  }

  # 退路：没有 Python 时，用在线二维码接口生成图片再转字符画
  try {
    Add-Type -AssemblyName System.Web -ErrorAction Stop
    $qrBase = 'https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=6&data='
    $qrUrl = $qrBase + [System.Web.HttpUtility]::UrlEncode($text)
    $bytes = (Invoke-WebRequest -Uri $qrUrl -UseBasicParsing -TimeoutSec 8).Content

    $tmpFile = Join-Path $env:TEMP ('qr_' + [guid]::NewGuid().ToString('N') + '.png')
    [System.IO.File]::WriteAllBytes($tmpFile, $bytes)

    $source = [System.Drawing.Image]::FromFile($tmpFile)
    $cells = 44
    $cellRows = [int]($source.Height * $cells / $source.Width)
    $bmp = New-Object System.Drawing.Bitmap($source, $cells, $cellRows)

    Write-Host '  手机扫码直接打开（安卓 / iOS 都可以）：' -ForegroundColor Gray
    Write-Host ''

    $block = [string][char]0x2588 + [string][char]0x2588
    $blank = '  '
    for ($y = 0; $y -lt $bmp.Height; $y++) {
      $sb = New-Object System.Text.StringBuilder
      for ($x = 0; $x -lt $bmp.Width; $x++) {
        $px = $bmp.GetPixel($x, $y)
        $lum = ($px.R * 0.299) + ($px.G * 0.587) + ($px.B * 0.114)
        if ($lum -lt 128) { [void]$sb.Append($block) } else { [void]$sb.Append($blank) }
      }
      Write-Host $sb.ToString() -ForegroundColor Black -BackgroundColor White
    }
    Write-Host ''

    $bmp.Dispose()
    $source.Dispose()
    Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue
  } catch {
    # 两条路都不通也没关系：上面的文字地址已经够用了
  }
}

Write-Host ''
Write-Host '  --------------------------------------------' -ForegroundColor DarkGray
Write-Host '   访问地址' -ForegroundColor White
Write-Host ''
Write-Host "   本机：    $localUrl" -ForegroundColor Green
if ($lanUrl) {
  Write-Host "   局域网：  $lanUrl" -ForegroundColor Green
  Write-Host '             （手机 / 平板连同一个 Wi-Fi 后打开这个地址）' -ForegroundColor Gray
} else {
  Write-Warn2 '没有检测到局域网 IP，手机暂时无法访问。请确认电脑已连上 Wi-Fi 或网线。'
}
Write-Host '  --------------------------------------------' -ForegroundColor DarkGray
Write-Host ''

if ($lanUrl) { Show-Qr $lanUrl }

if (-not $NoBrowser) {
  Write-Step '正在打开浏览器…'
  Start-Process $localUrl
}

Write-Host ''
if ($Mode -eq 'dev') {
  Write-Host '  开发服务器已启动：修改代码会自动热更新，无需重启。' -ForegroundColor Cyan
} else {
  Write-Host '  网站已启动：这就是一个本地网站，浏览器直接访问上面的网址即可。' -ForegroundColor Cyan
  Write-Host '  改完代码后重新运行本脚本，会自动检测并重新构建。' -ForegroundColor Cyan
}
Write-Host '  停止服务：在本窗口按 Ctrl + C，或直接关闭窗口。' -ForegroundColor Cyan
if ($lanUrl) {
  Write-Host ''
  Write-Host '  手机连不上？按顺序检查：' -ForegroundColor Yellow
  Write-Host '    1. 手机和电脑是否连的同一个 Wi-Fi（注意别一个连 5G 一个连 2.4G 的不同网段）' -ForegroundColor Gray
  Write-Host '    2. Windows 防火墙是否拦了 Node.js —— 首次运行要选「允许访问」' -ForegroundColor Gray
  Write-Host '       手动放行：控制面板 → Windows Defender 防火墙 → 允许应用通过防火墙 → 勾选 Node.js' -ForegroundColor Gray
  Write-Host '    3. 路由器是否开了「AP 隔离 / 客户端隔离」，开了的话设备之间不能互访' -ForegroundColor Gray
  Write-Host '    4. 公司/学校网络常禁止设备互访，可改用手机热点让电脑连上' -ForegroundColor Gray
}
Write-Host ''

# ---------- 6. 启动服务（占用当前窗口） ----------
$env:HOST = '0.0.0.0'
$env:PORT = "$Port"

try {
  if ($Mode -eq 'dev') {
    & node $viteBin --host 0.0.0.0 --port $Port
  } else {
    & node (Join-Path $ProjectRoot 'scripts\serve.mjs') --host 0.0.0.0 --port $Port --root dist
  }
} finally {
  Write-Host ''
  Write-Host '  服务已停止。' -ForegroundColor Yellow
}

Write-Host ''
Read-Host '  按回车键关闭窗口'
