/**
 * @fileoverview 错误处理和重试机制配置示例
 * 
 * 本文件提供了完整的错误处理和重试机制配置示例，
 * 可以集成到主配置文件中或作为独立的配置模块使用。
 * 
 * @author Claude Code
 * @version 1.0.0
 */

const { ErrorType, RetryStrategy } = require('../src/utils/retryManager')
const { ErrorCategory, ErrorSeverity } = require('../src/middleware/enhancedErrorHandler')

/**
 * 错误处理和重试配置
 */
const errorRetryConfig = {
  // 🔄 重试管理器配置
  retryManager: {
    // 基础重试配置
    maxRetries: parseInt(process.env.RETRY_MAX_ATTEMPTS) || 3,
    baseDelay: parseInt(process.env.RETRY_BASE_DELAY) || 1000,
    maxDelay: parseInt(process.env.RETRY_MAX_DELAY) || 30000,
    multiplier: parseFloat(process.env.RETRY_MULTIPLIER) || 2,
    jitter: parseFloat(process.env.RETRY_JITTER) || 0.1,
    
    // 🔗 熔断器配置
    circuitBreaker: {
      enabled: process.env.CIRCUIT_BREAKER_ENABLED !== 'false',
      failureThreshold: parseInt(process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD) || 5,
      recoveryTimeout: parseInt(process.env.CIRCUIT_BREAKER_RECOVERY_TIMEOUT) || 30000,
      halfOpenRetryCount: parseInt(process.env.CIRCUIT_BREAKER_HALF_OPEN_RETRY_COUNT) || 3
    },
    
    // 📋 错误类型特定策略
    errorStrategies: {
      // 网络错误 - 使用指数退避
      [ErrorType.NETWORK_ERROR]: {
        strategy: RetryStrategy.EXPONENTIAL_BACKOFF,
        maxRetries: parseInt(process.env.RETRY_NETWORK_ERROR_MAX) || 5,
        baseDelay: parseInt(process.env.RETRY_NETWORK_ERROR_DELAY) || 2000,
        multiplier: 2.5,
        jitter: 0.2
      },
      
      // API限流 - 使用固定延迟，尊重Retry-After头
      [ErrorType.API_RATE_LIMIT]: {
        strategy: RetryStrategy.FIXED_DELAY,
        maxRetries: parseInt(process.env.RETRY_RATE_LIMIT_MAX) || 3,
        baseDelay: parseInt(process.env.RETRY_RATE_LIMIT_DELAY) || 60000,
        respectRetryAfter: true
      },
      
      // 认证Token过期 - 不重试，需要外部刷新token
      [ErrorType.AUTH_TOKEN_EXPIRED]: {
        strategy: RetryStrategy.NO_RETRY,
        maxRetries: 0,
        allowTokenRefresh: true
      },
      
      // 连接错误 - 指数退避
      [ErrorType.CONNECTION_ERROR]: {
        strategy: RetryStrategy.EXPONENTIAL_BACKOFF,
        maxRetries: parseInt(process.env.RETRY_CONNECTION_ERROR_MAX) || 4,
        baseDelay: parseInt(process.env.RETRY_CONNECTION_ERROR_DELAY) || 1500,
        multiplier: 2
      },
      
      // 超时错误 - 线性退避
      [ErrorType.TIMEOUT_ERROR]: {
        strategy: RetryStrategy.LINEAR_BACKOFF,
        maxRetries: parseInt(process.env.RETRY_TIMEOUT_ERROR_MAX) || 3,
        baseDelay: parseInt(process.env.RETRY_TIMEOUT_ERROR_DELAY) || 5000
      },
      
      // 服务器错误 - 指数退避
      [ErrorType.SERVER_ERROR]: {
        strategy: RetryStrategy.EXPONENTIAL_BACKOFF,
        maxRetries: parseInt(process.env.RETRY_SERVER_ERROR_MAX) || 3,
        baseDelay: parseInt(process.env.RETRY_SERVER_ERROR_DELAY) || 2000
      },
      
      // 验证错误 - 不重试
      [ErrorType.VALIDATION_ERROR]: {
        strategy: RetryStrategy.NO_RETRY,
        maxRetries: 0
      },
      
      // 客户端错误 - 不重试
      [ErrorType.CLIENT_ERROR]: {
        strategy: RetryStrategy.NO_RETRY,
        maxRetries: 0
      },
      
      // 未知错误 - 保守重试
      [ErrorType.UNKNOWN_ERROR]: {
        strategy: RetryStrategy.EXPONENTIAL_BACKOFF,
        maxRetries: parseInt(process.env.RETRY_UNKNOWN_ERROR_MAX) || 2,
        baseDelay: parseInt(process.env.RETRY_UNKNOWN_ERROR_DELAY) || 3000
      }
    }
  },
  
  // 🛡️ 增强错误处理器配置
  errorHandler: {
    // 基础配置
    enableSanitization: process.env.ERROR_SANITIZATION_ENABLED !== 'false',
    enableStatistics: process.env.ERROR_STATISTICS_ENABLED !== 'false',
    defaultLanguage: process.env.ERROR_DEFAULT_LANGUAGE || 'zh',
    includeStackTrace: process.env.NODE_ENV === 'development' || process.env.ERROR_INCLUDE_STACK === 'true',
    logSensitiveData: process.env.ERROR_LOG_SENSITIVE === 'true',
    enableRecoveryHints: process.env.ERROR_RECOVERY_HINTS_ENABLED !== 'false',
    
    // 限制配置
    maxErrorMessageLength: parseInt(process.env.ERROR_MAX_MESSAGE_LENGTH) || 500,
    statisticsWindow: parseInt(process.env.ERROR_STATISTICS_WINDOW) || 300000, // 5分钟
    
    // 🌍 多语言错误消息扩展
    customMessages: {
      // 中文消息
      zh: {
        [ErrorCategory.AUTHENTICATION]: {
          message: '身份验证失败，请检查您的API密钥或登录凭据。',
          recovery: '请验证您的API密钥格式是否正确，或重新登录。'
        },
        [ErrorCategory.API_LIMIT]: {
          message: '您已达到API调用限制，请稍后再试。',
          recovery: '请等待限制重置时间，或考虑升级您的服务套餐。'
        },
        [ErrorCategory.UPSTREAM]: {
          message: 'Claude API服务暂时不可用，请稍后重试。',
          recovery: '这通常是临时问题，请等待几分钟后重试。'
        }
      },
      
      // 英文消息（fallback）
      en: {
        [ErrorCategory.AUTHENTICATION]: {
          message: 'Authentication failed. Please check your API key or login credentials.',
          recovery: 'Verify your API key format is correct or try logging in again.'
        },
        [ErrorCategory.API_LIMIT]: {
          message: 'You have reached the API rate limit. Please try again later.',
          recovery: 'Wait for the limit to reset or consider upgrading your service plan.'
        },
        [ErrorCategory.UPSTREAM]: {
          message: 'Claude API service is temporarily unavailable.',
          recovery: 'This is usually temporary. Please wait a few minutes and try again.'
        }
      }
    }
  },
  
  // 🎯 服务特定配置
  services: {
    // Claude API相关配置
    claudeApi: {
      timeout: parseInt(process.env.CLAUDE_API_TIMEOUT) || 60000,
      maxRetries: parseInt(process.env.CLAUDE_API_MAX_RETRIES) || 3,
      retryDelay: parseInt(process.env.CLAUDE_API_RETRY_DELAY) || 2000,
      circuitBreakerThreshold: parseInt(process.env.CLAUDE_API_CB_THRESHOLD) || 5,
      
      // Claude API特定错误映射
      errorMapping: {
        401: ErrorType.AUTH_TOKEN_EXPIRED,
        429: ErrorType.API_RATE_LIMIT,
        500: ErrorType.SERVER_ERROR,
        502: ErrorType.CONNECTION_ERROR,
        503: ErrorType.SERVER_ERROR,
        504: ErrorType.TIMEOUT_ERROR
      }
    },
    
    // Token刷新配置
    tokenRefresh: {
      timeout: parseInt(process.env.TOKEN_REFRESH_TIMEOUT) || 15000,
      maxRetries: parseInt(process.env.TOKEN_REFRESH_MAX_RETRIES) || 2,
      retryDelay: parseInt(process.env.TOKEN_REFRESH_RETRY_DELAY) || 3000
    },
    
    // 数据库操作配置
    database: {
      timeout: parseInt(process.env.DB_OPERATION_TIMEOUT) || 10000,
      maxRetries: parseInt(process.env.DB_OPERATION_MAX_RETRIES) || 3,
      retryDelay: parseInt(process.env.DB_OPERATION_RETRY_DELAY) || 1000,
      connectionRetries: parseInt(process.env.DB_CONNECTION_RETRIES) || 5
    }
  },
  
  // 📊 监控和统计配置
  monitoring: {
    enableMetrics: process.env.ERROR_METRICS_ENABLED !== 'false',
    metricsInterval: parseInt(process.env.ERROR_METRICS_INTERVAL) || 60000, // 1分钟
    persistStatistics: process.env.ERROR_PERSIST_STATS !== 'false',
    statisticsRetention: parseInt(process.env.ERROR_STATS_RETENTION) || 7 * 24 * 60 * 60 * 1000, // 7天
    
    // 告警配置
    alerting: {
      enabled: process.env.ERROR_ALERTING_ENABLED === 'true',
      errorRateThreshold: parseFloat(process.env.ERROR_RATE_THRESHOLD) || 0.1, // 10%错误率
      criticalErrorThreshold: parseInt(process.env.CRITICAL_ERROR_THRESHOLD) || 5, // 5个关键错误
      circuitBreakerAlerts: process.env.CB_ALERTS_ENABLED !== 'false'
    }
  },
  
  // 🔧 开发和调试配置
  development: {
    enableDebugLogs: process.env.NODE_ENV === 'development' || process.env.ERROR_DEBUG === 'true',
    verboseRetryLogs: process.env.VERBOSE_RETRY_LOGS === 'true',
    simulateErrors: process.env.SIMULATE_ERRORS === 'true',
    errorSimulationRate: parseFloat(process.env.ERROR_SIMULATION_RATE) || 0.05 // 5%模拟错误率
  }
}

