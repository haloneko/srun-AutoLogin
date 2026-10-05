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

#[cfg(test)]
mod tests {
    use super::*;

    /// `Http` 变体 Display 输出应包含「HTTP 请求失败」前缀与具体描述
    #[test]
    fn http_display_contains_message() {
        let e = SrunError::Http("连接超时".to_string());
        let s = e.to_string();
        assert!(s.contains("HTTP 请求失败"), "got: {s}");
        assert!(s.contains("连接超时"), "got: {s}");
    }

    /// `Jsonp` 变体 Display 输出应包含「JSONP 解析失败」前缀与具体描述
    #[test]
    fn jsonp_display_contains_message() {
        let e = SrunError::Jsonp("响应中无左括号".to_string());
        let s = e.to_string();
        assert!(s.contains("JSONP 解析失败"), "got: {s}");
        assert!(s.contains("响应中无左括号"), "got: {s}");
    }

    /// `MissingField` 变体应输出对应字段名
    #[test]
    fn missing_field_display() {
        let e = SrunError::MissingField("client_ip");
        let s = e.to_string();
        assert!(s.contains("client_ip"), "got: {s}");
        assert!(s.contains("缺少必需字段"), "got: {s}");
    }

    /// `serde_json::Error` 应能通过 `?` / `From` 转换为 `SrunError::Json`
    #[test]
    fn json_from_serde_json_error() {
        let json_err = serde_json::from_str::<serde_json::Value>("bad json").unwrap_err();
        let e: SrunError = json_err.into();
        assert!(matches!(e, SrunError::Json(_)), "got: {e:?}");
        let s = e.to_string();
        assert!(s.contains("JSON 处理失败"), "got: {s}");
    }
}
