// WebView 隐藏时可能保留上一次命中的元素，移动指针后再允许 :hover。
const HOVER_ATTRIBUTE = "data-window-hover";
const resetListeners = new Set<() => void>();

export function resetWindowHover(): void {
  document.documentElement.removeAttribute(HOVER_ATTRIBUTE);
  for (const listener of resetListeners) listener();
}

export function subscribeWindowHoverReset(listener: () => void): () => void {
  resetListeners.add(listener);
  return () => {
    resetListeners.delete(listener);
  };
}

export function installWindowHover(): void {
  const root = document.documentElement;
  let lastX: number | undefined;
  let lastY: number | undefined;

  window.addEventListener("pointermove", (event) => {
    if (document.hidden || event.pointerType === "touch") return;
    const moved = event.screenX !== lastX || event.screenY !== lastY;
    lastX = event.screenX;
    lastY = event.screenY;
    if (moved && !root.hasAttribute(HOVER_ATTRIBUTE)) root.setAttribute(HOVER_ATTRIBUTE, "");
  }, { capture: true, passive: true });
  window.addEventListener("blur", resetWindowHover);
  document.addEventListener("visibilitychange", resetWindowHover);
}
