/**
 * @fileoverview 高性能请求日志记录服务
 *
 * 核心设计理念：
 * - KISS 原则: 简洁的API设计和使用方式
 * - 性能第一: 异步批量处理，零阻塞关键路径
 * - SOLID 架构: 职责分离，可扩展设计
 * - DRY 复用: 重用现有系统组件
 *
 * 主要功能：
 * - 异步队列 + 批量写入，最小化I/O开销
 * - 智能采样器：基于系统负载、请求类型、API Key的动态采样
 * - 内存保护：队列大小限制、溢出保护、优雅降级
 * - 错误恢复：重试机制、断线重连、数据完整性保护
 * - 性能监控：队列长度、写入延迟、内存使用跟踪
 *
 * @author Claude Code
 * @version 1.0.0
 */

const config = require('../../config/config')
const logger = require('../utils/logger')
const database = require('../models/database')

/**
 * 简化的日志记录器 - 记录所有请求
 * 移除了智能采样功能，直接记录所有请求
 */
class SimpleLogger {
  constructor(options = {}) {
    this.config = options.config || config.requestLogging.sampling
    this.keyQuotas = new Map() // API Key 配额跟踪
    this.lastCleanup = Date.now()
    this.cleanupInterval = 60 * 60 * 1000 // 1小时清理一次
  }

  /**
   * 决定是否应该记录此请求
   * @param {Object} context 请求上下文
   * @returns {Promise<boolean>} 是否应该记录
   */
  async shouldLog(_context) {
    // 记录所有请求，不进行智能采样
    logger.debug('📝 All requests will be logged (sampling disabled)')
    return true
  }
}

/**
 * 高性能请求日志记录器主类
 *
 * 核心职责：
 * - 管理异步日志队列
 * - 执行批量写入操作
 * - 提供内存保护机制
 * - 监控性能指标
 * - 支持配置热重载
 */
class PerformantRequestLogger {
  constructor(options = {}) {
    // 配置管理器引用（用于动态配置获取）
    this.configManager = options.configManager || null
    this._configVersion = 0 // 配置版本号，用于检测配置变更

    // 异步初始化标志
    this._initialized = false
    this._initializing = false

    // 立即开始异步初始化
    this.initializeAsync(options)
  }

  /**
   * 异步初始化方法 - 从动态配置系统获取配置
   * @param {Object} options 初始化选项
   */
  async initializeAsync(options = {}) {
    if (this._initializing || this._initialized) {
      return
    }

    this._initializing = true

    try {
      // 1. 尝试从动态配置系统获取配置
      let dynamicConfig = null
      try {
        const { dynamicConfigManager } = require('./dynamicConfigService')
        dynamicConfig = await dynamicConfigManager.getRequestLoggingConfig()
        logger.debug('📋 Loaded configuration from dynamic config system:', {
          enabled: dynamicConfig?.enabled,
          mode: dynamicConfig?.mode
        })
      } catch (dynamicError) {
        logger.warn(
          '⚠️ Failed to load from dynamic config, falling back to static config:',
          dynamicError.message
        )
      }

      // 2. 配置优先级: options.config > dynamicConfig > 静态配置
      // 使用深度合并确保不丢失静态配置中的字段
      this.config = options.config || this.mergeConfigs(config.requestLogging, dynamicConfig)
      this._isEnabled = this.config.enabled || false

      // 3. 初始化组件
      if (!this._isEnabled) {
        logger.info('📝 Request logging is disabled')
        // 即使禁用也初始化基础结构，支持运行时启用
        this.initializeBaseComponents()
      } else {
        // 初始化所有组件
        this.initializeAllComponents()
      }

      this._initialized = true
      logger.info(
        `🚀 PerformantRequestLogger initialized successfully (enabled: ${this._isEnabled})`
      )

      // 🔍 添加详细的状态报告
      logger.info(`📊 REQUEST LOGGING SERVICE STATUS REPORT:`)
      logger.info(`   ✅ Service Initialized: ${this._initialized}`)
      logger.info(`   🔧 Service Enabled: ${this._isEnabled}`)
      logger.info(`   📝 Sampling Strategy: DISABLED - All requests will be logged`)
      logger.info(`   ⚡ Async Queue Size: ${this.config.async?.maxQueueSize || 1000}`)
      logger.info(`   📦 Batch Size: ${this.config.async?.batchSize || 50}`)
      logger.info(`   📋 Configuration Source: ${dynamicConfig ? 'Dynamic' : 'Static'}`)
      logger.info(`📊 REQUEST LOGGING SERVICE STATUS REPORT END`)
    } catch (error) {
      logger.error('❌ Failed to initialize PerformantRequestLogger:', error)
      // 降级到静态配置初始化
      this.config = config.requestLogging
      this._isEnabled = this.config.enabled || false
      this.initializeBaseComponents()
      this._initialized = true
    } finally {
      this._initializing = false
    }
  }

