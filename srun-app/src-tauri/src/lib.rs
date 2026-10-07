//! srun-app - 深澜校园网自动登录桌面应用（Tauri 后端）
//!
//! 复用 `srun-core` 完成登录流程，通过 Tauri command 暴露给 React 前端。

use serde_json::Value;
use srun_core::http::SrunHttp;
use srun_core::status::OnlineStatus;
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

/// 用前端传入的认证服务器地址构造客户端；缺省（未传或为空）时回退到默认网关。
fn make_http(base_url: Option<String>) -> Result<SrunHttp, String> {
    match base_url {
        Some(u) if !u.trim().is_empty() => SrunHttp::with_base_url(u.trim()),
        _ => SrunHttp::new(),
    }
    .map_err(|e| e.to_string())
}

/// 登录 command：前端 `invoke("srun_login", { username, password, baseUrl, acId, encVer, base64Alpha })` 调用。
///
/// 返回 srun_portal 的解析结果（`error` / `client_ip` / `online_ip` / `suc_msg` / `error_msg`），
/// 流程异常时以字符串错误返回（`error != "ok"` 属于业务失败，走 Ok 分支）。
/// `ac_id` / `enc_ver` / `base64_alpha` 为高级设置项，未传或为空时使用默认值（适配其他学校的深澜网关）。
#[tauri::command]
async fn srun_login(
    username: String,
    password: String,
    base_url: Option<String>,
    ac_id: Option<String>,
    enc_ver: Option<String>,
    base64_alpha: Option<String>,
) -> Result<Value, String> {
    let http = make_http(base_url)?;
    let ac_id = ac_id
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| srun_core::config::AC_ID.to_string());
    let enc_ver = enc_ver
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| srun_core::config::ENC_VER.to_string());
    let base64_alpha = base64_alpha
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| srun_core::config::SRUN_BASE64_ALPHA.to_string());
    srun_core::login::login_ex(&http, &username, &password, &ac_id, &enc_ver, &base64_alpha)
        .await
        .map_err(|e| e.to_string())
}

/// 在线状态 command：前端 `invoke("srun_status", { baseUrl })` 调用。
///
/// 查询 `/cgi-bin/rad_user_info`，返回在线与否、账号、IP、上线时长、已用流量。
#[tauri::command]
async fn srun_status(base_url: Option<String>) -> Result<OnlineStatus, String> {
    let http = make_http(base_url)?;
    srun_core::status::get_online_status(&http)
        .await
        .map_err(|e| e.to_string())
}

/// 注销 command：前端 `invoke("srun_logout", { baseUrl })` 调用。
///
/// 通过 `/cgi-bin/srun_portal`（action=logout）断开当前连接，
/// 返回网关原始解析结果（`error` / `error_msg` 等）。
#[tauri::command]
async fn srun_logout(base_url: Option<String>) -> Result<Value, String> {
    let http = make_http(base_url)?;
    srun_core::logout::logout(&http)
        .await
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 第二次启动：不新建实例，唤出已有窗口
            show_main_window(app);
        }))
        .setup(|app| {
            setup_tray(app)?;
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
            autostart_set
        ])
        .run(tauri::generate_context!())
        .expect("Tauri 应用启动失败");
}
