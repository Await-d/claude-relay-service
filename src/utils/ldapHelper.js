/**
 * @fileoverview LDAP Helper Utilities for Enterprise Authentication
 *
 * 提供LDAP连接管理、认证、用户同步和组管理功能
 * 支持连接池、代理集成、错误处理和性能优化
 *
 * @author Claude Code
 * @version 1.0.0
 */

const ldap = require('ldapjs')
const crypto = require('crypto')
const ProxyHelper = require('./proxyHelper')
const logger = require('./logger')
const LRUCache = require('./lruCache')

/**
 * LDAP助手类 - 企业目录服务集成
 * 提供连接管理、认证、用户同步等功能
 */
class LDAPHelper {
  constructor() {
    // ==================== 配置参数 ====================

    // LDAP 默认配置
    this.DEFAULT_CONFIG = {
      url: 'ldap://localhost:389',
      timeout: 30000, // 30秒连接超时
      connectTimeout: 10000, // 10秒连接建立超时
      idleTimeout: 300000, // 5分钟空闲超时
      reconnect: true, // 自动重连
      maxRetries: 3, // 最大重试次数
      retryDelay: 1000 // 重试延迟（毫秒）
    }

    // 连接池配置
    this.POOL_CONFIG = {
      min: 1, // 最小连接数
      max: 10, // 最大连接数
      acquireTimeout: 10000, // 获取连接超时
      createTimeout: 30000, // 创建连接超时
      idleTimeout: 300000, // 空闲连接超时
      reapInterval: 60000 // 清理间隔
    }

    // 默认LDAP属性映射
    this.DEFAULT_ATTRIBUTE_MAP = {
      username: 'uid',
      email: 'mail',
      firstName: 'givenName',
      lastName: 'sn',
      displayName: 'displayName',
      phone: 'telephoneNumber',
      department: 'ou',
      title: 'title',
      manager: 'manager',
      groups: 'memberOf'
    }

    // ==================== 内部状态 ====================

    // 连接池
    this.connectionPool = new Map()
    this.activeConnections = new Set()

    // 缓存系统
    this.userCache = new LRUCache(1000, 15 * 60 * 1000) // 15分钟用户缓存
    this.groupCache = new LRUCache(500, 30 * 60 * 1000) // 30分钟组缓存
    this.dnCache = new LRUCache(2000, 60 * 60 * 1000) // 1小时DN缓存

    // 统计信息
    this.stats = {
      connections: {
        created: 0,
        destroyed: 0,
        active: 0,
        pooled: 0
      },
      operations: {
        authenticate: 0,
        search: 0,
        bind: 0,
        unbind: 0
      },
      cache: {
        hits: 0,
        misses: 0
      },
      errors: {
        connection: 0,
        authentication: 0,
        search: 0,
        timeout: 0
      }
    }

    // ==================== 初始化 ====================

    // 定期清理过期连接和缓存
    this._startMaintenanceTimer()

    logger.info('🔗 LDAP Helper initialized', {
      poolConfig: this.POOL_CONFIG,
      cacheConfig: {
        userCache: this.userCache.maxSize,
        groupCache: this.groupCache.maxSize,
        dnCache: this.dnCache.maxSize
      }
    })
  }

  // ==================== 连接管理 ====================

