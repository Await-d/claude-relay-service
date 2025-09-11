/**
 * @fileoverview Excel数据查询适配器
 *
 * 负责为Excel导出功能查询和聚合所需的数据，包括：
 * - API Keys基础信息查询
 * - 使用统计数据聚合
 * - 成本分析数据计算
 * - 模型使用情况分析
 * - 时间趋势数据处理
 *
 * @author Claude Code
 * @version 1.0.0
 */

const _moment = require('moment')
const logger = require('./logger')

/**
 * Excel数据查询适配器
 *
 * 功能特性：
 * - 高性能批量数据查询
 * - 多维度数据聚合
 * - 智能缓存机制
 * - 数据库兼容性桥接
 * - 错误处理和降级
 */
class ExcelDataQueryAdapter {
  constructor(compatibilityBridge) {
    if (!compatibilityBridge) {
      throw new Error('UpstreamCompatibilityBridge is required for ExcelDataQueryAdapter')
    }

    this.bridge = compatibilityBridge
    this.cache = new Map()
    this.cacheTimeout = 5 * 60 * 1000 // 5分钟缓存

    // 查询统计
    this.stats = {
      totalQueries: 0,
      cacheHits: 0,
      averageQueryTime: 0,
      queryTimes: []
    }

    logger.info('🔍 ExcelDataQueryAdapter initialized successfully')
  }

  // ==================== API Keys数据查询 ====================

  /**
   * 获取API Keys及其统计数据
   * @param {Array<string>} keyIds API Key IDs，空数组表示查询全部
   * @param {Object} timeRange 时间范围
   * @returns {Promise<Array>} API Keys数据数组
   */
  async getApiKeysWithStats(keyIds = [], timeRange = {}) {
    const startTime = Date.now()

    try {
      logger.debug(`🔍 Querying API Keys with stats`, { keyIds: keyIds.length, timeRange })

      // 1. 获取API Keys基础信息
      const allApiKeys = await this.bridge.getAllApiKeys()
      const targetKeys =
        keyIds.length > 0 ? allApiKeys.filter((key) => keyIds.includes(key.id)) : allApiKeys

      if (targetKeys.length === 0) {
        logger.warn('⚠️ No API Keys found for export')
        return []
      }

      // 2. 并行获取每个API Key的统计数据
      const apiKeysWithStats = await this._batchQueryApiKeyStats(targetKeys, timeRange)

      // 3. 记录查询统计
      const queryTime = Date.now() - startTime
      this._recordQueryStats('getApiKeysWithStats', queryTime)

      logger.success(
        `✅ Retrieved ${apiKeysWithStats.length} API Keys with stats in ${queryTime}ms`
      )

      return apiKeysWithStats
    } catch (error) {
      logger.error('❌ Failed to get API Keys with stats:', error)
      throw new Error(`Failed to query API Keys data: ${error.message}`)
    }
  }

  /**
   * 批量查询API Key统计数据
   * @private
   * @param {Array} apiKeys API Keys数组
   * @param {Object} timeRange 时间范围
   * @returns {Promise<Array>} 带统计数据的API Keys
   */
  async _batchQueryApiKeyStats(apiKeys, timeRange) {
    const batchSize = 10 // 每批查询10个API Key
    const results = []

    for (let i = 0; i < apiKeys.length; i += batchSize) {
      const batch = apiKeys.slice(i, i + batchSize)

      const batchPromises = batch.map(async (apiKey) => {
        try {
          // 获取使用统计
          const usage = await this._getApiKeyUsage(apiKey.id, timeRange)

          // 获取成本统计
          const costs = await this._getApiKeyCosts(apiKey.id, timeRange)

          // 获取模型使用情况
          const modelUsage = await this._getApiKeyModelUsage(apiKey.id, timeRange)

          // 合并数据
          return {
            ...apiKey,
            usage,
            costs,
            modelUsage,
            // 计算衍生指标
            utilizationRate: this._calculateUtilizationRate(apiKey, usage),
            costEfficiency: this._calculateCostEfficiency(usage, costs),
            averageTokensPerRequest: this._calculateAverageTokensPerRequest(usage)
          }
        } catch (error) {
          logger.warn(`⚠️ Failed to get stats for API Key ${apiKey.id}:`, error.message)

          // 返回基础信息，统计数据为空
          return {
            ...apiKey,
            usage: this._getEmptyUsageStats(),
            costs: this._getEmptyCostStats(),
            modelUsage: [],
            utilizationRate: 0,
            costEfficiency: 0,
            averageTokensPerRequest: 0
          }
        }
      })

      const batchResults = await Promise.all(batchPromises)
      results.push(...batchResults)

      // 添加小延迟避免过度负载
      if (i + batchSize < apiKeys.length) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }

    return results
  }

