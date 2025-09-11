const crypto = require('crypto')
const { v4: uuidv4 } = require('uuid')
const config = require('../../config/config')
const database = require('../models/database')
const logger = require('../utils/logger')

class ApiKeyService {
  constructor() {
    this.prefix = config.security.apiKeyPrefix
  }

  // 🔑 生成新的API Key
  async generateApiKey(options = {}) {
    const {
      name = 'Unnamed Key',
      description = '',
      tokenLimit = config.limits.defaultTokenLimit,
      expiresAt = null,
      claudeAccountId = null,
      claudeConsoleAccountId = null,
      geminiAccountId = null,
      openaiAccountId = null,
      azureOpenaiAccountId = null,
      bedrockAccountId = null, // 添加 Bedrock 账号ID支持
      permissions = 'all', // 'claude', 'gemini', 'openai', 'all'
      isActive = true,
      concurrencyLimit = 0,
      rateLimitWindow = null,
      rateLimitRequests = null,
      enableModelRestriction = false,
      restrictedModels = [],
      enableClientRestriction = false,
      allowedClients = [],
      dailyCostLimit = 0,
      tags = []
    } = options

    // 生成简单的API Key (64字符十六进制)
    const apiKey = `${this.prefix}${this._generateSecretKey()}`
    const keyId = uuidv4()
    const hashedKey = this._hashApiKey(apiKey)

    const keyData = {
      id: keyId,
      name,
      description,
      apiKey: hashedKey,
      tokenLimit: String(tokenLimit ?? 0),
      concurrencyLimit: String(concurrencyLimit ?? 0),
      rateLimitWindow: String(rateLimitWindow ?? 0),
      rateLimitRequests: String(rateLimitRequests ?? 0),
      isActive: String(isActive),
      claudeAccountId: claudeAccountId || '',
      claudeConsoleAccountId: claudeConsoleAccountId || '',
      geminiAccountId: geminiAccountId || '',
      openaiAccountId: openaiAccountId || '',
      azureOpenaiAccountId: azureOpenaiAccountId || '',
      bedrockAccountId: bedrockAccountId || '', // 添加 Bedrock 账号ID
      permissions: permissions || 'all',
      enableModelRestriction: String(enableModelRestriction),
      restrictedModels: JSON.stringify(restrictedModels || []),
      enableClientRestriction: String(enableClientRestriction || false),
      allowedClients: JSON.stringify(allowedClients || []),
      dailyCostLimit: String(dailyCostLimit || 0),
      tags: JSON.stringify(tags || []),
      createdAt: new Date().toISOString(),
      lastUsedAt: '',
      expiresAt: expiresAt || '',
      createdBy: 'admin' // 可以根据需要扩展用户系统
    }

    // 保存API Key数据并建立哈希映射
    await database.setApiKey(keyId, keyData, hashedKey)

    logger.success(`🔑 Generated new API key: ${name} (${keyId})`)

    return {
      id: keyId,
      apiKey, // 只在创建时返回完整的key
      name: keyData.name,
      description: keyData.description,
      tokenLimit: parseInt(keyData.tokenLimit),
      concurrencyLimit: parseInt(keyData.concurrencyLimit),
      rateLimitWindow: parseInt(keyData.rateLimitWindow || 0),
      rateLimitRequests: parseInt(keyData.rateLimitRequests || 0),
      isActive: keyData.isActive === 'true',
      claudeAccountId: keyData.claudeAccountId,
      claudeConsoleAccountId: keyData.claudeConsoleAccountId,
      geminiAccountId: keyData.geminiAccountId,
      openaiAccountId: keyData.openaiAccountId,
      azureOpenaiAccountId: keyData.azureOpenaiAccountId,
      bedrockAccountId: keyData.bedrockAccountId, // 添加 Bedrock 账号ID
      permissions: keyData.permissions,
      enableModelRestriction: keyData.enableModelRestriction === 'true',
      restrictedModels: JSON.parse(keyData.restrictedModels),
      enableClientRestriction: keyData.enableClientRestriction === 'true',
      allowedClients: JSON.parse(keyData.allowedClients || '[]'),
      dailyCostLimit: parseFloat(keyData.dailyCostLimit || 0),
      tags: JSON.parse(keyData.tags || '[]'),
      createdAt: keyData.createdAt,
      expiresAt: keyData.expiresAt,
      createdBy: keyData.createdBy
    }
  }

