# 验证规范

命令与根目录 `ai-workflow.yaml` 的 `verify` 保持一致，二者不一致时以本文件为准并同步配置。

默认验证平台：web（本机浏览器）；engine 依赖 Apple Silicon 上的 MLX，只在本机验证。

```bash
python3 <workflow-core>/scripts/check_docs.py --root . --check-config
cd engine && uv run python -m unittest discover -s tests
cd web && npm run typecheck && npm run build
cd server && npm run typecheck && npm test
cd server && npm run test:cov
```

| 档位 | 开发中 | 交付前 |
| --- | --- | --- |
| 纯文档 | 核对关联规则与链接 | `check_docs.py --check-config` |
| 轻量代码 | 最小复现或受影响测试 | 只跑改动所在子项目的那一条命令 |
| 标准代码 | 相关测试基线与定向回归 | engine、web、server 三条命令全部跑 |
| 完整代码 | 按风险选基线 | 同标准档，server 改跑 `npm run test:cov`，并做关键链路验收 |

- 改了代码至少有格式、静态分析、相关测试三项结果；没执行的写明原因，不写成通过。
- 覆盖率门槛在 `server/package.json` 的 `jest.coverageThreshold`（行 90%、分支 75%）。
- CI：`.github/workflows/ci.yml`，按路径过滤触发；web 跑 `npm ci && npm run build`，server 跑 `pnpm install --frozen-lockfile`、`pnpm run typecheck`、`pnpm run test:cov`、`pnpm run build`；engine 不在 CI 中运行。