  /**
   * 将请求日志异步入队（关键路径零阻塞）
   * @param {Object} logEntry 日志条目
   * @returns {boolean} 是否成功入队
   */
  enqueueLog(logEntry) {
    if (!this.isCurrentlyEnabled()) {
      return false
    }

    try {
      // 队列长度检查 (< 0.1ms)
      if (this.logQueue.length >= (this.config.async?.maxQueueSize || 1000)) {
        return this.handleQueueOverflow(logEntry)
      }

      // 标准化日志条目
      const standardizedEntry = this.standardizeLogEntry(logEntry)

      // 入队操作 (< 0.01ms)
      this.logQueue.push(standardizedEntry)
      this.metrics.queueLength = this.logQueue.length
      this.metrics.totalEnqueued++

      // 更积极的批量写入触发策略
      if (this.logQueue.length >= (this.config.async?.batchSize || 5)) {
        // 达到批量大小时立即处理
        this.scheduleBatchWrite()
      } else if (this.logQueue.length === 1) {
        // 队列中第一条日志时，启动延迟写入
        this.scheduleDelayedWrite()
      }

      return true
    } catch (error) {
      logger.error('❌ Failed to enqueue log:', error)
      this.metrics.totalErrors++
      return false
    }
  }

  /**
   * 智能采样决策
   * @param {string} apiKeyId API Key ID
   * @param {string} requestType 请求类型
   * @param {Object} context 请求上下文 {responseTime, statusCode}
   * @returns {Promise<boolean>} 是否应该记录
   */
  async shouldLog(apiKeyId, requestType = 'normal', _context = {}) {
    const currentlyEnabled = this.isCurrentlyEnabled()
    logger.info(
      `🔍 shouldLog called - Service Enabled: ${currentlyEnabled}, API Key: ${apiKeyId}, Type: ${requestType}`
    )

    if (!currentlyEnabled) {
      logger.info(`❌ Request logging disabled - skipping log for ${apiKeyId}`)
      return false
    }

    // 简化版本：记录所有请求
    logger.info(`✅ All requests will be logged (sampling disabled) - API Key: ${apiKeyId}`)
    return true
  }

