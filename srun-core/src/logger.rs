//! 彩色日志与行重写
//!
//! 对应 Python `utils/print_log.py` 的彩色输出与倒计时行重写。
//! 保留同样的 ANSI 颜色组合：背景色徽章标签 + 亮色前景消息 + 普通前景详情。

use chrono::Local;
use std::io::Write;

/// 日志级别（对应 Python `print_log` 的 `level` 参数 0/1/2/3）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
    /// 信息（Python `level=0`），蓝色徽章 + 青色文字
    Info,
    /// 完成（Python `level=1`），绿色徽章 + 绿色亮文字
    Done,
    /// 警告（Python `level=2`），黄色徽章 + 黄色亮文字
    Warn,
    /// 错误（Python `level=3`），红色徽章 + 红色亮文字
    Error,
}

const RESET: &str = "\x1b[0m";

impl Level {
    /// 徽章（带前后空格的标签，背景色 + 亮黑前景，对应 Python `_bg(color, " LABEL ")`）
    fn badge(self) -> &'static str {
        match self {
            // bright + black fg + blue bg + " INFO " + reset
            Level::Info => "\x1b[1m\x1b[30m\x1b[44m INFO \x1b[0m",
            Level::Done => "\x1b[1m\x1b[30m\x1b[42m DONE \x1b[0m",
            Level::Warn => "\x1b[1m\x1b[30m\x1b[43m WARN \x1b[0m",
            Level::Error => "\x1b[1m\x1b[30m\x1b[41m ERROR \x1b[0m",
        }
    }

    /// 消息前景颜色（亮色，对应 Python `_fg(color, msg, bright=True)`）
    fn msg_prefix(self) -> &'static str {
        match self {
            Level::Info => "\x1b[1m\x1b[36m", // bright cyan
            Level::Done => "\x1b[1m\x1b[32m", // bright green
            Level::Warn => "\x1b[1m\x1b[33m", // bright yellow
            Level::Error => "\x1b[1m\x1b[31m", // bright red
        }
    }

    /// 详情前景颜色（普通色，对应 Python `_fg(color, detail, bright=False)`）
    fn detail_prefix(self) -> &'static str {
        match self {
            Level::Info => "\x1b[36m",
            Level::Done => "\x1b[32m",
            Level::Warn => "\x1b[33m",
            Level::Error => "\x1b[31m",
        }
    }
}

/// 格式化一行日志（不含 rewrite 前缀）。
///
/// 与 Python 版完全一致的格式：`<badge> [HH:MM:SS] <msg> <detail>`，
/// 其中 message / detail 均带颜色转义；detail 为空字符串时仍保留尾部空格
/// （与 Python `f'... {detail}'` 行为对齐，不主动 trim）。
pub fn format_log(msg: &str, detail: &str, level: Level) -> String {
    let ts = Local::now().format("%H:%M:%S");
    let badge = level.badge();
    let msg_p = level.msg_prefix();
    let det_p = level.detail_prefix();
    format!("{badge} [{ts}] {msg_p}{msg}{RESET} {det_p}{detail}{RESET}")
}

/// 格式化一行日志，可选带行重写前缀 `\r\x1b[2K`。
///
/// `rewrite=true` 时返回 `"\r\x1b[2K" + format_log(...)`，
/// 用于覆盖当前行内容（倒计时场景）。
pub fn format_line(msg: &str, detail: &str, level: Level, rewrite: bool) -> String {
    let core = format_log(msg, detail, level);
    if rewrite {
        format!("\r\x1b[2K{core}")
    } else {
        core
    }
}

