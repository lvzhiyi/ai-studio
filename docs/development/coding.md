# 代码规范

- 格式与静态分析：仓库内没有 eslint / prettier / ruff 配置，格式工具待确认；类型检查用 `tsc --noEmit`（web 的 `tsconfig.json`，server 的 `tsconfig.json`）。
- 命名：待确认
- 注释：待确认（现有代码在文件头和关键函数写中文说明）
- 依赖：三个子项目各自管理依赖，以锁文件为准（`web/package-lock.json`、`server/pnpm-lock.yaml`、`engine/uv.lock`）；改依赖时同时检查锁文件；不带入凭据、生产地址或真实敏感数据。
- 子项目之间只通过 HTTP 通信，不跨目录 import 代码（见 [AGENTS.md](../../AGENTS.md)）。

## 生成代码

- 前端构建产物提交在 `engine/studio/web/static/`，由 `cd web && npm run build` 生成；不手改，改 `web/src` 后重新构建并审查 diff。
