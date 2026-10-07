import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AC_ID_KEY,
  applyTheme,
  BASE64_ALPHA_KEY,
  BASE_URL_KEY,
  DEFAULT_AC_ID,
  DEFAULT_BASE64_ALPHA,
  DEFAULT_BASE_URL,
  DEFAULT_ENC_VER,
  DEFAULT_USER_AGENT,
  ENC_VER_KEY,
  PASSWORD_KEY,
  readSetting,
  readStartupMode,
  readTheme,
  STARTUP_MODE_KEY,
  StartupMode,
  ThemeMode,
  THEME_KEY,
  USERNAME_KEY,
  USER_AGENT_KEY,
  writeSetting,
} from "./settings";
import "./SettingsPanel.css";

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

/// 一个「文本输入 + 确认/撤销」型设置项的声明式定义。
/// 新增此类设置项：在此数组加一行 + 在 `SECTIONS` 里挂到对应分组即可。
interface TextFieldDef {
  key: string;
  label: string;
  hint?: string;
  placeholder: string;
  /// 读取本地存储时的兜底默认值
  defaultValue: string;
  /// 密码等敏感字段：遮罩显示 + 眼睛切换按钮，且保存时不 trim
  secret?: boolean;
  autoComplete?: string;
  /// 返回错误消息；校验通过返回 null
  validate: (value: string) => string | null;
  /// 保存成功后的提示（入参为最终保存的值）
  saveMsg: (value: string) => string;
}

const TEXT_FIELDS: TextFieldDef[] = [
  {
    key: USERNAME_KEY,
    label: "用户名",
    placeholder: "学号 / 工号",
    defaultValue: "",
    autoComplete: "username",
    validate: (v) => (v.trim() ? null : "请填写用户名"),
    saveMsg: () => "用户名已保存",
  },
  {
    key: PASSWORD_KEY,
    label: "密码",
    placeholder: "••••••••",
    defaultValue: "",
    secret: true,
    autoComplete: "current-password",
    validate: (v) => (v ? null : "密码不能为空"),
    saveMsg: () => "密码已保存",
  },
  {
    key: BASE_URL_KEY,
    label: "服务器地址",
    placeholder: DEFAULT_BASE_URL,
    defaultValue: DEFAULT_BASE_URL,
    validate: (v) =>
      /^https?:\/\/.+/i.test(v.trim()) ? null : "服务器地址需以 http(s):// 开头",
    saveMsg: () => "服务器地址已保存",
  },
  {
    key: USER_AGENT_KEY,
    label: "User-Agent",
    hint: "留空使用默认；可模拟特定浏览器",
    placeholder: DEFAULT_USER_AGENT,
    defaultValue: "",
    validate: (v) =>
      v.trim() && /[\x00-\x1f\x7f]/.test(v) ? "UA 不能包含换行或控制字符" : null,
    saveMsg: (v) => (v.trim() ? "User-Agent 已保存" : "已恢复默认 User-Agent"),
  },
  {
    key: AC_ID_KEY,
    label: "认证组 ID (ac_id)",
    hint: "多数学校为 1",
    placeholder: DEFAULT_AC_ID,
    defaultValue: DEFAULT_AC_ID,
    validate: (v) => (/^\d+$/.test(v.trim()) ? null : "认证组 ID 需为数字"),
    saveMsg: () => "认证组 ID 已保存",
  },
  {
    key: ENC_VER_KEY,
    label: "加密版本 (enc_ver)",
    hint: "深澜标准为 srun_bx1",
    placeholder: DEFAULT_ENC_VER,
    defaultValue: DEFAULT_ENC_VER,
    validate: (v) => (/^[A-Za-z0-9_]+$/.test(v.trim()) ? null : "加密版本格式不正确"),
    saveMsg: () => "加密版本已保存",
  },
  {
    key: BASE64_ALPHA_KEY,
    label: "加密字母表 (base64)",
    hint: "64 个字符，默认深澜标准",
    placeholder: DEFAULT_BASE64_ALPHA,
    defaultValue: DEFAULT_BASE64_ALPHA,
    validate: (v) => {
      const a = v.trim();
      const chars = new Set(a);
      return a.length === 64 && chars.size === 64 && !/[^\x21-\x7e]/.test(a)
        ? null
        : "字母表需为 64 个互不相同的 ASCII 字符";
    },
    saveMsg: () => "加密字母表已保存",
  },
];

const FIELD_BY_KEY: Record<string, TextFieldDef> = Object.fromEntries(
  TEXT_FIELDS.map((f) => [f.key, f]),
);

/// 文本字段分组（渲染顺序即数组顺序）；特殊控件（开关/单选）独立 section 手写
const SECTIONS: { title: string; desc: string; keys: string[] }[] = [
  {
    title: "账号",
    desc: "用于校园网认证，仅保存在本机。",
    keys: [USERNAME_KEY, PASSWORD_KEY],
  },
  {
    title: "认证服务器",
    desc: "深澜网关地址与请求头，一般不需要改动。",
    keys: [BASE_URL_KEY, USER_AGENT_KEY],
  },
  {
    title: "高级设置",
    desc: "深澜网关兼容参数，用于适配其他学校。默认值即可满足大多数学校。",
    keys: [AC_ID_KEY, ENC_VER_KEY, BASE64_ALPHA_KEY],
  },
];

