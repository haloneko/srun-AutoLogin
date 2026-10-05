import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/// srun_portal 登录响应中的关键字段
interface LoginResult {
  error: string;
  client_ip?: string;
  online_ip?: string;
  suc_msg?: string;
  error_msg?: string;
}

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
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
    case "success":
      return "已登录";
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
      return "✓";
    case "fail":
    case "error":
      return "✕";
    case "loading":
      return "";
    default:
      return "⏻";
  }
}

export default function App() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function handleLogin() {
    if (status.kind === "loading") return;
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

  return (
    <div className="shell">
      <button
        type="button"
        className={`hero hero--${status.kind}`}
        onClick={handleLogin}
        disabled={status.kind === "loading"}
        title="点击登录"
      >
        {status.kind === "loading" ? (
          <span className="hero__spinner" aria-hidden />
        ) : (
          <span className="hero__icon" aria-hidden>
            {statusIcon(status)}
          </span>
        )}
        <span className="hero__title">{statusTitle(status)}</span>
        <span className="hero__hint">{statusHint(status)}</span>
      </button>
    </div>
  );
}
