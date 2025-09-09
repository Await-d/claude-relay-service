const apiKeyService = require('../services/apiKeyService')
const userService = require('../services/userService')
const logger = require('../utils/logger')
const database = require('../models/database')
const { RateLimiterRedis } = require('rate-limiter-flexible')
const config = require('../../config/config')
const { unifiedLogServiceFactory } = require('../services/UnifiedLogServiceFactory')
const { dynamicConfigManager } = require('../services/dynamicConfigService')
const { costLimitService } = require('../services/costLimitService')

// 🔧 请求日志配置缓存和动态检查机制
let cachedRequestLoggingConfig = {
  enabled: config.requestLogging?.enabled || false,
  lastUpdate: 0,
  isUpdating: false
}

/**
 * 高性能请求日志配置检查（零阻塞）
 * 使用内存缓存 + 异步更新策略，确保主请求路径不被阻塞
 * @returns {boolean} 是否启用请求日志记录
 */
const isRequestLoggingEnabled = () => {
  const now = Date.now()
  const cacheAge = now - cachedRequestLoggingConfig.lastUpdate

  // 如果缓存新鲜（小于30秒），直接返回缓存值
  if (cacheAge < 30000) {
    return cachedRequestLoggingConfig.enabled
  }

  // 如果缓存过期但没有在更新中，触发异步更新
  if (!cachedRequestLoggingConfig.isUpdating) {
    cachedRequestLoggingConfig.isUpdating = true

    // 异步更新配置，不阻塞当前请求
    setImmediate(async () => {
      try {
        const enabled = await dynamicConfigManager.getConfig(
          'requestLogging.enabled',
          config.requestLogging?.enabled || false
        )

        cachedRequestLoggingConfig = {
          enabled,
          lastUpdate: Date.now(),
          isUpdating: false
        }

        logger.debug(`📊 Request logging config updated: enabled=${enabled}`)
      } catch (error) {
        // 更新失败时保持当前缓存，重置更新标志
        cachedRequestLoggingConfig.isUpdating = false
        logger.debug('Failed to update request logging config, using cached value:', error.message)
      }
    })
  }

  // 返回当前缓存值（可能稍微过时，但保证零阻塞）
  return cachedRequestLoggingConfig.enabled
}

// 监听动态配置变更事件，立即更新缓存
dynamicConfigManager.on('configChanged', ({ key, value }) => {
  if (key === 'requestLogging.enabled') {
    cachedRequestLoggingConfig = {
      enabled: value,
      lastUpdate: Date.now(),
      isUpdating: false
    }
    logger.info(`📊 Request logging config changed: enabled=${value}`)
  }
})

