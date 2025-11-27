# 项目概览
- 目的：自建 Claude/Codex/Gemini API 中转服务，支持多账号池轮换、独立 API Key、用量统计、速率/并发/客户端限制，提供 Web 管理后台与 CLI 工具。
- 技术栈：Node.js 18+、Express、Redis；后端 JavaScript；管理后台为 web/admin-spa 前端（npm 构建）；脚本/CLI 使用 Commander/Inquirer。
- 主要目录：src(app.js, routes, handlers, services, models, validators, middleware, utils)、cli、scripts、config、web/admin-spa、docs、resources。
- 配置：`.env`（JWT_SECRET、ENCRYPTION_KEY、Redis、可选管理员凭据等）、`config/config.js`（服务端口、Redis 等），示例文件 `.env.example` 与 `config/config.example.js`。
- 运行入口：`src/app.js` 启动 Express 服务；`scripts/manage.js` 负责启动/停止/状态；CLI 入口 `cli/index.js`。
- 依赖与工具：ESLint + Prettier 格式约束；Jest/Supertest 测试；nodemon 开发热重载；Dockerfile 与 docker-compose 支持容器部署；Makefile 提供常用封装命令。