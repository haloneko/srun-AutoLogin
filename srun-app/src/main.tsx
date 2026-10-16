import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "@/app/App";
import HistoryWindow from "@/app/HistoryWindow";
import "@/app/styles.css";

/// 当前窗口 label：主窗口与网络历史窗口共用同一份前端产物，按此分流渲染。
/// 纯浏览器打开（脱离 Tauri）时按主窗口处理，方便调试。
function windowLabel(): string {
  try {
    return getCurrentWindow().label;
  } catch {
    return "main";
  }
}

const isHistoryWindow = windowLabel() === "history";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isHistoryWindow ? <HistoryWindow /> : <App />}
  </React.StrictMode>
);
