//! 文件日志系统：单文件 5MB 轮转 + RUST_LOG 级别控制
//!
//! 设计目标（减少日志记录，方便排错又不过量）：
//! - 默认只记录 `info` 及以上，`debug` / `trace` 默认不落盘
//! - `RUST_LOG` 环境变量可临时调高（如 `RUST_LOG=debug`）或按模块过滤
//!   （如 `RUST_LOG=srun_core=debug,srun_app=info`），排错完去掉即可
//! - 高频轮询（状态查询 / WiFi 探测）只记失败，成功的轮询不写日志
//! - 敏感信息（密码、token 等）一律不进日志，埋点处保证
//! - 单文件达到 5MB 自动轮转：当前文件挪为 `.1` 备份，旧备份覆盖删除，
//!   日志总量恒定约 10MB，无需人工清理
//!
//! 日志格式：`[2026-01-01 12:00:00.123] [INFO ] [target] message`

use chrono::Local;
use log::{LevelFilter, Log, Metadata, Record};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

/// 单文件日志大小上限：5MB
pub const MAX_LOG_SIZE: u64 = 5 * 1024 * 1024;

/// RUST_LOG 解析出的规则：target 前缀 -> 级别
#[derive(Debug, Clone)]
struct Rule {
    target: String,
    level: LevelFilter,
}

/// 文件句柄与轮转状态
struct Inner {
    /// 当前日志文件路径
    path: PathBuf,
    /// 轮转后的备份路径（`srun.log.1`）
    backup: PathBuf,
    /// 当前文件句柄（`None` 仅在轮转中途出现）
    file: Option<File>,
    size: u64,
    max_size: u64,
}

impl Inner {
    /// 写入一行；超限时先轮转
    fn write_line(&mut self, line: &str) {
        let len = line.len() as u64;
        if self.size + len > self.max_size {
            self.rotate();
        }
        let Some(file) = self.file.as_mut() else {
            return;
        };
        if file.write_all(line.as_bytes()).is_ok() {
            let _ = file.flush();
            self.size += len;
        }
    }

    /// 轮转：关闭旧句柄 -> 删除旧备份 -> 当前文件挪为备份 -> 新建当前文件
    ///
    /// Windows 上必须先关闭旧文件句柄再 rename，否则文件被占用会失败。
    fn rotate(&mut self) {
        // 关闭旧句柄（先 flush 再 drop）
        if let Some(mut old) = self.file.take() {
            let _ = old.flush();
            drop(old);
        }
        let _ = fs::remove_file(&self.backup);
        let _ = fs::rename(&self.path, &self.backup);
        self.file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .ok();
        self.size = 0;
    }
}

/// 线程安全的自定义 logger（实现 `log::Log`）
pub struct FileLogger {
    inner: Mutex<Inner>,
    default_level: LevelFilter,
    rules: Vec<Rule>,
}

impl FileLogger {
    /// 构造 logger；`max_size` 供测试注入小值验证轮转。
    pub fn new(path: PathBuf, backup: PathBuf, max_size: u64) -> std::io::Result<Self> {
        let file = OpenOptions::new().create(true).append(true).open(&path)?;
        let size = file.metadata().map(|m| m.len()).unwrap_or(0);
        Ok(Self {
            inner: Mutex::new(Inner {
                path,
                backup,
                file: Some(file),
                size,
                max_size,
            }),
            default_level: LevelFilter::Info,
            rules: Vec::new(),
        })
    }

    /// 当前 target 生效的级别：最长前缀匹配规则，未命中用默认级别
    fn level_for(&self, target: &str) -> LevelFilter {
        let mut best: Option<&Rule> = None;
        for r in &self.rules {
            if target.starts_with(&r.target) {
                match best {
                    None => best = Some(r),
                    Some(b) if r.target.len() > b.target.len() => best = Some(r),
                    _ => {}
                }
            }
        }
        best.map(|r| r.level).unwrap_or(self.default_level)
    }
}

impl Log for FileLogger {
    fn enabled(&self, metadata: &Metadata) -> bool {
        metadata.level() <= self.level_for(metadata.target())
    }

