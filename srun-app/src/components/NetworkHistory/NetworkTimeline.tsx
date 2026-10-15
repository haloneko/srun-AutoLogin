import { useMemo } from "react";
import {
  buildDays,
  colorMap,
  formatDayLabel,
  formatSpan,
  formatSpanShort,
  HISTORY_DAYS,
  segmentTitle,
  totals,
} from "@/domain/networkHistory";
import type { DaySegment } from "@/domain/networkHistory";
import { readWifiSsid } from "@/domain/settings";
import type { NetworkSegment } from "@/common/types";
import "./NetworkTimeline.css";

interface NetworkTimelineProps {
  segments: NetworkSegment[];
}

/// 时间刻度：每 3 小时一个文字标签（轨道上每小时一条细线、每 6 小时一条粗线）
const SCALE_TICKS = [
  "00:00",
  "03:00",
  "06:00",
  "09:00",
  "12:00",
  "15:00",
  "18:00",
  "21:00",
  "24:00",
];

/// 时间条样式：未连接为灰色，其余按调色板取色；补记区段右端加斜纹
function segmentClass(seg: DaySegment, colors: Map<string, number>): string {
  const base = "nt-seg";
  const recovered = seg.recovered ? " nt-seg--recovered" : "";
  return seg.ssid === null
    ? `${base} nt-seg--off${recovered}`
    : `${base} nt-seg--c${colors.get(seg.ssid) ?? 0}${recovered}`;
}

/// 色块样式（累计卡片与时间条同色）
function swatchClass(ssid: string | null, colors: Map<string, number>): string {
  return ssid === null
    ? "nt-swatch nt-swatch--off"
    : `nt-swatch nt-swatch--c${colors.get(ssid) ?? 0}`;
}

/// 网络使用时间线：每天一行 24 小时时间条 + 近 N 天累计。
/// 纯展示组件，数据由调用方提供（主窗口与独立窗口共用同一份实现）。
export default function NetworkTimeline({ segments }: NetworkTimelineProps) {
  const days = useMemo(() => buildDays(segments), [segments]);
  const sums = useMemo(() => totals(segments), [segments]);
  const colors = useMemo(() => colorMap(segments), [segments]);
  const grandTotal = sums.reduce((acc, s) => acc + s.total, 0);
  /// 设置里配置的校园网 SSID，用于在累计里标记出来
  const campusSsid = readWifiSsid();

  return (
    <div className="nt-root">
      <div className="nt-days">
        {days.map((day) => (
          <div className="nt-day" key={day.dayStart}>
            <span className="nt-day__label">{formatDayLabel(day.dayStart)}</span>
            <div className="nt-day__track">
              {day.segments.map((seg, i) => (
                <span
                  key={`${seg.start}-${i}`}
                  className={segmentClass(seg, colors)}
                  style={{ left: `${seg.left}%`, width: `${seg.width}%` }}
                  title={segmentTitle(seg)}
                />
              ))}
            </div>
            <span className="nt-day__duration">
              {day.covered ? formatSpanShort(day.covered) : "—"}
            </span>
          </div>
        ))}
      </div>

      <div className="nt-scale" aria-hidden>
        <span />
        <div className="nt-scale__ticks">
          {SCALE_TICKS.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
        <span />
      </div>

      <section className="nt-totals">
        <h3 className="nt-totals__title">近 {HISTORY_DAYS} 天累计</h3>
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
                <div className="nt-card__meta">
                  {s.days} 天 · 占比 {pct}%
                </div>
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