  /**
   * 批量写入Redis (关键性能方法)
   * @returns {Promise<void>}
   */
  async flushLogs() {
    if (this.isProcessing || this.logQueue.length === 0) {
      return
    }

    this.isProcessing = true
    const batchStartTime = Date.now()
    let batch = [] // 声明batch变量在try块之外

    try {
      // 取出要处理的批次
      const batchSize = Math.min(this.logQueue.length, this.config.async?.batchSize || 50)
      batch = this.logQueue.splice(0, batchSize)

      logger.info(`📝 Processing batch of ${batch.length} logs`)

      // 使用数据库抽象接口进行批量写入
      const database_instance = await database.getDatabase()
      const writeResult = await database_instance.batchWriteLogs(batch, {
        retentionMaxAge: this.config.retention.maxAge
      })

      // 检查写入结果
      if (writeResult.success) {
        logger.info('🔍 DEBUGGING: Batch write successful:', {
          totalLogs: batch.length,
          successCount: writeResult.results.length,
          errorCount: writeResult.errors.length
        })
      } else {
        logger.error('🔍 DEBUGGING: Batch write had errors:', {
          totalLogs: batch.length,
          errorCount: writeResult.errors.length,
          sampleErrors: writeResult.errors.slice(0, 3)
        })
      }

      // 验证写入：随机选择一个日志进行验证
      if (batch.length > 0 && writeResult.results.length > 0) {
        try {
          const testLogKey = writeResult.results[0].logKey
          const verification = await database_instance.verifyLogWrite(testLogKey)

          if (verification.success) {
            logger.info('🔍 DEBUGGING: Write verification successful:', {
              testKey: testLogKey,
              fieldsCount: verification.fieldsCount,
              hasData: !!verification.data
            })
          } else {
            logger.error('🔍 DEBUGGING: Write verification FAILED:', {
              testKey: testLogKey,
              error: verification.error
            })
          }
        } catch (verifyError) {
          logger.error('🔍 DEBUGGING: Write verification error:', verifyError.message)
        }
      }

      // 更新性能指标
      const writeTime = Date.now() - batchStartTime
      this.updateMetrics(batch.length, writeTime)

      logger.info(`✅ Batch write completed: ${batch.length} logs in ${writeTime}ms`)
    } catch (error) {
      logger.error('❌ Batch write failed:', error)
      this.metrics.totalErrors++

      // 错误恢复：将失败的日志重新放回队列（在末尾，避免无限重试）
      if (batch && batch.length > 0) {
        this.logQueue.push(...batch)
        logger.warn(`⚠️ Re-queued ${batch.length} logs for retry`)
      }
    } finally {
      this.isProcessing = false
      this.metrics.queueLength = this.logQueue.length

      // 如果还有待处理的日志，继续处理
      if (this.logQueue.length > 0) {
        this.scheduleBatchWrite()
      }
    }
  }

  /**
   * 获取实时性能指标
   * @returns {Object} 性能指标
   */
  getMetrics() {
    const uptime = Date.now() - this.metrics.startTime
    const queueUtilization = this.metrics.queueLength / (this.config.async?.maxQueueSize || 1000)

    return {
      enabled: this.isCurrentlyEnabled(),
      configVersion: this._configVersion,
      queue: {
        length: this.metrics.queueLength,
        maxSize: this.config.async?.maxQueueSize || 1000,
        utilization: Math.round(queueUtilization * 100) / 100
      },
      throughput: {
        totalEnqueued: this.metrics.totalEnqueued,
        totalWritten: this.metrics.totalWritten,
        totalDropped: this.metrics.totalDropped,
        successRate:
          this.metrics.totalEnqueued > 0
            ? Math.round((this.metrics.totalWritten / this.metrics.totalEnqueued) * 100) / 100
            : 1
      },
      performance: {
        avgWriteTime: this.metrics.avgWriteTime,
        lastBatchTime: this.metrics.lastBatchTime,
        lastBatchSize: this.metrics.lastBatchSize,
        memoryUsage: this.metrics.memoryUsage
      },
      errors: {
        totalErrors: this.metrics.totalErrors,
        retryQueueSize: this.retryQueue.length
      },
      uptime: {
        seconds: Math.floor(uptime / 1000),
        formatted: this.formatUptime(uptime)
      },
      sampler: null // 智能采样已移除
    }
  }

  // ==================== 配置热重载方法 ====================

  /**
   * 重新加载配置（热重载核心方法）
   * @param {Object} newConfig 新的配置对象，如果未提供则从动态配置服务获取
   * @returns {Promise<Object>} 重载结果状态
   */
  async reloadConfig(newConfig = null) {
    logger.info('🔄 Starting configuration reload...')

    try {
      // 如果没有提供配置，从动态配置服务获取
      if (!newConfig) {
        const { dynamicConfigManager } = require('./dynamicConfigService')
        newConfig = await dynamicConfigManager.getRequestLoggingConfig()
      }

      const oldEnabled = this._isEnabled
      const newEnabled = newConfig.enabled

      // 智能合并配置：保留现有完整结构，只更新传入的字段
      this.config = this.mergeConfig(this.config, newConfig)
      this._isEnabled = newEnabled
      this._configVersion++

      logger.debug(
        `🔄 Config reload: enabled ${oldEnabled} → ${newEnabled}, version: ${this._configVersion}`
      )

      // 处理启用状态变更
      if (!oldEnabled && newEnabled) {
        // 从禁用变为启用：初始化所有组件
        await this.enable()
      } else if (oldEnabled && !newEnabled) {
        // 从启用变为禁用：优雅关闭
        await this.disable()
      } else if (oldEnabled && newEnabled) {
        // 都是启用状态：重新初始化组件以应用新配置
        await this.reinitializeComponents()
      }
      // 如果都是禁用状态，无需特殊处理

      logger.info(`✅ Configuration reload completed (version ${this._configVersion})`)

      return {
        success: true,
        reloadedAt: new Date().toISOString(),
        configApplied: newConfig,
        statusChange: {
          from: oldEnabled,
          to: newEnabled
        }
      }
    } catch (error) {
      logger.error('❌ Configuration reload failed:', error)
      this.metrics.totalErrors++

      return {
        success: false,
        error: error.message,
        reloadedAt: new Date().toISOString()
      }
    }
  }

