import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import WindowFrame from "@/components/WindowFrame/WindowFrame";
import SettingsPanel from "@/components/SettingsPanel/SettingsPanel";
import ThemeLayer from "@/components/theme/ThemeLayer";
import ToastStack from "@/components/Toast/ToastStack";
import { useThemeSync } from "@/hooks/useThemeSync";
import { useToasts } from "@/hooks/useToasts";

/// 设置独立窗口。
///
/// 与主窗口、历史窗口共用同一份前端产物，由 `main.tsx` 按窗口 label 分流到此组件；
/// 主窗口点齿轮后由后端 `open_settings_window` 创建（已打开则唤起）。
/// 窗口骨架与历史窗口一致（`WindowFrame`），内部是「左导航 + 右表单」的宽布局。
export default function SettingsWindow() {
  const { toasts, showToast, dismissToast } = useToasts();

  // 主题跟随设置，并在本窗口改动时广播给主窗口与历史窗口
  const theme = useThemeSync();

  // Esc 关闭窗口
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void closeWindow();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /// 关闭本窗口：走应用自身的命令，不依赖窗口插件权限
  async function closeWindow() {
    try {
      await invoke("close_current_window");
    } catch (err) {
      showToast(`关闭窗口失败：${String(err)}`);
    }
  }

  return (
    <>
      <ThemeLayer theme={theme} />
      <WindowFrame
        title="设置"
        subtitle="账号与网络参数仅保存在本机"
        overlay={<ToastStack toasts={toasts} onDismiss={dismissToast} />}
      >
        <SettingsPanel onToast={showToast} />
      </WindowFrame>
    </>
  );
}
