import { useEffect } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { applyTheme, readTheme, THEME_KEY, writeSetting } from "@/domain/settings";
import type { ThemeMode } from "@/domain/settings";

/// 主题变更广播事件名：窗口之间用它保持外观一致
export const THEME_EVENT = "theme-changed";

export function useThemeSync() {
  useEffect(() => {
    applyTheme(readTheme());
    let unlisten: (() => void) | undefined;
    listen<ThemeMode>(THEME_EVENT, (event) => applyTheme(event.payload))
      .then((fn) => {
        unlisten = fn;
      })
      // 纯浏览器里调试（脱离 Tauri）时没有事件系统，忽略即可
      .catch(() => {});
    return () => unlisten?.();
  }, []);
}

export async function changeTheme(mode: ThemeMode) {
  writeSetting(THEME_KEY, mode);
  applyTheme(mode);
  try {
    await emit(THEME_EVENT, mode);
  } catch {
    /* 非 Tauri 环境（浏览器预览）忽略 */
  }
}
