/**
 * @fileoverview 数据库工厂类
 *
 * 负责根据配置动态创建和管理数据库适配器实例
 * 支持多种数据库后端，提供统一的创建接口
 *
 * @author Claude Code
 * @version 1.0.0
 */

const DatabaseAdapter = require('./DatabaseAdapter')
const logger = require('../../utils/logger')

/**
 * 支持的数据库类型枚举
 */
const DATABASE_TYPES = {
  REDIS: 'redis',
  MONGODB: 'mongodb',
  MYSQL: 'mysql',
  POSTGRESQL: 'postgresql',
  SQLITE: 'sqlite'
}

/**
 * 数据库工厂类
 *
 * 实现工厂模式，根据配置创建相应的数据库适配器实例
 *
 * 架构特性:
 * - 遵循工厂模式，封装对象创建复杂性
 * - 支持配置驱动的适配器选择
 * - 提供单例模式确保适配器实例唯一性
 * - 支持运行时适配器切换（用于测试和迁移）
 * - 内置降级机制，默认回退到Redis
 */
class DatabaseFactory {
  constructor() {
    this.adapters = new Map() // 适配器实例缓存
    this.config = null
    this.currentAdapter = null
  }

  /**
   * 初始化工厂，设置配置
   * @param {Object} config 数据库配置对象
   * @param {string} config.type 数据库类型
   * @param {Object} config.options 数据库连接选项
   * @param {Object} config.fallback 降级配置
   */
  init(config) {
    if (!config) {
      throw new Error('Database configuration is required')
    }

    this.config = {
      type: config.type || DATABASE_TYPES.REDIS,
      options: config.options || {},
      fallback: config.fallback || {
        enabled: true,
        type: DATABASE_TYPES.REDIS,
        options: {}
      }
    }

    logger.info(`🏭 DatabaseFactory initialized with type: ${this.config.type}`)
  }

  /**
   * 创建数据库适配器实例
   * @param {string} type 数据库类型（可选，默认使用配置中的类型）
   * @param {Object} options 连接选项（可选，默认使用配置中的选项）
   * @returns {Promise<DatabaseAdapter>} 数据库适配器实例
   */
  async createAdapter(type = null, options = null) {
    const adapterType = type || this.config.type
    const adapterOptions = options || this.config.options

    // 检查缓存
    const cacheKey = this._generateCacheKey(adapterType, adapterOptions)
    if (this.adapters.has(cacheKey)) {
      logger.debug(`♻️ Reusing cached database adapter: ${adapterType}`)
      return this.adapters.get(cacheKey)
    }

    try {
      const adapter = await this._createAdapterInstance(adapterType, adapterOptions)

      // 验证适配器是否正确实现了所有必需方法
      this._validateAdapter(adapter)

      // 缓存适配器实例
      this.adapters.set(cacheKey, adapter)

      logger.info(`✅ Database adapter created successfully: ${adapterType}`)
      return adapter
    } catch (error) {
      logger.error(`❌ Failed to create database adapter: ${adapterType}`, error)

      // 尝试降级到fallback配置
      if (this.config.fallback.enabled && adapterType !== this.config.fallback.type) {
        logger.warn(`🔄 Attempting fallback to: ${this.config.fallback.type}`)
        return await this.createAdapter(this.config.fallback.type, this.config.fallback.options)
      }

      throw new Error(`Failed to create database adapter: ${error.message}`)
    }
  }

  /**
   * 获取当前活跃的适配器实例
   * @returns {Promise<DatabaseAdapter>} 当前适配器实例
   */
  async getCurrentAdapter() {
    if (!this.currentAdapter) {
      this.currentAdapter = await this.createAdapter()
    }
    return this.currentAdapter
  }

  /**
   * 切换数据库适配器（主要用于测试和迁移）
   * @param {string} type 新的数据库类型
   * @param {Object} options 新的连接选项
   * @returns {Promise<DatabaseAdapter>} 新的适配器实例
   */
  async switchAdapter(type, options) {
    logger.info(`🔄 Switching database adapter from ${this.config.type} to ${type}`)

    // 断开当前适配器连接
    if (this.currentAdapter && typeof this.currentAdapter.disconnect === 'function') {
      try {
        await this.currentAdapter.disconnect()
      } catch (error) {
        logger.warn('⚠️ Error disconnecting current adapter:', error)
      }
    }

    // 更新配置
    this.config.type = type
    this.config.options = options || {}

    // 创建新适配器
    this.currentAdapter = await this.createAdapter(type, options)

    return this.currentAdapter
  }

  /**
   * 获取支持的数据库类型列表
   * @returns {Array<string>} 支持的数据库类型
   */
  getSupportedTypes() {
    return Object.values(DATABASE_TYPES)
  }

  /**
   * 检查是否支持指定的数据库类型
   * @param {string} type 数据库类型
   * @returns {boolean} 是否支持
   */
  isTypeSupported(type) {
    return Object.values(DATABASE_TYPES).includes(type)
  }