interface SettingTextFieldProps {
  field: TextFieldDef;
  value: string;
  dirty: boolean;
  showPwd: boolean;
  onChange: (key: string, value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onTogglePwd: () => void;
}

/// 通用「输入框 + ✓/✕ 确认撤销」字段组件，由声明式注册表驱动
function SettingTextField({
  field,
  value,
  dirty,
  showPwd,
  onChange,
  onConfirm,
  onCancel,
  onTogglePwd,
}: SettingTextFieldProps) {
  return (
    <label className="settings-field">
      <span className="settings-field__label">
        {field.label}
        {field.hint && <span className="settings-field__hint">{field.hint}</span>}
      </span>
      <span className="settings-field__row">
        <input
          className="settings-field__input"
          type={field.secret ? (showPwd ? "text" : "password") : "text"}
          value={value}
          onChange={(e) => onChange(field.key, e.target.value)}
          placeholder={field.placeholder}
          spellCheck={false}
          autoComplete={field.autoComplete}
        />
        {field.secret && (
          <button
            type="button"
            className="settings-field__eye"
            onClick={onTogglePwd}
            aria-label={showPwd ? "隐藏密码" : "显示密码"}
          >
            {showPwd ? "🙈" : "👁"}
          </button>
        )}
        {dirty && (
          <span className="settings-field__actions">
            <button
              type="button"
              className="settings-field__confirm"
              onClick={onConfirm}
              aria-label={`确认保存${field.label}`}
            >
              ✓
            </button>
            <button
              type="button"
              className="settings-field__cancel"
              onClick={onCancel}
              aria-label={`撤销${field.label}修改`}
            >
              ✕
            </button>
          </span>
        )}
      </span>
    </label>
  );
}

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  onToast: (msg: string) => void;
}

export default function SettingsPanel({ open, onClose, onToast }: SettingsPanelProps) {
  /// 所有文本字段的当前编辑值 / 「已保存」基线，以 localStorage key 为索引
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [theme, setTheme] = useState<ThemeMode>("system");
  const [startupMode, setStartupMode] = useState<StartupMode>("manual");
  const [autostart, setAutostart] = useState(false);
  const [autostartLoading, setAutostartLoading] = useState(false);
  const [showPwd, setShowPwd] = useState(false);

  // 打开抽屉时载入已保存的值，并查询开机自启动状态
  useEffect(() => {
    if (!open) return;
    const loaded: Record<string, string> = {};
    for (const f of TEXT_FIELDS) loaded[f.key] = readSetting(f.key) || f.defaultValue;
    setValues(loaded);
    setSaved({ ...loaded });
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

  function isDirty(f: TextFieldDef): boolean {
    const cur = values[f.key] ?? "";
    const base = saved[f.key] ?? "";
    return f.secret ? cur !== base : cur.trim() !== base;
  }

  /// 校验 → 写入本地存储 → 更新基线的通用保存流程
  function confirmField(f: TextFieldDef): void {
    const raw = values[f.key] ?? "";
    const v = f.secret ? raw : raw.trim();
    const err = f.validate(v);
    if (err) {
      onToast(err);
      return;
    }
    if (!writeSetting(f.key, v)) {
      onToast("保存失败：本地存储不可用");
      return;
    }
    setValues((prev) => ({ ...prev, [f.key]: v }));
    setSaved((prev) => ({ ...prev, [f.key]: v }));
    onToast(f.saveMsg(v));
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
          {SECTIONS.map((section) => (
            <section key={section.title} className="settings-section">
              <h3 className="settings-section__title">{section.title}</h3>
              <p className="settings-section__desc">{section.desc}</p>
              {section.keys.map((key) => {
                const f = FIELD_BY_KEY[key];
                return (
                  <SettingTextField
                    key={key}
                    field={f}
                    value={values[f.key] ?? ""}
                    dirty={isDirty(f)}
                    showPwd={showPwd}
                    onChange={(k, v) => setValues((prev) => ({ ...prev, [k]: v }))}
                    onConfirm={() => confirmField(f)}
                    onCancel={() =>
                      setValues((prev) => ({ ...prev, [f.key]: saved[f.key] ?? "" }))
                    }
                    onTogglePwd={() => setShowPwd((v) => !v)}
                  />
                );
              })}
            </section>
          ))}

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
                        writeSetting(STARTUP_MODE_KEY, o.value);
                        onToast(`启动行为已设为「${o.label}」`);
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
                        writeSetting(THEME_KEY, o.value);
                        applyTheme(o.value);
                        onToast(`主题已切换为「${o.label}」`);
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
