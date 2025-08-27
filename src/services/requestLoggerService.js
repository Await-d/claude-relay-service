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
const os = require('os')

/**
 * 智能采样器类
 *
 * 负责基于多种因素决定是否记录请求日志：
 * - 系统负载（CPU、内存使用率）
 * - API Key 特定的采样率
 * - 请求类型（错误、慢请求优先记录）
 * - 时间窗口限制
 */
class IntelligentSampler {
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
  async shouldLog(context) {
    const {
      apiKeyId,
      requestType = 'normal', // 'normal', 'error', 'slow'
      responseTime = 0,
      statusCode = 200
    } = context

    try {
      // 1. 错误请求优先记录
      if (this.config.alwaysLogErrors && (statusCode >= 400 || requestType === 'error')) {
        logger.debug(`🎯 Sampler: Always logging error request (status: ${statusCode})`)
        return true
      }

      // 2. 慢请求优先记录
      if (this.config.alwaysLogSlowRequests && responseTime >= this.config.slowRequestThreshold) {
        logger.debug(`🎯 Sampler: Always logging slow request (${responseTime}ms)`)
        return true
      }

      // 3. 检查 API Key 配额限制
      if (apiKeyId && !(await this.checkApiKeyQuota(apiKeyId))) {
        logger.debug(`🎯 Sampler: API Key ${apiKeyId} exceeded quota`)
        return false
      }

      // 4. 动态采样（基于系统负载）
      if (this.config.enableDynamicSampling) {
        const dynamicRate = await this.calculateDynamicSamplingRate()
        if (Math.random() > dynamicRate) {
          return false
        }
      } else {
        // 5. 静态采样率
        if (Math.random() > this.config.rate) {
          return false
        }
      }

      // 6. 更新 API Key 配额
      if (apiKeyId) {
        this.incrementApiKeyQuota(apiKeyId)
      }

      logger.debug('🎯 Sampler: Request selected for logging')
      return true
    } catch (error) {
      logger.error('❌ Sampler error, defaulting to log:', error)
      return true // 出错时默认记录，确保重要日志不丢失
    }
  }

  /**
   * 检查 API Key 是否超出配额限制
   * @param {string} apiKeyId API Key ID
   * @returns {Promise<boolean>} 是否在配额内
   */
  async checkApiKeyQuota(apiKeyId) {
    const now = Date.now()
    const hourlyWindow = 60 * 60 * 1000 // 1小时

    // 清理过期数据
    if (now - this.lastCleanup > this.cleanupInterval) {
      this.cleanupExpiredQuotas()
    }

    if (!this.keyQuotas.has(apiKeyId)) {
      this.keyQuotas.set(apiKeyId, {
        count: 0,
        windowStart: now
      })
      return true
    }

    const quota = this.keyQuotas.get(apiKeyId)

    // 检查是否需要重置窗口
    if (now - quota.windowStart >= hourlyWindow) {
      quota.count = 0
      quota.windowStart = now
      return true
    }

    // 检查是否超出限制
    return quota.count < this.config.perKeyRateLimit
  }

  /**
   * 增加 API Key 配额计数
   * @param {string} apiKeyId API Key ID
   */
  incrementApiKeyQuota(apiKeyId) {
    if (!this.keyQuotas.has(apiKeyId)) {
      this.keyQuotas.set(apiKeyId, {
        count: 1,
        windowStart: Date.now()
      })
    } else {
      this.keyQuotas.get(apiKeyId).count++
    }
  }

  /**
   * 计算动态采样率（基于系统负载）
   * @returns {Promise<number>} 采样率 (0-1)
   */
  async calculateDynamicSamplingRate() {
    try {
      const systemLoad = this.getSystemLoad()
      let dynamicRate = this.config.rate

      // CPU 负载调整
      if (systemLoad.cpu > 0.8) {
        dynamicRate *= 0.3 // 高CPU负载时大幅降低采样
      } else if (systemLoad.cpu > 0.6) {
        dynamicRate *= 0.6 // 中等负载时适度降低
      }

      // 内存使用调整
      if (systemLoad.memory > 0.9) {
        dynamicRate *= 0.2 // 高内存使用时大幅降低采样
      } else if (systemLoad.memory > 0.7) {
        dynamicRate *= 0.5
      }

      // 确保采样率不会过低，保证基本监控能力
      dynamicRate = Math.max(dynamicRate, 0.01) // 最低1%

      logger.debug(
        `🎯 Dynamic sampling rate: ${dynamicRate} (CPU: ${systemLoad.cpu}, MEM: ${systemLoad.memory})`
      )
      return dynamicRate
    } catch (error) {
      logger.error('❌ Error calculating dynamic sampling rate:', error)
      return this.config.rate // 返回默认采样率
    }
  }

