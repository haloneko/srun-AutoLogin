import WindowControls from "@/components/TitleBar/WindowControls";
import { useWindowDrag } from "@/hooks/useWindowDrag";
import "./TitleBar.css";

interface TitleBarProps {
  title?: string;
  subtitle?: string;
}

export default function TitleBar({ title, subtitle }: TitleBarProps) {
  const onTitleBarMouseDown = useWindowDrag();

  return (
    <div className="titlebar" onMouseDown={onTitleBarMouseDown}>
      {title && (
        <h1 className="titlebar__title">
          {title}
          {subtitle && <span className="titlebar__sub">{subtitle}</span>}
        </h1>
      )}
      <WindowControls />
    </div>
  );
}
