# UnifiedLogService 依赖注入架构指南

## 📋 概述

UnifiedLogService 已重构为基于依赖注入的现代架构，遵循SOLID原则，提供更好的可测试性、可维护性和扩展性。

## 🏗️ 架构特点

### SOLID原则实现

- **S (单一职责)**: 每个服务类只承担一项明确职责
- **O (开放/封闭)**: 通过依赖注入支持功能扩展，无需修改现有代码
- **L (里氏替换)**: 接口抽象确保实现可替换性
- **I (接口隔离)**: 专一的服务接口，避免"胖接口"
- **D (依赖倒置)**: 依赖抽象接口而非具体实现

### 架构层级

```
UnifiedLogServiceFactory (工厂层)
    ↓
UnifiedLogService (服务层)
    ↓
Dependencies (依赖层): Database + HeadersFilter + Logger
```

## 🚀 快速开始

### 1. 基本使用（推荐）

```javascript
const { unifiedLogServiceFactory } = require('./src/services/UnifiedLogServiceFactory')

// 获取单例实例（推荐用法）
const logService = await unifiedLogServiceFactory.getSingleton()

// 记录日志
const logId = await logService.logRequest('api_key_123', {
  path: '/api/v1/messages',
  method: 'POST',
  status: 200,
  model: 'claude-3-sonnet',
  tokens: 1500,
  requestHeaders: { 'user-agent': 'MyApp/1.0' },
  responseHeaders: { 'content-type': 'application/json' }
})
```

### 2. 自定义配置

```javascript
const customConfig = {
  mergeWindowMs: 10000, // 10秒合并窗口
  enableAsync: true, // 异步处理
  enableHeadersCapture: true, // 启用Headers捕获
  enableTokenDetails: true, // 启用Token详情
  enableCostDetails: true, // 启用费用详情
  maxLogSize: 150000 // 150KB最大日志大小
}

const logService = await unifiedLogServiceFactory.getSingleton(customConfig)
```

### 3. 自定义依赖（高级用法）

```javascript
const customDependencies = {
  database: myCustomDatabase,
  headersFilter: myCustomHeadersFilter,
  logger: myCustomLogger
}

const logService = await unifiedLogServiceFactory.create(
  customConfig,
  customDependencies,
  'my-custom-instance'
)
```

## 📊 配置管理

### 从config.js读取

系统自动从`config.js`的`enhancedLogging`部分读取配置：

```javascript
// config/config.js
module.exports = {
  enhancedLogging: {
    enabled: true,
    performance: {
      mergeWindowMs: 15000,
      maxRetries: 3,
      enableAsync: true
    },
    features: {
      enableHeadersCapture: true,
      enableTokenDetails: true,
      enableCostDetails: true
    }
    // ... 更多配置选项
  }
}
```

### 环境变量支持

```bash
# 基本配置
ENHANCED_LOGGING_ENABLED=true
ENHANCED_LOGGING_MERGE_WINDOW=15000
ENHANCED_LOGGING_ASYNC=true

# 功能开关
ENHANCED_LOGGING_HEADERS=true
ENHANCED_LOGGING_TOKENS=true
ENHANCED_LOGGING_COSTS=true

# 性能配置
ENHANCED_LOGGING_MAX_LOG_SIZE=200000
ENHANCED_LOGGING_MAX_RETRIES=3
```

## 🔧 服务管理

### 工厂方法

```javascript
const factory = unifiedLogServiceFactory

// 创建新实例
const service1 = await factory.create()

// 获取单例
const singleton = await factory.getSingleton()

// 创建命名实例
const namedService = await factory.create({}, {}, 'analytics')

// 获取命名实例
const retrieved = factory.getNamedInstance('analytics')
```

### 健康检查

```javascript
const healthResult = await factory.healthCheck()
console.log('健康状态:', healthResult.status)
console.log('依赖状态:', healthResult.dependencies)
```

### 统计信息

```javascript
// 工厂统计
const factoryStats = factory.getFactoryStats()

// 服务统计
const serviceStats = await singleton.getStats()
```

## 🔄 迁移指南

### 从旧版本迁移

旧的使用方式：

```javascript
// 旧版本 - 直接实例化
const { unifiedLogService } = require('./UnifiedLogService')
await unifiedLogService.logRequest(keyId, logData)
```

新的使用方式：

```javascript
// 新版本 - 工厂模式
const { unifiedLogServiceFactory } = require('./UnifiedLogServiceFactory')
const service = await unifiedLogServiceFactory.getSingleton()
await service.logRequest(keyId, logData)
```

### 向后兼容性

系统提供完全的向后兼容性，现有代码可以无修改运行。

## 🧪 测试支持

### 单元测试

