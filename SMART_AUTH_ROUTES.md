# 智能认证路由检测功能

本文档介绍了 Claude Relay Service 新增的智能认证路由检测功能，该功能提供了更灵活、更智能的认证机制。

## 🚀 功能概览

### 新增功能

1. **智能认证类型检测** - 自动识别请求中的认证信息类型
2. **增强认证中间件** - 可配置的灵活认证策略
3. **认证上下文获取** - 统一的认证信息访问接口
4. **多重认证支持** - 支持同时验证多种认证类型
5. **优先级认证路由** - 可配置的认证方式优先级

### 核心特性

- ✅ **向后兼容** - 现有 API Key 用户零影响
- ✅ **智能检测** - 自动识别认证类型和来源
- ✅ **灵活配置** - 支持多种认证策略组合
- ✅ **安全增强** - 提供详细的认证失败信息
- ✅ **性能优化** - 高效的认证检测算法

## 📚 API 参考

### 1. `detectAuthenticationType(req)`

智能检测请求中的认证信息类型。

```javascript
const { detectAuthenticationType } = require('../src/middleware/auth')

const authInfo = detectAuthenticationType(req)
console.log(authInfo)
```

**返回值结构：**
```javascript
{
  hasApiKey: boolean,           // 是否包含 API Key
  hasSessionToken: boolean,     // 是否包含用户会话 Token
  hasAdminToken: boolean,       // 是否包含管理员 Token
  authType: string,             // 主要认证类型: 'api_key' | 'user_session' | 'admin_session' | 'none'
  detectedSources: string[],    // 检测到的认证来源列表
  confidence: number            // 检测置信度 (0-100)
}
```

**支持的认证来源：**
- `x-api-key` header
- `x-goog-api-key` header (Gemini CLI 兼容)
- `api-key` header
- `Authorization: Bearer cr_*` (Claude Relay API Key)
- `Authorization: Bearer <jwt>` (用户会话 Token)
- `x-session-token` header
- `x-admin-token` header
- Cookie: `sessionToken`, `adminToken`
- Query: `key`, `session_token` (仅开发环境)

### 2. `authenticateEnhanced(options)`

创建可配置的增强认证中间件。

```javascript
const { authenticateEnhanced } = require('../src/middleware/auth')

// 基础配置
const auth = authenticateEnhanced({
  requireApiKey: false,         // 是否必需 API Key
  requireUserSession: false,    // 是否必需用户会话
  requireAdminSession: false,   // 是否必需管理员会话
  allowFallback: true,          // 是否允许认证回退
  requireBoth: false,           // 是否需要多重认证
  strictMode: false,            // 严格模式
  priority: ['api_key', 'admin_session', 'user_session'], // 认证优先级
  customErrorHandler: null,     // 自定义错误处理器
  includeDebugInfo: false       // 是否包含调试信息
})

app.use('/api/protected', auth)
```

### 3. `getAuthenticationContext(req)`

获取当前请求的完整认证上下文。

```javascript
const { getAuthenticationContext } = require('../src/middleware/auth')

const context = getAuthenticationContext(req)
```

**返回值结构：**
```javascript
{
  authenticated: boolean,       // 是否已认证
  authType: string,            // 认证类型
  user: object | null,         // 用户信息
  admin: object | null,        // 管理员信息
  apiKey: object | null,       // API Key 信息
  session: object | null,      // 会话信息
  permissions: string[],       // 权限列表
  metadata: {                  // 请求元数据
    ip: string,
    userAgent: string,
    requestId: string,
    timestamp: string
  }
}
```

### 4. `authenticateDual(req, res, next)`

智能双重认证中间件（现有功能增强版）。

- 优先使用 API Key 认证
- 自动回退到用户会话认证
- 支持管理员会话认证
- 提供详细的认证失败信息

## 🛠️ 使用示例

### 基础使用

```javascript
const { authenticateDual, getAuthenticationContext } = require('./src/middleware/auth')

// 自动检测认证类型的路由
app.get('/api/v1/profile', authenticateDual, (req, res) => {
  const context = getAuthenticationContext(req)
  res.json({
    message: '用户资料',
    authType: context.authType,
    user: context.user
  })
})
```

### 高级配置

```javascript
const { authenticateEnhanced } = require('./src/middleware/auth')

// API 专用认证
const apiOnlyAuth = authenticateEnhanced({
  requireApiKey: true,
  strictMode: true
})

// 双重认证要求
const dualAuth = authenticateEnhanced({
  requireApiKey: true,
  requireUserSession: true,
  requireBoth: true
})

// 灵活认证策略
const flexibleAuth = authenticateEnhanced({
  priority: ['user_session', 'api_key'],
  allowFallback: true,
  includeDebugInfo: process.env.NODE_ENV === 'development'
})

app.post('/api/v1/models', apiOnlyAuth, handleModels)
app.post('/api/v1/admin/action', dualAuth, handleAdminAction)
app.get('/api/v1/data', flexibleAuth, handleData)
```

### 自定义错误处理

```javascript
const customAuth = authenticateEnhanced({
  requireApiKey: true,
  customErrorHandler: (error, req, res, next) => {
    console.error('认证失败:', error.message)
    res.status(401).json({
      error: 'Unauthorized',
      message: '请提供有效的 API Key',
      timestamp: new Date().toISOString()
    })
  }
})
```

## 🔧 配置选项详解

