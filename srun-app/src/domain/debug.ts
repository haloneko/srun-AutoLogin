//! 调试模式：一个全局开关。
//!
//! 入口先藏在「关于」页的隐藏指令里（↑↑↓↓←→←→ 之后接着敲 haloneko），
//! 打开后具体能做什么还没接——现在只有这个开关本身。
//! 值与其它设置同存 localStorage，并通过订阅 + 跨窗口广播保持一致，
//! 以后任何组件 `useDebugMode()` 就能读到最新状态。

import { readSetting, writeSetting } from "@/domain/settings";

export const DEBUG_MODE_KEY = "srun.debugMode";

const listeners = new Set<() => void>();

let cache: boolean | null = null;

function load(): boolean {
  if (cache === null) cache = readSetting(DEBUG_MODE_KEY) === "1";
  return cache;
}

export function isDebugMode(): boolean {
  return load();
}

export function setDebugMode(on: boolean): boolean {
  const ok = writeSetting(DEBUG_MODE_KEY, on ? "1" : "0");
  cache = on;
  for (const notify of listeners) notify();
  return ok;
}

export function reloadDebugMode() {
  cache = null;
  for (const notify of listeners) notify();
}

export function subscribeDebugMode(notify: () => void): () => void {
  listeners.add(notify);
  return () => listeners.delete(notify);
}
