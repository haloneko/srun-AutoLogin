//! network_history - 网络连接历史（近 N 天时间线）
//!
//! 记录「什么时间连在哪个网络上」，供界面按时间轴展示近几天的网络切换情况。
//!
//! 设计要点：
//! - **只写右端点**：连续同一个网络只维护一个「未闭合区间」（`open`），
//!   只有网络真正结束时才把右端点写进 `records`（因此 `records` 里全是已闭合区间）。
//! - **合并语义**：短于 `REJOIN_GRACE_MS` 的断开直接被抵消（视为抖动），
//!   断开前后两段自然并成一条，而不是事后再扫描合并；
//!   切换过程中 DHCP 未就绪导致的假断开不会在时间线上留下碎片。
//! - **崩溃 / 重启安全**：`open` 连同 `heartbeat` 一起落盘（正常退出也保留 `open`，
//!   只把 `heartbeat` 推到退出时刻）。重启时若距上次上报不超过 `RECONNECT_GRACE_MS`
//!   （90 秒），视为「只是关掉又打开了一下」——原区间接着累积，时间线上不留断链；
//!   超过宽限期才用 `heartbeat` 作为右端点补一条 `recovered` 记录
//!   （最多丢 `HEARTBEAT_MS` 的尾部时长）。`recovered` 记录不参与任何合并，
//!   因此「关机很久 → 重启 → 连回同一网络」必然是两条独立记录，不会被误并成一段。
//! - **有限窗口**：只保留 `RETENTION_DAYS` 天内的记录，查询时再按窗口截断。
//! - **原子写**：写临时文件 + rename 覆盖，断电不会留下半截 JSON。
//! - **状态未知 ≠ 离线**：区间内 `ssid=None` 表示「明确未连接」，
//!   没有任何记录的时间段表示「应用没运行，状态未知」，界面上应区分渲染。
//!
//! 唯一的写入口是 [`on_status`]，由网络状态来源统一调用（启动探测 / WLAN 通知 /
//! 前端状态查询 / 手动连接），避免多处各自埋点导致时间线不一致。

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

/// 保留天数（查询窗口上限）
pub const RETENTION_DAYS: u32 = 5;
/// 抖动合并窗口：断开后在此时间内回到同一网络，视为从未断开（不写右端点、不产生记录）
pub const REJOIN_GRACE_MS: i64 = 15_000;
/// `open` 区间心跳落盘间隔：异常退出时最多丢失这么久的尾部时长
pub const HEARTBEAT_MS: i64 = 30_000;
/// 重启宽限：距上次上报（`heartbeat`）在此时间内重新打开应用，视为没有断链——
/// 原区间继续累积，而不是在重启处切一刀留下「状态未知」的空白
pub const RECONNECT_GRACE_MS: i64 = 90_000;
/// 记录条数上限（兜底，防止极端切换频率把文件撑大）
pub const MAX_RECORDS: usize = 2000;
/// 心跳线程轮询间隔
const TICK_INTERVAL: Duration = Duration::from_secs(10);
/// 一天的毫秒数
const DAY_MS: i64 = 86_400_000;
/// 历史文件名
const FILE_NAME: &str = "network-history.json";
/// 当前磁盘格式版本
const FORMAT_VERSION: u32 = 1;

/// 当前时间（epoch 毫秒）
fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 一条已闭合的网络区间
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Record {
    /// 该区间的 SSID；`None` 表示「明确未连接」
    pub ssid: Option<String>,
    /// 起始时间（epoch 毫秒）
    pub start: i64,
    /// 结束时间（epoch 毫秒）
    pub end: i64,
    /// 是否为崩溃恢复补记的区间（数据可能不完整，且不参与合并）
    #[serde(default)]
    pub recovered: bool,
}

/// 返回前端的区间（已按查询窗口裁剪，时间到「现在」为止）
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    /// `None` 表示明确未连接
    pub ssid: Option<String>,
    pub start: i64,
    pub end: i64,
    /// 超期恢复补记的区间：结束时间不确定，数据可能不完整
    pub recovered: bool,
}

