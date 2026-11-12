import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./WindowControls.css";

/// 标题栏上的窗口按钮：最小化 / 最大化·还原 / 关闭，尺寸与悬停反馈对齐系统标题栏。
///
/// 三个动作都走应用自身的命令（关闭后主窗口隐藏到托盘，与其他窗口 × 的行为一致）。
/// 图标用 10×10 的独立字形：系统标题栏的字形就是这么大，套用内容图标会偏大偏粗。
export default function WindowControls() {
  /// 是否已最大化：决定第三个按钮画「最大化」还是「还原」
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let timer = 0;
    let unlisten: (() => void) | undefined;
    let disposed = false;

    function sync() {
      void invoke<boolean>("is_window_maximized")
        .then(setMaximized)
        .catch(() => {});
    }

    try {
      const win = getCurrentWindow();
      sync();

      // 窗口尺寸变化就回查一次状态：Win+↑、拖到屏幕顶端等改状态的操作
      // 都发生在标题栏之外，只能靠事件跟上。连续拖动时压一下频率。
      void win
        .onResized(() => {
          window.clearTimeout(timer);
          timer = window.setTimeout(sync, 120);
        })
        .then((fn) => {
          if (disposed) fn();
          else unlisten = fn;
        })
        .catch(() => {});
    } catch {
      // 脱离 Tauri（纯浏览器预览）时没有窗口 API：按钮点了不响应，界面不崩
    }

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      unlisten?.();
    };
  }, []);

  function minimize() {
    invoke("minimize_current_window").catch(() => {});
  }

  async function toggleMaximize() {
    try {
      setMaximized(await invoke<boolean>("toggle_maximize_window"));
    } catch {
      /* 忽略：按钮点不动不该弹错 */
    }
  }

  function close() {
    invoke("close_current_window").catch(() => {});
  }

  return (
    <div className="wc">
      <button
        type="button"
        className="wc__btn"
        onClick={minimize}
        title="最小化"
        aria-label="最小化"
      >
        <svg className="wc__glyph" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 5h10" />
        </svg>
      </button>
      <button
        type="button"
        className="wc__btn"
        onClick={() => void toggleMaximize()}
        title={maximized ? "还原" : "最大化"}
        aria-label={maximized ? "还原" : "最大化"}
      >
        <svg className="wc__glyph" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          {maximized ? (
            <>
              <path d="M2.5 0.5h7v7" />
              <rect x="0.5" y="2.5" width="7" height="7" />
            </>
          ) : (
            <rect x="0.5" y="0.5" width="9" height="9" />
          )}
        </svg>
      </button>
      <button
        type="button"
        className="wc__btn wc__btn--close"
        onClick={close}
        title="关闭"
        aria-label="关闭"
      >
        <svg className="wc__glyph" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 0l10 10M10 0 0 10" />
        </svg>
      </button>
    </div>
  );
}
