# 增强日志系统使用指南

## 概述

增强日志系统为 Claude Relay Service 提供了全面的请求日志记录功能，包括：

- **Headers 过滤和记录**: 安全过滤敏感信息，记录重要的请求和响应头
- **Token 详细统计**: 记录输入、输出、缓存创建和读取等详细Token使用情况
- **费用详细信息**: 计算并记录详细的API使用费用信息
- **性能监控**: 跟踪处理时间和系统性能指标
- **数据压缩优化**: 智能压缩大型日志数据以节省存储空间

## 功能特性

### 🔒 安全的Headers过滤

- **白名单机制**: 只记录预定义的安全Headers
- **敏感数据检测**: 自动识别并过滤API keys、tokens等敏感信息
- **IP地址匿名化**: 自动屏蔽IP地址最后一段保护隐私
- **大小限制**: 防止超大Headers值导致的存储问题

### 📊 详细的Token统计

- **多维度Token记录**: input、output、cache_create、cache_read
- **缓存效率分析**: 计算缓存命中率和Token效率指标
- **模型级别统计**: 支持按模型分类的详细统计
- **时间维度跟踪**: 包含详细的时间戳信息

### 💰 精确的费用计算

- **实时费用计算**: 基于Token使用量计算精确费用
- **多币种支持**: 支持不同货币和汇率
- **成本效益分析**: 计算每Token成本、每秒成本等指标
- **历史费用跟踪**: 记录历史费用变化趋势

### ⚡ 性能优化

- **异步处理**: 不阻塞主要请求流程的异步日志记录
- **数据压缩**: 智能压缩超过100KB的大型日志数据
- **批量处理**: 支持批量日志处理以提高效率
- **采样策略**: 可配置的采样率以控制日志记录量

## 系统架构

```
┌─────────────────┐    ┌─────────────────┐    ┌──────────────────┐
│   API Request   │───▶│  Authentication │───▶│ Request Handler  │
└─────────────────┘    └─────────────────┘    └──────────────────┘
                                                         │
                                                         ▼
┌─────────────────┐    ┌─────────────────┐    ┌──────────────────┐
│ Headers Filter  │◀───│ Enhanced Logger │◀───│ Usage Callback   │
└─────────────────┘    └─────────────────┘    └──────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌──────────────────┐
│  Safe Headers   │    │ Token Details   │    │  Cost Details    │
└─────────────────┘    └─────────────────┘    └──────────────────┘
         │                       │                       │
         └───────────────────────▼───────────────────────┘
                         ┌─────────────────┐
                         │  Redis Storage  │
                         └─────────────────┘
```

## 核心组件

### 1. HeadersFilterService

负责安全过滤HTTP Headers信息：

```javascript
const HeadersFilterService = require('./src/services/HeadersFilterService')
const headersFilter = new HeadersFilterService()

// 过滤请求Headers
const filteredRequestHeaders = headersFilter.filterRequestHeaders(originalHeaders, {
  enableCompression: true,
  maxValueLength: 2000,
  includeIpInfo: true
})

// 过滤响应Headers
const filteredResponseHeaders = headersFilter.filterResponseHeaders(responseHeaders)
```

### 2. EnhancedLogService

核心的增强日志记录服务：

```javascript
const { enhancedLogService } = require('./src/services/EnhancedLogService')

// 记录增强日志
const logId = await enhancedLogService.logRequestWithDetails(
  baseLogData,      // 基础日志数据
  requestHeaders,   // 请求Headers
  responseHeaders,  // 响应Headers
  tokenDetails,     // Token详细信息
  costDetails,      // 费用详细信息
  options          // 记录选项
)
```

### 3. RequestLoggingIntegration

将增强日志功能集成到API流程中：

```javascript
const { requestLoggingIntegration } = require('./src/services/RequestLoggingIntegration')

// 记录流式请求
await requestLoggingIntegration.logStreamRequest({
  apiKey,
  requestBody,
  requestHeaders,
  responseHeaders,
  usageData,
  accountId,
  responseTime,
  statusCode,
  // ... 其他参数
})
```

## 部署指南

### 1. 运行迁移脚本

在启用增强日志系统之前，运行迁移脚本：

```bash
# 检查兼容性（干运行）
node scripts/enhanced-logging-migration.js --dry-run

# 执行完整迁移
node scripts/enhanced-logging-migration.js

# 跳过备份（不推荐）
node scripts/enhanced-logging-migration.js --no-backup
```

### 2. 运行功能测试

验证增强日志系统是否正常工作：

```bash
# 运行完整测试套件
node scripts/enhanced-logging-test.js

# 安静模式运行
node scripts/enhanced-logging-test.js --quiet

# 遇到错误时停止
node scripts/enhanced-logging-test.js --stop-on-error
```