/// 正在累积、尚未闭合的区间
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct Open {
    ssid: Option<String>,
    start: i64,
    /// 最后一次确认「还活着」的时间（崩溃恢复时作为右端点）
    heartbeat: i64,
    /// 疑似断开的时间点：断开通知到达后先挂起，等过抖动宽限期才真正闭合
    #[serde(default, skip_serializing_if = "Option::is_none")]
    lost_at: Option<i64>,
}

/// 落盘格式（snake_case，仅本模块读写）
#[derive(Debug, Default, Serialize, Deserialize)]
struct Disk {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    open: Option<Open>,
    #[serde(default)]
    records: Vec<Record>,
}

/// 纯逻辑状态机（不含路径 / 磁盘，便于单测）
#[derive(Debug, Default)]
pub struct History {
    records: Vec<Record>,
    open: Option<Open>,
    /// 上一次接收状态的时间，用于系统时间回拨保护
    last_now: i64,
}

impl History {
    /// 从落盘状态恢复上次遗留的 `open`：
    ///
    /// - 距上次上报不超过 `RECONNECT_GRACE_MS`：只是关掉又打开了一下，原区间接着累积；
    /// - 超过宽限期：用 `heartbeat` 作为右端点补一条 `recovered` 记录（结束时间不确定）。
    fn from_disk(disk: Disk, now: i64) -> Self {
        let mut h = History {
            records: disk.records,
            open: None,
            last_now: now,
        };
        h.records.sort_by_key(|r| r.start);
        if let Some(o) = disk.open {
            let hb = o.heartbeat.max(o.start);
            if now - hb <= RECONNECT_GRACE_MS {
                // 接着上次那段继续记，界面上看不出中断
                h.open = Some(Open {
                    ssid: o.ssid,
                    start: o.start,
                    heartbeat: hb,
                    lost_at: o.lost_at,
                });
            } else {
                match o.lost_at {
                    // 退出前已断开：补一段连接区间 + 一段未连接区间
                    Some(t) => {
                        let t = t.clamp(o.start, hb);
                        h.push_closed(o.ssid, o.start, t, true);
                        h.push_closed(None, t, hb, true);
                    }
                    None => h.push_closed(o.ssid, o.start, hb, true),
                }
            }
        }
        h.prune(now);
        h
    }

    /// 状态入口：`ssid` 为 `None` 表示明确断开。返回落盘内容是否需要更新。
    fn on_status(&mut self, now: i64, ssid: Option<&str>) -> bool {
        if now < self.last_now {
            // 系统时间被回拨：丢弃本次，避免写出负长度区间
            return false;
        }
        self.last_now = now;
        self.apply(now, ssid)
    }

    /// 状态迁移（快照式，避免在可变借用期间做迁移）
    fn apply(&mut self, now: i64, ssid: Option<&str>) -> bool {
        // 进程启动后的第一条状态：建立区间起点（起于现在，此前的状态未知）
        let Some(cur) = self.open.as_ref().map(|o| (o.ssid.clone(), o.start, o.lost_at)) else {
            self.open = Some(Open::new(ssid, now));
            return true;
        };
        let (cur_ssid, cur_start, cur_lost) = cur;

        // 状态未变：只推进心跳；若此前挂起过断开，说明是抖动，撤销挂起（不产生记录）
        if cur_ssid.as_deref() == ssid {
            let open = self.open.as_mut().unwrap();
            open.heartbeat = now;
            if open.lost_at.is_some() {
                open.lost_at = None;
                return true;
            }
            return false;
        }

        // 连接 → 断开：先挂起，宽限期内回到同一网络即视为抖动；超时由 tick 结算
        if ssid.is_none() {
            let open = self.open.as_mut().unwrap();
            open.heartbeat = now;
            if open.lost_at.is_none() {
                open.lost_at = Some(now);
                return true;
            }
            return false;
        }

        // 以下：转入「已连上 target」
        let target = ssid.unwrap_or_default().to_string();
        match cur_lost {
            // 挂起的断开已被这次连接顶掉：连接区间结算到断开点，中间补一段未连接区间
            Some(t) if cur_ssid.is_some() => {
                self.push_closed(cur_ssid.clone(), cur_start, t, false);
                self.push_closed(None, t, now, false);
            }
            // 本就处于未连接状态：结算这段未连接时间
            None if cur_ssid.is_none() => {
                self.push_closed(None, cur_start, now, false);
            }
            // 直接从当前网络切到另一个网络：中间没有可观测的未连接段
            _ => {
                self.push_closed(cur_ssid.clone(), cur_start, now, false);
            }
        }
        self.open = Some(Open::new(Some(&target), now));
        true
    }

