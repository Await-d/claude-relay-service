/**
 * @fileoverview 增强日志记录服务 - 集成Headers过滤和详细信息
 *
 * 扩展现有的日志记录功能，添加：
 * - 过滤后的请求头和响应头信息
 * - 详细的Token统计信息
 * - 费用详细信息
 * - 数据压缩优化
 *
 * @author Claude Code
 * @version 1.0.0
 */

const logger = require('../utils/logger')
const database = require('../models/database')
const HeadersFilterService = require('./HeadersFilterService')

/**
 * 增强日志记录服务
 *
 * 功能特性：
 * - 安全的Headers过滤和记录
 * - 详细的Token使用统计
 * - 费用信息记录
 * - 向后兼容现有系统
 * - 异步处理优化性能
 */
class EnhancedLogService {
  constructor() {
    this.headersFilter = new HeadersFilterService()
    this.isEnabled = true

    // 统计信息
    this.stats = {
      totalRequests: 0,
      successfulLogs: 0,
      failedLogs: 0,
      headersFiltered: 0,
      tokenDetailsProcessed: 0,
      costDetailsProcessed: 0,
      dataCompressionSaved: 0,
      averageProcessingTime: 0
    }

    // 性能监控
    this.performanceMetrics = {
      processingTimes: [],
      maxProcessingTime: 0,
      minProcessingTime: Infinity
    }

    // 配置选项
    this.config = {
      maxHeadersSize: 50000, // 50KB
      maxTokenDetailsSize: 10000, // 10KB
      maxCostDetailsSize: 5000, // 5KB
      enableDataValidation: true,
      enablePerformanceTracking: true
    }
  }

  /**
   * 增强的日志记录方法
   * @param {Object} logData 基础日志数据
   * @param {Object} requestHeaders 原始请求头
   * @param {Object} responseHeaders 原始响应头
   * @param {Object} tokenDetails 详细Token信息
   * @param {Object} costDetails 费用详细信息
   * @param {Object} options 记录选项
   * @returns {Promise<string|null>} 日志ID或null
   */
  async logRequestWithDetails(
    logData,
    requestHeaders = {},
    responseHeaders = {},
    tokenDetails = {},
    costDetails = {},
    options = {}
  ) {
    if (!this.isEnabled) {
      return null
    }

    const startTime = Date.now()
    this.stats.totalRequests++

    try {
      // 1. 数据验证（如果启用）
      if (this.config.enableDataValidation) {
        this._validateInputData(logData, requestHeaders, responseHeaders, tokenDetails, costDetails)
      }

      // 2. 过滤Headers信息
      const { requestHeaders: filteredRequestHeaders, responseHeaders: filteredResponseHeaders } =
        this.headersFilter.filterHeaders(requestHeaders, responseHeaders, {
          enableCompression: options.enableCompression !== false,
          maxValueLength: options.maxValueLength || 2000,
          includeIpInfo: options.includeIpInfo !== false
        })

      this.stats.headersFiltered++

      // 3. 构建详细的Token信息
      const enhancedTokenDetails = this._buildTokenDetails(tokenDetails, logData)
      if (Object.keys(enhancedTokenDetails).length > 5) {
        this.stats.tokenDetailsProcessed++
      }

      // 4. 构建费用详细信息
      const enhancedCostDetails = this._buildCostDetails(costDetails, logData, enhancedTokenDetails)
      if (enhancedCostDetails.totalCost > 0) {
        this.stats.costDetailsProcessed++
      }

      // 5. 数据大小检查和压缩
      const compressedData = this._optimizeDataSize({
        requestHeaders: filteredRequestHeaders,
        responseHeaders: filteredResponseHeaders,
        tokenDetails: enhancedTokenDetails,
        costDetails: enhancedCostDetails
      })

      // 6. 准备增强的日志数据
      const enhancedLogData = {
        ...logData,
        ...compressedData,
        // 元数据
        logVersion: '2.1',
        processTime: Date.now() - startTime,
        dataOptimized: compressedData.wasCompressed || false
      }

      // 7. 写入到数据库
      const logId = await database.logRequest(logData.keyId, enhancedLogData, options.ttl)

      this.stats.successfulLogs++

      // 8. 性能监控
      if (this.config.enablePerformanceTracking) {
        this._updatePerformanceMetrics(Date.now() - startTime)
      }

      logger.debug(`📝 Enhanced log recorded: ${logId} (${Date.now() - startTime}ms)`, {
        keyId: logData.keyId,
        hasHeaders: !!(compressedData.requestHeaders || compressedData.responseHeaders),
        hasTokenDetails: !!enhancedTokenDetails.totalTokens,
        hasCostDetails: !!enhancedCostDetails.totalCost,
        dataOptimized: compressedData.wasCompressed
      })

      return logId
    } catch (error) {
      this.stats.failedLogs++
      logger.error('❌ Enhanced log recording failed:', {
        keyId: logData.keyId,
        error: error.message,
        processingTime: Date.now() - startTime
      })

      // 降级处理：如果增强日志记录失败，尝试记录基础日志
      try {
        return await database.logRequest(logData.keyId, logData, options.ttl)
      } catch (fallbackError) {
        logger.error('❌ Fallback log recording also failed:', fallbackError.message)
        return null
      }
    }
  }