// 🔑 API Key验证中间件（优化版）
const authenticateApiKey = async (req, res, next) => {
  const startTime = Date.now()

  try {
    // 安全提取API Key，支持多种格式（包括Gemini CLI支持）
    const apiKey =
      req.headers['x-api-key'] ||
      req.headers['x-goog-api-key'] ||
      req.headers['authorization']?.replace(/^Bearer\s+/i, '') ||
      req.headers['api-key'] ||
      req.query.key

    if (!apiKey) {
      logger.security(`🔒 Missing API key attempt from ${req.ip || 'unknown'}`)
      return res.status(401).json({
        error: 'Missing API key',
        message: 'Please provide an API key in the x-api-key header or Authorization header'
      })
    }

    // 基本API Key格式验证
    if (typeof apiKey !== 'string' || apiKey.length < 10 || apiKey.length > 512) {
      logger.security(`🔒 Invalid API key format from ${req.ip || 'unknown'}`)
      return res.status(401).json({
        error: 'Invalid API key format',
        message: 'API key format is invalid'
      })
    }

    // 验证API Key（带缓存优化）
    const validation = await apiKeyService.validateApiKey(apiKey)

    if (!validation.valid) {
      const clientIP = req.ip || req.connection?.remoteAddress || 'unknown'
      logger.security(`🔒 Invalid API key attempt: ${validation.error} from ${clientIP}`)
      return res.status(401).json({
        error: 'Invalid API key',
        message: validation.error
      })
    }

    // 🔒 检查客户端限制
    if (
      validation.keyData.enableClientRestriction &&
      validation.keyData.allowedClients?.length > 0
    ) {
      const userAgent = req.headers['user-agent'] || ''
      const clientIP = req.ip || req.connection?.remoteAddress || 'unknown'

      // 记录客户端限制检查开始
      logger.api(
        `🔍 Checking client restriction for key: ${validation.keyData.id} (${validation.keyData.name})`
      )
      logger.api(`   User-Agent: "${userAgent}"`)
      logger.api(`   Allowed clients: ${validation.keyData.allowedClients.join(', ')}`)

      let clientAllowed = false
      let matchedClient = null

      // 获取预定义客户端列表，如果配置不存在则使用默认值
      const predefinedClients = config.clientRestrictions?.predefinedClients || []
      const allowCustomClients = config.clientRestrictions?.allowCustomClients || false

      // 遍历允许的客户端列表
      for (const allowedClientId of validation.keyData.allowedClients) {
        // 在预定义客户端列表中查找
        const predefinedClient = predefinedClients.find((client) => client.id === allowedClientId)

        if (predefinedClient) {
          // 使用预定义的正则表达式匹配 User-Agent
          if (
            predefinedClient.userAgentPattern &&
            predefinedClient.userAgentPattern.test(userAgent)
          ) {
            clientAllowed = true
            matchedClient = predefinedClient.name
            break
          }
        } else if (allowCustomClients) {
          // 如果允许自定义客户端，这里可以添加自定义客户端的验证逻辑
          // 目前暂时跳过自定义客户端
          continue
        }
      }

      if (!clientAllowed) {
        logger.security(
          `🚫 Client restriction failed for key: ${validation.keyData.id} (${validation.keyData.name}) from ${clientIP}, User-Agent: ${userAgent}`
        )
        return res.status(403).json({
          error: 'Client not allowed',
          message: 'Your client is not authorized to use this API key',
          allowedClients: validation.keyData.allowedClients
        })
      }

      logger.api(
        `✅ Client validated: ${matchedClient} for key: ${validation.keyData.id} (${validation.keyData.name})`
      )
      logger.api(`   Matched client: ${matchedClient} with User-Agent: "${userAgent}"`)
    }

    // 检查并发限制
    const concurrencyLimit = validation.keyData.concurrencyLimit || 0
    if (concurrencyLimit > 0) {
      const currentConcurrency = await database.incrConcurrency(validation.keyData.id)
      logger.api(
        `📈 Incremented concurrency for key: ${validation.keyData.id} (${validation.keyData.name}), current: ${currentConcurrency}, limit: ${concurrencyLimit}`
      )

      if (currentConcurrency > concurrencyLimit) {
        // 如果超过限制，立即减少计数
        await database.decrConcurrency(validation.keyData.id)
        logger.security(
          `🚦 Concurrency limit exceeded for key: ${validation.keyData.id} (${validation.keyData.name}), current: ${currentConcurrency - 1}, limit: ${concurrencyLimit}`
        )
        return res.status(429).json({
          error: 'Concurrency limit exceeded',
          message: `Too many concurrent requests. Limit: ${concurrencyLimit} concurrent requests`,
          currentConcurrency: currentConcurrency - 1,
          concurrencyLimit
        })
      }

      // 使用标志位确保只减少一次
      let concurrencyDecremented = false

      const decrementConcurrency = async () => {
        if (!concurrencyDecremented) {
          concurrencyDecremented = true
          try {
            const newCount = await database.decrConcurrency(validation.keyData.id)
            logger.api(
              `📉 Decremented concurrency for key: ${validation.keyData.id} (${validation.keyData.name}), new count: ${newCount}`
            )
          } catch (error) {
            logger.error(`Failed to decrement concurrency for key ${validation.keyData.id}:`, error)
          }
        }
      }

      // 监听最可靠的事件（避免重复监听）
      // res.on('close') 是最可靠的，会在连接关闭时触发
      res.once('close', () => {
        logger.api(
          `🔌 Response closed for key: ${validation.keyData.id} (${validation.keyData.name})`
        )
        decrementConcurrency()
      })

      // req.on('close') 作为备用，处理请求端断开
      req.once('close', () => {
        logger.api(
          `🔌 Request closed for key: ${validation.keyData.id} (${validation.keyData.name})`
        )
        decrementConcurrency()
      })

      // res.on('finish') 处理正常完成的情况
      res.once('finish', () => {
        logger.api(
          `✅ Response finished for key: ${validation.keyData.id} (${validation.keyData.name})`
        )
        decrementConcurrency()
      })

      // 存储并发信息到请求对象，便于后续处理
      req.concurrencyInfo = {
        apiKeyId: validation.keyData.id,
        apiKeyName: validation.keyData.name,
        decrementConcurrency
      }
    }

    // 检查时间窗口限流
    const rateLimitWindow = validation.keyData.rateLimitWindow || 0
    const rateLimitRequests = validation.keyData.rateLimitRequests || 0

    if (rateLimitWindow > 0 && (rateLimitRequests > 0 || validation.keyData.tokenLimit > 0)) {
      const windowStartKey = `rate_limit:window_start:${validation.keyData.id}`
      const requestCountKey = `rate_limit:requests:${validation.keyData.id}`
      const tokenCountKey = `rate_limit:tokens:${validation.keyData.id}`

      const now = Date.now()
      const windowDuration = rateLimitWindow * 60 * 1000 // 转换为毫秒

      // 获取数据库客户端，避免重复连接检查
      const dbClient = database.getClient()
      if (!dbClient) {
        logger.warn('⚠️ database client not available for rate limiter')
        // 如果数据库客户端不可用，跳过限流检查
        logger.debug('Skipping rate limit check due to database unavailability')
      } else {
        // 获取窗口开始时间
        let windowStart = await dbClient.get(windowStartKey)

        if (!windowStart) {
          // 第一次请求，设置窗口开始时间
          // 使用原子操作确保所有键同时设置
          const pipeline = dbClient.pipeline()
          pipeline.set(windowStartKey, now, 'PX', windowDuration)
          pipeline.set(requestCountKey, 0, 'PX', windowDuration)
          pipeline.set(tokenCountKey, 0, 'PX', windowDuration)
          await pipeline.exec()
          windowStart = now
          logger.debug(`🚀 Initialized rate limit window for API Key: ${validation.keyData.id}`)
        } else {
          windowStart = parseInt(windowStart)

          // 检查窗口是否已过期
          if (now - windowStart >= windowDuration) {
            // 窗口已过期，重置所有键
            const pipeline = dbClient.pipeline()
            pipeline.set(windowStartKey, now, 'PX', windowDuration)
            pipeline.set(requestCountKey, 0, 'PX', windowDuration)
            pipeline.set(tokenCountKey, 0, 'PX', windowDuration)
            await pipeline.exec()
            windowStart = now
            logger.debug(`🔄 Reset expired rate limit window for API Key: ${validation.keyData.id}`)
          }
        }

        // 获取当前计数
        const currentRequests = parseInt((await dbClient.get(requestCountKey)) || '0')
        const currentTokens = parseInt((await dbClient.get(tokenCountKey)) || '0')

        // 检查请求次数限制
        if (rateLimitRequests > 0 && currentRequests >= rateLimitRequests) {
          const resetTime = new Date(windowStart + windowDuration)
          const remainingMinutes = Math.ceil((resetTime - now) / 60000)

          logger.security(
            `🚦 Rate limit exceeded (requests) for key: ${validation.keyData.id} (${validation.keyData.name}), requests: ${currentRequests}/${rateLimitRequests}`
          )

          return res.status(429).json({
            error: 'Rate limit exceeded',
            message: `已达到请求次数限制 (${rateLimitRequests} 次)，将在 ${remainingMinutes} 分钟后重置`,
            currentRequests,
            requestLimit: rateLimitRequests,
            resetAt: resetTime.toISOString(),
            remainingMinutes
          })
        }

        // 检查Token使用量限制
        const tokenLimit = parseInt(validation.keyData.tokenLimit)
        if (tokenLimit > 0 && currentTokens >= tokenLimit) {
          const resetTime = new Date(windowStart + windowDuration)
          const remainingMinutes = Math.ceil((resetTime - now) / 60000)

          logger.security(
            `🚦 Rate limit exceeded (tokens) for key: ${validation.keyData.id} (${validation.keyData.name}), tokens: ${currentTokens}/${tokenLimit}`
          )

          return res.status(429).json({
            error: 'Rate limit exceeded',
            message: `已达到 Token 使用限制 (${tokenLimit} tokens)，将在 ${remainingMinutes} 分钟后重置`,
            currentTokens,
            tokenLimit,
            resetAt: resetTime.toISOString(),
            remainingMinutes
          })
        }

        // 增加请求计数
        await dbClient.incr(requestCountKey)

        // 存储限流信息到请求对象
        req.rateLimitInfo = {
          windowStart,
          windowDuration,
          requestCountKey,
          tokenCountKey,
          currentRequests: currentRequests + 1,
          currentTokens,
          rateLimitRequests,
          tokenLimit
        }
      }
    }

    // 🔧 增强费用限制检查（向下兼容 + 多时间周期支持）
    const costCheckResult = await costLimitService.checkCostLimits(
      validation.keyData.id,
      validation.keyData
    )

    // 处理费用限制违规
    if (!costCheckResult.allowed) {
      const violationResponse = costLimitService.formatViolationResponse(costCheckResult.violations)

      logger.security(
        `💰 Cost limit exceeded for key: ${validation.keyData.id} (${validation.keyData.name}), violations: ${costCheckResult.violations.length}, check time: ${costCheckResult.checkDuration || 0}ms`
      )

      return res.status(429).json(violationResponse)
    }

    // 处理费用使用预警
    if (costCheckResult.warnings && costCheckResult.warnings.length > 0) {
      const formattedWarnings = costLimitService.formatWarnings(costCheckResult.warnings)

      logger.warn(
        `💰 Cost usage warning for key: ${validation.keyData.id} (${validation.keyData.name}), warnings: ${costCheckResult.warnings.length}`
      )

      // 将预警信息添加到请求对象，供后续中间件或路由使用
      req.costWarnings = formattedWarnings
    }

    // 记录费用限制检查通过（debug 级别，避免过多日志）
    if (costCheckResult.checkDuration > 50) {
      // 只在检查时间较长时记录，用于性能监控
      logger.debug(
        `💰 Cost limits check completed for key: ${validation.keyData.id} (${validation.keyData.name}), time: ${costCheckResult.checkDuration}ms`
      )
    }

    // 将验证信息添加到请求对象（只包含必要信息）
    req.apiKey = {
      id: validation.keyData.id,
      name: validation.keyData.name,
      tokenLimit: validation.keyData.tokenLimit,
      claudeAccountId: validation.keyData.claudeAccountId,
      claudeConsoleAccountId: validation.keyData.claudeConsoleAccountId, // 添加 Claude Console 账号ID
      geminiAccountId: validation.keyData.geminiAccountId,
      openaiAccountId: validation.keyData.openaiAccountId, // 添加 OpenAI 账号ID
      bedrockAccountId: validation.keyData.bedrockAccountId, // 添加 Bedrock 账号ID
      permissions: validation.keyData.permissions,
      concurrencyLimit: validation.keyData.concurrencyLimit,
      rateLimitWindow: validation.keyData.rateLimitWindow,
      rateLimitRequests: validation.keyData.rateLimitRequests,
      enableModelRestriction: validation.keyData.enableModelRestriction,
      restrictedModels: validation.keyData.restrictedModels,
      enableClientRestriction: validation.keyData.enableClientRestriction,
      allowedClients: validation.keyData.allowedClients,

      // 🔧 增强费用限制支持（向下兼容 + 扩展支持）
      dailyCostLimit: validation.keyData.dailyCostLimit, // 向下兼容
      dailyCost: validation.keyData.dailyCost, // 向下兼容

      // 扩展费用限制字段（可选）
      weeklyCostLimit: validation.keyData.weeklyCostLimit || 0,
      monthlyCostLimit: validation.keyData.monthlyCostLimit || 0,
      totalCostLimit: validation.keyData.totalCostLimit || 0,

      // 费用限制检查结果
      costLimits: costCheckResult.limits || {},
      currentCosts: costCheckResult.currentCosts || {},

      usage: validation.keyData.usage
    }
    req.usage = validation.keyData.usage

    const authDuration = Date.now() - startTime
    const userAgent = req.headers['user-agent'] || 'No User-Agent'
    logger.api(
      `🔓 Authenticated request from key: ${validation.keyData.name} (${validation.keyData.id}) in ${authDuration}ms`
    )
    logger.api(`   User-Agent: "${userAgent}"`)

    return next()
  } catch (error) {
    const authDuration = Date.now() - startTime
    logger.error(`❌ Authentication middleware error (${authDuration}ms):`, {
      error: error.message,
      stack: error.stack,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      url: req.originalUrl
    })

    return res.status(500).json({
      error: 'Authentication error',
      message: 'Internal server error during authentication'
    })
  }
}

