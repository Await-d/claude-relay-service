const express = require('express')
const database = require('../models/database')
const logger = require('../utils/logger')
const apiKeyService = require('../services/apiKeyService')
const CostCalculator = require('../utils/costCalculator')

const router = express.Router()

// 🏠 重定向页面请求到新版 admin-spa
router.get('/', (req, res) => {
  res.redirect(301, '/admin-next/api-stats')
})

// 🔑 获取 API Key 对应的 ID
router.post('/api/get-key-id', async (req, res) => {
  try {
    const { apiKey } = req.body

    if (!apiKey) {
      return res.status(400).json({
        error: 'API Key is required',
        message: 'Please provide your API Key'
      })
    }

    // 基本API Key格式验证
    if (typeof apiKey !== 'string' || apiKey.length < 10 || apiKey.length > 512) {
      return res.status(400).json({
        error: 'Invalid API key format',
        message: 'API key format is invalid'
      })
    }

    // 验证API Key
    const validation = await apiKeyService.validateApiKey(apiKey)

    if (!validation.valid) {
      const clientIP = req.ip || req.connection?.remoteAddress || 'unknown'
      logger.security(`🔒 Invalid API key in get-key-id: ${validation.error} from ${clientIP}`)
      return res.status(401).json({
        error: 'Invalid API key',
        message: validation.error
      })
    }

    const { keyData } = validation

    return res.json({
      success: true,
      data: {
        id: keyData.id
      }
    })
  } catch (error) {
    logger.error('❌ Failed to get API key ID:', error)
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to retrieve API key ID'
    })
  }
})

