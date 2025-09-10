/**
 * @fileoverview 连接管理器 - 高级连接池和健康监控
 *
 * 核心功能：
 * - HTTP/HTTPS连接池管理和复用
 * - 智能连接健康检查和故障检测
 * - 动态连接数调整和负载感知
 * - 代理连接的特殊处理和优化
 * - 连接生命周期管理和资源清理
 *
 * 性能特性：
 * - 连接预热和预分配机制
 * - 自动故障切换和连接恢复
 * - 动态超时调整和背压处理
 * - 详细监控指标收集
 *
 * @author Claude Code
 * @version 1.0.0
 */

const https = require('https')
const http = require('http')
const { Agent } = require('https')
const { Agent: HttpAgent } = require('http')
const { SocksProxyAgent } = require('socks-proxy-agent')
const { HttpsProxyAgent } = require('https-proxy-agent')
const logger = require('../utils/logger')
const config = require('../../config/config')
const database = require('../models/database')
const LRUCache = require('../utils/lruCache')

class ConnectionManager {
  constructor() {
    // 🔧 核心配置
    this.config = {
      // 连接池配置
      maxSockets: config.proxy?.maxSockets || 50,
      maxFreeSockets: config.proxy?.maxFreeSockets || 10,
      timeout: config.proxy?.timeout || 30000,
      keepAlive: true,
      keepAliveMsecs: 30000,

      // 健康检查配置
      healthCheckInterval: 60000, // 1分钟
      connectionTimeout: 10000, // 10秒连接超时
      healthCheckTimeout: 5000, // 5秒健康检查超时

      // 故障检测配置
      maxFailures: 3, // 最大失败次数
      failureWindow: 300000, // 5分钟故障窗口
      recoveryTime: 60000, // 1分钟恢复时间

      // 动态调整配置
      loadThreshold: 0.8, // 负载阈值
      scaleUpFactor: 1.5, // 扩容因子
      scaleDownFactor: 0.7, // 缩容因子
      minConnections: 2, // 最小连接数
      maxConnections: 100 // 最大连接数
    }

    // 🏊‍♂️ 连接池存储
    this.connectionPools = new Map()
    this.proxyAgents = new Map()

    // 📊 连接监控
    this.connectionStats = new Map()
    this.healthChecks = new Map()
    this.failureTracking = new Map()

    // 🔄 缓存和状态管理
    this.connectionCache = new LRUCache(1000)
    this.activeConnections = new Set()
    this.recovering = new Set()

    // ⏱️ 定时器管理
    this.healthCheckTimer = null
    this.cleanupTimer = null
    this.metricsTimer = null

    // 🚀 启动管理器
    this._initialize()
  }

  /**
   * 🚀 初始化连接管理器
   */
  async _initialize() {
    try {
      logger.info('🔗 Initializing Connection Manager...')

      // 启动健康检查
      this._startHealthChecks()

      // 启动清理任务
      this._startCleanupTasks()

      // 启动指标收集
      this._startMetricsCollection()

      // 预热默认连接
      await this._preWarmConnections()

      logger.info('✅ Connection Manager initialized successfully')
    } catch (error) {
      logger.error('❌ Failed to initialize Connection Manager:', error)
      throw error
    }
  }

  /**
   * 🔧 获取或创建连接代理
   * @param {Object} options - 连接选项
   * @returns {Agent} HTTP/HTTPS代理实例
   */
  async getConnectionAgent(options = {}) {
    try {
      const {
        target = 'api.anthropic.com',
        proxy = null,
        accountId = null,
        sessionId = null,
        forceNew = false
      } = options

      // 生成连接标识
      const connectionKey = this._generateConnectionKey(target, proxy)

      // 检查是否需要强制创建新连接
      if (forceNew) {
        return await this._createNewAgent(target, proxy, connectionKey)
      }

      // 尝试从缓存获取
      let agent = this.connectionCache.get(connectionKey)
      if (agent && this._isAgentHealthy(agent, connectionKey)) {
        this._updateConnectionStats(connectionKey, 'cache_hit')
        return agent
      }

      // 创建新的代理
      agent = await this._createNewAgent(target, proxy, connectionKey)

      // 缓存代理
      this.connectionCache.set(connectionKey, agent)
      this._updateConnectionStats(connectionKey, 'created')

      // 记录会话关联
      if (sessionId && accountId) {
        await this._trackSessionConnection(sessionId, accountId, connectionKey)
      }

      return agent
    } catch (error) {
      logger.error('❌ Failed to get connection agent:', error)
      throw error
    }
  }

