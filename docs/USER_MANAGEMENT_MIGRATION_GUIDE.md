# 用户管理系统迁移指南

本指南详细说明如何使用数据库迁移工具将现有的 Claude Relay Service 从纯 API Key 认证系统安全地升级到用户管理系统。

## 📋 迁移概述

### 迁移目标
- 从纯 API Key 认证升级到基于用户的管理系统
- 保持现有 API Key 的完整功能
- 实现零宕机迁移
- 提供完整的回滚机制

### 迁移内容
1. **用户数据结构创建**: 建立用户管理相关的数据模型
2. **API Key 迁移**: 将现有 API Key 关联到默认用户账户
3. **索引建立**: 创建用户-API Key 关联索引
4. **配置更新**: 启用用户管理功能
5. **数据验证**: 确保迁移完整性

## 🚀 快速开始

### 1. 环境检查
```bash
# 检查 Node.js 版本（需要 14.x 或更高）
node --version

# 确认服务配置
cat config/config.js

# 检查环境变量
cat .env
```

### 2. 试运行迁移
```bash
# 推荐：先执行试运行检查迁移过程
node scripts/migrate-user-management.js --dry-run
```

### 3. 执行实际迁移
```bash
# 生产环境迁移
node scripts/migrate-user-management.js

# 或指定特定选项
node scripts/migrate-user-management.js --force --batch-size 100
```

## 📚 命令行选项

### 基本选项
- `--dry-run`: 试运行模式，不修改任何数据
- `--force`: 强制执行迁移（即使检测到现有用户数据）
- `--skip-backup`: 跳过备份创建（不推荐生产环境使用）
- `--skip-validation`: 跳过迁移后验证
- `--batch-size <n>`: 设置批处理大小（默认: 50）
- `--help`: 显示帮助信息

### 回滚选项
- `--rollback`: 自动回滚最近的迁移
- `--rollback <backup-file>`: 从指定备份文件回滚

### 用户创建选项
- `--no-default-user`: 不自动创建默认用户

## 🔧 详细使用说明

### 迁移前准备

#### 1. 环境变量检查
确保以下环境变量正确配置：
```bash
# 必需的环境变量
JWT_SECRET=your-secure-jwt-secret-key
ENCRYPTION_KEY=your-32-character-encryption-key
REDIS_HOST=localhost
REDIS_PORT=6379
```

#### 2. 服务状态检查
```bash
# 检查服务状态
npm run cli status

# 检查 Redis 连接
redis-cli ping
```

#### 3. 数据备份（可选但推荐）
```bash
# 手动备份 Redis 数据
redis-cli --rdb /path/to/backup.rdb

# 或使用 BGSAVE
redis-cli BGSAVE
```

### 迁移执行流程

#### 第一步：试运行验证
```bash
# 执行试运行，检查所有前置条件
node scripts/migrate-user-management.js --dry-run

# 预期输出示例：
# 🚀 用户管理系统数据迁移工具
# 🔍 运行模式: 试运行 (不会修改数据)
# [1/8] 环境检查 ✅
# [2/8] 数据库连接检查 ✅
# [3/8] 现有数据分析 ✅
# ...
# ✅ 用户管理系统迁移成功完成！
```

#### 第二步：执行实际迁移
```bash
# 标准迁移（推荐）
node scripts/migrate-user-management.js

# 快速迁移（跳过某些检查）
node scripts/migrate-user-management.js --skip-validation

# 强制迁移（忽略警告）
node scripts/migrate-user-management.js --force
```

#### 第三步：验证迁移结果
```bash
# 重启服务以加载新功能
npm restart

# 或使用服务管理命令
npm run service:restart

# 验证用户管理界面
curl http://localhost:3000/admin/users

# 测试现有 API Key
curl -H "Authorization: Bearer cr_your_api_key" \
     http://localhost:3000/api/v1/models
```

### 迁移后配置

#### 1. Web 界面访问
迁移完成后，访问 Web 管理界面：
```
http://localhost:3000/web/users
```

#### 2. 用户账户创建
```bash
# 使用 CLI 创建新用户
npm run cli users create --username newuser --email user@example.com

# 通过 Web 界面创建用户
# 访问: http://localhost:3000/web/users/create
```

#### 3. API Key 管理
```bash
# 查看迁移后的 API Key
npm run cli keys list

# 为新用户创建 API Key
npm run cli keys create --user-id user_new_user --name "New User Key"
```

## 🔄 回滚操作

### 自动回滚
如果迁移过程中出现错误，工具会自动提示是否执行回滚：
```bash
# 迁移失败时的输出示例：
# 💥 迁移失败！
# ❌ 错误: Database connection failed
# 🔄 检测到部分操作已执行，建议回滚
# ? 是否立即执行回滚操作？ (Y/n)
```

### 手动回滚
```bash
# 从最近的备份回滚
node scripts/migrate-user-management.js --rollback

# 从指定备份文件回滚
node scripts/migrate-user-management.js --rollback backups/pre-migration-backup-2025-01-01.json
```

