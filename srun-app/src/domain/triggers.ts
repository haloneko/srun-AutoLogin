import { readSetting, writeSetting } from "@/domain/settings";

export const TRIGGER_KEY = "srun.triggers";

export type TriggerValues = Record<string, number>;

let cache: TriggerValues | null = null;

const listeners = new Set<() => void>();

function load(): TriggerValues {
  if (cache) return cache;
  let parsed: TriggerValues = {};
  try {
    const raw = readSetting(TRIGGER_KEY);
    const value: unknown = raw ? JSON.parse(raw) : {};
    if (value && typeof value === "object") parsed = value as TriggerValues;
  } catch {
  }
  cache = parsed;
  return cache;
}

function commit(next: TriggerValues) {
  cache = next;
  writeSetting(TRIGGER_KEY, JSON.stringify(next));
  for (const notify of listeners) notify();
}

export function readTriggers(): TriggerValues {
  return load();
}

export function getTrigger(name: string): number {
  return load()[name] ?? 0;
}

export function trigger(name: string, delta = 1) {
  const values = load();
  commit({ ...values, [name]: Math.max(0, (values[name] ?? 0) + delta) });
}

export function setTrigger(name: string, value: number) {
  commit({ ...load(), [name]: Math.max(0, value) });
}

export function resetTriggers() {
  commit({});
}

export function reloadTriggers() {
  cache = null;
  for (const notify of listeners) notify();
}

export function subscribeTriggers(notify: () => void): () => void {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

/// 冬至
function isWinterSolstice(date: Date): boolean {
  return date.getMonth() === 11 && (date.getDate() === 21 || date.getDate() === 22);
}

/// 登录成功后调一次：这次登录算进哪些触发值由这里定，调用方不必关心解锁条件
export function noteLogin(date = new Date()) {
  const values = load();
  const next: TriggerValues = {
    ...values,
    "login.success": (values["login.success"] ?? 0) + 1,
  };
  if (isWinterSolstice(date)) {
    next["login.solstice"] = (values["login.solstice"] ?? 0) + 1;
  }
  commit(next);
}
