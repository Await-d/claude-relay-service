/**
 * @fileoverview 动态配置管理器 - 企业级配置热重载核心组件
 *
 * 核心设计理念：
 * - KISS原则: 简洁统一的配置管理API
 * - SOLID架构: 单一职责的配置协调器，开放扩展
 * - DRY复用: 重用现有的ConfigWatcher和数据库组件
 * - 性能第一: 智能缓存+事件驱动的零延迟配置应用
 *
 * 主要功能：
 * - 多源配置合并（Redis > 环境变量 > 默认配置）
 * - 配置变化检测和智能通知
 * - 服务热重载协调和错误恢复
 * - 配置验证和安全性检查
 *
 * @author Claude Code
 * @version 1.0.0
 */

const EventEmitter = require('events')
const { ConfigWatcher } = require('./ConfigWatcher')
const config = require('../../config/config')
const logger = require('./logger')
const database = require('../models/database')

/**
 * 动态配置管理器类
 *
 * 负责协调整个系统的配置热重载流程：
 * 1. 监听配置变化（通过ConfigWatcher）
 * 2. 合并多源配置（Redis + 环境变量 + 默认）
 * 3. 验证配置有效性
 * 4. 通知相关服务重载配置
 * 5. 提供配置状态查询和管理API
 */
class DynamicConfigManager extends EventEmitter {
  constructor(options = {}) {
    super()

    // 配置初始化
    this.options = {
      // 配置监听间隔（毫秒）
      watchInterval: options.watchInterval || 30000,
      // 配置变化防抖延迟（毫秒）
      debounceDelay: options.debounceDelay || 500,
      // 配置缓存TTL（毫秒）
      cacheTTL: options.cacheTTL || 60000,
      // 启用自动重载
      enableAutoReload: options.enableAutoReload !== false,
      ...options
    }

    // 状态管理
    this.isStarted = false
    this.configWatcher = null
    this.currentConfig = {}
    this.configCache = new Map()
    this.lastReloadTime = 0
    this.reloadCount = 0

    // 性能监控指标
    this.metrics = {
      totalReloads: 0,
      successfulReloads: 0,
      failedReloads: 0,
      lastReloadDuration: 0,
      averageReloadDuration: 0,
      configChangeEvents: 0
    }

    // 初始化配置监听器
    this._initializeConfigWatcher()

    logger.info('🔧 DynamicConfigManager initialized', {
      watchInterval: this.options.watchInterval,
      debounceDelay: this.options.debounceDelay,
      enableAutoReload: this.options.enableAutoReload
    })
  }

  /**
   * 初始化配置监听器
   * @private
   */
  _initializeConfigWatcher() {
    try {
      this.configWatcher = new ConfigWatcher({
        watchKeys: ['request_logs_config'],
        pollInterval: this.options.watchInterval,
        debounceDelay: this.options.debounceDelay
      })

      // 监听配置变化事件
      this.configWatcher.on('configChanged', async (changeData) => {
        this.metrics.configChangeEvents++
        logger.info('📥 Configuration change detected', {
          key: changeData.key,
          hasNewValue: !!changeData.newValue,
          timestamp: new Date().toISOString()
        })

        if (this.options.enableAutoReload) {
          await this._handleConfigChange(changeData)
        }

        // 转发配置变化事件
        this.emit('configChanged', changeData)
      })

      // 监听配置监听器错误
      this.configWatcher.on('error', (error) => {
        logger.error('❌ ConfigWatcher error:', error)
        this.emit('watcherError', error)
      })

      // 监听重载跳过事件
      this.configWatcher.on('reloadSkipped', (reason) => {
        logger.debug('⏭️ Config reload skipped:', reason)
        this.emit('reloadSkipped', reason)
      })
    } catch (error) {
      logger.error('❌ Failed to initialize ConfigWatcher:', error)
      throw error
    }
  }

