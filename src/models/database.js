/**
 * @fileoverview 统一数据库接口层
 *
 * 作为数据库操作的统一入口点，提供与原redis.js完全相同的导出接口
 * 支持通过配置切换不同的数据库后端，实现完全向后兼容
 *
 * 核心特性：
 * - 工厂模式创建数据库实例
 * - 配置驱动的数据库选择
 * - 与原redis.js 100%兼容的API
 * - 包含所有时区辅助函数
 * - 默认Redis后端确保零风险迁移
 *
 * @author Claude Code
 * @version 1.0.0
 */

const config = require('../../config/config')
const logger = require('../utils/logger')
const { databaseFactory, DATABASE_TYPES } = require('./database/DatabaseFactory')

// 导入统一时区处理工具
const dateHelper = require('../utils/dateHelper')

/**
 * 时区辅助函数（向下兼容包装器）
 * 注意：这些函数现在由 dateHelper.js 提供实现，此处仅为向下兼容
 *
 * @param {Date} date 要转换的日期对象，默认为当前时间
 * @returns {Date} 调整后的日期对象
 */
function getDateInTimezone(date = new Date()) {
  return dateHelper.getDateInTimezone(date)
}

/**
 * 获取配置时区的日期字符串 (YYYY-MM-DD)
 *
 * @param {Date} date 要转换的日期对象，默认为当前时间
 * @returns {string} 格式化的日期字符串
 */
function getDateStringInTimezone(date = new Date()) {
  return dateHelper.getDateStringInTimezone(date)
}

/**
 * 获取配置时区的小时 (0-23)
 *
 * @param {Date} date 要转换的日期对象，默认为当前时间
 * @returns {number} 小时值 (0-23)
 */
function getHourInTimezone(date = new Date()) {
  return dateHelper.getHourInTimezone(date)
}

/**
 * 数据库配置管理类
 *
 * 负责解析配置文件中的数据库设置，并为DatabaseFactory提供标准化的配置
 */
class DatabaseConfig {
  constructor() {
    this.config = this._parseConfig()
  }

  /**
   * 解析数据库配置
   * @private
   * @returns {Object} 标准化的数据库配置
   */
  _parseConfig() {
    // 从环境变量或配置文件获取数据库类型，默认为Redis
    const databaseType = process.env.DATABASE_TYPE || 'redis'

    // 验证数据库类型是否支持
    if (!Object.values(DATABASE_TYPES).includes(databaseType)) {
      logger.warn(`⚠️ Unsupported database type: ${databaseType}, falling back to Redis`)
    }

    // 根据数据库类型构建配置
    const databaseConfig = {
      type: databaseType,
      options: this._getDatabaseOptions(databaseType),
      fallback: {
        enabled: true,
        type: DATABASE_TYPES.REDIS,
        options: this._getDatabaseOptions(DATABASE_TYPES.REDIS)
      }
    }

    logger.info(`🎯 Database configuration loaded: ${databaseType}`)
    return databaseConfig
  }

  /**
   * 根据数据库类型获取连接选项
   * @private
   * @param {string} type 数据库类型
   * @returns {Object} 数据库连接选项
   */
  _getDatabaseOptions(type) {
    switch (type) {
      case DATABASE_TYPES.REDIS:
        return {
          host: config.redis.host,
          port: config.redis.port,
          password: config.redis.password,
          db: config.redis.db,
          connectTimeout: config.redis.connectTimeout,
          commandTimeout: config.redis.commandTimeout,
          retryDelayOnFailover: config.redis.retryDelayOnFailover,
          maxRetriesPerRequest: config.redis.maxRetriesPerRequest,
          lazyConnect: config.redis.lazyConnect,
          enableTLS: config.redis.enableTLS
        }

      case DATABASE_TYPES.MONGODB:
        // 未来实现：从config中读取MongoDB配置
        return {
          uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/claude-relay',
          options: {
            useNewUrlParser: true,
            useUnifiedTopology: true
          }
        }

      case DATABASE_TYPES.POSTGRESQL:
        // 未来实现：从config中读取PostgreSQL配置
        return {
          host: process.env.POSTGRES_HOST || 'localhost',
          port: parseInt(process.env.POSTGRES_PORT) || 5432,
          database: process.env.POSTGRES_DB || 'claude_relay',
          username: process.env.POSTGRES_USER || 'postgres',
          password: process.env.POSTGRES_PASSWORD || ''
        }

      default:
        logger.warn(`⚠️ Unknown database type: ${type}, using Redis options`)
        return this._getDatabaseOptions(DATABASE_TYPES.REDIS)
    }
  }

