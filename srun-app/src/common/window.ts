import { invoke } from "@tauri-apps/api/core";

export async function closeCurrentWindow(onError?: (msg: string) => void) {
  try {
    await invoke("close_current_window");
  } catch (err) {
    onError?.(`关闭窗口失败：${String(err)}`);
  }
}
