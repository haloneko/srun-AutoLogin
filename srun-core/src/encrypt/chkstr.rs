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

#[cfg(test)]
mod tests {
    use super::*;

    /// 黄金向量：与 Python `srun.encrypt.get_chkstr` 输出一致
    /// 输入：token='abc123', ChkstrData{user1, enc_pw, ac_id=1, ip=1.2.3.4, n=200, type=1, info='{SRBX1}'+enc_info}
    /// 其中 enc_pw / enc_info 为同一组黄金向量算出的固定值
    #[test]
    fn golden_get_chkstr_user1() {
        let enc_pw = "d63bc18bf60a85be36cc2941a98541e3";
        let enc_info = "+oJls6bvVHqhBCxHkD5rShcXQmpSOuNgLVSbsel/7YRK/KbUCEAmsjeHjm83NFEy7bfvHX0GH/LNDx0NgmMJujnWSIvnxA7CIroeQUR2J79EpeFIxBMELM1oPpZ=";
        let info_field = format!("{{SRBX1}}{enc_info}");
        let data = ChkstrData {
            username: "user1",
            encrypted_password: enc_pw,
            ac_id: "1",
            ip: "1.2.3.4",
            n: 200,
            type_: 1,
            info: &info_field,
        };
        let out = get_chkstr(&data, "abc123");
        assert_eq!(out, "5578170f0e61d5142ff5bf684d89a724c79c1b60");
    }

    /// 同输入应得到同输出（SHA1 是确定性的）
    #[test]
    fn get_chkstr_is_deterministic() {
        let info_field = "{SRBX1}abc".to_string();
        let data = ChkstrData {
            username: "u",
            encrypted_password: "p",
            ac_id: "1",
            ip: "1.2.3.4",
            n: 200,
            type_: 1,
            info: &info_field,
        };
        let a = get_chkstr(&data, "tok");
        let b = get_chkstr(&data, "tok");
        assert_eq!(a, b);
    }

    /// chkstr 输出长度应为 40（SHA1 hex 长度 = 20 字节 * 2）
    #[test]
    fn get_chkstr_output_len_is_40() {
        let info_field = "{SRBX1}x".to_string();
        let data = ChkstrData {
            username: "u",
            encrypted_password: "p",
            ac_id: "1",
            ip: "1.2.3.4",
            n: 200,
            type_: 1,
            info: &info_field,
        };
        let out = get_chkstr(&data, "tok");
        assert_eq!(out.len(), 40);
    }
}
