import { invoke } from "@tauri-apps/api/core";
import { resetWindowHover } from "./windowHover";

export async function closeCurrentWindow(onError?: (msg: string) => void) {
  resetWindowHover();
  try {
    await invoke("close_current_window");
  } catch (err) {
    onError?.(`关闭窗口失败：${String(err)}`);
  }
}
