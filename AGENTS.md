# ai-studio · 开发约定

给 AI 编程助手和自己看的约定。产品和运行方式见 [README](README.md)。

## 仓库

- `web/`：Web 工作台（Vite + React + TS）
- `server/`：NestJS Agent 后端（目前只做转发、限流、模板下发）
- `engine/`：Python 执行引擎 studio-engine，所有 `uv run studio ...` 命令都在这个目录下运行
- 三个子项目各自管理依赖、各自测试，只通过 HTTP 通信；不跨目录 import 代码

## 约束

- 密钥只放在 `server/.env`（已忽略）；前端不打包任何密钥，调用云端模型只能经过 server。
- 引擎只监听本机，不直接对外提供服务。
- 第三方 API 以各自的锁文件（`web/package-lock.json`、`server/pnpm-lock.yaml`、`engine/uv.lock`）锁定的版本为准，不凭记忆写。
- 日志里不打印故事内容、请求体和响应体。
- 前端构建产物暂时提交在 `engine/studio/web/static/`（用控制台的人不需要装 Node），改了 `web/src` 要重新 `npm run build`。
- `engine/studio/jingtouben.py`（镜头本导入）已废弃，只为兼容旧导出文件保留，不再扩展。
- 不自动推送或发布；远程仓库是公开的，提交前确认不含密钥和个人资料。

## 验证

- engine：`cd engine && uv run python -m unittest discover -s tests`
- web：`cd web && npm run typecheck && npm run build`
- server：`cd server && npm run typecheck && npm test`；覆盖率 `npm run test:cov`
- 只报告实际跑过的验证。

## 协作方式

- 用中文沟通；改完自己跑「验证」里的命令。
- 涉及技术选型时，顺带一两句「面试中怎么讲」。
