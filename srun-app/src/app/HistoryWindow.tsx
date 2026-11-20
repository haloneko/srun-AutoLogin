import { useEffect, useRef, useState } from "react";
import WindowFrame from "@/components/WindowFrame/WindowFrame";
import NetworkTimeline from "@/components/NetworkHistory/NetworkTimeline";
import { IconRefresh, IconTrash } from "@/components/icons/Icons";
import { useWindowToast } from "@/components/WindowShell/WindowShell";
import { useNetworkHistory } from "@/hooks/useNetworkHistory";
import { usePageVisible } from "@/hooks/usePageVisible";

const AUTO_RELOAD_MS = 60_000;

export default function HistoryWindow() {
  const showToast = useWindowToast();
  const { segments, loading, reload, clear } = useNetworkHistory(showToast);
  const [busy, setBusy] = useState(false);
  const clearDialog = useRef<HTMLDialogElement>(null);
  const visible = usePageVisible();

  useEffect(() => {
    if (!visible) return;
    const id = window.setInterval(() => void reload(), AUTO_RELOAD_MS);
    return () => window.clearInterval(id);
  }, [reload, visible]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  return (
    <WindowFrame title="网络使用历史" className="nt-window">
      <NetworkTimeline
        segments={segments}
        loading={loading}
        actions={
          <div className="nt-actions" role="group" aria-label="历史记录操作">
            <button
              type="button"
              className="nt-icon-btn"
              onClick={() => void run(reload)}
              title="刷新"
              aria-label="刷新"
              disabled={loading || busy}
            >
              <IconRefresh size={16} />
            </button>
            <button
              type="button"
              className="nt-icon-btn nt-icon-btn--danger"
              onClick={() => clearDialog.current?.showModal()}
              title="清空历史记录"
              aria-label="清空历史记录"
              aria-haspopup="dialog"
              disabled={busy || segments.length === 0}
            >
              <IconTrash size={16} />
            </button>
            <dialog
              ref={clearDialog}
              className="nt-dialog"
              aria-labelledby="nt-clear-title"
              aria-describedby="nt-clear-message"
              onKeyDown={(event) => { if (event.key === "Escape") event.stopPropagation(); }}
            >
              <h2 id="nt-clear-title">清空历史记录？</h2>
              <p id="nt-clear-message">已保存的记录将被删除，当前连接会继续记录。</p>
              <form method="dialog">
                <button className="nt-dialog__button" autoFocus>取消</button>
                <button
                  type="button"
                  className="nt-dialog__button nt-dialog__button--danger"
                  onClick={() => {
                    clearDialog.current?.close();
                    void run(clear);
                  }}
                >
                  清空
                </button>
              </form>
            </dialog>
          </div>
        }
      />
    </WindowFrame>
  );
}
