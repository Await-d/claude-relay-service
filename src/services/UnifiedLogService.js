/**
 * @fileoverview 统一日志服务 - 依赖注入优化版本
 *
 * 整合基础日志和增强日志系统，提供统一的日志记录入口点
 * 实现智能合并、降级处理和性能监控
 *
 * 架构特点：
 * - 遵循SOLID原则，特别是依赖倒置原则(DIP)
 * - 支持依赖注入，消除硬编码依赖
 * - 配置驱动的服务行为
 * - 完全的向后兼容性
 *
 * @author Claude Code
 * @version 3.0.0 - 依赖注入重构版本
 */

const logger = require('../utils/logger')

/**
 * 统一日志服务类 - 依赖注入版本
 *
 * 核心特性:
 * - 单一日志记录入口点，消除重复调用
 * - 集成Headers过滤和Token详情记录
 * - 智能降级处理和错误恢复
 * - 性能监控和统计功能
 * - 支持异步处理，不阻塞主流程
 * - 依赖注入架构，遵循SOLID原则
 *
 * @class UnifiedLogService
 */
class UnifiedLogService {
  /**
   * 创建UnifiedLogService实例
   *
   * @param {Object} dependencies - 依赖对象
   * @param {Object} dependencies.database - 数据库适配器实例
   * @param {Object} dependencies.headersFilter - Headers过滤服务实例
   * @param {Object} dependencies.logger - 日志记录器实例
   * @param {Object} config - 服务配置对象
   * @param {number} [config.mergeWindowMs=15000] - 合并窗口时间(毫秒)
   * @param {number} [config.maxRetries=3] - 最大重试次数
   * @param {number} [config.retryDelayMs=1000] - 重试延迟时间(毫秒)
   * @param {boolean} [config.enableAsync=true] - 是否启用异步处理
   * @param {boolean} [config.enableHeadersCapture=true] - 是否启用Headers捕获
   * @param {boolean} [config.enableTokenDetails=true] - 是否启用Token详情记录
   * @param {boolean} [config.enableCostDetails=true] - 是否启用费用详情记录
   * @throws {Error} 当必需的依赖项缺失时
   */
  constructor(dependencies = {}, config = {}) {
    // 依赖验证 - 确保关键依赖存在
    this._validateDependencies(dependencies)

    // 注入依赖（依赖倒置原则）
    this.database = dependencies.database
    this.headersFilter = dependencies.headersFilter
    this.logger = dependencies.logger || logger // 向后兼容

    // 合并配置（配置驱动）
    this.config = this._mergeConfig(config)

    // 初始化内部状态
    this.stats = {
      totalRequests: 0,
      successfulLogs: 0,
      failedLogs: 0,
      averageProcessingTime: 0,
      lastResetTime: Date.now(),
      // 新增性能监控指标
      qpsMetrics: {
        current: 0,
        peak: 0,
        average: 0,
        requestTimestamps: [] // 最近1分钟的请求时间戳
      },
      memoryMetrics: {
        heapUsed: process.memoryUsage().heapUsed,
        heapTotal: process.memoryUsage().heapTotal,
        external: process.memoryUsage().external,
        rss: process.memoryUsage().rss
      },
      responseTimeDistribution: {
        under50ms: 0,
        under100ms: 0,
        under200ms: 0,
        under500ms: 0,
        over500ms: 0
      },
      errorsByType: {},
      healthStatus: 'healthy' // healthy, degraded, unhealthy
    }

    // 防重复记录的缓存
    this.recentLogs = new Map()
    this.cleanupInterval = setInterval(() => this.cleanupRecentLogs(), this.config.mergeWindowMs)

    this.logger.info('🔧 UnifiedLogService initialized successfully with dependency injection')
  }

