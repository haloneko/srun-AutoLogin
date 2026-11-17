import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  SEPARATOR,
  closeContextMenu,
  getContextMenu,
  subscribeContextMenu,
} from "@/app/contextMenu";
import type { ContextMenuState, MenuEntry, MenuItem } from "@/app/contextMenu";
import "./ContextMenu.css";

const EDGE = 8;

function runnableItems(entries: MenuEntry[]): MenuItem[] {
  return entries.filter(
    (entry): entry is MenuItem => entry !== SEPARATOR && Boolean(entry.run) && !entry.disabled,
  );
}

export default function ContextMenuHost() {
  const [state, setState] = useState<ContextMenuState | null>(getContextMenu);
  const [placed, setPlaced] = useState<{ owner: ContextMenuState; left: number; top: number } | null>(
    null,
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => subscribeContextMenu(() => setState(getContextMenu())), []);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!state || !menu) {
      setPlaced(null);
      return;
    }
    const { width, height } = menu.getBoundingClientRect();
    setPlaced({
      owner: state,
      left: Math.max(EDGE, Math.min(state.x, window.innerWidth - width - EDGE)),
      top: Math.max(EDGE, Math.min(state.y, window.innerHeight - height - EDGE)),
    });
    setActiveId(runnableItems(state.items)[0]?.id ?? null);
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeContextMenu();
        return;
      }
      if (event.key === "Tab") {
        closeContextMenu();
        return;
      }
      // 焦点留在输入框里时敲字会照常写进去：菜单立刻收起，不拦按键，
      // 免得菜单悬在已经变了的文字上
      if (event.key.length === 1 || event.key === "Backspace" || event.key === "Delete") {
        closeContextMenu();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter") return;

      event.preventDefault();
      event.stopPropagation();
      const runnable = runnableItems(state.items);
      if (runnable.length === 0) return;
      if (event.key === "Enter") {
        const current = runnable.find((item) => item.id === activeId) ?? runnable[0];
        closeContextMenu();
        current.run?.();
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      const from = runnable.findIndex((item) => item.id === activeId);
      const next = runnable[(from + step + runnable.length) % runnable.length];
      setActiveId(next.id);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [state, activeId]);

  useEffect(() => {
    if (!state) return;
    const close = () => closeContextMenu();
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      closeContextMenu();
    };
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [state]);

  if (!state) return null;

  const at = placed?.owner === state ? placed : { left: state.x, top: state.y };

  function activate(item: MenuItem) {
    closeContextMenu();
    item.run?.();
  }

  return (
    <>
      <div className="ctx-scrim" onPointerDown={() => closeContextMenu()} />
      <div
        ref={menuRef}
        className="ctx"
        role="menu"
        tabIndex={-1}
        style={{ left: at.left, top: at.top }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {state.items.map((entry, index) =>
          entry === SEPARATOR ? (
            <hr key={`sep-${index}`} className="ctx__sep" />
          ) : (
            <button
              key={entry.id}
              type="button"
              role="menuitem"
              className={[
                "ctx__item",
                entry.danger ? "ctx__item--danger" : "",
                entry.id === activeId ? "ctx__item--active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              disabled={!entry.run || entry.disabled}
              onPointerEnter={() => setActiveId(entry.id)}
              onClick={() => activate(entry)}
            >
              {entry.icon && <span className="ctx__icon">{entry.icon}</span>}
              <span className="ctx__label">{entry.label}</span>
              {entry.hint && <span className="ctx__hint">{entry.hint}</span>}
            </button>
          ),
        )}
      </div>
    </>
  );
}
