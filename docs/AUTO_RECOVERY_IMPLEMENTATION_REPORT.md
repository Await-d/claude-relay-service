# 自动错误恢复功能实施报告

## 📊 当前实施状态

### ✅ 已完成的工作

#### 1. 通用基础设施
- ✅ **errorRecoveryHelper.js** - 通用错误恢复助手模块
  - 位置: `src/utils/errorRecoveryHelper.js`
  - 功能: 为所有账户类型提供统一的错误恢复逻辑
  - 包含: 检查/清除/创建错误恢复数据的所有方法

#### 2. OpenAI-Responses 账户（完整实现）
- ✅ **后端服务**: `openaiResponsesAccountService.js`
  - 添加 `autoRecoverErrors` 字段（默认 false）
  - 添加 `errorRecoveryDuration` 字段（默认 5 分钟）
  - 实现 `checkAndClearErrorStatus()` 方法

- ✅ **中转服务**: `openaiResponsesRelayService.js`
  - 网络错误时根据配置设置恢复时间
  - 启用时自动恢复，禁用时需手动重置

- ✅ **调度器**: `unifiedOpenAIScheduler.js`
  - 专属账户自动恢复检查
  - 共享池账户自动恢复检查
  - 粘性会话账户可用性检查

- ✅ **前端界面**: `AccountForm.vue`
  - 创建模式：自动错误恢复开关 + 恢复时间输入
  - 编辑模式：自动错误恢复开关 + 恢复时间输入
  - 支持暗黑模式

#### 3. 实用工具脚本
- ✅ **批量添加脚本**: `scripts/add-auto-recovery-to-all-accounts.js`
  - 功能: 一键为所有账户类型添加自动恢复字段
  - 支持 dry-run 模式预览变更

- ✅ **检查脚本**: `scripts/check-auto-recovery-status.js`
  - 功能: 检查所有账户类型的实施状态
  - 输出详细的实施进度表格

---

## 🔄 需要完成的工作

### 账户类型实施状态

| 账户类型 | Service | Relay | 前端UI | 调度器 | 状态 |
|---------|---------|-------|--------|--------|------|
| OpenAI-Responses | ✅ | ✅ | ✅ | ✅ | **完整** |
| Claude Official | ❌ | ⚠️ | ❌ | ❌ | 待实施 |
| Claude Console | ❌ | ⚠️ | ❌ | ❌ | 待实施 |
| Gemini OAuth | ❌ | ⚠️ | ❌ | ❌ | 待实施 |
| Gemini API | ❌ | ⚠️ | ❌ | ❌ | 待实施 |
| OpenAI | ❌ | N/A | ❌ | ❌ | 待实施 |
| AWS Bedrock | ❌ | ❌ | ❌ | ❌ | 待实施 |
| Azure OpenAI | ❌ | ⚠️ | ❌ | ❌ | 待实施 |
| Droid | ❌ | ⚠️ | ❌ | ❌ | 待实施 |
| CCR | ❌ | ⚠️ | ❌ | ❌ | 待实施 |

说明: ⚠️  = 有网络错误处理但未集成错误恢复助手

---

## 🚀 快速实施指南

### 方法1: 快速启用（仅 OpenAI-Responses）

**适用场景**: 您主要使用 OpenAI-Responses 账户

```bash
# 步骤1: 重启服务
npm restart

# 步骤2: 打开 Web 管理界面
# 访问 http://your-domain/admin-next/

# 步骤3: 编辑 OpenAI-Responses 账户
# - 勾选"启用自动错误恢复"
# - 设置恢复时间（建议 5-15 分钟）
# - 保存

# 步骤4: 如果账户当前是 error 状态，点击"重置状态"
```

### 方法2: 为所有账户类型添加字段

**适用场景**: 为所有现有账户添加配置字段（但功能尚未完全实现）

```bash
# 步骤1: 预览将要做的更改（推荐）
node scripts/add-auto-recovery-to-all-accounts.js --dry-run

# 步骤2: 执行批量添加
node scripts/add-auto-recovery-to-all-accounts.js

# 步骤3: 检查状态
node scripts/check-auto-recovery-status.js
```

**注意**: 此方法只添加字段，完整功能需要更新代码（见方法3）

### 方法3: 完整实施所有账户类型

**适用场景**: 为所有账户类型实现完整的自动错误恢复功能

**需要修改的文件清单**:

#### 对于每个账户类型 (以 Claude 为例):

1. **AccountService** (`src/services/claudeAccountService.js`)
   ```javascript
   // 在 createAccount 中添加参数
   autoRecoverErrors = false,
   errorRecoveryDuration = 5

   // 在账户数据中添加字段
   autoRecoverErrors: autoRecoverErrors.toString(),
   errorRecoveryDuration: errorRecoveryDuration.toString(),

   // 添加方法
   async checkAndClearErrorStatus(accountId) {
     const account = await this.getAccount(accountId)
     const ErrorRecoveryHelper = require('../utils/errorRecoveryHelper')

     if (ErrorRecoveryHelper.shouldClearErrorStatus(account, accountId, 'Claude')) {
       await this.updateAccount(accountId, ErrorRecoveryHelper.createClearErrorData())
       return true
     }
     return false
   }
   ```