// 🛡️ 管理员验证中间件（优化版）
const authenticateAdmin = async (req, res, next) => {
  const startTime = Date.now()

  try {
    // 安全提取token，支持多种方式
    const token =
      req.headers['authorization']?.replace(/^Bearer\s+/i, '') ||
      req.cookies?.adminToken ||
      req.headers['x-admin-token']

    if (!token) {
      logger.security(`🔒 Missing admin token attempt from ${req.ip || 'unknown'}`)
      return res.status(401).json({
        error: 'Missing admin token',
        message: 'Please provide an admin token'
      })
    }

    // 基本token格式验证
    if (typeof token !== 'string' || token.length < 32 || token.length > 512) {
      logger.security(`🔒 Invalid admin token format from ${req.ip || 'unknown'}`)
      return res.status(401).json({
        error: 'Invalid admin token format',
        message: 'Admin token format is invalid'
      })
    }

    // 获取管理员会话（带超时处理）
    const adminSession = await Promise.race([
      database.getSession(token),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Session lookup timeout')), 5000)
      )
    ])

    if (!adminSession || Object.keys(adminSession).length === 0) {
      logger.security(`🔒 Invalid admin token attempt from ${req.ip || 'unknown'}`)
      return res.status(401).json({
        error: 'Invalid admin token',
        message: 'Invalid or expired admin session'
      })
    }

    // 🎯 智能会话活跃性检查
    const now = new Date()
    const lastActivity = new Date(adminSession.lastActivity || adminSession.loginTime)
    const inactiveDuration = now - lastActivity
    const maxInactivity = 24 * 60 * 60 * 1000 // 24小时

    // 增加会话活跃度阈值检查
    const sessionAge = now - new Date(adminSession.loginTime)
    const isLongSession = sessionAge > 2 * 60 * 60 * 1000 // 超过2小时的长会话

    if (inactiveDuration > maxInactivity) {
      logger.security(
        `🔒 Expired admin session for ${adminSession.username} from ${req.ip || 'unknown'} (inactive: ${Math.floor(inactiveDuration / 60000)}min)`
      )
      await database.deleteSession(token) // 清理过期会话
      return res.status(401).json({
        error: 'Session expired',
        message: 'Admin session has expired due to inactivity'
      })
    }

    // 对于长期活跃会话给出警告（可能存在异常轮询）
    if (isLongSession && inactiveDuration < 60 * 1000) {
      logger.debug(
        `⚠️ Highly active long session detected: ${adminSession.username} (${Math.floor(sessionAge / 60000)}min old, last activity: ${Math.floor(inactiveDuration / 1000)}s ago)`
      )
    }

    // 🎯 智能会话更新：减少频繁更新，仅在必要时执行
    const timeSinceLastUpdate = inactiveDuration // 重用已计算的非活跃时长

    // 只在超过5分钟未更新时才更新会话（减少Redis写入压力）
    if (timeSinceLastUpdate > 5 * 60 * 1000) {
      database
        .setSession(
          token,
          {
            ...adminSession,
            lastActivity: now.toISOString()
          },
          86400
        )
        .catch((error) => {
          logger.debug('Failed to update admin session activity:', error.message)
        })
    }

    // 设置管理员信息（只包含必要信息）
    req.admin = {
      id: adminSession.adminId || 'admin',
      username: adminSession.username,
      sessionId: token,
      loginTime: adminSession.loginTime
    }

    const authDuration = Date.now() - startTime

    // 🎯 智能日志记录：减少频繁认证日志，仅在必要时记录
    if (timeSinceLastUpdate > 5 * 60 * 1000 || authDuration > 100) {
      // 只在会话更新或认证较慢时记录安全日志
      logger.security(`🔐 Admin authenticated: ${adminSession.username} in ${authDuration}ms`)
    } else {
      // 常规快速认证只记录debug级别
      logger.debug(`🔐 Admin auth (cached): ${adminSession.username} in ${authDuration}ms`)
    }

    return next()
  } catch (error) {
    const authDuration = Date.now() - startTime
    logger.error(`❌ Admin authentication error (${authDuration}ms):`, {
      error: error.message,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      url: req.originalUrl
    })

    return res.status(500).json({
      error: 'Authentication error',
      message: 'Internal server error during admin authentication'
    })
  }
}

