import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri 开发模式要求固定的 dev server 端口（与 src-tauri/tauri.conf.json 的 devUrl 一致）
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    // 目录别名：src 根，配合 tsconfig paths 使用，避免深层相对路径
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // 避免监听 src-tauri 下的 Rust 变更触发前端重载
      ignored: ["**/src-tauri/**"],
    },
  },
});
