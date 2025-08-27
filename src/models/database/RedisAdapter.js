/**
 * @fileoverview Redis数据库适配器实现
 *
 * 继承DatabaseAdapter抽象基类，实现Redis特定的数据库操作
 * 从现有redis.js迁移方法，保持完全的向后兼容性
 *
 * @author Claude Code
 * @version 1.0.0
 */

const Redis = require('ioredis')
const config = require('../../../config/config')
const logger = require('../../utils/logger')
const DatabaseAdapter = require('./DatabaseAdapter')

// 时区辅助函数
// 注意：这个函数的目的是获取某个时间点在目标时区的"本地"表示
// 例如：UTC时间 2025-07-30 01:00:00 在 UTC+8 时区表示为 2025-07-30 09:00:00
function getDateInTimezone(date = new Date()) {
  const offset = config.system.timezoneOffset || 8 // 默认UTC+8

  // 方法：创建一个偏移后的Date对象，使其getUTCXXX方法返回目标时区的值
  // 这样我们可以用getUTCFullYear()等方法获取目标时区的年月日时分秒
  const offsetMs = offset * 3600000 // 时区偏移的毫秒数
  const adjustedTime = new Date(date.getTime() + offsetMs)

  return adjustedTime
}

// 获取配置时区的日期字符串 (YYYY-MM-DD)
function getDateStringInTimezone(date = new Date()) {
  const tzDate = getDateInTimezone(date)
  // 使用UTC方法获取偏移后的��期部分
  return `${tzDate.getUTCFullYear()}-${String(tzDate.getUTCMonth() + 1).padStart(2, '0')}-${String(tzDate.getUTCDate()).padStart(2, '0')}`
}

// 获取配置时区的小时 (0-23)
function getHourInTimezone(date = new Date()) {
  const tzDate = getDateInTimezone(date)
  return tzDate.getUTCHours()
}

/**
 * Redis数据库适配器
 *
 * 实现DatabaseAdapter接口，提供Redis特定的数据库操作
 *
 * 特性:
 * - 完全继承自DatabaseAdapter基类
 * - 从redis.js迁移所有方法逻辑，保持100%兼容性
 * - 保留现有的连接管理和错误处理机制
 * - 维持所有现有的性能优化策略
 */
class RedisAdapter extends DatabaseAdapter {
  constructor() {
    super()
    this.client = null
    this._reconnecting = false // 重连锁标志
  }

  // ==================== 连接管理 (4个方法) ====================

  /**
   * 连接到Redis数据库
   * @returns {Promise<any>} Redis客户端实例
   * @throws {Error} 连接失败时抛出错误
   */
  async connect() {
    try {
      // 如果已经连接且连接状态正常，则直接返回
      if (this.client && this.isConnected && this.client.status === 'ready') {
        return this.client
      }

      // 如果有旧的client，先清理
      if (this.client) {
        try {
          // 移除所有事件监听器，避免重复绑定
          this.client.removeAllListeners()
          // 安全断开连接
          if (this.client.status !== 'end') {
            await this.client.quit()
          }
        } catch (error) {
          // 忽略quit错误
          logger.debug('Failed to quit old Redis client:', error)
        }
      }

      this.client = new Redis({
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        db: config.redis.db,
        retryDelayOnFailover: config.redis.retryDelayOnFailover,
        maxRetriesPerRequest: config.redis.maxRetriesPerRequest,
        lazyConnect: config.redis.lazyConnect,
        tls: config.redis.enableTLS ? {} : false,
        // 添加连接保活和重连配置
        keepAlive: 30000, // 30秒保活
        connectTimeout: 10000, // 10秒连接超时
        commandTimeout: 5000, // 5秒命令超时
        retryDelayOnClusterDown: 300 // 集群故障重试延迟
      })

      // 使用once而不是on，避免重复绑定事件监听器
      this.client.once('connect', () => {
        this.isConnected = true
        logger.info('🔗 Redis connected successfully')
      })

      this.client.on('error', (err) => {
        // 避免频繁的错误日志
        if (this.isConnected) {
          this.isConnected = false
          logger.error('❌ Redis connection error:', err)
        }
      })

      this.client.on('close', () => {
        // 只在连接状态改变时记录日志
        if (this.isConnected) {
          this.isConnected = false
          logger.warn('⚠️ Redis connection closed')
        }
      })

      // 添加重连成功监听器
      this.client.on('ready', () => {
        if (!this.isConnected) {
          this.isConnected = true
          logger.info('🔄 Redis reconnected successfully')
        }
      })

      await this.client.connect()
      return this.client
    } catch (error) {
      logger.error('💥 Failed to connect to Redis:', error)
      throw error
    }
  }

  /**
   * 断开Redis连接
   * @returns {Promise<void>}
   */
  async disconnect() {
    if (this.client) {
      await this.client.quit()
      this.isConnected = false
      logger.info('👋 Redis disconnected')
    }
  }

  /**
   * 获取Redis客户端实例（可能为null）
   * @returns {any|null} Redis客户端实例或null
   */
  getClient() {
    // 检查客户端存在性和连接状态
    if (!this.client || !this.isConnected || this.client.status !== 'ready') {
      // 避免频繁的警告日志，只在状态真正改变时记录
      if (this.isConnected && this.client && this.client.status !== 'ready') {
        logger.warn('⚠️ Redis client status is not ready:', this.client.status)
      } else if (!this.client) {
        logger.warn('⚠️ Redis client is not initialized')
      }
      return null
    }
    return this.client
  }

  /**
   * 安全获取Redis客户端（必须存在）
   * @returns {any} Redis客户端实例
   * @throws {Error} 客户端不存在时抛出错误
   */
  getClientSafe() {
    const client = this.getClient()
    if (!client) {
      throw new Error('Redis client is not available')
    }
    return client
  }

  /**
   * 自动重连并获取客户端（新增）
   * @returns {Promise<any>} Redis客户端实例
   * @throws {Error} 重连失败时抛出错误
   */
  async getClientWithReconnect() {
    // 如果连接正常且状态为ready，直接返回
    if (this.client && this.isConnected && this.client.status === 'ready') {
      return this.client
    }

    // 避免并发重连，使用简单的锁机制
    if (this._reconnecting) {
      logger.debug('⏳ Reconnection already in progress, waiting...')
      // 等待重连完成
      let attempts = 0
      while (this._reconnecting && attempts < 50) {
        // 最多等待5秒
        await new Promise((resolve) => setTimeout(resolve, 100))
        attempts++
      }

      if (this.client && this.isConnected && this.client.status === 'ready') {
        return this.client
      }
    }

    this._reconnecting = true
    logger.warn('⚠️ Redis connection lost, attempting to reconnect...')

    try {
      // 尝试重连
      await this.connect()
      this._reconnecting = false
      return this.client
    } catch (error) {
      this._reconnecting = false
      logger.error('💥 Failed to reconnect to Redis:', error)
      throw new Error(`Redis reconnection failed: ${error.message}`)
    }
  }

  // Redis版本兼容的hset方法（支持多字段设置）
  async hsetCompat(key, ...args) {
    const client = await this.getClientWithReconnect()

    // 如果参数是对象形式 hset(key, {field1: value1, field2: value2})
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
      const obj = args[0]

      // 将对象转换为键值对数组格式，适用于现代hset
      const fields = []
      for (const [field, value] of Object.entries(obj)) {
        // 确保所有值都转换为字符串，避免undefined或null导致HSET参数不完整
        const stringValue = value === null || value === undefined ? '' : String(value)
        fields.push(field, stringValue)
      }

      // 调试输出
      logger.debug(`hsetCompat: key=${key}, fields=${JSON.stringify(fields)}, length=${fields.length}`)

      if (fields.length > 0) {
        return await client.hset(key, ...fields)
      }
      return 0
    }

