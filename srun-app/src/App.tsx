import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import HeroButton from "./HeroButton";
import SettingsPanel, { readBaseUrl, readStartupMode, writeLastOnline } from "./SettingsPanel";

/// srun_portal 登录响应中的关键字段
interface LoginResult {
  error: string;
  client_ip?: string;
  online_ip?: string;
  suc_msg?: string;
  error_msg?: string;
}

/// srun-core status::OnlineStatus 的镜像
interface OnlineStatus {
  online: boolean;
  username: string;
  ip: string;
  online_seconds: number;
  total_bytes: number;
  online_devices: number;
}

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loggingOut" }
  | { kind: "success"; ip: string; msg: string }
  | { kind: "fail"; error: string; msg: string }
  | { kind: "error"; msg: string };

/// 凭据暂存于 localStorage，将来由设置页写入（与这里约定的 key 保持一致即可）
const CRED_USERNAME_KEY = "srun.username";
const CRED_PASSWORD_KEY = "srun.password";

/// 条形通知停留时长（ms），与进度条动画时长一致
const TOAST_DURATION = 3000;

interface ToastItem {
  id: number;
  msg: string;
}

function readCredential(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

/// 秒 → "x天 x小时" / "x小时 x分" / "x分 x秒"
function formatDuration(secs: number): string {
  if (!secs) return "—";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (d > 0) return `${d}天 ${h}小时`;
  if (h > 0) return `${h}小时 ${m}分`;
  if (m > 0) return `${m}分 ${s}秒`;
  return `${s}秒`;
}

/// 字节 → B / KB / MB / GB（与官网一致，按 1000 进制换算）
function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(2)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(2)} KB`;
  return `${bytes} B`;
}

export default function App() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [info, setInfo] = useState<OnlineStatus | null>(null);
  const [infoError, setInfoError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastId = useRef(0);

  /// 显示一条条形通知：新的显示在最上方，旧的被顶下去，各自带消失进度条
  function showToast(msg: string) {
    const id = ++toastId.current;
    setToasts((prev) => [{ id, msg }, ...prev]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_DURATION);
  }

  async function refreshStatus(notify = false): Promise<OnlineStatus | null> {
    setRefreshing(true);
    try {
      const s = await invoke<OnlineStatus>("srun_status", {
        baseUrl: readBaseUrl(),
      });
      setInfo(s);
      setInfoError("");
      // 大按钮状态与在线状态同步：已在线 →「已登录」；离线 →「登录」
      setStatus((prev) =>
        s.online
          ? { kind: "success", ip: s.ip, msg: "已在线" }
          : prev.kind === "loading"
            ? prev
            : { kind: "idle" }
      );
      // 记录最近一次在线状态，供「记录过去状态」启动模式使用
      writeLastOnline(s.online);
      if (notify) showToast(s.online ? "状态已更新" : "状态已更新（离线）");
      return s;
    } catch (err) {
      setInfoError(String(err));
      if (notify) showToast(`刷新失败：${String(err)}`);
      return null;
    } finally {
      setRefreshing(false);
    }
  }

  // 应用打开时查询当前在线状态，并按启动模式决定是否自动登录
  useEffect(() => {
    (async () => {
      const mode = readStartupMode();
      const hasCred =
        readCredential(CRED_USERNAME_KEY).trim() && readCredential(CRED_PASSWORD_KEY);
      // 「记录过去状态」：以上次记录的在线状态为准（先于本次刷新读取）
      const lastOnline = localStorage.getItem("srun.lastOnline") === "1";
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
    setStatus({ kind: "loggingOut" });
    try {
      const res = (await invoke("srun_logout", { baseUrl: readBaseUrl() })) as {
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
      void handleLogin();
    }
  }

  async function handleLogin() {
    if (status.kind === "loading" || status.kind === "loggingOut") return;
    const username = readCredential(CRED_USERNAME_KEY).trim();
    const password = readCredential(CRED_PASSWORD_KEY);
    if (!username || !password) {
      setStatus({ kind: "error", msg: "尚未配置账号，请先到设置页填写" });
      return;
    }
    setStatus({ kind: "loading" });
    try {
      const res = (await invoke("srun_login", {
        username,
        password,
        baseUrl: readBaseUrl(),
      })) as LoginResult;
      if (res.error === "ok") {
        const ip = res.client_ip || res.online_ip || "";
        setStatus({
          kind: "success",
          ip,
          msg: res.suc_msg || "登录成功",
        });
        refreshStatus();
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

  const online = info?.online;

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
          ⚙
        </button>
        <button
          type="button"
          className={`icon-btn${refreshing ? " icon-btn--spin" : ""}`}
          onClick={() => void refreshStatus(true)}
          disabled={refreshing}
          title="刷新状态"
          aria-label="刷新状态"
        >
          ⟳
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
                ✕
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
          {infoError && <p className="status-card__error">{infoError}</p>}
        </section>
      </main>
    </div>
  );
}
