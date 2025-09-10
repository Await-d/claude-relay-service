/**
 * @fileoverview 增强错误处理中间件 - 提供智能错误分类、用户友好消息转换和安全脱敏
 *
 * 核心功能：
 * - 智能错误分类和上下文收集
 * - 用户友好错误消息转换
 * - 敏感信息脱敏和安全过滤
 * - 错误率统计和监控集成
 * - 多语言错误消息支持
 * - 错误恢复建议生成
 *
 * @author Claude Code
 * @version 1.0.0
 */

const logger = require('../utils/logger')
const database = require('../models/database')
const config = require('../../config/config')

/**
 * 错误分类枚举
 */
const ErrorCategory = {
  AUTHENTICATION: 'authentication',
  AUTHORIZATION: 'authorization',
  VALIDATION: 'validation',
  NETWORK: 'network',
  DATABASE: 'database',
  API_LIMIT: 'api_limit',
  SERVER_ERROR: 'server_error',
  CLIENT_ERROR: 'client_error',
  UPSTREAM: 'upstream',
  CONFIGURATION: 'configuration',
  UNKNOWN: 'unknown'
}

/**
 * 错误严重程度
 */
const ErrorSeverity = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical'
}

/**
 * 用户友好错误消息映射
 */
const USER_FRIENDLY_MESSAGES = {
  // 认证和授权错误
  authentication: {
    en: 'Authentication failed. Please check your credentials.',
    zh: '身份验证失败，请检查您的凭据。',
    recovery: 'Verify your API key or login credentials and try again.'
  },
  authorization: {
    en: 'You do not have permission to perform this action.',
    zh: '您没有权限执行此操作。',
    recovery: 'Contact your administrator to request appropriate permissions.'
  },

  // 验证错误
  validation: {
    en: 'The provided data is invalid or incomplete.',
    zh: '提供的数据无效或不完整。',
    recovery: 'Please check your request format and required fields.'
  },

  // 网络错误
  network: {
    en: 'Network connection failed. Please try again later.',
    zh: '网络连接失败，请稍后再试。',
    recovery: 'Check your internet connection and retry the request.'
  },

  // 数据库错误
  database: {
    en: 'Database service is temporarily unavailable.',
    zh: '数据库服务暂时不可用。',
    recovery: 'This is a temporary issue. Please try again in a few minutes.'
  },

  // API限制错误
  api_limit: {
    en: 'You have exceeded the API usage limit.',
    zh: '您已超出API使用限制。',
    recovery: 'Wait for the limit to reset or upgrade your plan.'
  },

  // 服务器错误
  server_error: {
    en: 'An internal server error occurred.',
    zh: '发生内部服务器错误。',
    recovery: 'This is an internal issue. Please try again later or contact support.'
  },

  // 客户端错误
  client_error: {
    en: 'Invalid request format or parameters.',
    zh: '请求格式或参数无效。',
    recovery: 'Please check your request format and parameters.'
  },

  // 上游服务错误
  upstream: {
    en: 'External service is temporarily unavailable.',
    zh: '外部服务暂时不可用。',
    recovery: 'The external service is experiencing issues. Please try again later.'
  },

  // 配置错误
  configuration: {
    en: 'Service configuration error.',
    zh: '服务配置错误。',
    recovery: 'Please contact the administrator to resolve this configuration issue.'
  },

  // 未知错误
  unknown: {
    en: 'An unexpected error occurred.',
    zh: '发生了意外错误。',
    recovery: 'If this problem persists, please contact support.'
  }
}

/**
 * 敏感信息匹配模式
 */