// 📊 用户API Key统计查询接口 - 安全的自查询接口
router.post('/api/user-stats', async (req, res) => {
  try {
    const { apiKey, apiId } = req.body

    let keyData
    let keyId

    if (apiId) {
      // 通过 apiId 查询
      if (
        typeof apiId !== 'string' ||
        !apiId.match(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i)
      ) {
        return res.status(400).json({
          error: 'Invalid API ID format',
          message: 'API ID must be a valid UUID'
        })
      }

      // 直接通过 ID 获取 API Key 数据
      keyData = await database.getApiKey(apiId)

      if (!keyData || Object.keys(keyData).length === 0) {
        logger.security(`🔒 API key not found for ID: ${apiId} from ${req.ip || 'unknown'}`)
        return res.status(404).json({
          error: 'API key not found',
          message: 'The specified API key does not exist'
        })
      }

      // 检查是否激活
      if (keyData.isActive !== 'true') {
        return res.status(403).json({
          error: 'API key is disabled',
          message: 'This API key has been disabled'
        })
      }

      // 检查是否过期
      if (keyData.expiresAt && new Date() > new Date(keyData.expiresAt)) {
        return res.status(403).json({
          error: 'API key has expired',
          message: 'This API key has expired'
        })
      }

      keyId = apiId

      // 获取使用统计
      const usage = await database.getUsageStats(keyId)

      // 获取当日费用统计
      const dailyCost = await database.getDailyCost(keyId)

      // 处理数据格式，与 validateApiKey 返回的格式保持一致
      // 解析限制模型数据
      let restrictedModels = []
      try {
        restrictedModels = keyData.restrictedModels ? JSON.parse(keyData.restrictedModels) : []
      } catch (e) {
        restrictedModels = []
      }

      // 解析允许的客户端数据
      let allowedClients = []
      try {
        allowedClients = keyData.allowedClients ? JSON.parse(keyData.allowedClients) : []
      } catch (e) {
        allowedClients = []
      }

      // 格式化 keyData
      keyData = {
        ...keyData,
        tokenLimit: parseInt(keyData.tokenLimit) || 0,
        concurrencyLimit: parseInt(keyData.concurrencyLimit) || 0,
        rateLimitWindow: parseInt(keyData.rateLimitWindow) || 0,
        rateLimitRequests: parseInt(keyData.rateLimitRequests) || 0,
        dailyCostLimit: parseFloat(keyData.dailyCostLimit) || 0,
        dailyCost: dailyCost || 0,
        enableModelRestriction: keyData.enableModelRestriction === 'true',
        restrictedModels,
        enableClientRestriction: keyData.enableClientRestriction === 'true',
        allowedClients,
        permissions: keyData.permissions || 'all',
        usage // 使用完整的 usage 数据，而不是只有 total
      }
    } else if (apiKey) {
      // 通过 apiKey 查询（保持向后兼容）
      if (typeof apiKey !== 'string' || apiKey.length < 10 || apiKey.length > 512) {
        logger.security(`🔒 Invalid API key format in user stats query from ${req.ip || 'unknown'}`)
        return res.status(400).json({
          error: 'Invalid API key format',
          message: 'API key format is invalid'
        })
      }

      // 验证API Key（重用现有的验证逻辑）
      const validation = await apiKeyService.validateApiKey(apiKey)

      if (!validation.valid) {
        const clientIP = req.ip || req.connection?.remoteAddress || 'unknown'
        logger.security(
          `🔒 Invalid API key in user stats query: ${validation.error} from ${clientIP}`
        )
        return res.status(401).json({
          error: 'Invalid API key',
          message: validation.error
        })
      }

      const { keyData: validatedKeyData } = validation
      keyData = validatedKeyData
      keyId = keyData.id
    } else {
      logger.security(`🔒 Missing API key or ID in user stats query from ${req.ip || 'unknown'}`)
      return res.status(400).json({
        error: 'API Key or ID is required',
        message: 'Please provide your API Key or API ID'
      })
    }

    // 记录合法查询
    logger.api(
      `📊 User stats query from key: ${keyData.name} (${keyId}) from ${req.ip || 'unknown'}`
    )

    // 获取验证结果中的完整keyData（包含isActive状态和cost信息）
    const fullKeyData = keyData

    // 计算总费用 - 使用与模型统计相同的逻辑（按模型分别计算）
    let totalCost = 0
    let formattedCost = '$0.000000'

    try {
      const client = database.getClientSafe()

      // 获取所有月度模型统计（与model-stats接口相同的逻辑）
      const allModelKeys = await client.keys(`usage:${keyId}:model:monthly:*:*`)
      const modelUsageMap = new Map()

      for (const key of allModelKeys) {
        const modelMatch = key.match(/usage:.+:model:monthly:(.+):(\d{4}-\d{2})$/)
        if (!modelMatch) {
          continue
        }

        const model = modelMatch[1]
        const data = await client.hgetall(key)

        if (data && Object.keys(data).length > 0) {
          if (!modelUsageMap.has(model)) {
            modelUsageMap.set(model, {
              inputTokens: 0,
              outputTokens: 0,
              cacheCreateTokens: 0,
              cacheReadTokens: 0
            })
          }

          const modelUsage = modelUsageMap.get(model)
          modelUsage.inputTokens += parseInt(data.inputTokens) || 0
          modelUsage.outputTokens += parseInt(data.outputTokens) || 0
          modelUsage.cacheCreateTokens += parseInt(data.cacheCreateTokens) || 0
          modelUsage.cacheReadTokens += parseInt(data.cacheReadTokens) || 0
        }
      }

      // 按模型计算费用并汇总
      for (const [model, usage] of modelUsageMap) {
        const usageData = {
          input_tokens: usage.inputTokens,
          output_tokens: usage.outputTokens,
          cache_creation_input_tokens: usage.cacheCreateTokens,
          cache_read_input_tokens: usage.cacheReadTokens
        }

        const costResult = CostCalculator.calculateCost(usageData, model)
        totalCost += costResult.costs.total
      }

      // 如果没有模型级别的详细数据，回退到总体数据计算
      if (modelUsageMap.size === 0 && fullKeyData.usage?.total?.allTokens > 0) {
        const usage = fullKeyData.usage.total
        const costUsage = {
          input_tokens: usage.inputTokens || 0,
          output_tokens: usage.outputTokens || 0,
          cache_creation_input_tokens: usage.cacheCreateTokens || 0,
          cache_read_input_tokens: usage.cacheReadTokens || 0
        }

        const costResult = CostCalculator.calculateCost(costUsage, 'claude-3-5-sonnet-20241022')
        totalCost = costResult.costs.total
      }

      formattedCost = CostCalculator.formatCost(totalCost)
    } catch (error) {
      logger.warn(`Failed to calculate detailed cost for key ${keyId}:`, error)
      // 回退到简单计算
      if (fullKeyData.usage?.total?.allTokens > 0) {
        const usage = fullKeyData.usage.total
        const costUsage = {
          input_tokens: usage.inputTokens || 0,
          output_tokens: usage.outputTokens || 0,
          cache_creation_input_tokens: usage.cacheCreateTokens || 0,
          cache_read_input_tokens: usage.cacheReadTokens || 0
        }

        const costResult = CostCalculator.calculateCost(costUsage, 'claude-3-5-sonnet-20241022')
        totalCost = costResult.costs.total
        formattedCost = costResult.formatted.total
      }
    }

    // 获取当前使用量
    let currentWindowRequests = 0
    let currentWindowTokens = 0
    let currentDailyCost = 0
    let windowStartTime = null
    let windowEndTime = null
    let windowRemainingSeconds = null

    try {
      // 获取当前时间窗口的请求次数和Token使用量
      if (fullKeyData.rateLimitWindow > 0) {
        const client = database.getClientSafe()
        const requestCountKey = `rate_limit:requests:${keyId}`
        const tokenCountKey = `rate_limit:tokens:${keyId}`
        const windowStartKey = `rate_limit:window_start:${keyId}`

        // 获取窗口开始时间
        const windowStart = await client.get(windowStartKey)
        const now = Date.now()
        const windowDuration = fullKeyData.rateLimitWindow * 60 * 1000 // 转换为毫秒

        if (windowStart) {
          windowStartTime = parseInt(windowStart)
          windowEndTime = windowStartTime + windowDuration

          // 检查窗口是否已过期
          if (now >= windowEndTime) {
            // 窗口已过期，清理过期数据
            try {
              await client.del(windowStartKey)
              await client.del(requestCountKey)
              await client.del(tokenCountKey)
              logger.debug(`🧹 Cleaned expired rate limit window for API Key: ${keyId}`)
            } catch (cleanupError) {
              logger.error(`❌ Failed to cleanup expired window for ${keyId}:`, cleanupError)
            }

            // 设置为窗口未开始状态
            windowStartTime = null
            windowEndTime = null
            windowRemainingSeconds = null
            currentWindowRequests = 0
            currentWindowTokens = 0
          } else {
            // 窗口仍然有效，获取实际计数
            const [requestCount, tokenCount] = await Promise.all([
              client.get(requestCountKey),
              client.get(tokenCountKey)
            ])

            windowRemainingSeconds = Math.max(0, Math.floor((windowEndTime - now) / 1000))
            currentWindowRequests = parseInt(requestCount || '0')
            currentWindowTokens = parseInt(tokenCount || '0')
          }
        } else {
          // 窗口还未开始（没有任何请求）
          currentWindowRequests = 0
          currentWindowTokens = 0
        }
      }

      // 获取当日费用
      currentDailyCost = (await database.getDailyCost(keyId)) || 0
    } catch (error) {
      logger.warn(`Failed to get current usage for key ${keyId}:`, error)
    }

    // 构建响应数据（只返回该API Key自己的信息，确保不泄露其他信息）
    const responseData = {
      id: keyId,
      name: fullKeyData.name,
      description: keyData.description || '',
      isActive: true, // 如果能通过validateApiKey验证，说明一定是激活的
      createdAt: keyData.createdAt,
      expiresAt: keyData.expiresAt,
      permissions: fullKeyData.permissions,

      // 使用统计（使用验证结果中的完整数据）
      usage: {
        total: {
          ...(fullKeyData.usage?.total || {
            requests: 0,
            tokens: 0,
            allTokens: 0,
            inputTokens: 0,
            outputTokens: 0,
            cacheCreateTokens: 0,
            cacheReadTokens: 0
          }),
          cost: totalCost,
          formattedCost
        }
      },

      // 限制信息（显示配置和当前使用量）
      limits: {
        tokenLimit: fullKeyData.tokenLimit || 0,
        concurrencyLimit: fullKeyData.concurrencyLimit || 0,
        rateLimitWindow: fullKeyData.rateLimitWindow || 0,
        rateLimitRequests: fullKeyData.rateLimitRequests || 0,
        dailyCostLimit: fullKeyData.dailyCostLimit || 0,
        // 当前使用量
        currentWindowRequests,
        currentWindowTokens,
        currentDailyCost,
        // 时间窗口信息
        windowStartTime,
        windowEndTime,
        windowRemainingSeconds
      },

      // 绑定的账户信息（只显示ID，不显示敏感信息）
      accounts: {
        claudeAccountId:
          fullKeyData.claudeAccountId && fullKeyData.claudeAccountId !== ''
            ? fullKeyData.claudeAccountId
            : null,
        geminiAccountId:
          fullKeyData.geminiAccountId && fullKeyData.geminiAccountId !== ''
            ? fullKeyData.geminiAccountId
            : null
      },

      // 模型和客户端限制信息
      restrictions: {
        enableModelRestriction: fullKeyData.enableModelRestriction || false,
        restrictedModels: fullKeyData.restrictedModels || [],
        enableClientRestriction: fullKeyData.enableClientRestriction || false,
        allowedClients: fullKeyData.allowedClients || []
      }
    }

    return res.json({
      success: true,
      data: responseData
    })
  } catch (error) {
    logger.error('❌ Failed to process user stats query:', error)
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to retrieve API key statistics'
    })
  }
})

