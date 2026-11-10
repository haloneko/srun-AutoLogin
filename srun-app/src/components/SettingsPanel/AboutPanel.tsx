import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useKonamiCode } from "@/hooks/useKonamiCode";
import { trigger } from "@/domain/triggers";

interface AboutPanelProps {
  onToast: (msg: string) => void;
}

/// 直接用到的开源项目：名字 / 用途 / 许可证
const OPEN_SOURCE = [
  { name: "Tauri", desc: "桌面外壳、窗口与前后端通信", license: "MIT / Apache-2.0" },
  { name: "React", desc: "界面渲染", license: "MIT" },
  { name: "Vite", desc: "前端构建与开发服务器", license: "MIT" },
  { name: "TypeScript", desc: "前端类型系统", license: "Apache-2.0" },
  { name: "Rust", desc: "后端实现语言", license: "MIT / Apache-2.0" },
  { name: "serde / serde_json", desc: "配置与 IPC 序列化", license: "MIT / Apache-2.0" },
  { name: "chrono", desc: "时间处理", license: "MIT / Apache-2.0" },
  { name: "log", desc: "日志门面", license: "MIT / Apache-2.0" },
  { name: "tauri-plugin-autostart", desc: "开机自启动", license: "MIT / Apache-2.0" },
  { name: "tauri-plugin-single-instance", desc: "单实例运行", license: "MIT / Apache-2.0" },
  { name: "windows", desc: "Windows WiFi 接口绑定", license: "MIT / Apache-2.0" },
];
export default function AboutPanel({ onToast }: AboutPanelProps) {
  const [version, setVersion] = useState("");

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion(""));
  }, []);

  useKonamiCode(() => {
    trigger("konami.entered");
    onToast("隐藏指令已记录");
  });

  return (
    <section className="settings-section about-section">
      <h2 className="settings-section__title">关于</h2>
      <p className="settings-section__desc">
        深澜校园网自动登录{version ? ` · v${version}` : ""}
      </p>

      <h3 className="about-subtitle">开源项目</h3>
      <ul className="about-list">
        {OPEN_SOURCE.map((item) => (
          <li key={item.name} className="about-item">
            <span className="about-item__name">{item.name}</span>
            <span className="about-item__desc">{item.desc}</span>
            <span className="about-item__license">{item.license}</span>
          </li>
        ))}
      </ul>

      <p className="about-note">
        以上项目版权归各自作者所有，按各自许可证分发；本程序不修改其源码。
      </p>
    </section>
  );
}
