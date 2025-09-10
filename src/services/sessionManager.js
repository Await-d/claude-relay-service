/**
 * @fileoverview 会话管理器 - 企业级会话持久化和生命周期管理
 *
 * 核心功能：
 * - 会话状态持久化到Redis/Database
 * - 断线重连和状态恢复机制
 * - 会话生命周期管理和自动清理
 * - 跨请求的上下文保持和亲和性
 * - 会话级别的连接池管理
 *
 * 高级特性：
 * - 智能会话亲和性（Sticky Sessions）
 * - 多层级会话存储策略
 * - 异步状态同步和冲突解决
 * - 会话级别监控和分析
 *
 * @author Claude Code
 * @version 1.0.0
 */

const { v4: uuidv4 } = require('uuid')
const crypto = require('crypto')
const database = require('../models/database')
const logger = require('../utils/logger')
const _config = require('../../config/config')
const LRUCache = require('../utils/lruCache')
const { connectionManager } = require('./connectionManager')

class SessionManager {
  constructor() {
    // 🔧 核心配置
    this.config = {
      // 会话配置
      defaultTTL: 3600, // 1小时默认TTL
      maxTTL: 86400, // 24小时最大TTL
      cleanupInterval: 300000, // 5分钟清理间隔

      // 持久化配置
      persistenceStrategy: 'redis', // redis, database, hybrid
      batchSize: 100, // 批量操作大小
      syncInterval: 60000, // 1分钟同步间隔

      // 缓存配置
      memoryCache: true, // 启用内存缓存
      memoryCacheSize: 10000, // 内存缓存大小
      memoryCacheTTL: 300, // 5分钟内存缓存TTL

      // 亲和性配置
      stickySession: true, // 启用会话亲和性
      affinityTTL: 1800, // 30分钟亲和性TTL
      maxAffinityRetries: 3, // 最大亲和性重试次数

      // 恢复配置
      recoveryTimeout: 30000, // 30秒恢复超时
      maxRecoveryAttempts: 3, // 最大恢复尝试次数
      recoveryBackoff: 5000 // 5秒恢复退避时间
    }

    // 🗄️ 存储层
    this.sessions = new Map() // 活跃会话存储
    this.sessionCache = new LRUCache(this.config.memoryCacheSize) // 内存缓存
    this.persistentSessions = new Map() // 持久化会话映射

    // 🔄 会话管理
    this.sessionAffinity = new Map() // 会话亲和性映射
    this.sessionConnections = new Map() // 会话连接映射
    this.sessionRecovery = new Map() // 会话恢复状态

    // 📊 监控和统计
    this.sessionStats = {
      created: 0,
      restored: 0,
      expired: 0,
      failed: 0,
      cacheHits: 0,
      cacheMisses: 0
    }

    // ⏱️ 定时器管理
    this.cleanupTimer = null
    this.syncTimer = null
    this.metricsTimer = null

    // 🚀 启动会话管理器
    this._initialize()
  }

  /**
   * 🚀 初始化会话管理器
   */
  async _initialize() {
    try {
      logger.info('📝 Initializing Session Manager...')

      // 启动清理任务
      this._startCleanupTasks()

      // 启动同步任务
      this._startSyncTasks()

      // 启动指标收集
      this._startMetricsCollection()

      // 恢复持久化会话
      await this._restorePersistentSessions()

      logger.info('✅ Session Manager initialized successfully')
    } catch (error) {
      logger.error('❌ Failed to initialize Session Manager:', error)
      throw error
    }
  }

  /**
   * 🆕 创建新会话
   * @param {Object} options - 会话选项
   * @returns {Object} 会话对象
   */
  async createSession(options = {}) {
    try {
      const {
        sessionId = uuidv4(),
        userId = null,
        accountId = null,
        apiKeyId = null,
        clientInfo = {},
        ttl = this.config.defaultTTL,
        sticky = this.config.stickySession,
        metadata = {}
      } = options

      const now = Date.now()
      const session = {
        sessionId,
        userId,
        accountId,
        apiKeyId,
        clientInfo,
        metadata,

        // 状态信息
        status: 'active',
        createdAt: now,
        lastActivity: now,
        expiresAt: now + ttl * 1000,

        // 连接信息
        connectionKey: null,
        connectionAgent: null,

        // 统计信息
        requestCount: 0,
        errorCount: 0,
        lastError: null,

        // 亲和性信息
        stickyEnabled: sticky,
        affinityScore: 0,
        lastAffinityUpdate: now
      }

      // 存储到内存
      this.sessions.set(sessionId, session)

      // 缓存到内存缓存
      if (this.config.memoryCache) {
        this.sessionCache.set(sessionId, session, this.config.memoryCacheTTL)
      }

      // 持久化存储
      await this._persistSession(session)

      // 设置连接亲和性
      if (sticky && accountId) {
        await this._setSessionAffinity(sessionId, accountId)
      }

      this.sessionStats.created++
      logger.info(`📝 Created session: ${sessionId} for account: ${accountId}`)

      return session
    } catch (error) {
      logger.error('❌ Failed to create session:', error)
      throw error
    }
  }

