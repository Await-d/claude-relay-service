/**
 * @fileoverview 专业配置监听器模块
 *
 * 核心设计理念：
 * - KISS 原则: 简洁的API设计和高效的监听机制
 * - 性能第一: 轮询+防抖的智能监听策略，零阻塞主流程
 * - SOLID 架构: 单一职责，可扩展的事件驱动设计
 * - DRY 复用: 重用现有系统组件和错误处理模式
 *
 * 主要功能：
 * - Redis配置监听: 定期检查配置变化，支持多键监听
 * - 智能防抖机制: 避免频繁触发重载，优化系统性能
 * - 错误恢复策略: 自动重试机制和优雅降级处理
 * - 事件系统: 支持配置变化的监听和分发
 * - 内存保护: 防止内存泄漏和资源浪费
 * - 频率限制: 防止配置重载过于频繁
 *
 * @author Claude Code
 * @version 1.0.0
 */

const { EventEmitter } = require('events')
const logger = require('./logger')
const database = require('../models/database')

/**
 * 配置监听器类
 *
 * 提供高性能的配置变化监听功能，支持防抖、错误恢复和频率限制
 *
 * @example
 * // 基本使用
 * const { ConfigWatcher } = require('../utils/ConfigWatcher')
 * const watcher = new ConfigWatcher({
 *   watchKeys: ['request_logs_config'],
 *   pollInterval: 30000,
 *   debounceDelay: 500
 * })
 *
 * watcher.on('configChanged', (data) => {
 *   console.log('配置变化:', data.key, data.newValue)
 * })
 *
 * await watcher.start()
 */
class ConfigWatcher extends EventEmitter {
  constructor(options = {}) {
    super()

    // 配置参数
    this.options = {
      // 要监听的配置键列表
      watchKeys: options.watchKeys || ['request_logs_config'],

      // 轮询间隔（毫秒）
      pollInterval: options.pollInterval || 30000,

      // 防抖延迟（毫秒）
      debounceDelay: options.debounceDelay || 500,

      // 最大重试次数
      maxRetries: options.maxRetries || 3,

      // 重载频率限制（每分钟最多次数）
      maxReloadsPerMinute: options.maxReloadsPerMinute || 1,

      // 启用调试日志
      enableDebugLogs: options.enableDebugLogs || false,

      ...options
    }

    // 状态管理
    this.isRunning = false
    this.isDestroyed = false
    this.pollTimer = null
    this.debounceTimers = new Map()

    // 配置状态缓存
    this.configStates = new Map()
    this.lastChecked = 0

    // 错误处理
    this.retryCount = 0
    this.consecutiveErrors = 0
    this.lastError = null

    // 重载频率控制
    this.reloadHistory = []

    // 性能统计
    this.stats = {
      totalChecks: 0,
      configChangesDetected: 0,
      reloadsTriggered: 0,
      errors: 0,
      startTime: null,
      lastCheckTime: null
    }

    logger.info('🔧 ConfigWatcher initialized', {
      watchKeys: this.options.watchKeys,
      pollInterval: this.options.pollInterval,
      debounceDelay: this.options.debounceDelay
    })
  }

  /**
   * 启动配置监听器
   * @returns {Promise<void>}
   */
  async start() {
    if (this.isRunning) {
      logger.warn('⚠️ ConfigWatcher is already running')
      return
    }

    if (this.isDestroyed) {
      throw new Error('ConfigWatcher has been destroyed and cannot be restarted')
    }

    try {
      // 初始化配置状态
      await this.initializeConfigStates()

      // 启动轮询
      this.isRunning = true
      this.stats.startTime = Date.now()
      this.scheduleNextCheck()

      logger.info('✅ ConfigWatcher started successfully', {
        watchKeys: this.options.watchKeys,
        pollInterval: this.options.pollInterval
      })

      // 发出启动事件
      this.emit('started')
    } catch (error) {
      logger.error('❌ Failed to start ConfigWatcher:', error)
      await this.stop()
      throw error
    }
  }

  /**
   * 停止配置监听器
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.isRunning) {
      return
    }

    this.isRunning = false

    // 清理轮询定时器
    if (this.pollTimer) {
      clearTimeout(this.pollTimer)
      this.pollTimer = null
    }

    // 清理防抖定时器
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer)
    }
    this.debounceTimers.clear()

    logger.info('🛑 ConfigWatcher stopped')
    this.emit('stopped')
  }

  /**
   * 销毁配置监听器，释放所有资源
   * @returns {Promise<void>}
   */
  async destroy() {
    await this.stop()

    this.isDestroyed = true
    this.removeAllListeners()
    this.configStates.clear()
    this.reloadHistory.length = 0

    logger.info('🗑️ ConfigWatcher destroyed')
  }

