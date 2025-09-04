/**
 * @fileoverview 请求日志集成服务 - 统一日志架构集成版本
 *
 * 提供与现有系统无缝集成的增强日志记录功能
 * 现在基于UnifiedLogMiddleware架构，提供更好的依赖注入和配置管理
 * 支持Headers捕获、Token详情和费用信息记录
 *
 * @author Claude Code
 * @version 2.0.0 - UnifiedLogMiddleware集成版本
 */

const logger = require('../utils/logger')
const costCalculator = require('../utils/costCalculator')

// 支持新的统一日志中间件架构和向后兼容
let unifiedLogMiddleware = null
let fallbackService = null

try {
  // 优先使用新的UnifiedLogMiddleware
  const { unifiedLogMiddleware: middleware } = require('../middleware/unifiedLogging')
  unifiedLogMiddleware = middleware
  logger.info('✅ Using UnifiedLogMiddleware for request logging integration')
} catch (middlewareError) {
  logger.warn(
    '⚠️ UnifiedLogMiddleware not available, attempting UnifiedLogService fallback:',
    middlewareError.message
  )

  try {
    // 第二选择：使用UnifiedLogService
    const { unifiedLogServiceFactory } = require('./UnifiedLogServiceFactory')
    // 延迟初始化
    const initUnifiedLogService = async () => {
      if (!fallbackService) {
        fallbackService = await unifiedLogServiceFactory.getSingleton()
      }
      return fallbackService
    }
    module.exports.initUnifiedLogService = initUnifiedLogService
    logger.info('⚙️ Using UnifiedLogService as fallback for request logging integration')
  } catch (serviceError) {
    logger.warn(
      '⚠️ UnifiedLogService also not available, using EnhancedLogService fallback:',
      serviceError.message
    )

    // 最后的降级选择：使用原始的EnhancedLogService
    try {
      const { enhancedLogService } = require('./EnhancedLogService')
      fallbackService = {
        async logRequest(keyId, logData) {
          return await enhancedLogService.logRequestWithDetails(
            logData,
            logData.requestHeaders || {},
            logData.responseHeaders || {},
            logData.tokenDetails || {},
            logData.costDetails || {},
            { enableCompression: true, ttl: 604800 }
          )
        },
        getStats: () => enhancedLogService.getStats?.() || {},
        updateConfig: (config) => {
          if (enhancedLogService.updateConfig) {
            enhancedLogService.updateConfig(config)
          }
        }
      }
      logger.info('🔄 Using EnhancedLogService as final fallback')
    } catch (finalError) {
      logger.error('❌ All logging services failed to initialize:', finalError)
      fallbackService = null
    }
  }
}

/**
 * 请求日志集成服务
 *
 * 功能特性：
 * - 无侵入式集成到现有API流程
 * - 自动捕获请求和响应头信息
 * - 集成Token使用统计和费用计算
 * - 支持采样策略和性能优化
 * - 提供降级处理保证系统稳定性
 */
class RequestLoggingIntegration {
  constructor() {
    this.isEnabled = true
    this.samplingRate = 1.0 // 100% 采样率，可根据需要调整

    // 统计信息
    this.integrationStats = {
      totalRequests: 0,
      enhancedLogged: 0,
      fallbackLogged: 0,
      skippedBySampling: 0,
      errors: 0
    }

    // 配置选项
    this.config = {
      enableHeadersCapture: true,
      enableTokenDetails: true,
      enableCostDetails: true,
      enablePerformanceMonitoring: true,
      maxLogSize: 500000, // 500KB
      asyncLogging: true // 异步日志记录
    }
  }

