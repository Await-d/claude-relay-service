/**
 * @fileoverview 错误处理和重试机制集成示例
 *
 * 展示如何将RetryManager和EnhancedErrorHandler集成到Claude Relay Service中
 * 提供了与现有服务的无缝集成方案和配置示例
 *
 * @author Claude Code
 * @version 1.0.0
 */

const { RetryManager, ErrorType, RetryStrategy } = require('./retryManager')
const {
  EnhancedErrorHandler,
  ErrorCategory: _ErrorCategory,
  ErrorSeverity: _ErrorSeverity
} = require('../middleware/enhancedErrorHandler')
const logger = require('./logger')
const _config = require('../../config/config')

/**
 * 智能错误处理和重试集成服务
 */
class ErrorRetryIntegration {
  constructor(options = {}) {
    // 初始化重试管理器
    this.retryManager = new RetryManager({
      maxRetries: options.maxRetries || 3,
      baseDelay: options.baseDelay || 1000,
      circuitBreaker: {
        enabled: true,
        failureThreshold: options.failureThreshold || 5,
        recoveryTimeout: options.recoveryTimeout || 30000
      },
      // Claude Relay特定的错误策略
      errorStrategies: {
        [ErrorType.API_RATE_LIMIT]: {
          strategy: RetryStrategy.FIXED_DELAY,
          maxRetries: 3,
          baseDelay: 60000, // Claude API限流等待1分钟
          respectRetryAfter: true
        },
        [ErrorType.AUTH_TOKEN_EXPIRED]: {
          strategy: RetryStrategy.NO_RETRY,
          maxRetries: 1,
          allowTokenRefresh: true // 允许token刷新后重试
        },
        [ErrorType.CONNECTION_ERROR]: {
          strategy: RetryStrategy.EXPONENTIAL_BACKOFF,
          maxRetries: 4,
          baseDelay: 2000,
          multiplier: 2
        },
        ...options.errorStrategies
      }
    })

    // 初始化错误处理器
    this.errorHandler = new EnhancedErrorHandler({
      enableSanitization: true,
      enableStatistics: true,
      defaultLanguage: 'zh', // Claude Relay主要服务中文用户
      includeStackTrace: process.env.NODE_ENV === 'development',
      enableRecoveryHints: true,
      ...options.errorHandlerOptions
    })

    // 服务特定配置
    this.serviceConfig = {
      claudeApiTimeout: options.claudeApiTimeout || 30000,
      tokenRefreshTimeout: options.tokenRefreshTimeout || 10000,
      maxConcurrentRetries: options.maxConcurrentRetries || 10,
      enableMetrics: options.enableMetrics !== false
    }

    logger.info('🔧 Error handling and retry integration initialized')
  }

  /**
   * Claude API请求重试包装器
   * @param {Function} apiCall - API调用函数
   * @param {Object} options - 调用选项
   * @returns {Promise} API调用结果
   */
  async executeClaudeApiCall(apiCall, options = {}) {
    const operationId = `claude_api_${Date.now()}_${Math.random().toString(36).substring(2)}`

    return await this.retryManager.executeWithRetry(
      async () => {
        try {
          const result = await apiCall()

          // 检查Claude API特定的错误响应
          if (result.statusCode && result.statusCode !== 200 && result.statusCode !== 201) {
            const error = new Error(`Claude API returned status ${result.statusCode}`)
            error.statusCode = result.statusCode
            error.response = result.body
            error.isUpstreamError = true
            throw error
          }

          return result
        } catch (error) {
          // 增强错误信息，便于重试管理器分类
          this.enhanceClaudeApiError(error)
          throw error
        }
      },
      {
        operationId,
        serviceName: 'claude_api',
        accountId: options.accountId,
        model: options.model,
        shouldRetry: (error, attempt) =>
          // 自定义重试逻辑
          this.shouldRetryClaudeApiCall(error, attempt, options)
      }
    )
  }

