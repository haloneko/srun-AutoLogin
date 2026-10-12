/// srun_portal 登录响应中的关键字段
export interface LoginResult {
  error: string;
  client_ip?: string;
  online_ip?: string;
  suc_msg?: string;
  error_msg?: string;
}

/// srun-core status::OnlineStatus 的镜像
export interface OnlineStatus {
  online: boolean;
  username: string;
  ip: string;
  online_seconds: number;
  total_bytes: number;
  online_devices: number;
}

/// 后端 wifi::WifiStatus 的镜像，随 wifi-changed 事件推送
export interface WifiStatus {
  connected: boolean;
  ssid: string | null;
  interfaceReady: boolean;
}

/// 大按钮状态（与 HeroButton 的 HeroStatus 一一对应）
export type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loggingOut" }
  | { kind: "success"; ip: string; msg: string }
  | { kind: "fail"; error: string; msg: string }
  | { kind: "error"; msg: string };

export interface ToastItem {
  id: number;
  msg: string;
}
