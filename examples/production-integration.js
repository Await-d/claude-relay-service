/**
 * @fileoverview 生产环境 ConfigWatcher 集成示例
 *
 * 展示如何在生产环境中安全可靠地集成 ConfigWatcher，
 * 包含完整的错误处理、监控和日志记录
 *
 * @author Claude Code
 * @version 1.0.0
 */

const { createRequestLogConfigWatcher } = require('../src/utils/ConfigWatcher')
const { requestLogger } = require('../src/services/requestLoggerService')
const { dynamicConfigManager } = require('../src/services/dynamicConfigService')
const logger = require('../src/utils/logger')

/**
 * 生产环境配置监听器管理器
 */
class ProductionConfigManager {
  constructor() {
    this.watchers = new Map()
    this.isInitialized = false
    this.stats = {
      successfulReloads: 0,
      failedReloads: 0,
      totalConfigChanges: 0,
      lastReloadTime: null
    }
  }

  /**
   * 初始化所有配置监听器
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.isInitialized) {
      logger.warn('⚠️ ProductionConfigManager is already initialized')
      return
    }

    try {
      logger.info('🚀 Initializing production config watchers...')

      // 初始化请求日志配置监听器
      await this.initializeRequestLogWatcher()

      // 可以添加更多配置监听器
      // await this.initializeSystemConfigWatcher()
      // await this.initializeProxyConfigWatcher()

      this.isInitialized = true
      logger.success('✅ Production config watchers initialized successfully')

      // 注册进程退出处理
      this.setupGracefulShutdown()
    } catch (error) {
      logger.error('❌ Failed to initialize production config watchers:', error)
      throw error
    }
  }

  /**
   * 初始化请求日志配置监听器
   * @private
   */
  async initializeRequestLogWatcher() {
    const watcher = createRequestLogConfigWatcher(
      async (changeData) => {
        try {
          await this.handleRequestLogConfigChange(changeData)
          this.stats.successfulReloads++
        } catch (error) {
          this.stats.failedReloads++
          throw error
        }
      },
      {
        // 生产环境配置
        pollInterval: 30000, // 30秒
        debounceDelay: 500, // 500ms防抖
        maxReloadsPerMinute: 1, // 每分钟最多重载1次
        enableDebugLogs: process.env.NODE_ENV === 'development'
      }
    )

    // 设置事件监听器
    this.setupWatcherEventListeners(watcher, 'request_log_config')

    // 启动监听器
    await watcher.start()

    // 保存监听器引用
    this.watchers.set('request_log_config', watcher)

    logger.info('✅ Request log config watcher initialized')
  }

  /**
   * 处理请求日志配置变化
   * @private
   */
  async handleRequestLogConfigChange(changeData) {
    const { key, newValue, oldValue, timestamp } = changeData

    logger.info('🔄 Processing request log config change:', {
      key,
      timestamp: new Date(timestamp).toISOString(),
      hasNewValue: !!newValue,
      hasOldValue: !!oldValue
    })

    this.stats.totalConfigChanges++
    this.stats.lastReloadTime = new Date(timestamp).toISOString()

    // 解析配置
    const newConfig = this.parseConfigValue(newValue)
    const oldConfig = this.parseConfigValue(oldValue)

    // 验证配置
    this.validateRequestLogConfig(newConfig)

    // 记录配置变化详情
    this.logConfigDifferences(oldConfig, newConfig)

    // 执行重载
    const reloadResult = await requestLogger.reloadConfig(newConfig)

    // 更新动态配置管理器
    if (newConfig.enabled !== undefined) {
      await dynamicConfigManager.setConfig('requestLogging.enabled', newConfig.enabled)
    }

    logger.success('✅ Request log config reload completed:', {
      reloadedAt: reloadResult.reloadedAt,
      statusChange: reloadResult.statusChange,
      configVersion: reloadResult.configApplied ? 'updated' : 'unchanged'
    })

    // 可选：发送监控通知
    await this.sendReloadNotification('request_log_config', {
      success: true,
      timestamp,
      changes: this.summarizeChanges(oldConfig, newConfig)
    })
  }

