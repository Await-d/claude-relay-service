const logger = require('../utils/logger')
const database = require('../models/database')
const {
  getTimezoneStartOfWeek,
  getTimezoneStartOfMonth,
  getNextResetTime
} = require('../utils/dateHelper')

/**
 * 增强费用限制服务
 * 支持多时间周期的费用限制检查和缓存优化
 * 向下兼容现有的 dailyCostLimit 字段
 */
class CostLimitService {
  constructor() {
    // 缓存配置
    this.cacheEnabled = true
    this.cachePrefix = 'cost_limit_cache'
    this.cacheTTL = 300 // 5分钟缓存

    // 预警阈值配置
    this.warningThresholds = {
      high: 0.9, // 90% 发出高级预警
      medium: 0.75, // 75% 发出中级预警
      low: 0.5 // 50% 发出低级预警
    }

    // 时间周期配置
    this.timePeriods = {
      daily: { duration: 24 * 60 * 60 * 1000, label: '每日' },
      weekly: { duration: 7 * 24 * 60 * 60 * 1000, label: '每周' },
      monthly: { duration: 30 * 24 * 60 * 60 * 1000, label: '每月' }
    }
  }

  /**
   * 检查费用限制（主要入口方法）
   * @param {string} apiKeyId - API Key ID
   * @param {Object} keyData - API Key 数据，包含费用限制配置
   * @returns {Promise<Object>} 检查结果
   */
  async checkCostLimits(apiKeyId, keyData) {
    try {
      const startTime = Date.now()

      // 获取所有费用限制配置
      const limits = this._extractCostLimits(keyData)

      // 如果没有配置任何费用限制，直接通过
      if (!this._hasAnyLimit(limits)) {
        logger.debug(`💰 No cost limits configured for API key: ${apiKeyId}`)
        return { allowed: true, limits, currentCosts: {}, warnings: [] }
      }

      // 获取当前费用使用情况（带缓存）
      const currentCosts = await this._getCurrentCosts(apiKeyId)

      // 检查每个时间周期的限制
      const violations = []
      const warnings = []

      for (const [period, limit] of Object.entries(limits)) {
        if (limit <= 0) {
          continue
        } // 跳过未配置的限制

        const currentCost = currentCosts[period] || 0
        const usage = currentCost / limit

        // 检查是否超过限制
        if (currentCost >= limit) {
          violations.push({
            period,
            limit,
            current: currentCost,
            usage: Math.min(usage, 1.0),
            resetTime: getNextResetTime(period)
          })
        }
        // 检查是否需要发出预警
        else if (usage >= this.warningThresholds.low) {
          warnings.push({
            level: this._getWarningLevel(usage),
            period,
            limit,
            current: currentCost,
            usage,
            resetTime: getNextResetTime(period)
          })
        }
      }

      const checkDuration = Date.now() - startTime

      if (violations.length > 0) {
        logger.security(
          `💰 Cost limit exceeded for API key: ${apiKeyId}, violations: ${violations.length}, check time: ${checkDuration}ms`
        )
        return {
          allowed: false,
          violations,
          warnings,
          limits,
          currentCosts,
          checkDuration
        }
      }

      if (warnings.length > 0) {
        logger.warn(
          `💰 Cost usage warning for API key: ${apiKeyId}, warnings: ${warnings.length}, check time: ${checkDuration}ms`
        )
      } else {
        logger.debug(
          `💰 Cost limits check passed for API key: ${apiKeyId}, check time: ${checkDuration}ms`
        )
      }

      return {
        allowed: true,
        violations: [],
        warnings,
        limits,
        currentCosts,
        checkDuration
      }
    } catch (error) {
      logger.error(`❌ Cost limit check error for API key: ${apiKeyId}:`, error)
      // 发生错误时允许通过，避免阻塞正常请求
      return {
        allowed: true,
        error: error.message,
        limits: {},
        currentCosts: {},
        warnings: []
      }
    }
  }