  /**
   * 手动触发配置检查
   * @returns {Promise<boolean>} 是否检测到配置变化
   */
  async checkNow() {
    if (this.isDestroyed) {
      throw new Error('ConfigWatcher has been destroyed')
    }

    try {
      return await this.performConfigCheck()
    } catch (error) {
      logger.error('❌ Manual config check failed:', error)
      throw error
    }
  }

  /**
   * 获取监听器状态和统计信息
   * @returns {Object} 状态信息
   */
  getStatus() {
    const uptime = this.stats.startTime ? Date.now() - this.stats.startTime : 0

    return {
      isRunning: this.isRunning,
      isDestroyed: this.isDestroyed,
      options: { ...this.options },
      stats: {
        ...this.stats,
        uptime,
        recentReloads: this.reloadHistory.length,
        consecutiveErrors: this.consecutiveErrors,
        lastError: this.lastError
      },
      watchedKeys: Array.from(this.configStates.keys()),
      lastChecked: this.lastChecked
    }
  }

  // ==================== 私有方法 ====================

  /**
   * 初始化配置状态
   * @private
   */
  async initializeConfigStates() {
    const dbClient = database.getClient()
    if (!dbClient) {
      throw new Error('Database client not available during initialization')
    }

    for (const key of this.options.watchKeys) {
      try {
        const value = await dbClient.get(key)
        const hash = this.hashValue(value)

        this.configStates.set(key, {
          value,
          hash,
          lastModified: Date.now()
        })

        if (this.options.enableDebugLogs) {
          logger.debug(`🔧 Initialized config state for ${key}:`, { hash })
        }
      } catch (error) {
        logger.warn(`⚠️ Failed to initialize config state for ${key}:`, error)
        // 设置默认状态
        this.configStates.set(key, {
          value: null,
          hash: null,
          lastModified: Date.now()
        })
      }
    }
  }

  /**
   * 安排下次检查
   * @private
   */
  scheduleNextCheck() {
    if (!this.isRunning || this.isDestroyed) {
      return
    }

    // 计算下次检查间隔（基于错误次数进行指数退避）
    let interval = this.options.pollInterval
    if (this.consecutiveErrors > 0) {
      interval = Math.min(
        interval * Math.pow(2, this.consecutiveErrors),
        300000 // 最大5分钟
      )
    }

    this.pollTimer = setTimeout(async () => {
      try {
        await this.performConfigCheck()
        this.scheduleNextCheck()
      } catch (error) {
        this.handleCheckError(error)
        // 即使出错也要继续调度下次检查
        this.scheduleNextCheck()
      }
    }, interval)
  }

  /**
   * 执行配置检查
   * @private
   * @returns {Promise<boolean>} 是否检测到配置变化
   */
  async performConfigCheck() {
    if (this.isDestroyed) {
      return false
    }

    const dbClient = database.getClient()
    if (!dbClient) {
      throw new Error('Database client not available')
    }

    this.stats.totalChecks++
    this.stats.lastCheckTime = Date.now()
    this.lastChecked = this.stats.lastCheckTime

    let hasChanges = false

    try {
      // 使用pipeline批量获取所有配置
      const pipeline = dbClient.pipeline()
      for (const key of this.options.watchKeys) {
        pipeline.get(key)
      }

      const results = await pipeline.exec()

      // 检查每个配置的变化
      for (let i = 0; i < this.options.watchKeys.length; i++) {
        const key = this.options.watchKeys[i]
        const [error, newValue] = results[i]

        if (error) {
          logger.warn(`⚠️ Failed to get config ${key}:`, error)
          continue
        }

        const oldState = this.configStates.get(key)
        const newHash = this.hashValue(newValue)

        // 检查配置是否发生变化
        if (!oldState || oldState.hash !== newHash) {
          hasChanges = true
          this.stats.configChangesDetected++

          // 更新配置状态
          this.configStates.set(key, {
            value: newValue,
            hash: newHash,
            lastModified: Date.now()
          })

          if (this.options.enableDebugLogs) {
            logger.debug(`🔧 Config change detected for ${key}:`, {
              oldHash: oldState?.hash,
              newHash,
              oldValue: oldState?.value,
              newValue
            })
          }

          // 触发防抖处理
          this.triggerDebouncedReload(key, {
            key,
            oldValue: oldState?.value || null,
            newValue,
            timestamp: Date.now()
          })
        }
      }

      // 重置连续错误计数
      this.consecutiveErrors = 0

      return hasChanges
    } catch (error) {
      this.consecutiveErrors++
      throw error
    }
  }

  /**
   * 触发防抖重载
   * @private
   */
  triggerDebouncedReload(key, changeData) {
    // 清理现有的防抖定时器
    if (this.debounceTimers.has(key)) {
      clearTimeout(this.debounceTimers.get(key))
    }

    // 设置新的防抖定时器
    const timer = setTimeout(async () => {
      this.debounceTimers.delete(key)

      try {
        await this.handleConfigChange(changeData)
      } catch (error) {
        logger.error(`❌ Failed to handle config change for ${key}:`, error)
        this.stats.errors++
      }
    }, this.options.debounceDelay)

    this.debounceTimers.set(key, timer)
  }

