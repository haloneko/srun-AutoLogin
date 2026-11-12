import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Field } from "@/components/ui/Controls";
import { changeDebugMode } from "@/hooks/useDebugMode";
import { useTriggers } from "@/hooks/useTriggers";
import { resetTriggers } from "@/domain/triggers";

interface DebugPanelProps {
  onToast: (msg: string) => void;
}

/// 调试页：只有敲开隐藏指令后才出现在导航里，用来查看运行环境与触发值
export default function DebugPanel({ onToast }: DebugPanelProps) {
  const [version, setVersion] = useState("");
  const [viewport, setViewport] = useState(() => describeViewport());
  const triggers = useTriggers();

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion(""));
  }, []);

  useEffect(() => {
    const onResize = () => setViewport(describeViewport());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const entries = Object.entries(triggers);

  return (
    <section className="settings-section settings-page debug-section">
      <h2 className="settings-section__title">调试</h2>
      <p className="settings-section__desc">
        隐藏指令解锁的页面，数据只在本机产生，不会上传。
      </p>

      <Field label="调试模式" hint="关闭后本页与导航入口一起消失" inline>
        <button
          type="button"
          className="settings-btn"
          onClick={() => {
            changeDebugMode(false);
            onToast("调试模式已关闭");
          }}
        >
          关闭调试模式
        </button>
      </Field>

      <h3 className="debug-subtitle">运行环境</h3>
      <dl className="debug-list">
        <div className="debug-row">
          <dt>应用版本</dt>
          <dd>{version || "未获取到"}</dd>
        </div>
        <div className="debug-row">
          <dt>窗口尺寸</dt>
          <dd>{viewport}</dd>
        </div>
        <div className="debug-row">
          <dt>运行内核</dt>
          <dd>{navigator.userAgent}</dd>
        </div>
      </dl>

      <h3 className="debug-subtitle">触发值</h3>
      {entries.length ? (
        <dl className="debug-list">
          {entries.map(([name, value]) => (
            <div className="debug-row" key={name}>
              <dt>{name}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="debug-empty">还没有记录到任何触发值。</p>
      )}

      <Field label="重置触发值" hint="主题会按解锁条件重新上锁" inline>
        <button
          type="button"
          className="settings-btn"
          disabled={!entries.length}
          onClick={() => {
            resetTriggers();
            onToast("触发值已重置");
          }}
        >
          重置触发值
        </button>
      </Field>
    </section>
  );
}

/// 窗口逻辑尺寸 + 像素比：用来核对样式在不同缩放下的表现
function describeViewport(): string {
  return `${window.innerWidth} × ${window.innerHeight} @ ${window.devicePixelRatio}x`;
}
