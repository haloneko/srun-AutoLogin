import type { Status } from "@/common/types";

/// 状态球合法迁移表（仅开发期告警，不阻断运行）。
/// 覆盖现实路径：用户操作（登录/注销/重试）与外部事实（查询已在线/离线、网络变更复位）。
const ALLOWED_TRANSITIONS: Record<Status["kind"], ReadonlyArray<Status["kind"]>> = {
  idle: ["idle", "loading", "error"],
  loading: ["success", "fail", "error"],
  loggingOut: ["idle", "success", "error"],
  success: ["success", "loggingOut", "idle"],
  fail: ["loading", "idle", "error"],
  error: ["loading", "idle"],
};

export type StatusAction =
  | { type: "set"; status: Status }
  | { type: "idle" };

export function statusReducer(state: Status, action: StatusAction): Status {
  switch (action.type) {
    case "set": {
      if (
        import.meta.env.DEV &&
        !ALLOWED_TRANSITIONS[state.kind].includes(action.status.kind)
      ) {
        console.warn(`[status] 非法状态迁移：${state.kind} → ${action.status.kind}`);
      }
      return action.status;
    }
    case "idle": {
      if (
        import.meta.env.DEV &&
        !ALLOWED_TRANSITIONS[state.kind].includes("idle")
      ) {
        console.warn(`[status] 非法状态迁移：${state.kind} → idle`);
      }
      return { kind: "idle" };
    }
  }
}
