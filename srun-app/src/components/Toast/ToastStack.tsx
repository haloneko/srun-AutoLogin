import { IconClose } from "@/components/icons/Icons";
import type { ToastItem } from "@/common/types";

interface ToastStackProps {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}

/// 左上角通知堆叠（含消失进度条）。主窗口与网络历史窗口共用。
export default function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <span className="toast__msg">{t.msg}</span>
          <button
            type="button"
            className="toast__close"
            onClick={() => onDismiss(t.id)}
            aria-label="关闭通知"
          >
            <IconClose size={12} />
          </button>
          <span className="toast__progress" aria-hidden />
        </div>
      ))}
    </div>
  );
}