    fn log(&self, record: &Record) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let ts = Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let line = format!(
            "[{ts}] [{:<5}] [{}] {}\n",
            record.level().as_str(),
            record.target(),
            record.args()
        );
        if let Ok(mut inner) = self.inner.lock() {
            inner.write_line(&line);
        }
    }

    fn flush(&self) {
        if let Ok(mut inner) = self.inner.lock() {
            if let Some(file) = inner.file.as_mut() {
                let _ = file.flush();
            }
        }
    }
}

/// 解析级别字符串（不区分大小写）
fn parse_level(s: &str) -> Option<LevelFilter> {
    match s.trim().to_ascii_lowercase().as_str() {
        "off" => Some(LevelFilter::Off),
        "error" => Some(LevelFilter::Error),
        "warn" => Some(LevelFilter::Warn),
        "info" => Some(LevelFilter::Info),
        "debug" => Some(LevelFilter::Debug),
        "trace" => Some(LevelFilter::Trace),
        _ => None,
    }
}

/// 解析 `RUST_LOG` 值。
///
/// 支持两种形式：
/// - 全局级别：`RUST_LOG=debug`
/// - 按模块过滤：`RUST_LOG=srun_core=debug,srun_app=warn`（未匹配的 target 用默认级别）
///
/// 返回 `(默认级别, 规则列表)`；无环境变量或解析失败时默认 `info`。
fn parse_rust_log(value: &str) -> (LevelFilter, Vec<Rule>) {
    let mut default = LevelFilter::Info;
    let mut rules = Vec::new();
    for part in value.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        if let Some((target, level)) = part.split_once('=') {
            if let Some(lv) = parse_level(level) {
                rules.push(Rule {
                    target: target.trim().to_string(),
                    level: lv,
                });
            }
        } else if let Some(lv) = parse_level(part) {
            default = lv;
        }
    }
    (default, rules)
}

/// 读取 `RUST_LOG` 环境变量构造默认级别与规则（未设置时默认 `info`）。
fn rules_from_env() -> (LevelFilter, Vec<Rule>) {
    match std::env::var("RUST_LOG") {
        Ok(v) => parse_rust_log(&v),
        Err(_) => (LevelFilter::Info, Vec::new()),
    }
}

