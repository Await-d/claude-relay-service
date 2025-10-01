# Repository Guidelines

## Project Structure & Module Organization
- `src/`：核心服务代码；`routes/` 暴露 HTTP API，`services/` 负责调度、转发与成本统计，`middleware/`、`utils/`、`adapters/` 提供通用能力，`models/` 管理 Redis 等持久化实体。
- `cli/` 与 `scripts/` 存放维护脚本和自动化任务；`config/` 提供配置模板；`prototypes/`、`examples/` 用于实验验证与 API 示例。
- 前端管理端位于 `web/admin-spa/`，文档、资源与样例分布在 `docs/`、`resources/`、`examples/`。

## Build, Test, and Development Commands
- `npm install`：在 Node.js 18+ 环境安装依赖。
- `npm run dev` / `npm start`：本地开发与准生产流程，后者会串联 lint。
- `npm run lint:check`、`npm run lint`：执行 ESLint 检查或尝试自动修复。
- `npm run format:check`、`npm run format`：使用 Prettier 验证或格式化核心目录。
- `npm run test` 及 `npm run test:integration` 等：覆盖单测与关键集成路径。

## Coding Style & Naming Conventions
- 统一使用 Prettier + ESLint，两个空格缩进、单引号、100 字符行宽、禁止多余分号。
- 模块、函数、变量使用 `camelCase`，常量与环境变量使用全大写下划线。
- 共用逻辑抽至 `services/` 或 `utils/`，新增复杂流程需补充 JSDoc 并避免重复实现。

## Testing Guidelines
- Jest 为默认测试框架，测试文件放置于与被测模块同级的 `__tests__/` 或 `*.test.js`。
- 新增或改动核心能力需补充 401/429 等关键分支测试，并关注生成的 `logs/*-test-report.json` 指标。
- 在运行回归前确保 Redis 等外部依赖可用，必要时先执行 `npm run status:detail` 了解健康状态。

## Commit & Pull Request Guidelines
- 使用简化版 Conventional Commits，例如 `fix: 修复模型费用计算` 或 `chore: sync VERSION`。
- PR 描述需列出改动摘要、关联任务、执行的 lint/测试命令；涉及 UI 或配置时附截图或示例片段。
- 提交前确保通过 `npm run lint:check` 和核心测试，Docker 相关调整需附本地启动日志，避免提交敏感配置。
