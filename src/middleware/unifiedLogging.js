/**
 * @fileoverview 统一日志中间件 - 基于UnifiedLogService的集成中间件
 *
 * 这个中间件将现有的分散日志调用统一到UnifiedLogService架构中
 * 提供无侵入式的增强日志记录，支持Headers过滤、Token详情和费用计算
 *
 * 核心特性：
 * - 统一的日志记录入口点
 * - 依赖注入架构，遵循SOLID原则
 * - 向后兼容现有的API调用模式
 * - 智能去重，避免重复记录
 * - 异步处理，不阻塞主业务流程
 * - 降级处理，确保系统稳定性
 *
 * @author Claude Code
 * @version 1.0.0 - UnifiedLogService集成版本
 */

const logger = require('../utils/logger')
const costCalculator = require('../utils/costCalculator')

/**
 * 统一日志中间件类
 *
 * 将UnifiedLogService集成到Express中间件体系中
 * 提供标准化的日志记录接口和流程控制
 */
class UnifiedLogMiddleware {
  constructor(options = {}) {
    /** @type {Object} 中间件配置选项 */
    this.options = {
      enableHeadersCapture: options.enableHeadersCapture !== false,
      enableTokenDetails: options.enableTokenDetails !== false,
      enableCostDetails: options.enableCostDetails !== false,
      enableAsync: options.enableAsync !== false,
      samplingRate: options.samplingRate || 1.0, // 100% 采样率
      requestTrackingEnabled: options.requestTrackingEnabled !== false,
      ...options
    }

    /** @type {UnifiedLogService|null} */
    this.unifiedLogService = null

    /** @type {Set<string>} 用于追踪已记录的请求，避免重复 */
    this.loggedRequests = new Set()

    /** @type {Map<string, Object>} 存储待完成的日志上下文 */
    this.pendingLogs = new Map()

    // 统计信息
    this.stats = {
      totalRequests: 0,
      loggedRequests: 0,
      skippedRequests: 0,
      errorCount: 0,
      lastResetTime: Date.now()
    }

    this._initializeService()
    this._setupCleanupInterval()

    logger.info('🔧 UnifiedLogMiddleware initialized')
  }

  /**
   * 异步初始化UnifiedLogService
   * @private
   */
  async _initializeService() {
    try {
      // 优先使用新的UnifiedLogServiceFactory
      const { unifiedLogServiceFactory } = require('../services/UnifiedLogServiceFactory')
      this.unifiedLogService = await unifiedLogServiceFactory.getSingleton()
      logger.info('✅ UnifiedLogMiddleware: UnifiedLogService initialized successfully')
    } catch (error) {
      logger.warn(
        '⚠️ UnifiedLogMiddleware: Failed to initialize UnifiedLogService, using fallback:',
        error.message
      )
      this._initializeFallbackService()
    }
  }

  /**
   * 初始化降级服务
   * @private
   */
  _initializeFallbackService() {
    try {
      const { enhancedLogService } = require('../services/EnhancedLogService')

      // 包装为统一接口
      this.unifiedLogService = {
        async logRequest(keyId, logData, options = {}) {
          return await enhancedLogService.logRequestWithDetails(
            logData,
            logData.requestHeaders || {},
            logData.responseHeaders || {},
            logData.tokenDetails || {},
            logData.costDetails || {},
            { enableCompression: true, ttl: 604800, ...options }
          )
        },
        getStats: () => enhancedLogService.getStats?.() || {},
        updateConfig: (config) => {
          if (enhancedLogService.updateConfig) {
            enhancedLogService.updateConfig(config)
          }
        }
      }

      logger.info('✅ UnifiedLogMiddleware: Fallback service initialized')
    } catch (fallbackError) {
      logger.error('❌ UnifiedLogMiddleware: Failed to initialize fallback service:', fallbackError)
      this.unifiedLogService = null
    }
  }

  /**
   * 设置定期清理间隔
   * @private
   */
  _setupCleanupInterval() {
    // 每5分钟清理一次过期的跟踪记录
    this.cleanupInterval = setInterval(
      () => {
        this._cleanupTrackedRequests()
        this._cleanupPendingLogs()
      },
      5 * 60 * 1000
    )
  }

