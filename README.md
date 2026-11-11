# ai-studio · AI 短剧 Agent 工作台

一个编排**多步骤、多模态、长耗时**任务的 Agent 工作台，用 AI 短剧制作做验证场景：输入故事，由 Agent 走完 拆分镜 → 检查 → 出图 → 质检 → 重画不合格镜头 → 配音 → 合成预览视频，关键步骤由人确认。

> 2026-11-11：原 ai-tools（本地流水线）和镜头本（Flutter App + NestJS 服务）合并为本仓库。镜头本客户端已归档，后端并入 `server/`；整体规划和 8 周里程碑见仓库外的个人笔记。

## 仓库结构

三个子项目各自管理依赖、各自启动、各自测试，彼此只通过 HTTP 通信。

```
web/      Web 工作台：Vite + React + TypeScript
server/   Agent 后端：NestJS（目前是转发服务：SSE、按设备限流、提示词模板下发；之后演进为 Agent 编排）
engine/   执行引擎 studio-engine：Python（出图、人脸质检、配音、图生视频、预览视频、MCP Server），只监听本机
docs/     学习日志、路线图、模型知识图谱、工具速查
```

```
web ──REST + SSE──▶ server ──HTTP──▶ engine ──▶ ComfyUI / LM Studio / MLX
```

现阶段 server 还没接上 engine，web 直接连 engine 的控制台接口（`127.0.0.1:8780`）。

## 本地运行

### engine

```bash
cd engine
uv sync
uv run studio check                 # 检查 ComfyUI、LM Studio 等本地环境
uv run studio web --no-browser      # 控制台接口 http://127.0.0.1:8780（同时托管已构建的前端）
```

引擎的详细说明（流水线、实测数据、角色一致性、MCP Server）见 [engine/README.md](engine/README.md)。

### web

```bash
cd web
npm install
npm run dev        # http://localhost:5173/static/ ，/api 和 /files 代理到 VITE_PROXY_TARGET（默认 127.0.0.1:8780）
npm run build      # 类型检查 + 构建，产物暂时输出到 engine/studio/web/static，由引擎托管
```

前后端分开部署时，用 `VITE_API_BASE` 指定接口地址。

### server

```bash
cd server
cp .env.example .env      # 不填 LLM_API_KEY 时使用模拟数据
pnpm install
pnpm run start:dev        # http://localhost:3000/health
```

## 验证

```bash
cd engine && uv run python -m unittest discover -s tests
cd web && npm run typecheck && npm run build
cd server && npm run typecheck && npm test
```
