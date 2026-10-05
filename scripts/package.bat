@echo off
chcp 65001 >nul
rem ============================================
rem  一键打包：CLI + 桌面 App + 安装包
rem  依次调用 scripts\ 下 3 个子脚本
rem  用法：双击运行，或 scripts\package.bat
rem ============================================

set "SCRIPTS=%~dp0"

echo.
echo ==== [1/3] 打包 CLI ====
call "%SCRIPTS%build-cli.bat" silent
if errorlevel 1 exit /b 1

echo.
echo ==== [2/3] 打包桌面 App ====
call "%SCRIPTS%build-app.bat" silent
if errorlevel 1 exit /b 1

echo.
echo ==== [3/3] 打包安装包 ====
call "%SCRIPTS%build-installer.bat" silent
if errorlevel 1 exit /b 1

echo.
echo 全部打包完成！
pause
