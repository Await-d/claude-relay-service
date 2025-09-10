/**
 * @fileoverview 上游仓库兼容性桥接器
 *
 * 提供上游Redis直接调用与本项目DatabaseAdapter之间的兼容性桥接
 * 确保上游代码能够无缝集成到本项目的多数据库架构中
 *
 * @author Claude Code
 * @version 1.0.0
 */

const logger = require('./logger')

/**
 * 上游兼容性桥接器
 *
 * 功能特性：
 * - Redis直接调用适配到DatabaseAdapter
 * - 保持上游代码调用方式不变
 * - 支持批量操作和事务
 * - 提供性能监控和错误处理
 * - 兼容现有多数据库架构
 */
class UpstreamCompatibilityBridge {
  constructor(databaseAdapter) {
    if (!databaseAdapter) {
      throw new Error('DatabaseAdapter is required for UpstreamCompatibilityBridge')
    }

    this.db = databaseAdapter
    this.client = databaseAdapter.getClient()

    // 统计信息
    this.stats = {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      averageResponseTime: 0,
      callsByMethod: {}
    }

    // 性能监控
    this.performanceMetrics = {
      callTimes: [],
      slowQueries: [],
      errorLog: []
    }

    logger.info('🌉 UpstreamCompatibilityBridge initialized successfully')
  }

  // ==================== 基础Redis方法适配 ====================

  /**
   * 获取键值
   * @param {string} key Redis键
   * @returns {Promise<string|null>} 值或null
   */
  async get(key) {
    return await this._executeWithStats('get', async () => await this.client.get(key))
  }

  /**
   * 设置键值
   * @param {string} key Redis键
   * @param {string} value 值
   * @param {string|number} options 选项（如'EX', 过期秒数）
   * @returns {Promise<string>} 操作结果
   */
  async set(key, value, ...options) {
    return await this._executeWithStats('set', async () => {
      if (options.length >= 2 && options[0] === 'EX') {
        // 处理过期时间：SET key value EX seconds
        return await this.client.setex(key, options[1], value)
      } else if (typeof options[0] === 'number') {
        // 处理旧式TTL参数：set(key, value, seconds)
        return await this.client.setex(key, options[0], value)
      }

      // 标准SET操作
      return await this.client.set(key, value, ...options)
    })
  }

  /**
   * 设置键值并指定过期时间
   * @param {string} key Redis键
   * @param {number} seconds 过期秒数
   * @param {string} value 值
   * @returns {Promise<string>} 操作结果
   */
  async setex(key, seconds, value) {
    return await this._executeWithStats(
      'setex',
      async () => await this.client.setex(key, seconds, value)
    )
  }

  /**
   * 删除键
   * @param {...string} keys 要删除的键
   * @returns {Promise<number>} 删除的键数量
   */
  async del(...keys) {
    return await this._executeWithStats('del', async () => await this.client.del(...keys))
  }

  /**
   * 检查键是否存在
   * @param {string} key Redis键
   * @returns {Promise<number>} 存在返回1，不存在返回0
   */
  async exists(key) {
    return await this._executeWithStats('exists', async () => await this.client.exists(key))
  }

  /**
   * 设置键的过期时间
   * @param {string} key Redis键
   * @param {number} seconds 过期秒数
   * @returns {Promise<number>} 成功返回1，失败返回0
   */
  async expire(key, seconds) {
    return await this._executeWithStats(
      'expire',
      async () => await this.client.expire(key, seconds)
    )
  }

  /**
   * 获取键的剩余过期时间
   * @param {string} key Redis键
   * @returns {Promise<number>} 剩余秒数，-1表示无过期时间，-2表示键不存在
   */
  async ttl(key) {
    return await this._executeWithStats('ttl', async () => await this.client.ttl(key))
  }

  /**
   * 搜索键
   * @param {string} pattern 搜索模式
   * @returns {Promise<Array<string>>} 匹配的键数组
   */
  async keys(pattern) {
    return await this._executeWithStats('keys', async () => await this.client.keys(pattern))
  }

  /**
   * 批量获取多个键的值
   * @param {...string} keys 键数组
   * @returns {Promise<Array>} 值数组
   */
  async mget(...keys) {
    return await this._executeWithStats('mget', async () => await this.client.mget(...keys))
  }

  /**
   * 批量设置多个键值对
   * @param {...any} keyValues 键值对参数
   * @returns {Promise<string>} 操作结果
   */
  async mset(...keyValues) {
    return await this._executeWithStats('mset', async () => await this.client.mset(...keyValues))
  }

  // ==================== Hash操作适配 ====================

  /**
   * 设置Hash字段
   * @param {string} key Hash键
   * @param {...any} args 字段和值
   * @returns {Promise<number>} 设置的字段数量
   */
  async hset(key, ...args) {
    return await this._executeWithStats('hset', async () => await this.client.hset(key, ...args))
  }

  /**
   * 获取Hash字段值
   * @param {string} key Hash键
   * @param {string} field 字段名
   * @returns {Promise<string|null>} 字段值
   */
  async hget(key, field) {
    return await this._executeWithStats('hget', async () => await this.client.hget(key, field))
  }

