import type { ReactNode } from "react";
import "./WindowFrame.css";

interface WindowFrameProps {
  /// 窗口标题
  title: string;
  /// 标题下的一句说明（可选）
  subtitle?: string;
  /// 右上角操作区（按钮组）
  actions?: ReactNode;
  /// 底部信息条（可选）：有页脚时通知会自动上移，避免遮挡
  footer?: ReactNode;
  /// 浮层（通知堆叠等）：挂在窗口根节点上、不参与布局，位置由窗口统一控制
  overlay?: ReactNode;
  /// 主体内容，自动成为滚动区
  children: ReactNode;
}

/// 独立窗口的通用骨架：标题栏 + 可滚动主体 + 可选页脚。
///
/// 「网络使用历史」与「设置」共用这一套，两个窗口不必各自实现一遍排版、
/// 按钮与页脚样式；通知堆叠的位置也统一在这里处理。
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
