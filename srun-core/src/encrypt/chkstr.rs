//! chkstr - SHA1 登录校验串
//!
//! 对应 Python `srun/encrypt.py::get_chkstr(data, token)`。

use sha1::{Digest, Sha1};

/// chkstr 所需数据（对应 Python `get_chkstr` 的 data 字典）
///
/// **关键陷阱**：`ac_id` 带下划线（与 [`crate::encrypt::info::LoginInfo`] 的 `acid` 不同）。
/// `info` 字段是含 `{SRBX1}` 前缀的完整字符串（即 `encrypt_info` 输出加前缀后的值）。
#[derive(Debug, Clone, Copy)]
pub struct ChkstrData<'a> {
    pub username: &'a str,
    pub encrypted_password: &'a str,
    pub ac_id: &'a str,
    pub ip: &'a str,
    pub n: u32,
    pub type_: u32,
    pub info: &'a str,
}

/// 对应 Python `get_chkstr(data, token)`：拼接 7 段后 SHA1 → 小写 hex
///
/// 拼接顺序（与 Python 完全一致）：
/// `token+username + token+encryptedPassword + token+ac_id + token+ip + token+n + token+type + token+i`
pub fn get_chkstr(data: &ChkstrData, token: &str) -> String {
    let mut chkstr = String::new();
    chkstr.push_str(token);
    chkstr.push_str(data.username);
    chkstr.push_str(token);
    chkstr.push_str(data.encrypted_password);
    chkstr.push_str(token);
    chkstr.push_str(data.ac_id);
    chkstr.push_str(token);
    chkstr.push_str(data.ip);
    chkstr.push_str(token);
    chkstr.push_str(&data.n.to_string());
    chkstr.push_str(token);
    chkstr.push_str(&data.type_.to_string());
    chkstr.push_str(token);
    chkstr.push_str(data.info);

    let mut hasher = Sha1::new();
    hasher.update(chkstr.as_bytes());
    hex::encode(hasher.finalize())
}