  /**
   * 创建LDAP连接
   * @param {Object} ldapConfig - LDAP配置
   * @param {Object} options - 连接选项
   * @returns {Promise<Object>} LDAP客户端连接
   */
  async connectLDAP(ldapConfig, options = {}) {
    const startTime = Date.now()
    let client = null

    try {
      // 配置合并
      const mergedConfig = {
        ...this.DEFAULT_CONFIG,
        ...ldapConfig,
        ...options
      }

      logger.debug('🔗 Creating LDAP connection', {
        url: mergedConfig.url,
        timeout: mergedConfig.timeout,
        useProxy: !!mergedConfig.proxy
      })

      // 创建LDAP客户端选项
      const clientOptions = {
        url: mergedConfig.url,
        timeout: mergedConfig.timeout,
        connectTimeout: mergedConfig.connectTimeout,
        idleTimeout: mergedConfig.idleTimeout,
        reconnect: mergedConfig.reconnect
      }

      // 代理支持
      if (mergedConfig.proxy) {
        const proxyAgent = ProxyHelper.createProxyAgent(mergedConfig.proxy)
        if (proxyAgent) {
          clientOptions.socketPath = proxyAgent
          logger.debug('🌐 LDAP connection using proxy', {
            proxy: ProxyHelper.maskProxyInfo(mergedConfig.proxy)
          })
        }
      }

      // TLS配置
      if (mergedConfig.tlsOptions) {
        clientOptions.tlsOptions = {
          rejectUnauthorized: mergedConfig.tlsOptions.rejectUnauthorized !== false,
          ...mergedConfig.tlsOptions
        }
      }

      // 创建客户端
      client = ldap.createClient(clientOptions)

      // 设置事件处理器
      await this._setupClientEventHandlers(client, mergedConfig)

      // 等待连接建立
      await this._waitForConnection(client, mergedConfig.connectTimeout)

      // 更新统计
      this.stats.connections.created++
      this.stats.connections.active++
      this.activeConnections.add(client)

      const duration = Date.now() - startTime
      logger.success(`LDAP connection established in ${duration}ms`, {
        url: mergedConfig.url,
        duration,
        activeConnections: this.stats.connections.active
      })

      return client
    } catch (error) {
      this.stats.errors.connection++

      if (client) {
        try {
          client.destroy()
        } catch (destroyError) {
          logger.warn('Failed to cleanup failed LDAP connection:', destroyError)
        }
      }

      logger.error('❌ LDAP connection failed:', {
        error: error.message,
        url: ldapConfig?.url,
        duration: Date.now() - startTime
      })

      throw error
    }
  }

  /**
   * 从连接池获取连接
   * @param {Object} ldapConfig - LDAP配置
   * @returns {Promise<Object>} LDAP客户端连接
   */
  async getConnection(ldapConfig) {
    const configKey = this._getConfigKey(ldapConfig)

    // 尝试从池中获取现有连接
    const pooledConnections = this.connectionPool.get(configKey) || []

    for (let i = 0; i < pooledConnections.length; i++) {
      const conn = pooledConnections[i]
      if (conn.available && !conn.client.destroyed) {
        conn.available = false
        conn.lastUsed = Date.now()

        logger.debug('🔄 Reusing pooled LDAP connection', {
          configKey,
          poolSize: pooledConnections.length
        })

        return conn.client
      }
    }

    // 如果池中没有可用连接，创建新连接
    const client = await this.connectLDAP(ldapConfig)

    // 添加到连接池
    const connection = {
      client,
      available: false,
      created: Date.now(),
      lastUsed: Date.now()
    }

    if (!this.connectionPool.has(configKey)) {
      this.connectionPool.set(configKey, [])
    }

    const connections = this.connectionPool.get(configKey)
    connections.push(connection)

    // 限制池大小
    if (connections.length > this.POOL_CONFIG.max) {
      const oldConn = connections.shift()
      this._closeConnection(oldConn.client)
    }

    this.stats.connections.pooled++

    return client
  }

  /**
   * 释放连接回池
   * @param {Object} client - LDAP客户端
   * @param {Object} ldapConfig - LDAP配置
   */
  releaseConnection(client, ldapConfig) {
    const configKey = this._getConfigKey(ldapConfig)
    const connections = this.connectionPool.get(configKey)

    if (!connections) {
      this._closeConnection(client)
      return
    }

    const connection = connections.find((conn) => conn.client === client)
    if (connection && !client.destroyed) {
      connection.available = true
      connection.lastUsed = Date.now()

      logger.debug('🔄 Connection released to pool', {
        configKey,
        poolSize: connections.length
      })
    } else {
      this._closeConnection(client)
    }
  }

