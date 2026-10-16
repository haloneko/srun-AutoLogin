import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { HISTORY_DAYS } from "@/domain/networkHistory";
import type { NetworkSegment } from "@/common/types";

export interface NetworkHistoryApi {
  /// 近 `HISTORY_DAYS` 天的网络区间（时间正序）
  segments: NetworkSegment[];
  /// 首次拉取中（刷新时不置位，避免时间线闪空）
  loading: boolean;
  reload: () => Promise<void>;
  clear: () => Promise<void>;
}

/// 网络使用历史：拉取后端记录的区间，并在网络变动（wifi-changed）后自动刷新。
///
/// `wifi-changed` 只当触发器用，数据一律以后端查询结果为准；
/// 面板未打开时也会保留订阅，打开即为最新数据。
export function useNetworkHistory(onToast: (msg: string) => void): NetworkHistoryApi {
  const [segments, setSegments] = useState<NetworkSegment[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const list = await invoke<NetworkSegment[]>("network_history_get", {
        days: HISTORY_DAYS,
      });
      setSegments(list);
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

  return { segments, loading, reload, clear };
}