  /**
   * 提取费用限制配置（向下兼容）
   * @param {Object} keyData - API Key 数据
   * @returns {Object} 费用限制配置
   */
  _extractCostLimits(keyData) {
    const limits = {}

    // 向下兼容：dailyCostLimit -> daily
    if (keyData.dailyCostLimit && keyData.dailyCostLimit > 0) {
      limits.daily = parseFloat(keyData.dailyCostLimit)
    }

    // 扩展支持其他时间周期
    if (keyData.weeklyCostLimit && keyData.weeklyCostLimit > 0) {
      limits.weekly = parseFloat(keyData.weeklyCostLimit)
    }

    if (keyData.monthlyCostLimit && keyData.monthlyCostLimit > 0) {
      limits.monthly = parseFloat(keyData.monthlyCostLimit)
    }

    if (keyData.totalCostLimit && keyData.totalCostLimit > 0) {
      limits.total = parseFloat(keyData.totalCostLimit)
    }

    return limits
  }

  /**
   * 检查是否配置了任何费用限制
   * @param {Object} limits - 费用限制配置
   * @returns {boolean} 是否有配置
   */
  _hasAnyLimit(limits) {
    return Object.values(limits).some((limit) => limit > 0)
  }

  /**
   * 获取当前费用使用情况（带缓存优化）
   * @param {string} apiKeyId - API Key ID
   * @returns {Promise<Object>} 当前费用数据
   */
  async _getCurrentCosts(apiKeyId) {
    try {
      const cacheKey = `${this.cachePrefix}:${apiKeyId}`

      // 尝试从缓存获取
      if (this.cacheEnabled) {
        const dbClient = database.getClient()
        if (dbClient) {
          const cachedData = await dbClient.get(cacheKey)
          if (cachedData) {
            const parsed = JSON.parse(cachedData)
            logger.debug(`💰 Cost data cache hit for API key: ${apiKeyId}`)
            return parsed
          }
        }
      }

      // 缓存未命中，从数据库获取
      const costs = {}

      // 获取每日费用（向下兼容现有方法）
      costs.daily = (await database.getDailyCost(apiKeyId)) || 0

      // 获取其他时间周期的费用
      costs.weekly = (await this._getWeeklyCost(apiKeyId)) || 0
      costs.monthly = (await this._getMonthlyCost(apiKeyId)) || 0
      costs.total = (await this._getTotalCost(apiKeyId)) || 0

      // 存入缓存
      if (this.cacheEnabled) {
        const dbClient = database.getClient()
        if (dbClient) {
          await dbClient.setex(cacheKey, this.cacheTTL, JSON.stringify(costs))
          logger.debug(`💰 Cost data cached for API key: ${apiKeyId}`)
        }
      }

      return costs
    } catch (error) {
      logger.warn(`⚠️ Failed to get current costs for API key: ${apiKeyId}:`, error.message)
      // 返回默认值
      return { daily: 0, weekly: 0, monthly: 0, total: 0 }
    }
  }

  /**
   * 获取每周费用
   * @param {string} apiKeyId - API Key ID
   * @returns {Promise<number>} 每周费用
   */
  async _getWeeklyCost(apiKeyId) {
    try {
      // 使用时区边界计算，获取本周的费用数据
      const now = new Date()
      const weekStart = getTimezoneStartOfWeek(now)

      return await database.getCostByDateRange(apiKeyId, weekStart, now)
    } catch (error) {
      logger.debug(`Failed to get weekly cost for API key: ${apiKeyId}:`, error.message)
      return 0
    }
  }

  /**
   * 获取每月费用
   * @param {string} apiKeyId - API Key ID
   * @returns {Promise<number>} 每月费用
   */
  async _getMonthlyCost(apiKeyId) {
    try {
      // 使用时区边界计算，获取本月的费用数据
      const now = new Date()
      const monthStart = getTimezoneStartOfMonth(now)

      return await database.getCostByDateRange(apiKeyId, monthStart, now)
    } catch (error) {
      logger.debug(`Failed to get monthly cost for API key: ${apiKeyId}:`, error.message)
      return 0
    }
  }

  /**
   * 获取总费用
   * @param {string} apiKeyId - API Key ID
   * @returns {Promise<number>} 总费用
   */
  async _getTotalCost(apiKeyId) {
    try {
      return await database.getTotalCost(apiKeyId)
    } catch (error) {
      logger.debug(`Failed to get total cost for API key: ${apiKeyId}:`, error.message)
      return 0
    }
  }