  // 🔍 验证API Key
  async validateApiKey(apiKey) {
    try {
      if (!apiKey || !apiKey.startsWith(this.prefix)) {
        return { valid: false, error: 'Invalid API key format' }
      }

      // 计算API Key的哈希值
      const hashedKey = this._hashApiKey(apiKey)

      // 通过哈希值直接查找API Key（性能优化）
      const keyData = await database.findApiKeyByHash(hashedKey)

      if (!keyData) {
        return { valid: false, error: 'API key not found' }
      }

      // 检查是否激活
      if (keyData.isActive !== 'true') {
        return { valid: false, error: 'API key is disabled' }
      }

      // 检查是否过期
      if (keyData.expiresAt && new Date() > new Date(keyData.expiresAt)) {
        return { valid: false, error: 'API key has expired' }
      }

      // 获取使用统计（供返回数据使用）
      const usage = await database.getUsageStats(keyData.id)

      // 获取当日费用统计
      const dailyCost = await database.getDailyCost(keyData.id)

      // 更新最后使用时间（优化：只在实际API调用时更新，而不是验证时）
      // 注意：lastUsedAt的更新已移至recordUsage方法中

      logger.api(`🔓 API key validated successfully: ${keyData.id}`)

      // 解析限制模型数据
      let restrictedModels = []
      try {
        restrictedModels = keyData.restrictedModels ? JSON.parse(keyData.restrictedModels) : []
      } catch (e) {
        restrictedModels = []
      }

      // 解析允许的客户端
      let allowedClients = []
      try {
        allowedClients = keyData.allowedClients ? JSON.parse(keyData.allowedClients) : []
      } catch (e) {
        allowedClients = []
      }

      // 解析标签
      let tags = []
      try {
        tags = keyData.tags ? JSON.parse(keyData.tags) : []
      } catch (e) {
        tags = []
      }

      return {
        valid: true,
        keyData: {
          id: keyData.id,
          name: keyData.name,
          description: keyData.description,
          createdAt: keyData.createdAt,
          expiresAt: keyData.expiresAt,
          claudeAccountId: keyData.claudeAccountId,
          claudeConsoleAccountId: keyData.claudeConsoleAccountId,
          geminiAccountId: keyData.geminiAccountId,
          openaiAccountId: keyData.openaiAccountId,
          azureOpenaiAccountId: keyData.azureOpenaiAccountId,
          bedrockAccountId: keyData.bedrockAccountId, // 添加 Bedrock 账号ID
          permissions: keyData.permissions || 'all',
          tokenLimit: parseInt(keyData.tokenLimit),
          concurrencyLimit: parseInt(keyData.concurrencyLimit || 0),
          rateLimitWindow: parseInt(keyData.rateLimitWindow || 0),
          rateLimitRequests: parseInt(keyData.rateLimitRequests || 0),
          enableModelRestriction: keyData.enableModelRestriction === 'true',
          restrictedModels,
          enableClientRestriction: keyData.enableClientRestriction === 'true',
          allowedClients,
          dailyCostLimit: parseFloat(keyData.dailyCostLimit || 0),
          dailyCost: dailyCost || 0,
          tags,
          usage
        }
      }
    } catch (error) {
      logger.error('❌ API key validation error:', error)
      return { valid: false, error: 'Internal validation error' }
    }
  }

