import "./HeroButton.css";

/// 大按钮的视觉状态（与 App 中的 Status.kind 一一对应）
export type HeroStatus =
  | "idle"
  | "loading"
  | "loggingOut"
  | "success"
  | "fail"
  | "error";

interface HeroButtonProps {
  status: HeroStatus;
  disabled?: boolean;
  onClick: () => void;
}

function heroLabel(status: HeroStatus): string {
  switch (status) {
    case "idle":
      return "未登录";
    case "loading":
      return "登录中";
    case "loggingOut":
      return "注销中";
    case "success":
      return "已连接";
    case "fail":
      return "登录失败";
    case "error":
      return "出错了";
  }
}

function heroHint(status: HeroStatus): string {
  switch (status) {
    case "idle":
      return "点击一键登录";
    case "fail":
      return "请检查账号配置";
    case "error":
      return "点击重试";
    default:
      return "";
  }
}

/// 登录中 / 注销中 / 已连接：中心发光球体（呼吸脉动，已连接时上下浮动）
function Orb() {
  return (
    <svg className="hero-orb__svg" viewBox="0 0 220 220" aria-hidden>
      <defs>
        <radialGradient id="hero-core-grad" cx="50%" cy="36%" r="72%">
          <stop offset="0%" stopColor="var(--core-hi)" />
          <stop offset="100%" stopColor="var(--core-lo)" />
        </radialGradient>
      </defs>
      <circle className="hero-orb__core" cx="110" cy="110" r="70" />
    </svg>
  );
}

/// 未登录 / 失败 / 出错：单个静态线框圆
function Ring() {
  return (
    <svg className="hero-orb__svg" viewBox="0 0 220 220" aria-hidden>
      <circle className="hero-ring__circle" cx="110" cy="110" r="98" />
    </svg>
  );
}

export default function HeroButton({ status, disabled, onClick }: HeroButtonProps) {
  const busy = status === "loading" || status === "loggingOut";
  const live = status === "success";
  const showOrb = busy || live;
  return (
    <button
      type="button"
      className={`hero hero--${status}`}
      onClick={onClick}
      disabled={disabled}
      title={live ? "点击退出登录" : "点击登录"}
      aria-label={live ? "退出登录" : "登录"}
    >
      <span className={`hero-visual${showOrb ? " hero-visual--orb" : ""}`}>
        {showOrb ? <Orb /> : <Ring />}
        <span className="hero-badge">
          <span className="hero-badge__label">{heroLabel(status)}</span>
          {live && <span className="hero-badge__label hero-badge__label--alt">退出登录</span>}
        </span>
      </span>
      {!showOrb && <span className="hero-hint">{heroHint(status)}</span>}
    </button>
  );
}