    /// 心跳：结算超时的挂起断开 + 推进 `open` 存活时间。返回落盘内容是否需要更新。
    fn tick(&mut self, now: i64) -> bool {
        if now < self.last_now {
            return false;
        }
        self.last_now = now;

        // 挂起的断开超过宽限期：真正闭合连接区间，转入未连接区间
        if let Some((start, ssid, Some(t))) = self
            .open
            .as_ref()
            .map(|o| (o.start, o.ssid.clone(), o.lost_at))
        {
            if now - t > REJOIN_GRACE_MS {
                self.open = Some(Open {
                    ssid: None,
                    start: t,
                    heartbeat: now,
                    lost_at: None,
                });
                self.push_closed(ssid, start, t, false);
                return true;
            }
        }

        // 心跳落盘：仅在超过阈值时写，避免无谓 IO
        if let Some(o) = self.open.as_mut() {
            if now - o.heartbeat >= HEARTBEAT_MS {
                o.heartbeat = now;
                return true;
            }
        }
        false
    }

    /// 退出前把心跳推到当前时刻。
    ///
    /// 刻意不闭合 `open`：关掉再打开是很常见的操作，闭合会把它切成两段、中间留一段
    /// 「状态未知」。是否真的断开交给重启时的 [`History::from_disk`] 按宽限期判断。
    fn mark_exit(&mut self, now: i64) {
        self.last_now = self.last_now.max(now);
        if let Some(o) = self.open.as_mut() {
            o.heartbeat = o.heartbeat.max(now);
        }
    }

    /// 清空历史记录；当前连接继续沿用，不人为制造区间端点
    fn clear(&mut self) {
        self.records.clear();
    }

    /// 裁剪过期记录并限制条数上限
    fn prune(&mut self, now: i64) {
        let cutoff = now - RETENTION_DAYS as i64 * DAY_MS;
        self.records.retain(|r| r.end > cutoff);
        if self.records.len() > MAX_RECORDS {
            let drop_n = self.records.len() - MAX_RECORDS;
            self.records.drain(..drop_n);
        }
    }

    /// 按窗口取区间：裁剪到 `[now - days, now]`，并带上进行中的区间
    fn segments(&self, days: u32, now: i64) -> Vec<Segment> {
        let days = days.clamp(1, RETENTION_DAYS) as i64;
        let cutoff = now - days * DAY_MS;
        let mut out = Vec::new();
        for r in &self.records {
            push_segment(&mut out, r.ssid.clone(), r.start, r.end, r.recovered, cutoff, now);
        }
        if let Some(o) = &self.open {
            match o.lost_at {
                // 挂起的断开在时间线上已可视为未连接
                Some(t) if o.ssid.is_some() => {
                    push_segment(&mut out, o.ssid.clone(), o.start, t, false, cutoff, now);
                    push_segment(&mut out, None, t, now, false, cutoff, now);
                }
                _ => push_segment(&mut out, o.ssid.clone(), o.start, now, false, cutoff, now),
            }
        }
        out
    }

    /// 追加一条已闭合区间。零 / 负长度直接丢弃；同一网络的连续性由状态机与抖动窗口保证，
    /// 此处不做「事后扫描合并」——那会把崩溃前后的两段误并成一段。
    fn push_closed(&mut self, ssid: Option<String>, start: i64, end: i64, recovered: bool) {
        if end <= start {
            return;
        }
        self.records.push(Record {
            ssid,
            start,
            end,
            recovered,
        });
    }
}

