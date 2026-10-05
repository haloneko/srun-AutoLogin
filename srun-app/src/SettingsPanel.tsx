import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./SettingsPanel.css";

const CRED_USERNAME_KEY = "srun.username";
const CRED_PASSWORD_KEY = "srun.password";
const BASE_URL_KEY = "srun.baseUrl";
const STARTUP_MODE_KEY = "srun.startupMode";
const LAST_ONLINE_KEY = "srun.lastOnline";

export const DEFAULT_BASE_URL = "https://wlrz.sdmu.edu.cn/";

export type StartupMode = "auto" | "manual" | "remember";

const STARTUP_OPTIONS: { value: StartupMode; label: string; desc: string }[] = [
  { value: "auto", label: "自动连接", desc: "打开软件后自动登录" },
  { value: "manual", label: "不自动连接", desc: "打开后仅查看状态，需手动登录" },
  { value: "remember", label: "记录过去状态", desc: "上次在线则自动重连，否则不连" },
];

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function readBaseUrl(): string {
  return read(BASE_URL_KEY) || DEFAULT_BASE_URL;
}

export function readStartupMode(): StartupMode {
  const v = read(STARTUP_MODE_KEY);
  return v === "auto" || v === "manual" || v === "remember" ? v : "manual";
}

/// 记录最近一次在线状态，供「记录过去状态」模式在下次启动时判断
export function writeLastOnline(online: boolean) {
  try {
    localStorage.setItem(LAST_ONLINE_KEY, online ? "1" : "0");
  } catch {
    /* 忽略 */
  }
}

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  onToast: (msg: string) => void;
}