  /**
   * 统一日志记录方法
   * @param {string} keyId API Key ID
   * @param {Object} logData 日志数据
   * @param {Object} options 记录选项
   * @returns {Promise<string|null>} 日志ID或null
   */
  async logRequest(keyId, logData, options = {}) {
    const startTime = Date.now()
    this.stats.totalRequests++

    // 更新QPS指标
    this.updateQpsMetrics(startTime)

    try {
      // 数据验证和预处理
      const processedData = await this.preprocessLogData(keyId, logData, options)

      // 重复检测
      if (await this.isDuplicateLog(processedData)) {
        this.logger.debug(`🔄 Duplicate log detected for ${keyId}, skipping`)
        return null
      }

      // 异步或同步处理
      if (this.config.enableAsync && !options.sync) {
        // 异步处理，不阻塞主流程
        setImmediate(() => this.performLogRecord(processedData, startTime))
        return `async_${Date.now()}_${keyId}`
      } else {
        // 同步处理
        return await this.performLogRecord(processedData, startTime)
      }
    } catch (error) {
      this.stats.failedLogs++
      this.recordErrorType(error)
      this.logger.error('❌ UnifiedLogService: Failed to log request:', error)

      // 降级处理：尝试记录基础信息
      try {
        return await this.fallbackLogRecord(keyId, logData, error)
      } catch (fallbackError) {
        this.logger.error('💥 UnifiedLogService: Fallback logging also failed:', fallbackError)
        return null
      }
    }
  }

  /**
   * 预处理日志数据
   * @private
   * @param {string} keyId API Key ID
   * @param {Object} logData 原始日志数据
   * @param {Object} options 选项
   * @returns {Promise<Object>} 处理后的数据
   */
  async preprocessLogData(keyId, logData, _options) {
    const processedData = {
      ...logData,
      keyId,
      timestamp: logData.timestamp || Date.now(),
      logVersion: '3.0.0',
      source: 'unified_service'
    }

    // Headers过滤处理
    if (this.config.enableHeadersCapture && logData.requestHeaders) {
      try {
        processedData.requestHeaders = await this.headersFilter.filterHeaders(
          logData.requestHeaders,
          'request'
        )
      } catch (error) {
        this.logger.warn('⚠️ Headers filtering failed for request:', error.message)
        processedData.requestHeaders = null
      }
    }

    if (this.config.enableHeadersCapture && logData.responseHeaders) {
      try {
        processedData.responseHeaders = await this.headersFilter.filterHeaders(
          logData.responseHeaders,
          'response'
        )
      } catch (error) {
        this.logger.warn('⚠️ Headers filtering failed for response:', error.message)
        processedData.responseHeaders = null
      }
    }

    // Token详情处理
    if (this.config.enableTokenDetails) {
      processedData.tokenDetails = this.processTokenDetails(logData)
    }

    // 费用详情处理
    if (this.config.enableCostDetails) {
      processedData.costDetails = this.processCostDetails(logData)
    }

    return processedData
  }

  /**
   * 处理Token详情
   * @private
   * @param {Object} logData 日志数据
   * @returns {Object|null} Token详情
   */
  processTokenDetails(logData) {
    try {
      const tokenDetails = {
        totalTokens: parseInt(logData.totalTokens || logData.tokens || 0),
        inputTokens: parseInt(logData.inputTokens || 0),
        outputTokens: parseInt(logData.outputTokens || 0),
        cacheCreateTokens: parseInt(logData.cacheCreateTokens || 0),
        cacheReadTokens: parseInt(logData.cacheReadTokens || 0)
      }

      // 计算缓存命中率和效率
      const totalCacheTokens = tokenDetails.cacheCreateTokens + tokenDetails.cacheReadTokens
      tokenDetails.cacheHitRatio =
        tokenDetails.totalTokens > 0
          ? Math.round((totalCacheTokens / tokenDetails.totalTokens) * 100 * 100) / 100
          : 0

      tokenDetails.tokenEfficiency =
        tokenDetails.totalTokens > 0
          ? Math.round((tokenDetails.outputTokens / tokenDetails.totalTokens) * 100) / 100
          : 0

      // 缓存类型详情
      if (logData.ephemeral5mTokens || logData.ephemeral_5m_input_tokens) {
        tokenDetails.ephemeral5mTokens = parseInt(
          logData.ephemeral5mTokens || logData.ephemeral_5m_input_tokens || 0
        )
      }

      if (logData.ephemeral1hTokens || logData.ephemeral_1h_input_tokens) {
        tokenDetails.ephemeral1hTokens = parseInt(
          logData.ephemeral1hTokens || logData.ephemeral_1h_input_tokens || 0
        )
      }

      return tokenDetails
    } catch (error) {
      this.logger.warn('⚠️ Token details processing failed:', error.message)
      return null
    }
  }