  /**
   * 获取当前数据库配置
   * @returns {Object} 数据库配置
   */
  getConfig() {
    return this.config
  }
}

/**
 * 数据库实例管理器
 *
 * 负责创建、缓存和管理数据库适配器实例
 * 提供与原redis.js完全相同的接口
 */
class DatabaseManager {
  constructor() {
    this.instance = null
    this.isInitialized = false
    this.configManager = new DatabaseConfig()
  }

  /**
   * 初始化数据库连接
   * @returns {Promise<Object>} 数据库实例
   */
  async init() {
    if (this.isInitialized && this.instance) {
      return this.instance
    }

    try {
      // 初始化DatabaseFactory
      const dbConfig = this.configManager.getConfig()
      databaseFactory.init(dbConfig)

      // 创建数据库适配器实例
      this.instance = await databaseFactory.getCurrentAdapter()

      // 连接数据库
      if (typeof this.instance.connect === 'function') {
        await this.instance.connect()
      }

      // 为了与原redis.js保持完全兼容，需要将时区函数添加到实例上
      this.instance.getDateInTimezone = getDateInTimezone
      this.instance.getDateStringInTimezone = getDateStringInTimezone
      this.instance.getHourInTimezone = getHourInTimezone

      this.isInitialized = true

      logger.info('✅ Database instance initialized successfully')
      return this.instance
    } catch (error) {
      logger.error('❌ Failed to initialize database instance:', error)
      throw error
    }
  }

  /**
   * 获取数据库实例
   * 如果未初始化，则自动初始化
   * @returns {Promise<Object>} 数据库实例
   */
  async getInstance() {
    if (!this.isInitialized || !this.instance) {
      return await this.init()
    }
    return this.instance
  }

  /**
   * 重置数据库连接
   * 主要用于测试或配置更改后的重连
   * @returns {Promise<Object>} 新的数据库实例
   */
  async reset() {
    if (this.instance && typeof this.instance.disconnect === 'function') {
      try {
        await this.instance.disconnect()
      } catch (error) {
        logger.warn('⚠️ Error during database disconnection:', error)
      }
    }

    this.instance = null
    this.isInitialized = false

    return await this.init()
  }

  /**
   * 优雅关闭数据库连接
   * @returns {Promise<void>}
   */
  async cleanup() {
    if (this.instance && typeof this.instance.disconnect === 'function') {
      try {
        await this.instance.disconnect()
        logger.info('🧹 Database connection closed successfully')
      } catch (error) {
        logger.error('❌ Error during database cleanup:', error)
      }
    }

    this.instance = null
    this.isInitialized = false
  }

  /**
   * 获取数据库状态信息
   * @returns {Object} 状态信息
   */
  getStatus() {
    return {
      isInitialized: this.isInitialized,
      hasInstance: !!this.instance,
      databaseType: this.configManager.getConfig().type,
      factoryStats: databaseFactory.getStats()
    }
  }
}

// 创建全局数据库管理器实例
const databaseManager = new DatabaseManager()

/**
 * 获取数据库实例的代理对象
 *
 * 这个代理对象会自动初始化数据库连接，并转发所有方法调用
 * 确保与原redis.js的使用方式完全一致
 */
