import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri 开发模式要求固定的 dev server 端口（与 src-tauri/tauri.conf.json 的 devUrl 一致）
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // 避免监听 src-tauri 下的 Rust 变更触发前端重载
      ignored: ["**/src-tauri/**"],
    },
  },
});
