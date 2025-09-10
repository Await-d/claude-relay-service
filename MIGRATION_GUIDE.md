# 版本迁移指南

## 概述

本指南提供了从Claude Relay Service早期版本升级到v1.1.0的详细步骤。新版本引入了智能负载均衡、API Key导出等重要功能，同时保持了完全的向后兼容性。

## 🔄 支持的迁移路径

### 直接升级路径
- **v1.0.18** → v1.1.0 ✅ **推荐**
- **v1.0.17** → v1.1.0 ✅ **支持**
- **v1.0.16** → v1.1.0 ⚠️ **需要额外步骤**

### 不支持的升级路径
- **v1.0.15及更早版本** → v1.1.0 ❌ **需要分步升级**

如果您使用的是v1.0.15或更早版本，请先升级到v1.0.18，然后再升级到v1.1.0。

## 📋 升级前检查清单

### 系统要求验证

```bash
# 检查Node.js版本（需要 >= 16.0.0）
node --version

# 检查Redis版本（需要 >= 6.0.0）
redis-cli --version

# 检查可用内存（推荐 >= 4GB）
free -h

# 检查磁盘空间（需要 >= 5GB）
df -h

# 检查当前版本
npm run cli --version
```

### 数据备份

```bash
# 1. 备份Redis数据
docker-compose exec redis redis-cli BGSAVE

# 2. 导出Redis数据到文件
docker-compose exec redis redis-cli --rdb backup.rdb

# 3. 备份配置文件
cp -r config config.backup.$(date +%Y%m%d_%H%M%S)

# 4. 备份日志文件（可选）
cp -r logs logs.backup.$(date +%Y%m%d_%H%M%S)

# 5. 备份自定义脚本（如果有）
cp -r scripts scripts.backup.$(date +%Y%m%d_%H%M%S)
```

## 🚀 迁移步骤

### 步骤1：停止现有服务

```bash
# Docker方式
docker-compose down

# 或者直接运行方式
npm run service:stop
```

### 步骤2：更新代码

```bash
# 拉取最新代码
git fetch origin
git checkout v1.1.0

# 或者拉取主分支最新代码
git pull origin main
```

### 步骤3：更新依赖

```bash
# 清理旧的node_modules
rm -rf node_modules package-lock.json

# 安装新依赖
npm install

# 安装Web界面依赖（如果需要）
npm run install:web
```

### 步骤4：配置迁移

#### 4.1 自动配置迁移

我们提供了自动配置迁移脚本：

```bash
# 运行配置迁移脚本
node scripts/migrate-config.js

# 验证配置
node scripts/validate-config.js
```

#### 4.2 手动配置迁移

如果自动迁移失败，请手动更新配置：

```bash
# 复制新的配置模板
cp config/config.example.js config/config.new.js
```

然后手动合并您的现有配置到新文件中。主要需要添加的新配置节段：

```javascript
module.exports = {
  // ... 现有配置

  // 新增：智能负载均衡配置
  loadBalancing: {
    enabled: true,
    defaultStrategy: 'balanced',
    selectionTimeout: 5000,
    healthCheck: {
      interval: 30,
      responseTimeThreshold: 5000,
      successRateThreshold: 0.95,
      errorRateThreshold: 0.05
    },
    failureRecovery: {
      failureThreshold: 5,
      temporaryFailureDelay: 300,
      maxBackoffTime: 3600,
      enableCircuitBreaker: true
    },
    algorithmWeights: {
      costPriority: 0.4,
      performance: 0.3,
      loadBalance: 0.2,
      reliability: 0.1
    }
  },

  // 新增：API导出配置
  apiExport: {
    enabled: true,
    outputDir: './temp/exports',
    sanitizeData: true,
    batchSize: 100,
    supportedFormats: ['json', 'csv'],
    autoCleanup: {
      enabled: true,
      maxAgeHours: 24,
      checkInterval: 6
    }
  },

  // 新增：查询优化配置
  queryOptimizer: {
    enabled: true,
    batchSize: 100,
    pipelineSize: 50,
    maxConcurrency: 10,
    cache: {
      enabled: true,
      ttl: 300,
      prefix: 'query_cache:',
      maxSize: 1000
    },
    performance: {
      enableProfiling: false,
      queryTimeout: 30000,
      memoryLimit: 104857600
    }
  }
}
```

### 步骤5：环境变量更新

在`.env`文件中添加新的环境变量：

```bash
# 智能负载均衡
LOAD_BALANCING_ENABLED=true
LOAD_BALANCING_STRATEGY=balanced

# API导出
API_EXPORT_ENABLED=true
API_EXPORT_OUTPUT_DIR=./temp/exports

# 查询优化
QUERY_OPTIMIZER_ENABLED=true
QUERY_CACHE_ENABLED=true
QUERY_CACHE_TTL=300

# 性能监控
ENABLE_PERFORMANCE_MONITORING=true
PERFORMANCE_LOG_LEVEL=info
```