// 🔐 用户会话认证中间件
const authenticateUserSession = async (req, res, next) => {
  const startTime = Date.now()

  try {
    // 提取会话令牌，支持多种方式
    const sessionToken = extractSessionToken(req)

    if (!sessionToken) {
      logger.security(`🔒 Missing session token attempt from ${req.ip || 'unknown'}`)
      return res.status(401).json({
        error: 'Missing session token',
        message: 'Please provide a valid session token'
      })
    }

    // 基本令牌格式验证
    if (
      typeof sessionToken !== 'string' ||
      sessionToken.length < 32 ||
      sessionToken.length > 1024
    ) {
      logger.security(`🔒 Invalid session token format from ${req.ip || 'unknown'}`)
      return res.status(401).json({
        error: 'Invalid session token format',
        message: 'Session token format is invalid'
      })
    }

    // 验证用户会话
    const sessionData = await userService.validateUserSession(sessionToken)

    if (!sessionData || !sessionData.valid) {
      const clientIP = req.ip || req.connection?.remoteAddress || 'unknown'
      logger.security(`🔒 Invalid user session attempt from ${clientIP}`)
      return res.status(401).json({
        error: 'Invalid session',
        message: 'Session expired or invalid'
      })
    }

    // 获取用户详细信息
    const userInfo = await userService.getUserById(sessionData.userId)
    if (!userInfo) {
      logger.security(`🔒 User not found for session: ${sessionData.userId}`)
      return res.status(401).json({
        error: 'User not found',
        message: 'Associated user account not found'
      })
    }

    // 设置用户上下文到请求对象
    req.user = {
      id: userInfo.id,
      username: userInfo.username,
      email: userInfo.email,
      fullName: userInfo.fullName,
      role: userInfo.role,
      status: userInfo.status,
      authMethod: userInfo.authMethod,
      groups: userInfo.groups || []
    }
    req.session = {
      sessionId: sessionData.sessionId,
      userId: sessionData.userId,
      token: sessionToken
    }

    const authDuration = Date.now() - startTime
    const userAgent = req.headers['user-agent'] || 'No User-Agent'

    logger.security(
      `🔐 User session authenticated: ${userInfo.username} (${userInfo.id}) in ${authDuration}ms`
    )
    logger.api(`   User-Agent: "${userAgent}"`)

    return next()
  } catch (error) {
    const authDuration = Date.now() - startTime
    logger.error(`❌ User session authentication error (${authDuration}ms):`, {
      error: error.message,
      stack: error.stack,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      url: req.originalUrl
    })

    return res.status(500).json({
      error: 'Authentication error',
      message: 'Internal server error during authentication'
    })
  }
}

// 🔄 智能双重认证模式（增强版，API Key优先，智能回退）
const authenticateDual = async (req, res, next) => {
  const startTime = Date.now()

  try {
    // 使用增强的认证类型检测
    const authInfo = detectAuthenticationType(req)

    logger.debug(
      `🔍 Smart authentication detection: ${authInfo.authType} (confidence: ${authInfo.confidence}%, sources: ${authInfo.detectedSources.join(', ')})`
    )

    // 优先使用API Key认证（最高优先级）
    if (authInfo.hasApiKey) {
      logger.debug(
        `🔑 Using API Key authentication (sources: ${authInfo.detectedSources.filter((s) => s.includes('key')).join(', ')})`
      )
      return authenticateApiKey(req, res, next)
    }

    // 回退到用户会话认证
    if (authInfo.hasSessionToken) {
      logger.debug(
        `🎫 Using User Session authentication (sources: ${authInfo.detectedSources.filter((s) => s.includes('session') || s.includes('bearer')).join(', ')})`
      )
      return authenticateUserSession(req, res, next)
    }

    // 管理员会话认证（如果没有其他认证方式）
    if (authInfo.hasAdminToken) {
      logger.debug(
        `👑 Using Admin Session authentication (sources: ${authInfo.detectedSources.filter((s) => s.includes('admin')).join(', ')})`
      )
      return authenticateAdmin(req, res, next)
    }

    // 没有提供任何认证方式
    logger.security(`🔒 No authentication provided from ${req.ip || 'unknown'}`)
    return res.status(401).json({
      error: 'Authentication required',
      message: 'Please provide API key, session token, or admin token',
      supportedMethods: [
        'API Key (x-api-key, x-goog-api-key, api-key headers, or Authorization Bearer cr_*)',
        'Session Token (Authorization Bearer, x-session-token header, or sessionToken cookie)',
        'Admin Token (x-admin-token header or adminToken cookie)'
      ],
      detectedSources: authInfo.detectedSources.length > 0 ? authInfo.detectedSources : undefined
    })
  } catch (error) {
    const authDuration = Date.now() - startTime
    logger.error(`❌ Smart dual authentication error (${authDuration}ms):`, {
      error: error.message,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      url: req.originalUrl
    })

    return res.status(500).json({
      error: 'Authentication error',
      message: 'Internal server error during authentication'
    })
  }
}

// 🔍 会话令牌提取工具函数
const extractSessionToken = (req) => {
  // 从Authorization header提取Bearer token（排除API Key格式）
  const authHeader = req.headers['authorization']
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.replace(/^Bearer\s+/i, '')
    // 确保不是API Key格式（cr_前缀）
    if (!token.startsWith('cr_')) {
      return token
    }
  }

  // 从专用session token header提取
  const sessionHeader = req.headers['x-session-token']
  if (sessionHeader) {
    return sessionHeader
  }

  // 从Cookie提取
  const cookieToken = req.cookies?.sessionToken
  if (cookieToken) {
    return cookieToken
  }

  // 从查询参数提取（开发调试使用，生产环境应禁用）
  if (process.env.NODE_ENV === 'development') {
    const queryToken = req.query.session_token
    if (queryToken) {
      return queryToken
    }
  }

  return null
}