  /**
   * 智能合并配置（深度合并，保留现有结构）
   * @param {Object} existingConfig 现有配置
   * @param {Object} newConfig 新配置
   * @returns {Object} 合并后的配置
   */
  mergeConfig(existingConfig, newConfig) {
    // 深克隆现有配置以避免意外修改
    const merged = JSON.parse(JSON.stringify(existingConfig))

    // 只更新新配置中明确提供的字段
    if (newConfig.enabled !== undefined) {
      merged.enabled = newConfig.enabled
    }
    if (newConfig.mode !== undefined) {
      merged.mode = newConfig.mode
    }
    if (newConfig.sampling && typeof newConfig.sampling === 'object') {
      merged.sampling = { ...merged.sampling, ...newConfig.sampling }
    }

    // 从Web界面的字段映射到标准配置结构
    if (newConfig.level !== undefined) {
      merged.mode = newConfig.level === 'debug' ? 'detailed' : 'basic'
    }
    if (newConfig.retentionDays !== undefined) {
      if (!merged.retention) {
        merged.retention = {}
      }
      merged.retention.maxAge = newConfig.retentionDays * 24 * 60 * 60 * 1000
    }

    logger.debug('🔧 Configuration merged successfully:', {
      originalKeys: Object.keys(existingConfig),
      newKeys: Object.keys(newConfig),
      mergedKeys: Object.keys(merged)
    })

    return merged
  }

  /**
   * 运行时启用日志服务
   * @returns {Promise<void>}
   */
  async enable() {
    if (this._isEnabled) {
      logger.debug('📝 Request logging is already enabled')
      return
    }

    logger.info('🚀 Enabling request logging service...')
    this._isEnabled = true
    this._configVersion++

    // 初始化所有组件
    this.initializeAllComponents()

    logger.info('✅ Request logging service enabled successfully')
  }

  /**
   * 运行时禁用日志服务
   * @returns {Promise<void>}
   */
  async disable() {
    if (!this._isEnabled) {
      logger.debug('📝 Request logging is already disabled')
      return
    }

    logger.info('🛑 Disabling request logging service...')
    this._isEnabled = false
    this._configVersion++

    // 清理定时器
    this.clearTimers()

    // 处理剩余的日志
    if (this.logQueue && this.logQueue.length > 0) {
      logger.info(`📝 Flushing ${this.logQueue.length} remaining logs before disable...`)
      await this.flushLogs()
    }

    logger.info('✅ Request logging service disabled successfully')
  }

  /**
   * 动态检查当前启用状态
   * @returns {boolean} 当前是否启用
   */
  isCurrentlyEnabled() {
    // 如果正在初始化，返回false（确保初始化完成后再处理请求）
    if (this._initializing || !this._initialized) {
      logger.debug(
        `🔍 Service not ready: initializing=${this._initializing}, initialized=${this._initialized}`
      )
      return false
    }

    // 支持从配置管理器动态获取状态
    if (this.configManager && typeof this.configManager.getRequestLoggingEnabled === 'function') {
      const dynamicEnabled = this.configManager.getRequestLoggingEnabled()
      logger.debug(`🔍 Dynamic config enabled: ${dynamicEnabled}`)
      return dynamicEnabled
    }

    const enabled = this._isEnabled || false
    logger.debug(`🔍 Static config enabled: ${enabled}`)
    return enabled
  }