  /**
   * 设置监听器事件处理
   * @private
   */
  setupWatcherEventListeners(watcher, watcherName) {
    // 错误处理
    watcher.on('error', async (data) => {
      logger.error(`❌ ${watcherName} watcher error:`, data)

      // 错误恢复策略
      if (data.consecutiveErrors >= 3) {
        logger.warn(`⚠️ ${watcherName} watcher has ${data.consecutiveErrors} consecutive errors`)

        // 可以实现更复杂的恢复策略
        await this.handleWatcherError(watcherName, data)
      }
    })

    // 重载跳过处理
    watcher.on('reloadSkipped', (data) => {
      logger.warn(`⚠️ ${watcherName} config reload skipped:`, {
        reason: data.reason,
        key: data.key,
        timestamp: new Date(data.timestamp).toISOString()
      })
    })

    // 重载错误处理
    watcher.on('reloadError', async (data) => {
      logger.error(`❌ ${watcherName} config reload error:`, data)

      this.stats.failedReloads++

      // 发送错误通知
      await this.sendReloadNotification(watcherName, {
        success: false,
        error: data.error,
        timestamp: data.timestamp
      })
    })

    // 启动和停止事件
    watcher.on('started', () => {
      logger.info(`🚀 ${watcherName} watcher started`)
    })

    watcher.on('stopped', () => {
      logger.info(`🛑 ${watcherName} watcher stopped`)
    })
  }

  /**
   * 处理监听器错误
   * @private
   */
  async handleWatcherError(watcherName, _errorData) {
    logger.info(`🔧 Attempting to recover ${watcherName} watcher...`)

    try {
      const watcher = this.watchers.get(watcherName)
      if (watcher) {
        // 尝试重启监听器
        await watcher.stop()
        await new Promise((resolve) => setTimeout(resolve, 5000)) // 等待5秒
        await watcher.start()

        logger.success(`✅ ${watcherName} watcher recovered successfully`)
      }
    } catch (error) {
      logger.error(`❌ Failed to recover ${watcherName} watcher:`, error)

      // 可以在这里实现更严重的错误处理，比如发送告警
      await this.sendCriticalAlert(watcherName, error)
    }
  }

  /**
   * 解析配置值
   * @private
   */
  parseConfigValue(value) {
    if (!value) {
      return {}
    }

    try {
      return JSON.parse(value)
    } catch (error) {
      logger.warn('⚠️ Failed to parse config value:', error)
      return {}
    }
  }

  /**
   * 验证请求日志配置
   * @private
   */
  validateRequestLogConfig(config) {
    if (typeof config !== 'object') {
      throw new Error('Config must be an object')
    }

    if (config.enabled !== undefined && typeof config.enabled !== 'boolean') {
      throw new Error('enabled must be a boolean')
    }

    if (config.sampling?.rate !== undefined) {
      const { rate } = config.sampling
      if (typeof rate !== 'number' || rate < 0 || rate > 1) {
        throw new Error('sampling.rate must be a number between 0 and 1')
      }
    }

    if (config.async?.batchSize !== undefined) {
      const { batchSize } = config.async
      if (!Number.isInteger(batchSize) || batchSize <= 0) {
        throw new Error('async.batchSize must be a positive integer')
      }
    }
  }

  /**
   * 记录配置差异
   * @private
   */
  logConfigDifferences(oldConfig, newConfig) {
    const differences = this.findConfigDifferences(oldConfig, newConfig)

    if (differences.length > 0) {
      logger.info('📋 Configuration changes detected:', differences)
    } else {
      logger.info('ℹ️ No significant configuration changes detected')
    }
  }

