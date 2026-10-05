//! status 模块 - 在线状态查询
//!
//! 复用 `/cgi-bin/rad_user_info` 端点（登录流程第一步也在用），
//! 提取当前在线信息：账号（uid）、IP、上线时长（online_time）、已用流量（sum_bytes）。

use crate::api::user::get_user_info;
use crate::error::Result;
use crate::http::SrunHttp;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 在线状态信息，序列化后供 GUI / CLI 层直接展示
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct OnlineStatus {
    /// 是否在线（网关 `error=ok` 或存在账号）
    pub online: bool,
    /// 用户账号（`uid`，缺失时回退 `user_name` / `username`）
    pub username: String,
    /// 当前 IP（优先 `user_ip`，其次 `online_ip` / `client_ip`）
    pub ip: String,
    /// 已上线时长（秒，`online_time`，缺失时回退 `online_sec` / `sum_seconds`）
    pub online_seconds: u64,
    /// 已用流量（字节，`sum_bytes`）
    pub total_bytes: u64,
    /// 当前在线设备数（`online_device_total`，部分网关无此字段时为 0）
    pub online_devices: u64,
}

/// 容错读取 u64：数字直取；字符串数字则解析；否则 0。
/// 网关各字段类型不统一（有的数字、有的字符串），统一按此处理。
fn value_as_u64(v: Option<&Value>) -> u64 {
    let Some(v) = v else { return 0 };
    v.as_u64()
        .or_else(|| v.as_str().and_then(|s| s.trim().parse().ok()))
        .or_else(|| v.as_f64().map(|f| f as u64))
        .unwrap_or(0)
}

/// 容错读取字符串：非字符串字段返回空串。
fn value_as_str(v: Option<&Value>) -> String {
    v.and_then(|v| v.as_str()).unwrap_or("").to_string()
}

/// 从 `rad_user_info` 响应中提取用户账号，兼容不同网关字段名
/// （`uid` → `user_name` → `username`），登录 / 注销流程共用。
pub fn extract_username(info: &Value) -> String {
    value_as_str(
        info.get("uid")
            .or_else(|| info.get("user_name"))
            .or_else(|| info.get("username")),
    )
}

/// 从 `rad_user_info` 响应中提取在线 IP，兼容不同网关字段名
/// （`user_ip` → `online_ip` → `client_ip`），状态查询 / 注销流程共用。
pub fn extract_ip(info: &Value) -> String {
    value_as_str(
        info.get("user_ip")
            .or_else(|| info.get("online_ip"))
            .or_else(|| info.get("client_ip")),
    )
}

/// 查询当前在线状态（对应网关 `/cgi-bin/rad_user_info`）。
///
/// 在线时响应 `error=ok` 且带 `uid`；未登录时 `error` 非 ok 且无 `uid`，
/// 此时返回 `online=false`，其余字段为空 / 0。
pub async fn get_online_status(http: &SrunHttp) -> Result<OnlineStatus> {
    let info = get_user_info(http).await?;
    let error = value_as_str(info.get("error"));
    let username = extract_username(&info);
    let online = error == "ok" || !username.is_empty();
    Ok(OnlineStatus {
        online,
        username,
        ip: extract_ip(&info),
        online_seconds: value_as_u64(
            info.get("online_time")
                .or_else(|| info.get("online_sec"))
                .or_else(|| info.get("sum_seconds")),
        ),
        total_bytes: value_as_u64(info.get("sum_bytes")),
        online_devices: value_as_u64(info.get("online_device_total")),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn make_http(uri: &str) -> SrunHttp {
        SrunHttp::with_base_url(uri).expect("构造测试 SrunHttp 失败")
    }

    /// 在线时：`error=ok` 且带 uid/ip/时长/流量，应全部解析出来
    #[tokio::test]
    async fn parse_online_status() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/cgi-bin/rad_user_info"))
            .respond_with(
                ResponseTemplate::new(200).set_body_string(
                    r#"callback({"error":"ok","uid":"20240001","user_ip":"192.0.2.10","online_time":7200,"sum_bytes":2097152})"#,
                ),
            )
            .mount(&server)
            .await;
        let http = make_http(&server.uri());
        let s = get_online_status(&http).await.unwrap();
        assert!(s.online);
        assert_eq!(s.username, "20240001");
        assert_eq!(s.ip, "192.0.2.10");
        assert_eq!(s.online_seconds, 7200);
        assert_eq!(s.total_bytes, 2097152);
    }

    /// 部分网关字段名不同：账户用 `user_name`、时长用 `sum_seconds`，应能兜底解析
    #[tokio::test]
    async fn parse_alternate_field_names() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/cgi-bin/rad_user_info"))
            .respond_with(
                ResponseTemplate::new(200).set_body_string(
                    r#"callback({"error":"ok","user_name":"20240001","online_ip":"192.0.2.11","sum_seconds":3600,"sum_bytes":1048576,"online_device_total":"3"})"#,
                ),
            )
            .mount(&server)
            .await;
        let http = make_http(&server.uri());
        let s = get_online_status(&http).await.unwrap();
        assert!(s.online);
        assert_eq!(s.username, "20240001");
        assert_eq!(s.online_seconds, 3600);
        assert_eq!(s.total_bytes, 1048576);
        assert_eq!(s.online_devices, 3);
    }

    /// 字符串数字字段也应正确解析（部分网关以字符串返回时长/流量）
    #[tokio::test]
    async fn parse_numeric_fields_as_string() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/cgi-bin/rad_user_info"))
            .respond_with(
                ResponseTemplate::new(200).set_body_string(
                    r#"callback({"error":"ok","uid":"u1","user_ip":"192.0.2.12","online_time":"120","sum_bytes":"2048"})"#,
                ),
            )
            .mount(&server)
            .await;
        let http = make_http(&server.uri());
        let s = get_online_status(&http).await.unwrap();
        assert!(s.online);
        assert_eq!(s.online_seconds, 120);
        assert_eq!(s.total_bytes, 2048);
    }

    /// 未登录：`error` 非 ok 且无 uid，应返回 `online=false`
    #[tokio::test]
    async fn parse_offline_status() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/cgi-bin/rad_user_info"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(r#"callback({"error":"not_online"})"#),
            )
            .mount(&server)
            .await;
        let http = make_http(&server.uri());
        let s = get_online_status(&http).await.unwrap();
        assert!(!s.online);
        assert!(s.username.is_empty());
        assert!(s.ip.is_empty());
        assert_eq!(s.online_seconds, 0);
        assert_eq!(s.total_bytes, 0);
    }

    /// IP 缺 `user_ip` 时应回退到 `online_ip` / `client_ip`
    #[tokio::test]
    async fn ip_falls_back_to_online_ip() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/cgi-bin/rad_user_info"))
            .respond_with(
                ResponseTemplate::new(200).set_body_string(
                    r#"callback({"error":"ok","uid":"u1","online_ip":"192.0.2.13"})"#,
                ),
            )
            .mount(&server)
            .await;
        let http = make_http(&server.uri());
        let s = get_online_status(&http).await.unwrap();
        assert_eq!(s.ip, "192.0.2.13");
    }
}
