const logger = require('../utils/logger')
const database = require('../models/database')
const CostCalculator = require('../utils/costCalculator')

/**
 * 智能负载均衡器
 * 实现基于成本效率的Claude账户选择算法，支持多维度权重计算和动态调整
 *
 * 核心特性：
 * - 基于成本效率的账户评分
 * - 动态权重调整（账户状态、响应时间、错误率）
 * - 智能故障检测和自动切换
 * - 实时性能监控和负载分布
 * - 与现有multi-database架构兼容
 *
 * @author Claude Code
 * @version 1.0.0
 */
class IntelligentLoadBalancer {
  constructor(options = {}) {
    // 默认权重配置
    this.weights = {
      costEfficiency: 0.4, // 成本效率权重 (40%)
      responseTime: 0.25, // 响应时间权重 (25%)
      errorRate: 0.2, // 错误率权重 (20%)
      availability: 0.15 // 可用性权重 (15%)
    }

    // 性能监控配置
    this.performanceWindow = options.performanceWindow || 300000 // 5分钟窗口
    this.maxHistorySize = options.maxHistorySize || 1000
    this.healthCheckThreshold = options.healthCheckThreshold || 0.7

    // 缓存账户性能数据
    this.accountMetrics = new Map()
    this.lastHealthCheck = new Map()

    // 成本优化配置
    this.costOptimizationEnabled = options.costOptimizationEnabled !== false
    this.maxCostThreshold = options.maxCostThreshold || 0.1 // $0.1 per request

    // 定期清理过期数据
    this.setupCleanupInterval()

    logger.info('🧠 Intelligent Load Balancer initialized with smart cost optimization')
  }

  /**
   * 智能选择最优账户
   * @param {Array} availableAccounts - 可用账户列表
   * @param {Object} requestContext - 请求上下文
   * @returns {Object} 选择结果
   */
  async selectOptimalAccount(availableAccounts, requestContext = {}) {
    try {
      if (!availableAccounts || availableAccounts.length === 0) {
        throw new Error('No available accounts provided')
      }

      const { model = 'claude-3-5-sonnet-20241022', estimatedTokens = 2000 } = requestContext

      // 单个账户直接返回
      if (availableAccounts.length === 1) {
        const account = availableAccounts[0]
        await this.updateAccountUsage(account.id)
        return {
          accountId: account.id,
          account,
          reason: 'only_available',
          metrics: await this.getAccountMetrics(account.id)
        }
      }

      logger.info(`🧠 Intelligent load balancing for ${availableAccounts.length} accounts`)

      // 计算每个账户的综合评分
      const scoredAccounts = await this.calculateAccountScores(
        availableAccounts,
        model,
        estimatedTokens
      )

      // 根据评分选择最优账户（带随机性以避免总是选择同一个）
      const selectedAccount = this.selectAccountByScore(scoredAccounts)

      if (!selectedAccount) {
        throw new Error('Failed to select optimal account')
      }

      // 更新使用统计
      await this.updateAccountUsage(selectedAccount.account.id)

      logger.success(
        `🎯 Selected optimal account: ${selectedAccount.account.name} (score: ${selectedAccount.totalScore.toFixed(3)})`
      )

      return {
        accountId: selectedAccount.account.id,
        account: selectedAccount.account,
        reason: 'intelligent_optimization',
        score: selectedAccount.totalScore,
        breakdown: selectedAccount.scoreBreakdown,
        metrics: selectedAccount.metrics
      }
    } catch (error) {
      logger.error('❌ Intelligent load balancer selection failed:', error)
      throw error
    }
  }

