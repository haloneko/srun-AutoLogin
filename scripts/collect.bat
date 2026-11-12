@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
rem ============================================
rem  归集产物：按版本号重命名，复制到 ..\<版本>\
rem  用法：scripts\collect.bat（package.bat 末尾自动调用）
rem ============================================

set "ROOT=%~dp0.."
rem workspace 构建：所有产物都落在根目录的 target\release 下
set "RELEASE=%ROOT%\target\release"
set "CLI_DIR=%RELEASE%"

rem 版本号统一取桌面应用的 Cargo 版本，安装包与 CLI 都按它命名
set "VERSION="
for /f "tokens=2 delims==" %%v in ('findstr /b /c:"version =" "%ROOT%\srun-app\src-tauri\Cargo.toml"') do (
  if not defined VERSION set "VERSION=%%v"
)
set "VERSION=%VERSION: =%"
set VERSION=%VERSION:"=%
if not defined VERSION (
  echo [错误] 未能从 srun-app\src-tauri\Cargo.toml 读取版本号
  exit /b 1
)

rem 上级目录下按版本号建目录：srun\..\<版本>\
pushd "%ROOT%\.."
set "OUT=%CD%\%VERSION%"
popd
if not exist "%OUT%" mkdir "%OUT%"

echo.
echo ==== 归集产物 (版本 %VERSION%) ====
echo   目标目录: %OUT%

set "FAILED="

rem ---- CLI 可执行文件 ----
if exist "%CLI_DIR%\srun-cli.exe" (
  copy /y "%CLI_DIR%\srun-cli.exe" "%OUT%\srun-cli_%VERSION%_windows_amd64.exe" >nul || set "FAILED=1"
  echo   -^> srun-cli_%VERSION%_windows_amd64.exe
) else (
  echo   [跳过] 未找到 CLI 产物: %CLI_DIR%\srun-cli.exe
)

rem ---- 桌面 App 免安装 exe ----
set "APP="
if exist "%RELEASE%\srun-app.exe" set "APP=%RELEASE%\srun-app.exe"
if not defined APP if exist "%RELEASE%\srun.exe" set "APP=%RELEASE%\srun.exe"
if defined APP (
  copy /y "%APP%" "%OUT%\srun-app.exe" >nul || set "FAILED=1"
  echo   -^> srun-app.exe
) else (
  echo   [跳过] 未找到桌面 App 产物: %RELEASE%\srun-app.exe
)

rem ---- NSIS 安装包 ----
set "FOUND="
if exist "%RELEASE%\bundle\nsis\*.exe" (
  for %%f in ("%RELEASE%\bundle\nsis\*.exe") do (
    copy /y "%%~ff" "%OUT%\srun_%VERSION%_x64-setup.exe" >nul || set "FAILED=1"
    set "FOUND=1"
  )
)
if defined FOUND (
  echo   -^> srun_%VERSION%_x64-setup.exe
) else (
  echo   [跳过] 未找到 NSIS 安装包
)

rem ---- MSI 安装包 ----
set "FOUND="
if exist "%RELEASE%\bundle\msi\*.msi" (
  for %%f in ("%RELEASE%\bundle\msi\*.msi") do (
    copy /y "%%~ff" "%OUT%\srun_%VERSION%_x64-setup.msi" >nul || set "FAILED=1"
    set "FOUND=1"
  )
)
if defined FOUND (
  echo   -^> srun_%VERSION%_x64-setup.msi
) else (
  echo   [跳过] 未找到 MSI 安装包
)

if defined FAILED (
  echo.
  echo [错误] 有文件复制失败，请检查目标目录是否被占用
  exit /b 1
)

echo.
echo 归集完成！
if /i not "%~1"=="silent" pause
exit /b 0