  /**
   * 处理配置变化
   * @private
   */
  async handleConfigChange(changeData) {
    // 检查重载频率限制
    if (!this.canTriggerReload()) {
      logger.warn(`⚠️ Reload frequency limit exceeded, skipping reload for ${changeData.key}`)
      this.emit('reloadSkipped', {
        ...changeData,
        reason: 'frequency_limit'
      })
      return
    }

    try {
      // 记录重载历史
      this.recordReload()

      logger.info(`🔄 Configuration change detected, triggering reload:`, {
        key: changeData.key,
        timestamp: new Date(changeData.timestamp).toISOString()
      })

      // 发出配置变化事件
      this.emit('configChanged', changeData)

      this.stats.reloadsTriggered++
    } catch (error) {
      logger.error('❌ Error handling config change:', error)
      this.stats.errors++

      this.emit('reloadError', {
        ...changeData,
        error: error.message
      })

      throw error
    }
  }

  /**
   * 检查是否可以触发重载（频率限制）
   * @private
   */
  canTriggerReload() {
    const now = Date.now()
    const oneMinute = 60 * 1000

    // 清理过期的重载历史记录
    this.reloadHistory = this.reloadHistory.filter((time) => now - time < oneMinute)

    // 检查是否超出频率限制
    return this.reloadHistory.length < this.options.maxReloadsPerMinute
  }

  /**
   * 记录重载时间
   * @private
   */
  recordReload() {
    this.reloadHistory.push(Date.now())

    // 保持历史记录在合理范围内
    if (this.reloadHistory.length > this.options.maxReloadsPerMinute * 2) {
      this.reloadHistory = this.reloadHistory.slice(-this.options.maxReloadsPerMinute)
    }
  }

  /**
   * 处理检查错误
   * @private
   */
  handleCheckError(error) {
    this.stats.errors++
    this.lastError = {
      message: error.message,
      timestamp: Date.now(),
      consecutiveCount: this.consecutiveErrors
    }

    logger.error(`❌ ConfigWatcher check error (consecutive: ${this.consecutiveErrors}):`, error)

    // 发出错误事件
    this.emit('error', {
      error: error.message,
      consecutiveErrors: this.consecutiveErrors,
      timestamp: Date.now()
    })

    // 如果连续错误过多，考虑临时暂停
    if (this.consecutiveErrors >= this.options.maxRetries) {
      logger.warn(
        `⚠️ ConfigWatcher has ${this.consecutiveErrors} consecutive errors, using exponential backoff`
      )
    }
  }

  /**
   * 计算值的哈希（简单但有效的变化检测）
   * @private
   */
  hashValue(value) {
    if (value === null || value === undefined) {
      return 'null'
    }

    // 对于复杂对象，使用JSON字符串化后计算简单哈希
    const str = typeof value === 'string' ? value : JSON.stringify(value)

    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash // 转换为32位整数
    }

    return hash.toString()
  }
}

/**
 * 创建配置监听器实例的工厂函数
 *
 * @param {Object} options 配置选项
 * @returns {ConfigWatcher} 配置监听器实例
 *
 * @example
 * // 创建请求日志配置监听器
 * const watcher = createConfigWatcher({
 *   watchKeys: ['request_logs_config'],
 *   pollInterval: 30000
 * })
 */
function createConfigWatcher(options = {}) {
  return new ConfigWatcher(options)
}

/**
 * 创建针对请求日志的专用配置监听器
 *
 * @param {Function} reloadCallback 重载回调函数
 * @param {Object} options 额外配置选项
 * @returns {ConfigWatcher} 配置监听器实例
 *
 * @example
 * // 集成到请求日志系统
 * const { requestLogger } = require('../services/requestLoggerService')
 *
 * const watcher = createRequestLogConfigWatcher(
 *   async (changeData) => {
 *     const newConfig = JSON.parse(changeData.newValue || '{}')
 *     await requestLogger.reloadConfig(newConfig)
 *   }
 * )
 *
 * await watcher.start()
 */
function createRequestLogConfigWatcher(reloadCallback, options = {}) {
  const watcher = new ConfigWatcher({
    watchKeys: ['request_logs_config'],
    pollInterval: 30000,
    debounceDelay: 500,
    maxReloadsPerMinute: 1,
    enableDebugLogs: false,
    ...options
  })

  // 绑定重载回调
  if (typeof reloadCallback === 'function') {
    watcher.on('configChanged', async (changeData) => {
      try {
        await reloadCallback(changeData)
        logger.info('✅ Request log config reload completed successfully')
      } catch (error) {
        logger.error('❌ Request log config reload failed:', error)
        throw error
      }
    })
  }

  return watcher
}

module.exports = {
  ConfigWatcher,
  createConfigWatcher,
  createRequestLogConfigWatcher
}
