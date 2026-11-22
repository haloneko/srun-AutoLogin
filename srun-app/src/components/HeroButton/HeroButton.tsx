import type { Status } from "@/common/types";
import { IconAlert, IconCheck, IconLogOut, IconPower, IconRefresh, IconWifi } from "@/components/icons/Icons";
import "./HeroButton.css";

export type HeroStatus = Status["kind"];

interface HeroButtonProps {
  status: HeroStatus;
  disabled?: boolean;
  onClick: () => void;
}

const appearance: Record<HeroStatus, {
  label: string;
  action?: string;
  hint?: string;
  icon: typeof IconCheck;
}> = {
  idle: { label: "未登录", action: "一键登录", hint: "点击一键登录", icon: IconPower },
  loading: { label: "登录中", icon: IconWifi },
  loggingOut: { label: "注销中", icon: IconLogOut },
  success: { label: "已连接", action: "退出登录", hint: "点击退出登录", icon: IconCheck },
  fail: { label: "登录失败", action: "重新登录", hint: "请检查账号配置", icon: IconAlert },
  error: { label: "出错了", action: "重试", hint: "点击重试", icon: IconRefresh },
};

export default function HeroButton({ status, disabled, onClick }: HeroButtonProps) {
  const { label, action, hint, icon: Icon } = appearance[status];
  const busy = action === undefined;

  return (
    <>
      <button
        type="button"
        className={`hero hero--${status}`}
        onClick={onClick}
        disabled={disabled || busy}
        title={action}
        aria-label={action ? `${label}，${action}` : label}
        aria-busy={busy}
      >
        <span className="hero__orbit" aria-hidden="true" />
        <span className="hero__sweep" aria-hidden="true" />
        {status === "success" && <span className="hero__wave" aria-hidden="true" />}
        <span className="hero__core" aria-hidden="true">
          <span className="hero__content" key={status}>
            <Icon className="hero__icon" size={27} />
            <span className="hero__label">{label}</span>
          </span>
        </span>
      </button>
      <span className="hero-hint" aria-hidden="true">{hint}</span>
    </>
  );
}
