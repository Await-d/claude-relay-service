/**
 * @fileoverview 动态配置管理服务
 *
 * 核心设计理念：
 * - KISS 原则: 简洁的API和高效的缓存机制
 * - 性能第一: 内存缓存 + 智能更新策略，零阻塞关键路径
 * - SOLID 架构: 职责单一，配置获取与管理分离
 * - DRY 复用: 重用现有Redis连接和错误处理机制
 *
 * 主要功能：
 * - 高性能配置缓存：内存 + Redis双层缓存
 * - 智能缓存策略：TTL过期 + 事件驱动更新
 * - 优雅降级：Redis不可用时使用静态配置
 * - 异步更新：配置变更异步通知，不阻塞主流程
 * - 类型安全：严格的配置验证和类型检查
 *
 * @author Claude Code
 * @version 1.0.0
 */

const config = require('../../config/config')
const logger = require('../utils/logger')
const database = require('../models/database')
const { EventEmitter } = require('events')

/**
 * 动态配置管理器类
 *
 * 提供高性能的配置获取和管理功能，支持实时配置更新
 */
class DynamicConfigManager extends EventEmitter {
  constructor() {
    super()

    // 内存缓存：用于最高性能的配置访问
    this.cache = new Map()

    // 缓存TTL配置（毫秒）
    this.cacheTTL = 5 * 60 * 1000 // 5分钟

    // 配置键前缀
    this.configPrefix = 'dynamic_config:'

    // 支持的配置项及其默认值
    this.supportedConfigs = {
      'requestLogging.enabled': {
        default: config.requestLogging?.enabled || false,
        validator: this.validateBoolean,
        description: '请求日志记录开关'
      },
      'requestLogging.mode': {
        default: config.requestLogging?.mode || 'basic',
        validator: this.validateMode,
        description: '请求日志记录模式'
      },
      'requestLogging.sampling.rate': {
        default: config.requestLogging?.sampling?.rate || 0.1,
        validator: this.validateSamplingRate,
        description: '请求日志采样率'
      }
    }

    // 初始化状态
    this.initialized = false
    this.initializing = false

    // 错误统计
    this.errorCount = 0
    this.lastError = null

    logger.info('📊 Dynamic Config Manager initialized')
  }

  /**
   * 获取配置值（高性能版本）
   * @param {string} key - 配置键名（支持点号分隔的路径）
   * @param {*} defaultValue - 默认值（可选）
   * @returns {Promise<*>} 配置值
   */
  async getConfig(key, defaultValue = undefined) {
    try {
      // 1. 检查内存缓存（最高性能路径）
      const cached = this.cache.get(key)
      if (cached && !this.isCacheExpired(cached)) {
        return cached.value
      }

      // 2. 从Redis获取配置
      const value = await this.loadConfigFromRedis(key)

      if (value !== undefined) {
        // 更新内存缓存
        this.setCacheEntry(key, value)
        return value
      }

      // 3. 回退到默认配置
      return this.getDefaultValue(key, defaultValue)
    } catch (error) {
      this.handleError('getConfig', key, error)

      // 优雅降级：返回默认值
      return this.getDefaultValue(key, defaultValue)
    }
  }

  /**
   * 设置配置值
   * @param {string} key - 配置键名
   * @param {*} value - 配置值
   * @returns {Promise<boolean>} 是否设置成功
   */
  async setConfig(key, value) {
    try {
      // 验证配置项
      if (!this.validateConfigKey(key)) {
        throw new Error(`Unsupported config key: ${key}`)
      }

      // 验证配置值
      const configDef = this.supportedConfigs[key]
      if (configDef && configDef.validator && !configDef.validator(value)) {
        throw new Error(`Invalid config value for ${key}: ${value}`)
      }

      // 保存到Redis
      const redisKey = this.configPrefix + key
      const dbClient = database.getClient()

      if (!dbClient) {
        throw new Error('Database client not available')
      }

      // 判断是否为持久配置（关键配置不设置过期时间）
      const isPersistentConfig = this.isPersistentConfig(key)

      if (isPersistentConfig) {
        // 持久配置：永不过期，确保服务重启后配置保持
        await dbClient.set(redisKey, JSON.stringify(value))
        logger.info(`💾 Persistent config saved: ${key} = ${JSON.stringify(value)} (no expiration)`)
      } else {
        // 临时配置：设置过期时间
        await dbClient.set(redisKey, JSON.stringify(value), 'EX', Math.floor(this.cacheTTL / 1000))
        logger.info(
          `⏰ Temporary config saved: ${key} = ${JSON.stringify(value)} (${Math.floor(this.cacheTTL / 1000)}s TTL)`
        )
      }

      // 更新内存缓存
      this.setCacheEntry(key, value)

      // 发出配置更新事件
      this.emit('configChanged', {
        key,
        value,
        timestamp: Date.now(),
        persistent: isPersistentConfig
      })

      logger.info(`✅ Config updated: ${key} = ${JSON.stringify(value)}`)
      return true
    } catch (error) {
      this.handleError('setConfig', key, error)
      return false
    }
  }