// 🕵️ 智能认证类型检测工具函数（增强版）
const detectAuthenticationType = (req) => {
  const authInfo = {
    hasApiKey: false,
    hasSessionToken: false,
    hasAdminToken: false,
    authType: 'none',
    detectedSources: [],
    confidence: 0
  }

  // 检测API Key的多种来源
  const apiKeySources = [
    { name: 'x-api-key', value: req.headers['x-api-key'] },
    { name: 'x-goog-api-key', value: req.headers['x-goog-api-key'] },
    { name: 'api-key', value: req.headers['api-key'] },
    { name: 'query-key', value: req.query.key }
  ]

  // 特殊处理Authorization Bearer（需要区分API Key和Session Token）
  const authHeader = req.headers['authorization']
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.replace(/^Bearer\s+/i, '')

    if (token.startsWith('cr_')) {
      // Claude Relay API Key格式
      apiKeySources.push({ name: 'bearer-api-key', value: token })
    } else if (token.length >= 64 && token.match(/^[a-zA-Z0-9+/=._-]+$/)) {
      // JWT Session Token格式特征
      authInfo.hasSessionToken = true
      authInfo.detectedSources.push('authorization-bearer-jwt')
    } else {
      // 其他Bearer token格式
      authInfo.hasSessionToken = true
      authInfo.detectedSources.push('authorization-bearer-other')
    }
  }

  // 检查API Key来源
  for (const source of apiKeySources) {
    if (source.value && typeof source.value === 'string' && source.value.length > 8) {
      authInfo.hasApiKey = true
      authInfo.detectedSources.push(source.name)
    }
  }

  // 检测Session Token的其他来源
  const sessionSources = [
    { name: 'x-session-token', value: req.headers['x-session-token'] },
    { name: 'cookie-session', value: req.cookies?.sessionToken }
  ]

  // 开发环境支持查询参数
  if (process.env.NODE_ENV === 'development') {
    sessionSources.push({ name: 'query-session', value: req.query.session_token })
  }

  for (const source of sessionSources) {
    if (source.value && typeof source.value === 'string' && source.value.length > 16) {
      authInfo.hasSessionToken = true
      authInfo.detectedSources.push(source.name)
    }
  }

  // 检测管理员Token
  const adminSources = [
    { name: 'x-admin-token', value: req.headers['x-admin-token'] },
    { name: 'cookie-admin', value: req.cookies?.adminToken }
  ]

  for (const source of adminSources) {
    if (source.value && typeof source.value === 'string' && source.value.length > 32) {
      authInfo.hasAdminToken = true
      authInfo.detectedSources.push(source.name)
    }
  }

  // 确定主要认证类型和置信度
  if (authInfo.hasApiKey) {
    authInfo.authType = 'api_key'
    authInfo.confidence = authInfo.detectedSources.filter((s) => s.includes('key')).length * 30
  } else if (authInfo.hasAdminToken) {
    authInfo.authType = 'admin_session'
    authInfo.confidence = authInfo.detectedSources.filter((s) => s.includes('admin')).length * 40
  } else if (authInfo.hasSessionToken) {
    authInfo.authType = 'user_session'
    authInfo.confidence =
      authInfo.detectedSources.filter((s) => s.includes('session') || s.includes('bearer')).length *
      25
  }

  // 提高多源检测的置信度
  if (authInfo.detectedSources.length > 1) {
    authInfo.confidence += 10
  }

  return authInfo
}

// 🕵️ 认证类型检测工具函数（保持向后兼容）
const detectAuthType = (req) => {
  const enhanced = detectAuthenticationType(req)
  return {
    hasApiKey: enhanced.hasApiKey,
    hasSessionToken: enhanced.hasSessionToken,
    authType: enhanced.authType
  }
}

// 注意：使用统计现在直接在/api/v1/messages路由中处理，
// 以便从Claude API响应中提取真实的usage数据
// 动态配置支持：请求日志记录现在支持实时配置变更

// 🚦 CORS中间件（优化版）
const corsMiddleware = (req, res, next) => {
  const { origin } = req.headers

  // 允许的源（可以从配置文件读取）
  const allowedOrigins = [
    'http://localhost:3000',
    'https://localhost:3000',
    'http://127.0.0.1:3000',
    'https://127.0.0.1:3000'
  ]

  // 设置CORS头
  if (allowedOrigins.includes(origin) || !origin) {
    res.header('Access-Control-Allow-Origin', origin || '*')
  }

  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.header(
    'Access-Control-Allow-Headers',
    [
      'Origin',
      'X-Requested-With',
      'Content-Type',
      'Accept',
      'Authorization',
      'x-api-key',
      'x-goog-api-key',
      'api-key',
      'x-admin-token',
      'x-session-token'
    ].join(', ')
  )

  res.header('Access-Control-Expose-Headers', ['X-Request-ID', 'Content-Type'].join(', '))

  res.header('Access-Control-Max-Age', '86400') // 24小时预检缓存
  res.header('Access-Control-Allow-Credentials', 'true')

  if (req.method === 'OPTIONS') {
    res.status(204).end()
  } else {
    next()
  }
}