const databaseProxy = new Proxy(
  {},
  {
    get(target, prop) {
      // 特殊属性：时区辅助函数直接返回
      if (prop === 'getDateInTimezone') {
        return getDateInTimezone
      }
      if (prop === 'getDateStringInTimezone') {
        return getDateStringInTimezone
      }
      if (prop === 'getHourInTimezone') {
        return getHourInTimezone
      }

      // 数据库管理器方法
      if (prop === '_manager') {
        return databaseManager
      }
      if (prop === '_factory') {
        return databaseFactory
      }
      if (prop === '_config') {
        return DatabaseConfig
      }

      // 模块管理方法特殊处理（不通过数据库实例转发）

      // 数据库状态方法
      if (prop === 'getDatabaseStatus') {
        return function () {
          return {
            ...databaseManager.getStatus(),
            proxy: {
              type: 'unified_proxy',
              methods: Object.getOwnPropertyNames(module.exports).filter(
                (name) =>
                  typeof module.exports[name] === 'function' &&
                  !name.startsWith('_') &&
                  name !== 'getDatabaseStatus'
              ).length
            }
          }
        }
      }

      // 数据库切换方法
      if (prop === 'switchDatabase') {
        return async function (type, _options) {
          logger.info(`🔄 Switching database to ${type}`)

          if (!databaseManager.isInitialized) {
            throw new Error('Database module is not initialized')
          }

          // 重置并重新初始化
          await databaseManager.reset()

          // 更新配置
          process.env.DATABASE_TYPE = type

          return await databaseManager.getInstance()
        }
      }

      // 数据库初始化方法
      if (prop === 'initDatabase') {
        return async function (databaseConfig = null) {
          logger.info('🎯 Initializing database module with custom config...')

          if (databaseConfig) {
            // 如果提供了自定义配置，更新环境变量
            if (databaseConfig.type) {
              process.env.DATABASE_TYPE = databaseConfig.type
            }
          }

          // 重置现有连接
          await databaseManager.reset()

          return await databaseManager.getInstance()
        }
      }

      // 获取数据库实例方法
      if (prop === 'getDatabase') {
        return async function () {
          return await databaseManager.getInstance()
        }
      }

      // 向后兼容的Redis客户端获取
      if (prop === 'getRedisClient') {
        return function () {
          logger.warn('⚠️ getRedisClient() is deprecated, use getClient() instead')
          return databaseProxy.getClient()
        }
      }

      // 数据库类型常量
      if (prop === 'DATABASE_TYPES') {
        return DATABASE_TYPES
      }
      if (prop === 'REDIS') {
        return DATABASE_TYPES.REDIS
      }
      if (prop === 'MONGODB') {
        return DATABASE_TYPES.MONGODB
      }
      if (prop === 'MYSQL') {
        return DATABASE_TYPES.MYSQL
      }
      if (prop === 'POSTGRESQL') {
        return DATABASE_TYPES.POSTGRESQL
      }
      if (prop === 'SQLITE') {
        return DATABASE_TYPES.SQLITE
      }

      // client属性特殊处理 - 同步返回客户端
      if (prop === 'client') {
        return (
          target._clientProxy ||
          (target._clientProxy = new Proxy(
            {},
            {
              get(clientTarget, clientProp) {
                // 返回异步函数，调用时获取实例
                return async function (...args) {
                  try {
                    const instance = await databaseManager.getInstance()
                    const client = instance.getClient()

                    if (!client) {
                      throw new Error('Database client is not available')
                    }

                    if (typeof client[clientProp] !== 'function') {
                      throw new Error(`Method ${clientProp} is not available on database client`)
                    }

                    return await client[clientProp].apply(client, args)
                  } catch (error) {
                    logger.error(`❌ Error calling database client method ${clientProp}:`, error)
                    throw error
                  }
                }
              }
            }
          ))
        )
      }

      // 连接管理方法特殊处理
      if (prop === 'connect') {
        return async function (...args) {
          try {
            const instance = await databaseManager.getInstance()
            if (typeof instance.connect === 'function') {
              return await instance.connect.apply(instance, args)
            }
            return instance
          } catch (error) {
            logger.error(`❌ Error connecting database:`, error)
            throw error
          }
        }
      }

      if (prop === 'disconnect') {
        return async function (...args) {
          try {
            if (
              databaseManager.instance &&
              typeof databaseManager.instance.disconnect === 'function'
            ) {
              return await databaseManager.instance.disconnect.apply(databaseManager.instance, args)
            }
            return true
          } catch (error) {
            logger.error(`❌ Error disconnecting database:`, error)
            throw error
          }
        }
      }

      // 同步方法处理 (getClient, getClientSafe等)
      const syncMethods = ['getClient', 'getClientSafe']
      if (syncMethods.includes(prop)) {
        return function (...args) {
          try {
            // 如果已经初始化，直接返回
            if (databaseManager.isInitialized && databaseManager.instance) {
              const result = databaseManager.instance[prop].apply(databaseManager.instance, args)
              return result
            } else {
              logger.warn(`⚠️ Database not initialized, ${prop} returning null`)
              return null
            }
          } catch (error) {
            logger.error(`❌ Error calling sync database method ${prop}:`, error)
            throw error
          }
        }
      }

      // Symbol属性处理
      if (typeof prop === 'symbol') {
        return target[prop]
      }

      // 其他属性：从数据库实例获取（异步方法）
      return async function (...args) {
        try {
          const instance = await databaseManager.getInstance()

          if (typeof instance[prop] !== 'function') {
            throw new Error(`Method ${prop} is not available on database instance`)
          }

          return await instance[prop].apply(instance, args)
        } catch (error) {
          // 检查是否是连接错误，尝试重连
          if (error.message && error.message.includes('Connection is closed')) {
            logger.warn(`⚠️ Database connection error for ${prop}, attempting reconnection...`)
            try {
              // 尝试重新获取连接的实例
              const freshInstance = await databaseManager.getInstance()
              if (freshInstance && typeof freshInstance.connect === 'function') {
                await freshInstance.connect()
                // 重试原始操作
                return await freshInstance[prop].apply(freshInstance, args)
              }
            } catch (reconnectError) {
              logger.error(`💥 Failed to reconnect database for ${prop}:`, reconnectError)
              throw new Error(`Database reconnection failed: ${reconnectError.message}`)
            }
          }

          logger.error(`❌ Error calling database method ${prop}:`, error)
          throw error
        }
      }
    }
  }
)

