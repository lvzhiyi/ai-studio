# 接口联调约定

## 契约来源

- 接口工具：无。web 的请求类型和函数在 `web/src/api.ts`，字段与 engine 控制台接口（`engine/studio/web/`）返回的结构一一对应；server 的接口定义在 `server/src` 各模块的 controller 和 dto。
- 契约记录位置：有技术方案时写在 `docs/superpowers/specs`，否则写在关联 Issue。

## 项目接入边界

- 现状：web 开发时通过 Vite 代理把 `/api`、`/files` 转给 engine（默认 `http://127.0.0.1:8780`，用 `VITE_PROXY_TARGET` 覆盖）；server 独立运行，提供 `POST /storyboard/stream`（SSE）和 `GET /health`。演进计划见[架构说明](../architecture.md)。
- 环境与地址注入方式：server 用 `server/.env`（模板 `server/.env.example`）；web 用 Vite 环境变量；构建参数不放凭据，前端不打包任何密钥。
- 响应包裹与成功码：待确认
- 鉴权与过期处理：待确认（目前 server 只按设备或 IP 限流，登录在规划中）
- Mock 只放测试或明确的开发入口：server 没有 `LLM_API_KEY` 时返回模拟分镜，仅用于本地开发和演示。

## 测试账号与数据

- 账号与数据通过安全渠道提供，文档只记录角色和引用位置，不写凭据。