// 📝 请求日志中间件（集成高性能日志记录功能）
const requestLogger = (req, res, next) => {
  const start = Date.now()
  const requestId = Math.random().toString(36).substring(2, 15)

  // 添加请求ID到请求对象
  req.requestId = requestId
  res.setHeader('X-Request-ID', requestId)

  // 获取客户端信息
  const clientIP = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown'
  const userAgent = req.get('User-Agent') || 'unknown'
  const referer = req.get('Referer') || 'none'

  // 🎯 轻量级数据收集 - 创建日志上下文（< 0.1ms）
  req._logContext = {
    requestId,
    startTime: start,
    method: req.method,
    url: req.originalUrl,
    ip: clientIP,
    userAgent,
    referer
  }

  // 🎯 智能请求日志记录：减少频繁的管理界面请求日志
  const isHealthCheck = req.originalUrl === '/health'
  const isAdminAuth = req.originalUrl.includes('/admin/') || req.originalUrl.includes('/web/auth/')
  const isFrequentCall = isAdminAuth && req.method === 'GET'

  if (!isHealthCheck && !isFrequentCall) {
    logger.info(`▶️ [${requestId}] ${req.method} ${req.originalUrl} | IP: ${clientIP}`)
  } else if (isFrequentCall) {
    logger.debug(`▶️ [${requestId}] ${req.method} ${req.originalUrl} | IP: ${clientIP}`)
  }

  // 🚀 优化事件监听器 - 避免重复创建，使用单一监听器处理多种需求
  let eventHandled = false

  const handleRequestComplete = () => {
    if (eventHandled) {
      return
    }
    eventHandled = true

    const duration = Date.now() - start
    const contentLength = res.get('Content-Length') || '0'

    // 构建完整日志元数据
    const logMetadata = {
      requestId,
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration,
      contentLength,
      ip: clientIP,
      userAgent,
      referer
    }

    // 标准 Winston 日志记录（保持现有功能）
    if (res.statusCode >= 500) {
      logger.error(
        `◀️ [${requestId}] ${req.method} ${req.originalUrl} | ${res.statusCode} | ${duration}ms | ${contentLength}B`,
        logMetadata
      )
    } else if (res.statusCode >= 400) {
      logger.warn(
        `◀️ [${requestId}] ${req.method} ${req.originalUrl} | ${res.statusCode} | ${duration}ms | ${contentLength}B`,
        logMetadata
      )
    } else if (!isHealthCheck && !isFrequentCall) {
      // 只记录非健康检查和非频繁管理请求的成功响应
      logger.request(req.method, req.originalUrl, res.statusCode, duration, logMetadata)
    } else if (isFrequentCall && duration > 100) {
      // 频繁请求只在响应时间较长时记录
      logger.debug(
        `◀️ [${requestId}] ${req.method} ${req.originalUrl} | ${res.statusCode} | ${duration}ms (slow admin)`
      )
    }

    // API Key相关日志
    if (req.apiKey) {
      logger.api(
        `📱 [${requestId}] Request from ${req.apiKey.name} (${req.apiKey.id}) | ${duration}ms`
      )
    }

    // 用户会话相关日志
    if (req.user && req.session) {
      logger.api(
        `👤 [${requestId}] Request from user ${req.user.username} (${req.user.id}) | ${duration}ms`
      )
    }

    // 慢请求警告
    if (duration > 5000) {
      logger.warn(
        `🐌 [${requestId}] Slow request detected: ${duration}ms for ${req.method} ${req.originalUrl}`
      )
    }

    // 🚀 高性能日志记录集成 - 异步非阻塞处理（支持动态配置）
    if (isRequestLoggingEnabled() && req.apiKey) {
      // 使用 setImmediate 确保完全异步，零阻塞主请求流程
      setImmediate(async () => {
        try {
          // 确定请求类型用于智能采样
          let requestType = 'normal'
          if (res.statusCode >= 400) {
            requestType = 'error'
          } else if (duration >= 5000) {
            // 默认5秒为慢请求阈值
            requestType = 'slow'
          }

          // 🎯 关键修复：添加采样器决策检查
          logger.info(`🔍 REQUEST LOGGING STATUS CHECK - Using UnifiedLogService`)

          // 🔧 使用统一日志服务记录请求（中间件级别）
          try {
            const unifiedLogService = await unifiedLogServiceFactory.getSingleton()

            const logData = {
              // 从现有上下文复用数据
              requestId: req._logContext.requestId,
              method: req._logContext.method,
              path: req._logContext.url,
              statusCode: res.statusCode,
              responseTime: duration,
              userAgent: req._logContext.userAgent,
              ipAddress: req._logContext.ip,

              // API Key 信息
              keyId: req.apiKey.id,
              keyName: req.apiKey.name,

              // 请求类型（用于分析）
              requestType,

              // 可选的模型和token信息（如果存在）
              model: req.body?.model || '',
              tokens: req._tokenUsage?.total || 0,
              inputTokens: req._tokenUsage?.input || 0,
              outputTokens: req._tokenUsage?.output || 0,

              // 错误信息
              error: res.statusCode >= 400 ? `HTTP ${res.statusCode}` : null,

              // 请求和响应数据
              requestHeaders: req.headers,
              responseHeaders: res.getHeaders(),
              requestBody: req.body,
              timestamp: Date.now()
            }

            await unifiedLogService.logRequest(req.apiKey.id, logData)
            logger.debug(
              `📊 Request logged with UnifiedLogService: ${req.method} ${req.originalUrl} - ${duration}ms`
            )
          } catch (unifiedLogError) {
            logger.warn(
              `⚠️ UnifiedLogService middleware logging failed: ${unifiedLogError.message}`
            )
          }
        } catch (logError) {
          // 静默处理日志错误，不影响主请求流程
          logger.info('❌ High-performance logging error (non-critical):', logError.message)
        }
      })
    }
  }

  // 优化的事件监听 - 使用 once 避免重复处理
  res.once('finish', handleRequestComplete)
  res.once('close', handleRequestComplete)

  // 错误处理（独立监听器）
  res.on('error', (error) => {
    const duration = Date.now() - start
    logger.error(`💥 [${requestId}] Response error after ${duration}ms:`, error)
  })

  next()
}

// 🛡️ 安全中间件（增强版）
const securityMiddleware = (req, res, next) => {
  // 设置基础安全头
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-XSS-Protection', '1; mode=block')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')

  // 添加更多安全头
  res.setHeader('X-DNS-Prefetch-Control', 'off')
  res.setHeader('X-Download-Options', 'noopen')
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none')

  // Cross-Origin-Opener-Policy (仅对可信来源设置)
  const host = req.get('host') || ''
  const isLocalhost =
    host.includes('localhost') || host.includes('127.0.0.1') || host.includes('0.0.0.0')
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https'

  if (isLocalhost || isHttps) {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
    res.setHeader('Origin-Agent-Cluster', '?1')
  }

  // Content Security Policy (适用于web界面)
  if (req.path.startsWith('/web') || req.path === '/') {
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://cdn.tailwindcss.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://cdn.bootcdn.net",
        "style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdnjs.cloudflare.com https://cdn.bootcdn.net",
        "font-src 'self' https://cdnjs.cloudflare.com https://cdn.bootcdn.net",
        "img-src 'self' data:",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'"
      ].join('; ')
    )
  }

  // Strict Transport Security (HTTPS)
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains')
  }

  // 移除泄露服务器信息的头
  res.removeHeader('X-Powered-By')
  res.removeHeader('Server')

  // 防止信息泄露
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')

  next()
}