  /**
   * 获取适配器统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    return {
      currentType: this.config?.type || 'not_configured',
      cachedAdapters: this.adapters.size,
      supportedTypes: this.getSupportedTypes(),
      fallbackEnabled: this.config?.fallback?.enabled || false
    }
  }

  /**
   * 清理工厂实例，断开所有适配器连接
   * @returns {Promise<void>}
   */
  async cleanup() {
    logger.info('🧹 Cleaning up DatabaseFactory...')

    const disconnectPromises = []

    for (const adapter of this.adapters.values()) {
      if (typeof adapter.disconnect === 'function') {
        disconnectPromises.push(
          adapter
            .disconnect()
            .catch((error) => logger.warn('⚠️ Error disconnecting adapter:', error))
        )
      }
    }

    await Promise.all(disconnectPromises)

    this.adapters.clear()
    this.currentAdapter = null

    logger.info('✅ DatabaseFactory cleanup completed')
  }

  // ==================== 私有方法 ====================

  /**
   * 创建具体的适配器实例
   * @private
   * @param {string} type 数据库类型
   * @param {Object} options 连接选项
   * @returns {Promise<DatabaseAdapter>} 适配器实例
   */
  async _createAdapterInstance(type, options) {
    switch (type) {
      case DATABASE_TYPES.REDIS:
        // 动态加载Redis适配器（使用新的RedisAdapter）
        const RedisAdapter = require('./RedisAdapter')
        const instance = new RedisAdapter()
        return instance

      case DATABASE_TYPES.MONGODB:
        // 未来实现：MongoDB适配器
        throw new Error(`MongoDB adapter is not implemented yet`)

      case DATABASE_TYPES.MYSQL:
        // 未来实现：MySQL适配器
        throw new Error(`MySQL adapter is not implemented yet`)

      case DATABASE_TYPES.POSTGRESQL:
        // 未来实现：PostgreSQL适配器
        throw new Error(`PostgreSQL adapter is not implemented yet`)

      case DATABASE_TYPES.SQLITE:
        // 未来实现：SQLite适配器
        throw new Error(`SQLite adapter is not implemented yet`)

      default:
        throw new Error(`Unsupported database type: ${type}`)
    }
  }

  /**
   * 验证适配器是否实现了所有必需方法
   * @private
   * @param {any} adapter 适配器实例
   */
  _validateAdapter(adapter) {
    // 必需的方法列表（从DatabaseAdapter抽象类提取）
    const requiredMethods = [
      // 连接管理
      'connect',
      'disconnect',
      'getClient',
      'getClientSafe',
      // API Key操作
      'setApiKey',
      'getApiKey',
      'deleteApiKey',
      'getAllApiKeys',
      'findApiKeyByHash',
      // 使用统计
      'incrementTokenUsage',
      'incrementAccountUsage',
      'getUsageStats',
      'getDailyCost',
      'incrementDailyCost',
      'getCostStats',
      'getAccountUsageStats',
      'getAllAccountsUsageStats',
      'resetAllUsageStats',
      // 账户管理
      'setClaudeAccount',
      'getClaudeAccount',
      'getAllClaudeAccounts',
      'deleteClaudeAccount',
      'updateClaudeAccountSchedulingFields',
      'incrementClaudeAccountUsageCount',
      'setOpenAiAccount',
      'getOpenAiAccount',
      'deleteOpenAiAccount',
      'getAllOpenAIAccounts',
      // 会话管理
      'setSession',
      'getSession',
      'deleteSession',
      'setApiKeyHash',
      'getApiKeyHash',
      'deleteApiKeyHash',
      'setOAuthSession',
      'getOAuthSession',
      'deleteOAuthSession',
      // 系统统计
      'getSystemStats',
      'getTodayStats',
      'getSystemAverages',
      'getRealtimeSystemMetrics',
      // 维护功能
      'setSessionAccountMapping',
      'getSessionAccountMapping',
      'deleteSessionAccountMapping',
      'cleanup',
      // 并发控制
      'incrConcurrency',
      'decrConcurrency',
      'getConcurrency',
      // 配置管理
      'setSystemSchedulingConfig',
      'getSystemSchedulingConfig',
      'deleteSystemSchedulingConfig'
    ]

    const missingMethods = []

    for (const method of requiredMethods) {
      if (typeof adapter[method] !== 'function') {
        missingMethods.push(method)
      }
    }

    if (missingMethods.length > 0) {
      throw new Error(`Adapter is missing required methods: ${missingMethods.join(', ')}`)
    }
  }

  /**
   * 生成适配器缓存键
   * @private
   * @param {string} type 数据库类型
   * @param {Object} options 连接选项
   * @returns {string} 缓存键
   */
  _generateCacheKey(type, options) {
    const optionsHash = JSON.stringify(options || {})
    return `${type}:${Buffer.from(optionsHash).toString('base64')}`
  }
}

// 导出工厂单例实例
const databaseFactory = new DatabaseFactory()

module.exports = {
  DatabaseFactory,
  databaseFactory,
  DATABASE_TYPES
}
