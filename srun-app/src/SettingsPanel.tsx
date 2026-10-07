import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./SettingsPanel.css";

const CRED_USERNAME_KEY = "srun.username";
const CRED_PASSWORD_KEY = "srun.password";
const BASE_URL_KEY = "srun.baseUrl";
const AC_ID_KEY = "srun.acId";
const ENC_VER_KEY = "srun.encVer";
const THEME_KEY = "srun.theme";
const STARTUP_MODE_KEY = "srun.startupMode";
const LAST_ONLINE_KEY = "srun.lastOnline";

export const DEFAULT_BASE_URL = "https://wlrz.sdmu.edu.cn/";
export const DEFAULT_AC_ID = "1";
export const DEFAULT_ENC_VER = "srun_bx1";

export type StartupMode = "auto" | "manual" | "remember";

export type ThemeMode = "system" | "light" | "dark";

const THEME_OPTIONS: { value: ThemeMode; label: string; desc: string }[] = [
  { value: "system", label: "跟随系统", desc: "根据系统外观自动切换" },
  { value: "light", label: "浅色", desc: "始终使用浅色主题" },
  { value: "dark", label: "深色", desc: "始终使用深色主题" },
];

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

export function readAcId(): string {
  return read(AC_ID_KEY) || DEFAULT_AC_ID;
}

export function readEncVer(): string {
  return read(ENC_VER_KEY) || DEFAULT_ENC_VER;
}

export function readTheme(): ThemeMode {
  const v = read(THEME_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

/// 将主题应用到 <html> 的 data-theme 属性：light / dark 强制，system 删除属性（跟随系统）
export function applyTheme(theme: ThemeMode) {
  const el = document.documentElement;
  if (theme === "light" || theme === "dark") {
    el.dataset.theme = theme;
  } else {
    delete el.dataset.theme;
  }
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
  const [acId, setAcId] = useState("");
  const [encVer, setEncVer] = useState("");
  const [theme, setTheme] = useState<ThemeMode>("system");
  const [startupMode, setStartupMode] = useState<StartupMode>("manual");
  const [autostart, setAutostart] = useState(false);
  const [autostartLoading, setAutostartLoading] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  // 各输入框「已保存」的基线，用于判断是否有未提交修改（显示 ✓/✗）
  const [savedUsername, setSavedUsername] = useState("");
  const [savedPassword, setSavedPassword] = useState("");
  const [savedBaseUrl, setSavedBaseUrl] = useState(DEFAULT_BASE_URL);
  const [savedAcId, setSavedAcId] = useState(DEFAULT_AC_ID);
  const [savedEncVer, setSavedEncVer] = useState(DEFAULT_ENC_VER);

  // 打开抽屉时载入已保存的值，并查询开机自启动状态
  useEffect(() => {
    if (!open) return;
    const u = read(CRED_USERNAME_KEY);
    const p = read(CRED_PASSWORD_KEY);
    const b = read(BASE_URL_KEY) || DEFAULT_BASE_URL;
    const a = readAcId();
    const e = readEncVer();
    setUsername(u);
    setPassword(p);
    setBaseUrl(b);
    setAcId(a);
    setEncVer(e);
    setSavedUsername(u);
    setSavedPassword(p);
    setSavedBaseUrl(b);
    setSavedAcId(a);
    setSavedEncVer(e);
    setTheme(readTheme());
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

  function confirmAcId() {
    const a = acId.trim();
    if (!/^\d+$/.test(a)) {
      onToast("认证组 ID 需为数字");
      return;
    }
    if (!writeValue(AC_ID_KEY, a, "认证组 ID 已保存")) return;
    setAcId(a);
    setSavedAcId(a);
  }

  function confirmEncVer() {
    const e = encVer.trim();
    if (!/^[A-Za-z0-9_]+$/.test(e)) {
      onToast("加密版本格式不正确");
      return;
    }
    if (!writeValue(ENC_VER_KEY, e, "加密版本已保存")) return;
    setEncVer(e);
    setSavedEncVer(e);
  }

  if (!open) return null;

  const usernameDirty = username !== savedUsername;
  const passwordDirty = password !== savedPassword;
  const baseUrlDirty = baseUrl.trim() !== savedBaseUrl;
  const acIdDirty = acId.trim() !== savedAcId;
  const encVerDirty = encVer.trim() !== savedEncVer;

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
              深澜网关地址，一般不需要改动。
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
            <h3 className="settings-section__title">高级设置</h3>
            <p className="settings-section__desc">
              深澜网关兼容参数，用于适配其他学校。默认值即可满足大多数学校。
            </p>
            <label className="settings-field">
              <span className="settings-field__label">
                认证组 ID (ac_id)
                <span className="settings-field__hint">多数学校为 1</span>
              </span>
              <span className="settings-field__row">
                <input
                  className="settings-field__input"
                  type="text"
                  value={acId}
                  onChange={(e) => setAcId(e.target.value)}
                  placeholder={DEFAULT_AC_ID}
                  spellCheck={false}
                />
                {acIdDirty && (
                  <span className="settings-field__actions">
                    <button
                      type="button"
                      className="settings-field__confirm"
                      onClick={confirmAcId}
                      aria-label="确认保存认证组 ID"
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      className="settings-field__cancel"
                      onClick={() => setAcId(savedAcId)}
                      aria-label="撤销认证组 ID 修改"
                    >
                      ✕
                    </button>
                  </span>
                )}
              </span>
            </label>
            <label className="settings-field">
              <span className="settings-field__label">
                加密版本 (enc_ver)
                <span className="settings-field__hint">深澜标准为 srun_bx1</span>
              </span>
              <span className="settings-field__row">
                <input
                  className="settings-field__input"
                  type="text"
                  value={encVer}
                  onChange={(e) => setEncVer(e.target.value)}
                  placeholder={DEFAULT_ENC_VER}
                  spellCheck={false}
                />
                {encVerDirty && (
                  <span className="settings-field__actions">
                    <button
                      type="button"
                      className="settings-field__confirm"
                      onClick={confirmEncVer}
                      aria-label="确认保存加密版本"
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      className="settings-field__cancel"
                      onClick={() => setEncVer(savedEncVer)}
                      aria-label="撤销加密版本修改"
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

          <section className="settings-section">
            <h3 className="settings-section__title">外观</h3>
            <div className="settings-field">
              <span className="settings-field__label">主题</span>
              <div className="settings-options">
                {THEME_OPTIONS.map((o) => (
                  <label
                    key={o.value}
                    className={`settings-option${theme === o.value ? " settings-option--on" : ""}`}
                  >
                    <input
                      type="radio"
                      name="theme-mode"
                      className="settings-option__radio"
                      checked={theme === o.value}
                      onChange={() => {
                        setTheme(o.value);
                        writeValue(THEME_KEY, o.value, `主题已切换为「${o.label}」`);
                        applyTheme(o.value);
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