// 🚨 错误处理中间件（增强版）
const errorHandler = (error, req, res, _next) => {
  const requestId = req.requestId || 'unknown'
  const isDevelopment = process.env.NODE_ENV === 'development'

  // 记录详细错误信息
  logger.error(`💥 [${requestId}] Unhandled error:`, {
    error: error.message,
    stack: error.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip || 'unknown',
    userAgent: req.get('User-Agent') || 'unknown',
    apiKey: req.apiKey ? req.apiKey.id : 'none',
    admin: req.admin ? req.admin.username : 'none',
    user: req.user ? req.user.username : 'none',
    session: req.session ? req.session.sessionId : 'none'
  })

  // 确定HTTP状态码
  let statusCode = 500
  let errorMessage = 'Internal Server Error'
  let userMessage = 'Something went wrong'

  if (error.status && error.status >= 400 && error.status < 600) {
    statusCode = error.status
  }

  // 根据错误类型提供友好的错误消息
  switch (error.name) {
    case 'ValidationError':
      statusCode = 400
      errorMessage = 'Validation Error'
      userMessage = 'Invalid input data'
      break
    case 'CastError':
      statusCode = 400
      errorMessage = 'Cast Error'
      userMessage = 'Invalid data format'
      break
    case 'MongoError':
    case 'RedisError':
      statusCode = 503
      errorMessage = 'Database Error'
      userMessage = 'Database temporarily unavailable'
      break
    case 'TimeoutError':
      statusCode = 408
      errorMessage = 'Request Timeout'
      userMessage = 'Request took too long to process'
      break
    default:
      if (error.message && !isDevelopment) {
        // 在生产环境中，只显示安全的错误消息
        if (error.message.includes('ECONNREFUSED')) {
          userMessage = 'Service temporarily unavailable'
        } else if (error.message.includes('timeout')) {
          userMessage = 'Request timeout'
        }
      }
  }

  // 设置响应头
  res.setHeader('X-Request-ID', requestId)

  // 构建错误响应
  const errorResponse = {
    error: errorMessage,
    message: isDevelopment ? error.message : userMessage,
    requestId,
    timestamp: new Date().toISOString()
  }

  // 在开发环境中包含更多调试信息
  if (isDevelopment) {
    errorResponse.stack = error.stack
    errorResponse.url = req.originalUrl
    errorResponse.method = req.method
  }

  res.status(statusCode).json(errorResponse)
}

// 🌐 全局速率限制中间件（延迟初始化）
let rateLimiter = null

const getRateLimiter = () => {
  try {
    const client = database.getClient()
    if (!client) {
      logger.warn('⚠️ database client not available for rate limiter')
      // 重置 rateLimiter，下次重新初始化
      rateLimiter = null
      return null
    }

    // 检查现有 rateLimiter 的连接状态
    if (rateLimiter) {
      // 检查Redis连接状态，如果断开则重新初始化
      if (client.status !== 'ready') {
        logger.warn('⚠️ Redis connection not ready, reinitializing rate limiter')
        rateLimiter = null
      }
    }

    if (!rateLimiter) {
      rateLimiter = new RateLimiterRedis({
        storeClient: client,
        keyPrefix: 'global_rate_limit',
        points: 1000, // 请求数量
        duration: 900, // 15分钟 (900秒)
        blockDuration: 900 // 阻塞时间15分钟
      })

      logger.info('✅ Rate limiter initialized successfully')
    }
  } catch (error) {
    logger.warn('⚠️ Rate limiter initialization failed, using fallback', { error: error.message })
    rateLimiter = null
    return null
  }

  return rateLimiter
}

const globalRateLimit = async (req, res, next) => {
  // 跳过健康检查和内部请求
  if (req.path === '/health' || req.path === '/api/health') {
    return next()
  }

  const limiter = getRateLimiter()
  if (!limiter) {
    // 如果数据库不可用，直接跳过速率限制
    return next()
  }

  const clientIP = req.ip || req.connection?.remoteAddress || 'unknown'

  try {
    await limiter.consume(clientIP)
    return next()
  } catch (rejRes) {
    const remainingPoints = rejRes.remainingPoints || 0
    const msBeforeNext = rejRes.msBeforeNext || 900000

    logger.security(`🚦 Global rate limit exceeded for IP: ${clientIP}`)

    res.set({
      'Retry-After': Math.round(msBeforeNext / 1000) || 900,
      'X-RateLimit-Limit': 1000,
      'X-RateLimit-Remaining': remainingPoints,
      'X-RateLimit-Reset': new Date(Date.now() + msBeforeNext).toISOString()
    })

    return res.status(429).json({
      error: 'Too Many Requests',
      message: 'Too many requests from this IP, please try again later.',
      retryAfter: Math.round(msBeforeNext / 1000)
    })
  }
}

// 📊 请求大小限制中间件
const requestSizeLimit = (req, res, next) => {
  const maxSize = 10 * 1024 * 1024 // 10MB
  const contentLength = parseInt(req.headers['content-length'] || '0')

  if (contentLength > maxSize) {
    logger.security(`🚨 Request too large: ${contentLength} bytes from ${req.ip}`)
    return res.status(413).json({
      error: 'Payload Too Large',
      message: 'Request body size exceeds limit',
      limit: '10MB'
    })
  }

  return next()
}

// 🔧 可配置的增强认证中间件
const authenticateEnhanced = (options = {}) => {
  const authConfig = {
    // 认证模式配置
    requireApiKey: options.requireApiKey || false,
    requireUserSession: options.requireUserSession || false,
    requireAdminSession: options.requireAdminSession || false,
    allowFallback: options.allowFallback !== false, // 默认允许fallback

    // 组合认证配置
    requireBoth: options.requireBoth || false, // 同时需要API Key和Session
    strictMode: options.strictMode || false, // 严格模式，不允许任何fallback

    // 优先级配置
    priority: options.priority || ['api_key', 'admin_session', 'user_session'],

    // 错误处理配置
    customErrorHandler: options.customErrorHandler || null,
    includeDebugInfo: options.includeDebugInfo || false
  }

  return async (req, res, next) => {
    const startTime = Date.now()

    try {
      const authInfo = detectAuthenticationType(req)

      logger.debug(
        `🔧 Enhanced authentication: config=${JSON.stringify(authConfig)}, detected=${authInfo.authType}`
      )

      // 严格模式：只允许指定的认证类型
      if (authConfig.strictMode) {
        if (authConfig.requireApiKey && !authInfo.hasApiKey) {
          return handleAuthFailure('API Key required in strict mode', req, res, authConfig)
        }
        if (authConfig.requireUserSession && !authInfo.hasSessionToken) {
          return handleAuthFailure('User session required in strict mode', req, res, authConfig)
        }
        if (authConfig.requireAdminSession && !authInfo.hasAdminToken) {
          return handleAuthFailure('Admin session required in strict mode', req, res, authConfig)
        }
      }

      // 组合认证模式：同时需要多种认证
      if (authConfig.requireBoth) {
        const missingAuth = []
        if (authConfig.requireApiKey && !authInfo.hasApiKey) {
          missingAuth.push('API Key')
        }
        if (authConfig.requireUserSession && !authInfo.hasSessionToken) {
          missingAuth.push('User Session')
        }
        if (authConfig.requireAdminSession && !authInfo.hasAdminToken) {
          missingAuth.push('Admin Session')
        }

        if (missingAuth.length > 0) {
          return handleAuthFailure(
            `Missing required authentication: ${missingAuth.join(', ')}`,
            req,
            res,
            authConfig
          )
        }

        // 执行多重认证验证
        return executeMultipleAuth(req, res, next, authInfo, authConfig)
      }

      // 单一认证模式：按优先级选择
      for (const authType of authConfig.priority) {
        if (authType === 'api_key' && authInfo.hasApiKey) {
          logger.debug('🔑 Enhanced auth: Using API Key (priority match)')
          return authenticateApiKey(req, res, next)
        }
        if (authType === 'admin_session' && authInfo.hasAdminToken) {
          logger.debug('👑 Enhanced auth: Using Admin Session (priority match)')
          return authenticateAdmin(req, res, next)
        }
        if (authType === 'user_session' && authInfo.hasSessionToken) {
          logger.debug('🎫 Enhanced auth: Using User Session (priority match)')
          return authenticateUserSession(req, res, next)
        }
      }

      // 没有找到合适的认证方式
      return handleAuthFailure('No valid authentication found', req, res, authConfig)
    } catch (error) {
      const authDuration = Date.now() - startTime
      logger.error(`❌ Enhanced authentication error (${authDuration}ms):`, {
        error: error.message,
        config: authConfig,
        ip: req.ip,
        url: req.originalUrl
      })

      if (authConfig.customErrorHandler) {
        return authConfig.customErrorHandler(error, req, res, next)
      }

      return res.status(500).json({
        error: 'Authentication error',
        message: 'Internal server error during enhanced authentication'
      })
    }
  }
}

