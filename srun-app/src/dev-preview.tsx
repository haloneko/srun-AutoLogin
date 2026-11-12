import { createRoot } from "react-dom/client";
import HeroButton from "@/components/HeroButton/HeroButton";
import "@/app/styles.css";

/// 临时预览页：开发时核对首页视觉（?theme=dark 切深色），不参与正式构建。
const dark = new URLSearchParams(location.search).get("theme") === "dark";
if (dark) document.documentElement.dataset.theme = "dark";

function SamplePanel() {
  return (
    <section className="panel" aria-label="网络状态">
      <div className="panel__figures">
        <div className="figure">
          <span className="figure__value">5天 13小时</span>
          <span className="figure__label">在线时长</span>
        </div>
        <span className="panel__rule" aria-hidden />
        <div className="figure figure--end">
          <span className="figure__value">27.95 GB</span>
          <span className="figure__label">已用流量</span>
        </div>
      </div>
      <dl className="facts">
        <div className="fact">
          <dt>账户</dt>
          <dd>253051303106</dd>
        </div>
        <div className="fact">
          <dt>IP</dt>
          <dd>10.44.1.7</dd>
        </div>
        <div className="fact">
          <dt>WiFi</dt>
          <dd>喵喵喵喵喵喵喵喵</dd>
        </div>
        <div className="fact">
          <dt>设备</dt>
          <dd>2</dd>
        </div>
      </dl>
      <div className="wifi-hint">
        <span className="wifi-hint__msg">
          「喵喵喵喵喵喵喵喵」不是校园网「SDMU-5G」，点上方球体切换
        </span>
      </div>
    </section>
  );
}

function Preview() {
  return (
    <div className="window">
      <div className="shell">
        <main className="home">
          <HeroButton status="success" onClick={() => {}} />
          <SamplePanel />
        </main>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Preview />);