  /**
   * 启动配置管理器
   * @returns {Promise<void>}
   */
  async start() {
    if (this.isStarted) {
      logger.warn('⚠️ DynamicConfigManager is already started')
      return
    }

    try {
      // 首次加载配置
      await this.reloadConfig()

      // 启动配置监听器
      if (this.configWatcher) {
        await this.configWatcher.start()
      }

      this.isStarted = true
      logger.success('🚀 DynamicConfigManager started successfully')

      // 发送启动完成事件
      this.emit('started')
    } catch (error) {
      logger.error('❌ Failed to start DynamicConfigManager:', error)
      throw error
    }
  }

  /**
   * 停止配置管理器
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.isStarted) {
      logger.warn('⚠️ DynamicConfigManager is not started')
      return
    }

    try {
      // 停止配置监听器
      if (this.configWatcher) {
        await this.configWatcher.stop()
      }

      // 清理缓存
      this.configCache.clear()

      this.isStarted = false
      logger.success('🛑 DynamicConfigManager stopped successfully')

      // 发送停止完成事件
      this.emit('stopped')
    } catch (error) {
      logger.error('❌ Failed to stop DynamicConfigManager:', error)
      throw error
    }
  }

  /**
   * 获取当前生效配置
   * @param {string} [configKey] - 配置键名，不提供则返回所有配置
   * @returns {Promise<any>} 配置值或配置对象
   */
  async getCurrentConfig(configKey = null) {
    try {
      // 检查缓存
      if (configKey && this.configCache.has(configKey)) {
        const cached = this.configCache.get(configKey)
        if (Date.now() - cached.timestamp < this.options.cacheTTL) {
          return cached.value
        }
      }

      // 从Redis获取配置
      const redisConfig = await this._getRedisConfig()

      // 合并配置（优先级：Redis > 环境变量 > 默认配置）
      const mergedConfig = this._mergeConfigs(redisConfig)

      // 更新缓存
      if (configKey) {
        const value = this._getNestedValue(mergedConfig, configKey)
        this.configCache.set(configKey, {
          value,
          timestamp: Date.now()
        })
        return value
      }

      this.currentConfig = mergedConfig
      return mergedConfig
    } catch (error) {
      logger.error('❌ Failed to get current config:', error)

      // 降级到静态配置
      const fallbackConfig = this._getFallbackConfig()

      if (configKey) {
        return this._getNestedValue(fallbackConfig, configKey)
      }

      return fallbackConfig
    }
  }

  /**
   * 重新加载配置
   * @param {Object} [specificConfig] - 特定配置对象，不提供则从Redis重新加载
   * @returns {Promise<boolean>} 重载是否成功
   */
  async reloadConfig(specificConfig = null) {
    const startTime = Date.now()
    this.metrics.totalReloads++

    try {
      logger.info('🔄 Starting configuration reload...')

      let newConfig
      if (specificConfig) {
        // 使用提供的配置
        newConfig = specificConfig
      } else {
        // 从Redis重新加载
        newConfig = await this.getCurrentConfig()
      }

      // 验证配置
      if (!this.validateConfig(newConfig)) {
        throw new Error('Configuration validation failed')
      }

      // 检测配置变化
      const configChanges = this._detectConfigChanges(this.currentConfig, newConfig)

      if (Object.keys(configChanges).length === 0) {
        logger.debug('🔄 No configuration changes detected, skipping reload')
        return true
      }

      // 通知相关服务重载配置
      const reloadResults = await this._notifyServicesReload(newConfig, configChanges)

      // 更新当前配置
      this.currentConfig = { ...newConfig }

      // 清理缓存
      this.configCache.clear()

      // 更新统计信息
      const duration = Date.now() - startTime
      this.metrics.successfulReloads++
      this.metrics.lastReloadDuration = duration
      this.metrics.averageReloadDuration =
        (this.metrics.averageReloadDuration * (this.metrics.successfulReloads - 1) + duration) /
        this.metrics.successfulReloads

      this.lastReloadTime = Date.now()
      this.reloadCount++

      logger.success('✅ Configuration reload completed successfully', {
        duration: `${duration}ms`,
        changes: Object.keys(configChanges),
        reloadResults
      })

      // 发送配置重载完成事件
      this.emit('configReloaded', {
        config: newConfig,
        changes: configChanges,
        duration,
        reloadResults
      })

      return true
    } catch (error) {
      this.metrics.failedReloads++
      this.metrics.lastReloadDuration = Date.now() - startTime

      logger.error('❌ Configuration reload failed:', error)

      // 发送重载失败事件
      this.emit('reloadFailed', {
        error: error.message,
        duration: Date.now() - startTime
      })

      return false
    }
  }