/**
 * 根据环境生成动态配置
 * @param {string} env - 环境名称 (development, staging, production)
 * @returns {Object} 环境特定配置
 */
function getEnvironmentConfig(env) {
  const baseConfig = { ...errorRetryConfig }
  
  switch (env) {
    case 'development':
      return {
        ...baseConfig,
        retryManager: {
          ...baseConfig.retryManager,
          maxRetries: 2, // 开发环境减少重试次数
          baseDelay: 500 // 更快的重试
        },
        errorHandler: {
          ...baseConfig.errorHandler,
          includeStackTrace: true,
          enableRecoveryHints: true,
          logSensitiveData: false // 开发环境也不记录敏感数据
        },
        development: {
          ...baseConfig.development,
          enableDebugLogs: true,
          verboseRetryLogs: true
        }
      }
      
    case 'staging':
      return {
        ...baseConfig,
        retryManager: {
          ...baseConfig.retryManager,
          maxRetries: 3
        },
        errorHandler: {
          ...baseConfig.errorHandler,
          includeStackTrace: false,
          logSensitiveData: false
        },
        monitoring: {
          ...baseConfig.monitoring,
          enableMetrics: true,
          alerting: {
            ...baseConfig.monitoring.alerting,
            enabled: true
          }
        }
      }
      
    case 'production':
      return {
        ...baseConfig,
        retryManager: {
          ...baseConfig.retryManager,
          maxRetries: 5, // 生产环境增加重试次数
          circuitBreaker: {
            ...baseConfig.retryManager.circuitBreaker,
            enabled: true,
            failureThreshold: 3 // 生产环境更严格的熔断阈值
          }
        },
        errorHandler: {
          ...baseConfig.errorHandler,
          includeStackTrace: false,
          enableSanitization: true,
          logSensitiveData: false
        },
        monitoring: {
          ...baseConfig.monitoring,
          enableMetrics: true,
          persistStatistics: true,
          alerting: {
            ...baseConfig.monitoring.alerting,
            enabled: true,
            errorRateThreshold: 0.05, // 生产环境5%错误率告警
            criticalErrorThreshold: 3
          }
        },
        development: {
          ...baseConfig.development,
          enableDebugLogs: false,
          verboseRetryLogs: false,
          simulateErrors: false
        }
      }
      
    default:
      return baseConfig
  }
}

