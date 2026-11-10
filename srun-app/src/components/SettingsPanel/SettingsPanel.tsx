import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AC_ID_KEY,
  BASE64_ALPHA_KEY,
  BASE_URL_KEY,
  DEFAULT_AC_ID,
  DEFAULT_BASE64_ALPHA,
  DEFAULT_BASE_URL,
  DEFAULT_ENC_VER,
  DEFAULT_USER_AGENT,
  DEFAULT_WIFI_SSID,
  ENC_VER_KEY,
  PASSWORD_KEY,
  readSetting,
  readSilentStart,
  readStartupMode,
  readWifiMode,
  SILENT_START_KEY,
  STARTUP_MODE_KEY,
  StartupMode,
  USERNAME_KEY,
  USER_AGENT_KEY,
  WIFI_MODE_KEY,
  WIFI_PASSWORD_KEY,
  WIFI_SSID_KEY,
  WifiMode,
  writeSetting,
} from "@/domain/settings";
import {
  IconCheck,
  IconClose,
  IconEye,
  IconEyeOff,
  IconFolder,
} from "@/components/icons/Icons";
import { Field, OptionGroup, Switch } from "@/components/ui/Controls";
import type { OptionItem } from "@/components/ui/Controls";
import AboutPanel from "./AboutPanel";
import { changeTheme, useThemeSync } from "@/hooks/useThemeSync";
import { useTriggers } from "@/hooks/useTriggers";
import { isThemeUnlocked, THEMES } from "@/domain/theme";
import type { ThemeId } from "@/domain/theme";
import "./SettingsPanel.css";

const STARTUP_OPTIONS: { value: StartupMode; label: string; desc: string }[] = [
  { value: "auto", label: "自动连接", desc: "打开软件后自动登录" },
  { value: "manual", label: "不自动连接", desc: "打开后仅查看状态，需手动登录" },
  { value: "remember", label: "记录过去状态", desc: "上次在线则自动重连，否则不连" },
];

const WIFI_OPTIONS: { value: WifiMode; label: string; desc: string }[] = [
  {
    value: "auto",
    label: "未连接时自动连接",
    desc: "当前未连接 WiFi 时，自动连接校园网 WiFi",
  },
  {
    value: "always",
    label: "始终自动连接",
    desc: "忽略当前网络，始终自动连接校园网 WiFi",
  },
];

/// 左侧导航：与右侧各区段的 id 一一对应，点击滚动到对应区段
const NAV: { id: string; label: string }[] = [
  { id: "account", label: "账号" },
  { id: "server", label: "认证服务器" },
  { id: "wifi", label: "WiFi 自动连接" },
  { id: "behavior", label: "启动与行为" },
  { id: "appearance", label: "外观" },
  { id: "logs", label: "日志" },
  { id: "advanced", label: "高级参数" },
];