impl Open {
    fn new(ssid: Option<&str>, now: i64) -> Self {
        Open {
            ssid: ssid.map(str::to_string),
            start: now,
            heartbeat: now,
            lost_at: None,
        }
    }
}

/// 按查询窗口裁剪后写入结果（越界区间被截断而非丢弃）
fn push_segment(
    out: &mut Vec<Segment>,
    ssid: Option<String>,
    start: i64,
    end: i64,
    recovered: bool,
    cutoff: i64,
    now: i64,
) {
    let start = start.max(cutoff);
    let end = end.min(now);
    if end > start {
        out.push(Segment {
            ssid,
            start,
            end,
            recovered,
        });
    }
}

/// 已初始化的存储：路径 + 状态机
struct Inner {
    path: PathBuf,
    tmp: PathBuf,
    history: History,
}

impl Inner {
    /// 原子落盘：临时文件 + rename 覆盖，断电不留半截 JSON
    fn save(&self) -> Result<(), String> {
        let disk = Disk {
            version: FORMAT_VERSION,
            open: self.history.open.clone(),
            records: self.history.records.clone(),
        };
        let bytes =
            serde_json::to_vec_pretty(&disk).map_err(|e| format!("序列化网络历史失败: {e}"))?;
        let mut file = File::create(&self.tmp).map_err(|e| format!("写临时文件失败: {e}"))?;
        file.write_all(&bytes)
            .map_err(|e| format!("写临时文件失败: {e}"))?;
        file.sync_all().map_err(|e| format!("网络历史落盘失败: {e}"))?;
        drop(file);
        fs::rename(&self.tmp, &self.path).map_err(|e| format!("替换网络历史文件失败: {e}"))
    }
}

/// 全局存储（未初始化时所有写入/查询静默空转）
static STORE: Mutex<Option<Inner>> = Mutex::new(None);
/// 心跳线程是否已启动
static HEARTBEAT_STARTED: AtomicBool = AtomicBool::new(false);

/// 在持有全局锁的前提下操作存储
fn with_store<T>(f: impl FnOnce(&mut Inner) -> T) -> Option<T> {
    let mut guard = STORE.lock().ok()?;
    guard.as_mut().map(f)
}

/// 读取落盘内容；文件缺失 / 损坏 / 版本过高时按空历史处理（绝不 panic）
fn read_disk(path: &Path) -> Disk {
    let Ok(bytes) = fs::read(path) else {
        return Disk::default();
    };
    match serde_json::from_slice::<Disk>(&bytes) {
        Ok(disk) if disk.version <= FORMAT_VERSION => disk,
        Ok(disk) => {
            log::warn!(
                "网络历史文件版本 {} 高于当前支持（{}），按空历史重建",
                disk.version,
                FORMAT_VERSION
            );
            Disk::default()
        }
        Err(e) => {
            log::warn!("网络历史文件解析失败，按空历史重建: {e}");
            Disk::default()
        }
    }
}

/// 初始化：读盘恢复（含崩溃补记）、裁剪过期记录、启动心跳线程。
///
/// 返回错误说明历史不可用（目录不可写等），调用方决定是否继续。
pub fn init(data_dir: PathBuf) -> Result<(), String> {
    fs::create_dir_all(&data_dir).map_err(|e| format!("创建数据目录失败: {e}"))?;
    let path = data_dir.join(FILE_NAME);
    let tmp = data_dir.join(format!("{FILE_NAME}.tmp"));

    let now = now_ms();
    let history = History::from_disk(read_disk(&path), now);
    let inner = Inner {
        path: path.clone(),
        tmp,
        history,
    };
    // 立刻回写一次：完成裁剪 / 崩溃补记 / 格式规整
    inner.save()?;
    {
        let mut guard = STORE.lock().map_err(|_| "网络历史状态锁不可用".to_string())?;
        *guard = Some(inner);
    }
    start_heartbeat();
    log::info!(
        "网络历史已加载: {}（保留 {} 天）",
        path.display(),
        RETENTION_DAYS
    );
    Ok(())
}

