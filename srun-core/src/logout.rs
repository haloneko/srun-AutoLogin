//! logout 模块 - 注销（下线）
//!
//! 复用 `/cgi-bin/rad_user_dm` 端点（对应门户 `Portal.js` 的 `sendLogout`）：
//! 1. 查 `rad_user_info` 取账号（uid/user_name/username）与 ip（user_ip/online_ip/client_ip）
//! 2. 计算 `sign = sha1(time + username + ip + unbind + time)`，`time` 为当前 Unix 秒
//! 3. GET `/cgi-bin/rad_user_dm` 发起注销请求
//! 注销不需要密码 / challenge / 加密，仅需账号、ip、时间戳。

use crate::api::user;
use crate::api::{now_millis, now_secs};
use crate::error::{Result, SrunError};
use crate::http::SrunHttp;
use serde_json::Value;
use sha1::{Digest, Sha1};

/// 生成 `rad_user_dm` 的 `sign`，对应 Python `build_logout_sign` 与门户 `sendLogout`。
///
/// `sign = sha1(time + username + ip + unbind + time)`，小写 hex。
pub fn build_logout_sign(username: &str, ip: &str, unbind: u32, ts: u64) -> String {
    let mut hasher = Sha1::new();
    hasher.update(ts.to_string().as_bytes());
    hasher.update(username.as_bytes());
    hasher.update(ip.as_bytes());
    hasher.update(unbind.to_string().as_bytes());
    hasher.update(ts.to_string().as_bytes());
    format!("{:x}", hasher.finalize())
}

/// 发起注销请求，对应 Python `do_logout`。
///
/// 1. `get_user_info` → 取账号与 ip（均带网关字段名兜底）
/// 2. 构造 `time`（当前秒）与 `sign`
/// 3. `rad_user_dm` 发起注销，返回网关原始解析结果
pub async fn logout(http: &SrunHttp) -> Result<Value> {
    let user_info = user::get_user_info(http).await?;
    let username = crate::status::extract_username(&user_info);
    if username.is_empty() {
        return Err(SrunError::MissingField("uid/user_name/username"));
    }
    let ip = crate::status::extract_ip(&user_info);
    if ip.is_empty() {
        return Err(SrunError::MissingField("user_ip/online_ip/client_ip"));
    }

    let ts = now_secs();
    let unbind = 1u32;
    let sign = build_logout_sign(&username, &ip, unbind, ts);

    let params: Vec<(&str, String)> = vec![
        ("callback", "callback".to_string()),
        ("ip", ip),
        ("username", username),
        ("time", ts.to_string()),
        ("unbind", unbind.to_string()),
        ("sign", sign),
        ("_", now_millis()),
    ];
    user::dm(http, &params).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn make_http(uri: &str) -> SrunHttp {
        SrunHttp::with_base_url(uri).expect("构造测试 SrunHttp 失败")
    }

    /// 黄金向量：与 Python `build_logout_sign` 完全一致
    /// ts=1700000000, username=20240001, ip=192.0.2.1, unbind=1
    /// → 4b284753ec67c12ab6eada577fdf5a75f51aac09
    #[test]
    fn golden_build_logout_sign() {
        let sign = build_logout_sign("20240001", "192.0.2.1", 1, 1700000000);
        assert_eq!(sign, "4b284753ec67c12ab6eada577fdf5a75f51aac09");
    }

    /// 同输入应得到同输出（SHA1 确定性），输出为 40 位小写 hex
    #[test]
    fn build_logout_sign_is_deterministic() {
        let a = build_logout_sign("u1", "192.0.2.1", 1, 1700000000);
        let b = build_logout_sign("u1", "192.0.2.1", 1, 1700000000);
        assert_eq!(a, b);
        assert_eq!(a.len(), 40);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }

    /// 注销流程：rad_user_info 取账号/ip → rad_user_dm 发起注销
    #[tokio::test]
    async fn logout_full_flow_with_wiremock() {
        let server = MockServer::start().await;
        let base = server.uri();
        // 1. rad_user_info
        Mock::given(method("GET"))
            .and(path("/cgi-bin/rad_user_info"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(r#"callback({"uid":"20240001","user_ip":"192.0.2.2"})"#),
            )
            .mount(&server)
            .await;
        // 2. rad_user_dm（sign 的正确性由 golden_build_logout_sign 覆盖，此处只校验固定参数）
        Mock::given(method("GET"))
            .and(path("/cgi-bin/rad_user_dm"))
            .and(query_param("username", "20240001"))
            .and(query_param("ip", "192.0.2.2"))
            .and(query_param("unbind", "1"))
            .respond_with(
                ResponseTemplate::new(200).set_body_string(r#"callback({"error":"ok"})"#),
            )
            .mount(&server)
            .await;

        let http = make_http(&base);
        let res = logout(&http).await.unwrap();
        assert_eq!(res["error"], "ok");
    }

    /// 网关返回 `user_name` / `online_ip`（而非 uid / user_ip）时，注销也应成功
    #[tokio::test]
    async fn logout_with_alternate_field_names() {
        let server = MockServer::start().await;
        let base = server.uri();
        Mock::given(method("GET"))
            .and(path("/cgi-bin/rad_user_info"))
            .respond_with(
                ResponseTemplate::new(200).set_body_string(
                    r#"callback({"user_name":"20240001","online_ip":"192.0.2.3"})"#,
                ),
            )
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/cgi-bin/rad_user_dm"))
            .and(query_param("username", "20240001"))
            .and(query_param("ip", "192.0.2.3"))
            .respond_with(
                ResponseTemplate::new(200).set_body_string(r#"callback({"error":"ok"})"#),
            )
            .mount(&server)
            .await;

        let http = make_http(&base);
        let res = logout(&http).await.unwrap();
        assert_eq!(res["error"], "ok");
    }

    /// user_info 缺少账号字段时应返回 MissingField 错误（未登录时注销失败）
    #[tokio::test]
    async fn logout_returns_missing_field_when_no_uid() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/cgi-bin/rad_user_info"))
            .respond_with(ResponseTemplate::new(200).set_body_string(r#"callback({"other":"x"})"#))
            .mount(&server)
            .await;
        let http = make_http(&server.uri());
        let err = logout(&http).await.unwrap_err();
        assert!(matches!(err, SrunError::MissingField(_)), "got: {err:?}");
    }

    /// user_info 缺少 IP 字段时应返回 MissingField 错误
    #[tokio::test]
    async fn logout_returns_missing_field_when_no_ip() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/cgi-bin/rad_user_info"))
            .respond_with(
                ResponseTemplate::new(200).set_body_string(r#"callback({"user_name":"u1"})"#),
            )
            .mount(&server)
            .await;
        let http = make_http(&server.uri());
        let err = logout(&http).await.unwrap_err();
        assert!(matches!(err, SrunError::MissingField(_)), "got: {err:?}");
    }
}