  // 📋 获取所有API Keys
  async getAllApiKeys() {
    try {
      const apiKeys = await database.getAllApiKeys()
      const client = database.getClientSafe()

      // 为每个key添加使用统计和当前并发数
      for (const key of apiKeys) {
        key.usage = await database.getUsageStats(key.id)
        key.tokenLimit = parseInt(key.tokenLimit)
        key.concurrencyLimit = parseInt(key.concurrencyLimit || 0)
        key.rateLimitWindow = parseInt(key.rateLimitWindow || 0)
        key.rateLimitRequests = parseInt(key.rateLimitRequests || 0)
        key.currentConcurrency = await database.getConcurrency(key.id)
        key.isActive = key.isActive === 'true'
        key.enableModelRestriction = key.enableModelRestriction === 'true'
        key.enableClientRestriction = key.enableClientRestriction === 'true'
        key.permissions = key.permissions || 'all' // 兼容旧数据
        key.dailyCostLimit = parseFloat(key.dailyCostLimit || 0)
        key.dailyCost = (await database.getDailyCost(key.id)) || 0

        // 获取当前时间窗口的请求次数和Token使用量
        if (key.rateLimitWindow > 0) {
          const requestCountKey = `rate_limit:requests:${key.id}`
          const tokenCountKey = `rate_limit:tokens:${key.id}`
          const windowStartKey = `rate_limit:window_start:${key.id}`

          // 获取窗口开始时间
          const windowStart = await client.get(windowStartKey)
          const now = Date.now()
          const windowDuration = key.rateLimitWindow * 60 * 1000 // 转换为毫秒

          if (windowStart) {
            const windowStartTime = parseInt(windowStart)
            const windowEndTime = windowStartTime + windowDuration

            // 检查窗口是否已过期
            if (now >= windowEndTime) {
              // 窗口已过期，清理过期数据
              try {
                await client.del(windowStartKey)
                await client.del(requestCountKey)
                await client.del(tokenCountKey)
                logger.debug(`🧹 Cleaned expired rate limit window for API Key: ${key.id}`)
              } catch (cleanupError) {
                logger.error(`❌ Failed to cleanup expired window for ${key.id}:`, cleanupError)
              }

              // 设置为窗口未开始状态
              key.windowStartTime = null
              key.windowEndTime = null
              key.windowRemainingSeconds = null
              key.currentWindowRequests = 0
              key.currentWindowTokens = 0
            } else {
              // 窗口仍然有效，获取实际计数
              const [requestCount, tokenCount] = await Promise.all([
                client.get(requestCountKey),
                client.get(tokenCountKey)
              ])

              key.windowStartTime = windowStartTime
              key.windowEndTime = windowEndTime
              key.windowRemainingSeconds = Math.max(0, Math.floor((windowEndTime - now) / 1000))
              key.currentWindowRequests = parseInt(requestCount || '0')
              key.currentWindowTokens = parseInt(tokenCount || '0')
            }
          } else {
            // 窗口还未开始（没有任何请求）
            key.windowStartTime = null
            key.windowEndTime = null
            key.windowRemainingSeconds = null
            key.currentWindowRequests = 0
            key.currentWindowTokens = 0
          }
        } else {
          key.currentWindowRequests = 0
          key.currentWindowTokens = 0
          key.windowStartTime = null
          key.windowEndTime = null
          key.windowRemainingSeconds = null
        }

        try {
          key.restrictedModels = key.restrictedModels ? JSON.parse(key.restrictedModels) : []
        } catch (e) {
          key.restrictedModels = []
        }
        try {
          key.allowedClients = key.allowedClients ? JSON.parse(key.allowedClients) : []
        } catch (e) {
          key.allowedClients = []
        }
        try {
          key.tags = key.tags ? JSON.parse(key.tags) : []
        } catch (e) {
          key.tags = []
        }
        delete key.apiKey // 不返回哈希后的key
      }

      return apiKeys
    } catch (error) {
      logger.error('❌ Failed to get API keys:', error)
      throw error
    }
  }

  // 📝 更新API Key
  async updateApiKey(keyId, updates) {
    try {
      const keyData = await database.getApiKey(keyId)
      if (!keyData || Object.keys(keyData).length === 0) {
        throw new Error('API key not found')
      }

      // 允许更新的字段
      const allowedUpdates = [
        'name',
        'description',
        'tokenLimit',
        'concurrencyLimit',
        'rateLimitWindow',
        'rateLimitRequests',
        'isActive',
        'claudeAccountId',
        'claudeConsoleAccountId',
        'geminiAccountId',
        'openaiAccountId',
        'azureOpenaiAccountId',
        'bedrockAccountId', // 添加 Bedrock 账号ID
        'permissions',
        'expiresAt',
        'enableModelRestriction',
        'restrictedModels',
        'enableClientRestriction',
        'allowedClients',
        'dailyCostLimit',
        'tags'
      ]
      const updatedData = { ...keyData }

      for (const [field, value] of Object.entries(updates)) {
        if (allowedUpdates.includes(field)) {
          if (field === 'restrictedModels' || field === 'allowedClients' || field === 'tags') {
            // 特殊处理数组字段
            updatedData[field] = JSON.stringify(value || [])
          } else if (field === 'enableModelRestriction' || field === 'enableClientRestriction') {
            // 布尔值转字符串
            updatedData[field] = String(value)
          } else {
            updatedData[field] = (value !== null && value !== undefined ? value : '').toString()
          }
        }
      }

      updatedData.updatedAt = new Date().toISOString()

      // 更新时不需要重新建立哈希映射，因为API Key本身没有变化
      await database.setApiKey(keyId, updatedData)

      logger.success(`📝 Updated API key: ${keyId}`)

      return { success: true }
    } catch (error) {
      logger.error('❌ Failed to update API key:', error)
      throw error
    }
  }

