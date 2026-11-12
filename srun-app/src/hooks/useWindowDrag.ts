import type { MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";


export function useWindowDrag() {
  return function onTitleBarMouseDown(e: MouseEvent<HTMLElement>) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest("button, a, input, select, textarea")) return;
    invoke("start_window_drag").catch(() => {});
  };
}
