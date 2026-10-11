//! wifi_watcher - 监听 WiFi 连接状态变动（Windows WLAN API 通知）
//!
//! 通过 `WlanRegisterNotification` 注册系统事件通知，在连接开始 / 完成、断开、
//! 接口到达 / 移除时，把最新连接状态以 `wifi-changed` 事件推送给前端。
//! 事件驱动、即时且无轮询（相比 `netsh` 定时轮询零额外开销）。
//!
//! 通知回调不保证在哪个线程执行（注册线程有消息队列时在注册线程，否则在线程池），
//! 因此回调内**不得执行阻塞操作**：只派发一个异步任务，由阻塞线程池重新查询一次
//! 当前状态（复用 `wifi::current_status` 的 `netsh` 解析，兼容中英文系统输出）再 emit。
//! 注册失败时静默降级，不影响主流程。

#![cfg(windows)]

use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter};
use windows::Win32::Foundation::{BOOL, HANDLE};
use windows::Win32::NetworkManagement::WiFi::*;

/// 监听是否已启动（防止重复注册）
static WATCHER_STARTED: AtomicBool = AtomicBool::new(false);

/// 回调上下文：持有 AppHandle，用于向前端推送状态事件
struct WatcherCtx {
    app: AppHandle,
}

/// 关注的连接状态类通知码：连接开始 / 完成、断开、接口到达 / 移除
fn is_relevant(code: u32) -> bool {
    let code = code as i32;
    code == wlan_notification_acm_connection_start.0
        || code == wlan_notification_acm_connection_complete.0
        || code == wlan_notification_acm_disconnected.0
        || code == wlan_notification_acm_interface_arrival.0
        || code == wlan_notification_acm_interface_removal.0
}

/// WLAN 通知回调（不阻塞：仅派发异步任务查询状态并 emit）
unsafe extern "system" fn on_wlan_notification(
    data: *mut L2_NOTIFICATION_DATA,
    context: *mut c_void,
) {
    if context.is_null() || data.is_null() {
        return;
    }
    let code = (*data).NotificationCode;
    if !is_relevant(code) {
        return;
    }
    let app = (*(context as *const WatcherCtx)).app.clone();
    // 回调线程不可阻塞：到阻塞线程池查询最新状态，再发事件
    tauri::async_runtime::spawn(async move {
        let status = tauri::async_runtime::spawn_blocking(crate::wifi::current_status)
            .await
            .unwrap_or_default();
        let _ = app.emit("wifi-changed", status);
    });
}

/// 注册 WLAN 通知监听。失败时打印诊断并降级（不阻塞应用启动）。
pub fn start(app: &tauri::App) {
    if WATCHER_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    unsafe {
        let mut handle = HANDLE::default();
        let mut negotiated = 0u32;
        // Windows 8+ 由 WlanOpenHandle 内部完成 CoInitializeEx(MTA)，此处无需自行初始化；
        // 返回 0 表示 ERROR_SUCCESS
        if WlanOpenHandle(2, None, &mut negotiated, &mut handle) != 0 {
            eprintln!("[wifi_watcher] WlanOpenHandle 失败，WiFi 变动监听不可用");
            WATCHER_STARTED.store(false, Ordering::SeqCst);
            return;
        }
        let ctx = Box::into_raw(Box::new(WatcherCtx {
            app: app.handle().clone(),
        }));
        // bIgnoreDuplicate = FALSE：接收全部通知，前端状态幂等覆盖即可
        let result = WlanRegisterNotification(
            handle,
            WLAN_NOTIFICATION_SOURCE_ACM,
            BOOL(0),
            Some(on_wlan_notification),
            Some(ctx as *const c_void),
            None,
            None,
        );
        if result != 0 {
            eprintln!("[wifi_watcher] WlanRegisterNotification 失败，WiFi 变动监听不可用");
            drop(Box::from_raw(ctx));
            WATCHER_STARTED.store(false, Ordering::SeqCst);
            return;
        }
        // client handle 为纯句柄值（Copy，无析构），进程生命周期内保持打开，退出时由系统回收
    }
}
