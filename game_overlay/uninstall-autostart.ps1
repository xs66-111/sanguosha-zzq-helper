# 卸载开机自启，并停掉监视器/注入器
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Startup = [Environment]::GetFolderPath('Startup')
$VbsPath = Join-Path $Startup '三国杀自走棋助手（自动注入）.vbs'

if (Test-Path -LiteralPath $VbsPath) {
    Remove-Item -LiteralPath $VbsPath -Force
    Write-Host "[✓] 已删除开机自启：$VbsPath"
} else {
    Write-Host '[i] 没找到开机自启项，跳过'
}

$killed = 0
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.CommandLine -match 'auto-watch\.ps1|game_overlay\\launch\.ps1' -and $_.ProcessId -ne $PID } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $killed++ }
Write-Host ("[✓] 已停止 {0} 个监视/注入进程" -f $killed)
Write-Host ''
Write-Host '注意：游戏里已经挂上的浮窗会保留到你重启游戏为止。'
