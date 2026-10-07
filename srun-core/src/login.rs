//! login 编排模块
//!
//! 对应 Python `srun/user.py`：组合 user_info / challenge / encrypt / portal 完成登录流程。
//! 拆出 [`build_login_request`] 纯函数，供 CLI `--dry-run` 与单元测试复用。

use crate::api::now_millis;
use crate::api::{challenge, user};
use crate::config::{
    AC_ID, BASE_URL, DOUBLE_STACK, ENC_VER, NAME, N, OS, SRUN_BASE64_ALPHA, TYPE, USER_AGENT,
};
use crate::encrypt::chkstr::{get_chkstr, ChkstrData};
use crate::encrypt::info::{encrypt_info_with_alpha, LoginInfo};
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

/// 由加密版本（如 `srun_bx1`）派生 info 前缀（如 `{SRBX1}`），适配不同学校的加密版本。
fn info_prefix(enc_ver: &str) -> String {
    let ver = enc_ver.strip_prefix("srun_").unwrap_or(enc_ver);
    // 去掉加密算法标识字母：如 "bx1" → "x1"，拼成 {SRBX1}
    let num = ver.strip_prefix('b').unwrap_or(ver);
    format!("{{SRB{}}}", num.to_ascii_uppercase())
}

/// 已知 `user_info` / `challenge` 后构造 portal 请求参数（纯函数）。
///
/// 供 CLI `--dry-run` 与单元测试复用，避免重复实现加密链路。
/// 字段顺序与 Python `login_params` 完全一致。使用默认 `ac_id` / `enc_ver`。
pub fn build_login_request(
    username: &str,
    password: &str,
    ip: &str,
    challenge: &str,
) -> Result<Vec<(String, String)>> {
    build_login_request_ex(username, password, ip, challenge, AC_ID, ENC_VER, SRUN_BASE64_ALPHA)
}