```javascript
const { UnifiedLogService } = require('./UnifiedLogService')

// 模拟依赖
const mockDatabase = {
  async logRequest(keyId, data) {
    return 'mock-log-id'
  }
}

const mockHeadersFilter = {
  async filterHeaders(headers) {
    return headers
  }
}

const mockLogger = {
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}

// 直接实例化用于测试
const service = new UnifiedLogService(
  {
    database: mockDatabase,
    headersFilter: mockHeadersFilter,
    logger: mockLogger
  },
  { enableAsync: false } // 同步模式便于测试
)
```

### 集成测试

```javascript
const { unifiedLogServiceFactory } = require('./UnifiedLogServiceFactory')

describe('UnifiedLogService Integration', () => {
  let service

  beforeEach(async () => {
    service = await unifiedLogServiceFactory.create()
  })

  afterEach(async () => {
    await service.shutdown()
  })

  it('should log requests successfully', async () => {
    const logId = await service.logRequest('test-key', {
      path: '/test',
      method: 'POST'
    })
    expect(logId).toBeDefined()
  })
})
```

## 🚨 错误处理

### 依赖验证

```javascript
try {
  const service = new UnifiedLogService({}, {}) // 缺少必需依赖
} catch (error) {
  console.error('依赖验证失败:', error.message)
  // 输出: 缺少必需的依赖项: database, headersFilter
}
```

### 优雅降级

```javascript
const service = await unifiedLogServiceFactory.getSingleton()

// 系统自动处理错误并尝试降级记录
const logId = await service.logRequest('key', invalidData)
// 即使主要记录失败，也会尝试记录简化版本
```

## 📈 性能优化

### 异步处理

```javascript
const service = await unifiedLogServiceFactory.getSingleton({
  enableAsync: true,
  mergeWindowMs: 10000
})

// 异步记录，不阻塞主流程
const logId = await service.logRequest(keyId, logData, { sync: false })
```

### 缓存和去重

```javascript
// 系统自动处理重复日志合并
await service.logRequest('key', { path: '/api' })
await service.logRequest('key', { path: '/api' }) // 自动合并或跳过
```

## 🔒 最佳实践

### 1. 使用单例模式

```javascript
// ✅ 推荐 - 使用单例
const service = await unifiedLogServiceFactory.getSingleton()

// ❌ 避免 - 重复创建实例
const service1 = await unifiedLogServiceFactory.create()
const service2 = await unifiedLogServiceFactory.create()
```

### 2. 配置集中管理

```javascript
// ✅ 推荐 - 从config.js读取
const service = await unifiedLogServiceFactory.getSingleton()

// ❌ 避免 - 硬编码配置
const service = await unifiedLogServiceFactory.getSingleton({
  mergeWindowMs: 15000 // 应该从配置文件读取
})
```

### 3. 错误处理

```javascript
try {
  const logId = await service.logRequest(keyId, logData)
  if (logId) {
    logger.debug('日志记录成功:', logId)
  }
} catch (error) {
  logger.error('日志记录失败:', error)
  // 不要让日志错误影响主要业务流程
}
```

### 4. 优雅关闭

```javascript
process.on('SIGTERM', async () => {
  await unifiedLogServiceFactory.shutdown()
  process.exit(0)
})
```

## 📚 类型定义

项目提供完整的TypeScript类型定义：

```typescript
import type {
  IUnifiedLogService,
  LogData,
  UnifiedLogServiceConfig
} from './types/UnifiedLogService'

const service: IUnifiedLogService = await unifiedLogServiceFactory.getSingleton()
const logData: LogData = { path: '/api', method: 'POST' }
await service.logRequest('key', logData)
```

## 🔗 相关文档

- [ENHANCED_LOGGING_GUIDE.md](./ENHANCED_LOGGING_GUIDE.md) - 增强日志系统详细说明
- [UNIFIED_LOGGING_SYSTEM.md](./UNIFIED_LOGGING_SYSTEM.md) - 统一日志系统架构
- [config/config.js](./config/config.js) - 配置文件参考

## 💡 故障排除

### 常见问题

1. **依赖注入失败**

   ```javascript
   // 检查依赖是否正确
   const healthCheck = await factory.healthCheck()
   console.log(healthCheck.dependencies)
   ```

2. **配置加载失败**

   ```javascript
   // 查看工厂状态
   const stats = factory.getFactoryStats()
   console.log('配置已加载:', stats.configurationLoaded)
   ```

3. **性能问题**
   ```javascript
   // 检查服务统计
   const stats = await service.getStats()
   console.log('平均处理时间:', stats.averageProcessingTime)
   console.log('成功率:', stats.successRate)
   ```

---

_通过依赖注入架构，UnifiedLogService现在提供了更好的可测试性、可维护性和扩展性，同时保持了完全的向后兼容性。_