/**
 * 验证配置的有效性
 * @param {Object} config - 配置对象
 * @returns {Object} 验证结果
 */
function validateConfig(config) {
  const errors = []
  const warnings = []
  
  // 验证重试管理器配置
  if (config.retryManager.maxRetries < 0 || config.retryManager.maxRetries > 10) {
    errors.push('retryManager.maxRetries must be between 0 and 10')
  }
  
  if (config.retryManager.baseDelay < 100) {
    warnings.push('retryManager.baseDelay is less than 100ms, may cause excessive load')
  }
  
  if (config.retryManager.maxDelay < config.retryManager.baseDelay) {
    errors.push('retryManager.maxDelay must be greater than baseDelay')
  }
  
  // 验证熔断器配置
  if (config.retryManager.circuitBreaker.enabled) {
    if (config.retryManager.circuitBreaker.failureThreshold < 1) {
      errors.push('circuitBreaker.failureThreshold must be at least 1')
    }
    
    if (config.retryManager.circuitBreaker.recoveryTimeout < 1000) {
      warnings.push('circuitBreaker.recoveryTimeout is less than 1 second')
    }
  }
  
  // 验证错误处理器配置
  if (config.errorHandler.maxErrorMessageLength < 100) {
    warnings.push('errorHandler.maxErrorMessageLength is very small')
  }
  
  if (config.errorHandler.statisticsWindow < 60000) {
    warnings.push('errorHandler.statisticsWindow is less than 1 minute')
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings
  }
}

