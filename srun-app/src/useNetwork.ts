import { useEffect, useRef } from "react";
import {
  LAST_ONLINE_KEY,
  PASSWORD_KEY,
  readSetting,
  readStartupMode,
  USERNAME_KEY,
} from "./settings";
import { readCredential } from "./utils";
import { useSession } from "./useSession";
import { useWifi } from "./useWifi";
import type { OnlineStatus, Status, WifiStatus } from "./types";

export interface NetworkApi {
  status: Status;
  info: OnlineStatus | null;
  infoError: string;
  refreshing: boolean;
  wifi: WifiStatus | null;
  wifiOnOther: boolean;
  targetSsid: string | null;
  handleButtonClick: () => void;
  handleRefresh: () => void;
}

/// 组合器：只做装配与跨域编排，不含业务细节。
/// - 装配：把会话域（useSession）与 WiFi 域（useWifi）连接起来；
/// - 编排：大按钮（切换 WiFi → 登录/注销）与启动流程（初始化 → 连 WiFi → 查状态 → 自动登录）。
export function useNetwork(onToast: (msg: string) => void): NetworkApi {
  /// 会话域与 WiFi 域共享的「主动跳过切换」标记（ref 注入两边）
  const wifiSkipped = useRef<string | null>(null);
  const session = useSession(onToast, wifiSkipped);
  const wifi = useWifi(onToast, {
    refreshing: session.refreshing,
    statusRef: session.statusRef,
    refreshStatus: session.refreshStatus,
    handleLogin: session.handleLogin,
    cancelLoginCheck: session.cancelLoginCheck,
    resetPanel: session.resetPanel,
    wifiSkipped,
  });

  /// 大按钮：跨会话 + WiFi 的编排。loading/loggingOut 防重入；已在线 → 注销，
  /// 否则手动触发：直接执行公共 connectWifi（无条件切到校园网），再登录。
  function handleButtonClick() {
    const kind = session.status.kind;
    if (kind === "loading" || kind === "loggingOut") return;
    if (kind === "success") {
      void session.handleLogout();
    } else {
      void (async () => {
        await wifi.connectWifi();
        await session.handleLogin();
      })();
    }
  }

  /// 启动编排：查 wifi 初始态 → 确保连上校园网 → 查在线状态 → 按启动模式自动登录
  useEffect(() => {
    (async () => {
      const mode = readStartupMode();
      const hasCred =
        readCredential(USERNAME_KEY).trim() && readCredential(PASSWORD_KEY);
      // 「记录过去状态」：以上次记录的在线状态为准（先于本次刷新读取）
      const lastOnline = readSetting(LAST_ONLINE_KEY) === "1";
      await wifi.initWifi();
      // 自动触发：按启动模式判断是否需要切换，需要才连接校园网
      await wifi.ensureWifiAuto();
      const s = await session.refreshStatus();
      const shouldAuto =
        hasCred && (mode === "auto" || (mode === "remember" && lastOnline));
      if (s && !s.online && shouldAuto) {
        void session.handleLogin();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    status: session.status,
    info: session.info,
    infoError: session.infoError,
    refreshing: session.refreshing,
    wifi: wifi.wifi,
    wifiOnOther: wifi.wifiOnOther,
    targetSsid: wifi.targetSsid,
    handleButtonClick,
    handleRefresh: wifi.handleRefresh,
  };
}
