import { useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import HeroButton from "@/components/HeroButton/HeroButton";
import ThemeLayer from "@/components/theme/ThemeLayer";
import ToastStack from "@/components/Toast/ToastStack";
import { IconGear, IconRefresh, IconTimeline } from "@/components/icons/Icons";
import { useNetwork } from "@/hooks/useNetwork";
import { useThemeSync } from "@/hooks/useThemeSync";
import { useToasts } from "@/hooks/useToasts";
import {
  readAutostartVersion,
  readSilentStart,
  writeAutostartVersion,
} from "@/domain/settings";
import { formatBytes, formatDuration } from "@/common/utils";

export default function App() {
  const { toasts, showToast, dismissToast } = useToasts();
  const {
    status,
    info,
    infoError,
    refreshing,
    wifi,
    wifiOnOther,
    targetSsid,
    handleButtonClick,
    handleRefresh,
  } = useNetwork(showToast);

  const theme = useThemeSync();

  // 启动时的非网络初始化：窗口显示（自启动补显）、自启动版本兼容
  useEffect(() => {
    (async () => {
      // 窗口默认隐藏（tauri.conf.json visible:false）。
      // 手动启动的显示已由后端 setup 直接保证（不依赖前端）；
      // 此处仅处理「开机自启动（--silent）但未开启静默启动」这一种需补显示的情况。
      try {
        const autoLaunch = await invoke<boolean>("is_autostart_launch");
        if (autoLaunch && !readSilentStart()) {
          void getCurrentWindow().show();
        }
      } catch {
        // 查询失败时保持现状：手动启动已由后端显示，自启动保持托盘驻留
      }
    })();
    (async () => {
      // 自启动兼容：老版本写入的 Run 项可能没带 --silent，升级后自启动会弹出主窗口。
      // 当前版本与上次记录的版本不一致才处理——开了自启动就复用插件重写一遍（自动带上参数），
      // 没开则只记版本；用户之后开启时插件写入的本来就是带参数的正确条目。
      // 任一环节失败都不影响主流程，等下次启动再补。
      try {
        const current = await getVersion();
        if (readAutostartVersion() !== current) {
          if (await invoke<boolean>("autostart_enabled")) {
            await invoke("autostart_set", { enable: true });
          }
          writeAutostartVersion(current);
        }
      } catch {
        /* 忽略 */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /// 打开独立的「网络使用历史」窗口（已打开则唤起并聚焦）
  async function openHistory() {
    try {
      await invoke("open_history_window");
    } catch (err) {
      showToast(`打开历史窗口失败：${String(err)}`);
    }
  }

  /// 打开独立的「设置」窗口（已打开则唤起并聚焦）
  async function openSettings() {
    try {
      await invoke("open_settings_window");
    } catch (err) {
      showToast(`打开设置窗口失败：${String(err)}`);
    }
  }

  return (
    <div className="shell">
      <ThemeLayer theme={theme} />
      <div className="topbar">
        <button
          type="button"
          className="icon-btn"
          onClick={() => void openHistory()}
          title="网络使用历史"
          aria-label="网络使用历史"
        >
          <IconTimeline size={15} />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => void openSettings()}
          title="设置"
          aria-label="设置"
        >
          <IconGear size={15} />
        </button>
        <button
          type="button"
          className={`icon-btn${refreshing ? " icon-btn--spin" : ""}`}
          onClick={() => void handleRefresh()}
          disabled={refreshing}
          title="刷新状态"
          aria-label="刷新状态"
        >
          <IconRefresh size={15} />
        </button>
      </div>
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <main className="home">
        <HeroButton
          status={status.kind}
          disabled={status.kind === "loading" || status.kind === "loggingOut"}
          onClick={handleButtonClick}
        />

        <section className="panel" aria-label="网络状态">
          {/* 两个主数字：在线时长 / 已用流量，第一眼就能读到 */}
          <div className="panel__figures">
            <div className="figure">
              <span className="figure__value">
                {info ? formatDuration(info.online_seconds) : "—"}
              </span>
              <span className="figure__label">在线时长</span>
            </div>
            <span className="panel__rule" aria-hidden />
            <div className="figure figure--end">
              <span className="figure__value">
                {info ? formatBytes(info.total_bytes) : "—"}
              </span>
              <span className="figure__label">已用流量</span>
            </div>
          </div>

          <dl className="facts">
            <div className="fact">
              <dt>账户</dt>
              <dd title={info?.username || undefined}>{info?.username || "—"}</dd>
            </div>
            <div className="fact">
              <dt>IP</dt>
              <dd title={info?.ip || undefined}>{info?.ip || "—"}</dd>
            </div>
            <div className="fact">
              <dt>WiFi</dt>
              <dd title={wifi?.ssid ?? undefined}>{wifi?.ssid ?? "—"}</dd>
            </div>
            <div className="fact">
              <dt>设备</dt>
              <dd>{info ? info.online_devices : "—"}</dd>
            </div>
          </dl>

          {wifi && wifiOnOther && (
            <div className="wifi-hint">
              <span className="wifi-hint__msg">
                「{wifi.ssid}」不是校园网「{targetSsid}」，点上方球体切换
              </span>
            </div>
          )}
          {infoError && <p className="panel__error">{infoError}</p>}
        </section>
      </main>
    </div>
  );
}
