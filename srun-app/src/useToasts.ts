import { useRef, useState } from "react";
import type { ToastItem } from "./types";

/// 条形通知停留时长（ms），与进度条动画时长一致
const TOAST_DURATION = 3000;

/// 条形通知：新的显示在最上方，旧的被顶下去，各自带消失进度条
export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastId = useRef(0);

  function showToast(msg: string) {
    const id = ++toastId.current;
    setToasts((prev) => [{ id, msg }, ...prev]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_DURATION);
  }

  function dismissToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  return { toasts, showToast, dismissToast };
}
