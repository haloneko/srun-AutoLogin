import { useEffect, useSyncExternalStore } from "react";
import { readTriggers, reloadTriggers, subscribeTriggers } from "@/domain/triggers";
import type { TriggerValues } from "@/domain/triggers";

export function useTriggers(): TriggerValues {
  const values = useSyncExternalStore(subscribeTriggers, readTriggers);

  useEffect(() => {
    const onFocus = () => reloadTriggers();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  return values;
}
