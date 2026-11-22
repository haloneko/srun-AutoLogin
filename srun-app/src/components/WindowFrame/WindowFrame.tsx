import { useEffect, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import TitleBar from "@/components/TitleBar/TitleBar";
import ToastStack from "@/components/Toast/ToastStack";
import { useWindowChrome } from "@/components/WindowShell/WindowShell";
import "./WindowFrame.css";

interface WindowFrameProps {
  title: string;
  className?: string;
  subtitle?: string;
  children: ReactNode;
}

export default function WindowFrame({ title, subtitle, className, children }: WindowFrameProps) {
  const { theme, toasts, showToast, dismissToast } = useWindowChrome();

  useEffect(() => {
    const backgroundColor = getComputedStyle(document.documentElement)
      .getPropertyValue("--bg")
      .trim();
    void invoke<void>("child_window_ready", { backgroundColor }).catch((error) => {
      showToast(`初始化窗口失败：${String(error)}`);
    });
  }, [theme, showToast]);

  return (
    <div className={className ? `wf-root ${className}` : "wf-root"}>
      <TitleBar title={title} subtitle={subtitle} />

      <main className="wf-body">{children}</main>

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