// 导出统一数据库接口（与原redis.js完全兼容）
module.exports = databaseProxy

// 为IDE智能提示添加方法定义（静态方法定义）
// 这些方法实际由Proxy动态处理，但IDE需要静态定义来识别

// 时区辅助函数（同步函数）
module.exports.getDateInTimezone = getDateInTimezone
module.exports.getDateStringInTimezone = getDateStringInTimezone
module.exports.getHourInTimezone = getHourInTimezone

// 连接管理方法
module.exports.connect = async function (...args) {
  return await databaseProxy.connect(...args)
}
module.exports.disconnect = async function (...args) {
  return await databaseProxy.disconnect(...args)
}
module.exports.getClient = function (...args) {
  return databaseProxy.getClient(...args)
}
module.exports.getClientSafe = function (...args) {
  return databaseProxy.getClientSafe(...args)
}
module.exports.ping = async function (...args) {
  return await databaseProxy.ping(...args)
}

// Redis基础操作方法 - IDE识别 + 实际转发到Proxy
module.exports.keys = async function (...args) {
  return await databaseProxy.keys(...args)
}
module.exports.get = async function (...args) {
  return await databaseProxy.get(...args)
}
module.exports.set = async function (...args) {
  return await databaseProxy.set(...args)
}
module.exports.del = async function (...args) {
  return await databaseProxy.del(...args)
}
module.exports.hget = async function (...args) {
  return await databaseProxy.hget(...args)
}
module.exports.hset = async function (...args) {
  return await databaseProxy.hset(...args)
}
module.exports.hgetall = async function (...args) {
  return await databaseProxy.hgetall(...args)
}
module.exports.hdel = async function (...args) {
  return await databaseProxy.hdel(...args)
}
module.exports.hmset = async function (...args) {
  return await databaseProxy.hmset(...args)
}
module.exports.expire = async function (...args) {
  return await databaseProxy.expire(...args)
}
module.exports.incr = async function (...args) {
  return await databaseProxy.incr(...args)
}
module.exports.decr = async function (...args) {
  return await databaseProxy.decr(...args)
}
module.exports.type = async function (...args) {
  return await databaseProxy.type(...args)
}

// 兼容性方法
module.exports.hsetCompat = async function (...args) {
  return await databaseProxy.hsetCompat(...args)
}

