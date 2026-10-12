import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  PASSWORD_KEY,
  readWifiMode,
  readWifiPassword,
  readWifiSsid,
  USERNAME_KEY,
} from "./settings";
import { clearTimer, readCredential, scheduleTimer } from "./utils";
import type { WifiStatus } from "./types";
import type { SessionApi } from "./useSession";

/// 连上校园网后延迟自动探测的时长（WLAN 事件在关联完成后立即触发，此时 DHCP 可能尚未就绪）
const AUTO_PROBE_DELAY = 3000;
/// 首次自动探测失败（网络栈未就绪）后的重试间隔
const AUTO_PROBE_RETRY_DELAY = 5000;

export interface WifiApi {
  wifi: WifiStatus | null;
  wifiOnOther: boolean;
  targetSsid: string | null;
  /// 公共切换操作：无条件连接校园网 WiFi（手动/自动共用执行体）
  connectWifi: () => Promise<void>;
  /// 自动触发入口：按启动模式判断是否需要切换，需要才执行 connectWifi
  ensureWifiAuto: () => Promise<void>;
  /// 手动刷新：先确认连接的是校园网 WiFi 再查询网关，否则提示
  handleRefresh: () => Promise<void>;
  /// 启动时主动查询一次 wifi 状态（WLAN 事件只推送变动，启动需补一次初始态）
  initWifi: () => Promise<void>;
}

/// WiFi 域依赖的会话能力（由 useSession 提供），显式注入避免隐藏闭包依赖
export interface WifiDeps {
  refreshing: boolean;
  statusRef: SessionApi["statusRef"];
  refreshStatus: SessionApi["refreshStatus"];
  handleLogin: SessionApi["handleLogin"];
  cancelLoginCheck: SessionApi["cancelLoginCheck"];
  resetPanel: SessionApi["resetPanel"];
  wifiSkipped: { current: string | null };
}

