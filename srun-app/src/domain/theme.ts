import { readSetting, writeSetting } from "@/domain/settings";

export const THEME_KEY = "srun.theme";

export type ColorScheme = "system" | "light" | "dark";

export type BackgroundId = string;

export type ThemeId = "system" | "light" | "dark" | (string & {});

export interface ThemeDef {
  id: ThemeId;
  label: string;
  desc: string;
  colorScheme: ColorScheme;
  background: BackgroundId;
}

export type ThemePluginMeta = Omit<ThemeDef, "background">;

/// 只有配色的内置主题（不带背景特效）
const BUILTIN_THEMES: ThemeDef[] = [
  {
    id: "system",
    label: "跟随系统",
    desc: "随系统外观自动切换",
    colorScheme: "system",
    background: "none",
  },
  {
    id: "light",
    label: "浅色",
    desc: "始终使用浅色配色",
    colorScheme: "light",
    background: "none",
  },
  {
    id: "dark",
    label: "深色",
    desc: "始终使用深色配色",
    colorScheme: "dark",
    background: "none",
  },
];

const PLUGIN_META = import.meta.glob<ThemePluginMeta>(
  "../components/theme/*/index.tsx",
  { eager: true, import: "meta" },
);

export const THEMES: ThemeDef[] = [
  ...BUILTIN_THEMES,
  ...Object.values(PLUGIN_META).map((meta) => ({ ...meta, background: meta.id })),
];

const FALLBACK: ThemeDef = THEMES[0];

/// 按 id 取主题定义；未知或已删除的插件一律回落到「跟随系统」
export function resolveTheme(id: string | null | undefined): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? FALLBACK;
}

/// 读取当前主题（未设置或值非法时回落）
export function readTheme(): ThemeId {
  return resolveTheme(readSetting(THEME_KEY)).id;
}

/// 把主题应用到 `<html>`：写入 `data-theme`（配色）与 `data-bg`（背景）
export function applyTheme(id: ThemeId) {
  const theme = resolveTheme(id);
  const el = document.documentElement;
  if (theme.colorScheme === "system") {
    delete el.dataset.theme;
  } else {
    el.dataset.theme = theme.colorScheme;
  }
  el.dataset.bg = theme.background;
}

export function saveTheme(id: ThemeId): boolean {
  return writeSetting(THEME_KEY, id);
}
