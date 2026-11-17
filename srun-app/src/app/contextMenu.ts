interface ContextMenuContext {
  x: number;
  y: number;
  target: Element;
  native: MouseEvent;
}

type ContextMenuHandler = (context: ContextMenuContext) => boolean | void;

const handlers = new Set<ContextMenuHandler>();

export function registerContextMenu(handler: ContextMenuHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

export function installContextMenu(): void {
  document.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const target = event.target;
    if (!(target instanceof Element)) return;

    const context: ContextMenuContext = {
      x: event.clientX,
      y: event.clientY,
      target,
      native: event,
    };
    for (const handler of handlers) {
      if (handler(context) === true) return;
    }
  });
}
