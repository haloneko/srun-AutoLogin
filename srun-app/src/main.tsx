import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "@/app/App";
import HistoryWindow from "@/app/HistoryWindow";
import SettingsWindow from "@/app/SettingsWindow";
import "@/app/styles.css";

/// 当前窗口 label：主窗口、历史窗口、设置窗口共用同一份前端产物，按此分流渲染。
/// 纯浏览器打开（脱离 Tauri）时按主窗口处理，方便调试。
function windowLabel(): string {
  try {
    return getCurrentWindow().label;
  } catch {
    return "main";
  }
}

const label = windowLabel();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {label === "history" ? (
      <HistoryWindow />
    ) : label === "settings" ? (
      <SettingsWindow />
    ) : (
      <App />
    )}
  </React.StrictMode>
);