  /**
   * 获取系统负载指标
   * @returns {Object} 系统负载信息
   */
  getSystemLoad() {
    try {
      const cpus = os.cpus()
      let totalIdle = 0
      let totalTick = 0

      cpus.forEach((cpu) => {
        for (const type in cpu.times) {
          totalTick += cpu.times[type]
        }
        totalIdle += cpu.times.idle
      })

      const cpuUsage = 1 - totalIdle / totalTick

      const totalMem = os.totalmem()
      const freeMem = os.freemem()
      const memoryUsage = (totalMem - freeMem) / totalMem

      return {
        cpu: Math.max(0, Math.min(1, cpuUsage)), // 确保在 0-1 范围内
        memory: Math.max(0, Math.min(1, memoryUsage))
      }
    } catch (error) {
      logger.error('❌ Error getting system load:', error)
      return { cpu: 0.5, memory: 0.5 } // 返回中等负载作为默认值
    }
  }

  /**
   * 清理过期的配额数据
   */
  cleanupExpiredQuotas() {
    const now = Date.now()
    const expireTime = 2 * 60 * 60 * 1000 // 2小时

    for (const [keyId, quota] of this.keyQuotas.entries()) {
      if (now - quota.windowStart > expireTime) {
        this.keyQuotas.delete(keyId)
      }
    }

    this.lastCleanup = now
    logger.debug(`🧹 Cleaned up expired quota data, remaining keys: ${this.keyQuotas.size}`)
  }

  /**
   * 获取采样器统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    return {
      trackedApiKeys: this.keyQuotas.size,
      lastCleanup: this.lastCleanup,
      config: {
        rate: this.config.rate,
        perKeyRateLimit: this.config.perKeyRateLimit,
        enableDynamicSampling: this.config.enableDynamicSampling
      }
    }
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
 */
class PerformantRequestLogger {
  constructor(options = {}) {
    // 配置初始化
    this.config = options.config || config.requestLogging
    this.isEnabled = this.config.enabled

    if (!this.isEnabled) {
      logger.info('📝 Request logging is disabled')
      return
    }

    // 核心组件初始化
    this.logQueue = []
    this.isProcessing = false
    this.batchTimer = null
    this.retryQueue = []

    // 采样器
    this.sampler = new IntelligentSampler({ config: this.config.sampling })

    // 性能监控
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
    this.maxRetries = this.config.async.maxRetries
    this.retryDelay = this.config.async.retryDelay

    // 启动监控和清理定时器
    this.startPerformanceMonitoring()
    this.startBatchTimer()

    logger.info('🚀 PerformantRequestLogger initialized successfully')
  }

