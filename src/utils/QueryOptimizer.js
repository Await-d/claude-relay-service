/**
 * @fileoverview 数据库查询优化器
 *
 * 针对API Key导出、负载均衡等场景的批量查询优化
 * 支持多种数据库适配器，提供统一的优化策略
 *
 * @author Claude Code
 * @version 1.0.0
 */

const logger = require('./logger')
const { performance } = require('perf_hooks')

/**
 * 查询优化器类
 *
 * 核心特性：
 * - 批量查询优化和管道执行
 * - 智能缓存策略和TTL管理
 * - 查询计划分析和性能监控
 * - 多维度统计聚合优化
 * - 内存使用优化和流式处理
 */
class QueryOptimizer {
  constructor(database, options = {}) {
    this.database = database
    this.options = {
      // 批量查询配置
      batchSize: options.batchSize || 100,
      pipelineSize: options.pipelineSize || 50,
      maxConcurrency: options.maxConcurrency || 10,

      // 缓存配置
      enableCache: options.enableCache !== false,
      cacheTTL: options.cacheTTL || 300, // 5分钟
      cachePrefix: options.cachePrefix || 'query_cache:',

      // 性能配置
      enableProfiling: options.enableProfiling || false,
      queryTimeout: options.queryTimeout || 30000, // 30秒
      memoryLimit: options.memoryLimit || 100 * 1024 * 1024, // 100MB

      ...options
    }

    // 查询缓存
    this.queryCache = new Map()
    this.cacheStats = {
      hits: 0,
      misses: 0,
      evictions: 0
    }

    // 性能统计
    this.performanceStats = {
      totalQueries: 0,
      totalTime: 0,
      averageTime: 0,
      slowQueries: []
    }

    logger.info('🚀 QueryOptimizer initialized', {
      batchSize: this.options.batchSize,
      cacheEnabled: this.options.enableCache,
      cacheTTL: this.options.cacheTTL
    })
  }

  // ==================== API Key 导出优化 ====================

  /**
   * 优化的API Key批量导出查询
   * @param {Object} filters 过滤条件
   * @param {Object} options 查询选项
   * @returns {Promise<Array>} 优化后的API Key列表
   */
  async optimizedApiKeyExport(filters = {}, options = {}) {
    const startTime = performance.now()
    logger.info('📊 Starting optimized API key export', { filters })

    try {
      // 1. 分阶段查询策略
      const result = await this._executeApiKeyExportPlan(filters, options)

      // 2. 性能统计
      const duration = performance.now() - startTime
      this._recordPerformance('apiKeyExport', duration, result.length)

      logger.info('✅ API key export completed', {
        totalKeys: result.length,
        duration: `${duration.toFixed(2)}ms`,
        cacheHits: this.cacheStats.hits,
        cacheMisses: this.cacheStats.misses
      })

      return result
    } catch (error) {
      logger.error('❌ API key export failed', { error: error.message })
      throw error
    }
  }

  /**
   * API Key导出查询执行计划
   * @private
   */
  async _executeApiKeyExportPlan(filters, options) {
    // 阶段1: 获取基础API Key数据（使用已优化的哈希查找）
    const apiKeys = await this._getBatchApiKeys(filters)

    if (apiKeys.length === 0) {
      return []
    }

    // 阶段2: 批量获取使用统计（并行+管道）
    const enrichedKeys = await this._enrichApiKeysWithStats(apiKeys, options)

    // 阶段3: 应用高级过滤和排序
    return this._applyAdvancedFilters(enrichedKeys, filters, options)
  }

  /**
   * 批量获取API Keys（优化版本）
   * @private
   */
  async _getBatchApiKeys(filters) {
    const cacheKey = `api_keys:${JSON.stringify(filters)}`

    // 检查缓存
    const cached = this._getFromCache(cacheKey)
    if (cached) {
      return cached
    }

    let apiKeys

    // Redis优化：使用SCAN而非KEYS避免阻塞
    if (this.database.constructor.name === 'RedisAdapter') {
      apiKeys = await this._scanApiKeys()
    } else {
      // 传统查询用于其他数据库
      apiKeys = await this.database.getAllApiKeys()
    }

    // 基础过滤
    const filteredKeys = this._applyBasicFilters(apiKeys, filters)

    // 缓存结果
    this._setCache(cacheKey, filteredKeys, this.options.cacheTTL)

    return filteredKeys
  }