  /**
   * 重新初始化组件（配置变更时调用）
   * @returns {Promise<void>}
   */
  async reinitializeComponents() {
    logger.info('🔄 Reinitializing components with new configuration...')

    // 清理旧的定时器
    this.clearTimers()

    // 处理队列中的剩余日志
    if (this.logQueue && this.logQueue.length > 0) {
      logger.debug(`📝 Flushing ${this.logQueue.length} logs before reinitialization...`)
      await this.flushLogs()
    }

    // 智能采样已移除，无需重新创建采样器

    // 更新错误处理配置 - 安全访问属性
    const asyncConfig = this.config.async || {}
    this.maxRetries = asyncConfig.maxRetries || 3
    this.retryDelay = asyncConfig.retryDelay || 1000

    // 重新启动监控和定时器
    this.startPerformanceMonitoring()
    this.startBatchTimer()

    logger.info('✅ Components reinitialized successfully')
  }

  // ==================== 组件初始化方法 ====================

  /**
   * 初始化基础组件（最小化初始化，支持后续启用）
   */
  initializeBaseComponents() {
    // 核心组件初始化
    this.logQueue = []
    this.isProcessing = false
    this.batchTimer = null
    this.retryQueue = []
    this.monitoringTimer = null
    this.batchIntervalTimer = null

    // 性能监控（即使禁用状态也保持基础指标）
    this.metrics = {
      queueLength: 0,
      totalEnqueued: 0,
      totalWritten: 0,
      totalDropped: 0,
      totalErrors: 0,
      lastBatchTime: 0,
      lastBatchSize: 0,
      avgWriteTime: 0,
      memoryUsage: 0,
      startTime: Date.now()
    }

    // 错误处理配置
    this.maxRetries = this.config.async?.maxRetries || 3
    this.retryDelay = this.config.async?.retryDelay || 1000
  }

  /**
   * 初始化所有组件（完整初始化）
   */
  initializeAllComponents() {
    // 先初始化基础组件
    this.initializeBaseComponents()

    // 智能采样已移除

    // 启动监控和清理定时器
    this.startPerformanceMonitoring()
    this.startBatchTimer()
  }

