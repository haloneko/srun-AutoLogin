import { useEffect, useReducer, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  PASSWORD_KEY,
  toLoginOptions,
  USERNAME_KEY,
  writeLastOnline,
} from "@/domain/settings";
import { clearTimer, readCredential, scheduleTimer } from "@/common/utils";
import type { LoginResult, OnlineStatus, Status } from "@/common/types";
import { statusReducer } from "@/domain/status";

export interface SessionApi {
  status: Status;
  info: OnlineStatus | null;
  infoError: string;
  refreshing: boolean;
  /// status 的 ref 镜像：事件回调里需读取最新按钮状态做并发判断
  statusRef: { current: Status };
  /// 刷新在线信息面板。`preserveStatus=true` 时离线结果不改动大按钮状态
  /// （用于登录刚成功时：网关数据可能尚未同步，避免把「登录成功」覆盖回「未登录」）。
  refreshStatus: (
    notify?: boolean,
    preserveStatus?: boolean,
  ) => Promise<OnlineStatus | null>;
  /// 纯登录（不负责切 WiFi，调用方需确保已连校园网）
  handleLogin: () => Promise<void>;
  handleLogout: () => Promise<void>;
  /// 作废登录成功后挂起的延迟重查（网络变更/注销时调用）
  cancelLoginCheck: () => void;
  /// 复位状态面板与大按钮（切换到其他网络/断开时调用）
  resetPanel: () => void;
}

/// 会话域：大按钮状态机（statusReducer）+ 在线状态面板 + 登录/注销/查询。
/// 只依赖注入的 onToast 与 wifiSkipped 跳过标记，不触碰 WiFi/事件订阅。
export function useSession(
  onToast: (msg: string) => void,
  wifiSkipped: { current: string | null },
): SessionApi {
  const [status, dispatch] = useReducer(statusReducer, { kind: "idle" });
  const [info, setInfo] = useState<OnlineStatus | null>(null);
  const [infoError, setInfoError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  /// status 的 ref 镜像：事件回调里需读取最新按钮状态做并发判断
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  /// 登录成功后延迟查询在线状态的定时器（网关数据同步有延迟）
  const loginCheckTimer = useRef<number | null>(null);

  /// 登录成功后延迟 2s 查询在线状态，若网关尚未同步（仍离线）则每隔 2s 重查，最多 retries 次
  function schedulePostLoginCheck(retries = 3) {
    scheduleTimer(loginCheckTimer, () => {
      void (async () => {
        const s = await refreshStatus(false, true);
        if (s && !s.online && retries > 0) {
          schedulePostLoginCheck(retries - 1);
        }
      })();
    }, 2000);
  }

  /// 刷新在线信息面板。`preserveStatus=true` 时离线结果不改动大按钮状态
  /// （用于登录刚成功时：网关数据可能尚未同步，避免把「登录成功」覆盖回「未登录」）；
  /// 已在线则始终同步状态球。
  async function refreshStatus(
    notify = false,
    preserveStatus = false,
  ): Promise<OnlineStatus | null> {
    setRefreshing(true);
    try {
      const s = await invoke<OnlineStatus>("srun_status", {
        options: toLoginOptions(),
      });
      setInfo(s);
      setInfoError("");
      // 查询成功说明校园网可达，之前记录的「主动跳过」不再适用
      wifiSkipped.current = null;
      // 大按钮状态与在线状态同步：已在线 →「已连接」；离线 →「未登录」
      // preserveStatus 仅保护「离线」结果（登录刚成功网关未同步时不被覆盖），已在线始终更新
      if (s.online) {
        dispatch({ type: "set", status: { kind: "success", ip: s.ip, msg: "已在线" } });
      } else if (!preserveStatus && statusRef.current.kind !== "loading") {
        dispatch({ type: "idle" });
      }
      // 记录最近一次在线状态，供「记录过去状态」启动模式使用
      writeLastOnline(s.online);
      if (notify) onToast(s.online ? "状态已更新" : "状态已更新（离线）");
      return s;
    } catch (err) {
      // 若是「未连接时自动连接」模式下主动跳过了切换，网关不可达属于预期内：
      // 替换掉原始报错，避免用户以为自己哪里配错了。
      const skipped = wifiSkipped.current;
      setInfoError(
        skipped
          ? `当前连接的是「${skipped}」，不是校园网，已按设置跳过自动切换；需要登录校园网时点击上方按钮即可。`
          : String(err),
      );
      if (notify) onToast(`刷新失败：${String(err)}`);
      return null;
    } finally {
      setRefreshing(false);
    }
  }

  function cancelLoginCheck() {
    clearTimer(loginCheckTimer);
  }

  /// 复位状态面板与大按钮（切换到其他网络/断开时调用），避免残留上次登录状态
  function resetPanel() {
    setInfo(null);
    setInfoError("");
    dispatch({ type: "idle" });
  }

  async function handleLogout() {
    if (status.kind === "loggingOut") return;
    // 取消登录成功后挂起的延迟重查，避免其把状态卡片改回「在线」
    cancelLoginCheck();
    dispatch({ type: "set", status: { kind: "loggingOut" } });
    try {
      const res = (await invoke("srun_logout", {
        options: toLoginOptions(),
      })) as {
        error: string;
        error_msg?: string;
      };
      if (res.error === "ok") {
        // 注销成功后间隔 0.5s 再回查真实状态，等待网关侧状态刷新
        await new Promise((r) => setTimeout(r, 500));
        await refreshStatus();
      } else {
        dispatch({
          type: "set",
          status: { kind: "error", msg: res.error_msg || res.error || "注销失败" },
        });
      }
    } catch (err) {
      dispatch({ type: "set", status: { kind: "error", msg: String(err) } });
    }
  }

  async function handleLogin() {
    if (status.kind === "loading" || status.kind === "loggingOut") return;
    const username = readCredential(USERNAME_KEY).trim();
    const password = readCredential(PASSWORD_KEY);
    if (!username || !password) {
      dispatch({ type: "set", status: { kind: "error", msg: "尚未配置账号，请先到设置页填写" } });
      return;
    }
    dispatch({ type: "set", status: { kind: "loading" } });
    try {
      const res = (await invoke("srun_login", {
        username,
        password,
        options: toLoginOptions(),
      })) as LoginResult;
      if (res.error === "ok") {
        const ip = res.client_ip || res.online_ip || "";
        dispatch({
          type: "set",
          status: { kind: "success", ip, msg: res.suc_msg || "登录成功" },
        });
        onToast("登录成功");
        // 网关数据同步有延迟：延迟 2s 再查询状态栏，离线则自动重查，避免状态卡片停在「离线」
        schedulePostLoginCheck();
      } else {
        dispatch({
          type: "set",
          status: {
            kind: "fail",
            error: res.error,
            msg: res.error_msg || res.error,
          },
        });
      }
    } catch (err) {
      dispatch({ type: "set", status: { kind: "error", msg: String(err) } });
    }
  }

  return {
    status,
    info,
    infoError,
    refreshing,
    statusRef,
    refreshStatus,
    handleLogin,
    handleLogout,
    cancelLoginCheck,
    resetPanel,
  };
}
