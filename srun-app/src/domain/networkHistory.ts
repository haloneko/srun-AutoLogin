/// 网络使用历史的纯领域逻辑：把后端返回的区间裁剪到「某一天」，换算成时间条并做累计统计。
///
/// 与界面无关，只做时间计算，便于单独推理：时间线只画一条，横轴固定是一整天
/// （00:00–24:00，一天还是 24 小时），下拉列表只换「看哪一天」。

import type { NetworkSegment } from "@/common/types";

/// 一天的毫秒数
export const DAY_MS = 86_400_000;
/// 一小时的毫秒数
export const HOUR_MS = 3_600_000;
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

/// 时间线下拉的选项：最近若干自然日（今天在最前）
export interface DayOption {
  /// 相对今天的天数偏移（0 = 今天，1 = 昨天），用作下拉的取值
  offset: number;
  /// 下拉列表里显示的名字（今天 / 昨天 / 前天 / M/D）
  label: string;
  /// 当天 0 点的时间戳
  dayStart: number;
}

/// 最近 `days` 天的日期选项：每天都是一个完整自然日的窗口
export function dayOptions(days: number = HISTORY_DAYS, now: number = Date.now()): DayOption[] {
  const base = new Date(now);
  base.setHours(0, 0, 0, 0);
  const out: DayOption[] = [];
  for (let offset = 0; offset < days; offset++) {
    // 用日期运算逐天回退，跨夏令时也正确
    const d = new Date(base);
    d.setDate(d.getDate() - offset);
    out.push({ offset, label: formatDayLabel(d.getTime(), now), dayStart: d.getTime() });
  }
  return out;
}

/// 某一天的显示窗口：[当天 0 点, 当天 0 点 + 24 小时)——横轴固定一天，不随「现在」伸缩
///
/// 用固定的 24 小时而不是「次日 0 点」，是为了和刻度线的 24 等分对齐
/// （真实的一天在有夏令时的地区可能是 23/25 小时，国内不存在这种情况）。
export function dayWindow(dayStart: number): { from: number; to: number } {
  return { from: dayStart, to: dayStart + DAY_MS };
}

/// 时间条上的一段（已裁剪到时间窗内）
export interface TrackSegment {
  ssid: string | null;
  /// 已裁剪到窗口的起止时间
  start: number;
  end: number;
  recovered: boolean;
  /// 相对窗口左端的百分比位置（0–100）
  left: number;
  /// 占窗口时长的百分比宽度
  width: number;
}

/// 时间轴上的一条刻度
export interface Tick {
  ts: number;
  /// 相对窗口左端的百分比位置（0–100）
  left: number;
  label: string;
  /// 是否整点「粗」刻度：每 3 小时一条，带文字标签
  major: boolean;
}

/// 把区间裁剪到 [from, to] 窗口并换算成百分比位置（按开始时间正序）。
///
/// 不做合并：后端只在状态真的变化时才落一条记录，`recovered` 的两段也刻意不并，
/// 前端再合会把这些区分抹掉。
export function buildTrack(
  segments: NetworkSegment[],
  from: number,
  to: number,
): TrackSegment[] {
  const span = to - from;
  if (span <= 0) return [];
  const out: TrackSegment[] = [];
  for (const seg of segments) {
    const a = Math.max(seg.start, from);
    const b = Math.min(seg.end, to);
    if (b <= a) continue;
    out.push({
      ssid: seg.ssid,
      start: a,
      end: b,
      recovered: seg.recovered,
      left: ((a - from) / span) * 100,
      width: ((b - a) / span) * 100,
    });
  }
  out.sort((x, y) => x.start - y.start);
  return out;
}

/// 整日时间线的刻度：每小时一条竖线，每 3 小时一条粗线并带时刻标签。
///
/// 横轴固定 24 等分，所以刻度位置直接按小时数算，不受窗口真实长度影响。
export function buildDayTicks(from: number): Tick[] {
  const out: Tick[] = [];
  for (let hour = 0; hour <= 24; hour++) {
    const major = hour % 3 === 0;
    out.push({
      ts: from + hour * HOUR_MS,
      left: (hour / 24) * 100,
      major,
      // 末尾那条是次日的 0 点，按一天的说法标成 24:00
      label: major ? (hour === 24 ? "24:00" : formatClock(from + hour * HOUR_MS)) : "",
    });
  }
  return out;
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

/// 按网络累计 [from, to] 窗口内的时长（降序）；`null`（未连接）始终排在最后
export function totals(segments: NetworkSegment[], from: number, to: number): SsidTotal[] {
  const acc = new Map<string, { total: number; dayKeys: Set<number> }>();
  for (const seg of segments) {
    const a = Math.max(seg.start, from);
    const b = Math.min(seg.end, to);
    if (b <= a) continue;
    // 用 key 区分「未连接」与真实 SSID，避免同名冲突
    const key = seg.ssid === null ? "\u0000offline" : seg.ssid;
    const item = acc.get(key) ?? { total: 0, dayKeys: new Set<number>() };
    item.total += b - a;
    item.dayKeys.add(startOfDay(a));
    // 跨天区间把跨过的每一天都算上
    for (let t = startOfDay(a) + DAY_MS; t <= b; t += DAY_MS) {
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

/// 时间戳 → "M/D HH:MM"（跨天的区段用，避免只看时刻分不清是哪一天）
export function formatStamp(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${formatClock(ts)}`;
}

/// 时间戳 → "HH:MM"（当天内）
export function formatClock(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/// 当天 0 点 → "今天" / "昨天" / "前天" / "M/D"（只保留近几天，不需要年份）
export function formatDayLabel(dayStart: number, now: number = Date.now()): string {
  const base = new Date(now);
  base.setHours(0, 0, 0, 0);
  const names = ["今天", "昨天", "前天"];
  for (let i = 0; i < names.length; i++) {
    // 用日期运算逐天回退，跨夏令时也正确
    const d = new Date(base);
    d.setDate(d.getDate() - i);
    if (dayStart === d.getTime()) return names[i];
  }
  const d = new Date(dayStart);
  return `${d.getMonth() + 1}/${d.getDate()}`;
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
///
/// 区段跨天时两端都带上日期，否则「00:00–23:59」看不出是哪一天。
export function segmentTitle(seg: TrackSegment): string {
  const name = seg.ssid ?? "未连接";
  const span = formatSpan(seg.end - seg.start);
  const crossesDay = startOfDay(seg.start) !== startOfDay(seg.end);
  const fmt = crossesDay ? formatStamp : formatClock;
  const tail = seg.recovered ? "（异常退出，结束时间不确定）" : "";
  return `${name} ${fmt(seg.start)}–${fmt(seg.end)}，${span}${tail}`;
}