  // ==================== 使用统计查询 ====================

  /**
   * 获取使用统计数据
   * @param {Array<string>} keyIds API Key IDs
   * @param {Object} timeRange 时间范围
   * @returns {Promise<Object>} 聚合的使用统计数据
   */
  async getUsageStatistics(keyIds = [], timeRange = {}) {
    const startTime = Date.now()

    try {
      logger.debug(`📊 Querying usage statistics`, { keyIds: keyIds.length, timeRange })

      const cacheKey = this._generateCacheKey('usage', keyIds, timeRange)
      const cached = this._getCachedData(cacheKey)
      if (cached) {
        this.stats.cacheHits++
        return cached
      }

      // 构建聚合统计
      const aggregatedStats = {
        totalKeys: keyIds.length,
        timeRange,
        summary: {
          totalRequests: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTokens: 0,
          averageRequestsPerKey: 0,
          averageTokensPerKey: 0,
          peakUsageDate: null,
          peakUsageValue: 0
        },
        keyBreakdown: [],
        dailyTrends: [],
        modelBreakdown: [],
        hourlyDistribution: Array(24).fill(0)
      }

      // 并行查询每个API Key的使用数据
      const keyUsagePromises = keyIds.map((keyId) => this._getDetailedUsageStats(keyId, timeRange))
      const keyUsageResults = await Promise.all(keyUsagePromises)

      // 聚合数据
      for (let i = 0; i < keyIds.length; i++) {
        const keyId = keyIds[i]
        const keyUsage = keyUsageResults[i]

        // 添加到按键统计
        aggregatedStats.keyBreakdown.push({
          keyId,
          ...keyUsage
        })

        // 累加到总计
        aggregatedStats.summary.totalRequests += keyUsage.totalRequests
        aggregatedStats.summary.totalInputTokens += keyUsage.totalInputTokens
        aggregatedStats.summary.totalOutputTokens += keyUsage.totalOutputTokens
        aggregatedStats.summary.totalTokens += keyUsage.totalTokens

        // 更新峰值使用
        if (keyUsage.peakUsageValue > aggregatedStats.summary.peakUsageValue) {
          aggregatedStats.summary.peakUsageValue = keyUsage.peakUsageValue
          aggregatedStats.summary.peakUsageDate = keyUsage.peakUsageDate
        }

        // 聚合模型使用情况
        this._aggregateModelUsage(aggregatedStats.modelBreakdown, keyUsage.modelUsage)

        // 聚合时间分布
        this._aggregateHourlyDistribution(
          aggregatedStats.hourlyDistribution,
          keyUsage.hourlyDistribution
        )
      }

      // 计算平均值
      if (aggregatedStats.totalKeys > 0) {
        aggregatedStats.summary.averageRequestsPerKey = Math.round(
          aggregatedStats.summary.totalRequests / aggregatedStats.totalKeys
        )
        aggregatedStats.summary.averageTokensPerKey = Math.round(
          aggregatedStats.summary.totalTokens / aggregatedStats.totalKeys
        )
      }

      // 生成每日趋势
      aggregatedStats.dailyTrends = await this._generateDailyTrends(keyIds, timeRange)

      // 缓存结果
      this._setCachedData(cacheKey, aggregatedStats)

      const queryTime = Date.now() - startTime
      this._recordQueryStats('getUsageStatistics', queryTime)

      logger.success(`✅ Generated usage statistics for ${keyIds.length} keys in ${queryTime}ms`)

      return aggregatedStats
    } catch (error) {
      logger.error('❌ Failed to get usage statistics:', error)
      throw new Error(`Failed to query usage statistics: ${error.message}`)
    }
  }

