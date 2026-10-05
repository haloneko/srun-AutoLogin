//! JSONP 解析与序列化
//!
//! 深澜服务端响应通常形如 `callback({"a":1})`，需先剥离外层 `callback(...)`
//! 后再用 JSON 解析。Python 版用正则匹配，这里改为按首个 `(` 与末尾 `)` 截取，
//! 更稳健且避免引入 regex 依赖。

use crate::error::{Result, SrunError};
use serde_json::Value;

/// 解析 JSONP 响应：截取首个 `(` 与末尾 `)` 之间的 JSON 文本并反序列化。
///
/// 兼容 `cb({...})`、`cb({...});`（带尾分号）等常见变体。
/// 无 `(` / 无 `)` / 括号顺序异常返回 [`SrunError::Jsonp`]；
/// 中间文本非合法 JSON 返回 [`SrunError::Json`]。
pub fn parse_jsonp(s: &str) -> Result<Value> {
    let start = s.find('(').ok_or_else(|| SrunError::Jsonp("响应中无左括号".to_string()))?;
    let end = s.rfind(')').ok_or_else(|| SrunError::Jsonp("响应中无右括号".to_string()))?;
    if end < start {
        return Err(SrunError::Jsonp("括号顺序异常".to_string()));
    }
    let json_text = &s[start + 1..end];
    let value = serde_json::from_str(json_text)?;
    Ok(value)
}

/// 序列化为 JSONP 文本：`callback(json)`。
///
/// 内部使用 `serde_json::to_string`，非 ASCII 字符保留为 UTF-8 不转义，
/// 与 Python `json.dumps(ensure_ascii=False)` 行为一致。
pub fn stringify_jsonp(value: &Value, callback: &str) -> Result<String> {
    let json = serde_json::to_string(value)?;
    Ok(format!("{callback}({json})"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// 标准 `cb({...})` 文本应正确解析
    #[test]
    fn parse_callback_with_object() {
        let s = r#"callback({"a":1,"b":"x"})"#;
        let v = parse_jsonp(s).unwrap();
        assert_eq!(v["a"], 1);
        assert_eq!(v["b"], "x");
    }

    /// 带尾分号 `cb({...});` 也能解析（rfind 直接定位最后一个 `)`）
    #[test]
    fn parse_callback_with_trailing_semicolon() {
        let s = r#"cb({"a":1});"#;
        let v = parse_jsonp(s).unwrap();
        assert_eq!(v["a"], 1);
    }

    /// 无括号应返回 `Jsonp` 错误
    #[test]
    fn parse_no_paren_returns_error() {
        let err = parse_jsonp("hello").unwrap_err();
        assert!(matches!(err, SrunError::Jsonp(_)), "got: {err:?}");
        assert!(err.to_string().contains("JSONP 解析失败"));
    }

    /// 只有左括号应返回 `Jsonp` 错误
    #[test]
    fn parse_only_left_paren_returns_error() {
        let err = parse_jsonp("cb({a:1").unwrap_err();
        assert!(matches!(err, SrunError::Jsonp(_)), "got: {err:?}");
    }

    /// 中间非合法 JSON 应返回 `Json` 错误（来自 serde_json）
    #[test]
    fn parse_invalid_json_returns_json_error() {
        let err = parse_jsonp("cb(not_json)").unwrap_err();
        assert!(matches!(err, SrunError::Json(_)), "got: {err:?}");
    }

    /// 对称性：`parse_jsonp(stringify_jsonp(v, "cb")) == v`
    #[test]
    fn stringify_then_parse_round_trip() {
        let v = json!({"a": 1, "b": "hello"});
        let s = stringify_jsonp(&v, "cb").unwrap();
        assert!(s.starts_with("cb("), "got: {s}");
        assert!(s.ends_with(')'), "got: {s}");
        let parsed = parse_jsonp(&s).unwrap();
        assert_eq!(parsed, v);
    }

    /// 中文不应被转义为 `\uXXXX`，与 Python `ensure_ascii=False` 一致
    #[test]
    fn stringify_keeps_chinese_unescaped() {
        let v = json!({"name": "张三"});
        let s = stringify_jsonp(&v, "cb").unwrap();
        assert!(s.contains("张三"), "got: {s}");
        assert!(!s.contains("\\u"), "got: {s}");
    }

    /// 嵌套对象与数组也应保持对称性
    #[test]
    fn round_trip_nested() {
        let v = json!({"outer": {"inner": [1, 2, 3]}, "null": null, "bool": true});
        let s = stringify_jsonp(&v, "cb").unwrap();
        let parsed = parse_jsonp(&s).unwrap();
        assert_eq!(parsed, v);
    }
}