/// 一个「文本输入 + 确认/撤销」型设置项的声明式定义。
/// 新增此类设置项：在此数组加一行 + 在下面某个区段里挂上 key 即可。
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
    hint: "留空使用默认网关",
    placeholder: DEFAULT_BASE_URL,
    defaultValue: "",
    validate: (v) => {
      const t = v.trim();
      return !t || /^https?:\/\/.+/i.test(t) ? null : "服务器地址需以 http(s):// 开头";
    },
    saveMsg: (v) => (v.trim() ? "服务器地址已保存" : "已恢复默认服务器地址"),
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
    key: WIFI_SSID_KEY,
    label: "校园网 SSID",
    hint: "留空使用默认",
    placeholder: DEFAULT_WIFI_SSID,
    defaultValue: "",
    validate: (v) => {
      const t = v.trim();
      return !t || !/[\x00-\x1f\x7f]/.test(t) ? null : "SSID 不能包含换行或控制字符";
    },
    saveMsg: (v) => (v.trim() ? "WiFi 名称已保存" : "已恢复默认 WiFi 名称"),
  },
  {
    key: WIFI_PASSWORD_KEY,
    label: "WiFi 密码",
    hint: "留空表示无密码",
    placeholder: "无密码留空",
    defaultValue: "",
    secret: true,
    autoComplete: "current-password",
    validate: () => null,
    saveMsg: () => "WiFi 密码已保存",
  },
  {
    key: AC_ID_KEY,
    label: "认证组 ID (ac_id)",
    hint: "留空使用默认；多数学校为 1",
    placeholder: DEFAULT_AC_ID,
    defaultValue: "",
    validate: (v) => {
      const t = v.trim();
      return !t || /^\d+$/.test(t) ? null : "认证组 ID 需为数字";
    },
    saveMsg: (v) => (v.trim() ? "认证组 ID 已保存" : "已恢复默认认证组 ID"),
  },
  {
    key: ENC_VER_KEY,
    label: "加密版本 (enc_ver)",
    hint: "留空使用默认；深澜标准为 srun_bx1",
    placeholder: DEFAULT_ENC_VER,
    defaultValue: "",
    validate: (v) => {
      const t = v.trim();
      return !t || /^[A-Za-z0-9_]+$/.test(t) ? null : "加密版本格式不正确";
    },
    saveMsg: (v) => (v.trim() ? "加密版本已保存" : "已恢复默认加密版本"),
  },
  {
    key: BASE64_ALPHA_KEY,
    label: "加密字母表 (base64)",
    hint: "留空使用默认；64 个字符深澜标准",
    placeholder: DEFAULT_BASE64_ALPHA,
    defaultValue: "",
    validate: (v) => {
      const a = v.trim();
      if (!a) return null;
      const chars = new Set(a);
      return a.length === 64 && chars.size === 64 && !/[^\x21-\x7e]/.test(a)
        ? null
        : "字母表需为 64 个互不相同的 ASCII 字符";
    },
    saveMsg: (v) => (v.trim() ? "加密字母表已保存" : "已恢复默认加密字母表"),
  },
];

const FIELD_BY_KEY: Record<string, TextFieldDef> = Object.fromEntries(
  TEXT_FIELDS.map((f) => [f.key, f]),
);

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

/// 通用「输入框 + ✓/✕ 确认撤销」字段，由声明式注册表驱动
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
    <Field label={field.label} hint={field.hint} inline>
      <input
        className="settings-input"
        type={field.secret ? (showPwd ? "text" : "password") : "text"}
        value={value}
        onChange={(e) => onChange(field.key, e.target.value)}
        placeholder={field.placeholder}
        spellCheck={false}
        autoComplete={field.autoComplete}
        aria-label={field.label}
      />
      {field.secret && (
        <button
          type="button"
          className="settings-input__btn"
          onClick={onTogglePwd}
          aria-label={showPwd ? "隐藏密码" : "显示密码"}
        >
          {showPwd ? <IconEyeOff size={15} /> : <IconEye size={15} />}
        </button>
      )}
      {dirty && (
        <span className="settings-input__actions">
          <button
            type="button"
            className="settings-input__btn settings-input__btn--ok"
            onClick={onConfirm}
            aria-label={`确认保存${field.label}`}
          >
            <IconCheck size={15} />
          </button>
          <button
            type="button"
            className="settings-input__btn"
            onClick={onCancel}
            aria-label={`撤销${field.label}修改`}
          >
            <IconClose size={15} />
          </button>
        </span>
      )}
    </Field>
  );
}

interface SettingsPanelProps {
  onToast: (msg: string) => void;
}

