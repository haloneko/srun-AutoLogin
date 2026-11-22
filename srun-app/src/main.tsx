import React from "react";
import type { ComponentType } from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "@/app/App";
import HistoryWindow from "@/app/HistoryWindow";
import SettingsWindow from "@/app/SettingsWindow";
import ContextMenuHost from "@/components/ContextMenu/ContextMenuHost";
import WindowShell from "@/components/WindowShell/WindowShell";
import { installContextMenu } from "@/app/contextMenu";
import { installSelectionReset } from "@/app/selection";
import { installWindowHover } from "@/common/windowHover";
import "@/app/styles.css";

installSelectionReset();
installContextMenu();
installWindowHover();

/// 当前窗口 label：主窗口、历史窗口、设置窗口共用同一份前端产物，按此分流渲染。
/// 纯浏览器打开（脱离 Tauri）时按主窗口处理，方便调试。
function windowLabel(): string {
  try {
    return getCurrentWindow().label;
  } catch {
    return "main";
  }
}

const ROUTES: Record<string, { Component: ComponentType; closeOnEsc: boolean }> = {
  main: { Component: App, closeOnEsc: false },
  history: { Component: HistoryWindow, closeOnEsc: true },
  settings: { Component: SettingsWindow, closeOnEsc: true },
};

const route = ROUTES[windowLabel()] ?? ROUTES.main;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <WindowShell closeOnEsc={route.closeOnEsc}>
      <route.Component />
    </WindowShell>
    <ContextMenuHost />
  </React.StrictMode>
);
