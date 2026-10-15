import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import NetworkTimeline from "@/components/NetworkHistory/NetworkTimeline";
import ToastStack from "@/components/Toast/ToastStack";
import { IconClose, IconRefresh, IconTrash } from "@/components/icons/Icons";
import { useNetworkHistory } from "@/hooks/useNetworkHistory";
import { useToasts } from "@/hooks/useToasts";
import { applyTheme, readTheme } from "@/domain/settings";
import "./HistoryWindow.css";

/// 打开期间自动刷新间隔：让「进行中」的那一段随时间增长
const AUTO_RELOAD_MS = 30_000;

/// 网络使用历史独立窗口。
///
/// 与主窗口共用同一份前端产物，由 `main.tsx` 按窗口 label 分流到此组件；
/// 主窗口点历史入口后由后端 `open_history_window` 创建（已打开则唤起）。
export default function HistoryWindow() {
  const { toasts, showToast, dismissToast } = useToasts();
  const { segments, loading, reload, clear } = useNetworkHistory(showToast);
  /// 清空需二次确认，避免误触
  const [confirmClear, setConfirmClear] = useState(false);

  // 主题跟随设置（与主窗口共用同一份本地存储）
  useEffect(() => {
    applyTheme(readTheme());
  }, []);

  // 定时刷新（首次拉取由 hook 完成）
  useEffect(() => {
    const id = window.setInterval(() => void reload(), AUTO_RELOAD_MS);
    return () => window.clearInterval(id);
  }, [reload]);

  // Esc 关闭窗口
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeWindow();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /// 关闭本窗口：走应用自身的命令，不依赖窗口插件权限
  async function closeWindow() {
    try {
      await invoke("close_current_window");
    } catch (err) {
      showToast(`关闭窗口失败：${String(err)}`);
    }
  }

  function handleClear() {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setConfirmClear(false);
    void clear();
  }

  return (
    <div className="hw-root">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <header className="hw-header">
        <div className="hw-header__titles">
          <h1 className="hw-header__title">网络使用历史</h1>
          <p className="hw-header__sub">按天查看，横轴固定 00:00–24:00 · 应用运行期间自动记录</p>
        </div>
        <div className="hw-header__actions">
          <button type="button" className="hw-btn" onClick={() => void reload()}>
            <IconRefresh size={15} />
            刷新
          </button>
          <button
            type="button"
            className={`hw-btn hw-btn--danger${confirmClear ? " hw-btn--confirm" : ""}`}
            onClick={handleClear}
          >
            <IconTrash size={15} />
            {confirmClear ? "确认清空？" : "清空记录"}
          </button>
          <button
            type="button"
            className="hw-btn hw-btn--icon"
            onClick={closeWindow}
            title="关闭窗口"
            aria-label="关闭窗口"
          >
            <IconClose size={15} />
          </button>
        </div>
      </header>

      <main className="hw-body">
        {loading ? (
          <p className="hw-empty">正在读取…</p>
        ) : segments.length === 0 ? (
          <p className="hw-empty">
            还没有记录。应用运行期间会自动记录当前连接的网络，
            连上校园网 WiFi 后回到这里即可看到时间线。
          </p>
        ) : (
          <NetworkTimeline segments={segments} />
        )}
      </main>

      <footer className="hw-footer">
        <span className="hw-footer__note">
          空白表示当时应用未运行（状态未知）；斜纹区段是异常退出后补记的，结束时间不精确；今天右端更浅的一段是尚未到来的时段。
        </span>
        <span className="hw-footer__hint">记录仅在应用运行期间产生</span>
      </footer>
    </div>
  );
}
