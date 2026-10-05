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
    /// 启用 cookie 存储与统一 User-Agent。
    pub fn with_base_url(base_url: &str) -> Result<Self> {
        let base_url =
            Url::parse(base_url).map_err(|e| SrunError::Http(format!("URL 解析失败: {e}")))?;
        let client = reqwest::Client::builder()
            .cookie_store(true)
            .user_agent(USER_AGENT)
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