### 3. 配置调优

根据系统负载调整配置：

```javascript
// 调整采样率（降低系统负载）
requestLoggingIntegration.setSamplingRate(0.1) // 10%采样

// 更新配置
requestLoggingIntegration.updateConfig({
  enableHeadersCapture: true,
  enableTokenDetails: true,
  enableCostDetails: true,
  asyncLogging: true,
  maxLogSize: 300000 // 300KB
})
```

## 数据结构

### 增强日志数据结构

```javascript
{
  // 基础字段（兼容现有系统）
  "keyId": "api-key-123",
  "method": "POST",
  "path": "/api/v1/messages",
  "status": 200,
  "model": "claude-3-sonnet",
  "tokens": 150,
  "inputTokens": 120,
  "outputTokens": 30,
  "responseTime": 2500,
  "userAgent": "claude-cli/1.0.0",
  "ipAddress": "192.168.1.***",
  "timestamp": 1703123456789,
  
  // 新增增强字段
  "requestHeaders": {
    "user-agent": "claude-cli/1.0.0",
    "content-type": "application/json",
    "x-forwarded-for": "192.168.1.***"
  },
  
  "responseHeaders": {
    "content-type": "text/event-stream",
    "anthropic-ratelimit-requests-remaining": "100"
  },
  
  "tokenDetails": {
    "totalTokens": 150,
    "inputTokens": 120,
    "outputTokens": 30,
    "cacheCreateTokens": 10,
    "cacheReadTokens": 5,
    "ephemeral5mTokens": 8,
    "ephemeral1hTokens": 2,
    "cacheHitRatio": 10.0,
    "tokenEfficiency": 0.25,
    "model": "claude-3-sonnet",
    "recordedAt": "2023-12-21T10:30:56.789Z"
  },
  
  "costDetails": {
    "totalCost": 0.02,
    "inputCost": 0.015,
    "outputCost": 0.005,
    "cacheCost": 0,
    "inputTokenPrice": 0.000015,
    "outputTokenPrice": 0.000075,
    "currency": "USD",
    "exchangeRate": 1.0,
    "costPerToken": 0.000133,
    "recordedAt": "2023-12-21T10:30:56.789Z"
  },
  
  // 元数据
  "logVersion": "2.1",
  "processTime": 45,
  "dataOptimized": false
}
```

### Redis存储结构

```
# 主日志数据
request_log:{keyId}:{timestamp}

# 索引结构
request_log_index:{keyId}:{date}        # 按API Key和日期索引
request_log_status:{status}:{date}      # 按状态码索引
request_log_model:{model}:{date}        # 按模型索引
request_log_time:{hourTimestamp}        # 按小时时间索引
request_log_errors:{date}               # 错误日志索引
```

## 监控和统计

### 获取服务统计信息

```javascript
// 获取Enhanced Log Service统计
const enhancedStats = enhancedLogService.getStats()
console.log('Enhanced Log Service Stats:', enhancedStats)

// 获取Headers Filter统计
const headersFilter = new HeadersFilterService()
const filterStats = headersFilter.getFilterStats()
console.log('Headers Filter Stats:', filterStats)

// 获取请求日志集成统计
const integrationStats = requestLoggingIntegration.getStats()
console.log('Request Logging Integration Stats:', integrationStats)
```

### 统计信息示例

```javascript
{
  // Enhanced Log Service统计
  "totalRequests": 1000,
  "successfulLogs": 995,
  "failedLogs": 5,
  "headersFiltered": 1000,
  "tokenDetailsProcessed": 980,
  "costDetailsProcessed": 950,
  "dataCompressionSaved": 15,
  "averageProcessingTime": 25.5,
  "successRate": 99.5,
  
  // 性能指标
  "performanceMetrics": {
    "maxProcessingTime": 120,
    "minProcessingTime": 10,
    "totalSamples": 1000
  },
  
  // Headers Filter统计
  "headersFilterStats": {
    "requestWhitelistCount": 15,
    "responseWhitelistCount": 8,
    "sensitiveBlacklistCount": 20,
    "sensitivePatternCount": 15,
    "stats": {
      "totalRequests": 1000,
      "blockedHeaders": 45,
      "blockedValues": 23,
      "compressedHeaders": 12
    }
  }
}
```

## 安全考虑

### 1. 敏感数据保护

- **API Keys**: 自动检测并过滤各种格式的API keys
- **Authentication Headers**: 完全过滤authorization、cookie等认证头
- **Personal Information**: IP地址自动匿名化处理
- **Large Data**: 超大数据自动截断或压缩

