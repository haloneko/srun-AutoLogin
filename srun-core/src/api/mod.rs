//! API 模块入口
//!
//! 对应 Python `api/` 子包。封装深澜服务端的三个端点：
//! - `user::get_user_info` —— `/cgi-bin/rad_user_info`
//! - `user::portal` —— `/cgi-bin/srun_portal`（登录 / 登出）
//! - `challenge::get_challenge` —— `/cgi-bin/get_challenge`

pub mod challenge;
pub mod user;

/// 当前毫秒时间戳字符串，对应 Python `int(time.time() * 1000)`
pub fn now_millis() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before UNIX_EPOCH")
        .as_millis()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::http::SrunHttp;
    use serde_json::json;
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn make_http(uri: &str) -> SrunHttp {
        SrunHttp::with_base_url(uri).expect("构造测试 SrunHttp 失败")
    }

    /// `now_millis()` 应为纯数字字符串
    #[test]
    fn now_millis_is_numeric() {
        let s = now_millis();
        assert!(s.chars().all(|c| c.is_ascii_digit()), "got: {s}");
        // 13 位毫秒时间戳（当前 epoch 在 1.7e12 量级）
        assert!(s.len() >= 12 && s.len() <= 14, "got: {s}");
    }

    /// `get_user_info` 应请求 `/cgi-bin/rad_user_info`，并解析 JSONP 响应
    #[tokio::test]
    async fn get_user_info_requests_correct_path_and_parses() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/cgi-bin/rad_user_info"))
            .and(query_param("callback", "callback"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(r#"callback({"client_ip":"10.0.0.1","online_ip":"10.0.0.2"})"#),
            )
            .mount(&server)
            .await;
        let http = make_http(&server.uri());
        let v = crate::api::user::get_user_info(&http).await.unwrap();
        assert_eq!(v["client_ip"], "10.0.0.1");
        assert_eq!(v["online_ip"], "10.0.0.2");
    }

    /// `get_challenge` 应传递 username/ip，并解析 challenge 字段
    #[tokio::test]
    async fn get_challenge_sends_username_and_ip() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/cgi-bin/get_challenge"))
            .and(query_param("username", "user1"))
            .and(query_param("ip", "10.0.0.1"))
            .and(query_param("callback", "callback"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(r#"callback({"challenge":"abc123","error":"ok"})"#),
            )
            .mount(&server)
            .await;
        let http = make_http(&server.uri());
        let v = crate::api::challenge::get_challenge(&http, "user1", "10.0.0.1")
            .await
            .unwrap();
        assert_eq!(v["challenge"], "abc123");
        assert_eq!(v["error"], "ok");
    }

    /// `portal` 应把传入参数作为 query 透传到 `/cgi-bin/srun_portal`
    #[tokio::test]
    async fn portal_forwards_params_to_srun_portal() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/cgi-bin/srun_portal"))
            .and(query_param("action", "login"))
            .and(query_param("username", "user1"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(r#"callback({"error":"ok","online_ip":"10.0.0.1"})"#),
            )
            .mount(&server)
            .await;
        let http = make_http(&server.uri());
        let params = vec![
            ("action", "login".to_string()),
            ("username", "user1".to_string()),
        ];
        let v = crate::api::user::portal(&http, &params).await.unwrap();
        assert_eq!(v["error"], "ok");
        assert_eq!(v["online_ip"], "10.0.0.1");
    }

    /// 服务端返回非 JSONP 格式时应抛 Jsonp 错误
    #[tokio::test]
    async fn parse_error_when_response_not_jsonp() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/cgi-bin/rad_user_info"))
            .respond_with(ResponseTemplate::new(200).set_body_string("not a jsonp"))
            .mount(&server)
            .await;
        let http = make_http(&server.uri());
        let err = crate::api::user::get_user_info(&http).await.unwrap_err();
        assert!(matches!(err, crate::error::SrunError::Jsonp(_)), "got: {err:?}");
    }

    /// 对称性：固定响应可稳定反序列化
    #[tokio::test]
    async fn portal_response_stable_parse() {
        let server = MockServer::start().await;
        let body = r#"callback({"error":"ok","client_ip":"1.2.3.4"})"#;
        Mock::given(method("GET"))
            .and(path("/cgi-bin/srun_portal"))
            .respond_with(ResponseTemplate::new(200).set_body_string(body))
            .mount(&server)
            .await;
        let http = make_http(&server.uri());
        let v1 = crate::api::user::portal(&http, &[]).await.unwrap();
        let v2 = crate::api::user::portal(&http, &[]).await.unwrap();
        assert_eq!(v1, v2);
        assert_eq!(v1, json!({"error": "ok", "client_ip": "1.2.3.4"}));
    }
}
