//! srun-app - 深澜校园网自动登录桌面应用（Tauri 后端）
//!
//! 复用 `srun-core` 完成登录流程，通过 Tauri command 暴露给 React 前端。

use serde::Deserialize;
use serde_json::Value;
use srun_core::http::SrunHttp;
use srun_core::login::SrunLoginOptions;
use srun_core::status::OnlineStatus;
mod wifi;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::MacosLauncher;

/// 显示并聚焦主窗口
fn show_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// 托盘左键单击：切换主窗口显示 / 隐藏
fn toggle_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            show_main_window(app);
        }
    }
}

/// 构建系统托盘：左键切换窗口，右键菜单可显示主界面 / 退出
fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "show", "显示主界面", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    let mut tray = TrayIconBuilder::with_id("main-tray")
        .tooltip("深澜校园网自动登录")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }

    tray.build(app)?;
    Ok(())
}

/// 开机自启动是否已启用
#[tauri::command]
fn autostart_enabled(app: AppHandle) -> bool {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().unwrap_or(false)
}

/// 开启 / 关闭开机自启动
#[tauri::command]
fn autostart_set(app: AppHandle, enable: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let autolaunch = app.autolaunch();
    if enable {
        autolaunch.enable().map_err(|e| e.to_string())
    } else {
        autolaunch.disable().map_err(|e| e.to_string())
    }
}

/// 网关兼容参数：与前端 `toLoginOptions()` 字段一一对应，三个 command 统一消费。
///
/// 全部字段可缺省，空白值在核心层 [`SrunLoginOptions::normalize`] 中回退默认配置。
/// 后续新增设置项只需改这里与核心 options，command 签名保持稳定。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GatewayOptions {
    base_url: Option<String>,
    ac_id: Option<String>,
    enc_ver: Option<String>,
    base64_alpha: Option<String>,
    user_agent: Option<String>,
}

impl GatewayOptions {
    /// Option 转 String，空白字段回退默认值（供登录 / 状态 / 注销共用）
    fn to_srun_options(&self) -> SrunLoginOptions {
        let mut opts = SrunLoginOptions {
            base_url: self.base_url.clone().unwrap_or_default(),
            ac_id: self.ac_id.clone().unwrap_or_default(),
            enc_ver: self.enc_ver.clone().unwrap_or_default(),
            base64_alpha: self.base64_alpha.clone().unwrap_or_default(),
            user_agent: self.user_agent.clone().unwrap_or_default(),
        };
        opts.normalize();
        opts
    }
}

/// 登录 command：前端 `invoke("srun_login", { username, password, options })` 调用。
///
/// 返回 srun_portal 的解析结果（`error` / `client_ip` / `online_ip` / `suc_msg` / `error_msg`），
/// 流程异常时以字符串错误返回（`error != "ok"` 属于业务失败，走 Ok 分支）。
#[tauri::command]
async fn srun_login(
    username: String,
    password: String,
    options: GatewayOptions,
) -> Result<Value, String> {
    let opts = options.to_srun_options();
    srun_core::login::login_ex(&username, &password, &opts)
        .await
        .map_err(|e| e.to_string())
}

/// 在线状态 command：前端 `invoke("srun_status", { options })` 调用。
///
/// 查询 `/cgi-bin/rad_user_info`，返回在线与否、账号、IP、上线时长、已用流量。
#[tauri::command]
async fn srun_status(options: GatewayOptions) -> Result<OnlineStatus, String> {
    let opts = options.to_srun_options();
    let http = SrunHttp::with_base_url_and_ua(&opts.base_url, &opts.user_agent)
        .map_err(|e| e.to_string())?;
    srun_core::status::get_online_status(&http)
        .await
        .map_err(|e| e.to_string())
}