/// 网络状态变更入口（唯一写入口）。`ssid` 为 `None` 表示明确断开。
///
/// 由启动探测 / WLAN 通知 / 前端状态查询 / 手动连接统一调用，状态机自行去重。
pub fn on_status(ssid: Option<&str>) {
    let now = now_ms();
    let changed = with_store(|inner| {
        let changed = inner.history.on_status(now, ssid);
        if changed {
            if let Err(e) = inner.save() {
                log::warn!("网络历史落盘失败: {e}");
            }
        }
        changed
    });
    if changed == Some(true) {
        log::debug!("网络历史更新: ssid={}", ssid.unwrap_or("<未连接>"));
    }
}

/// 心跳（后台线程调用）：推进存活时间、结算超时的挂起断开
pub fn tick() {
    let now = now_ms();
    with_store(|inner| {
        if inner.history.tick(now) {
            if let Err(e) = inner.save() {
                log::warn!("网络历史落盘失败: {e}");
            }
        }
    });
}

/// 优雅退出：推进心跳后落盘，保留未闭合区间（重启后按 `RECONNECT_GRACE_MS` 决定是否接着记）
pub fn shutdown() {
    let now = now_ms();
    with_store(|inner| {
        inner.history.mark_exit(now);
        if let Err(e) = inner.save() {
            log::warn!("网络历史退出落盘失败: {e}");
        }
    });
}

/// 查询近 `days` 天的区间（按窗口裁剪，含当前进行中的区间）
pub fn segments(days: u32) -> Vec<Segment> {
    let now = now_ms();
    with_store(|inner| inner.history.segments(days, now)).unwrap_or_default()
}

/// 清空历史记录（当前连接继续沿用，不制造区间端点）
pub fn clear() -> Result<(), String> {
    with_store(|inner| {
        inner.history.clear();
        inner.save()
    })
    .unwrap_or_else(|| Err("网络历史尚未初始化".to_string()))
}

