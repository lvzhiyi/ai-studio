# 架构说明

ai-studio 由三个子项目组成：`web/`（工作台前端）、`server/`（Agent 后端）、`engine/`（执行引擎）。三者各自管理依赖、各自启动、各自测试，只通过 HTTP 通信，不跨目录 import 代码。

## 目标架构

```
web（Vite + React + TS）
  │  REST + SSE（Last-Event-ID 续传），JWT
server（NestJS）                      对外唯一入口
  │  agent-core：运行循环、工具注册、checkpoint、审批节点、预算
  │  plugins/drama：短剧工具、校验规则、提示词
  │  llm 网关 · auth · BullMQ 队列 · Postgres · Redis · MinIO
  │  HTTP（engine adapter，可换成 mock 引擎）
engine（Python studio-engine）        只监听 127.0.0.1
     出图 · 人脸质检 · 配音 · 图生视频 · 预览视频 · MCP Server
     ComfyUI · LM Studio · MLX
```

| 子项目 | 负责 | 不负责 |
|---|---|---|
| web | 交互、流式状态展示、审批、媒体预览 | 直接访问引擎 |
| server | 鉴权、Agent 编排、持久化、推送、调用 LLM、统计成本 | 运行本地大模型 |
| engine | 执行重活：模型轮流加载、出图、质检、配音、视频 | 用户、权限、业务状态 |

## 现状（2026-11-11 合并后）

```
web ──/api、/files──▶ engine 控制台接口（127.0.0.1:8780，同时托管 web 的构建产物）
server（独立运行，还没接上 engine）：POST /storyboard/stream、GET /health
```

| 子项目 | 已有 | 来源 |
|---|---|---|
| web | 引擎控制台：总览、项目、剧本、试一张图、任务、运行历史、阈值校准 | 原 ai-tools 控制台 |
| server | 流式分镜（SSE）、OpenAI 兼容的 LLM 服务（没有 Key 时返回模拟数据）、按设备或 IP 限流、CORS | 原镜头本转发服务；道具绘图和即梦/可灵模板已删除 |
| engine | 流水线、任务队列 + SSE、质检、MCP Server、命令行 | 原 ai-tools |

## 从现状到目标的过渡

| 阶段 | 变化 |
|---|---|
| 第 1 周 | server 加 engine adapter 和 mock 引擎；server 端实现分镜输出的逐行解析、修复和校验（原来在 Flutter 端），并和 engine 的分镜表格式对齐 |
| 第 2~4 周 | server 加持久化 run、队列和 Agent 循环，由它调用 engine |
| 第 5 周 | web 改为只连 server；server 加登录；engine 不再托管前端，`/files` 改由 server 通过 MinIO 签名 URL 提供 |
| 第 8 周 | 删除废弃的 `engine/studio/jingtouben.py` |

## 职责约定

- **分镜由 server 负责。** Agent 的拆分镜走 server 的 LLM 网关，网关可以路由到云端模型，也可以路由到本机 LM Studio。`engine/studio/plan.py` 只给命令行 `studio plan` 使用，不再扩展，以后的分镜改进只改 server。
- **engine 不感知用户和 run。** 它只接收"给这个分镜表跑这一步"这样的任务，状态归 server 管。
- **密钥只放在 server。** web 不打包任何密钥；engine 使用的本地模型不需要密钥，云端兜底的配置留在 `engine/config.toml` 和本机环境变量里。

## 面试讲法速记

- **为什么一个仓库三个子项目**：改接口时一次提交前后端同步，面试官一次就能看全；子项目之间只走 HTTP，以后拆成多个仓库也不用改代码。
- **为什么 TS 写 Agent 后端、Python 写引擎**：Agent 后端以 IO 为主（等模型、等引擎、推 SSE），Node 擅长，而且和前端共享类型；模型推理的生态在 Python。这也是业内常见的分层：BFF / Agent 服务加 AI 推理服务。
- **为什么 POST 加自己解析 SSE**：故事可能上千字，放不进 GET 查询串；浏览器的 EventSource 只支持 GET。只需要服务端单向推送，SSE 基于普通 HTTP，比 WebSocket 简单，代理和抓包也好调试。
- **为什么前端用 Vite 单页应用而不是 Next.js**：工作台在登录之后使用，不需要 SEO 和服务端渲染，以客户端状态和 SSE 为主。
