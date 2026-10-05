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