  // ==================== 成本分析查询 ====================

  /**
   * 获取成本统计数据
   * @param {Array<string>} keyIds API Key IDs
   * @param {Object} timeRange 时间范围
   * @returns {Promise<Object>} 成本分析数据
   */
  async getCostStatistics(keyIds = [], timeRange = {}) {
    const startTime = Date.now()

    try {
      logger.debug(`💰 Querying cost statistics`, { keyIds: keyIds.length, timeRange })

      const cacheKey = this._generateCacheKey('costs', keyIds, timeRange)
      const cached = this._getCachedData(cacheKey)
      if (cached) {
        this.stats.cacheHits++
        return cached
      }

      const aggregatedCosts = {
        totalKeys: keyIds.length,
        timeRange,
        summary: {
          totalCost: 0,
          averageCostPerKey: 0,
          averageCostPerRequest: 0,
          averageCostPerToken: 0,
          highestCostKey: null,
          highestCostValue: 0,
          currency: 'USD'
        },
        keyBreakdown: [],
        dailyCosts: [],
        modelCosts: [],
        costTrends: []
      }

      // 并行查询成本数据
      const costPromises = keyIds.map((keyId) => this._getDetailedCostStats(keyId, timeRange))
      const costResults = await Promise.all(costPromises)

      // 聚合成本数据
      for (let i = 0; i < keyIds.length; i++) {
        const keyId = keyIds[i]
        const keyCost = costResults[i]

        aggregatedCosts.keyBreakdown.push({
          keyId,
          ...keyCost
        })

        // 累加总成本
        aggregatedCosts.summary.totalCost += keyCost.totalCost

        // 更新最高成本API Key
        if (keyCost.totalCost > aggregatedCosts.summary.highestCostValue) {
          aggregatedCosts.summary.highestCostValue = keyCost.totalCost
          aggregatedCosts.summary.highestCostKey = keyId
        }

        // 聚合模型成本
        this._aggregateModelCosts(aggregatedCosts.modelCosts, keyCost.modelCosts)
      }

      // 计算平均值和比率
      if (aggregatedCosts.totalKeys > 0) {
        aggregatedCosts.summary.averageCostPerKey =
          aggregatedCosts.summary.totalCost / aggregatedCosts.totalKeys
      }

      // 获取总请求数和Token数用于计算单位成本
      const totalRequests = aggregatedCosts.keyBreakdown.reduce(
        (sum, key) => sum + key.totalRequests,
        0
      )
      const totalTokens = aggregatedCosts.keyBreakdown.reduce(
        (sum, key) => sum + key.totalTokens,
        0
      )

      if (totalRequests > 0) {
        aggregatedCosts.summary.averageCostPerRequest =
          aggregatedCosts.summary.totalCost / totalRequests
      }

      if (totalTokens > 0) {
        aggregatedCosts.summary.averageCostPerToken =
          aggregatedCosts.summary.totalCost / totalTokens
      }

      // 生成每日成本趋势
      aggregatedCosts.dailyCosts = await this._generateDailyCostTrends(keyIds, timeRange)

      // 缓存结果
      this._setCachedData(cacheKey, aggregatedCosts)

      const queryTime = Date.now() - startTime
      this._recordQueryStats('getCostStatistics', queryTime)

      logger.success(`✅ Generated cost statistics for ${keyIds.length} keys in ${queryTime}ms`)

      return aggregatedCosts
    } catch (error) {
      logger.error('❌ Failed to get cost statistics:', error)
      throw new Error(`Failed to query cost statistics: ${error.message}`)
    }
  }

  // ==================== 模型使用情况查询 ====================