/**
 * 生成环境变量配置示例
 * @returns {string} 环境变量配置文本
 */
function generateEnvExample() {
  return `
# 错误处理和重试机制配置示例
# Error Handling and Retry Configuration Example

# 重试管理器配置 (Retry Manager Configuration)
RETRY_MAX_ATTEMPTS=3
RETRY_BASE_DELAY=1000
RETRY_MAX_DELAY=30000
RETRY_MULTIPLIER=2
RETRY_JITTER=0.1

# 熔断器配置 (Circuit Breaker Configuration)
CIRCUIT_BREAKER_ENABLED=true
CIRCUIT_BREAKER_FAILURE_THRESHOLD=5
CIRCUIT_BREAKER_RECOVERY_TIMEOUT=30000
CIRCUIT_BREAKER_HALF_OPEN_RETRY_COUNT=3

# 错误类型特定重试配置 (Error Type Specific Retry Configuration)
RETRY_NETWORK_ERROR_MAX=5
RETRY_NETWORK_ERROR_DELAY=2000
RETRY_RATE_LIMIT_MAX=3
RETRY_RATE_LIMIT_DELAY=60000
RETRY_CONNECTION_ERROR_MAX=4
RETRY_CONNECTION_ERROR_DELAY=1500
RETRY_TIMEOUT_ERROR_MAX=3
RETRY_TIMEOUT_ERROR_DELAY=5000
RETRY_SERVER_ERROR_MAX=3
RETRY_SERVER_ERROR_DELAY=2000
RETRY_UNKNOWN_ERROR_MAX=2
RETRY_UNKNOWN_ERROR_DELAY=3000

# 错误处理器配置 (Error Handler Configuration)
ERROR_SANITIZATION_ENABLED=true
ERROR_STATISTICS_ENABLED=true
ERROR_DEFAULT_LANGUAGE=zh
ERROR_INCLUDE_STACK=false
ERROR_LOG_SENSITIVE=false
ERROR_RECOVERY_HINTS_ENABLED=true
ERROR_MAX_MESSAGE_LENGTH=500
ERROR_STATISTICS_WINDOW=300000

# 服务特定配置 (Service Specific Configuration)
CLAUDE_API_TIMEOUT=60000
CLAUDE_API_MAX_RETRIES=3
CLAUDE_API_RETRY_DELAY=2000
CLAUDE_API_CB_THRESHOLD=5
TOKEN_REFRESH_TIMEOUT=15000
TOKEN_REFRESH_MAX_RETRIES=2
TOKEN_REFRESH_RETRY_DELAY=3000
DB_OPERATION_TIMEOUT=10000
DB_OPERATION_MAX_RETRIES=3
DB_OPERATION_RETRY_DELAY=1000
DB_CONNECTION_RETRIES=5

# 监控配置 (Monitoring Configuration)
ERROR_METRICS_ENABLED=true
ERROR_METRICS_INTERVAL=60000
ERROR_PERSIST_STATS=true
ERROR_STATS_RETENTION=604800000
ERROR_ALERTING_ENABLED=false
ERROR_RATE_THRESHOLD=0.1
CRITICAL_ERROR_THRESHOLD=5
CB_ALERTS_ENABLED=true

# 开发调试配置 (Development Debug Configuration)
ERROR_DEBUG=false
VERBOSE_RETRY_LOGS=false
SIMULATE_ERRORS=false
ERROR_SIMULATION_RATE=0.05
`
}

module.exports = {
  errorRetryConfig,
  getEnvironmentConfig,
  validateConfig,
  generateEnvExample
}