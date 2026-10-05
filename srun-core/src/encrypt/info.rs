//! encrypt_info - 登录信息加密
//!
//! 对应 Python `srun/encrypt.py::encrypt_info(info, token)`：
//! LoginInfo 序列化为紧凑 JSON → UTF-8 → x_encode → base64_encode。

use crate::encrypt::srun_lib::{base64_encode, x_encode};
use crate::error::Result;
use serde::Serialize;

/// 登录信息（对应 Python `_stringify_login_info` 的有序字典）
///
/// **字段声明顺序即序列化顺序**：`username, password, ip, acid, enc_ver`。
/// **关键陷阱**：这里是 `acid` 不带下划线（与 [`crate::encrypt::chkstr::ChkstrData`] 的 `ac_id` 不同）。
/// `serde_json::to_string` 默认按 struct 字段声明顺序输出，且不转义非 ASCII，
/// 与 Python `json.dumps(ensure_ascii=False, separators=(',', ':'))` 行为一致。
#[derive(Serialize)]
pub struct LoginInfo<'a> {
    pub username: &'a str,
    pub password: &'a str,
    pub ip: &'a str,
    pub acid: &'a str,
    pub enc_ver: &'a str,
}

/// 对应 Python `encrypt_info(info, token)`：序列化为 JSON → UTF-8 → x_encode → base64_encode
pub fn encrypt_info(info: &LoginInfo, token: &str) -> Result<String> {
    let json = serde_json::to_string(info)?;
    let data = json.as_bytes();
    let key = token.as_bytes();
    let x_encoded = x_encode(data, key);
    Ok(base64_encode(&x_encoded))
}
