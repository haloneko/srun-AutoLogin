//! srun-cli - 深澜校园网自动登录命令行工具
//!
//! 对应 Python `main.py`：解析参数 → 重试循环 → 倒计时。
//! 核心逻辑委托给 `srun-core`，便于未来 Tauri GUI 直接复用 core。

use clap::Parser;
use srun_core::config::{BASE_URL, DEFAULT_RETRY, DEFAULT_WAIT};
use srun_core::http::SrunHttp;
use srun_core::logger::{print_log, Level};
use srun_core::login::{build_login_request, login};
use std::time::Duration;
use tokio::time::sleep;

/// 深澜校园网自动登录 CLI
#[derive(Parser, Debug)]
#[command(name = "srun", version, about = "深澜校园网自动登录 CLI")]
struct Args {
    /// 深澜账号用户名
    #[arg(short = 'u', long)]
    username: String,

    /// 深澜账号密码
    #[arg(short = 'p', long)]
    password: String,

    /// 失败重试次数（仅在网络/解析异常时重试；服务端返回 error!=ok 不重试）
    #[arg(long, default_value_t = DEFAULT_RETRY)]
    retry: u32,

    /// 结束后倒计时秒数
    #[arg(long, default_value_t = DEFAULT_WAIT)]
    wait: u64,

    /// 离线构造登录请求并打印参数（不发起实际登录请求）。
    /// 该模式需要 --ip 与 --challenge，纯本地测试加密链路。
    #[arg(long)]
    dry_run: bool,

    /// dry-run 模式下使用的本机 IP
    #[arg(long)]
    ip: Option<String>,

    /// dry-run 模式下使用的 challenge（从服务端 get_challenge 获取的 token）
    #[arg(long)]
    challenge: Option<String>,

    /// 覆盖默认 BASE_URL（测试或自部署环境用）
    #[arg(long)]
    base_url: Option<String>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();
    println!("======= 深澜校园网自动登录工具 v0.1.0 =======");

    if args.dry_run {
        return run_dry_run(&args).await;
    }
    run_login(&args).await
}

/// --dry-run 模式：纯离线构造登录请求参数并打印，不发起任何实际登录请求
async fn run_dry_run(args: &Args) -> anyhow::Result<()> {
    let ip = args
        .ip
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("--dry-run 模式需要 --ip 参数"))?;
    let challenge = args
        .challenge
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("--dry-run 模式需要 --challenge 参数"))?;
    let params = build_login_request(&args.username, &args.password, ip, challenge)
        .map_err(|e| anyhow::anyhow!("构造登录请求失败: {e}"))?;
    print_log("dry-run 登录请求参数:", "", Level::Info, false);
    for (k, v) in &params {
        println!("  {k} = {v}");
    }
    Ok(())
}

/// 普通登录模式：构造 HTTP 客户端 → 重试循环 → 倒计时
async fn run_login(args: &Args) -> anyhow::Result<()> {
    let base_url = args.base_url.as_deref().unwrap_or(BASE_URL);
    let http = SrunHttp::with_base_url(base_url)
        .map_err(|e| anyhow::anyhow!("HTTP 客户端构造失败: {e}"))?;

    for attempt in 1..=args.retry {
        print_log("正在登录校园网...", "", Level::Info, false);
        match login(&http, &args.username, &args.password).await {
            Ok(res) => {
                let error = res.get("error").and_then(|v| v.as_str()).unwrap_or("");
                let client_ip = res.get("client_ip").and_then(|v| v.as_str()).unwrap_or("");
                if error == "ok" {
                    let suc_msg = res.get("suc_msg").and_then(|v| v.as_str()).unwrap_or("");
                    print_log("客户端 IP 地址:", client_ip, Level::Info, false);
                    print_log("登录提示信息:", suc_msg, Level::Info, false);
                    print_log("登录成功", "", Level::Done, false);
                } else {
                    print_log("客户端 IP 地址:", client_ip, Level::Info, false);
                    print_log("登录失败:", error, Level::Error, false);
                }
                // Python quirk：服务端返回 error!=ok 不重试，直接 break
                break;
            }
            Err(e) => {
                // 仅在抛异常时重试（与 Python main.py 一致）
                print_log("请求失败:", &e.to_string(), Level::Error, false);
                if attempt < args.retry {
                    continue;
                }
            }
        }
    }

    wait_countdown(args.wait, "自动关闭").await;
    Ok(())
}

/// 倒计时 N 秒，每秒原地重写一行；最后换行
async fn wait_countdown(secs: u64, message: &str) {
    if secs == 0 {
        return;
    }
    for t in (1..=secs).rev() {
        print_log(&format!("{t} 秒后{message}"), "", Level::Info, true);
        sleep(Duration::from_secs(1)).await;
    }
    println!();
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 基本参数解析：-u/-p 必填
    #[test]
    fn parse_basic_args() {
        let args = Args::try_parse_from(["srun", "-u", "user1", "-p", "pass1"]).unwrap();
        assert_eq!(args.username, "user1");
        assert_eq!(args.password, "pass1");
    }

    /// 长选项形式也应等价
    #[test]
    fn parse_long_options() {
        let args =
            Args::try_parse_from(["srun", "--username", "u", "--password", "p"]).unwrap();
        assert_eq!(args.username, "u");
        assert_eq!(args.password, "p");
    }

    /// 缺少 -u 应报错
    #[test]
    fn missing_username_errors() {
        assert!(Args::try_parse_from(["srun", "-p", "p"]).is_err());
    }

    /// 缺少 -p 应报错
    #[test]
    fn missing_password_errors() {
        assert!(Args::try_parse_from(["srun", "-u", "u"]).is_err());
    }

    /// retry/wait 默认值应与 Python `range(5)` / `wait(5, ...)` 一致
    #[test]
    fn default_retry_and_wait_match_python() {
        let args = Args::try_parse_from(["srun", "-u", "u", "-p", "p"]).unwrap();
        assert_eq!(args.retry, 5);
        assert_eq!(args.wait, 5);
    }

    /// retry/wait 可显式覆盖
    #[test]
    fn override_retry_and_wait() {
        let args = Args::try_parse_from([
            "srun", "-u", "u", "-p", "p", "--retry", "3", "--wait", "10",
        ])
        .unwrap();
        assert_eq!(args.retry, 3);
        assert_eq!(args.wait, 10);
    }

    /// --dry-run flag 应能被解析
    #[test]
    fn parse_dry_run_flag() {
        let args = Args::try_parse_from([
            "srun", "-u", "u", "-p", "p", "--dry-run", "--ip", "1.2.3.4", "--challenge", "tok",
        ])
        .unwrap();
        assert!(args.dry_run);
        assert_eq!(args.ip.as_deref(), Some("1.2.3.4"));
        assert_eq!(args.challenge.as_deref(), Some("tok"));
    }

    /// --base-url 可覆盖默认
    #[test]
    fn parse_base_url_override() {
        let args = Args::try_parse_from([
            "srun", "-u", "u", "-p", "p", "--base-url", "http://example.com/",
        ])
        .unwrap();
        assert_eq!(args.base_url.as_deref(), Some("http://example.com/"));
    }

    /// wait_countdown(0) 应立即返回（边界）
    #[tokio::test]
    async fn wait_countdown_zero_is_noop() {
        wait_countdown(0, "x").await;
        // 不 panic 即通过
    }
}
