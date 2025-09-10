# 错误处理和重试机制集成指南

本文档详细说明如何将增强的错误处理和重试机制集成到Claude Relay Service中。

## 📋 概述

我们为Claude Relay Service开发了两个核心增强组件：

1. **RetryManager** (`src/utils/retryManager.js`) - 智能重试管理器
2. **EnhancedErrorHandler** (`src/middleware/enhancedErrorHandler.js`) - 增强错误处理中间件

这些组件提供：
- 指数退避重试策略
- 熔断器模式防止雪崩
- 错误分类和智能处理
- 用户友好的错误消息
- 敏感信息脱敏
- 实时监控和统计

## 🚀 快速集成

### 步骤1: 更新主应用入口

修改 `src/server.js` 或主入口文件：

```javascript
const express = require('express')
const { createErrorRetryIntegration } = require('./src/utils/errorRetryIntegration')

const app = express()

// 创建错误处理和重试集成实例
const errorRetryIntegration = createErrorRetryIntegration({
  maxRetries: 3,
  baseDelay: 1000,
  defaultLanguage: 'zh'
})

// 应用增强的错误处理中间件
app.use(errorRetryIntegration.createErrorMiddleware())

// ... 其他中间件和路由

// 错误处理中间件应该在最后
app.use(errorRetryIntegration.createErrorMiddleware())
```

### 步骤2: 增强核心服务

修改核心服务文件，例如 `src/services/claudeRelayService.js`：

```javascript
const { createErrorRetryIntegration } = require('../utils/errorRetryIntegration')
const claudeRelayService = require('./claudeRelayService')

// 创建集成实例
const errorRetryIntegration = createErrorRetryIntegration()

// 包装现有服务
const enhancedClaudeService = errorRetryIntegration.createEnhancedClaudeService(claudeRelayService)

module.exports = enhancedClaudeService
```

### 步骤3: 更新配置文件

在 `config/config.js` 中添加错误处理配置：

```javascript
const { errorRetryConfig } = require('./errorRetryConfig.example')

const config = {
  // ... 现有配置
  
  // 新增错误处理和重试配置
  errorHandling: errorRetryConfig,
  
  // ... 其他配置
}
```

### 步骤4: 环境变量配置

在 `.env` 文件中添加配置项：

```bash
# 错误处理和重试配置
RETRY_MAX_ATTEMPTS=3
RETRY_BASE_DELAY=1000
CIRCUIT_BREAKER_ENABLED=true
ERROR_SANITIZATION_ENABLED=true
ERROR_DEFAULT_LANGUAGE=zh
```

## 🔧 详细集成方案

### 1. Claude API请求重试

将现有的Claude API调用包装为重试调用：

```javascript
// 原有代码
const response = await this._makeClaudeRequest(body, accessToken, proxyAgent, clientHeaders, accountId)

// 增强后的代码
const response = await errorRetryIntegration.executeClaudeApiCall(
  () => this._makeClaudeRequest(body, accessToken, proxyAgent, clientHeaders, accountId),
  {
    accountId,
    model: body.model,
    maxRetries: 3
  }
)
```

### 2. Token刷新重试

增强token刷新的可靠性：

```javascript
// 原有代码
const tokenData = await this.refreshAccessToken(accountId)

// 增强后的代码
const tokenData = await errorRetryIntegration.executeTokenRefresh(
  () => this.refreshAccessToken(accountId),
  { accountId }
)
```

### 3. 数据库操作重试

为数据库操作添加重试机制：

```javascript
// 原有代码
const result = await database.get(key)

// 增强后的代码
const result = await errorRetryIntegration.executeDatabaseOperation(
  () => database.get(key),
  { operationType: 'read', key }
)
```

### 4. 路由级别错误处理

在路由中使用增强的错误处理：

```javascript
app.post('/api/v1/messages', async (req, res, next) => {
  try {
    // 业务逻辑
    const result = await processMessage(req.body)
    res.json(result)
  } catch (error) {
    // 错误会被增强错误处理中间件自动处理
    next(error)
  }
})
```

## 📊 监控和统计

### 获取监控数据

```javascript
// 获取综合监控统计
const monitoringData = errorRetryIntegration.getMonitoringData()

console.log('重试统计:', monitoringData.retryManager.statistics)
console.log('错误统计:', monitoringData.errorHandler.statistics)
console.log('熔断器状态:', monitoringData.retryManager.circuitBreakers)
```

### 健康检查集成

```javascript
app.get('/health', (req, res) => {
  const systemHealth = errorRetryIntegration.healthCheck()
  
  res.status(systemHealth.healthy ? 200 : 503).json({
    status: systemHealth.healthy ? 'healthy' : 'unhealthy',
    components: systemHealth.components,
    timestamp: systemHealth.timestamp
  })
})
```

