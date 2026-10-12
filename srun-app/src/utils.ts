/// 秒 → "x天 x小时" / "x小时 x分" / "x分 x秒"
export function formatDuration(secs: number): string {
  if (!secs) return "—";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (d > 0) return `${d}天 ${h}小时`;
  if (h > 0) return `${h}小时 ${m}分`;
  if (m > 0) return `${m}分 ${s}秒`;
  return `${s}秒`;
}

/// 字节 → B / KB / MB / GB（与官网一致，按 1000 进制换算）
export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(2)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(2)} KB`;
  return `${bytes} B`;
}

/// 读取 localStorage 中的凭据（异常时返回空串，不抛错）
export function readCredential(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

/// 取消定时器：安全清空 ref
export function clearTimer(ref: { current: number | null }) {
  if (ref.current !== null) {
    window.clearTimeout(ref.current);
    ref.current = null;
  }
}

/// 挂起定时器：先取消旧的同名定时器，触发后自动清空 ref
export function scheduleTimer(
  ref: { current: number | null },
  fn: () => void,
  delay: number,
) {
  clearTimer(ref);
  ref.current = window.setTimeout(() => {
    ref.current = null;
    fn();
  }, delay);
}