  /**
   * 获取模型使用情况详细分析
   * @param {Array<string>} keyIds API Key IDs
   * @param {Object} timeRange 时间范围
   * @returns {Promise<Array>} 模型使用详情数组
   */
  async getModelUsageBreakdown(keyIds = [], timeRange = {}) {
    const startTime = Date.now()

    try {
      logger.debug(`🤖 Querying model usage breakdown`, { keyIds: keyIds.length, timeRange })

      const modelBreakdown = []

      // 为每个API Key查询模型使用情况
      for (const keyId of keyIds) {
        const keyModelUsage = await this._getApiKeyModelUsage(keyId, timeRange)

        for (const modelData of keyModelUsage) {
          // 查找是否已存在该模型的记录
          let existingModel = modelBreakdown.find((m) => m.model === modelData.model)

          if (!existingModel) {
            existingModel = {
              model: modelData.model,
              totalRequests: 0,
              totalInputTokens: 0,
              totalOutputTokens: 0,
              totalTokens: 0,
              totalCost: 0,
              averageResponseTime: 0,
              successRate: 0,
              keyUsage: []
            }
            modelBreakdown.push(existingModel)
          }

          // 聚合数据
          existingModel.totalRequests += modelData.requests
          existingModel.totalInputTokens += modelData.inputTokens
          existingModel.totalOutputTokens += modelData.outputTokens
          existingModel.totalTokens += modelData.totalTokens
          existingModel.totalCost += modelData.cost

          // 添加按Key的使用情况
          existingModel.keyUsage.push({
            keyId,
            requests: modelData.requests,
            inputTokens: modelData.inputTokens,
            outputTokens: modelData.outputTokens,
            cost: modelData.cost,
            averageResponseTime: modelData.averageResponseTime,
            successRate: modelData.successRate
          })
        }
      }

      // 计算聚合指标
      for (const model of modelBreakdown) {
        if (model.keyUsage.length > 0) {
          // 计算平均响应时间
          const totalResponseTime = model.keyUsage.reduce(
            (sum, key) => sum + key.averageResponseTime * key.requests,
            0
          )
          model.averageResponseTime =
            model.totalRequests > 0 ? totalResponseTime / model.totalRequests : 0

          // 计算成功率
          const totalSuccessfulRequests = model.keyUsage.reduce(
            (sum, key) => sum + (key.requests * key.successRate) / 100,
            0
          )
          model.successRate =
            model.totalRequests > 0 ? (totalSuccessfulRequests / model.totalRequests) * 100 : 0
        }
      }

      // 按使用量排序
      modelBreakdown.sort((a, b) => b.totalRequests - a.totalRequests)

      const queryTime = Date.now() - startTime
      this._recordQueryStats('getModelUsageBreakdown', queryTime)

      logger.success(
        `✅ Generated model usage breakdown for ${modelBreakdown.length} models in ${queryTime}ms`
      )

      return modelBreakdown
    } catch (error) {
      logger.error('❌ Failed to get model usage breakdown:', error)
      throw new Error(`Failed to query model usage breakdown: ${error.message}`)
    }
  }

  // ==================== 私有辅助方法 ====================

  /**
   * 获取API Key使用统计
   * @private
   */
  async _getApiKeyUsage(keyId, timeRange) {
    try {
      const usage = await this.bridge.getUsageStats(keyId, {
        start: timeRange.start,
        end: timeRange.end
      })

      return {
        totalRequests: usage.totalRequests || 0,
        totalInputTokens: usage.totalInputTokens || 0,
        totalOutputTokens: usage.totalOutputTokens || 0,
        totalTokens: (usage.totalInputTokens || 0) + (usage.totalOutputTokens || 0),
        firstRequestAt: usage.firstRequestAt || null,
        lastRequestAt: usage.lastRequestAt || null
      }
    } catch (error) {
      logger.warn(`⚠️ Failed to get usage for key ${keyId}:`, error.message)
      return this._getEmptyUsageStats()
    }
  }

  /**
   * 获取API Key成本统计
   * @private
   */
  async _getApiKeyCosts(keyId, timeRange) {
    try {
      const costs = await this.bridge.getCostStats(keyId, {
        start: timeRange.start,
        end: timeRange.end
      })

      return {
        totalCost: costs.totalCost || 0,
        dailyAverage: costs.dailyAverage || 0,
        currency: costs.currency || 'USD'
      }
    } catch (error) {
      logger.warn(`⚠️ Failed to get costs for key ${keyId}:`, error.message)
      return this._getEmptyCostStats()
    }
  }