  /**
   * 处理费用详情
   * @private
   * @param {Object} logData 日志数据
   * @returns {Object|null} 费用详情
   */
  processCostDetails(logData) {
    try {
      if (!logData.cost && !logData.totalCost) {
        return null
      }

      const totalCost = parseFloat(logData.cost || logData.totalCost || 0)
      const totalTokens = parseInt(logData.totalTokens || logData.tokens || 0)

      return {
        totalCost,
        costPerToken: totalTokens > 0 ? totalCost / totalTokens : 0,
        currency: 'USD',
        model: logData.model || 'unknown'
      }
    } catch (error) {
      this.logger.warn('⚠️ Cost details processing failed:', error.message)
      return null
    }
  }

  /**
   * 重复日志检测
   * @private
   * @param {Object} processedData 处理后的数据
   * @returns {Promise<boolean>} 是否重复
   */
  async isDuplicateLog(processedData) {
    const { keyId, timestamp, path, method } = processedData
    const cacheKey = `${keyId}:${path}:${method}`

    const existingLog = this.recentLogs.get(cacheKey)
    if (existingLog) {
      const timeDiff = Math.abs(timestamp - existingLog.timestamp)
      if (timeDiff < this.config.mergeWindowMs) {
        return true
      }
    }

    // 更新缓存
    this.recentLogs.set(cacheKey, { timestamp })
    return false
  }

  /**
   * 执行实际的日志记录
   * @private
   * @param {Object} processedData 处理后的数据
   * @param {number} startTime 开始时间
   * @returns {Promise<string>} 日志ID
   */
  async performLogRecord(processedData, startTime) {
    try {
      // 使用注入的数据库依赖（符合依赖倒置原则）
      const logId = await this.database.logRequest(
        processedData.keyId,
        processedData,
        604800 // 7天TTL
      )

      // 更新统计
      const processingTime = Date.now() - startTime
      this.updateStats(true, processingTime)

      this.logger.debug(
        `✅ Log recorded successfully: ${logId}, processing time: ${processingTime}ms`
      )
      return logId
    } catch (error) {
      this.updateStats(false, Date.now() - startTime)
      throw error
    }
  }

  /**
   * 降级日志记录
   * @private
   * @param {string} keyId API Key ID
   * @param {Object} logData 原始日志数据
   * @param {Error} originalError 原始错误
   * @returns {Promise<string|null>} 日志ID或null
   */
  async fallbackLogRecord(keyId, logData, originalError) {
    try {
      this.logger.warn('🔄 Attempting fallback logging for:', keyId)

      // 简化的日志数据
      const fallbackData = {
        keyId,
        timestamp: Date.now(),
        path: logData.path || '/unknown',
        method: logData.method || 'UNKNOWN',
        status: logData.status || 0,
        tokens: parseInt(logData.tokens || logData.totalTokens || 0),
        error: originalError.message,
        logVersion: '3.0.0-fallback'
      }

      // 使用注入的数据库依赖
      return await this.database.logRequest(keyId, fallbackData, 86400) // 1天TTL
    } catch (error) {
      this.logger.error('💥 Fallback logging failed:', error)
      return null
    }
  }

  /**
   * 更新统计信息
   * @private
   * @param {boolean} success 是否成功
   * @param {number} processingTime 处理时间
   */
  updateStats(success, processingTime) {
    if (success) {
      this.stats.successfulLogs++
    } else {
      this.stats.failedLogs++
    }

    // 更新平均处理时间
    const totalLogs = this.stats.successfulLogs + this.stats.failedLogs
    this.stats.averageProcessingTime =
      totalLogs > 0
        ? (this.stats.averageProcessingTime * (totalLogs - 1) + processingTime) / totalLogs
        : processingTime

    // 更新响应时间分布统计
    this.updateResponseTimeDistribution(processingTime)

    // 更新内存指标
    this.updateMemoryMetrics()

    // 更新健康状态
    this.updateHealthStatus()
  }

