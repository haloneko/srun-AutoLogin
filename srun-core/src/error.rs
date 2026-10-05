//! 统一错误类型
//!
//! 对应 Python 各模块可能抛出的异常，集中成一个 [`SrunError`] 枚举，
//! 便于上层（CLI / GUI）统一处理与展示。所有模块统一返回 [`Result`]。

use std::error::Error as StdError;
use thiserror::Error;

/// 深澜登录流程中所有可能出现的错误
///
/// 设计说明：
/// - `Http` 变体暂存错误字符串描述。步骤 8 引入 reqwest 后，
///   将改为 `Http(#[from] reqwest::Error)` 直接转换。
/// - `Json` 变体直接 `#[from] serde_json::Error`，因为 serde_json 在步骤 3 起即被广泛使用。
#[derive(Debug, Error)]
pub enum SrunError {
    /// HTTP 请求失败（连接、超时、状态码异常等）
    #[error("HTTP 请求失败: {0}")]
    Http(String),

    /// JSONP 响应解析失败（无 `(`、无 `)`、JSON 体非法等）
    #[error("JSONP 解析失败: {0}")]
    Jsonp(String),

    /// JSON 序列化 / 反序列化失败
    #[error("JSON 处理失败: {0}")]
    Json(#[from] serde_json::Error),

    /// 服务端响应缺少必需字段（如 `challenge`、`client_ip` 等）
    #[error("缺少必需字段: {0}")]
    MissingField(&'static str),

    /// 其他未分类错误（如自定义 trait object 错误）
    #[error("{0}")]
    Other(#[source] Box<dyn StdError + Send + Sync>),
}

/// 模块内统一 Result 别名
pub type Result<T> = std::result::Result<T, SrunError>;
