// Web 工作台：独立的 Vite 项目。
// 开发：npm run dev，接口通过代理转给后端（默认是本机引擎的控制台接口 127.0.0.1:8780，
//       server 接管后改成 server 的地址），用 VITE_PROXY_TARGET 覆盖。
// 构建：npm run build，产物暂时仍输出到 engine/studio/web/static，由引擎托管，
//       保证 `uv run studio web` 不装 Node 也能用；server 接管前端托管后改成输出到 dist/。
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const target = env.VITE_PROXY_TARGET || "http://127.0.0.1:8780";
  return {
    plugins: [react()],
    base: "/static/",
    build: {
      outDir: "../engine/studio/web/static",
      emptyOutDir: true,
    },
    server: {
      port: 5173,
      proxy: {
        "/api": { target, changeOrigin: true },
        "/files": { target, changeOrigin: true },
      },
    },
  };
});
