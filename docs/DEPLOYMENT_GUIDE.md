# 新功能部署指南

## 概览

本指南提供了Claude Relay Service v1.1.0新功能的详细部署步骤、配置说明和最佳实践。新版本引入了智能负载均衡、API Key批量导出、上游功能适配器等企业级功能。

## 🚀 快速部署

### 最小化升级步骤

```bash
# 1. 备份现有数据和配置
docker-compose exec redis redis-cli BGSAVE
cp -r config config.backup.$(date +%Y%m%d)

# 2. 停止现有服务
docker-compose down

# 3. 拉取新版本
git pull origin main

# 4. 更新配置文件
cp config/config.example.js config/config.js.new
# 手动合并配置（参考下文配置迁移部分）

# 5. 重新构建和启动
docker-compose build --no-cache
docker-compose up -d

# 6. 验证服务状态
npm run cli status
```

## 📋 前置要求

### 系统要求
- **Node.js**: >= 16.0.0
- **Redis**: >= 6.0.0 
- **内存**: >= 2GB (推荐4GB)
- **磁盘空间**: >= 5GB (用于导出文件和日志)
- **网络**: 稳定的外网连接

### 依赖检查
```bash
# 检查Node.js版本
node --version

# 检查Redis状态
redis-cli ping

# 检查可用内存
free -h

# 检查磁盘空间
df -h
```

## ⚙️ 配置迁移

### 1. 智能负载均衡配置

在 `config/config.js` 中添加以下配置：

```javascript
module.exports = {
  // ... 现有配置

  // 智能负载均衡配置
  loadBalancing: {
    // 启用智能负载均衡
    enabled: true,
    
    // 默认调度策略: 'least_used', 'least_recent', 'lowest_cost', 'balanced', 'weighted_random'
    defaultStrategy: 'balanced',
    
    // 账户选择超时时间（毫秒）
    selectionTimeout: 5000,
    
    // 健康检查配置
    healthCheck: {
      // 检查间隔（秒）
      interval: 30,
      // 响应时间阈值（毫秒）
      responseTimeThreshold: 5000,
      // 成功率阈值（0-1）
      successRateThreshold: 0.95,
      // 错误率阈值（0-1）
      errorRateThreshold: 0.05
    },
    
    // 故障恢复配置
    failureRecovery: {
      // 连续失败次数阈值
      failureThreshold: 5,
      // 临时故障重试延迟（秒）
      temporaryFailureDelay: 300,
      // 最大退避时间（秒）
      maxBackoffTime: 3600,
      // 启用熔断器
      enableCircuitBreaker: true
    },
    
    // 算法权重配置
    algorithmWeights: {
      costPriority: 0.4,    // 成本优先权重
      performance: 0.3,     // 性能权重
      loadBalance: 0.2,     // 负载均衡权重
      reliability: 0.1      // 可靠性权重
    }
  },

  // API导出配置
  apiExport: {
    // 启用API导出功能
    enabled: true,
    
    // 导出文件存储目录
    outputDir: './temp/exports',
    
    // 默认启用敏感数据脱敏
    sanitizeData: true,
    
    // 批处理大小
    batchSize: 100,
    
    // 支持的导出格式
    supportedFormats: ['json', 'csv'],
    
    // 文件自动清理配置
    autoCleanup: {
      enabled: true,
      // 文件保留时间（小时）
      maxAgeHours: 24,
      // 清理检查间隔（小时）
      checkInterval: 6
    }
  },

  // 查询优化配置
  queryOptimizer: {
    // 启用查询优化
    enabled: true,
    
    // 批量查询大小
    batchSize: 100,
    // 管道大小
    pipelineSize: 50,
    // 最大并发数
    maxConcurrency: 10,
    
    // 缓存配置
    cache: {
      enabled: true,
      ttl: 300,           // 5分钟
      prefix: 'query_cache:',
      maxSize: 1000       // 最大缓存条目数
    },
    
    // 性能监控
    performance: {
      enableProfiling: false,
      queryTimeout: 30000,      // 30秒
      memoryLimit: 104857600    // 100MB
    }
  }
}
```

