//! HmacMD5 密码加密
//!
//! 对应 Python `srun/encrypt.py::encrypt_password(password, token)`。
//! `token` 是从服务端 challenge 接口取到的 challenge 字符串，
//! 作为 HMAC 的 key；password 作为 message；输出小写 hex。

use hmac::{Hmac, Mac};
use md_5::Md5;

/// Hmac&lt;Md5&gt; 类型别名
type HmacMd5 = Hmac<Md5>;

/// 对应 Python `encrypt_password(password, token)`：HmacMD5(message=password, key=token) → 小写 hex
pub fn encrypt_password(password: &str, token: &str) -> String {
    let mut mac = HmacMd5::new_from_slice(token.as_bytes()).expect("HMAC 接受任意长度密钥");
    mac.update(password.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// RFC 2202 HMAC-MD5 测试用例 1：key=0x0b×16, data="Hi There"
    /// 对应 Python：`hmac.new(b'\x0b'*16, b'Hi There', hashlib.md5).hexdigest()`
    #[test]
    fn rfc2202_case_1_key_0x0b_16() {
        let token = "\x0b".repeat(16);
        let result = encrypt_password("Hi There", &token);
        assert_eq!(result, "9294727a3638bb1c13f48ef8158bfc9d");
    }

    /// 黄金向量：`encrypt_password('pass1', 'abc123')` 与 Python 一致
    #[test]
    fn golden_pass1_abc123() {
        assert_eq!(encrypt_password("pass1", "abc123"), "d63bc18bf60a85be36cc2941a98541e3");
    }

    /// 同输入应得到同输出（HMAC 是确定性的）
    #[test]
    fn encrypt_password_is_deterministic() {
        let a = encrypt_password("pass", "tok");
        let b = encrypt_password("pass", "tok");
        assert_eq!(a, b);
    }
}
