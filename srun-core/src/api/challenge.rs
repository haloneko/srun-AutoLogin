//! challenge API - 获取加密所需的 challenge
//!
//! 对应 Python `api/challenge.py`。

use crate::api::now_millis;
use crate::error::Result;
use crate::http::SrunHttp;
use crate::jsonp::parse_jsonp;
use serde_json::Value;

/// 获取加密所需的 challenge 信息，对应 Python `get_challenge(username, ip)`。
///
/// GET `/cgi-bin/get_challenge?callback=callback&username=<u>&ip=<ip>&_=<毫秒时间戳>`
pub async fn get_challenge(http: &SrunHttp, username: &str, ip: &str) -> Result<Value> {
    let now = now_millis();
    let params: &[(&str, &str)] = &[
        ("callback", "callback"),
        ("username", username),
        ("ip", ip),
        ("_", &now),
    ];
    let text = http.get_jsonp("/cgi-bin/get_challenge", params).await?;
    parse_jsonp(&text)
}
