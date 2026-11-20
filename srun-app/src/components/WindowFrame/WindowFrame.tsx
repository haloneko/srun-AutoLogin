import type { ReactNode } from "react";
import TitleBar from "@/components/TitleBar/TitleBar";
import ToastStack from "@/components/Toast/ToastStack";
import { useWindowChrome } from "@/components/WindowShell/WindowShell";
import "./WindowFrame.css";

interface WindowFrameProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export default function WindowFrame({ title, subtitle, actions, children }: WindowFrameProps) {
  const { toasts, dismissToast } = useWindowChrome();

  return (
    <div className="wf-root">
      <TitleBar title={title} subtitle={subtitle} />

      <main className="wf-body">
        {actions && <div className="wf-actions">{actions}</div>}
        {children}
      </main>

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