  /**
   * Token刷新重试包装器
   * @param {Function} refreshCall - Token刷新函数
   * @param {Object} options - 刷新选项
   * @returns {Promise} 刷新结果
   */
  async executeTokenRefresh(refreshCall, options = {}) {
    return await this.retryManager.executeWithRetry(refreshCall, {
      operationId: `token_refresh_${options.accountId || 'unknown'}`,
      serviceName: 'token_refresh',
      maxRetries: 2, // Token刷新只重试2次
      shouldRetry: (error, attempt) =>
        // Token刷新特定的重试逻辑
        attempt < 2 && !error.message.includes('invalid_grant')
    })
  }

  /**
   * 数据库操作重试包装器
   * @param {Function} dbOperation - 数据库操作函数
   * @param {Object} options - 操作选项
   * @returns {Promise} 操作结果
   */
  async executeDatabaseOperation(dbOperation, _options = {}) {
    return await this.retryManager.executeWithRetry(dbOperation, {
      operationId: `db_operation_${Date.now()}`,
      serviceName: 'database',
      shouldRetry: (error, attempt) => {
        // 数据库操作重试逻辑
        const message = error.message.toLowerCase()
        return (
          attempt < 3 &&
          (message.includes('connection') ||
            message.includes('timeout') ||
            message.includes('busy'))
        )
      }
    })
  }

  /**
   * 增强Claude API错误信息
   * @private
   */
  enhanceClaudeApiError(error) {
    const statusCode = error.statusCode || error.status || 0
    const message = error.message || ''
    const responseBody = error.response || error.body || ''

    // 标记为上游错误
    error.isUpstreamError = true
    error.source = 'claude_api'

    // 根据状态码增强错误类型
    if (statusCode === 401) {
      error.errorType = ErrorType.AUTH_TOKEN_EXPIRED
    } else if (statusCode === 429) {
      error.errorType = ErrorType.API_RATE_LIMIT

      // 提取重试延迟信息
      if (error.headers && error.headers['retry-after']) {
        error.retryAfter = parseInt(error.headers['retry-after'])
      }
    } else if (statusCode >= 500) {
      error.errorType = ErrorType.SERVER_ERROR
    } else if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
      error.errorType = ErrorType.TIMEOUT_ERROR
    } else if (message.includes('ECONNRESET') || message.includes('ECONNREFUSED')) {
      error.errorType = ErrorType.CONNECTION_ERROR
    } else {
      error.errorType = ErrorType.UNKNOWN_ERROR
    }