/// 设置项主体：左侧分类导航 + 右侧表单，窗口外壳由 `SettingsWindow` 提供。
export default function SettingsPanel({ onToast }: SettingsPanelProps) {
  /// 所有文本字段的当前编辑值 / 「已保存」基线，以 localStorage key 为索引
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const theme = useThemeSync();
  const [startupMode, setStartupMode] = useState<StartupMode>("manual");
  const [autostart, setAutostart] = useState(false);
  const [autostartLoading, setAutostartLoading] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [silentStart, setSilentStart] = useState(true);
  const [wifiMode, setWifiMode] = useState<WifiMode>("auto");
  const [openingLogDir, setOpeningLogDir] = useState(false);
  const [active, setActive] = useState(NAV[0].id);
  /// 「关于」是独立页面：切过去时右侧只渲染它
  const [showAbout, setShowAbout] = useState(false);
  /// 从关于页切回配置页时要滚到的区段
  const pendingScroll = useRef<string | null>(null);

  useEffect(() => {
    const id = pendingScroll.current;
    if (showAbout || !id) return;
    pendingScroll.current = null;
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [showAbout]);

  useTriggers();

  const themeOptions: OptionItem[] = THEMES.map((def) => {
    const unlocked = isThemeUnlocked(def);
    return {
      value: def.id,
      label: def.label,
      desc: unlocked ? def.desc : `未解锁 · ${def.unlock?.hint ?? ""}`,
      disabled: !unlocked,
    };
  });

  // 窗口打开时载入已保存的值，并查询开机自启动状态
  useEffect(() => {
    const loaded: Record<string, string> = {};
    for (const f of TEXT_FIELDS) loaded[f.key] = readSetting(f.key) || f.defaultValue;
    setValues(loaded);
    setSaved({ ...loaded });
    setStartupMode(readStartupMode());
    setSilentStart(readSilentStart());
    setWifiMode(readWifiMode());
    setShowPwd(false);
    invoke<boolean>("autostart_enabled")
      .then(setAutostart)
      .catch(() => setAutostart(false));
  }, []);

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

  function toggleSilentStart(next: boolean) {
    setSilentStart(next);
    const ok = writeSetting(SILENT_START_KEY, next ? "1" : "0");
    onToast(
      ok ? (next ? "已开启静默启动" : "已关闭静默启动") : "保存失败：本地存储不可用",
    );
  }

  /// 一键打开日志目录：成功后提示路径，便于直接取 srun.log 反馈
  async function openLogDir() {
    if (openingLogDir) return;
    setOpeningLogDir(true);
    try {
      const dir = await invoke<string>("open_log_dir");
      onToast(`已打开日志目录：${dir}`);
    } catch (err) {
      onToast(`打开日志目录失败：${String(err)}`);
    } finally {
      setOpeningLogDir(false);
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

  /// 点击导航：滚动到对应区段（滚动容器是窗口主体）
  function goTo(id: string) {
    setActive(id);
    if (showAbout) {
      // 配置页被隐藏着，滚不动；先切回来，等渲染完再滚
      pendingScroll.current = id;
      setShowAbout(false);
      return;
    }
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openAbout() {
    setActive("about");
    setShowAbout(true);
  }

  /// 按注册表渲染一组文本字段
  function renderFields(keys: string[]) {
    return keys.map((key) => {
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
          onCancel={() => setValues((prev) => ({ ...prev, [f.key]: saved[f.key] ?? "" }))}
          onTogglePwd={() => setShowPwd((v) => !v)}
        />
      );
    });
  }

  return (
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="设置分类">
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`settings-nav__item${active === item.id ? " settings-nav__item--on" : ""}`}
            onClick={() => goTo(item.id)}
          >
            {item.label}
          </button>
        ))}
        <button
          type="button"
          className={`settings-nav__item settings-nav__item--about${
            active === "about" ? " settings-nav__item--on" : ""
          }`}
          onClick={openAbout}
        >
          关于
        </button>
      </nav>

      <div className={`settings-panes${showAbout ? " settings-panes--about" : ""}`}>
        {showAbout && <AboutPanel />}

        <section className="settings-section" id="account">
          <h2 className="settings-section__title">账号</h2>
          <p className="settings-section__desc">用于校园网认证，仅保存在本机。</p>
          {renderFields([USERNAME_KEY, PASSWORD_KEY])}
        </section>

        <section className="settings-section" id="server">
          <h2 className="settings-section__title">认证服务器</h2>
          <p className="settings-section__desc">深澜网关地址与请求头，留空即使用默认值。</p>
          {renderFields([BASE_URL_KEY, USER_AGENT_KEY])}
        </section>

        <section className="settings-section" id="wifi">
          <h2 className="settings-section__title">WiFi 自动连接</h2>
          <p className="settings-section__desc">
            开机静默启动后自动连接校园 WiFi；SSID 留空使用默认，密码留空表示无密码。
          </p>
          {renderFields([WIFI_SSID_KEY, WIFI_PASSWORD_KEY])}
        </section>

        <section className="settings-section" id="behavior">
          <h2 className="settings-section__title">启动与行为</h2>
          <p className="settings-section__desc">开机后如何运行、以及连上网络后如何登录。</p>

          <Field label="开机自启动" hint="开机后自动运行本程序" inline>
            <Switch
              checked={autostart}
              label="开机自启动"
              disabled={autostartLoading}
              onChange={(next) => void toggleAutostart(next)}
            />
          </Field>

          <Field label="静默启动" hint="启动后隐藏主窗口，仅驻留系统托盘" inline>
            <Switch
              checked={silentStart}
              label="静默启动"
              onChange={(next) => toggleSilentStart(next)}
            />
          </Field>

          {/* 选项组纵向排布：三张卡片需要横向空间，跟标签挤一行会被压扁 */}
          <Field label="启动时行为" hint="打开软件后是否自动登录">
            <OptionGroup
              name="startup-mode"
              value={startupMode}
              options={STARTUP_OPTIONS}
              onChange={(next) => {
                setStartupMode(next as StartupMode);
                writeSetting(STARTUP_MODE_KEY, next);
                const label = STARTUP_OPTIONS.find((o) => o.value === next)?.label ?? next;
                onToast(`启动行为已设为「${label}」`);
              }}
            />
          </Field>

          <Field label="自动连接 WiFi" hint="连上校园网 WiFi 的策略">
            <OptionGroup
              name="wifi-mode"
              value={wifiMode}
              options={WIFI_OPTIONS}
              columns={2}
              onChange={(next) => {
                setWifiMode(next as WifiMode);
                writeSetting(WIFI_MODE_KEY, next);
                const label = WIFI_OPTIONS.find((o) => o.value === next)?.label ?? next;
                onToast(`WiFi 自动连接已设为「${label}」`);
              }}
            />
          </Field>
        </section>

        <section className="settings-section" id="appearance">
          <h2 className="settings-section__title">外观</h2>
          <p className="settings-section__desc">主窗口、历史窗口与设置窗口共用同一套主题。</p>

          <Field label="主题">
            <OptionGroup
              name="theme-mode"
              value={theme}
              options={themeOptions}
              onChange={(next) => {
                void changeTheme(next as ThemeId);
                const label = themeOptions.find((o) => o.value === next)?.label ?? next;
                onToast(`主题已切换为「${label}」`);
              }}
            />
          </Field>
        </section>

        <section className="settings-section" id="logs">
          <h2 className="settings-section__title">日志</h2>
          <p className="settings-section__desc">
            运行日志落盘在本机，单文件 5MB 自动轮转，排查问题时可直接取用。
          </p>
          <Field label="日志目录" hint="在文件管理器中打开" inline>
            <button
              type="button"
              className="settings-btn"
              onClick={() => void openLogDir()}
              disabled={openingLogDir}
            >
              <IconFolder size={15} />
              {openingLogDir ? "正在打开…" : "打开日志目录"}
            </button>
          </Field>
        </section>

        <section className="settings-section" id="advanced">
          <h2 className="settings-section__title">高级参数</h2>
          <p className="settings-section__desc">
            深澜网关兼容参数，留空即使用默认值；仅在适配其他学校网关时修改。
          </p>
          {renderFields([AC_ID_KEY, ENC_VER_KEY, BASE64_ALPHA_KEY])}
        </section>
      </div>
    </div>
  );
}
