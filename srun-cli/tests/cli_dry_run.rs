//! CLI 集成测试：用 `assert_cmd` 调用 `srun-cli` 二进制，
//! 验证 --dry-run 端到端输出与离线加密链路一致性。

use assert_cmd::Command;

/// --dry-run 应打印所有构造的登录请求参数，
/// 且 chksum 与 Python 同输入下的黄金向量一致
#[test]
fn dry_run_prints_params_and_golden_chksum() {
    let stdout = Command::cargo_bin("srun-cli")
        .unwrap()
        .args([
            "-u", "user1", "-p", "pass1", "--dry-run", "--ip", "1.2.3.4", "--challenge", "abc123",
        ])
        .output()
        .unwrap()
        .stdout;
    let stdout = String::from_utf8_lossy(&stdout);
    assert!(stdout.contains("dry-run 登录请求参数:"), "got: {stdout}");
    assert!(stdout.contains("username = user1"), "got: {stdout}");
    assert!(stdout.contains("ac_id = 1"), "got: {stdout}");
    assert!(stdout.contains("n = 200"), "got: {stdout}");
    assert!(stdout.contains("type = 1"), "got: {stdout}");
    assert!(stdout.contains("os = Windows 10"), "got: {stdout}");
    assert!(stdout.contains("name = Windows"), "got: {stdout}");
    assert!(stdout.contains("double_stack = 0"), "got: {stdout}");
    // password 含 {MD5} 前缀
    assert!(stdout.contains("password = {MD5}"), "got: {stdout}");
    // info 含 {SRBX1} 前缀
    assert!(stdout.contains("info = {SRBX1}"), "got: {stdout}");
    // chksum 黄金向量（与 Python `srun.user.login` 同输入下一致）
    assert!(
        stdout.contains("chksum = 5578170f0e61d5142ff5bf684d89a724c79c1b60"),
        "got: {stdout}"
    );
}

/// --dry-run 缺少 --ip / --challenge 时应非零退出
#[test]
fn dry_run_requires_ip_and_challenge() {
    let output = Command::cargo_bin("srun-cli")
        .unwrap()
        .args(["-u", "u", "-p", "p", "--dry-run"])
        .output()
        .unwrap();
    assert!(!output.status.success(), "expected non-zero exit");
}

/// 缺少必填 -u / -p 时 clap 应报错退出
#[test]
fn missing_required_args_exits_nonzero() {
    let output = Command::cargo_bin("srun-cli")
        .unwrap()
        .output()
        .unwrap();
    assert!(!output.status.success(), "expected non-zero exit");
}
