# 2025-12-26 上游合并任务 - claude-relay-service

## 背景
- 上游 `Wei-Shaw/claude-relay-service` 的 `main` 分支新增多项功能与修复，包含版本号提升至 `v1.1.241`、鉴权重大安全漏洞修复、账号导出同步 API、Claude 串行队列/预热拦截、cc 遥测适配、cron 测试支持等。
- 本地分支 `main` 相比 origin 领先 22 个提交、落后 1 个提交（`v1.1.239`），仍保留前次同步的本地独有功能。

## 目标
- 合并 `upstream/main` 最新变更到本地 `main`，保持本地独有功能与配置。
- 解决合并冲突并对关键功能进行必要验证（lint/test/build 至少择要执行）。
- 更新同步记录，确认 VERSION 策略与本地选择保持一致。

## 本地独有功能（需保留）
- OpenAI-Responses 分组功能支持（`src/routes/admin.js`, `src/services/accountGroupService.js` 等）。
- GPT/GPT-Responses 限流机制配置 UI（`web/admin-spa/src/components/accounts/AccountForm.vue`）。
- Azure OpenAI 平台规范化（`src/services/accountGroupService.js`）。
- 可复用的 `RateLimitConfig` 组件（`web/admin-spa/src/components/common/RateLimitConfig.vue`）。
- 前端依赖更新（`web/admin-spa/package*.json`）。

## TODO / 分阶段计划
- [x] 获取最新远端：`git fetch origin upstream`
- [x] 分析上游差异与关键变更影响本地功能的范围
- [x] 执行 `git merge upstream/main` 并解决冲突（优先保留本地独有功能，同时吸收安全修复）
- [x] 必要时调整 VERSION 及配置示例（保持本地策略）
- [x] 执行必要检查（lint/test/build 或最小用例），记录结果
- [x] 更新 `.upstream-sync.md` 同步记录
- [ ] 任务完成后移动文档至 `.agentdocs/workflow/done/`

## 关注点/风险
- 鉴权安全修复涉及 `src/middleware/auth.js`，需谨慎合并避免回退。
- 新增账户导出/同步逻辑（`src/routes/admin/sync.js`、`src/services/accountTestSchedulerService.js` 等）可能与本地路由或服务初始化冲突。
- 前端账号表单存在大规模变更，需确保保留本地限流配置 UI 与依赖升级，避免被覆盖。
