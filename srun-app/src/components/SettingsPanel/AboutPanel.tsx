import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useKonamiCode } from "@/hooks/useKonamiCode";
import { changeDebugMode } from "@/hooks/useDebugMode";
import { trigger } from "@/domain/triggers";
import appIcon from "../../../app-icon.svg";

interface AboutPanelProps {
  onToast: (msg: string) => void;
}

const KONAMI_SEQUENCE = [
  "arrowup",
  "arrowup",
  "arrowdown",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "arrowleft",
  "arrowright",
  "b",
  "a",
  "enter",
];

const DEBUG_SEQUENCE = [...KONAMI_SEQUENCE.slice(0, 8), ..."haloneko", "enter"];

const MIT_OR_APACHE = "MIT OR Apache-2.0";

const OPEN_SOURCE_GROUPS = [
  {
    title: "桌面应用",
    projects: [
      { name: "Tauri", desc: "桌面窗口、系统托盘与本机功能调用", license: MIT_OR_APACHE },
      { name: "React / React DOM", desc: "绘制和更新界面", license: "MIT" },
      { name: "Tauri Autostart", desc: "开机自启动", license: MIT_OR_APACHE },
      { name: "Tauri Single Instance", desc: "重复打开时唤起已有窗口", license: MIT_OR_APACHE },
      { name: "Tauri Clipboard Manager", desc: "右键菜单的复制与粘贴", license: MIT_OR_APACHE },
      { name: "windows-rs", desc: "监听 Windows 无线网络变化", license: MIT_OR_APACHE },
      { name: "Serde / serde_json", desc: "读写配置和网络使用记录", license: MIT_OR_APACHE },
      { name: "Chrono", desc: "处理日期与连接时间", license: MIT_OR_APACHE },
      { name: "log", desc: "记录运行日志", license: MIT_OR_APACHE },
    ],
  },
  {
    title: "认证与命令行",
    projects: [
      { name: "reqwest", desc: "发送校园网认证和状态查询请求", license: MIT_OR_APACHE },
      { name: "rustls", desc: "为 HTTPS 请求提供加密连接", license: "Apache-2.0 OR ISC OR MIT" },
      { name: "Tokio", desc: "处理网络请求和后台任务", license: "MIT" },
      { name: "RustCrypto（hmac、md-5、sha1）", desc: "生成深澜认证所需的摘要和校验值", license: MIT_OR_APACHE },
      { name: "base64 / hex", desc: "编码认证参数", license: MIT_OR_APACHE },
      { name: "clap", desc: "解析命令行参数", license: MIT_OR_APACHE },
      { name: "thiserror / anyhow", desc: "处理认证与命令行错误", license: MIT_OR_APACHE },
    ],
  },
  {
    title: "开发与测试",
    projects: [
      { name: "Rust", desc: "编译桌面应用和命令行工具", license: MIT_OR_APACHE },
      { name: "Tauri CLI / tauri-build", desc: "构建桌面程序和安装包", license: MIT_OR_APACHE },
      { name: "Vite / Vite React Plugin", desc: "开发和打包界面", license: "MIT" },
      { name: "TypeScript", desc: "检查界面代码的类型", license: "Apache-2.0" },
      { name: "DefinitelyTyped", desc: "提供 React 的 TypeScript 类型定义", license: "MIT" },
      { name: "wiremock / assert_cmd", desc: "测试网关交互和命令行行为", license: MIT_OR_APACHE },
    ],
  },
];

export default function AboutPanel({ onToast }: AboutPanelProps) {
  const [version, setVersion] = useState("");
  const [groupIndex, setGroupIndex] = useState(0);
  const group = OPEN_SOURCE_GROUPS[groupIndex];

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion(""));
  }, []);

  useKonamiCode(KONAMI_SEQUENCE, () => {
    trigger("konami.entered");
    onToast("隐藏指令生效：已解锁主题「流星夜空」");
  });
  useKonamiCode(DEBUG_SEQUENCE, () => {
    changeDebugMode(true);
    onToast("调试模式已开启");
  });

  return (
    <section className="settings-section settings-page" aria-labelledby="about-product-name">
      <header className="about-product">
        <img className="about-product__icon" src={appIcon} alt="" width={48} height={48} />
        <div>
          <h2 id="about-product-name" className="about-product__name" data-selectable>深澜校园网自动登录</h2>
          <p className="about-product__desc">自动登录校园网，查看连接状态和网络使用历史。</p>
        </div>
        {version && <span className="about-product__version" data-selectable>v{version}</span>}
      </header>

      <section className="about-credits" aria-labelledby="about-credits-title">
        <h3 id="about-credits-title" className="about-credits__title">开源致谢</h3>
        <div className="about-credits__card">
          <div className="about-categories" role="group" aria-label="开源项目分类">
            {OPEN_SOURCE_GROUPS.map(({ title }, index) => (
              <button
                key={title}
                type="button"
                aria-pressed={index === groupIndex}
                aria-controls="about-projects"
                onClick={() => setGroupIndex(index)}
              >
                {title}
              </button>
            ))}
          </div>
          <table id="about-projects" className="about-projects" aria-label={group.title}>
            <tbody>
              {group.projects.map(({ name, desc, license }) => (
                <tr key={name}>
                  <td>
                    <span className="about-projects__name" data-selectable>{name}</span>
                    <span className="about-projects__desc">{desc}</span>
                  </td>
                  <td className="about-projects__license">
                    <span data-selectable>{license}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
