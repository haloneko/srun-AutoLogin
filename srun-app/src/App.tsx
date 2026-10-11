import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import HeroButton from "./HeroButton";
import SettingsPanel from "./SettingsPanel";
import { IconClose, IconGear, IconRefresh } from "./icons/Icons";
import {
  applyTheme,
  LAST_ONLINE_KEY,
  PASSWORD_KEY,
  readAutostartVersion,
  readSilentStart,
  readStartupMode,
  readSetting,
  readTheme,
  readWifiMode,
  readWifiPassword,
  readWifiSsid,
  toLoginOptions,
  USERNAME_KEY,
  writeAutostartVersion,
  writeLastOnline,
} from "./settings";
import { formatBytes, formatDuration, readCredential } from "./utils";
import type {
  LoginResult,
  OnlineStatus,
  Status,
  ToastItem,
  WifiStatus,
} from "./types";

/// 条形通知停留时长（ms），与进度条动画时长一致
const TOAST_DURATION = 3000;

/// 连上校园网后延迟自动探测的时长（WLAN 事件在关联完成后立即触发，此时 DHCP 可能尚未就绪）
const AUTO_PROBE_DELAY = 3000;
/// 首次自动探测失败（网络栈未就绪）后的重试间隔
const AUTO_PROBE_RETRY_DELAY = 5000;

