/**
 * @fileoverview UnifiedLogService工厂类 - 依赖注入容器
 *
 * 负责创建和管理UnifiedLogService实例，处理依赖注入和配置管理
 * 实现工厂模式和单例模式的结合，提供类型安全的服务实例化
 *
 * 架构特点：
 * - 工厂模式：封装复杂的对象创建逻辑
 * - 依赖注入容器：管理和注入服务依赖
 * - 单例模式：确保服务实例的一致性
 * - 配置驱动：从config.js读取配置参数
 * - 错误处理：完善的依赖验证和错误恢复
 *
 * @author Claude Code
 * @version 1.0.0
 */

const { UnifiedLogService } = require('./UnifiedLogService')
const HeadersFilterService = require('./HeadersFilterService')
const logger = require('../utils/logger')

/**
 * UnifiedLogService工厂类
 *
 * 负责创建和管理UnifiedLogService实例，提供依赖注入和配置管理功能
 *
 * 核心功能：
 * - 依赖注入容器：自动解析和注入服务依赖
 * - 配置管理：从配置文件加载和合并配置参数
 * - 单例管理：支持单例和多实例模式
 * - 健康检查：验证依赖的可用性
 * - 优雅关闭：管理服务生命周期
 *
 * @class UnifiedLogServiceFactory
 */
class UnifiedLogServiceFactory {
  constructor() {
    /** @type {UnifiedLogService|null} */
    this._singletonInstance = null

    /** @type {Map<string, UnifiedLogService>} */
    this._namedInstances = new Map()

    /** @type {boolean} */
    this._isInitialized = false

    /** @type {Object} */
    this._defaultConfig = null

    logger.info('🏭 UnifiedLogServiceFactory initialized')
  }

  /**
   * 创建UnifiedLogService实例
   *
   * @param {Object} [customConfig={}] - 自定义配置
   * @param {Object} [customDependencies={}] - 自定义依赖
   * @param {string} [instanceName] - 实例名称（用于命名实例）
   * @returns {Promise<UnifiedLogService>} UnifiedLogService实例
   * @throws {Error} 当依赖注入失败时
   */
  async create(customConfig = {}, customDependencies = {}, instanceName = null) {
    try {
      // 如果指定了实例名称，检查是否已存在
      if (instanceName && this._namedInstances.has(instanceName)) {
        logger.debug(`📦 Returning existing named instance: ${instanceName}`)
        return this._namedInstances.get(instanceName)
      }

      // 解析依赖
      const dependencies = await this._resolveDependencies(customDependencies)

      // 合并配置
      const config = await this._resolveConfiguration(customConfig)

      // 创建服务实例
      const serviceInstance = new UnifiedLogService(dependencies, config)

      // 如果指定了实例名称，保存为命名实例
      if (instanceName) {
        this._namedInstances.set(instanceName, serviceInstance)
        logger.info(`✅ Created named UnifiedLogService instance: ${instanceName}`)
      } else {
        logger.info('✅ Created UnifiedLogService instance successfully')
      }

      return serviceInstance
    } catch (error) {
      logger.error('❌ Failed to create UnifiedLogService instance:', error)
      throw new Error(`UnifiedLogService创建失败: ${error.message}`)
    }
  }

  /**
   * 获取或创建单例实例
   *
   * @param {Object} [customConfig={}] - 自定义配置
   * @param {Object} [customDependencies={}] - 自定义依赖
   * @returns {Promise<UnifiedLogService>} 单例实例
   */
  async getSingleton(customConfig = {}, customDependencies = {}) {
    if (!this._singletonInstance) {
      logger.info('🔄 Creating UnifiedLogService singleton instance...')
      this._singletonInstance = await this.create(customConfig, customDependencies)
    } else {
      logger.debug('📦 Returning existing singleton instance')
    }

    return this._singletonInstance
  }

  /**
   * 获取命名实例
   *
   * @param {string} instanceName - 实例名称
   * @returns {UnifiedLogService|null} 实例或null
   */
  getNamedInstance(instanceName) {
    const instance = this._namedInstances.get(instanceName)
    if (!instance) {
      logger.warn(`⚠️ Named instance not found: ${instanceName}`)
      return null
    }

    logger.debug(`📦 Retrieved named instance: ${instanceName}`)
    return instance
  }