/// 注销 command：前端 `invoke("srun_logout", { options })` 调用。
///
/// 通过 `/cgi-bin/srun_portal`（action=logout）断开当前连接，
/// 返回网关原始解析结果（`error` / `error_msg` 等）。
#[tauri::command]
async fn srun_logout(options: GatewayOptions) -> Result<Value, String> {
    let opts = options.to_srun_options();
    let http = SrunHttp::with_base_url_and_ua(&opts.base_url, &opts.user_agent)
        .map_err(|e| e.to_string())?;
    srun_core::logout::logout(&http)
        .await
        .map_err(|e| e.to_string())
}

/// 当前无线连接状态 command：前端 `invoke("wifi_status")` 调用。
///
/// 无网卡 / WLAN 服务未启动 / 接口禁用时返回 `interface_ready=false`，
/// 由前端据此决定是否跳过自动连接。
///
/// `netsh` 是阻塞调用，必须 async + `spawn_blocking`：非 async 的 command 在主线程执行，
/// netsh 期间窗口会整体假死（启动后几秒「点不动、拖不动」）。
#[tauri::command]
async fn wifi_status() -> Result<wifi::WifiStatus, String> {
    tauri::async_runtime::spawn_blocking(wifi::current_status)
        .await
        .map_err(|e| e.to_string())
}

/// 连接指定 WiFi command：前端 `invoke("wifi_connect", { ssid, password })` 调用。
///
/// `password` 可缺省（开放网络或已保存过密码的网络）。返回 [`wifi::WifiConnectResult`]，
/// 其中 `connected=true` 表示本次实际执行了连接，前端可据此等待 DHCP 就绪后再查状态。
///
/// 同 [`wifi_status`]：连接含多次 netsh 调用与最多 15 秒轮询，必须放到阻塞线程池执行，
/// 否则会长时间占住主线程导致窗口假死。
#[tauri::command]
async fn wifi_connect(
    ssid: String,
    password: Option<String>,
) -> Result<wifi::WifiConnectResult, String> {
    let password = password.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || wifi::connect(&ssid, &password))
        .await
        .map_err(|e| e.to_string())?
}

/// 开机自启动拉起时附加的命令行参数，用于区分「自启动」与「用户手动启动」。
/// 自启动隐藏、手动启动显示主窗口，依赖该标记判断。
const AUTOSTART_FLAG: &str = "--silent";

/// 判断当前进程是否为开机自启动拉起（命令行含 `--silent` 标记）。
/// 自启动附加该参数见 `run()` 中 autostart 插件初始化。
fn is_autostart_launch_impl() -> bool {
    std::env::args().any(|a| a == AUTOSTART_FLAG)
}

/// 前端查询接口：是否为自启动拉起（供前端补充显示逻辑使用）。
#[tauri::command]
fn is_autostart_launch() -> bool {
    is_autostart_launch_impl()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            // 自启动时附加 --silent：应用据此隐藏主窗口，仅驻留托盘
            Some(vec![AUTOSTART_FLAG]),
        ))
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // 第二次启动：不新建实例。
            // 手动启动（无 --silent）唤出已有窗口；自启动重复拉起则保持后台驻留。
            if !args.iter().any(|a| a == AUTOSTART_FLAG) {
                show_main_window(app);
            }
        }))
        .setup(|app| {
            setup_tray(app)?;
            // 窗口默认隐藏（tauri.conf.json visible:false）。
            // 手动启动（命令行无 --silent）时由后端直接显示主窗口，不经过前端 JS：
            // 避免 WebView 未就绪或前端脚本报错导致窗口永不出现。
            // 开机自启动（带 --silent）则不在此显示，交由前端按「静默启动」设置决定。
            if !is_autostart_launch_impl() {
                show_main_window(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // 点 × 关闭：隐藏到托盘后台运行，而非退出应用
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            srun_login,
            srun_status,
            srun_logout,
            autostart_enabled,
            autostart_set,
            is_autostart_launch,
            wifi_status,
            wifi_connect
        ])
        .run(tauri::generate_context!())
        .expect("Tauri 应用启动失败");
}
