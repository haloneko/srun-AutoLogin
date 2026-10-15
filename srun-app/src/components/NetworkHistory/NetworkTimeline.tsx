import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildTicks,
  buildTrack,
  colorMap,
  dayOptions,
  dayWindow,
  DAY_MS,
  formatClock,
  formatSpan,
  HISTORY_DAYS,
  segmentTitle,
  totals,
} from "@/domain/networkHistory";
import type { TrackSegment } from "@/domain/networkHistory";
import { readWifiSsid } from "@/domain/settings";
import type { NetworkSegment } from "@/common/types";
import "./NetworkTimeline.css";

interface NetworkTimelineProps {
  segments: NetworkSegment[];
}

/// 最小可放大到的视窗：5 分钟（再细就没有能看的区段了）
const MIN_SPAN_MS = 5 * 60_000;
/// 滚轮每一格的缩放倍率
const ZOOM_STEP = 1.4;

/// 当前视窗。`day` 记住它属于哪一天，换了日期就自动回到整天。
interface View {
  day: number;
  start: number;
  span: number;
}

/// 时间条样式：未连接为灰色，其余按调色板取色
function segmentClass(seg: TrackSegment, colors: Map<string, number>): string {
  const base = "nt-seg";
  return seg.ssid === null ? `${base} nt-seg--off` : `${base} nt-seg--c${colors.get(seg.ssid) ?? 0}`;
}

/// 色块样式（累计卡片与时间条同色）
function swatchClass(ssid: string | null, colors: Map<string, number>): string {
  return ssid === null
    ? "nt-swatch nt-swatch--off"
    : `nt-swatch nt-swatch--c${colors.get(ssid) ?? 0}`;
}

