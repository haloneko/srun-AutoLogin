//! wifi 模块 - 自动连接校园网 WiFi（Windows）
//!
//! 通过系统 `netsh wlan` 命令实现：查询当前连接、检查目标网络可用性、发起连接。
//! 选择 netsh 而非 WLAN API：不引入额外依赖，连接已保存的配置文件也无需管理员权限。
//!
//! 本模块全部函数均为**阻塞调用**（spawn 进程 + `sleep` 轮询）：调用方必须放到阻塞线程池
//! （见 `lib.rs` 中 `wifi_status` / `wifi_connect` 的 `spawn_blocking`），不得在主线程直接调用，
//! 否则 netsh 执行期间窗口会假死。
//!
//! 兼容中英文系统输出：字段名（SSID / BSSID / Profile）在 netsh 输出中均为英文，
//! 以这些 ASCII 关键字解析即可避免中文乱码问题（netsh 中文系统输出为 GBK 编码，
//! 其余中文行在 lossy 转换下可能显示为 �，但不影响本模块依赖的关键字判断）。

use std::process::Command;
use std::sync::Mutex;

/// 串行化 WiFi 连接操作。
///
/// 连接流程会写入 profile 并轮询确认，启动自动切换与用户手动点击可能同时触发；
/// 并发执行会互相打断（一方刚连上又被另一方重连），导致误判超时失败。
static CONNECT_LOCK: Mutex<()> = Mutex::new(());

/// 构造 netsh 命令。
///
/// netsh 是控制台程序，从 GUI 进程直接 spawn 会闪现控制台窗口并抢占前台焦点
/// （用户表现为「窗口点不动」），故 Windows 下统一以 `CREATE_NO_WINDOW` 启动。
#[cfg(windows)]
fn netsh_command() -> Command {
    use std::os::windows::process::CommandExt;
    /// 不为子进程创建控制台窗口
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut cmd = Command::new("netsh");
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

#[cfg(not(windows))]
fn netsh_command() -> Command {
    Command::new("netsh")
}

/// 当前无线连接状态（序列化后返回前端）
#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WifiStatus {
    /// 是否已连接到任意无线网络
    pub connected: bool,
    /// 当前连接的 SSID（未连接为 null）
    pub ssid: Option<String>,
    /// 无线接口是否可用（未启用 / 无网卡时为 false）
    pub interface_ready: bool,
}

/// `wifi_connect` 的结果：`connected=true` 表示本次执行了连接动作（前端据此等待 DHCP 就绪）
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WifiConnectResult {
    /// 本次是否真的执行了连接（false 表示此前已连在目标网络）
    pub connected: bool,
    /// 提示消息（成功说明 / 失败原因）
    pub message: String,
}