  // 🗑️ 删除API Key
  async deleteApiKey(keyId) {
    try {
      const result = await database.deleteApiKey(keyId)

      if (result === 0) {
        throw new Error('API key not found')
      }

      logger.success(`🗑️ Deleted API key: ${keyId}`)

      return { success: true }
    } catch (error) {
      logger.error('❌ Failed to delete API key:', error)
      throw error
    }
  }

  // 📊 记录使用情况（支持缓存token和账户级别统计）
  async recordUsage(
    keyId,
    inputTokens = 0,
    outputTokens = 0,
    cacheCreateTokens = 0,
    cacheReadTokens = 0,
    model = 'unknown',
    accountId = null
  ) {
    try {
      const totalTokens = inputTokens + outputTokens + cacheCreateTokens + cacheReadTokens

      // 计算费用
      const CostCalculator = require('../utils/costCalculator')
      const costInfo = CostCalculator.calculateCost(
        {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cache_creation_input_tokens: cacheCreateTokens,
          cache_read_input_tokens: cacheReadTokens
        },
        model
      )

      // 记录API Key级别的使用统计
      await database.incrementTokenUsage(
        keyId,
        totalTokens,
        inputTokens,
        outputTokens,
        cacheCreateTokens,
        cacheReadTokens,
        model
      )

      // 记录费用统计
      if (costInfo.costs.total > 0) {
        await database.incrementDailyCost(keyId, costInfo.costs.total)
        logger.database(
          `💰 Recorded cost for ${keyId}: $${costInfo.costs.total.toFixed(6)}, model: ${model}`
        )
      } else {
        logger.debug(`💰 No cost recorded for ${keyId} - zero cost for model: ${model}`)
      }

      // 获取API Key数据以确定关联的账户
      const keyData = await database.getApiKey(keyId)
      if (keyData && Object.keys(keyData).length > 0) {
        // 更新最后使用时间
        keyData.lastUsedAt = new Date().toISOString()
        await database.setApiKey(keyId, keyData)

        // 记录账户级别的使用统计（只统计实际处理请求的账户）
        if (accountId) {
          await database.incrementAccountUsage(
            accountId,
            totalTokens,
            inputTokens,
            outputTokens,
            cacheCreateTokens,
            cacheReadTokens,
            model
          )
          logger.database(
            `📊 Recorded account usage: ${accountId} - ${totalTokens} tokens (API Key: ${keyId})`
          )
        } else {
          logger.debug(
            '⚠️ No accountId provided for usage recording, skipping account-level statistics'
          )
        }
      }

      const logParts = [`Model: ${model}`, `Input: ${inputTokens}`, `Output: ${outputTokens}`]
      if (cacheCreateTokens > 0) {
        logParts.push(`Cache Create: ${cacheCreateTokens}`)
      }
      if (cacheReadTokens > 0) {
        logParts.push(`Cache Read: ${cacheReadTokens}`)
      }
      logParts.push(`Total: ${totalTokens} tokens`)

      logger.database(`📊 Recorded usage: ${keyId} - ${logParts.join(', ')}`)
    } catch (error) {
      logger.error('❌ Failed to record usage:', error)
    }
  }