  /**
   * 构建详细的Token统计信息
   * @private
   * @param {Object} tokenDetails Token详情
   * @param {Object} logData 基础日志数据
   * @returns {Object} 增强的Token详细信息
   */
  _buildTokenDetails(tokenDetails, logData) {
    const details = {
      // 基础Token信息
      totalTokens: tokenDetails.totalTokens || logData.tokens || 0,
      inputTokens: tokenDetails.inputTokens || logData.inputTokens || 0,
      outputTokens: tokenDetails.outputTokens || logData.outputTokens || 0,

      // 缓存Token信息
      cacheCreateTokens: tokenDetails.cacheCreateTokens || 0,
      cacheReadTokens: tokenDetails.cacheReadTokens || 0,

      // 详细缓存类型
      ephemeral5mTokens: tokenDetails.ephemeral5mTokens || 0,
      ephemeral1hTokens: tokenDetails.ephemeral1hTokens || 0,

      // 计算字段
      cacheHitRatio: 0,
      tokenEfficiency: 0,

      // 模型信息
      model: tokenDetails.model || logData.model || 'unknown',

      // 时间戳
      recordedAt: new Date().toISOString()
    }

    // 计算缓存命中率
    if (details.totalTokens > 0) {
      details.cacheHitRatio = (details.cacheReadTokens / details.totalTokens) * 100
    }

    // 计算Token效率 (输出/输入比率)
    if (details.inputTokens > 0) {
      details.tokenEfficiency = details.outputTokens / details.inputTokens
    }

    // 验证数据一致性
    const calculatedTotal =
      details.inputTokens +
      details.outputTokens +
      details.cacheCreateTokens +
      details.cacheReadTokens
    if (Math.abs(calculatedTotal - details.totalTokens) > 5) {
      logger.warn('⚠️ Token count mismatch detected:', {
        provided: details.totalTokens,
        calculated: calculatedTotal,
        keyId: logData.keyId
      })
    }

    return details
  }

  /**
   * 构建费用详细信息
   * @private
   * @param {Object} costDetails 费用详情
   * @param {Object} logData 基础日志数据
   * @param {Object} tokenDetails Token详细信息
   * @returns {Object} 增强的费用详细信息
   */
  _buildCostDetails(costDetails, logData, tokenDetails) {
    const details = {
      // 基础费用信息
      totalCost: costDetails.totalCost || 0,
      inputCost: costDetails.inputCost || 0,
      outputCost: costDetails.outputCost || 0,
      cacheCost: costDetails.cacheCost || 0,

      // 费用计算细节
      inputTokenPrice: costDetails.inputTokenPrice || 0,
      outputTokenPrice: costDetails.outputTokenPrice || 0,
      cacheTokenPrice: costDetails.cacheTokenPrice || 0,

      // 汇率和货币
      currency: costDetails.currency || 'USD',
      exchangeRate: costDetails.exchangeRate || 1.0,

      // 时间相关费用信息
      billingPeriod: costDetails.billingPeriod || 'per-request',
      recordedAt: new Date().toISOString(),

      // 成本效益分析
      costPerToken: 0,
      costPerSecond: 0
    }

    // 计算每Token成本
    if (tokenDetails.totalTokens > 0) {
      details.costPerToken = details.totalCost / tokenDetails.totalTokens
    }

    // 计算每秒成本（如果有响应时间）
    if (logData.responseTime > 0) {
      details.costPerSecond = details.totalCost / (logData.responseTime / 1000)
    }

    // 验证费用一致性
    const calculatedTotal = details.inputCost + details.outputCost + details.cacheCost
    if (Math.abs(calculatedTotal - details.totalCost) > 0.001) {
      logger.debug('💰 Cost calculation verification:', {
        provided: details.totalCost,
        calculated: calculatedTotal,
        keyId: logData.keyId
      })
    }

    return details
  }