  /**
   * Redis SCAN优化的API Key获取
   * @private
   */
  async _scanApiKeys() {
    const apiKeys = []
    let cursor = '0'
    const { batchSize } = this.options

    do {
      const result = await this.database.client.scan(
        cursor,
        'MATCH',
        'apikey:*',
        'COUNT',
        batchSize
      )

      cursor = result[0]
      const keys = result[1].filter((key) => key !== 'apikey:hash_map')

      if (keys.length > 0) {
        // 使用管道批量获取
        const pipeline = this.database.client.pipeline()
        keys.forEach((key) => pipeline.hgetall(key))

        const results = await pipeline.exec()
        results.forEach((result, index) => {
          if (result[0] === null && result[1]) {
            const keyId = keys[index].replace('apikey:', '')
            apiKeys.push({ id: keyId, ...result[1] })
          }
        })
      }
    } while (cursor !== '0')

    return apiKeys
  }

  /**
   * 批量丰富API Key统计数据
   * @private
   */
  async _enrichApiKeysWithStats(apiKeys, options) {
    const includeUsage = options.includeUsageStats !== false
    const includeCosts = options.includeCostStats !== false

    if (!includeUsage && !includeCosts) {
      return apiKeys
    }

    logger.debug('📈 Enriching API keys with statistics', {
      totalKeys: apiKeys.length,
      includeUsage,
      includeCosts
    })

    // 分批处理避免内存溢出
    const batches = this._createBatches(apiKeys, this.options.batchSize)
    const enrichedKeys = []

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]
      logger.debug(`📊 Processing batch ${i + 1}/${batches.length} (${batch.length} keys)`)

      const enrichedBatch = await this._processBatch(batch, { includeUsage, includeCosts })
      enrichedKeys.push(...enrichedBatch)

