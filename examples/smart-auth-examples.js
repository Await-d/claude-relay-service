/**
 * Claude Relay Service - 智能认证路由检测示例
 * 
 * 本文件演示如何使用新增的智能认证功能
 * 这些示例展示了不同的认证场景和配置选项
 */

const {
  detectAuthenticationType,
  authenticateEnhanced,
  getAuthenticationContext,
  authenticateDual
} = require('../src/middleware/auth')

// ====================================================================
// 示例 1: 智能认证类型检测
// ====================================================================

/**
 * 演示 detectAuthenticationType 函数的用法
 */
function exampleDetectAuthType() {
  console.log('\n=== 示例 1: 智能认证类型检测 ===')
  
  // 模拟不同类型的请求对象
  const requests = [
    {
      name: 'API Key in x-api-key header',
      req: {
        headers: { 'x-api-key': 'cr_1234567890abcdef' },
        query: {},
        cookies: {}
      }
    },
    {
      name: 'JWT Session Token in Authorization Bearer',
      req: {
        headers: { 
          'authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c' 
        },
        query: {},
        cookies: {}
      }
    },
    {
      name: 'Claude Relay API Key in Authorization Bearer',
      req: {
        headers: { 
          'authorization': 'Bearer cr_1234567890abcdef' 
        },
        query: {},
        cookies: {}
      }
    },
    {
      name: 'Multiple authentication sources',
      req: {
        headers: { 
          'x-api-key': 'cr_primary_key',
          'authorization': 'Bearer backup_session_token',
          'x-admin-token': 'admin_session_123456'
        },
        query: {},
        cookies: { sessionToken: 'cookie_session_token' }
      }
    }
  ]

  requests.forEach(({ name, req }) => {
    console.log(`\n${name}:`)
    const authInfo = detectAuthenticationType(req)
    console.log(`  认证类型: ${authInfo.authType}`)
    console.log(`  置信度: ${authInfo.confidence}%`)
    console.log(`  检测到的来源: ${authInfo.detectedSources.join(', ')}`)
    console.log(`  有API Key: ${authInfo.hasApiKey}`)
    console.log(`  有Session Token: ${authInfo.hasSessionToken}`)
    console.log(`  有Admin Token: ${authInfo.hasAdminToken}`)
  })
}

// ====================================================================
// 示例 2: 增强认证中间件配置
// ====================================================================

/**
 * 演示不同的 authenticateEnhanced 配置选项
 */
function exampleEnhancedAuth() {
  console.log('\n=== 示例 2: 增强认证中间件配置 ===')

  // 配置选项 1: 仅允许API Key认证
  const apiKeyOnlyAuth = authenticateEnhanced({
    requireApiKey: true,
    strictMode: true,
    includeDebugInfo: true
  })
  console.log('\n✅ API Key专用认证中间件已创建')

  // 配置选项 2: 用户会话优先，API Key回退
  const sessionFirstAuth = authenticateEnhanced({
    priority: ['user_session', 'api_key'],
    allowFallback: true
  })
  console.log('✅ 用户会话优先认证中间件已创建')

  // 配置选项 3: 双重认证（同时需要API Key和用户会话）
  const dualRequiredAuth = authenticateEnhanced({
    requireApiKey: true,
    requireUserSession: true,
    requireBoth: true
  })
  console.log('✅ 双重认证中间件已创建')

  // 配置选项 4: 管理员专用认证
  const adminOnlyAuth = authenticateEnhanced({
    requireAdminSession: true,
    strictMode: true,
    customErrorHandler: (error, req, res, next) => {
      console.log(`自定义错误处理: ${error.message}`)
      res.status(403).json({ error: 'Admin access required' })
    }
  })
  console.log('✅ 管理员专用认证中间件已创建')

  // 配置选项 5: 灵活认证（自动检测最佳认证方式）
  const flexibleAuth = authenticateEnhanced({
    priority: ['api_key', 'admin_session', 'user_session'],
    allowFallback: true,
    includeDebugInfo: false
  })
  console.log('✅ 灵活认证中间件已创建')
}