  /**
   * 清理所有定时器
   */
  clearTimers() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }
    if (this.delayedWriteTimer) {
      clearTimeout(this.delayedWriteTimer)
      this.delayedWriteTimer = null
    }
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer)
      this.monitoringTimer = null
    }
    if (this.batchIntervalTimer) {
      clearInterval(this.batchIntervalTimer)
      this.batchIntervalTimer = null
    }
  }

  // ==================== 私有方法 ====================

  /**
   * 处理队列溢出情况
   * @param {Object} logEntry 新的日志条目
   * @returns {boolean} 是否成功处理
   */
  handleQueueOverflow(logEntry) {
    this.metrics.totalDropped++

    const strategy = this.config.async?.queueFullStrategy || 'drop_oldest'

    if (strategy === 'drop_oldest') {
      // 删除最老的日志，添加新日志
      this.logQueue.shift()
      this.logQueue.push(this.standardizeLogEntry(logEntry))
      logger.warn('⚠️ Queue full, dropped oldest log entry')
      return true
    } else if (strategy === 'drop_newest') {
      // 丢弃新日志
      logger.warn('⚠️ Queue full, dropped newest log entry')
      return false
    } else {
      // 触发紧急批量写入
      this.scheduleBatchWrite()
      return false
    }
  }

  /**
   * 标准化日志条目格式
   * @param {Object} logEntry 原始日志条目
   * @returns {Object} 标准化的日志条目
   */
  standardizeLogEntry(logEntry) {
    const now = Date.now()

    return {
      id: `${logEntry.keyId}_${now}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: now,
      keyId: logEntry.keyId || 'unknown',
      data: {
        method: logEntry.method || '',
        path: logEntry.path || '',
        statusCode: logEntry.statusCode || 0,
        responseTime: logEntry.responseTime || 0,
        userAgent: this.sanitizeUserAgent(logEntry.userAgent || ''),
        ipAddress: this.sanitizeIpAddress(logEntry.ipAddress || ''),
        model: logEntry.model || '',
        tokens: logEntry.tokens || 0,
        inputTokens: logEntry.inputTokens || 0,
        outputTokens: logEntry.outputTokens || 0,
        error: logEntry.error || null,
        timestamp: now,
        keyId: logEntry.keyId || 'unknown'
      }
    }
  }

  /**
   * 净化用户代理字符串
   * @param {string} userAgent 原始用户代理
   * @returns {string} 净化后的用户代理
   */
  sanitizeUserAgent(userAgent) {
    if (!userAgent) {
      return ''
    }

    const maxLength = this.config.filtering.maxUserAgentLength
    const sanitized = userAgent.replace(/[^\x20-\x7E]/g, '').substring(0, maxLength)

    return sanitized
  }

  /**
   * 净化IP地址（根据配置决定是否掩码）
   * @param {string} ipAddress 原始IP地址
   * @returns {string} 净化后的IP地址
   */
  sanitizeIpAddress(ipAddress) {
    if (!ipAddress) {
      return ''
    }

    if (this.config.filtering.maskIpAddress) {
      // IPv4 掩码: 192.168.1.xxx
      if (ipAddress.includes('.')) {
        const parts = ipAddress.split('.')
        if (parts.length === 4) {
          return `${parts[0]}.${parts[1]}.${parts[2]}.xxx`
        }
      }
      // IPv6 掩码: 2001:db8::xxx
      if (ipAddress.includes(':')) {
        const parts = ipAddress.split(':')
        if (parts.length > 2) {
          return `${parts[0]}:${parts[1]}::xxx`
        }
      }
    }

    return ipAddress
  }

  /**
   * 安排延迟写入任务（用于小批量快速写入）
   */
  scheduleDelayedWrite() {
    // 如果已有延迟写入任务，不重复创建
    if (this.delayedWriteTimer) {
      return
    }

    // 设置较短的延迟写入时间（1秒）
    this.delayedWriteTimer = setTimeout(() => {
      if (this.logQueue.length > 0 && !this.isProcessing) {
        logger.info(`⏰ Delayed write triggered for ${this.logQueue.length} logs`)
        this.flushLogs()
      }
      this.delayedWriteTimer = null
    }, 1000) // 1秒延迟写入
  }

  /**
   * 安排批量写入任务
   */
  scheduleBatchWrite() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
    }

    // 使用 setImmediate 确保非阻塞
    this.batchTimer = setImmediate(() => {
      this.flushLogs()
      this.batchTimer = null
    })
  }

  /**
   * 启动批量写入定时器
   */
  startBatchTimer() {
    if (!this.isCurrentlyEnabled()) {
      return
    }

    // 清理旧的定时器（防止重复启动）
    if (this.batchIntervalTimer) {
      clearInterval(this.batchIntervalTimer)
    }

    this.batchIntervalTimer = setInterval(() => {
      if (this.logQueue.length > 0 && !this.isProcessing) {
        this.flushLogs()
      }
    }, this.config.async?.batchTimeout || 5000)
  }

  /**
   * 更新性能指标
   * @param {number} batchSize 批次大小
   * @param {number} writeTime 写入时间
   */
  updateMetrics(batchSize, writeTime) {
    this.metrics.totalWritten += batchSize
    this.metrics.lastBatchTime = writeTime
    this.metrics.lastBatchSize = batchSize

    // 计算平均写入时间 (使用移动平均)
    const alpha = 0.3 // 平滑因子
    this.metrics.avgWriteTime =
      this.metrics.avgWriteTime === 0
        ? writeTime
        : alpha * writeTime + (1 - alpha) * this.metrics.avgWriteTime

    // 更新内存使用
    this.updateMemoryUsage()
  }

  /**
   * 更新内存使用统计
   */
  updateMemoryUsage() {
    try {
      const memUsage = process.memoryUsage()
      this.metrics.memoryUsage = Math.round(memUsage.heapUsed / 1024 / 1024) // MB
    } catch (error) {
      // 忽略内存统计错误
    }
  }

  /**
   * 处理写入错误
   * @param {Error} error 错误对象
   */
  handleWriteError(error) {
    logger.error('❌ Write error occurred:', error)

    // 简单的错误恢复策略：记录错误并继续处理
    // 在生产环境中，可以实现更复杂的重试逻辑
  }

  /**
   * 启动性能监控
   */
  startPerformanceMonitoring() {
    const monitoringConfig = this.config.monitoring || {}
    if (!monitoringConfig.enabled) {
      return
    }

    // 清理旧的定时器（防止重复启动）
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer)
    }

    this.monitoringTimer = setInterval(() => {
      const metrics = this.getMetrics()
      const warningThresholds = monitoringConfig.warningThresholds || {}

      // 检查警告阈值
      if (metrics.queue.length >= (warningThresholds.queueLength || 800)) {
        logger.warn(`⚠️ Request logger queue length warning: ${metrics.queue.length}`)
      }

      if (metrics.performance.avgWriteTime >= (warningThresholds.batchWriteDelay || 1000)) {
        logger.warn(`⚠️ Request logger write time warning: ${metrics.performance.avgWriteTime}ms`)
      }

      if (metrics.performance.memoryUsage >= (warningThresholds.memoryUsage || 100)) {
        logger.warn(`⚠️ Request logger memory usage warning: ${metrics.performance.memoryUsage}MB`)
      }

      // 调试级别的定期指标输出
      logger.debug('📊 Request logger metrics:', {
        queueLength: metrics.queue.length,
        throughput: `${metrics.throughput.totalWritten}/${metrics.throughput.totalEnqueued}`,
        avgWriteTime: `${Math.round(metrics.performance.avgWriteTime)}ms`,
        memoryUsage: `${metrics.performance.memoryUsage}MB`
      })
    }, monitoringConfig.metricsInterval || 60000)
  }

  /**
   * 格式化运行时间
   * @param {number} uptime 运行时间（毫秒）
   * @returns {string} 格式化的时间字符串
   */
  formatUptime(uptime) {
    const seconds = Math.floor(uptime / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`
    } else {
      return `${seconds}s`
    }
  }

  /**
   * 优雅关闭日志服务
   * @returns {Promise<void>}
   */
  async shutdown() {
    logger.info('🛑 Shutting down request logger...')

    // 标记为禁用状态
    this._isEnabled = false

    // 清除所有定时器
    this.clearTimers()

    // 处理剩余的日志
    if (this.logQueue && this.logQueue.length > 0) {
      logger.info(`📝 Flushing ${this.logQueue.length} remaining logs...`)
      await this.flushLogs()
    }

    logger.info('✅ Request logger shutdown completed')
  }

  /**
   * 深度合并配置对象
   * @param {Object} baseConfig 基础配置（静态配置）
   * @param {Object} overrideConfig 覆盖配置（动态配置）
   * @returns {Object} 合并后的配置
   */
  mergeConfigs(baseConfig, overrideConfig) {
    if (!overrideConfig) {
      return baseConfig
    }

    const merged = { ...baseConfig }

    for (const [key, value] of Object.entries(overrideConfig)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        // 递归合并对象
        merged[key] = this.mergeConfigs(merged[key] || {}, value)
      } else {
        // 直接覆盖基本类型和数组
        merged[key] = value
      }
    }

    return merged
  }
}

// 创建全局实例（延迟初始化，避免测试时出错）
let requestLogger
try {
  requestLogger = new PerformantRequestLogger()
} catch (error) {
  // 在测试环境或配置未就绪时，创建一个空的占位符
  requestLogger = {
    enqueueLog: () => false,
    shouldLog: async () => false,
    getMetrics: () => ({}),
    shutdown: async () => {},
    reloadConfig: async () => false,
    enable: async () => {},
    disable: async () => {},
    isCurrentlyEnabled: () => false
  }
}

// 优雅关闭处理
process.on('SIGINT', async () => {
  await requestLogger.shutdown()
})

process.on('SIGTERM', async () => {
  await requestLogger.shutdown()
})

module.exports = {
  PerformantRequestLogger,
  SimpleLogger,
  requestLogger // 单例实例，供其他模块使用
}
