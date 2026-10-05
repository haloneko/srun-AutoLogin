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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn make_http(uri: &str) -> SrunHttp {
        SrunHttp::with_base_url(uri).expect("构造测试 SrunHttp 失败")
    }

    /// `extract_ip` 应优先取 `client_ip`
    #[test]
    fn extract_ip_prefers_client_ip() {
        let v = json!({"client_ip": "10.0.0.1", "online_ip": "10.0.0.2"});
        assert_eq!(extract_ip(&v), "10.0.0.1");
    }

    /// `extract_ip` 缺少 `client_ip` 时取 `online_ip`
    #[test]
    fn extract_ip_falls_back_to_online_ip() {
        let v = json!({"online_ip": "10.0.0.2"});
        assert_eq!(extract_ip(&v), "10.0.0.2");
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
        let params = build_login_request("user1", "pass1", "10.0.0.1", "abc123").unwrap();
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
        let params = build_login_request("user1", "pass1", "10.0.0.1", "abc123").unwrap();
        let pw = params.iter().find(|(k, _)| k == "password").map(|(_, v)| v.clone()).unwrap();
        assert!(pw.starts_with("{MD5}"), "got: {pw}");
        // 后半段应为 32 位 hex（HmacMD5 → 16 字节 → 32 hex 字符）
        assert_eq!(pw.len(), "{MD5}".len() + 32);
    }

    /// `info` 字段值应以 `{SRBX1}` 前缀开头
    #[test]
    fn build_login_request_info_has_srbx1_prefix() {
        let params = build_login_request("user1", "pass1", "10.0.0.1", "abc123").unwrap();
        let info = params.iter().find(|(k, _)| k == "info").map(|(_, v)| v.clone()).unwrap();
        assert!(info.starts_with("{SRBX1}"), "got: {info}");
    }

    /// `chksum` 字段值长度应为 40（SHA1 hex）
    #[test]
    fn build_login_request_chksum_len_is_40() {
        let params = build_login_request("user1", "pass1", "10.0.0.1", "abc123").unwrap();
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
                    .set_body_string(r#"callback({"client_ip":"10.0.0.1"})"#),
            )
            .mount(&server)
            .await;
        // 2. get_challenge
        Mock::given(method("GET"))
            .and(path("/cgi-bin/get_challenge"))
            .and(query_param("username", "user1"))
            .and(query_param("ip", "10.0.0.1"))
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
                    .set_body_string(r#"callback({"error":"ok","online_ip":"10.0.0.1"})"#),
            )
            .mount(&server)
            .await;

        let http = make_http(&base);
        let res = login(&http, "user1", "pass1").await.unwrap();
        assert_eq!(res["error"], "ok");
        assert_eq!(res["online_ip"], "10.0.0.1");
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
        let http = make_http(&server.uri());
        let err = login(&http, "u", "p").await.unwrap_err();
        assert!(matches!(err, SrunError::MissingField(_)), "got: {err:?}");
    }

    /// challenge 响应缺少 `challenge` 字段时应返回 MissingField 错误
    #[tokio::test]
    async fn login_returns_missing_field_when_no_challenge() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/cgi-bin/rad_user_info"))
            .respond_with(
                ResponseTemplate::new(200).set_body_string(r#"callback({"client_ip":"10.0.0.1"})"#),
            )
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/cgi-bin/get_challenge"))
            .respond_with(ResponseTemplate::new(200).set_body_string(r#"callback({"error":"ok"})"#))
            .mount(&server)
            .await;
        let http = make_http(&server.uri());
        let err = login(&http, "u", "p").await.unwrap_err();
        assert!(matches!(err, SrunError::MissingField(_)), "got: {err:?}");
    }
}
