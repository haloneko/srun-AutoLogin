import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import HeroButton from "@/components/HeroButton/HeroButton";
import SettingsPanel from "@/components/SettingsPanel/SettingsPanel";
import { IconClose, IconGear, IconRefresh } from "@/components/icons/Icons";
import { useNetwork } from "@/hooks/useNetwork";
import { useToasts } from "@/hooks/useToasts";
import {
  applyTheme,
  readAutostartVersion,
  readSilentStart,
  readTheme,
  writeAutostartVersion,
} from "@/domain/settings";
import { formatBytes, formatDuration } from "@/common/utils";

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
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

  // 启动时的非网络初始化：主题、窗口显示（自启动补显）、自启动版本兼容
  useEffect(() => {
    applyTheme(readTheme());
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

  const online = info?.online;

  return (
    <div className="shell">
      <div className="topbar">
        <button
          type="button"
          className="icon-btn"
          onClick={() => setSettingsOpen(true)}
          title="设置"
          aria-label="设置"
        >
          <IconGear size={20} />
        </button>
        <button
          type="button"
          className={`icon-btn${refreshing ? " icon-btn--spin" : ""}`}
          onClick={() => void handleRefresh()}
          disabled={refreshing}
          title="刷新状态"
          aria-label="刷新状态"
        >
          <IconRefresh size={20} />
        </button>
      </div>
      {toasts.length > 0 && (
        <div className="toast-stack" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className="toast">
              <span className="toast__msg">{t.msg}</span>
              <button
                type="button"
                className="toast__close"
                onClick={() => dismissToast(t.id)}
                aria-label="关闭通知"
              >
                <IconClose size={12} />
              </button>
              <span className="toast__progress" aria-hidden />
            </div>
          ))}
        </div>
      )}

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onToast={showToast}
      />
      <main className="home">
        <HeroButton
          status={status.kind}
          disabled={status.kind === "loading" || status.kind === "loggingOut"}
          onClick={handleButtonClick}
        />

        <section className="status-card" aria-label="网络状态">
          <div className="status-grid">
            <div className="status-item">
              <span className="status-item__label">状态</span>
              <span
                className={`status-item__value status-item__value--${online ? "on" : "off"}`}
              >
                {info ? (online ? "在线" : "离线") : "—"}
              </span>
            </div>
            <div className="status-item">
              <span className="status-item__label">账户</span>
              <span className="status-item__value">{info?.username || "—"}</span>
            </div>
            <div className="status-item">
              <span className="status-item__label">IP 地址</span>
              <span className="status-item__value">{info?.ip || "—"}</span>
            </div>
            <div className="status-item">
              <span className="status-item__label">上线时长</span>
              <span className="status-item__value">
                {info ? formatDuration(info.online_seconds) : "—"}
              </span>
            </div>
            <div className="status-item">
              <span className="status-item__label">已用流量</span>
              <span className="status-item__value">
                {info ? formatBytes(info.total_bytes) : "—"}
              </span>
            </div>
            <div className="status-item">
              <span className="status-item__label">在线设备</span>
              <span className="status-item__value">
                {info ? info.online_devices : "—"}
              </span>
            </div>
          </div>
          {wifi && wifiOnOther && (
            <div className="wifi-hint">
              <span className="wifi-hint__msg">
                当前连接的是「{wifi.ssid}」，不是校园网「{targetSsid}」，单击上方按钮切换
              </span>
            </div>
          )}
          {infoError && <p className="status-card__error">{infoError}</p>}
        </section>
      </main>
    </div>
  );
}