  // 📊 记录使用情况（新版本，支持详细的缓存类型）
  async recordUsageWithDetails(keyId, usageObject, model = 'unknown', accountId = null) {
    try {
      // 提取 token 数量
      const inputTokens = usageObject.input_tokens || 0
      const outputTokens = usageObject.output_tokens || 0
      const cacheCreateTokens = usageObject.cache_creation_input_tokens || 0
      const cacheReadTokens = usageObject.cache_read_input_tokens || 0

      const totalTokens = inputTokens + outputTokens + cacheCreateTokens + cacheReadTokens

      // 计算费用（支持详细的缓存类型）- 添加错误处理
      let costInfo = { totalCost: 0, ephemeral5mCost: 0, ephemeral1hCost: 0 }
      try {
        const pricingService = require('./pricingService')
        // 确保 pricingService 已初始化
        if (!pricingService.pricingData) {
          logger.warn('⚠️ PricingService not initialized, initializing now...')
          await pricingService.initialize()
        }
        costInfo = pricingService.calculateCost(usageObject, model)
      } catch (pricingError) {
        logger.error('❌ Failed to calculate cost:', pricingError)
        // 继续执行，不要因为费用计算失败而跳过统计记录
      }

      // 提取详细的缓存创建数据
      let ephemeral5mTokens = 0
      let ephemeral1hTokens = 0

      if (usageObject.cache_creation && typeof usageObject.cache_creation === 'object') {
        ephemeral5mTokens = usageObject.cache_creation.ephemeral_5m_input_tokens || 0
        ephemeral1hTokens = usageObject.cache_creation.ephemeral_1h_input_tokens || 0
      }

      // 记录API Key级别的使用统计 - 这个必须执行
      await database.incrementTokenUsage(
        keyId,
        totalTokens,
        inputTokens,
        outputTokens,
        cacheCreateTokens,
        cacheReadTokens,
        model,
        ephemeral5mTokens, // 传递5分钟缓存 tokens
        ephemeral1hTokens // 传递1小时缓存 tokens
      )

      // 记录费用统计
      if (costInfo.totalCost > 0) {
        await database.incrementDailyCost(keyId, costInfo.totalCost)
        logger.database(
          `💰 Recorded cost for ${keyId}: $${costInfo.totalCost.toFixed(6)}, model: ${model}`
        )

        // 记录详细的缓存费用（如果有）
        if (costInfo.ephemeral5mCost > 0 || costInfo.ephemeral1hCost > 0) {
          logger.database(
            `💰 Cache costs - 5m: $${costInfo.ephemeral5mCost.toFixed(6)}, 1h: $${costInfo.ephemeral1hCost.toFixed(6)}`
          )
        }
      } else {
        logger.debug(`💰 No cost recorded for ${keyId} - zero cost for model: ${model}`)
      }

      // 获取API Key数据以确定关联的账户
      const keyData = await database.getApiKey(keyId)
      if (keyData && Object.keys(keyData).length > 0) {
        // 更新最后使用时间
        keyData.lastUsedAt = new Date().toISOString()
        await database.setApiKey(keyId, keyData)

        // 记录账户级别的使用统计（只统计实际处理请求的账户）
        if (accountId) {
          await database.incrementAccountUsage(
            accountId,
            totalTokens,
            inputTokens,
            outputTokens,
            cacheCreateTokens,
            cacheReadTokens,
            model
          )
          logger.database(
            `📊 Recorded account usage: ${accountId} - ${totalTokens} tokens (API Key: ${keyId})`
          )

          // 记录账户级别的费用统计
          if (costInfo.totalCost > 0) {
            await database.incrementAccountCost(accountId, costInfo.totalCost)
            logger.database(
              `💰 Recorded account cost: ${accountId} - $${costInfo.totalCost.toFixed(6)} (API Key: ${keyId}, Model: ${model})`
            )
          }
        } else {
          logger.debug(
            '⚠️ No accountId provided for usage recording, skipping account-level statistics'
          )
        }
      }

      const logParts = [`Model: ${model}`, `Input: ${inputTokens}`, `Output: ${outputTokens}`]
      if (cacheCreateTokens > 0) {
        logParts.push(`Cache Create: ${cacheCreateTokens}`)

        // 如果有详细的缓存创建数据，也记录它们
        if (usageObject.cache_creation) {
          const { ephemeral_5m_input_tokens, ephemeral_1h_input_tokens } =
            usageObject.cache_creation
          if (ephemeral_5m_input_tokens > 0) {
            logParts.push(`5m: ${ephemeral_5m_input_tokens}`)
          }
          if (ephemeral_1h_input_tokens > 0) {
            logParts.push(`1h: ${ephemeral_1h_input_tokens}`)
          }
        }
      }
      if (cacheReadTokens > 0) {
        logParts.push(`Cache Read: ${cacheReadTokens}`)
      }
      logParts.push(`Total: ${totalTokens} tokens`)

      logger.database(`📊 Recorded usage: ${keyId} - ${logParts.join(', ')}`)
    } catch (error) {
      logger.error('❌ Failed to record usage:', error)
    }
  }

