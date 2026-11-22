import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import type { NetworkSegment } from "@/common/types";
import { subscribeWindowHoverReset } from "@/common/windowHover";
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
  totals,
} from "@/domain/networkHistory";
import { readWifiSsid } from "@/domain/settings";
import { IconRefresh } from "@/components/icons/Icons";
import "./NetworkTimeline.css";

interface NetworkTimelineProps {
  segments: NetworkSegment[];
  loading?: boolean;
  actions?: ReactNode;
}

const MIN_SPAN_MS = 5 * 60_000;
const WHEEL_ZOOM = 1.4;
const weekdayFormat = new Intl.DateTimeFormat("zh-CN", { weekday: "short" });
const dateFormat = new Intl.DateTimeFormat("zh-CN", { dateStyle: "full" });

interface View {
  dayStart: number;
  start: number;
  span: number;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

function tone(ssid: string | null, colors: Map<string, number>): string {
  return ssid === null ? "nt-tone--offline" : `nt-tone--${colors.get(ssid) ?? 0}`;
}

function Duration({ ms }: { ms: number }) {
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  if (ms > 0 && minutes === 0) return <><strong>&lt; 1</strong><span>分</span></>;
  return (
    <>
      {hours > 0 && <><strong>{hours}</strong><span>小时</span></>}
      <strong>{hours > 0 ? String(minutes % 60).padStart(2, "0") : minutes}</strong><span>分</span>
    </>
  );
}

export default function NetworkTimeline({ segments, loading = false, actions }: NetworkTimelineProps) {
  const [dayOffset, setDayOffset] = useState(0);
  const [view, setView] = useState<View | null>(null);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const [keyRatio, setKeyRatio] = useState<number | null>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointer: number; x: number; start: number; width: number } | null>(null);

  useEffect(() => subscribeWindowHoverReset(() => {
    setHoverRatio(null);
    dragRef.current = null;
  }), []);

  // 进行中的区间随 hook 一起刷新，日期跨过零点时也会重新计算。
  const now = useMemo(() => Date.now(), [segments, dayOffset]);
  const options = useMemo(() => dayOptions(HISTORY_DAYS, now), [now]);
  const { from: dayStart, to: dayEnd } = dayWindow(options[dayOffset].dayStart);
  const { start, span } = view?.dayStart === dayStart ? view : { start: dayStart, span: DAY_MS };
  const end = start + span;
  const zoomed = span < DAY_MS;

  const track = useMemo(() => buildTrack(segments, dayStart, dayEnd), [segments, dayStart, dayEnd]);
  const visibleTrack = track.filter((seg) => seg.end > start && seg.start < end);
  const latest = visibleTrack[visibleTrack.length - 1];
  const canInspect = track.length > 0;
  const ticks = useMemo(() => buildTicks(start, end), [start, end]);
  const sums = useMemo(() => totals(segments, dayStart, dayEnd), [segments, dayStart, dayEnd]);
  const colors = useMemo(() => colorMap(segments), [segments]);
  const connected = sums.reduce((total, s) => total + (s.ssid === null ? 0 : s.total), 0);
  const recorded = sums.reduce((total, s) => total + s.total, 0);
  const campusSsid = readWifiSsid();

  const position = (ts: number) => ((ts - start) / span) * 100;
  const clock = (ts: number) => ts === dayEnd ? "24:00" : formatClock(ts);
  const timeRange = (from: number, to: number) => `${clock(from)} – ${clock(to)}`;
  const nowPosition = dayOffset === 0 ? clamp(position(now), 0, 100) : 100;
  const inspectRatio = hoverRatio ?? keyRatio;
  const cursorTime = Math.min(end - 1, start + span * (inspectRatio ?? 0));
  const inspected = inspectRatio === null
    ? latest
    : visibleTrack.find((seg) => seg.start <= cursorTime && cursorTime < seg.end);
  const isFuture = (inspectRatio === null ? start : cursorTime) >= now;
  const inspectedLabel = inspected ? inspected.ssid ?? "未连接" : isFuture ? "尚未到达" : "未记录";
  const inspectedRange = inspected
    ? timeRange(inspected.start, inspected.end)
    : inspectRatio === null ? timeRange(start, end) : clock(cursorTime);
  const inspectedDuration = inspected ? formatSpan(inspected.end - inspected.start) : null;

  const applyView = useCallback((nextStart: number, nextSpan: number) => {
    const bounded = clamp(nextSpan, MIN_SPAN_MS, DAY_MS);
    setView(bounded === DAY_MS ? null : {
      dayStart,
      start: clamp(nextStart, dayStart, dayEnd - bounded),
      span: bounded,
    });
  }, [dayStart, dayEnd]);

  const zoom = useCallback((factor: number, ratio: number) => {
    const nextSpan = clamp(span * factor, MIN_SPAN_MS, DAY_MS);
    if (nextSpan !== span) applyView(start + (span - nextSpan) * ratio, nextSpan);
  }, [start, span, applyView]);

