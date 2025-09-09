# 用户管理系统迁移快速指南

本指南帮助您快速完成从纯 API Key 认证到用户管理系统的迁移。

## 🚀 快速开始

### 1. 迁移前准备（5分钟）
```bash
# 确保服务正在运行
npm run cli status

# 试运行迁移，检查系统状态
node scripts/migrate-user-management.js --dry-run
```

### 2. 执行迁移（2-5分钟）
```bash
# 执行完整迁移
node scripts/migrate-user-management.js

# 重启服务（重要！）
npm restart
```

### 3. 验证迁移（2分钟）
```bash
# 验证系统状态
node scripts/verify-user-migration.js

# 检查Web界面
curl http://localhost:3000/web
```

## 📋 详细步骤

### 步骤1：环境检查
确保系统准备就绪：
- ✅ 服务正在运行
- ✅ Redis 连接正常
- ✅ 配置文件完整
- ✅ 环境变量正确设置

### 步骤2：试运行测试
```bash
node scripts/migrate-user-management.js --dry-run
```
预期输出：
```
🚀 用户管理系统数据迁移工具
🔍 运行模式: 试运行 (不会修改数据)
[1/8] 环境检查 ✅
[2/8] 数据库连接检查 ✅
[3/8] 现有数据分析 ✅
...
✅ 用户管理系统迁移成功完成！
```

### 步骤3：执行实际迁移
```bash
node scripts/migrate-user-management.js
```
迁移过程包括：
1. 🔍 环境和数据库检查
2. 💾 创建数据备份
3. 📊 分析现有API Key
4. 🏗️ 创建用户数据结构
5. 🔄 迁移API Key到用户系统
6. ✅ 验证迁移结果
7. 📋 生成迁移报告

### 步骤4：重启服务
**重要：必须重启服务以加载新功能**
```bash
npm restart
# 或
npm run service:restart
```

### 步骤5：验证系统
```bash
node scripts/verify-user-migration.js
```
验证项目：
- ✅ 环境配置
- ✅ 数据库连接
- ✅ 用户数据结构
- ✅ API Key迁移
- ✅ 系统配置
- ✅ Web界面
- ✅ API端点

## 🆘 常见问题

### Q: 迁移失败怎么办？
```bash
# 检查错误日志
tail -f logs/claude-relay-*.log

# 如果支持回滚
node scripts/migrate-user-management.js --rollback

# 或从备份恢复
node scripts/migrate-user-management.js --rollback backups/xxx.json
```

### Q: 验证失败怎么办？
1. 检查服务是否正在运行
2. 检查Redis连接
3. 重新运行迁移
4. 查看详细错误信息

### Q: 现有API Key还能用吗？
是的！迁移后现有API Key完全兼容，无需修改客户端代码。

### Q: 如何访问新的用户管理界面？
访问：`http://localhost:3000/web/users`（需要管理员登录）

## 📊 迁移后功能

### 新增功能
- 👤 用户管理界面
- 🔑 API Key与用户关联
- 📊 用户级别的使用统计
- ⚙️ 用户权限管理
- 🎨 个人配置和偏好

### 保持兼容
- 🔑 现有API Key正常使用
- 📡 所有API端点保持不变
- 🔒 认证机制完全兼容
- 📊 使用统计继续工作

## 🔧 高级选项

### 自定义迁移
```bash
# 强制迁移（忽略警告）
node scripts/migrate-user-management.js --force

# 跳过备份（不推荐）
node scripts/migrate-user-management.js --skip-backup

# 调整批处理大小
node scripts/migrate-user-management.js --batch-size 100
```

### 测试工具
```bash
# 运行完整测试套件
node scripts/test-user-migration.js
```

## 📞 获取帮助

如果遇到问题：

1. **查看帮助**: `node scripts/migrate-user-management.js --help`
2. **运行测试**: `node scripts/test-user-migration.js`
3. **检查日志**: `tail -f logs/claude-relay-*.log`
4. **查看详细文档**: `docs/USER_MANAGEMENT_MIGRATION_GUIDE.md`

---

**⚠️ 重要提醒**:
- 生产环境建议在维护窗口执行
- 迁移前确保数据备份
- 迁移后必须重启服务
- 验证功能正常后结束维护窗口