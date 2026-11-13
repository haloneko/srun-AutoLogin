import type { ReactNode } from "react";
import TitleBar from "@/components/TitleBar/TitleBar";
import "./WindowFrame.css";

interface WindowFrameProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  footer?: ReactNode;
  overlay?: ReactNode;
  children: ReactNode;
}

export default function WindowFrame({
  title,
  subtitle,
  actions,
  footer,
  overlay,
  children,
}: WindowFrameProps) {
  return (
    <div className={`wf-root${footer ? " wf-root--with-footer" : ""}`}>
      <TitleBar title={title} subtitle={subtitle} />

      <main className="wf-body">
        {actions && <div className="wf-actions">{actions}</div>}
        {children}
      </main>

      {footer && <footer className="wf-footer">{footer}</footer>}
      {overlay}
    </div>
  );
}
