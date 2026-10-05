//! login 编排模块
//!
//! 对应 Python `srun/user.py`：组合 user_info / challenge / encrypt / portal 完成登录流程。
//! 拆出 [`build_login_request`] 纯函数，供 CLI `--dry-run` 与单元测试复用。

use crate::api::now_millis;
use crate::api::{challenge, user};
use crate::config::{AC_ID, DOUBLE_STACK, ENC_VER, NAME, N, OS, TYPE};
use crate::encrypt::chkstr::{get_chkstr, ChkstrData};
use crate::encrypt::info::{encrypt_info, LoginInfo};
use crate::encrypt::password::encrypt_password;
use crate::error::{Result, SrunError};
use crate::http::SrunHttp;
use serde_json::Value;

/// 从 `get_user_info` 响应中提取本机 IP，对应 Python `get_ip()`。
///
/// 优先 `client_ip`，否则 `online_ip`，否则返回空字符串。
pub fn extract_ip(user_info: &Value) -> String {
    user_info
        .get("client_ip")
        .or_else(|| user_info.get("online_ip"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

/// 已知 `user_info` / `challenge` 后构造 portal 请求参数（纯函数）。
///
/// 供 CLI `--dry-run` 与单元测试复用，避免重复实现加密链路。
/// 字段顺序与 Python `login_params` 完全一致。
pub fn build_login_request(
    username: &str,
    password: &str,
    ip: &str,
    challenge: &str,
) -> Result<Vec<(String, String)>> {
    let info = LoginInfo {
        username,
        password,
        ip,
        acid: AC_ID,
        enc_ver: ENC_VER,
    };
    let encrypted_info_inner = encrypt_info(&info, challenge)?;
    // info 字段值含 {SRBX1} 前缀（前缀是大括号字面量字符串）
    let encrypted_info = format!("{{SRBX1}}{}", encrypted_info_inner);
    let encrypted_password = encrypt_password(password, challenge);
    let chksum = get_chkstr(
        &ChkstrData {
            username,
            encrypted_password: &encrypted_password,
            ac_id: AC_ID,
            ip,
            n: N,
            type_: TYPE,
            info: &encrypted_info,
        },
        challenge,
    );

    let now = now_millis();
    let params = vec![
        ("callback".to_string(), "callback".to_string()),
        ("action".to_string(), "login".to_string()),
        ("username".to_string(), username.to_string()),
        // password 字段值含 {MD5} 前缀
        ("password".to_string(), format!("{{MD5}}{}", encrypted_password)),
        ("ac_id".to_string(), AC_ID.to_string()),
        ("ip".to_string(), ip.to_string()),
        ("chksum".to_string(), chksum),
        ("info".to_string(), encrypted_info),
        ("n".to_string(), N.to_string()),
        ("type".to_string(), TYPE.to_string()),
        ("os".to_string(), OS.to_string()),
        ("name".to_string(), NAME.to_string()),
        ("double_stack".to_string(), DOUBLE_STACK.to_string()),
        ("_".to_string(), now),
    ];
    Ok(params)
}

/// 完整登录流程，对应 Python `login(username, password)`。
///
/// 1. `get_user_info` → 提取 ip
/// 2. `get_challenge` → 取 token
/// 3. [`build_login_request`] 构造加密参数
/// 4. `portal` 发起登录请求
pub async fn login(http: &SrunHttp, username: &str, password: &str) -> Result<Value> {
    let user_info = user::get_user_info(http).await?;
    let ip = extract_ip(&user_info);
    if ip.is_empty() {
        return Err(SrunError::MissingField("client_ip/online_ip"));
    }
    let challenge_val = challenge::get_challenge(http, username, &ip).await?;
    let challenge = challenge_val
        .get("challenge")
        .and_then(|v| v.as_str())
        .ok_or(SrunError::MissingField("challenge"))?;
    let params = build_login_request(username, password, &ip, challenge)?;
    let owned: Vec<(&str, String)> = params
        .iter()
        .map(|(k, v)| (k.as_str(), v.clone()))
        .collect();
    let res = user::portal(http, &owned).await?;
    Ok(res)
}
