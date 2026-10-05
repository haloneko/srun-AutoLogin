@echo off
setlocal
chcp 65001 >nul
rem ============================================
rem  打包安装包 (NSIS + MSI)
rem  用法：双击运行，或 scripts\build-installer.bat
rem ============================================

set "ROOT=%~dp0.."
set "BUNDLE=%ROOT%\srun-app\src-tauri\target\release\bundle"

echo.
echo ==== 打包安装包 (srun-app) ... ====
pushd "%ROOT%\srun-app"
call npm run tauri build
if errorlevel 1 (
  echo [错误] 安装包打包失败
  popd
  exit /b 1
)
popd

echo.
echo 打包完成！安装包位置：
if exist "%BUNDLE%\nsis" (
  for %%f in ("%BUNDLE%\nsis\*.exe") do echo   安装包(NSIS): %%f
)
if exist "%BUNDLE%\msi" (
  for %%f in ("%BUNDLE%\msi\*.msi") do echo   安装包(MSI) : %%f
)
if /i not "%~1"=="silent" pause
exit /b 0
