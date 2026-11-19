import { createContext, useContext, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import ThemeLayer from "@/components/theme/ThemeLayer";
import { closeCurrentWindow } from "@/common/window";
import { useThemeSync } from "@/hooks/useThemeSync";
import { useToasts } from "@/hooks/useToasts";
import type { ThemeId } from "@/domain/theme";
import type { ToastItem } from "@/common/types";

interface WindowChrome {
  theme: ThemeId;
  toasts: ToastItem[];
  showToast: (msg: string) => void;
  dismissToast: (id: number) => void;
}

const WindowChromeContext = createContext<WindowChrome | null>(null);

function useChrome(): WindowChrome {
  const chrome = useContext(WindowChromeContext);
  if (!chrome) throw new Error("窗口页面必须渲染在 WindowShell 内");
  return chrome;
}

export function useWindowToast(): (msg: string) => void {
  return useChrome().showToast;
}

export function useWindowTheme(): ThemeId {
  return useChrome().theme;
}

export function useWindowChrome(): WindowChrome {
  return useChrome();
}

interface WindowShellProps {
  closeOnEsc?: boolean;
  children: ReactNode;
}

export default function WindowShell({ closeOnEsc = false, children }: WindowShellProps) {
  const theme = useThemeSync();
  const { toasts, showToast, dismissToast } = useToasts();

  useEffect(() => {
    if (!closeOnEsc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void closeCurrentWindow(showToast);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeOnEsc, showToast]);

  const chrome = useMemo(
    () => ({ theme, toasts, showToast, dismissToast }),
    [theme, toasts, showToast, dismissToast],
  );

  return (
    <WindowChromeContext.Provider value={chrome}>
      <ThemeLayer theme={theme} />
      {children}
    </WindowChromeContext.Provider>
  );
}
