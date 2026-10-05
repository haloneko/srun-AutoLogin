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
  const [dirty, setDirty] = useState(false);

  // 打开抽屉时载入已保存的值，并查询开机自启动状态
  useEffect(() => {
    if (!open) return;
    setUsername(read(CRED_USERNAME_KEY));
    setPassword(read(CRED_PASSWORD_KEY));
    setBaseUrl(read(BASE_URL_KEY) || DEFAULT_BASE_URL);
    setStartupMode(readStartupMode());
    setShowPwd(false);
    setDirty(false);
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

  function save() {
    const u = username.trim();
    if (!u) {
      onToast("请填写用户名");
      return;
    }
    if (!/^https?:\/\/.+/i.test(baseUrl.trim())) {
      onToast("服务器地址需以 http(s):// 开头");
      return;
    }
    try {
      localStorage.setItem(CRED_USERNAME_KEY, u);
      localStorage.setItem(CRED_PASSWORD_KEY, password);
      localStorage.setItem(BASE_URL_KEY, baseUrl.trim() || DEFAULT_BASE_URL);
      localStorage.setItem(STARTUP_MODE_KEY, startupMode);
      setDirty(false);
      onToast("设置已保存");
    } catch {
      onToast("保存失败：本地存储不可用");
    }
  }

  if (!open) return null;

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
              <input
                className="settings-field__input"
                type="text"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setDirty(true);
                }}
                placeholder="学号 / 工号"
                autoComplete="username"
              />
            </label>
            <label className="settings-field">
              <span className="settings-field__label">密码</span>
              <span className="settings-field__row">
                <input
                  className="settings-field__input"
                  type={showPwd ? "text" : "password"}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setDirty(true);
                  }}
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
              <input
                className="settings-field__input"
                type="text"
                value={baseUrl}
                onChange={(e) => {
                  setBaseUrl(e.target.value);
                  setDirty(true);
                }}
                placeholder={DEFAULT_BASE_URL}
                spellCheck={false}
              />
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
                        setDirty(true);
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

        <footer className="settings-drawer__footer">
          <button
            type="button"
            className={`settings-save${dirty ? " settings-save--active" : ""}`}
            onClick={save}
          >
            保存设置
          </button>
        </footer>
      </aside>
    </div>
  );
}
