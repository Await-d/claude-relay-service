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

/**
 * 时区辅助函数
 * 注意：这个函数的目的是获取某个时间点在目标时区的"本地"表示
 * 例如：UTC时间 2025-07-30 01:00:00 在 UTC+8 时区表示为 2025-07-30 09:00:00
 *
 * @param {Date} date 要转换的日期对象，默认为当前时间
 * @returns {Date} 调整后的日期对象
 */
function getDateInTimezone(date = new Date()) {
  const offset = config.system.timezoneOffset || 8 // 默认UTC+8

  // 方法：创建一个偏移后的Date对象，使其getUTCXXX方法返回目标时区的值
  // 这样我们可以用getUTCFullYear()等方法获取目标时区的年月日时分秒
  const offsetMs = offset * 3600000 // 时区偏移的毫秒数
  const adjustedTime = new Date(date.getTime() + offsetMs)

  return adjustedTime
}

/**
 * 获取配置时区的日期字符串 (YYYY-MM-DD)
 *
 * @param {Date} date 要转换的日期对象，默认为当前时间
 * @returns {string} 格式化的日期字符串
 */
function getDateStringInTimezone(date = new Date()) {
  const tzDate = getDateInTimezone(date)
  // 使用UTC方法获取偏移后的日期部分
  return `${tzDate.getUTCFullYear()}-${String(tzDate.getUTCMonth() + 1).padStart(2, '0')}-${String(tzDate.getUTCDate()).padStart(2, '0')}`
}

/**
 * 获取配置时区的小时 (0-23)
 *
 * @param {Date} date 要转换的日期对象，默认为当前时间
 * @returns {number} 小时值 (0-23)
 */
function getHourInTimezone(date = new Date()) {
  const tzDate = getDateInTimezone(date)
  return tzDate.getUTCHours()
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

      // Symbol属性处理
      if (typeof prop === 'symbol') {
        return target[prop]
      }

      // 其他属性：从数据库实例获取
      return async function (...args) {
        try {
          const instance = await databaseManager.getInstance()

          if (typeof instance[prop] !== 'function') {
            throw new Error(`Method ${prop} is not available on database instance`)
          }

          return await instance[prop].apply(instance, args)
        } catch (error) {
          logger.error(`❌ Error calling database method ${prop}:`, error)
          throw error
        }
      }
    }
  }
)

// 导出统一数据库接口（与原redis.js完全兼容）
module.exports = databaseProxy

// 同时导出时区辅助函数（保持向后兼容）
module.exports.getDateInTimezone = getDateInTimezone
module.exports.getDateStringInTimezone = getDateStringInTimezone
module.exports.getHourInTimezone = getHourInTimezone

// 导出管理器实例（供高级用户使用）
module.exports._manager = databaseManager
module.exports._factory = databaseFactory
module.exports._config = DatabaseConfig

/**
 * 优雅关闭处理
 * 确保应用退出时正确清理数据库连接
 */
process.on('SIGINT', async () => {
  logger.info('🛑 Received SIGINT, closing database connections...')
  await databaseManager.cleanup()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  logger.info('🛑 Received SIGTERM, closing database connections...')
  await databaseManager.cleanup()
  process.exit(0)
})

// 处理未捕获的异常
process.on('uncaughtException', async (error) => {
  logger.error('💥 Uncaught Exception:', error)
  await databaseManager.cleanup()
  process.exit(1)
})

process.on('unhandledRejection', async (reason, promise) => {
  logger.error('💥 Unhandled Rejection at:', promise, 'reason:', reason)
  await databaseManager.cleanup()
  process.exit(1)
})