export default function App() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [info, setInfo] = useState<OnlineStatus | null>(null);
  const [infoError, setInfoError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastId = useRef(0);
  /// 登录成功后延迟查询在线状态的定时器（网关数据同步有延迟）
  const loginCheckTimer = useRef<number | null>(null);
  /// 「未连接时自动连接」模式下，因当前已连在别的网络上而主动跳过切换时，
  /// 记下当时的网络名。此后在线状态查询必然因校园网网关不可达而失败，
  /// 用它把原始报错换成一句能看懂的说明。
  const wifiSkipped = useRef<string | null>(null);
  /// 最近一次 wifi-changed 事件推送的连接状态（驱动「网络」行与切换提示）
  const [wifi, setWifi] = useState<WifiStatus | null>(null);
  /// status 的 ref 镜像：wifi-changed 回调里需读取最新按钮状态做并发判断
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  /// 连上校园网后延迟自动探测的定时器（连接过程事件连续到达，需防抖）
  const autoProbeTimer = useRef<number | null>(null);
  /// 最近一次 wifi-changed 推送的状态（ref 镜像，供回调比较上一次状态判断转变）
  const wifiRef = useRef<WifiStatus | null>(null);

  /// 登录成功后延迟 2s 查询在线状态，若网关尚未同步（仍离线）则每隔 2s 重查，最多 retries 次
  function schedulePostLoginCheck(retries = 3) {
    if (loginCheckTimer.current) {
      window.clearTimeout(loginCheckTimer.current);
    }
    loginCheckTimer.current = window.setTimeout(async () => {
      loginCheckTimer.current = null;
      const s = await refreshStatus(false, true);
      if (s && !s.online && retries > 0) {
        schedulePostLoginCheck(retries - 1);
      }
    }, 2000);
  }

  /// 显示一条条形通知：新的显示在最上方，旧的被顶下去，各自带消失进度条
  function showToast(msg: string) {
    const id = ++toastId.current;
    setToasts((prev) => [{ id, msg }, ...prev]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_DURATION);
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
      setStatus((prev) =>
        s.online
          ? { kind: "success", ip: s.ip, msg: "已在线" }
          : preserveStatus || prev.kind === "loading"
            ? prev
            : { kind: "idle" }
      );
      // 记录最近一次在线状态，供「记录过去状态」启动模式使用
      writeLastOnline(s.online);
      if (notify) showToast(s.online ? "状态已更新" : "状态已更新（离线）");
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
      if (notify) showToast(`刷新失败：${String(err)}`);
      return null;
    } finally {
      setRefreshing(false);
    }
  }

  /// 连上校园网 WiFi：手动点击（`force`）无条件切换；开机启动按设置——`always` 不在目标
  /// 就切，`auto` 仅在完全没连 WiFi 时才切（别合并成同一个条件，否则 `auto` 会强切热点）。
  async function ensureWifi(force = false): Promise<void> {
    const wifiSsid = readWifiSsid();
    if (!wifiSsid) return;
    try {
      const cur = await invoke<{
        connected: boolean;
        ssid: string | null;
      }>("wifi_status");
      const onTarget = cur.connected && (cur.ssid ?? "") === wifiSsid;
      const mode = readWifiMode();
      const need = force || (mode === "always" ? !onTarget : !cur.connected);
      // 只有「未连接时自动连接」+ 已连在别的网络上，才算按设置主动跳过切换
      const skipped =
        !force && mode === "auto" && cur.connected && !onTarget
          ? (cur.ssid ?? "")
          : null;
      wifiSkipped.current = skipped;
      if (!need) {
        if (skipped) {
          showToast(`当前为「${skipped}」，已按设置跳过连接 ${wifiSsid}`);
        }
        return;
      }
      showToast(`正在连接 ${wifiSsid}…`);
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
      autoProbeTimer.current = window.setTimeout(() => {
        autoProbeTimer.current = null;
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
    if (autoProbeTimer.current) {
      window.clearTimeout(autoProbeTimer.current);
      autoProbeTimer.current = null;
    }
    // 登录成功后的延迟重查一并作废：否则它会在网络已变更后把状态球改回「已连接」
    if (loginCheckTimer.current) {
      window.clearTimeout(loginCheckTimer.current);
      loginCheckTimer.current = null;
    }

    if (wifiSsid && curSsid === wifiSsid) {
      // 已连校园网：提示一次，防抖后自动探测并登录
      if (transitioned) showToast(`已连接到校园网「${curSsid}」`);
      autoProbeTimer.current = window.setTimeout(() => {
        autoProbeTimer.current = null;
        void autoProbeAndLogin();
      }, AUTO_PROBE_DELAY);
      return;
    }

    if (curSsid !== null) {
      // 已连其他网络：复位「已连接」显示，避免停留在旧状态
      if (transitioned) {
        setInfo(null);
        setInfoError("");
        setStatus({ kind: "idle" });
        wifiSkipped.current = null;
        showToast(
          wifiSsid
            ? `已连接到其他网络「${curSsid}」，可点击下方按钮切换`
            : `已连接到「${curSsid}」`,
        );
      }
      return;
    }

    // 未连接：复位「已连接」显示与状态球，避免残留上次登录状态
    if (transitioned) {
      setInfo(null);
      setInfoError("");
      setStatus({ kind: "idle" });
      wifiSkipped.current = null;
      showToast("WiFi 已断开");
    }
  }

  // 订阅后端 WLAN 通知：事件仅作「网络有变动」的触发器，到达后主动查询一次
  // 最新状态再走统一入口（事件 payload 在连接完成的瞬间可能滞后，netsh 尚未更新）。
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

  // 应用打开时查询当前在线状态，并按启动模式决定是否自动登录
  useEffect(() => {
    applyTheme(readTheme());
    (async () => {
      // 窗口默认隐藏（tauri.conf.json visible:false）。
      // 手动启动的显示已由后端 setup 直接保证（不依赖前端）；
      // 此处仅处理「开机自启动（--silent）但未开启静默启动」这一种需补显示的情况。
      try {
        const autoLaunch = await invoke<boolean>("is_autostart_launch");
        if (autoLaunch && !readSilentStart()) {
          void getCurrentWindow().show();
        }
      } catch {
        // 查询失败时保持现状：手动启动已由后端显示，自启动保持托盘驻留
      }
    })();
    (async () => {
      // 自启动兼容：老版本写入的 Run 项可能没带 --silent，升级后自启动会弹出主窗口。
      // 当前版本与上次记录的版本不一致才处理——开了自启动就复用插件重写一遍（自动带上参数），
      // 没开则只记版本；用户之后开启时插件写入的本来就是带参数的正确条目。
      // 任一环节失败都不影响主流程，等下次启动再补。
      try {
        const current = await getVersion();
        if (readAutostartVersion() !== current) {
          if (await invoke<boolean>("autostart_enabled")) {
            await invoke("autostart_set", { enable: true });
          }
          writeAutostartVersion(current);
        }
      } catch {
        /* 忽略 */
      }
    })();
    (async () => {
      const mode = readStartupMode();
      const hasCred =
        readCredential(USERNAME_KEY).trim() && readCredential(PASSWORD_KEY);
      // 「记录过去状态」：以上次记录的在线状态为准（先于本次刷新读取）
      const lastOnline = readSetting(LAST_ONLINE_KEY) === "1";
      // 初始化 wifi 状态：WLAN 事件只推送变动，启动时主动查一次，
      // 已连接则经统一入口弹「已连接」提示（启动时无需调度自动探测，登录流程随后进行）
      try {
        const cur = await invoke<WifiStatus>("wifi_status");
        wifiRef.current = cur;
        setWifi(cur);
        if (cur.connected) {
          showToast(`已连接到${cur.ssid ? `「${cur.ssid}」` : "WiFi"}`);
        }
      } catch {
        /* 查询失败保持空状态 */
      }
      // 先确保连上校园网 WiFi，再查在线状态
      await ensureWifi();
      const s = await refreshStatus();
      const shouldAuto =
        hasCred && (mode === "auto" || (mode === "remember" && lastOnline));
      if (s && !s.online && shouldAuto) {
        void handleLogin();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogout() {
    if (status.kind === "loggingOut") return;
    // 取消登录成功后挂起的延迟重查，避免其把状态卡片改回「在线」
    if (loginCheckTimer.current) {
      window.clearTimeout(loginCheckTimer.current);
      loginCheckTimer.current = null;
    }
    setStatus({ kind: "loggingOut" });
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
        setStatus({ kind: "error", msg: res.error_msg || res.error || "注销失败" });
      }
    } catch (err) {
      setStatus({ kind: "error", msg: String(err) });
    }
  }

  function handleButtonClick() {
    if (status.kind === "loading" || status.kind === "loggingOut") return;
    if (status.kind === "success") {
      void handleLogout();
    } else {
      // 手动点击连接：先无条件切到校园网 WiFi（不看设置），再登录
      void handleLogin(true);
    }
  }

  async function handleLogin(wifiFirst = false) {
    if (status.kind === "loading" || status.kind === "loggingOut") return;
    // 手动路径：先切 WiFi 再登录；启动路径（默认 false）已由 ensureWifi(false) 处理
    if (wifiFirst) {
      await ensureWifi(true);
    }
    const username = readCredential(USERNAME_KEY).trim();
    const password = readCredential(PASSWORD_KEY);
    if (!username || !password) {
      setStatus({ kind: "error", msg: "尚未配置账号，请先到设置页填写" });
      return;
    }
    setStatus({ kind: "loading" });
    try {
      const res = (await invoke("srun_login", {
        username,
        password,
        options: toLoginOptions(),
      })) as LoginResult;
      if (res.error === "ok") {
        const ip = res.client_ip || res.online_ip || "";
        setStatus({
          kind: "success",
          ip,
          msg: res.suc_msg || "登录成功",
        });
        showToast("登录成功");
        // 网关数据同步有延迟：延迟 2s 再查询状态栏，离线则自动重查，避免状态卡片停在「离线」
        schedulePostLoginCheck();
      } else {
        setStatus({
          kind: "fail",
          error: res.error,
          msg: res.error_msg || res.error,
        });
      }
    } catch (err) {
      setStatus({ kind: "error", msg: String(err) });
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
      showToast(
        cur?.connected
          ? `当前连接的是「${cur.ssid}」，不是校园网「${targetSsid}」，无法刷新在线状态`
          : "当前未连接 WiFi，无法刷新在线状态",
      );
      return;
    }
    await refreshStatus(true);
  }

  const online = info?.online;

  // 是否连在校园网之外的其他网络：是则展示切换提示条
  const targetSsid = readWifiSsid();
  const wifiOnOther =
    !!wifi && wifi.connected && !!targetSsid && wifi.ssid !== targetSsid;

  return (
    <div className="shell">
      <div className="topbar">
        <button
          type="button"
          className="icon-btn"
          onClick={() => setSettingsOpen(true)}
          title="设置"
          aria-label="设置"
        >
          <IconGear size={20} />
        </button>
        <button
          type="button"
          className={`icon-btn${refreshing ? " icon-btn--spin" : ""}`}
          onClick={() => void handleRefresh()}
          disabled={refreshing}
          title="刷新状态"
          aria-label="刷新状态"
        >
          <IconRefresh size={20} />
        </button>
      </div>
      {toasts.length > 0 && (
        <div className="toast-stack" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className="toast">
              <span className="toast__msg">{t.msg}</span>
              <button
                type="button"
                className="toast__close"
                onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
                aria-label="关闭通知"
              >
                <IconClose size={12} />
              </button>
              <span className="toast__progress" aria-hidden />
            </div>
          ))}
        </div>
      )}

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onToast={showToast}
      />
      <main className="home">
        <HeroButton
          status={status.kind}
          disabled={status.kind === "loading" || status.kind === "loggingOut"}
          onClick={handleButtonClick}
        />

        <section className="status-card" aria-label="网络状态">
          <div className="status-grid">
            <div className="status-item">
              <span className="status-item__label">状态</span>
              <span
                className={`status-item__value status-item__value--${online ? "on" : "off"}`}
              >
                {info ? (online ? "在线" : "离线") : "—"}
              </span>
            </div>
            <div className="status-item">
              <span className="status-item__label">账户</span>
              <span className="status-item__value">{info?.username || "—"}</span>
            </div>
            <div className="status-item">
              <span className="status-item__label">IP 地址</span>
              <span className="status-item__value">{info?.ip || "—"}</span>
            </div>
            <div className="status-item">
              <span className="status-item__label">上线时长</span>
              <span className="status-item__value">
                {info ? formatDuration(info.online_seconds) : "—"}
              </span>
            </div>
            <div className="status-item">
              <span className="status-item__label">已用流量</span>
              <span className="status-item__value">
                {info ? formatBytes(info.total_bytes) : "—"}
              </span>
            </div>
            <div className="status-item">
              <span className="status-item__label">在线设备</span>
              <span className="status-item__value">
                {info ? info.online_devices : "—"}
              </span>
            </div>
          </div>
          {wifi && wifiOnOther && (
            <div className="wifi-hint">
              <span className="wifi-hint__msg">
                当前连接的是「{wifi.ssid}」，不是校园网「{targetSsid}」，单击上方按钮切换
              </span>
            </div>
          )}
          {infoError && <p className="status-card__error">{infoError}</p>}
        </section>
      </main>
    </div>
  );
}