2. **RelayService** (`src/services/claudeRelayService.js`)
   ```javascript
   // 在网络错误处理部分
   const ErrorRecoveryHelper = require('../utils/errorRecoveryHelper')

   if (ErrorRecoveryHelper.isNetworkError(error.code)) {
     const recoveryData = ErrorRecoveryHelper.createErrorRecoveryData(
       fullAccount,
       error.code,
       'Claude'
     )
     await claudeAccountService.updateAccount(account.id, recoveryData)
   }
   ```

3. **调度器** (`src/services/unifiedClaudeScheduler.js` 等)
   ```javascript
   // 在账户选择前检查自动恢复
   if (account.status === 'error') {
     const isErrorCleared = await claudeAccountService.checkAndClearErrorStatus(account.id)
     if (isErrorCleared) {
       account = await claudeAccountService.getAccount(account.id)
       logger.info(`✅ Claude account ${account.id} auto-recovered from error`)
     }
   }
   ```

4. **前端界面** (`web/admin-spa/src/components/accounts/AccountForm.vue`)
   - 参考 OpenAI-Responses 的实现（第1549-1582行）
   - 在对应平台的配置区域添加相同的UI组件
   - 在表单初始化和提交中添加字段处理

---

## 📝 实施优先级建议

### 高优先级（推荐先实施）
1. **Claude Official** - 最常用，有4处网络错误处理
2. **Azure OpenAI** - 使用较多，有3处网络错误处理
3. **OpenAI** - 通过统一调度器调用

### 中等优先级
4. **Gemini OAuth** - 有2处网络错误处理
5. **Droid** - 有1处网络错误处理
6. **CCR / Claude Console** - 各有1处网络错误处理

### 低优先级
7. **Gemini API** - 使用较少
8. **AWS Bedrock** - 目前没有网络错误处理

---

## 🔍 验证测试清单

完成实施后，请进行以下测试：

### 功能测试
- [ ] 新建账户时可以配置自动错误恢复
- [ ] 编辑账户时可以修改自动错误恢复配置
- [ ] 网络错误发生时正确设置恢复时间（启用时）
- [ ] 网络错误发生时保持永久error（禁用时）
- [ ] 达到恢复时间后账户自动变为 active 状态
- [ ] 自动恢复后的账户可以正常使用

### UI测试
- [ ] 明亮模式下UI显示正常
- [ ] 暗黑模式下UI显示正常
- [ ] 复选框和输入框交互正常
- [ ] 表单验证正常（恢复时间必须 > 0）

### 日志测试
- [ ] 启用自动恢复时有正确的日志
- [ ] 禁用自动恢复时有正确的日志
- [ ] 自动恢复成功时有正确的日志

---

## 💡 使用建议

### 推荐配置

| 场景 | autoRecoverErrors | errorRecoveryDuration | 说明 |
|------|------------------|----------------------|------|
| 生产环境 - 稳定API | ✅ 启用 | 10-15 分钟 | 适合偶尔网络波动 |
| 生产环境 - 不稳定API | ❌ 禁用 | N/A | 需要人工确认问题 |
| 开发环境 | ✅ 启用 | 3-5 分钟 | 快速恢复便于开发 |
| 测试环境 | ✅ 启用 | 1-3 分钟 | 快速验证 |

### 最佳实践

1. **首次启用**
   - 先在1-2个账户上测试
   - 观察日志确认工作正常
   - 逐步推广到其他账户

2. **监控**
   - 定期检查日志中的自动恢复事件
   - 如果某账户频繁进入 error 状态，考虑禁用自动恢复并人工检查

3. **调整恢复时间**
   - 根据实际网络情况调整
   - 如果API提供商有明确的维护窗口，设置更长的恢复时间

---

## 📚 相关文件

### 核心文件
- `src/utils/errorRecoveryHelper.js` - 通用错误恢复助手
- `src/services/openaiResponsesAccountService.js` - 参考实现
- `src/services/openaiResponsesRelayService.js` - 参考实现
- `web/admin-spa/src/components/accounts/AccountForm.vue` - 前端UI

### 实用工具
- `scripts/add-auto-recovery-to-all-accounts.js` - 批量添加字段
- `scripts/check-auto-recovery-status.js` - 状态检查

### 文档
- `CLAUDE.md` - 项目文档（需要更新）

---

## ⚠️ 注意事项

1. **向后兼容性**
   - 所有字段默认值都是禁用（false）
   - 旧账户不会自动启用此功能
   - 需要用户主动配置

2. **数据持久化**
   - 所有配置存储在 Redis
   - 重启服务不会丢失配置
   - 备份Redis时会包含这些配置

3. **性能影响**
   - 自动恢复检查是轻量级的
   - 仅在账户选择时检查
   - 对系统性能影响极小

---

## 📞 获取帮助

如有问题，请：
1. 检查日志文件 `logs/claude-relay-*.log`
2. 运行检查脚本查看状态
3. 参考 OpenAI-Responses 的完整实现
4. 提交 GitHub Issue

---

**生成时间**: 2025-11-26
**版本**: 1.0.0
**状态**: OpenAI-Responses 已完整实现，其他账户类型待实施