  /**
   * 集成到流式API请求处理
   * 现在使用统一的UnifiedLogMiddleware架构
   * @param {Object} params 参数对象
   * @param {Object} params.apiKey API Key对象
   * @param {Object} params.requestBody 请求体
   * @param {Object} params.requestHeaders 请求头
   * @param {Object} params.responseHeaders 响应头
   * @param {Object} params.usageData Token使用数据
   * @param {string} params.accountId 账户ID
   * @param {number} params.responseTime 响应时间
   * @param {number} params.statusCode 状态码
   * @param {string} params.method HTTP方法
   * @param {string} params.path 请求路径
   * @param {string} params.userAgent 用户代理
   * @param {string} params.ipAddress IP地址
   * @returns {Promise<string|null>} 日志ID或null
   */
  async logStreamRequest(params) {
    if (!this.isEnabled || !this._shouldSample()) {
      if (!this._shouldSample()) {
        this.integrationStats.skippedBySampling++
      }
      return null
    }

    this.integrationStats.totalRequests++
    const startTime = Date.now()

    try {
      // 优先使用新的UnifiedLogMiddleware架构
      if (unifiedLogMiddleware) {
        const streamData = {
          apiKey: params.apiKey,
          method: params.method || 'POST',
          path: params.path || '/api/v1/messages',
          status: params.statusCode || 200,
          requestHeaders: this.config.enableHeadersCapture ? params.requestHeaders : {},
          responseHeaders: this.config.enableHeadersCapture ? params.responseHeaders : {},
          usage: params.usageData,
          model: params.requestBody?.model,
          userAgent: params.userAgent,
          ip: params.ipAddress,
          timestamp: startTime,
          trackingKey: `${params.apiKey.id}-${startTime}-stream`
        }

        const logId = await unifiedLogMiddleware.logStreamRequest(streamData)

        if (logId) {
          this.integrationStats.enhancedLogged++
          const processingTime = Date.now() - startTime
          logger.debug(`✅ Stream request logged via UnifiedLogMiddleware (${processingTime}ms)`, {
            keyId: params.apiKey.id,
            model: params.requestBody?.model || 'unknown',
            logId: `${logId.substring(0, 8)}...`
          })
        }

        return logId
      }

      // 降级到传统方法
      return await this._legacyLogStreamRequest(params, startTime)
    } catch (error) {
      this.integrationStats.errors++
      logger.error('❌ Stream request logging integration failed:', {
        keyId: params.apiKey.id,
        error: error.message,
        processingTime: Date.now() - startTime
      })
      return null
    }
  }

  /**
   * 传统的流式请求日志记录方法（降级处理）
   * @private
   */
  async _legacyLogStreamRequest(params, startTime) {
    // 1. 提取基础日志数据
    const baseLogData = this._extractBaseLogData(params)

    // 2. 构建Token详细信息
    const tokenDetails = this._buildTokenDetailsFromUsage(params.usageData, params.requestBody)

    // 3. 计算费用详细信息
    const costDetails = this._buildCostDetailsFromUsage(
      params.usageData,
      tokenDetails,
      params.accountId
    )

    // 4. 处理头部信息（如果启用）
    const requestHeaders = this.config.enableHeadersCapture ? params.requestHeaders : {}
    const responseHeaders = this.config.enableHeadersCapture ? params.responseHeaders : {}

    // 5. 设置日志选项
    const options = {
      enableCompression: true,
      maxValueLength: 2000,
      includeIpInfo: true,
      ttl: 604800 // 7天
    }

    // 6. 记录增强日志
    let logId = null
    if (this.config.asyncLogging) {
      // 异步记录，不阻塞主流程
      setImmediate(async () => {
        try {
          await this._recordEnhancedLog(
            baseLogData,
            requestHeaders,
            responseHeaders,
            tokenDetails,
            costDetails,
            options
          )
          this.integrationStats.enhancedLogged++
        } catch (error) {
          logger.error('❌ Async enhanced logging failed:', error.message)
          this.integrationStats.errors++
        }
      })
    } else {
      // 同步记录
      logId = await this._recordEnhancedLog(
        baseLogData,
        requestHeaders,
        responseHeaders,
        tokenDetails,
        costDetails,
        options
      )
      if (logId) {
        this.integrationStats.enhancedLogged++
      }
    }

    const processingTime = Date.now() - startTime
    logger.debug(`📊 Stream request processed via legacy method (${processingTime}ms)`, {
      keyId: params.apiKey.id,
      model: params.requestBody?.model || 'unknown',
      async: this.config.asyncLogging,
      hasUsageData: !!params.usageData
    })

    return logId
  }

  /**
   * 集成到非流式API请求处理
   * @param {Object} params 参数对象 (同上)
   * @returns {Promise<string|null>} 日志ID或null
   */
  async logNonStreamRequest(params) {
    // 对于非流式请求，处理逻辑相同
    return await this.logStreamRequest(params)
  }