/// WiFi 域：校园网连接 + 事件监控（wifi-changed 订阅 / 防抖自动探测登录 / 切换提示）+ 手动刷新。
/// 网络变更时通过 resetPanel/cancelLoginCheck 间接复位会话状态，不直接触碰会话内部状态。
export function useWifi(
  onToast: (msg: string) => void,
  deps: WifiDeps,
): WifiApi {
  const {
    refreshing,
    statusRef,
    refreshStatus,
    handleLogin,
    cancelLoginCheck,
    resetPanel,
    wifiSkipped,
  } = deps;
  /// 最近一次 wifi-changed 事件推送的连接状态（驱动「网络」行与切换提示）
  const [wifi, setWifi] = useState<WifiStatus | null>(null);
  /// 最近一次 wifi-changed 推送的状态（ref 镜像，供回调比较上一次状态判断转变）
  const wifiRef = useRef<WifiStatus | null>(null);
  /// 连上校园网后延迟自动探测的定时器（连接过程事件连续到达，需防抖）
  const autoProbeTimer = useRef<number | null>(null);

  /// 公共切换操作：无条件执行「连接校园网 WiFi」（手动与自动共用）。
  /// 只做连接本身与提示，不含「是否需要切换」的判断。
  async function connectWifi(): Promise<void> {
    const wifiSsid = readWifiSsid();
    if (!wifiSsid) return;
    onToast(`正在连接 ${wifiSsid}…`);
    try {
      const res = await invoke<{ connected: boolean; message: string }>(
        "wifi_connect",
        { ssid: wifiSsid, password: readWifiPassword() },
      );
      if (res.connected) {
        await new Promise((r) => setTimeout(r, 3000));
      }
    } catch {
      // WiFi 连接失败不影响后续状态检查与自动登录
    }
  }

  /// 自动触发：先按启动模式判断「是否需要切换」，需要才执行公共 connectWifi。
  /// `always` 不在目标就切；`auto` 仅在完全没连 WiFi 时才切（别合并成同一个条件，否则 `auto` 会强切热点）。
  async function ensureWifiAuto(): Promise<void> {
    const wifiSsid = readWifiSsid();
    if (!wifiSsid) return;
    try {
      const cur = await invoke<{
        connected: boolean;
        ssid: string | null;
      }>("wifi_status");
      const onTarget = cur.connected && (cur.ssid ?? "") === wifiSsid;
      const mode = readWifiMode();
      const need = mode === "always" ? !onTarget : !cur.connected;
      // 只有「未连接时自动连接」+ 已连在别的网络上，才算按设置主动跳过切换
      const skipped =
        mode === "auto" && cur.connected && !onTarget ? (cur.ssid ?? "") : null;
      wifiSkipped.current = skipped;
      if (!need) {
        if (skipped) {
          onToast(`当前为「${skipped}」，已按设置跳过连接 ${wifiSsid}`);
        }
        return;
      }
      await connectWifi();
    } catch {
      // 状态查询失败不切换，不影响后续状态检查与自动登录
    }
  }

  /// 已连上校园网时的自动探测：查一次在线状态，未认证（离线）且已配置凭据则自动登录。
  /// 由 wifi-changed 事件经防抖触发；网络栈未就绪（探测报错）时延迟重试一次。
  async function autoProbeAndLogin(attempt = 0) {
    const kind = statusRef.current.kind;
    // 正在登录 / 注销、或已确认在线：无需动作（登录成功后的延迟重查已在跑）
    if (kind === "loading" || kind === "loggingOut" || kind === "success") return;
    // 连上校园网后不再有「主动跳过切换」的说法，清掉可能残留的跳过标记
    wifiSkipped.current = null;
    const s = await refreshStatus(false, true);
    if (s) {
      if (!s.online) {
        const hasCred =
          readCredential(USERNAME_KEY).trim() && readCredential(PASSWORD_KEY);
        if (hasCred) {
          await handleLogin();
        }
      }
    } else if (attempt < 1) {
      // 网络栈尚未就绪（探测报错）：稍后再试一次
      scheduleTimer(autoProbeTimer, () => {
        void autoProbeAndLogin(1);
      }, AUTO_PROBE_RETRY_DELAY);
    }
  }

  /// 网络变更统一入口。状态只认 ssid：null 即未连接，有值即已连接。
  /// 仅状态转变（连上校园网 / 连上其他 / 断开）时提示一次；
  /// 连上校园网时防抖调度自动探测，未认证自动登录。
  function onWifiChanged(prev: WifiStatus | null, cur: WifiStatus) {
    const wifiSsid = readWifiSsid();
    const prevSsid = prev?.connected ? (prev.ssid ?? null) : null;
    const curSsid = cur.connected ? (cur.ssid ?? null) : null;
    const transitioned = prevSsid !== curSsid;

    // 非校园网状态（断开/连上其他）先取消挂起的自动探测
    clearTimer(autoProbeTimer);
    // 登录成功后的延迟重查一并作废：否则它会在网络已变更后把状态球改回「已连接」
    cancelLoginCheck();

    if (wifiSsid && curSsid === wifiSsid) {
      // 已连校园网：提示一次，防抖后自动探测并登录
      if (transitioned) onToast(`已连接到校园网「${curSsid}」`);
      scheduleTimer(autoProbeTimer, () => {
        void autoProbeAndLogin();
      }, AUTO_PROBE_DELAY);
      return;
    }

    if (curSsid !== null) {
      // 已连其他网络：复位「已连接」显示，避免停留在旧状态
      if (transitioned) {
        resetPanel();
        wifiSkipped.current = null;
        onToast(
          wifiSsid
            ? `已连接到其他网络「${curSsid}」，可点击下方按钮切换`
            : `已连接到「${curSsid}」`,
        );
      }
      return;
    }

    // 未连接：复位「已连接」显示与状态球，避免残留上次登录状态
    if (transitioned) {
      resetPanel();
      wifiSkipped.current = null;
      onToast("WiFi 已断开");
    }
  }

  /// 订阅后端 WLAN 通知：事件仅作「网络有变动」的触发器，到达后主动查询一次
  /// 最新状态再走统一入口（事件 payload 在连接完成的瞬间可能滞后，netsh 尚未更新）。
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<WifiStatus>("wifi-changed", () => {
      void (async () => {
        try {
          const cur = await invoke<WifiStatus>("wifi_status");
          const prev = wifiRef.current;
          wifiRef.current = cur;
          setWifi(cur);
          onWifiChanged(prev, cur);
        } catch {
          /* 查询失败静默 */
        }
      })();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /// 启动时主动查询一次 wifi 状态（WLAN 事件只推送变动），已连接则弹提示
  async function initWifi() {
    try {
      const cur = await invoke<WifiStatus>("wifi_status");
      wifiRef.current = cur;
      setWifi(cur);
      if (cur.connected) {
        onToast(`已连接到${cur.ssid ? `「${cur.ssid}」` : "WiFi"}`);
      }
    } catch {
      /* 查询失败保持空状态 */
    }
  }

  /// 手动刷新：先确认连接的是校园网 WiFi 再查询网关，否则提示，避免白白请求失败
  async function handleRefresh() {
    if (refreshing) return;
    const targetSsid = readWifiSsid();
    // 以实时查询为准（wifi state 可能滞后或为空）
    let cur = wifi;
    try {
      cur = await invoke<WifiStatus>("wifi_status");
      setWifi(cur);
    } catch {
      /* 查询失败则沿用现有 wifi state */
    }
    const onCampus = !!targetSsid && !!cur && cur.connected && cur.ssid === targetSsid;
    if (!onCampus) {
      onToast(
        cur?.connected
          ? `当前连接的是「${cur.ssid}」，不是校园网「${targetSsid}」，无法刷新在线状态`
          : "当前未连接 WiFi，无法刷新在线状态",
      );
      return;
    }
    await refreshStatus(true);
  }

  // 是否连在校园网之外的其他网络：是则展示切换提示条
  const targetSsid = readWifiSsid();
  const wifiOnOther =
    !!wifi && wifi.connected && !!targetSsid && wifi.ssid !== targetSsid;

  return {
    wifi,
    wifiOnOther,
    targetSsid,
    connectWifi,
    ensureWifiAuto,
    handleRefresh,
    initWifi,
  };
}
