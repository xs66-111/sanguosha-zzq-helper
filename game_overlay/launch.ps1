# 三国杀自走棋 · 一键"带调试口启动客户端 + 注入浮窗助手"
#
# 做什么：
#   1. 找到 Steam 版《三国杀》客户端 Sgsc10th.exe
#   2. 用 --remote-debugging-port=9222 启动它（客户端本身是 Chromium 套壳）
#   3. 通过 CDP 把 data/tavernchess.js + game_overlay/overlay.js 注入进游戏页面
#   4. 一直挂着，换页/刷新自动重注入；关掉这个窗口=卸载浮窗
#
# 只做只读注入，不发送游戏协议、不自动操作。

param(
    [int]$Port = 9222,
    [switch]$NoLaunch
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$DataFile = Join-Path $Root 'data\tavernchess.js'
$LineupsFile = Join-Path $Root 'data\lineups.js'
$StatsFile = Join-Path $Root 'data\stats.js'
$OverlayFile = Join-Path $Root 'game_overlay\overlay.js'
$RecordsFile = Join-Path $Root 'records\matches.json'

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Warn2($msg) { Write-Host "[!] $msg" -ForegroundColor Yellow }
function Write-Ok($msg) { Write-Host "[✓] $msg" -ForegroundColor Green }

function Test-Port {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/json/version" -UseBasicParsing -TimeoutSec 3
        return $r.StatusCode -eq 200
    } catch { return $false }
}