  /**
   * 记录增强日志 - 支持依赖注入架构
   * @private
   */
  async _recordEnhancedLog(
    baseLogData,
    requestHeaders,
    responseHeaders,
    tokenDetails,
    costDetails,
    options
  ) {
    try {
      // 如果使用新的UnifiedLogService架构
      if (module.exports.initUnifiedLogService) {
        const service = await module.exports.initUnifiedLogService()

        // 组合完整的日志数据
        const completeLogData = {
          ...baseLogData,
          requestHeaders,
          responseHeaders,
          tokenDetails,
          costDetails
        }

        return await service.logRequest(baseLogData.keyId, completeLogData, {
          sync: !this.config.asyncLogging,
          enableCompression: options.enableCompression,
          ttl: options.ttl
        })
      }

      // 向后兼容：使用fallback服务
      if (fallbackService) {
        return await fallbackService.logRequest(baseLogData.keyId, {
          ...baseLogData,
          requestHeaders,
          responseHeaders,
          tokenDetails,
          costDetails
        })
      }

      // 最后的fallback：记录错误并返回默认值
      logger.error('❌ No log service available for request logging')
      return false
    } catch (error) {
      logger.error('❌ Enhanced log recording failed:', error)
      throw error
    }
  }

  /**
   * 提取基础日志数据
   * @private
   */
  _extractBaseLogData(params) {
    return {
      keyId: params.apiKey.id,
      method: params.method || 'POST',
      path: params.path || '/api/v1/messages',
      status: params.statusCode || 200,
      model: params.requestBody?.model || 'unknown',
      tokens: this._getTotalTokens(params.usageData),
      inputTokens: params.usageData?.input_tokens || 0,
      outputTokens: params.usageData?.output_tokens || 0,
      responseTime: params.responseTime || 0,
      userAgent: params.userAgent || '',
      ipAddress: params.ipAddress || '',
      error: params.statusCode >= 400 ? `HTTP ${params.statusCode}` : null,
      // 新增字段
      accountId: params.accountId || null,
      isStreaming: params.isStreaming || false,
      timestamp: Date.now()
    }
  }

  /**
   * 从使用数据构建Token详细信息
   * @private
   */
  _buildTokenDetailsFromUsage(usageData, requestBody) {
    if (!usageData || !this.config.enableTokenDetails) {
      return {}
    }

    const details = {
      totalTokens: this._getTotalTokens(usageData),
      inputTokens: usageData.input_tokens || 0,
      outputTokens: usageData.output_tokens || 0,
      cacheCreateTokens: usageData.cache_creation_input_tokens || 0,
      cacheReadTokens: usageData.cache_read_input_tokens || 0,
      model: usageData.model || requestBody?.model || 'unknown',

      // 详细缓存信息
      ephemeral5mTokens: 0,
      ephemeral1hTokens: 0,

      // 计算字段
      cacheHitRatio: 0,
      tokenEfficiency: 0,
      recordedAt: new Date().toISOString()
    }

    // 处理详细缓存创建数据
    if (usageData.cache_creation && typeof usageData.cache_creation === 'object') {
      details.ephemeral5mTokens = usageData.cache_creation.ephemeral_5m_input_tokens || 0
      details.ephemeral1hTokens = usageData.cache_creation.ephemeral_1h_input_tokens || 0
    }

    // 计算缓存命中率
    if (details.totalTokens > 0) {
      details.cacheHitRatio = (details.cacheReadTokens / details.totalTokens) * 100
    }

    // 计算Token效率
    if (details.inputTokens > 0) {
      details.tokenEfficiency = details.outputTokens / details.inputTokens
    }

    return details
  }

