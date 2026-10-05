//! srun-core - 深澜校园网登录核心库
//!
//! 本 crate 封装深澜校园网自动登录的全部业务逻辑（加密、HTTP、登录编排），
//! 与具体的 UI 层（CLI / Tauri GUI）解耦，便于未来复用。

pub mod config;
pub mod error;
pub mod jsonp;

#[cfg(test)]
mod tests {
    /// 工具链可用性 smoke 测试：确保 cargo test 流程通。
    #[test]
    fn smoke() {
        assert!(true);
    }
}