/// 打印一行日志，可选行重写。
///
/// `rewrite=true` 用 `print!` + flush 实现原地刷新（倒计时场景）；
/// `rewrite=false` 用 `println!` 换行输出。
pub fn print_log(msg: &str, detail: &str, level: Level, rewrite: bool) {
    let line = format_line(msg, detail, level, rewrite);
    if rewrite {
        print!("{line}");
        let _ = std::io::stdout().flush();
    } else {
        println!("{line}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `Info` 级别输出含 ` INFO ` 徽章与消息内容
    #[test]
    fn format_log_info_label() {
        let s = format_log("登录中", "", Level::Info);
        assert!(s.contains(" INFO "), "got: {s}");
        assert!(s.contains("登录中"), "got: {s}");
    }

    /// `Done` 级别输出含 ` DONE ` 徽章，并保留 detail
    #[test]
    fn format_log_done_label_with_detail() {
        let s = format_log("登录成功", "user:12345", Level::Done);
        assert!(s.contains(" DONE "), "got: {s}");
        assert!(s.contains("user:12345"), "got: {s}");
    }

    /// `Warn` 级别输出含 ` WARN ` 徽章
    #[test]
    fn format_log_warn_label() {
        let s = format_log("重试中", "", Level::Warn);
        assert!(s.contains(" WARN "), "got: {s}");
    }

    /// `Error` 级别输出含 ` ERROR ` 徽章
    #[test]
    fn format_log_error_label() {
        let s = format_log("登录失败", "", Level::Error);
        assert!(s.contains(" ERROR "), "got: {s}");
    }

    /// 输出应包含 `[HH:MM:SS]` 时间戳（长度恰为 10）
    #[test]
    fn format_log_contains_timestamp_brackets() {
        let s = format_log("x", "", Level::Info);
        // 时间戳前后有空格，故查找 " [" 与匹配的 "]"
        let open = s.find(" [").map(|i| i + 1);
        assert!(open.is_some(), "got: {s}");
        if let Some(i) = open {
            let close = s[i..].find(']').map(|j| i + j);
            assert!(close.is_some(), "got: {s}");
            if let Some(j) = close {
                let ts = &s[i..=j];
                assert_eq!(ts.len(), 10, "got: {ts}");
                assert!(ts.starts_with('['), "got: {ts}");
                assert!(ts.ends_with(']'), "got: {ts}");
            }
        }
    }

    /// 输出应包含 ANSI 颜色转义码（与 Python colorama 等价）
    #[test]
    fn format_log_includes_ansi_color_codes() {
        let s = format_log("x", "", Level::Info);
        assert!(s.contains("\x1b["), "got: {s}");
        assert!(s.contains("\x1b[0m"), "got: {s}");
    }

    /// Info 徽章应为蓝色背景 `\x1b[44m`
    #[test]
    fn info_badge_is_blue_bg() {
        let s = format_log("x", "", Level::Info);
        assert!(s.contains("\x1b[44m"), "got: {s}");
    }

    /// Error 徽章应为红色背景 `\x1b[41m`
    #[test]
    fn error_badge_is_red_bg() {
        let s = format_log("x", "", Level::Error);
        assert!(s.contains("\x1b[41m"), "got: {s}");
    }

    /// `rewrite=true` 输出应以 `\r\x1b[2K` 开头
    #[test]
    fn format_line_rewrite_starts_with_clear_seq() {
        let s = format_line("等待 5 秒", "", Level::Info, true);
        assert!(s.starts_with("\r\x1b[2K"), "got: {s}");
        assert!(s.contains("等待 5 秒"), "got: {s}");
    }

    /// `rewrite=false` 输出不应以 `\r\x1b[2K` 开头
    #[test]
    fn format_line_no_rewrite_does_not_start_with_clear_seq() {
        let s = format_line("等待 5 秒", "", Level::Info, false);
        assert!(!s.starts_with("\r\x1b[2K"), "got: {s}");
    }

    /// 空 detail 时输出仍应保留尾部空格（与 Python `f'... {detail}'` 行为对齐）：
    /// detail 部分会变成 `空格 + 颜色码 + 立即 reset`。
    #[test]
    fn format_log_empty_detail_keeps_trailing_space() {
        let s = format_log("msg", "", Level::Info);
        assert!(s.ends_with(" \x1b[36m\x1b[0m"), "got: {s}");
    }
}