  /**
   * 📖 获取会话
   * @param {string} sessionId - 会话ID
   * @param {boolean} refresh - 是否刷新TTL
   * @returns {Object|null} 会话对象
   */
  async getSession(sessionId, refresh = true) {
    try {
      if (!sessionId) {
        return null
      }

      // 尝试从内存获取
      let session = this.sessions.get(sessionId)
      if (session) {
        if (refresh) {
          await this._refreshSession(session)
        }
        this.sessionStats.cacheHits++
        return session
      }

      // 尝试从内存缓存获取
      if (this.config.memoryCache) {
        session = this.sessionCache.get(sessionId)
        if (session) {
          this.sessions.set(sessionId, session)
          if (refresh) {
            await this._refreshSession(session)
          }
          this.sessionStats.cacheHits++
          return session
        }
      }

      // 从持久化存储恢复
      session = await this._restoreSession(sessionId)
      if (session) {
        this.sessions.set(sessionId, session)
        if (this.config.memoryCache) {
          this.sessionCache.set(sessionId, session, this.config.memoryCacheTTL)
        }
        if (refresh) {
          await this._refreshSession(session)
        }
        this.sessionStats.restored++
        return session
      }

      this.sessionStats.cacheMisses++
      return null
    } catch (error) {
      logger.error(`❌ Failed to get session ${sessionId}:`, error)
      return null
    }
  }

  /**
   * 🔄 更新会话
   * @param {string} sessionId - 会话ID
   * @param {Object} updates - 更新数据
   * @returns {Object|null} 更新后的会话对象
   */
  async updateSession(sessionId, updates = {}) {
    try {
      const session = await this.getSession(sessionId, false)
      if (!session) {
        logger.warn(`⚠️ Session not found for update: ${sessionId}`)
        return null
      }

      // 应用更新
      Object.assign(session, updates)
      session.lastActivity = Date.now()

      // 更新内存
      this.sessions.set(sessionId, session)

      // 更新缓存
      if (this.config.memoryCache) {
        this.sessionCache.set(sessionId, session, this.config.memoryCacheTTL)
      }

      // 持久化更新
      await this._persistSession(session)

      logger.debug(`🔄 Updated session: ${sessionId}`)
      return session
    } catch (error) {
      logger.error(`❌ Failed to update session ${sessionId}:`, error)
      throw error
    }
  }

  /**
   * 🗑️ 删除会话
   * @param {string} sessionId - 会话ID
   * @returns {boolean} 是否成功删除
   */
  async deleteSession(sessionId) {
    try {
      if (!sessionId) {
        return false
      }

      // 从内存移除
      const session = this.sessions.get(sessionId)
      this.sessions.delete(sessionId)

      // 从缓存移除
      if (this.config.memoryCache) {
        this.sessionCache.cache.delete(sessionId)
      }

      // 清理亲和性
      if (session) {
        await this._clearSessionAffinity(sessionId, session.accountId)

        // 清理连接
        await this._clearSessionConnection(sessionId)
      }

      // 从持久化存储移除
      await this._removePersistentSession(sessionId)

      logger.info(`🗑️ Deleted session: ${sessionId}`)
      return true
    } catch (error) {
      logger.error(`❌ Failed to delete session ${sessionId}:`, error)
      return false
    }
  }