  /**
   * 清理最近日志缓存
   * @private
   */
  cleanupRecentLogs() {
    const now = Date.now()
    const cutoff = now - this.config.mergeWindowMs

    for (const [key, log] of this.recentLogs.entries()) {
      if (log.timestamp < cutoff) {
        this.recentLogs.delete(key)
      }
    }

    this.logger.debug(`🧹 Cleaned up recent logs cache, remaining: ${this.recentLogs.size}`)
  }

  /**
   * 更新配置
   * @param {Object} newConfig 新配置
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig }
    this.logger.info('⚙️ UnifiedLogService configuration updated:', newConfig)
  }

  /**
   * 获取服务统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    const successRate =
      this.stats.totalRequests > 0
        ? Math.round((this.stats.successfulLogs / this.stats.totalRequests) * 100 * 100) / 100
        : 0

    return {
      ...this.stats,
      successRate: `${successRate}%`,
      cacheSize: this.recentLogs.size,
      uptime: Date.now() - this.stats.lastResetTime,
      config: { ...this.config }
    }
  }

  /**
   * 重置统计信息
   */
  resetStats() {
    this.stats = {
      totalRequests: 0,
      successfulLogs: 0,
      failedLogs: 0,
      averageProcessingTime: 0,
      lastResetTime: Date.now()
    }
    this.logger.info('📊 UnifiedLogService stats reset')
  }