  /**
   * 批量记录多个请求的日志
   * @param {Array<Object>} logEntries 日志条目数组
   * @param {Object} options 批量选项
   * @returns {Promise<Array>} 记录结果数组
   */
  async batchLogRequests(logEntries, options = {}) {
    if (!this.isEnabled || !Array.isArray(logEntries) || logEntries.length === 0) {
      return []
    }

    const startTime = Date.now()
    const results = []
    const batchSize = options.batchSize || 10

    logger.info(`📊 Starting batch log processing: ${logEntries.length} entries`)

    // 分批处理以控制内存使用
    for (let i = 0; i < logEntries.length; i += batchSize) {
      const batch = logEntries.slice(i, i + batchSize)

      const batchPromises = batch.map(async (entry, index) => {
        try {
          const logId = await this.logRequestWithDetails(
            entry.logData,
            entry.requestHeaders,
            entry.responseHeaders,
            entry.tokenDetails,
            entry.costDetails,
            entry.options
          )

          return {
            index: i + index,
            success: true,
            logId,
            error: null
          }
        } catch (error) {
          return {
            index: i + index,
            success: false,
            logId: null,
            error: error.message
          }
        }
      })

      const batchResults = await Promise.all(batchPromises)
      results.push(...batchResults)

      // 短暂延迟以减少系统压力
      if (i + batchSize < logEntries.length) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    }

    const processingTime = Date.now() - startTime
    const successCount = results.filter((r) => r.success).length

    logger.info(
      `📊 Batch log processing completed: ${successCount}/${logEntries.length} successful (${processingTime}ms)`
    )

    return results
  }

  /**
   * 启用日志记录
   */
  enable() {
    this.isEnabled = true
    logger.info('✅ Enhanced log service enabled')
  }

  /**
   * 禁用日志记录
   */
  disable() {
    this.isEnabled = false
    logger.info('⛔ Enhanced log service disabled')
  }

  /**
   * 验证输入数据
   * @private
   * @param {Object} logData 日志数据
   * @param {Object} requestHeaders 请求头
   * @param {Object} responseHeaders 响应头
   * @param {Object} tokenDetails Token详情
   * @param {Object} costDetails 费用详情
   */
  _validateInputData(logData, requestHeaders, responseHeaders, tokenDetails, costDetails) {
    // 基础数据验证
    if (!logData || typeof logData !== 'object') {
      throw new Error('logData must be a valid object')
    }

    if (!logData.keyId) {
      throw new Error('logData.keyId is required')
    }

    // Headers大小检查
    const headersSize = JSON.stringify({ requestHeaders, responseHeaders }).length
    if (headersSize > this.config.maxHeadersSize) {
      logger.warn(
        `⚠️ Headers data too large: ${headersSize} bytes (max: ${this.config.maxHeadersSize})`
      )
    }

    // Token详情大小检查
    if (tokenDetails && Object.keys(tokenDetails).length > 0) {
      const tokenDetailsSize = JSON.stringify(tokenDetails).length
      if (tokenDetailsSize > this.config.maxTokenDetailsSize) {
        logger.warn(
          `⚠️ Token details too large: ${tokenDetailsSize} bytes (max: ${this.config.maxTokenDetailsSize})`
        )
      }
    }

    // 费用详情大小检查
    if (costDetails && Object.keys(costDetails).length > 0) {
      const costDetailsSize = JSON.stringify(costDetails).length
      if (costDetailsSize > this.config.maxCostDetailsSize) {
        logger.warn(
          `⚠️ Cost details too large: ${costDetailsSize} bytes (max: ${this.config.maxCostDetailsSize})`
        )
      }
    }
  }

  /**
   * 优化数据大小
   * @private
   * @param {Object} data 数据对象
   * @returns {Object} 优化后的数据
   */
  _optimizeDataSize(data) {
    let wasCompressed = false
    const originalSize = JSON.stringify(data).length

    // 如果数据太大，进行压缩优化
    if (originalSize > 100000) {
      // 100KB
      wasCompressed = true
      this.stats.dataCompressionSaved++

      logger.debug(`🗜️ Compressing large log data: ${originalSize} bytes`)

      // 简单的压缩策略：移除空字段、简化重复数据
      const optimizedData = this._compressLogData(data)

      const newSize = JSON.stringify(optimizedData).length
      logger.debug(
        `✅ Data compression completed: ${originalSize} → ${newSize} bytes (${(((originalSize - newSize) / originalSize) * 100).toFixed(1)}% saved)`
      )

      return {
        ...optimizedData,
        wasCompressed
      }
    }

    return {
      ...data,
      wasCompressed
    }
  }