// API Key 操作方法 - IDE识别 + 实际转发到Proxy
module.exports.setApiKey = async function (...args) {
  return await databaseProxy.setApiKey(...args)
}
module.exports.getApiKey = async function (...args) {
  return await databaseProxy.getApiKey(...args)
}
module.exports.deleteApiKey = async function (...args) {
  return await databaseProxy.deleteApiKey(...args)
}
module.exports.getAllApiKeys = async function (...args) {
  return await databaseProxy.getAllApiKeys(...args)
}
module.exports.findApiKeyByHash = async function (...args) {
  return await databaseProxy.findApiKeyByHash(...args)
}

// 使用统计操作方法 - IDE识别 + 实际转发到Proxy
module.exports.incrementTokenUsage = async function (...args) {
  return await databaseProxy.incrementTokenUsage(...args)
}
module.exports.incrementAccountUsage = async function (...args) {
  return await databaseProxy.incrementAccountUsage(...args)
}
module.exports.getUsageStats = async function (...args) {
  return await databaseProxy.getUsageStats(...args)
}
module.exports.getDailyCost = async function (...args) {
  return await databaseProxy.getDailyCost(...args)
}
module.exports.incrementDailyCost = async function (...args) {
  return await databaseProxy.incrementDailyCost(...args)
}
module.exports.getCostStats = async function (...args) {
  return await databaseProxy.getCostStats(...args)
}
module.exports.getAccountUsageStats = async function (...args) {
  return await databaseProxy.getAccountUsageStats(...args)
}
module.exports.getAllAccountsUsageStats = async function (...args) {
  return await databaseProxy.getAllAccountsUsageStats(...args)
}
module.exports.resetAllUsageStats = async function (...args) {
  return await databaseProxy.resetAllUsageStats(...args)
}

// ==========================================
// 日志存储抽象接口 (Log Storage Abstract Interface)
// ==========================================

/**
 * 批量写入日志条目
 * @param {Array} logEntries 日志条目数组
 * @param {Object} options 配置选项
 * @returns {Promise<Object>} 写入结果
 */
module.exports.batchWriteLogs = async function (...args) {
  return await databaseProxy.batchWriteLogs(...args)
}

/**
 * 验证日志写入结果
 * @param {string} logKey 日志键
 * @returns {Promise<Object>} 验证结果
 */
module.exports.verifyLogWrite = async function (...args) {
  return await databaseProxy.verifyLogWrite(...args)
}

// 系统统计方法 - IDE识别 + 实际转发到Proxy
module.exports.getSystemStats = async function (...args) {
  return await databaseProxy.getSystemStats(...args)
}
module.exports.getSessionWindowUsage = async function (...args) {
  return await databaseProxy.getSessionWindowUsage(...args)
}
module.exports.getTodayStats = async function (...args) {
  return await databaseProxy.getTodayStats(...args)
}
module.exports.getSystemAverages = async function (...args) {
  return await databaseProxy.getSystemAverages(...args)
}
module.exports.getRealtimeSystemMetrics = async function (...args) {
  return await databaseProxy.getRealtimeSystemMetrics(...args)
}

// 账户管理方法 - IDE识别 + 实际转发到Proxy
module.exports.setClaudeAccount = async function (...args) {
  return await databaseProxy.setClaudeAccount(...args)
}
module.exports.getClaudeAccount = async function (...args) {
  return await databaseProxy.getClaudeAccount(...args)
}
module.exports.getAllClaudeAccounts = async function (...args) {
  return await databaseProxy.getAllClaudeAccounts(...args)
}
module.exports.deleteClaudeAccount = async function (...args) {
  return await databaseProxy.deleteClaudeAccount(...args)
}
module.exports.updateClaudeAccountSchedulingFields = async function (...args) {
  return await databaseProxy.updateClaudeAccountSchedulingFields(...args)
}
module.exports.incrementClaudeAccountUsageCount = async function (...args) {
  return await databaseProxy.incrementClaudeAccountUsageCount(...args)
}
module.exports.setOpenAiAccount = async function (...args) {
  return await databaseProxy.setOpenAiAccount(...args)
}
module.exports.getOpenAiAccount = async function (...args) {
  return await databaseProxy.getOpenAiAccount(...args)
}
module.exports.deleteOpenAiAccount = async function (...args) {
  return await databaseProxy.deleteOpenAiAccount(...args)
}
module.exports.getAllOpenAIAccounts = async function (...args) {
  return await databaseProxy.getAllOpenAIAccounts(...args)
}