  /**
   * 获取账户当前费用使用情况
   * @param {string} accountId - Claude账户ID
   * @returns {Promise<Object>} 当前费用数据
   */
  async _getAccountCurrentCosts(accountId) {
    try {
      const costs = {}

      // 获取Claude账户的费用统计方法
      const claudeAccountService = require('./claudeAccountService')

      // 获取各个时间周期的费用
      costs.daily = (await claudeAccountService.getAccountDailyCost(accountId)) || 0
      costs.weekly = (await claudeAccountService.getAccountWeeklyCost(accountId)) || 0
      costs.monthly = (await claudeAccountService.getAccountMonthlyCost(accountId)) || 0
      costs.total = (await claudeAccountService.getAccountTotalCost(accountId)) || 0

      return costs
    } catch (error) {
      logger.warn(
        `⚠️ Failed to get account current costs for account: ${accountId}:`,
        error.message
      )
      // 返回默认值
      return { daily: 0, weekly: 0, monthly: 0, total: 0 }
    }
  }

  /**
   * 支持预估费用的费用限制检查方法
   * @param {string} apiKeyId - API Key ID
   * @param {Object} keyData - API Key 数据
   * @param {number} estimatedCost - 预估费用（美元）
   * @returns {Promise<Object>} 检查结果
   */
  async checkCostLimitsWithEstimate(apiKeyId, keyData, estimatedCost = 0) {
    try {
      const startTime = Date.now()

      // 获取所有费用限制配置
      const limits = this._extractCostLimits(keyData)

      // 如果没有配置任何费用限制，直接通过
      if (!this._hasAnyLimit(limits)) {
        logger.debug(`💰 No cost limits configured for API key: ${apiKeyId}`)
        return { allowed: true, limits, currentCosts: {}, warnings: [] }
      }

      // 获取当前费用使用情况（带缓存）
      const currentCosts = await this._getCurrentCosts(apiKeyId)

      // 检查每个时间周期的限制（考虑预估费用）
      const violations = []
      const warnings = []

      for (const [period, limit] of Object.entries(limits)) {
        if (limit <= 0) {
          continue
        } // 跳过未配置的限制

        const currentCost = currentCosts[period] || 0
        const projectedCost = currentCost + estimatedCost
        const usage = projectedCost / limit

        // 检查是否超过限制（包含预估费用）
        if (projectedCost > limit) {
          violations.push({
            period,
            limit,
            current: currentCost,
            estimated: estimatedCost,
            projected: projectedCost,
            usage: Math.min(usage, 1.0),
            resetTime: getNextResetTime(period)
          })
        }
        // 检查是否需要发出预警
        else if (usage >= this.warningThresholds.low) {
          warnings.push({
            level: this._getWarningLevel(usage),
            period,
            limit,
            current: currentCost,
            estimated: estimatedCost,
            projected: projectedCost,
            usage,
            resetTime: getNextResetTime(period)
          })
        }
      }

      const checkDuration = Date.now() - startTime

      if (violations.length > 0) {
        logger.security(
          `💰 Cost limit exceeded with estimate for API key: ${apiKeyId}, violations: ${violations.length}, estimated: $${estimatedCost.toFixed(4)}, check time: ${checkDuration}ms`
        )
        return {
          allowed: false,
          violations,
          warnings,
          limits,
          currentCosts,
          checkDuration
        }
      }

      if (warnings.length > 0) {
        logger.warn(
          `💰 Cost usage warning with estimate for API key: ${apiKeyId}, warnings: ${warnings.length}, estimated: $${estimatedCost.toFixed(4)}, check time: ${checkDuration}ms`
        )
      } else {
        logger.debug(
          `💰 Cost limits check with estimate passed for API key: ${apiKeyId}, estimated: $${estimatedCost.toFixed(4)}, check time: ${checkDuration}ms`
        )
      }

      return {
        allowed: true,
        violations: [],
        warnings,
        limits,
        currentCosts,
        checkDuration
      }
    } catch (error) {
      logger.error(`❌ Cost limit check with estimate error for API key: ${apiKeyId}:`, error)
      // 发生错误时允许通过，避免阻塞正常请求
      return {
        allowed: true,
        error: error.message,
        limits: {},
        currentCosts: {},
        warnings: []
      }
    }
  }

  // 注意：_getResetTime 方法已被 dateHelper.getNextResetTime 替代
  // 该方法已删除，以确保时区处理的一致性