  /**
   * 获取Hash所有字段和值
   * @param {string} key Hash键
   * @returns {Promise<Object>} 字段值对象
   */
  async hgetall(key) {
    return await this._executeWithStats('hgetall', async () => await this.client.hgetall(key))
  }

  /**
   * 删除Hash字段
   * @param {string} key Hash键
   * @param {...string} fields 要删除的字段
   * @returns {Promise<number>} 删除的字段数量
   */
  async hdel(key, ...fields) {
    return await this._executeWithStats('hdel', async () => await this.client.hdel(key, ...fields))
  }

  /**
   * Hash字段递增
   * @param {string} key Hash键
   * @param {string} field 字段名
   * @param {number} increment 递增值，默认1
   * @returns {Promise<number>} 递增后的值
   */
  async hincrby(key, field, increment = 1) {
    return await this._executeWithStats(
      'hincrby',
      async () => await this.client.hincrby(key, field, increment)
    )
  }

  // ==================== API Key管理方法适配 ====================

  /**
   * 保存API Key数据
   * @param {string} keyId API Key ID
   * @param {Object} keyData API Key数据
   * @param {string} hashedKey 哈希后的API Key
   * @returns {Promise<void>}
   */
  async setApiKey(keyId, keyData, hashedKey) {
    return await this._executeWithStats(
      'setApiKey',
      async () => await this.db.setApiKey(keyId, keyData, hashedKey)
    )
  }

  /**
   * 获取API Key数据
   * @param {string} keyId API Key ID
   * @returns {Promise<Object|null>} API Key数据
   */
  async getApiKey(keyId) {
    return await this._executeWithStats('getApiKey', async () => await this.db.getApiKey(keyId))
  }

  /**
   * 根据哈希查找API Key
   * @param {string} hash 哈希值
   * @returns {Promise<Object|null>} API Key数据
   */
  async findApiKeyByHash(hash) {
    return await this._executeWithStats(
      'findApiKeyByHash',
      async () => await this.db.findApiKeyByHash(hash)
    )
  }

  /**
   * 删除API Key
   * @param {string} keyId API Key ID
   * @returns {Promise<void>}
   */
  async deleteApiKey(keyId) {
    return await this._executeWithStats(
      'deleteApiKey',
      async () => await this.db.deleteApiKey(keyId)
    )
  }

  /**
   * 获取所有API Keys
   * @returns {Promise<Array>} API Keys数组
   */
  async getAllApiKeys() {
    return await this._executeWithStats('getAllApiKeys', async () => await this.db.getAllApiKeys())
  }

  // ==================== 使用统计方法适配 ====================

  /**
   * 递增Token使用统计
   * @param {string} keyId API Key ID
   * @param {number} inputTokens 输入Token数
   * @param {number} outputTokens 输出Token数
   * @param {string} model 模型名称
   * @param {string} accountId 账户ID
   * @returns {Promise<void>}
   */
  async incrementTokenUsage(keyId, inputTokens, outputTokens, model, accountId) {
    return await this._executeWithStats(
      'incrementTokenUsage',
      async () =>
        await this.db.incrementTokenUsage(keyId, inputTokens, outputTokens, model, accountId)
    )
  }

  /**
   * 获取成本统计
   * @param {string} keyId API Key ID
   * @param {Object} options 查询选项
   * @returns {Promise<Object>} 成本统计数据
   */
  async getCostStats(keyId, options = {}) {
    return await this._executeWithStats(
      'getCostStats',
      async () => await this.db.getCostStats(keyId, options)
    )
  }

  /**
   * 获取使用统计
   * @param {string} keyId API Key ID
   * @param {Object} options 查询选项
   * @returns {Promise<Object>} 使用统计数据
   */
  async getUsageStats(keyId, options = {}) {
    return await this._executeWithStats(
      'getUsageStats',
      async () => await this.db.getUsageStats(keyId, options)
    )
  }

  /**
   * 递增日成本
   * @param {string} keyId API Key ID
   * @param {number} cost 成本值
   * @returns {Promise<void>}
   */
  async incrementDailyCost(keyId, cost) {
    return await this._executeWithStats(
      'incrementDailyCost',
      async () => await this.db.incrementDailyCost(keyId, cost)
    )
  }

  // ==================== 会话管理方法适配 ====================

  /**
   * 设置会话数据
   * @param {string} token 会话Token
   * @param {Object} sessionData 会话数据
   * @param {number} ttl 过期时间（秒）
   * @returns {Promise<void>}
   */
  async setSession(token, sessionData, ttl) {
    return await this._executeWithStats(
      'setSession',
      async () => await this.db.setSession(token, sessionData, ttl)
    )
  }

  /**
   * 获取会话数据
   * @param {string} token 会话Token
   * @returns {Promise<Object|null>} 会话数据
   */
  async getSession(token) {
    return await this._executeWithStats('getSession', async () => await this.db.getSession(token))
  }

  /**
   * 删除会话
   * @param {string} token 会话Token
   * @returns {Promise<void>}
   */
  async deleteSession(token) {
    return await this._executeWithStats(
      'deleteSession',
      async () => await this.db.deleteSession(token)
    )
  }

