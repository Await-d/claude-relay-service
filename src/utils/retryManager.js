/**
 * @fileoverview 智能重试管理器 - 提供指数退避、熔断机制和错误分类重试策略
 *
 * 核心功能：
 * - 指数退避算法，支持抖动和上限控制
 * - 差异化错误类型处理（网络、API限流、认证等）
 * - 熔断器模式，防止雪崩效应
 * - 重试统计和监控集成
 * - 可配置的重试策略和动态调整
 *
 * @author Claude Code
 * @version 1.0.0
 */

const logger = require('./logger')
const database = require('../models/database')
const _config = require('../../config/config')

/**
 * 错误分类枚举
 */
const ErrorType = {
  NETWORK_ERROR: 'network_error',
  API_RATE_LIMIT: 'api_rate_limit',
  AUTH_TOKEN_EXPIRED: 'auth_token_expired',
  SERVER_ERROR: 'server_error',
  VALIDATION_ERROR: 'validation_error',
  CLIENT_ERROR: 'client_error',
  CONNECTION_ERROR: 'connection_error',
  TIMEOUT_ERROR: 'timeout_error',
  UNKNOWN_ERROR: 'unknown_error'
}

/**
 * 重试策略枚举
 */
const RetryStrategy = {
  EXPONENTIAL_BACKOFF: 'exponential_backoff',
  FIXED_DELAY: 'fixed_delay',
  LINEAR_BACKOFF: 'linear_backoff',
  NO_RETRY: 'no_retry'
}

/**
 * 熔断器状态枚举
 */
const CircuitBreakerState = {
  CLOSED: 'closed', // 正常状态
  OPEN: 'open', // 熔断开启
  HALF_OPEN: 'half_open' // 半开状态，测试恢复
}

/**
 * 默认重试配置
 */
const DEFAULT_RETRY_CONFIG = {
  // 基础重试配置
  maxRetries: 3,
  baseDelay: 1000, // 基础延迟 1秒
  maxDelay: 30000, // 最大延迟 30秒
  multiplier: 2, // 指数倍增因子
  jitter: 0.1, // 抖动因子，避免惊群效应

  // 熔断器配置
  circuitBreaker: {
    enabled: true,
    failureThreshold: 5, // 失败阈值
    recoveryTimeout: 30000, // 恢复超时
    halfOpenRetryCount: 3 // 半开状态下的重试次数
  },

  // 错误类型特定配置
  errorStrategies: {
    [ErrorType.NETWORK_ERROR]: {
      strategy: RetryStrategy.EXPONENTIAL_BACKOFF,
      maxRetries: 5,
      baseDelay: 2000,
      multiplier: 2.5
    },
    [ErrorType.API_RATE_LIMIT]: {
      strategy: RetryStrategy.FIXED_DELAY,
      maxRetries: 3,
      baseDelay: 60000, // API限流等待1分钟
      respectRetryAfter: true
    },
    [ErrorType.AUTH_TOKEN_EXPIRED]: {
      strategy: RetryStrategy.NO_RETRY, // 需要外部处理token刷新
      maxRetries: 1,
      allowTokenRefresh: true
    },
    [ErrorType.CONNECTION_ERROR]: {
      strategy: RetryStrategy.EXPONENTIAL_BACKOFF,
      maxRetries: 4,
      baseDelay: 1500,
      multiplier: 2
    },
    [ErrorType.TIMEOUT_ERROR]: {
      strategy: RetryStrategy.LINEAR_BACKOFF,
      maxRetries: 3,
      baseDelay: 5000
    },
    [ErrorType.SERVER_ERROR]: {
      strategy: RetryStrategy.EXPONENTIAL_BACKOFF,
      maxRetries: 3,
      baseDelay: 2000
    },
    [ErrorType.VALIDATION_ERROR]: {
      strategy: RetryStrategy.NO_RETRY,
      maxRetries: 0
    },
    [ErrorType.CLIENT_ERROR]: {
      strategy: RetryStrategy.NO_RETRY,
      maxRetries: 0
    }
  }
}

/**
 * 智能重试管理器主类
 */