export default function SettingsPanel({ open, onClose, onToast }: SettingsPanelProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [startupMode, setStartupMode] = useState<StartupMode>("manual");
  const [autostart, setAutostart] = useState(false);
  const [autostartLoading, setAutostartLoading] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  // 各输入框「已保存」的基线，用于判断是否有未提交修改（显示 ✓/✗）
  const [savedUsername, setSavedUsername] = useState("");
  const [savedPassword, setSavedPassword] = useState("");
  const [savedBaseUrl, setSavedBaseUrl] = useState(DEFAULT_BASE_URL);

  // 打开抽屉时载入已保存的值，并查询开机自启动状态
  useEffect(() => {
    if (!open) return;
    const u = read(CRED_USERNAME_KEY);
    const p = read(CRED_PASSWORD_KEY);
    const b = read(BASE_URL_KEY) || DEFAULT_BASE_URL;
    setUsername(u);
    setPassword(p);
    setBaseUrl(b);
    setSavedUsername(u);
    setSavedPassword(p);
    setSavedBaseUrl(b);
    setStartupMode(readStartupMode());
    setShowPwd(false);
    invoke<boolean>("autostart_enabled")
      .then(setAutostart)
      .catch(() => setAutostart(false));
  }, [open]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function toggleAutostart(next: boolean) {
    if (autostartLoading) return;
    setAutostartLoading(true);
    const prev = autostart;
    setAutostart(next);
    try {
      await invoke("autostart_set", { enable: next });
      onToast(next ? "已开启开机自启动" : "已关闭开机自启动");
    } catch (err) {
      setAutostart(prev);
      onToast(`开机自启动设置失败：${String(err)}`);
    } finally {
      setAutostartLoading(false);
    }
  }

  function writeValue(key: string, value: string, okMsg: string): boolean {
    try {
      localStorage.setItem(key, value);
      onToast(okMsg);
      return true;
    } catch {
      onToast("保存失败：本地存储不可用");
      return false;
    }
  }

  function confirmUsername() {
    const u = username.trim();
    if (!u) {
      onToast("请填写用户名");
      return;
    }
    if (!writeValue(CRED_USERNAME_KEY, u, "用户名已保存")) return;
    setUsername(u);
    setSavedUsername(u);
  }

  function confirmPassword() {
    if (!password) {
      onToast("密码不能为空");
      return;
    }
    if (!writeValue(CRED_PASSWORD_KEY, password, "密码已保存")) return;
    setSavedPassword(password);
  }

  function confirmBaseUrl() {
    const u = baseUrl.trim();
    if (!/^https?:\/\/.+/i.test(u)) {
      onToast("服务器地址需以 http(s):// 开头");
      return;
    }
    if (!writeValue(BASE_URL_KEY, u, "服务器地址已保存")) return;
    setBaseUrl(u);
    setSavedBaseUrl(u);
  }

  if (!open) return null;

  const usernameDirty = username !== savedUsername;
  const passwordDirty = password !== savedPassword;
  const baseUrlDirty = baseUrl.trim() !== savedBaseUrl;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <aside
        className="settings-drawer"
        role="dialog"
        aria-label="设置"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="settings-drawer__header">
          <h2 className="settings-drawer__title">设置</h2>
          <button
            type="button"
            className="settings-drawer__close"
            onClick={onClose}
            aria-label="关闭设置"
          >
            ✕
          </button>
        </header>

        <div className="settings-drawer__body">
          <section className="settings-section">
            <h3 className="settings-section__title">账号</h3>
            <p className="settings-section__desc">用于校园网认证，仅保存在本机。</p>
            <label className="settings-field">
              <span className="settings-field__label">用户名</span>
              <span className="settings-field__row">
                <input
                  className="settings-field__input"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="学号 / 工号"
                  autoComplete="username"
                />
                {usernameDirty && (
                  <span className="settings-field__actions">
                    <button
                      type="button"
                      className="settings-field__confirm"
                      onClick={confirmUsername}
                      aria-label="确认保存用户名"
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      className="settings-field__cancel"
                      onClick={() => setUsername(savedUsername)}
                      aria-label="撤销用户名修改"
                    >
                      ✕
                    </button>
                  </span>
                )}
              </span>
            </label>
            <label className="settings-field">
              <span className="settings-field__label">密码</span>
              <span className="settings-field__row">
                <input
                  className="settings-field__input"
                  type={showPwd ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="settings-field__eye"
                  onClick={() => setShowPwd((v) => !v)}
                  aria-label={showPwd ? "隐藏密码" : "显示密码"}
                >
                  {showPwd ? "🙈" : "👁"}
                </button>
                {passwordDirty && (
                  <span className="settings-field__actions">
                    <button
                      type="button"
                      className="settings-field__confirm"
                      onClick={confirmPassword}
                      aria-label="确认保存密码"
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      className="settings-field__cancel"
                      onClick={() => setPassword(savedPassword)}
                      aria-label="撤销密码修改"
                    >
                      ✕
                    </button>
                  </span>
                )}
              </span>
            </label>
          </section>

          <section className="settings-section">
            <h3 className="settings-section__title">认证服务器</h3>
            <p className="settings-section__desc">
              深澜网关地址，一般不需要改动；更换学校 / 测试环境时再调整。
            </p>
            <label className="settings-field">
              <span className="settings-field__label">服务器地址</span>
              <span className="settings-field__row">
                <input
                  className="settings-field__input"
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder={DEFAULT_BASE_URL}
                  spellCheck={false}
                />
                {baseUrlDirty && (
                  <span className="settings-field__actions">
                    <button
                      type="button"
                      className="settings-field__confirm"
                      onClick={confirmBaseUrl}
                      aria-label="确认保存服务器地址"
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      className="settings-field__cancel"
                      onClick={() => setBaseUrl(savedBaseUrl)}
                      aria-label="撤销服务器地址修改"
                    >
                      ✕
                    </button>
                  </span>
                )}
              </span>
            </label>
          </section>

          <section className="settings-section">
            <h3 className="settings-section__title">通用</h3>
            <label className="settings-field settings-field--row">
              <span className="settings-field__label">
                开机自启动
                <span className="settings-field__hint">开机后自动运行本程序</span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={autostart}
                className={`settings-switch${autostart ? " settings-switch--on" : ""}`}
                onClick={() => void toggleAutostart(!autostart)}
              >
                <span className="settings-switch__knob" />
              </button>
            </label>
            <div className="settings-field">
              <span className="settings-field__label">启动时行为</span>
              <div className="settings-options">
                {STARTUP_OPTIONS.map((o) => (
                  <label
                    key={o.value}
                    className={`settings-option${startupMode === o.value ? " settings-option--on" : ""}`}
                  >
                    <input
                      type="radio"
                      name="startup-mode"
                      className="settings-option__radio"
                      checked={startupMode === o.value}
                      onChange={() => {
                        setStartupMode(o.value);
                        writeValue(STARTUP_MODE_KEY, o.value, `启动行为已设为「${o.label}」`);
                      }}
                    />
                    <span className="settings-option__label">{o.label}</span>
                    <span className="settings-option__desc">{o.desc}</span>
                  </label>
                ))}
              </div>
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}
