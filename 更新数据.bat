@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   三国杀自走棋助手 - 抓取最新赛季数据
echo ============================================
echo.
echo 正在联网抓取官方配置并解密，请稍等...
echo.
python tools\update_data.py
echo.
if errorlevel 1 (
    echo [失败] 抓取或解密出错。常见原因：
    echo   1. 没装 Python 或没装依赖：python -m pip install wasmtime
    echo   2. 网络不通，可手动另存 Config.sgs 后执行：
    echo      python tools\update_data.py --config Config.sgs
) else (
    echo [完成] 重新打开 index.html 即可看到新赛季数据。
)
echo.
pause