  /**
   * 计算账户综合评分
   * @param {Array} accounts - 账户列表
   * @param {string} model - 模型名称
   * @param {number} estimatedTokens - 预估token数量
   * @returns {Array} 评分结果
   */
  async calculateAccountScores(accounts, model, estimatedTokens) {
    const scoredAccounts = []

    for (const account of accounts) {
      try {
        const metrics = await this.getAccountMetrics(account.id)
        const costScore = this.calculateCostEfficiencyScore(account, model, estimatedTokens)
        const performanceScore = this.calculatePerformanceScore(metrics)
        const availabilityScore = this.calculateAvailabilityScore(metrics)
        const errorScore = this.calculateErrorScore(metrics)

        // 综合评分计算
        const totalScore =
          costScore * this.weights.costEfficiency +
          performanceScore * this.weights.responseTime +
          availabilityScore * this.weights.availability +
          errorScore * this.weights.errorRate

        const scoreBreakdown = {
          cost: costScore,
          performance: performanceScore,
          availability: availabilityScore,
          error: errorScore,
          weights: { ...this.weights }
        }

        scoredAccounts.push({
          account,
          totalScore,
          scoreBreakdown,
          metrics
        })

        logger.debug(
          `📊 Account ${account.name} score: ${totalScore.toFixed(3)} (cost: ${costScore.toFixed(
            3
          )}, perf: ${performanceScore.toFixed(3)}, avail: ${availabilityScore.toFixed(
            3
          )}, err: ${errorScore.toFixed(3)})`
        )
      } catch (error) {
        logger.error(`❌ Failed to calculate score for account ${account.id}:`, error)
        // 给失败的账户一个低分，但不完全排除
        scoredAccounts.push({
          account,
          totalScore: 0.1,
          scoreBreakdown: {
            cost: 0.1,
            performance: 0.1,
            availability: 0.1,
            error: 0.1
          },
          metrics: {}
        })
      }
    }

    return scoredAccounts.sort((a, b) => b.totalScore - a.totalScore)
  }

  /**
   * 计算成本效率评分
   * @param {Object} account - 账户信息
   * @param {string} model - 模型名称
   * @param {number} estimatedTokens - 预估token数量
   * @returns {number} 成本评分 (0-1)
   */
  calculateCostEfficiencyScore(account, model, estimatedTokens) {
    try {
      // 模拟使用量数据计算成本
      const mockUsage = {
        input_tokens: Math.floor(estimatedTokens * 0.7),
        output_tokens: Math.floor(estimatedTokens * 0.3),
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0
      }

      const costResult = CostCalculator.calculateCost(mockUsage, model)
      const estimatedCost = costResult.costs.total

      // 成本效率评分：成本越低评分越高
      // 使用指数衰减函数，确保成本差异被合理放大
      const costScore = Math.exp(-estimatedCost / 0.01) // 0.01 作为成本基准

      // 考虑账户历史成本表现
      const metrics = this.accountMetrics.get(account.id)
      if (metrics && metrics.avgCostPerRequest > 0) {
        const historicalCostScore = Math.exp(-metrics.avgCostPerRequest / 0.01)
        return (costScore + historicalCostScore) / 2
      }

      return Math.max(0, Math.min(1, costScore))
    } catch (error) {
      logger.warn(`⚠️ Failed to calculate cost efficiency for account ${account.id}:`, error)
      return 0.5 // 中等评分
    }
  }

  /**
   * 计算性能评分
   * @param {Object} metrics - 账户性能指标
   * @returns {number} 性能评分 (0-1)
   */
  calculatePerformanceScore(metrics) {
    if (!metrics.avgResponseTime || metrics.avgResponseTime <= 0) {
      return 0.5 // 无历史数据时给中等评分
    }

    // 响应时间评分：时间越短评分越高
    // 理想响应时间为2秒，超过10秒评分接近0
    const idealResponseTime = 2000 // 2秒
    const maxResponseTime = 10000 // 10秒

    const normalizedTime = Math.min(maxResponseTime, metrics.avgResponseTime)
    const performanceScore = Math.max(
      0,
      1 - (normalizedTime - idealResponseTime) / (maxResponseTime - idealResponseTime)
    )

    return Math.max(0, Math.min(1, performanceScore))
  }

  /**
   * 计算可用性评分
   * @param {Object} metrics - 账户性能指标
   * @returns {number} 可用性评分 (0-1)
   */
  calculateAvailabilityScore(metrics) {
    if (!metrics.totalRequests || metrics.totalRequests === 0) {
      return 0.8 // 新账户给较高的初始评分
    }

    // 可用性 = 1 - 错误率
    const successRate = 1 - (metrics.errorCount || 0) / metrics.totalRequests
    return Math.max(0, Math.min(1, successRate))
  }

  /**
   * 计算错误率评分
   * @param {Object} metrics - 账户性能指标
   * @returns {number} 错误率评分 (0-1)
   */
  calculateErrorScore(metrics) {
    if (!metrics.totalRequests || metrics.totalRequests === 0) {
      return 0.8 // 新账户给较高的初始评分
    }

    const errorRate = (metrics.errorCount || 0) / metrics.totalRequests
    // 错误率评分：错误率越低评分越高
    const errorScore = Math.exp(-errorRate * 10) // 指数衰减

    return Math.max(0, Math.min(1, errorScore))
  }