  /**
   * 测试LDAP连接
   * @param {Object} ldapConfig - LDAP配置
   * @returns {Promise<Object>} 连接测试结果
   */
  async testConnection(ldapConfig) {
    const startTime = Date.now()
    let client = null

    try {
      logger.info('🔍 Testing LDAP connection...', {
        url: ldapConfig?.url,
        bindDN: ldapConfig?.bindDN
      })

      // 建立连接
      client = await this.connectLDAP(ldapConfig, { timeout: 10000 })

      // 尝试绑定（如果提供了认证信息）
      if (ldapConfig.bindDN && ldapConfig.bindPassword) {
        await this._bindClient(client, ldapConfig.bindDN, ldapConfig.bindPassword)
      }

      // 执行基本搜索测试
      const searchResult = await this._performSearch(client, {
        base: ldapConfig.baseDN || '',
        scope: 'base',
        filter: '(objectClass=*)',
        sizeLimit: 1,
        timeLimit: 5
      })

      const duration = Date.now() - startTime

      logger.success('LDAP connection test successful', {
        duration,
        url: ldapConfig?.url,
        searchEntries: searchResult?.entries?.length || 0
      })

      return {
        success: true,
        duration,
        server: {
          url: ldapConfig?.url,
          version: searchResult?.serverInfo?.version,
          vendor: searchResult?.serverInfo?.vendor
        },
        connection: {
          authenticated: !!(ldapConfig.bindDN && ldapConfig.bindPassword),
          searchable: searchResult?.entries?.length >= 0
        }
      }
    } catch (error) {
      const duration = Date.now() - startTime

      logger.error('❌ LDAP connection test failed:', {
        error: error.message,
        duration,
        url: ldapConfig?.url
      })

      return {
        success: false,
        duration,
        error: error.message,
        errorCode: error.code
      }
    } finally {
      if (client) {
        this._closeConnection(client)
      }
    }
  }

  // ==================== 认证功能 ====================

  /**
   * LDAP用户认证
   * @param {string} username - 用户名
   * @param {string} password - 密码
   * @param {Object} ldapConfig - LDAP配置
   * @param {Object} options - 认证选项
   * @returns {Promise<Object>} 认证结果
   */
  async authenticateLDAP(username, password, ldapConfig, options = {}) {
    const startTime = Date.now()
    let client = null

    try {
      this.stats.operations.authenticate++

      if (!username || !password) {
        throw new Error('Username and password are required')
      }

      logger.debug('🔐 Starting LDAP authentication', {
        username: `${username.substring(0, 3)}***`,
        ldapUrl: ldapConfig?.url
      })

      // 获取连接
      client = await this.getConnection(ldapConfig)

      // 管理员绑定（如果需要搜索用户DN）
      if (ldapConfig.bindDN && ldapConfig.bindPassword) {
        await this._bindClient(client, ldapConfig.bindDN, ldapConfig.bindPassword)
      }

      // 查找用户DN
      const userDN = await this._findUserDN(client, username, ldapConfig)
      if (!userDN) {
        throw new Error(`User not found: ${username}`)
      }

      // 创建新连接进行用户认证（避免管理员绑定污染）
      const authClient = await this.connectLDAP(ldapConfig)

      try {
        // 用户密码验证
        await this._bindClient(authClient, userDN, password)

        logger.success('LDAP authentication successful', {
          username: `${username.substring(0, 3)}***`,
          userDN,
          duration: Date.now() - startTime
        })

        // 获取用户详细信息
        let userInfo = {}
        if (options.retrieveUserInfo !== false) {
          userInfo = await this._getUserInfo(client, userDN, ldapConfig)
        }

        // 获取用户组信息
        let groups = []
        if (options.retrieveGroups !== false) {
          groups = await this.getLDAPGroups(userDN, ldapConfig)
        }

        return {
          success: true,
          userDN,
          userInfo,
          groups,
          duration: Date.now() - startTime
        }
      } finally {
        this._closeConnection(authClient)
      }
    } catch (error) {
      this.stats.errors.authentication++

      logger.error('❌ LDAP authentication failed:', {
        username: `${username?.substring(0, 3)}***`,
        error: error.message,
        duration: Date.now() - startTime
      })

      return {
        success: false,
        error: error.message,
        errorCode: error.code,
        duration: Date.now() - startTime
      }
    } finally {
      if (client) {
        this.releaseConnection(client, ldapConfig)
      }
    }
  }

  // ==================== 用户同步 ====================

