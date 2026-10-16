/// 网络使用历史的纯领域逻辑：把后端返回的区间裁剪到当前视窗，换算成时间条并做累计统计。
///
/// 与界面无关，只做时间计算，便于单独推理：时间线只画一条，视窗默认是一整天
/// （00:00–24:00），放大后可以看一天里的某一段；下拉列表只换「看哪一天」，
/// 累计始终按整天算。

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

/// 时间条上的一段（已裁剪到当前视窗内）
export interface TrackSegment {
  ssid: string | null;
  /// 已裁剪到视窗的起止时间
  start: number;
  end: number;
  /// 相对视窗左端的百分比位置（0–100）
  left: number;
  /// 占视窗时长的百分比宽度
  width: number;
}

/// 时间轴上的一条刻度
export interface Tick {
  ts: number;
  /// 相对视窗左端的百分比位置（0–100）
  left: number;
  label: string;
  /// 是否为带文字标签的主刻度；否则只是主刻度之间的细分线
  major: boolean;
}

/// 主刻度的候选步长（毫秒），由细到粗：挑第一个让主刻度数不超 `MAX_TICKS` 的
const TICK_STEPS = [
  60_000, // 1 分
  120_000, // 2 分
  300_000, // 5 分
  900_000, // 15 分
  1_800_000, // 30 分
  HOUR_MS, // 1 时
  2 * HOUR_MS,
  3 * HOUR_MS,
  6 * HOUR_MS,
  12 * HOUR_MS,
  DAY_MS, // 1 天
];
/// 时间轴上最多画几条带标签的主刻度（再多就挤成一片）
const MAX_TICKS = 8;
/// 主刻度之间再细分几格（整天视图靠它保持「每小时一条线」）
const MINOR_DIVISIONS = 3;

/// 把区间裁剪到 [from, to] 视窗并换算成百分比位置（按开始时间正序）。
///
/// 不做合并：后端只在状态真的变化时才落一条记录，前端再合会把真实切换抹掉。
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
      left: ((a - from) / span) * 100,
      width: ((b - a) / span) * 100,
    });
  }
  out.sort((x, y) => x.start - y.start);
  return out;
}

/// 时间刻度：挑一条「整齐」的主步长（整分 / 整刻 / 整时 / 整天），主刻度之间再画细分线。
///
/// 刻度对齐到本地整点或 0 点——视窗从 01:09 开始也不会出现 01:09、02:09 这种脏标签。
/// 整天视图（24 小时）选出的主步长是 3 小时，细分线正好落在每小时，和刻度尺一致。
export function buildTicks(from: number, to: number): Tick[] {
  const span = to - from;
  if (span <= 0) return [];
  const step = TICK_STEPS.find((s) => span / s <= MAX_TICKS) ?? TICK_STEPS[TICK_STEPS.length - 1];
  // 主刻度之间再切细线；切不出整数就只画主刻度
  const minor = step % MINOR_DIVISIONS === 0 ? step / MINOR_DIVISIONS : 0;
  const gap = minor || step;
  // 以左端当天的 0 点为基准对齐，刻度才会落在整齐的本地时刻上
  const base = startOfDay(from);
  /// 视窗右端正好是某天的 0 点（整天视图）：末尾刻度按一天的说法标成 24:00
  const endOfDay = to === startOfDay(to) ? to : null;
  const out: Tick[] = [];
  for (let t = base + Math.ceil((from - base) / gap) * gap; t <= to; t += gap) {
    const major = (t - base) % step === 0;
    out.push({
      ts: t,
      left: ((t - from) / span) * 100,
      major,
      label: !major ? "" : t === endOfDay ? "24:00" : formatClock(t),
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

/// 时间条的悬停说明：网络名 + 起止时刻 + 时长
///
/// 时间线只画一天，区段必定落在同一天内，所以两端只给时刻就够了。
export function segmentTitle(seg: TrackSegment): string {
  const name = seg.ssid ?? "未连接";
  const span = formatSpan(seg.end - seg.start);
  return `${name} ${formatClock(seg.start)}–${formatClock(seg.end)}，${span}`;
}
