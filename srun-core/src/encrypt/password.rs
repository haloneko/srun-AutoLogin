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
