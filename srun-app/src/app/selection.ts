const SELECTABLE = "input, textarea, [contenteditable='true'], [data-selectable]";

export function installSelectionReset(): void {
  document.addEventListener(
    "pointerdown",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest(SELECTABLE)) return;
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) selection.removeAllRanges();
    },
    true,
  );
}