### 回滚验证
```bash
# 回滚后重启服务
npm restart

# 验证原有功能
curl -H "Authorization: Bearer cr_your_api_key" \
     http://localhost:3000/api/v1/messages \
     -d '{"model":"claude-3-sonnet","messages":[{"role":"user","content":"test"}]}'
```

## 📊 迁移报告

每次迁移都会生成详细报告：

### 报告位置
- 迁移报告: `reports/user-management-migration-report-{timestamp}.json`
- 备份文件: `backups/user-management-migration/pre-migration-backup-{timestamp}.json`
- 回滚数据: `backups/user-management-migration/rollback-data-{timestamp}.json`

### 报告内容
```json
{
  "migrationInfo": {
    "version": "1.0.0",
    "timestamp": "2025-01-01T00:00:00.000Z",
    "duration": 5000,
    "mode": "actual"
  },
  "statistics": {
    "totalApiKeys": 10,
    "migratedApiKeys": 10,
    "createdUsers": 1,
    "successRate": "100.00"
  },
  "systemStatus": {
    "userManagementEnabled": true,
    "backupCreated": true,
    "rollbackAvailable": true
  },
  "postMigrationSteps": [
    "1. 重启服务以加载新的用户管理功能",
    "2. 访问Web管理界面验证用户管理功能",
    "3. 测试API Key在新系统下的工作状态"
  ]
}
```

## 🧪 测试工具

### 迁移测试套件
```bash
# 运行完整测试套件
node scripts/test-user-migration.js

# 测试内容包括：
# - 环境检查功能测试
# - 数据库连接测试
# - 数据分析测试
# - 试运行迁移测试
# - 实际迁移测试
# - 验证功能测试
# - 回滚功能测试
```

### 测试报告
测试完成后会生成报告：`test-reports/user-migration-test-report-{timestamp}.json`

## ⚠️ 注意事项

### 迁移前
1. **备份数据**: 强烈建议在生产环境迁移前创建完整备份
2. **低峰执行**: 建议在系统低峰时段执行迁移
3. **测试环境**: 先在测试环境验证迁移过程
4. **依赖检查**: 确认所有依赖服务（Redis）正常运行

### 迁移中
1. **避免重启**: 迁移过程中不要重启或停止服务
2. **监控日志**: 关注迁移过程中的日志输出
3. **网络稳定**: 确保网络连接稳定，避免中断

### 迁移后
1. **服务重启**: 必须重启服务以加载新功能
2. **功能验证**: 验证现有 API Key 和新增功能
3. **性能监控**: 监控系统性能变化
4. **用户培训**: 培训管理员使用新的用户管理功能

## 🆘 故障排除

### 常见问题

#### 1. 环境检查失败
```bash
# 错误: Node.js版本过低
# 解决: 升级Node.js到14.x或更高版本
nvm use 16
# 或
nvm install 16

# 错误: 配置文件不存在
# 解决: 运行初始化设置
npm run setup
```

#### 2. 数据库连接失败
```bash
# 检查Redis服务状态
systemctl status redis
# 或
redis-cli ping

# 检查配置
echo $REDIS_HOST
echo $REDIS_PORT
```

#### 3. 迁移中断
```bash
# 如果迁移被中断，检查日志
tail -f logs/claude-relay-*.log

# 执行回滚
node scripts/migrate-user-management.js --rollback
```

#### 4. 验证失败
```bash
# 检查数据完整性
redis-cli keys "user:*"
redis-cli keys "api_key:*"

# 手动验证API Key状态
redis-cli hgetall api_key:your_key_id
```

### 获取帮助
1. 查看工具帮助: `node scripts/migrate-user-management.js --help`
2. 运行测试套件: `node scripts/test-user-migration.js`
3. 检查迁移日志: `tail -f logs/claude-relay-*.log`
4. 查看系统状态: `npm run cli status`

## 📈 最佳实践

### 生产环境迁移流程
1. **预迁移检查**
   ```bash
   # 环境检查
   node scripts/migrate-user-management.js --dry-run
   
   # 测试套件
   node scripts/test-user-migration.js
   ```

2. **创建维护窗口**
   - 通知用户服务维护
   - 准备回滚计划
   - 监控系统资源

3. **执行迁移**
   ```bash
   # 完整迁移
   node scripts/migrate-user-management.js --batch-size 50
   ```

4. **迁移后验证**
   ```bash
   # 重启服务
   npm run service:restart
   
   # 功能验证
   npm run cli status
   curl http://localhost:3000/health
   ```

5. **用户通知**
   - 通知用户维护完成
   - 提供新功能使用指导

### 监控和维护
1. **定期检查**: 监控用户管理功能运行状态
2. **性能优化**: 根据使用情况优化数据库索引
3. **备份策略**: 建立定期备份机制
4. **用户培训**: 培训管理员使用用户管理功能

---

如有问题或需要技术支持，请查看项目文档或联系技术团队。