// ====================================================================
// 示例 3: 认证上下文获取
// ====================================================================

/**
 * 演示 getAuthenticationContext 函数的用法
 */
function exampleAuthContext() {
  console.log('\n=== 示例 3: 认证上下文获取 ===')

  // 模拟已认证的请求对象
  const authenticatedRequests = [
    {
      name: 'API Key认证用户',
      req: {
        ip: '192.168.1.100',
        requestId: 'req_123',
        get: (header) => header === 'User-Agent' ? 'Claude Code/1.0' : 'unknown',
        apiKey: {
          id: 'key_123',
          name: 'Production Key',
          permissions: ['api:access', 'models:gpt-4'],
          tokenLimit: 10000,
          concurrencyLimit: 5
        }
      }
    },
    {
      name: '用户会话认证',
      req: {
        ip: '10.0.0.50',
        requestId: 'req_456',
        get: (header) => header === 'User-Agent' ? 'Mozilla/5.0' : 'unknown',
        user: {
          id: 'user_456',
          username: 'john_doe',
          email: 'john@example.com',
          role: 'admin',
          groups: ['api_access', 'advanced_features']
        },
        session: {
          sessionId: 'session_789',
          token: 'jwt_token_here'
        }
      }
    },
    {
      name: '管理员会话认证',
      req: {
        ip: '127.0.0.1',
        requestId: 'req_789',
        get: (header) => header === 'User-Agent' ? 'Admin Panel/2.0' : 'unknown',
        admin: {
          id: 'admin_001',
          username: 'admin',
          sessionId: 'admin_session_456',
          loginTime: new Date().toISOString()
        }
      }
    }
  ]

  authenticatedRequests.forEach(({ name, req }) => {
    console.log(`\n${name}:`)
    const context = getAuthenticationContext(req)
    console.log(`  认证状态: ${context.authenticated ? '✅ 已认证' : '❌ 未认证'}`)
    console.log(`  认证类型: ${context.authType}`)
    console.log(`  权限列表: ${context.permissions.join(', ') || '无'}`)
    
    if (context.user) {
      console.log(`  用户信息: ${context.user.username} (${context.user.email})`)
    }
    
    if (context.admin) {
      console.log(`  管理员: ${context.admin.username}`)
    }
    
    if (context.apiKey) {
      console.log(`  API Key: ${context.apiKey.name} (${context.apiKey.id})`)
    }
    
    console.log(`  请求元数据: IP=${context.metadata.ip}, Agent=${context.metadata.userAgent}`)
  })
}

// ====================================================================
// 示例 4: Express路由集成
// ====================================================================

/**
 * 演示如何在 Express 路由中使用智能认证
 */
function exampleExpressIntegration() {
  console.log('\n=== 示例 4: Express路由集成 ===')

  // 这些是伪代码示例，展示实际使用方式
  const expressExamples = `
// 1. 基础路由：自动检测认证类型
app.get('/api/v1/user/profile', authenticateDual, (req, res) => {
  const context = getAuthenticationContext(req)
  res.json({
    message: 'Profile data',
    authType: context.authType,
    user: context.user || context.admin
  })
})

// 2. API专用路由：仅允许API Key
app.post('/api/v1/models', authenticateEnhanced({
  requireApiKey: true,
  strictMode: true
}), (req, res) => {
  res.json({ models: ['gpt-4', 'claude-3'] })
})

// 3. 管理员路由：仅允许管理员会话
app.get('/admin/dashboard', authenticateEnhanced({
  requireAdminSession: true,
  strictMode: true
}), (req, res) => {
  res.json({ message: 'Admin dashboard data' })
})

// 4. 高级路由：需要双重认证
app.post('/api/v1/admin/emergency', authenticateEnhanced({
  requireApiKey: true,
  requireAdminSession: true,
  requireBoth: true
}), (req, res) => {
  res.json({ message: 'Emergency action executed' })
})

// 5. 灵活路由：支持多种认证方式，优先级可配置
app.get('/api/v1/flexible', authenticateEnhanced({
  priority: ['user_session', 'api_key', 'admin_session'],
  allowFallback: true,
  includeDebugInfo: process.env.NODE_ENV === 'development'
}), (req, res) => {
  const context = getAuthenticationContext(req)
  res.json({
    message: 'Flexible endpoint',
    authType: context.authType,
    permissions: context.permissions
  })
})
`

  console.log('Express路由集成示例:')
  console.log(expressExamples)
}