  /**
   * 查找配置差异
   * @private
   */
  findConfigDifferences(oldConfig, newConfig) {
    const differences = []

    // 检查顶级属性
    const allKeys = new Set([...Object.keys(oldConfig), ...Object.keys(newConfig)])

    for (const key of allKeys) {
      const { [key]: oldValue } = oldConfig
      const { [key]: newValue } = newConfig

      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        differences.push({
          key,
          oldValue,
          newValue,
          type: oldValue === undefined ? 'added' : newValue === undefined ? 'removed' : 'changed'
        })
      }
    }

    return differences
  }

  /**
   * 汇总变化
   * @private
   */
  summarizeChanges(oldConfig, newConfig) {
    const changes = this.findConfigDifferences(oldConfig, newConfig)
    return changes.map((change) => `${change.key}: ${change.type}`)
  }

  /**
   * 发送重载通知
   * @private
   */
  async sendReloadNotification(configType, data) {
    // 这里可以集成实际的通知系统，比如webhook、邮件等
    logger.audit('📢 Config reload notification:', {
      configType,
      success: data.success,
      timestamp: data.timestamp,
      changes: data.changes || [],
      error: data.error || null
    })

    // 示例：发送到监控系统
    // await this.sendToMonitoringSystem('config_reload', {
    //   config_type: configType,
    //   success: data.success,
    //   timestamp: data.timestamp
    // })
  }

  /**
   * 发送关键告警
   * @private
   */
  async sendCriticalAlert(watcherName, error) {
    logger.audit('🚨 Critical config watcher alert:', {
      watcherName,
      error: error.message,
      timestamp: new Date().toISOString(),
      severity: 'critical'
    })

    // 这里可以集成告警系统
    // await this.sendToAlertingSystem('config_watcher_critical', {
    //   watcher_name: watcherName,
    //   error: error.message
    // })
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const watcherStats = {}

    for (const [name, watcher] of this.watchers) {
      watcherStats[name] = watcher.getStatus()
    }

    return {
      isInitialized: this.isInitialized,
      totalWatchers: this.watchers.size,
      stats: this.stats,
      watchers: watcherStats
    }
  }

  /**
   * 设置优雅关闭
   * @private
   */
  setupGracefulShutdown() {
    const shutdownHandler = async (signal) => {
      logger.info(`🛑 Received ${signal}, shutting down config watchers...`)
      await this.shutdown()
      process.exit(0)
    }

    process.on('SIGINT', shutdownHandler)
    process.on('SIGTERM', shutdownHandler)
  }

  /**
   * 关闭所有配置监听器
   */
  async shutdown() {
    logger.info('🛑 Shutting down production config manager...')

    const shutdownPromises = []

    for (const [name, watcher] of this.watchers) {
      logger.info(`🛑 Stopping ${name} watcher...`)
      shutdownPromises.push(
        watcher.destroy().catch((error) => {
          logger.error(`❌ Error stopping ${name} watcher:`, error)
        })
      )
    }

    await Promise.all(shutdownPromises)
    this.watchers.clear()
    this.isInitialized = false

    logger.success('✅ Production config manager shutdown completed')
  }
}

// 创建全局实例
const productionConfigManager = new ProductionConfigManager()

/**
 * 主函数
 */
async function main() {
  try {
    logger.start('Production ConfigWatcher integration starting...')

    // 初始化配置管理器
    await productionConfigManager.initialize()

    // 定期输出统计信息
    setInterval(() => {
      const stats = productionConfigManager.getStats()
      logger.performance('📊 Config management stats:', {
        totalWatchers: stats.totalWatchers,
        successfulReloads: stats.stats.successfulReloads,
        failedReloads: stats.stats.failedReloads,
        totalConfigChanges: stats.stats.totalConfigChanges,
        lastReloadTime: stats.stats.lastReloadTime
      })
    }, 300000) // 每5分钟输出一次统计

    logger.success('✅ Production ConfigWatcher integration is running')
  } catch (error) {
    logger.error('❌ Failed to start production config integration:', error)
    process.exit(1)
  }
}

// 导出管理器实例
module.exports = {
  ProductionConfigManager,
  productionConfigManager
}

// 如果直接运行此文件
if (require.main === module) {
  main()
}