/// 带自定义 `ac_id` / `enc_ver` / `base64_alpha` 的请求构造版本
/// （高级设置：适配其他学校的深澜网关）。
pub fn build_login_request_ex(
    username: &str,
    password: &str,
    ip: &str,
    challenge: &str,
    ac_id: &str,
    enc_ver: &str,
    base64_alpha: &str,
) -> Result<Vec<(String, String)>> {
    let info = LoginInfo {
        username,
        password,
        ip,
        acid: ac_id,
        enc_ver,
    };
    let encrypted_info_inner = encrypt_info_with_alpha(&info, challenge, base64_alpha)?;
    // info 字段值含前缀（默认 {SRBX1}），前缀由加密版本派生
    let encrypted_info = format!("{}{}", info_prefix(enc_ver), encrypted_info_inner);
    let encrypted_password = encrypt_password(password, challenge);
    let chksum = get_chkstr(
        &ChkstrData {
            username,
            encrypted_password: &encrypted_password,
            ac_id,
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
        ("ac_id".to_string(), ac_id.to_string()),
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

/// 网关兼容参数对象：一处定义，登录 / 状态 / 注销请求统一消费。
///
/// 全部字段可留空——空白字段经 [`SrunLoginOptions::normalize`] 回退到
/// [`config`](crate::config) 内置默认值，上层（Tauri / CLI）直接透传用户输入即可。
#[derive(Debug, Clone)]
pub struct SrunLoginOptions {
    /// 认证服务器地址（如 `https://wlrz.sdmu.edu.cn/`）
    pub base_url: String,
    /// 认证组 ID（如 `1`）
    pub ac_id: String,
    /// 加密版本（如 `srun_bx1`）
    pub enc_ver: String,
    /// 深澜 Base64 字母表（64 字符）
    pub base64_alpha: String,
    /// User-Agent（如 `Mozilla/5.0 ...`）
    pub user_agent: String,
}

impl SrunLoginOptions {
    /// 全部字段使用内置默认值（默认网关 / 默认加密参数）
    pub fn defaults() -> Self {
        Self {
            base_url: BASE_URL.to_string(),
            ac_id: AC_ID.to_string(),
            enc_ver: ENC_VER.to_string(),
            base64_alpha: SRUN_BASE64_ALPHA.to_string(),
            user_agent: USER_AGENT.to_string(),
        }
    }

    /// 空白字段回退到默认值（空 = 使用默认）
    pub fn normalize(&mut self) {
        if self.base_url.trim().is_empty() {
            self.base_url = BASE_URL.to_string();
        }
        if self.ac_id.trim().is_empty() {
            self.ac_id = AC_ID.to_string();
        }
        if self.enc_ver.trim().is_empty() {
            self.enc_ver = ENC_VER.to_string();
        }
        if self.base64_alpha.trim().is_empty() {
            self.base64_alpha = SRUN_BASE64_ALPHA.to_string();
        }
        if self.user_agent.trim().is_empty() {
            self.user_agent = USER_AGENT.to_string();
        }
    }
}

/// 完整登录流程，对应 Python `login(username, password)`，全部使用默认网关配置。
///
/// 1. `get_user_info` → 提取 ip
/// 2. `get_challenge` → 取 token
/// 3. [`build_login_request`] 构造加密参数
/// 4. `portal` 发起登录请求
pub async fn login(username: &str, password: &str) -> Result<Value> {
    login_ex(username, password, &SrunLoginOptions::defaults()).await
}

/// 带自定义网关参数（[`SrunLoginOptions`]）的完整登录流程
/// （高级设置：适配其他学校的深澜网关）。
///
/// 根据 `options.base_url` / `options.user_agent` 自行构造 HTTP 客户端。
pub async fn login_ex(
    username: &str,
    password: &str,
    options: &SrunLoginOptions,
) -> Result<Value> {
    let http = SrunHttp::with_base_url_and_ua(&options.base_url, &options.user_agent)?;
    let user_info = user::get_user_info(&http).await?;
    let ip = extract_ip(&user_info);
    if ip.is_empty() {
        return Err(SrunError::MissingField("client_ip/online_ip"));
    }
    let challenge_val = challenge::get_challenge(&http, username, &ip).await?;
    let challenge = challenge_val
        .get("challenge")
        .and_then(|v| v.as_str())
        .ok_or(SrunError::MissingField("challenge"))?;
    let params = build_login_request_ex(
        username,
        password,
        &ip,
        challenge,
        &options.ac_id,
        &options.enc_ver,
        &options.base64_alpha,
    )?;
    let owned: Vec<(&str, String)> = params
        .iter()
        .map(|(k, v)| (k.as_str(), v.clone()))
        .collect();
    let res = user::portal(&http, &owned).await?;
    Ok(res)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    /// 以 wiremock 地址为 base_url 构造网关参数（其余字段用默认值）
    fn test_options(uri: &str) -> SrunLoginOptions {
        SrunLoginOptions {
            base_url: uri.to_string(),
            ..SrunLoginOptions::defaults()
        }
    }

    /// `defaults()` 应全部使用内置默认配置，且无空白字段
    #[test]
    fn options_defaults_are_complete() {
        let opts = SrunLoginOptions::defaults();
        assert_eq!(opts.base_url, BASE_URL);
        assert_eq!(opts.ac_id, AC_ID);
        assert_eq!(opts.enc_ver, ENC_VER);
        assert_eq!(opts.base64_alpha, SRUN_BASE64_ALPHA);
        assert_eq!(opts.user_agent, USER_AGENT);
    }

    /// `normalize()` 空白字段回退默认，非空白字段保留
    #[test]
    fn options_normalize_fills_blank_fields() {
        let mut opts = SrunLoginOptions {
            base_url: String::new(),
            ac_id: "  ".to_string(),
            enc_ver: "custom_ver".to_string(),
            base64_alpha: String::new(),
            user_agent: String::new(),
        };
        opts.normalize();
        assert_eq!(opts.base_url, BASE_URL);
        assert_eq!(opts.ac_id, AC_ID);
        assert_eq!(opts.enc_ver, "custom_ver");
        assert_eq!(opts.base64_alpha, SRUN_BASE64_ALPHA);
        assert_eq!(opts.user_agent, USER_AGENT);
    }

    /// `extract_ip` 应优先取 `client_ip`
    #[test]
    fn extract_ip_prefers_client_ip() {
        let v = json!({"client_ip": "192.0.2.1", "online_ip": "192.0.2.2"});
        assert_eq!(extract_ip(&v), "192.0.2.1");
    }

    /// `extract_ip` 缺少 `client_ip` 时取 `online_ip`
    #[test]
    fn extract_ip_falls_back_to_online_ip() {
        let v = json!({"online_ip": "192.0.2.2"});
        assert_eq!(extract_ip(&v), "192.0.2.2");
    }

    /// `extract_ip` 两个字段都缺时返回空字符串
    #[test]
    fn extract_ip_returns_empty_when_missing() {
        let v = json!({"other": "x"});
        assert_eq!(extract_ip(&v), "");
    }

    /// `build_login_request` 应生成所有必需字段（与 Python `login_params` 对齐）
    #[test]
    fn build_login_request_includes_all_required_fields() {
        let params = build_login_request("user1", "pass1", "192.0.2.1", "abc123").unwrap();
        let keys: Vec<&str> = params.iter().map(|(k, _)| k.as_str()).collect();
        for required in [
            "callback", "action", "username", "password", "ac_id", "ip", "chksum", "info",
            "n", "type", "os", "name", "double_stack", "_",
        ] {
            assert!(keys.contains(&required), "missing key: {required}");
        }
    }

    /// `password` 字段值应以 `{MD5}` 前缀开头
    #[test]
    fn build_login_request_password_has_md5_prefix() {
        let params = build_login_request("user1", "pass1", "192.0.2.1", "abc123").unwrap();
        let pw = params.iter().find(|(k, _)| k == "password").map(|(_, v)| v.clone()).unwrap();
        assert!(pw.starts_with("{MD5}"), "got: {pw}");
        // 后半段应为 32 位 hex（HmacMD5 → 16 字节 → 32 hex 字符）
        assert_eq!(pw.len(), "{MD5}".len() + 32);
    }

    /// `info` 字段值应以 `{SRBX1}` 前缀开头
    #[test]
    fn build_login_request_info_has_srbx1_prefix() {
        let params = build_login_request("user1", "pass1", "192.0.2.1", "abc123").unwrap();
        let info = params.iter().find(|(k, _)| k == "info").map(|(_, v)| v.clone()).unwrap();
        assert!(info.starts_with("{SRBX1}"), "got: {info}");
    }

    /// `chksum` 字段值长度应为 40（SHA1 hex）
    #[test]
    fn build_login_request_chksum_len_is_40() {
        let params = build_login_request("user1", "pass1", "192.0.2.1", "abc123").unwrap();
        let chksum = params.iter().find(|(k, _)| k == "chksum").map(|(_, v)| v.clone()).unwrap();
        assert_eq!(chksum.len(), 40);
    }

    /// 黄金向量：用固定 ip=1.2.3.4 / challenge=abc123 构造请求，
    /// chksum 应与 Python `srun.user.login` 在同输入下生成的值一致
    #[test]
    fn golden_build_login_request_chksum() {
        // 由 Python 算得：encrypt_password('pass1', 'abc123') = d63bc18bf60a85be36cc2941a98541e3
        // encrypt_info(LoginInfo{user1, pass1, 1.2.3.4, 1, srun_bx1}, 'abc123') = +oJls...
        // chkstr 拼接顺序：token+username + token+enc_pw + token+ac_id + token+ip + token+n + token+type + token+i
        // chksum = sha1(...) = 5578170f0e61d5142ff5bf684d89a724c79c1b60
        let params = build_login_request("user1", "pass1", "1.2.3.4", "abc123").unwrap();
        let chksum = params.iter().find(|(k, _)| k == "chksum").map(|(_, v)| v.clone()).unwrap();
        assert_eq!(chksum, "5578170f0e61d5142ff5bf684d89a724c79c1b60");
    }

    /// `_` 字段值应为纯数字（毫秒时间戳）
    #[test]
    fn build_login_request_underscore_is_numeric() {
        let params = build_login_request("u", "p", "1.2.3.4", "tok").unwrap();
        let now = params.iter().find(|(k, _)| k == "_").map(|(_, v)| v.clone()).unwrap();
        assert!(now.chars().all(|c| c.is_ascii_digit()), "got: {now}");
    }

    /// 完整 `login` 流程：3 个端点按顺序 stub，断言最终解析结果
    #[tokio::test]
    async fn login_full_flow_with_wiremock() {
        let server = MockServer::start().await;
        let base = server.uri();
        // 1. rad_user_info
        Mock::given(method("GET"))
            .and(path("/cgi-bin/rad_user_info"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(r#"callback({"client_ip":"192.0.2.1"})"#),
            )
            .mount(&server)
            .await;
        // 2. get_challenge
        Mock::given(method("GET"))
            .and(path("/cgi-bin/get_challenge"))
            .and(query_param("username", "user1"))
            .and(query_param("ip", "192.0.2.1"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(r#"callback({"challenge":"abc123","error":"ok"})"#),
            )
            .mount(&server)
            .await;
        // 3. srun_portal
        Mock::given(method("GET"))
            .and(path("/cgi-bin/srun_portal"))
            .and(query_param("action", "login"))
            .and(query_param("username", "user1"))
            .and(query_param("ac_id", "1"))
            .and(query_param("n", "200"))
            .and(query_param("type", "1"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(r#"callback({"error":"ok","online_ip":"192.0.2.1"})"#),
            )
            .mount(&server)
            .await;

        let options = test_options(&base);
        let res = login_ex("user1", "pass1", &options).await.unwrap();
        assert_eq!(res["error"], "ok");
        assert_eq!(res["online_ip"], "192.0.2.1");
    }

    /// `user_info` 缺少 ip 字段时应返回 MissingField 错误
    #[tokio::test]
    async fn login_returns_missing_field_when_no_ip() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/cgi-bin/rad_user_info"))
            .respond_with(ResponseTemplate::new(200).set_body_string(r#"callback({"other":"x"})"#))
            .mount(&server)
            .await;
        let options = test_options(&server.uri());
        let err = login_ex("u", "p", &options).await.unwrap_err();
        assert!(matches!(err, SrunError::MissingField(_)), "got: {err:?}");
    }

    /// challenge 响应缺少 `challenge` 字段时应返回 MissingField 错误
    #[tokio::test]
    async fn login_returns_missing_field_when_no_challenge() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/cgi-bin/rad_user_info"))
            .respond_with(
                ResponseTemplate::new(200).set_body_string(r#"callback({"client_ip":"192.0.2.1"})"#),
            )
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/cgi-bin/get_challenge"))
            .respond_with(ResponseTemplate::new(200).set_body_string(r#"callback({"error":"ok"})"#))
            .mount(&server)
            .await;
        let options = test_options(&server.uri());
        let err = login_ex("u", "p", &options).await.unwrap_err();
        assert!(matches!(err, SrunError::MissingField(_)), "got: {err:?}");
    }
}