### 步骤6：数据库迁移

```bash
# 运行数据库迁移脚本（可选，向后兼容）
node scripts/migrate-database.js

# 验证数据完整性
node scripts/verify-data-integrity.js
```

### 步骤7：启动服务

```bash
# Docker方式启动
docker-compose up -d

# 或者直接运行
npm start
```

### 步骤8：验证升级

```bash
# 检查服务状态
npm run cli status

# 检查健康状态
curl http://localhost:3000/health

# 验证新功能
npm run cli load-balance status
npm run cli export test
```

## 🔍 分版本迁移说明

### 从v1.0.18迁移

v1.0.18是最新的稳定版本，迁移过程最简单：

```bash
# 简化迁移步骤
docker-compose down
git pull origin main
docker-compose up -d
npm run cli status
```

**注意事项**：
- 配置文件完全兼容，无需修改
- 数据结构保持一致，无需迁移
- 所有现有功能正常工作

### 从v1.0.17迁移

v1.0.17引入了Gemini支持，迁移时需要注意：

```bash
# 额外步骤：更新Gemini配置
node scripts/migrate-gemini-config.js
```

**配置更新**：
- Gemini账户配置保持不变
- 新增负载均衡功能会自动包含Gemini账户
- 代理配置继续有效

### 从v1.0.16迁移

v1.0.16是Web界面的首个版本，需要更多迁移步骤：

```bash
# 额外步骤：重建Web界面
npm run build:web

# 更新数据库架构
node scripts/migrate-from-1016.js
```

**重要变化**：
- Web界面组件结构有变化
- 需要重新编译前端资源
- 某些API端点有所调整

### 从v1.0.15及更早版本迁移

**强烈建议分步升级**：

```bash
# 步骤1：升级到v1.0.18
git checkout v1.0.18
npm install
npm run setup
docker-compose up -d

# 验证v1.0.18正常工作后，再升级到v1.1.0
git checkout v1.1.0
# 按照上述标准迁移流程执行
```

## 🐳 Docker环境迁移

### 更新Docker配置

新版本的`docker-compose.yml`有一些更新：

```yaml
version: '3.8'

services:
  claude-relay:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - LOAD_BALANCING_ENABLED=true
      - API_EXPORT_ENABLED=true
      - QUERY_OPTIMIZER_ENABLED=true
    volumes:
      - ./config:/app/config
      - ./logs:/app/logs
      - ./temp:/app/temp  # 新增：导出文件存储
    depends_on:
      - redis
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  redis:
    image: redis:7-alpine  # 更新到Redis 7
    command: redis-server --appendonly yes --maxmemory 1gb --maxmemory-policy allkeys-lru
    volumes:
      - redis_data:/data
    ports:
      - "6379:6379"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  redis_data:
```

### Docker迁移步骤

```bash
# 1. 停止现有容器
docker-compose down

# 2. 备份数据卷
docker run --rm -v claude-relay-service_redis_data:/source -v $(pwd):/backup alpine tar czf /backup/redis_backup.tar.gz -C /source .

# 3. 更新配置文件
cp docker-compose.yml docker-compose.yml.backup
# 手动更新或使用新的docker-compose.yml

# 4. 重新构建
docker-compose build --no-cache

# 5. 启动服务
docker-compose up -d

# 6. 验证
docker-compose logs -f claude-relay
```

## ⚠️ 常见问题和解决方案

### 问题1：配置文件格式错误

**症状**：服务启动失败，提示配置错误

**解决**：
```bash
# 验证配置文件语法
node -c config/config.js

# 使用配置验证脚本
node scripts/validate-config.js

# 如果有错误，使用示例配置重新开始
cp config/config.example.js config/config.js
# 然后手动合并您的配置
```

### 问题2：Redis连接失败

**症状**：服务启动时无法连接Redis

**解决**：
```bash
# 检查Redis服务状态
redis-cli ping

# 检查Redis版本
redis-cli --version

# 如果版本过低，更新Redis
# Ubuntu/Debian
sudo apt update && sudo apt install redis-server

# 或使用Docker
docker run -d --name redis -p 6379:6379 redis:7-alpine
```

### 问题3：权限问题

**症状**：无法创建导出文件或访问日志

**解决**：
```bash
# 创建必要的目录并设置权限
mkdir -p temp/exports logs
chmod 755 temp/exports logs

# 如果使用Docker，确保容器有正确权限
docker-compose exec claude-relay chown -R app:app /app/temp /app/logs
```