  /**
   * 获取API Key模型使用情况
   * @private
   */
  async _getApiKeyModelUsage(_keyId, _timeRange) {
    // 这里需要实现从数据库查询模型使用情况的逻辑
    // 暂时返回模拟数据结构
    return [
      {
        model: 'claude-3-haiku',
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cost: 0,
        averageResponseTime: 0,
        successRate: 100
      }
    ]
  }

  /**
   * 计算使用率
   * @private
   */
  _calculateUtilizationRate(apiKey, usage) {
    if (!apiKey.tokenLimit || apiKey.tokenLimit === 0) {
      return 0
    }

    return Math.min(100, (usage.totalTokens / parseInt(apiKey.tokenLimit)) * 100)
  }

  /**
   * 计算成本效率
   * @private
   */
  _calculateCostEfficiency(usage, costs) {
    if (costs.totalCost === 0 || usage.totalTokens === 0) {
      return 0
    }

    // 成本效率：每美元获得的Token数
    return usage.totalTokens / costs.totalCost
  }

  /**
   * 计算平均每请求Token数
   * @private
   */
  _calculateAverageTokensPerRequest(usage) {
    if (usage.totalRequests === 0) {
      return 0
    }

    return Math.round(usage.totalTokens / usage.totalRequests)
  }

  /**
   * 获取空的使用统计
   * @private
   */
  _getEmptyUsageStats() {
    return {
      totalRequests: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      firstRequestAt: null,
      lastRequestAt: null
    }
  }

  /**
   * 获取空的成本统计
   * @private
   */
  _getEmptyCostStats() {
    return {
      totalCost: 0,
      dailyAverage: 0,
      currency: 'USD'
    }
  }

  // ==================== 缓存管理 ====================

  /**
   * 生成缓存键
   * @private
   */
  _generateCacheKey(type, keyIds, timeRange) {
    const keyIdsStr = Array.isArray(keyIds) ? keyIds.sort().join(',') : ''
    const timeRangeStr = `${timeRange.start || ''}-${timeRange.end || ''}`
    return `${type}:${keyIdsStr}:${timeRangeStr}`
  }

  /**
   * 获取缓存数据
   * @private
   */
  _getCachedData(key) {
    const cached = this.cache.get(key)
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data
    }

    if (cached) {
      this.cache.delete(key) // 清理过期缓存
    }

    return null
  }

  /**
   * 设置缓存数据
   * @private
   */
  _setCachedData(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    })

    // 限制缓存大小
    if (this.cache.size > 100) {
      const firstKey = this.cache.keys().next().value
      this.cache.delete(firstKey)
    }
  }

  /**
   * 记录查询统计
   * @private
   */
  _recordQueryStats(method, queryTime) {
    this.stats.totalQueries++
    this.stats.queryTimes.push(queryTime)

    // 保持最近100次查询的记录
    if (this.stats.queryTimes.length > 100) {
      this.stats.queryTimes = this.stats.queryTimes.slice(-100)
    }

    // 计算平均查询时间
    this.stats.averageQueryTime =
      this.stats.queryTimes.reduce((sum, time) => sum + time, 0) / this.stats.queryTimes.length
  }

  // ==================== 统计和监控 ====================

  /**
   * 获取查询适配器统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    return {
      ...this.stats,
      cacheHitRate:
        this.stats.totalQueries > 0
          ? `${((this.stats.cacheHits / this.stats.totalQueries) * 100).toFixed(2)}%`
          : '0%',
      cacheSize: this.cache.size,
      averageQueryTime: `${Math.round(this.stats.averageQueryTime)}ms`
    }
  }

  /**
   * 清理缓存
   */
  clearCache() {
    this.cache.clear()
    logger.info('🧹 ExcelDataQueryAdapter cache cleared')
  }
}

module.exports = ExcelDataQueryAdapter
