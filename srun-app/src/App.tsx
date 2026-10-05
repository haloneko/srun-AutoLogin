import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

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

function readCredential(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function statusTitle(status: Status): string {
  switch (status.kind) {
    case "idle":
      return "登录";
    case "loading":
      return "登录中…";
    case "loggingOut":
      return "注销中…";
    case "success":
      return "退出登录";
    case "fail":
      return "登录失败";
    case "error":
      return "出错";
  }
}

function statusHint(status: Status): string {
  switch (status.kind) {
    case "idle":
      return "点击一键登录";
    case "loading":
      return "正在连接认证网关…";
    case "loggingOut":
      return "正在断开连接…";
    case "success":
      return status.ip ? `IP：${status.ip}` : status.msg || "连接成功";
    case "fail":
      return status.msg || status.error;
    case "error":
      return status.msg;
  }
}

function statusIcon(status: Status): string {
  switch (status.kind) {
    case "success":
      return "⇤";
    case "fail":
    case "error":
      return "✕";
    case "loading":
    case "loggingOut":
      return "";
    default:
      return "⏻";
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

  async function refreshStatus() {
    setRefreshing(true);
    try {
      const s = await invoke<OnlineStatus>("srun_status");
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
    } catch (err) {
      setInfoError(String(err));
    } finally {
      setRefreshing(false);
    }
  }

  // 应用打开时从网站查询一次当前在线状态，并同步按钮/信息面板
  useEffect(() => {
    refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogout() {
    if (status.kind === "loggingOut") return;
    setStatus({ kind: "loggingOut" });
    try {
      const res = (await invoke("srun_logout")) as {
        error: string;
        error_msg?: string;
      };
      if (res.error === "ok") {
        // 注销成功后回查真实状态，同步按钮与信息面板
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
      <button
        type="button"
        className={`refresh-btn${refreshing ? " refresh-btn--spin" : ""}`}
        onClick={refreshStatus}
        disabled={refreshing}
        title="刷新状态"
        aria-label="刷新状态"
      >
        ⟳
      </button>
      <main className="home">
        <button
          type="button"
          className={`hero hero--${status.kind}`}
          onClick={handleButtonClick}
          disabled={status.kind === "loading" || status.kind === "loggingOut"}
          title={status.kind === "success" ? "点击退出登录" : "点击登录"}
        >
          {status.kind === "loading" || status.kind === "loggingOut" ? (
            <span className="hero__spinner" aria-hidden />
          ) : (
            <span className="hero__icon" aria-hidden>
              {statusIcon(status)}
            </span>
          )}
          <span className="hero__title">{statusTitle(status)}</span>
          <span className="hero__hint">{statusHint(status)}</span>
        </button>

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
