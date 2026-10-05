@echo off
setlocal
chcp 65001 >nul
rem ============================================
rem  打包 CLI 可执行文件 (srun-cli)
rem  用法：双击运行，或 scripts\build-cli.bat
rem ============================================

set "ROOT=%~dp0.."
set "OUTDIR=%ROOT%\dist"

echo.
echo ==== 打包 CLI (srun-cli) ... ====
pushd "%ROOT%"
cargo build --release -p srun-cli
if errorlevel 1 (
  echo [错误] CLI 打包失败
  popd
  exit /b 1
)
popd

if not exist "%OUTDIR%" mkdir "%OUTDIR%"
set "CLIEXE=%ROOT%\target\release\srun-cli.exe"
if not exist "%CLIEXE%" (
  echo [错误] 未找到 CLI 产物: %CLIEXE%
  exit /b 1
)
copy /y "%CLIEXE%" "%OUTDIR%\srun-cli.exe" >nul
echo   -^> %OUTDIR%\srun-cli.exe

echo.
echo 打包完成！
if /i not "%~1"=="silent" pause
exit /b 0