  /**
   * 根据评分选择账户（带随机性）
   * @param {Array} scoredAccounts - 已评分的账户列表
   * @returns {Object} 选择的账户
   */
  selectAccountByScore(scoredAccounts) {
    if (scoredAccounts.length === 0) {
      return null
    }

    // 使用加权随机选择以避免总是选择最高分账户
    // 给高分账户更高的选择概率，但保留一定随机性
    const totalScore = scoredAccounts.reduce((sum, acc) => sum + Math.pow(acc.totalScore, 2), 0)

    if (totalScore === 0) {
      // 所有账户评分都很低，随机选择
      return scoredAccounts[Math.floor(Math.random() * scoredAccounts.length)]
    }

    let randomValue = Math.random() * totalScore
    for (const scoredAccount of scoredAccounts) {
      randomValue -= Math.pow(scoredAccount.totalScore, 2)
      if (randomValue <= 0) {
        return scoredAccount
      }
    }

    // 后备：返回最高分账户
    return scoredAccounts[0]
  }

  /**
   * 获取账户性能指标
   * @param {string} accountId - 账户ID
   * @returns {Object} 性能指标
   */
  async getAccountMetrics(accountId) {
    try {
      // 从缓存获取
      let metrics = this.accountMetrics.get(accountId)

      if (!metrics || Date.now() - metrics.lastUpdated > 60000) {
        // 缓存过期或不存在，从数据库重新计算
        metrics = await this.calculateAccountMetrics(accountId)
        this.accountMetrics.set(accountId, metrics)
      }

      return metrics
    } catch (error) {
      logger.error(`❌ Failed to get metrics for account ${accountId}:`, error)
      return {
        totalRequests: 0,
        errorCount: 0,
        avgResponseTime: 2000,
        avgCostPerRequest: 0,
        lastUpdated: Date.now()
      }
    }
  }

  /**
   * 计算账户性能指标
   * @param {string} accountId - 账户ID
   * @returns {Object} 性能指标
   */
  async calculateAccountMetrics(accountId) {
    try {
      const now = Date.now()
      const windowStart = now - this.performanceWindow

      // 获取时间窗口内的使用统计
      const usageStats = await database.getAccountUsageInTimeWindow(accountId, windowStart, now)

      // 计算聚合指标
      const totalRequests = usageStats.length
      const errorCount = usageStats.filter((stat) => stat.status === 'error').length
      const successfulRequests = usageStats.filter((stat) => stat.status === 'success')

      // 计算平均响应时间
      const avgResponseTime =
        successfulRequests.length > 0
          ? successfulRequests.reduce((sum, stat) => sum + (stat.responseTime || 2000), 0) /
            successfulRequests.length
          : 2000

      // 计算平均成本
      const avgCostPerRequest =
        successfulRequests.length > 0
          ? successfulRequests.reduce((sum, stat) => sum + (stat.cost || 0), 0) /
            successfulRequests.length
          : 0

      const metrics = {
        totalRequests,
        errorCount,
        avgResponseTime,
        avgCostPerRequest,
        successRate: totalRequests > 0 ? (totalRequests - errorCount) / totalRequests : 1,
        lastUpdated: now
      }

      logger.debug(`📊 Calculated metrics for account ${accountId}:`, metrics)

      return metrics
    } catch (error) {
      logger.error(`❌ Failed to calculate metrics for account ${accountId}:`, error)
      // 返回默认指标
      return {
        totalRequests: 0,
        errorCount: 0,
        avgResponseTime: 2000,
        avgCostPerRequest: 0,
        successRate: 1,
        lastUpdated: Date.now()
      }
    }
  }

  /**
   * 更新账户使用统计
   * @param {string} accountId - 账户ID
   * @param {Object} usage - 使用信息
   */
  async updateAccountUsage(accountId, usage = {}) {
    try {
      const now = Date.now()
      const { responseTime = null, cost = null, status = 'success' } = usage

      // 更新数据库中的使用记录
      await database.recordAccountUsage(accountId, {
        timestamp: now,
        responseTime,
        cost,
        status,
        ...usage
      })

      // 使本地缓存失效
      const metrics = this.accountMetrics.get(accountId)
      if (metrics) {
        metrics.lastUpdated = 0 // 强制重新计算
      }

      logger.debug(`📈 Updated usage for account ${accountId}`)
    } catch (error) {
      logger.error(`❌ Failed to update account usage for ${accountId}:`, error)
    }
  }