  /**
   * Express中间件 - 请求日志记录
   *
   * 这个方法可以作为Express中间件使用，自动记录API请求
   *
   * @param {Object} req Express请求对象
   * @param {Object} res Express响应对象
   * @param {Function} next Express next函数
   */
  logRequest = (req, res, next) => {
    this.stats.totalRequests++

    // 采样控制
    if (!this._shouldLogRequest()) {
      this.stats.skippedRequests++
      return next()
    }

    // 创建请求跟踪键
    const trackingKey = this._createTrackingKey(req)
    req._unifiedLogTrackingKey = trackingKey

    // 检查是否已经记录过
    if (this.loggedRequests.has(trackingKey)) {
      this.stats.skippedRequests++
      logger.debug(`🔄 Request already logged: ${trackingKey}`)
      return next()
    }

    // 初始化日志上下文
    const logContext = this._initializeLogContext(req, res)
    req._unifiedLogContext = logContext

    // 拦截响应以捕获响应数据
    this._interceptResponse(req, res, logContext)

    next()
  }

  /**
   * 手动记录流式请求
   *
   * 为流式请求提供手动日志记录接口
   * 兼容现有的requestLoggingIntegration.logStreamRequest调用
   *
   * @param {Object} streamData 流式请求数据
   * @returns {Promise<string|null>} 日志ID或null
   */
  async logStreamRequest(streamData) {
    try {
      if (!this.unifiedLogService) {
        logger.warn('⚠️ UnifiedLogService not available, skipping log')
        return null
      }

      // 检查重复
      const trackingKey = streamData.trackingKey || this._createTrackingKeyFromData(streamData)
      if (this.loggedRequests.has(trackingKey)) {
        logger.debug(`🔄 Stream request already logged: ${trackingKey}`)
        return null
      }

      // 标记为已记录
      this.loggedRequests.add(trackingKey)

      // 构建日志数据
      const logData = await this._buildLogDataFromStream(streamData)

      // 记录日志
      const logId = await this.unifiedLogService.logRequest(
        streamData.apiKey?.id || 'unknown',
        logData,
        { enableAsync: this.options.enableAsync }
      )

      this.stats.loggedRequests++
      logger.debug(`✅ Stream request logged: ${logId}`)

      return logId
    } catch (error) {
      this.stats.errorCount++
      logger.error('❌ Failed to log stream request:', error)
      return null
    }
  }

  /**
   * 手动记录完整的请求响应
   *
   * @param {Object} requestData 完整的请求数据
   * @returns {Promise<string|null>} 日志ID或null
   */
  async logCompleteRequest(requestData) {
    try {
      if (!this.unifiedLogService) {
        logger.warn('⚠️ UnifiedLogService not available, skipping log')
        return null
      }

      const trackingKey = requestData.trackingKey || this._createTrackingKeyFromData(requestData)

      // 检查重复
      if (this.loggedRequests.has(trackingKey)) {
        logger.debug(`🔄 Complete request already logged: ${trackingKey}`)
        return null
      }

      // 标记为已记录
      this.loggedRequests.add(trackingKey)

      // 构建完整的日志数据
      const logData = await this._buildCompleteLogData(requestData)

      // 记录日志
      const logId = await this.unifiedLogService.logRequest(
        requestData.apiKey?.id || requestData.keyId || 'unknown',
        logData,
        { enableAsync: this.options.enableAsync }
      )

      this.stats.loggedRequests++
      logger.debug(`✅ Complete request logged: ${logId}`)

      return logId
    } catch (error) {
      this.stats.errorCount++
      logger.error('❌ Failed to log complete request:', error)
      return null
    }
  }

  /**
   * 判断是否应该记录请求
   * @private
   * @returns {boolean}
   */
  _shouldLogRequest() {
    return Math.random() < this.options.samplingRate
  }

  /**
   * 创建请求跟踪键
   * @private
   * @param {Object} req Express请求对象
   * @returns {string} 跟踪键
   */
  _createTrackingKey(req) {
    const apiKeyId = req.apiKey?.id || req.headers['x-api-key'] || 'unknown'
    const timestamp = Date.now()
    return `${apiKeyId}-${timestamp}-${Math.random().toString(36).substr(2, 6)}`
  }

  /**
   * 从数据对象创建跟踪键
   * @private
   * @param {Object} data 数据对象
   * @returns {string} 跟踪键
   */
  _createTrackingKeyFromData(data) {
    const apiKeyId = data.apiKey?.id || data.keyId || 'unknown'
    const timestamp = data.timestamp || Date.now()
    return `${apiKeyId}-${timestamp}-${Math.random().toString(36).substr(2, 6)}`
  }

  /**
   * 初始化日志上下文
   * @private
   * @param {Object} req Express请求对象
   * @param {Object} res Express响应对象
   * @returns {Object} 日志上下文
   */
  _initializeLogContext(req, _res) {
    const context = {
      startTime: Date.now(),
      method: req.method,
      path: req.path,
      requestHeaders: this.options.enableHeadersCapture ? { ...req.headers } : null,
      responseHeaders: {},
      tokenDetails: {},
      costDetails: {},
      requestBody: null,
      responseBody: null,
      status: null
    }

    return context
  }