  /**
   * 同步LDAP用户到本地系统
   * @param {Object} ldapUserData - LDAP用户数据
   * @param {Object} ldapConfig - LDAP配置
   * @param {Object} options - 同步选项
   * @returns {Promise<Object>} 同步结果
   */
  async syncLDAPUser(ldapUserData, ldapConfig, options = {}) {
    const startTime = Date.now()

    try {
      logger.debug('👤 Starting LDAP user sync', {
        userDN: ldapUserData?.dn,
        hasGroups: !!ldapUserData?.groups?.length
      })

      // 映射LDAP属性到本地属性
      const mappedUser = this.mapLDAPAttributes(ldapUserData, ldapConfig)

      // 验证必需属性
      const requiredFields = options.requiredFields || ['username', 'email']
      for (const field of requiredFields) {
        if (!mappedUser[field]) {
          throw new Error(`Required field missing: ${field}`)
        }
      }

      // 处理组映射
      let mappedGroups = []
      if (ldapUserData.groups && ldapConfig.groupMapping) {
        mappedGroups = this._mapLDAPGroups(ldapUserData.groups, ldapConfig.groupMapping)
      }

      // 创建同步结果
      const syncResult = {
        user: {
          ...mappedUser,
          ldapDN: ldapUserData.dn,
          ldapSource: ldapConfig.url,
          lastSyncAt: new Date().toISOString(),
          syncVersion: '1.0'
        },
        groups: mappedGroups,
        metadata: {
          originalAttributes: Object.keys(ldapUserData.attributes || {}),
          syncDuration: Date.now() - startTime,
          syncOptions: options
        }
      }

      logger.success('LDAP user sync completed', {
        username: mappedUser.username,
        email: mappedUser.email,
        groupCount: mappedGroups.length,
        duration: Date.now() - startTime
      })

      return syncResult
    } catch (error) {
      logger.error('❌ LDAP user sync failed:', {
        userDN: ldapUserData?.dn,
        error: error.message,
        duration: Date.now() - startTime
      })

      throw error
    }
  }

  /**
   * 映射LDAP属性到本地属性
   * @param {Object} ldapUser - LDAP用户数据
   * @param {Object} ldapConfig - LDAP配置
   * @returns {Object} 映射后的用户数据
   */
  mapLDAPAttributes(ldapUser, ldapConfig) {
    try {
      const attributeMap = {
        ...this.DEFAULT_ATTRIBUTE_MAP,
        ...(ldapConfig.attributeMapping || {})
      }

      const mappedUser = {}
      const attributes = ldapUser.attributes || {}

      // 映射基本属性
      for (const [localAttr, ldapAttr] of Object.entries(attributeMap)) {
        if (attributes[ldapAttr]) {
          const value = attributes[ldapAttr]
          // 处理多值属性
          mappedUser[localAttr] = Array.isArray(value) ? value[0] : value
        }
      }

      // 特殊属性处理
      if (ldapUser.dn) {
        mappedUser.dn = ldapUser.dn
      }

      // 生成用户ID（如果不存在）
      if (!mappedUser.username && mappedUser.email) {
        mappedUser.username = mappedUser.email.split('@')[0]
      }

      // 生成显示名称
      if (!mappedUser.displayName && (mappedUser.firstName || mappedUser.lastName)) {
        mappedUser.displayName = [mappedUser.firstName, mappedUser.lastName]
          .filter(Boolean)
          .join(' ')
      }

      logger.debug('🗺️ LDAP attributes mapped', {
        originalCount: Object.keys(attributes).length,
        mappedCount: Object.keys(mappedUser).length,
        username: mappedUser.username
      })

      return mappedUser
    } catch (error) {
      logger.error('❌ LDAP attribute mapping failed:', error)
      throw error
    }
  }

  // ==================== 组管理 ====================

