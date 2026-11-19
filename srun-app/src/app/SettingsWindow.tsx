import WindowFrame from "@/components/WindowFrame/WindowFrame";
import SettingsPanel from "@/components/SettingsPanel/SettingsPanel";

export default function SettingsWindow() {
  return (
    <WindowFrame title="设置">
      <SettingsPanel />
    </WindowFrame>
  );
}