/// 心跳线程：每 `TICK_INTERVAL` 推进一次状态，与进程同生命周期
fn start_heartbeat() {
    if HEARTBEAT_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    let spawned = std::thread::Builder::new()
        .name("network-history-heartbeat".to_string())
        .spawn(|| loop {
            std::thread::sleep(TICK_INTERVAL);
            tick();
        });
    if let Err(e) = spawned {
        HEARTBEAT_STARTED.store(false, Ordering::SeqCst);
        log::warn!("网络历史心跳线程启动失败: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 连接网络的 SSID 常量
    const A: Option<&str> = Some("A-WiFi");
    /// 另一个网络的 SSID 常量
    const B: Option<&str> = Some("B-WiFi");

    /// 取出记录的三元组便于断言
    fn recs(h: &History) -> Vec<(Option<String>, i64, i64)> {
        h.records
            .iter()
            .map(|r| (r.ssid.clone(), r.start, r.end))
            .collect()
    }

    /// 首条状态只建立区间起点，不产生记录（此前的状态未知）
    #[test]
    fn first_status_starts_interval_without_record() {
        let mut h = History::default();
        assert!(h.on_status(1_000, A));
        assert!(h.records.is_empty());
        let open = h.open.as_ref().unwrap();
        assert_eq!(open.ssid.as_deref(), Some("A-WiFi"));
        assert_eq!(open.start, 1_000);
    }

    /// 同一网络重复上报只推进心跳，不新增记录
    #[test]
    fn same_ssid_reports_do_not_add_records() {
        let mut h = History::default();
        h.on_status(1_000, A);
        assert!(!h.on_status(2_000, A));
        assert!(!h.on_status(3_000, A));
        assert!(h.records.is_empty(), "同网络重复上报不应产生记录");
        assert_eq!(h.open.as_ref().unwrap().heartbeat, 3_000);
    }

    /// 网络切换：只在此刻写出上一条的右端点
    #[test]
    fn ssid_change_writes_right_endpoint() {
        let mut h = History::default();
        h.on_status(1_000, A);
        h.on_status(5_000, B);
        assert_eq!(recs(&h), vec![(Some("A-WiFi".to_string()), 1_000, 5_000)]);
    }

    /// 同一时刻切换：零长度区间不入库
    #[test]
    fn zero_length_intervals_are_skipped() {
        let mut h = History::default();
        h.on_status(5_000, A);
        h.on_status(5_000, B);
        assert!(h.records.is_empty(), "零长度区间不入库");
    }

    /// 抖动：断开后宽限期内回到同一网络，两段合并为一条（不写右端点、起点不变）
    #[test]
    fn short_gap_same_ssid_is_merged_without_record() {
        let mut h = History::default();
        h.on_status(1_000, A);
        h.on_status(2_000, None);
        h.on_status(9_000, A); // 7s < 15s 宽限期
        assert!(h.records.is_empty(), "抖动应被合并，不写右端点");
        let open = h.open.as_ref().unwrap();
        assert_eq!(open.start, 1_000, "合并后区间起点保持原值");
        assert!(open.lost_at.is_none(), "挂起状态应被撤销");
    }

    /// 挂起的断开超过宽限期：tick 结算连接区间，转入未连接区间
    #[test]
    fn pending_disconnect_after_grace_closes_and_switches_offline() {
        let mut h = History::default();
        h.on_status(1_000, A);
        h.on_status(10_000, None);
        assert!(!h.tick(20_000), "宽限期内不结算也不落盘");
        assert!(h.records.is_empty());
        assert!(h.tick(30_000), "超过宽限期应结算");
        assert_eq!(recs(&h), vec![(Some("A-WiFi".to_string()), 1_000, 10_000)]);
        let open = h.open.as_ref().unwrap();
        assert_eq!(open.ssid, None);
        assert_eq!(open.start, 10_000, "未连接区间从断开点起算");
    }

    /// 断开后直接连上另一个网络（超宽限期）：补一段未连接区间
    #[test]
    fn reconnect_after_grace_records_offline_interval() {
        let mut h = History::default();
        h.on_status(1_000, A);
        h.on_status(10_000, None);
        h.on_status(40_000, B);
        assert_eq!(
            recs(&h),
            vec![
                (Some("A-WiFi".to_string()), 1_000, 10_000),
                (None, 10_000, 40_000),
            ]
        );
        assert_eq!(h.open.as_ref().unwrap().ssid.as_deref(), Some("B-WiFi"));
    }

    /// 心跳：未到间隔不落盘，到点才推进
    #[test]
    fn heartbeat_only_advances_after_interval() {
        let mut h = History::default();
        h.on_status(1_000, A);
        assert!(!h.tick(2_000), "未到心跳间隔不应落盘");
        assert!(h.tick(1_000 + HEARTBEAT_MS), "到心跳间隔应落盘");
        assert_eq!(h.open.as_ref().unwrap().heartbeat, 1_000 + HEARTBEAT_MS);
    }

    /// 系统时间回拨：丢弃本次状态，不写出负长度区间
    #[test]
    fn clock_rollback_is_ignored() {
        let mut h = History::default();
        h.on_status(10_000, A);
        h.on_status(50_000, B);
        assert!(!h.on_status(20_000, A), "时间回拨应被忽略");
        assert_eq!(recs(&h).len(), 1);
        assert_eq!(h.open.as_ref().unwrap().ssid.as_deref(), Some("B-WiFi"));
    }

    /// 重启宽限：距上次上报不超过 RECONNECT_GRACE_MS 就重开，视为没断链——原区间接着记
    #[test]
    fn restart_within_grace_keeps_interval_going() {
        let disk = Disk {
            version: FORMAT_VERSION,
            open: Some(Open {
                ssid: Some("A-WiFi".to_string()),
                start: 1_000,
                heartbeat: 60_000,
                lost_at: None,
            }),
            records: vec![],
        };
        let now = 60_000 + RECONNECT_GRACE_MS;
        let mut h = History::from_disk(disk, now);
        assert!(h.records.is_empty(), "宽限期内重启不应补记区间");
        assert_eq!(
            h.open.as_ref().unwrap().start,
            1_000,
            "原区间应继续沿用，而不是从重启时刻另起一段"
        );
        // 重启后状态没变：继续累积，依然不产生记录
        h.on_status(now + 1_000, A);
        assert!(h.records.is_empty());
        assert_eq!(h.open.as_ref().unwrap().start, 1_000);
    }

    /// 超过宽限期：遗留 open 以心跳为右端点补记，且带 recovered 标记
    #[test]
    fn recovered_open_is_closed_at_heartbeat() {
        let disk = Disk {
            version: FORMAT_VERSION,
            open: Some(Open {
                ssid: Some("A-WiFi".to_string()),
                start: 1_000,
                heartbeat: 31_000,
                lost_at: None,
            }),
            records: vec![Record {
                ssid: Some("X".to_string()),
                start: 0,
                end: 500,
                recovered: false,
            }],
        };
        let h = History::from_disk(disk, 31_000 + RECONNECT_GRACE_MS + 1);
        assert_eq!(
            recs(&h),
            vec![
                (Some("X".to_string()), 0, 500),
                (Some("A-WiFi".to_string()), 1_000, 31_000),
            ]
        );
        assert!(h.records[1].recovered, "超期补记区间应带 recovered 标记");
    }

    /// 崩溃前已处于「挂起断开」：拆成连接区间 + 未连接区间
    #[test]
    fn recovered_pending_loss_splits_into_offline_interval() {
        let disk = Disk {
            version: FORMAT_VERSION,
            open: Some(Open {
                ssid: Some("A-WiFi".to_string()),
                start: 1_000,
                heartbeat: 60_000,
                lost_at: Some(40_000),
            }),
            records: vec![],
        };
        let h = History::from_disk(disk, 60_000 + RECONNECT_GRACE_MS + 1);
        assert_eq!(
            recs(&h),
            vec![
                (Some("A-WiFi".to_string()), 1_000, 40_000),
                (None, 40_000, 60_000),
            ]
        );
    }

    /// 崩溃后连回同一网络：必须是两条记录，不能与崩溃前那段合并
    #[test]
    fn recovered_record_is_not_merged_with_next_same_ssid() {
        let disk = Disk {
            version: FORMAT_VERSION,
            open: Some(Open {
                ssid: Some("A-WiFi".to_string()),
                start: 1_000,
                heartbeat: 10_000,
                lost_at: None,
            }),
            records: vec![],
        };
        let mut h = History::from_disk(disk, 10_000 + RECONNECT_GRACE_MS + 1);
        h.on_status(200_000, A);
        h.on_status(260_000, B);
        assert_eq!(
            recs(&h),
            vec![
                (Some("A-WiFi".to_string()), 1_000, 10_000),
                (Some("A-WiFi".to_string()), 200_000, 260_000),
            ],
            "超期补记的那段不能与重启后的同网络区间合并"
        );
    }

    /// 退出：保留未闭合区间，只把心跳推到退出时刻（短时间内重开才接得上）
    #[test]
    fn exit_keeps_interval_open_with_advanced_heartbeat() {
        let mut h = History::default();
        h.on_status(1_000, A);
        h.mark_exit(9_000);
        assert!(h.records.is_empty(), "退出不应闭合当前区间");
        let o = h.open.as_ref().unwrap();
        assert_eq!(o.start, 1_000);
        assert_eq!(o.heartbeat, 9_000);
    }

    /// 挂起断开期间退出：挂起状态原样保留，交给重启后的 tick 结算
    #[test]
    fn exit_while_pending_keeps_lost_at() {
        let mut h = History::default();
        h.on_status(1_000, A);
        h.on_status(4_000, None);
        h.mark_exit(9_000);
        assert!(h.records.is_empty());
        let o = h.open.as_ref().unwrap();
        assert_eq!(o.lost_at, Some(4_000));
        assert_eq!(o.heartbeat, 9_000);
    }

    /// 清空：记录清掉，当前连接继续沿用
    #[test]
    fn clear_drops_records_but_keeps_ongoing_interval() {
        let mut h = History::default();
        h.on_status(1_000, A);
        h.on_status(5_000, B);
        h.clear();
        assert!(h.records.is_empty());
        assert_eq!(
            h.open.as_ref().unwrap().ssid.as_deref(),
            Some("B-WiFi"),
            "当前连接应继续沿用"
        );
    }

    /// 窗口裁剪：过期记录在恢复时被裁掉，跨窗口区间在查询时被截断
    #[test]
    fn prune_and_segments_respect_retention_window() {
        let now = 10 * DAY_MS;
        let disk = Disk {
            version: FORMAT_VERSION,
            open: None,
            records: vec![
                // 窗口外（保留 5 天）
                Record {
                    ssid: Some("old".to_string()),
                    start: 1 * DAY_MS,
                    end: 2 * DAY_MS,
                    recovered: false,
                },
                // 跨窗口：起点在窗口外，查询结果应被截断到窗口起点
                Record {
                    ssid: Some("span".to_string()),
                    start: 4 * DAY_MS + DAY_MS / 2,
                    end: 5 * DAY_MS + DAY_MS / 2,
                    recovered: false,
                },
                // 窗口内
                Record {
                    ssid: Some("mid".to_string()),
                    start: 8 * DAY_MS,
                    end: 9 * DAY_MS,
                    recovered: false,
                },
            ],
        };
        let h = History::from_disk(disk, now);
        assert_eq!(
            recs(&h),
            vec![
                (Some("span".to_string()), 4 * DAY_MS + DAY_MS / 2, 5 * DAY_MS + DAY_MS / 2),
                (Some("mid".to_string()), 8 * DAY_MS, 9 * DAY_MS),
            ],
            "窗口外的记录应被裁掉"
        );

        let segs = h.segments(5, now);
        assert_eq!(segs.len(), 2);
        assert_eq!(segs[0].start, 5 * DAY_MS, "跨窗口区间应被截断到窗口起点");
        assert_eq!(segs[1].start, 8 * DAY_MS);
    }

    /// 查询包含进行中的区间：挂起的断开在时间线上已算作未连接
    #[test]
    fn segments_include_ongoing_interval_up_to_now() {
        let mut h = History::default();
        h.on_status(1_000, A);
        h.on_status(5_000, None);
        let segs = h.segments(5, 8_000);
        assert_eq!(segs.len(), 2, "进行中的区间应拆成「已连接」+「未连接」两段");
        assert_eq!(
            (segs[0].ssid.as_deref(), segs[0].start, segs[0].end),
            (Some("A-WiFi"), 1_000, 5_000)
        );
        assert_eq!(
            (segs[1].ssid.is_none(), segs[1].start, segs[1].end),
            (true, 5_000, 8_000)
        );
    }

    /// 落盘往返一致；文件损坏 / 缺失时按空历史处理，不 panic
    #[test]
    fn store_roundtrip_and_corrupt_file_falls_back_to_empty() {
        let dir = std::env::temp_dir().join(format!("srun-history-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(FILE_NAME);
        let tmp = dir.join(format!("{FILE_NAME}.tmp"));

        let mut history = History::default();
        history.on_status(1_000, A);
        history.on_status(5_000, B);
        history.tick(5_000 + HEARTBEAT_MS); // 推进心跳，让恢复时能补出非零长度区间
        let inner = Inner {
            path: path.clone(),
            tmp,
            history,
        };
        inner.save().unwrap();
        assert!(path.exists(), "落盘文件应存在");

        let disk = read_disk(&path);
        assert_eq!(disk.version, FORMAT_VERSION);
        assert_eq!(disk.records.len(), 1);
        assert_eq!(
            disk.open.as_ref().unwrap().ssid.as_deref(),
            Some("B-WiFi"),
            "未闭合区间应随心跳一并持久化"
        );

        // 超过重启宽限期再恢复：1 条已闭合 + 1 条按心跳补记
        let restored =
            History::from_disk(disk, 5_000 + HEARTBEAT_MS + RECONNECT_GRACE_MS + 1_000);
        assert_eq!(recs(&restored).len(), 2);

        // 半截 JSON / 缺失文件：按空历史处理
        fs::write(&path, b"{ this is not json").unwrap();
        assert!(read_disk(&path).records.is_empty());
        assert!(read_disk(&dir.join("missing.json")).records.is_empty());

        let _ = fs::remove_dir_all(&dir);
    }
}
