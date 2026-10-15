import { useMemo, useState } from "react";
import {
  buildDayTicks,
  buildTrack,
  colorMap,
  dayOptions,
  dayWindow,
  DAY_MS,
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

/// 时间条样式：未连接为灰色，其余按调色板取色；补记区段右端加斜纹
function segmentClass(seg: TrackSegment, colors: Map<string, number>): string {
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

/// 网络使用时间线：一条 00:00–24:00 的时间条 + 日期下拉 + 当天累计。
///
/// 横轴固定是一整天，下拉只换「看哪一天」（今天 / 昨天 / 前天 / …）：
/// 一天里的短切换在 24 小时的尺度上很窄，所以每段右端留 1px 缝隙、极短段保底 2px，
/// 免得一整天的记录糊成一坨。悬停某一段可以看到它的起止时刻。
/// 纯展示组件，数据由调用方提供（主窗口与独立窗口共用同一份实现）。
export default function NetworkTimeline({ segments }: NetworkTimelineProps) {
  /// 相对今天的天数偏移：0 = 今天
  const [dayOffset, setDayOffset] = useState(0);
  /// 用来定位「今天」的当前时刻。跟随数据刷新（或切换日期）一起走动。
  const now = useMemo(() => Date.now(), [segments, dayOffset]);
  const options = useMemo(() => dayOptions(HISTORY_DAYS, now), [now]);
  const day = options.find((o) => o.offset === dayOffset) ?? options[0];
  const { from, to } = dayWindow(day.dayStart);

  const track = useMemo(() => buildTrack(segments, from, to), [segments, from, to]);
  const ticks = useMemo(() => buildDayTicks(from), [from]);
  const sums = useMemo(() => totals(segments, from, to), [segments, from, to]);
  const colors = useMemo(() => colorMap(segments), [segments]);
  const grandTotal = sums.reduce((acc, s) => acc + s.total, 0);
  /// 今天的窗口只到此刻：还没到的那段时间既不是「已记录」也不是「状态未知」
  const elapsed = Math.min(now, to) - from;
  const unknown = Math.max(elapsed - grandTotal, 0);
  const futurePct = ((DAY_MS - elapsed) / DAY_MS) * 100;
  /// 设置里配置的校园网 SSID，用于在累计里标记出来
  const campusSsid = readWifiSsid();

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
        <span className="nt-toolbar__meta">
          已记录 {formatSpan(grandTotal)} · 状态未知 {unknown > 0 ? formatSpan(unknown) : "无"}
        </span>
      </div>

      <div className="nt-track">
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
        {track.length === 0 && <span className="nt-track__empty">这一天没有记录</span>}
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