class RetryManager {
  constructor(options = {}) {
    this.config = { ...DEFAULT_RETRY_CONFIG, ...options }
    this.statistics = new Map() // 重试统计
    this.circuitBreakers = new Map() // 熔断器状态
    this.serviceMetrics = new Map() // 服务指标

    // 初始化统计定时器
    this.startStatisticsTimer()

    logger.info('🔄 RetryManager initialized with config:', {
      maxRetries: this.config.maxRetries,
      circuitBreakerEnabled: this.config.circuitBreaker.enabled,
      errorStrategiesCount: Object.keys(this.config.errorStrategies).length
    })
  }

  /**
   * 执行带重试的操作
   * @param {Function} operation - 要重试的操作函数
   * @param {Object} options - 重试选项
   * @returns {Promise<any>} 操作结果
   */
  async executeWithRetry(operation, options = {}) {
    const operationId = options.operationId || this.generateOperationId()
    const serviceName = options.serviceName || 'default'
    const context = {
      operationId,
      serviceName,
      startTime: Date.now(),
      attempts: 0,
      errors: []
    }

    logger.debug(`🔄 Starting retry operation: ${operationId} for service: ${serviceName}`)

    // 检查熔断器状态
    if (!this.canExecute(serviceName)) {
      throw new Error(`Circuit breaker is OPEN for service: ${serviceName}`)
    }

    try {
      return await this.attemptOperation(operation, context, options)
    } catch (error) {
      this.recordFailure(serviceName, error, context)
      throw this.enhanceError(error, context)
    }
  }

