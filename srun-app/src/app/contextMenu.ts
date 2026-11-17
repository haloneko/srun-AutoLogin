import type { ReactNode } from "react";
import { defaultMenuItems } from "@/app/defaultMenu";

export interface MenuItem {
  id: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  run?: () => void;
}

export const SEPARATOR = "separator";

export type MenuEntry = MenuItem | typeof SEPARATOR;

export interface ContextMenuContext {
  x: number;
  y: number;
  target: Element;
  native: MouseEvent;
}

export type ContextMenuProvider = (context: ContextMenuContext) => MenuEntry[] | null;

export interface ContextMenuState {
  x: number;
  y: number;
  items: MenuEntry[];
}

let opened: ContextMenuState | null = null;
const listeners = new Set<() => void>();

export function subscribeContextMenu(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getContextMenu(): ContextMenuState | null {
  return opened;
}

export function closeContextMenu(): void {
  if (!opened) return;
  opened = null;
  for (const listener of listeners) listener();
}

const providers: ContextMenuProvider[] = [];

export function registerContextMenu(provider: ContextMenuProvider): () => void {
  providers.push(provider);
  return () => {
    const index = providers.indexOf(provider);
    if (index >= 0) providers.splice(index, 1);
  };
}

function buildMenu(context: ContextMenuContext): MenuEntry[] {
  const entries: MenuEntry[] = [...defaultMenuItems(context)];
  for (const provider of providers) {
    const part = provider(context);
    if (!part || part.length === 0) continue;
    if (entries.length > 0) entries.push(SEPARATOR);
    entries.push(...part);
  }
  const compact: MenuEntry[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry === SEPARATOR) {
      if (compact.length === 0 || compact[compact.length - 1] === SEPARATOR) continue;
      compact.push(SEPARATOR);
      continue;
    }
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    compact.push(entry);
  }
  while (compact.length > 0 && compact[compact.length - 1] === SEPARATOR) compact.pop();
  return compact;
}

export function installContextMenu(): void {
  document.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const target = event.target;
    if (!(target instanceof Element)) return;

    const items = buildMenu({
      x: event.clientX,
      y: event.clientY,
      target,
      native: event,
    });
    if (items.length === 0) {
      closeContextMenu();
      return;
    }
    opened = { x: event.clientX, y: event.clientY, items };
    for (const listener of listeners) listener();
  });
}
