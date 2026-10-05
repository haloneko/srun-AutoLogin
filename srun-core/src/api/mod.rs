//! API 模块入口
//!
//! 对应 Python `api/` 子包。封装深澜服务端的三个端点：
//! - `user::get_user_info` —— `/cgi-bin/rad_user_info`
//! - `user::portal` —— `/cgi-bin/srun_portal`（登录 / 登出）
//! - `challenge::get_challenge` —— `/cgi-bin/get_challenge`

pub mod challenge;
pub mod user;

/// 当前毫秒时间戳字符串，对应 Python `int(time.time() * 1000)`
pub fn now_millis() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before UNIX_EPOCH")
        .as_millis()
        .to_string()
}
