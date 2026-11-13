import WindowControls from "@/components/TitleBar/WindowControls";
import { useWindowDrag } from "@/hooks/useWindowDrag";
import "./TitleBar.css";

export default function TitleBar() {
  const onTitleBarMouseDown = useWindowDrag();

  return (
    <div className="titlebar" onMouseDown={onTitleBarMouseDown}>
      <WindowControls />
    </div>
  );
}
