# 合并上游 main 最新功能（251212）

## 背景
上游仓库（`upstream/main`）近期新增并发队列健康检查/管理端点等功能，并更新了部分配置与前端表单。当前项目主分支已有多次上游合并记录，但落后于最新上游提交，需要同步。

## 目标
- 将 `upstream/main` 的最新改动合并到本仓库 `main`。
- 保持本地已有功能不回退。
- 通过现有 lint / 单测，确保合并后可用。

## 执行与结果
### 步骤
- [x] 检查远程与分支：确认存在 `upstream` 远程，当前位于 `main`。
- [x] 拉取上游：`git fetch upstream`。
- [x] 合并：`git merge upstream/main --no-edit`，仅 `VERSION` 发生冲突。
- [x] 冲突处理：保留本地较新的版本号 `1.1.238`，完成合并提交 `86e21a2a`。
- [x] 运行验证：`npm run lint:check`、`npm test`。
- [x] 修复测试问题：测试环境写日志到 `logs/` 目录因权限导致失败；在 `src/utils/logger.js` 中按 `NODE_ENV=test` 禁用文件日志，仅保留控制台输出，提交 `9f0b5122`。
- [x] 运行冒烟启动检查：发现 `logs/` 与 `data/` 目录不可写会触发 `EACCES`；增强降级策略：`logger` 在目录不可写时自动禁用文件日志并吞掉 transport error，`PricingService` 在无法写入 `data/` 目录时仍使用 fallback 价格数据（内存），落盘仅 best-effort，提交 `afb7ab82`。

### 主要变更来源
上游新增提交包括：
- 并发队列增强（健康检查/管理端点、测试用例）。
- `.env.example`、`docker-compose.yml` 等配置更新。
- 后端认证与调度相关逻辑细化。
- 管理后台 `AccountForm.vue` 等表单更新。

## 遇到的挑战
- `VERSION` 冲突：本地版本号高于上游，按版本语义保留本地值解决。
- 运行/测试权限问题：`logs/`、`data/` 目录可能由 root 创建导致不可写，触发 `EACCES` 干扰运行；通过在日志与价格缓存处增加可写性检测并降级，避免因落盘失败影响可用性。

## 后续建议
- 若需要推送到远端：执行 `git push origin main`。
- `logs/` 目录权限异常来自历史环境，建议在部署/容器构建阶段统一由运行用户创建，避免本地开发或 CI 再遇到权限问题。
- 当前存在未跟踪文件 `docs/platform-access.md`，未纳入本次合并；如需保留请手动决定是否提交或加入忽略。
