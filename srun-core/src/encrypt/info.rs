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

#[cfg(test)]
mod tests {
    use super::*;

    /// LoginInfo 序列化字段顺序严格断言：
    /// 必须是 `username, password, ip, acid, enc_ver`（紧凑无空格、不转义非 ASCII）
    #[test]
    fn login_info_serialization_field_order() {
        let info = LoginInfo {
            username: "user1",
            password: "pass1",
            ip: "1.2.3.4",
            acid: "1",
            enc_ver: "srun_bx1",
        };
        let json = serde_json::to_string(&info).unwrap();
        assert_eq!(
            json,
            r#"{"username":"user1","password":"pass1","ip":"1.2.3.4","acid":"1","enc_ver":"srun_bx1"}"#
        );
    }

    /// LoginInfo 中文字段不转义为 `\uXXXX`（与 Python `ensure_ascii=False` 一致）
    #[test]
    fn login_info_keeps_chinese_unescaped() {
        let info = LoginInfo {
            username: "张三",
            password: "p",
            ip: "1.2.3.4",
            acid: "1",
            enc_ver: "srun_bx1",
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("张三"), "got: {json}");
        assert!(!json.contains("\\u"), "got: {json}");
    }

    /// 黄金向量：`encrypt_info(LoginInfo{user1, pass1, 1.2.3.4, 1, srun_bx1}, 'abc123')`
    /// 与 Python `srun.encrypt.encrypt_info` 输出一致
    #[test]
    fn golden_encrypt_info_user1() {
        let info = LoginInfo {
            username: "user1",
            password: "pass1",
            ip: "1.2.3.4",
            acid: "1",
            enc_ver: "srun_bx1",
        };
        let out = encrypt_info(&info, "abc123").unwrap();
        assert_eq!(
            out,
            "+oJls6bvVHqhBCxHkD5rShcXQmpSOuNgLVSbsel/7YRK/KbUCEAmsjeHjm83NFEy7bfvHX0GH/LNDx0NgmMJujnWSIvnxA7CIroeQUR2J79EpeFIxBMELM1oPpZ="
        );
    }

    /// 同输入应得到同输出（确定性）
    #[test]
    fn encrypt_info_is_deterministic() {
        let info = LoginInfo {
            username: "u",
            password: "p",
            ip: "1.2.3.4",
            acid: "1",
            enc_ver: "srun_bx1",
        };
        let a = encrypt_info(&info, "tok").unwrap();
        let b = encrypt_info(&info, "tok").unwrap();
        assert_eq!(a, b);
    }
}