### 2. 环境变量配置

在 `.env` 文件中添加：

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

## 🗄️ 数据库迁移

### Redis数据结构更新

新版本引入了一些新的Redis数据结构，但完全向后兼容。如需手动迁移：

```bash
# 运行迁移脚本（可选）
node scripts/migrate-load-balancing.js

# 检查数据完整性
node scripts/verify-data-integrity.js
```

### 新增的Redis键模式

```bash
# 负载均衡相关
load_balance:health:{accountId}     # 账户健康状态
load_balance:stats:{accountId}      # 账户统计信息
load_balance:circuit:{accountId}    # 熔断器状态

# 查询缓存
query_cache:*                       # 查询缓存数据

# 导出任务
export:task:{taskId}                # 导出任务状态
export:stats:*                      # 导出统计信息
```

## 🐳 Docker部署

### 更新docker-compose.yml

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
    image: redis:7-alpine
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

### 构建和部署

```bash
# 构建新镜像
docker-compose build --no-cache

# 启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f claude-relay

# 健康检查
docker-compose exec claude-relay npm run cli status
```

## 🔧 配置验证

### 1. 服务状态检查

```bash
# 基本状态检查
curl http://localhost:3000/health

# 详细状态信息
npm run cli status

# 负载均衡状态
npm run cli load-balance status

# 导出功能测试
npm run cli export test
```

### 2. 功能验证脚本

创建验证脚本 `scripts/verify-deployment.js`：

```javascript
const axios = require('axios');
const logger = require('../src/utils/logger');

async function verifyDeployment() {
  try {
    // 1. 健康检查
    const health = await axios.get('http://localhost:3000/health');
    console.log('✅ 健康检查通过:', health.data);

    // 2. 负载均衡功能
    const accounts = await axios.get('http://localhost:3000/admin/claude-accounts');
    console.log('✅ 账户管理正常:', accounts.data.length, '个账户');

    // 3. API导出功能（需要认证）
    // ... 添加具体验证逻辑

    console.log('🎉 所有功能验证通过！');
  } catch (error) {
    console.error('❌ 验证失败:', error.message);
    process.exit(1);
  }
}

verifyDeployment();
```

运行验证：
```bash
node scripts/verify-deployment.js
```

## 📊 监控配置

### 1. 性能监控

```javascript
// 在config/config.js中启用性能监控
module.exports = {
  monitoring: {
    enabled: true,
    metrics: {
      // 收集详细的性能指标
      enableDetailedMetrics: true,
      // 慢查询阈值（毫秒）
      slowQueryThreshold: 1000,
      // 内存使用告警阈值
      memoryAlertThreshold: 0.8
    },
    alerts: {
      // 启用告警
      enabled: true,
      // 邮件通知配置
      email: {
        enabled: false,
        smtp: {
          host: 'smtp.example.com',
          port: 587,
          auth: {
            user: 'alerts@example.com',
            pass: 'password'
          }
        }
      }
    }
  }
}
```

### 2. 日志配置

```javascript
// 更新日志配置
module.exports = {
  logging: {
    level: 'info',
    // 新增负载均衡专用日志
    loadBalancing: {
      enabled: true,
      level: 'debug',
      file: 'logs/load-balancing.log'
    },
    // API导出日志
    apiExport: {
      enabled: true,
      level: 'info',
      file: 'logs/api-export.log'
    }
  }
}
```

## 🚨 故障排查

### 常见问题

#### 1. 负载均衡不工作
```bash
# 检查配置
npm run cli config check

# 查看负载均衡日志
tail -f logs/load-balancing.log

# 检查账户健康状态
npm run cli accounts health-check
```

#### 2. 导出功能失败
```bash
# 检查导出目录权限
ls -la temp/exports

# 查看导出日志
tail -f logs/api-export.log

# 手动测试导出
npm run cli export test --format=json
```

