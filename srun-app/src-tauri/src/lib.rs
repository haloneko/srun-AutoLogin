//! srun-app - 深澜校园网自动登录桌面应用（Tauri 后端）
//!
//! 复用 `srun-core` 完成登录流程，通过 Tauri command 暴露给 React 前端。

use serde_json::Value;
use srun_core::http::SrunHttp;

/// 登录 command：前端 `invoke("srun_login", { username, password })` 调用。
///
/// 返回 srun_portal 的解析结果（`error` / `client_ip` / `online_ip` / `suc_msg` / `error_msg`），
/// 流程异常时以字符串错误返回（`error != "ok"` 属于业务失败，走 Ok 分支）。
#[tauri::command]
async fn srun_login(username: String, password: String) -> Result<Value, String> {
    let http = SrunHttp::new().map_err(|e| e.to_string())?;
    srun_core::login::login(&http, &username, &password)
        .await
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![srun_login])
        .run(tauri::generate_context!())
        .expect("Tauri 应用启动失败");
}
