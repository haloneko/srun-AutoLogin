//! HTTP 客户端封装
//!
//! 对应 Python `utils/request.py`：统一 User-Agent、cookie 存储、JSONP 文本获取。

use crate::config::{BASE_URL, USER_AGENT};
use crate::error::{Result, SrunError};
use reqwest::Url;

/// 深澜 HTTP 客户端，封装 reqwest::Client 与 base_url。
///
/// 所有深澜请求都是 `GET base_url+path?params`，返回 JSONP 文本。
#[derive(Clone)]
pub struct SrunHttp {
    pub client: reqwest::Client,
    pub base_url: Url,
}

impl SrunHttp {
    /// 用 [`BASE_URL`] 构造默认客户端（生产环境）。
    pub fn new() -> Result<Self> {
        Self::with_base_url(BASE_URL)
    }

    /// 指定 base_url 构造客户端（测试用注入 wiremock URL）。
    ///
    /// 启用 cookie 存储与统一 User-Agent（默认 [`USER_AGENT`]）。
    pub fn with_base_url(base_url: &str) -> Result<Self> {
        Self::with_base_url_and_ua(base_url, USER_AGENT)
    }

    /// 指定 base_url 与 User-Agent 构造客户端（自定义 UA：适配网关反爬 / 模拟特定浏览器）。
    ///
    /// `user_agent` 为空或全空白时回退到默认 [`USER_AGENT`]；启用 cookie 存储。
    pub fn with_base_url_and_ua(base_url: &str, user_agent: &str) -> Result<Self> {
        let base_url =
            Url::parse(base_url).map_err(|e| SrunError::Http(format!("URL 解析失败: {e}")))?;
        let ua = if user_agent.trim().is_empty() {
            USER_AGENT
        } else {
            user_agent
        };
        let client = reqwest::Client::builder()
            .cookie_store(true)
            .user_agent(ua)
            .build()
            .map_err(|e| SrunError::Http(e.to_string()))?;
        Ok(Self { client, base_url })
    }

    /// 发送 GET 请求并返回响应文本（JSONP 格式）。
    ///
    /// `path` 会拼接到 `base_url`（如 `/cgi-bin/get_challenge`）；
    /// `params` 作为 URL query 传入。
    pub async fn get_jsonp(&self, path: &str, params: &[(&str, &str)]) -> Result<String> {
        let url = self
            .base_url
            .join(path)
            .map_err(|e| SrunError::Http(format!("URL join 失败: {e}")))?;
        let text = self
            .client
            .get(url)
            .query(params)
            .send()
            .await
            .map_err(|e| SrunError::Http(e.to_string()))?
            .text()
            .await
            .map_err(|e| SrunError::Http(e.to_string()))?;
        Ok(text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::USER_AGENT;
    use wiremock::matchers::{header, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn make_http(uri: &str) -> SrunHttp {
        SrunHttp::with_base_url(uri).expect("构造测试 SrunHttp 失败")
    }

    /// GET 请求应返回响应文本（JSONP 透传不解码）
    #[tokio::test]
    async fn get_jsonp_returns_response_text() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/cgi-bin/test"))
            .respond_with(
                ResponseTemplate::new(200).set_body_string("callback({\"ok\":1})"),
            )
            .mount(&server)
            .await;
        let http = make_http(&server.uri());
        let text = http.get_jsonp("/cgi-bin/test", &[]).await.unwrap();
        assert_eq!(text, "callback({\"ok\":1})");
    }

    /// 应发送所有 query 参数
    #[tokio::test]
    async fn get_jsonp_sends_query_params() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/cgi-bin/test"))
            .and(query_param("a", "1"))
            .and(query_param("b", "2"))
            .respond_with(ResponseTemplate::new(200).set_body_string("ok"))
            .mount(&server)
            .await;
        let http = make_http(&server.uri());
        let _ = http
            .get_jsonp("/cgi-bin/test", &[("a", "1"), ("b", "2")])
            .await
            .unwrap();
    }

    /// 应携带统一 User-Agent
    #[tokio::test]
    async fn get_jsonp_sends_user_agent() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/cgi-bin/test"))
            .and(header("user-agent", USER_AGENT))
            .respond_with(ResponseTemplate::new(200).set_body_string("ok"))
            .mount(&server)
            .await;
        let http = make_http(&server.uri());
        let _ = http.get_jsonp("/cgi-bin/test", &[]).await.unwrap();
    }

    /// 自定义 UA 构造的客户端应发送用户指定的值
    #[tokio::test]
    async fn with_base_url_and_ua_sends_custom_user_agent() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/cgi-bin/test"))
            .and(header("user-agent", "MyCustomAgent/1.0"))
            .respond_with(ResponseTemplate::new(200).set_body_string("ok"))
            .mount(&server)
            .await;
        let http = SrunHttp::with_base_url_and_ua(&server.uri(), "MyCustomAgent/1.0").unwrap();
        let _ = http.get_jsonp("/cgi-bin/test", &[]).await.unwrap();
    }

    /// 自定义 UA 为空或全空白时应回退到默认 [`USER_AGENT`]
    #[tokio::test]
    async fn with_base_url_and_ua_blank_falls_back_to_default() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/cgi-bin/test"))
            .and(header("user-agent", USER_AGENT))
            .respond_with(ResponseTemplate::new(200).set_body_string("ok"))
            .mount(&server)
            .await;
        let http = SrunHttp::with_base_url_and_ua(&server.uri(), "  ").unwrap();
        let _ = http.get_jsonp("/cgi-bin/test", &[]).await.unwrap();
    }

    /// 服务端返回 4xx/5xx 时 reqwest 默认不抛错，text() 仍返回响应体；
    /// 错误处理留给上层（api 模块）按 JSONP 解析结果判断
    #[tokio::test]
    async fn get_jsonp_returns_body_even_on_4xx() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/cgi-bin/test"))
            .respond_with(
                ResponseTemplate::new(404).set_body_string("callback({\"error\":\"not_found\"})"),
            )
            .mount(&server)
            .await;
        let http = make_http(&server.uri());
        let text = http.get_jsonp("/cgi-bin/test", &[]).await.unwrap();
        assert!(text.contains("not_found"));
    }
}
