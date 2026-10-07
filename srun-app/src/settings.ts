//! 设置项集中管理：localStorage key、默认值、类型与读写封装。
//!
//! 后端不感知这些 key；`App.tsx` / `SettingsPanel.tsx` 统一从这里读写，
//! 新增设置项时只改注册表（SettingsPanel）与这里的 key/默认值，避免散落。

export const USERNAME_KEY = "srun.username";
export const PASSWORD_KEY = "srun.password";
export const BASE_URL_KEY = "srun.baseUrl";
export const AC_ID_KEY = "srun.acId";
export const ENC_VER_KEY = "srun.encVer";
export const BASE64_ALPHA_KEY = "srun.base64Alpha";
export const USER_AGENT_KEY = "srun.userAgent";
export const THEME_KEY = "srun.theme";
export const STARTUP_MODE_KEY = "srun.startupMode";
export const LAST_ONLINE_KEY = "srun.lastOnline";

export const DEFAULT_BASE_URL = "https://wlrz.sdmu.edu.cn/";
export const DEFAULT_AC_ID = "1";
export const DEFAULT_ENC_VER = "srun_bx1";
export const DEFAULT_BASE64_ALPHA =
  "LVoJPiCN2R8G90yg+hmFHuacZ1OWMnrsSTXkYpUq/3dlbfKwv6xztjI7DeBE45QA";
/// 与 srun-core `config::USER_AGENT` 保持一致；留空时后端使用该默认值
export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export type StartupMode = "auto" | "manual" | "remember";
export type ThemeMode = "system" | "light" | "dark";

/// 读取原始存储值；异常或不存在时返回空字符串
export function readSetting(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

/// 写入存储；成功返回 true（设置面板据此提示成功/失败）
export function writeSetting(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/// 认证服务器地址；返回存储的原始值（空字符串表示使用默认网关，后端兜底）
export function readBaseUrl(): string {
  return readSetting(BASE_URL_KEY);
}

/// 认证组 ID；返回存储的原始值（空字符串表示使用默认值，后端兜底）
export function readAcId(): string {
  return readSetting(AC_ID_KEY);
}

/// 加密版本；返回存储的原始值（空字符串表示使用默认值，后端兜底）
export function readEncVer(): string {
  return readSetting(ENC_VER_KEY);
}

/// 加密字母表；返回存储的原始值（空字符串表示使用默认深澜字母表，后端兜底）
export function readBase64Alpha(): string {
  return readSetting(BASE64_ALPHA_KEY);
}

/// 自定义 UA；返回存储的原始值（空字符串表示使用默认 UA）
export function readUserAgent(): string {
  return readSetting(USER_AGENT_KEY);
}

/// 网关兼容参数：与 Tauri `GatewayOptions` / 核心 `SrunLoginOptions` 字段一一对应，
/// 登录 / 状态 / 注销三个 command 统一消费的唯一对象。
export interface GatewayOptions {
  baseUrl: string;
  acId: string;
  encVer: string;
  base64Alpha: string;
  userAgent: string;
}

/// 从当前设置组装网关参数（空字段 = 后端回退默认值）
export function toLoginOptions(): GatewayOptions {
  return {
    baseUrl: readBaseUrl(),
    acId: readAcId(),
    encVer: readEncVer(),
    base64Alpha: readBase64Alpha(),
    userAgent: readUserAgent(),
  };
}

export function readTheme(): ThemeMode {
  const v = readSetting(THEME_KEY);
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
  const v = readSetting(STARTUP_MODE_KEY);
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