  /**
   * 拦截响应以捕获响应数据
   * @private
   * @param {Object} req Express请求对象
   * @param {Object} res Express响应对象
   * @param {Object} logContext 日志上下文
   */
  _interceptResponse(req, res, logContext) {
    if (!this.options.enableHeadersCapture) {
      return
    }

    // 拦截setHeader
    const originalSetHeader = res.setHeader.bind(res)
    res.setHeader = (name, value) => {
      logContext.responseHeaders[name] = value
      return originalSetHeader(name, value)
    }

    // 拦截end方法
    const originalEnd = res.end.bind(res)
    res.end = (chunk, encoding) => {
      logContext.status = res.statusCode

      // 异步完成日志记录
      if (this.options.enableAsync) {
        setImmediate(() => this._finalizeLog(req, logContext))
      } else {
        this._finalizeLog(req, logContext)
      }

      return originalEnd(chunk, encoding)
    }
  }

  /**
   * 完成日志记录
   * @private
   * @param {Object} req Express请求对象
   * @param {Object} logContext 日志上下文
   */
  async _finalizeLog(req, logContext) {
    try {
      if (!this.unifiedLogService) {
        return
      }

      const trackingKey = req._unifiedLogTrackingKey
      if (this.loggedRequests.has(trackingKey)) {
        return // 已经记录过了
      }

      // 标记为已记录
      this.loggedRequests.add(trackingKey)

      // 构建完整的日志数据
      const logData = this._buildLogDataFromContext(logContext, req)

      // 记录日志
      await this.unifiedLogService.logRequest(
        req.apiKey?.id || 'unknown',
        logData,
        { enableAsync: false } // 这里已经是异步上下文了
      )

      this.stats.loggedRequests++
    } catch (error) {
      this.stats.errorCount++
      logger.error('❌ Failed to finalize log:', error)
    }
  }

  /**
   * 从上下文构建日志数据
   * @private
   * @param {Object} logContext 日志上下文
   * @param {Object} req Express请求对象
   * @returns {Object} 日志数据
   */
  _buildLogDataFromContext(logContext, req) {
    const processingTime = Date.now() - logContext.startTime

    return {
      timestamp: logContext.startTime,
      method: logContext.method,
      path: logContext.path,
      status: logContext.status,
      processingTime,
      requestHeaders: logContext.requestHeaders,
      responseHeaders: logContext.responseHeaders,
      tokenDetails: logContext.tokenDetails,
      costDetails: logContext.costDetails,
      userAgent: req.headers['user-agent'],
      ip: req.ip || req.connection.remoteAddress,
      source: 'unified_middleware'
    }
  }

  /**
   * 从流数据构建日志数据
   * @private
   * @param {Object} streamData 流数据
   * @returns {Promise<Object>} 日志数据
   */
  async _buildLogDataFromStream(streamData) {
    const logData = {
      timestamp: Date.now(),
      method: streamData.method || 'POST',
      path: streamData.path || '/api/v1/messages',
      status: streamData.status || 200,
      requestHeaders: streamData.requestHeaders || {},
      responseHeaders: streamData.responseHeaders || {},
      userAgent: streamData.userAgent,
      ip: streamData.ip,
      source: 'stream_request'
    }

    // 处理Token详情
    if (this.options.enableTokenDetails && streamData.usage) {
      logData.tokenDetails = this._extractTokenDetails(streamData.usage)
      logData.totalTokens = streamData.usage.total_tokens || streamData.usage.totalTokens
      logData.inputTokens = streamData.usage.input_tokens || streamData.usage.inputTokens
      logData.outputTokens = streamData.usage.output_tokens || streamData.usage.outputTokens
    }

    // 处理费用详情
    if (this.options.enableCostDetails && streamData.usage && streamData.model) {
      try {
        const cost = costCalculator.calculateCost(streamData.usage, streamData.model)
        logData.costDetails = {
          totalCost: cost,
          costPerToken:
            streamData.usage.total_tokens > 0 ? cost / streamData.usage.total_tokens : 0,
          currency: 'USD',
          model: streamData.model
        }
        logData.cost = cost
      } catch (error) {
        logger.warn('⚠️ Failed to calculate cost:', error.message)
      }
    }

    return logData
  }