  /**
   * 从使用数据构建费用详细信息
   * @private
   */
  _buildCostDetailsFromUsage(usageData, tokenDetails, accountId = null) {
    if (!usageData || !this.config.enableCostDetails || !tokenDetails.model) {
      return {}
    }

    try {
      // 使用现有的费用计算器（使用正确的方法名）
      const costResult = costCalculator.calculateCost(usageData, tokenDetails.model)

      if (!costResult || !costResult.costs) {
        return { totalCost: 0, currency: 'USD', calculationFailed: true }
      }

      const totalCost = costResult.costs.total
      const inputCost = costResult.costs.input
      const outputCost = costResult.costs.output
      const cacheWriteCost = costResult.costs.cacheWrite
      const cacheReadCost = costResult.costs.cacheRead

      return {
        // 基本费用信息
        totalCost,
        inputCost,
        outputCost,
        cacheCost: cacheWriteCost + cacheReadCost,
        cacheWriteCost,
        cacheReadCost,

        // 定价信息
        inputTokenPrice: costResult.pricing?.input || 0,
        outputTokenPrice: costResult.pricing?.output || 0,
        cacheWriteTokenPrice: costResult.pricing?.cacheWrite || 0,
        cacheReadTokenPrice: costResult.pricing?.cacheRead || 0,

        // 元信息
        currency: 'USD',
        exchangeRate: 1.0,
        billingPeriod: 'per-request',
        costPerToken: tokenDetails.totalTokens > 0 ? totalCost / tokenDetails.totalTokens : 0,
        usingDynamicPricing: costResult.usingDynamicPricing || false,

        // 新增：账户相关费用信息
        accountId: accountId || null,
        accountCost: totalCost, // 当前请求产生的账户费用

        recordedAt: new Date().toISOString()
      }
    } catch (error) {
      logger.warn('⚠️ Cost calculation failed:', error.message)
      return {
        totalCost: 0,
        currency: 'USD',
        calculationError: error.message,
        accountId: accountId || null,
        accountCost: 0
      }
    }
  }

  /**
   * 获取总Token数
   * @private
   */
  _getTotalTokens(usageData) {
    if (!usageData) {
      return 0
    }

    const input = usageData.input_tokens || 0
    const output = usageData.output_tokens || 0
    const cacheCreate = usageData.cache_creation_input_tokens || 0
    const cacheRead = usageData.cache_read_input_tokens || 0

    return input + output + cacheCreate + cacheRead
  }

  /**
   * 采样决策
   * @private
   */
  _shouldSample() {
    return Math.random() < this.samplingRate
  }

  /**
   * 更新配置
   * @param {Object} newConfig 新配置
   */
  updateConfig(newConfig) {
    this.config = {
      ...this.config,
      ...newConfig
    }
    logger.info('🔄 Request logging integration config updated:', newConfig)
  }

  /**
   * 设置采样率
   * @param {number} rate 采样率 (0-1)
   */
  setSamplingRate(rate) {
    if (rate >= 0 && rate <= 1) {
      this.samplingRate = rate
      logger.info(`🎯 Sampling rate updated: ${rate * 100}%`)
    }
  }

  /**
   * 启用/禁用集成
   * @param {boolean} enabled 是否启用
   */
  setEnabled(enabled) {
    this.isEnabled = enabled
    logger.info(
      `${enabled ? '✅' : '⛔'} Request logging integration ${enabled ? 'enabled' : 'disabled'}`
    )
  }

  /**
   * 获取集成统计信息
   * @returns {Object} 统计信息
   */
  async getStats() {
    const baseStats = {
      integration: this.integrationStats,
      config: this.config,
      samplingRate: this.samplingRate,
      isEnabled: this.isEnabled
    }

    try {
      // 如果使用新的UnifiedLogService架构
      if (module.exports.initUnifiedLogService) {
        const service = await module.exports.initUnifiedLogService()
        baseStats.unifiedLogService = service.getStats()
        baseStats.architecture = 'dependency-injection'
      } else {
        // 向后兼容
        baseStats.enhancedLogService = fallbackService ? fallbackService.getStats?.() || {} : {}
        baseStats.architecture = 'legacy'
      }
    } catch (error) {
      logger.warn('⚠️ Failed to get service stats:', error.message)
      baseStats.statsError = error.message
    }

    return baseStats
  }

  /**
   * 重置统计信息
   */
  resetStats() {
    this.integrationStats = {
      totalRequests: 0,
      enhancedLogged: 0,
      fallbackLogged: 0,
      skippedBySampling: 0,
      errors: 0
    }
    logger.info('🔄 Request logging integration stats reset')
  }
}

// 创建单例实例
const requestLoggingIntegration = new RequestLoggingIntegration()

module.exports = {
  RequestLoggingIntegration,
  requestLoggingIntegration
}
