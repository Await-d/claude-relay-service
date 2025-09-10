/**
 * @fileoverview 上游功能适配器基类
 *
 * 提供通用的功能适配器框架，用于将内部业务逻辑适配到上游系统
 * 支持多种适配模式：数据导出、格式转换、API对接等
 *
 * 核心设计原则：
 * - 遵循适配器模式，分离接口和实现
 * - 统一错误处理和日志记录
 * - 灵活的配置和扩展机制
 * - 与现有DatabaseAdapter完全兼容
 *
 * @author Claude Code
 * @version 1.0.0
 */

const logger = require('../utils/logger')
const database = require('../models/database')

/**
 * 上游功能适配器抽象基类
 *
 * 提供通用的适配器框架，各具体适配器需要继承此类并实现相应的方法
 *
 * 架构特性:
 * - 统一的初始化和配置管理
 * - 标准化的错误处理和异常捕获
 * - 内置的性能监控和日志记录
 * - 与现有数据库适配器的无缝集成
 * - 支持异步操作和并发控制
 */
class UpstreamFeatureAdapter {
  /**
   * 构造函数
   * @param {Object} options 适配器配置选项
   * @param {string} options.name 适配器名称
   * @param {string} options.version 适配器版本
   * @param {Object} options.config 适配器配置
   * @param {boolean} options.enableMetrics 是否启用性能监控
   * @param {number} options.timeout 操作超时时间（毫秒）
   */
  constructor(options = {}) {
    const {
      name = 'UnknownAdapter',
      version = '1.0.0',
      config = {},
      enableMetrics = true,
      timeout = 30000
    } = options

    this.name = name
    this.version = version
    this.config = config
    this.enableMetrics = enableMetrics
    this.timeout = timeout
    this.initialized = false

    // 性能监控数据
    this.metrics = {
      operationCount: 0,
      errorCount: 0,
      totalProcessingTime: 0,
      lastOperation: null,
      createdAt: new Date()
    }

    // 数据库适配器实例
    this.database = database

    logger.info(`UpstreamFeatureAdapter initialized: ${this.name} v${this.version}`)
  }

  // ==================== 核心抽象方法 ====================

  /**
   * 初始化适配器
   * 子类需要实现此方法来执行具体的初始化逻辑
   * @returns {Promise<void>}
   */
  async initialize() {
    throw new Error(`initialize method must be implemented by ${this.name}`)
  }

  /**
   * 执行适配操作
   * 核心方法，子类需要实现具体的适配逻辑
   * @param {any} input 输入数据
   * @param {Object} options 操作选项
   * @returns {Promise<any>} 适配后的输出数据
   */
  async adapt(input, options = {}) {
    throw new Error(`adapt method must be implemented by ${this.name}`)
  }

  /**
   * 验证输入数据
   * 子类可以重写此方法来实现特定的数据验证逻辑
   * @param {any} input 输入数据
   * @param {Object} options 验证选项
   * @returns {Promise<boolean>} 验证结果
   */
  async validate(input, options = {}) {
    // 默认实现：基本的非空验证
    return input !== null && input !== undefined
  }

  /**
   * 清理资源
   * 子类可以重写此方法来实现特定的清理逻辑
   * @returns {Promise<void>}
   */
  async cleanup() {
    logger.debug(`Cleaning up adapter: ${this.name}`)
  }

  // ==================== 通用工具方法 ====================

  /**
   * 安全初始化适配器
   * 包含错误处理和状态管理的初始化包装器
   * @returns {Promise<void>}
   * @throws {Error} 初始化失败时抛出错误
   */
  async safeInitialize() {
    if (this.initialized) {
      logger.debug(`Adapter ${this.name} already initialized`)
      return
    }

    const startTime = Date.now()

    try {
      await this.initialize()
      this.initialized = true

      const duration = Date.now() - startTime
      logger.info(`Adapter ${this.name} initialized successfully in ${duration}ms`)

      if (this.enableMetrics) {
        this.updateMetrics('initialize', duration, false)
      }
    } catch (error) {
      const duration = Date.now() - startTime
      logger.error(`Failed to initialize adapter ${this.name}:`, {
        error: error.message,
        stack: error.stack,
        duration
      })

      if (this.enableMetrics) {
        this.updateMetrics('initialize', duration, true)
      }

      throw error
    }
  }

