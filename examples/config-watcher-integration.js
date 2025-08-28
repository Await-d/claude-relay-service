/**
 * @fileoverview ConfigWatcher 集成示例
 *
 * 展示如何将 ConfigWatcher 与现有系统组件集成，
 * 实现配置热重载功能
 *
 * @author Claude Code
 * @version 1.0.0
 */

const { ConfigWatcher, createRequestLogConfigWatcher } = require('../src/utils/ConfigWatcher')
const { requestLogger } = require('../src/services/requestLoggerService')
const logger = require('../src/utils/logger')

/**
 * 基本使用示例
 */
async function basicUsageExample() {
  logger.info('🔧 启动基本 ConfigWatcher 示例...')

  // 创建基本配置监听器
  const watcher = new ConfigWatcher({
    watchKeys: ['request_logs_config', 'system_config'],
    pollInterval: 30000, // 30秒轮询一次
    debounceDelay: 500, // 500ms防抖
    maxReloadsPerMinute: 2, // 每分钟最多重载2次
    enableDebugLogs: true
  })

  // 监听配置变化事件
  watcher.on('configChanged', (data) => {
    logger.info('📊 配置发生变化:', {
      key: data.key,
      hasOldValue: data.oldValue !== null,
      hasNewValue: data.newValue !== null,
      timestamp: new Date(data.timestamp).toISOString()
    })
  })

  // 监听错误事件
  watcher.on('error', (data) => {
    logger.error('❌ ConfigWatcher 错误:', data)
  })

  // 监听重载跳过事件
  watcher.on('reloadSkipped', (data) => {
    logger.warn('⚠️ 配置重载被跳过:', data)
  })

  // 启动监听器
  await watcher.start()
  logger.success('✅ ConfigWatcher 启动成功')

  // 显示状态
  setInterval(() => {
    const status = watcher.getStatus()
    logger.info('📊 ConfigWatcher 状态:', {
      isRunning: status.isRunning,
      totalChecks: status.stats.totalChecks,
      configChanges: status.stats.configChangesDetected,
      reloadsTriggered: status.stats.reloadsTriggered,
      uptime: `${Math.round(status.stats.uptime / 1000)}s`
    })
  }, 60000) // 每分钟显示一次状态

  return watcher
}

/**
 * 请求日志配置监听器示例
 */
async function requestLogConfigExample() {
  logger.info('📝 启动请求日志配置监听器示例...')

  // 使用专用工厂函数创建请求日志配置监听器
  const watcher = createRequestLogConfigWatcher(
    async (changeData) => {
      logger.info('🔄 请求日志配置变更，开始重载...', {
        key: changeData.key,
        timestamp: new Date(changeData.timestamp).toISOString()
      })

      try {
        // 解析新配置
        const newConfig = changeData.newValue ? JSON.parse(changeData.newValue) : {}

        // 触发请求日志服务重载
        const reloadResult = await requestLogger.reloadConfig(newConfig)

        logger.success('✅ 请求日志配置重载成功:', {
          configApplied: reloadResult.configApplied?.enabled || 'unknown',
          statusChange: reloadResult.statusChange || 'none',
          reloadedAt: reloadResult.reloadedAt
        })
      } catch (error) {
        logger.error('❌ 请求日志配置重载失败:', error)
        throw error
      }
    },
    {
      // 自定义选项
      pollInterval: 15000, // 更频繁的检查（15秒）
      enableDebugLogs: process.env.NODE_ENV === 'development'
    }
  )

  // 启动监听器
  await watcher.start()
  logger.success('✅ 请求日志配置监听器启动成功')

  return watcher
}

/**
 * 高级集成示例
 */
async function advancedIntegrationExample() {
  logger.info('🚀 启动高级集成示例...')

  const watcher = new ConfigWatcher({
    watchKeys: ['request_logs_config'],
    pollInterval: 20000,
    debounceDelay: 1000, // 更长的防抖时间
    maxReloadsPerMinute: 1, // 更严格的频率限制
    enableDebugLogs: false
  })

  // 实现智能重载逻辑
  watcher.on('configChanged', async (data) => {
    const { key, newValue, oldValue, timestamp } = data

    logger.info('🔄 智能配置重载开始:', {
      key,
      timestamp: new Date(timestamp).toISOString()
    })

    try {
      // 验证新配置
      const newConfig = newValue ? JSON.parse(newValue) : {}
      const oldConfig = oldValue ? JSON.parse(oldValue) : {}

      // 检查关键配置是否真正发生变化
      const criticalChanges = detectCriticalChanges(oldConfig, newConfig)

      if (criticalChanges.length === 0) {
        logger.info('ℹ️ 未检测到关键配置变化，跳过重载')
        return
      }

      logger.info('📋 检测到关键配置变化:', criticalChanges)

      // 执行分阶段重载
      await performStageReload(newConfig, criticalChanges)

      logger.success('✅ 智能配置重载完成')
    } catch (error) {
      logger.error('❌ 智能配置重载失败:', error)

      // 可以在这里实现回滚机制
      // await rollbackConfig(oldValue)
    }
  })

  // 错误恢复处理
  watcher.on('error', async (data) => {
    logger.error('❌ ConfigWatcher 发生错误:', data)

    // 实现错误恢复策略
    if (data.consecutiveErrors >= 3) {
      logger.warn('⚠️ 连续错误过多，尝试重置监听器...')

      try {
        await watcher.stop()
        await new Promise((resolve) => setTimeout(resolve, 5000)) // 等待5秒
        await watcher.start()
        logger.success('✅ ConfigWatcher 重置成功')
      } catch (resetError) {
        logger.error('❌ ConfigWatcher 重置失败:', resetError)
      }
    }
  })

  await watcher.start()
  return watcher
}