// 📊 用户模型统计查询接口 - 安全的自查询接口
router.post('/api/user-model-stats', async (req, res) => {
  try {
    const { apiKey, apiId, period = 'monthly', date, hours = 24 } = req.body
    
    // 参数验证
    if (period && !['daily', 'monthly', 'hourly'].includes(period)) {
      return res.status(400).json({
        error: 'Invalid period parameter',
        message: 'Period must be one of: daily, monthly, hourly'
      })
    }
    
    // 小时统计的额外参数验证
    if (period === 'hourly') {
      if (!date) {
        return res.status(400).json({
          error: 'Missing date parameter',
          message: 'Date parameter is required for hourly period (format: YYYY-MM-DD)'
        })
      }
      
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({
          error: 'Invalid date format',
          message: 'Date must be in YYYY-MM-DD format'
        })
      }
      
      if (typeof hours !== 'number' || hours < 1 || hours > 168) {
        return res.status(400).json({
          error: 'Invalid hours parameter',
          message: 'Hours parameter must be between 1 and 168'
        })
      }
    }

    let keyData
    let keyId

    if (apiId) {
      // 通过 apiId 查询
      if (
        typeof apiId !== 'string' ||
        !apiId.match(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i)
      ) {
        return res.status(400).json({
          error: 'Invalid API ID format',
          message: 'API ID must be a valid UUID'
        })
      }

      // 直接通过 ID 获取 API Key 数据
      keyData = await database.getApiKey(apiId)

      if (!keyData || Object.keys(keyData).length === 0) {
        logger.security(`🔒 API key not found for ID: ${apiId} from ${req.ip || 'unknown'}`)
        return res.status(404).json({
          error: 'API key not found',
          message: 'The specified API key does not exist'
        })
      }

      // 检查是否激活
      if (keyData.isActive !== 'true') {
        return res.status(403).json({
          error: 'API key is disabled',
          message: 'This API key has been disabled'
        })
      }

      keyId = apiId

      // 获取使用统计
      const usage = await database.getUsageStats(keyId)
      keyData.usage = { total: usage.total }
    } else if (apiKey) {
      // 通过 apiKey 查询（保持向后兼容）
      // 验证API Key
      const validation = await apiKeyService.validateApiKey(apiKey)

      if (!validation.valid) {
        const clientIP = req.ip || req.connection?.remoteAddress || 'unknown'
        logger.security(
          `🔒 Invalid API key in user model stats query: ${validation.error} from ${clientIP}`
        )
        return res.status(401).json({
          error: 'Invalid API key',
          message: validation.error
        })
      }

      const { keyData: validatedKeyData } = validation
      keyData = validatedKeyData
      keyId = keyData.id
    } else {
      logger.security(
        `🔒 Missing API key or ID in user model stats query from ${req.ip || 'unknown'}`
      )
      return res.status(400).json({
        error: 'API Key or ID is required',
        message: 'Please provide your API Key or API ID'
      })
    }

    logger.api(
      `📊 User model stats query from key: ${keyData.name} (${keyId}) for period: ${period}${period === 'hourly' ? `, date: ${date}, hours: ${hours}` : ''}`
    )

    let modelStats = []
    
    if (period === 'hourly') {
      // 使用新的小时统计方法
      try {
        const startDate = new Date(`${date}T00:00:00.000Z`)
        if (isNaN(startDate.getTime())) {
          return res.status(400).json({
            error: 'Invalid date format',
            message: 'Unable to parse the provided date'
          })
        }
        
        const hourlyStats = await database.getModelUsageHourly(keyId, startDate, hours)
        
        // 聚合所有小时的模型数据
        const modelAggregation = new Map()
        let totalHourlyTokens = 0
        let totalHourlyRequests = 0
        let totalHourlyCost = 0
        let peakHour = null
        let peakHourTokens = 0
        
        for (const hourStat of hourlyStats) {
          // 计算峰值小时
          if (hourStat.totalTokens > peakHourTokens) {
            peakHourTokens = hourStat.totalTokens
            peakHour = hourStat.hour
          }
          
          totalHourlyTokens += hourStat.totalTokens
          totalHourlyRequests += hourStat.totalRequests
          totalHourlyCost += hourStat.totalCost
          
          // 聚合各模型数据
          for (const [modelName, modelData] of Object.entries(hourStat.models)) {
            if (!modelAggregation.has(modelName)) {
              modelAggregation.set(modelName, {
                model: modelName,
                requests: 0,
                inputTokens: 0,
                outputTokens: 0,
                cacheCreateTokens: 0,
                cacheReadTokens: 0,
                allTokens: 0,
                totalCost: 0
              })
            }
            
            const aggregated = modelAggregation.get(modelName)
            aggregated.requests += modelData.requests
            aggregated.inputTokens += modelData.inputTokens
            aggregated.outputTokens += modelData.outputTokens
            aggregated.cacheCreateTokens += modelData.cacheCreateTokens
            aggregated.cacheReadTokens += modelData.cacheReadTokens
            aggregated.allTokens += modelData.tokens
            aggregated.totalCost += modelData.cost
          }
        }
        
        // 转换为标准格式
        for (const [modelName, aggregated] of modelAggregation) {
          const usage = {
            input_tokens: aggregated.inputTokens,
            output_tokens: aggregated.outputTokens,
            cache_creation_input_tokens: aggregated.cacheCreateTokens,
            cache_read_input_tokens: aggregated.cacheReadTokens
          }
          
          const costData = CostCalculator.calculateCost(usage, modelName)
          
          modelStats.push({
            model: modelName,
            requests: aggregated.requests,
            inputTokens: aggregated.inputTokens,
            outputTokens: aggregated.outputTokens,
            cacheCreateTokens: aggregated.cacheCreateTokens,
            cacheReadTokens: aggregated.cacheReadTokens,
            allTokens: aggregated.allTokens,
            costs: costData.costs,
            formatted: costData.formatted,
            pricing: costData.pricing,
            // 小时统计特有字段
            hourlyDetails: {
              totalCost: aggregated.totalCost,
              peakHour: peakHour,
              hoursWithActivity: hourlyStats.filter(h => h.totalTokens > 0).length
            }
          })
        }
        
        // 为响应添加汇总信息
        const hourlySummary = {
          totalTokens: totalHourlyTokens,
          totalRequests: totalHourlyRequests,
          totalCost: totalHourlyCost,
          activeModels: modelAggregation.size,
          peakHour: peakHour,
          hourlyData: hourlyStats // 包含完整的小时数据
        }
        
        // 按总token数降序排列
        modelStats.sort((a, b) => b.allTokens - a.allTokens)
        
        return res.json({
          success: true,
          data: modelStats,
          period: period,
          range: period,
          summary: hourlySummary
        })
        
      } catch (error) {
        logger.error(`❌ Failed to get hourly model stats for ${keyId}:`, error)
        return res.status(500).json({
          error: 'Internal server error',
          message: 'Failed to retrieve hourly model statistics'
        })
      }
    } else {
      // 原有的daily和monthly逻辑
      const client = database.getClientSafe()
      // 使用与管理页面相同的时区处理逻辑
      const tzDate = database.getDateInTimezone()
      const today = database.getDateStringInTimezone()
      const currentMonth = `${tzDate.getFullYear()}-${String(tzDate.getMonth() + 1).padStart(2, '0')}`

      const pattern =
        period === 'daily'
          ? `usage:${keyId}:model:daily:*:${today}`
          : `usage:${keyId}:model:monthly:*:${currentMonth}`

      const keys = await client.keys(pattern)

      for (const key of keys) {
        const match = key.match(
          period === 'daily'
            ? /usage:.+:model:daily:(.+):\d{4}-\d{2}-\d{2}$/
            : /usage:.+:model:monthly:(.+):\d{4}-\d{2}$/
        )

        if (!match) {
          continue
        }

        const model = match[1]
        const data = await client.hgetall(key)

        if (data && Object.keys(data).length > 0) {
          const usage = {
            input_tokens: parseInt(data.inputTokens) || 0,
            output_tokens: parseInt(data.outputTokens) || 0,
            cache_creation_input_tokens: parseInt(data.cacheCreateTokens) || 0,
            cache_read_input_tokens: parseInt(data.cacheReadTokens) || 0
          }

          const costData = CostCalculator.calculateCost(usage, model)

          modelStats.push({
            model,
            requests: parseInt(data.requests) || 0,
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            cacheCreateTokens: usage.cache_creation_input_tokens,
            cacheReadTokens: usage.cache_read_input_tokens,
            allTokens: parseInt(data.allTokens) || 0,
            costs: costData.costs,
            formatted: costData.formatted,
            pricing: costData.pricing
          })
        }
      }
    }

    // 如果没有详细的模型数据，不显示历史数据以避免混淆
    // 只有在查询特定时间段时返回空数组，表示该时间段确实没有数据
    if (modelStats.length === 0) {
      logger.info(`📊 No model stats found for key ${keyId} in period ${period}`)
    }

    // 按总token数降序排列
    modelStats.sort((a, b) => b.allTokens - a.allTokens)

    return res.json({
      success: true,
      data: modelStats,
      period
    })
  } catch (error) {
    logger.error('❌ Failed to process user model stats query:', error)
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to retrieve model statistics'
    })
  }
})