  /**
   * 构建完整的日志数据
   * @private
   * @param {Object} requestData 请求数据
   * @returns {Promise<Object>} 日志数据
   */
  async _buildCompleteLogData(requestData) {
    const logData = {
      timestamp: requestData.timestamp || Date.now(),
      method: requestData.method || 'POST',
      path: requestData.path || requestData.url,
      status: requestData.status || requestData.statusCode,
      requestHeaders: requestData.requestHeaders || {},
      responseHeaders: requestData.responseHeaders || {},
      processingTime: requestData.processingTime,
      userAgent: requestData.userAgent,
      ip: requestData.ip,
      source: 'complete_request'
    }

    // 复制所有相关字段
    const fieldsToExtract = [
      'totalTokens',
      'inputTokens',
      'outputTokens',
      'cacheCreateTokens',
      'cacheReadTokens',
      'cost',
      'model',
      'provider',
      'error',
      'errorMessage'
    ]

    fieldsToExtract.forEach((field) => {
      if (requestData[field] !== undefined) {
        logData[field] = requestData[field]
      }
    })

    return logData
  }

  /**
   * 提取Token详情
   * @private
   * @param {Object} usage 使用量数据
   * @returns {Object} Token详情
   */
  _extractTokenDetails(usage) {
    const details = {
      totalTokens: usage.total_tokens || usage.totalTokens || 0,
      inputTokens: usage.input_tokens || usage.inputTokens || 0,
      outputTokens: usage.output_tokens || usage.outputTokens || 0,
      cacheCreateTokens: usage.cache_creation_input_tokens || usage.cacheCreateTokens || 0,
      cacheReadTokens: usage.cache_read_input_tokens || usage.cacheReadTokens || 0
    }

    // 计算缓存命中率
    const totalCacheTokens = details.cacheCreateTokens + details.cacheReadTokens
    details.cacheHitRatio =
      details.totalTokens > 0
        ? Math.round((totalCacheTokens / details.totalTokens) * 100 * 100) / 100
        : 0

    // 计算Token效率
    details.tokenEfficiency =
      details.totalTokens > 0
        ? Math.round((details.outputTokens / details.totalTokens) * 100) / 100
        : 0

    return details
  }

  /**
   * 清理过期的跟踪记录
   * @private
   */
  _cleanupTrackedRequests() {
    const now = Date.now()
    const cutoffTime = now - 10 * 60 * 1000 // 10分钟前

    for (const trackingKey of this.loggedRequests) {
      const [, timestamp] = trackingKey.split('-')
      if (parseInt(timestamp) < cutoffTime) {
        this.loggedRequests.delete(trackingKey)
      }
    }

    if (this.loggedRequests.size > 0) {
      logger.debug(
        `🧹 UnifiedLogMiddleware cleaned up tracking set, remaining: ${this.loggedRequests.size}`
      )
    }
  }

  /**
   * 清理待处理的日志
   * @private
   */
  _cleanupPendingLogs() {
    const now = Date.now()
    const cutoffTime = now - 10 * 60 * 1000 // 10分钟前

    for (const [key, log] of this.pendingLogs.entries()) {
      if (log.timestamp < cutoffTime) {
        this.pendingLogs.delete(key)
      }
    }
  }

  /**
   * 更新中间件配置
   * @param {Object} newConfig 新配置
   */
  updateConfig(newConfig) {
    this.options = { ...this.options, ...newConfig }

    // 更新底层服务配置
    if (this.unifiedLogService && this.unifiedLogService.updateConfig) {
      this.unifiedLogService.updateConfig(newConfig)
    }

    logger.info('⚙️ UnifiedLogMiddleware configuration updated')
  }

  /**
   * 获取中间件统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    const successRate =
      this.stats.totalRequests > 0
        ? Math.round((this.stats.loggedRequests / this.stats.totalRequests) * 100 * 100) / 100
        : 0

    return {
      ...this.stats,
      successRate: `${successRate}%`,
      samplingRate: `${(this.options.samplingRate * 100).toFixed(1)}%`,
      trackedRequestsCount: this.loggedRequests.size,
      pendingLogsCount: this.pendingLogs.size,
      serviceStats: this.unifiedLogService ? this.unifiedLogService.getStats() : null
    }
  }

  /**
   * 重置统计信息
   */
  resetStats() {
    this.stats = {
      totalRequests: 0,
      loggedRequests: 0,
      skippedRequests: 0,
      errorCount: 0,
      lastResetTime: Date.now()
    }

    logger.info('📊 UnifiedLogMiddleware stats reset')
  }

  /**
   * 优雅关闭中间件
   */
  async shutdown() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }

    this.loggedRequests.clear()
    this.pendingLogs.clear()

    logger.info('👋 UnifiedLogMiddleware shutdown completed')
  }
}

// 创建默认实例
const unifiedLogMiddleware = new UnifiedLogMiddleware()

// 导出类和实例
module.exports = {
  UnifiedLogMiddleware,
  unifiedLogMiddleware
}