/**
 * 检测关键配置变化
 * @param {Object} oldConfig 旧配置
 * @param {Object} newConfig 新配置
 * @returns {Array} 变化列表
 */
function detectCriticalChanges(oldConfig, newConfig) {
  const changes = []

  // 检查启用状态变化
  if (oldConfig.enabled !== newConfig.enabled) {
    changes.push({
      type: 'enabled_change',
      from: oldConfig.enabled,
      to: newConfig.enabled
    })
  }

  // 检查采样率变化
  if (oldConfig.sampling?.rate !== newConfig.sampling?.rate) {
    changes.push({
      type: 'sampling_rate_change',
      from: oldConfig.sampling?.rate,
      to: newConfig.sampling?.rate
    })
  }

  // 检查批量大小变化
  if (oldConfig.async?.batchSize !== newConfig.async?.batchSize) {
    changes.push({
      type: 'batch_size_change',
      from: oldConfig.async?.batchSize,
      to: newConfig.async?.batchSize
    })
  }

  return changes
}

/**
 * 执行分阶段重载
 * @param {Object} newConfig 新配置
 * @param {Array} changes 变化列表
 */
async function performStageReload(newConfig, changes) {
  // 阶段1：验证配置
  logger.info('🔍 阶段1：验证新配置...')
  validateConfig(newConfig)

  // 阶段2：应用非关键配置
  logger.info('⚙️ 阶段2：应用非关键配置...')
  await applyNonCriticalConfig(newConfig)

  // 阶段3：应用关键配置
  logger.info('🔧 阶段3：应用关键配置...')
  for (const change of changes) {
    await applyCriticalChange(change, newConfig)
  }

  logger.success('✅ 分阶段重载完成')
}

/**
 * 验证配置
 * @param {Object} config 配置对象
 */
function validateConfig(config) {
  if (typeof config !== 'object') {
    throw new Error('配置必须是对象类型')
  }

  if (typeof config.enabled !== 'undefined' && typeof config.enabled !== 'boolean') {
    throw new Error('enabled 配置必须是布尔值')
  }

  if (
    config.sampling?.rate &&
    (typeof config.sampling.rate !== 'number' ||
      config.sampling.rate < 0 ||
      config.sampling.rate > 1)
  ) {
    throw new Error('采样率必须是0-1之间的数字')
  }
}

/**
 * 应用非关键配置
 * @param {Object} config 配置对象
 */
async function applyNonCriticalConfig(config) {
  // 这里可以应用一些不影响核心功能的配置
  logger.debug('应用非关键配置:', config)
}

/**
 * 应用关键配置变化
 * @param {Object} change 变化对象
 * @param {Object} config 完整配置
 */
async function applyCriticalChange(change, _config) {
  logger.info(`应用关键变化: ${change.type}`, change)

  switch (change.type) {
    case 'enabled_change':
      await requestLogger.reloadConfig({ enabled: change.to })
      break
    case 'sampling_rate_change':
      // 可以实现渐进式采样率调整
      await requestLogger.reloadConfig({ sampling: { rate: change.to } })
      break
    case 'batch_size_change':
      await requestLogger.reloadConfig({ async: { batchSize: change.to } })
      break
  }
}

/**
 * 主函数
 */
async function main() {
  try {
    logger.start('ConfigWatcher 集成示例启动')

    // 选择运行的示例
    const exampleType = process.argv[2] || 'basic'

    let watcher
    switch (exampleType) {
      case 'basic':
        watcher = await basicUsageExample()
        break
      case 'request-log':
        watcher = await requestLogConfigExample()
        break
      case 'advanced':
        watcher = await advancedIntegrationExample()
        break
      default:
        throw new Error(`未知的示例类型: ${exampleType}`)
    }

    // 优雅关闭处理
    process.on('SIGINT', async () => {
      logger.info('🛑 接收到关闭信号，正在停止 ConfigWatcher...')
      await watcher.destroy()
      process.exit(0)
    })

    logger.success(`✅ ${exampleType} 示例运行中...`)
  } catch (error) {
    logger.error('❌ 示例运行失败:', error)
    process.exit(1)
  }
}

// 如果直接运行此文件
if (require.main === module) {
  main()
}

module.exports = {
  basicUsageExample,
  requestLogConfigExample,
  advancedIntegrationExample
}