### 监控仪表板端点

```javascript
app.get('/admin/monitoring/errors', authenticateAdmin, (req, res) => {
  const monitoringData = errorRetryIntegration.getMonitoringData()
  res.json(monitoringData)
})

app.post('/admin/monitoring/reset', authenticateAdmin, (req, res) => {
  errorRetryIntegration.resetAllStatistics()
  res.json({ message: 'Statistics reset successfully' })
})
```

## 🎯 特定服务集成示例

### 1. Claude账户服务增强

```javascript
// src/services/claudeAccountService.js
const { createErrorRetryIntegration } = require('../utils/errorRetryIntegration')

class ClaudeAccountService {
  constructor() {
    this.errorRetryIntegration = createErrorRetryIntegration()
  }

  async getValidAccessToken(accountId) {
    return await this.errorRetryIntegration.executeDatabaseOperation(
      async () => {
        // 原有token获取逻辑
        const tokenData = await this.getTokenFromDatabase(accountId)
        
        if (this.isTokenExpired(tokenData)) {
          // 自动刷新过期token
          await this.errorRetryIntegration.executeTokenRefresh(
            () => this.refreshAccessToken(accountId),
            { accountId }
          )
          return await this.getTokenFromDatabase(accountId)
        }
        
        return tokenData
      },
      { accountId, operationType: 'get_token' }
    )
  }
}
```

### 2. API Key验证增强

```javascript
// src/middleware/auth.js
const { createErrorRetryIntegration } = require('../utils/errorRetryIntegration')

const errorRetryIntegration = createErrorRetryIntegration()

const authenticateApiKey = async (req, res, next) => {
  try {
    // 使用重试机制验证API Key
    const validation = await errorRetryIntegration.executeDatabaseOperation(
      () => apiKeyService.validateApiKey(req.headers['x-api-key']),
      { operationType: 'api_key_validation' }
    )

    if (!validation.valid) {
      const error = new Error('Invalid API key')
      error.statusCode = 401
      error.category = 'authentication'
      throw error
    }

    req.apiKey = validation.keyData
    next()
  } catch (error) {
    next(error) // 交给增强错误处理中间件处理
  }
}
```

### 3. 流式响应错误处理

```javascript
// 在流式响应中使用错误处理
app.post('/api/v1/messages/stream', authenticateApiKey, async (req, res, next) => {
  try {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    await errorRetryIntegration.executeClaudeApiCall(
      () => claudeService.relayStreamRequestWithUsageCapture(
        req.body,
        req.apiKey,
        res,
        req.headers,
        (usage) => {
          // 处理usage数据
        }
      ),
      {
        accountId: req.apiKey.claudeAccountId,
        model: req.body.model
      }
    )
  } catch (error) {
    // 流式响应的错误处理
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
    }
    
    res.write(`data: ${JSON.stringify({
      error: 'Stream error',
      message: error.message,
      requestId: req.requestId
    })}\n\n`)
    
    res.end()
  }
})
```

## ⚙️ 高级配置

### 1. 自定义错误分类

```javascript
const errorRetryIntegration = createErrorRetryIntegration({
  errorHandlerOptions: {
    customErrorClassifier: (error) => {
      if (error.message.includes('claude api quota')) {
        return 'api_quota_exceeded'
      }
      return null // 使用默认分类
    }
  }
})
```

### 2. 自定义重试策略

```javascript
const errorRetryIntegration = createErrorRetryIntegration({
  errorStrategies: {
    'custom_error_type': {
      strategy: RetryStrategy.EXPONENTIAL_BACKOFF,
      maxRetries: 5,
      baseDelay: 3000,
      shouldRetry: (error, attempt) => {
        // 自定义重试逻辑
        return attempt < 3 && error.isRetryable
      }
    }
  }
})
```

### 3. 多语言支持

```javascript
const errorRetryIntegration = createErrorRetryIntegration({
  errorHandlerOptions: {
    customMessages: {
      en: {
        authentication: {
          message: 'Authentication failed',
          recovery: 'Please check your credentials'
        }
      },
      ja: {
        authentication: {
          message: '認証に失敗しました',
          recovery: '認証情報を確認してください'
        }
      }
    }
  }
})
```

## 🔍 测试和验证

### 1. 单元测试示例

