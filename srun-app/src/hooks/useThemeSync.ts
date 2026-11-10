import { useEffect, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { applyTheme, isThemeUnlocked, readTheme, resolveTheme, saveTheme } from "@/domain/theme";
import type { ThemeId } from "@/domain/theme";

/// 主题变更广播事件名：窗口之间用它保持外观一致
export const THEME_EVENT = "theme-changed";

const subscribers = new Set<(theme: ThemeId) => void>();

let listening: Promise<void> | undefined;
function publish(theme: ThemeId) {
  applyTheme(theme);
  for (const notify of subscribers) notify(theme);
}
function ensureListening() {
  if (listening) return;
  listening = listen<ThemeId>(THEME_EVENT, (event) => publish(event.payload))
    .then(() => undefined)
    .catch(() => {
      listening = undefined;
    });
}
export function useThemeSync(): ThemeId {
  const [theme, setTheme] = useState<ThemeId>(() => readTheme());

  useEffect(() => {
    const current = readTheme();
    publish(current);
    setTheme(current);

    subscribers.add(setTheme);
    ensureListening();
    return () => {
      subscribers.delete(setTheme);
    };
  }, []);

  return theme;
}
export async function changeTheme(id: ThemeId) {
  if (!isThemeUnlocked(resolveTheme(id))) return;
  saveTheme(id);
  publish(id);
  try {
    await emit(THEME_EVENT, id);
  } catch {
    /* 非 Tauri 环境（浏览器预览）忽略 */
  }
}
