# 把"自动监视器"装成开机自启（当前用户），并立刻启动
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Watcher = Join-Path $Root 'game_overlay\auto-watch.ps1'
$Startup = [Environment]::GetFolderPath('Startup')
$VbsPath = Join-Path $Startup '三国杀自走棋助手（自动注入）.vbs'

if (-not (Test-Path -LiteralPath $Watcher)) { Write-Host "[X] 找不到 $Watcher"; exit 1 }

Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.CommandLine -match 'auto-watch\.ps1|game_overlay\\launch\.ps1' -and $_.ProcessId -ne $PID } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1

$vbsLines = @(
    'Set s = CreateObject("WScript.Shell")',
    ('s.Run "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""' + $Watcher + '""", 0, False')
)
# 路径里有中文，VBS 必须存成 UTF-16LE(带 BOM)，wscript 才认
Set-Content -LiteralPath $VbsPath -Value $vbsLines -Encoding Unicode
Write-Host "[✓] 已安装开机自启：$VbsPath"

Start-Process -FilePath 'wscript.exe' -ArgumentList "`"$VbsPath`"" -WindowStyle Hidden | Out-Null
Start-Sleep -Seconds 3

$running = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'auto-watch\.ps1' })
Write-Host ("[✓] 监视器已在运行：{0} 个进程" -f $running.Count)
Write-Host ''
Write-Host '以后你随便怎么开游戏（Steam 点、桌面图标都行），助手都会自动挂上。'
Write-Host ("日志：" + (Join-Path $Root 'logs\auto-watch.log'))
Write-Host '不想用了：双击「卸载自动启动.bat」'