#### 3. 性能问题
```bash
# 查看系统资源使用
docker stats

# 检查Redis内存使用
redis-cli info memory

# 查看慢查询
redis-cli slowlog get 10
```

### 调试模式

启用调试模式获取更多信息：

```bash
# 设置环境变量
export DEBUG=claude-relay:*
export LOG_LEVEL=debug

# 重启服务
docker-compose restart claude-relay
```

## 🔄 回滚计划

### 快速回滚步骤

如果新版本出现问题，可以快速回滚：

```bash
# 1. 停止服务
docker-compose down

# 2. 切换到上一个版本
git checkout v1.0.18  # 替换为实际的上一个版本标签

# 3. 恢复配置
cp config.backup.$(date +%Y%m%d)/config.js config/

# 4. 重新启动
docker-compose up -d

# 5. 验证服务
curl http://localhost:3000/health
```

### 数据回滚

如果需要回滚Redis数据：

```bash
# 恢复备份的Redis数据
docker-compose exec redis redis-cli FLUSHALL
docker-compose exec redis redis-cli --rdb dump.rdb
```

## 📈 性能调优

### 1. Redis优化

```bash
# 在redis.conf中添加
maxmemory 2gb
maxmemory-policy allkeys-lru
tcp-keepalive 60
timeout 300

# 对于大数据量
save 900 1
save 300 10
save 60 10000
```

### 2. Node.js优化

```bash
# 设置Node.js优化参数
export NODE_OPTIONS="--max-old-space-size=2048"
export UV_THREADPOOL_SIZE=16

# 启用V8优化
export NODE_OPTIONS="$NODE_OPTIONS --optimize-for-size"
```

### 3. 系统级优化

```bash
# 增加文件描述符限制
echo "* soft nofile 65536" >> /etc/security/limits.conf
echo "* hard nofile 65536" >> /etc/security/limits.conf

# 优化网络参数
echo "net.core.somaxconn = 65535" >> /etc/sysctl.conf
sysctl -p
```

## 🔐 安全考虑

### 1. 导出文件安全

```bash
# 设置导出目录权限
chmod 700 temp/exports
chown app:app temp/exports

# 配置文件加密（如果包含敏感信息）
gpg --cipher-algo AES256 --compress-algo 1 --symmetric config/config.js
```

### 2. 网络安全

```bash
# 配置防火墙
ufw allow 3000/tcp
ufw allow 6379/tcp from 127.0.0.1
ufw enable
```

### 3. 定期安全检查

```bash
# 检查导出文件权限
find temp/exports -type f -not -perm 600 -ls

# 清理过期导出文件
npm run cli export cleanup --max-age=24

# 检查敏感信息泄露
grep -r "api.*key\|token\|secret" logs/ || echo "无敏感信息泄露"
```

## 📝 部署清单

### 部署前检查
- [ ] 备份现有数据和配置
- [ ] 检查系统资源（内存、磁盘、网络）
- [ ] 更新配置文件
- [ ] 验证依赖版本
- [ ] 准备回滚计划

### 部署后验证
- [ ] 服务健康检查
- [ ] 功能验证测试
- [ ] 性能基准测试
- [ ] 日志检查
- [ ] 监控配置
- [ ] 安全检查

### 运维监控
- [ ] 设置性能监控告警
- [ ] 配置日志轮转
- [ ] 建立备份策略
- [ ] 文档更新
- [ ] 团队培训

## 🆘 支持和帮助

### 获取帮助

- **文档**: 查看 `docs/` 目录下的详细文档
- **命令行帮助**: `npm run cli --help`
- **日志分析**: 查看 `logs/` 目录下的日志文件
- **性能分析**: 使用内置的性能监控工具

### 联系方式

- **技术支持**: support@example.com
- **Bug报告**: 提交GitHub Issue
- **功能建议**: 通过GitHub Discussions

---

*本部署指南版本: v1.1.0*  
*最后更新: 2024-09-10*  
*适用版本: Claude Relay Service v1.1.0+*