    // 解析Claude API特定的错误信息
    if (responseBody) {
      try {
        const parsedBody =
          typeof responseBody === 'string' ? JSON.parse(responseBody) : responseBody
        if (parsedBody.error) {
          error.claudeErrorType = parsedBody.error.type
          error.claudeErrorMessage = parsedBody.error.message
        }
      } catch (parseError) {
        // 忽略JSON解析错误
      }
    }
  }

  /**
   * 判断是否应该重试Claude API调用
   * @private
   */
  shouldRetryClaudeApiCall(error, attempt, options) {
    const maxRetries = options.maxRetries || 3

    if (attempt >= maxRetries) {
      return false
    }

    // 不重试的错误类型
    const nonRetryableErrors = [ErrorType.VALIDATION_ERROR, ErrorType.CLIENT_ERROR]

    if (nonRetryableErrors.includes(error.errorType)) {
      return false
    }

    // Token过期需要特殊处理
    if (error.errorType === ErrorType.AUTH_TOKEN_EXPIRED) {
      return options.allowTokenRefresh && attempt < 2
    }

    // API限流检查剩余重试次数
    if (error.errorType === ErrorType.API_RATE_LIMIT) {
      return attempt < 2 // 限流最多重试2次
    }

    return true
  }

  /**
   * Express错误处理中间件工厂
   * @returns {Function} Express中间件
   */
  createErrorMiddleware() {
    return this.errorHandler.middleware()
  }

  /**
   * 创建带重试的Claude服务客户端
   * @param {Object} claudeService - 原始Claude服务
   * @returns {Object} 增强的Claude服务
   */
  createEnhancedClaudeService(claudeService) {
    return {
      ...claudeService,

      // 包装relayRequest方法
      relayRequest: async (...args) =>
        await this.executeClaudeApiCall(() => claudeService.relayRequest(...args), {
          accountId: args[1]?.claudeAccountId,
          model: args[0]?.model
        }),

      // 包装流式请求方法
      relayStreamRequestWithUsageCapture: async (...args) =>
        await this.executeClaudeApiCall(
          () => claudeService.relayStreamRequestWithUsageCapture(...args),
          {
            accountId: args[1]?.claudeAccountId,
            model: args[0]?.model
          }
        ),

      // 包装健康检查
      healthCheck: async () =>
        await this.executeDatabaseOperation(() => claudeService.healthCheck(), {
          operationType: 'health_check'
        })
    }
  }

  /**
   * 创建带重试的账户服务客户端
   * @param {Object} accountService - 原始账户服务
   * @returns {Object} 增强的账户服务
   */
  createEnhancedAccountService(accountService) {
    return {
      ...accountService,

      // 包装token刷新方法
      refreshAccessToken: async (accountId) =>
        await this.executeTokenRefresh(() => accountService.refreshAccessToken(accountId), {
          accountId
        }),

      // 包装token获取方法
      getValidAccessToken: async (accountId) =>
        await this.executeDatabaseOperation(
          async () => {
            try {
              return await accountService.getValidAccessToken(accountId)
            } catch (error) {
              // 如果token过期，尝试刷新
              if (error.message.includes('expired') || error.statusCode === 401) {
                logger.info(`🔄 Token expired for account ${accountId}, attempting refresh`)
                await this.executeTokenRefresh(() => accountService.refreshAccessToken(accountId), {
                  accountId
                })
                return await accountService.getValidAccessToken(accountId)
              }
              throw error
            }
          },
          { accountId, operationType: 'get_token' }
        )
    }
  }

  /**
   * 获取综合监控统计
   * @returns {Object} 监控数据
   */
  getMonitoringData() {
    const retryStats = this.retryManager.getStatistics()
    const errorStats = this.errorHandler.getStatistics()
    const circuitBreakerStatus = this.retryManager.getCircuitBreakerStatus()

    return {
      timestamp: new Date().toISOString(),
      retryManager: {
        statistics: retryStats,
        circuitBreakers: circuitBreakerStatus,
        healthCheck: this.retryManager.healthCheck()
      },
      errorHandler: {
        statistics: errorStats,
        healthCheck: this.errorHandler.healthCheck()
      },
      services: {
        claude_api: retryStats.claude_api || { totalSuccesses: 0, totalFailures: 0 },
        token_refresh: retryStats.token_refresh || { totalSuccesses: 0, totalFailures: 0 },
        database: retryStats.database || { totalSuccesses: 0, totalFailures: 0 }
      }
    }
  }

  /**
   * 健康检查
   * @returns {Object} 整体健康状态
   */
  healthCheck() {
    const retryHealth = this.retryManager.healthCheck()
    const errorHealth = this.errorHandler.healthCheck()

    const overallHealthy = retryHealth.healthy && errorHealth.healthy

    return {
      healthy: overallHealthy,
      components: {
        retryManager: retryHealth,
        errorHandler: errorHealth
      },
      timestamp: new Date().toISOString()
    }
  }

  /**
   * 重置所有统计数据
   */
  resetAllStatistics() {
    this.retryManager.resetStatistics()
    this.errorHandler.resetStatistics()
    logger.info('📊 All error handling and retry statistics reset')
  }
}

/**
 * 创建全局实例的工厂函数
 */
function createErrorRetryIntegration(options = {}) {
  return new ErrorRetryIntegration(options)
}

/**
 * 默认配置用于Claude Relay Service
 */
const CLAUDE_RELAY_DEFAULT_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000,
  failureThreshold: 5,
  recoveryTimeout: 30000,
  claudeApiTimeout: 60000,
  tokenRefreshTimeout: 15000,
  errorHandlerOptions: {
    defaultLanguage: 'zh',
    enableRecoveryHints: true,
    maxErrorMessageLength: 500
  }
}

// 导出模块
module.exports = {
  ErrorRetryIntegration,
  createErrorRetryIntegration,
  CLAUDE_RELAY_DEFAULT_CONFIG
}