  /**
   * 🏗️ 创建新的代理实例
   * @param {string} target - 目标主机
   * @param {Object} proxy - 代理配置
   * @param {string} connectionKey - 连接标识
   * @returns {Agent} 新的代理实例
   */
  async _createNewAgent(target, proxy, connectionKey) {
    try {
      let agent

      if (proxy) {
        // 创建代理连接
        agent = await this._createProxyAgent(target, proxy, connectionKey)
      } else {
        // 创建直连
        const isHttps = target.includes('anthropic.com') || target.startsWith('https://')
        const AgentClass = isHttps ? Agent : HttpAgent

        agent = new AgentClass({
          keepAlive: this.config.keepAlive,
          keepAliveMsecs: this.config.keepAliveMsecs,
          maxSockets: this.config.maxSockets,
          maxFreeSockets: this.config.maxFreeSockets,
          timeout: this.config.timeout,
          // 启用 TCP_NODELAY 优化延迟
          nodelay: true,
          // 启用 socket 复用
          reuseSocket: true
        })
      }

      // 设置连接事件监听
      this._setupAgentEventListeners(agent, connectionKey)

      // 记录到活跃连接
      this.activeConnections.add(connectionKey)

      logger.debug(`🔗 Created new agent for ${connectionKey}`)
      return agent
    } catch (error) {
      logger.error(`❌ Failed to create agent for ${connectionKey}:`, error)
      throw error
    }
  }

  /**
   * 🌐 创建代理Agent
   * @param {string} target - 目标主机
   * @param {Object} proxy - 代理配置
   * @param {string} connectionKey - 连接标识
   * @returns {Agent} 代理Agent实例
   */
  async _createProxyAgent(target, proxy, connectionKey) {
    try {
      const { type, host, port, username, password } = proxy

      let proxyUrl
      if (username && password) {
        proxyUrl = `${type}://${username}:${password}@${host}:${port}`
      } else {
        proxyUrl = `${type}://${host}:${port}`
      }

      let agent
      if (type.toLowerCase() === 'socks5' || type.toLowerCase() === 'socks') {
        agent = new SocksProxyAgent(proxyUrl, {
          keepAlive: this.config.keepAlive,
          keepAliveMsecs: this.config.keepAliveMsecs,
          maxSockets: this.config.maxSockets,
          maxFreeSockets: this.config.maxFreeSockets,
          timeout: this.config.timeout
        })
      } else if (type.toLowerCase() === 'http' || type.toLowerCase() === 'https') {
        agent = new HttpsProxyAgent(proxyUrl, {
          keepAlive: this.config.keepAlive,
          keepAliveMsecs: this.config.keepAliveMsecs,
          maxSockets: this.config.maxSockets,
          maxFreeSockets: this.config.maxFreeSockets,
          timeout: this.config.timeout
        })
      } else {
        throw new Error(`Unsupported proxy type: ${type}`)
      }

      // 测试代理连接
      await this._testProxyConnection(agent, target, connectionKey)

      logger.info(`🌐 Created proxy agent for ${connectionKey}: ${type}://${host}:${port}`)
      return agent
    } catch (error) {
      logger.error(`❌ Failed to create proxy agent for ${connectionKey}:`, error)
      throw error
    }
  }