  // 🔐 生成密钥
  _generateSecretKey() {
    return crypto.randomBytes(32).toString('hex')
  }

  // 🔒 哈希API Key
  _hashApiKey(apiKey) {
    return crypto
      .createHash('sha256')
      .update(apiKey + config.security.encryptionKey)
      .digest('hex')
  }

  // 📈 获取使用统计
  async getUsageStats(keyId) {
    return await database.getUsageStats(keyId)
  }

  // 📊 获取账户使用统计
  async getAccountUsageStats(accountId) {
    return await database.getAccountUsageStats(accountId)
  }

  // 📈 获取所有账户使用统计
  async getAllAccountsUsageStats() {
    return await database.getAllAccountsUsageStats()
  }

  // 🧹 清理过期的API Keys
  async cleanupExpiredKeys() {
    try {
      const apiKeys = await database.getAllApiKeys()
      const now = new Date()
      let cleanedCount = 0

      for (const key of apiKeys) {
        // 检查是否已过期且仍处于激活状态
        if (key.expiresAt && new Date(key.expiresAt) < now && key.isActive === 'true') {
          // 将过期的 API Key 标记为禁用状态，而不是直接删除
          await this.updateApiKey(key.id, { isActive: false })
          logger.info(`🔒 API Key ${key.id} (${key.name}) has expired and been disabled`)
          cleanedCount++
        }
      }

      if (cleanedCount > 0) {
        logger.success(`🧹 Disabled ${cleanedCount} expired API keys`)
      }

      return cleanedCount
    } catch (error) {
      logger.error('❌ Failed to cleanup expired keys:', error)
      return 0
    }
  }

  // 📤 导出API Keys数据 (安全脱敏版本)
  async exportApiKeys(filters = {}, format = 'csv', userId = null) {
    try {
      // 1. 权限检查 - 确保只有管理员可以导出
      if (!userId) {
        throw new Error('导出操作需要指定用户ID')
      }

      // 记录导出审计日志
      logger.info('📤 API Key导出请求', {
        userId,
        filters,
        format,
        timestamp: new Date().toISOString()
      })

      // 2. 获取所有API Keys数据
      const allApiKeys = await database.getAllApiKeys()
      if (!allApiKeys || allApiKeys.length === 0) {
        logger.warn('📤 没有可导出的API Key数据')
        return []
      }

      // 3. 应用过滤条件
      const filteredKeys = this._applyExportFilters(allApiKeys, filters)

      // 4. 数据脱敏和格式化
      const exportData = await this._prepareExportData(filteredKeys)

      logger.info(`📤 成功准备导出数据: ${exportData.length} 条记录`, {
        totalKeys: allApiKeys.length,
        filteredKeys: filteredKeys.length,
        format
      })

      return exportData
    } catch (error) {
      logger.error('❌ API Key导出失败:', {
        error: error.message,
        userId,
        filters,
        stack: error.stack
      })
      throw error
    }
  }

  // 🎭 API Key脱敏处理
  maskApiKey(apiKey) {
    if (!apiKey || typeof apiKey !== 'string') {
      return '****'
    }

    // 移除前缀（如果存在）
    const cleanKey = apiKey.startsWith(this.prefix) ? apiKey.substring(this.prefix.length) : apiKey

    if (cleanKey.length < 8) {
      return '****'
    }

    // 显示前4位和后4位，中间用*替代
    const front = cleanKey.substring(0, 4)
    const back = cleanKey.substring(cleanKey.length - 4)
    const middle = '*'.repeat(Math.max(cleanKey.length - 8, 4))

    return `${this.prefix}${front}${middle}${back}`
  }