  /**
   * 安全执行适配操作
   * 包含超时控制、错误处理和性能监控的执行包装器
   * @param {any} input 输入数据
   * @param {Object} options 操作选项
   * @returns {Promise<any>} 适配结果
   * @throws {Error} 适配失败时抛出错误
   */
  async safeAdapt(input, options = {}) {
    // 确保适配器已初始化
    if (!this.initialized) {
      await this.safeInitialize()
    }

    const startTime = Date.now()
    const operationId = this.generateOperationId()

    logger.debug(`Starting adapt operation ${operationId} for ${this.name}`, {
      inputType: typeof input,
      optionsKeys: Object.keys(options)
    })

    try {
      // 验证输入数据
      const isValid = await this.validate(input, options)
      if (!isValid) {
        throw new Error(`Invalid input data for adapter ${this.name}`)
      }

      // 设置超时控制
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Operation timeout after ${this.timeout}ms for adapter ${this.name}`))
        }, this.timeout)
      })

      // 执行适配操作
      const adaptPromise = this.adapt(input, options)
      const result = await Promise.race([adaptPromise, timeoutPromise])

      const duration = Date.now() - startTime
      logger.debug(`Adapt operation ${operationId} completed successfully in ${duration}ms`)

      if (this.enableMetrics) {
        this.updateMetrics('adapt', duration, false)
      }

      return result
    } catch (error) {
      const duration = Date.now() - startTime
      logger.error(`Adapt operation ${operationId} failed:`, {
        adapter: this.name,
        error: error.message,
        stack: error.stack,
        duration,
        inputType: typeof input
      })

      if (this.enableMetrics) {
        this.updateMetrics('adapt', duration, true)
      }

      throw error
    }
  }

  /**
   * 批量适配操作
   * 支持并发处理多个输入数据
   * @param {Array} inputs 输入数据数组
   * @param {Object} options 操作选项
   * @param {number} options.concurrency 并发数量，默认为3
   * @param {boolean} options.failFast 是否快速失败，默认为false
   * @returns {Promise<Array>} 适配结果数组
   */
  async batchAdapt(inputs, options = {}) {
    const { concurrency = 3, failFast = false } = options

    if (!Array.isArray(inputs)) {
      throw new Error('Inputs must be an array for batch processing')
    }

    if (inputs.length === 0) {
      return []
    }

    logger.info(
      `Starting batch adapt for ${this.name}: ${inputs.length} items, concurrency: ${concurrency}`
    )

    const results = []
    const errors = []

    // 分块处理
    for (let i = 0; i < inputs.length; i += concurrency) {
      const chunk = inputs.slice(i, i + concurrency)
      const chunkPromises = chunk.map(async (input, index) => {
        try {
          const result = await this.safeAdapt(input, options)
          return { index: i + index, result, error: null }
        } catch (error) {
          const errorResult = { index: i + index, result: null, error }
          if (failFast) {
            throw error
          }
          return errorResult
        }
      })

      try {
        const chunkResults = await Promise.all(chunkPromises)
        chunkResults.forEach((item) => {
          if (item.error) {
            errors.push(item)
          }
          results[item.index] = item.result
        })
      } catch (error) {
        if (failFast) {
          throw error
        }
      }
    }

    if (errors.length > 0) {
      logger.warn(
        `Batch adapt completed with ${errors.length} errors out of ${inputs.length} items`
      )
    }

    return results
  }

  // ==================== 数据库集成方法 ====================

  /**
   * 从数据库获取数据
   * 通用的数据获取方法，支持不同的查询模式
   * @param {string} type 数据类型 ('apikey', 'account', 'usage', 'logs')
   * @param {string|Object} identifier 数据标识符或查询条件
   * @param {Object} options 查询选项
   * @returns {Promise<any>} 查询结果
   */
  async fetchData(type, identifier, options = {}) {
    try {
      logger.debug(`Fetching data: ${type}`, { identifier, options })

      switch (type) {
        case 'apikey':
          if (typeof identifier === 'string') {
            return await this.database.getApiKey(identifier)
          }
          break

        case 'apikeys':
          return await this.database.getAllApiKeys()

        case 'claude-account':
          if (typeof identifier === 'string') {
            return await this.database.getClaudeAccount(identifier)
          }
          break

        case 'claude-accounts':
          return await this.database.getAllClaudeAccounts()

        case 'usage':
          if (typeof identifier === 'string') {
            return await this.database.getUsageStats(identifier)
          }
          break

        case 'logs':
          return await this.database.searchLogs(identifier, options)

        default:
          throw new Error(`Unsupported data type: ${type}`)
      }
    } catch (error) {
      logger.error(`Failed to fetch data: ${type}`, {
        error: error.message,
        identifier,
        adapter: this.name
      })
      throw error
    }
  }

  // ==================== 性能监控方法 ====================

  /**
   * 更新性能监控指标
   * @param {string} operation 操作名称
   * @param {number} duration 执行时长（毫秒）
   * @param {boolean} hasError 是否有错误
   * @private
   */
  updateMetrics(operation, duration, hasError) {
    if (!this.enableMetrics) {
      return
    }

    this.metrics.operationCount++
    this.metrics.totalProcessingTime += duration
    this.metrics.lastOperation = {
      name: operation,
      duration,
      hasError,
      timestamp: new Date()
    }

    if (hasError) {
      this.metrics.errorCount++
    }
  }

  /**
   * 获取性能监控报告
   * @returns {Object} 性能监控数据
   */
  getMetrics() {
    if (!this.enableMetrics) {
      return { enabled: false }
    }

    const uptime = Date.now() - this.metrics.createdAt.getTime()
    const avgProcessingTime =
      this.metrics.operationCount > 0
        ? this.metrics.totalProcessingTime / this.metrics.operationCount
        : 0

    return {
      ...this.metrics,
      uptime,
      avgProcessingTime,
      errorRate:
        this.metrics.operationCount > 0 ? this.metrics.errorCount / this.metrics.operationCount : 0
    }
  }

  /**
   * 重置性能监控数据
   */
  resetMetrics() {
    this.metrics = {
      operationCount: 0,
      errorCount: 0,
      totalProcessingTime: 0,
      lastOperation: null,
      createdAt: new Date()
    }
    logger.info(`Metrics reset for adapter: ${this.name}`)
  }

  // ==================== 工具方法 ====================

  /**
   * 生成操作ID
   * @returns {string} 唯一操作标识符
   * @private
   */
  generateOperationId() {
    return `${this.name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * 格式化错误信息
   * @param {Error} error 错误对象
   * @param {string} operation 操作名称
   * @returns {Object} 格式化的错误信息
   * @private
   */
  formatError(error, operation) {
    return {
      adapter: this.name,
      operation,
      message: error.message,
      stack: error.stack,
      timestamp: new Date(),
      type: error.constructor.name
    }
  }

  /**
   * 获取适配器状态信息
   * @returns {Object} 适配器状态
   */
  getStatus() {
    return {
      name: this.name,
      version: this.version,
      initialized: this.initialized,
      enableMetrics: this.enableMetrics,
      timeout: this.timeout,
      metrics: this.getMetrics()
    }
  }

  /**
   * 配置适配器参数
   * @param {Object} newConfig 新的配置参数
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig }
    logger.info(`Configuration updated for adapter: ${this.name}`, {
      updatedKeys: Object.keys(newConfig)
    })
  }
}

module.exports = UpstreamFeatureAdapter
