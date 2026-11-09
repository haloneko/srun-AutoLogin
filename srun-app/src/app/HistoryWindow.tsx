import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import WindowFrame from "@/components/WindowFrame/WindowFrame";
import NetworkTimeline from "@/components/NetworkHistory/NetworkTimeline";
import ToastStack from "@/components/Toast/ToastStack";
import { IconRefresh, IconTrash } from "@/components/icons/Icons";
import { useNetworkHistory } from "@/hooks/useNetworkHistory";
import { useThemeSync } from "@/hooks/useThemeSync";
import { useToasts } from "@/hooks/useToasts";

/// 兜底对时间隔：进行中的区段由本地时钟自己长、切换网络由后端推送，
/// 这里只是低频兜底（事件万一漏掉也能自愈），不承担「实时」职责
const AUTO_RELOAD_MS = 60_000;

/// 网络使用历史独立窗口。
///
/// 与主窗口、设置窗口共用同一份前端产物，由 `main.tsx` 按窗口 label 分流到此组件；
/// 主窗口点历史入口后由后端 `open_history_window` 创建（已打开则唤起）。
export default function HistoryWindow() {
  const { toasts, showToast, dismissToast } = useToasts();
  const { segments, loading, reload, clear } = useNetworkHistory(showToast);
  /// 清空需二次确认，避免误触
  const [confirmClear, setConfirmClear] = useState(false);

  // 主题跟随设置，并在设置窗口改动时同步
  useThemeSync();

  // 兜底刷新（首次拉取由 hook 完成）
  useEffect(() => {
    const id = window.setInterval(() => void reload(), AUTO_RELOAD_MS);
    return () => window.clearInterval(id);
  }, [reload]);

  // Esc 关闭窗口
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void closeWindow();
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
    <WindowFrame
      title="网络使用历史"
      actions={
        <>
          <button
            type="button"
            className="wf-btn wf-btn--icon"
            onClick={() => void reload()}
            title="刷新"
            aria-label="刷新"
          >
            <IconRefresh size={15} />
          </button>
          <button
            type="button"
            className={`wf-btn wf-btn--danger${confirmClear ? " wf-btn--confirm" : " wf-btn--icon"}`}
            onClick={handleClear}
            title="清空历史记录"
          >
            <IconTrash size={15} />
            {confirmClear && <span>确认清空？</span>}
          </button>
        </>
      }
      footer={
        <>
          <span className="wf-footer__note">实时记录中…</span>
          <span className="wf-footer__hint">滚轮缩放 · 左键拖拽或滑动条平移</span>
        </>
      }
      overlay={<ToastStack toasts={toasts} onDismiss={dismissToast} />}
    >
      {loading ? (
        <p className="wf-empty">正在读取…</p>
      ) : segments.length === 0 ? (
        <p className="wf-empty">
          还没有记录。应用运行期间会自动记录当前连接的网络，
          连上校园网 WiFi 后回到这里即可看到时间线。
        </p>
      ) : (
        <NetworkTimeline segments={segments} />
      )}
    </WindowFrame>
  );
}
