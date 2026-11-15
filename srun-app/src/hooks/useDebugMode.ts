import { useEffect, useSyncExternalStore } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { isDebugMode, reloadDebugMode, setDebugMode, subscribeDebugMode } from "@/domain/debug";

/// 调试模式变更广播：主窗口、设置窗口共用同一个开关，改完让别的窗口重读一次
export const DEBUG_EVENT = "debug-mode-changed";

let listening: Promise<void> | undefined;

function ensureListening() {
  if (listening) return;
  listening = listen(DEBUG_EVENT, () => reloadDebugMode())
    .then(() => undefined)
    .catch(() => {
      listening = undefined;
    });
}

export function useDebugMode(): boolean {
  const on = useSyncExternalStore(subscribeDebugMode, isDebugMode);

  useEffect(() => {
    ensureListening();
  }, []);

  return on;
}

export function changeDebugMode(on: boolean): boolean {
  const ok = setDebugMode(on);
  void emit(DEBUG_EVENT, on).catch(() => {});
  return ok;
}