// 📊 专用小时统计API接口 - 获取指定时间段的小时级模型使用统计
router.post('/api/user-model-stats/hourly', async (req, res) => {
  try {
    const { apiKey, apiId, date, hours = 24 } = req.body

    // 参数验证
    if (!date) {
      return res.status(400).json({
        error: 'Missing date parameter',
        message: 'Date parameter is required (format: YYYY-MM-DD)'
      })
    }
    
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        error: 'Invalid date format',
        message: 'Date must be in YYYY-MM-DD format'
      })
    }
    
    if (typeof hours !== 'number' || hours < 1 || hours > 168) {
      return res.status(400).json({
        error: 'Invalid hours parameter',
        message: 'Hours parameter must be between 1 and 168'
      })
    }

    let keyData
    let keyId

    // API Key验证逻辑（复用现有逻辑）
    if (apiId) {
      // 通过 apiId 查询
      if (
        typeof apiId !== 'string' ||
        !apiId.match(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i)
      ) {
        return res.status(400).json({
          error: 'Invalid API ID format',
          message: 'API ID must be a valid UUID'
        })
      }

      keyData = await database.getApiKey(apiId)

      if (!keyData || Object.keys(keyData).length === 0) {
        logger.security(`🔒 API key not found for ID: ${apiId} from ${req.ip || 'unknown'}`)
        return res.status(404).json({
          error: 'API key not found',
          message: 'The specified API key does not exist'
        })
      }

      if (keyData.isActive !== 'true') {
        return res.status(403).json({
          error: 'API key is disabled',
          message: 'This API key has been disabled'
        })
      }

      keyId = apiId
      keyData.name = keyData.name || 'Unknown'
    } else if (apiKey) {
      // 通过 apiKey 查询
      const validation = await apiKeyService.validateApiKey(apiKey)

      if (!validation.valid) {
        const clientIP = req.ip || req.connection?.remoteAddress || 'unknown'
        logger.security(
          `🔒 Invalid API key in hourly stats query: ${validation.error} from ${clientIP}`
        )
        return res.status(401).json({
          error: 'Invalid API key',
          message: validation.error
        })
      }

      const { keyData: validatedKeyData } = validation
      keyData = validatedKeyData
      keyId = keyData.id
    } else {
      logger.security(
        `🔒 Missing API key or ID in hourly stats query from ${req.ip || 'unknown'}`
      )
      return res.status(400).json({
        error: 'API Key or ID is required',
        message: 'Please provide your API Key or API ID'
      })
    }

    logger.api(
      `📊 Hourly model stats query from key: ${keyData.name} (${keyId}), date: ${date}, hours: ${hours}`
    )

    // 解析日期
    const startDate = new Date(`${date}T00:00:00.000Z`)
    if (isNaN(startDate.getTime())) {
      return res.status(400).json({
        error: 'Invalid date format',
        message: 'Unable to parse the provided date'
      })
    }

    // 获取小时级统计数据
    const hourlyStats = await database.getModelUsageHourly(keyId, startDate, hours)

    // 计算汇总信息
    let totalTokens = 0
    let totalRequests = 0
    let totalCost = 0
    const activeModels = new Set()
    let peakHour = null
    let peakHourTokens = 0

    for (const hourStat of hourlyStats) {
      totalTokens += hourStat.totalTokens
      totalRequests += hourStat.totalRequests
      totalCost += hourStat.totalCost

      // 计算峰值小时
      if (hourStat.totalTokens > peakHourTokens) {
        peakHourTokens = hourStat.totalTokens
        peakHour = hourStat.hour
      }

      // 统计活跃模型
      for (const modelName of Object.keys(hourStat.models)) {
        activeModels.add(modelName)
      }
    }

    const summary = {
      totalTokens,
      totalRequests,
      totalCost: Math.round(totalCost * 1000000) / 1000000, // 保留6位小数
      activeModels: Array.from(activeModels),
      peakHour,
      hoursQueried: hours,
      hoursWithActivity: hourlyStats.filter(h => h.totalTokens > 0).length
    }

    const response = {
      success: true,
      data: {
        range: 'hourly',
        period: { 
          start: startDate.toISOString(), 
          hours: hours,
          end: new Date(startDate.getTime() + hours * 60 * 60 * 1000).toISOString()
        },
        hourlyStats: hourlyStats,
        summary: summary
      }
    }

    return res.json(response)

  } catch (error) {
    logger.error('❌ Failed to process hourly model stats query:', error)
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to retrieve hourly model statistics'
    })
  }
})

module.exports = router