### 2. 访问控制

- **日志访问**: 只有管理员可以访问详细日志
- **敏感字段**: 敏感字段需要额外权限查看
- **数据导出**: 导出功能需要2FA验证

### 3. 数据保留

- **TTL设置**: 默认7天自动过期
- **存储限制**: 单条日志最大500KB
- **清理策略**: 自动清理过期数据

## 故障排除

### 常见问题

#### 1. 增强日志记录失败

**症状**: 日志中显示 "Enhanced log recording failed"

**解决方案**:
```bash
# 检查Redis连接
node -e "console.log(require('./src/models/database').getClient().ping())"

# 检查服务状态
node -e "console.log(require('./src/services/EnhancedLogService').enhancedLogService.getStats())"

# 运行诊断测试
node scripts/enhanced-logging-test.js
```

#### 2. Headers过滤不生效

**症状**: 敏感Headers仍然出现在日志中

**解决方案**:
```javascript
// 检查过滤配置
const headersFilter = new HeadersFilterService()
console.log('Filter config:', headersFilter.getFilterStats())

// 手动测试过滤
const filtered = headersFilter.filterRequestHeaders({
  'authorization': 'Bearer token'
})
console.log('Filtered result:', filtered) // 应该为空或不包含authorization
```

#### 3. 性能影响

**症状**: API响应时间增加

**解决方案**:
```javascript
// 启用异步日志记录
requestLoggingIntegration.updateConfig({
  asyncLogging: true
})

// 降低采样率
requestLoggingIntegration.setSamplingRate(0.5) // 50%

// 禁用部分功能
requestLoggingIntegration.updateConfig({
  enableHeadersCapture: false,
  enableCostDetails: false
})
```

#### 4. 存储空间占用过多

**症状**: Redis存储空间快速增长

**解决方案**:
```javascript
// 启用数据压缩
requestLoggingIntegration.updateConfig({
  maxLogSize: 100000 // 100KB
})

// 缩短TTL
// 在logRequest调用时设置更短的TTL
await enhancedLogService.logRequestWithDetails(
  logData, 
  requestHeaders, 
  responseHeaders, 
  tokenDetails, 
  costDetails,
  { ttl: 86400 } // 1天
)

# 手动清理过期数据
node -e "
const client = require('./src/models/database').getClient()
client.keys('request_log:*').then(keys => {
  console.log('Total log keys:', keys.length)
  // 可以根据需要删除特定键
})
"
```

### 日志级别说明

- **ERROR**: 系统错误，需要立即关注
- **WARN**: 警告信息，可能需要关注
- **INFO**: 一般信息，正常操作日志
- **DEBUG**: 调试信息，详细的处理过程

### 监控建议

1. **设置告警**: 监控错误率和处理时间
2. **定期检查**: 每周检查统计信息和存储使用情况
3. **性能测试**: 定期运行性能测试确保系统稳定
4. **日志轮转**: 设置合适的日志保留策略

## 最佳实践

### 1. 配置优化

```javascript
// 生产环境推荐配置
requestLoggingIntegration.updateConfig({
  enableHeadersCapture: true,
  enableTokenDetails: true,
  enableCostDetails: true,
  asyncLogging: true,           // 异步处理
  maxLogSize: 200000,          // 200KB限制
  enablePerformanceMonitoring: true
})

// 高负载环境配置
requestLoggingIntegration.setSamplingRate(0.1) // 10%采样率
```

### 2. 监控指标

定期检查以下指标：

- **成功率**: `successRate > 95%`
- **平均处理时间**: `averageProcessingTime < 50ms`
- **错误数量**: `failedLogs < 1%`
- **存储增长**: 监控Redis存储使用量

### 3. 维护建议

- **每月**: 检查统计报告和性能指标
- **每季度**: 评估采样率和配置优化
- **每半年**: 进行全面的安全审计
- **每年**: 更新敏感数据过滤规则

## 版本更新

### 当前版本: 2.1.0

**新增功能**:
- IP地址匿名化处理
- 增强的敏感数据检测
- 性能监控和统计
- 数据压缩优化
- 批量处理支持

**兼容性**: 完全向后兼容现有日志格式

### 升级路径

1. 运行迁移脚本检查兼容性
2. 备份现有日志数据
3. 部署新版本代码
4. 运行功能测试验证
5. 监控系统性能
6. 根据需要调整配置

## 技术支持

如需技术支持，请提供以下信息：

1. 错误日志和堆栈跟踪
2. 系统配置信息
3. 统计信息快照
4. 复现步骤

---

*最后更新: 2023-12-21*
*文档版本: 1.0.0*