/// 初始化全局 logger 并写入 `log_dir/srun.log`。
///
/// 返回错误则说明日志系统不可用（目录不可写等），调用方决定是否继续。
pub fn init(log_dir: PathBuf) -> Result<(), String> {
    fs::create_dir_all(&log_dir).map_err(|e| format!("创建日志目录失败: {e}"))?;
    let path = log_dir.join("srun.log");
    let backup = log_dir.join("srun.log.1");

    let mut logger =
        FileLogger::new(path.clone(), backup, MAX_LOG_SIZE).map_err(|e| e.to_string())?;
    let (default_level, rules) = rules_from_env();
    logger.default_level = default_level;
    logger.rules = rules;

    log::set_boxed_logger(Box::new(logger)).map_err(|e| e.to_string())?;
    log::set_max_level(LevelFilter::Trace);
    log::info!("日志系统已初始化: {}", path.display());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use log::Level;

    /// 无 `RUST_LOG` 时默认 `info`
    #[test]
    fn parse_rust_log_defaults_to_info() {
        let (default, rules) = parse_rust_log("");
        assert_eq!(default, LevelFilter::Info);
        assert!(rules.is_empty());
    }

    /// 纯级别字符串设置全局级别
    #[test]
    fn parse_rust_log_global_level() {
        let (default, rules) = parse_rust_log("debug");
        assert_eq!(default, LevelFilter::Debug);
        assert!(rules.is_empty());
    }

    /// 按模块过滤：`target=level` 形式，未匹配 target 用默认级别
    #[test]
    fn parse_rust_log_module_rules() {
        let (default, rules) = parse_rust_log("srun_core=debug,srun_app=warn");
        assert_eq!(default, LevelFilter::Info);
        assert_eq!(rules.len(), 2);
        assert_eq!(rules[0].target, "srun_core");
        assert_eq!(rules[0].level, LevelFilter::Debug);
        assert_eq!(rules[1].target, "srun_app");
        assert_eq!(rules[1].level, LevelFilter::Warn);
    }

    /// 解析忽略非法片段（非法级别不建规则）
    #[test]
    fn parse_rust_log_ignores_invalid() {
        let (default, rules) = parse_rust_log("bogus,srun_core=verbose,");
        assert_eq!(default, LevelFilter::Info);
        assert!(rules.is_empty());
    }

    /// 测试辅助：在临时目录创建真实文件，返回句柄（不能打开目录）
    fn temp_file(name: &str) -> File {
        let dir = std::env::temp_dir().join(format!("srun-log-aux-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let path = dir.join(name);
        OpenOptions::new().create(true).append(true).open(path).unwrap()
    }

    /// 最长前缀匹配
    #[test]
    fn level_for_matches_longest_prefix() {
        let logger = FileLogger {
            inner: Mutex::new(Inner {
                path: PathBuf::new(),
                backup: PathBuf::new(),
                file: Some(temp_file("level_for.log")),
                size: 0,
                max_size: MAX_LOG_SIZE,
            }),
            default_level: LevelFilter::Info,
            rules: vec![
                Rule {
                    target: "srun_core".into(),
                    level: LevelFilter::Debug,
                },
                Rule {
                    target: "srun_core::http".into(),
                    level: LevelFilter::Trace,
                },
            ],
        };
        assert_eq!(logger.level_for("srun_core::http::foo"), LevelFilter::Trace);
        assert_eq!(logger.level_for("srun_core::login::bar"), LevelFilter::Debug);
        assert_eq!(logger.level_for("srun_app"), LevelFilter::Info);
    }

    /// 记录一条日志后当前文件出现对应内容
    #[test]
    fn log_writes_line_to_file() {
        let dir = std::env::temp_dir().join(format!("srun-log-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("srun.log");
        let logger = FileLogger::new(path.clone(), dir.join("srun.log.1"), MAX_LOG_SIZE).unwrap();

        let args = format_args!("登录失败");
        let record = Record::builder()
            .args(args)
            .level(Level::Error)
            .target("srun_core::login")
            .build();
        logger.log(&record);

        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("登录失败"), "got: {content}");
        assert!(content.contains("[ERROR]"), "got: {content}");
        assert!(content.contains("[srun_core::login]"), "got: {content}");

        let _ = fs::remove_dir_all(&dir);
    }

    /// 达到上限后自动轮转：当前文件重置，旧内容进备份
    #[test]
    fn rotates_when_over_limit() {
        let dir = std::env::temp_dir().join(format!("srun-log-rot-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("srun.log");
        let backup = dir.join("srun.log.1");
        let logger = FileLogger::new(path.clone(), backup.clone(), 100).unwrap();

        // 写入超过上限的内容（多行累计 > 100 字节）
        for i in 0..50 {
            let args = format_args!("line number {i} padding padding padding");
            let record = Record::builder()
                .args(args)
                .level(Level::Info)
                .target("t")
                .build();
            logger.log(&record);
        }

        assert!(backup.exists(), "轮转后应存在备份文件");
        let cur = fs::read_to_string(&path).unwrap();
        // max_size=100 必然多次轮转：最初写入的 line 0 应早已被淘汰（不在当前文件、也不在仅保留
        // 最近一次轮转旧内容的备份中）
        assert!(!cur.contains("line number 0"), "当前文件应已轮转，got: {cur}");
        let bak = fs::read_to_string(&backup).unwrap();
        // 备份只保留最后一次轮转前的最近内容，应包含部分日志行
        assert!(!bak.is_empty(), "旧日志应在备份中");

        let _ = fs::remove_dir_all(&dir);
    }

    /// 低于 `info` 的日志（debug）默认被过滤
    #[test]
    fn debug_filtered_by_default() {
        let logger = FileLogger {
            inner: Mutex::new(Inner {
                path: PathBuf::new(),
                backup: PathBuf::new(),
                file: Some(temp_file("debug_filter.log")),
                size: 0,
                max_size: MAX_LOG_SIZE,
            }),
            default_level: LevelFilter::Info,
            rules: Vec::new(),
        };
        let meta = log::Metadata::builder()
            .level(Level::Debug)
            .target("x")
            .build();
        assert!(!logger.enabled(&meta));

        let meta = log::Metadata::builder()
            .level(Level::Warn)
            .target("x")
            .build();
        assert!(logger.enabled(&meta));
    }
}
