# srun — 深澜校园网自动登录

深澜校园网自动登录工具，包含三个模块：

| 模块 | 说明 | 技术栈 |
|---|---|---|
| `srun-core` | 核心库：深澜加密算法、HTTP 请求、在线状态查询 | Rust |
| `srun-cli` | 命令行工具：登录、失败重试、dry-run 离线调试 | Rust (clap + tokio) |
| `srun-app` | 桌面应用：可视化登录/状态/设置、托盘常驻 | Tauri 2 + React |

## 功能介绍

- **图形化界面**：可视化登录/状态/设置，支持自定义认证服务器地址
- **一键自动登录**：登录 / 注销深澜账号，断网自动重连、失败重试
- **状态展示**：在线状态、IP 地址、上线时长、已用流量、在线设备数
- **设置**：账号密码、认证服务器、开机自启动、启动行为（自动 / 手动 / 记录上次状态）
- **系统托盘**：点 × 隐藏后台运行，托盘图标切换窗口 / 退出
- **单例运行**：重复启动只唤起已有窗口，不重复开进程
- **免安装 exe**：可直接运行 `srun.exe` 启动，无需安装
- **CLI 命令行工具**：登录 / 失败重试 / 倒计时退出，支持 `--dry-run` 离线调试与自定义服务器地址

## 适用学校

- 默认适配 **山东管理学院**（认证服务器 `https://wlrz.sdmu.edu.cn/`）
- 其他使用**深澜（srun）认证系统**的学校：在桌面应用「设置 → 认证服务器地址」中填入本校的网关登录地址即可试用，无需改代码重新编译
- 说明：深澜系统普遍基于 `srun_portal` / `get_challenge` 协议，接口基本兼容；但个别学校的认证组（`ac_id`）、加密版本等配置不同，若登录失败可提供网关地址协助适配

## 目录结构

```
srun/
├── Cargo.toml              # Cargo workspace
├── srun-core/              # 核心库
├── srun-cli/               # 命令行工具
├── srun-app/               # 桌面应用（React 前端 + Tauri 壳）
│   ├── src/                # React 前端
│   └── src-tauri/          # Tauri 后端（Rust）
├── scripts/                # 打包脚本（package / build-cli / build-app / build-installer）
└── README.md
```

## 环境要求

- [Rust](https://www.rust-lang.org/)（stable）
- [Node.js](https://nodejs.org/) 18+ 与 npm
- 桌面应用打包还需要 [WebView2 运行时](https://developer.microsoft.com/microsoft-edge/webview2/)（Win10/11 一般自带）

## 开发运行

```bash
# 桌面应用（热更新开发模式）
cd srun-app
npm install
npm run tauri dev

# CLI（构建并运行）
cargo run -p srun-cli -- --help
```

## 打包脚本

`scripts\` 目录提供 4 个脚本：

| 脚本 | 作用 | 产物 |
|---|---|---|
| `package.bat` | 一键打包全部（调用下面 3 个） | CLI + App + 安装包 |
| `build-cli.bat` | 只打包 CLI | `dist\srun-cli.exe` |
| `build-app.bat` | 只打包桌面 App（免安装 exe） | `srun-app\src-tauri\target\release\srun.exe` |
| `build-installer.bat` | 只打包安装包 | `bundle\nsis\*.exe`、`bundle\msi\*.msi` |

### 一键打包

在项目根目录执行（或直接双击）：

```bat
scripts\package.bat
```

依次执行 `build-cli.bat` → `build-app.bat` → `build-installer.bat`，任一失败即中止。

### 单独打包

```bat
scripts\build-cli.bat          # 只打 CLI
scripts\build-app.bat          # 只打桌面 App（免安装 exe，不生成安装包）
scripts\build-installer.bat    # 只打安装包
```

### 产物位置

| 产物 | 路径 |
|---|---|
| CLI 可执行文件 | `dist\srun-cli.exe` |
| 桌面 App（免安装 exe） | `srun-app\src-tauri\target\release\bundle\srun.exe` |
| 安装包 NSIS | `srun-app\src-tauri\target\release\bundle\nsis\*.exe` |
| 安装包 MSI | `srun-app\src-tauri\target\release\bundle\msi\*.msi` |

> 说明：`build-app.bat` 使用 `tauri build --no-bundle` 只出 exe；`build-installer.bat` 使用 `tauri build` 按 `tauri.conf.json` 的 `bundle.targets` 出安装包（当前为 `"all"`）。

## 打包配置说明

- 安装包格式在 `srun-app\src-tauri\tauri.conf.json` 的 `bundle.targets` 配置，当前为 `"all"`（生成 NSIS + MSI）
- 想加快打包或只出单一格式，可改为 `"nsis"` 或 `"msi"`
- 首次打包耗时较长（需编译依赖并下载 WiX/NSIS 工具链），之后会缓存

## 声明

仅提供快捷登录方式，不提供破解服务，不会绕过计费系统