// 会话管理方法 - IDE识别 + 实际转发到Proxy
module.exports.setSession = async function (...args) {
  return await databaseProxy.setSession(...args)
}
module.exports.getSession = async function (...args) {
  return await databaseProxy.getSession(...args)
}
module.exports.deleteSession = async function (...args) {
  return await databaseProxy.deleteSession(...args)
}
module.exports.setApiKeyHash = async function (...args) {
  return await databaseProxy.setApiKeyHash(...args)
}
module.exports.getApiKeyHash = async function (...args) {
  return await databaseProxy.getApiKeyHash(...args)
}
module.exports.deleteApiKeyHash = async function (...args) {
  return await databaseProxy.deleteApiKeyHash(...args)
}
module.exports.setOAuthSession = async function (...args) {
  return await databaseProxy.setOAuthSession(...args)
}
module.exports.getOAuthSession = async function (...args) {
  return await databaseProxy.getOAuthSession(...args)
}
module.exports.deleteOAuthSession = async function (...args) {
  return await databaseProxy.deleteOAuthSession(...args)
}

// 维护功能方法 - IDE识别 + 实际转发到Proxy
module.exports.setSessionAccountMapping = async function (...args) {
  return await databaseProxy.setSessionAccountMapping(...args)
}
module.exports.getSessionAccountMapping = async function (...args) {
  return await databaseProxy.getSessionAccountMapping(...args)
}
module.exports.deleteSessionAccountMapping = async function (...args) {
  return await databaseProxy.deleteSessionAccountMapping(...args)
}
module.exports.cleanup = async function (...args) {
  // 这是一个轻量级清理方法，用于定时任务
  // 不会关闭数据库连接，只是清理缓存等资源
  try {
    const instance = await databaseManager.getInstance()
    if (typeof instance.cleanup === 'function') {
      return await instance.cleanup(...args)
    }
    logger.debug('✅ Database cleanup completed (no cleanup method available)')
    return true
  } catch (error) {
    logger.error('❌ Database cleanup failed:', error)
    throw error
  }
}

// 并发控制方法 - IDE识别 + 实际转发到Proxy
module.exports.incrConcurrency = async function (...args) {
  return await databaseProxy.incrConcurrency(...args)
}
module.exports.decrConcurrency = async function (...args) {
  return await databaseProxy.decrConcurrency(...args)
}
module.exports.getConcurrency = async function (...args) {
  return await databaseProxy.getConcurrency(...args)
}

// 配置管理方法 - IDE识别 + 实际转发到Proxy
module.exports.setSystemSchedulingConfig = async function (...args) {
  return await databaseProxy.setSystemSchedulingConfig(...args)
}
module.exports.getSystemSchedulingConfig = async function (...args) {
  return await databaseProxy.getSystemSchedulingConfig(...args)
}
module.exports.deleteSystemSchedulingConfig = async function (...args) {
  return await databaseProxy.deleteSystemSchedulingConfig(...args)
}

// client属性（这个无法预定义，但实际使用时Proxy会处理）
// module.exports.client = {} // 由Proxy动态处理

// 扩展的模块管理功能（整合自database/index.js）

/**
 * 向后兼容的Redis客户端获取
 * @deprecated 建议使用 getClient() 方法
 * @returns {any} Redis客户端实例
 */
module.exports.getRedisClient = function () {
  logger.warn('⚠️ getRedisClient() is deprecated, use getClient() instead')
  return databaseProxy.getClient()
}

/**
 * 切换数据库类型（主要用于测试和迁移）
 * @param {string} type 数据库类型
 * @param {Object} options 连接选项
 * @returns {Promise<Object>} 新的数据库适配器实例
 */
module.exports.switchDatabase = async function (type, _options) {
  logger.info(`🔄 Switching database to ${type}`)

  if (!databaseManager.isInitialized) {
    throw new Error('Database module is not initialized')
  }

  // 重置并重新初始化
  await databaseManager.reset()

  // 更新配置
  process.env.DATABASE_TYPE = type

  return await databaseManager.getInstance()
}