  /**
   * 压缩日志数据
   * @private
   * @param {Object} data 原始数据
   * @returns {Object} 压缩后的数据
   */
  _compressLogData(data) {
    const compressed = { ...data }

    // 移除空值和无效数据
    Object.keys(compressed).forEach((key) => {
      if (compressed[key] === null || compressed[key] === undefined || compressed[key] === '') {
        delete compressed[key]
      }
    })

    // 简化Headers数据
    if (compressed.requestHeaders && Object.keys(compressed.requestHeaders).length > 20) {
      compressed.requestHeaders = this._simplifyHeaders(compressed.requestHeaders)
    }

    if (compressed.responseHeaders && Object.keys(compressed.responseHeaders).length > 20) {
      compressed.responseHeaders = this._simplifyHeaders(compressed.responseHeaders)
    }

    return compressed
  }

  /**
   * 简化Headers数据
   * @private
   * @param {Object} headers Headers对象
   * @returns {Object} 简化后的Headers
   */
  _simplifyHeaders(headers) {
    const important = ['user-agent', 'content-type', 'authorization', 'x-request-id']
    const simplified = {}

    // 保留重要头部
    important.forEach((key) => {
      const value = headers[key] || headers[key.toLowerCase()]
      if (value) {
        simplified[key] = value
      }
    })

    // 添加统计信息
    simplified['_original_count'] = Object.keys(headers).length
    simplified['_simplified'] = true

    return simplified
  }

  /**
   * 更新性能指标
   * @private
   * @param {number} processingTime 处理时间（毫秒）
   */
  _updatePerformanceMetrics(processingTime) {
    this.performanceMetrics.processingTimes.push(processingTime)

    // 保持最近1000次记录
    if (this.performanceMetrics.processingTimes.length > 1000) {
      this.performanceMetrics.processingTimes.shift()
    }

    // 更新最大最小值
    this.performanceMetrics.maxProcessingTime = Math.max(
      this.performanceMetrics.maxProcessingTime,
      processingTime
    )
    this.performanceMetrics.minProcessingTime = Math.min(
      this.performanceMetrics.minProcessingTime,
      processingTime
    )

    // 计算平均处理时间
    const times = this.performanceMetrics.processingTimes
    this.stats.averageProcessingTime = times.reduce((sum, time) => sum + time, 0) / times.length
  }

  /**
   * 获取服务统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    return {
      ...this.stats,
      isEnabled: this.isEnabled,
      headersFilterStats: this.headersFilter.getFilterStats(),
      performanceMetrics: {
        ...this.performanceMetrics,
        averageProcessingTime: this.stats.averageProcessingTime,
        totalSamples: this.performanceMetrics.processingTimes.length
      },
      config: this.config,
      successRate:
        this.stats.totalRequests > 0
          ? (this.stats.successfulLogs / this.stats.totalRequests) * 100
          : 0
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
      headersFiltered: 0
    }
    logger.info('🔄 Enhanced log service stats reset')
  }

  /**
   * 更新Headers过滤配置
   * @param {string} type 类型 ('request' | 'response')
   * @param {Array<string>} whitelist 白名单数组
   */
  updateHeadersFilter(type, whitelist) {
    this.headersFilter.updateWhitelist(type, whitelist)
    logger.info(`🔄 Headers filter updated: ${type}`)
  }

  /**
   * 验证日志数据完整性
   * @param {string} logId 日志ID
   * @returns {Promise<Object>} 验证结果
   */
  async validateLogData(logId) {
    try {
      const verification = await database.verifyLogWrite(logId)
      return {
        isValid: verification.success,
        data: verification.data,
        hasHeaders: !!(verification.data?.requestHeaders || verification.data?.responseHeaders),
        hasTokenDetails: !!verification.data?.tokenDetails,
        hasCostDetails: !!verification.data?.costDetails,
        logVersion: verification.data?.logVersion || '1.0'
      }
    } catch (error) {
      logger.error(`❌ Log validation failed for ${logId}:`, error)
      return {
        isValid: false,
        error: error.message
      }
    }
  }
}

// 创建单例实例
const enhancedLogService = new EnhancedLogService()

module.exports = {
  EnhancedLogService,
  enhancedLogService
}
