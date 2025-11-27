# 任务完成检查
- 必要检查：`npm run lint`（或 `npm run lint:check`）和 `npm test` 若改动影响逻辑；前端改动运行 `npm run build:web` 验证构建。
- 若涉及服务管理脚本/启动流程，确保 `npm run service:status` 正常且 `npm run service:logs` 无异常。
- 配置文件：如修改 `.env`/`config/config.js`，确认示例同步（如 `config.example.js` / `.env.example`）。
- 输出：在提交说明中列出修改点、影响面、已执行的检查/测试。
- 编码：保持 UTF-8 无 BOM；遵循 ESLint/Prettier 规则（无分号、单引号、100 列宽）；尊重 KISS/YAGNI/DRY/SOLID 原则，保持函数职责单一。