  /**
   * 批量获取请求日志配置（优化版）
   * @returns {Promise<Object>} 请求日志配置对象
   */
  async getRequestLoggingConfig() {
    try {
      // 尝试一次性获取所有请求日志配置
      const configs = await Promise.allSettled([
        this.getConfig('requestLogging.enabled'),
        this.getConfig('requestLogging.mode'),
        this.getConfig('requestLogging.sampling.rate')
      ])

      return {
        enabled:
          configs[0].status === 'fulfilled'
            ? configs[0].value
            : config.requestLogging?.enabled || false,
        mode:
          configs[1].status === 'fulfilled'
            ? configs[1].value
            : config.requestLogging?.mode || 'basic',
        sampling: {
          rate:
            configs[2].status === 'fulfilled'
              ? configs[2].value
              : config.requestLogging?.sampling?.rate || 0.1
        }
      }
    } catch (error) {
      this.handleError('getRequestLoggingConfig', null, error)

      // 降级到静态配置
      return {
        enabled: config.requestLogging?.enabled || false,
        mode: config.requestLogging?.mode || 'basic',
        sampling: {
          rate: config.requestLogging?.sampling?.rate || 0.1
        }
      }
    }
  }

  /**
   * 清理过期缓存（定期清理）
   */
  cleanupCache() {
    const now = Date.now()
    let cleaned = 0

    for (const [key, entry] of this.cache.entries()) {
      if (this.isCacheExpired(entry, now)) {
        this.cache.delete(key)
        cleaned++
      }
    }

    if (cleaned > 0) {
      logger.debug(`🧹 Cleaned ${cleaned} expired cache entries`)
    }
  }

  /**
   * 获取配置管理器状态
   * @returns {Object} 状态信息
   */
  getStatus() {
    return {
      initialized: this.initialized,
      cacheSize: this.cache.size,
      errorCount: this.errorCount,
      lastError: this.lastError,
      supportedConfigCount: Object.keys(this.supportedConfigs).length
    }
  }

  // ==================== 私有方法 ====================

  /**
   * 从Redis加载配置
   * @private
   */
  async loadConfigFromRedis(key) {
    const dbClient = database.getClient()
    if (!dbClient) {
      return undefined
    }

    const redisKey = this.configPrefix + key
    const rawValue = await dbClient.get(redisKey)

    if (rawValue === null) {
      return undefined
    }

    try {
      return JSON.parse(rawValue)
    } catch (error) {
      logger.warn(`⚠️ Failed to parse config value for ${key}:`, error)
      return undefined
    }
  }

  /**
   * 设置缓存条目
   * @private
   */
  setCacheEntry(key, value) {
    this.cache.set(key, {
      value,
      timestamp: Date.now()
    })
  }

  /**
   * 检查缓存是否过期
   * @private
   */
  isCacheExpired(entry, now = Date.now()) {
    return now - entry.timestamp > this.cacheTTL
  }

  /**
   * 获取默认值
   * @private
   */
  getDefaultValue(key, fallback) {
    const configDef = this.supportedConfigs[key]
    if (configDef && configDef.default !== undefined) {
      return configDef.default
    }

    if (fallback !== undefined) {
      return fallback
    }

    // 尝试从静态配置中获取
    const pathParts = key.split('.')
    let current = config

    for (const part of pathParts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part]
      } else {
        return undefined
      }
    }

    return current
  }

  /**
   * 验证配置键是否支持
   * @private
   */
  validateConfigKey(key) {
    return Object.prototype.hasOwnProperty.call(this.supportedConfigs, key)
  }

  /**
   * 判断配置是否需要持久化（永不过期）
   * @param {string} key - 配置键名
   * @returns {boolean} 是否为持久配置
   * @private
   */
  isPersistentConfig(key) {
    // 关键的用户配置应该持久化，避免服务重启后丢失
    const persistentConfigs = [
      'requestLogging.enabled', // 日志开关状态 - 用户明确设置的应该保持
      'requestLogging.mode' // 日志模式 - 用户偏好设置
    ]

    return persistentConfigs.includes(key)
  }

  /**
   * 布尔值验证器
   * @private
   */
  validateBoolean(value) {
    return typeof value === 'boolean'
  }

  /**
   * 模式验证器
   * @private
   */
  validateMode(value) {
    const validModes = ['basic', 'detailed', 'debug']
    return validModes.includes(value)
  }

  /**
   * 采样率验证器
   * @private
   */
  validateSamplingRate(value) {
    return typeof value === 'number' && value >= 0 && value <= 1
  }

  /**
   * 错误处理
   * @private
   */
  handleError(operation, key, error) {
    this.errorCount++
    this.lastError = {
      operation,
      key,
      error: error.message,
      timestamp: Date.now()
    }

    logger.error(`❌ Dynamic config error [${operation}${key ? ` for ${key}` : ''}]:`, error)
  }
}

// 创建单例实例
const dynamicConfigManager = new DynamicConfigManager()

// 设置定期缓存清理
setInterval(() => {
  dynamicConfigManager.cleanupCache()
}, 60 * 1000) // 每分钟清理一次

module.exports = {
  dynamicConfigManager,
  DynamicConfigManager
}