const SENSITIVE_PATTERNS = [
  // API Keys 和 Tokens
  /\b[Aa]pi[_-]?[Kk]ey\b.*?[:\s=]+\s*([A-Za-z0-9+/=_-]{16,})/g,
  /\b[Tt]oken\b.*?[:\s=]+\s*([A-Za-z0-9+/=_.-]{16,})/g,
  /\bBearer\s+([A-Za-z0-9+/=_.-]{16,})/g,
  /\bcr_[A-Za-z0-9+/=_-]{16,}/g,

  // 密码和密钥
  /\b[Pp]assword\b.*?[:\s=]+\s*([^\s"']{6,})/g,
  /\b[Ss]ecret\b.*?[:\s=]+\s*([A-Za-z0-9+/=_-]{16,})/g,
  /\b[Kk]ey\b.*?[:\s=]+\s*([A-Za-z0-9+/=_-]{16,})/g,

  // 数据库连接字符串
  /mongodb:\/\/[^\/\s]+\/[^\s]*/g,
  /redis:\/\/[^\/\s]+\/[^\s]*/g,
  /postgres:\/\/[^\/\s]+\/[^\s]*/g,
  /mysql:\/\/[^\/\s]+\/[^\s]*/g,

  // 邮箱和个人信息
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, // 信用卡号格式

  // IP地址和端口
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d{1,5}\b/g,

  // 文件路径
  /[A-Za-z]:\\[^<>:"|*?\n\r\t]*|\/[^<>:"|*?\n\r\t]*/g
]

/**
 * 增强错误处理器类
 */
class EnhancedErrorHandler {
  constructor(options = {}) {
    this.options = {
      enableSanitization: options.enableSanitization !== false,
      enableStatistics: options.enableStatistics !== false,
      defaultLanguage: options.defaultLanguage || 'en',
      includeStackTrace: options.includeStackTrace || process.env.NODE_ENV === 'development',
      logSensitiveData: options.logSensitiveData || false,
      enableRecoveryHints: options.enableRecoveryHints !== false,
      maxErrorMessageLength: options.maxErrorMessageLength || 500,
      statisticsWindow: options.statisticsWindow || 300000, // 5分钟
      ...options
    }

    // 错误统计
    this.errorStats = {
      total: 0,
      categories: new Map(),
      recentErrors: new Map(), // 时间窗口内的错误
      criticalErrors: []
    }

    // 启动统计清理定时器
    this.startStatsCleanup()

    logger.info('🛡️ Enhanced error handler initialized:', {
      enableSanitization: this.options.enableSanitization,
      enableStatistics: this.options.enableStatistics,
      defaultLanguage: this.options.defaultLanguage
    })
  }

  /**
   * Express错误处理中间件
   */
  middleware() {
    return (error, req, res, next) => {
      this.handleError(error, req, res, next)
    }
  }

  /**
   * 主要错误处理逻辑
   * @param {Error} error - 错误对象
   * @param {Object} req - Express请求对象
   * @param {Object} res - Express响应对象
   * @param {Function} next - Express next函数
   */
  async handleError(error, req, res, next) {
    const startTime = Date.now()
    const requestId = req.requestId || this.generateId()

    try {
      // 1. 错误分析和分类
      const errorAnalysis = this.analyzeError(error, req)

      // 2. 收集错误上下文
      const context = this.collectErrorContext(error, req, requestId)

      // 3. 记录错误日志（安全脱敏后）
      await this.logError(errorAnalysis, context)

      // 4. 更新错误统计
      if (this.options.enableStatistics) {
        this.updateErrorStatistics(errorAnalysis, context)
      }

      // 5. 生成用户响应
      const userResponse = this.generateUserResponse(errorAnalysis, context)

      // 6. 设置响应头
      this.setResponseHeaders(res, requestId, errorAnalysis)

      // 7. 发送响应
      res.status(errorAnalysis.statusCode).json(userResponse)

      const processingTime = Date.now() - startTime
      logger.debug(`🛡️ Error handled in ${processingTime}ms for request ${requestId}`)
    } catch (handlingError) {
      logger.error('💥 Error handler itself failed:', handlingError)

      // 回退到基本错误响应
      this.sendFallbackResponse(res, requestId)
    }
  }

  /**
   * 分析和分类错误
   * @param {Error} error - 错误对象
   * @param {Object} req - 请求对象
   * @returns {Object} 错误分析结果
   */
  analyzeError(error, req) {
    const analysis = {
      originalError: error,
      category: this.categorizeError(error),
      severity: this.determineSeverity(error),
      statusCode: this.determineStatusCode(error),
      isRetryable: this.isRetryableError(error),
      isTransient: this.isTransientError(error),
      source: this.determineErrorSource(error, req),
      timestamp: Date.now()
    }

    // 添加特定错误的额外信息
    this.enrichErrorAnalysis(analysis, error, req)

    return analysis
  }

  /**
   * 错误分类
   * @param {Error} error - 错误对象
   * @returns {string} 错误分类
   */
  categorizeError(error) {
    const message = (error.message || '').toLowerCase()
    const name = (error.name || '').toLowerCase()
    const code = error.code || error.statusCode || 0

    // HTTP状态码分类
    if (code === 401 || message.includes('unauthorized') || message.includes('authentication')) {
      return ErrorCategory.AUTHENTICATION
    }
    if (code === 403 || message.includes('forbidden') || message.includes('permission')) {
      return ErrorCategory.AUTHORIZATION
    }
    if (code === 400 || name.includes('validation') || message.includes('invalid')) {
      return ErrorCategory.VALIDATION
    }
    if (code === 429 || message.includes('rate limit') || message.includes('too many')) {
      return ErrorCategory.API_LIMIT
    }
    if (code >= 500 && code < 600) {
      return ErrorCategory.SERVER_ERROR
    }
    if (code >= 400 && code < 500) {
      return ErrorCategory.CLIENT_ERROR
    }

    // 网络和连接错误
    if (
      message.includes('econnreset') ||
      message.includes('econnrefused') ||
      message.includes('timeout') ||
      message.includes('network')
    ) {
      return ErrorCategory.NETWORK
    }

    // 数据库错误
    if (
      name.includes('mongo') ||
      name.includes('redis') ||
      name.includes('database') ||
      (message.includes('connection') && message.includes('database'))
    ) {
      return ErrorCategory.DATABASE
    }

    // 上游服务错误
    if (
      message.includes('upstream') ||
      message.includes('claude api') ||
      message.includes('anthropic') ||
      error.isUpstreamError
    ) {
      return ErrorCategory.UPSTREAM
    }

    // 配置错误
    if (
      message.includes('config') ||
      message.includes('environment') ||
      (message.includes('missing') && message.includes('variable'))
    ) {
      return ErrorCategory.CONFIGURATION
    }

    return ErrorCategory.UNKNOWN
  }

  /**
   * 确定错误严重程度
   * @param {Error} error - 错误对象
   * @returns {string} 错误严重程度
   */
  determineSeverity(error) {
    const code = error.code || error.statusCode || 0
    const message = (error.message || '').toLowerCase()

    // 关键错误
    if (
      code >= 500 ||
      message.includes('critical') ||
      message.includes('fatal') ||
      (message.includes('database') && message.includes('down'))
    ) {
      return ErrorSeverity.CRITICAL
    }

    // 高严重性错误
    if (
      code === 401 ||
      code === 403 ||
      message.includes('security') ||
      message.includes('authentication') ||
      message.includes('authorization')
    ) {
      return ErrorSeverity.HIGH
    }

    // 中等严重性错误
    if (
      code === 429 ||
      code === 404 ||
      message.includes('rate limit') ||
      message.includes('not found') ||
      message.includes('timeout')
    ) {
      return ErrorSeverity.MEDIUM
    }

    // 低严重性错误
    return ErrorSeverity.LOW
  }

  /**
   * 确定HTTP状态码
   * @param {Error} error - 错误对象
   * @returns {number} HTTP状态码
   */
  determineStatusCode(error) {
    // 优先使用明确设置的状态码
    if (error.statusCode && error.statusCode >= 100 && error.statusCode < 600) {
      return error.statusCode
    }
    if (error.status && error.status >= 100 && error.status < 600) {
      return error.status
    }

    const message = (error.message || '').toLowerCase()

    // 根据错误消息推断状态码
    if (message.includes('unauthorized') || message.includes('invalid token')) {
      return 401
    }
    if (message.includes('forbidden') || message.includes('permission')) {
      return 403
    }
    if (message.includes('not found')) {
      return 404
    }
    if (message.includes('rate limit') || message.includes('too many')) {
      return 429
    }
    if (message.includes('validation') || message.includes('invalid')) {
      return 400
    }
    if (message.includes('timeout')) {
      return 408
    }
    if (message.includes('service unavailable') || message.includes('database')) {
      return 503
    }

    // 默认服务器内部错误
    return 500
  }

  /**
   * 判断错误是否可重试
   * @param {Error} error - 错误对象
   * @returns {boolean} 是否可重试
   */
  isRetryableError(error) {
    const code = error.statusCode || error.status || 0
    const message = (error.message || '').toLowerCase()

    // 不可重试的错误
    const nonRetryableCodes = [400, 401, 403, 404, 422]
    if (nonRetryableCodes.includes(code)) {
      return false
    }

    if (
      message.includes('validation') ||
      message.includes('invalid') ||
      message.includes('malformed') ||
      message.includes('bad request')
    ) {
      return false
    }

    // 可重试的错误
    const retryableCodes = [429, 500, 502, 503, 504]
    if (retryableCodes.includes(code)) {
      return true
    }

    if (
      message.includes('timeout') ||
      message.includes('connection') ||
      message.includes('network') ||
      message.includes('temporary')
    ) {
      return true
    }

    return false
  }

  /**
   * 判断错误是否为暂时性错误
   * @param {Error} error - 错误对象
   * @returns {boolean} 是否为暂时性错误
   */
  isTransientError(error) {
    const code = error.statusCode || error.status || 0
    const message = (error.message || '').toLowerCase()

    const transientIndicators = [
      'timeout',
      'temporary',
      'rate limit',
      'service unavailable',
      'connection',
      'network',
      'busy',
      'overload'
    ]

    return (
      code >= 500 ||
      code === 429 ||
      transientIndicators.some((indicator) => message.includes(indicator))
    )
  }

  /**
   * 确定错误来源
   * @param {Error} error - 错误对象
   * @param {Object} req - 请求对象
   * @returns {string} 错误来源
   */
  determineErrorSource(error, req) {
    if (error.isUpstreamError || error.source === 'upstream') {
      return 'upstream'
    }

    if (
      error.source === 'database' ||
      error.name?.toLowerCase().includes('mongo') ||
      error.name?.toLowerCase().includes('redis')
    ) {
      return 'database'
    }

    if (req.path?.includes('/admin')) {
      return 'admin_api'
    }

    if (req.path?.includes('/api')) {
      return 'client_api'
    }

    return 'application'
  }

  /**
   * 丰富错误分析信息
   * @param {Object} analysis - 错误分析对象
   * @param {Error} error - 错误对象
   * @param {Object} req - 请求对象
   */
  enrichErrorAnalysis(analysis, error, req) {
    // 添加重试上下文（如果存在）
    if (error.retryContext) {
      analysis.retryInfo = {
        attempts: error.retryContext.attempts,
        duration: error.retryContext.duration,
        finalErrorType: error.retryContext.finalErrorType
      }
    }

    // 添加API Key上下文
    if (req.apiKey) {
      analysis.apiContext = {
        keyId: req.apiKey.id,
        keyName: req.apiKey.name
      }
    }

    // 添加用户上下文
    if (req.user) {
      analysis.userContext = {
        userId: req.user.id,
        username: req.user.username
      }
    }

    // 添加管理员上下文
    if (req.admin) {
      analysis.adminContext = {
        adminId: req.admin.id,
        username: req.admin.username
      }
    }
  }

  /**
   * 收集错误上下文信息
   * @param {Error} error - 错误对象
   * @param {Object} req - 请求对象
   * @param {string} requestId - 请求ID
   * @returns {Object} 错误上下文
   */
  collectErrorContext(error, req, requestId) {
    const context = {
      requestId,
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.originalUrl,
      userAgent: req.get('User-Agent'),
      ip: req.ip || req.connection?.remoteAddress,

      // 请求头（过滤敏感信息）
      headers: this.sanitizeHeaders(req.headers),

      // 查询参数（过滤敏感信息）
      query: this.sanitizeObject(req.query),

      // 请求体大小
      contentLength: req.get('Content-Length') || 0,

      // 错误堆栈（如果允许）
      stack: this.options.includeStackTrace ? error.stack : undefined
    }

    // 添加认证上下文
    if (req.apiKey) {
      context.authentication = {
        type: 'api_key',
        keyId: req.apiKey.id,
        keyName: req.apiKey.name
      }
    } else if (req.user) {
      context.authentication = {
        type: 'user_session',
        userId: req.user.id,
        username: req.user.username
      }
    } else if (req.admin) {
      context.authentication = {
        type: 'admin_session',
        adminId: req.admin.id,
        username: req.admin.username
      }
    }

    return context
  }

  /**
   * 记录错误日志
   * @param {Object} analysis - 错误分析
   * @param {Object} context - 错误上下文
   */
  async logError(analysis, context) {
    const logLevel = this.getLogLevel(analysis.severity)
    const errorMessage = this.sanitizeMessage(analysis.originalError.message)

    const logData = {
      category: analysis.category,
      severity: analysis.severity,
      statusCode: analysis.statusCode,
      retryable: analysis.isRetryable,
      transient: analysis.isTransient,
      source: analysis.source,
      context: this.options.logSensitiveData ? context : this.sanitizeObject(context)
    }

    // 根据严重程度使用不同的日志级别
    switch (logLevel) {
      case 'error':
        logger.error(`💥 [${context.requestId}] ${errorMessage}`, logData)
        break
      case 'warn':
        logger.warn(`⚠️ [${context.requestId}] ${errorMessage}`, logData)
        break
      case 'info':
        logger.info(`ℹ️ [${context.requestId}] ${errorMessage}`, logData)
        break
      default:
        logger.debug(`🐛 [${context.requestId}] ${errorMessage}`, logData)
    }

    // 关键错误需要特殊处理
    if (analysis.severity === ErrorSeverity.CRITICAL) {
      logger.security(`🚨 CRITICAL ERROR: ${errorMessage}`, {
        ...logData,
        alertRequired: true
      })

      // 存储关键错误供后续分析
      this.errorStats.criticalErrors.push({
        timestamp: Date.now(),
        error: errorMessage,
        context: context.requestId
      })

      // 保持最近100个关键错误
      if (this.errorStats.criticalErrors.length > 100) {
        this.errorStats.criticalErrors.shift()
      }
    }
  }

  /**
   * 生成用户响应
   * @param {Object} analysis - 错误分析
   * @param {Object} context - 错误上下文
   * @returns {Object} 用户响应对象
   */
  generateUserResponse(analysis, context) {
    const friendlyMessage = this.getFriendlyMessage(analysis.category, context)

    const response = {
      error: this.getErrorTitle(analysis.category),
      message: friendlyMessage.message,
      requestId: context.requestId,
      timestamp: context.timestamp
    }

    // 添加恢复建议
    if (this.options.enableRecoveryHints && friendlyMessage.recovery) {
      response.suggestion = friendlyMessage.recovery
    }

    // 添加重试信息
    if (analysis.isRetryable) {
      response.retryable = true
      if (analysis.isTransient) {
        response.retryAfter = this.calculateRetryAfter(analysis)
      }
    }

    // 添加开发模式调试信息
    if (this.options.includeStackTrace && process.env.NODE_ENV === 'development') {
      response.debug = {
        category: analysis.category,
        severity: analysis.severity,
        source: analysis.source,
        originalMessage: this.sanitizeMessage(analysis.originalError.message)
      }

      if (analysis.retryInfo) {
        response.debug.retryInfo = analysis.retryInfo
      }
    }

    return response
  }

  /**
   * 获取友好错误消息
   * @param {string} category - 错误分类
   * @param {Object} context - 错误上下文
   * @returns {Object} 友好消息对象
   */
  getFriendlyMessage(category, context) {
    const language = this.detectLanguage(context)
    const messageConfig = USER_FRIENDLY_MESSAGES[category] || USER_FRIENDLY_MESSAGES.unknown

    return {
      message: messageConfig[language] || messageConfig.en,
      recovery: messageConfig.recovery
    }
  }

  /**
   * 检测用户语言偏好
   * @param {Object} context - 错误上下文
   * @returns {string} 语言代码
   */
  detectLanguage(context) {
    // 从Accept-Language头检测
    const acceptLanguage = context.headers?.['accept-language']
    if (acceptLanguage) {
      if (acceptLanguage.includes('zh')) {
        return 'zh'
      }
    }

    return this.options.defaultLanguage
  }

  /**
   * 获取错误标题
   * @param {string} category - 错误分类
   * @returns {string} 错误标题
   */
  getErrorTitle(category) {
    const titles = {
      [ErrorCategory.AUTHENTICATION]: 'Authentication Failed',
      [ErrorCategory.AUTHORIZATION]: 'Access Denied',
      [ErrorCategory.VALIDATION]: 'Validation Error',
      [ErrorCategory.NETWORK]: 'Network Error',
      [ErrorCategory.DATABASE]: 'Service Unavailable',
      [ErrorCategory.API_LIMIT]: 'Rate Limit Exceeded',
      [ErrorCategory.SERVER_ERROR]: 'Internal Server Error',
      [ErrorCategory.CLIENT_ERROR]: 'Bad Request',
      [ErrorCategory.UPSTREAM]: 'Service Unavailable',
      [ErrorCategory.CONFIGURATION]: 'Configuration Error'
    }

    return titles[category] || 'Unknown Error'
  }

  /**
   * 计算重试延迟时间
   * @param {Object} analysis - 错误分析
   * @returns {number} 延迟秒数
   */
  calculateRetryAfter(analysis) {
    if (analysis.category === ErrorCategory.API_LIMIT) {
      return 60 // API限流等待1分钟
    }
    if (analysis.category === ErrorCategory.NETWORK) {
      return 30 // 网络错误等待30秒
    }
    if (analysis.severity === ErrorSeverity.CRITICAL) {
      return 300 // 关键错误等待5分钟
    }

    return 10 // 默认等待10秒
  }

  /**
   * 设置响应头
   * @param {Object} res - 响应对象
   * @param {string} requestId - 请求ID
   * @param {Object} analysis - 错误分析
   */
  setResponseHeaders(res, requestId, analysis) {
    res.setHeader('X-Request-ID', requestId)
    res.setHeader('X-Error-Category', analysis.category)

    if (analysis.isRetryable) {
      res.setHeader('X-Retryable', 'true')
      if (analysis.isTransient) {
        const retryAfter = this.calculateRetryAfter(analysis)
        res.setHeader('Retry-After', retryAfter)
      }
    }

    // 安全头
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
  }

  /**
   * 更新错误统计
   * @param {Object} analysis - 错误分析
   * @param {Object} context - 错误上下文
   */
  updateErrorStatistics(analysis, context) {
    const now = Date.now()
    this.errorStats.total++

    // 按分类统计
    const categoryStats = this.errorStats.categories.get(analysis.category) || {
      count: 0,
      severity: new Map(),
      sources: new Map(),
      lastOccurrence: 0
    }

    categoryStats.count++
    categoryStats.lastOccurrence = now

    // 按严重程度统计
    const severityCount = categoryStats.severity.get(analysis.severity) || 0
    categoryStats.severity.set(analysis.severity, severityCount + 1)

    // 按来源统计
    const sourceCount = categoryStats.sources.get(analysis.source) || 0
    categoryStats.sources.set(analysis.source, sourceCount + 1)

    this.errorStats.categories.set(analysis.category, categoryStats)

    // 时间窗口统计
    const windowKey = Math.floor(now / this.options.statisticsWindow)
    const windowStats = this.errorStats.recentErrors.get(windowKey) || {
      timestamp: now,
      count: 0,
      categories: new Map()
    }

    windowStats.count++
    const windowCategoryCount = windowStats.categories.get(analysis.category) || 0
    windowStats.categories.set(analysis.category, windowCategoryCount + 1)

    this.errorStats.recentErrors.set(windowKey, windowStats)
  }

  /**
   * 敏感信息脱敏
   * @param {string} message - 原始消息
   * @returns {string} 脱敏后的消息
   */
  sanitizeMessage(message) {
    if (!this.options.enableSanitization || !message) {
      return message
    }

    let sanitized = message

    // 应用敏感信息匹配模式
    SENSITIVE_PATTERNS.forEach((pattern) => {
      sanitized = sanitized.replace(pattern, (match, capture) => {
        if (capture) {
          const maskedCapture =
            capture.length > 8
              ? `${capture.substring(0, 4)}***${capture.substring(capture.length - 4)}`
              : '***'
          return match.replace(capture, maskedCapture)
        }
        return '[REDACTED]'
      })
    })

    // 限制消息长度
    if (sanitized.length > this.options.maxErrorMessageLength) {
      sanitized = `${sanitized.substring(0, this.options.maxErrorMessageLength - 3)}...`
    }

    return sanitized
  }

  /**
   * 对象敏感信息脱敏
   * @param {Object} obj - 原始对象
   * @returns {Object} 脱敏后的对象
   */
  sanitizeObject(obj) {
    if (!this.options.enableSanitization || !obj || typeof obj !== 'object') {
      return obj
    }

    const sensitiveKeys = [
      'password',
      'token',
      'secret',
      'key',
      'authorization',
      'cookie',
      'x-api-key',
      'x-auth-token',
      'apikey',
      'api_key'
    ]

    const sanitized = {}

    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase()

      if (sensitiveKeys.some((sensitive) => lowerKey.includes(sensitive))) {
        sanitized[key] = '[REDACTED]'
      } else if (typeof value === 'string') {
        sanitized[key] = this.sanitizeMessage(value)
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitizeObject(value)
      } else {
        sanitized[key] = value
      }
    }

    return sanitized
  }

  /**
   * Header敏感信息脱敏
   * @param {Object} headers - 原始headers
   * @returns {Object} 脱敏后的headers
   */
  sanitizeHeaders(headers) {
    if (!headers) {
      return {}
    }

    const sanitizedHeaders = {}
    const sensitiveHeaders = [
      'authorization',
      'cookie',
      'x-api-key',
      'x-auth-token',
      'x-admin-token',
      'x-session-token',
      'api-key'
    ]

    for (const [key, value] of Object.entries(headers)) {
      const lowerKey = key.toLowerCase()

      if (sensitiveHeaders.includes(lowerKey)) {
        sanitizedHeaders[key] = '[REDACTED]'
      } else {
        sanitizedHeaders[key] = value
      }
    }

    return sanitizedHeaders
  }

  /**
   * 获取日志级别
   * @param {string} severity - 错误严重程度
   * @returns {string} 日志级别
   */
  getLogLevel(severity) {
    const levels = {
      [ErrorSeverity.CRITICAL]: 'error',
      [ErrorSeverity.HIGH]: 'error',
      [ErrorSeverity.MEDIUM]: 'warn',
      [ErrorSeverity.LOW]: 'info'
    }

    return levels[severity] || 'debug'
  }

  /**
   * 发送回退响应
   * @param {Object} res - 响应对象
   * @param {string} requestId - 请求ID
   */
  sendFallbackResponse(res, requestId) {
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'An unexpected error occurred while processing your request.',
      requestId,
      timestamp: new Date().toISOString()
    })
  }

  /**
   * 生成唯一ID
   * @returns {string} 唯一ID
   */
  generateId() {
    return `err_${Date.now()}_${Math.random().toString(36).substring(2)}`
  }

  /**
   * 启动统计清理定时器
   */
  startStatsCleanup() {
    // 每小时清理过期的时间窗口统计
    setInterval(
      () => {
        const now = Date.now()
        const expiredThreshold = now - this.options.statisticsWindow * 12 // 保留12个时间窗口

        for (const [windowKey, stats] of this.errorStats.recentErrors.entries()) {
          if (stats.timestamp < expiredThreshold) {
            this.errorStats.recentErrors.delete(windowKey)
          }
        }
      },
      60 * 60 * 1000
    ) // 1小时
  }

  /**
   * 获取错误统计信息
   * @returns {Object} 统计信息
   */
  getStatistics() {
    const stats = {
      total: this.errorStats.total,
      categories: {},
      recentWindows: [],
      criticalErrorsCount: this.errorStats.criticalErrors.length
    }

    // 转换分类统计
    for (const [category, categoryStats] of this.errorStats.categories.entries()) {
      stats.categories[category] = {
        count: categoryStats.count,
        severity: Object.fromEntries(categoryStats.severity),
        sources: Object.fromEntries(categoryStats.sources),
        lastOccurrence: new Date(categoryStats.lastOccurrence).toISOString()
      }
    }

    // 转换时间窗口统计
    const recentWindows = Array.from(this.errorStats.recentErrors.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 10) // 最近10个时间窗口

    stats.recentWindows = recentWindows.map((window) => ({
      timestamp: new Date(window.timestamp).toISOString(),
      count: window.count,
      categories: Object.fromEntries(window.categories)
    }))

    return stats
  }

  /**
   * 重置统计信息
   */
  resetStatistics() {
    this.errorStats = {
      total: 0,
      categories: new Map(),
      recentErrors: new Map(),
      criticalErrors: []
    }

    logger.info('📊 Error statistics reset')
  }

  /**
   * 健康检查
   * @returns {Object} 健康状态
   */
  healthCheck() {
    const now = Date.now()
    const recentWindow = now - this.options.statisticsWindow

    let recentErrorCount = 0
    for (const stats of this.errorStats.recentErrors.values()) {
      if (stats.timestamp > recentWindow) {
        recentErrorCount += stats.count
      }
    }

    const criticalErrorsRecent = this.errorStats.criticalErrors.filter(
      (error) => error.timestamp > recentWindow
    ).length

    const errorRate = recentErrorCount / (this.options.statisticsWindow / 1000) // 每秒错误数
    const isHealthy = errorRate < 1 && criticalErrorsRecent === 0 // 每秒少于1个错误且无关键错误

    return {
      healthy: isHealthy,
      errorRate: Math.round(errorRate * 100) / 100,
      recentErrors: recentErrorCount,
      criticalErrors: criticalErrorsRecent,
      totalErrors: this.errorStats.total,
      timestamp: new Date().toISOString()
    }
  }
}

// 导出错误处理器和相关常量
module.exports = {
  EnhancedErrorHandler,
  ErrorCategory,
  ErrorSeverity,
  USER_FRIENDLY_MESSAGES
}
