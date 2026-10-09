# 三国杀自走棋助手 · 自动监视器
#
# 作用：不管你是从 Steam 点开、桌面图标点开还是 启动并注入.bat，都能自动把浮窗挂上。
#   1. 盯着 Sgsc10th.exe 进程
#   2. 端口在 → 起一个子进程做注入（game_overlay/launch.ps1 -NoLaunch）
#   3. 端口不在、但游戏是"刚启动"的（默认 150 秒内）→ 自动带调试端口重启游戏
#   4. 端口不在、游戏已经跑了很久 → 只弹提示，不擅自杀掉你的对局
#
# 日志：logs/auto-watch.log

param(
    [int]$Port = 9222,
    [int]$IntervalSec = 3,
    [int]$FreshSeconds = 150,
    [switch]$NoRelaunch,
    [switch]$NoNotify,
    [switch]$Once
)

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$LaunchScript = Join-Path $Root 'game_overlay\launch.ps1'
$LogDir = Join-Path $Root 'logs'
$LogFile = Join-Path $LogDir 'auto-watch.log'
if (-not (Test-Path -LiteralPath $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

function Write-Log($msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
    Write-Host $line
}

$script:notifyIcon = $null
function Notify($text, $title = '三国杀自走棋助手') {
    if ($NoNotify) { return }
    try {
        if (-not $script:notifyIcon) {
            Add-Type -AssemblyName System.Windows.Forms
            Add-Type -AssemblyName System.Drawing
            $script:notifyIcon = New-Object System.Windows.Forms.NotifyIcon
            $script:notifyIcon.Icon = [System.Drawing.SystemIcons]::Information
            $script:notifyIcon.Visible = $true
        }
        $script:notifyIcon.ShowBalloonTip(6000, $title, $text, [System.Windows.Forms.ToolTipIcon]::Info)
    } catch { }
}

function Test-PortAlive([int]$p) {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$p/json/version" -UseBasicParsing -TimeoutSec 3
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
            foreach ($m in [regex]::Matches($txt, '"path"\s+"([^"]+)"')) { $libs += ($m.Groups[1].Value -replace '\\\\', '\') }
        }
        $libs += $r
    }
    $libs += @('D:\SteamLibrary', 'E:\Steam', 'C:\Program Files (x86)\Steam')
    foreach ($l in $libs) {
        $c = Join-Path $l 'steamapps\common\Sgsc10th\Sgsc10th.exe'
        if (Test-Path -LiteralPath $c) { return $c }
    }
    return $null
}

$GameExe = Find-GameExe
Write-Log ("自动监视启动（端口 $Port，间隔 ${IntervalSec}s，自动重启窗口 ${FreshSeconds}s）")
if ($GameExe) { Write-Log "客户端：$GameExe" } else { Write-Log '警告：没找到 Sgsc10th.exe' }

$injector = $null
$lastRelaunch = [datetime]::MinValue
$lastWarned = [datetime]::MinValue

while ($true) {
    try {
        $procs = @(Get-Process -Name 'Sgsc10th' -ErrorAction SilentlyContinue)
        if ($procs.Count -eq 0) {
            if ($injector -and -not $injector.HasExited) {
                Stop-Process -Id $injector.Id -Force -ErrorAction SilentlyContinue
                $injector = $null
                Write-Log '游戏已关闭，停止注入器'
            }
        }
        elseif (Test-PortAlive $Port) {
            if (-not $injector -or $injector.HasExited) {
                $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', $LaunchScript, '-Port', "$Port", '-NoLaunch')
                $injector = Start-Process -FilePath 'powershell' -ArgumentList $argList -WindowStyle Hidden -PassThru
                Write-Log ("端口已开，启动注入器 (PID {0})" -f $injector.Id)
                Notify '自走棋浮窗已挂上，祝吃鸡～'
            }
        }
        else {
            $started = ($procs | Sort-Object StartTime | Select-Object -First 1).StartTime
            $ageSec = [int]((Get-Date) - $started).TotalSeconds
            $recent = ((Get-Date) - $lastRelaunch).TotalSeconds -gt 120
            if ((-not $NoRelaunch) -and $GameExe -and ($ageSec -le $FreshSeconds) -and $recent) {
                Write-Log ("游戏刚启动 ${ageSec}s 且没带调试端口，自动重启以便注入…")
                Notify '正在自动重启游戏（助手需要带调试端口启动）'
                foreach ($p in $procs) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
                Start-Sleep -Seconds 3
                Start-Process -FilePath $GameExe -ArgumentList "--remote-debugging-port=$Port" | Out-Null
                $lastRelaunch = Get-Date
            }
            elseif (((Get-Date) - $lastWarned).TotalMinutes -gt 10) {
                $lastWarned = Get-Date
                Write-Log ("游戏在运行但没有调试端口（已运行 ${ageSec}s），未自动重启。")
                Notify '这次没挂上助手：游戏不是带调试端口启动的。下次直接开游戏我会自动处理；本次想用请重开游戏。'
            }
        }
    } catch {
        Write-Log ("监视循环出错：" + $_.Exception.Message)
    }
    if ($Once) { break }
    Start-Sleep -Seconds $IntervalSec
}