// ====================================================================
// 示例 5: 错误处理和调试
// ====================================================================

/**
 * 演示错误处理和调试功能
 */
function exampleErrorHandling() {
  console.log('\n=== 示例 5: 错误处理和调试 ===')

  const debugConfig = {
    includeDebugInfo: true,
    customErrorHandler: (error, req, res, next) => {
      console.error('自定义错误处理器被调用:', error.message)
      
      // 记录详细的错误信息
      console.log('请求详情:', {
        method: req.method,
        url: req.originalUrl,
        ip: req.ip,
        userAgent: req.get?.('User-Agent')
      })
      
      // 返回自定义错误响应
      res.status(401).json({
        error: 'Authentication Failed',
        message: '认证失败，请检查您的凭据',
        supportedMethods: [
          'API Key (x-api-key header)',
          'Session Token (Authorization Bearer)',
          'Admin Token (x-admin-token header)'
        ],
        timestamp: new Date().toISOString()
      })
    }
  }

  console.log('✅ 调试配置已设置')
  console.log('  - 包含调试信息: 是')
  console.log('  - 自定义错误处理器: 是')
  console.log('  - 详细错误日志: 是')
}

// ====================================================================
// 示例 6: 性能和安全最佳实践
// ====================================================================

/**
 * 演示性能和安全最佳实践
 */
function exampleBestPractices() {
  console.log('\n=== 示例 6: 性能和安全最佳实践 ===')

  console.log('\n🚀 性能最佳实践:')
  console.log('  1. 缓存认证结果以减少数据库查询')
  console.log('  2. 使用内存缓存存储频繁访问的认证信息')
  console.log('  3. 异步处理认证日志记录')
  console.log('  4. 智能采样减少日志数据量')

  console.log('\n🔒 安全最佳实践:')
  console.log('  1. 敏感信息（tokens, keys）在日志中自动过滤')
  console.log('  2. 认证失败时提供通用错误消息，避免信息泄露')
  console.log('  3. IP地址在日志中自动匿名化')
  console.log('  4. 支持多因素认证和权限细化控制')

  console.log('\n⚡ 使用建议:')
  console.log('  1. 生产环境关闭 includeDebugInfo')
  console.log('  2. 根据流量调整认证缓存策略')
  console.log('  3. 定期轮换和更新认证密钥')
  console.log('  4. 监控认证失败率和异常模式')
}

// ====================================================================
// 主函数 - 运行所有示例
// ====================================================================

function runAllExamples() {
  console.log('🎯 Claude Relay Service - 智能认证路由检测功能示例')
  console.log('=' .repeat(60))

  try {
    exampleDetectAuthType()
    exampleEnhancedAuth()
    exampleAuthContext()
    exampleExpressIntegration()
    exampleErrorHandling()
    exampleBestPractices()

    console.log('\n🎉 所有示例运行完成！')
    console.log('\n📚 更多信息:')
    console.log('  - 查看 src/middleware/auth.js 了解完整实现')
    console.log('  - 参考项目文档了解配置选项')
    console.log('  - 在开发环境中启用调试模式获取详细信息')
  } catch (error) {
    console.error('❌ 示例运行出错:', error.message)
  }
}

// 导出示例函数供其他模块使用
module.exports = {
  exampleDetectAuthType,
  exampleEnhancedAuth,
  exampleAuthContext,
  exampleExpressIntegration,
  exampleErrorHandling,
  exampleBestPractices,
  runAllExamples
}

// 如果直接运行此文件，执行所有示例
if (require.main === module) {
  runAllExamples()
}