### 问题4：内存不足

**症状**：服务运行缓慢或崩溃

**解决**：
```bash
# 检查内存使用
free -h

# 优化Node.js内存设置
export NODE_OPTIONS="--max-old-space-size=2048"

# 调整Redis内存配置
redis-cli CONFIG SET maxmemory 1gb
redis-cli CONFIG SET maxmemory-policy allkeys-lru
```

### 问题5：端口冲突

**症状**：服务无法启动，端口被占用

**解决**：
```bash
# 检查端口使用情况
netstat -tulpn | grep :3000
netstat -tulpn | grep :6379

# 修改端口配置
# 在.env文件中设置
PORT=3001
REDIS_PORT=6380

# 或者停止冲突的服务
sudo systemctl stop nginx  # 如果3000端口被nginx占用
```

## 🔄 回滚计划

如果升级后遇到问题，可以快速回滚：

### 快速回滚步骤

```bash
# 1. 停止新版本服务
docker-compose down

# 2. 切换到旧版本
git checkout v1.0.18  # 或您之前的版本

# 3. 恢复配置文件
cp config.backup.*/config.js config/

# 4. 恢复Redis数据（如果需要）
docker-compose exec redis redis-cli FLUSHALL
# 然后恢复备份数据

# 5. 启动旧版本
docker-compose up -d

# 6. 验证服务正常
curl http://localhost:3000/health
```

### 数据回滚

```bash
# 如果需要回滚Redis数据
docker-compose down
docker volume rm claude-relay-service_redis_data

# 恢复备份数据
docker run --rm -v claude-relay-service_redis_data:/target -v $(pwd):/backup alpine tar xzf /backup/redis_backup.tar.gz -C /target

docker-compose up -d
```

## 📊 迁移验证

### 功能验证检查清单

#### 基础功能
- [ ] 服务正常启动
- [ ] 健康检查通过
- [ ] API Key认证工作正常
- [ ] Claude账户正常工作
- [ ] Web界面可以访问

#### 新功能
- [ ] 负载均衡功能正常
- [ ] API导出功能可用
- [ ] 性能监控工作
- [ ] 新界面元素显示正常

#### 数据完整性
- [ ] 现有API Key数据完整
- [ ] Claude账户配置保持
- [ ] 使用统计数据正确
- [ ] 系统日志正常

### 性能验证

```bash
# 运行性能测试
npm run test:performance

# 检查系统资源使用
docker stats

# 验证响应时间
curl -w "@curl-format.txt" -o /dev/null -s http://localhost:3000/health
```

### 验证脚本

创建验证脚本 `verify-migration.sh`：

```bash
#!/bin/bash

echo "🔍 开始迁移验证..."

# 基础服务检查
echo "📡 检查服务状态..."
if curl -f http://localhost:3000/health > /dev/null 2>&1; then
    echo "✅ 服务健康检查通过"
else
    echo "❌ 服务健康检查失败"
    exit 1
fi

# 检查负载均衡
echo "⚖️ 检查负载均衡功能..."
if npm run cli load-balance status > /dev/null 2>&1; then
    echo "✅ 负载均衡功能正常"
else
    echo "⚠️ 负载均衡功能可能有问题"
fi

# 检查导出功能
echo "📤 检查导出功能..."
if npm run cli export test > /dev/null 2>&1; then
    echo "✅ 导出功能正常"
else
    echo "⚠️ 导出功能可能有问题"
fi

echo "🎉 迁移验证完成！"
```

运行验证：
```bash
chmod +x verify-migration.sh
./verify-migration.sh
```

## 📞 获取帮助

### 迁移支持

如果在迁移过程中遇到问题：

1. **查看日志**：
   ```bash
   # 应用日志
   tail -f logs/claude-relay-*.log
   
   # Docker日志
   docker-compose logs -f claude-relay
   ```

2. **运行诊断**：
   ```bash
   npm run cli diagnose
   node scripts/health-check.js
   ```

3. **寻求帮助**：
   - 查看[故障排除文档](docs/DEPLOYMENT_GUIDE.md#故障排查)
   - 提交[GitHub Issue](https://github.com/your-repo/issues)
   - 加入社区讨论

### 联系方式

- **技术文档**：查看 `docs/` 目录
- **问题报告**：GitHub Issues
- **功能讨论**：GitHub Discussions
- **紧急支持**：查看README联系方式

---

**✨ 迁移完成后，您将享受到更智能、更高效的Claude Relay Service！**

---

*本迁移指南版本: v1.1.0*  
*最后更新: 2024-09-10*  
*适用版本: 从v1.0.16+ 迁移到 v1.1.0*