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

export default function App() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) {
      setStatus({ kind: "error", msg: "请输入账号和密码" });
      return;
    }
    setStatus({ kind: "loading" });
    try {
      const res = (await invoke("srun_login", {
        username: username.trim(),
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
      <div className="card">
        <header className="card__header">
          <div className="logo" aria-hidden>
            <svg viewBox="0 0 24 24" width="28" height="28">
              <path
                fill="currentColor"
                d="M12 21s-6.5-4.35-6.5-9.5A6.5 6.5 0 0 1 12 5a6.5 6.5 0 0 1 6.5 6.5C18.5 16.65 12 21 12 21Zm0-8.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"
              />
            </svg>
          </div>
          <h1>深澜校园网自动登录</h1>
          <p className="subtitle">SRUN Portal</p>
        </header>

        <form className="form" onSubmit={handleLogin}>
          <label className="field">
            <span className="field__label">账号</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="学号 / 工号"
              autoComplete="username"
              autoFocus
            />
          </label>

          <label className="field">
            <span className="field__label">密码</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="登录密码"
              autoComplete="current-password"
            />
          </label>

          <button className="submit" type="submit" disabled={status.kind === "loading"}>
            {status.kind === "loading" ? "登录中…" : "登 录"}
          </button>
        </form>

        {status.kind !== "idle" && (
          <div className={`result result--${status.kind}`}>
            {status.kind === "loading" && <span className="spinner" />}
            {status.kind === "success" && (
              <>
                <strong>登录成功</strong>
                {status.ip && <span>客户端 IP：{status.ip}</span>}
                {status.msg && <span>{status.msg}</span>}
              </>
            )}
            {status.kind === "fail" && (
              <>
                <strong>登录失败（{status.error}）</strong>
                {status.msg && <span>{status.msg}</span>}
              </>
            )}
            {status.kind === "error" && (
              <>
                <strong>出错</strong>
                <span>{status.msg}</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
