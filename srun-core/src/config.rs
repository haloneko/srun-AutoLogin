//! 配置常量与运行时配置结构
//!
//! 对应 Python `config.py` 的常量，以及 `main.py` 中隐含的重试/等待默认值。
//! 这些常量在加密链路、HTTP 请求构造、登录参数拼装中均会被引用，
//! 集中放置便于将来切换学校 / 多端点支持时统一修改。

/// 校园网登录网站地址（与 Python 版一致，末尾保留 `/`，由 http 模块负责拼接）
pub const BASE_URL: &str = "https://wlrz.sdmu.edu.cn/";

/// 统一 User-Agent（对应 Python `utils/request.py` 中的 service.headers）
pub const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                             (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/// 深澜自定义 Base64 字母表（对应 Python `srun_lib.SRUN_BASE64_ALPHA`）
/// 标准 Base64 字母表被替换为此顺序，用于 `encrypt_info` 输出编码。
pub const SRUN_BASE64_ALPHA: &str = "LVoJPiCN2R8G90yg+hmFHuacZ1OWMnrsSTXkYpUq/3dlbfKwv6xztjI7DeBE45QA";

/// 校园网认证区域 ID（对应 Python `srun/user.py` 中 `acid: '1'`）
pub const AC_ID: &str = "1";

/// 加密版本标识（对应 Python `srun/user.py` 中 `enc_ver: "srun_bx1"`）
pub const ENC_VER: &str = "srun_bx1";

/// 登录参数 `n`（对应 Python `chkstr_data['n']` 与 `login_params['n']`）
pub const N: u32 = 200;

/// 登录参数 `type`（对应 Python `chkstr_data['type']` 与 `login_params['type']`）
pub const TYPE: u32 = 1;

/// 登录参数 `os`（对应 Python `login_params['os']`）
pub const OS: &str = "Windows 10";

/// 登录参数 `name`（对应 Python `login_params['name']`）
pub const NAME: &str = "Windows";

/// 登录参数 `double_stack`（对应 Python `login_params['double_stack']`）
pub const DOUBLE_STACK: u32 = 0;

/// 默认重试次数（与 Python `main.py` 中 `range(5)` 一致）
pub const DEFAULT_RETRY: u32 = 5;

/// 默认等待秒数（与 Python `main.py` 中 `wait(5, '自动关闭')` 一致）
pub const DEFAULT_WAIT: u64 = 5;

/// 运行时配置
///
/// 由 CLI 层（或未来 GUI 层）构造后传入核心库使用。
/// `username` / `password` 必填，`retry` / `wait` 缺省时取 [`Default`] 实现的默认值。
#[derive(Debug, Clone)]
pub struct SrunConfig {
    /// 深澜账号用户名
    pub username: String,
    /// 深澜账号密码
    pub password: String,
    /// 登录失败重试次数（仅在网络/解析异常时重试；服务端返回 error!=ok 不重试）
    pub retry: u32,
    /// 登录流程结束后倒计时关闭秒数
    pub wait: u64,
}

impl Default for SrunConfig {
    fn default() -> Self {
        Self {
            username: String::new(),
            password: String::new(),
            retry: DEFAULT_RETRY,
            wait: DEFAULT_WAIT,
        }
    }
}