/// 网络使用时间线：一条默认 00:00–24:00 的时间条 + 日期下拉 + 当天累计。
///
/// 缩放：滚轮在时间条上滚动，以指针所在的时刻为中心放大 / 缩小（最小 5 分钟，最大整天）。
/// 平移：放大之后左键拖拽时间条，或拖动下方的滑动条。累计始终按整天算，不受视窗影响。
/// 纯展示组件，数据由调用方提供（主窗口与独立窗口共用同一份实现）。
export default function NetworkTimeline({ segments }: NetworkTimelineProps) {
  /// 相对今天的天数偏移：0 = 今天
  const [dayOffset, setDayOffset] = useState(0);
  const [view, setView] = useState<View | null>(null);
  /// 定位「今天」用的当前时刻。跟随数据刷新（或切换日期）一起走动。
  const now = useMemo(() => Date.now(), [segments, dayOffset]);
  const options = useMemo(() => dayOptions(HISTORY_DAYS, now), [now]);
  const day = options.find((o) => o.offset === dayOffset) ?? options[0];
  const { from: dayStart, to: dayEnd } = dayWindow(day.dayStart);

  /// 生效的视窗：没缩放过、或换了日期，就先按整天来
  const active: View =
    view && view.day === dayOffset ? view : { day: dayOffset, start: dayStart, span: DAY_MS };
  const { start, span } = active;
  const end = start + span;
  const canPan = span < DAY_MS;

  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; start: number; width: number } | null>(null);

  /// 把视窗夹在当天之内：既不越出这一天，也不超过 24 小时
  const applyView = useCallback(
    (nextStart: number, nextSpan: number) => {
      const s = Math.min(Math.max(nextSpan, MIN_SPAN_MS), DAY_MS);
      const st = Math.min(Math.max(nextStart, dayStart), dayEnd - s);
      setView({ day: dayOffset, start: st, span: s });
    },
    [dayOffset, dayStart, dayEnd],
  );

  // 滚轮缩放：以指针所在的时刻为锚点，上滚放大、下滚缩小
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // 拦掉页面滚动，否则一滚整个窗口跟着动
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
      const anchor = start + ratio * span;
      const target = e.deltaY < 0 ? span / ZOOM_STEP : span * ZOOM_STEP;
      const next = Math.min(Math.max(target, MIN_SPAN_MS), DAY_MS);
      applyView(anchor - ratio * next, next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [start, span, applyView]);

  const track = useMemo(() => buildTrack(segments, start, end), [segments, start, end]);
  const ticks = useMemo(() => buildTicks(start, end), [start, end]);
  /// 累计按整天算，缩放 / 平移不影响它
  const sums = useMemo(() => totals(segments, dayStart, dayEnd), [segments, dayStart, dayEnd]);
  const colors = useMemo(() => colorMap(segments), [segments]);
  const grandTotal = sums.reduce((acc, s) => acc + s.total, 0);
  /// 今天的窗口只到此刻：还没到的那段时间既不是「已记录」也不是「状态未知」
  const elapsed = Math.min(now, dayEnd) - dayStart;
  const unknown = Math.max(elapsed - grandTotal, 0);
  /// 视窗内「尚未到来」的那一段（只有今天、且视窗越过了此刻时才有）
  const futureFrom = Math.max(now, start);
  const futurePct = end > futureFrom ? ((end - futureFrom) / span) * 100 : 0;
  /// 设置里配置的校园网 SSID，用于在累计里标记出来
  const campusSsid = readWifiSsid();

  const rangeLabel = `${formatClock(start)}–${end === dayEnd ? "24:00" : formatClock(end)}`;

  /// 左键拖拽平移：往右拖＝回到更早的时间
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!canPan || e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    dragRef.current = { x: e.clientX, start, width: rect.width };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    applyView(drag.start - ((e.clientX - drag.x) / drag.width) * span, span);
  }

  function onPointerEnd(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  return (
    <div className="nt-root">
      <div className="nt-toolbar">
        <label className="nt-range">
          <span className="nt-range__label">日期</span>
          <select
            className="nt-range__select"
            value={dayOffset}
            onChange={(e) => setDayOffset(Number(e.target.value))}
          >
            {options.map((o) => (
              <option key={o.offset} value={o.offset}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <span className="nt-toolbar__span" title="当前显示的时间段">
          {rangeLabel}
        </span>
        <span className="nt-toolbar__meta">
          已记录 {formatSpan(grandTotal)} · 状态未知 {unknown > 0 ? formatSpan(unknown) : "无"}
        </span>
      </div>

      <div
        ref={trackRef}
        className={`nt-track${canPan ? " nt-track--pannable" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <div className="nt-grid" aria-hidden>
          {ticks
            .filter((t) => t.left > 0 && t.left < 100)
            .map((t) => (
              <span
                key={t.ts}
                className={t.major ? "nt-grid__major" : undefined}
                style={{ left: `${t.left}%` }}
              />
            ))}
        </div>
        {futurePct > 0 && (
          <span
            className="nt-future"
            style={{ left: `${100 - futurePct}%`, width: `${futurePct}%` }}
            title="尚未到来的时段"
          />
        )}
        {track.map((seg, i) => (
          <span
            key={`${seg.start}-${i}`}
            className={segmentClass(seg, colors)}
            style={{ left: `${seg.left}%`, width: `calc(${seg.width}% - 1px)` }}
            title={segmentTitle(seg)}
          />
        ))}
        {track.length === 0 && <span className="nt-track__empty">这个时段没有记录</span>}
      </div>

      <div className="nt-ticks" aria-hidden>
        {ticks
          .filter((t) => t.major)
          .map((t) => (
            <span
              key={t.ts}
              style={{
                left: `${t.left}%`,
                // 两端的标签贴边对齐，免得「00:00」「24:00」被裁掉一半
                transform: t.left <= 0 ? "none" : t.left >= 100 ? "translateX(-100%)" : undefined,
              }}
            >
              {t.label}
            </span>
          ))}
      </div>

      <div className="nt-pan">
        {canPan && (
          <input
            type="range"
            className="nt-pan__slider"
            aria-label="时间线位置"
            min={0}
            max={DAY_MS - span}
            step={1000}
            value={start - dayStart}
            onChange={(e) => applyView(dayStart + Number(e.target.value), span)}
          />
        )}
      </div>

      <section className="nt-totals">
        <h3 className="nt-totals__title">{day.label}累计</h3>
        <div className="nt-totals__grid">
          {sums.map((s) => {
            const pct = grandTotal ? Math.round((s.total / grandTotal) * 100) : 0;
            return (
              <article className="nt-card" key={s.ssid ?? "__offline"}>
                <header className="nt-card__head">
                  <span className={swatchClass(s.ssid, colors)} />
                  <span className="nt-card__name" title={s.ssid ?? "未连接"}>
                    {s.ssid ?? "未连接"}
                  </span>
                  {s.ssid !== null && s.ssid === campusSsid && (
                    <span className="nt-card__tag">校园网</span>
                  )}
                </header>
                <div className="nt-card__time">{formatSpan(s.total)}</div>
                <div className="nt-card__meta">占比 {pct}%</div>
                <div className="nt-card__bar">
                  <span
                    className={swatchClass(s.ssid, colors)}
                    style={{ width: `${Math.max(pct, 2)}%` }}
                  />
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