  /**
   * 解析服务依赖
   *
   * @private
   * @param {Object} customDependencies - 自定义依赖
   * @returns {Promise<Object>} 解析后的依赖对象
   * @throws {Error} 当必需依赖无法解析时
   */
  async _resolveDependencies(customDependencies = {}) {
    const dependencies = {}

    try {
      // 解析数据库依赖
      if (customDependencies.database) {
        dependencies.database = customDependencies.database
      } else {
        // 动态加载数据库模块（避免循环依赖）
        const database = require('../models/database')

        // 确保数据库连接已初始化
        if (typeof database.connect === 'function') {
          await database.connect()
        }

        dependencies.database = database
      }

      // 解析Headers过滤服务依赖
      if (customDependencies.headersFilter) {
        dependencies.headersFilter = customDependencies.headersFilter
      } else {
        // 创建HeadersFilterService实例而不是传递类
        dependencies.headersFilter = new HeadersFilterService()
      }

      // 解析日志记录器依赖
      if (customDependencies.logger) {
        dependencies.logger = customDependencies.logger
      } else {
        dependencies.logger = logger
      }

      logger.debug('✅ Dependencies resolved successfully')
      return dependencies
    } catch (error) {
      logger.error('❌ Failed to resolve dependencies:', error)
      throw new Error(`依赖解析失败: ${error.message}`)
    }
  }

  /**
   * 解析服务配置
   *
   * @private
   * @param {Object} customConfig - 自定义配置
   * @returns {Promise<Object>} 解析后的配置对象
   */
  async _resolveConfiguration(customConfig = {}) {
    try {
      // 如果还没有加载默认配置，则加载
      if (!this._defaultConfig) {
        this._defaultConfig = await this._loadDefaultConfiguration()
      }

      // 合并配置：默认配置 < 全局配置 < 自定义配置
      const mergedConfig = {
        ...this._defaultConfig,
        ...customConfig
      }

      logger.debug('✅ Configuration resolved successfully:', mergedConfig)
      return mergedConfig
    } catch (error) {
      logger.error('❌ Failed to resolve configuration:', error)

      // 降级到默认配置
      logger.warn('🔄 Falling back to hardcoded default configuration')
      return this._getHardcodedDefaults()
    }
  }

  /**
   * 加载默认配置
   *
   * @private
   * @returns {Promise<Object>} 默认配置对象
   */
  async _loadDefaultConfiguration() {
    try {
      // 动态加载配置以避免循环依赖
      const config = require('../../config/config')

      // 从config.js中提取增强日志相关配置
      const enhancedLoggingConfig = {
        // 从现有requestLogging配置映射到新的结构
        mergeWindowMs: config.requestLogging?.async?.batchTimeout || 15000,
        maxRetries: config.requestLogging?.async?.maxRetries || 3,
        retryDelayMs: config.requestLogging?.async?.retryDelay || 1000,
        enableAsync: config.requestLogging?.async ? true : true,
        enableHeadersCapture: !config.requestLogging?.filtering?.sensitiveHeaders ? false : true,
        enableTokenDetails: true,
        enableCostDetails: true,

        // 新增的增强日志配置项
        enableDataCompression: config.enhancedLogging?.enableDataCompression !== false,
        enablePerformanceMonitoring: config.enhancedLogging?.enablePerformanceMonitoring !== false,
        maxLogSize: config.enhancedLogging?.maxLogSize || 200000,
        enableFallbackLogging: config.enhancedLogging?.enableFallbackLogging !== false
      }

      logger.info('📋 Loaded configuration from config.js')
      return enhancedLoggingConfig
    } catch (error) {
      logger.warn('⚠️ Failed to load configuration from config.js:', error.message)
      return this._getHardcodedDefaults()
    }
  }

  /**
   * 获取硬编码的默认配置
   *
   * @private
   * @returns {Object} 硬编码默认配置
   */
  _getHardcodedDefaults() {
    return {
      mergeWindowMs: 15000,
      maxRetries: 3,
      retryDelayMs: 1000,
      enableAsync: true,
      enableHeadersCapture: true,
      enableTokenDetails: true,
      enableCostDetails: true,
      enableDataCompression: true,
      enablePerformanceMonitoring: true,
      maxLogSize: 200000,
      enableFallbackLogging: true
    }
  }