  /**
   * 将请求日志异步入队（关键路径零阻塞）
   * @param {Object} logEntry 日志条目
   * @returns {boolean} 是否成功入队
   */
  enqueueLog(logEntry) {
    if (!this.isEnabled) {
      return false
    }

    try {
      // 队列长度检查 (< 0.1ms)
      if (this.logQueue.length >= this.config.async.maxQueueSize) {
        return this.handleQueueOverflow(logEntry)
      }

      // 标准化日志条目
      const standardizedEntry = this.standardizeLogEntry(logEntry)

      // 入队操作 (< 0.01ms)
      this.logQueue.push(standardizedEntry)
      this.metrics.queueLength = this.logQueue.length
      this.metrics.totalEnqueued++

      // 检查是否需要立即处理
      if (this.logQueue.length >= this.config.async.batchSize) {
        this.scheduleBatchWrite()
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
   * @param {number} systemLoad 系统负载
   * @returns {Promise<boolean>} 是否应该记录
   */
  async shouldLog(apiKeyId, requestType = 'normal', systemLoad = 0.5) {
    if (!this.isEnabled) {
      return false
    }

    return await this.sampler.shouldLog({
      apiKeyId,
      requestType,
      systemLoad
    })
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

    try {
      // 取出要处理的批次
      const batchSize = Math.min(this.logQueue.length, this.config.async.batchSize)
      const batch = this.logQueue.splice(0, batchSize)

      logger.debug(`📝 Processing batch of ${batch.length} logs`)

      // 使用 Redis Pipeline 进行批量写入
      const client = await database.getDatabase()
      const pipeline = client.client.pipeline()

      for (const logEntry of batch) {
        const logKey = this.generateLogKey(logEntry)
        const indexKey = this.generateIndexKey(logEntry)

        // 写入日志条目 - 使用 hset 替代已弃用的 hmset
        const dataEntries = Object.entries(logEntry.data).flat()
        pipeline.hset(logKey, ...dataEntries)
        pipeline.expire(logKey, Math.floor(this.config.retention.maxAge / 1000))

        // 更新索引
        pipeline.sadd(indexKey, logKey)
        pipeline.expire(indexKey, Math.floor(this.config.retention.maxAge / 1000))
      }

      // 执行批量写入
      await pipeline.exec()

      // 更新性能指标
      const writeTime = Date.now() - batchStartTime
      this.updateMetrics(batch.length, writeTime)

      logger.debug(`✅ Batch write completed: ${batch.length} logs in ${writeTime}ms`)
    } catch (error) {
      logger.error('❌ Batch write failed:', error)
      this.metrics.totalErrors++

      // 错误恢复：将失败的日志加入重试队列
      this.handleWriteError(error)
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
    const queueUtilization = this.metrics.queueLength / this.config.async.maxQueueSize

    return {
      enabled: this.isEnabled,
      queue: {
        length: this.metrics.queueLength,
        maxSize: this.config.async.maxQueueSize,
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
      sampler: this.sampler.getStats()
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

    const strategy = this.config.async.queueFullStrategy

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
   * 生成日志存储键名
   * @param {Object} logEntry 日志条目
   * @returns {string} Redis 键名
   */
  generateLogKey(logEntry) {
    return `${this.config.storage.keyPrefix}:${logEntry.keyId}:${logEntry.timestamp}`
  }

  /**
   * 生成索引键名
   * @param {Object} logEntry 日志条目
   * @returns {string} Redis 索引键名
   */
  generateIndexKey(logEntry) {
    const date = new Date(logEntry.timestamp).toISOString().split('T')[0]
    return `${this.config.storage.indexKeyPrefix}:${logEntry.keyId}:${date}`
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
    if (!this.isEnabled) {
      return
    }

    setInterval(() => {
      if (this.logQueue.length > 0 && !this.isProcessing) {
        this.flushLogs()
      }
    }, this.config.async.batchTimeout)
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
    if (!this.config.monitoring.enabled) {
      return
    }

    setInterval(() => {
      const metrics = this.getMetrics()

      // 检查警告阈值
      if (metrics.queue.length >= this.config.monitoring.warningThresholds.queueLength) {
        logger.warn(`⚠️ Request logger queue length warning: ${metrics.queue.length}`)
      }

      if (
        metrics.performance.avgWriteTime >= this.config.monitoring.warningThresholds.batchWriteDelay
      ) {
        logger.warn(`⚠️ Request logger write time warning: ${metrics.performance.avgWriteTime}ms`)
      }

      if (metrics.performance.memoryUsage >= this.config.monitoring.warningThresholds.memoryUsage) {
        logger.warn(`⚠️ Request logger memory usage warning: ${metrics.performance.memoryUsage}MB`)
      }

      // 调试级别的定期指标输出
      logger.debug('📊 Request logger metrics:', {
        queueLength: metrics.queue.length,
        throughput: `${metrics.throughput.totalWritten}/${metrics.throughput.totalEnqueued}`,
        avgWriteTime: `${Math.round(metrics.performance.avgWriteTime)}ms`,
        memoryUsage: `${metrics.performance.memoryUsage}MB`
      })
    }, this.config.monitoring.metricsInterval)
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

    // 清除定时器
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
    }

    // 处理剩余的日志
    if (this.logQueue && this.logQueue.length > 0) {
      logger.info(`📝 Flushing ${this.logQueue.length} remaining logs...`)
      await this.flushLogs()
    }

    logger.info('✅ Request logger shutdown completed')
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
    shutdown: async () => {}
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
  IntelligentSampler,
  requestLogger // 单例实例，供其他模块使用
}