// 🎯 获取当前请求的认证上下文
const getAuthenticationContext = (req) => {
  const context = {
    authenticated: false,
    authType: 'none',
    user: null,
    admin: null,
    apiKey: null,
    session: null,
    permissions: [],
    metadata: {}
  }

  // API Key 认证上下文
  if (req.apiKey) {
    context.authenticated = true
    context.authType = 'api_key'
    context.apiKey = {
      id: req.apiKey.id,
      name: req.apiKey.name,
      permissions: req.apiKey.permissions || [],
      limits: {
        tokenLimit: req.apiKey.tokenLimit,
        concurrencyLimit: req.apiKey.concurrencyLimit,
        rateLimitWindow: req.apiKey.rateLimitWindow,
        rateLimitRequests: req.apiKey.rateLimitRequests
      }
    }
    context.permissions = req.apiKey.permissions || []
  }

  // 用户会话认证上下文
  if (req.user && req.session) {
    context.authenticated = true
    context.authType = context.authType === 'api_key' ? 'dual' : 'user_session'
    context.user = {
      id: req.user.id,
      username: req.user.username,
      email: req.user.email,
      fullName: req.user.fullName,
      role: req.user.role,
      status: req.user.status,
      groups: req.user.groups || []
    }
    context.session = {
      sessionId: req.session.sessionId,
      token: req.session.token
    }
    context.permissions = [...context.permissions, ...getUserPermissions(req.user)]
  }

  // 管理员会话认证上下文
  if (req.admin) {
    context.authenticated = true
    context.authType = context.authType !== 'none' ? 'multi_admin' : 'admin_session'
    context.admin = {
      id: req.admin.id,
      username: req.admin.username,
      sessionId: req.admin.sessionId,
      loginTime: req.admin.loginTime
    }
    context.permissions = [...context.permissions, 'admin:*'] // 管理员拥有所有权限
  }

  // 添加请求元数据
  context.metadata = {
    ip: req.ip || 'unknown',
    userAgent: req.get('User-Agent') || 'unknown',
    requestId: req.requestId || 'unknown',
    timestamp: new Date().toISOString()
  }

  return context
}

// 🔧 辅助函数：处理认证失败
const handleAuthFailure = (message, req, res, authConfig) => {
  logger.security(`🔒 Enhanced auth failure: ${message} from ${req.ip || 'unknown'}`)

  const response = {
    error: 'Authentication failed',
    message
  }

  if (authConfig.includeDebugInfo) {
    response.debugInfo = {
      detectedAuth: detectAuthenticationType(req),
      config: authConfig,
      timestamp: new Date().toISOString()
    }
  }

  return res.status(401).json(response)
}

// 🔧 辅助函数：执行多重认证
const executeMultipleAuth = async (req, res, next, authInfo, authConfig) => {
  const authResults = []

  // 依次执行各种认证
  if (authConfig.requireApiKey && authInfo.hasApiKey) {
    try {
      await new Promise((resolve, reject) => {
        authenticateApiKey(req, res, (error) => {
          if (error) {
            reject(error)
          } else {
            resolve()
          }
        })
      })
      authResults.push({ type: 'api_key', success: true })
    } catch (error) {
      authResults.push({ type: 'api_key', success: false, error: error.message })
    }
  }

  if (authConfig.requireUserSession && authInfo.hasSessionToken) {
    try {
      await new Promise((resolve, reject) => {
        authenticateUserSession(req, res, (error) => {
          if (error) {
            reject(error)
          } else {
            resolve()
          }
        })
      })
      authResults.push({ type: 'user_session', success: true })
    } catch (error) {
      authResults.push({ type: 'user_session', success: false, error: error.message })
    }
  }

  if (authConfig.requireAdminSession && authInfo.hasAdminToken) {
    try {
      await new Promise((resolve, reject) => {
        authenticateAdmin(req, res, (error) => {
          if (error) {
            reject(error)
          } else {
            resolve()
          }
        })
      })
      authResults.push({ type: 'admin_session', success: true })
    } catch (error) {
      authResults.push({ type: 'admin_session', success: false, error: error.message })
    }
  }

  // 检查所有必需的认证是否都成功
  const failedAuth = authResults.filter((r) => !r.success)
  if (failedAuth.length > 0) {
    return handleAuthFailure(
      `Multiple authentication failed: ${failedAuth.map((f) => f.type).join(', ')}`,
      req,
      res,
      authConfig
    )
  }

  logger.debug(
    `✅ Multiple authentication successful: ${authResults.map((r) => r.type).join(', ')}`
  )

  return next()
}

// 🔧 辅助函数：获取用户权限
const getUserPermissions = (user) => {
  const permissions = []

  // 基于角色的权限
  if (user.role) {
    switch (user.role) {
      case 'admin':
        permissions.push('user:read', 'user:write', 'user:delete', 'system:read')
        break
      case 'moderator':
        permissions.push('user:read', 'user:write', 'system:read')
        break
      case 'user':
        permissions.push('user:read')
        break
    }
  }

  // 基于组的权限
  if (user.groups && Array.isArray(user.groups)) {
    for (const group of user.groups) {
      switch (group) {
        case 'api_access':
          permissions.push('api:access')
          break
        case 'advanced_features':
          permissions.push('features:advanced')
          break
      }
    }
  }

  return [...new Set(permissions)] // 去重
}

module.exports = {
  // 现有的认证函数
  authenticateApiKey,
  authenticateAdmin,
  authenticateUserSession,
  authenticateDual,

  // 新增的智能认证函数
  detectAuthenticationType,
  authenticateEnhanced,
  getAuthenticationContext,

  // 兼容性函数
  extractSessionToken,
  detectAuthType,

  // 其他中间件
  corsMiddleware,
  requestLogger,
  securityMiddleware,
  errorHandler,
  globalRateLimit,
  requestSizeLimit
}
