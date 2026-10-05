//! srun-app - 深澜校园网自动登录桌面应用（Tauri 后端）
//!
//! 复用 `srun-core` 完成登录流程，通过 Tauri command 暴露给 React 前端。

use serde_json::Value;
use srun_core::http::SrunHttp;
use srun_core::status::OnlineStatus;
use tauri::AppHandle;
use tauri_plugin_autostart::MacosLauncher;

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

/// 登录 command：前端 `invoke("srun_login", { username, password, baseUrl })` 调用。
///
/// 返回 srun_portal 的解析结果（`error` / `client_ip` / `online_ip` / `suc_msg` / `error_msg`），
/// 流程异常时以字符串错误返回（`error != "ok"` 属于业务失败，走 Ok 分支）。
#[tauri::command]
async fn srun_login(username: String, password: String, base_url: Option<String>) -> Result<Value, String> {
    let http = make_http(base_url)?;
    srun_core::login::login(&http, &username, &password)
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