  /**
   * 获取用户的LDAP组信息
   * @param {string} userDN - 用户DN
   * @param {Object} ldapConfig - LDAP配置
   * @returns {Promise<Array>} 用户组列表
   */
  async getLDAPGroups(userDN, ldapConfig) {
    let client = null

    try {
      // 检查缓存
      const cacheKey = `groups:${userDN}`
      const cachedGroups = this.groupCache.get(cacheKey)
      if (cachedGroups) {
        this.stats.cache.hits++
        return cachedGroups
      }

      this.stats.cache.misses++
      client = await this.getConnection(ldapConfig)

      // 管理员绑定
      if (ldapConfig.bindDN && ldapConfig.bindPassword) {
        await this._bindClient(client, ldapConfig.bindDN, ldapConfig.bindPassword)
      }

      const groups = []

      // 方法1：通过用户的memberOf属性获取
      try {
        const userEntry = await this._performSearch(client, {
          base: userDN,
          scope: 'base',
          filter: '(objectClass=*)',
          attributes: ['memberOf']
        })

        if (userEntry.entries?.[0]?.memberOf) {
          const memberOfGroups = Array.isArray(userEntry.entries[0].memberOf)
            ? userEntry.entries[0].memberOf
            : [userEntry.entries[0].memberOf]

          groups.push(
            ...memberOfGroups.map((groupDN) => ({
              dn: groupDN,
              name: this._extractCNFromDN(groupDN),
              type: 'memberOf'
            }))
          )
        }
      } catch (error) {
        logger.warn('Failed to get groups via memberOf:', error.message)
      }

      // 方法2：通过搜索组的member属性获取
      if (ldapConfig.groupBaseDN) {
        try {
          const groupSearch = await this._performSearch(client, {
            base: ldapConfig.groupBaseDN,
            scope: 'sub',
            filter: `(member=${userDN})`,
            attributes: ['cn', 'description', 'objectClass']
          })

          for (const groupEntry of groupSearch.entries || []) {
            const groupInfo = {
              dn: groupEntry.dn,
              name: groupEntry.cn || this._extractCNFromDN(groupEntry.dn),
              description: groupEntry.description,
              objectClass: groupEntry.objectClass,
              type: 'member'
            }

            // 避免重复
            if (!groups.some((g) => g.dn === groupInfo.dn)) {
              groups.push(groupInfo)
            }
          }
        } catch (error) {
          logger.warn('Failed to search groups by member:', error.message)
        }
      }

      // 缓存结果
      this.groupCache.set(cacheKey, groups)

      logger.debug('👥 User groups retrieved', {
        userDN,
        groupCount: groups.length,
        methods: ['memberOf', 'member'].filter((m) => groups.some((g) => g.type === m))
      })

      return groups
    } catch (error) {
      logger.error('❌ Failed to get LDAP groups:', {
        userDN,
        error: error.message
      })
      return []
    } finally {
      if (client) {
        this.releaseConnection(client, ldapConfig)
      }
    }
  }

  // ==================== 工具函数 ====================

  /**
   * 获取LDAP连接统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    return {
      ...this.stats,
      connectionPool: {
        totalPools: this.connectionPool.size,
        totalConnections: Array.from(this.connectionPool.values()).reduce(
          (sum, connections) => sum + connections.length,
          0
        ),
        availableConnections: Array.from(this.connectionPool.values()).reduce(
          (sum, connections) => sum + connections.filter((c) => c.available).length,
          0
        )
      },
      cache: {
        ...this.stats.cache,
        userCache: this.userCache.getStats(),
        groupCache: this.groupCache.getStats(),
        dnCache: this.dnCache.getStats()
      }
    }
  }

  /**
   * 清理资源
   * @param {boolean} force - 是否强制清理
   */
  async cleanup(force = false) {
    logger.info('🧹 Starting LDAP helper cleanup', { force })

    // 关闭所有连接
    for (const [, connections] of this.connectionPool) {
      for (const conn of connections) {
        this._closeConnection(conn.client)
      }
    }

    this.connectionPool.clear()
    this.activeConnections.clear()

    // 清理缓存
    this.userCache.clear()
    this.groupCache.clear()
    this.dnCache.clear()

    // 重置统计
    if (force) {
      this.stats = {
        connections: { created: 0, destroyed: 0, active: 0, pooled: 0 },
        operations: { authenticate: 0, search: 0, bind: 0, unbind: 0 },
        cache: { hits: 0, misses: 0 },
        errors: { connection: 0, authentication: 0, search: 0, timeout: 0 }
      }
    }

    logger.success('LDAP helper cleanup completed')
  }

  // ==================== 私有方法 ====================