```javascript
// tests/errorRetry.test.js
const { createErrorRetryIntegration } = require('../src/utils/errorRetryIntegration')

describe('Error Retry Integration', () => {
  let integration

  beforeEach(() => {
    integration = createErrorRetryIntegration()
  })

  test('should retry failed Claude API calls', async () => {
    let attempts = 0
    const mockApiCall = jest.fn().mockImplementation(() => {
      attempts++
      if (attempts < 3) {
        throw new Error('Network error')
      }
      return { success: true }
    })

    const result = await integration.executeClaudeApiCall(mockApiCall)
    expect(result.success).toBe(true)
    expect(attempts).toBe(3)
  })

  test('should classify errors correctly', async () => {
    const error = new Error('Rate limit exceeded')
    error.statusCode = 429
    
    try {
      await integration.executeClaudeApiCall(() => {
        throw error
      })
    } catch (enhancedError) {
      expect(enhancedError.retryContext.finalErrorType).toBe('api_rate_limit')
    }
  })
})
```

### 2. 集成测试

```javascript
const request = require('supertest')
const app = require('../src/server')

describe('Enhanced Error Handling', () => {
  test('should return user-friendly error messages', async () => {
    const response = await request(app)
      .post('/api/v1/messages')
      .set('x-api-key', 'invalid-key')
      .expect(401)

    expect(response.body.message).toContain('身份验证失败')
    expect(response.body.suggestion).toBeDefined()
    expect(response.body.requestId).toBeDefined()
  })

  test('should handle circuit breaker correctly', async () => {
    // 触发多次失败以开启熔断器
    for (let i = 0; i < 6; i++) {
      await request(app)
        .post('/api/v1/messages')
        .set('x-api-key', 'valid-key')
        .send({ model: 'failed-model' })
        .expect(500)
    }

    // 熔断器应该开启，后续请求直接失败
    const response = await request(app)
      .post('/api/v1/messages')
      .set('x-api-key', 'valid-key')
      .send({ model: 'any-model' })
      .expect(503)

    expect(response.body.message).toContain('Circuit breaker')
  })
})
```

## 🚨 故障排除

### 常见问题和解决方案

1. **重试次数过多导致响应延迟**
   ```javascript
   // 调整重试配置
   const integration = createErrorRetryIntegration({
     maxRetries: 2, // 减少重试次数
     baseDelay: 500 // 减少基础延迟
   })
   ```

2. **熔断器过于敏感**
   ```javascript
   // 调整熔断器阈值
   const integration = createErrorRetryIntegration({
     circuitBreaker: {
       failureThreshold: 10, // 增加失败阈值
       recoveryTimeout: 60000 // 增加恢复时间
     }
   })
   ```

3. **错误消息包含敏感信息**
   ```javascript
   // 确保启用脱敏功能
   const integration = createErrorRetryIntegration({
     errorHandlerOptions: {
       enableSanitization: true,
       logSensitiveData: false
     }
   })
   ```

### 日志分析

查看错误处理日志：

```bash
# 查看重试相关日志
grep "🔄" logs/claude-relay-*.log

# 查看熔断器状态变化
grep "🚨\|✅.*Circuit breaker" logs/claude-relay-*.log

# 查看错误统计
grep "📊.*Error" logs/claude-relay-*.log
```

## 📈 性能优化建议

1. **调整重试参数**：
   - 生产环境建议 `maxRetries: 3-5`
   - 基础延迟 `baseDelay: 1000-2000ms`
   - 启用抖动避免惊群效应

2. **熔断器配置**：
   - 失败阈值根据服务QPS调整
   - 恢复超时不宜过短

3. **监控配置**：
   - 启用统计持久化
   - 设置合理的统计窗口期

4. **资源管理**：
   - 定期清理过期统计数据
   - 监控内存使用情况

## 🔄 版本升级

### 从现有系统迁移

1. **逐步迁移**：先在非关键路径测试
2. **保持兼容**：现有错误处理逻辑保持不变
3. **监控对比**：对比迁移前后的错误率和响应时间
4. **回滚准备**：准备快速回滚方案

### 配置迁移

```javascript
// 旧配置迁移示例
const oldConfig = {
  maxRetries: 3,
  timeout: 30000
}

// 新配置
const newConfig = {
  retryManager: {
    maxRetries: oldConfig.maxRetries,
    baseDelay: 1000,
    circuitBreaker: { enabled: true }
  },
  services: {
    claudeApi: {
      timeout: oldConfig.timeout
    }
  }
}
```

## 📝 结论

通过集成这些增强的错误处理和重试机制，Claude Relay Service将获得：

- ✅ 更高的服务可用性和容错能力
- ✅ 更好的用户体验和错误反馈
- ✅ 更全面的监控和故障诊断能力
- ✅ 更安全的错误信息处理

建议在测试环境充分验证后，逐步部署到生产环境。持续监控系统指标，根据实际运行情况调整配置参数。