/**
 * 获取数据库状态和统计信息
 * @returns {Object} 状态信息
 */
module.exports.getDatabaseStatus = function () {
  return {
    ...databaseManager.getStatus(),
    proxy: {
      type: 'unified_proxy',
      methods: Object.getOwnPropertyNames(module.exports).filter(
        (name) =>
          typeof module.exports[name] === 'function' &&
          !name.startsWith('_') &&
          name !== 'getDatabaseStatus'
      ).length
    }
  }
}

/**
 * 初始化数据库模块
 * @param {Object} config 数据库配置
 * @returns {Promise<Object>} 数据库实例
 */
module.exports.initDatabase = async function (databaseConfig = null) {
  logger.info('🎯 Initializing database module with custom config...')

  if (databaseConfig) {
    // 如果提供了自定义配置，更新环境变量
    if (databaseConfig.type) {
      process.env.DATABASE_TYPE = databaseConfig.type
    }
  }

  // 重置现有连接
  await databaseManager.reset()

  return await databaseManager.getInstance()
}

/**
 * 获取当前数据库实例（直接访问）
 * @returns {Promise<Object>} 数据库适配器实例
 */
module.exports.getDatabase = async function () {
  return await databaseManager.getInstance()
}

// 请求日志相关方法 - IDE识别 + 实际转发到Proxy
module.exports.searchLogs = async function (...args) {
  return await databaseProxy.searchLogs(...args)
}
module.exports.countLogs = async function (...args) {
  return await databaseProxy.countLogs(...args)
}
module.exports.aggregateLogs = async function (...args) {
  return await databaseProxy.aggregateLogs(...args)
}
module.exports.exportLogs = async function (...args) {
  return await databaseProxy.exportLogs(...args)
}
module.exports.deleteLogs = async function (...args) {
  return await databaseProxy.deleteLogs(...args)
}
module.exports.deleteExpiredLogs = async function (...args) {
  return await databaseProxy.deleteExpiredLogs(...args)
}
module.exports.getRequestLogsConfig = async function (...args) {
  return await databaseProxy.getRequestLogsConfig(...args)
}
module.exports.setRequestLogsConfig = async function (...args) {
  return await databaseProxy.setRequestLogsConfig(...args)
}
module.exports.getRequestLogDetails = async function (...args) {
  return await databaseProxy.getRequestLogDetails(...args)
}

// 管理器实例（供高级用户使用）
module.exports._manager = databaseManager
module.exports._factory = databaseFactory
module.exports._config = DatabaseConfig

// 导出数据库类型常量（便捷访问）
module.exports.DATABASE_TYPES = DATABASE_TYPES
module.exports.REDIS = DATABASE_TYPES.REDIS
module.exports.MONGODB = DATABASE_TYPES.MONGODB
module.exports.MYSQL = DATABASE_TYPES.MYSQL
module.exports.POSTGRESQL = DATABASE_TYPES.POSTGRESQL
module.exports.SQLITE = DATABASE_TYPES.SQLITE

/**
 * 数据库优雅关闭处理
 * 注意：这些监听器只在数据库模块作为独立进程运行时使用
 * 当作为模块被其他应用程序导入时，应用程序负责调用 cleanup()
 */

// 只在非主模块模式下注册进程监听器
if (require.main === module) {
  // 仅在直接运行���文件时才注册进程监听器
  process.on('SIGINT', async () => {
    logger.info('🛑 Database module received SIGINT, closing connections...')
    await databaseManager.cleanup()
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    logger.info('🛑 Database module received SIGTERM, closing connections...')
    await databaseManager.cleanup()
    process.exit(0)
  })

  // 处理未捕获的异常
  process.on('uncaughtException', async (error) => {
    logger.error('💥 Database module uncaught exception:', error)
    await databaseManager.cleanup()
    process.exit(1)
  })

  process.on('unhandledRejection', async (reason, promise) => {
    logger.error('💥 Database module unhandled rejection at:', promise, 'reason:', reason)
    await databaseManager.cleanup()
    process.exit(1)
  })
} else {
  // 作为模块被导入时，不注册全局监听器
  // 但为主应用程序提供清理函数
  logger.debug('📦 Database module loaded as dependency, skipping process listeners')
}