  // ==================== 批量操作和事务支持 ====================

  /**
   * 创建管道操作
   * @returns {Object} Pipeline对象
   */
  pipeline() {
    return this.client.pipeline()
  }

  /**
   * 执行管道操作
   * @param {Object} pipeline Pipeline对象
   * @returns {Promise<Array>} 执行结果
   */
  async exec(pipeline) {
    return await this._executeWithStats('pipeline.exec', async () => await pipeline.exec())
  }

  // ==================== 统计和监控方法 ====================

  /**
   * 获取桥接器统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    return {
      totalCalls: this.stats.totalCalls,
      successfulCalls: this.stats.successfulCalls,
      failedCalls: this.stats.failedCalls,
      successRate:
        this.stats.totalCalls > 0
          ? `${((this.stats.successfulCalls / this.stats.totalCalls) * 100).toFixed(2)}%`
          : '0%',
      averageResponseTime: `${this.stats.averageResponseTime.toFixed(2)}ms`,
      callsByMethod: this.stats.callsByMethod,
      slowQueries: this.performanceMetrics.slowQueries.length,
      errors: this.performanceMetrics.errorLog.length
    }
  }

  /**
   * 重置统计信息
   */
  resetStats() {
    this.stats = {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      averageResponseTime: 0,
      callsByMethod: {}
    }

    this.performanceMetrics = {
      callTimes: [],
      slowQueries: [],
      errorLog: []
    }

    logger.info('📊 UpstreamCompatibilityBridge stats reset')
  }

  /**
   * 获取性能报告
   * @returns {Object} 性能报告
   */
  getPerformanceReport() {
    const { callTimes } = this.performanceMetrics

    if (callTimes.length === 0) {
      return { message: 'No performance data available' }
    }

    const sortedTimes = [...callTimes].sort((a, b) => a - b)

    return {
      totalCalls: callTimes.length,
      averageTime: `${(callTimes.reduce((a, b) => a + b, 0) / callTimes.length).toFixed(2)}ms`,
      medianTime: `${sortedTimes[Math.floor(sortedTimes.length / 2)].toFixed(2)}ms`,
      p95Time: `${sortedTimes[Math.floor(sortedTimes.length * 0.95)].toFixed(2)}ms`,
      p99Time: `${sortedTimes[Math.floor(sortedTimes.length * 0.99)].toFixed(2)}ms`,
      slowQueries: this.performanceMetrics.slowQueries.slice(0, 10), // 最慢的10个查询
      recentErrors: this.performanceMetrics.errorLog.slice(-5) // 最近5个错误
    }
  }

  // ==================== 私有辅助方法 ====================

  /**
   * 执行带统计的操作
   * @private
   * @param {string} methodName 方法名
   * @param {Function} operation 要执行的操作
   * @returns {Promise<any>} 操作结果
   */
  async _executeWithStats(methodName, operation) {
    const startTime = Date.now()
    this.stats.totalCalls++

    if (!this.stats.callsByMethod[methodName]) {
      this.stats.callsByMethod[methodName] = 0
    }
    this.stats.callsByMethod[methodName]++

    try {
      const result = await operation()

      const endTime = Date.now()
      const executionTime = endTime - startTime

      // 更新统计信息
      this.stats.successfulCalls++
      this._updatePerformanceMetrics(methodName, executionTime)

      return result
    } catch (error) {
      const endTime = Date.now()
      const executionTime = endTime - startTime

      // 记录错误
      this.stats.failedCalls++
      this.performanceMetrics.errorLog.push({
        method: methodName,
        error: error.message,
        timestamp: new Date().toISOString(),
        executionTime
      })

      logger.error(`❌ UpstreamCompatibilityBridge.${methodName} failed:`, error)

      // 重新抛出错误
      throw error
    }
  }

  /**
   * 更新性能指标
   * @private
   * @param {string} methodName 方法名
   * @param {number} executionTime 执行时间（毫秒）
   */
  _updatePerformanceMetrics(methodName, executionTime) {
    // 记录调用时间
    this.performanceMetrics.callTimes.push(executionTime)

    // 保持最近1000次调用的记录
    if (this.performanceMetrics.callTimes.length > 1000) {
      this.performanceMetrics.callTimes = this.performanceMetrics.callTimes.slice(-1000)
    }

    // 记录慢查询 (>100ms)
    if (executionTime > 100) {
      this.performanceMetrics.slowQueries.push({
        method: methodName,
        executionTime,
        timestamp: new Date().toISOString()
      })

      // 保持最近50个慢查询记录
      if (this.performanceMetrics.slowQueries.length > 50) {
        this.performanceMetrics.slowQueries = this.performanceMetrics.slowQueries.slice(-50)
      }
    }

    // 更新平均响应时间
    const totalTime = this.performanceMetrics.callTimes.reduce((a, b) => a + b, 0)
    this.stats.averageResponseTime = totalTime / this.performanceMetrics.callTimes.length
  }
}

module.exports = UpstreamCompatibilityBridge