### 认证模式

- **`requireApiKey`** - 强制要求 API Key 认证
- **`requireUserSession`** - 强制要求用户会话认证
- **`requireAdminSession`** - 强制要求管理员会话认证

### 认证策略

- **`allowFallback`** - 允许认证方式之间的自动回退
- **`requireBoth`** - 同时要求多种认证方式
- **`strictMode`** - 严格模式，禁用所有回退机制

### 优先级配置

通过 `priority` 数组定义认证方式的检查顺序：

```javascript
// API Key 优先
priority: ['api_key', 'user_session', 'admin_session']

// 用户会话优先
priority: ['user_session', 'api_key', 'admin_session']

// 管理员优先
priority: ['admin_session', 'api_key', 'user_session']
```

## 🔒 安全特性

### 自动安全过滤

- 敏感信息（API Keys、Tokens）在日志中自动过滤
- IP 地址自动匿名化处理
- 认证失败时不泄露具体错误原因

### 认证审计

- 详细的认证过程日志记录
- 认证失败统计和监控
- 异常认证模式检测

### 多层认证验证

- 支持同时验证多种认证方式
- 认证上下文完整性检查
- 权限系统集成

## 📊 性能优化

### 高效检测算法

- 智能认证类型检测，避免重复解析
- 内存缓存认证结果
- 异步认证处理

### 资源优化

- 最小化认证开销
- 智能日志采样
- 缓存策略优化

## 🧪 测试和调试

### 开发模式

在开发环境中启用调试功能：

```javascript
const debugAuth = authenticateEnhanced({
  includeDebugInfo: true,
  customErrorHandler: (error, req, res, next) => {
    console.log('认证调试信息:', {
      error: error.message,
      detectedAuth: detectAuthenticationType(req),
      request: {
        method: req.method,
        url: req.originalUrl,
        headers: req.headers
      }
    })
    next(error)
  }
})
```

### 测试用例

项目包含完整的测试示例，参考：
- `examples/smart-auth-examples.js` - 功能演示
- 单元测试（计划中）
- 集成测试（计划中）

## 🔄 迁移指南

### 现有代码兼容性

**无需修改现有代码**：
- 现有的 `authenticateApiKey` 功能完全保持不变
- 现有的 `authenticateDual` 功能向后兼容
- 所有现有路由继续正常工作

### 推荐升级步骤

1. **逐步迁移** - 新路由使用新功能，现有路由保持不变
2. **测试验证** - 在开发环境中充分测试新功能
3. **渐进部署** - 逐步将关键路由迁移到新的认证机制

### 升级示例

```javascript
// 旧代码 (继续有效)
app.get('/api/old', authenticateApiKey, handler)
app.get('/api/mixed', authenticateDual, handler)

// 新代码 (推荐使用)
app.get('/api/new', authenticateEnhanced({ 
  priority: ['api_key', 'user_session'] 
}), handler)
```

## 📈 最佳实践

### 生产环境配置

```javascript
const productionAuth = authenticateEnhanced({
  requireApiKey: true,
  strictMode: true,
  includeDebugInfo: false,
  customErrorHandler: (error, req, res, next) => {
    // 记录错误但不泄露细节
    logger.security('认证失败', { ip: req.ip, url: req.originalUrl })
    res.status(401).json({ error: 'Unauthorized' })
  }
})
```

### 开发环境配置

```javascript
const developmentAuth = authenticateEnhanced({
  priority: ['api_key', 'user_session'],
  allowFallback: true,
  includeDebugInfo: true
})
```

## 🐛 故障排除

### 常见问题

1. **认证检测失败**
   - 检查请求头格式是否正确
   - 验证 Token 是否有效且未过期
   - 确认认证来源配置正确

2. **多重认证问题**
   - 确认 `requireBoth: true` 配置
   - 检查所有必需的认证方式都已提供
   - 验证认证优先级配置

3. **性能问题**
   - 检查认证缓存配置
   - 关闭不必要的调试信息
   - 优化自定义错误处理器

### 调试技巧

```javascript
// 启用详细调试
process.env.NODE_ENV = 'development'

// 检查认证检测结果
const authInfo = detectAuthenticationType(req)
console.log('认证检测:', authInfo)

// 获取完整认证上下文
const context = getAuthenticationContext(req)
console.log('认证上下文:', context)
```

## 📝 更新日志

### v1.0.0 (当前版本)

**新增功能：**
- ✅ 智能认证类型检测
- ✅ 可配置增强认证中间件  
- ✅ 认证上下文统一接口
- ✅ 多重认证支持
- ✅ 优先级认证路由

**性能优化：**
- ✅ 高效认证检测算法
- ✅ 缓存策略优化
- ✅ 异步处理支持

**安全增强：**
- ✅ 敏感信息自动过滤
- ✅ IP 匿名化处理
- ✅ 认证审计日志

## 🤝 贡献指南

欢迎为智能认证功能贡献代码和建议：

1. Fork 项目并创建特性分支
2. 添加测试用例确保功能正常
3. 遵循项目代码规范（ESLint + Prettier）
4. 提交 Pull Request 并描述变更内容

## 📞 技术支持

如有问题或建议，请：
- 查看项目文档和示例代码
- 搜索现有 Issues
- 创建新的 Issue 并提供详细信息
- 参与社区讨论

---

**Claude Relay Service** - 强大、灵活、安全的 AI API 中转服务