  /**
   * 健康检查 - 验证所有依赖的可用性
   *
   * @returns {Promise<Object>} 健康检查结果
   */
  async healthCheck() {
    const results = {
      status: 'healthy',
      dependencies: {},
      timestamp: new Date().toISOString()
    }

    try {
      // 检查数据库依赖
      try {
        const database = require('../models/database')
        await database.ping()
        results.dependencies.database = { status: 'healthy' }
      } catch (error) {
        results.dependencies.database = { status: 'unhealthy', error: error.message }
        results.status = 'degraded'
      }

      // 检查Headers过滤服务
      try {
        // 简单的功能测试 - 创建实例并测试
        const headersFilterInstance = new HeadersFilterService()
        const testHeaders = { 'user-agent': 'test' }
        const filtered = headersFilterInstance.filterRequestHeaders(testHeaders)
        if (filtered && typeof filtered === 'object') {
          results.dependencies.headersFilter = { status: 'healthy' }
        } else {
          throw new Error('Headers filter did not return expected result')
        }
      } catch (error) {
        results.dependencies.headersFilter = { status: 'unhealthy', error: error.message }
        results.status = 'degraded'
      }

      // 检查日志记录器
      try {
        logger.debug('Health check: logger test')
        results.dependencies.logger = { status: 'healthy' }
      } catch (error) {
        results.dependencies.logger = { status: 'unhealthy', error: error.message }
        results.status = 'degraded'
      }
    } catch (error) {
      results.status = 'unhealthy'
      results.error = error.message
    }

    return results
  }

  /**
   * 获取工厂统计信息
   *
   * @returns {Object} 工厂统计信息
   */
  getFactoryStats() {
    return {
      singletonCreated: !!this._singletonInstance,
      namedInstancesCount: this._namedInstances.size,
      namedInstanceNames: Array.from(this._namedInstances.keys()),
      isInitialized: this._isInitialized,
      configurationLoaded: !!this._defaultConfig
    }
  }

  /**
   * 重置单例实例
   *
   * @returns {Promise<void>}
   */
  async resetSingleton() {
    if (this._singletonInstance) {
      try {
        await this._singletonInstance.shutdown()
      } catch (error) {
        logger.error('⚠️ Error shutting down singleton instance:', error)
      }

      this._singletonInstance = null
      logger.info('🔄 Singleton instance reset')
    }
  }

  /**
   * 移除命名实例
   *
   * @param {string} instanceName - 实例名称
   * @returns {Promise<boolean>} 是否成功移除
   */
  async removeNamedInstance(instanceName) {
    const instance = this._namedInstances.get(instanceName)
    if (!instance) {
      logger.warn(`⚠️ Named instance not found for removal: ${instanceName}`)
      return false
    }

    try {
      await instance.shutdown()
      this._namedInstances.delete(instanceName)
      logger.info(`✅ Named instance removed: ${instanceName}`)
      return true
    } catch (error) {
      logger.error(`❌ Failed to remove named instance ${instanceName}:`, error)
      return false
    }
  }

  /**
   * 优雅关闭工厂和所有管理的实例
   *
   * @returns {Promise<void>}
   */
  async shutdown() {
    logger.info('🛑 Shutting down UnifiedLogServiceFactory...')

    // 关闭单例实例
    if (this._singletonInstance) {
      try {
        await this._singletonInstance.shutdown()
      } catch (error) {
        logger.error('⚠️ Error shutting down singleton instance:', error)
      }
      this._singletonInstance = null
    }

    // 关闭所有命名实例
    const shutdownPromises = Array.from(this._namedInstances.entries()).map(
      async ([name, instance]) => {
        try {
          await instance.shutdown()
          logger.debug(`✅ Named instance shutdown: ${name}`)
        } catch (error) {
          logger.error(`⚠️ Error shutting down named instance ${name}:`, error)
        }
      }
    )

    await Promise.allSettled(shutdownPromises)
    this._namedInstances.clear()

    this._isInitialized = false
    this._defaultConfig = null

    logger.info('👋 UnifiedLogServiceFactory shutdown completed')
  }
}

// 创建工厂单例
const unifiedLogServiceFactory = new UnifiedLogServiceFactory()

// 优雅关闭处理
process.on('SIGINT', async () => {
  await unifiedLogServiceFactory.shutdown()
})

process.on('SIGTERM', async () => {
  await unifiedLogServiceFactory.shutdown()
})

module.exports = {
  UnifiedLogServiceFactory,
  unifiedLogServiceFactory
}