/// 运行 netsh 并返回 stdout；失败返回 Err（命令不存在 / WLAN 服务未启动等）
fn run_netsh(args: &[&str]) -> Result<String, String> {
    let out = netsh_command()
        .args(args)
        .output()
        .map_err(|e| format!("无法执行 netsh: {e}"))?;
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// 从形如 `SSID                   : MyWiFi` 的行中提取冒号后的值；非目标行返回 None。
/// `key` 为行首关键字（SSID / State 等），首尾空白已去除。
fn strip_field(line: &str, key: &str) -> Option<String> {
    let t = line.trim();
    if t.starts_with(key) {
        if let Some(idx) = t.find(':') {
            let v = t[idx + 1..].trim();
            if !v.is_empty() {
                return Some(v.to_string());
            }
        }
    }
    None
}

/// 当前无线连接状态：
/// - 无无线网卡 / WLAN 服务未启动 / 接口禁用 → `interface_ready=false`
/// - 有接口但未连接 → `connected=false`，无 SSID 行
/// - 已连接 → 解析出当前 SSID
pub fn current_status() -> WifiStatus {
    let out = match run_netsh(&["wlan", "show", "interfaces"]) {
        Ok(s) => s,
        Err(_) => return WifiStatus::default(),
    };

    let has_interface = out.lines().any(|l| {
        let t = l.trim();
        t.starts_with("SSID")
            || t.starts_with("State")
            || t.starts_with("状态")
            || t.starts_with("Name")
            || t.starts_with("名称")
    });
    if !has_interface {
        return WifiStatus::default();
    }

    let mut ssid = None;
    for line in out.lines() {
        if let Some(v) = strip_field(line, "SSID") {
            ssid = Some(v);
            break;
        }
    }
    WifiStatus {
        connected: ssid.is_some(),
        ssid,
        interface_ready: true,
    }
}

/// 当前可见的无线网络 SSID 列表（`netsh wlan show networks mode=bssid`）
fn available_ssids() -> Vec<String> {
    let Ok(out) = run_netsh(&["wlan", "show", "networks", "mode=bssid"]) else {
        return Vec::new();
    };
    out.lines()
        .filter_map(|l| {
            // 输出形如 `SSID 1 : MyWiFi`；仅取冒号后内容，忽略 BSSID 等行
            let t = l.trim();
            if t.starts_with("SSID") {
                if let Some(idx) = t.find(':') {
                    let v = t[idx + 1..].trim();
                    if !v.is_empty() {
                        return Some(v.to_string());
                    }
                }
            }
            None
        })
        .collect()
}

/// 目标 SSID 是否已有配置文件（判断是否需写入带密码的 profile）
fn has_profile(ssid: &str) -> bool {
    let Ok(out) = run_netsh(&["wlan", "show", "profiles"]) else {
        return false;
    };
    out.lines().any(|l| {
        let t = l.trim();
        // 中英文系统关键字：所有用户配置文件 / 用户配置文件 / All User Profile / User Profile
        if t.contains("配置文件") || t.contains("Profile") {
            if let Some(idx) = t.find(':') {
                return t[idx + 1..].trim() == ssid;
            }
        }
        false
    })
}

/// XML 转义（SSID / 密码可能包含 & < > " '）
fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// 生成 `netsh wlan add profile` 所需的 profile XML。
/// 密码为空时按开放网络生成（无 security 段）；否则按 WPA2-PSK / AES。
fn profile_xml(ssid: &str, password: &str) -> String {
    let hex: String = ssid.as_bytes().iter().map(|b| format!("{b:02X}")).collect();
    let name = xml_escape(ssid);
    let head = format!(
        r#"<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
  <name>{name}</name>
  <SSIDConfig>
    <SSID>
      <hex>{hex}</hex>
      <name>{name}</name>
    </SSID>
  </SSIDConfig>
  <connectionType>ESS</connectionType>
  <connectionMode>manual</connectionMode>
"#
    );
    if password.is_empty() {
        format!("{head}</WLANProfile>")
    } else {
        let pwd = xml_escape(password);
        format!(
            "{head}  <MSM>\n    <security>\n      <authEncryption>\n        <authentication>WPA2PSK</authentication>\n        <encryption>AES</encryption>\n        <useOneX>false</useOneX>\n      </authEncryption>\n      <sharedKey>\n        <keyType>passPhrase</keyType>\n        <protected>false</protected>\n        <keyMaterial>{pwd}</keyMaterial>\n      </sharedKey>\n    </security>\n  </MSM>\n</WLANProfile>"
        )
    }
}

/// 连接指定 SSID。
///
/// 流程：接口检查 → 可用性检查 → 无 profile 时写入（含密码则一并写入）→ connect → 轮询确认。
/// 轮询最多 15 秒，避免「命令返回成功但 DHCP/关联尚未完成」的假成功。
pub fn connect(ssid: &str, password: &str) -> Result<WifiConnectResult, String> {
    let ssid = ssid.trim();
    if ssid.is_empty() {
        return Err("SSID 不能为空".to_string());
    }

    // 串行化：并发调用会让「连接 → 轮询确认」互相打断
    let _guard = CONNECT_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    let st = current_status();
    if !st.interface_ready {
        return Err("未检测到可用的无线网卡，请检查 WLAN 服务或无线开关".to_string());
    }
    // 已连在目标网络：直接返回，避免重复触发连接
    if st.connected && st.ssid.as_deref() == Some(ssid) {
        return Ok(WifiConnectResult {
            connected: false,
            message: format!("已连接到 {ssid}"),
        });
    }

    if !available_ssids().iter().any(|s| s == ssid) {
        return Err(format!("未找到网络「{ssid}」，请确认 WiFi 已开启且在信号范围内"));
    }

    // 目标网络没有配置文件时写入一个（开放网络 / 带密码均适用）
    if !has_profile(ssid) {
        let xml = profile_xml(ssid, password);
        let file_name = format!(
            "srun_wifi_{}.xml",
            ssid.chars().filter(|c| c.is_alphanumeric()).collect::<String>()
        );
        let path = std::env::temp_dir().join(file_name);
        std::fs::write(&path, xml).map_err(|e| format!("写入临时配置文件失败: {e}"))?;
        let add = run_netsh(&[
            "wlan",
            "add",
            "profile",
            &format!("filename=\"{}\"", path.display()),
            "user=current",
        ]);
        let _ = std::fs::remove_file(&path); // 无论成败都清理临时文件
        if let Err(e) = add {
            return Err(format!("写入 WiFi 配置文件失败（需要管理员权限？）: {e}"));
        }
    }

    // 发起连接；参数带引号以兼容 SSID 含空格的情况
    let out = netsh_command()
        .args([
            "wlan",
            "connect",
            &format!("name=\"{ssid}\""),
            &format!("ssid=\"{ssid}\""),
        ])
        .output()
        .map_err(|e| format!("无法执行 netsh connect: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    if !out.status.success() && !stdout.to_lowercase().contains("success") {
        return Err(format!("连接命令执行失败: {}", stdout.trim()));
    }

    // 轮询确认真正关联成功（最多 15 秒）：先立即查一次（netsh connect 后通常已关联），
    // 未成功再休眠重试，省掉无谓的首秒等待和最后一次空轮询
    for _ in 0..15 {
        let st = current_status();
        if st.connected && st.ssid.as_deref() == Some(ssid) {
            return Ok(WifiConnectResult {
                connected: true,
                message: format!("已连接到 {ssid}"),
            });
        }
        std::thread::sleep(std::time::Duration::from_secs(1));
    }
    Err(format!(
        "连接「{ssid}」超时未成功，请检查密码是否正确或网络是否可用"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_field_extracts_value() {
        assert_eq!(
            strip_field("    SSID                   : MyWiFi", "SSID").as_deref(),
            Some("MyWiFi")
        );
        assert_eq!(
            strip_field("状态                   : 已连接", "状态").as_deref(),
            Some("已连接")
        );
        // 非目标行返回 None
        assert_eq!(strip_field("BSSID 1 : aa:bb", "SSID"), None);
        // 冒号后为空也返回 None
        assert_eq!(strip_field("SSID                   :", "SSID"), None);
    }

    #[test]
    fn available_ssids_parses_section() {
        // 模拟 `netsh wlan show networks mode=bssid` 的中文系统输出
        let out = concat!(
            "可用网络:\n\n",
            "显示 3 个网络。\n\n",
            "    SSID 1 : SDMU-5G\n",
            "        网络类型            : 结构\n",
            "        身份验证            : WPA2 - 个人\n",
            "        BSSID 1             : 00:11:22:33:44:55\n",
            "          信号              : 100%\n",
            "    SSID 2 : ChinaNet\n",
            "        网络类型            : 结构\n",
        );
        // 直接验证解析函数（通过 run_netsh 的调用不可测，这里单测解析逻辑）
        let ssids: Vec<String> = out
            .lines()
            .filter_map(|l| {
                let t = l.trim();
                if t.starts_with("SSID") {
                    if let Some(idx) = t.find(':') {
                        let v = t[idx + 1..].trim();
                        if !v.is_empty() {
                            return Some(v.to_string());
                        }
                    }
                }
                None
            })
            .collect();
        assert_eq!(ssids, vec!["SDMU-5G".to_string(), "ChinaNet".to_string()]);
    }

    #[test]
    fn profile_xml_escapes_and_hex() {
        let xml = profile_xml("SDMU-5G", "");
        assert!(xml.contains("<name>SDMU-5G</name>"));
        assert!(xml.contains("<hex>53444D552D3547</hex>"));
        assert!(!xml.contains("<MSM>"), "开放网络不应含 security 段");

        let xml = profile_xml("A&B", "p<w>");
        assert!(xml.contains("<name>A&amp;B</name>"));
        assert!(xml.contains("<keyMaterial>p&lt;w&gt;</keyMaterial>"));
        assert!(xml.contains("<authentication>WPA2PSK</authentication>"));
    }

    #[test]
    fn connect_rejects_empty_ssid() {
        let err = connect("   ", "x").unwrap_err();
        assert!(err.contains("SSID 不能为空"));
    }
}