  /**
   * 健康检查和故障检测
   * @param {Array} accounts - 账户列表
   * @returns {Array} 健康的账户列表
   */
  async performHealthCheck(accounts) {
    const healthyAccounts = []

    for (const account of accounts) {
      try {
        const metrics = await this.getAccountMetrics(account.id)
        const healthScore = this.calculateHealthScore(metrics)

        if (healthScore >= this.healthCheckThreshold) {
          healthyAccounts.push(account)
        } else {
          logger.warn(
            `⚠️ Account ${account.name} failed health check (score: ${healthScore.toFixed(3)})`
          )
        }

        this.lastHealthCheck.set(account.id, {
          timestamp: Date.now(),
          score: healthScore,
          healthy: healthScore >= this.healthCheckThreshold
        })
      } catch (error) {
        logger.error(`❌ Health check failed for account ${account.id}:`, error)
        // 健康检查失败的账户暂时排除
      }
    }

    logger.info(
      `🏥 Health check completed: ${healthyAccounts.length}/${accounts.length} accounts healthy`
    )

    return healthyAccounts
  }

  /**
   * 计算账户健康评分
   * @param {Object} metrics - 性能指标
   * @returns {number} 健康评分 (0-1)
   */
  calculateHealthScore(metrics) {
    if (!metrics.totalRequests || metrics.totalRequests === 0) {
      return 0.8 // 新账户默认健康
    }

    const availabilityScore = this.calculateAvailabilityScore(metrics)
    const performanceScore = this.calculatePerformanceScore(metrics)
    const errorScore = this.calculateErrorScore(metrics)

    // 健康评分是各项指标的加权平均
    return availabilityScore * 0.5 + performanceScore * 0.3 + errorScore * 0.2
  }

  /**
   * 获取负载均衡统计信息
   * @returns {Object} 统计信息
   */
  getLoadBalancerStats() {
    const stats = {
      totalAccountsTracked: this.accountMetrics.size,
      healthChecks: this.lastHealthCheck.size,
      configuration: {
        weights: { ...this.weights },
        performanceWindow: this.performanceWindow,
        healthCheckThreshold: this.healthCheckThreshold,
        costOptimizationEnabled: this.costOptimizationEnabled
      },
      cacheStats: {
        accountMetrics: this.accountMetrics.size,
        oldestEntry: this.getOldestCacheEntry()
      }
    }

    return stats
  }

  /**
   * 更新权重配置
   * @param {Object} newWeights - 新的权重配置
   */
  updateWeights(newWeights) {
    // 验证权重总和为1
    const totalWeight = Object.values(newWeights).reduce((sum, weight) => sum + weight, 0)
    if (Math.abs(totalWeight - 1) > 0.01) {
      throw new Error(`Weight sum must equal 1, got ${totalWeight}`)
    }

    this.weights = { ...this.weights, ...newWeights }
    logger.info('🔧 Updated load balancer weights:', this.weights)
  }

  /**
   * 清理过期缓存数据
   */
  cleanup() {
    const now = Date.now()
    const maxAge = this.performanceWindow * 2 // 保留2倍时间窗口的数据

    // 清理性能指标缓存
    for (const [accountId, metrics] of this.accountMetrics.entries()) {
      if (now - metrics.lastUpdated > maxAge) {
        this.accountMetrics.delete(accountId)
      }
    }

    // 清理健康检查缓存
    for (const [accountId, healthCheck] of this.lastHealthCheck.entries()) {
      if (now - healthCheck.timestamp > maxAge) {
        this.lastHealthCheck.delete(accountId)
      }
    }

    logger.debug(`🧹 Cleaned up load balancer cache`)
  }

  /**
   * 获取最旧的缓存条目时间
   * @returns {number} 时间戳
   */
  getOldestCacheEntry() {
    let oldest = Date.now()

    for (const metrics of this.accountMetrics.values()) {
      if (metrics.lastUpdated < oldest) {
        oldest = metrics.lastUpdated
      }
    }

    return oldest
  }

  /**
   * 设置清理定时器
   */
  setupCleanupInterval() {
    // 每5分钟清理一次
    setInterval(() => {
      this.cleanup()
    }, 300000)

    logger.debug('⏰ Set up load balancer cleanup interval')
  }
}

module.exports = IntelligentLoadBalancer
