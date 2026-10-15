/// 网络使用历史的纯领域逻辑：把后端返回的区间切成「按天的时间条」并做累计统计。
///
/// 与界面无关，只做时间计算，便于单独推理：跨天区间会被逐天切分，
/// 一天内可能有多段（例如白天连校园网、晚上切热点）。

import type { NetworkSegment } from "@/common/types";

/// 一天的毫秒数
export const DAY_MS = 86_400_000;
/// 时间线展示天数（与后端保留窗口一致）
export const HISTORY_DAYS = 5;
/// 可区分的颜色数量（超过后颜色循环复用）
export const PALETTE_SIZE = 6;

/// 某一天的 0 点（本地时区）
export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/// 一天（本地时区）内的某一格
export interface DaySegment {
  ssid: string | null;
  /// 已裁剪到当天的起止时间
  start: number;
  end: number;
  recovered: boolean;
  /// 相对当天 0 点的百分比位置（0–100）
  left: number;
  /// 占当天时长的百分比宽度
  width: number;
}

/// 时间线上的一行（一天）
export interface DayRow {
  /// 当天 0 点的时间戳
  dayStart: number;
  segments: DaySegment[];
  /// 当天有记录的时长（毫秒）：不含「状态未知」的空档
  covered: number;
}

/// 把区间按天切分并裁剪到 `days` 天窗口内（结果按时间正序，最后一行是今天）
export function buildDays(
  segments: NetworkSegment[],
  days: number = HISTORY_DAYS,
  now: number = Date.now(),
): DayRow[] {
  const rows: DayRow[] = [];
  for (let i = days - 1; i >= 0; i--) {
    // 用日期运算逐天回退，跨夏令时也正确
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    rows.push({ dayStart: d.getTime(), segments: [], covered: 0 });
  }
  if (rows.length === 0) return rows;

  const windowStart = rows[0].dayStart;
  for (const seg of segments) {
    const from = Math.max(seg.start, windowStart);
    const to = Math.min(seg.end, now);
    if (to <= from) continue;
    for (const row of rows) {
      const a = Math.max(from, row.dayStart);
      const b = Math.min(to, row.dayStart + DAY_MS);
      if (b <= a) continue;
      row.segments.push({
        ssid: seg.ssid,
        start: a,
        end: b,
        recovered: seg.recovered,
        left: ((a - row.dayStart) / DAY_MS) * 100,
        width: ((b - a) / DAY_MS) * 100,
      });
      row.covered += b - a;
    }
  }
  return rows;
}

/// 单个网络的累计使用情况
export interface SsidTotal {
  /// `null` 表示「未连接」合计
  ssid: string | null;
  /// 窗口内累计时长（毫秒）
  total: number;
  /// 出现过的天数
  days: number;
}

/// 按网络累计时长（降序）；`null`（未连接）始终排在最后
export function totals(
  segments: NetworkSegment[],
  days: number = HISTORY_DAYS,
  now: number = Date.now(),
): SsidTotal[] {
  const windowStart = startOfDay(now) - (days - 1) * DAY_MS;
  const acc = new Map<string, { total: number; dayKeys: Set<number> }>();
  for (const seg of segments) {
    const from = Math.max(seg.start, windowStart);
    const to = Math.min(seg.end, now);
    if (to <= from) continue;
    // 用 key 区分「未连接」与真实 SSID，避免同名冲突
    const key = seg.ssid === null ? "\u0000offline" : seg.ssid;
    const item = acc.get(key) ?? { total: 0, dayKeys: new Set<number>() };
    item.total += to - from;
    item.dayKeys.add(startOfDay(from));
    // 跨天区间把跨过的每一天都算上
    for (let t = startOfDay(from) + DAY_MS; t <= to; t += DAY_MS) {
      item.dayKeys.add(t);
    }
    acc.set(key, item);
  }

  const list: SsidTotal[] = [...acc.entries()].map(([key, v]) => ({
    ssid: key === "\u0000offline" ? null : key,
    total: v.total,
    days: v.dayKeys.size,
  }));
  list.sort((a, b) => {
    if (a.ssid === null) return 1;
    if (b.ssid === null) return -1;
    return b.total - a.total;
  });
  return list;
}

/// 给出现的网络分配稳定的调色板下标：同名网络在时间线与图例里始终同色
export function colorMap(segments: NetworkSegment[]): Map<string, number> {
  const names = [...new Set(segments.map((s) => s.ssid).filter((s): s is string => !!s))];
  names.sort((a, b) => a.localeCompare(b));
  return new Map(names.map((name, i) => [name, i % PALETTE_SIZE]));
}

/// 时间戳 → "HH:MM"（当天内）
export function formatClock(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/// 当天 0 点 → "今天" / "昨天" / "M/D"（窗口只有 5 天，不需要年份）
export function formatDayLabel(dayStart: number, now: number = Date.now()): string {
  const today = startOfDay(now);
  if (dayStart === today) return "今天";
  if (dayStart === startOfDay(today - DAY_MS)) return "昨天";
  const d = new Date(dayStart);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/// 毫秒 → 紧凑时长（列宽有限）："12时30分" / "45分" / "<1分"
export function formatSpanShort(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins <= 0) return "<1分";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h <= 0) return `${m}分`;
  return m === 0 ? `${h}时` : `${h}时${m}分`;
}

/// 毫秒 → 人类可读时长（用于时间条与图例，精确到分）
export function formatSpan(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins <= 0) return "不足 1 分";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h <= 0) return `${m} 分`;
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`;
}

/// 时间条的悬停说明：网络名 + 起止时刻 + 时长（+ 结束时间不确定的提示）
export function segmentTitle(seg: DaySegment): string {
  const name = seg.ssid ?? "未连接";
  const span = formatSpan(seg.end - seg.start);
  const tail = seg.recovered ? "（异常退出，结束时间不确定）" : "";
  return `${name} ${formatClock(seg.start)}–${formatClock(seg.end)}，${span}${tail}`;
}