  /**
   * 🔗 获取会话连接
   * @param {string} sessionId - 会话ID
   * @param {Object} connectionOptions - 连接选项
   * @returns {Agent} 连接代理
   */
  async getSessionConnection(sessionId, connectionOptions = {}) {
    try {
      const session = await this.getSession(sessionId)
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`)
      }

      // 检查是否有现有连接
      if (session.connectionAgent && session.connectionKey) {
        const agent = await connectionManager.getConnectionAgent({
          ...connectionOptions,
          sessionId,
          accountId: session.accountId,
          forceNew: false
        })

        if (agent) {
          await this._updateSessionActivity(sessionId)
          return agent
        }
      }

      // 创建新连接
      const agent = await connectionManager.getConnectionAgent({
        ...connectionOptions,
        sessionId,
        accountId: session.accountId,
        forceNew: false
      })

      // 更新会话连接信息
      await this.updateSession(sessionId, {
        connectionAgent: 'assigned',
        connectionKey: this._generateConnectionKey(connectionOptions)
      })

      return agent
    } catch (error) {
      logger.error(`❌ Failed to get session connection for ${sessionId}:`, error)
      throw error
    }
  }

  /**
   * 🔄 刷新会话TTL
   * @param {Object} session - 会话对象
   */
  async _refreshSession(session) {
    try {
      const now = Date.now()
      session.lastActivity = now

      // 重新计算过期时间
      const remainingTTL = session.expiresAt - now
      if (remainingTTL < this.config.defaultTTL * 1000 * 0.5) {
        session.expiresAt = now + this.config.defaultTTL * 1000
        await this._persistSession(session)
      }
    } catch (error) {
      logger.error('❌ Failed to refresh session:', error)
    }
  }

  /**
   * 💾 持久化会话
   * @param {Object} session - 会话对象
   */
  async _persistSession(session) {
    try {
      const key = `session:${session.sessionId}`
      const ttl = Math.max(1, Math.floor((session.expiresAt - Date.now()) / 1000))

      const sessionData = {
        ...session,
        connectionAgent: null // 不持久化连接对象
      }

      await database.client.setex(key, ttl, JSON.stringify(sessionData))

      // 添加到持久化映射
      this.persistentSessions.set(session.sessionId, {
        key,
        lastPersisted: Date.now()
      })

      logger.debug(`💾 Persisted session: ${session.sessionId}`)
    } catch (error) {
      logger.error(`❌ Failed to persist session ${session.sessionId}:`, error)
    }
  }

  /**
   * 🔄 恢复会话
   * @param {string} sessionId - 会话ID
   * @returns {Object|null} 恢复的会话对象
   */
  async _restoreSession(sessionId) {
    try {
      const key = `session:${sessionId}`
      const data = await database.client.get(key)

      if (!data) {
        return null
      }

      const session = JSON.parse(data)

      // 检查是否过期
      if (session.expiresAt < Date.now()) {
        await this._removePersistentSession(sessionId)
        return null
      }

      logger.debug(`🔄 Restored session: ${sessionId}`)
      return session
    } catch (error) {
      logger.error(`❌ Failed to restore session ${sessionId}:`, error)
      return null
    }
  }

  /**
   * 🗑️ 移除持久化会话
   * @param {string} sessionId - 会话ID
   */
  async _removePersistentSession(sessionId) {
    try {
      const key = `session:${sessionId}`
      await database.client.del(key)
      this.persistentSessions.delete(sessionId)
    } catch (error) {
      logger.error(`❌ Failed to remove persistent session ${sessionId}:`, error)
    }
  }

  /**
   * 🔗 设置会话亲和性
   * @param {string} sessionId - 会话ID
   * @param {string} accountId - 账户ID
   */
  async _setSessionAffinity(sessionId, accountId) {
    try {
      const affinityKey = `session_affinity:${sessionId}`
      const affinityData = {
        accountId,
        sessionId,
        score: 1.0,
        createdAt: Date.now(),
        lastActivity: Date.now()
      }

      // 存储亲和性映射
      this.sessionAffinity.set(sessionId, affinityData)

      // 持久化亲和性
      await database.client.setex(
        affinityKey,
        this.config.affinityTTL,
        JSON.stringify(affinityData)
      )

      // 反向映射（账户到会话）
      const accountAffinityKey = `account_affinity:${accountId}`
      await database.client.sadd(accountAffinityKey, sessionId)
      await database.client.expire(accountAffinityKey, this.config.affinityTTL)

      logger.debug(`🔗 Set session affinity: ${sessionId} -> ${accountId}`)
    } catch (error) {
      logger.error(`❌ Failed to set session affinity for ${sessionId}:`, error)
    }
  }

  /**
   * 🧹 清理会话亲和性
   * @param {string} sessionId - 会话ID
   * @param {string} accountId - 账户ID
   */
  async _clearSessionAffinity(sessionId, accountId) {
    try {
      // 清理内存亲和性
      this.sessionAffinity.delete(sessionId)

      // 清理持久化亲和性
      const affinityKey = `session_affinity:${sessionId}`
      await database.client.del(affinityKey)

      // 清理反向映射
      if (accountId) {
        const accountAffinityKey = `account_affinity:${accountId}`
        await database.client.srem(accountAffinityKey, sessionId)
      }

      logger.debug(`🧹 Cleared session affinity: ${sessionId}`)
    } catch (error) {
      logger.error(`❌ Failed to clear session affinity for ${sessionId}:`, error)
    }
  }

  /**
   * 🔗 清理会话连接
   * @param {string} sessionId - 会话ID
   */
  async _clearSessionConnection(sessionId) {
    try {
      // 清理连接映射
      this.sessionConnections.delete(sessionId)

      // 清理持久化连接信息
      const connectionKey = `session_connection:${sessionId}`
      await database.client.del(connectionKey)

      logger.debug(`🔗 Cleared session connection: ${sessionId}`)
    } catch (error) {
      logger.error(`❌ Failed to clear session connection for ${sessionId}:`, error)
    }
  }

  /**
   * 📊 更新会话活动
   * @param {string} sessionId - 会话ID
   * @param {Object} activity - 活动数据
   */
  async _updateSessionActivity(sessionId, activity = {}) {
    try {
      const session = this.sessions.get(sessionId)
      if (!session) {
        return
      }

      session.lastActivity = Date.now()
      session.requestCount = (session.requestCount || 0) + 1

      if (activity.error) {
        session.errorCount = (session.errorCount || 0) + 1
        session.lastError = activity.error
      }

      // 更新亲和性分数
      if (this.sessionAffinity.has(sessionId)) {
        const affinity = this.sessionAffinity.get(sessionId)
        affinity.lastActivity = Date.now()
        affinity.score = Math.min(10.0, affinity.score + 0.1)
      }

      logger.debug(`📊 Updated session activity: ${sessionId}`)
    } catch (error) {
      logger.error(`❌ Failed to update session activity for ${sessionId}:`, error)
    }
  }

  /**
   * 🔑 生成连接键
   * @param {Object} options - 连接选项
   * @returns {string} 连接键
   */
  _generateConnectionKey(options) {
    const { target = 'api.anthropic.com', proxy = null } = options
    return crypto
      .createHash('md5')
      .update(`${target}:${JSON.stringify(proxy || {})}`)
      .digest('hex')
  }

  /**
   * 🧹 启动清理任务
   */
  _startCleanupTasks() {
    this.cleanupTimer = setInterval(async () => {
      try {
        await this._performCleanup()
      } catch (error) {
        logger.error('❌ Session cleanup failed:', error)
      }
    }, this.config.cleanupInterval)

    logger.info('🧹 Session cleanup tasks started')
  }

  /**
   * 🧹 执行清理操作
   */
  async _performCleanup() {
    const now = Date.now()
    const expiredSessions = []

    // 查找过期会话
    for (const [sessionId, session] of this.sessions) {
      if (session.expiresAt < now) {
        expiredSessions.push(sessionId)
      }
    }

    // 清理过期会话
    for (const sessionId of expiredSessions) {
      await this.deleteSession(sessionId)
      this.sessionStats.expired++
    }

    // 清理内存缓存
    this.sessionCache.cleanup()

    logger.debug(`🧹 Session cleanup completed: ${expiredSessions.length} sessions expired`)
  }

  /**
   * 🔄 启动同步任务
   */
  _startSyncTasks() {
    this.syncTimer = setInterval(async () => {
      try {
        await this._performSync()
      } catch (error) {
        logger.error('❌ Session sync failed:', error)
      }
    }, this.config.syncInterval)

    logger.info('🔄 Session sync tasks started')
  }

  /**
   * 🔄 执行同步操作
   */
  async _performSync() {
    const syncBatch = []

    for (const [sessionId, session] of this.sessions) {
      // 检查是否需要同步
      const persistent = this.persistentSessions.get(sessionId)
      if (!persistent || Date.now() - persistent.lastPersisted > this.config.syncInterval) {
        syncBatch.push(session)

        if (syncBatch.length >= this.config.batchSize) {
          break
        }
      }
    }

    // 批量同步
    const syncPromises = syncBatch.map((session) => this._persistSession(session))
    await Promise.allSettled(syncPromises)

    logger.debug(`🔄 Session sync completed: ${syncBatch.length} sessions synced`)
  }

  /**
   * 📊 启动指标收集
   */
  _startMetricsCollection() {
    this.metricsTimer = setInterval(async () => {
      try {
        await this._collectMetrics()
      } catch (error) {
        logger.error('❌ Session metrics collection failed:', error)
      }
    }, 60000) // 1分钟

    logger.info('📊 Session metrics collection started')
  }

  /**
   * 📊 收集指标数据
   */
  async _collectMetrics() {
    const metrics = {
      timestamp: Date.now(),
      activeSessions: this.sessions.size,
      persistentSessions: this.persistentSessions.size,
      affinitySessions: this.sessionAffinity.size,
      cacheSize: this.sessionCache.cache.size,
      cacheStats: this.sessionCache.getStats(),
      sessionStats: { ...this.sessionStats }
    }

    // 存储指标到Redis
    const key = `session_metrics:${new Date().toISOString().substring(0, 13)}`
    await database.client.setex(key, 3600, JSON.stringify(metrics))

    logger.debug('📊 Session metrics collected:', metrics)
  }

  /**
   * 🔄 恢复持久化会话
   */
  async _restorePersistentSessions() {
    try {
      const pattern = 'session:*'
      const keys = await database.client.keys(pattern)

      let restored = 0
      for (const key of keys) {
        try {
          const sessionId = key.replace('session:', '')
          const session = await this._restoreSession(sessionId)

          if (session) {
            this.sessions.set(sessionId, session)
            restored++
          }
        } catch (error) {
          logger.error(`❌ Failed to restore session from key ${key}:`, error)
        }
      }

      logger.info(`🔄 Restored ${restored} persistent sessions`)
    } catch (error) {
      logger.error('❌ Failed to restore persistent sessions:', error)
    }
  }

  /**
   * 📊 获取会话统计
   * @returns {Object} 统计数据
   */
  getSessionStats() {
    return {
      activeSessions: this.sessions.size,
      persistentSessions: this.persistentSessions.size,
      affinitySessions: this.sessionAffinity.size,
      cacheSize: this.sessionCache.cache.size,
      cacheStats: this.sessionCache.getStats(),
      sessionStats: { ...this.sessionStats }
    }
  }

  /**
   * 🔍 查找会话
   * @param {Object} criteria - 查找条件
   * @returns {Array} 匹配的会话列表
   */
  findSessions(criteria = {}) {
    const { userId, accountId, apiKeyId, status } = criteria
    const results = []

    for (const session of this.sessions.values()) {
      let match = true

      if (userId && session.userId !== userId) {
        match = false
      }
      if (accountId && session.accountId !== accountId) {
        match = false
      }
      if (apiKeyId && session.apiKeyId !== apiKeyId) {
        match = false
      }
      if (status && session.status !== status) {
        match = false
      }

      if (match) {
        results.push(session)
      }
    }

    return results
  }

  /**
   * 🛑 关闭会话管理器
   */
  async shutdown() {
    try {
      logger.info('🛑 Shutting down Session Manager...')

      // 停止定时器
      if (this.cleanupTimer) {
        clearInterval(this.cleanupTimer)
      }
      if (this.syncTimer) {
        clearInterval(this.syncTimer)
      }
      if (this.metricsTimer) {
        clearInterval(this.metricsTimer)
      }

      // 保存所有活跃会话
      const savePromises = Array.from(this.sessions.values()).map((session) =>
        this._persistSession(session)
      )
      await Promise.allSettled(savePromises)

      // 清理状态
      this.sessions.clear()
      this.sessionCache.clear()
      this.persistentSessions.clear()
      this.sessionAffinity.clear()
      this.sessionConnections.clear()
      this.sessionRecovery.clear()

      logger.info('✅ Session Manager shutdown completed')
    } catch (error) {
      logger.error('❌ Session Manager shutdown failed:', error)
    }
  }
}

// 单例模式
const sessionManager = new SessionManager()

module.exports = {
  sessionManager,
  SessionManager
}