      // 内存检查
      if (this._checkMemoryUsage()) {
        logger.warn('⚠️ Memory usage high, forcing garbage collection')
        if (global.gc) {
          global.gc()
        }
      }
    }

    return enrichedKeys
  }

  /**
   * 处理单个批次的统计数据获取
   * @private
   */
  async _processBatch(batch, options) {
    const promises = batch.map(async (apiKey) => {
      try {
        const enriched = { ...apiKey }

        if (options.includeUsage) {
          enriched.usage = await this._getCachedUsageStats(apiKey.id)
        }

        if (options.includeCosts) {
          enriched.costs = await this._getCachedCostStats(apiKey.id)
        }

        return enriched
      } catch (error) {
        logger.warn(`Failed to enrich API key ${apiKey.id}:`, error.message)
        return {
          ...apiKey,
          usage: options.includeUsage ? {} : undefined,
          costs: options.includeCosts ? {} : undefined,
          enrichmentError: error.message
        }
      }
    })

    return Promise.all(promises)
  }

  // ==================== 负载均衡查询优化 ====================

  /**
   * 优化的账户负载均衡数据查询
   * @param {Array} accountIds 账户ID列表
   * @param {Object} options 查询选项
   * @returns {Promise<Array>} 账户负载信息
   */
  async optimizedLoadBalanceQuery(accountIds = [], options = {}) {
    const startTime = performance.now()
    logger.info('⚖️ Starting optimized load balance query', {
      accountCount: accountIds.length
    })

    try {
      // 1. 并行获取账户基础信息和实时状态
      const [accounts, accountStats] = await Promise.all([
        this._getBatchAccounts(accountIds),
        this._getBatchAccountStats(accountIds, options)
      ])

      // 2. 合并数据并计算负载指标
      const loadBalanceData = this._calculateLoadMetrics(accounts, accountStats)

      // 3. 应用智能排序和筛选
      const optimizedAccounts = this._optimizeAccountSelection(loadBalanceData, options)

      const duration = performance.now() - startTime
      this._recordPerformance('loadBalanceQuery', duration, optimizedAccounts.length)

      logger.info('✅ Load balance query completed', {
        totalAccounts: optimizedAccounts.length,
        duration: `${duration.toFixed(2)}ms`,
        strategy: options.strategy || 'least_recent'
      })

      return optimizedAccounts
    } catch (error) {
      logger.error('❌ Load balance query failed', { error: error.message })
      throw error
    }
  }

  /**
   * 批量获取账户信息
   * @private
   */
  async _getBatchAccounts(accountIds) {
    if (accountIds.length === 0) {
      // 获取所有Claude账户
      const cacheKey = 'all_claude_accounts'
      const cached = this._getFromCache(cacheKey)
      if (cached) {
        return cached
      }

      const accounts = await this.database.getAllClaudeAccounts()
      this._setCache(cacheKey, accounts, 60) // 1分钟缓存
      return accounts
    }

    // 批量获取指定账户
    const batchSize = this.options.pipelineSize
    const batches = this._createBatches(accountIds, batchSize)
    const allAccounts = []

    for (const batch of batches) {
      if (this.database.constructor.name === 'RedisAdapter') {
        // Redis管道优化
        const pipeline = this.database.client.pipeline()
        batch.forEach((id) => pipeline.hgetall(`claude:account:${id}`))

        const results = await pipeline.exec()
        results.forEach((result, index) => {
          if (result[0] === null && result[1]) {
            allAccounts.push({ id: batch[index], ...result[1] })
          }
        })
      } else {
        // 其他数据库并发查询
        const batchPromises = batch.map((id) => this.database.getClaudeAccount(id))
        const batchResults = await Promise.all(batchPromises)
        allAccounts.push(...batchResults.filter((account) => account))
      }
    }

    return allAccounts
  }

  /**
   * 批量获取账户统计数据
   * @private
   */
  async _getBatchAccountStats(accountIds, options) {
    const includeRealtime = options.includeRealtime !== false
    const timeRange = options.timeRange || 'today'

    const statsPromises = accountIds.map(async (accountId) => {
      const cacheKey = `account_stats:${accountId}:${timeRange}`
      const cached = this._getFromCache(cacheKey)
      if (cached) {
        return { accountId, ...cached }
      }

      try {
        const stats = await this._getAccountStats(accountId, timeRange)
        this._setCache(cacheKey, stats, 30) // 30秒缓存
        return { accountId, ...stats }
      } catch (error) {
        logger.warn(`Failed to get stats for account ${accountId}:`, error.message)
        return { accountId, error: error.message }
      }
    })

    return Promise.all(statsPromises)
  }

  /**
   * 获取单个账户统计信息
   * @private
   */
  async _getAccountStats(accountId, timeRange) {
    const now = new Date()
    let stats = {}

    switch (timeRange) {
      case 'today':
        stats = await this.database.getAccountCostStats(accountId, 'daily')
        break
      case 'hour':
        stats = await this.database.getAccountCostStats(accountId, 'hourly')
        break
      case 'month':
        stats = await this.database.getAccountCostStats(accountId, 'monthly')
        break
      default:
        stats = await this.database.getAccountCostStats(accountId, 'all')
    }

    return {
      costs: stats.costs || {},
      usage: stats.usage || {},
      requests: stats.requests || 0,
      tokens: stats.tokens || 0,
      lastUsed: stats.lastUsed || null
    }
  }

  /**
   * 计算负载均衡指标
   * @private
   */
  _calculateLoadMetrics(accounts, accountStats) {
    return accounts.map((account) => {
      const stats = accountStats.find((s) => s.accountId === account.id) || {}

      // 计算负载指标
      const loadMetrics = {
        // 使用率指标
        hourlyRequests: stats.requests || 0,
        hourlyTokens: stats.tokens || 0,
        hourlyCost: stats.costs?.totalCost || 0,

        // 时间指标
        lastUsedTime: stats.lastUsed ? new Date(stats.lastUsed) : null,
        timeSinceLastUse: stats.lastUsed
          ? Date.now() - new Date(stats.lastUsed).getTime()
          : Infinity,

        // 权重计算
        schedulingWeight: parseFloat(account.schedulingWeight) || 1,
        usageCount: parseInt(account.usageCount) || 0,

        // 健康状态
        isHealthy: account.status !== 'error' && account.isActive === 'true',
        errorCount: account.errorCount || 0
      }

      // 计算综合负载分数（越低越优先）
      loadMetrics.loadScore = this._calculateLoadScore(loadMetrics)

      return {
        ...account,
        loadMetrics
      }
    })
  }

  /**
   * 计算负载分数
   * @private
   */
  _calculateLoadScore(metrics) {
    if (!metrics.isHealthy) {
      return Infinity // 不健康的账户排到最后
    }

    // 加权计算负载分数
    const weights = {
      usage: 0.3, // 使用次数权重
      recency: 0.4, // 最近使用时间权重
      cost: 0.2, // 成本权重
      errors: 0.1 // 错误率权重
    }

    const usageScore = metrics.usageCount * weights.usage
    const recencyScore = (metrics.timeSinceLastUse / (1000 * 60 * 60)) * weights.recency // 转换为小时
    const costScore = metrics.hourlyCost * weights.cost
    const errorScore = metrics.errorCount * weights.errors

    return usageScore + recencyScore + costScore + errorScore
  }

  /**
   * 优化账户选择
   * @private
   */
  _optimizeAccountSelection(accounts, options) {
    const strategy = options.strategy || 'least_recent'
    const maxResults = options.maxResults || accounts.length

    // 过滤不健康的账户
    let validAccounts = accounts.filter((account) => account.loadMetrics.isHealthy)

    if (validAccounts.length === 0) {
      logger.warn('⚠️ No healthy accounts available for load balancing')
      return []
    }

    // 根据策略排序
    switch (strategy) {
      case 'least_used':
        validAccounts.sort((a, b) => a.loadMetrics.usageCount - b.loadMetrics.usageCount)
        break
      case 'least_recent':
        validAccounts.sort(
          (a, b) => b.loadMetrics.timeSinceLastUse - a.loadMetrics.timeSinceLastUse
        )
        break
      case 'lowest_cost':
        validAccounts.sort((a, b) => a.loadMetrics.hourlyCost - b.loadMetrics.hourlyCost)
        break
      case 'balanced':
        validAccounts.sort((a, b) => a.loadMetrics.loadScore - b.loadMetrics.loadScore)
        break
      case 'weighted_random':
        validAccounts = this._weightedRandomShuffle(validAccounts)
        break
      default:
        // 默认使用综合负载分数
        validAccounts.sort((a, b) => a.loadMetrics.loadScore - b.loadMetrics.loadScore)
    }

    return validAccounts.slice(0, maxResults)
  }

  // ==================== 缓存管理 ====================

  /**
   * 从缓存获取数据
   * @private
   */
  _getFromCache(key) {
    if (!this.options.enableCache) {
      return null
    }

    const cached = this.queryCache.get(key)
    if (cached && cached.expiry > Date.now()) {
      this.cacheStats.hits++
      return cached.data
    }

    if (cached) {
      this.queryCache.delete(key)
      this.cacheStats.evictions++
    }

    this.cacheStats.misses++
    return null
  }

  /**
   * 设置缓存数据
   * @private
   */
  _setCache(key, data, ttlSeconds) {
    if (!this.options.enableCache) {
      return
    }

    this.queryCache.set(key, {
      data: JSON.parse(JSON.stringify(data)), // 深拷贝避免引用问题
      expiry: Date.now() + ttlSeconds * 1000
    })

    // 缓存清理
    if (this.queryCache.size > 1000) {
      this._cleanupCache()
    }
  }

  /**
   * 清理过期缓存
   * @private
   */
  _cleanupCache() {
    const now = Date.now()
    for (const [key, value] of this.queryCache.entries()) {
      if (value.expiry <= now) {
        this.queryCache.delete(key)
        this.cacheStats.evictions++
      }
    }
  }

  // ==================== 工具方法 ====================

  /**
   * 创建批次
   * @private
   */
  _createBatches(items, batchSize) {
    const batches = []
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize))
    }
    return batches
  }

  /**
   * 应用高级过滤和排序
   * @private
   */
  _applyAdvancedFilters(apiKeys, filters, options = {}) {
    let filteredKeys = [...apiKeys]

    // 高级过滤条件
    if (filters.minTokens) {
      filteredKeys = filteredKeys.filter((key) => (key.totalTokens || 0) >= filters.minTokens)
    }

    if (filters.maxTokens) {
      filteredKeys = filteredKeys.filter((key) => (key.totalTokens || 0) <= filters.maxTokens)
    }

    if (filters.minCost) {
      filteredKeys = filteredKeys.filter((key) => (key.totalCost || 0) >= filters.minCost)
    }

    if (filters.maxCost) {
      filteredKeys = filteredKeys.filter((key) => (key.totalCost || 0) <= filters.maxCost)
    }

    if (filters.tags && filters.tags.length > 0) {
      filteredKeys = filteredKeys.filter((key) => {
        const keyTags = key.tags || []
        return filters.tags.some((tag) => keyTags.includes(tag))
      })
    }

    // 排序
    if (options.sortBy) {
      filteredKeys = this._sortApiKeys(filteredKeys, options.sortBy, options.sortOrder)
    }

    // 分页
    if (options.limit || options.offset) {
      const offset = options.offset || 0
      const limit = options.limit || filteredKeys.length
      filteredKeys = filteredKeys.slice(offset, offset + limit)
    }

    return filteredKeys
  }

  /**
   * 排序API Keys
   * @private
   */
  _sortApiKeys(apiKeys, sortBy, sortOrder = 'desc') {
    return apiKeys.sort((a, b) => {
      let valueA, valueB

      switch (sortBy) {
        case 'createdAt':
          valueA = new Date(a.createdAt || 0).getTime()
          valueB = new Date(b.createdAt || 0).getTime()
          break
        case 'totalTokens':
          valueA = a.totalTokens || 0
          valueB = b.totalTokens || 0
          break
        case 'totalCost':
          valueA = a.totalCost || 0
          valueB = b.totalCost || 0
          break
        case 'requestCount':
          valueA = a.requestCount || 0
          valueB = b.requestCount || 0
          break
        case 'name':
          valueA = (a.name || '').toLowerCase()
          valueB = (b.name || '').toLowerCase()
          break
        default:
          return 0
      }

      if (sortOrder === 'asc') {
        return valueA < valueB ? -1 : valueA > valueB ? 1 : 0
      } else {
        return valueA > valueB ? -1 : valueA < valueB ? 1 : 0
      }
    })
  }

  /**
   * 应用基础过滤器
   * @private
   */
  _applyBasicFilters(items, filters) {
    return items.filter((item) => {
      if (filters.isActive !== undefined && item.isActive !== filters.isActive.toString()) {
        return false
      }
      if (filters.name && !item.name.toLowerCase().includes(filters.name.toLowerCase())) {
        return false
      }
      return true
    })
  }

  /**
   * 检查内存使用
   * @private
   */
  _checkMemoryUsage() {
    if (typeof process.memoryUsage === 'function') {
      const usage = process.memoryUsage()
      return usage.heapUsed > this.options.memoryLimit
    }
    return false
  }

  /**
   * 记录性能统计
   * @private
   */
  _recordPerformance(operation, duration, resultCount) {
    this.performanceStats.totalQueries++
    this.performanceStats.totalTime += duration
    this.performanceStats.averageTime =
      this.performanceStats.totalTime / this.performanceStats.totalQueries

    if (duration > 1000) {
      // 记录慢查询(>1秒)
      this.performanceStats.slowQueries.push({
        operation,
        duration: Math.round(duration),
        resultCount,
        timestamp: new Date().toISOString()
      })

      // 只保留最近50个慢查询
      if (this.performanceStats.slowQueries.length > 50) {
        this.performanceStats.slowQueries = this.performanceStats.slowQueries.slice(-50)
      }
    }

    if (this.options.enableProfiling) {
      logger.debug('🔍 Query Performance', {
        operation,
        duration: `${duration.toFixed(2)}ms`,
        resultCount,
        avgTime: `${this.performanceStats.averageTime.toFixed(2)}ms`
      })
    }
  }

  /**
   * 获取缓存的使用统计
   * @private
   */
  async _getCachedUsageStats(keyId) {
    const cacheKey = `usage_stats:${keyId}`
    const cached = this._getFromCache(cacheKey)
    if (cached) {
      return cached
    }

    const stats = await this.database.getUsageStats(keyId)
    this._setCache(cacheKey, stats, 60) // 1分钟缓存
    return stats
  }

  /**
   * 获取缓存的成本统计
   * @private
   */
  async _getCachedCostStats(keyId) {
    const cacheKey = `cost_stats:${keyId}`
    const cached = this._getFromCache(cacheKey)
    if (cached) {
      return cached
    }

    try {
      const stats = await this.database.getCostStats(keyId)
      this._setCache(cacheKey, stats, 60) // 1分钟缓存
      return stats
    } catch (error) {
      // 如果方法不存在，返回空对象
      return {}
    }
  }

  /**
   * 加权随机洗牌
   * @private
   */
  _weightedRandomShuffle(accounts) {
    const totalWeight = accounts.reduce(
      (sum, account) => sum + account.loadMetrics.schedulingWeight,
      0
    )

    return accounts.sort(() => {
      const random = Math.random() * totalWeight
      let current = 0
      for (const account of accounts) {
        current += account.loadMetrics.schedulingWeight
        if (random <= current) {
          return -1
        }
      }
      return 1
    })
  }

  // ==================== 性能监控 ====================

  /**
   * 获取性能统计
   */
  getPerformanceStats() {
    return {
      ...this.performanceStats,
      cacheStats: { ...this.cacheStats },
      cacheSize: this.queryCache.size,
      cacheHitRate: (this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses)) * 100
    }
  }

  /**
   * 重置性能统计
   */
  resetPerformanceStats() {
    this.performanceStats = {
      totalQueries: 0,
      totalTime: 0,
      averageTime: 0,
      slowQueries: []
    }
    this.cacheStats = {
      hits: 0,
      misses: 0,
      evictions: 0
    }
    logger.info('🔄 Performance statistics reset')
  }

  /**
   * 清除所有缓存
   */
  clearCache() {
    const cacheSize = this.queryCache.size
    this.queryCache.clear()
    this.cacheStats.evictions += cacheSize
    logger.info('🗑️ Query cache cleared', { evictedEntries: cacheSize })
  }
}

module.exports = QueryOptimizer
