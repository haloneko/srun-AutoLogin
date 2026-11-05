import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { HISTORY_DAYS } from "@/domain/networkHistory";
import type { NetworkSegment } from "@/common/types";

const LIVE_TICK_MS = 1_000;
const ONGOING_TOLERANCE_MS = 10_000;

export interface NetworkHistoryApi {
  segments: NetworkSegment[];
  loading: boolean;
  reload: () => Promise<void>;
  clear: () => Promise<void>;
}

function hasOngoing(list: NetworkSegment[], syncedAt: number): boolean {
  const last = list[list.length - 1];
  if (!last || last.recovered) return false;
  return syncedAt - last.end <= ONGOING_TOLERANCE_MS;
}

function advanceOngoing(list: NetworkSegment[], now: number): NetworkSegment[] {
  const last = list[list.length - 1];
  if (!last || last.end >= now) return list;
  return [...list.slice(0, -1), { ...last, end: now }];
}

/// 网络使用历史：拉取后端记录的区间，并在网络变动（wifi-changed）后自动刷新。
///
/// `wifi-changed` 只当触发器用，数据一律以后端查询结果为准；
/// 面板未打开时也会保留订阅，打开即为最新数据。
export function useNetworkHistory(onToast: (msg: string) => void): NetworkHistoryApi {
  const [data, setData] = useState<NetworkSegment[]>([]);
  const [syncedAt, setSyncedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const list = await invoke<NetworkSegment[]>("network_history_get", {
        days: HISTORY_DAYS,
      });
      setData(list);
      setSyncedAt(Date.now());
      setNow(Date.now());
    } catch {
      /* 查询失败保持上一次数据 */
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(async () => {
    try {
      await invoke("network_history_clear");
      await reload();
      onToast("网络使用历史已清空（当前连接继续记录）");
    } catch (err) {
      onToast(`清空失败：${String(err)}`);
    }
  }, [reload, onToast]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /// 网络变动后刷新时间线（连上 / 断开 / 切换都会带出新的一段）
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen("wifi-changed", () => {
      void reload();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [reload]);

  const ongoing = useMemo(() => hasOngoing(data, syncedAt), [data, syncedAt]);
  useEffect(() => {
    if (!ongoing) return;
    const id = window.setInterval(() => setNow(Date.now()), LIVE_TICK_MS);
    return () => window.clearInterval(id);
  }, [ongoing]);

  const segments = useMemo(
    () => (ongoing ? advanceOngoing(data, now) : data),
    [ongoing, data, now],
  );

  return { segments, loading, reload, clear };
}