  // 🔍 应用导出过滤条件
  _applyExportFilters(apiKeys, filters) {
    let filtered = [...apiKeys]

    // 时间范围过滤
    if (filters.dateFrom || filters.dateTo) {
      filtered = filtered.filter((key) => {
        const createdAt = new Date(key.createdAt)

        if (filters.dateFrom && createdAt < new Date(filters.dateFrom)) {
          return false
        }

        if (filters.dateTo && createdAt > new Date(filters.dateTo)) {
          return false
        }

        return true
      })
    }

    // 状态过滤
    if (filters.status) {
      filtered = filtered.filter((key) => {
        const isActive = key.isActive === 'true' || key.isActive === true
        switch (filters.status) {
          case 'active':
            return isActive
          case 'disabled':
            return !isActive
          case 'suspended':
            return key.isSuspended === 'true' || key.isSuspended === true
          default:
            return true
        }
      })
    }

    // 使用量过滤
    if (filters.minUsage !== undefined) {
      filtered = filtered.filter((key) => {
        const totalTokens = parseInt(key.totalTokens || '0')
        return totalTokens >= parseInt(filters.minUsage)
      })
    }

    if (filters.maxUsage !== undefined) {
      filtered = filtered.filter((key) => {
        const totalTokens = parseInt(key.totalTokens || '0')
        return totalTokens <= parseInt(filters.maxUsage)
      })
    }

    // 名称搜索过滤
    if (filters.search) {
      const searchTerm = filters.search.toLowerCase()
      filtered = filtered.filter(
        (key) =>
          (key.name && key.name.toLowerCase().includes(searchTerm)) ||
          (key.description && key.description.toLowerCase().includes(searchTerm))
      )
    }

    return filtered
  }

  // 📋 准备导出数据（脱敏和格式化）
  async _prepareExportData(apiKeys) {
    const exportData = []

    for (const key of apiKeys) {
      try {
        // 获取使用统计（如果可用）
        let _usageStats = null
        try {
          _usageStats = await database.getUsageStats(key.id)
        } catch (error) {
          logger.debug(`无法获取API Key ${key.id} 的使用统计:`, error.message)
        }

        // 获取成本统计（如果可用）
        let costStats = null
        try {
          costStats = await database.getCostStats(key.id)
        } catch (error) {
          logger.debug(`无法获取API Key ${key.id} 的成本统计:`, error.message)
        }

        // 构建导出记录
        const exportRecord = {
          ID: key.id || '',
          名称: key.name || '未命名',
          描述: key.description || '',
          'API Key': this.maskApiKey(key.apiKey), // 脱敏处理
          状态: this._getKeyStatus(key),
          权限: key.permissions || 'all',
          创建时间: key.createdAt || '',
          最后使用: key.lastUsedAt || '从未使用',
          过期时间: key.expiresAt || '永不过期',
          Token限制: key.tokenLimit || '0',
          并发限制: key.concurrencyLimit || '0',
          总请求数: key.totalRequests || '0',
          总Token数: key.totalTokens || '0',
          输入Token: key.inputTokens || '0',
          输出Token: key.outputTokens || '0',
          缓存创建Token: key.cacheCreateTokens || '0',
          缓存读取Token: key.cacheReadTokens || '0',
          总费用: costStats?.totalCost
            ? `$${parseFloat(costStats.totalCost).toFixed(6)}`
            : '$0.000000',
          日费用限制: key.dailyCostLimit ? `$${key.dailyCostLimit}` : '无限制',
          标签: Array.isArray(key.tags) ? key.tags.join(', ') : key.tags || '',
          关联Claude账户: key.claudeAccountId || '',
          关联Gemini账户: key.geminiAccountId || '',
          关联OpenAI账户: key.openaiAccountId || '',
          模型限制: key.enableModelRestriction === 'true' ? '是' : '否',
          受限模型: Array.isArray(key.restrictedModels)
            ? key.restrictedModels.join(', ')
            : key.restrictedModels || '',
          客户端限制: key.enableClientRestriction === 'true' ? '是' : '否',
          允许客户端: Array.isArray(key.allowedClients)
            ? key.allowedClients.join(', ')
            : key.allowedClients || ''
        }

        exportData.push(exportRecord)
      } catch (error) {
        logger.error(`处理API Key ${key.id} 导出数据时出错:`, error)
        // 继续处理其他记录，不因单个错误而中断
      }
    }

    return exportData
  }

  // 📊 获取API Key状态文本
  _getKeyStatus(key) {
    const isActive = key.isActive === 'true' || key.isActive === true
    const isSuspended = key.isSuspended === 'true' || key.isSuspended === true
    const isExpired = key.expiresAt && new Date(key.expiresAt) < new Date()

    if (isExpired) {
      return '已过期'
    }
    if (isSuspended) {
      return '已暂停'
    }
    if (!isActive) {
      return '已禁用'
    }
    return '活跃'
  }
}

// 导出实例和单独的方法
const apiKeyService = new ApiKeyService()

// 为了方便其他服务调用，导出 recordUsage 方法
apiKeyService.recordUsageMetrics = apiKeyService.recordUsage.bind(apiKeyService)

module.exports = apiKeyService
