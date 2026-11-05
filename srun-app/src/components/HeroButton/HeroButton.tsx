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

/// 状态球：外圈刻度环 + 内圈轨道 + 连接中的对向双弧 + 球心文字。
///
/// 记忆点全在这一个环上——离线时是静止的灰刻度（像仪表的零位），
/// 连接中双弧对向扫过，在线时刻度环缓慢自转并透出呼吸光晕。
/// 层叠顺序即绘制顺序：刻度 → 轨道 → 弧 → 内环 → 球体（球体透明时露出内环）。
export default function HeroButton({ status, disabled, onClick }: HeroButtonProps) {
  const busy = status === "loading" || status === "loggingOut";
  const live = status === "success";
  return (
    <>
      <button
        type="button"
        className={`hero hero--${status}`}
        onClick={onClick}
        disabled={disabled}
        title={live ? "点击退出登录" : "点击登录"}
        aria-label={live ? "退出登录" : "登录"}
      >
        <span className="hero-visual">
          <svg className="hero-svg" viewBox="0 0 200 200" aria-hidden>
            <circle className="hero-ticks" cx="100" cy="100" r="90" pathLength="100" />
            <circle className="hero-track" cx="100" cy="100" r="79" />
            <circle className="hero-arc hero-arc--a" cx="100" cy="100" r="79" pathLength="100" />
            <circle className="hero-arc hero-arc--b" cx="100" cy="100" r="79" pathLength="100" />
            <circle className="hero-inner" cx="100" cy="100" r="55" />
          </svg>
          <span className="hero-label">
            <span className="hero-label__text">{heroLabel(status)}</span>
            {live && <span className="hero-label__alt">退出登录</span>}
          </span>
        </span>
      </button>
      {!busy && !live && (
        <span className="hero-hint" aria-hidden>
          {heroHint(status)}
        </span>
      )}
    </>
  );
}