  /**
   * 验证配置对象
   * @param {Object} configObj - 要验证的配置对象
   * @returns {boolean} 验证是否通过
   */
  validateConfig(configObj) {
    try {
      if (!configObj || typeof configObj !== 'object') {
        logger.warn('⚠️ Invalid config: not an object')
        return false
      }

      // 验证请求日志配置
      if (configObj.requestLogging) {
        const rlConfig = configObj.requestLogging

        // 验证必要字段
        if (typeof rlConfig.enabled !== 'boolean') {
          logger.warn('⚠️ Invalid requestLogging.enabled: must be boolean')
          return false
        }

        // 验证批量大小
        if (rlConfig.async && typeof rlConfig.async.batchSize === 'number') {
          if (rlConfig.async.batchSize < 1 || rlConfig.async.batchSize > 1000) {
            logger.warn('⚠️ Invalid batch size: must be between 1 and 1000')
            return false
          }
        }
      }

      logger.debug('✅ Configuration validation passed')
      return true
    } catch (error) {
      logger.error('❌ Configuration validation error:', error)
      return false
    }
  }

  /**
   * 获取配置管理器状态
   * @returns {Object} 状态信息
   */
  getStatus() {
    return {
      isStarted: this.isStarted,
      lastReloadTime: this.lastReloadTime,
      reloadCount: this.reloadCount,
      metrics: { ...this.metrics },
      watcherStatus: this.configWatcher ? this.configWatcher.getStatus() : null,
      cacheSize: this.configCache.size,
      currentConfig: { ...this.currentConfig }
    }
  }

  /**
   * 处理配置变化
   * @param {Object} changeData - 配置变化数据
   * @private
   */
  async _handleConfigChange(changeData) {
    try {
      logger.info('🔄 Handling configuration change', {
        key: changeData.key,
        changeType: changeData.newValue ? 'update' : 'delete'
      })

      // 解析新配置
      let newConfig = {}
      if (changeData.newValue) {
        try {
          newConfig = JSON.parse(changeData.newValue)
        } catch (parseError) {
          logger.error('❌ Failed to parse new config JSON:', parseError)
          return
        }
      }

      // 触发配置重载
      await this.reloadConfig(newConfig)
    } catch (error) {
      logger.error('❌ Failed to handle configuration change:', error)
    }
  }

  /**
   * 从Redis获取配置
   * @returns {Promise<Object>} Redis配置对象
   * @private
   */
  async _getRedisConfig() {
    try {
      const redisConfig = await database.getRequestLogsConfig()
      return redisConfig || {}
    } catch (error) {
      logger.error('❌ Failed to get Redis config:', error)
      return {}
    }
  }

  /**
   * 合并多源配置
   * @param {Object} redisConfig - Redis配置
   * @returns {Object} 合并后的配置
   * @private
   */
  _mergeConfigs(redisConfig) {
    // 配置优先级：Redis > 环境变量 > 默认配置
    const defaultConfig = config.requestLogging || {}
    const envConfig = this._getEnvConfig()

    return {
      requestLogging: {
        ...defaultConfig,
        ...envConfig,
        ...redisConfig
      }
    }
  }

