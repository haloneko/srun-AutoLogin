import type { ReactNode } from "react";
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
  const { toasts, dismissToast } = useWindowChrome();

  return (
    <div className={className ? `wf-root ${className}` : "wf-root"}>
      <TitleBar title={title} subtitle={subtitle} />

      <main className="wf-body">{children}</main>

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