  /**
   * 优雅关闭服务
   */
  async shutdown() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }

    this.recentLogs.clear()
    this.logger.info('👋 UnifiedLogService shutdown completed')
  }

  /**
   * 验证必需的依赖项
   * @private
   * @param {Object} dependencies 依赖对象
   * @throws {Error} 当必需依赖缺失时
   */
  _validateDependencies(dependencies) {
    const requiredDeps = ['database', 'headersFilter']
    const missing = requiredDeps.filter((dep) => !dependencies[dep])

    if (missing.length > 0) {
      throw new Error(
        `缺少必需的依赖项: ${missing.join(', ')}. 请确保通过UnifiedLogServiceFactory创建实例。`
      )
    }
  }

  /**
   * 更新QPS指标
   * @private
   * @param {number} currentTime 当前时间戳
   */
  updateQpsMetrics(currentTime) {
    // 添加当前请求时间戳
    this.stats.qpsMetrics.requestTimestamps.push(currentTime)

    // 只保留最近1分钟的请求时间戳
    const oneMinuteAgo = currentTime - 60000
    this.stats.qpsMetrics.requestTimestamps = this.stats.qpsMetrics.requestTimestamps.filter(
      (timestamp) => timestamp > oneMinuteAgo
    )

    // 计算当前QPS（最近1分钟的请求数）
    const currentQps = this.stats.qpsMetrics.requestTimestamps.length / 60
    this.stats.qpsMetrics.current = Math.round(currentQps * 100) / 100

    // 更新峰值QPS
    if (this.stats.qpsMetrics.current > this.stats.qpsMetrics.peak) {
      this.stats.qpsMetrics.peak = this.stats.qpsMetrics.current
    }

    // 计算平均QPS
    const { totalRequests } = this.stats
    const uptime = (currentTime - this.stats.lastResetTime) / 1000 // 秒
    this.stats.qpsMetrics.average =
      uptime > 0 ? Math.round((totalRequests / uptime) * 100) / 100 : 0
  }

  /**
   * 更新响应时间分布
   * @private
   * @param {number} processingTime 处理时间（毫秒）
   */
  updateResponseTimeDistribution(processingTime) {
    if (processingTime < 50) {
      this.stats.responseTimeDistribution.under50ms++
    } else if (processingTime < 100) {
      this.stats.responseTimeDistribution.under100ms++
    } else if (processingTime < 200) {
      this.stats.responseTimeDistribution.under200ms++
    } else if (processingTime < 500) {
      this.stats.responseTimeDistribution.under500ms++
    } else {
      this.stats.responseTimeDistribution.over500ms++
    }
  }

  /**
   * 更新内存指标
   * @private
   */
  updateMemoryMetrics() {
    const memoryUsage = process.memoryUsage()
    this.stats.memoryMetrics = {
      heapUsed: memoryUsage.heapUsed,
      heapTotal: memoryUsage.heapTotal,
      external: memoryUsage.external,
      rss: memoryUsage.rss
    }
  }

  /**
   * 更新健康状态
   * @private
   */
  updateHealthStatus() {
    const successRate =
      this.stats.totalRequests > 0
        ? (this.stats.successfulLogs / this.stats.totalRequests) * 100
        : 100

    const avgResponseTime = this.stats.averageProcessingTime
    const memoryUsage = this.stats.memoryMetrics.heapUsed / (1024 * 1024) // MB

    // 健康状态判断逻辑
    if (successRate >= 95 && avgResponseTime < 100 && memoryUsage < 512) {
      this.stats.healthStatus = 'healthy'
    } else if (successRate >= 85 && avgResponseTime < 500 && memoryUsage < 1024) {
      this.stats.healthStatus = 'degraded'
    } else {
      this.stats.healthStatus = 'unhealthy'
    }
  }

  /**
   * 记录错误类型统计
   * @private
   * @param {Error} error 错误对象
   */
  recordErrorType(error) {
    const errorType = error.constructor.name || 'UnknownError'
    this.stats.errorsByType[errorType] = (this.stats.errorsByType[errorType] || 0) + 1
  }

  /**
   * 获取详细的性能报告
   * @returns {Object} 性能报告
   */
  getPerformanceReport() {
    const uptime = Date.now() - this.stats.lastResetTime
    const totalLogs = this.stats.successfulLogs + this.stats.failedLogs

    return {
      // 基础指标
      uptime,
      totalRequests: this.stats.totalRequests,
      successfulLogs: this.stats.successfulLogs,
      failedLogs: this.stats.failedLogs,
      successRate:
        totalLogs > 0 ? Math.round((this.stats.successfulLogs / totalLogs) * 100 * 100) / 100 : 0,

      // QPS指标
      qps: this.stats.qpsMetrics,

      // 响应时间指标
      averageResponseTime: this.stats.averageProcessingTime,
      responseTimeDistribution: {
        ...this.stats.responseTimeDistribution,
        totalRequests: Object.values(this.stats.responseTimeDistribution).reduce((a, b) => a + b, 0)
      },

      // 内存指标（格式化为MB）
      memory: {
        heapUsedMB: Math.round((this.stats.memoryMetrics.heapUsed / (1024 * 1024)) * 100) / 100,
        heapTotalMB: Math.round((this.stats.memoryMetrics.heapTotal / (1024 * 1024)) * 100) / 100,
        externalMB: Math.round((this.stats.memoryMetrics.external / (1024 * 1024)) * 100) / 100,
        rssMB: Math.round((this.stats.memoryMetrics.rss / (1024 * 1024)) * 100) / 100
      },

      // 健康状态和错误统计
      healthStatus: this.stats.healthStatus,
      errorsByType: this.stats.errorsByType,

      // 时间戳
      reportTimestamp: new Date().toISOString()
    }
  }

  /**
   * 合并配置参数
   * @private
   * @param {Object} userConfig 用户提供的配置
   * @returns {Object} 合并后的配置
   */
  _mergeConfig(userConfig) {
    const defaultConfig = {
      mergeWindowMs: 15000, // 15秒合并窗口
      maxRetries: 3,
      retryDelayMs: 1000,
      enableAsync: true,
      enableHeadersCapture: true,
      enableTokenDetails: true,
      enableCostDetails: true
    }

    return { ...defaultConfig, ...userConfig }
  }
}

// 注意：不再创建全局单例，改由工厂管理
// 这符合依赖注入模式和单一职责原则

module.exports = {
  UnifiedLogService
}