  /**
   * 设置客户端事件处理器
   * @param {Object} client - LDAP客户端
   * @param {Object} clientConfig - 配置
   * @private
   */
  async _setupClientEventHandlers(client, clientConfig) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('LDAP connection timeout'))
      }, clientConfig.connectTimeout || 10000)

      client.on('connect', () => {
        clearTimeout(timeout)
        logger.debug('🔗 LDAP client connected')
        resolve()
      })

      client.on('error', (clientError) => {
        clearTimeout(timeout)
        logger.error('❌ LDAP client error:', clientError)
        reject(clientError)
      })

      client.on('close', () => {
        logger.debug('🔌 LDAP client disconnected')
        this.activeConnections.delete(client)
        this.stats.connections.active = Math.max(0, this.stats.connections.active - 1)
      })

      client.on('timeout', () => {
        this.stats.errors.timeout++
        logger.warn('⏰ LDAP client timeout')
      })
    })
  }

  /**
   * 等待连接建立
   * @param {Object} client - LDAP客户端
   * @param {number} timeout - 超时时间
   * @private
   */
  async _waitForConnection(client, timeout = 10000) {
    if (client.connected) {
      return
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`LDAP connection timeout after ${timeout}ms`))
      }, timeout)

      const onConnect = () => {
        clearTimeout(timer)
        client.removeListener('error', onError)
        resolve()
      }

      const onError = (error) => {
        clearTimeout(timer)
        client.removeListener('connect', onConnect)
        reject(error)
      }

      client.once('connect', onConnect)
      client.once('error', onError)
    })
  }

  /**
   * 绑定LDAP客户端
   * @param {Object} client - LDAP客户端
   * @param {string} bindDN - 绑定DN
   * @param {string} password - 密码
   * @private
   */
  async _bindClient(client, bindDN, password) {
    return new Promise((resolve, reject) => {
      this.stats.operations.bind++

      client.bind(bindDN, password, (error) => {
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      })
    })
  }

  /**
   * 执行LDAP搜索
   * @param {Object} client - LDAP客户端
   * @param {Object} searchOptions - 搜索选项
   * @private
   */
  async _performSearch(client, searchOptions) {
    return new Promise((resolve, reject) => {
      this.stats.operations.search++

      const entries = []
      const referrals = []

      client.search(searchOptions.base, searchOptions, (error, res) => {
        if (error) {
          return reject(error)
        }

        res.on('searchEntry', (entry) => {
          entries.push({
            dn: entry.dn.toString(),
            ...entry.pojo.attributes
          })
        })

        res.on('searchReference', (referral) => {
          referrals.push(referral)
        })

        res.on('error', (searchError) => {
          reject(searchError)
        })

        res.on('end', (result) => {
          resolve({
            entries,
            referrals,
            status: result?.status
          })
        })
      })
    })
  }

  /**
   * 查找用户DN
   * @param {Object} client - LDAP客户端
   * @param {string} username - 用户名
   * @param {Object} ldapConfig - LDAP配置
   * @private
   */
  async _findUserDN(client, username, ldapConfig) {
    // 检查缓存
    const cacheKey = `dn:${username}:${ldapConfig.url}`
    const cachedDN = this.dnCache.get(cacheKey)
    if (cachedDN) {
      this.stats.cache.hits++
      return cachedDN
    }

    this.stats.cache.misses++

    // 如果配置了用户DN模板，直接构建
    if (ldapConfig.userDNTemplate) {
      const userDN = ldapConfig.userDNTemplate.replace('{username}', username)
      this.dnCache.set(cacheKey, userDN)
      return userDN
    }

    // 搜索用户DN
    if (!ldapConfig.baseDN) {
      throw new Error('No baseDN configured for user search')
    }

    const usernameAttr = ldapConfig.usernameAttribute || 'uid'
    const searchResult = await this._performSearch(client, {
      base: ldapConfig.baseDN,
      scope: 'sub',
      filter: `(${usernameAttr}=${username})`,
      attributes: ['dn'],
      sizeLimit: 1
    })

    if (!searchResult.entries || searchResult.entries.length === 0) {
      return null
    }

    const userDN = searchResult.entries[0].dn
    this.dnCache.set(cacheKey, userDN)

    return userDN
  }

  /**
   * 获取用户详细信息
   * @param {Object} client - LDAP客户端
   * @param {string} userDN - 用户DN
   * @param {Object} ldapConfig - LDAP配置
   * @private
   */
  async _getUserInfo(client, userDN, ldapConfig) {
    try {
      const attributes = ldapConfig.userAttributes || [
        'uid',
        'cn',
        'mail',
        'givenName',
        'sn',
        'displayName',
        'telephoneNumber',
        'ou',
        'title',
        'description'
      ]

      const searchResult = await this._performSearch(client, {
        base: userDN,
        scope: 'base',
        filter: '(objectClass=*)',
        attributes
      })

      if (searchResult.entries && searchResult.entries.length > 0) {
        return {
          dn: userDN,
          attributes: searchResult.entries[0]
        }
      }

      return {}
    } catch (error) {
      logger.warn('Failed to get user info:', error.message)
      return {}
    }
  }

  /**
   * 映射LDAP组到本地组
   * @param {Array} ldapGroups - LDAP组列表
   * @param {Object} groupMapping - 组映射配置
   * @private
   */
  _mapLDAPGroups(ldapGroups, groupMapping) {
    const mappedGroups = []

    for (const group of ldapGroups) {
      const groupName = typeof group === 'string' ? this._extractCNFromDN(group) : group.name

      // 查找映射
      const mapping = groupMapping[groupName] || groupMapping[group.dn]
      if (mapping) {
        if (typeof mapping === 'string') {
          mappedGroups.push(mapping)
        } else if (typeof mapping === 'object') {
          mappedGroups.push({
            name: mapping.name || groupName,
            role: mapping.role,
            permissions: mapping.permissions || []
          })
        }
      } else if (groupMapping['*']) {
        // 默认映射
        mappedGroups.push(groupName)
      }
    }

    return mappedGroups
  }

  /**
   * 从DN中提取CN
   * @param {string} dn - 区分名
   * @private
   */
  _extractCNFromDN(dn) {
    if (!dn || typeof dn !== 'string') {
      return ''
    }

    const cnMatch = dn.match(/^cn=([^,]+)/i)
    return cnMatch ? cnMatch[1] : dn.split(',')[0]
  }

  /**
   * 生成配置键
   * @param {Object} ldapConfig - LDAP配置
   * @private
   */
  _getConfigKey(ldapConfig) {
    const key = `${ldapConfig.url}:${ldapConfig.bindDN || 'anonymous'}`
    return crypto.createHash('md5').update(key).digest('hex')
  }

  /**
   * 关闭LDAP连接
   * @param {Object} client - LDAP客户端
   * @private
   */
  _closeConnection(client) {
    try {
      if (client && !client.destroyed) {
        this.stats.operations.unbind++
        client.unbind()
        client.destroy()
        this.stats.connections.destroyed++
      }
    } catch (error) {
      logger.warn('Error closing LDAP connection:', error.message)
    }
  }

  /**
   * 启动维护定时器
   * @private
   */
  _startMaintenanceTimer() {
    // 每5分钟清理一次过期连接和缓存
    setInterval(
      () => {
        this._performMaintenance()
      },
      5 * 60 * 1000
    )
  }

  /**
   * 执行维护任务
   * @private
   */
  _performMaintenance() {
    const now = Date.now()

    logger.debug('🔧 Starting LDAP maintenance')

    // 清理过期连接
    for (const [configKey, connections] of this.connectionPool) {
      const validConnections = connections.filter((conn) => {
        const isExpired = now - conn.lastUsed > this.POOL_CONFIG.idleTimeout
        const isDestroyed = conn.client.destroyed

        if (isExpired || isDestroyed) {
          this._closeConnection(conn.client)
          return false
        }

        return true
      })

      this.connectionPool.set(configKey, validConnections)
    }

    // 清理空池
    for (const [configKey, connections] of this.connectionPool) {
      if (connections.length === 0) {
        this.connectionPool.delete(configKey)
      }
    }

    // 清理缓存
    this.userCache.cleanup()
    this.groupCache.cleanup()
    this.dnCache.cleanup()

    // 更新统计
    this.stats.connections.pooled = Array.from(this.connectionPool.values()).reduce(
      (sum, connections) => sum + connections.length,
      0
    )

    logger.debug('🔧 LDAP maintenance completed', {
      connectionPools: this.connectionPool.size,
      totalConnections: this.stats.connections.pooled,
      activeConnections: this.stats.connections.active
    })
  }
}

// 创建单例实例
const ldapHelper = new LDAPHelper()

module.exports = ldapHelper
