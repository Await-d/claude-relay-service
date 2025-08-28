/**
 * @fileoverview 动态配置系统启动器
 *
 * 将动态配置管理器集成到主应用中，提供：
 * - 应用启动时的配置管理器初始化
 * - 全局配置管理器实例访问
 * - 优雅关闭时的资源清理
 *
 * @author Claude Code
 * @version 1.0.0
 */

const { createRequestLogConfigManager } = require('../utils/DynamicConfigManager')
const logger = require('../utils/logger')

/**
 * 全局动态配置管理器实例
 */
let globalConfigManager = null

/**
 * 初始化动态配置系统
 * @param {Object} options - 配置选项
 * @returns {Promise<void>}
 */
async function initializeDynamicConfigSystem(options = {}) {
  try {
    logger.info('🔧 Initializing dynamic configuration system...')

    // 创建配置管理器实例
    globalConfigManager = createRequestLogConfigManager({
      watchInterval: options.watchInterval || 30000,
      debounceDelay: options.debounceDelay || 500,
      enableAutoReload: options.enableAutoReload !== false,
      ...options
    })

    // 监听配置管理器事件
    globalConfigManager.on('started', () => {
      logger.success('✅ Dynamic configuration system started')
    })

    globalConfigManager.on('configChanged', (data) => {
      logger.info('🔄 Configuration changed:', {
        key: data.key,
        hasNewValue: !!data.newValue
      })
    })

    globalConfigManager.on('configReloaded', (data) => {
      logger.success('✅ Configuration reloaded successfully', {
        changes: Object.keys(data.changes),
        duration: `${data.duration}ms`,
        reloadResults: data.reloadResults
      })
    })

    globalConfigManager.on('reloadFailed', (data) => {
      logger.error('❌ Configuration reload failed:', {
        error: data.error,
        duration: `${data.duration}ms`
      })
    })

    globalConfigManager.on('watcherError', (error) => {
      logger.error('❌ Configuration watcher error:', error)
    })

    // 启动配置管理器
    await globalConfigManager.start()

    logger.success('🚀 Dynamic configuration system initialized successfully')
  } catch (error) {
    logger.error('❌ Failed to initialize dynamic configuration system:', error)
    throw error
  }
}

/**
 * 获取全局配置管理器实例
 * @returns {DynamicConfigManager|null} 配置管理器实例
 */
function getDynamicConfigManager() {
  return globalConfigManager
}

/**
 * 获取当前动态配置
 * @param {string} [configKey] - 配置键名
 * @returns {Promise<any>} 配置值
 */
async function getDynamicConfig(configKey = null) {
  if (!globalConfigManager) {
    logger.warn('⚠️ Dynamic config manager not initialized, using static config')
    const config = require('../config/config')

    if (configKey) {
      return configKey.split('.').reduce((obj, key) => obj && obj[key], config)
    }

    return config
  }

  try {
    return await globalConfigManager.getCurrentConfig(configKey)
  } catch (error) {
    logger.error('❌ Failed to get dynamic config, falling back to static config:', error)

    const config = require('../config/config')
    if (configKey) {
      return configKey.split('.').reduce((obj, key) => obj && obj[key], config)
    }

    return config
  }
}

/**
 * 关闭动态配置系统
 * @returns {Promise<void>}
 */
async function shutdownDynamicConfigSystem() {
  if (!globalConfigManager) {
    return
  }

  try {
    logger.info('🛑 Shutting down dynamic configuration system...')

    await globalConfigManager.stop()
    globalConfigManager = null

    logger.success('✅ Dynamic configuration system shutdown completed')
  } catch (error) {
    logger.error('❌ Error during dynamic configuration system shutdown:', error)
  }
}

/**
 * 获取配置管理器状态
 * @returns {Object|null} 状态信息
 */
function getDynamicConfigStatus() {
  if (!globalConfigManager) {
    return null
  }

  return globalConfigManager.getStatus()
}

/**
 * 手动触发配置重载
 * @param {Object} [specificConfig] - 特定配置对象
 * @returns {Promise<boolean>} 重载是否成功
 */
async function reloadDynamicConfig(specificConfig = null) {
  if (!globalConfigManager) {
    logger.warn('⚠️ Dynamic config manager not initialized')
    return false
  }

  try {
    return await globalConfigManager.reloadConfig(specificConfig)
  } catch (error) {
    logger.error('❌ Failed to reload dynamic config:', error)
    return false
  }
}

module.exports = {
  initializeDynamicConfigSystem,
  shutdownDynamicConfigSystem,
  getDynamicConfigManager,
  getDynamicConfig,
  getDynamicConfigStatus,
  reloadDynamicConfig
}
