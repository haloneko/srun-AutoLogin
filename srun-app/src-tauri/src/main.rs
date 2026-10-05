// 发布版在 Windows 上不显示多余的控制台窗口（勿删）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    srun_app_lib::run()
}