  // 原生监听器需要 passive:false，滚轮缩放时不带动窗口滚动。
  useEffect(() => {
    const plot = plotRef.current;
    if (!plot || loading) return;
    function onWheel(event: WheelEvent) {
      if (!event.deltaY || !plot) return;
      const rect = plot.getBoundingClientRect();
      const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      const factor = event.deltaY < 0 ? 1 / WHEEL_ZOOM : WHEEL_ZOOM;
      if (clamp(span * factor, MIN_SPAN_MS, DAY_MS) === span) return;
      event.preventDefault();
      zoom(factor, ratio);
    }
    plot.addEventListener("wheel", onWheel, { passive: false });
    return () => plot.removeEventListener("wheel", onWheel);
  }, [loading, span, zoom]);

  function selectDay(offset: number) {
    if (offset === dayOffset) return;
    setDayOffset(offset);
    setView(null);
    setHoverRatio(null);
    setKeyRatio(null);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (loading || !event.isPrimary || event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setHoverRatio(clamp((event.clientX - rect.left) / rect.width, 0, 1));
    if (!zoomed) return;
    dragRef.current = { pointer: event.pointerId, x: event.clientX, start, width: rect.width };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (loading || !event.isPrimary) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setHoverRatio(clamp((event.clientX - rect.left) / rect.width, 0, 1));
    const drag = dragRef.current;
    if (drag?.pointer === event.pointerId) {
      applyView(drag.start - ((event.clientX - drag.x) / drag.width) * span, span);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 };
    const step = steps[event.key];
    if (!step && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    setHoverRatio(null);
    const current = keyRatio ?? (latest ? (Math.max(latest.start, start) + Math.min(latest.end, end) - 2 * start) / (2 * span) : 0);
    setKeyRatio(event.key === "Home" ? 0 : event.key === "End" ? 1 : clamp(current + step / 96, 0, 1));
  }

  const viewLabel = zoomed ? timeRange(start, end) : "全天";
  const cursorAnchor = latest ? (Math.max(latest.start, start) + Math.min(latest.end, end)) / 2 : start + span / 2;
  const showNow = dayOffset === 0 && now >= start && now <= end;

  return (
    <div className="nt-root" aria-busy={loading}>
      <div className="nt-toolbar">
        <div className="nt-dates" role="group" aria-label="选择日期">
          {options.map((day) => {
            const date = new Date(day.dayStart);
            const label = day.offset < 2 ? day.label : weekdayFormat.format(date);
            const month = date.getMonth() + 1;
            const dayOfMonth = String(date.getDate()).padStart(2, "0");
            const isoDate = `${date.getFullYear()}-${String(month).padStart(2, "0")}-${dayOfMonth}`;
            return (
              <button
                type="button"
                key={day.offset}
                className="nt-date"
                aria-pressed={day.offset === dayOffset}
                aria-label={`${label}，${dateFormat.format(date)}`}
                onClick={() => selectDay(day.offset)}
              >
                <span>{label}</span>
                <time dateTime={isoDate}>{month}/{dayOfMonth}</time>
              </button>
            );
          })}
        </div>
        {actions}
      </div>

      <section className="nt-panel" aria-label="连接时间线">
        <header className="nt-panel__head">
          <div className="nt-metric">
            <h2>Wi-Fi 连接时长</h2>
            <div className="nt-metric__value" data-selectable>
              {recorded > 0 ? <Duration ms={connected} /> : <strong aria-label="暂无统计">—</strong>}
            </div>
          </div>
          <div className="nt-viewport" role="group" aria-label="时间线缩放">
            <span className="nt-viewport__range">{viewLabel}</span>
            <button type="button" className="nt-icon-btn" title="缩小" aria-label="缩小" disabled={!zoomed} onClick={() => zoom(2, 0.5)}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8h8" /></svg>
            </button>
            <button type="button" className="nt-icon-btn" title="放大" aria-label="放大" disabled={loading || span <= MIN_SPAN_MS} onClick={() => zoom(0.5, zoomed ? 0.5 : position(cursorAnchor) / 100)}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8h8M8 4v8" /></svg>
            </button>
            <button type="button" className="nt-icon-btn" title="恢复全天" aria-label="恢复全天" disabled={!zoomed} onClick={() => setView(null)}>
              <IconRefresh size={14} />
            </button>
          </div>
        </header>

        <div className="nt-chart">
          <div
            className={`nt-plot${zoomed ? " nt-plot--pannable" : ""}`}
            ref={plotRef}
            role={canInspect ? "slider" : undefined}
            tabIndex={canInspect ? 0 : undefined}
            aria-label={canInspect ? "查看连接时段" : undefined}
            aria-valuemin={canInspect ? 0 : undefined}
            aria-valuemax={canInspect ? 100 : undefined}
            aria-valuenow={canInspect ? Math.round((inspectRatio ?? position(cursorAnchor) / 100) * 100) : undefined}
            aria-valuetext={canInspect ? [inspectedLabel, inspectedRange, inspectedDuration].filter(Boolean).join("，") : undefined}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerLeave={() => setHoverRatio(null)}
            onLostPointerCapture={() => { dragRef.current = null; }}
            onPointerCancel={() => setHoverRatio(null)}
            onKeyDown={onKeyDown}
            onBlur={() => setKeyRatio(null)}
          >
            <div className="nt-plot__layers" aria-hidden="true">
              {nowPosition < 100 && <span className="nt-future" style={{ left: `${nowPosition}%` }} />}
              {ticks.map((tick) => (
                <span key={tick.ts} className={`nt-grid${tick.major ? " nt-grid--major" : ""}`} style={{ left: `${tick.left}%` }} />
              ))}
              <div className="nt-baseline" style={{ width: `${nowPosition}%` }} />
              {visibleTrack.map((seg) => {
                const left = position(Math.max(start, seg.start));
                const right = position(Math.min(end, seg.end));
                return (
                  <span
                    key={seg.start}
                    className={`nt-band ${tone(seg.ssid, colors)}${inspectRatio !== null && inspected === seg ? " nt-band--active" : ""}`}
                    style={{ left: `${left}%`, width: `${right - left}%` }}
                  />
                );
              })}
              {showNow && (
                <>
                  <span className="nt-now" style={{ left: `${nowPosition}%` }} />
                  <span className="nt-now__label" style={{ left: `clamp(18px, ${nowPosition}%, calc(100% - 18px))` }}>现在</span>
                </>
              )}
              {inspectRatio !== null && canInspect && <span className="nt-crosshair" style={{ left: `${inspectRatio * 100}%` }} />}
            </div>
            {!canInspect && <p className="nt-empty" role="status">{loading ? "正在读取…" : "当天暂无记录"}</p>}
          </div>
          <div className="nt-axis" aria-hidden="true">
            {ticks.filter((tick) => tick.major).map((tick) => (
              <span
                key={tick.ts}
                className={tick.left < 3 ? "nt-axis__start" : tick.left > 97 ? "nt-axis__end" : undefined}
                style={{ left: `${tick.left}%` }}
              >
                {tick.label}
              </span>
            ))}
          </div>
          {zoomed && (
            <input
              className="nt-pan"
              type="range"
              aria-label="平移时间线"
              aria-valuetext={viewLabel}
              min={0}
              max={DAY_MS - span}
              step="any"
              value={start - dayStart}
              onChange={(event) => applyView(dayStart + Number(event.target.value), span)}
            />
          )}
        </div>

        {canInspect && (
          <div className="nt-inspect">
            <span className="nt-inspect__label">{inspectRatio !== null ? "所选时段" : latest ? "最近记录" : "当前视窗"}</span>
            <div className="nt-network">
              {inspected && <span className={`nt-swatch ${tone(inspected.ssid, colors)}`} aria-hidden="true" />}
              <span className="nt-network__name" data-selectable title={inspectedLabel}>{inspectedLabel}</span>
            </div>
            <span className="nt-inspect__time" data-selectable>{inspectedRange}</span>
            <span className="nt-inspect__duration" data-selectable>{inspectedDuration}</span>
          </div>
        )}
      </section>

      {sums.length > 0 && (
        <section className="nt-breakdown" aria-labelledby="nt-breakdown-title">
          <h2 id="nt-breakdown-title">按网络统计</h2>
          <table className="nt-summary">
            <thead><tr><th scope="col">网络</th><th scope="col">记录占比</th><th scope="col">时长</th></tr></thead>
            <tbody>
              {sums.map((item) => {
                const name = item.ssid ?? "未连接";
                const color = tone(item.ssid, colors);
                const fraction = item.total / recorded;
                const percent = fraction < 0.01 ? "<1%" : `${Math.round(fraction * 100)}%`;
                return (
                  <tr key={item.ssid === null ? "offline" : `wifi:${item.ssid}`}>
                    <th scope="row">
                      <div className="nt-network">
                        <span className={`nt-swatch ${color}`} aria-hidden="true" />
                        <span className="nt-network__name" data-selectable title={name}>{name}</span>
                        {item.ssid !== null && item.ssid === campusSsid && <span className="nt-campus">校园网</span>}
                      </div>
                    </th>
                    <td>
                      <div className="nt-share">
                        <span className="nt-share__track" aria-hidden="true"><span className={color} style={{ width: `${fraction * 100}%` }} /></span>
                        <span>{percent}</span>
                      </div>
                    </td>
                    <td className="nt-summary__duration" data-selectable>{formatSpan(item.total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
