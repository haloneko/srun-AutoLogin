//! user API - 用户信息查询与登录/登出 portal 操作
//!
//! 对应 Python `api/user.py`。

use crate::api::now_millis;
use crate::error::Result;
use crate::http::SrunHttp;
use crate::jsonp::parse_jsonp;
use serde_json::Value;

/// 获取用户信息，对应 Python `get_user_info()`。
///
/// GET `/cgi-bin/rad_user_info?callback=callback&_=<毫秒时间戳>`
pub async fn get_user_info(http: &SrunHttp) -> Result<Value> {
    let now = now_millis();
    let params: &[(&str, &str)] = &[("callback", "callback"), ("_", &now)];
    let text = http.get_jsonp("/cgi-bin/rad_user_info", params).await?;
    parse_jsonp(&text)
}

/// 用户操作（登录/登出），对应 Python `portal(params)`。
///
/// GET `/cgi-bin/srun_portal?<params>`
pub async fn portal(http: &SrunHttp, params: &[(&str, String)]) -> Result<Value> {
    let owned: Vec<(&str, &str)> = params.iter().map(|(k, v)| (*k, v.as_str())).collect();
    let text = http.get_jsonp("/cgi-bin/srun_portal", &owned).await?;
    parse_jsonp(&text)
}