  /**
   * 获取预警级别
   * @param {number} usage - 使用率 (0-1)
   * @returns {string} 预警级别
   */
  _getWarningLevel(usage) {
    if (usage >= this.warningThresholds.high) {
      return 'high'
    }
    if (usage >= this.warningThresholds.medium) {
      return 'medium'
    }
    if (usage >= this.warningThresholds.low) {
      return 'low'
    }
    return 'info'
  }

  /**
   * 格式化费用违规响应
   * @param {Array} violations - 违规列表
   * @returns {Object} 格式化的响应
   */
  formatViolationResponse(violations) {
    if (!violations.length) {
      return null
    }

    // 找出最严重的违规（按使用率排序）
    const primaryViolation = violations.sort((a, b) => b.usage - a.usage)[0]
    const periodLabel = this.timePeriods[primaryViolation.period]?.label || primaryViolation.period

    const response = {
      error: 'Cost limit exceeded',
      message: `已达到${periodLabel}费用限制 ($${primaryViolation.limit.toFixed(2)})`,
      details: {
        period: primaryViolation.period,
        currentCost: primaryViolation.current,
        costLimit: primaryViolation.limit,
        usage: `${Math.min(primaryViolation.usage * 100, 100).toFixed(1)}%`,
        resetAt: primaryViolation.resetTime?.toISOString() || null,
        // 添加预估费用信息（如果存在）
        estimatedCost: primaryViolation.estimated || 0,
        projectedCost: primaryViolation.projected || primaryViolation.current
      },
      allViolations: violations.map((v) => ({
        period: v.period,
        periodLabel: this.timePeriods[v.period]?.label || v.period,
        current: v.current,
        limit: v.limit,
        usage: `${Math.min(v.usage * 100, 100).toFixed(1)}%`,
        resetAt: v.resetTime?.toISOString() || null,
        estimated: v.estimated || 0,
        projected: v.projected || v.current
      })),
      // 添加系统标识
      limitType: 'cost_limit',
      timestamp: new Date().toISOString()
    }

    // 如果有重置时间，计算剩余时间
    if (primaryViolation.resetTime) {
      const remainingMinutes = Math.ceil((primaryViolation.resetTime - new Date()) / 60000)
      if (remainingMinutes > 0) {
        response.remainingMinutes = remainingMinutes
        response.message += `，将在 ${remainingMinutes} 分钟后重置`
      }
    }

    // 如果包含预估费用，添加到消息中
    if (primaryViolation.estimated > 0) {
      response.message += `（包含预估费用 $${primaryViolation.estimated.toFixed(4)}）`
    }

    return response
  }

  /**
   * 格式化预警信息
   * @param {Array} warnings - 预警列表
   * @returns {Array} 格式化的预警信息
   */
  formatWarnings(warnings) {
    return warnings.map((warning) => {
      const periodLabel = this.timePeriods[warning.period]?.label || warning.period
      return {
        level: warning.level,
        message: `${periodLabel}费用使用率已达到 ${(warning.usage * 100).toFixed(1)}%`,
        details: {
          period: warning.period,
          periodLabel,
          current: warning.current,
          limit: warning.limit,
          usage: warning.usage,
          resetAt: warning.resetTime?.toISOString() || null
        }
      }
    })
  }

  /**
   * 清除费用缓存
   * @param {string} apiKeyId - API Key ID（可选，不提供则清除所有）
   * @returns {Promise<void>}
   */
  async clearCache(apiKeyId = null) {
    try {
      const dbClient = database.getClient()
      if (!dbClient) {
        return
      }

      if (apiKeyId) {
        // 清除特定 API Key 的缓存
        const cacheKey = `${this.cachePrefix}:${apiKeyId}`
        await dbClient.del(cacheKey)
        logger.debug(`💰 Cleared cost cache for API key: ${apiKeyId}`)
      } else {
        // 清除所有费用缓存
        const pattern = `${this.cachePrefix}:*`
        const keys = await dbClient.keys(pattern)
        if (keys.length > 0) {
          await dbClient.del(keys)
          logger.debug(`💰 Cleared ${keys.length} cost cache entries`)
        }
      }
    } catch (error) {
      logger.warn('⚠️ Failed to clear cost cache:', error.message)
    }
  }

