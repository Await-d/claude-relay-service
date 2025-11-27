# 代码结构速览
- 核心目录：
  - `src/app.js` Express 入口；子目录 `routes/`, `handlers/`, `services/`, `models/`, `validators/`, `middleware/`, `utils/`。
  - `cli/`：命令行管理工具入口 `cli/index.js`。
  - `scripts/`：服务管理与迁移脚本（`manage.js`, `setup.js`, `update-model-pricing.js`, 数据导入导出、监控、迁移等）。
  - `config/`：`config.example.js`、实际配置 `config.js`。
  - `web/admin-spa/`：管理后台前端；通过 `npm run install:web` / `npm run build:web` 构建。
  - `docs/`, `resources/`, `config/`, `cli/`, `.github/` 等支持文件。
- 配置与示例：`.env.example`、`config/config.example.js`；Dockerfile 与 docker-compose 支持容器部署；Makefile 提供常用命令封装。
- 其他：`nodemon.json`、`VERSION`、`Dockerfile`、`docker-entrypoint.sh`、`scripts/manage.js` 服务启动封装。