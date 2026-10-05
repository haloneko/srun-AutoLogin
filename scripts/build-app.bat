@echo off
setlocal
chcp 65001 >nul
rem ============================================
rem  打包桌面应用（免安装 exe，不生成安装包）
rem  用法：双击运行，或 scripts\build-app.bat
rem ============================================

set "ROOT=%~dp0.."

echo.
echo ==== 打包桌面应用 (srun-app) ... ====
pushd "%ROOT%\srun-app"
call npm run tauri build -- --no-bundle
if errorlevel 1 (
  echo [错误] 应用打包失败
  popd
  exit /b 1
)
popd

set "APPEXE=%ROOT%\srun-app\src-tauri\target\release\srun.exe"
echo.
echo 打包完成！
echo   桌面 App: %APPEXE%
if /i not "%~1"=="silent" pause
exit /b 0