  /**
   * 获取缓存统计
   * @returns {Promise<Object>} 缓存统计信息
   */
  async getCacheStats() {
    try {
      const dbClient = database.getClient()
      if (!dbClient) {
        return { enabled: false, entries: 0 }
      }

      const pattern = `${this.cachePrefix}:*`
      const keys = await dbClient.keys(pattern)

      return {
        enabled: this.cacheEnabled,
        entries: keys.length,
        ttl: this.cacheTTL,
        prefix: this.cachePrefix
      }
    } catch (error) {
      logger.warn('⚠️ Failed to get cost cache stats:', error.message)
      return { enabled: false, entries: 0, error: error.message }
    }
  }

  /**
   * 更新缓存配置
   * @param {Object} config - 新的缓存配置
   */
  updateCacheConfig(config = {}) {
    if (typeof config.enabled === 'boolean') {
      this.cacheEnabled = config.enabled
    }
    if (typeof config.ttl === 'number' && config.ttl > 0) {
      this.cacheTTL = config.ttl
    }

    logger.info(`💰 Updated cost cache config: enabled=${this.cacheEnabled}, ttl=${this.cacheTTL}s`)
  }

  /**
   * 检查账户费用限制（P1.2 要求的具体方法）
   * @param {string} accountId - Claude账户ID
   * @param {number} estimatedCost - 预估费用（美元）
   * @returns {Promise<Object>} 限制检查结果
   */
  async checkAccountCostLimit(accountId, estimatedCost = 0) {
    try {
      const startTime = Date.now()

      // 验证输入参数
      if (!accountId || typeof accountId !== 'string') {
        throw new Error('Invalid accountId: must be a non-empty string')
      }

      if (typeof estimatedCost !== 'number' || estimatedCost < 0) {
        throw new Error('Invalid estimatedCost: must be a non-negative number')
      }

      // 获取账户信息（包含费用限制配置）
      const claudeAccountService = require('./claudeAccountService')
      const accountResult = await claudeAccountService.getAccount(accountId)

      if (!accountResult) {
        logger.warn(`💰 Account not found for cost limit check: ${accountId}`)
        // 账户不存在时允许通过，避免阻塞正常请求
        return {
          allowed: true,
          reason: 'account_not_found',
          accountId,
          estimatedCost,
          currentCosts: {},
          limits: {},
          checkDuration: Date.now() - startTime
        }
      }

      const accountData = accountResult

      // 提取账户级别的费用限制配置
      const limits = {
        daily: parseFloat(accountData.dailyCostLimit) || 0,
        weekly: parseFloat(accountData.weeklyCostLimit) || 0,
        monthly: parseFloat(accountData.monthlyCostLimit) || 0,
        total: parseFloat(accountData.totalCostLimit) || 0
      }

      // 如果没有配置任何费用限制，直接通过
      if (!this._hasAnyLimit(limits)) {
        logger.debug(`💰 No cost limits configured for account: ${accountId}`)
        return {
          allowed: true,
          reason: 'no_limits_configured',
          accountId,
          estimatedCost,
          currentCosts: {},
          limits,
          checkDuration: Date.now() - startTime
        }
      }

      // 获取账户当前费用使用情况
      const currentCosts = await this._getAccountCurrentCosts(accountId)

      // 检查每个时间周期的限制（考虑预估费用）
      const violations = []
      const warnings = []

      for (const [period, limit] of Object.entries(limits)) {
        if (limit <= 0) {
          continue
        } // 跳过未配置的限制

        const currentCost = currentCosts[period] || 0
        const projectedCost = currentCost + estimatedCost
        const usage = projectedCost / limit

        // 检查是否超过限制（包含预估费用）
        if (projectedCost > limit) {
          violations.push({
            period,
            limit,
            current: currentCost,
            estimated: estimatedCost,
            projected: projectedCost,
            usage: Math.min(usage, 1.0),
            resetTime: getNextResetTime(period)
          })
        }
        // 检查是否需要发出预警
        else if (usage >= this.warningThresholds.low) {
          warnings.push({
            level: this._getWarningLevel(usage),
            period,
            limit,
            current: currentCost,
            estimated: estimatedCost,
            projected: projectedCost,
            usage,
            resetTime: getNextResetTime(period)
          })
        }
      }

      const checkDuration = Date.now() - startTime

      if (violations.length > 0) {
        logger.security(
          `💰 Account cost limit exceeded: ${accountId}, violations: ${violations.length}, estimated: $${estimatedCost.toFixed(4)}, check time: ${checkDuration}ms`
        )
        return {
          allowed: false,
          reason: 'cost_limit_exceeded',
          accountId,
          estimatedCost,
          violations,
          warnings,
          limits,
          currentCosts,
          checkDuration
        }
      }

      if (warnings.length > 0) {
        logger.warn(
          `💰 Account cost usage warning: ${accountId}, warnings: ${warnings.length}, estimated: $${estimatedCost.toFixed(4)}, check time: ${checkDuration}ms`
        )
      } else {
        logger.debug(
          `💰 Account cost limits check passed: ${accountId}, estimated: $${estimatedCost.toFixed(4)}, check time: ${checkDuration}ms`
        )
      }

      return {
        allowed: true,
        reason: 'limits_passed',
        accountId,
        estimatedCost,
        violations: [],
        warnings,
        limits,
        currentCosts,
        checkDuration
      }
    } catch (error) {
      logger.error(`❌ Account cost limit check error for account: ${accountId}:`, error)
      // 发生错误时允许通过，避免阻塞正常请求
      return {
        allowed: true,
        reason: 'check_error',
        error: error.message,
        accountId,
        estimatedCost,
        limits: {},
        currentCosts: {},
        warnings: []
      }
    }
  }

