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
      <TitleBar />
      <header className="wf-header">
        <div className="wf-header__titles">
          <h1 className="wf-header__title">{title}</h1>
          {subtitle && <p className="wf-header__sub">{subtitle}</p>}
        </div>
        {actions && <div className="wf-header__actions">{actions}</div>}
      </header>

      <main className="wf-body">{children}</main>

      {footer && <footer className="wf-footer">{footer}</footer>}
      {overlay}
    </div>
  );
}