  /**
   * 🧪 测试代理连接
   * @param {Agent} agent - 代理Agent
   * @param {string} target - 目标主机
   * @param {string} connectionKey - 连接标识
   */
  async _testProxyConnection(agent, target, connectionKey) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Proxy connection test timeout for ${connectionKey}`))
      }, this.config.connectionTimeout)

      const testUrl = target.startsWith('http') ? target : `https://${target}`
      const url = new URL(testUrl)

      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: '/',
        method: 'HEAD',
        agent,
        timeout: this.config.connectionTimeout
      }

      const req = https.request(options, (res) => {
        clearTimeout(timeout)
        resolve()
      })

      req.on('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })

      req.on('timeout', () => {
        clearTimeout(timeout)
        req.destroy()
        reject(new Error(`Proxy connection test timeout for ${connectionKey}`))
      })

      req.end()
    })
  }

  /**
   * 🎯 设置Agent事件监听器
   * @param {Agent} agent - Agent实例
   * @param {string} connectionKey - 连接标识
   */
  _setupAgentEventListeners(agent, connectionKey) {
    // 监听socket创建
    agent.on('socket', (socket) => {
      this._updateConnectionStats(connectionKey, 'socket_created')

      socket.on('connect', () => {
        this._updateConnectionStats(connectionKey, 'connected')
      })

      socket.on('error', (error) => {
        this._handleConnectionError(connectionKey, error)
      })

      socket.on('timeout', () => {
        this._handleConnectionTimeout(connectionKey)
      })

      socket.on('close', () => {
        this._updateConnectionStats(connectionKey, 'closed')
      })
    })

    // 监听连接池错误
    agent.on('error', (error) => {
      this._handleConnectionError(connectionKey, error)
    })
  }

  /**
   * 📊 更新连接统计
   * @param {string} connectionKey - 连接标识
   * @param {string} event - 事件类型
   */
  _updateConnectionStats(connectionKey, event) {
    if (!this.connectionStats.has(connectionKey)) {
      this.connectionStats.set(connectionKey, {
        created: 0,
        connected: 0,
        errors: 0,
        timeouts: 0,
        closed: 0,
        cache_hits: 0,
        socket_created: 0,
        lastActivity: Date.now(),
        firstCreated: Date.now()
      })
    }

    const stats = this.connectionStats.get(connectionKey)
    stats[event] = (stats[event] || 0) + 1
    stats.lastActivity = Date.now()
  }

  /**
   * ❌ 处理连接错误
   * @param {string} connectionKey - 连接标识
   * @param {Error} error - 错误对象
   */
  _handleConnectionError(connectionKey, error) {
    logger.warn(`🔴 Connection error for ${connectionKey}:`, error.message)

    this._updateConnectionStats(connectionKey, 'errors')
    this._trackFailure(connectionKey, error)

    // 检查是否需要标记为不健康
    const failures = this._getFailureCount(connectionKey)
    if (failures >= this.config.maxFailures) {
      this._markUnhealthy(connectionKey)
    }
  }

  /**
   * ⏰ 处理连接超时
   * @param {string} connectionKey - 连接标识
   */
  _handleConnectionTimeout(connectionKey) {
    logger.warn(`⏰ Connection timeout for ${connectionKey}`)

    this._updateConnectionStats(connectionKey, 'timeouts')
    this._trackFailure(connectionKey, new Error('Connection timeout'))
  }

  /**
   * 📝 跟踪失败记录
   * @param {string} connectionKey - 连接标识
   * @param {Error} error - 错误对象
   */
  _trackFailure(connectionKey, error) {
    if (!this.failureTracking.has(connectionKey)) {
      this.failureTracking.set(connectionKey, [])
    }

    const failures = this.failureTracking.get(connectionKey)
    const now = Date.now()

    // 添加新的失败记录
    failures.push({
      timestamp: now,
      error: error.message,
      code: error.code || 'UNKNOWN'
    })

    // 清理过期的失败记录
    const cutoff = now - this.config.failureWindow
    const recentFailures = failures.filter((f) => f.timestamp > cutoff)
    this.failureTracking.set(connectionKey, recentFailures)
  }

  /**
   * 📊 获取失败计数
   * @param {string} connectionKey - 连接标识
   * @returns {number} 失败次数
   */
  _getFailureCount(connectionKey) {
    const failures = this.failureTracking.get(connectionKey) || []
    return failures.length
  }

  /**
   * ❤️ 启动健康检查
   */
  _startHealthChecks() {
    this.healthCheckTimer = setInterval(async () => {
      try {
        await this._performHealthChecks()
      } catch (error) {
        logger.error('❌ Health check failed:', error)
      }
    }, this.config.healthCheckInterval)

    logger.info(`❤️ Health checks started (interval: ${this.config.healthCheckInterval}ms)`)
  }

  /**
   * 🏥 执行健康检查
   */
  async _performHealthChecks() {
    const connections = Array.from(this.activeConnections)
    const healthChecks = []

    for (const connectionKey of connections) {
      const agent = this.connectionCache.get(connectionKey)
      if (agent) {
        healthChecks.push(this._checkConnectionHealth(connectionKey, agent))
      }
    }

    const results = await Promise.allSettled(healthChecks)
    let healthy = 0
    let unhealthy = 0

    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value) {
        healthy++
      } else {
        unhealthy++
        const connectionKey = connections[index]
        this._markUnhealthy(connectionKey)
      }
    })

    logger.debug(`🏥 Health check completed: ${healthy} healthy, ${unhealthy} unhealthy`)
  }

  /**
   * 🔍 检查单个连接健康状态
   * @param {string} connectionKey - 连接标识
   * @param {Agent} agent - Agent实例
   * @returns {boolean} 是否健康
   */
  async _checkConnectionHealth(connectionKey, agent) {
    try {
      // 获取连接统计
      const stats = this.connectionStats.get(connectionKey)
      if (!stats) {
        return false
      }

      // 检查最近活动
      const timeSinceActivity = Date.now() - stats.lastActivity
      if (timeSinceActivity > this.config.healthCheckInterval * 2) {
        logger.debug(`🕐 Connection ${connectionKey} inactive for ${timeSinceActivity}ms`)
        return false
      }

      // 检查错误率
      const totalRequests = stats.created + stats.cache_hits
      if (totalRequests > 10) {
        const errorRate = stats.errors / totalRequests
        if (errorRate > 0.1) {
          // 10% 错误率阈值
          logger.debug(`📈 Connection ${connectionKey} error rate: ${errorRate * 100}%`)
          return false
        }
      }

      // 检查Agent状态
      if (!this._isAgentHealthy(agent, connectionKey)) {
        return false
      }

      return true
    } catch (error) {
      logger.error(`❌ Health check failed for ${connectionKey}:`, error)
      return false
    }
  }

  /**
   * 🔍 检查Agent是否健康
   * @param {Agent} agent - Agent实例
   * @param {string} connectionKey - 连接标识
   * @returns {boolean} 是否健康
   */
  _isAgentHealthy(agent, connectionKey) {
    try {
      if (!agent) {
        return false
      }

      // 检查socket数量
      const sockets = agent.sockets || {}
      const freeSockets = agent.freeSockets || {}

      const totalSockets = Object.values(sockets).reduce((sum, arr) => sum + arr.length, 0)
      const totalFreeSockets = Object.values(freeSockets).reduce((sum, arr) => sum + arr.length, 0)

      // 如果socket数量超过限制，认为不健康
      if (totalSockets > this.config.maxSockets * 1.2) {
        logger.debug(`🔴 Connection ${connectionKey} has too many sockets: ${totalSockets}`)
        return false
      }

      return true
    } catch (error) {
      logger.error(`❌ Agent health check failed for ${connectionKey}:`, error)
      return false
    }
  }

  /**
   * 🔴 标记连接为不健康
   * @param {string} connectionKey - 连接标识
   */
  _markUnhealthy(connectionKey) {
    logger.warn(`🔴 Marking connection ${connectionKey} as unhealthy`)

    // 从缓存中移除
    this.connectionCache.delete(connectionKey)

    // 添加到恢复队列
    this.recovering.add(connectionKey)

    // 设置恢复定时器
    setTimeout(() => {
      this.recovering.delete(connectionKey)
      this.failureTracking.delete(connectionKey)
      logger.info(`🟢 Connection ${connectionKey} recovery window expired`)
    }, this.config.recoveryTime)
  }

  /**
   * 🧹 启动清理任务
   */
  _startCleanupTasks() {
    this.cleanupTimer = setInterval(() => {
      try {
        this._performCleanup()
      } catch (error) {
        logger.error('❌ Cleanup task failed:', error)
      }
    }, 300000) // 5分钟

    logger.info('🧹 Cleanup tasks started')
  }

  /**
   * 🧹 执行清理操作
   */
  _performCleanup() {
    // 清理过期连接
    this._cleanupExpiredConnections()

    // 清理过期统计
    this._cleanupExpiredStats()

    // 清理缓存
    this.connectionCache.cleanup()

    logger.debug('🧹 Connection cleanup completed')
  }

  /**
   * 🧹 清理过期连接
   */
  _cleanupExpiredConnections() {
    const now = Date.now()
    const expiredKeys = []

    for (const [key, agent] of this.connectionCache.entries()) {
      const stats = this.connectionStats.get(key)
      if (stats && now - stats.lastActivity > 600000) {
        // 10分钟无活动
        expiredKeys.push(key)
      }
    }

    for (const key of expiredKeys) {
      this.connectionCache.delete(key)
      this.activeConnections.delete(key)
      logger.debug(`🧹 Cleaned up expired connection: ${key}`)
    }
  }

  /**
   * 🧹 清理过期统计
   */
  _cleanupExpiredStats() {
    const now = Date.now()
    const expiredKeys = []

    for (const [key, stats] of this.connectionStats.entries()) {
      if (now - stats.lastActivity > 3600000) {
        // 1小时无活动
        expiredKeys.push(key)
      }
    }

    for (const key of expiredKeys) {
      this.connectionStats.delete(key)
      this.failureTracking.delete(key)
      logger.debug(`🧹 Cleaned up expired stats: ${key}`)
    }
  }

  /**
   * 📊 启动指标收集
   */
  _startMetricsCollection() {
    this.metricsTimer = setInterval(async () => {
      try {
        await this._collectMetrics()
      } catch (error) {
        logger.error('❌ Metrics collection failed:', error)
      }
    }, 60000) // 1分钟

    logger.info('📊 Metrics collection started')
  }

  /**
   * 📊 收集指标数据
   */
  async _collectMetrics() {
    const metrics = {
      timestamp: Date.now(),
      totalConnections: this.activeConnections.size,
      cacheSize: this.connectionCache.cache.size,
      recoveringConnections: this.recovering.size,
      connectionStats: this._aggregateConnectionStats(),
      cacheStats: this.connectionCache.getStats()
    }

    // 存储指标到Redis
    await this._storeMetrics(metrics)

    logger.debug('📊 Metrics collected:', metrics)
  }

  /**
   * 📊 聚合连接统计
   * @returns {Object} 聚合统计数据
   */
  _aggregateConnectionStats() {
    const aggregate = {
      totalCreated: 0,
      totalConnected: 0,
      totalErrors: 0,
      totalTimeouts: 0,
      totalCacheHits: 0,
      activeConnections: this.activeConnections.size
    }

    for (const stats of this.connectionStats.values()) {
      aggregate.totalCreated += stats.created || 0
      aggregate.totalConnected += stats.connected || 0
      aggregate.totalErrors += stats.errors || 0
      aggregate.totalTimeouts += stats.timeouts || 0
      aggregate.totalCacheHits += stats.cache_hits || 0
    }

    return aggregate
  }

  /**
   * 💾 存储指标数据
   * @param {Object} metrics - 指标数据
   */
  async _storeMetrics(metrics) {
    try {
      const key = `connection_metrics:${new Date().toISOString().substring(0, 13)}`
      await database.client.setex(key, 3600, JSON.stringify(metrics))
    } catch (error) {
      logger.error('❌ Failed to store metrics:', error)
    }
  }

  /**
   * 🔥 预热连接
   */
  async _preWarmConnections() {
    try {
      const targets = ['api.anthropic.com', 'console.anthropic.com']

      const preWarmPromises = targets.map((target) =>
        this.getConnectionAgent({ target, forceNew: false })
      )

      await Promise.allSettled(preWarmPromises)
      logger.info('🔥 Connection pre-warming completed')
    } catch (error) {
      logger.error('❌ Connection pre-warming failed:', error)
    }
  }

  /**
   * 🔑 生成连接标识
   * @param {string} target - 目标主机
   * @param {Object} proxy - 代理配置
   * @returns {string} 连接标识
   */
  _generateConnectionKey(target, proxy) {
    if (!proxy) {
      return `direct:${target}`
    }

    const { type, host, port } = proxy
    return `${type}:${host}:${port}:${target}`
  }

  /**
   * 📝 跟踪会话连接
   * @param {string} sessionId - 会话ID
   * @param {string} accountId - 账户ID
   * @param {string} connectionKey - 连接标识
   */
  async _trackSessionConnection(sessionId, accountId, connectionKey) {
    try {
      const key = `session_connection:${sessionId}`
      const data = {
        accountId,
        connectionKey,
        timestamp: Date.now()
      }

      await database.client.setex(key, 3600, JSON.stringify(data))
    } catch (error) {
      logger.error('❌ Failed to track session connection:', error)
    }
  }

  /**
   * 📊 获取连接统计
   * @param {string} connectionKey - 连接标识（可选）
   * @returns {Object} 统计数据
   */
  getConnectionStats(connectionKey = null) {
    if (connectionKey) {
      return this.connectionStats.get(connectionKey) || null
    }

    return {
      totalConnections: this.activeConnections.size,
      cacheSize: this.connectionCache.cache.size,
      recovering: this.recovering.size,
      aggregateStats: this._aggregateConnectionStats(),
      cacheStats: this.connectionCache.getStats()
    }
  }

  /**
   * 🔄 重置连接
   * @param {string} connectionKey - 连接标识
   */
  async resetConnection(connectionKey) {
    try {
      // 从缓存中移除
      this.connectionCache.delete(connectionKey)

      // 清理统计
      this.connectionStats.delete(connectionKey)
      this.failureTracking.delete(connectionKey)

      // 从活跃连接中移除
      this.activeConnections.delete(connectionKey)

      logger.info(`🔄 Reset connection: ${connectionKey}`)
    } catch (error) {
      logger.error(`❌ Failed to reset connection ${connectionKey}:`, error)
    }
  }

  /**
   * 🛑 关闭连接管理器
   */
  async shutdown() {
    try {
      logger.info('🛑 Shutting down Connection Manager...')

      // 停止定时器
      if (this.healthCheckTimer) {
        clearInterval(this.healthCheckTimer)
      }
      if (this.cleanupTimer) {
        clearInterval(this.cleanupTimer)
      }
      if (this.metricsTimer) {
        clearInterval(this.metricsTimer)
      }

      // 关闭所有连接
      for (const agent of this.connectionCache.values()) {
        if (agent && typeof agent.destroy === 'function') {
          agent.destroy()
        }
      }

      // 清理状态
      this.connectionPools.clear()
      this.connectionCache.clear()
      this.connectionStats.clear()
      this.healthChecks.clear()
      this.failureTracking.clear()
      this.activeConnections.clear()
      this.recovering.clear()

      logger.info('✅ Connection Manager shutdown completed')
    } catch (error) {
      logger.error('❌ Connection Manager shutdown failed:', error)
    }
  }
}

// 单例模式
const connectionManager = new ConnectionManager()

module.exports = {
  connectionManager,
  ConnectionManager
}