  /**
   * 检查API Key费用限制（P1.2 要求的具体方法）
   * @param {string} apiKeyId - API Key ID
   * @param {number} estimatedCost - 预估费用（美元）
   * @returns {Promise<Object>} 限制检查结果
   */
  async checkApiKeyCostLimit(apiKeyId, estimatedCost = 0) {
    try {
      const startTime = Date.now()

      // 验证输入参数
      if (!apiKeyId || typeof apiKeyId !== 'string') {
        throw new Error('Invalid apiKeyId: must be a non-empty string')
      }

      if (typeof estimatedCost !== 'number' || estimatedCost < 0) {
        throw new Error('Invalid estimatedCost: must be a non-negative number')
      }

      // 获取API Key信息（包含费用限制配置）
      const localDatabase = require('../models/database')
      const keyResult = await localDatabase.getApiKey(apiKeyId)

      if (!keyResult || Object.keys(keyResult).length === 0) {
        logger.warn(`💰 API Key not found for cost limit check: ${apiKeyId}`)
        // API Key不存在时允许通过，避免阻塞正常请求
        return {
          allowed: true,
          reason: 'api_key_not_found',
          apiKeyId,
          estimatedCost,
          currentCosts: {},
          limits: {},
          checkDuration: Date.now() - startTime
        }
      }

      const keyData = keyResult

      // 使用现有的checkCostLimits方法（支持预估费用）
      const result = await this.checkCostLimitsWithEstimate(apiKeyId, keyData, estimatedCost)

      // 添加方法特定的字段
      result.apiKeyId = apiKeyId
      result.estimatedCost = estimatedCost
      result.checkDuration = Date.now() - startTime

      if (!result.allowed) {
        logger.security(
          `💰 API Key cost limit exceeded: ${apiKeyId}, violations: ${result.violations?.length || 0}, estimated: $${estimatedCost.toFixed(4)}, check time: ${result.checkDuration}ms`
        )
        result.reason = 'cost_limit_exceeded'
      } else if (result.warnings?.length > 0) {
        logger.warn(
          `💰 API Key cost usage warning: ${apiKeyId}, warnings: ${result.warnings.length}, estimated: $${estimatedCost.toFixed(4)}, check time: ${result.checkDuration}ms`
        )
        result.reason = 'limits_passed_with_warnings'
      } else {
        logger.debug(
          `💰 API Key cost limits check passed: ${apiKeyId}, estimated: $${estimatedCost.toFixed(4)}, check time: ${result.checkDuration}ms`
        )
        result.reason = 'limits_passed'
      }

      return result
    } catch (error) {
      logger.error(`❌ API Key cost limit check error for key: ${apiKeyId}:`, error)
      // 发生错误时允许通过，避免阻塞正常请求
      return {
        allowed: true,
        reason: 'check_error',
        error: error.message,
        apiKeyId,
        estimatedCost,
        limits: {},
        currentCosts: {},
        warnings: []
      }
    }
  }
}

// 创建单例实例
const costLimitService = new CostLimitService()

module.exports = {
  CostLimitService,
  costLimitService
}