  /**
   * 尝试执行操作（包含重试逻辑）
   * @private
   */
  async attemptOperation(operation, context, options) {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      context.attempts++

      try {
        const result = await operation()

        // 成功执行，记录成功统计
        this.recordSuccess(context.serviceName, context)

        logger.debug(`✅ Operation ${context.operationId} succeeded on attempt ${context.attempts}`)
        return result
      } catch (error) {
        const errorType = this.classifyError(error)
        const errorStrategy = this.getErrorStrategy(errorType)
        const shouldRetry = this.shouldRetry(error, context, errorStrategy, options)

        context.errors.push({
          type: errorType,
          message: error.message,
          attempt: context.attempts,
          timestamp: Date.now()
        })

        logger.warn(`❌ Operation ${context.operationId} failed on attempt ${context.attempts}:`, {
          errorType,
          errorMessage: error.message,
          shouldRetry
        })

        if (!shouldRetry) {
          throw error
        }

        // 计算延迟时间并等待
        const delay = this.calculateDelay(context.attempts, errorStrategy, error)
        logger.debug(`⏳ Retrying operation ${context.operationId} in ${delay}ms...`)

        await this.sleep(delay)
      }
    }
  }

  /**
   * 分类错误类型
   * @param {Error} error - 错误对象
   * @returns {string} 错误类型
   */
  classifyError(error) {
    const errorMessage = error.message?.toLowerCase() || ''
    const errorCode = error.code?.toLowerCase() || ''
    const statusCode = error.status || error.statusCode

    // HTTP状态码分类
    if (statusCode) {
      if (statusCode === 401) {
        return ErrorType.AUTH_TOKEN_EXPIRED
      }
      if (statusCode === 429) {
        return ErrorType.API_RATE_LIMIT
      }
      if (statusCode >= 500) {
        return ErrorType.SERVER_ERROR
      }
      if (statusCode >= 400) {
        return ErrorType.CLIENT_ERROR
      }
    }

    // 网络错误分类
    if (errorCode === 'econnreset' || errorMessage.includes('connection reset')) {
      return ErrorType.CONNECTION_ERROR
    }
    if (errorCode === 'enotfound' || errorMessage.includes('getaddrinfo')) {
      return ErrorType.NETWORK_ERROR
    }
    if (errorCode === 'econnrefused' || errorMessage.includes('connection refused')) {
      return ErrorType.CONNECTION_ERROR
    }
    if (errorCode === 'etimedout' || errorMessage.includes('timeout')) {
      return ErrorType.TIMEOUT_ERROR
    }

    // API特定错误
    if (errorMessage.includes('rate limit') || errorMessage.includes('too many requests')) {
      return ErrorType.API_RATE_LIMIT
    }
    if (errorMessage.includes('unauthorized') || errorMessage.includes('invalid token')) {
      return ErrorType.AUTH_TOKEN_EXPIRED
    }
    if (errorMessage.includes('validation') || errorMessage.includes('invalid input')) {
      return ErrorType.VALIDATION_ERROR
    }

    // 默认分类
    return ErrorType.UNKNOWN_ERROR
  }

  /**
   * 获取错误对应的重试策略
   * @param {string} errorType - 错误类型
   * @returns {Object} 重试策略配置
   */
  getErrorStrategy(errorType) {
    return (
      this.config.errorStrategies[errorType] || {
        strategy: RetryStrategy.EXPONENTIAL_BACKOFF,
        maxRetries: this.config.maxRetries,
        baseDelay: this.config.baseDelay,
        multiplier: this.config.multiplier
      }
    )
  }

  /**
   * 判断是否应该重试
   * @param {Error} error - 错误对象
   * @param {Object} context - 执行上下文
   * @param {Object} errorStrategy - 错误策略
   * @param {Object} options - 选项
   * @returns {boolean} 是否应该重试
   */
  shouldRetry(error, context, errorStrategy, options) {
    // 检查重试次数限制
    if (context.attempts >= errorStrategy.maxRetries) {
      return false
    }

    // 检查策略是否允许重试
    if (errorStrategy.strategy === RetryStrategy.NO_RETRY) {
      return false
    }

    // 检查熔断器状态
    if (!this.canExecute(context.serviceName)) {
      return false
    }

    // 检查自定义重试条件
    if (options.shouldRetry && typeof options.shouldRetry === 'function') {
      return options.shouldRetry(error, context.attempts)
    }

    return true
  }

  /**
   * 计算延迟时间
   * @param {number} attempt - 尝试次数
   * @param {Object} strategy - 重试策略
   * @param {Error} error - 错误对象
   * @returns {number} 延迟毫秒数
   */
  calculateDelay(attempt, strategy, error) {
    let delay

    switch (strategy.strategy) {
      case RetryStrategy.EXPONENTIAL_BACKOFF:
        delay =
          strategy.baseDelay * Math.pow(strategy.multiplier || this.config.multiplier, attempt - 1)
        break

      case RetryStrategy.LINEAR_BACKOFF:
        delay = strategy.baseDelay * attempt
        break

      case RetryStrategy.FIXED_DELAY:
        delay = strategy.baseDelay
        break

      default:
        delay = this.config.baseDelay
    }

    // 应用延迟上限
    delay = Math.min(delay, strategy.maxDelay || this.config.maxDelay)

    // 处理API限流的特殊情况
    if (strategy.respectRetryAfter && error.headers?.['retry-after']) {
      const retryAfter = parseInt(error.headers['retry-after']) * 1000
      delay = Math.max(delay, retryAfter)
    }

    // 添加抖动，避免惊群效应
    const jitter = strategy.jitter || this.config.jitter
    if (jitter > 0) {
      const jitterAmount = delay * jitter * (Math.random() * 2 - 1)
      delay = Math.max(0, delay + jitterAmount)
    }

    return Math.floor(delay)
  }

  /**
   * 检查服务是否可以执行（熔断器检查）
   * @param {string} serviceName - 服务名称
   * @returns {boolean} 是否可以执行
   */
  canExecute(serviceName) {
    if (!this.config.circuitBreaker.enabled) {
      return true
    }

    const breaker = this.circuitBreakers.get(serviceName)
    if (!breaker) {
      return true
    }

    const now = Date.now()

    switch (breaker.state) {
      case CircuitBreakerState.CLOSED:
        return true

      case CircuitBreakerState.OPEN:
        if (now - breaker.openedAt > this.config.circuitBreaker.recoveryTimeout) {
          breaker.state = CircuitBreakerState.HALF_OPEN
          breaker.halfOpenAttempts = 0
          logger.info(`🔄 Circuit breaker for ${serviceName} moved to HALF_OPEN`)
          return true
        }
        return false

      case CircuitBreakerState.HALF_OPEN:
        return breaker.halfOpenAttempts < this.config.circuitBreaker.halfOpenRetryCount

      default:
        return true
    }
  }

  /**
   * 记录操作成功
   * @param {string} serviceName - 服务名称
   * @param {Object} context - 执行上下文
   */
  recordSuccess(serviceName, context) {
    this.updateStatistics(serviceName, true, context)
    this.updateCircuitBreaker(serviceName, true, context)
  }

  /**
   * 记录操作失败
   * @param {string} serviceName - 服务名称
   * @param {Error} error - 错误对象
   * @param {Object} context - 执行上下文
   */
  recordFailure(serviceName, error, context) {
    this.updateStatistics(serviceName, false, context)
    this.updateCircuitBreaker(serviceName, false, context)
  }

  /**
   * 更新统计信息
   * @private
   */
  updateStatistics(serviceName, success, context) {
    let stats = this.statistics.get(serviceName)
    if (!stats) {
      stats = {
        totalAttempts: 0,
        totalSuccesses: 0,
        totalFailures: 0,
        totalRetries: 0,
        averageAttempts: 0,
        errorTypes: new Map(),
        lastUpdated: Date.now()
      }
      this.statistics.set(serviceName, stats)
    }

    stats.totalAttempts += context.attempts
    if (success) {
      stats.totalSuccesses++
    } else {
      stats.totalFailures++
      stats.totalRetries += context.attempts - 1

      // 记录错误类型统计
      context.errors.forEach((error) => {
        const count = stats.errorTypes.get(error.type) || 0
        stats.errorTypes.set(error.type, count + 1)
      })
    }

    stats.averageAttempts = stats.totalAttempts / (stats.totalSuccesses + stats.totalFailures)
    stats.lastUpdated = Date.now()
  }

  /**
   * 更新熔断器状态
   * @private
   */
  updateCircuitBreaker(serviceName, success, _context) {
    if (!this.config.circuitBreaker.enabled) {
      return
    }

    let breaker = this.circuitBreakers.get(serviceName)
    if (!breaker) {
      breaker = {
        state: CircuitBreakerState.CLOSED,
        failureCount: 0,
        lastFailureTime: null,
        openedAt: null,
        halfOpenAttempts: 0
      }
      this.circuitBreakers.set(serviceName, breaker)
    }

    if (success) {
      if (breaker.state === CircuitBreakerState.HALF_OPEN) {
        breaker.state = CircuitBreakerState.CLOSED
        breaker.failureCount = 0
        logger.info(`✅ Circuit breaker for ${serviceName} moved to CLOSED (recovered)`)
      } else if (breaker.state === CircuitBreakerState.CLOSED) {
        breaker.failureCount = Math.max(0, breaker.failureCount - 1)
      }
    } else {
      breaker.failureCount++
      breaker.lastFailureTime = Date.now()

      if (breaker.state === CircuitBreakerState.HALF_OPEN) {
        breaker.halfOpenAttempts++
        if (breaker.halfOpenAttempts >= this.config.circuitBreaker.halfOpenRetryCount) {
          breaker.state = CircuitBreakerState.OPEN
          breaker.openedAt = Date.now()
          logger.warn(`🚨 Circuit breaker for ${serviceName} moved to OPEN (half-open failed)`)
        }
      } else if (
        breaker.state === CircuitBreakerState.CLOSED &&
        breaker.failureCount >= this.config.circuitBreaker.failureThreshold
      ) {
        breaker.state = CircuitBreakerState.OPEN
        breaker.openedAt = Date.now()
        logger.warn(`🚨 Circuit breaker for ${serviceName} moved to OPEN (threshold reached)`)
      }
    }
  }

  /**
   * 增强错误信息
   * @param {Error} error - 原始错误
   * @param {Object} context - 执行上下文
   * @returns {Error} 增强后的错误
   */
  enhanceError(error, context) {
    const enhancedError = new Error(error.message)
    enhancedError.name = error.name
    enhancedError.stack = error.stack
    enhancedError.originalError = error

    // 添加重试上下文
    enhancedError.retryContext = {
      operationId: context.operationId,
      serviceName: context.serviceName,
      attempts: context.attempts,
      duration: Date.now() - context.startTime,
      errors: context.errors,
      finalErrorType: this.classifyError(error)
    }

    return enhancedError
  }

  /**
   * 获取服务统计信息
   * @param {string} serviceName - 服务名称
   * @returns {Object} 统计信息
   */
  getStatistics(serviceName = null) {
    if (serviceName) {
      const stats = this.statistics.get(serviceName)
      if (!stats) {
        return null
      }

      return {
        ...stats,
        successRate: stats.totalSuccesses / (stats.totalSuccesses + stats.totalFailures),
        errorTypes: Object.fromEntries(stats.errorTypes)
      }
    }

    // 返回所有服务的统计信息
    const allStats = {}
    for (const [service, stats] of this.statistics.entries()) {
      allStats[service] = {
        ...stats,
        successRate: stats.totalSuccesses / (stats.totalSuccesses + stats.totalFailures),
        errorTypes: Object.fromEntries(stats.errorTypes)
      }
    }

    return allStats
  }

  /**
   * 获取熔断器状态
   * @param {string} serviceName - 服务名称
   * @returns {Object} 熔断器状态
   */
  getCircuitBreakerStatus(serviceName = null) {
    if (serviceName) {
      return (
        this.circuitBreakers.get(serviceName) || {
          state: CircuitBreakerState.CLOSED,
          failureCount: 0
        }
      )
    }

    // 返回所有服务的熔断器状态
    return Object.fromEntries(this.circuitBreakers)
  }

  /**
   * 重置服务统计
   * @param {string} serviceName - 服务名称
   */
  resetStatistics(serviceName) {
    if (serviceName) {
      this.statistics.delete(serviceName)
      this.circuitBreakers.delete(serviceName)
    } else {
      this.statistics.clear()
      this.circuitBreakers.clear()
    }

    logger.info(`📊 Reset statistics for service: ${serviceName || 'all services'}`)
  }

  /**
   * 手动触发熔断器状态切换
   * @param {string} serviceName - 服务名称
   * @param {string} state - 目标状态
   */
  setCircuitBreakerState(serviceName, state) {
    if (!Object.values(CircuitBreakerState).includes(state)) {
      throw new Error(`Invalid circuit breaker state: ${state}`)
    }

    let breaker = this.circuitBreakers.get(serviceName)
    if (!breaker) {
      breaker = {
        state: CircuitBreakerState.CLOSED,
        failureCount: 0,
        lastFailureTime: null,
        openedAt: null,
        halfOpenAttempts: 0
      }
      this.circuitBreakers.set(serviceName, breaker)
    }

    const oldState = breaker.state
    breaker.state = state

    if (state === CircuitBreakerState.OPEN) {
      breaker.openedAt = Date.now()
    } else if (state === CircuitBreakerState.HALF_OPEN) {
      breaker.halfOpenAttempts = 0
    }

    logger.info(`🔧 Manually changed circuit breaker for ${serviceName}: ${oldState} → ${state}`)
  }

  /**
   * 生成操作ID
   * @private
   */
  generateOperationId() {
    return `retry_${Date.now()}_${Math.random().toString(36).substring(2)}`
  }

  /**
   * 延迟函数
   * @private
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * 启动统计定时器
   * @private
   */
  startStatisticsTimer() {
    // 每5分钟持久化统计数据到数据库
    setInterval(
      async () => {
        try {
          await this.persistStatistics()
        } catch (error) {
          logger.debug('Failed to persist retry statistics:', error.message)
        }
      },
      5 * 60 * 1000
    )
  }

  /**
   * 持久化统计数据
   * @private
   */
  async persistStatistics() {
    try {
      const allStats = this.getStatistics()
      const timestamp = new Date().toISOString()

      for (const [serviceName, stats] of Object.entries(allStats)) {
        const key = `retry_stats:${serviceName}:${timestamp}`
        await database.set(key, JSON.stringify(stats), 'EX', 7 * 24 * 60 * 60) // 保留7天
      }

      logger.debug(`📊 Persisted retry statistics for ${Object.keys(allStats).length} services`)
    } catch (error) {
      logger.debug('Failed to persist retry statistics to database:', error.message)
    }
  }

  /**
   * 健康检查
   * @returns {Object} 健康状态
   */
  healthCheck() {
    const stats = this.getStatistics()
    const circuitBreakers = this.getCircuitBreakerStatus()

    const serviceCount = Object.keys(stats).length
    const openCircuitBreakers = Object.values(circuitBreakers).filter(
      (breaker) => breaker.state === CircuitBreakerState.OPEN
    ).length

    const overallSuccessRate =
      serviceCount > 0
        ? Object.values(stats).reduce((acc, stat) => acc + stat.successRate, 0) / serviceCount
        : 1

    const isHealthy = overallSuccessRate > 0.8 && openCircuitBreakers === 0

    return {
      healthy: isHealthy,
      serviceCount,
      overallSuccessRate: Math.round(overallSuccessRate * 100) / 100,
      openCircuitBreakers,
      timestamp: new Date().toISOString()
    }
  }
}

// 导出错误类型和重试策略常量
module.exports = {
  RetryManager,
  ErrorType,
  RetryStrategy,
  CircuitBreakerState,
  DEFAULT_RETRY_CONFIG
}
