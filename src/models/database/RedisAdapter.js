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
const Decimal = require('decimal.js')
const CostCalculator = require('../../utils/costCalculator')

// 导入统一时区处理工具
const dateHelper = require('../../utils/dateHelper')

// 时区辅助函数（现在由 dateHelper 提供）
// 注意：这个函数的目的是获取某个时间点在目标时区的"本地"表示
// 例如：UTC时间 2025-07-30 01:00:00 在 UTC+8 时区表示为 2025-07-30 09:00:00
function getDateInTimezone(date = new Date()) {
  return dateHelper.getDateInTimezone(date)
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

  /**
   * Ping Redis服务器检查连接状态
   * @returns {Promise<string>} 返回'PONG'表示连接正常
   * @throws {Error} 连接失败时抛出错误
   */
  async ping() {
    try {
      const client = this.getClientSafe()
      const result = await client.ping()
      return result
    } catch (error) {
      logger.error('💥 Redis ping failed:', error)
      throw error
    }
  }

  // Redis版本兼容的hset方法（支持多字段设置）
  async hsetCompat(key, ...args) {
    const client = await this.getClientWithReconnect()

    // 如果参数是对象形式 hset(key, {field1: value1, field2: value2})
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
      const obj = args[0]
      const fields = Object.keys(obj)

      // 对于低版本Redis，使用pipeline逐一设置字段
      const pipeline = client.pipeline()
      for (const field of fields) {
        pipeline.hset(key, field, obj[field])
      }
      return await pipeline.exec()
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

    // 对于其他模型，去掉常见的版本后缀，包括1M上下文标识
    return model.replace(/-v\d+:\d+$|:latest$|\[\d+[a-zA-Z]*\]$|\[1M\]$/, '')
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
   * 获取指定时间段的模型小时使用统计
   * @param {string} keyId API Key ID
   * @param {Date} startDate 开始时间
   * @param {number} hours 小时数(默认24，最大168)
   * @returns {Promise<Array>} 小时统计数据数组
   */
  async getModelUsageHourly(keyId, startDate, hours = 24) {
    // 参数验证
    if (!keyId || typeof keyId !== 'string') {
      throw new Error('Invalid keyId parameter')
    }

    if (!(startDate instanceof Date)) {
      throw new Error('startDate must be a Date object')
    }

    if (typeof hours !== 'number' || hours < 1 || hours > 168) {
      throw new Error('Hours parameter must be between 1 and 168')
    }

    const hourlyStats = []

    try {
      // 生成所有需要查询的小时键
      const hourKeys = []
      for (let i = 0; i < hours; i++) {
        const currentDate = new Date(startDate.getTime() + i * 60 * 60 * 1000)
        const tzDate = getDateInTimezone(currentDate)
        const dateStr = getDateStringInTimezone(currentDate)
        const hourStr = String(tzDate.getUTCHours()).padStart(2, '0')
        const hourKey = `${dateStr}:${hourStr}`
        hourKeys.push({ hourKey, timestamp: currentDate.toISOString() })
      }

      // 使用Pipeline批量查询以提高性能
      const pipeline = this.client.pipeline()
      const queryMap = new Map()

      for (const { hourKey } of hourKeys) {
        // 查询该小时的所有模型数据
        const pattern = `usage:${keyId}:model:hourly:*:${hourKey}`
        pipeline.keys(pattern)
        queryMap.set(hourKey, pattern)
      }

      const patternResults = await pipeline.exec()

      // 处理每个小时的数据
      for (let i = 0; i < hourKeys.length; i++) {
        const { hourKey, timestamp } = hourKeys[i]
        const modelKeys = patternResults[i][1] || []

        const hourStat = {
          hour: hourKey,
          timestamp,
          models: {},
          totalTokens: 0,
          totalRequests: 0,
          totalCost: 0
        }

        if (modelKeys.length > 0) {
          // 批量获取该小时所有模型的详细数据
          const dataPipeline = this.client.pipeline()
          for (const modelKey of modelKeys) {
            dataPipeline.hgetall(modelKey)
          }

          const modelResults = await dataPipeline.exec()

          // 处理每个模型的数据
          for (let j = 0; j < modelKeys.length; j++) {
            const modelKey = modelKeys[j]
            const modelData = modelResults[j][1] || {}

            // 从键名提取模型名: usage:{keyId}:model:hourly:{model}:{hour}
            const modelMatch = modelKey.match(/usage:.+:model:hourly:(.+):\d{4}-\d{2}-\d{2}:\d{2}$/)
            if (!modelMatch || !modelData || Object.keys(modelData).length === 0) {
              continue
            }

            const modelName = modelMatch[1]
            const inputTokens = parseInt(modelData.inputTokens) || 0
            const outputTokens = parseInt(modelData.outputTokens) || 0
            const cacheCreateTokens = parseInt(modelData.cacheCreateTokens) || 0
            const cacheReadTokens = parseInt(modelData.cacheReadTokens) || 0
            const requests = parseInt(modelData.requests) || 0
            const totalModelTokens =
              inputTokens + outputTokens + cacheCreateTokens + cacheReadTokens

            // 计算模型费用
            const usage = {
              input_tokens: inputTokens,
              output_tokens: outputTokens,
              cache_creation_input_tokens: cacheCreateTokens,
              cache_read_input_tokens: cacheReadTokens
            }

            let modelCost = 0
            try {
              const costResult = CostCalculator.calculateCost(usage, modelName)
              modelCost = costResult.costs.total || 0
            } catch (error) {
              logger.warn(`Failed to calculate cost for model ${modelName}:`, error)
              modelCost = 0
            }

            // 添加到模型统计
            hourStat.models[modelName] = {
              tokens: totalModelTokens,
              inputTokens,
              outputTokens,
              cacheCreateTokens,
              cacheReadTokens,
              requests,
              cost: modelCost
            }

            // 累计到小时总计
            hourStat.totalTokens += totalModelTokens
            hourStat.totalRequests += requests
            hourStat.totalCost += modelCost
          }
        }

        hourlyStats.push(hourStat)
      }

      logger.debug(
        `📊 Retrieved hourly model stats for keyId: ${keyId}, hours: ${hours}, results: ${hourlyStats.length}`
      )
      return hourlyStats
    } catch (error) {
      logger.error(`❌ Failed to get hourly model usage for keyId ${keyId}:`, error)
      throw error
    }
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
   * 获取总费用
   * @param {string} keyId API Key ID
   * @returns {Promise<number>} 总费用
   */
  async getTotalCost(keyId) {
    const totalKey = `usage:cost:total:${keyId}`
    const cost = await this.client.get(totalKey)
    const result = parseFloat(cost || 0)
    logger.debug(
      `💰 Getting total cost for ${keyId}, key: ${totalKey}, value: ${cost}, result: ${result}`
    )
    return result
  }

  /**
   * 根据日期范围获取费用（用于周费用和月费用计算）
   * @param {string} keyId API Key ID
   * @param {Date} startDate 开始日期
   * @param {Date} endDate 结束日期
   * @returns {Promise<number>} 指定日期范围内的费用
   */
  async getCostByDateRange(keyId, startDate, endDate) {
    try {
      const dates = []
      const current = new Date(startDate)

      // 生成日期范围内的所有日期
      while (current <= endDate) {
        const dateString = current.toISOString().split('T')[0] // YYYY-MM-DD 格式
        dates.push(dateString)
        current.setDate(current.getDate() + 1)
      }

      // 如果日期范围超过30天，为了性能考虑，使用月度统计
      if (dates.length > 30) {
        logger.debug(`💰 Using monthly aggregation for large date range: ${dates.length} days`)

        const monthKeys = new Set()
        dates.forEach((date) => {
          const [year, month] = date.split('-')
          monthKeys.add(`usage:cost:monthly:${keyId}:${year}-${month}`)
        })

        const monthlyResults = await Promise.all(
          Array.from(monthKeys).map((key) => this.client.get(key))
        )

        const totalCost = monthlyResults.reduce((sum, cost) => sum + parseFloat(cost || 0), 0)
        logger.debug(
          `💰 Cost by date range (monthly): ${keyId}, ${startDate.toISOString()} to ${endDate.toISOString()}, result: $${totalCost}`
        )
        return totalCost
      }

      // 对于较小的日期范围，使用日度统计
      const dailyKeys = dates.map((date) => `usage:cost:daily:${keyId}:${date}`)
      const dailyResults = await Promise.all(dailyKeys.map((key) => this.client.get(key)))

      const totalCost = dailyResults.reduce((sum, cost) => sum + parseFloat(cost || 0), 0)
      logger.debug(
        `💰 Cost by date range (daily): ${keyId}, ${startDate.toISOString()} to ${endDate.toISOString()}, result: $${totalCost}`
      )
      return totalCost
    } catch (error) {
      logger.warn(`⚠️ Failed to get cost by date range for ${keyId}:`, error.message)
      return 0
    }
  }

  /**
   * 获取指定Claude账户的每日费用
   * @param {string} accountId - Claude账户ID
   * @param {Date} date - 日期（可选，默认今天）
   * @returns {Promise<number>} 账户每日费用
   */
  async getAccountDailyCost(accountId, date = new Date()) {
    try {
      // 参数验证
      if (!accountId || typeof accountId !== 'string') {
        throw new Error('Invalid accountId: must be a non-empty string')
      }
      if (!(date instanceof Date) && date !== null && date !== undefined) {
        throw new Error('Invalid date: must be a Date object or null/undefined')
      }

      // 确保date是有效的Date对象
      const targetDate = date || new Date()

      // 使用时区转换函数获取日期字符串
      const dateString = getDateStringInTimezone(targetDate)
      const costKey = `usage:cost:daily:account:${accountId}:${dateString}`

      const cost = await this.client.get(costKey)

      // 使用Decimal.js确保精度
      const result = new Decimal(cost || 0).toNumber()

      logger.debug(
        `💰 Getting account daily cost for ${accountId}, date: ${dateString}, key: ${costKey}, result: $${result.toFixed(6)}`
      )

      return result
    } catch (error) {
      logger.error(`❌ Failed to get account daily cost for ${accountId}:`, error)
      // 降级处理 - 返回0而不是抛出错误
      return 0
    }
  }

  /**
   * 根据日期范围获取账户费用
   * @param {string} accountId 账户ID
   * @param {Date} startDate 开始日期
   * @param {Date} endDate 结束日期
   * @returns {Promise<number>} 指定日期范围内的账户费用
   */
  async getAccountCostByDateRange(accountId, startDate, endDate) {
    try {
      const dates = []
      const current = new Date(startDate)

      // 生成日期范围内的所有日期，使用时区转换
      while (current <= endDate) {
        const dateString = getDateStringInTimezone(current)
        dates.push(dateString)
        current.setDate(current.getDate() + 1)
      }

      // 如果日期范围超过30天，为了性能考虑，使用月度统计
      if (dates.length > 30) {
        logger.debug(
          `💰 Using monthly aggregation for account ${accountId} large date range: ${dates.length} days`
        )

        const monthKeys = new Set()
        dates.forEach((date) => {
          const [year, month] = date.split('-')
          monthKeys.add(`usage:cost:monthly:account:${accountId}:${year}-${month}`)
        })

        // 并行获取月度数据
        const monthCosts = await Promise.all(
          Array.from(monthKeys).map(async (key) => {
            const cost = await this.client.get(key)
            return parseFloat(cost || 0)
          })
        )

        const totalCost = monthCosts.reduce((sum, cost) => sum + cost, 0)
        logger.debug(
          `💰 Account ${accountId} cost by date range (monthly): $${totalCost.toFixed(6)}`
        )
        return totalCost
      }

      // 对于较小的日期范围，使用每日统计
      const dailyKeys = dates.map((date) => `usage:cost:daily:account:${accountId}:${date}`)

      // 并行获取每日费用数据
      const dailyCosts = await Promise.all(
        dailyKeys.map(async (key) => {
          const cost = await this.client.get(key)
          return parseFloat(cost || 0)
        })
      )

      const totalCost = dailyCosts.reduce((sum, cost) => sum + cost, 0)
      logger.debug(
        `💰 Account ${accountId} cost by date range (${dates.length} days): $${totalCost.toFixed(6)}`
      )
      return totalCost
    } catch (error) {
      logger.warn(`⚠️ Failed to get account cost by date range for ${accountId}:`, error.message)
      return 0
    }
  }

  /**
   * 增量更新账户费用
   * @param {string} accountId - Claude账户ID
   * @param {number} amount - 费用增量
   * @param {string} model - 模型名称
   * @returns {Promise<number>} 更新后的费用
   */
  async incrementAccountCost(accountId, amount, model) {
    try {
      // 参数验证
      if (!accountId || typeof accountId !== 'string') {
        throw new Error('Invalid accountId: must be a non-empty string')
      }
      if (typeof amount !== 'number' || amount < 0) {
        throw new Error('Invalid amount: must be a non-negative number')
      }
      if (!model || typeof model !== 'string') {
        throw new Error('Invalid model: must be a non-empty string')
      }

      // 使用Decimal.js确保精度
      const preciseAmount = new Decimal(amount)

      const now = new Date()
      const tzDate = getDateInTimezone(now)
      const dateString = getDateStringInTimezone(now)
      const currentMonth = `${tzDate.getUTCFullYear()}-${String(tzDate.getUTCMonth() + 1).padStart(2, '0')}`
      const currentHour = `${dateString}:${String(tzDate.getUTCHours()).padStart(2, '0')}`

      // Redis键结构
      const dailyKey = `usage:cost:daily:account:${accountId}:${dateString}`
      const monthlyKey = `usage:cost:monthly:account:${accountId}:${currentMonth}`
      const hourlyKey = `usage:cost:hourly:account:${accountId}:${currentHour}`
      const totalKey = `usage:cost:total:account:${accountId}`

      // 模型级别的费用统计
      const modelDailyKey = `usage:cost:daily:account:${accountId}:${model}:${dateString}`
      const modelMonthlyKey = `usage:cost:monthly:account:${accountId}:${model}:${currentMonth}`

      logger.debug(
        `💰 Incrementing account cost for ${accountId}, amount: $${preciseAmount.toString()}, model: ${model}, date: ${dateString}`
      )

      // 使用Pipeline批量操作确保原子性
      const pipeline = this.client.pipeline()

      // 基础费用统计
      pipeline.incrbyfloat(dailyKey, preciseAmount.toNumber())
      pipeline.incrbyfloat(monthlyKey, preciseAmount.toNumber())
      pipeline.incrbyfloat(hourlyKey, preciseAmount.toNumber())
      pipeline.incrbyfloat(totalKey, preciseAmount.toNumber())

      // 模型级别费用统计
      pipeline.incrbyfloat(modelDailyKey, preciseAmount.toNumber())
      pipeline.incrbyfloat(modelMonthlyKey, preciseAmount.toNumber())

      // 设置过期时间
      pipeline.expire(dailyKey, 86400 * 32) // 32天
      pipeline.expire(monthlyKey, 86400 * 365) // 1年
      pipeline.expire(hourlyKey, 86400 * 7) // 7天
      pipeline.expire(modelDailyKey, 86400 * 32) // 32天
      pipeline.expire(modelMonthlyKey, 86400 * 365) // 1年

      const results = await pipeline.exec()

      // 检查执行结果
      const dailyResult = results[0]
      if (dailyResult[0]) {
        logger.error(`❌ Failed to increment daily cost for ${accountId}:`, dailyResult[0])
        throw dailyResult[0]
      }

      const newDailyTotal = parseFloat(dailyResult[1]) || 0

      logger.debug(
        `💰 Account cost incremented successfully for ${accountId}, model: ${model}, new daily total: $${newDailyTotal.toFixed(6)}`
      )

      return newDailyTotal
    } catch (error) {
      logger.error(`❌ Failed to increment account cost for ${accountId}:`, error)
      // 降级处理 - 返回0而不是抛出错误
      return 0
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

    // 获取账户创建时间来计算平均值（支持多种账户类型）
    const accountPrefixes = [
      `claude:account:${accountId}`,
      `claude_console_account:${accountId}`,
      `gemini:account:${accountId}`,
      `openai:account:${accountId}`,
      `bedrock:account:${accountId}`,
      `azure_openai:account:${accountId}`
    ]

    let createdAt = new Date()
    let accountData = null

    // 依次尝试不同的账户类型前缀
    for (const prefix of accountPrefixes) {
      try {
        accountData = await this.client.hgetall(prefix)
        if (accountData && accountData.createdAt) {
          createdAt = new Date(accountData.createdAt)
          logger.debug(`✅ Found account data for ${accountId} with prefix: ${prefix}`)
          break
        }
      } catch (error) {
        logger.debug(`⚠️ Failed to get account data with prefix ${prefix}:`, error.message)
      }
    }

    if (!accountData || !accountData.createdAt) {
      logger.debug(`ℹ️ No creation time found for account ${accountId}, using current time`)
    }

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
      logger.debug('🔍 Starting to get all accounts usage stats with batch optimization...')

      // 批量获取所有账户类型的键名
      const [claudeKeys, consoleKeys, geminiKeys, openaiKeys, bedrockKeys, azureKeys] =
        await Promise.all([
          this.client.keys('claude:account:*'),
          this.client.keys('claude_console_account:*'),
          this.client.keys('gemini:account:*'),
          this.client.keys('openai:account:*'),
          this.client.keys('bedrock:account:*'),
          this.client.keys('azure_openai:account:*')
        ])

      logger.debug(
        `📊 Found accounts: Claude=${claudeKeys.length}, Console=${consoleKeys.length}, Gemini=${geminiKeys.length}, OpenAI=${openaiKeys.length}, Bedrock=${bedrockKeys.length}, Azure=${azureKeys.length}`
      )

      // 合并所有键，并标记类型
      const allAccountKeys = [
        ...claudeKeys.map((key) => ({ key, type: 'claude', prefix: 'claude:account:' })),
        ...consoleKeys.map((key) => ({
          key,
          type: 'claude_console',
          prefix: 'claude_console_account:'
        })),
        ...geminiKeys.map((key) => ({ key, type: 'gemini', prefix: 'gemini:account:' })),
        ...openaiKeys.map((key) => ({ key, type: 'openai', prefix: 'openai:account:' })),
        ...bedrockKeys.map((key) => ({ key, type: 'bedrock', prefix: 'bedrock:account:' })),
        ...azureKeys.map((key) => ({ key, type: 'azure_openai', prefix: 'azure_openai:account:' }))
      ]

      if (allAccountKeys.length === 0) {
        logger.debug('ℹ️ No accounts found')
        return []
      }

      // 批量获取所有账户数据
      logger.debug(`📦 Batch fetching data for ${allAccountKeys.length} accounts...`)
      const pipeline = this.client.pipeline()
      allAccountKeys.forEach(({ key }) => pipeline.hgetall(key))
      const accountDataResults = await pipeline.exec()

      // 过滤有效账户并准备批量获取使用统计
      const validAccounts = []
      accountDataResults.forEach(([err, data], index) => {
        if (!err && data && (data.name || data.email)) {
          const { key, type, prefix } = allAccountKeys[index]
          const accountId = key.replace(prefix, '')

          validAccounts.push({
            id: accountId,
            data,
            type,
            name: data.name || data.email || accountId,
            email: data.email || '',
            status: data.status || 'unknown',
            isActive: data.isActive === 'true'
          })
        }
      })

      logger.debug(`✅ Found ${validAccounts.length} valid accounts, getting usage stats...`)

      // 并行获取所有账户的使用统计
      const statsPromises = validAccounts.map((account) =>
        this.getAccountUsageStats(account.id).catch((error) => {
          logger.warn(`⚠️ Failed to get stats for account ${account.id}:`, error.message)
          return {
            total: { allTokens: 0, requests: 0 },
            daily: { allTokens: 0, requests: 0 },
            monthly: { allTokens: 0, requests: 0 },
            averages: { rpm: 0, tpm: 0 }
          }
        })
      )

      const statsResults = await Promise.all(statsPromises)

      // 组合结果
      const accountStats = validAccounts.map((account, index) => ({
        id: account.id,
        name: account.name,
        email: account.email,
        status: account.status,
        isActive: account.isActive,
        accountType: account.type,
        ...statsResults[index]
      }))

      // 按当日token使用量排序
      accountStats.sort((a, b) => (b.daily?.allTokens || 0) - (a.daily?.allTokens || 0))

      logger.debug(
        `🎉 Successfully processed ${accountStats.length} accounts with batch optimization`
      )
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

  /**
   * 获取账户会话窗口使用统计
   * @param {string} accountId 账户ID
   * @param {string} windowStart 窗口开始时间（ISO字符串）
   * @param {string} windowEnd 窗口结束时间（ISO字符串）
   * @returns {Promise<Object>} 会话窗口使用统计
   */
  async getSessionWindowUsage(accountId, windowStart, windowEnd) {
    let retries = 0
    const maxRetries = 3

    while (retries < maxRetries) {
      try {
        // 参数验证和清理（这些错误不应该重试）
        if (!accountId || typeof accountId !== 'string') {
          throw new Error('Invalid accountId parameter')
        }
        if (!windowStart || !windowEnd) {
          throw new Error('Invalid time window parameters')
        }

        const startDate = new Date(windowStart)
        const endDate = new Date(windowEnd)

        // 验证时间窗口的有效性（这些错误不应该重试）
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          throw new Error('Invalid date format in time window')
        }
        if (startDate >= endDate) {
          throw new Error('Start date must be before end date')
        }

        // 限制时间窗口大小以防止过大查询
        const windowSizeHours = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60)
        if (windowSizeHours > 24 * 7) {
          // 限制为一周
          logger.warn(
            `⚠️ Large time window detected: ${windowSizeHours} hours for account ${accountId}`
          )
        }

        // 添加日志以调试时间窗口
        logger.debug(
          `📊 Getting session window usage for account ${accountId} (attempt ${retries + 1}/${maxRetries})`
        )
        logger.debug(`   Window: ${windowStart} to ${windowEnd}`)
        logger.debug(`   Start UTC: ${startDate.toISOString()}, End UTC: ${endDate.toISOString()}`)

        // 获取窗口内所有可能的小时键
        // 重要：需要使用配置的时区来构建键名，因为数据存储时使用的是配置时区
        const hourlyKeys = []
        const currentHour = new Date(startDate)
        currentHour.setMinutes(0)
        currentHour.setSeconds(0)
        currentHour.setMilliseconds(0)

        while (currentHour <= endDate) {
          try {
            // 使用时区转换函数来获取正确的日期和小时
            const tzDateStr = getDateStringInTimezone(currentHour)
            const tzHour = String(getHourInTimezone(currentHour)).padStart(2, '0')
            const key = `account_usage:hourly:${accountId}:${tzDateStr}:${tzHour}`

            logger.debug(`   Adding hourly key: ${key}`)
            hourlyKeys.push(key)
            currentHour.setHours(currentHour.getHours() + 1)
          } catch (timeZoneError) {
            logger.warn(
              `⚠️ Failed to process hour ${currentHour.toISOString()}:`,
              timeZoneError.message
            )
            currentHour.setHours(currentHour.getHours() + 1)
            continue
          }
        }

        if (hourlyKeys.length === 0) {
          logger.debug('   No hourly keys to check, returning empty usage')
          return this._getEmptySessionUsage()
        }

        logger.debug(`   Total hourly keys to check: ${hourlyKeys.length}`)

        // 使用连接重试机制获取Redis客户端
        const client = await this.getClientWithReconnect()

        let results = []
        try {
          // 批量获取所有小时数据，添加超时保护
          const pipeline = client.pipeline()
          hourlyKeys.forEach((key) => {
            pipeline.hgetall(key)
          })

          // 添加管道执行超时
          const pipelinePromise = pipeline.exec()
          const timeoutPromise = new Promise(
            (_, reject) => setTimeout(() => reject(new Error('Pipeline execution timeout')), 30000) // 30秒超时
          )

          results = await Promise.race([pipelinePromise, timeoutPromise])
          logger.debug(`   Successfully retrieved ${results.length} hourly results`)
        } catch (pipelineError) {
          logger.error(
            `❌ Pipeline execution failed (attempt ${retries + 1}):`,
            pipelineError.message
          )
          throw pipelineError
        }

        // 聚合数据（增强错误处理）
        let totalInputTokens = 0
        let totalOutputTokens = 0
        let totalCacheCreateTokens = 0
        let totalCacheReadTokens = 0
        let totalAllTokens = 0
        let totalRequests = 0
        const modelUsage = {}

        logger.debug(`   Processing ${results.length} hourly results`)

        try {
          for (const [error, data] of results) {
            if (error) {
              logger.debug(`   Skipping result due to error: ${error.message}`)
              continue
            }

            if (!data || Object.keys(data).length === 0) {
              continue
            }

            try {
              // 处理总计数据（修复字段名不一致问题），增强数据验证
              const hourInputTokens = Math.max(0, parseInt(data.inputTokens || 0))
              const hourOutputTokens = Math.max(0, parseInt(data.outputTokens || 0))
              const hourCacheCreateTokens = Math.max(0, parseInt(data.cacheCreateTokens || 0))
              const hourCacheReadTokens = Math.max(0, parseInt(data.cacheReadTokens || 0))
              const hourAllTokens = Math.max(0, parseInt(data.allTokens || 0))
              const hourRequests = Math.max(0, parseInt(data.requests || 0))

              totalInputTokens += hourInputTokens
              totalOutputTokens += hourOutputTokens
              totalCacheCreateTokens += hourCacheCreateTokens
              totalCacheReadTokens += hourCacheReadTokens
              totalAllTokens += hourAllTokens
              totalRequests += hourRequests

              if (hourAllTokens > 0) {
                logger.debug(`   Hour data: allTokens=${hourAllTokens}, requests=${hourRequests}`)
              }
            } catch (dataProcessError) {
              logger.warn(`⚠️ Failed to process hour data:`, dataProcessError.message)
              // 继续处理其他小时的数据，不中断整个流程
            }
          }
        } catch (aggregationError) {
          logger.error(`❌ Data aggregation failed:`, aggregationError.message)
          throw aggregationError
        }

        // 获取窗口内的模型使用数据（从独立的模型键中）
        logger.debug(`🔍 Getting model-specific usage data for window...`)
        const modelKeys = []
        const modelHour = new Date(startDate)
        modelHour.setMinutes(0, 0, 0)

        try {
          while (modelHour <= endDate) {
            try {
              const tzDateStr = getDateStringInTimezone(modelHour)
              const tzHour = String(getHourInTimezone(modelHour)).padStart(2, '0')
              const hourStr = `${tzDateStr}:${tzHour}`

              // 获取所有可能的模型键，添加超时保护
              const modelPattern = `account_usage:model:hourly:${accountId}:*:${hourStr}`

              try {
                const keysPromise = client.keys(modelPattern)
                const keysTimeout = new Promise(
                  (_, reject) =>
                    setTimeout(() => reject(new Error('Model keys query timeout')), 10000) // 10秒超时
                )

                const foundModelKeys = await Promise.race([keysPromise, keysTimeout])
                modelKeys.push(...foundModelKeys)
                logger.debug(`   Found ${foundModelKeys.length} model keys for hour ${hourStr}`)
              } catch (keyError) {
                logger.warn(`⚠️ Failed to get model keys for hour ${hourStr}:`, keyError.message)
                // 继续处理下一个小时，不中断整个流程
              }

              modelHour.setHours(modelHour.getHours() + 1)
            } catch (hourProcessError) {
              logger.warn(
                `⚠️ Failed to process model hour ${modelHour.toISOString()}:`,
                hourProcessError.message
              )
              modelHour.setHours(modelHour.getHours() + 1)
              continue
            }
          }
        } catch (modelKeysError) {
          logger.error(`❌ Model keys collection failed:`, modelKeysError.message)
          // 不中断主流程，模型数据为可选数据
        }

        // 批量获取模型数据（增强错误处理）
        if (modelKeys.length > 0) {
          logger.debug(`📊 Processing ${modelKeys.length} model keys...`)
          try {
            // 添加模型数据管道超时保护
            const modelPipeline = client.pipeline()
            modelKeys.forEach((key) => modelPipeline.hgetall(key))

            const modelPipelinePromise = modelPipeline.exec()
            const modelTimeoutPromise = new Promise(
              (_, reject) =>
                setTimeout(() => reject(new Error('Model pipeline execution timeout')), 20000) // 20秒超时
            )

            const modelResults = await Promise.race([modelPipelinePromise, modelTimeoutPromise])

            let processedModels = 0
            let skippedModels = 0

            modelResults.forEach(([err, data], index) => {
              if (err) {
                logger.debug(`   Skipping model result ${index} due to error: ${err.message}`)
                skippedModels++
                return
              }

              if (!data || Object.keys(data).length === 0) {
                return
              }

              try {
                // 从键名中提取模型名: account_usage:model:hourly:accountId:modelName:hour
                const keyParts = modelKeys[index].split(':')
                if (keyParts.length < 5) {
                  logger.warn(`⚠️ Invalid model key format: ${modelKeys[index]}`)
                  skippedModels++
                  return
                }

                const modelName = keyParts[4] // 模型名在第5个位置（索引4）

                if (!modelUsage[modelName]) {
                  modelUsage[modelName] = {
                    inputTokens: 0,
                    outputTokens: 0,
                    cacheCreateTokens: 0,
                    cacheReadTokens: 0,
                    allTokens: 0,
                    requests: 0
                  }
                }

                // 增强数据验证和处理
                modelUsage[modelName].inputTokens += Math.max(0, parseInt(data.inputTokens || 0))
                modelUsage[modelName].outputTokens += Math.max(0, parseInt(data.outputTokens || 0))
                modelUsage[modelName].cacheCreateTokens += Math.max(
                  0,
                  parseInt(data.cacheCreateTokens || 0)
                )
                modelUsage[modelName].cacheReadTokens += Math.max(
                  0,
                  parseInt(data.cacheReadTokens || 0)
                )
                modelUsage[modelName].allTokens += Math.max(0, parseInt(data.allTokens || 0))
                modelUsage[modelName].requests += Math.max(0, parseInt(data.requests || 0))
                processedModels++

                logger.debug(
                  `   Model ${modelName}: ${data.allTokens} tokens, ${data.requests} requests`
                )
              } catch (modelProcessError) {
                logger.warn(
                  `⚠️ Failed to process model data for key ${modelKeys[index]}:`,
                  modelProcessError.message
                )
                skippedModels++
              }
            })

            logger.debug(
              `✅ Successfully processed ${processedModels} model entries, skipped ${skippedModels}`
            )
          } catch (modelPipelineError) {
            logger.error(`❌ Failed to get model data:`, modelPipelineError.message)
            // 不中断主流程，模型数据为可选数据
          }
        } else {
          logger.debug(`ℹ️ No model-specific data found for the time window`)
        }

        // 最终结果汇总和验证
        logger.debug(`📊 Session window usage summary:`)
        logger.debug(`   Total allTokens: ${totalAllTokens}`)
        logger.debug(`   Total requests: ${totalRequests}`)
        logger.debug(`   Input: ${totalInputTokens}, Output: ${totalOutputTokens}`)
        logger.debug(
          `   Cache Create: ${totalCacheCreateTokens}, Cache Read: ${totalCacheReadTokens}`
        )

        const result = {
          totalInputTokens,
          totalOutputTokens,
          totalCacheCreateTokens,
          totalCacheReadTokens,
          totalAllTokens,
          totalRequests,
          modelUsage,
          window: {
            start: windowStart,
            end: windowEnd,
            durationHours: Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60))
          }
        }

        // 成功完成，返回结果
        logger.debug(
          `✅ Successfully completed session window usage query for account ${accountId}`
        )
        return result
      } catch (error) {
        retries++

        // 区分不同类型的错误
        const isRetryableError = !(
          error.message.includes('Invalid') ||
          error.message.includes('format') ||
          error.message.includes('before end date')
        )

        if (!isRetryableError) {
          logger.error(
            `❌ Non-retryable error in getSessionWindowUsage for account ${accountId}:`,
            error.message
          )
          return this._getEmptySessionUsage()
        }

        if (retries >= maxRetries) {
          logger.error(
            `❌ Failed to get session window usage for account ${accountId} after ${maxRetries} attempts:`,
            error.message
          )
          return this._getEmptySessionUsage()
        }

        // 指数退避重试
        const backoffDelay = Math.min(1000 * Math.pow(2, retries - 1), 5000)
        logger.warn(
          `⚠️ Retrying getSessionWindowUsage for account ${accountId} (attempt ${retries}/${maxRetries}) after ${backoffDelay}ms delay:`,
          error.message
        )

        await new Promise((resolve) => setTimeout(resolve, backoffDelay))
      }
    }

    // 如果所有重试都失败，返回空结果
    logger.error(`❌ All retry attempts exhausted for getSessionWindowUsage, account ${accountId}`)
    return this._getEmptySessionUsage()
  }

  /**
   * 返回空的会话使用统计对象
   * @private
   * @returns {Object} 空的使用统计
   */
  _getEmptySessionUsage() {
    return {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheCreateTokens: 0,
      totalCacheReadTokens: 0,
      totalAllTokens: 0,
      totalRequests: 0,
      modelUsage: {},
      window: {
        start: null,
        end: null,
        durationHours: 0
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
      lastScheduledAt: accountData.lastScheduledAt || '',
      // 新增警告控制字段的默认值（向后兼容）
      autoStopOnWarning: accountData.autoStopOnWarning || 'false'
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
      lastScheduledAt: accountData.lastScheduledAt || '',
      // 新增警告控制字段的默认值（向后兼容）
      autoStopOnWarning: accountData.autoStopOnWarning || 'false'
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
          lastScheduledAt: accountData.lastScheduledAt || '',
          // 新增警告控制字段的默认值（向后兼容）
          autoStopOnWarning: accountData.autoStopOnWarning || 'false'
        }
        accounts.push(enrichedAccount)
      }
    }
    return accounts
  }

  /**
   * 获取所有Claude Console账户
   * @returns {Promise<Array>} Claude Console账户数据数组
   */
  async getAllClaudeConsoleAccounts() {
    const keys = await this.client.keys('claude_console_account:*')
    const accounts = []
    for (const key of keys) {
      const accountData = await this.client.hgetall(key)
      if (accountData && Object.keys(accountData).length > 0) {
        // 确保所有调度策略字段都有默认值（向后兼容）
        const enrichedAccount = {
          id: key.replace('claude_console_account:', ''),
          ...accountData,
          schedulingStrategy: accountData.schedulingStrategy || 'least_recent',
          schedulingWeight: accountData.schedulingWeight || '1',
          sequentialOrder: accountData.sequentialOrder || '1',
          roundRobinIndex: accountData.roundRobinIndex || '0',
          usageCount: accountData.usageCount || '0',
          lastScheduledAt: accountData.lastScheduledAt || '',
          // 新增警告控制字段的默认值（向后兼容）
          autoStopOnWarning: accountData.autoStopOnWarning || 'false'
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

  // ==================== Gemini 账户管理 (4个方法) ====================

  /**
   * 获取所有Gemini账户
   * @returns {Promise<Array>} Gemini账户数组
   */
  async getAllGeminiAccounts() {
    try {
      const keys = await this.client.keys('gemini:account:*')
      const accounts = []

      for (const key of keys) {
        const accountData = await this.client.hgetall(key)
        if (accountData && Object.keys(accountData).length > 0) {
          // 确保所有调度策略字段都有默认值（向后兼容）
          const enrichedAccount = {
            id: key.replace('gemini:account:', ''),
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
    } catch (error) {
      logger.error('❌ Failed to get all Gemini accounts:', error)
      throw error
    }
  }

  /**
   * 获取单个Gemini账户
   * @param {string} accountId Gemini账户ID
   * @returns {Promise<Object|null>} Gemini账户数据对象或null
   */
  async getGeminiAccount(accountId) {
    try {
      const key = `gemini:account:${accountId}`
      const accountData = await this.client.hgetall(key)

      if (!accountData || Object.keys(accountData).length === 0) {
        return null
      }

      // 确保所有调度策略字段都有默认值（向后兼容）
      return {
        id: accountId,
        ...accountData,
        schedulingStrategy: accountData.schedulingStrategy || 'least_recent',
        schedulingWeight: accountData.schedulingWeight || '1',
        sequentialOrder: accountData.sequentialOrder || '1',
        roundRobinIndex: accountData.roundRobinIndex || '0',
        usageCount: accountData.usageCount || '0',
        lastScheduledAt: accountData.lastScheduledAt || ''
      }
    } catch (error) {
      logger.error(`❌ Failed to get Gemini account ${accountId}:`, error)
      throw error
    }
  }

  /**
   * 设置Gemini账户数据
   * @param {string} accountId Gemini账户ID
   * @param {Object} accountData Gemini账户数据对象
   * @returns {Promise<void>}
   * @throws {Error} 账户数据无效时抛出错误
   */
  async setGeminiAccount(accountId, accountData) {
    try {
      const key = `gemini:account:${accountId}`
      const client = this.getClientSafe()

      // 验证账户数据
      if (
        !accountData ||
        typeof accountData !== 'object' ||
        Object.keys(accountData).length === 0
      ) {
        throw new Error('Invalid Gemini account data provided')
      }

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

      await client.hmset(key, enrichedAccountData)
      logger.info(`🤖 Gemini account ${accountId} data updated`)
    } catch (error) {
      logger.error(`❌ Failed to set Gemini account ${accountId}:`, error)
      throw error
    }
  }

  /**
   * 删除Gemini账户
   * @param {string} accountId Gemini账户ID
   * @returns {Promise<number>} 删除的记录数
   */
  async deleteGeminiAccount(accountId) {
    try {
      const key = `gemini:account:${accountId}`
      const result = await this.client.del(key)
      logger.info(`🗑️ Gemini account ${accountId} deleted`)
      return result
    } catch (error) {
      logger.error(`❌ Failed to delete Gemini account ${accountId}:`, error)
      throw error
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

  // ==================== 品牌设置管理 (3个方法) ====================

  /**
   * 获取品牌配置
   * @returns {Promise<Object|null>} 品牌配置对象或null
   */
  async getBrandingConfig() {
    try {
      const key = 'system:branding_config'
      const brandingConfig = await this.client.hgetall(key)

      if (!brandingConfig || Object.keys(brandingConfig).length === 0) {
        return null
      }

      return brandingConfig
    } catch (error) {
      logger.error('❌ Failed to get branding config:', error)
      throw error
    }
  }

  /**
   * 设置品牌配置
   * @param {Object} config 品牌配置对象
   * @returns {Promise<void>}
   * @throws {Error} 配置数据无效时抛出错误
   */
  async setBrandingConfig(brandingConfig) {
    try {
      const key = 'system:branding_config'
      const client = this.getClientSafe()

      // 验证配置数据
      if (
        !brandingConfig ||
        typeof brandingConfig !== 'object' ||
        Object.keys(brandingConfig).length === 0
      ) {
        throw new Error('Invalid branding configuration data provided')
      }

      // 使用hset方法设置多个hash字段
      await client.hmset(key, brandingConfig)
      logger.info('🎨 Branding configuration updated')
    } catch (error) {
      logger.error('❌ Failed to set branding config:', error)
      throw error
    }
  }

  /**
   * 删除品牌配置
   * @returns {Promise<number>} 删除的记录数
   */
  async deleteBrandingConfig() {
    try {
      const key = 'system:branding_config'
      const result = await this.client.del(key)
      logger.info('🗑️ Branding configuration deleted')
      return result
    } catch (error) {
      logger.error('❌ Failed to delete branding config:', error)
      throw error
    }
  }

  // ==================== 通知设置管理 (3个方法) ====================

  /**
   * 获取通知配置
   * @returns {Promise<Object|null>} 通知配置对象或null
   */
  async getNotificationConfig() {
    try {
      const key = 'system:notification_config'
      const notificationConfig = await this.client.hgetall(key)

      if (!notificationConfig || Object.keys(notificationConfig).length === 0) {
        return null
      }

      return notificationConfig
    } catch (error) {
      logger.error('❌ Failed to get notification config:', error)
      throw error
    }
  }

  /**
   * 设置通知配置
   * @param {Object} config 通知配置对象
   * @returns {Promise<void>}
   * @throws {Error} 配置数据无效时抛出错误
   */
  async setNotificationConfig(notificationConfig) {
    try {
      const key = 'system:notification_config'
      const client = this.getClientSafe()

      // 验证配置数据
      if (
        !notificationConfig ||
        typeof notificationConfig !== 'object' ||
        Object.keys(notificationConfig).length === 0
      ) {
        throw new Error('Invalid notification configuration data provided')
      }

      // 使用hset方法设置多个hash字段
      await client.hmset(key, notificationConfig)
      logger.info('🔔 Notification configuration updated')
    } catch (error) {
      logger.error('❌ Failed to set notification config:', error)
      throw error
    }
  }

  /**
   * 删除通知配置
   * @returns {Promise<number>} 删除的记录数
   */
  async deleteNotificationConfig() {
    try {
      const key = 'system:notification_config'
      const result = await this.client.del(key)
      logger.info('🗑️ Notification configuration deleted')
      return result
    } catch (error) {
      logger.error('❌ Failed to delete notification config:', error)
      throw error
    }
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

  // ==================== 管理员信息管理 (4个方法) ====================

  /**
   * 获取所有管理员信息
   * @returns {Promise<Array>} 管理员信息数组
   */
  async getAllAdmins() {
    try {
      const keys = await this.client.keys('admin:*')
      const admins = []

      for (const key of keys) {
        // 过滤掉用户名映射键，只处理实际的管理员数据
        if (key.startsWith('admin_username:')) {
          continue
        }

        const adminData = await this.client.hgetall(key)
        if (adminData && Object.keys(adminData).length > 0) {
          const adminId = key.replace('admin:', '')
          admins.push({
            id: adminId,
            ...adminData
          })
        }
      }

      return admins
    } catch (error) {
      logger.error('❌ Failed to get all admins:', error)
      throw error
    }
  }

  /**
   * 根据ID获取管理员信息
   * @param {string} adminId 管理员ID
   * @returns {Promise<Object|null>} 管理员信息对象或null
   */
  async getAdminById(adminId) {
    try {
      const key = `admin:${adminId}`
      const adminData = await this.client.hgetall(key)

      if (!adminData || Object.keys(adminData).length === 0) {
        return null
      }

      return {
        id: adminId,
        ...adminData
      }
    } catch (error) {
      logger.error(`❌ Failed to get admin by ID ${adminId}:`, error)
      throw error
    }
  }

  /**
   * 设置管理员数据
   * @param {string} adminId 管理员ID
   * @param {Object} adminData 管理员数据对象
   * @returns {Promise<void>}
   * @throws {Error} 管理员数据无效时抛出错误
   */
  async setAdmin(adminId, adminData) {
    try {
      const key = `admin:${adminId}`
      const client = this.getClientSafe()

      // 验证管理员数据
      if (!adminData || typeof adminData !== 'object' || Object.keys(adminData).length === 0) {
        throw new Error('Invalid admin data provided')
      }

      // 设置管理员数据
      await client.hmset(key, adminData)

      // 维护用户名映射（如果提供了用户名）
      if (adminData.username) {
        const usernameMapKey = `admin_username:${adminData.username}`
        await client.set(usernameMapKey, adminId)
      }

      logger.info(`👤 Admin ${adminId} data updated`)
    } catch (error) {
      logger.error(`❌ Failed to set admin ${adminId}:`, error)
      throw error
    }
  }

  /**
   * 删除管理员
   * @param {string} adminId 管理员ID
   * @returns {Promise<number>} 删除的记录数
   */
  async deleteAdmin(adminId) {
    try {
      const key = `admin:${adminId}`

      // 获取管理员数据以便清理用户名映射
      const adminData = await this.client.hgetall(key)

      // 删除管理员数据
      const result = await this.client.del(key)

      // 清理用户名映射
      if (adminData && adminData.username) {
        const usernameMapKey = `admin_username:${adminData.username}`
        await this.client.del(usernameMapKey)
      }

      logger.info(`🗑️ Admin ${adminId} deleted`)
      return result
    } catch (error) {
      logger.error(`❌ Failed to delete admin ${adminId}:`, error)
      throw error
    }
  }

  // ==================== 2FA配置管理 (3个方法) ====================

  /**
   * 获取指定用户名的2FA配置
   * @param {string} username 用户名
   * @returns {Promise<Object|null>} 2FA配置对象或null
   */
  async getTwoFactorConfig(username) {
    try {
      const key = `2fa:config:${username}`
      const twoFactorConfig = await this.client.hgetall(key)

      if (!twoFactorConfig || Object.keys(twoFactorConfig).length === 0) {
        return null
      }

      return {
        username,
        ...twoFactorConfig
      }
    } catch (error) {
      logger.error(`❌ Failed to get 2FA config for ${username}:`, error)
      throw error
    }
  }

  /**
   * 设置指定用户名的2FA配置
   * @param {string} username 用户名
   * @param {Object} config 2FA配置对象
   * @returns {Promise<void>}
   * @throws {Error} 配置数据无效时抛出错误
   */
  async setTwoFactorConfig(username, twoFactorConfig) {
    try {
      const key = `2fa:config:${username}`
      const client = this.getClientSafe()

      // 验证配置数据
      if (
        !twoFactorConfig ||
        typeof twoFactorConfig !== 'object' ||
        Object.keys(twoFactorConfig).length === 0
      ) {
        throw new Error('Invalid 2FA configuration data provided')
      }

      // 验证用户名
      if (!username || typeof username !== 'string' || username.trim().length === 0) {
        throw new Error('Invalid username provided')
      }

      // 设置2FA配置，包含安全敏感信息的处理
      const configToStore = {
        ...twoFactorConfig,
        createdAt: twoFactorConfig.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }

      await client.hmset(key, configToStore)
      logger.info(`🔐 2FA configuration updated for user: ${username}`)
    } catch (error) {
      logger.error(`❌ Failed to set 2FA config for ${username}:`, error)
      throw error
    }
  }

  /**
   * 获取所有2FA配置
   * @returns {Promise<Array>} 所有2FA配置数组
   */
  async getAllTwoFactorConfigs() {
    try {
      const keys = await this.client.keys('2fa:config:*')
      const configs = []

      for (const key of keys) {
        const configData = await this.client.hgetall(key)
        if (configData && Object.keys(configData).length > 0) {
          const username = key.replace('2fa:config:', '')
          configs.push({
            username,
            ...configData
          })
        }
      }

      return configs
    } catch (error) {
      logger.error('❌ Failed to get all 2FA configs:', error)
      throw error
    }
  }

  /**
   * 记录请求日志到Redis（增强版本 - 支持Headers、详细信息和智能合并）
   * @param {string} keyId API Key ID
   * @param {Object} logData 日志数据对象
   * @param {Object} logData.requestHeaders 过滤后的请求头信息
   * @param {Object} logData.responseHeaders 响应头信息
   * @param {Object} logData.tokenDetails 详细的Token统计信息
   * @param {Object} logData.costDetails 费用详细信息
   * @param {number} ttl 过期时间（秒），默认604800秒（7天）
   * @param {Object} mergeOptions 日志合并配置选项
   * @param {boolean} mergeOptions.enabled 是否启用合并功能，默认false
   * @param {number} mergeOptions.windowMs 合并时间窗口（毫秒），默认15000（15秒）
   * @param {string} mergeOptions.priority 日志优先级（enhanced|basic|unknown），默认'unknown'
   * @param {boolean} mergeOptions.forceWrite 是否强制写入（忽略合并），默认false
   * @param {Function} mergeOptions.onDuplicate 处理重复日志的回调函数
   * @returns {Promise<string>} 日志唯一ID
   */
  async logRequest(keyId, logData, ttl = 604800, mergeOptions = {}) {
    try {
      const now = new Date()
      const today = getDateStringInTimezone(now)
      const timestamp = now.getTime()
      const logId = `request_log:${keyId}:${timestamp}`

      // 设置合并选项的默认值
      const mergeConfig = {
        enabled: mergeOptions.enabled || false,
        windowMs: mergeOptions.windowMs || 15000, // 15秒时间窗口
        priority: mergeOptions.priority || 'unknown',
        forceWrite: mergeOptions.forceWrite || false,
        onDuplicate: mergeOptions.onDuplicate || null,
        ...mergeOptions
      }

      const defaultData = {
        timestamp,
        keyId,
        path: '',
        method: '',
        status: 0,
        model: '',
        tokens: 0,
        responseTime: 0,
        error: null,
        // 新增字段
        requestHeaders: null,
        responseHeaders: null,
        tokenDetails: null,
        costDetails: null,
        // 合并相关字段
        logVersion: '2.1',
        priority: mergeConfig.priority,
        mergeCount: 0,
        originalTimestamp: timestamp,
        isDuplicate: false
      }

      const finalLogData = { ...defaultData, ...logData }

      // 智能合并逻辑 - 如果启用合并功能且不强制写入
      if (mergeConfig.enabled && !mergeConfig.forceWrite) {
        logger.debug(`🔄 检查重复日志，keyId: ${keyId}, 时间窗口: ${mergeConfig.windowMs}ms`)

        try {
          // 检测重复日志
          const duplicates = await this.detectDuplicateLogs(
            keyId,
            finalLogData,
            mergeConfig.windowMs
          )

          if (duplicates.length > 0) {
            logger.debug(`🔍 发现 ${duplicates.length} 个重复日志候选项`)

            // 找到最佳匹配的重复日志
            const bestMatch = duplicates.reduce((best, current) =>
              current.similarity > best.similarity ? current : best
            )

            // 如果相似度足够高，则执行合并
            if (bestMatch.similarity > 0.8) {
              // 80%相似度阈值
              logger.info(
                `🚀 合并日志: ${logId} -> ${bestMatch.logId} (相似度: ${(bestMatch.similarity * 100).toFixed(1)}%)`
              )

              // 执行合并操作
              const mergeResult = await this.mergeLogEntries(bestMatch.logId, [logId], {
                priority: mergeConfig.priority === 'enhanced' ? 'higher' : 'lower',
                preserveHeaders: true,
                aggregateTokens: true
              })

              // 调用重复处理回调
              if (mergeConfig.onDuplicate && typeof mergeConfig.onDuplicate === 'function') {
                try {
                  await mergeConfig.onDuplicate({
                    originalLogId: bestMatch.logId,
                    duplicateLogId: logId,
                    similarity: bestMatch.similarity,
                    mergeResult
                  })
                } catch (callbackError) {
                  logger.warn('⚠️ 重复日志回调函数执行失败:', callbackError.message)
                }
              }

              return mergeResult.mergedLogId
            }
          }
        } catch (mergeError) {
          logger.warn('⚠️ 日志合并检测失败，继续正常写入:', mergeError.message)
          // 合并失败时继续正常写入，不影响主要功能
        }
      }

      // 正常写入逻辑（如果没有合并或合并失败）

      // 处理复杂对象字段 - 序列化为JSON字符串以支持Redis存储
      if (finalLogData.requestHeaders && typeof finalLogData.requestHeaders === 'object') {
        finalLogData.requestHeaders = JSON.stringify(finalLogData.requestHeaders)
      }

      if (finalLogData.responseHeaders && typeof finalLogData.responseHeaders === 'object') {
        finalLogData.responseHeaders = JSON.stringify(finalLogData.responseHeaders)
      }

      if (finalLogData.tokenDetails && typeof finalLogData.tokenDetails === 'object') {
        finalLogData.tokenDetails = JSON.stringify(finalLogData.tokenDetails)
      }

      if (finalLogData.costDetails && typeof finalLogData.costDetails === 'object') {
        finalLogData.costDetails = JSON.stringify(finalLogData.costDetails)
      }

      const client = this.getClientSafe()

      // 使用Pipeline批量操作提升性能
      const pipeline = client.pipeline()

      // 1. 存储日志数据
      pipeline.hmset(logId, finalLogData)
      pipeline.expire(logId, ttl)

      // 2. 建立多维度索引以优化查询
      const dailyIndex = `request_log_index:${keyId}:${today}`
      pipeline.sadd(dailyIndex, logId)
      pipeline.expire(dailyIndex, ttl)

      // 3. 按状态码索引（用于快速查找错误日志）
      if (finalLogData.status) {
        const statusIndex = `request_log_status:${finalLogData.status}:${today}`
        pipeline.sadd(statusIndex, logId)
        pipeline.expire(statusIndex, ttl)
      }

      // 4. 按模型索引（用于模型使用统计）
      if (finalLogData.model) {
        const modelIndex = `request_log_model:${finalLogData.model}:${today}`
        pipeline.sadd(modelIndex, logId)
        pipeline.expire(modelIndex, ttl)
      }

      // 5. 全局时间索引（用于时间范围查询优化）
      const hourKey = `request_log_time:${Math.floor(timestamp / 3600000)}`
      pipeline.sadd(hourKey, logId)
      pipeline.expire(hourKey, ttl)

      // 6. 错误日志特殊索引
      if (finalLogData.error && finalLogData.error !== 'null') {
        const errorIndex = `request_log_errors:${today}`
        pipeline.sadd(errorIndex, logId)
        pipeline.expire(errorIndex, ttl)
      }

      await pipeline.exec()

      return logId
    } catch (error) {
      logger.error('Failed to log request:', error)
      throw error
    }
  }

  /**
   * 搜索请求日志（优化版本）
   * @param {Object} query 查询条件
   * @param {Object} options 查询选项（分页、排序等）
   * @param {boolean} options.includeEnhancedStats 是否包含增强的统计信息
   * @returns {Promise<Array>} 日志数组
   */
  async searchLogs(query = {}, options = {}) {
    const { offset = 0, limit = 20, sortOrder = 'desc', includeEnhancedStats = false } = options
    const startTime = Date.now()

    try {
      const client = this.getClientSafe()
      let matchingLogs = []

      // 记录搜索参数
      if (query.search) {
        logger.debug(`执行文本搜索: "${query.search}", 限制: ${limit}, 偏移: ${offset}`)
      }

      // 优化策略：基于查询条件选择最佳搜索方法
      if (query.status && query.dateRange) {
        // 优先使用状态码索引
        matchingLogs = await this._searchLogsByStatusAndDate(client, query.status, query.dateRange)
      } else if (query.model && query.dateRange) {
        // 使用模型索引
        matchingLogs = await this._searchLogsByModelAndDate(client, query.model, query.dateRange)
      } else if (query.hasError && query.dateRange) {
        // 使用错误索引
        matchingLogs = await this._searchErrorLogsByDate(client, query.dateRange)
      } else if (query.keyId && query.dateRange) {
        // 如果有 keyId 和日期范围，使用日志索引
        matchingLogs = await this._searchLogsByKeyIdAndDate(client, query.keyId, query.dateRange)
      } else if (query.keyId) {
        // 如果只有 keyId，使用更精确的模式匹配
        const pattern = `request_log:${query.keyId}:*`
        matchingLogs = await client.keys(pattern)
      } else if (query.dateRange) {
        // 如果只有日期范围，使用日志索引
        matchingLogs = await this._searchLogsByDateRange(client, query.dateRange)
      } else if (query.status) {
        // 仅状态码查询，使用今日状态码索引
        const today = getDateStringInTimezone()
        const statusIndex = `request_log_status:${query.status}:${today}`
        try {
          matchingLogs = await client.smembers(statusIndex)
        } catch (error) {
          matchingLogs = []
        }
      } else if (query.model) {
        // 仅模型查询，使用今日模型索引
        const today = getDateStringInTimezone()
        const modelIndex = `request_log_model:${query.model}:${today}`
        try {
          matchingLogs = await client.smembers(modelIndex)
        } catch (error) {
          matchingLogs = []
        }
      } else {
        // 🔧 修复：使用实际存在的键模式进行全量搜索
        logger.info('🔍 DEBUGGING: Performing full scan for request logs')

        // 搜索所有请求日志相关的键模式
        const [indexKeys, statusKeys, modelKeys, errorKeys, timeKeys] = await Promise.all([
          client.keys('request_log_index:*'),
          client.keys('request_log_status:*'),
          client.keys('request_log_model:*'),
          client.keys('request_log_errors:*'),
          client.keys('request_log_time:*')
        ])

        // 合并所有索引键，从中提取主日志键
        const allIndexKeys = [...indexKeys, ...statusKeys, ...modelKeys, ...errorKeys, ...timeKeys]
        logger.info('🔍 DEBUGGING: Found index keys:', {
          indexKeys: indexKeys.length,
          statusKeys: statusKeys.length,
          modelKeys: modelKeys.length,
          errorKeys: errorKeys.length,
          timeKeys: timeKeys.length,
          totalIndexKeys: allIndexKeys.length
        })

        // 从索引键中提取实际的日志键
        const extractedLogKeys = new Set()
        for (const indexKey of allIndexKeys) {
          try {
            // 对于集合索引，获取成员
            if (
              indexKey.includes('request_log_index:') ||
              indexKey.includes('request_log_status:') ||
              indexKey.includes('request_log_model:') ||
              indexKey.includes('request_log_errors:')
            ) {
              const members = await client.smembers(indexKey)
              members.forEach((member) => extractedLogKeys.add(member))
            }
            // 对于时间索引，获取成员
            else if (indexKey.includes('request_log_time:')) {
              const members = await client.smembers(indexKey)
              members.forEach((member) => extractedLogKeys.add(member))
            }
          } catch (error) {
            logger.debug(`Failed to extract from index ${indexKey}:`, error.message)
          }
        }

        matchingLogs = Array.from(extractedLogKeys)
        logger.info('🔍 DEBUGGING: Extracted log keys:', {
          extractedCount: matchingLogs.length,
          sampleKeys: matchingLogs.slice(0, 5)
        })

        // 按时间戳排序并截取最近的记录
        matchingLogs = matchingLogs
          .filter((key) => key && key.includes(':')) // 确保键格式正确
          .sort((a, b) => {
            const timestampA = parseInt(a.split(':')[2]) || 0
            const timestampB = parseInt(b.split(':')[2]) || 0
            return sortOrder === 'desc' ? timestampB - timestampA : timestampA - timestampB
          })
          .slice(0, Math.min(1000, offset + limit * 5)) // 限制最大扫描量
      }

      // 限制文本搜索的扫描范围，避免性能问题
      if (query.search && matchingLogs.length > 2000) {
        logger.warn(`文本搜索的结果集过大 (${matchingLogs.length})，限制到 2000 条`)
        matchingLogs = matchingLogs.slice(0, 2000)
      }

      // 应用其他过滤条件
      if (Object.keys(query).length > 0) {
        matchingLogs = await this._filterLogsByQuery(client, matchingLogs, query)
      }

      // 排序（如果还未排序）
      if (!query.keyId || Object.keys(query).length > 1) {
        matchingLogs.sort((a, b) => {
          const timestampA = parseInt(a.split(':')[2]) || 0
          const timestampB = parseInt(b.split(':')[2]) || 0
          return sortOrder === 'desc' ? timestampB - timestampA : timestampA - timestampB
        })
      }

      // 分页
      const paginatedLogs = matchingLogs.slice(offset, offset + limit)
      logger.info('🔍 DEBUGGING: About to fetch log data:', {
        totalMatching: matchingLogs.length,
        paginatedCount: paginatedLogs.length,
        samplePaginatedKeys: paginatedLogs.slice(0, 3)
      })

      // 批量获取日志详情
      const pipeline = client.pipeline()
      paginatedLogs.forEach((logKey) => pipeline.hgetall(logKey))

      const results = await pipeline.exec()
      logger.info('🔍 DEBUGGING: Pipeline results:', {
        resultsCount: results.length,
        sampleResults: results.slice(0, 2).map(([err, data]) => ({
          error: err?.message,
          dataKeys: data ? Object.keys(data) : null,
          hasData: data && Object.keys(data).length > 0
        }))
      })

      const logs = results
        .map(([err, logData], index) => {
          if (err || !logData || Object.keys(logData).length === 0) {
            return null
          }

          // 反序列化JSON字符串字段
          const processedLogData = { ...logData }

          // 通用的JSON反序列化函数
          const safeJSONParse = (fieldName, value) => {
            if (!value || typeof value !== 'string') {
              return null
            }

            try {
              return JSON.parse(value)
            } catch (e) {
              logger.debug(
                `Failed to parse ${fieldName} for log ${paginatedLogs[index]}:`,
                e.message
              )
              return null
            }
          }

          // 数据解压缩和反序列化
          const jsonFields = ['requestHeaders', 'responseHeaders', 'tokenDetails', 'costDetails']
          jsonFields.forEach((field) => {
            if (processedLogData[field]) {
              processedLogData[field] = safeJSONParse(field, processedLogData[field])
            }
          })

          // 数值类型转换
          const numericFields = {
            timestamp: 'int',
            duration: 'int',
            responseTime: 'float',
            inputTokens: 'int',
            outputTokens: 'int',
            totalTokens: 'int',
            cost: 'float',
            status: 'int',
            tokens: 'int'
          }

          Object.entries(numericFields).forEach(([field, type]) => {
            if (processedLogData[field] !== undefined && processedLogData[field] !== '') {
              if (type === 'int') {
                processedLogData[field] = parseInt(processedLogData[field]) || 0
              } else if (type === 'float') {
                processedLogData[field] = parseFloat(processedLogData[field]) || 0
              }
            }
          })

          // 计算增强统计信息
          const enhancedLog = {
            ...processedLogData,
            logId: paginatedLogs[index],
            timestamp: processedLogData.timestamp
          }

          // 添加tokenSummary（总是包含）
          enhancedLog.tokenSummary = {
            totalTokens: enhancedLog.totalTokens || enhancedLog.tokens || 0,
            inputTokens: enhancedLog.inputTokens || 0,
            outputTokens: enhancedLog.outputTokens || 0,
            cost: enhancedLog.cost || 0
          }

          // 添加标志信息（总是包含）
          enhancedLog.hasHeaders = !!(
            (enhancedLog.requestHeaders &&
              Object.keys(enhancedLog.requestHeaders || {}).length > 0) ||
            (enhancedLog.responseHeaders &&
              Object.keys(enhancedLog.responseHeaders || {}).length > 0)
          )

          enhancedLog.hasBody = !!(
            (enhancedLog.requestBody && enhancedLog.requestBody.trim().length > 0) ||
            (enhancedLog.responseBody && enhancedLog.responseBody.trim().length > 0)
          )

          enhancedLog.isError = (enhancedLog.status || 0) >= 400
          enhancedLog.dateTime = enhancedLog.timestamp
            ? new Date(enhancedLog.timestamp).toISOString()
            : null

          // 如果启用了增强统计，添加更多详细信息
          if (includeEnhancedStats) {
            enhancedLog.metadata = {
              hasRequestHeaders: !!(
                enhancedLog.requestHeaders && Object.keys(enhancedLog.requestHeaders).length > 0
              ),
              hasResponseHeaders: !!(
                enhancedLog.responseHeaders && Object.keys(enhancedLog.responseHeaders).length > 0
              ),
              hasTokenDetails: !!(
                enhancedLog.tokenDetails && Object.keys(enhancedLog.tokenDetails || {}).length > 0
              ),
              hasCostDetails: !!(
                enhancedLog.costDetails && Object.keys(enhancedLog.costDetails || {}).length > 0
              ),
              processedAt: new Date().toISOString()
            }
          }

          return enhancedLog
        })
        .filter(Boolean)

      logger.info('🔍 DEBUGGING: Final processed logs:', {
        processedCount: logs.length,
        includeEnhancedStats,
        sampleLogData: logs.slice(0, 2).map((log) => ({
          logId: log.logId,
          keyId: log.keyId,
          timestamp: log.timestamp,
          hasHeaders: log.hasHeaders,
          hasBody: log.hasBody,
          tokenSummary: log.tokenSummary,
          fieldsCount: Object.keys(log).length
        }))
      })

      const endTime = Date.now()
      const searchTime = endTime - startTime

      // 记录搜索结果和性能
      if (query.search) {
        logger.debug(`文本搜索完成: 耗时 ${searchTime}ms, 找到 ${logs.length} 条结果`)
      }

      return logs
    } catch (error) {
      logger.error('Failed to search logs:', error)
      return []
    }
  }

  /**
   * 统计日志数量（优化版本）
   * @param {Object} query 查询条件
   * @returns {Promise<number>} 匹配的日志数量
   */
  async countLogs(query = {}) {
    try {
      const client = this.getClientSafe()
      let matchingLogs = []

      // 使用与 searchLogs 相同的优化策略
      if (query.status && query.dateRange) {
        matchingLogs = await this._searchLogsByStatusAndDate(client, query.status, query.dateRange)
      } else if (query.model && query.dateRange) {
        matchingLogs = await this._searchLogsByModelAndDate(client, query.model, query.dateRange)
      } else if (query.hasError && query.dateRange) {
        matchingLogs = await this._searchErrorLogsByDate(client, query.dateRange)
      } else if (query.keyId && query.dateRange) {
        matchingLogs = await this._searchLogsByKeyIdAndDate(client, query.keyId, query.dateRange)
      } else if (query.keyId) {
        const pattern = `request_log:${query.keyId}:*`
        matchingLogs = await client.keys(pattern)
      } else if (query.dateRange) {
        matchingLogs = await this._searchLogsByDateRange(client, query.dateRange)
      } else if (query.status) {
        const today = getDateStringInTimezone()
        const statusIndex = `request_log_status:${query.status}:${today}`
        try {
          matchingLogs = await client.smembers(statusIndex)
        } catch (error) {
          matchingLogs = []
        }
      } else if (query.model) {
        const today = getDateStringInTimezone()
        const modelIndex = `request_log_model:${query.model}:${today}`
        try {
          matchingLogs = await client.smembers(modelIndex)
        } catch (error) {
          matchingLogs = []
        }
      } else {
        // 全量扫描时，可以直接返回键数量而不需要获取内容
        matchingLogs = await client.keys('request_log:*')
      }

      // 应用其他过滤条件
      if (Object.keys(query).length > 0 && !(query.keyId && Object.keys(query).length === 1)) {
        matchingLogs = await this._filterLogsByQuery(client, matchingLogs, query)
      }

      return matchingLogs.length
    } catch (error) {
      logger.error('Failed to count logs:', error)
      return 0
    }
  }

  /**
   * 聚合日志统计
   * @param {Object} query 查询条件
   * @returns {Promise<Object>} 聚合统计结果
   */
  async aggregateLogs(query = {}) {
    try {
      const client = this.getClientSafe()
      let matchingLogs = []

      // 使用与 searchLogs 相同的优化策略
      if (query.status && query.dateRange) {
        matchingLogs = await this._searchLogsByStatusAndDate(client, query.status, query.dateRange)
      } else if (query.model && query.dateRange) {
        matchingLogs = await this._searchLogsByModelAndDate(client, query.model, query.dateRange)
      } else if (query.hasError && query.dateRange) {
        matchingLogs = await this._searchErrorLogsByDate(client, query.dateRange)
      } else if (query.keyId && query.dateRange) {
        matchingLogs = await this._searchLogsByKeyIdAndDate(client, query.keyId, query.dateRange)
      } else if (query.keyId) {
        const pattern = `request_log:${query.keyId}:*`
        matchingLogs = await client.keys(pattern)
      } else if (query.dateRange) {
        matchingLogs = await this._searchLogsByDateRange(client, query.dateRange)
      } else {
        matchingLogs = await client.keys('request_log:*')
      }

      // 应用其他过滤条件
      if (Object.keys(query).length > 0) {
        matchingLogs = await this._filterLogsByQuery(client, matchingLogs, query)
      }

      const pipeline = client.pipeline()
      matchingLogs.forEach((logKey) => pipeline.hgetall(logKey))

      const results = await pipeline.exec()

      const stats = {
        totalRequests: 0,
        totalTokens: 0,
        totalResponseTime: 0,
        statusCodes: {},
        models: {},
        apiKeys: {}
      }

      results.forEach(([err, logData]) => {
        if (err || !logData) {
          return
        }

        stats.totalRequests++
        stats.totalTokens += parseInt(logData.tokens) || 0
        stats.totalResponseTime += parseFloat(logData.responseTime) || 0

        // 状态码统计
        const status = logData.status || 'unknown'
        stats.statusCodes[status] = (stats.statusCodes[status] || 0) + 1

        // 模型统计
        const model = logData.model || 'unknown'
        stats.models[model] = (stats.models[model] || 0) + 1

        // API Key统计
        const keyId = logData.keyId || 'unknown'
        stats.apiKeys[keyId] = (stats.apiKeys[keyId] || 0) + 1
      })

      return stats
    } catch (error) {
      logger.error('Failed to aggregate logs:', error)
      return {}
    }
  }

  /**
   * 通过 keyId 和日期范围搜索日志
   * @private
   * @param {Object} client Redis客户端
   * @param {string} keyId API Key ID
   * @param {Object} dateRange 日期范围 {start, end}
   * @returns {Promise<Array>} 匹配的日志键数组
   */
  async _searchLogsByKeyIdAndDate(client, keyId, dateRange) {
    const { start, end } = dateRange
    const startTimestamp = new Date(start).getTime()
    const endTimestamp = new Date(end).getTime()

    // 使用更精确的模式匹配
    const pattern = `request_log:${keyId}:*`
    const logs = await client.keys(pattern)

    // 过滤时间范围
    return logs.filter((logKey) => {
      const timestamp = parseInt(logKey.split(':')[2]) || 0
      return timestamp >= startTimestamp && timestamp <= endTimestamp
    })
  }

  /**
   * 通过日期范围搜索日志（索引优化版本）
   * @private
   * @param {Object} client Redis客户端
   * @param {Object} dateRange 日期范围 {start, end}
   * @returns {Promise<Array>} 匹配的日志键数组
   */
  async _searchLogsByDateRange(client, dateRange) {
    const { start, end } = dateRange
    const startTimestamp = new Date(start).getTime()
    const endTimestamp = new Date(end).getTime()

    // 优化策略：使用时间索引而不是全量扫描
    const startHour = Math.floor(startTimestamp / 3600000)
    const endHour = Math.floor(endTimestamp / 3600000)

    const allLogs = new Set()

    // 如果时间范围跨度不大（少于24小时），使用小时索引
    if (endHour - startHour <= 24) {
      for (let hour = startHour; hour <= endHour; hour++) {
        const hourKey = `request_log_time:${hour}`
        try {
          const hourLogs = await client.smembers(hourKey)
          hourLogs.forEach((logKey) => allLogs.add(logKey))
        } catch (error) {
          // 索引不存在时忽略错误
        }
      }

      // 转换为数组并进行精确时间过滤
      return Array.from(allLogs).filter((logKey) => {
        const timestamp = parseInt(logKey.split(':')[2]) || 0
        return timestamp >= startTimestamp && timestamp <= endTimestamp
      })
    } else {
      // 长时间范围降级到传统方法
      const allLogKeys = await client.keys('request_log:*')
      return allLogKeys.filter((logKey) => {
        const timestamp = parseInt(logKey.split(':')[2]) || 0
        return timestamp >= startTimestamp && timestamp <= endTimestamp
      })
    }
  }

  /**
   * 通过状态码和日期范围搜索日志
   * @private
   * @param {Object} client Redis客户端
   * @param {string} status 状态码
   * @param {Object} dateRange 日期范围
   * @returns {Promise<Array>} 匹配的日志键数组
   */
  async _searchLogsByStatusAndDate(client, status, dateRange) {
    const { start, end } = dateRange
    const startDate = new Date(start)
    const endDate = new Date(end)
    const results = new Set()

    // 遍历日期范围内的每一天
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = getDateStringInTimezone(d)
      const statusIndex = `request_log_status:${status}:${dateStr}`

      try {
        const dayLogs = await client.smembers(statusIndex)
        dayLogs.forEach((logKey) => results.add(logKey))
      } catch (error) {
        // 索引不存在时忽略
      }
    }

    return Array.from(results)
  }

  /**
   * 通过模型和日期范围搜索日志
   * @private
   * @param {Object} client Redis客户端
   * @param {string} model 模型名称
   * @param {Object} dateRange 日期范围
   * @returns {Promise<Array>} 匹配的日志键数组
   */
  async _searchLogsByModelAndDate(client, model, dateRange) {
    const { start, end } = dateRange
    const startDate = new Date(start)
    const endDate = new Date(end)
    const results = new Set()

    // 遍历日期范围内的每一天
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = getDateStringInTimezone(d)
      const modelIndex = `request_log_model:${model}:${dateStr}`

      try {
        const dayLogs = await client.smembers(modelIndex)
        dayLogs.forEach((logKey) => results.add(logKey))
      } catch (error) {
        // 索引不存在时忽略
      }
    }

    return Array.from(results)
  }

  /**
   * 通过日期范围搜索错误日志
   * @private
   * @param {Object} client Redis客户端
   * @param {Object} dateRange 日期范围
   * @returns {Promise<Array>} 匹配的错误日志键数组
   */
  async _searchErrorLogsByDate(client, dateRange) {
    const { start, end } = dateRange
    const startDate = new Date(start)
    const endDate = new Date(end)
    const results = new Set()

    // 遍历日期范围内的每一天
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = getDateStringInTimezone(d)
      const errorIndex = `request_log_errors:${dateStr}`

      try {
        const dayLogs = await client.smembers(errorIndex)
        dayLogs.forEach((logKey) => results.add(logKey))
      } catch (error) {
        // 索引不存在时忽略
      }
    }

    return Array.from(results)
  }

  /**
   * 通过查询条件过滤日志
   * @private
   * @param {Object} client Redis客户端
   * @param {Array} logKeys 要过滤的日志键数组
   * @param {Object} query 查询条件
   * @returns {Promise<Array>} 过滤后的日志键数组
   */
  async _filterLogsByQuery(client, logKeys, query) {
    if (logKeys.length === 0) {
      return []
    }

    // 批量获取日志数据以支持复杂过滤
    const pipeline = client.pipeline()
    logKeys.forEach((logKey) => pipeline.hgetall(logKey))

    const results = await pipeline.exec()
    const filteredKeys = []

    // 如果有文本搜索，需要预加载API Key信息
    let apiKeyCache = {}
    if (query.search) {
      try {
        logger.debug(`预加载API Key信息以支持文本搜索: ${query.search}`)
        const allApiKeys = await this.getAllApiKeys()
        apiKeyCache = allApiKeys.reduce((cache, key) => {
          cache[key.id] = key
          return cache
        }, {})
        logger.debug(`已加载 ${Object.keys(apiKeyCache).length} 个API Key信息`)
      } catch (error) {
        logger.warn('加载API Key信息失败，文本搜索可能不完整:', error.message)
      }
    }

    results.forEach(([err, logData], index) => {
      if (err || !logData) {
        return
      }

      const logKey = logKeys[index]
      let matches = true

      // 应用各种过滤条件
      for (const [key, value] of Object.entries(query)) {
        if (key === 'search') {
          // 特殊处理文本搜索
          if (!this._performTextSearch(logData, logKey, value, apiKeyCache)) {
            matches = false
            break
          }
        } else if (!this._checkLogFieldMatch(logData, logKey, key, value)) {
          matches = false
          break
        }
      }

      if (matches) {
        filteredKeys.push(logKey)
      }
    })

    return filteredKeys
  }

  /**
   * 检查日志字段是否匹配查询条件（增强版本）
   * @private
   * @param {Object} logData 日志数据
   * @param {string} logKey 日志键
   * @param {string} fieldName 字段名
   * @param {*} value 期望值
   * @returns {boolean} 是否匹配
   */
  _checkLogFieldMatch(logData, logKey, fieldName, value) {
    switch (fieldName) {
      case 'keyId':
        return logKey.includes(`:${value}:`) || logData.keyId === value

      case 'status':
        return logData.status === String(value)

      case 'method':
        return logData.method === value

      case 'path':
        return logData.path && logData.path.includes(value)

      case 'model':
        return logData.model === value

      case 'search':
        // 文本搜索在上层处理，这里直接返回true
        return true

      case 'dateRange':
        // 日期范围已在上层方法中处理
        return true

      case 'minTokens':
        return parseInt(logData.tokens) >= parseInt(value)

      case 'maxTokens':
        return parseInt(logData.tokens) <= parseInt(value)

      case 'minResponseTime':
        return parseFloat(logData.responseTime) >= parseFloat(value)

      case 'maxResponseTime':
        return parseFloat(logData.responseTime) <= parseFloat(value)

      case 'hasError':
        return value
          ? logData.error && logData.error !== 'null'
          : !logData.error || logData.error === 'null'

      default:
        // 通用字段匹配
        return logData[fieldName] === value
    }
  }

  /**
   * 执行文本搜索（多字段模糊匹配）
   * @private
   * @param {Object} logData 日志数据
   * @param {string} logKey 日志键
   * @param {string} searchText 搜索文本
   * @param {Object} apiKeyCache API Key缓存对象
   * @returns {boolean} 是否匹配
   */
  _performTextSearch(logData, logKey, searchText, apiKeyCache = {}) {
    if (!searchText || typeof searchText !== 'string') {
      return true
    }

    // 限制搜索词长度，避免过度复杂查询
    if (searchText.length > 100) {
      logger.warn(`搜索词过长，截断到100字符: ${searchText.substring(0, 100)}...`)
      searchText = searchText.substring(0, 100)
    }

    // 不区分大小写的搜索
    const searchLower = searchText.toLowerCase().trim()
    if (!searchLower) {
      return true
    }

    // 支持多词搜索（空格分割）
    const searchTerms = searchLower.split(/\s+/).filter((term) => term.length > 0)
    if (searchTerms.length === 0) {
      return true
    }

    // 获取API Key名称（使用缓存提高性能）
    let apiKeyName = ''
    if (logData.keyId && apiKeyCache[logData.keyId]) {
      apiKeyName = (apiKeyCache[logData.keyId].name || '').toLowerCase()
    }

    // 构建搜索字段数组（使用实际的字段名）
    const searchFields = [
      apiKeyName, // API Key 名称
      (logData.path || '').toLowerCase(), // 请求路径
      (logData.ipAddress || '').toLowerCase(), // IP 地址
      (logData.userAgent || '').toLowerCase(), // User Agent
      (logData.error || '').toLowerCase(), // 错误信息
      (logData.method || '').toLowerCase(), // HTTP方法
      (logData.model || '').toLowerCase(), // 模型名称
      (logData.keyId || '').toLowerCase(), // API Key ID
      (logData.statusCode || '').toString().toLowerCase() // 状态码
    ].filter((field) => field.length > 0)

    // 合并所有搜索字段为一个字符串
    const searchableText = searchFields.join(' ')

    // 检查是否所有搜索词都能在搜索文本中找到
    return searchTerms.every((term) => searchableText.includes(term))
  }

  /**
   * 导出日志到文件
   * @param {Object} query 查询条件
   * @param {string} format 导出格式（csv/json）
   * @param {string} filename 导出文件名
   * @returns {Promise<string>} 导出文件路径
   */
  async exportLogs(query = {}, format = 'csv', filename) {
    const path = require('path')
    const fs = require('fs')

    try {
      // 搜索日志
      const logs = await this.searchLogs(query)

      // 确定导出目录
      const exportDir = path.join(__dirname, '../../../logs/exports')
      fs.mkdirSync(exportDir, { recursive: true })

      const exportPath = path.join(exportDir, filename)

      if (format === 'json') {
        fs.writeFileSync(exportPath, JSON.stringify(logs, null, 2))
      } else {
        // CSV导出
        const csvHeader = [
          'logId',
          'timestamp',
          'keyId',
          'path',
          'method',
          'status',
          'model',
          'tokens',
          'responseTime',
          'error'
        ]
        const csvContent = [
          csvHeader.join(','),
          ...logs.map((log) =>
            csvHeader
              .map((header) => `"${String(log[header] || '').replace(/"/g, '""')}"`)
              .join(',')
          )
        ].join('\n')

        fs.writeFileSync(exportPath, csvContent)
      }

      return exportPath
    } catch (error) {
      logger.error('Failed to export logs:', error)
      throw error
    }
  }

  /**
   * 删除指定条件的日志（优化版本）
   * @param {Object} query 查询条件
   * @returns {Promise<number>} 删除的日志数量
   */
  async deleteLogs(query = {}) {
    try {
      const client = this.getClientSafe()
      let matchingLogs = []

      // 使用优化的搜索策略
      if (query.status && query.dateRange) {
        matchingLogs = await this._searchLogsByStatusAndDate(client, query.status, query.dateRange)
      } else if (query.model && query.dateRange) {
        matchingLogs = await this._searchLogsByModelAndDate(client, query.model, query.dateRange)
      } else if (query.hasError && query.dateRange) {
        matchingLogs = await this._searchErrorLogsByDate(client, query.dateRange)
      } else if (query.keyId && query.dateRange) {
        matchingLogs = await this._searchLogsByKeyIdAndDate(client, query.keyId, query.dateRange)
      } else if (query.keyId) {
        const pattern = `request_log:${query.keyId}:*`
        matchingLogs = await client.keys(pattern)
      } else if (query.dateRange) {
        matchingLogs = await this._searchLogsByDateRange(client, query.dateRange)
      } else if (query.status) {
        const today = getDateStringInTimezone()
        const statusIndex = `request_log_status:${query.status}:${today}`
        try {
          matchingLogs = await client.smembers(statusIndex)
        } catch (error) {
          matchingLogs = []
        }
      } else if (query.model) {
        const today = getDateStringInTimezone()
        const modelIndex = `request_log_model:${query.model}:${today}`
        try {
          matchingLogs = await client.smembers(modelIndex)
        } catch (error) {
          matchingLogs = []
        }
      } else {
        matchingLogs = await client.keys('request_log:*')
      }

      // 应用其他过滤条件
      if (Object.keys(query).length > 0 && !(query.keyId && Object.keys(query).length === 1)) {
        matchingLogs = await this._filterLogsByQuery(client, matchingLogs, query)
      }

      // 分批删除以避免Redis命令过长
      let totalDeleted = 0
      const batchSize = 100 // 每批删除100个key

      for (let i = 0; i < matchingLogs.length; i += batchSize) {
        const batch = matchingLogs.slice(i, i + batchSize)
        if (batch.length > 0) {
          await client.del(...batch)
          totalDeleted += batch.length
        }
      }

      // 同时清理相关索引
      await this._cleanupLogIndexes(client, matchingLogs)

      logger.info(`成功删除 ${totalDeleted} 条日志记录`)
      return totalDeleted
    } catch (error) {
      logger.error('Failed to delete logs:', error)
      return 0
    }
  }

  /**
   * 删除过期的日志记录（内存优化版本）
   * @param {string} cutoffDate 截止日期（ISO字符串）
   * @returns {Promise<number>} 删除的日志数量
   */
  async deleteExpiredLogs(cutoffDate) {
    try {
      const client = this.getClientSafe()
      const cutoffTimestamp = new Date(cutoffDate).getTime()

      logger.info(`开始清理 ${cutoffDate} 之前的过期日志`)

      // 获取所有请求日志键
      const allLogKeys = await client.keys('request_log:*')
      logger.info(`发现 ${allLogKeys.length} 个日志文件`)

      // 分批处理以减少内存使用
      const batchSize = 500
      const expiredLogs = []

      for (let i = 0; i < allLogKeys.length; i += batchSize) {
        const batch = allLogKeys.slice(i, i + batchSize)

        // 首先从key中提取时间戳进行快速筛选
        const potentialExpired = batch.filter((logKey) => {
          const keyTimestamp = parseInt(logKey.split(':')[2]) || 0
          return keyTimestamp > 0 && keyTimestamp < cutoffTimestamp
        })

        // 对于可能过期的日志，批量获取详细信息确认
        if (potentialExpired.length > 0) {
          const pipeline = client.pipeline()
          potentialExpired.forEach((logKey) => pipeline.hget(logKey, 'timestamp'))

          const results = await pipeline.exec()

          results.forEach(([err, timestamp], index) => {
            if (!err && timestamp && parseInt(timestamp) < cutoffTimestamp) {
              expiredLogs.push(potentialExpired[index])
            }
          })
        }

        // 进度报告
        if (i + batchSize < allLogKeys.length) {
          logger.debug(
            `已处理 ${Math.min(i + batchSize, allLogKeys.length)}/${allLogKeys.length} 个日志，发现 ${expiredLogs.length} 个过期日志`
          )
        }
      }

      // 分批删除过期日志
      let totalDeleted = 0
      const deleteBatchSize = 100

      for (let i = 0; i < expiredLogs.length; i += deleteBatchSize) {
        const batch = expiredLogs.slice(i, i + deleteBatchSize)
        if (batch.length > 0) {
          await client.del(...batch)
          totalDeleted += batch.length
        }
      }

      // 清理相关索引
      await this._cleanupLogIndexes(client, expiredLogs)

      logger.info(`清理过期日志完成: 删除 ${totalDeleted} 条记录`)
      return totalDeleted
    } catch (error) {
      logger.error('Failed to delete expired logs:', error)
      return 0
    }
  }

  /**
   * 清理日志索引
   * @private
   * @param {Object} client Redis客户端
   * @param {Array} deletedLogKeys 已删除的日志键数组
   * @returns {Promise<void>}
   */
  async _cleanupLogIndexes(client, deletedLogKeys) {
    if (deletedLogKeys.length === 0) {
      return
    }

    try {
      // 获取所有索引键
      const indexKeys = await client.keys('request_log_index:*')

      if (indexKeys.length > 0) {
        const pipeline = client.pipeline()

        // 批量清理索引
        indexKeys.forEach((indexKey) => {
          deletedLogKeys.forEach((logKey) => {
            pipeline.srem(indexKey, logKey)
          })
        })

        await pipeline.exec()
        logger.debug(`清理了 ${indexKeys.length} 个索引中的 ${deletedLogKeys.length} 条记录`)
      }
    } catch (error) {
      logger.warn('索引清理失败，但不影响日志删除:', error.message)
    }
  }

  /**
   * 获取请求日志配置
   * @returns {Promise<Object>} 日志配置对象
   */
  async getRequestLogsConfig() {
    try {
      const configStr = await this.get('request_logs_config')
      return configStr ? JSON.parse(configStr) : null
    } catch (error) {
      logger.error('Failed to get request logs config:', error)
      return null
    }
  }

  /**
   * 设置请求日志配置
   * @param {Object} config 配置对象
   * @returns {Promise<void>}
   */
  async setRequestLogsConfig(requestLogsConfig) {
    try {
      await this.set('request_logs_config', JSON.stringify(requestLogsConfig))
      logger.info('请求日志配置已更新')
    } catch (error) {
      logger.error('Failed to set request logs config:', error)
      throw error
    }
  }

  /**
   * 获取单个请求日志的详细信息（增强版本）
   * @param {string} logId 日志ID (完整的Redis key或简化的ID)
   * @returns {Promise<Object|null>} 日志详细信息对象或null
   */
  async getRequestLogDetails(logId) {
    try {
      const client = this.getClientSafe()
      let actualLogKey = logId
      const startTime = Date.now()

      // 参数验证和清理
      if (!logId || typeof logId !== 'string') {
        logger.warn('获取日志详情失败: 无效的日志ID参数', { logId, type: typeof logId })
        return null
      }

      // 清理和标准化logId
      const cleanLogId = logId.trim().replace(/^["']|["']$/g, '') // 移除可能的引号
      if (!cleanLogId) {
        logger.warn('获取日志详情失败: 清理后的日志ID为空', { originalLogId: logId })
        return null
      }

      // 智能识别和构造完整的Redis key
      if (!cleanLogId.startsWith('request_log:')) {
        // 如果是简化的ID格式（如 keyId:timestamp），构造完整key
        if (cleanLogId.includes(':')) {
          const parts = cleanLogId.split(':')
          if (parts.length === 2 && parts[0] && parts[1]) {
            actualLogKey = `request_log:${parts[0]}:${parts[1]}`
          } else if (parts.length === 3 && parts[0] === 'request_log') {
            actualLogKey = cleanLogId // 已经是完整格式
          } else {
            logger.warn('获取日志详情失败: 无法解析日志ID格式', {
              cleanLogId,
              parts,
              expectedFormat: 'keyId:timestamp 或 request_log:keyId:timestamp'
            })
            return null
          }
        } else {
          // 如果只是timestamp，尝试通过模式匹配查找（性能较低，谨慎使用）
          logger.debug('尝试通过timestamp查找日志', { timestamp: cleanLogId })
          const pattern = `request_log:*:${cleanLogId}`
          const matchingKeys = await client.keys(pattern)
          if (matchingKeys.length > 0) {
            actualLogKey = matchingKeys[0] // 取第一个匹配的key
            logger.debug('通过模式匹配找到日志', { pattern, matchingKey: actualLogKey })
          } else {
            logger.warn('获取日志详情失败: 未找到匹配的日志key', { pattern })
            return null
          }
        }
      } else {
        actualLogKey = cleanLogId
      }

      logger.debug(`获取日志详情: ${logId} -> ${actualLogKey}`)

      // 获取完整的hash数据
      const logData = await client.hgetall(actualLogKey)

      // 检查日志是否存在
      if (!logData || Object.keys(logData).length === 0) {
        logger.warn(`日志不存在: ${actualLogKey}`)
        return null
      }

      // 处理和反序列化复杂对象字段
      const processedLogData = { ...logData }

      // 改进的JSON反序列化函数，支持压缩数据
      const safeJSONParse = (fieldName, value) => {
        if (!value || typeof value !== 'string') {
          return null
        }

        try {
          // 尝试直接JSON解析
          return JSON.parse(value)
        } catch (e) {
          // 如果直接解析失败，检查是否是其他格式
          logger.debug(`解析${fieldName}失败 for log ${actualLogKey}:`, e.message)

          // 检查是否是被转义的JSON字符串
          if (value.startsWith('\\"') || value.includes('\\"')) {
            try {
              const unescaped = value.replace(/\\"/g, '"')
              return JSON.parse(unescaped)
            } catch (unescapeError) {
              logger.debug(`反转义后解析${fieldName}仍然失败:`, unescapeError.message)
            }
          }

          return null
        }
      }

      // 扩展的数据解压缩和反序列化字段
      const jsonFields = [
        'requestHeaders',
        'responseHeaders',
        'tokenDetails',
        'costDetails',
        'metadata'
      ]
      jsonFields.forEach((field) => {
        if (processedLogData[field]) {
          processedLogData[field] = safeJSONParse(field, processedLogData[field])
        }
      })

      // 扩展的数值类型字段转换（支持更多缓存token类型）
      const numericFields = {
        timestamp: 'int',
        duration: 'int',
        responseTime: 'float',
        inputTokens: 'int',
        outputTokens: 'int',
        totalTokens: 'int',
        cacheCreateTokens: 'int', // 新增缓存token
        cacheReadTokens: 'int', // 新增缓存token
        cost: 'float',
        status: 'int',
        tokens: 'int'
      }

      Object.entries(numericFields).forEach(([field, type]) => {
        if (processedLogData[field] !== undefined && processedLogData[field] !== '') {
          if (type === 'int') {
            processedLogData[field] = parseInt(processedLogData[field]) || 0
          } else if (type === 'float') {
            processedLogData[field] = parseFloat(processedLogData[field]) || 0
          }
        }
      })

      // 添加日志ID信息
      processedLogData.logId = actualLogKey
      processedLogData.shortLogId = cleanLogId
      processedLogData.originalLogId = logId

      // 增强的计算字段和元数据
      processedLogData.hasHeaders = !!(
        (processedLogData.requestHeaders &&
          Object.keys(processedLogData.requestHeaders).length > 0) ||
        (processedLogData.responseHeaders &&
          Object.keys(processedLogData.responseHeaders).length > 0)
      )

      processedLogData.hasBody = !!(
        (processedLogData.requestBody && processedLogData.requestBody.trim().length > 0) ||
        (processedLogData.responseBody && processedLogData.responseBody.trim().length > 0)
      )

      processedLogData.isError = (processedLogData.status || 0) >= 400
      processedLogData.dateTime = processedLogData.timestamp
        ? new Date(processedLogData.timestamp).toISOString()
        : null

      // 详细的状态分类
      const statusCode = processedLogData.status || 0
      processedLogData.statusCategory =
        statusCode >= 500
          ? 'server_error'
          : statusCode >= 400
            ? 'client_error'
            : statusCode >= 300
              ? 'redirect'
              : statusCode >= 200
                ? 'success'
                : 'unknown'

      // 增强的Token汇总信息（支持缓存token）
      processedLogData.tokenSummary = {
        totalTokens: processedLogData.totalTokens || processedLogData.tokens || 0,
        inputTokens: processedLogData.inputTokens || 0,
        outputTokens: processedLogData.outputTokens || 0,
        cacheCreateTokens: processedLogData.cacheCreateTokens || 0, // 新增
        cacheReadTokens: processedLogData.cacheReadTokens || 0, // 新增
        cost: processedLogData.cost || 0,
        costBreakdown: processedLogData.costDetails || null,
        efficiency: 0
      }

      // 计算token使用效率
      if (processedLogData.tokenSummary.totalTokens > 0) {
        processedLogData.tokenSummary.efficiency = parseFloat(
          (
            (processedLogData.tokenSummary.outputTokens /
              processedLogData.tokenSummary.totalTokens) *
            100
          ).toFixed(2)
        )
      }

      // 性能分析
      const responseTime = processedLogData.duration || processedLogData.responseTime || 0
      processedLogData.performanceAnalysis = {
        responseTimeMs: responseTime,
        isSlowRequest: responseTime > 5000, // 超过5秒
        performanceLevel:
          responseTime > 10000
            ? 'very_slow'
            : responseTime > 5000
              ? 'slow'
              : responseTime > 1000
                ? 'normal'
                : 'fast',
        tokenEfficiency: processedLogData.tokenSummary.efficiency,
        errorCategory: processedLogData.statusCategory
      }

      // 增强的详细元数据标志
      processedLogData.metadata = {
        // 基本检索信息
        retrievedAt: new Date().toISOString(),
        processingTimeMs: Date.now() - startTime,

        // 数据可用性标志
        hasRequestHeaders: !!(
          processedLogData.requestHeaders && Object.keys(processedLogData.requestHeaders).length > 0
        ),
        hasResponseHeaders: !!(
          processedLogData.responseHeaders &&
          Object.keys(processedLogData.responseHeaders).length > 0
        ),
        hasRequestBody: !!(
          processedLogData.requestBody && processedLogData.requestBody.trim().length > 0
        ),
        hasResponseBody: !!(
          processedLogData.responseBody && processedLogData.responseBody.trim().length > 0
        ),
        hasTokenDetails: !!(
          processedLogData.tokenDetails &&
          Object.keys(processedLogData.tokenDetails || {}).length > 0
        ),
        hasCostDetails: !!(
          processedLogData.costDetails && Object.keys(processedLogData.costDetails || {}).length > 0
        ),

        // 数据完整性标志
        isComplete: !!(
          processedLogData.requestHeaders &&
          processedLogData.responseHeaders &&
          processedLogData.tokenSummary
        ),
        hasError: processedLogData.isError,

        // 数据大小信息
        dataSize: {
          requestBodySize: processedLogData.requestBody ? processedLogData.requestBody.length : 0,
          responseBodySize: processedLogData.responseBody
            ? processedLogData.responseBody.length
            : 0,
          requestHeadersSize: processedLogData.requestHeaders
            ? JSON.stringify(processedLogData.requestHeaders).length
            : 0,
          responseHeadersSize: processedLogData.responseHeaders
            ? JSON.stringify(processedLogData.responseHeaders).length
            : 0,
          totalSize: 0
        },

        // Header分析
        headerAnalysis: {
          requestCount: processedLogData.requestHeaders
            ? Object.keys(processedLogData.requestHeaders).length
            : 0,
          responseCount: processedLogData.responseHeaders
            ? Object.keys(processedLogData.responseHeaders).length
            : 0,
          hasUserAgent: !!(
            processedLogData.requestHeaders?.['user-agent'] ||
            processedLogData.requestHeaders?.['User-Agent']
          ),
          hasContentType: !!(
            processedLogData.requestHeaders?.['content-type'] ||
            processedLogData.requestHeaders?.['Content-Type'] ||
            processedLogData.responseHeaders?.['content-type'] ||
            processedLogData.responseHeaders?.['Content-Type']
          )
        }
      }

      // 计算总数据大小
      processedLogData.metadata.dataSize.totalSize =
        processedLogData.metadata.dataSize.requestBodySize +
        processedLogData.metadata.dataSize.responseBodySize +
        processedLogData.metadata.dataSize.requestHeadersSize +
        processedLogData.metadata.dataSize.responseHeadersSize

      const endTime = Date.now()
      logger.debug(
        `成功获取日志详情: ${actualLogKey}, 耗时: ${endTime - startTime}ms, 字段数: ${Object.keys(processedLogData).length}, hasHeaders: ${processedLogData.hasHeaders}, hasBody: ${processedLogData.hasBody}, tokens: ${processedLogData.tokenSummary.totalTokens}`
      )

      return processedLogData
    } catch (error) {
      logger.error(`获取日志详情失败 ${logId}:`, {
        error: error.message,
        stack: error.stack,
        logId,
        timestamp: new Date().toISOString()
      })
      return null
    }
  }

  /**
   * ==========================================
   * 抽象日志存储接口 (Abstract Log Storage Interface)
   * ==========================================
   *
   * 以下方法提供数据库无关的日志存储抽象接口
   * 支持不同数据库后端的扩展 (Redis, MongoDB, PostgreSQL等)
   */

  /**
   * 批量写入日志条目
   * @param {Array} logEntries 日志条目数组
   * @param {Object} options 配置选项
   * @param {number} options.retentionMaxAge 数据保留时间 (毫秒)
   * @returns {Promise<Object>} 写入结果 {success: boolean, results: Array, errors: Array}
   */
  async batchWriteLogs(logEntries, options = {}) {
    const client = this.getClientSafe()
    const pipeline = client.pipeline()
    const results = { success: true, results: [], errors: [] }

    try {
      for (const logEntry of logEntries) {
        const logKey = this._generateLogKey(logEntry)
        const indexKey = this._generateIndexKey(logEntry)

        // 处理hash数据
        const dataEntries = Object.entries(logEntry.data).flat()
        if (dataEntries.length > 0 && dataEntries.length % 2 === 0) {
          // 清理null/undefined值
          const sanitizedEntries = dataEntries.map((entry) =>
            entry === null || entry === undefined ? '' : String(entry)
          )

          // 批量写入操作
          pipeline.hmset(logKey, ...sanitizedEntries)
          pipeline.expire(logKey, Math.floor(options.retentionMaxAge / 1000))

          // 更新索引
          pipeline.sadd(indexKey, logKey)
          pipeline.expire(indexKey, Math.floor(options.retentionMaxAge / 1000))

          results.results.push({ logKey, indexKey, status: 'queued' })
        } else {
          const error = `Invalid data structure for log entry: ${logKey}`
          results.errors.push({ logKey, error })
          logger.warn(`⚠️ ${error}`)
        }
      }

      // 执行批量操作
      const pipelineResults = await pipeline.exec()

      // 处理执行结果
      if (pipelineResults) {
        const errorResults = pipelineResults.filter(([err]) => err !== null)
        if (errorResults.length > 0) {
          results.success = false
          results.errors.push(
            ...errorResults.map(([err, res]) => ({
              error: err?.message || err,
              result: res
            }))
          )
        }
      }

      logger.debug(
        `📊 Batch write completed: ${logEntries.length} logs, ${results.errors.length} errors`
      )
      return results
    } catch (error) {
      logger.error('❌ Batch write logs failed:', error)
      results.success = false
      results.errors.push({ error: error.message })
      return results
    }
  }

  /**
   * 验证日志写入结果
   * @param {string} logKey 日志键
   * @returns {Promise<Object>} 验证结果 {success: boolean, data: Object|null}
   */
  async verifyLogWrite(logKey) {
    try {
      const client = this.getClientSafe()
      const data = await client.hgetall(logKey)

      return {
        success: data && Object.keys(data).length > 0,
        data: data || null,
        fieldsCount: data ? Object.keys(data).length : 0
      }
    } catch (error) {
      logger.error(`❌ Log write verification failed for ${logKey}:`, error)
      return {
        success: false,
        data: null,
        error: error.message
      }
    }
  }

  /**
   * 生成日志键
   * @private
   * @param {Object} logEntry 日志条目
   * @returns {string} 日志键
   */
  _generateLogKey(logEntry) {
    return `request_log:${logEntry.keyId}:${logEntry.timestamp}`
  }

  /**
   * 生成索引键
   * @private
   * @param {Object} logEntry 日志条目
   * @returns {string} 索引键
   */
  _generateIndexKey(logEntry) {
    // 使用时区转换的日期
    const date = getDateStringInTimezone(new Date(logEntry.timestamp))
    return `request_log_index:${logEntry.keyId}:${date}`
  }

  // ==================== 智能日志合并功能 ====================

  /**
   * 检测和查找重复的日志条目
   * @param {string} keyId API Key ID
   * @param {Object} logData 待检测的日志数据
   * @param {number} windowMs 检测时间窗口（毫秒）
   * @returns {Promise<Array>} 重复日志条目数组
   */
  async detectDuplicateLogs(keyId, logData, windowMs = 15000) {
    try {
      const client = this.getClientSafe()
      const currentTime = logData.timestamp || Date.now()
      const startTime = currentTime - windowMs
      const endTime = currentTime + windowMs

      // 搜索时间窗口内的相关日志
      const pattern = `request_log:${keyId}:*`
      const logKeys = await client.keys(pattern)

      const duplicates = []

      // 批量获取日志详情
      if (logKeys.length > 0) {
        const pipeline = client.pipeline()
        logKeys.forEach((key) => pipeline.hgetall(key))
        const results = await pipeline.exec()

        results.forEach(([err, logEntry], index) => {
          if (err || !logEntry) {
            return
          }

          const logTimestamp = parseInt(logEntry.timestamp)
          if (logTimestamp < startTime || logTimestamp > endTime) {
            return
          }

          // 计算相似度
          const similarity = this._calculateLogSimilarity(logData, logEntry)
          if (similarity > 0.8) {
            // 80%相似度阈值
            duplicates.push({
              logId: logKeys[index],
              timestamp: logTimestamp,
              priority: this._determinePriority(logEntry),
              similarity: Math.round(similarity * 100) / 100,
              data: logEntry
            })
          }
        })
      }

      // 按优先级和时间排序
      duplicates.sort((a, b) => {
        const priorityOrder = { enhanced: 3, basic: 2, unknown: 1 }
        const priorityDiff = (priorityOrder[b.priority] || 1) - (priorityOrder[a.priority] || 1)
        return priorityDiff !== 0 ? priorityDiff : b.timestamp - a.timestamp
      })

      return duplicates
    } catch (error) {
      logger.error('❌ Failed to detect duplicate logs:', error)
      return []
    }
  }

  /**
   * 合并多个日志条目
   * @param {string} primaryLogId 主要日志ID
   * @param {Array} duplicateLogIds 重复日志ID数组
   * @param {Object} mergeStrategy 合并策略配置
   * @returns {Promise<Object>} 合并结果
   */
  async mergeLogEntries(primaryLogId, duplicateLogIds, mergeStrategy = {}) {
    try {
      const client = this.getClientSafe()

      // 默认合并策略
      const strategy = {
        priority: mergeStrategy.priority || 'higher',
        preserveHeaders: mergeStrategy.preserveHeaders !== false,
        aggregateTokens: mergeStrategy.aggregateTokens !== false,
        ...mergeStrategy
      }

      // 获取所有要合并的日志数据
      const allLogIds = [primaryLogId, ...duplicateLogIds]
      const pipeline = client.pipeline()
      allLogIds.forEach((logId) => pipeline.hgetall(logId))
      const results = await pipeline.exec()

      const logEntries = results
        .filter(([err, data]) => !err && data && Object.keys(data).length > 0)
        .map(([, data]) => data)

      if (logEntries.length < 2) {
        return { success: false, error: 'Insufficient logs to merge' }
      }

      // 执行合并
      const mergedData = this._performLogMerge(logEntries, strategy)

      // 更新主日志
      await client.hmset(primaryLogId, mergedData)

      // 删除重复日志
      if (duplicateLogIds.length > 0) {
        await client.del(...duplicateLogIds)

        // 清理相关索引
        await this._cleanupLogIndexes(client, duplicateLogIds)
      }

      logger.info(`🔄 Merged ${duplicateLogIds.length} duplicate logs into ${primaryLogId}`)

      return {
        success: true,
        mergedLogId: primaryLogId,
        details: {
          mergedCount: duplicateLogIds.length,
          strategy: strategy.priority,
          preservedHeaders: strategy.preserveHeaders,
          aggregatedTokens: strategy.aggregateTokens
        }
      }
    } catch (error) {
      logger.error('❌ Failed to merge log entries:', error)
      return { success: false, error: error.message }
    }
  }

  /**
   * 计算日志相似度
   * @private
   * @param {Object} logA 日志A
   * @param {Object} logB 日志B
   * @returns {number} 相似度 (0-1)
   */
  _calculateLogSimilarity(logA, logB) {
    let score = 0
    let factors = 0

    // 路径相似度 (权重: 0.3)
    if (logA.path && logB.path) {
      score += logA.path === logB.path ? 0.3 : 0
      factors += 0.3
    }

    // 方法相似度 (权重: 0.2)
    if (logA.method && logB.method) {
      score += logA.method === logB.method ? 0.2 : 0
      factors += 0.2
    }

    // 模型相似度 (权重: 0.2)
    if (logA.model && logB.model) {
      score += logA.model === logB.model ? 0.2 : 0
      factors += 0.2
    }

    // 状态码相似度 (权重: 0.15)
    if (logA.status && logB.status) {
      score += logA.status === logB.status ? 0.15 : 0
      factors += 0.15
    }

    // Token数量相似度 (权重: 0.15)
    const tokensA = parseInt(logA.tokens || logA.totalTokens || 0)
    const tokensB = parseInt(logB.tokens || logB.totalTokens || 0)
    if (tokensA > 0 && tokensB > 0) {
      const tokenRatio = Math.min(tokensA, tokensB) / Math.max(tokensA, tokensB)
      score += tokenRatio > 0.8 ? 0.15 : 0
      factors += 0.15
    }

    return factors > 0 ? score / factors : 0
  }

  /**
   * 确定日志优先级
   * @private
   * @param {Object} logEntry 日志条目
   * @returns {string} 优先级
   */
  _determinePriority(logEntry) {
    if (logEntry.source === 'unified_service' || logEntry.logVersion?.startsWith('2.')) {
      return 'enhanced'
    }

    if (logEntry.requestHeaders || logEntry.responseHeaders || logEntry.tokenDetails) {
      return 'enhanced'
    }

    if (logEntry.logVersion || logEntry.source) {
      return 'basic'
    }

    return 'unknown'
  }

  /**
   * 执行日志数据合并
   * @private
   * @param {Array} logEntries 日志条目数组
   * @param {Object} strategy 合并策略
   * @returns {Object} 合并后的数据
   */
  _performLogMerge(logEntries, strategy) {
    // 按优先级排序，选择最佳数据源
    const sortedEntries = logEntries.sort((a, b) => {
      const priorityOrder = { enhanced: 3, basic: 2, unknown: 1 }
      const aPriority = this._determinePriority(a)
      const bPriority = this._determinePriority(b)
      return (priorityOrder[bPriority] || 1) - (priorityOrder[aPriority] || 1)
    })

    const primary = sortedEntries[0]
    const merged = { ...primary }

    // 聚合Token统计
    if (strategy.aggregateTokens) {
      let totalTokens = 0
      let totalInputTokens = 0
      let totalOutputTokens = 0
      let totalCacheCreateTokens = 0
      let totalCacheReadTokens = 0
      let totalRequests = 0

      logEntries.forEach((entry) => {
        totalTokens += parseInt(entry.tokens || entry.totalTokens || 0)
        totalInputTokens += parseInt(entry.inputTokens || 0)
        totalOutputTokens += parseInt(entry.outputTokens || 0)
        totalCacheCreateTokens += parseInt(entry.cacheCreateTokens || 0)
        totalCacheReadTokens += parseInt(entry.cacheReadTokens || 0)
        totalRequests += 1
      })

      merged.tokens = totalTokens
      merged.totalTokens = totalTokens
      merged.inputTokens = totalInputTokens
      merged.outputTokens = totalOutputTokens
      merged.cacheCreateTokens = totalCacheCreateTokens
      merged.cacheReadTokens = totalCacheReadTokens
      merged.mergedRequestCount = totalRequests
    }

    // 合并Headers信息
    if (strategy.preserveHeaders) {
      const allRequestHeaders = {}
      const allResponseHeaders = {}

      logEntries.forEach((entry) => {
        if (entry.requestHeaders) {
          const headers =
            typeof entry.requestHeaders === 'string'
              ? JSON.parse(entry.requestHeaders)
              : entry.requestHeaders
          Object.assign(allRequestHeaders, headers)
        }

        if (entry.responseHeaders) {
          const headers =
            typeof entry.responseHeaders === 'string'
              ? JSON.parse(entry.responseHeaders)
              : entry.responseHeaders
          Object.assign(allResponseHeaders, headers)
        }
      })

      if (Object.keys(allRequestHeaders).length > 0) {
        merged.requestHeaders = JSON.stringify(allRequestHeaders)
      }

      if (Object.keys(allResponseHeaders).length > 0) {
        merged.responseHeaders = JSON.stringify(allResponseHeaders)
      }
    }

    // 添加合并元数据
    merged.logVersion = '2.0.0-merged'
    merged.source = 'unified_service'
    merged.mergedAt = new Date().toISOString()
    merged.originalLogCount = logEntries.length

    return merged
  }

  // ==================== 账户费用统计方法 ====================

  /**
   * 获取账户费用统计
   * @param {string} accountId - 账户ID
   * @param {string} period - 时间范围 ('today', 'week', 'month', 'all')
   * @param {string} platform - 平台类型 ('claude', 'gemini', 'openai', 'bedrock', 'azure_openai', 'claude-console')
   * @returns {Promise<Object>} 账户费用统计数据
   */
  async getAccountCostStats(accountId, _period = 'all', platform = 'claude') {
    try {
      // 参数验证
      if (!accountId || typeof accountId !== 'string') {
        throw new Error('Invalid accountId: must be a non-empty string')
      }

      const now = new Date()
      const tzDate = getDateInTimezone(now)
      const dateString = getDateStringInTimezone(now)
      const currentMonth = `${tzDate.getUTCFullYear()}-${String(tzDate.getUTCMonth() + 1).padStart(2, '0')}`
      const currentHour = `${dateString}:${String(tzDate.getUTCHours()).padStart(2, '0')}`

      // 生成基于平台的Redis键
      // Claude保持向后兼容，其他平台使用平台前缀
      let accountKeyPart
      if (platform === 'claude') {
        // Claude保持原有键格式（向后兼容）
        accountKeyPart = `account:${accountId}`
      } else {
        // 其他平台使用平台前缀
        accountKeyPart = `account:${platform}:${accountId}`
      }

      const dailyKey = `usage:cost:daily:${accountKeyPart}:${dateString}`
      const monthlyKey = `usage:cost:monthly:${accountKeyPart}:${currentMonth}`
      const hourlyKey = `usage:cost:hourly:${accountKeyPart}:${currentHour}`
      const totalKey = `usage:cost:total:${accountKeyPart}`

      // 批量获取费用数据
      const [daily, monthly, hourly, total] = await Promise.all([
        this.client.get(dailyKey),
        this.client.get(monthlyKey),
        this.client.get(hourlyKey),
        this.client.get(totalKey)
      ])

      // 获取模型级别的费用统计
      const modelDailyPattern = `usage:cost:daily:${accountKeyPart}:*:${dateString}`
      const modelMonthlyPattern = `usage:cost:monthly:${accountKeyPart}:*:${currentMonth}`

      const [modelDailyKeys, modelMonthlyKeys] = await Promise.all([
        this.client.keys(modelDailyPattern),
        this.client.keys(modelMonthlyPattern)
      ])

      // 获取模型费用详情
      const modelStats = {
        daily: {},
        monthly: {}
      }

      if (modelDailyKeys.length > 0) {
        const modelDailyPipeline = this.client.pipeline()
        modelDailyKeys.forEach((key) => modelDailyPipeline.get(key))
        const modelDailyResults = await modelDailyPipeline.exec()

        modelDailyKeys.forEach((key, index) => {
          const model = key.split(':')[6] // 提取模型名
          const cost = parseFloat(modelDailyResults[index][1]) || 0
          if (cost > 0) {
            modelStats.daily[model] = cost
          }
        })
      }

      if (modelMonthlyKeys.length > 0) {
        const modelMonthlyPipeline = this.client.pipeline()
        modelMonthlyKeys.forEach((key) => modelMonthlyPipeline.get(key))
        const modelMonthlyResults = await modelMonthlyPipeline.exec()

        modelMonthlyKeys.forEach((key, index) => {
          const model = key.split(':')[6] // 提取模型名
          const cost = parseFloat(modelMonthlyResults[index][1]) || 0
          if (cost > 0) {
            modelStats.monthly[model] = cost
          }
        })
      }

      // 使用Decimal.js确保精度
      const dailyCost = new Decimal(parseFloat(daily) || 0)
      const monthlyCost = new Decimal(parseFloat(monthly) || 0)
      const hourlyCost = new Decimal(parseFloat(hourly) || 0)
      const totalCost = new Decimal(parseFloat(total) || 0)

      const costStats = {
        accountId,
        timestamp: now.toISOString(),
        timezone: config.timezone || 'UTC',
        costs: {
          daily: dailyCost.toNumber(),
          monthly: monthlyCost.toNumber(),
          hourly: hourlyCost.toNumber(),
          total: totalCost.toNumber()
        },
        formatted: {
          daily: CostCalculator.formatCost(dailyCost.toNumber()),
          monthly: CostCalculator.formatCost(monthlyCost.toNumber()),
          hourly: CostCalculator.formatCost(hourlyCost.toNumber()),
          total: CostCalculator.formatCost(totalCost.toNumber())
        },
        modelBreakdown: modelStats,
        period: {
          daily: dateString,
          monthly: currentMonth,
          hourly: `${dateString}:${String(tzDate.getUTCHours()).padStart(2, '0')}`
        },
        averages: {
          // 计算月度日均费用
          dailyAverage: monthlyCost.div(new Date().getDate()).toNumber(),
          // 计算小时均费用
          hourlyAverage: dailyCost.div(24).toNumber()
        }
      }

      logger.debug(
        `💰 Retrieved cost stats for account ${accountId}: daily=$${dailyCost.toString()}, monthly=$${monthlyCost.toString()}, total=$${totalCost.toString()}`
      )

      return costStats
    } catch (error) {
      logger.error(`❌ Failed to get account cost stats for ${accountId}:`, error)
      // 降级处理 - 返回默认统计结构
      return {
        accountId,
        timestamp: new Date().toISOString(),
        timezone: config.timezone || 'UTC',
        costs: {
          daily: 0,
          monthly: 0,
          hourly: 0,
          total: 0
        },
        formatted: {
          daily: '$0.000000',
          monthly: '$0.000000',
          hourly: '$0.000000',
          total: '$0.000000'
        },
        modelBreakdown: {
          daily: {},
          monthly: {}
        },
        period: {
          daily: getDateStringInTimezone(),
          monthly: new Date().toISOString().substring(0, 7),
          hourly: `${getDateStringInTimezone()}:${String(getHourInTimezone()).padStart(2, '0')}`
        },
        averages: {
          dailyAverage: 0,
          hourlyAverage: 0
        },
        error: error.message
      }
    }
  }

  // ==================== 用户管理 (8个方法) ====================

  /**
   * 创建用户
   * @param {Object} userData - 用户数据
   * @param {string} userData.username - 用户名
   * @param {string} userData.email - 邮箱
   * @param {string} userData.passwordHash - 密码哈希
   * @param {string} [userData.role='user'] - 用户角色
   * @param {Array} [userData.permissions=[]] - 用户权限
   * @param {Array} [userData.groups=[]] - 用户分组
   * @returns {Promise<string>} 用户ID
   */
  async createUser(userData) {
    try {
      const client = this.getClientSafe()
      const userId = require('crypto').randomUUID()
      const now = new Date().toISOString()

      // 验证必需字段
      if (!userData.username || !userData.passwordHash) {
        throw new Error('Username and passwordHash are required')
      }

      // 检查用户名唯一性
      const existingUser = await client.get(`user_username:${userData.username}`)
      if (existingUser) {
        throw new Error('Username already exists')
      }

      // 检查邮箱唯一性（如果提供）
      if (userData.email) {
        const existingEmail = await client.get(`user_email:${userData.email}`)
        if (existingEmail) {
          throw new Error('Email already exists')
        }
      }

      const user = {
        id: userId,
        username: userData.username,
        email: userData.email || '',
        passwordHash: userData.passwordHash,
        role: userData.role || 'user',
        permissions: JSON.stringify(userData.permissions || []),
        groups: JSON.stringify(userData.groups || []),
        isActive: 'true',
        lastLogin: '',
        createdAt: now,
        updatedAt: now,
        ldapDN: userData.ldapDN || '',
        preferences: JSON.stringify(userData.preferences || {})
      }

      // 使用事务保证数据一致性
      const pipeline = client.pipeline()
      pipeline.hset(`user:${userId}`, user)
      pipeline.set(`user_username:${userData.username}`, userId)
      if (userData.email) {
        pipeline.set(`user_email:${userData.email}`, userId)
      }
      await pipeline.exec()

      logger.info(`👤 Created user: ${userData.username} (${userId})`)
      return userId
    } catch (error) {
      logger.error('❌ Failed to create user:', error)
      throw error
    }
  }

  /**
   * 根据用户名获取用户
   * @param {string} username - 用户名
   * @returns {Promise<Object|null>} 用户数据
   */
  async getUserByUsername(username) {
    try {
      if (!username) {
        return null
      }

      const client = this.getClientSafe()
      const userId = await client.get(`user_username:${username}`)

      if (!userId) {
        return null
      }

      return await this.getUserById(userId)
    } catch (error) {
      logger.error(`❌ Failed to get user by username ${username}:`, error)
      return null
    }
  }

  /**
   * 根据用户ID获取用户
   * @param {string} userId - 用户ID
   * @returns {Promise<Object|null>} 用户数据
   */
  async getUserById(userId) {
    try {
      if (!userId) {
        return null
      }

      const client = this.getClientSafe()
      const userData = await client.hgetall(`user:${userId}`)

      if (!userData || Object.keys(userData).length === 0) {
        return null
      }

      // 解析JSON字段
      return {
        ...userData,
        permissions: JSON.parse(userData.permissions || '[]'),
        groups: JSON.parse(userData.groups || '[]'),
        preferences: JSON.parse(userData.preferences || '{}'),
        isActive: userData.isActive === 'true'
      }
    } catch (error) {
      logger.error(`❌ Failed to get user by ID ${userId}:`, error)
      return null
    }
  }

  /**
   * 更新用户信息
   * @param {string} userId - 用户ID
   * @param {Object} updateData - 更新数据
   * @returns {Promise<boolean>} 更新是否成功
   */
  async updateUser(userId, updateData) {
    try {
      const client = this.getClientSafe()
      const existingUser = await this.getUserById(userId)

      if (!existingUser) {
        throw new Error('User not found')
      }

      const now = new Date().toISOString()
      const pipeline = client.pipeline()

      // 准备更新数据
      const updates = {
        updatedAt: now
      }

      // 处理各字段的更新
      const allowedFields = [
        'email',
        'passwordHash',
        'role',
        'permissions',
        'groups',
        'isActive',
        'ldapDN',
        'preferences'
      ]

      for (const [field, value] of Object.entries(updateData)) {
        if (allowedFields.includes(field)) {
          if (field === 'permissions' || field === 'groups' || field === 'preferences') {
            updates[field] = JSON.stringify(value)
          } else if (field === 'isActive') {
            updates[field] = value ? 'true' : 'false'
          } else {
            updates[field] = value
          }
        }
      }

      // 检查邮箱唯一性（如果更新邮箱）
      if (updateData.email && updateData.email !== existingUser.email) {
        const existingEmail = await client.get(`user_email:${updateData.email}`)
        if (existingEmail && existingEmail !== userId) {
          throw new Error('Email already exists')
        }

        // 更新邮箱映射
        if (existingUser.email) {
          pipeline.del(`user_email:${existingUser.email}`)
        }
        pipeline.set(`user_email:${updateData.email}`, userId)
      }

      pipeline.hset(`user:${userId}`, updates)
      await pipeline.exec()

      logger.info(`👤 Updated user: ${existingUser.username} (${userId})`)
      return true
    } catch (error) {
      logger.error(`❌ Failed to update user ${userId}:`, error)
      throw error
    }
  }

  /**
   * 删除用户（软删除）
   * @param {string} userId - 用户ID
   * @returns {Promise<boolean>} 删除是否成功
   */
  async deleteUser(userId) {
    try {
      const client = this.getClientSafe()
      const existingUser = await this.getUserById(userId)

      if (!existingUser) {
        return false
      }

      const now = new Date().toISOString()
      const pipeline = client.pipeline()

      // 软删除：标记为非活跃并添加删除标记
      pipeline.hset(`user:${userId}`, {
        isActive: 'false',
        deletedAt: now,
        updatedAt: now
      })

      // 清理映射（防止用户名/邮箱被重用）
      pipeline.del(`user_username:${existingUser.username}`)
      if (existingUser.email) {
        pipeline.del(`user_email:${existingUser.email}`)
      }

      // 清理用户会话
      const sessionKeys = await client.keys(`session:*`)
      for (const sessionKey of sessionKeys) {
        const sessionData = await client.hgetall(sessionKey)
        if (sessionData.userId === userId) {
          pipeline.del(sessionKey)
        }
      }

      await pipeline.exec()

      logger.info(`👤 Deleted user: ${existingUser.username} (${userId})`)
      return true
    } catch (error) {
      logger.error(`❌ Failed to delete user ${userId}:`, error)
      throw error
    }
  }

  /**
   * 创建用户会话
   * @param {string} userId - 用户ID
   * @param {Object} sessionData - 会话数据
   * @param {number} [expiresIn=86400] - 过期时间（秒）
   * @returns {Promise<string>} 会话令牌
   */
  async createSession(userId, sessionData, expiresIn = 86400) {
    try {
      const client = this.getClientSafe()
      const sessionToken = require('crypto').randomBytes(32).toString('hex')
      const now = new Date().toISOString()
      const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()

      const session = {
        token: sessionToken,
        userId,
        createdAt: now,
        lastActivity: now,
        expiresAt,
        ipAddress: sessionData.ipAddress || '',
        userAgent: sessionData.userAgent || '',
        isActive: 'true'
      }

      await client.hset(`session:${sessionToken}`, session)
      await client.expire(`session:${sessionToken}`, expiresIn)

      // 更新用户最后登录时间
      await client.hset(`user:${userId}`, { lastLogin: now })

      logger.info(`🔑 Created session for user ${userId}: ${sessionToken.substring(0, 8)}...`)
      return sessionToken
    } catch (error) {
      logger.error(`❌ Failed to create session for user ${userId}:`, error)
      throw error
    }
  }

  /**
   * 验证用户会话
   * @param {string} sessionToken - 会话令牌
   * @returns {Promise<Object|null>} 会话数据
   */
  async validateSession(sessionToken) {
    try {
      if (!sessionToken) {
        return null
      }

      const client = this.getClientSafe()
      const sessionData = await client.hgetall(`session:${sessionToken}`)

      if (!sessionData || Object.keys(sessionData).length === 0) {
        return null
      }

      // 检查会话是否过期
      const now = new Date()
      const expiresAt = new Date(sessionData.expiresAt)

      if (now > expiresAt || sessionData.isActive !== 'true') {
        await this.destroySession(sessionToken)
        return null
      }

      // 获取用户信息
      const user = await this.getUserById(sessionData.userId)
      if (!user || !user.isActive) {
        await this.destroySession(sessionToken)
        return null
      }

      // 更新最后活动时间
      await client.hset(`session:${sessionToken}`, { lastActivity: now.toISOString() })

      return {
        ...sessionData,
        user
      }
    } catch (error) {
      logger.error(`❌ Failed to validate session ${sessionToken}:`, error)
      return null
    }
  }

  /**
   * 销毁用户会话
   * @param {string} sessionToken - 会话令牌
   * @returns {Promise<boolean>} 是否成功
   */
  async destroySession(sessionToken) {
    try {
      if (!sessionToken) {
        return false
      }

      const client = this.getClientSafe()
      const result = await client.del(`session:${sessionToken}`)

      if (result > 0) {
        logger.info(`🔑 Destroyed session: ${sessionToken.substring(0, 8)}...`)
      }

      return result > 0
    } catch (error) {
      logger.error(`❌ Failed to destroy session ${sessionToken}:`, error)
      return false
    }
  }

  // ==================== 分组管理 (6个方法) ====================

  /**
   * 创建分组
   * @param {Object} groupData - 分组数据
   * @returns {Promise<string>} 分组ID
   */
  async createGroup(groupData) {
    try {
      const client = this.getClientSafe()
      const groupId = require('crypto').randomUUID()
      const now = new Date().toISOString()

      // 验证必需字段
      if (!groupData.name) {
        throw new Error('Group name is required')
      }

      // 检查分组名唯一性
      const existingGroup = await client.get(`group_name:${groupData.name}`)
      if (existingGroup) {
        throw new Error('Group name already exists')
      }

      const group = {
        id: groupId,
        name: groupData.name,
        description: groupData.description || '',
        permissions: JSON.stringify(groupData.permissions || []),
        assignedAccounts: JSON.stringify(
          groupData.assignedAccounts || {
            claudeAccounts: [],
            geminiAccounts: [],
            openaiAccounts: []
          }
        ),
        scheduling: JSON.stringify(
          groupData.scheduling || {
            strategy: 'random',
            weights: {}
          }
        ),
        isActive: 'true',
        createdAt: now,
        updatedAt: now
      }

      // 使用事务保证数据一致性
      const pipeline = client.pipeline()
      pipeline.hset(`group:${groupId}`, group)
      pipeline.set(`group_name:${groupData.name}`, groupId)
      await pipeline.exec()

      logger.info(`👥 Created group: ${groupData.name} (${groupId})`)
      return groupId
    } catch (error) {
      logger.error('❌ Failed to create group:', error)
      throw error
    }
  }

  /**
   * 将用户分配到分组
   * @param {string} userId - 用户ID
   * @param {string} groupId - 分组ID
   * @returns {Promise<boolean>} 是否成功
   */
  async assignUserToGroup(userId, groupId) {
    try {
      const client = this.getClientSafe()

      // 验证用户和分组存在
      const user = await this.getUserById(userId)
      const group = await client.hgetall(`group:${groupId}`)

      if (!user) {
        throw new Error('User not found')
      }

      if (!group || Object.keys(group).length === 0) {
        throw new Error('Group not found')
      }

      // 检查用户是否已在分组中
      if (user.groups.includes(groupId)) {
        return true // 已经在分组中
      }

      // 更新用户的分组列表
      const updatedGroups = [...user.groups, groupId]
      await this.updateUser(userId, { groups: updatedGroups })

      logger.info(`👥 Assigned user ${user.username} to group ${group.name}`)
      return true
    } catch (error) {
      logger.error(`❌ Failed to assign user ${userId} to group ${groupId}:`, error)
      throw error
    }
  }

  /**
   * 获取用户的分组
   * @param {string} userId - 用户ID
   * @returns {Promise<Array>} 用户分组列表
   */
  async getUserGroups(userId) {
    try {
      const user = await this.getUserById(userId)

      if (!user || !user.groups.length) {
        return []
      }

      const client = this.getClientSafe()
      const groupDetails = []

      for (const groupId of user.groups) {
        const groupData = await client.hgetall(`group:${groupId}`)
        if (groupData && Object.keys(groupData).length > 0) {
          groupDetails.push({
            ...groupData,
            permissions: JSON.parse(groupData.permissions || '[]'),
            assignedAccounts: JSON.parse(groupData.assignedAccounts || '{}'),
            scheduling: JSON.parse(groupData.scheduling || '{}'),
            isActive: groupData.isActive === 'true'
          })
        }
      }

      return groupDetails
    } catch (error) {
      logger.error(`❌ Failed to get user groups for ${userId}:`, error)
      return []
    }
  }

  /**
   * 获取分组的分配账户
   * @param {string} groupId - 分组ID
   * @returns {Promise<Object>} 分配的账户
   */
  async getGroupAccounts(groupId) {
    try {
      const client = this.getClientSafe()
      const groupData = await client.hgetall(`group:${groupId}`)

      if (!groupData || Object.keys(groupData).length === 0) {
        return {}
      }

      return JSON.parse(groupData.assignedAccounts || '{}')
    } catch (error) {
      logger.error(`❌ Failed to get group accounts for ${groupId}:`, error)
      return {}
    }
  }

  /**
   * 更新分组信息
   * @param {string} groupId - 分组ID
   * @param {Object} updateData - 更新数据
   * @returns {Promise<boolean>} 是否成功
   */
  async updateGroup(groupId, updateData) {
    try {
      const client = this.getClientSafe()
      const existingGroup = await client.hgetall(`group:${groupId}`)

      if (!existingGroup || Object.keys(existingGroup).length === 0) {
        throw new Error('Group not found')
      }

      const now = new Date().toISOString()
      const pipeline = client.pipeline()

      // 准备更新数据
      const updates = {
        updatedAt: now
      }

      const allowedFields = [
        'description',
        'permissions',
        'assignedAccounts',
        'scheduling',
        'isActive'
      ]

      for (const [field, value] of Object.entries(updateData)) {
        if (allowedFields.includes(field)) {
          if (field === 'permissions' || field === 'assignedAccounts' || field === 'scheduling') {
            updates[field] = JSON.stringify(value)
          } else if (field === 'isActive') {
            updates[field] = value ? 'true' : 'false'
          } else {
            updates[field] = value
          }
        }
      }

      pipeline.hset(`group:${groupId}`, updates)
      await pipeline.exec()

      logger.info(`👥 Updated group: ${existingGroup.name} (${groupId})`)
      return true
    } catch (error) {
      logger.error(`❌ Failed to update group ${groupId}:`, error)
      throw error
    }
  }

  /**
   * 删除分组
   * @param {string} groupId - 分组ID
   * @returns {Promise<boolean>} 是否成功
   */
  async deleteGroup(groupId) {
    try {
      const client = this.getClientSafe()
      const existingGroup = await client.hgetall(`group:${groupId}`)

      if (!existingGroup || Object.keys(existingGroup).length === 0) {
        return false
      }

      const pipeline = client.pipeline()

      // 从所有用户中移除此分组
      const userKeys = await client.keys('user:*')
      for (const userKey of userKeys) {
        const userData = await client.hgetall(userKey)
        if (userData.groups) {
          const groups = JSON.parse(userData.groups)
          const updatedGroups = groups.filter((id) => id !== groupId)
          if (groups.length !== updatedGroups.length) {
            pipeline.hset(userKey, {
              groups: JSON.stringify(updatedGroups),
              updatedAt: new Date().toISOString()
            })
          }
        }
      }

      // 删除分组数据
      pipeline.del(`group:${groupId}`)
      pipeline.del(`group_name:${existingGroup.name}`)

      await pipeline.exec()

      logger.info(`👥 Deleted group: ${existingGroup.name} (${groupId})`)
      return true
    } catch (error) {
      logger.error(`❌ Failed to delete group ${groupId}:`, error)
      throw error
    }
  }

  /**
   * 获取所有分组
   * @returns {Promise<Array>} 分组列表
   */
  async getAllGroups() {
    const keys = await this.client.keys('group:*')
    const groups = []

    for (const key of keys) {
      // 跳过非分组key (如group_name:*)
      if (!key.startsWith('group:') || key.includes('group_name:')) {
        continue
      }

      const groupData = await this.client.hgetall(key)
      if (groupData && Object.keys(groupData).length > 0) {
        groups.push({
          id: key.replace('group:', ''),
          ...groupData,
          permissions: JSON.parse(groupData.permissions || '[]'),
          assignedAccounts: JSON.parse(groupData.assignedAccounts || '{}'),
          scheduling: JSON.parse(groupData.scheduling || '{}'),
          isActive: groupData.isActive === 'true',
          createdAt: groupData.createdAt,
          updatedAt: groupData.updatedAt
        })
      }
    }

    return groups
  }

  // ==================== 智能负载均衡支持方法 ====================

  /**
   * 记录账户使用统计（用于智能负载均衡）
   * @param {string} accountId - 账户ID
   * @param {Object} usageData - 使用数据
   * @returns {Promise<boolean>} 操作成功返回true
   */
  async recordAccountUsage(accountId, usageData) {
    try {
      await this.ensureConnection()
      const client = this.getClientSafe()

      const now = Date.now()
      const {
        timestamp = now,
        responseTime = null,
        cost = null,
        status = 'success',
        ...extraData
      } = usageData

      // 构建使用记录
      const usageRecord = {
        accountId,
        timestamp,
        responseTime,
        cost,
        status,
        ...extraData
      }

      // 使用有序集合存储使用记录，按时间戳排序
      const usageKey = `account_usage:${accountId}`
      await client.zadd(usageKey, timestamp, JSON.stringify(usageRecord))

      // 设置过期时间（7天）
      await client.expire(usageKey, 7 * 24 * 60 * 60)

      // 清理过期数据（保留最近7天）
      const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000
      await client.zremrangebyscore(usageKey, '-inf', sevenDaysAgo)

      logger.debug(`📈 Recorded usage for account ${accountId}`, { responseTime, cost, status })
      return true
    } catch (error) {
      logger.error(`❌ Failed to record account usage for ${accountId}:`, error)
      throw error
    }
  }

  /**
   * 获取指定时间窗口内的账户使用统计
   * @param {string} accountId - 账户ID
   * @param {number} startTime - 开始时间戳
   * @param {number} endTime - 结束时间戳
   * @returns {Promise<Array>} 使用统计数组
   */
  async getAccountUsageInTimeWindow(accountId, startTime, endTime) {
    try {
      await this.ensureConnection()
      const client = this.getClientSafe()

      const usageKey = `account_usage:${accountId}`

      // 从有序集合中获取指定时间窗口的数据
      const usageRecords = await client.zrangebyscore(usageKey, startTime, endTime)

      const parsedRecords = usageRecords
        .map((record) => {
          try {
            return JSON.parse(record)
          } catch (parseError) {
            logger.warn(`⚠️ Failed to parse usage record for account ${accountId}:`, parseError)
            return null
          }
        })
        .filter((record) => record !== null)

      logger.debug(
        `📊 Retrieved ${parsedRecords.length} usage records for account ${accountId} in time window`
      )
      return parsedRecords
    } catch (error) {
      logger.error(`❌ Failed to get account usage for ${accountId}:`, error)
      // 返回空数组而不是抛出错误，以便负载均衡器可以继续工作
      return []
    }
  }

  /**
   * 获取账户性能摘要统计
   * @param {string} accountId - 账户ID
   * @param {number} timeWindow - 时间窗口（毫秒），默认5分钟
   * @returns {Promise<Object>} 性能统计摘要
   */
  async getAccountPerformanceSummary(accountId, timeWindow = 300000) {
    try {
      const now = Date.now()
      const windowStart = now - timeWindow

      const usageRecords = await this.getAccountUsageInTimeWindow(accountId, windowStart, now)

      if (usageRecords.length === 0) {
        return {
          accountId,
          timeWindow,
          totalRequests: 0,
          errorCount: 0,
          avgResponseTime: 0,
          avgCost: 0,
          successRate: 1.0,
          lastUsedAt: null
        }
      }

      const totalRequests = usageRecords.length
      const errorCount = usageRecords.filter((record) => record.status === 'error').length
      const successfulRequests = usageRecords.filter((record) => record.status === 'success')

      // 计算平均响应时间（仅成功请求）
      const responseTimeSamples = successfulRequests
        .filter((record) => record.responseTime && record.responseTime > 0)
        .map((record) => record.responseTime)

      const avgResponseTime =
        responseTimeSamples.length > 0
          ? responseTimeSamples.reduce((sum, time) => sum + time, 0) / responseTimeSamples.length
          : 0

      // 计算平均成本（仅成功请求）
      const costSamples = successfulRequests
        .filter((record) => record.cost && record.cost > 0)
        .map((record) => record.cost)

      const avgCost =
        costSamples.length > 0
          ? costSamples.reduce((sum, cost) => sum + cost, 0) / costSamples.length
          : 0

      // 计算成功率
      const successRate = totalRequests > 0 ? (totalRequests - errorCount) / totalRequests : 1.0

      // 最后使用时间
      const lastUsedAt = Math.max(...usageRecords.map((record) => record.timestamp))

      const summary = {
        accountId,
        timeWindow,
        totalRequests,
        errorCount,
        avgResponseTime: Math.round(avgResponseTime),
        avgCost: parseFloat(avgCost.toFixed(6)),
        successRate: parseFloat(successRate.toFixed(4)),
        lastUsedAt: new Date(lastUsedAt).toISOString()
      }

      logger.debug(`📊 Performance summary for account ${accountId}:`, summary)
      return summary
    } catch (error) {
      logger.error(`❌ Failed to get performance summary for ${accountId}:`, error)
      // 返回默认统计信息
      return {
        accountId,
        timeWindow,
        totalRequests: 0,
        errorCount: 0,
        avgResponseTime: 0,
        avgCost: 0,
        successRate: 1.0,
        lastUsedAt: null
      }
    }
  }

  /**
   * 批量获取多个账户的性能摘要
   * @param {Array<string>} accountIds - 账户ID列表
   * @param {number} timeWindow - 时间窗口（毫秒）
   * @returns {Promise<Object>} 账户ID到性能摘要的映射
   */
  async getMultipleAccountPerformanceSummaries(accountIds, timeWindow = 300000) {
    try {
      const summaries = {}

      // 并行获取所有账户的性能摘要
      const promises = accountIds.map(async (accountId) => {
        try {
          const summary = await this.getAccountPerformanceSummary(accountId, timeWindow)
          return { accountId, summary }
        } catch (error) {
          logger.warn(`⚠️ Failed to get performance summary for account ${accountId}:`, error)
          return {
            accountId,
            summary: {
              accountId,
              timeWindow,
              totalRequests: 0,
              errorCount: 0,
              avgResponseTime: 0,
              avgCost: 0,
              successRate: 1.0,
              lastUsedAt: null
            }
          }
        }
      })

      const results = await Promise.all(promises)

      results.forEach(({ accountId, summary }) => {
        summaries[accountId] = summary
      })

      logger.debug(`📊 Retrieved performance summaries for ${accountIds.length} accounts`)
      return summaries
    } catch (error) {
      logger.error('❌ Failed to get multiple account performance summaries:', error)
      // 返回空对象而不是抛出错误
      return {}
    }
  }

  /**
   * 清理过期的账户使用数据
   * @param {number} maxAge - 最大保存时间（毫秒），默认7天
   * @returns {Promise<number>} 清理的记录数
   */
  async cleanupAccountUsageData(maxAge = 7 * 24 * 60 * 60 * 1000) {
    try {
      await this.ensureConnection()
      const client = this.getClientSafe()

      const cutoffTime = Date.now() - maxAge
      const usageKeys = await client.keys('account_usage:*')

      let totalCleaned = 0
      for (const key of usageKeys) {
        const cleaned = await client.zremrangebyscore(key, '-inf', cutoffTime)
        totalCleaned += cleaned

        // 如果键为空，删除它
        const remainingCount = await client.zcard(key)
        if (remainingCount === 0) {
          await client.del(key)
        }
      }

      logger.info(
        `🧹 Cleaned up ${totalCleaned} expired usage records from ${usageKeys.length} accounts`
      )
      return totalCleaned
    } catch (error) {
      logger.error('❌ Failed to cleanup account usage data:', error)
      return 0
    }
  }
}

// 导出时区辅助函数
RedisAdapter.getDateInTimezone = getDateInTimezone
RedisAdapter.getDateStringInTimezone = getDateStringInTimezone
RedisAdapter.getHourInTimezone = getHourInTimezone

module.exports = RedisAdapter