  /**
   * 获取环境变量配置
   * @returns {Object} 环境变量配置
   * @private
   */
  _getEnvConfig() {
    const envConfig = {}

    // 从环境变量读取请求日志配置
    if (process.env.REQUEST_LOGGING_ENABLED !== undefined) {
      envConfig.enabled = process.env.REQUEST_LOGGING_ENABLED === 'true'
    }

    if (process.env.REQUEST_LOGGING_MODE) {
      envConfig.mode = process.env.REQUEST_LOGGING_MODE
    }

    return envConfig
  }

  /**
   * 获取降级配置
   * @returns {Object} 降级配置
   * @private
   */
  _getFallbackConfig() {
    return {
      requestLogging: config.requestLogging || {
        enabled: false,
        mode: 'basic'
      }
    }
  }

  /**
   * 获取嵌套值
   * @param {Object} obj - 对象
   * @param {string} keyPath - 键路径（如 'requestLogging.enabled'）
   * @returns {any} 值
   * @private
   */
  _getNestedValue(obj, keyPath) {
    return keyPath
      .split('.')
      .reduce(
        (current, key) => (current && current[key] !== undefined ? current[key] : undefined),
        obj
      )
  }

  /**
   * 检测配置变化
   * @param {Object} oldConfig - 旧配置
   * @param {Object} newConfig - 新配置
   * @returns {Object} 变化详情
   * @private
   */
  _detectConfigChanges(oldConfig, newConfig) {
    const changes = {}

    // 检查请求日志配置变化
    const oldRL = oldConfig.requestLogging || {}
    const newRL = newConfig.requestLogging || {}

    if (oldRL.enabled !== newRL.enabled) {
      changes['requestLogging.enabled'] = {
        from: oldRL.enabled,
        to: newRL.enabled
      }
    }

    if (oldRL.mode !== newRL.mode) {
      changes['requestLogging.mode'] = {
        from: oldRL.mode,
        to: newRL.mode
      }
    }

    return changes
  }

  /**
   * 通知相关服务重载配置
   * @param {Object} newConfig - 新配置
   * @param {Object} changes - 配置变化
   * @returns {Promise<Object>} 重载结果
   * @private
   */
  async _notifyServicesReload(newConfig, changes) {
    const results = {}

    try {
      // 通知请求日志服务重载
      if (changes['requestLogging.enabled'] || changes['requestLogging.mode']) {
        logger.info('📨 Notifying requestLoggerService to reload...')

        try {
          // 动态导入请求日志服务（避免循环依赖）
          const requestLoggerService = require('../services/requestLoggerService')

          if (requestLoggerService && typeof requestLoggerService.reloadConfig === 'function') {
            await requestLoggerService.reloadConfig(newConfig.requestLogging)
            results.requestLoggerService = 'success'
            logger.success('✅ requestLoggerService reloaded successfully')
          } else {
            results.requestLoggerService = 'not_available'
            logger.warn('⚠️ requestLoggerService.reloadConfig not available')
          }
        } catch (error) {
          results.requestLoggerService = `error: ${error.message}`
          logger.error('❌ Failed to reload requestLoggerService:', error)
        }
      }

      // 可以在这里添加其他服务的重载通知
    } catch (error) {
      logger.error('❌ Error in service reload notification:', error)
    }

    return results
  }
}

/**
 * 创建请求日志配置专用管理器
 * @param {Object} options - 配置选项
 * @returns {DynamicConfigManager} 配置管理器实例
 */
function createRequestLogConfigManager(options = {}) {
  return new DynamicConfigManager({
    watchInterval: 30000, // 30秒检查一次
    debounceDelay: 500, // 500ms防抖
    enableAutoReload: true,
    ...options
  })
}

// 导出类和工厂函数
module.exports = {
  DynamicConfigManager,
  createRequestLogConfigManager
}