function Find-GameExe {
    $roots = @()
    foreach ($key in @('HKCU:\Software\Valve\Steam', 'HKLM:\SOFTWARE\WOW6432Node\Valve\Steam')) {
        try {
            $p = (Get-ItemProperty -Path $key -ErrorAction Stop).SteamPath
            if ($p) { $roots += ($p -replace '/', '\') }
        } catch { }
    }
    $libs = @()
    foreach ($r in $roots) {
        $vdf = Join-Path $r 'steamapps\libraryfolders.vdf'
        if (Test-Path $vdf) {
            $txt = Get-Content -LiteralPath $vdf -Raw -Encoding UTF8
            foreach ($m in [regex]::Matches($txt, '"path"\s+"([^"]+)"')) {
                $libs += ($m.Groups[1].Value -replace '\\\\', '\')
            }
        }
        $libs += $r
    }
    $libs += @('D:\SteamLibrary', 'E:\Steam', 'C:\Program Files (x86)\Steam')
    $cands = @()
    foreach ($l in $libs) {
        $cands += (Join-Path $l 'steamapps\common\Sgsc10th\Sgsc10th.exe')
    }
    foreach ($c in $cands) { if (Test-Path -LiteralPath $c) { return $c } }
    return $null
}

Write-Host ''
Write-Host ' 三国杀自走棋 · 浮窗助手注入器' -ForegroundColor Yellow
Write-Host ' --------------------------------'

if (-not (Test-Path -LiteralPath $DataFile)) {
    Write-Warn2 "没找到数据文件：$DataFile"
    Write-Host '    请先运行本文件夹里的「更新数据.bat」（或 python tools/update_data.py）生成数据。'
    exit 1
}

if (Test-Port) {
    Write-Ok "检测到调试端口 $Port 已开启，直接注入。"
} else {
    if ($NoLaunch) { Write-Warn2 "端口未开且指定了 -NoLaunch，退出。"; exit 1 }
    $exe = Find-GameExe
    if (-not $exe) {
        Write-Warn2 '没找到 Sgsc10th.exe。请手动用下面的参数启动游戏，然后重跑本脚本：'
        Write-Host "    Sgsc10th.exe --remote-debugging-port=$Port"
        exit 1
    }
    Write-Step "客户端：$exe"
    $running = Get-Process -Name 'Sgsc10th' -ErrorAction SilentlyContinue
    if ($running) {
        Write-Warn2 '游戏已经在运行，但没带调试端口。'
        $ans = Read-Host '    需要先退出游戏才能重新带端口启动，现在关掉它吗？(y/N)'
        if ($ans -match '^[Yy]') {
            $running | Stop-Process -Force
            Start-Sleep -Seconds 3
            Write-Ok '已关闭旧进程。'
        } else {
            Write-Host '    那就先手动退出游戏，再重新运行本脚本。'
            exit 1
        }
    }
    Write-Step "启动客户端（调试端口 $Port）…（Steam 需要处于登录状态）"
    Start-Process -FilePath $exe -ArgumentList "--remote-debugging-port=$Port" | Out-Null
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Seconds 1
        if (Test-Port) { break }
    }
    if (-not (Test-Port)) {
        Write-Warn2 '等了 60 秒还是连不上调试端口，可能是启动失败或端口被占用。'
        exit 1
    }
    Write-Ok '调试端口已就绪。'
}

# ---- 读取注入内容 ----
$dataJs = Get-Content -LiteralPath $DataFile -Raw -Encoding UTF8
$lineupsJs = if (Test-Path -LiteralPath $LineupsFile) { Get-Content -LiteralPath $LineupsFile -Raw -Encoding UTF8 } else { '' }
$statsJs = if (Test-Path -LiteralPath $StatsFile) { Get-Content -LiteralPath $StatsFile -Raw -Encoding UTF8 } else { '' }
$overlayJs = Get-Content -LiteralPath $OverlayFile -Raw -Encoding UTF8
$payload = @"
(function(){try{
$dataJs
}catch(e){console.warn('[自走棋助手] 数据注入失败',e);}
try{
$lineupsJs
}catch(e){console.warn('[自走棋助手] 阵容库注入失败',e);}
try{
$statsJs
}catch(e){console.warn('[自走棋助手] 统计注入失败',e);}
try{
$overlayJs
}catch(e){console.warn('[自走棋助手] 浮窗注入失败',e);}
})();
"@
$runScript = @"
(function(){
$payload
  try{
    var src = $(ConvertTo-Json $payload -Compress);
    var fs = document.querySelectorAll('iframe');
    for (var i=0;i<fs.length;i++){
      try{ var w=fs[i].contentWindow; if(w && !w.__zzqOverlayLoaded) w.eval(src); }catch(e){}
    }
  }catch(e){}
})();
"@

function Receive-Json($ws) {
    $buf = New-Object byte[] 262144
    $seg = New-Object 'System.ArraySegment[byte]' -ArgumentList @(, $buf)
    $sb = New-Object System.Text.StringBuilder
    do {
        $t = $ws.ReceiveAsync($seg, [Threading.CancellationToken]::None)
        $t.Wait()
        $res = $t.Result
        [void]$sb.Append([Text.Encoding]::UTF8.GetString($buf, 0, $res.Count))
    } while (-not $res.EndOfMessage)
    return $sb.ToString()
}

function Send-Cdp($ws, [int]$id, [string]$method, $params) {
    $msg = @{ id = $id; method = $method; params = $params } | ConvertTo-Json -Depth 30 -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($msg)
    $seg = New-Object 'System.ArraySegment[byte]' -ArgumentList @(, $bytes)
    $ws.SendAsync($seg, [Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).Wait()
    while ($true) {
        $raw = Receive-Json $ws
        $obj = $raw | ConvertFrom-Json
        if ($obj.id -eq $id) { return $obj }
    }
}

$injected = @{}
$lastRecords = ''
Write-Step '正在注入浮窗…'

while ($true) {
    try {
        $list = (Invoke-WebRequest -Uri "http://127.0.0.1:$Port/json/list" -UseBasicParsing -TimeoutSec 5).Content | ConvertFrom-Json
        foreach ($t in $list) {
            if ($t.type -ne 'page') { continue }
            if ($t.url -match '^(devtools|chrome|edge|about|chrome-extension|edge-extension):') { continue }
            if ($t.url -notmatch '^(https?|file):') { continue }
            if ($injected.ContainsKey($t.id)) { continue }

            $ws = New-Object System.Net.WebSockets.ClientWebSocket
            $ws.ConnectAsync([Uri]$t.webSocketDebuggerUrl, [Threading.CancellationToken]::None).Wait()
            $null = Send-Cdp $ws 1 'Page.enable' @{}
            $null = Send-Cdp $ws 2 'Runtime.enable' @{}
            $null = Send-Cdp $ws 3 'Page.addScriptToEvaluateOnNewDocument' @{ source = $runScript }
            $res = Send-Cdp $ws 4 'Runtime.evaluate' @{ expression = $runScript; includeCommandLineAPI = $true }
            if ($res.result.exceptionDetails) {
                Write-Warn2 ("注入异常：" + $res.result.exceptionDetails.text)
            } else {
                Write-Ok ("已注入：" + $t.title + "  " + $t.url)
            }
            $injected[$t.id] = $ws
        }

        # 定时把游戏里的对局记录拉回本地（记录器在浮窗脚本里）
        foreach ($kv in @($injected.GetEnumerator())) {
            $ws2 = $kv.Value
            try {
                $res2 = Send-Cdp $ws2 900 'Runtime.evaluate' @{ expression = 'window.__zzqExportMatches ? window.__zzqExportMatches() : ""'; returnByValue = $true }
                $text = $res2.result.result.value
                if ($text -and $text.Length -gt 2 -and $text -ne $lastRecords) {
                    $lastRecords = $text
                    $dir = Split-Path -Parent $RecordsFile
                    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
                    $obj = $text | ConvertFrom-Json
                    ($obj | ConvertTo-Json -Depth 12) | Set-Content -LiteralPath $RecordsFile -Encoding UTF8
                    Write-Ok ("对局记录已保存 " + @($obj).Count + " 局 → " + $RecordsFile)
                }
            } catch {
                Write-Warn2 ("记录同步失败：" + $_.Exception.Message)
            }
        }
    } catch {
        Write-Warn2 ("轮询出错：" + $_.Exception.Message)
    }
    Start-Sleep -Seconds 3
}
