import type { ContextMenuContext, MenuEntry } from "@/app/contextMenu";
import { copyText, pasteText } from "@/common/clipboard";
import { IconCopy, IconPaste } from "@/components/icons/Icons";

const EDITABLE = "input, textarea, [contenteditable='true']";

function insertText(target: Element, text: string): void {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    target.focus();
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? start;
    target.setRangeText(text, start, end, "end");
    target.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  // 可编辑区域交给浏览器插入，撤销栈与富文本格式都保持原生行为
  if (target instanceof HTMLElement) target.focus();
  document.execCommand("insertText", false, text);
}

async function pasteInto(target: Element): Promise<void> {
  const text = await pasteText();
  if (text) insertText(target, text);
}

function selectedText(): string {
  try {
    const selection = window.getSelection();
    if (!selection || selection.type !== "Range" || selection.isCollapsed) return "";

    const range = selection.getRangeAt(0);
    if (range.getClientRects().length === 0) return "";

    const host = range.startContainer;
    const element = host instanceof Element ? host : host.parentElement;
    if (element && getComputedStyle(element).userSelect === "none") return "";

    return selection.toString().trim();
  } catch {
    return "";
  }
}

function editableSelectedText(element: Element | null): string {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const start = element.selectionStart ?? 0;
    const end = element.selectionEnd ?? 0;
    return end > start ? element.value.slice(start, end) : "";
  }
  return "";
}

export function defaultMenuItems(context: ContextMenuContext): MenuEntry[] {
  const entries: MenuEntry[] = [];
  const editable = context.target.closest(EDITABLE);

  const selected = selectedText() || editableSelectedText(editable);
  if (selected) {
    entries.push({
      id: "copy",
      label: "复制",
      hint: selected.length > 16 ? `${selected.slice(0, 16)}…` : selected,
      icon: <IconCopy size={14} />,
      run: () => void copyText(selected),
    });
  }

  if (editable) {
    entries.push({
      id: "paste",
      label: "粘贴",
      icon: <IconPaste size={14} />,
      run: () => void pasteInto(editable),
    });
  }

  return entries;
}
