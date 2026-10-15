import { useEffect, useMemo, useState } from "react";
import { IconClose, IconRefresh, IconTrash } from "@/components/icons/Icons";
import { useNetworkHistory } from "@/hooks/useNetworkHistory";
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
import "./NetworkHistoryPanel.css";

interface NetworkHistoryPanelProps {
  open: boolean;
  onClose: () => void;
  onToast: (msg: string) => void;
}

/// 时间刻度（每 6 小时一条，与轨道上的分隔线对齐）
const SCALE_TICKS = ["00:00", "06:00", "12:00", "18:00", "24:00"];
/// 打开期间定时刷新间隔：让「进行中」的那一段随时间增长
const AUTO_RELOAD_MS = 60_000;

/// 时间条样式：未连接为灰色，其余按调色板取色；恢复补记的区段右端加斜纹提示
function segmentClass(seg: DaySegment, colors: Map<string, number>): string {
  const base = "history-seg";
  const recovered = seg.recovered ? " history-seg--recovered" : "";
  return seg.ssid === null
    ? `${base} history-seg--off${recovered}`
    : `${base} history-seg--c${colors.get(seg.ssid) ?? 0}${recovered}`;
}

/// 图例圆点样式（与时间条同色）
function dotClass(ssid: string | null, colors: Map<string, number>): string {
  return ssid === null
    ? "history-dot history-dot--off"
    : `history-dot history-dot--c${colors.get(ssid) ?? 0}`;
}

export default function NetworkHistoryPanel({
  open,
  onClose,
  onToast,
}: NetworkHistoryPanelProps) {
  const { segments, loading, reload, clear } = useNetworkHistory(onToast);
  /// 清空需二次确认，避免误触
  const [confirmClear, setConfirmClear] = useState(false);

  // 打开时重新拉取一次并复位确认态
  useEffect(() => {
    if (!open) return;
    setConfirmClear(false);
    void reload();
  }, [open, reload]);

  // 打开期间定时刷新：进行中的区间会随时间增长
  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => void reload(), AUTO_RELOAD_MS);
    return () => window.clearInterval(id);
  }, [open, reload]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const days = useMemo(() => buildDays(segments), [segments]);
  const sums = useMemo(() => totals(segments), [segments]);
  const colors = useMemo(() => colorMap(segments), [segments]);
  const grandTotal = sums.reduce((acc, s) => acc + s.total, 0);
  const hasRecord = days.some((d) => d.covered > 0);

  if (!open) return null;

  return (
    <div className="history-overlay" onClick={onClose}>
      <section
        className="history-card"
        role="dialog"
        aria-label="网络使用历史"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="history-card__header">
          <div className="history-card__titles">
            <h2 className="history-card__title">网络使用历史</h2>
            <p className="history-card__sub">
              近 {HISTORY_DAYS} 天 · 应用运行期间自动记录
            </p>
          </div>
          <button
            type="button"
            className="history-card__close"
            onClick={onClose}
            aria-label="关闭网络使用历史"
          >
            <IconClose size={13} />
          </button>
        </header>

        <div className="history-card__body">
          {loading ? (
            <p className="history-empty">正在读取…</p>
          ) : !hasRecord ? (
            <p className="history-empty">
              还没有记录。应用运行期间会自动记录当前连接的网络，
              连上校园网 WiFi 后回到这里即可看到时间线。
            </p>
          ) : (
            <>
              <div className="history-days">
                {days.map((day) => (
                  <div className="history-day" key={day.dayStart}>
                    <span className="history-day__label">
                      {formatDayLabel(day.dayStart)}
                    </span>
                    <div className="history-day__track">
                      {day.segments.map((seg, i) => (
                        <span
                          key={`${seg.start}-${i}`}
                          className={segmentClass(seg, colors)}
                          style={{ left: `${seg.left}%`, width: `${seg.width}%` }}
                          title={segmentTitle(seg)}
                        />
                      ))}
                    </div>
                    <span className="history-day__duration">
                      {day.covered ? formatSpanShort(day.covered) : "—"}
                    </span>
                  </div>
                ))}
              </div>

              <div className="history-scale" aria-hidden>
                <span />
                <div className="history-scale__ticks">
                  {SCALE_TICKS.map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </div>
                <span />
              </div>

              <div className="history-legend">
                <div className="history-legend__title">近 {HISTORY_DAYS} 天累计</div>
                {sums.map((s) => (
                  <div className="history-legend__row" key={s.ssid ?? "__offline"}>
                    <span className={dotClass(s.ssid, colors)} />
                    <span className="history-legend__name">{s.ssid ?? "未连接"}</span>
                    <span className="history-legend__days">{s.days} 天</span>
                    <span className="history-legend__time">{formatSpan(s.total)}</span>
                    <span className="history-legend__pct">
                      {grandTotal ? Math.round((s.total / grandTotal) * 100) : 0}%
                    </span>
                  </div>
                ))}
                <p className="history-legend__note">
                  空白表示当时应用未运行（状态未知）；带斜纹的区段是异常退出后补记的，
                  结束时间不精确。
                </p>
              </div>
            </>
          )}
        </div>

        <footer className="history-card__footer">
          <button type="button" className="history-btn" onClick={() => void reload()}>
            <IconRefresh size={14} />
            刷新
          </button>
          <button
            type="button"
            className={`history-btn history-btn--danger${confirmClear ? " history-btn--confirm" : ""}`}
            onClick={() => {
              if (!confirmClear) {
                setConfirmClear(true);
                return;
              }
              setConfirmClear(false);
              void clear();
            }}
          >
            <IconTrash size={14} />
            {confirmClear ? "确认清空？" : "清空记录"}
          </button>
        </footer>
      </section>
    </div>
  );
}