    // 其他情况直接调用原生hset
    return await client.hset(key, ...args)
  }

  // ==================== Redis基础操作方法 ====================

  /**
   * Redis keys命令 - 获取匹配模式的所有键
   * @param {string} pattern 匹配模式
   * @returns {Promise<Array>} 键数组
   */
  async keys(pattern) {
    const client = this.getClientSafe()
    return await client.keys(pattern)
  }

  /**
   * Redis get命令 - 获取字符串值
   * @param {string} key 键名
   * @returns {Promise<string>} 值
   */
  async get(key) {
    const client = this.getClientSafe()
    return await client.get(key)
  }

  /**
   * Redis set命令 - 设置字符串值
   * @param {string} key 键名
   * @param {string} value 值
   * @param {string} mode 设置模式 (EX, PX等)
   * @param {number} time 过期时间
   * @returns {Promise<string>} 结果
   */
  async set(key, value, ...args) {
    const client = this.getClientSafe()
    return await client.set(key, value, ...args)
  }

  /**
   * Redis del命令 - 删除键
   * @param {...string} keys 要删除的键
   * @returns {Promise<number>} 删除的键数量
   */
  async del(...keys) {
    const client = this.getClientSafe()
    return await client.del(...keys)
  }

  /**
   * Redis hget命令 - 获取哈希字段值
   * @param {string} key 键名
   * @param {string} field 字段名
   * @returns {Promise<string>} 字段值
   */
  async hget(key, field) {
    const client = this.getClientSafe()
    return await client.hget(key, field)
  }

  /**
   * Redis hset命令 - 设置哈希字段值
   * @param {string} key 键名
   * @param {...any} args 字段和值
   * @returns {Promise<number>} 设置的字段数量
   */
  async hset(key, ...args) {
    const client = this.getClientSafe()
    return await client.hset(key, ...args)
  }

  /**
   * Redis hgetall命令 - 获取所有哈希字段和值
   * @param {string} key 键名
   * @returns {Promise<Object>} 哈希对象
   */
  async hgetall(key) {
    const client = this.getClientSafe()
    return await client.hgetall(key)
  }

  /**
   * Redis hdel命令 - 删除哈希字段
   * @param {string} key 键名
   * @param {...string} fields 字段名
   * @returns {Promise<number>} 删除的字段数量
   */
  async hdel(key, ...fields) {
    const client = this.getClientSafe()
    return await client.hdel(key, ...fields)
  }

  /**
   * Redis hmset命令 - 设置多个哈希字段 (为了兼容性)
   * @param {string} key 键名
   * @param {Object|Array} hash 哈希数据
   * @returns {Promise<string>} 结果
   */
  async hmset(key, hash) {
    const client = this.getClientSafe()
    return await client.hmset(key, hash)
  }

  /**
   * Redis expire命令 - 设置键过期时间
   * @param {string} key 键名
   * @param {number} seconds 过期秒数
   * @returns {Promise<number>} 结果
   */
  async expire(key, seconds) {
    const client = this.getClientSafe()
    return await client.expire(key, seconds)
  }

  /**
   * Redis incr命令 - 递增数值
   * @param {string} key 键名
   * @returns {Promise<number>} 递增后的值
   */
  async incr(key) {
    const client = this.getClientSafe()
    return await client.incr(key)
  }

  /**
   * Redis decr命令 - 递减数值
   * @param {string} key 键名
   * @returns {Promise<number>} 递减后的值
   */
  async decr(key) {
    const client = this.getClientSafe()
    return await client.decr(key)
  }

  /**
   * Redis type命令 - 获取键的数据类型
   * @param {string} key 键名
   * @returns {Promise<string>} 数据类型
   */
  async type(key) {
    const client = this.getClientSafe()
    return await client.type(key)
  }

  // ==================== API Key 操作 (5个方法) ====================

  /**
   * 设置API Key数据
   * @param {string} keyId API Key ID
   * @param {Object} keyData API Key数据对象
   * @param {string|null} hashedKey 哈希后的Key值，用于快速查找
   * @returns {Promise<void>}
   */
  async setApiKey(keyId, keyData, hashedKey = null) {
    const key = `apikey:${keyId}`
    const client = this.getClientSafe()

    // 维护哈希映射表（用于快速查找）
    // hashedKey参数是实际的哈希值，用于建立映射
    if (hashedKey) {
      await client.hset('apikey:hash_map', hashedKey, keyId)
    }

    await this.hsetCompat(key, keyData)
    await client.expire(key, 86400 * 365) // 1年过期
  }

  /**
   * 获取API Key数据
   * @param {string} keyId API Key ID
   * @returns {Promise<Object>} API Key数据对象
   */
  async getApiKey(keyId) {
    const key = `apikey:${keyId}`
    return await this.client.hgetall(key)
  }

  /**
   * 删除API Key
   * @param {string} keyId API Key ID
   * @returns {Promise<number>} 删除的记录数
   */
  async deleteApiKey(keyId) {
    const key = `apikey:${keyId}`

    // 获取要删除的API Key哈希值，以便从映射表中移除
    const keyData = await this.client.hgetall(key)
    if (keyData && keyData.apiKey) {
      // keyData.apiKey现在存储的是哈希值，直接从映射表删除
      await this.client.hdel('apikey:hash_map', keyData.apiKey)
    }

    return await this.client.del(key)
  }

  /**
   * 获取所有API Keys
   * @returns {Promise<Array>} API Key列表
   */
  async getAllApiKeys() {
    const keys = await this.client.keys('apikey:*')
    const apiKeys = []
    for (const key of keys) {
      // 过滤掉hash_map，它不是真正的API Key
      if (key === 'apikey:hash_map') {
        continue
      }

      const keyData = await this.client.hgetall(key)
      if (keyData && Object.keys(keyData).length > 0) {
        apiKeys.push({ id: key.replace('apikey:', ''), ...keyData })
      }
    }
    return apiKeys
  }

  /**
   * 通过哈希值查找API Key（性能优化）
   * @param {string} hashedKey 哈希后的Key值
   * @returns {Promise<Object|null>} API Key数据对象或null
   */
  async findApiKeyByHash(hashedKey) {
    // 使用反向映射表：hash -> keyId
    const keyId = await this.client.hget('apikey:hash_map', hashedKey)
    if (!keyId) {
      return null
    }

    const keyData = await this.client.hgetall(`apikey:${keyId}`)
    if (keyData && Object.keys(keyData).length > 0) {
      return { id: keyId, ...keyData }
    }

    // 如果数据不存在，清理映射表
    await this.client.hdel('apikey:hash_map', hashedKey)
    return null
  }

  // ==================== 使用统计操作 (9个方法) ====================

  /**
   * 标准化模型名称，用于统计聚合
   * @param {string} model 原始模型名称
   * @returns {string} 标准化后的模型名称
   * @private
   */
  _normalizeModelName(model) {
    if (!model || model === 'unknown') {
      return model
    }

    // 对于Bedrock模型，去掉区域前缀进行统一
    if (model.includes('.anthropic.') || model.includes('.claude')) {
      // 匹配所有AWS区域格式：region.anthropic.model-name-v1:0 -> claude-model-name
      // 支持所有AWS区域格式，如：us-east-1, eu-west-1, ap-southeast-1, ca-central-1等
      let normalized = model.replace(/^[a-z0-9-]+\./, '') // 去掉任何区域前缀（更通用）
      normalized = normalized.replace('anthropic.', '') // 去掉anthropic前缀
      normalized = normalized.replace(/-v\d+:\d+$/, '') // 去掉版本后缀（如-v1:0, -v2:1等）
      return normalized
    }

    // 对于其他模型，去掉常见的版本后缀
    return model.replace(/-v\d+:\d+$|:latest$/, '')
  }

  /**
   * 增加Token使用统计（支持多种缓存Token类型）
   * @param {string} keyId API Key ID
   * @param {number} tokens 总Token数
   * @param {number} inputTokens 输入Token数
   * @param {number} outputTokens 输出Token数
   * @param {number} cacheCreateTokens 缓存创建Token数
   * @param {number} cacheReadTokens 缓存读取Token数
   * @param {string} model 模型名称
   * @param {number} ephemeral5mTokens 5分钟缓存Token数
   * @param {number} ephemeral1hTokens 1小时缓存Token数
   * @returns {Promise<void>}
   */
  async incrementTokenUsage(
    keyId,
    tokens,
    inputTokens = 0,
    outputTokens = 0,
    cacheCreateTokens = 0,
    cacheReadTokens = 0,
    model = 'unknown',
    ephemeral5mTokens = 0, // 新增：5分钟缓存 tokens
    ephemeral1hTokens = 0 // 新增：1小时缓存 tokens
  ) {
    const key = `usage:${keyId}`
    const now = new Date()
    const today = getDateStringInTimezone(now)
    const tzDate = getDateInTimezone(now)
    const currentMonth = `${tzDate.getUTCFullYear()}-${String(tzDate.getUTCMonth() + 1).padStart(2, '0')}`
    const currentHour = `${today}:${String(getHourInTimezone(now)).padStart(2, '0')}` // 新增小时级别

    const daily = `usage:daily:${keyId}:${today}`
    const monthly = `usage:monthly:${keyId}:${currentMonth}`
    const hourly = `usage:hourly:${keyId}:${currentHour}` // 新增小时级别key

    // 标准化模型名用于统计聚合
    const normalizedModel = this._normalizeModelName(model)

    // 按模型统计的键
    const modelDaily = `usage:model:daily:${normalizedModel}:${today}`
    const modelMonthly = `usage:model:monthly:${normalizedModel}:${currentMonth}`
    const modelHourly = `usage:model:hourly:${normalizedModel}:${currentHour}` // 新增模型小时级别

    // API Key级别的模型统计
    const keyModelDaily = `usage:${keyId}:model:daily:${normalizedModel}:${today}`
    const keyModelMonthly = `usage:${keyId}:model:monthly:${normalizedModel}:${currentMonth}`
    const keyModelHourly = `usage:${keyId}:model:hourly:${normalizedModel}:${currentHour}` // 新增API Key模型小时级别

    // 新增：系统级分钟统计
    const minuteTimestamp = Math.floor(now.getTime() / 60000)
    const systemMinuteKey = `system:metrics:minute:${minuteTimestamp}`

    // 智能处理输入输出token分配
    const finalInputTokens = inputTokens || 0
    const finalOutputTokens = outputTokens || (finalInputTokens > 0 ? 0 : tokens)
    const finalCacheCreateTokens = cacheCreateTokens || 0
    const finalCacheReadTokens = cacheReadTokens || 0

    // 重新计算真实的总token数（包括缓存token）
    const totalTokens =
      finalInputTokens + finalOutputTokens + finalCacheCreateTokens + finalCacheReadTokens
    // 核心token（不包括缓存）- 用于与历史数据兼容
    const coreTokens = finalInputTokens + finalOutputTokens

    // 使用Pipeline优化性能
    const pipeline = this.client.pipeline()

    // 现有的统计保持不变
    // 核心token统计（保持向后兼容）
    pipeline.hincrby(key, 'totalTokens', coreTokens)
    pipeline.hincrby(key, 'totalInputTokens', finalInputTokens)
    pipeline.hincrby(key, 'totalOutputTokens', finalOutputTokens)
    // 缓存token统计（新增）
    pipeline.hincrby(key, 'totalCacheCreateTokens', finalCacheCreateTokens)
    pipeline.hincrby(key, 'totalCacheReadTokens', finalCacheReadTokens)
    pipeline.hincrby(key, 'totalAllTokens', totalTokens) // 包含所有类型的总token
    // 详细缓存类型统计（新增）
    pipeline.hincrby(key, 'totalEphemeral5mTokens', ephemeral5mTokens)
    pipeline.hincrby(key, 'totalEphemeral1hTokens', ephemeral1hTokens)
    // 请求计数
    pipeline.hincrby(key, 'totalRequests', 1)

    // 每日统计
    pipeline.hincrby(daily, 'tokens', coreTokens)
    pipeline.hincrby(daily, 'inputTokens', finalInputTokens)
    pipeline.hincrby(daily, 'outputTokens', finalOutputTokens)
    pipeline.hincrby(daily, 'cacheCreateTokens', finalCacheCreateTokens)
    pipeline.hincrby(daily, 'cacheReadTokens', finalCacheReadTokens)
    pipeline.hincrby(daily, 'allTokens', totalTokens)
    pipeline.hincrby(daily, 'requests', 1)
    // 详细缓存类型统计
    pipeline.hincrby(daily, 'ephemeral5mTokens', ephemeral5mTokens)
    pipeline.hincrby(daily, 'ephemeral1hTokens', ephemeral1hTokens)

    // 每月统计
    pipeline.hincrby(monthly, 'tokens', coreTokens)
    pipeline.hincrby(monthly, 'inputTokens', finalInputTokens)
    pipeline.hincrby(monthly, 'outputTokens', finalOutputTokens)
    pipeline.hincrby(monthly, 'cacheCreateTokens', finalCacheCreateTokens)
    pipeline.hincrby(monthly, 'cacheReadTokens', finalCacheReadTokens)
    pipeline.hincrby(monthly, 'allTokens', totalTokens)
    pipeline.hincrby(monthly, 'requests', 1)
    // 详细缓存类型统计
    pipeline.hincrby(monthly, 'ephemeral5mTokens', ephemeral5mTokens)
    pipeline.hincrby(monthly, 'ephemeral1hTokens', ephemeral1hTokens)

    // 按模型统计 - 每日
    pipeline.hincrby(modelDaily, 'inputTokens', finalInputTokens)
    pipeline.hincrby(modelDaily, 'outputTokens', finalOutputTokens)
    pipeline.hincrby(modelDaily, 'cacheCreateTokens', finalCacheCreateTokens)
    pipeline.hincrby(modelDaily, 'cacheReadTokens', finalCacheReadTokens)
    pipeline.hincrby(modelDaily, 'allTokens', totalTokens)
    pipeline.hincrby(modelDaily, 'requests', 1)

    // 按模型统计 - 每月
    pipeline.hincrby(modelMonthly, 'inputTokens', finalInputTokens)
    pipeline.hincrby(modelMonthly, 'outputTokens', finalOutputTokens)
    pipeline.hincrby(modelMonthly, 'cacheCreateTokens', finalCacheCreateTokens)
    pipeline.hincrby(modelMonthly, 'cacheReadTokens', finalCacheReadTokens)
    pipeline.hincrby(modelMonthly, 'allTokens', totalTokens)
    pipeline.hincrby(modelMonthly, 'requests', 1)

    // API Key级别的模型统计 - 每日
    pipeline.hincrby(keyModelDaily, 'inputTokens', finalInputTokens)
    pipeline.hincrby(keyModelDaily, 'outputTokens', finalOutputTokens)
    pipeline.hincrby(keyModelDaily, 'cacheCreateTokens', finalCacheCreateTokens)
    pipeline.hincrby(keyModelDaily, 'cacheReadTokens', finalCacheReadTokens)
    pipeline.hincrby(keyModelDaily, 'allTokens', totalTokens)
    pipeline.hincrby(keyModelDaily, 'requests', 1)
    // 详细缓存类型统计
    pipeline.hincrby(keyModelDaily, 'ephemeral5mTokens', ephemeral5mTokens)
    pipeline.hincrby(keyModelDaily, 'ephemeral1hTokens', ephemeral1hTokens)

    // API Key级别的模型统计 - 每月
    pipeline.hincrby(keyModelMonthly, 'inputTokens', finalInputTokens)
    pipeline.hincrby(keyModelMonthly, 'outputTokens', finalOutputTokens)
    pipeline.hincrby(keyModelMonthly, 'cacheCreateTokens', finalCacheCreateTokens)
    pipeline.hincrby(keyModelMonthly, 'cacheReadTokens', finalCacheReadTokens)
    pipeline.hincrby(keyModelMonthly, 'allTokens', totalTokens)
    pipeline.hincrby(keyModelMonthly, 'requests', 1)
    // 详细缓存类型统计
    pipeline.hincrby(keyModelMonthly, 'ephemeral5mTokens', ephemeral5mTokens)
    pipeline.hincrby(keyModelMonthly, 'ephemeral1hTokens', ephemeral1hTokens)

    // 小时级别统计
    pipeline.hincrby(hourly, 'tokens', coreTokens)
    pipeline.hincrby(hourly, 'inputTokens', finalInputTokens)
    pipeline.hincrby(hourly, 'outputTokens', finalOutputTokens)
    pipeline.hincrby(hourly, 'cacheCreateTokens', finalCacheCreateTokens)
    pipeline.hincrby(hourly, 'cacheReadTokens', finalCacheReadTokens)
    pipeline.hincrby(hourly, 'allTokens', totalTokens)
    pipeline.hincrby(hourly, 'requests', 1)

    // 按模型统计 - 每小时
    pipeline.hincrby(modelHourly, 'inputTokens', finalInputTokens)
    pipeline.hincrby(modelHourly, 'outputTokens', finalOutputTokens)
    pipeline.hincrby(modelHourly, 'cacheCreateTokens', finalCacheCreateTokens)
    pipeline.hincrby(modelHourly, 'cacheReadTokens', finalCacheReadTokens)
    pipeline.hincrby(modelHourly, 'allTokens', totalTokens)
    pipeline.hincrby(modelHourly, 'requests', 1)

    // API Key级别的模型统计 - 每小时
    pipeline.hincrby(keyModelHourly, 'inputTokens', finalInputTokens)
    pipeline.hincrby(keyModelHourly, 'outputTokens', finalOutputTokens)
    pipeline.hincrby(keyModelHourly, 'cacheCreateTokens', finalCacheCreateTokens)
    pipeline.hincrby(keyModelHourly, 'cacheReadTokens', finalCacheReadTokens)
    pipeline.hincrby(keyModelHourly, 'allTokens', totalTokens)
    pipeline.hincrby(keyModelHourly, 'requests', 1)

    // 新增：系统级分钟统计
    pipeline.hincrby(systemMinuteKey, 'requests', 1)
    pipeline.hincrby(systemMinuteKey, 'totalTokens', totalTokens)
    pipeline.hincrby(systemMinuteKey, 'inputTokens', finalInputTokens)
    pipeline.hincrby(systemMinuteKey, 'outputTokens', finalOutputTokens)
    pipeline.hincrby(systemMinuteKey, 'cacheCreateTokens', finalCacheCreateTokens)
    pipeline.hincrby(systemMinuteKey, 'cacheReadTokens', finalCacheReadTokens)

    // 设置过期时间
    pipeline.expire(daily, 86400 * 32) // 32天过期
    pipeline.expire(monthly, 86400 * 365) // 1年过期
    pipeline.expire(hourly, 86400 * 7) // 小时统计7天过期
    pipeline.expire(modelDaily, 86400 * 32) // 模型每日统计32天过期
    pipeline.expire(modelMonthly, 86400 * 365) // 模型每月统计1年过期
    pipeline.expire(modelHourly, 86400 * 7) // 模型小时统计7天过期
    pipeline.expire(keyModelDaily, 86400 * 32) // API Key模型每日统计32天过期
    pipeline.expire(keyModelMonthly, 86400 * 365) // API Key模型每月统计1年过期
    pipeline.expire(keyModelHourly, 86400 * 7) // API Key模型小时统计7天过期

    // 系统级分钟统计的过期时间（窗口时间的2倍）
    const configLocal = require('../../../config/config')
    const { metricsWindow } = configLocal.system
    pipeline.expire(systemMinuteKey, metricsWindow * 60 * 2)

    // 执行Pipeline
    await pipeline.exec()
  }

  /**
   * 记录账户级别的使用统计
   * @param {string} accountId 账户ID
   * @param {number} totalTokens 总Token数
   * @param {number} inputTokens 输入Token数
   * @param {number} outputTokens 输出Token数
   * @param {number} cacheCreateTokens 缓存创建Token数
   * @param {number} cacheReadTokens 缓存读取Token数
   * @param {string} model 模型名称
   * @returns {Promise<void>}
   */
  async incrementAccountUsage(
    accountId,
    totalTokens,
    inputTokens = 0,
    outputTokens = 0,
    cacheCreateTokens = 0,
    cacheReadTokens = 0,
    model = 'unknown'
  ) {
    const now = new Date()
    const today = getDateStringInTimezone(now)
    const tzDate = getDateInTimezone(now)
    const currentMonth = `${tzDate.getUTCFullYear()}-${String(tzDate.getUTCMonth() + 1).padStart(2, '0')}`
    const currentHour = `${today}:${String(getHourInTimezone(now)).padStart(2, '0')}`

    // 账户级别统计的键
    const accountKey = `account_usage:${accountId}`
    const accountDaily = `account_usage:daily:${accountId}:${today}`
    const accountMonthly = `account_usage:monthly:${accountId}:${currentMonth}`
    const accountHourly = `account_usage:hourly:${accountId}:${currentHour}`

    // 标准化模型名用于统计聚合
    const normalizedModel = this._normalizeModelName(model)

    // 账户按模型统计的键
    const accountModelDaily = `account_usage:model:daily:${accountId}:${normalizedModel}:${today}`
    const accountModelMonthly = `account_usage:model:monthly:${accountId}:${normalizedModel}:${currentMonth}`
    const accountModelHourly = `account_usage:model:hourly:${accountId}:${normalizedModel}:${currentHour}`

    // 处理token分配
    const finalInputTokens = inputTokens || 0
    const finalOutputTokens = outputTokens || 0
    const finalCacheCreateTokens = cacheCreateTokens || 0
    const finalCacheReadTokens = cacheReadTokens || 0
    const actualTotalTokens =
      finalInputTokens + finalOutputTokens + finalCacheCreateTokens + finalCacheReadTokens
    const coreTokens = finalInputTokens + finalOutputTokens

    await Promise.all([
      // 账户总体统计
      this.client.hincrby(accountKey, 'totalTokens', coreTokens),
      this.client.hincrby(accountKey, 'totalInputTokens', finalInputTokens),
      this.client.hincrby(accountKey, 'totalOutputTokens', finalOutputTokens),
      this.client.hincrby(accountKey, 'totalCacheCreateTokens', finalCacheCreateTokens),
      this.client.hincrby(accountKey, 'totalCacheReadTokens', finalCacheReadTokens),
      this.client.hincrby(accountKey, 'totalAllTokens', actualTotalTokens),
      this.client.hincrby(accountKey, 'totalRequests', 1),

      // 账户每日统计
      this.client.hincrby(accountDaily, 'tokens', coreTokens),
      this.client.hincrby(accountDaily, 'inputTokens', finalInputTokens),
      this.client.hincrby(accountDaily, 'outputTokens', finalOutputTokens),
      this.client.hincrby(accountDaily, 'cacheCreateTokens', finalCacheCreateTokens),
      this.client.hincrby(accountDaily, 'cacheReadTokens', finalCacheReadTokens),
      this.client.hincrby(accountDaily, 'allTokens', actualTotalTokens),
      this.client.hincrby(accountDaily, 'requests', 1),

      // 账户每月统计
      this.client.hincrby(accountMonthly, 'tokens', coreTokens),
      this.client.hincrby(accountMonthly, 'inputTokens', finalInputTokens),
      this.client.hincrby(accountMonthly, 'outputTokens', finalOutputTokens),
      this.client.hincrby(accountMonthly, 'cacheCreateTokens', finalCacheCreateTokens),
      this.client.hincrby(accountMonthly, 'cacheReadTokens', finalCacheReadTokens),
      this.client.hincrby(accountMonthly, 'allTokens', actualTotalTokens),
      this.client.hincrby(accountMonthly, 'requests', 1),

      // 账户每小时统计
      this.client.hincrby(accountHourly, 'tokens', coreTokens),
      this.client.hincrby(accountHourly, 'inputTokens', finalInputTokens),
      this.client.hincrby(accountHourly, 'outputTokens', finalOutputTokens),
      this.client.hincrby(accountHourly, 'cacheCreateTokens', finalCacheCreateTokens),
      this.client.hincrby(accountHourly, 'cacheReadTokens', finalCacheReadTokens),
      this.client.hincrby(accountHourly, 'allTokens', actualTotalTokens),
      this.client.hincrby(accountHourly, 'requests', 1),

      // 账户按模型统计 - 每日
      this.client.hincrby(accountModelDaily, 'inputTokens', finalInputTokens),
      this.client.hincrby(accountModelDaily, 'outputTokens', finalOutputTokens),
      this.client.hincrby(accountModelDaily, 'cacheCreateTokens', finalCacheCreateTokens),
      this.client.hincrby(accountModelDaily, 'cacheReadTokens', finalCacheReadTokens),
      this.client.hincrby(accountModelDaily, 'allTokens', actualTotalTokens),
      this.client.hincrby(accountModelDaily, 'requests', 1),

      // 账户按模型统计 - 每月
      this.client.hincrby(accountModelMonthly, 'inputTokens', finalInputTokens),
      this.client.hincrby(accountModelMonthly, 'outputTokens', finalOutputTokens),
      this.client.hincrby(accountModelMonthly, 'cacheCreateTokens', finalCacheCreateTokens),
      this.client.hincrby(accountModelMonthly, 'cacheReadTokens', finalCacheReadTokens),
      this.client.hincrby(accountModelMonthly, 'allTokens', actualTotalTokens),
      this.client.hincrby(accountModelMonthly, 'requests', 1),

      // 账户按模型统计 - 每小时
      this.client.hincrby(accountModelHourly, 'inputTokens', finalInputTokens),
      this.client.hincrby(accountModelHourly, 'outputTokens', finalOutputTokens),
      this.client.hincrby(accountModelHourly, 'cacheCreateTokens', finalCacheCreateTokens),
      this.client.hincrby(accountModelHourly, 'cacheReadTokens', finalCacheReadTokens),
      this.client.hincrby(accountModelHourly, 'allTokens', actualTotalTokens),
      this.client.hincrby(accountModelHourly, 'requests', 1),

      // 设置过期时间
      this.client.expire(accountDaily, 86400 * 32), // 32天过期
      this.client.expire(accountMonthly, 86400 * 365), // 1年过期
      this.client.expire(accountHourly, 86400 * 7), // 7天过期
      this.client.expire(accountModelDaily, 86400 * 32), // 32天过期
      this.client.expire(accountModelMonthly, 86400 * 365), // 1年过期
      this.client.expire(accountModelHourly, 86400 * 7) // 7天过期
    ])
  }

  /**
   * 获取API Key使用统计（包括兼容性处理）
   * @param {string} keyId API Key ID
   * @returns {Promise<Object>} 使用统计对象
   */
  async getUsageStats(keyId) {
    const totalKey = `usage:${keyId}`
    const today = getDateStringInTimezone()
    const dailyKey = `usage:daily:${keyId}:${today}`
    const tzDate = getDateInTimezone()
    const currentMonth = `${tzDate.getUTCFullYear()}-${String(tzDate.getUTCMonth() + 1).padStart(2, '0')}`
    const monthlyKey = `usage:monthly:${keyId}:${currentMonth}`

    const [total, daily, monthly] = await Promise.all([
      this.client.hgetall(totalKey),
      this.client.hgetall(dailyKey),
      this.client.hgetall(monthlyKey)
    ])

    // 获取API Key的创建时间来计算平均值
    const keyData = await this.client.hgetall(`apikey:${keyId}`)
    const createdAt = keyData.createdAt ? new Date(keyData.createdAt) : new Date()
    const now = new Date()
    const daysSinceCreated = Math.max(1, Math.ceil((now - createdAt) / (1000 * 60 * 60 * 24)))

    const totalTokens = parseInt(total.totalTokens) || 0
    const totalRequests = parseInt(total.totalRequests) || 0

    // 计算平均RPM (requests per minute) 和 TPM (tokens per minute)
    const totalMinutes = Math.max(1, daysSinceCreated * 24 * 60)
    const avgRPM = totalRequests / totalMinutes
    const avgTPM = totalTokens / totalMinutes

    // 处理旧数据兼容性（支持缓存token）
    const handleLegacyData = (data) => {
      // 优先使用total*字段（存储时使用的字段）
      const tokens = parseInt(data.totalTokens) || parseInt(data.tokens) || 0
      const inputTokens = parseInt(data.totalInputTokens) || parseInt(data.inputTokens) || 0
      const outputTokens = parseInt(data.totalOutputTokens) || parseInt(data.outputTokens) || 0
      const requests = parseInt(data.totalRequests) || parseInt(data.requests) || 0

      // 新增缓存token字段
      const cacheCreateTokens =
        parseInt(data.totalCacheCreateTokens) || parseInt(data.cacheCreateTokens) || 0
      const cacheReadTokens =
        parseInt(data.totalCacheReadTokens) || parseInt(data.cacheReadTokens) || 0
      const allTokens = parseInt(data.totalAllTokens) || parseInt(data.allTokens) || 0

      const totalFromSeparate = inputTokens + outputTokens
      // 计算实际的总tokens（包含所有类型）
      const actualAllTokens =
        allTokens || inputTokens + outputTokens + cacheCreateTokens + cacheReadTokens

      if (totalFromSeparate === 0 && tokens > 0) {
        // 旧数据：没有输入输出分离
        return {
          tokens, // 保持兼容性，但统一使用allTokens
          inputTokens: Math.round(tokens * 0.3), // 假设30%为输入
          outputTokens: Math.round(tokens * 0.7), // 假设70%为输出
          cacheCreateTokens: 0, // 旧数据没有缓存token
          cacheReadTokens: 0,
          allTokens: tokens, // 对于旧数据，allTokens等于tokens
          requests
        }
      } else {
        // 新数据或无数据 - 统一使用allTokens作为tokens的值
        return {
          tokens: actualAllTokens, // 统一使用allTokens作为总数
          inputTokens,
          outputTokens,
          cacheCreateTokens,
          cacheReadTokens,
          allTokens: actualAllTokens,
          requests
        }
      }
    }

    const totalData = handleLegacyData(total)
    const dailyData = handleLegacyData(daily)
    const monthlyData = handleLegacyData(monthly)

    return {
      total: totalData,
      daily: dailyData,
      monthly: monthlyData,
      averages: {
        rpm: Math.round(avgRPM * 100) / 100, // 保留2位小数
        tpm: Math.round(avgTPM * 100) / 100,
        dailyRequests: Math.round((totalRequests / daysSinceCreated) * 100) / 100,
        dailyTokens: Math.round((totalTokens / daysSinceCreated) * 100) / 100
      }
    }
  }

  /**
   * 获取当日费用
   * @param {string} keyId API Key ID
   * @returns {Promise<number>} 当日费用
   */
  async getDailyCost(keyId) {
    const today = getDateStringInTimezone()
    const costKey = `usage:cost:daily:${keyId}:${today}`
    const cost = await this.client.get(costKey)
    const result = parseFloat(cost || 0)
    logger.debug(
      `💰 Getting daily cost for ${keyId}, date: ${today}, key: ${costKey}, value: ${cost}, result: ${result}`
    )
    return result
  }

  /**
   * 增加当日费用
   * @param {string} keyId API Key ID
   * @param {number} amount 费用金额
   * @returns {Promise<void>}
   */
  async incrementDailyCost(keyId, amount) {
    const today = getDateStringInTimezone()
    const tzDate = getDateInTimezone()
    const currentMonth = `${tzDate.getUTCFullYear()}-${String(tzDate.getUTCMonth() + 1).padStart(2, '0')}`
    const currentHour = `${today}:${String(getHourInTimezone(new Date())).padStart(2, '0')}`

    const dailyKey = `usage:cost:daily:${keyId}:${today}`
    const monthlyKey = `usage:cost:monthly:${keyId}:${currentMonth}`
    const hourlyKey = `usage:cost:hourly:${keyId}:${currentHour}`
    const totalKey = `usage:cost:total:${keyId}`

    logger.debug(
      `💰 Incrementing cost for ${keyId}, amount: $${amount}, date: ${today}, dailyKey: ${dailyKey}`
    )

    const results = await Promise.all([
      this.client.incrbyfloat(dailyKey, amount),
      this.client.incrbyfloat(monthlyKey, amount),
      this.client.incrbyfloat(hourlyKey, amount),
      this.client.incrbyfloat(totalKey, amount),
      // 设置过期时间
      this.client.expire(dailyKey, 86400 * 30), // 30天
      this.client.expire(monthlyKey, 86400 * 90), // 90天
      this.client.expire(hourlyKey, 86400 * 7) // 7天
    ])

    logger.debug(`💰 Cost incremented successfully, new daily total: $${results[0]}`)
  }

  /**
   * 获取费用统计
   * @param {string} keyId API Key ID
   * @returns {Promise<Object>} 费用统计对象
   */
  async getCostStats(keyId) {
    const today = getDateStringInTimezone()
    const tzDate = getDateInTimezone()
    const currentMonth = `${tzDate.getUTCFullYear()}-${String(tzDate.getUTCMonth() + 1).padStart(2, '0')}`
    const currentHour = `${today}:${String(getHourInTimezone(new Date())).padStart(2, '0')}`

    const [daily, monthly, hourly, total] = await Promise.all([
      this.client.get(`usage:cost:daily:${keyId}:${today}`),
      this.client.get(`usage:cost:monthly:${keyId}:${currentMonth}`),
      this.client.get(`usage:cost:hourly:${keyId}:${currentHour}`),
      this.client.get(`usage:cost:total:${keyId}`)
    ])

    return {
      daily: parseFloat(daily || 0),
      monthly: parseFloat(monthly || 0),
      hourly: parseFloat(hourly || 0),
      total: parseFloat(total || 0)
    }
  }

  /**
   * 获取账户使用统计
   * @param {string} accountId 账户ID
   * @returns {Promise<Object>} 账户使用统计对象
   */
  async getAccountUsageStats(accountId) {
    const accountKey = `account_usage:${accountId}`
    const today = getDateStringInTimezone()
    const accountDailyKey = `account_usage:daily:${accountId}:${today}`
    const tzDate = getDateInTimezone()
    const currentMonth = `${tzDate.getUTCFullYear()}-${String(tzDate.getUTCMonth() + 1).padStart(2, '0')}`
    const accountMonthlyKey = `account_usage:monthly:${accountId}:${currentMonth}`

    const [total, daily, monthly] = await Promise.all([
      this.client.hgetall(accountKey),
      this.client.hgetall(accountDailyKey),
      this.client.hgetall(accountMonthlyKey)
    ])

    // 获取账户创建时间来计算平均值
    const accountData = await this.client.hgetall(`claude_account:${accountId}`)
    const createdAt = accountData.createdAt ? new Date(accountData.createdAt) : new Date()
    const now = new Date()
    const daysSinceCreated = Math.max(1, Math.ceil((now - createdAt) / (1000 * 60 * 60 * 24)))

    const totalTokens = parseInt(total.totalTokens) || 0
    const totalRequests = parseInt(total.totalRequests) || 0

    // 计算平均RPM和TPM
    const totalMinutes = Math.max(1, daysSinceCreated * 24 * 60)
    const avgRPM = totalRequests / totalMinutes
    const avgTPM = totalTokens / totalMinutes

    // 处理账户统计数据
    const handleAccountData = (data) => {
      const tokens = parseInt(data.totalTokens) || parseInt(data.tokens) || 0
      const inputTokens = parseInt(data.totalInputTokens) || parseInt(data.inputTokens) || 0
      const outputTokens = parseInt(data.totalOutputTokens) || parseInt(data.outputTokens) || 0
      const requests = parseInt(data.totalRequests) || parseInt(data.requests) || 0
      const cacheCreateTokens =
        parseInt(data.totalCacheCreateTokens) || parseInt(data.cacheCreateTokens) || 0
      const cacheReadTokens =
        parseInt(data.totalCacheReadTokens) || parseInt(data.cacheReadTokens) || 0
      const allTokens = parseInt(data.totalAllTokens) || parseInt(data.allTokens) || 0

      const actualAllTokens =
        allTokens || inputTokens + outputTokens + cacheCreateTokens + cacheReadTokens

      return {
        tokens,
        inputTokens,
        outputTokens,
        cacheCreateTokens,
        cacheReadTokens,
        allTokens: actualAllTokens,
        requests
      }
    }

    const totalData = handleAccountData(total)
    const dailyData = handleAccountData(daily)
    const monthlyData = handleAccountData(monthly)

    return {
      accountId,
      total: totalData,
      daily: dailyData,
      monthly: monthlyData,
      averages: {
        rpm: Math.round(avgRPM * 100) / 100,
        tpm: Math.round(avgTPM * 100) / 100,
        dailyRequests: Math.round((totalRequests / daysSinceCreated) * 100) / 100,
        dailyTokens: Math.round((totalTokens / daysSinceCreated) * 100) / 100
      }
    }
  }

  /**
   * 获取所有账户的使用统计
   * @returns {Promise<Array>} 所有账户使用统计数组
   */
  async getAllAccountsUsageStats() {
    try {
      // 获取所有Claude账户
      const accountKeys = await this.client.keys('claude_account:*')
      const accountStats = []

      for (const accountKey of accountKeys) {
        const accountId = accountKey.replace('claude_account:', '')
        const accountData = await this.client.hgetall(accountKey)

        if (accountData.name) {
          const stats = await this.getAccountUsageStats(accountId)
          accountStats.push({
            id: accountId,
            name: accountData.name,
            email: accountData.email || '',
            status: accountData.status || 'unknown',
            isActive: accountData.isActive === 'true',
            ...stats
          })
        }
      }

      // 按当日token使用量排序
      accountStats.sort((a, b) => (b.daily.allTokens || 0) - (a.daily.allTokens || 0))

      return accountStats
    } catch (error) {
      logger.error('❌ Failed to get all accounts usage stats:', error)
      return []
    }
  }

  /**
   * 清空所有API Key的使用统计数据
   * @returns {Promise<Object>} 清理统计结果
   */
  async resetAllUsageStats() {
    const client = this.getClientSafe()
    const stats = {
      deletedKeys: 0,
      deletedDailyKeys: 0,
      deletedMonthlyKeys: 0,
      resetApiKeys: 0
    }

    try {
      // 获取所有API Key ID
      const apiKeyIds = []
      const apiKeyKeys = await client.keys('apikey:*')

      for (const key of apiKeyKeys) {
        if (key === 'apikey:hash_map') {
          continue
        } // 跳过哈希映射表
        const keyId = key.replace('apikey:', '')
        apiKeyIds.push(keyId)
      }

      // 清空每个API Key的使用统计
      for (const keyId of apiKeyIds) {
        // 删除总体使用统计
        const usageKey = `usage:${keyId}`
        const deleted = await client.del(usageKey)
        if (deleted > 0) {
          stats.deletedKeys++
        }

        // 删除该API Key的每日统计（使用精确的keyId匹配）
        const dailyKeys = await client.keys(`usage:daily:${keyId}:*`)
        if (dailyKeys.length > 0) {
          await client.del(...dailyKeys)
          stats.deletedDailyKeys += dailyKeys.length
        }

        // 删除该API Key的每月统计（使用精确的keyId匹配）
        const monthlyKeys = await client.keys(`usage:monthly:${keyId}:*`)
        if (monthlyKeys.length > 0) {
          await client.del(...monthlyKeys)
          stats.deletedMonthlyKeys += monthlyKeys.length
        }

        // 重置API Key的lastUsedAt字段
        const keyData = await client.hgetall(`apikey:${keyId}`)
        if (keyData && Object.keys(keyData).length > 0) {
          keyData.lastUsedAt = ''
          await client.hmset(`apikey:${keyId}`, keyData)
          stats.resetApiKeys++
        }
      }

      // 额外清理：删除所有可能遗漏的usage相关键
      const allUsageKeys = await client.keys('usage:*')
      if (allUsageKeys.length > 0) {
        await client.del(...allUsageKeys)
        stats.deletedKeys += allUsageKeys.length
      }

      return stats
    } catch (error) {
      throw new Error(`Failed to reset usage stats: ${error.message}`)
    }
  }

  // ==================== 系统统计 (4个方法) ====================

  /**
   * 获取基础系统统计数据
   * @returns {Promise<Object>} 系统统计对象，包含API Key、Claude账户和使用记录的总数
   */
  async getSystemStats() {
    const keys = await Promise.all([
      this.client.keys('apikey:*'),
      this.client.keys('claude:account:*'),
      this.client.keys('usage:*')
    ])

    return {
      totalApiKeys: keys[0].length,
      totalClaudeAccounts: keys[1].length,
      totalUsageRecords: keys[2].length
    }
  }

  /**
   * 获取当日系统统计数据（复杂的批量Pipeline操作和兼容性处理）
   * @returns {Promise<Object>} 当日统计对象，包含请求数、Token数和API Key创建数
   */
  async getTodayStats() {
    try {
      const today = getDateStringInTimezone()
      const dailyKeys = await this.client.keys(`usage:daily:*:${today}`)

      let totalRequestsToday = 0
      let totalTokensToday = 0
      let totalInputTokensToday = 0
      let totalOutputTokensToday = 0
      let totalCacheCreateTokensToday = 0
      let totalCacheReadTokensToday = 0

      // 批量获取所有今日数据，提高性能
      if (dailyKeys.length > 0) {
        const pipeline = this.client.pipeline()
        dailyKeys.forEach((key) => pipeline.hgetall(key))
        const results = await pipeline.exec()

        for (const [error, dailyData] of results) {
          if (error || !dailyData) {
            continue
          }

          totalRequestsToday += parseInt(dailyData.requests) || 0
          const currentDayTokens = parseInt(dailyData.tokens) || 0
          totalTokensToday += currentDayTokens

          // 处理旧数据兼容性：如果有总token但没有输入输出分离，则使用总token作为输出token
          const inputTokens = parseInt(dailyData.inputTokens) || 0
          const outputTokens = parseInt(dailyData.outputTokens) || 0
          const cacheCreateTokens = parseInt(dailyData.cacheCreateTokens) || 0
          const cacheReadTokens = parseInt(dailyData.cacheReadTokens) || 0
          const totalTokensFromSeparate = inputTokens + outputTokens

          if (totalTokensFromSeparate === 0 && currentDayTokens > 0) {
            // 旧数据：没有输入输出分离，假设70%为输出，30%为输入（基于一般对话比例）
            totalOutputTokensToday += Math.round(currentDayTokens * 0.7)
            totalInputTokensToday += Math.round(currentDayTokens * 0.3)
          } else {
            // 新数据：使用实际的输入输出分离
            totalInputTokensToday += inputTokens
            totalOutputTokensToday += outputTokens
          }

          // 添加cache token统计
          totalCacheCreateTokensToday += cacheCreateTokens
          totalCacheReadTokensToday += cacheReadTokens
        }
      }

      // 获取今日创建的API Key数量（批量优化）
      const allApiKeys = await this.client.keys('apikey:*')
      let apiKeysCreatedToday = 0

      if (allApiKeys.length > 0) {
        const pipeline = this.client.pipeline()
        allApiKeys.forEach((key) => pipeline.hget(key, 'createdAt'))
        const results = await pipeline.exec()

        for (const [error, createdAt] of results) {
          if (!error && createdAt && createdAt.startsWith(today)) {
            apiKeysCreatedToday++
          }
        }
      }

      return {
        requestsToday: totalRequestsToday,
        tokensToday: totalTokensToday,
        inputTokensToday: totalInputTokensToday,
        outputTokensToday: totalOutputTokensToday,
        cacheCreateTokensToday: totalCacheCreateTokensToday,
        cacheReadTokensToday: totalCacheReadTokensToday,
        apiKeysCreatedToday
      }
    } catch (error) {
      logger.error('Error getting today stats:', error)
      return {
        requestsToday: 0,
        tokensToday: 0,
        inputTokensToday: 0,
        outputTokensToday: 0,
        cacheCreateTokensToday: 0,
        cacheReadTokensToday: 0,
        apiKeysCreatedToday: 0
      }
    }
  }

  /**
   * 获取系统级平均RPM/TPM计算（复杂的批量数据处理）
   * @returns {Promise<Object>} 系统平均值对象，包含RPM、TPM和Token分布数据
   */
  async getSystemAverages() {
    try {
      const allApiKeys = await this.client.keys('apikey:*')
      let totalRequests = 0
      let totalTokens = 0
      let totalInputTokens = 0
      let totalOutputTokens = 0
      let oldestCreatedAt = new Date()

      // 批量获取所有usage数据和key数据，提高性能
      const usageKeys = allApiKeys.map((key) => `usage:${key.replace('apikey:', '')}`)
      const pipeline = this.client.pipeline()

      // 添加所有usage查询
      usageKeys.forEach((key) => pipeline.hgetall(key))
      // 添加所有key数据查询
      allApiKeys.forEach((key) => pipeline.hgetall(key))

      const results = await pipeline.exec()
      const usageResults = results.slice(0, usageKeys.length)
      const keyResults = results.slice(usageKeys.length)

      for (let i = 0; i < allApiKeys.length; i++) {
        const totalData = usageResults[i][1] || {}
        const keyData = keyResults[i][1] || {}

        totalRequests += parseInt(totalData.totalRequests) || 0
        totalTokens += parseInt(totalData.totalTokens) || 0
        totalInputTokens += parseInt(totalData.totalInputTokens) || 0
        totalOutputTokens += parseInt(totalData.totalOutputTokens) || 0

        const createdAt = keyData.createdAt ? new Date(keyData.createdAt) : new Date()
        if (createdAt < oldestCreatedAt) {
          oldestCreatedAt = createdAt
        }
      }

      const now = new Date()
      // 保持与个人API Key计算一致的算法：按天计算然后转换为分钟
      const daysSinceOldest = Math.max(
        1,
        Math.ceil((now - oldestCreatedAt) / (1000 * 60 * 60 * 24))
      )
      const totalMinutes = daysSinceOldest * 24 * 60

      return {
        systemRPM: Math.round((totalRequests / totalMinutes) * 100) / 100,
        systemTPM: Math.round((totalTokens / totalMinutes) * 100) / 100,
        totalInputTokens,
        totalOutputTokens,
        totalTokens
      }
    } catch (error) {
      logger.error('Error getting system averages:', error)
      return {
        systemRPM: 0,
        systemTPM: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0
      }
    }
  }

  /**
   * 获取实时系统指标（基于滑动窗口的复杂计算逻辑）
   * @returns {Promise<Object>} 实时系统指标对象，包含实时RPM/TPM和窗口内详细统计
   */
  async getRealtimeSystemMetrics() {
    try {
      const configLocal = require('../../../config/config')
      const windowMinutes = configLocal.system.metricsWindow || 5

      const now = new Date()
      const currentMinute = Math.floor(now.getTime() / 60000)

      // 调试：打印当前时间和分钟时间戳
      logger.debug(
        `🔍 Realtime metrics - Current time: ${now.toISOString()}, Minute timestamp: ${currentMinute}`
      )

      // 使用Pipeline批量获取窗口内的所有分钟数据
      const pipeline = this.client.pipeline()
      const minuteKeys = []
      for (let i = 0; i < windowMinutes; i++) {
        const minuteKey = `system:metrics:minute:${currentMinute - i}`
        minuteKeys.push(minuteKey)
        pipeline.hgetall(minuteKey)
      }

      logger.debug(`🔍 Realtime metrics - Checking keys: ${minuteKeys.join(', ')}`)

      const results = await pipeline.exec()

      // 聚合计算
      let totalRequests = 0
      let totalTokens = 0
      let totalInputTokens = 0
      let totalOutputTokens = 0
      let totalCacheCreateTokens = 0
      let totalCacheReadTokens = 0
      let validDataCount = 0

      results.forEach(([err, data], index) => {
        if (!err && data && Object.keys(data).length > 0) {
          validDataCount++
          totalRequests += parseInt(data.requests || 0)
          totalTokens += parseInt(data.totalTokens || 0)
          totalInputTokens += parseInt(data.inputTokens || 0)
          totalOutputTokens += parseInt(data.outputTokens || 0)
          totalCacheCreateTokens += parseInt(data.cacheCreateTokens || 0)
          totalCacheReadTokens += parseInt(data.cacheReadTokens || 0)

          logger.debug(`🔍 Realtime metrics - Key ${minuteKeys[index]} data:`, {
            requests: data.requests,
            totalTokens: data.totalTokens
          })
        }
      })

      logger.debug(
        `🔍 Realtime metrics - Valid data count: ${validDataCount}/${windowMinutes}, Total requests: ${totalRequests}, Total tokens: ${totalTokens}`
      )

      // 计算平均值（每分钟）
      const realtimeRPM =
        windowMinutes > 0 ? Math.round((totalRequests / windowMinutes) * 100) / 100 : 0
      const realtimeTPM =
        windowMinutes > 0 ? Math.round((totalTokens / windowMinutes) * 100) / 100 : 0

      const result = {
        realtimeRPM,
        realtimeTPM,
        windowMinutes,
        totalRequests,
        totalTokens,
        totalInputTokens,
        totalOutputTokens,
        totalCacheCreateTokens,
        totalCacheReadTokens
      }

      logger.debug('🔍 Realtime metrics - Final result:', result)

      return result
    } catch (error) {
      logger.error('Error getting realtime system metrics:', error)
      // 如果出错，返回历史平均值作为降级方案
      const historicalMetrics = await this.getSystemAverages()
      return {
        realtimeRPM: historicalMetrics.systemRPM,
        realtimeTPM: historicalMetrics.systemTPM,
        windowMinutes: 0, // 标识使用了历史数据
        totalRequests: 0,
        totalTokens: historicalMetrics.totalTokens,
        totalInputTokens: historicalMetrics.totalInputTokens,
        totalOutputTokens: historicalMetrics.totalOutputTokens,
        totalCacheCreateTokens: 0,
        totalCacheReadTokens: 0
      }
    }
  }

  // ==================== Claude 账户管理 (6个方法) ====================

  /**
   * 设置Claude账户数据（包含调度策略字段）
   * @param {string} accountId 账户ID
   * @param {Object} accountData 账户数据对象
   * @returns {Promise<void>}
   */
  async setClaudeAccount(accountId, accountData) {
    const key = `claude:account:${accountId}`

    // 确保新的调度策略字段有默认值
    const enrichedAccountData = {
      ...accountData,
      // 调度策略字段（向后兼容）
      schedulingStrategy: accountData.schedulingStrategy || 'least_recent',
      schedulingWeight: accountData.schedulingWeight || '1',
      sequentialOrder: accountData.sequentialOrder || '1',
      roundRobinIndex: accountData.roundRobinIndex || '0',
      usageCount: accountData.usageCount || '0',
      lastScheduledAt: accountData.lastScheduledAt || ''
    }

    await this.client.hmset(key, enrichedAccountData)
  }

  /**
   * 获取Claude账户数据（确保调度字段默认值）
   * @param {string} accountId 账户ID
   * @returns {Promise<Object>} 账户数据对象
   */
  async getClaudeAccount(accountId) {
    const key = `claude:account:${accountId}`
    const accountData = await this.client.hgetall(key)

    if (!accountData || Object.keys(accountData).length === 0) {
      return accountData
    }

    // 确保所有调度策略字段都有默认值（向后兼容）
    return {
      ...accountData,
      schedulingStrategy: accountData.schedulingStrategy || 'least_recent',
      schedulingWeight: accountData.schedulingWeight || '1',
      sequentialOrder: accountData.sequentialOrder || '1',
      roundRobinIndex: accountData.roundRobinIndex || '0',
      usageCount: accountData.usageCount || '0',
      lastScheduledAt: accountData.lastScheduledAt || ''
    }
  }

  /**
   * 获取所有Claude账户（批量默认值处理）
   * @returns {Promise<Array>} Claude账户列表
   */
  async getAllClaudeAccounts() {
    const keys = await this.client.keys('claude:account:*')
    const accounts = []
    for (const key of keys) {
      const accountData = await this.client.hgetall(key)
      if (accountData && Object.keys(accountData).length > 0) {
        // 确保所有调度策略字段都有默认值（向后兼容）
        const enrichedAccount = {
          id: key.replace('claude:account:', ''),
          ...accountData,
          schedulingStrategy: accountData.schedulingStrategy || 'least_recent',
          schedulingWeight: accountData.schedulingWeight || '1',
          sequentialOrder: accountData.sequentialOrder || '1',
          roundRobinIndex: accountData.roundRobinIndex || '0',
          usageCount: accountData.usageCount || '0',
          lastScheduledAt: accountData.lastScheduledAt || ''
        }
        accounts.push(enrichedAccount)
      }
    }
    return accounts
  }

  /**
   * 删除Claude账户
   * @param {string} accountId 账户ID
   * @returns {Promise<number>} 删除的记录数
   */
  async deleteClaudeAccount(accountId) {
    const key = `claude:account:${accountId}`
    return await this.client.del(key)
  }

  /**
   * 更新Claude账户调度相关字段
   * @param {string} accountId 账户ID
   * @param {Object} updates 更新的字段对象
   * @returns {Promise<void>}
   */
  async updateClaudeAccountSchedulingFields(accountId, updates) {
    const key = `claude:account:${accountId}`

    // 仅更新调度相关的字段
    const schedulingUpdates = {}

    if (updates.usageCount !== undefined) {
      schedulingUpdates.usageCount = updates.usageCount.toString()
    }

    if (updates.lastScheduledAt !== undefined) {
      schedulingUpdates.lastScheduledAt = updates.lastScheduledAt
    }

    if (updates.roundRobinIndex !== undefined) {
      schedulingUpdates.roundRobinIndex = updates.roundRobinIndex.toString()
    }

    if (Object.keys(schedulingUpdates).length > 0) {
      await this.client.hmset(key, schedulingUpdates)
    }
  }

  /**
   * 原子性增加Claude账户使用计数
   * @param {string} accountId 账户ID
   * @returns {Promise<number>} 增加后的使用计数
   */
  async incrementClaudeAccountUsageCount(accountId) {
    const key = `claude:account:${accountId}`
    return await this.client.hincrby(key, 'usageCount', 1)
  }

  // ==================== 会话管理 (12个方法) ====================

  /**
   * 设置会话数据
   * @param {string} sessionId 会话ID
   * @param {Object} sessionData 会话数据对象
   * @param {number} ttl 过期时间（秒），默认86400秒（1天）
   * @returns {Promise<void>}
   */
  async setSession(sessionId, sessionData, ttl = 86400) {
    try {
      const key = `session:${sessionId}`
      const client = await this.getClientWithReconnect()

      logger.info(`🔧 Setting session: ${sessionId}`) // 使用info级别确保能看到

      // 使用hmset方法，这是Redis兼容性最好的方式
      await client.hmset(key, sessionData)

      // 只有当ttl大于0时才设置过期时间
      if (ttl > 0) {
        await client.expire(key, ttl)
      }

      logger.info(`✅ Session set successfully: ${sessionId}`)
    } catch (error) {
      logger.error('❌ Failed to set session:', error)
      throw error
    }
  }

  /**
   * 获取会话数据
   * @param {string} sessionId 会话ID
   * @returns {Promise<Object>} 会话数据对象
   */
  async getSession(sessionId) {
    try {
      const client = await this.getClientWithReconnect()
      const key = `session:${sessionId}`
      return await client.hgetall(key)
    } catch (error) {
      logger.error('❌ Failed to get session:', error)
      return {}
    }
  }

  /**
   * 删除会话
   * @param {string} sessionId 会话ID
   * @returns {Promise<number>} 删除的记录数
   */
  async deleteSession(sessionId) {
    try {
      const key = `session:${sessionId}`
      const client = await this.getClientWithReconnect()
      return await client.del(key)
    } catch (error) {
      logger.error('❌ Failed to delete session:', error)
      throw error
    }
  }

  /**
   * 设置API Key哈希索引
   * @param {string} hashedKey 哈希后的Key值
   * @param {Object} keyData API Key数据
   * @param {number} ttl 过期时间（秒），默认0表示不过期
   * @returns {Promise<void>}
   */
  async setApiKeyHash(hashedKey, keyData, ttl = 0) {
    const key = `apikey_hash:${hashedKey}`
    const client = this.getClientSafe()
    await client.hmset(key, keyData)
    if (ttl > 0) {
      await client.expire(key, ttl)
    }
  }

  /**
   * 获取API Key哈希索引数据
   * @param {string} hashedKey 哈希后的Key值
   * @returns {Promise<Object>} API Key数据对象
   */
  async getApiKeyHash(hashedKey) {
    const key = `apikey_hash:${hashedKey}`
    return await this.client.hgetall(key)
  }

  /**
   * 删除API Key哈希索引
   * @param {string} hashedKey 哈希后的Key值
   * @returns {Promise<number>} 删除的记录数
   */
  async deleteApiKeyHash(hashedKey) {
    const key = `apikey_hash:${hashedKey}`
    return await this.client.del(key)
  }

  /**
   * 设置OAuth会话数据（包含复杂对象序列化）
   * @param {string} sessionId 会话ID
   * @param {Object} sessionData 会话数据对象
   * @param {number} ttl 过期时间（秒），默认600秒（10分钟）
   * @returns {Promise<void>}
   */
  async setOAuthSession(sessionId, sessionData, ttl = 600) {
    const key = `oauth:${sessionId}`
    const client = this.getClientSafe()

    // 序列化复杂对象，特别是 proxy 配置
    const serializedData = {}
    for (const [dataKey, value] of Object.entries(sessionData)) {
      if (typeof value === 'object' && value !== null) {
        serializedData[dataKey] = JSON.stringify(value)
      } else {
        serializedData[dataKey] = value
      }
    }

    await client.hmset(key, serializedData)
    await client.expire(key, ttl)
  }

  /**
   * 获取OAuth会话数据（包含复杂对象反序列化）
   * @param {string} sessionId 会话ID
   * @returns {Promise<Object>} OAuth会话数据对象
   */
  async getOAuthSession(sessionId) {
    const key = `oauth:${sessionId}`
    const data = await this.client.hgetall(key)

    // 反序列化 proxy 字段
    if (data.proxy) {
      try {
        data.proxy = JSON.parse(data.proxy)
      } catch (error) {
        // 如果解析失败，设置为 null
        data.proxy = null
      }
    }

    return data
  }

  /**
   * 删除OAuth会话
   * @param {string} sessionId 会话ID
   * @returns {Promise<number>} 删除的记录数
   */
  async deleteOAuthSession(sessionId) {
    const key = `oauth:${sessionId}`
    return await this.client.del(key)
  }

  /**
   * 设置会话账户映射（Sticky Session）
   * @param {string} sessionHash 会话哈希
   * @param {string} accountId 账户ID
   * @param {number} ttl 过期时间（秒），默认3600秒（1小时）
   * @returns {Promise<void>}
   */
  async setSessionAccountMapping(sessionHash, accountId, ttl = 3600) {
    const key = `sticky_session:${sessionHash}`
    const client = this.getClientSafe()
    await client.set(key, accountId, 'EX', ttl)
  }

  /**
   * 获取会话账户映射（Sticky Session）
   * @param {string} sessionHash 会话哈希
   * @returns {Promise<string|null>} 账户ID或null
   */
  async getSessionAccountMapping(sessionHash) {
    const key = `sticky_session:${sessionHash}`
    return await this.client.get(key)
  }

  /**
   * 删除会话账户映射（Sticky Session）
   * @param {string} sessionHash 会话哈希
   * @returns {Promise<number>} 删除的记录数
   */
  async deleteSessionAccountMapping(sessionHash) {
    const key = `sticky_session:${sessionHash}`
    return await this.client.del(key)
  }

  // ==================== 维护功能 (4个方法) ====================

  /**
   * 系统清理功能，包含批量键查询和TTL设置逻辑
   * 用于清理过期数据，确保数据库健康运行
   * @returns {Promise<void>}
   */
  async cleanup() {
    try {
      const patterns = ['usage:daily:*', 'ratelimit:*', 'session:*', 'sticky_session:*', 'oauth:*']

      for (const pattern of patterns) {
        const keys = await this.client.keys(pattern)
        const pipeline = this.client.pipeline()

        for (const key of keys) {
          const ttl = await this.client.ttl(key)
          if (ttl === -1) {
            // 没有设置过期时间的键
            if (key.startsWith('oauth:')) {
              pipeline.expire(key, 600) // OAuth会话设置10分钟过期
            } else {
              pipeline.expire(key, 86400) // 其他设置1天过期
            }
          }
        }

        await pipeline.exec()
      }

      logger.info('🧹 Redis cleanup completed')
    } catch (error) {
      logger.error('❌ Redis cleanup failed:', error)
    }
  }

  /**
   * 增加并发计数，包含过期时间设置
   * 用于跟踪API Key的并发请求数量
   * @param {string} apiKeyId API Key ID
   * @returns {Promise<number>} 增加后的并发计数
   */
  async incrConcurrency(apiKeyId) {
    try {
      const key = `concurrency:${apiKeyId}`
      const count = await this.client.incr(key)

      // 设置过期时间为180秒（3分钟），防止计数器永远不清零
      // 正常情况下请求会在完成时主动减少计数，这只是一个安全保障
      // 180秒足够支持较长的流式请求
      await this.client.expire(key, 180)

      logger.database(`🔢 Incremented concurrency for key ${apiKeyId}: ${count}`)
      return count
    } catch (error) {
      logger.error('❌ Failed to increment concurrency:', error)
      throw error
    }
  }

  /**
   * 减少并发计数，使用Lua脚本确保原子性操作
   * 防止计数器变成负数，确保并发计数的准确性
   * @param {string} apiKeyId API Key ID
   * @returns {Promise<number>} 减少后的并发计数
   */
  async decrConcurrency(apiKeyId) {
    try {
      const key = `concurrency:${apiKeyId}`

      // 使用Lua脚本确保原子性操作，防止计数器变成负数
      const luaScript = `
        local key = KEYS[1]
        local current = tonumber(redis.call('get', key) or "0")
        
        if current <= 0 then
          redis.call('del', key)
          return 0
        else
          local new_value = redis.call('decr', key)
          if new_value <= 0 then
            redis.call('del', key)
            return 0
          else
            return new_value
          end
        end
      `

      const count = await this.client.eval(luaScript, 1, key)
      logger.database(`🔢 Decremented concurrency for key ${apiKeyId}: ${count}`)
      return count
    } catch (error) {
      logger.error('❌ Failed to decrement concurrency:', error)
      throw error
    }
  }

  /**
   * 获取当前并发数
   * 用于检查API Key的当前并发请求数量
   * @param {string} apiKeyId API Key ID
   * @returns {Promise<number>} 当前并发数
   */
  async getConcurrency(apiKeyId) {
    try {
      const key = `concurrency:${apiKeyId}`
      const count = await this.client.get(key)
      return parseInt(count || 0)
    } catch (error) {
      logger.error('❌ Failed to get concurrency:', error)
      return 0
    }
  }

  // ==================== OpenAI 账户管理 (4个方法) ====================

  /**
   * 设置OpenAI账户数据
   * @param {string} accountId 账户ID
   * @param {Object} accountData 账户数据对象
   * @returns {Promise<void>}
   */
  async setOpenAiAccount(accountId, accountData) {
    const key = `openai:account:${accountId}`

    // 确保新的调度策略字段有默认值
    const enrichedAccountData = {
      ...accountData,
      // 调度策略字段（向后兼容）
      schedulingStrategy: accountData.schedulingStrategy || 'least_recent',
      schedulingWeight: accountData.schedulingWeight || '1',
      sequentialOrder: accountData.sequentialOrder || '1',
      roundRobinIndex: accountData.roundRobinIndex || '0',
      usageCount: accountData.usageCount || '0',
      lastScheduledAt: accountData.lastScheduledAt || ''
    }

    await this.client.hmset(key, enrichedAccountData)
  }

  /**
   * 获取OpenAI账户数据
   * @param {string} accountId 账户ID
   * @returns {Promise<Object>} 账户数据对象
   */
  async getOpenAiAccount(accountId) {
    const key = `openai:account:${accountId}`
    const accountData = await this.client.hgetall(key)

    if (!accountData || Object.keys(accountData).length === 0) {
      return accountData
    }

    // 确保所有调度策略字段都有默认值（向后兼容）
    return {
      ...accountData,
      schedulingStrategy: accountData.schedulingStrategy || 'least_recent',
      schedulingWeight: accountData.schedulingWeight || '1',
      sequentialOrder: accountData.sequentialOrder || '1',
      roundRobinIndex: accountData.roundRobinIndex || '0',
      usageCount: accountData.usageCount || '0',
      lastScheduledAt: accountData.lastScheduledAt || ''
    }
  }

  /**
   * 删除OpenAI账户
   * @param {string} accountId 账户ID
   * @returns {Promise<number>} 删除的记录数
   */
  async deleteOpenAiAccount(accountId) {
    const key = `openai:account:${accountId}`
    return await this.client.del(key)
  }

  /**
   * 获取所有OpenAI账户
   * @returns {Promise<Array>} OpenAI账户列表
   */
  async getAllOpenAIAccounts() {
    const keys = await this.client.keys('openai:account:*')
    const accounts = []
    for (const key of keys) {
      const accountData = await this.client.hgetall(key)
      if (accountData && Object.keys(accountData).length > 0) {
        // 确保所有调度策略字段都有默认值（向后兼容）
        const enrichedAccount = {
          id: key.replace('openai:account:', ''),
          ...accountData,
          schedulingStrategy: accountData.schedulingStrategy || 'least_recent',
          schedulingWeight: accountData.schedulingWeight || '1',
          sequentialOrder: accountData.sequentialOrder || '1',
          roundRobinIndex: accountData.roundRobinIndex || '0',
          usageCount: accountData.usageCount || '0',
          lastScheduledAt: accountData.lastScheduledAt || ''
        }
        accounts.push(enrichedAccount)
      }
    }
    return accounts
  }

  // ==================== 配置管理 (3个方法) ====================

  /**
   * 设置系统调度配置
   * @param {Object} configData 配置数据对象
   * @returns {Promise<void>}
   * @throws {Error} 配置数据无效时抛出错误
   */
  async setSystemSchedulingConfig(configData) {
    const key = 'system:scheduling_config'
    const client = this.getClientSafe()

    // 验证配置数据
    if (!configData || typeof configData !== 'object' || Object.keys(configData).length === 0) {
      throw new Error('Invalid configuration data provided')
    }

    // 使用hset方法设置多个hash字段
    await client.hmset(key, configData)
    logger.info('📝 System scheduling configuration updated')
  }

  /**
   * 获取系统调度配置（包含默认配置回退逻辑）
   * @returns {Promise<Object>} 系统调度配置对象
   */
  async getSystemSchedulingConfig() {
    const key = 'system:scheduling_config'
    const schedulingConfig = await this.client.hgetall(key)

    // 返回默认配置如果没有存储的配置
    if (!schedulingConfig || Object.keys(schedulingConfig).length === 0) {
      const defaultConfig = {
        defaultStrategy: 'least_recent',
        enableAccountOverride: 'true',
        enableGroupOverride: 'true'
      }

      // 保存默认配置到Redis
      await this.setSystemSchedulingConfig(defaultConfig)
      return defaultConfig
    }

    return schedulingConfig
  }

  /**
   * 删除系统调度配置
   * @returns {Promise<number>} 删除的记录数
   */
  async deleteSystemSchedulingConfig() {
    const key = 'system:scheduling_config'
    return await this.client.del(key)
  }
}

// 导出时区辅助函数
RedisAdapter.getDateInTimezone = getDateInTimezone
RedisAdapter.getDateStringInTimezone = getDateStringInTimezone
RedisAdapter.getHourInTimezone = getHourInTimezone

module.exports = RedisAdapter
