import { useEffect, useState } from "react";
import WindowFrame from "@/components/WindowFrame/WindowFrame";
import NetworkTimeline from "@/components/NetworkHistory/NetworkTimeline";
import { IconRefresh, IconTrash } from "@/components/icons/Icons";
import { useWindowToast } from "@/components/WindowShell/WindowShell";
import { useNetworkHistory } from "@/hooks/useNetworkHistory";
import { usePageVisible } from "@/hooks/usePageVisible";

/// 兜底对时间隔：进行中的区段由本地时钟自己长、切换网络由后端推送，
/// 这里只是低频兜底（事件万一漏掉也能自愈），不承担「实时」职责
const AUTO_RELOAD_MS = 60_000;

export default function HistoryWindow() {
  const showToast = useWindowToast();
  const { segments, loading, reload, clear } = useNetworkHistory(showToast);
  const [confirmClear, setConfirmClear] = useState(false);

  const visible = usePageVisible();

  // 兜底刷新（首次拉取由 hook 完成）
  useEffect(() => {
    if (!visible) return;
    const id = window.setInterval(() => void reload(), AUTO_RELOAD_MS);
    return () => window.clearInterval(id);
  }, [reload, visible]);

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
