import type { ComponentType } from "react";
import { resolveTheme } from "@/domain/theme";
import type { ThemeDef, ThemeId } from "@/domain/theme";
import "./ThemeLayer.css";

interface ThemeLayerProps {
  theme: ThemeId;
}

type ThemeModule = {
  meta: Omit<ThemeDef, "background">;
  default: ComponentType;
};

const MODULES = import.meta.glob<ThemeModule>("./*/index.tsx", { eager: true });

const VIEWS: Record<string, ComponentType> = Object.fromEntries(
  Object.values(MODULES).map((mod) => [mod.meta.id, mod.default]),
);
export default function ThemeLayer({ theme }: ThemeLayerProps) {
  const { background } = resolveTheme(theme);
  const View = VIEWS[background];
  return View ? <View /> : null;
}
