const express = require('express')
const apiKeyService = require('../services/apiKeyService')
const claudeAccountService = require('../services/claudeAccountService')
const claudeConsoleAccountService = require('../services/claudeConsoleAccountService')
const bedrockAccountService = require('../services/bedrockAccountService')
const geminiAccountService = require('../services/geminiAccountService')
const openaiAccountService = require('../services/openaiAccountService')
const azureOpenaiAccountService = require('../services/azureOpenaiAccountService')
const accountGroupService = require('../services/accountGroupService')
const groupService = require('../services/groupService')
const userService = require('../services/userService')
const database = require('../models/database')
const { authenticateAdmin } = require('../middleware/auth')
const logger = require('../utils/logger')
const oauthHelper = require('../utils/oauthHelper')
const CostCalculator = require('../utils/costCalculator')
const pricingService = require('../services/pricingService')
const claudeCodeHeadersService = require('../services/claudeCodeHeadersService')
const webhookNotifier = require('../utils/webhookNotifier')
const schedulingValidator = require('../utils/schedulingValidator')
const axios = require('axios')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const config = require('../../config/config')
const ProxyHelper = require('../utils/proxyHelper')

const router = express.Router()

// 🔑 API Keys 管理

// 调试：获取API Key费用详情
router.get('/api-keys/:keyId/cost-debug', authenticateAdmin, async (req, res) => {
  try {
    const { keyId } = req.params
    const costStats = await database.getCostStats(keyId)
    const dailyCost = await database.getDailyCost(keyId)
    const today = database.getDateStringInTimezone()
    const client = database.getClient()

    // 获取所有相关的数据库键
    const costKeys = await client.keys(`usage:cost:*:${keyId}:*`)
    const keyValues = {}

    for (const key of costKeys) {
      keyValues[key] = await client.get(key)
    }

    return res.json({
      keyId,
      today,
      dailyCost,
      costStats,
      redisKeys: keyValues,
      timezone: config.system.timezoneOffset || 8
    })
  } catch (error) {
    logger.error('❌ Failed to get cost debug info:', error)
    return res.status(500).json({ error: 'Failed to get cost debug info', message: error.message })
  }
})

// 获取所有API Keys
router.get('/api-keys', authenticateAdmin, async (req, res) => {
  try {
    const { timeRange = 'all' } = req.query // all, 7days, monthly
    const apiKeys = await apiKeyService.getAllApiKeys()

    // 根据时间范围计算查询模式
    const now = new Date()
    const searchPatterns = []

    if (timeRange === 'today') {
      // 今日 - 使用时区日期
      const databaseClient = require('../models/database')
      const tzDate = databaseClient.getDateInTimezone(now)
      const dateStr = `${tzDate.getUTCFullYear()}-${String(tzDate.getUTCMonth() + 1).padStart(2, '0')}-${String(tzDate.getUTCDate()).padStart(2, '0')}`
      searchPatterns.push(`usage:daily:*:${dateStr}`)
    } else if (timeRange === '7days') {
      // 最近7天
      const databaseClient = require('../models/database')
      for (let i = 0; i < 7; i++) {
        const date = new Date(now)
        date.setDate(date.getDate() - i)
        const tzDate = databaseClient.getDateInTimezone(date)
        const dateStr = `${tzDate.getUTCFullYear()}-${String(tzDate.getUTCMonth() + 1).padStart(2, '0')}-${String(tzDate.getUTCDate()).padStart(2, '0')}`
        searchPatterns.push(`usage:daily:*:${dateStr}`)
      }
    } else if (timeRange === 'monthly') {
      // 本月
      const databaseClient = require('../models/database')
      const tzDate = databaseClient.getDateInTimezone(now)
      const currentMonth = `${tzDate.getUTCFullYear()}-${String(tzDate.getUTCMonth() + 1).padStart(2, '0')}`
      searchPatterns.push(`usage:monthly:*:${currentMonth}`)
    }

    // 为每个API Key计算准确的费用和统计数据
    for (const apiKey of apiKeys) {
      const client = database.getClient()

      if (timeRange === 'all') {
        // 全部时间：保持原有逻辑
        if (apiKey.usage && apiKey.usage.total) {
          // 使用与展开模型统计相同的数据源
          // 获取所有时间的模型统计数据
          const monthlyKeys = await client.keys(`usage:${apiKey.id}:model:monthly:*:*`)
          const modelStatsMap = new Map()

          // 汇总所有月份的数据
          for (const key of monthlyKeys) {
            const match = key.match(/usage:.+:model:monthly:(.+):\d{4}-\d{2}$/)
            if (!match) {
              continue
            }

            const model = match[1]
            const data = await client.hgetall(key)

            if (data && Object.keys(data).length > 0) {
              if (!modelStatsMap.has(model)) {
                modelStatsMap.set(model, {
                  inputTokens: 0,
                  outputTokens: 0,
                  cacheCreateTokens: 0,
                  cacheReadTokens: 0
                })
              }

              const stats = modelStatsMap.get(model)
              stats.inputTokens +=
                parseInt(data.totalInputTokens) || parseInt(data.inputTokens) || 0
              stats.outputTokens +=
                parseInt(data.totalOutputTokens) || parseInt(data.outputTokens) || 0
              stats.cacheCreateTokens +=
                parseInt(data.totalCacheCreateTokens) || parseInt(data.cacheCreateTokens) || 0
              stats.cacheReadTokens +=
                parseInt(data.totalCacheReadTokens) || parseInt(data.cacheReadTokens) || 0
            }
          }

          let totalCost = 0

          // 计算每个模型的费用
          for (const [model, stats] of modelStatsMap) {
            const usage = {
              input_tokens: stats.inputTokens,
              output_tokens: stats.outputTokens,
              cache_creation_input_tokens: stats.cacheCreateTokens,
              cache_read_input_tokens: stats.cacheReadTokens
            }

            const costResult = CostCalculator.calculateCost(usage, model)
            totalCost += costResult.costs.total
          }

          // 如果没有详细的模型数据，使用总量数据和默认模型计算
          if (modelStatsMap.size === 0) {
            const usage = {
              input_tokens: apiKey.usage.total.inputTokens || 0,
              output_tokens: apiKey.usage.total.outputTokens || 0,
              cache_creation_input_tokens: apiKey.usage.total.cacheCreateTokens || 0,
              cache_read_input_tokens: apiKey.usage.total.cacheReadTokens || 0
            }

            const costResult = CostCalculator.calculateCost(usage, 'claude-3-5-haiku-20241022')
            totalCost = costResult.costs.total
          }

          // 添加格式化的费用到响应数据
          apiKey.usage.total.cost = totalCost
          apiKey.usage.total.formattedCost = CostCalculator.formatCost(totalCost)
        }
      } else {
        // 7天或本月：重新计算统计数据
        const tempUsage = {
          requests: 0,
          tokens: 0,
          allTokens: 0, // 添加allTokens字段
          inputTokens: 0,
          outputTokens: 0,
          cacheCreateTokens: 0,
          cacheReadTokens: 0
        }

        // 获取指定时间范围的统计数据
        for (const pattern of searchPatterns) {
          const keys = await client.keys(pattern.replace('*', apiKey.id))

          for (const key of keys) {
            const data = await client.hgetall(key)
            if (data && Object.keys(data).length > 0) {
              // 使用与 database.js incrementTokenUsage 中相同的字段名
              tempUsage.requests += parseInt(data.totalRequests) || parseInt(data.requests) || 0
              tempUsage.tokens += parseInt(data.totalTokens) || parseInt(data.tokens) || 0
              tempUsage.allTokens += parseInt(data.totalAllTokens) || parseInt(data.allTokens) || 0 // 读取包含所有Token的字段
              tempUsage.inputTokens +=
                parseInt(data.totalInputTokens) || parseInt(data.inputTokens) || 0
              tempUsage.outputTokens +=
                parseInt(data.totalOutputTokens) || parseInt(data.outputTokens) || 0
              tempUsage.cacheCreateTokens +=
                parseInt(data.totalCacheCreateTokens) || parseInt(data.cacheCreateTokens) || 0
              tempUsage.cacheReadTokens +=
                parseInt(data.totalCacheReadTokens) || parseInt(data.cacheReadTokens) || 0
            }
          }
        }

        // 计算指定时间范围的费用
        let totalCost = 0
        const databaseClient = require('../models/database')
        const tzToday = databaseClient.getDateStringInTimezone(now)
        const tzDate = databaseClient.getDateInTimezone(now)
        const tzMonth = `${tzDate.getUTCFullYear()}-${String(tzDate.getUTCMonth() + 1).padStart(2, '0')}`

        const modelKeys =
          timeRange === 'today'
            ? await client.keys(`usage:${apiKey.id}:model:daily:*:${tzToday}`)
            : timeRange === '7days'
              ? await client.keys(`usage:${apiKey.id}:model:daily:*:*`)
              : await client.keys(`usage:${apiKey.id}:model:monthly:*:${tzMonth}`)

        const modelStatsMap = new Map()

        // 过滤和汇总相应时间范围的模型数据
        for (const key of modelKeys) {
          if (timeRange === '7days') {
            // 检查是否在最近7天内
            const dateMatch = key.match(/\d{4}-\d{2}-\d{2}$/)
            if (dateMatch) {
              const keyDate = new Date(dateMatch[0])
              const daysDiff = Math.floor((now - keyDate) / (1000 * 60 * 60 * 24))
              if (daysDiff > 6) {
                continue
              }
            }
          } else if (timeRange === 'today') {
            // today选项已经在查询时过滤了，不需要额外处理
          }

          const modelMatch = key.match(
            /usage:.+:model:(?:daily|monthly):(.+):\d{4}-\d{2}(?:-\d{2})?$/
          )
          if (!modelMatch) {
            continue
          }

          const model = modelMatch[1]
          const data = await client.hgetall(key)

          if (data && Object.keys(data).length > 0) {
            if (!modelStatsMap.has(model)) {
              modelStatsMap.set(model, {
                inputTokens: 0,
                outputTokens: 0,
                cacheCreateTokens: 0,
                cacheReadTokens: 0
              })
            }

            const stats = modelStatsMap.get(model)
            stats.inputTokens += parseInt(data.totalInputTokens) || parseInt(data.inputTokens) || 0
            stats.outputTokens +=
              parseInt(data.totalOutputTokens) || parseInt(data.outputTokens) || 0
            stats.cacheCreateTokens +=
              parseInt(data.totalCacheCreateTokens) || parseInt(data.cacheCreateTokens) || 0
            stats.cacheReadTokens +=
              parseInt(data.totalCacheReadTokens) || parseInt(data.cacheReadTokens) || 0
          }
        }

        // 计算费用
        for (const [model, stats] of modelStatsMap) {
          const usage = {
            input_tokens: stats.inputTokens,
            output_tokens: stats.outputTokens,
            cache_creation_input_tokens: stats.cacheCreateTokens,
            cache_read_input_tokens: stats.cacheReadTokens
          }

          const costResult = CostCalculator.calculateCost(usage, model)
          totalCost += costResult.costs.total
        }

        // 如果没有模型数据，使用临时统计数据计算
        if (modelStatsMap.size === 0 && tempUsage.tokens > 0) {
          const usage = {
            input_tokens: tempUsage.inputTokens,
            output_tokens: tempUsage.outputTokens,
            cache_creation_input_tokens: tempUsage.cacheCreateTokens,
            cache_read_input_tokens: tempUsage.cacheReadTokens
          }

          const costResult = CostCalculator.calculateCost(usage, 'claude-3-5-haiku-20241022')
          totalCost = costResult.costs.total
        }

        // 使用从Redis读取的allTokens，如果没有则计算
        const allTokens =
          tempUsage.allTokens ||
          tempUsage.inputTokens +
            tempUsage.outputTokens +
            tempUsage.cacheCreateTokens +
            tempUsage.cacheReadTokens

        // 更新API Key的usage数据为指定时间范围的数据
        apiKey.usage[timeRange] = {
          ...tempUsage,
          tokens: allTokens, // 使用包含所有Token的总数
          allTokens,
          cost: totalCost,
          formattedCost: CostCalculator.formatCost(totalCost)
        }

        // 为了保持兼容性，也更新total字段
        apiKey.usage.total = apiKey.usage[timeRange]
      }
    }

    return res.json({ success: true, data: apiKeys })
  } catch (error) {
    logger.error('❌ Failed to get API keys:', error)
    return res.status(500).json({ error: 'Failed to get API keys', message: error.message })
  }
})

// 获取支持的客户端列表
router.get('/supported-clients', authenticateAdmin, async (req, res) => {
  try {
    // 检查配置是否存在，如果不存在则使用默认值
    const predefinedClients = config.clientRestrictions?.predefinedClients || [
      {
        id: 'claude_code',
        name: 'ClaudeCode',
        description: 'Official Claude Code CLI'
      },
      {
        id: 'gemini_cli',
        name: 'Gemini-CLI',
        description: 'Gemini Command Line Interface'
      }
    ]

    const clients = predefinedClients.map((client) => ({
      id: client.id,
      name: client.name,
      description: client.description
    }))

    return res.json({ success: true, data: clients })
  } catch (error) {
    logger.error('❌ Failed to get supported clients:', error)
    return res
      .status(500)
      .json({ error: 'Failed to get supported clients', message: error.message })
  }
})

// 📤 导出API Keys数据
router.post('/api-keys/export', authenticateAdmin, async (req, res) => {
  try {
    const { format = 'csv', dateFrom, dateTo, status, minUsage, maxUsage, search } = req.body

    // 验证导出格式
    if (!['csv', 'xlsx'].includes(format.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: '不支持的导出格式，仅支持 csv 和 xlsx'
      })
    }

    // 构建过滤条件
    const filters = {}
    if (dateFrom) {
      filters.dateFrom = dateFrom
    }
    if (dateTo) {
      filters.dateTo = dateTo
    }
    if (status) {
      filters.status = status
    }
    if (minUsage !== undefined) {
      filters.minUsage = minUsage
    }
    if (maxUsage !== undefined) {
      filters.maxUsage = maxUsage
    }
    if (search) {
      filters.search = search
    }

    // 记录导出请求日志
    logger.info('📤 API Keys导出请求:', {
      user: req.user.username,
      userId: req.user.id,
      filters,
      format,
      timestamp: new Date().toISOString()
    })

    // 使用API Key服务获取导出数据
    const exportData = await apiKeyService.exportApiKeys(filters, format, req.user.id)

    if (!exportData || exportData.length === 0) {
      return res.status(404).json({
        success: false,
        message: '没有找到符合条件的API Key数据'
      })
    }

    // 使用数据导出工具生成文件
    const dataExporter = require('../utils/dataExporter')
    const result = await dataExporter.export(exportData, format)

    // 设置下载响应头
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`)
    res.setHeader('Content-Type', result.mimeType)
    res.setHeader('Content-Length', result.size)

    // 记录成功日志
    logger.info('📤 API Keys导出成功:', {
      user: req.user.username,
      filename: result.filename,
      size: result.size,
      records: exportData.length,
      format
    })

    // 发送文件
    res.sendFile(path.resolve(result.filePath), (error) => {
      if (error) {
        logger.error('❌ 文件发送失败:', {
          filename: result.filename,
          error: error.message
        })
      }
    })
  } catch (error) {
    logger.error('❌ API Keys导出失败:', {
      error: error.message,
      user: req.user?.username,
      stack: error.stack
    })

    res.status(500).json({
      success: false,
      message: '导出失败',
      error: error.message
    })
  }
})

// 获取已存在的标签列表
router.get('/api-keys/tags', authenticateAdmin, async (req, res) => {
  try {
    const apiKeys = await apiKeyService.getAllApiKeys()
    const tagSet = new Set()

    // 收集所有API Keys的标签
    for (const apiKey of apiKeys) {
      if (apiKey.tags && Array.isArray(apiKey.tags)) {
        apiKey.tags.forEach((tag) => {
          if (tag && tag.trim()) {
            tagSet.add(tag.trim())
          }
        })
      }
    }

    // 转换为数组并排序
    const tags = Array.from(tagSet).sort()

    logger.info(`📋 Retrieved ${tags.length} unique tags from API keys`)
    return res.json({ success: true, data: tags })
  } catch (error) {
    logger.error('❌ Failed to get API key tags:', error)
    return res.status(500).json({ error: 'Failed to get API key tags', message: error.message })
  }
})

// 创建新的API Key
router.post('/api-keys', authenticateAdmin, async (req, res) => {
  try {
    const {
      name,
      description,
      tokenLimit,
      expiresAt,
      claudeAccountId,
      claudeConsoleAccountId,
      geminiAccountId,
      openaiAccountId,
      bedrockAccountId,
      permissions,
      concurrencyLimit,
      rateLimitWindow,
      rateLimitRequests,
      enableModelRestriction,
      restrictedModels,
      enableClientRestriction,
      allowedClients,
      dailyCostLimit,
      tags
    } = req.body

    // 输入验证
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required and must be a non-empty string' })
    }

    if (name.length > 100) {
      return res.status(400).json({ error: 'Name must be less than 100 characters' })
    }

    if (description && (typeof description !== 'string' || description.length > 500)) {
      return res
        .status(400)
        .json({ error: 'Description must be a string with less than 500 characters' })
    }

    if (tokenLimit && (!Number.isInteger(Number(tokenLimit)) || Number(tokenLimit) < 0)) {
      return res.status(400).json({ error: 'Token limit must be a non-negative integer' })
    }

    if (
      concurrencyLimit !== undefined &&
      concurrencyLimit !== null &&
      concurrencyLimit !== '' &&
      (!Number.isInteger(Number(concurrencyLimit)) || Number(concurrencyLimit) < 0)
    ) {
      return res.status(400).json({ error: 'Concurrency limit must be a non-negative integer' })
    }

    if (
      rateLimitWindow !== undefined &&
      rateLimitWindow !== null &&
      rateLimitWindow !== '' &&
      (!Number.isInteger(Number(rateLimitWindow)) || Number(rateLimitWindow) < 1)
    ) {
      return res
        .status(400)
        .json({ error: 'Rate limit window must be a positive integer (minutes)' })
    }

    if (
      rateLimitRequests !== undefined &&
      rateLimitRequests !== null &&
      rateLimitRequests !== '' &&
      (!Number.isInteger(Number(rateLimitRequests)) || Number(rateLimitRequests) < 1)
    ) {
      return res.status(400).json({ error: 'Rate limit requests must be a positive integer' })
    }

    // 验证模型限制字段
    if (enableModelRestriction !== undefined && typeof enableModelRestriction !== 'boolean') {
      return res.status(400).json({ error: 'Enable model restriction must be a boolean' })
    }

    if (restrictedModels !== undefined && !Array.isArray(restrictedModels)) {
      return res.status(400).json({ error: 'Restricted models must be an array' })
    }

    // 验证客户端限制字段
    if (enableClientRestriction !== undefined && typeof enableClientRestriction !== 'boolean') {
      return res.status(400).json({ error: 'Enable client restriction must be a boolean' })
    }

    if (allowedClients !== undefined && !Array.isArray(allowedClients)) {
      return res.status(400).json({ error: 'Allowed clients must be an array' })
    }

    // 验证标签字段
    if (tags !== undefined && !Array.isArray(tags)) {
      return res.status(400).json({ error: 'Tags must be an array' })
    }

    if (tags && tags.some((tag) => typeof tag !== 'string' || tag.trim().length === 0)) {
      return res.status(400).json({ error: 'All tags must be non-empty strings' })
    }

    const newKey = await apiKeyService.generateApiKey({
      name,
      description,
      tokenLimit,
      expiresAt,
      claudeAccountId,
      claudeConsoleAccountId,
      geminiAccountId,
      openaiAccountId,
      bedrockAccountId,
      permissions,
      concurrencyLimit,
      rateLimitWindow,
      rateLimitRequests,
      enableModelRestriction,
      restrictedModels,
      enableClientRestriction,
      allowedClients,
      dailyCostLimit,
      tags
    })

    logger.success(`🔑 Admin created new API key: ${name}`)
    return res.json({ success: true, data: newKey })
  } catch (error) {
    logger.error('❌ Failed to create API key:', error)
    return res.status(500).json({ error: 'Failed to create API key', message: error.message })
  }
})

// 批量创建API Keys
router.post('/api-keys/batch', authenticateAdmin, async (req, res) => {
  try {
    const {
      baseName,
      count,
      description,
      tokenLimit,
      expiresAt,
      claudeAccountId,
      claudeConsoleAccountId,
      geminiAccountId,
      openaiAccountId,
      permissions,
      concurrencyLimit,
      rateLimitWindow,
      rateLimitRequests,
      enableModelRestriction,
      restrictedModels,
      enableClientRestriction,
      allowedClients,
      dailyCostLimit,
      tags
    } = req.body

    // 输入验证
    if (!baseName || typeof baseName !== 'string' || baseName.trim().length === 0) {
      return res.status(400).json({ error: 'Base name is required and must be a non-empty string' })
    }

    if (!count || !Number.isInteger(count) || count < 2 || count > 500) {
      return res.status(400).json({ error: 'Count must be an integer between 2 and 500' })
    }

    if (baseName.length > 90) {
      return res
        .status(400)
        .json({ error: 'Base name must be less than 90 characters to allow for numbering' })
    }

    // 生成批量API Keys
    const createdKeys = []
    const errors = []

    for (let i = 1; i <= count; i++) {
      try {
        const name = `${baseName}_${i}`
        const newKey = await apiKeyService.generateApiKey({
          name,
          description,
          tokenLimit,
          expiresAt,
          claudeAccountId,
          claudeConsoleAccountId,
          geminiAccountId,
          openaiAccountId,
          permissions,
          concurrencyLimit,
          rateLimitWindow,
          rateLimitRequests,
          enableModelRestriction,
          restrictedModels,
          enableClientRestriction,
          allowedClients,
          dailyCostLimit,
          tags
        })

        // 保留原始 API Key 供返回
        createdKeys.push({
          ...newKey,
          apiKey: newKey.apiKey
        })
      } catch (error) {
        errors.push({
          index: i,
          name: `${baseName}_${i}`,
          error: error.message
        })
      }
    }

    // 如果有部分失败，返回部分成功的结果
    if (errors.length > 0 && createdKeys.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Failed to create any API keys',
        errors
      })
    }

    // 返回创建的keys（包含完整的apiKey）
    return res.json({
      success: true,
      data: createdKeys,
      errors: errors.length > 0 ? errors : undefined,
      summary: {
        requested: count,
        created: createdKeys.length,
        failed: errors.length
      }
    })
  } catch (error) {
    logger.error('Failed to batch create API keys:', error)
    return res.status(500).json({
      success: false,
      error: 'Failed to batch create API keys',
      message: error.message
    })
  }
})

// 批量编辑API Keys
router.put('/api-keys/batch', authenticateAdmin, async (req, res) => {
  try {
    const { keyIds, updates } = req.body

    if (!keyIds || !Array.isArray(keyIds) || keyIds.length === 0) {
      return res.status(400).json({
        error: 'Invalid input',
        message: 'keyIds must be a non-empty array'
      })
    }

    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({
        error: 'Invalid input',
        message: 'updates must be an object'
      })
    }

    logger.info(
      `🔄 Admin batch editing ${keyIds.length} API keys with updates: ${JSON.stringify(updates)}`
    )
    logger.info(`🔍 Debug: keyIds received: ${JSON.stringify(keyIds)}`)

    const results = {
      successCount: 0,
      failedCount: 0,
      errors: []
    }

    // 处理每个API Key
    for (const keyId of keyIds) {
      try {
        // 获取当前API Key信息
        const currentKey = await database.getApiKey(keyId)
        if (!currentKey || Object.keys(currentKey).length === 0) {
          results.failedCount++
          results.errors.push(`API key ${keyId} not found`)
          continue
        }

        // 构建最终更新数据
        const finalUpdates = {}

        // 处理普通字段
        if (updates.name) {
          finalUpdates.name = updates.name
        }
        if (updates.tokenLimit !== undefined) {
          finalUpdates.tokenLimit = updates.tokenLimit
        }
        if (updates.concurrencyLimit !== undefined) {
          finalUpdates.concurrencyLimit = updates.concurrencyLimit
        }
        if (updates.rateLimitWindow !== undefined) {
          finalUpdates.rateLimitWindow = updates.rateLimitWindow
        }
        if (updates.rateLimitRequests !== undefined) {
          finalUpdates.rateLimitRequests = updates.rateLimitRequests
        }
        if (updates.dailyCostLimit !== undefined) {
          finalUpdates.dailyCostLimit = updates.dailyCostLimit
        }
        if (updates.permissions !== undefined) {
          finalUpdates.permissions = updates.permissions
        }
        if (updates.isActive !== undefined) {
          finalUpdates.isActive = updates.isActive
        }
        if (updates.monthlyLimit !== undefined) {
          finalUpdates.monthlyLimit = updates.monthlyLimit
        }
        if (updates.priority !== undefined) {
          finalUpdates.priority = updates.priority
        }
        if (updates.enabled !== undefined) {
          finalUpdates.enabled = updates.enabled
        }

        // 处理账户绑定
        if (updates.claudeAccountId !== undefined) {
          finalUpdates.claudeAccountId = updates.claudeAccountId
        }
        if (updates.claudeConsoleAccountId !== undefined) {
          finalUpdates.claudeConsoleAccountId = updates.claudeConsoleAccountId
        }
        if (updates.geminiAccountId !== undefined) {
          finalUpdates.geminiAccountId = updates.geminiAccountId
        }
        if (updates.openaiAccountId !== undefined) {
          finalUpdates.openaiAccountId = updates.openaiAccountId
        }
        if (updates.bedrockAccountId !== undefined) {
          finalUpdates.bedrockAccountId = updates.bedrockAccountId
        }

        // 处理标签操作
        if (updates.tags !== undefined) {
          if (updates.tagOperation) {
            const currentTags = currentKey.tags ? JSON.parse(currentKey.tags) : []
            const operationTags = updates.tags

            switch (updates.tagOperation) {
              case 'replace': {
                finalUpdates.tags = operationTags
                break
              }
              case 'add': {
                const newTags = [...currentTags]
                operationTags.forEach((tag) => {
                  if (!newTags.includes(tag)) {
                    newTags.push(tag)
                  }
                })
                finalUpdates.tags = newTags
                break
              }
              case 'remove': {
                finalUpdates.tags = currentTags.filter((tag) => !operationTags.includes(tag))
                break
              }
            }
          } else {
            // 如果没有指定操作类型，默认为替换
            finalUpdates.tags = updates.tags
          }
        }

        // 执行更新
        await apiKeyService.updateApiKey(keyId, finalUpdates)
        results.successCount++
        logger.success(`✅ Batch edit: API key ${keyId} updated successfully`)
      } catch (error) {
        results.failedCount++
        results.errors.push(`Failed to update key ${keyId}: ${error.message}`)
        logger.error(`❌ Batch edit failed for key ${keyId}:`, error)
      }
    }

    // 记录批量编辑结果
    if (results.successCount > 0) {
      logger.success(
        `🎉 Batch edit completed: ${results.successCount} successful, ${results.failedCount} failed`
      )
    } else {
      logger.warn(
        `⚠️ Batch edit completed with no successful updates: ${results.failedCount} failed`
      )
    }

    return res.json({
      success: true,
      message: `批量编辑完成`,
      data: results
    })
  } catch (error) {
    logger.error('❌ Failed to batch edit API keys:', error)
    return res.status(500).json({
      error: 'Batch edit failed',
      message: error.message
    })
  }
})

// 更新API Key
router.put('/api-keys/:keyId', authenticateAdmin, async (req, res) => {
  try {
    const { keyId } = req.params
    const {
      tokenLimit,
      concurrencyLimit,
      rateLimitWindow,
      rateLimitRequests,
      isActive,
      claudeAccountId,
      claudeConsoleAccountId,
      geminiAccountId,
      openaiAccountId,
      bedrockAccountId,
      permissions,
      enableModelRestriction,
      restrictedModels,
      enableClientRestriction,
      allowedClients,
      expiresAt,
      dailyCostLimit,
      tags
    } = req.body

    // 只允许更新指定字段
    const updates = {}

    if (tokenLimit !== undefined && tokenLimit !== null && tokenLimit !== '') {
      if (!Number.isInteger(Number(tokenLimit)) || Number(tokenLimit) < 0) {
        return res.status(400).json({ error: 'Token limit must be a non-negative integer' })
      }
      updates.tokenLimit = Number(tokenLimit)
    }

    if (concurrencyLimit !== undefined && concurrencyLimit !== null && concurrencyLimit !== '') {
      if (!Number.isInteger(Number(concurrencyLimit)) || Number(concurrencyLimit) < 0) {
        return res.status(400).json({ error: 'Concurrency limit must be a non-negative integer' })
      }
      updates.concurrencyLimit = Number(concurrencyLimit)
    }

    if (rateLimitWindow !== undefined && rateLimitWindow !== null && rateLimitWindow !== '') {
      if (!Number.isInteger(Number(rateLimitWindow)) || Number(rateLimitWindow) < 0) {
        return res
          .status(400)
          .json({ error: 'Rate limit window must be a non-negative integer (minutes)' })
      }
      updates.rateLimitWindow = Number(rateLimitWindow)
    }

    if (rateLimitRequests !== undefined && rateLimitRequests !== null && rateLimitRequests !== '') {
      if (!Number.isInteger(Number(rateLimitRequests)) || Number(rateLimitRequests) < 0) {
        return res.status(400).json({ error: 'Rate limit requests must be a non-negative integer' })
      }
      updates.rateLimitRequests = Number(rateLimitRequests)
    }

    if (claudeAccountId !== undefined) {
      // 空字符串表示解绑，null或空字符串都设置为空字符串
      updates.claudeAccountId = claudeAccountId || ''
    }

    if (claudeConsoleAccountId !== undefined) {
      // 空字符串表示解绑，null或空字符串都设置为空字符串
      updates.claudeConsoleAccountId = claudeConsoleAccountId || ''
    }

    if (geminiAccountId !== undefined) {
      // 空字符串表示解绑，null或空字符串都设置为空字符串
      updates.geminiAccountId = geminiAccountId || ''
    }

    if (openaiAccountId !== undefined) {
      // 空字符串表示解绑，null或空字符串都设置为空字符串
      updates.openaiAccountId = openaiAccountId || ''
    }

    if (bedrockAccountId !== undefined) {
      // 空字符串表示解绑，null或空字符串都设置为空字符串
      updates.bedrockAccountId = bedrockAccountId || ''
    }

    if (permissions !== undefined) {
      // 验证权限值
      if (!['claude', 'gemini', 'openai', 'all'].includes(permissions)) {
        return res
          .status(400)
          .json({ error: 'Invalid permissions value. Must be claude, gemini, openai, or all' })
      }
      updates.permissions = permissions
    }

    // 处理模型限制字段
    if (enableModelRestriction !== undefined) {
      if (typeof enableModelRestriction !== 'boolean') {
        return res.status(400).json({ error: 'Enable model restriction must be a boolean' })
      }
      updates.enableModelRestriction = enableModelRestriction
    }

    if (restrictedModels !== undefined) {
      if (!Array.isArray(restrictedModels)) {
        return res.status(400).json({ error: 'Restricted models must be an array' })
      }
      updates.restrictedModels = restrictedModels
    }

    // 处理客户端限制字段
    if (enableClientRestriction !== undefined) {
      if (typeof enableClientRestriction !== 'boolean') {
        return res.status(400).json({ error: 'Enable client restriction must be a boolean' })
      }
      updates.enableClientRestriction = enableClientRestriction
    }

    if (allowedClients !== undefined) {
      if (!Array.isArray(allowedClients)) {
        return res.status(400).json({ error: 'Allowed clients must be an array' })
      }
      updates.allowedClients = allowedClients
    }

    // 处理过期时间字段
    if (expiresAt !== undefined) {
      if (expiresAt === null) {
        // null 表示永不过期
        updates.expiresAt = null
        updates.isActive = true
      } else {
        // 验证日期格式
        const expireDate = new Date(expiresAt)
        if (isNaN(expireDate.getTime())) {
          return res.status(400).json({ error: 'Invalid expiration date format' })
        }
        updates.expiresAt = expiresAt
        updates.isActive = expireDate > new Date() // 如果过期时间在当前时间之后，则设置为激活状态
      }
    }

    // 处理每日费用限制
    if (dailyCostLimit !== undefined && dailyCostLimit !== null && dailyCostLimit !== '') {
      const costLimit = Number(dailyCostLimit)
      if (isNaN(costLimit) || costLimit < 0) {
        return res.status(400).json({ error: 'Daily cost limit must be a non-negative number' })
      }
      updates.dailyCostLimit = costLimit
    }

    // 处理标签
    if (tags !== undefined) {
      if (!Array.isArray(tags)) {
        return res.status(400).json({ error: 'Tags must be an array' })
      }
      if (tags.some((tag) => typeof tag !== 'string' || tag.trim().length === 0)) {
        return res.status(400).json({ error: 'All tags must be non-empty strings' })
      }
      updates.tags = tags
    }

    // 处理活跃/禁用状态状态, 放在过期处理后，以确保后续增加禁用key功能
    if (isActive !== undefined) {
      if (typeof isActive !== 'boolean') {
        return res.status(400).json({ error: 'isActive must be a boolean' })
      }
      updates.isActive = isActive
    }

    await apiKeyService.updateApiKey(keyId, updates)

    logger.success(`📝 Admin updated API key: ${keyId}`)
    return res.json({ success: true, message: 'API key updated successfully' })
  } catch (error) {
    logger.error('❌ Failed to update API key:', error)
    return res.status(500).json({ error: 'Failed to update API key', message: error.message })
  }
})

// 批量删除API Keys（必须在 :keyId 路由之前定义）
router.delete('/api-keys/batch', authenticateAdmin, async (req, res) => {
  try {
    const { keyIds } = req.body

    // 调试信息
    logger.info(`🐛 Batch delete request body: ${JSON.stringify(req.body)}`)
    logger.info(`🐛 keyIds type: ${typeof keyIds}, value: ${JSON.stringify(keyIds)}`)

    // 参数验证
    if (!keyIds || !Array.isArray(keyIds) || keyIds.length === 0) {
      logger.warn(
        `🚨 Invalid keyIds: ${JSON.stringify({ keyIds, type: typeof keyIds, isArray: Array.isArray(keyIds) })}`
      )
      return res.status(400).json({
        error: 'Invalid request',
        message: 'keyIds 必须是一个非空数组'
      })
    }

    if (keyIds.length > 100) {
      return res.status(400).json({
        error: 'Too many keys',
        message: '每次最多只能删除100个API Keys'
      })
    }

    // 验证keyIds格式
    const invalidKeys = keyIds.filter((id) => !id || typeof id !== 'string')
    if (invalidKeys.length > 0) {
      return res.status(400).json({
        error: 'Invalid key IDs',
        message: '包含无效的API Key ID'
      })
    }

    logger.info(
      `🗑️ Admin attempting batch delete of ${keyIds.length} API keys: ${JSON.stringify(keyIds)}`
    )

    const results = {
      successCount: 0,
      failedCount: 0,
      errors: []
    }

    // 逐个删除，记录成功和失败情况
    for (const keyId of keyIds) {
      try {
        // 检查API Key是否存在
        const apiKey = await database.getApiKey(keyId)
        if (!apiKey || Object.keys(apiKey).length === 0) {
          results.failedCount++
          results.errors.push({ keyId, error: 'API Key 不存在' })
          continue
        }

        // 执行删除
        await apiKeyService.deleteApiKey(keyId)
        results.successCount++

        logger.success(`✅ Batch delete: API key ${keyId} deleted successfully`)
      } catch (error) {
        results.failedCount++
        results.errors.push({
          keyId,
          error: error.message || '删除失败'
        })

        logger.error(`❌ Batch delete failed for key ${keyId}:`, error)
      }
    }

    // 记录批量删除结果
    if (results.successCount > 0) {
      logger.success(
        `🎉 Batch delete completed: ${results.successCount} successful, ${results.failedCount} failed`
      )
    } else {
      logger.warn(
        `⚠️ Batch delete completed with no successful deletions: ${results.failedCount} failed`
      )
    }

    return res.json({
      success: true,
      message: `批量删除完成`,
      data: results
    })
  } catch (error) {
    logger.error('❌ Failed to batch delete API keys:', error)
    return res.status(500).json({
      error: 'Batch delete failed',
      message: error.message
    })
  }
})

// 删除单个API Key（必须在批量删除路由之后定义）
router.delete('/api-keys/:keyId', authenticateAdmin, async (req, res) => {
  try {
    const { keyId } = req.params

    await apiKeyService.deleteApiKey(keyId)

    logger.success(`🗑️ Admin deleted API key: ${keyId}`)
    return res.json({ success: true, message: 'API key deleted successfully' })
  } catch (error) {
    logger.error('❌ Failed to delete API key:', error)
    return res.status(500).json({ error: 'Failed to delete API key', message: error.message })
  }
})

// 👥 账户分组管理

// 创建账户分组
router.post('/account-groups', authenticateAdmin, async (req, res) => {
  try {
    const { name, platform, description, schedulingStrategy, schedulingWeight, sequentialOrder } =
      req.body

    // 验证调度策略字段
    const schedulingFields = { schedulingStrategy, schedulingWeight, sequentialOrder }
    const validation = schedulingValidator.validateSchedulingFields(schedulingFields)
    if (!validation.valid) {
      return res.status(400).json({
        error: `调度策略字段验证失败: ${validation.errors.join(', ')}`
      })
    }

    const group = await accountGroupService.createGroup({
      name,
      platform,
      description,
      schedulingStrategy,
      schedulingWeight,
      sequentialOrder
    })

    return res.json({ success: true, data: group })
  } catch (error) {
    logger.error('❌ Failed to create account group:', error)
    return res.status(400).json({ error: error.message })
  }
})

// 获取所有分组
router.get('/account-groups', authenticateAdmin, async (req, res) => {
  try {
    const { platform } = req.query
    const groups = await accountGroupService.getAllGroups(platform)
    return res.json({ success: true, data: groups })
  } catch (error) {
    logger.error('❌ Failed to get account groups:', error)
    return res.status(500).json({ error: error.message })
  }
})

// 获取分组详情
router.get('/account-groups/:groupId', authenticateAdmin, async (req, res) => {
  try {
    const { groupId } = req.params
    const group = await accountGroupService.getGroup(groupId)

    if (!group) {
      return res.status(404).json({ error: '分组不存在' })
    }

    return res.json({ success: true, data: group })
  } catch (error) {
    logger.error('❌ Failed to get account group:', error)
    return res.status(500).json({ error: error.message })
  }
})

// 更新分组
router.put('/account-groups/:groupId', authenticateAdmin, async (req, res) => {
  try {
    const { groupId } = req.params
    const updates = req.body

    // 验证调度策略字段（如果有更新）
    const schedulingFields = {}
    if (updates.schedulingStrategy !== undefined) {
      schedulingFields.schedulingStrategy = updates.schedulingStrategy
    }
    if (updates.schedulingWeight !== undefined) {
      schedulingFields.schedulingWeight = updates.schedulingWeight
    }
    if (updates.sequentialOrder !== undefined) {
      schedulingFields.sequentialOrder = updates.sequentialOrder
    }

    if (Object.keys(schedulingFields).length > 0) {
      const validation = schedulingValidator.validateSchedulingFields(schedulingFields)
      if (!validation.valid) {
        return res.status(400).json({
          error: `调度策略字段验证失败: ${validation.errors.join(', ')}`
        })
      }
    }

    const updatedGroup = await accountGroupService.updateGroup(groupId, updates)
    return res.json({ success: true, data: updatedGroup })
  } catch (error) {
    logger.error('❌ Failed to update account group:', error)
    return res.status(400).json({ error: error.message })
  }
})

// 删除分组
router.delete('/account-groups/:groupId', authenticateAdmin, async (req, res) => {
  try {
    const { groupId } = req.params
    await accountGroupService.deleteGroup(groupId)
    return res.json({ success: true, message: '分组删除成功' })
  } catch (error) {
    logger.error('❌ Failed to delete account group:', error)
    return res.status(400).json({ error: error.message })
  }
})

// 获取分组成员
router.get('/account-groups/:groupId/members', authenticateAdmin, async (req, res) => {
  try {
    const { groupId } = req.params
    const memberIds = await accountGroupService.getGroupMembers(groupId)

    // 获取成员详细信息
    const members = []
    for (const memberId of memberIds) {
      // 尝试从不同的服务获取账户信息
      let account = null

      // 先尝试Claude OAuth账户
      account = await claudeAccountService.getAccount(memberId)

      // 如果找不到，尝试Claude Console账户
      if (!account) {
        account = await claudeConsoleAccountService.getAccount(memberId)
      }

      // 如果还找不到，尝试Gemini账户
      if (!account) {
        account = await geminiAccountService.getAccount(memberId)
      }

      // 如果还找不到，尝试OpenAI账户
      if (!account) {
        account = await openaiAccountService.getAccount(memberId)
      }

      if (account) {
        members.push(account)
      }
    }

    return res.json({ success: true, data: members })
  } catch (error) {
    logger.error('❌ Failed to get group members:', error)
    return res.status(500).json({ error: error.message })
  }
})

// 🏢 Claude 账户管理

// 生成OAuth授权URL
router.post('/claude-accounts/generate-auth-url', authenticateAdmin, async (req, res) => {
  try {
    const { proxy } = req.body // 接收代理配置
    const oauthParams = await oauthHelper.generateOAuthParams()

    // 将codeVerifier和state临时存储到数据库，用于后续验证
    const sessionId = require('crypto').randomUUID()
    await database.setOAuthSession(sessionId, {
      codeVerifier: oauthParams.codeVerifier,
      state: oauthParams.state,
      codeChallenge: oauthParams.codeChallenge,
      proxy: proxy || null, // 存储代理配置
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10分钟过期
    })

    logger.success('🔗 Generated OAuth authorization URL with proxy support')
    return res.json({
      success: true,
      data: {
        authUrl: oauthParams.authUrl,
        sessionId,
        instructions: [
          '1. 复制上面的链接到浏览器中打开',
          '2. 登录您的 Anthropic 账户',
          '3. 同意应用权限',
          '4. 复制浏览器地址栏中的完整 URL',
          '5. 在添加账户表单中粘贴完整的回调 URL 和授权码'
        ]
      }
    })
  } catch (error) {
    logger.error('❌ Failed to generate OAuth URL:', error)
    return res.status(500).json({ error: 'Failed to generate OAuth URL', message: error.message })
  }
})

// 验证授权码并获取token
router.post('/claude-accounts/exchange-code', authenticateAdmin, async (req, res) => {
  try {
    const { sessionId, authorizationCode, callbackUrl } = req.body

    if (!sessionId || (!authorizationCode && !callbackUrl)) {
      return res
        .status(400)
        .json({ error: 'Session ID and authorization code (or callback URL) are required' })
    }

    // 从数据库获取OAuth会话信息
    const oauthSession = await database.getOAuthSession(sessionId)
    if (!oauthSession) {
      return res.status(400).json({ error: 'Invalid or expired OAuth session' })
    }

    // 检查会话是否过期
    if (new Date() > new Date(oauthSession.expiresAt)) {
      await database.deleteOAuthSession(sessionId)
      return res
        .status(400)
        .json({ error: 'OAuth session has expired, please generate a new authorization URL' })
    }

    // 统一处理授权码输入（可能是直接的code或完整的回调URL）
    let finalAuthCode
    const inputValue = callbackUrl || authorizationCode

    try {
      finalAuthCode = oauthHelper.parseCallbackUrl(inputValue)
    } catch (parseError) {
      return res
        .status(400)
        .json({ error: 'Failed to parse authorization input', message: parseError.message })
    }

    // 交换访问令牌
    const tokenData = await oauthHelper.exchangeCodeForTokens(
      finalAuthCode,
      oauthSession.codeVerifier,
      oauthSession.state,
      oauthSession.proxy // 传递代理配置
    )

    // 清理OAuth会话
    await database.deleteOAuthSession(sessionId)

    logger.success('🎉 Successfully exchanged authorization code for tokens')
    return res.json({
      success: true,
      data: {
        claudeAiOauth: tokenData
      }
    })
  } catch (error) {
    logger.error('❌ Failed to exchange authorization code:', {
      error: error.message,
      sessionId: req.body.sessionId,
      // 不记录完整的授权码，只记录长度和前几个字符
      codeLength: req.body.callbackUrl
        ? req.body.callbackUrl.length
        : req.body.authorizationCode
          ? req.body.authorizationCode.length
          : 0,
      codePrefix: req.body.callbackUrl
        ? `${req.body.callbackUrl.substring(0, 10)}...`
        : req.body.authorizationCode
          ? `${req.body.authorizationCode.substring(0, 10)}...`
          : 'N/A'
    })
    return res
      .status(500)
      .json({ error: 'Failed to exchange authorization code', message: error.message })
  }
})

// 生成Claude setup-token授权URL
router.post('/claude-accounts/generate-setup-token-url', authenticateAdmin, async (req, res) => {
  try {
    const { proxy } = req.body // 接收代理配置
    const setupTokenParams = await oauthHelper.generateSetupTokenParams()

    // 将codeVerifier和state临时存储到数据库，用于后续验证
    const sessionId = require('crypto').randomUUID()
    await database.setOAuthSession(sessionId, {
      type: 'setup-token', // 标记为setup-token类型
      codeVerifier: setupTokenParams.codeVerifier,
      state: setupTokenParams.state,
      codeChallenge: setupTokenParams.codeChallenge,
      proxy: proxy || null, // 存储代理配置
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10分钟过期
    })

    logger.success('🔗 Generated Setup Token authorization URL with proxy support')
    return res.json({
      success: true,
      data: {
        authUrl: setupTokenParams.authUrl,
        sessionId,
        instructions: [
          '1. 复制上面的链接到浏览器中打开',
          '2. 登录您的 Claude 账户并授权 Claude Code',
          '3. 完成授权后，从返回页面复制 Authorization Code',
          '4. 在添加账户表单中粘贴 Authorization Code'
        ]
      }
    })
  } catch (error) {
    logger.error('❌ Failed to generate Setup Token URL:', error)
    return res
      .status(500)
      .json({ error: 'Failed to generate Setup Token URL', message: error.message })
  }
})

// 验证setup-token授权码并获取token
router.post('/claude-accounts/exchange-setup-token-code', authenticateAdmin, async (req, res) => {
  try {
    const { sessionId, authorizationCode, callbackUrl } = req.body

    if (!sessionId || (!authorizationCode && !callbackUrl)) {
      return res
        .status(400)
        .json({ error: 'Session ID and authorization code (or callback URL) are required' })
    }

    // 从数据库获取OAuth会话信息
    const oauthSession = await database.getOAuthSession(sessionId)
    if (!oauthSession) {
      return res.status(400).json({ error: 'Invalid or expired OAuth session' })
    }

    // 检查是否是setup-token类型
    if (oauthSession.type !== 'setup-token') {
      return res.status(400).json({ error: 'Invalid session type for setup token exchange' })
    }

    // 检查会话是否过期
    if (new Date() > new Date(oauthSession.expiresAt)) {
      await database.deleteOAuthSession(sessionId)
      return res
        .status(400)
        .json({ error: 'OAuth session has expired, please generate a new authorization URL' })
    }

    // 统一处理授权码输入（可能是直接的code或完整的回调URL）
    let finalAuthCode
    const inputValue = callbackUrl || authorizationCode

    try {
      finalAuthCode = oauthHelper.parseCallbackUrl(inputValue)
    } catch (parseError) {
      return res
        .status(400)
        .json({ error: 'Failed to parse authorization input', message: parseError.message })
    }

    // 交换Setup Token
    const tokenData = await oauthHelper.exchangeSetupTokenCode(
      finalAuthCode,
      oauthSession.codeVerifier,
      oauthSession.state,
      oauthSession.proxy // 传递代理配置
    )

    // 清理OAuth会话
    await database.deleteOAuthSession(sessionId)

    logger.success('🎉 Successfully exchanged setup token authorization code for tokens')
    return res.json({
      success: true,
      data: {
        claudeAiOauth: tokenData
      }
    })
  } catch (error) {
    logger.error('❌ Failed to exchange setup token authorization code:', {
      error: error.message,
      sessionId: req.body.sessionId,
      // 不记录完整的授权码，只记录长度和前几个字符
      codeLength: req.body.callbackUrl
        ? req.body.callbackUrl.length
        : req.body.authorizationCode
          ? req.body.authorizationCode.length
          : 0,
      codePrefix: req.body.callbackUrl
        ? `${req.body.callbackUrl.substring(0, 10)}...`
        : req.body.authorizationCode
          ? `${req.body.authorizationCode.substring(0, 10)}...`
          : 'N/A'
    })
    return res
      .status(500)
      .json({ error: 'Failed to exchange setup token authorization code', message: error.message })
  }
})

// 获取所有Claude账户
router.get('/claude-accounts', authenticateAdmin, async (req, res) => {
  try {
    const { platform, groupId } = req.query
    let accounts = await claudeAccountService.getAllAccounts()

    // 根据查询参数进行筛选
    if (platform && platform !== 'all' && platform !== 'claude') {
      // 如果指定了其他平台，返回空数组
      accounts = []
    }

    // 如果指定了分组筛选
    if (groupId && groupId !== 'all') {
      if (groupId === 'ungrouped') {
        // 筛选未分组账户
        accounts = accounts.filter((account) => !account.groupInfo)
      } else {
        // 筛选特定分组的账户
        accounts = accounts.filter(
          (account) => account.groupInfo && account.groupInfo.id === groupId
        )
      }
    }

    // 为每个账户添加使用统计信息和限流状态
    const accountsWithStats = await Promise.all(
      accounts.map(async (account) => {
        try {
          const usageStats = await database.getAccountUsageStats(account.id)
          const rateLimitInfo = await claudeAccountService.getAccountRateLimitInfo(account.id)
          const sessionWindowInfo = await claudeAccountService.getSessionWindowInfo(account.id)
          return {
            ...account,
            usage: {
              daily: usageStats.daily,
              total: usageStats.total,
              averages: usageStats.averages
            },
            rateLimitStatus: rateLimitInfo,
            sessionWindow: sessionWindowInfo
          }
        } catch (statsError) {
          logger.warn(`⚠️ Failed to get usage stats for account ${account.id}:`, statsError.message)
          // 如果获取统计失败，返回空统计
          return {
            ...account,
            usage: {
              daily: { tokens: 0, requests: 0, allTokens: 0 },
              total: { tokens: 0, requests: 0, allTokens: 0 },
              averages: { rpm: 0, tpm: 0 }
            },
            rateLimitStatus: null,
            sessionWindow: null
          }
        }
      })
    )

    return res.json({ success: true, data: accountsWithStats })
  } catch (error) {
    logger.error('❌ Failed to get Claude accounts:', error)
    return res.status(500).json({ error: 'Failed to get Claude accounts', message: error.message })
  }
})

// 创建新的Claude账户
router.post('/claude-accounts', authenticateAdmin, async (req, res) => {
  try {
    const {
      name,
      description,
      email,
      password,
      refreshToken,
      claudeAiOauth,
      proxy,
      accountType,
      platform = 'claude',
      priority,
      groupId,
      // 新增调度策略字段
      schedulingStrategy,
      schedulingWeight,
      sequentialOrder,
      // 新增警告控制字段
      autoStopOnWarning
    } = req.body

    if (!name) {
      return res.status(400).json({ error: 'Name is required' })
    }

    // 验证accountType的有效性
    if (accountType && !['shared', 'dedicated', 'group'].includes(accountType)) {
      return res
        .status(400)
        .json({ error: 'Invalid account type. Must be "shared", "dedicated" or "group"' })
    }

    // 如果是分组类型，验证groupId
    if (accountType === 'group' && !groupId) {
      return res.status(400).json({ error: 'Group ID is required for group type accounts' })
    }

    // 验证priority的有效性
    if (
      priority !== undefined &&
      (typeof priority !== 'number' || priority < 1 || priority > 100)
    ) {
      return res.status(400).json({ error: 'Priority must be a number between 1 and 100' })
    }

    // 使用验证工具验证调度策略字段
    const schedulingFields = {
      schedulingStrategy,
      schedulingWeight,
      sequentialOrder
    }

    const schedulingValidation =
      schedulingValidator.validateAndPrepareSchedulingFields(schedulingFields)

    if (!schedulingValidation.valid) {
      return res.status(400).json({
        error: 'Invalid scheduling fields',
        details: schedulingValidation.errors
      })
    }

    const newAccount = await claudeAccountService.createAccount({
      name,
      description,
      email,
      password,
      refreshToken,
      claudeAiOauth,
      proxy,
      accountType: accountType || 'shared', // 默认为共享类型
      platform,
      priority: priority || 50, // 默认优先级为50
      // 使用验证后的调度策略字段
      ...schedulingValidation.fields,
      // 新增警告控制字段
      autoStopOnWarning: autoStopOnWarning || false
    })

    // 如果是分组类型，将账户添加到分组
    if (accountType === 'group' && groupId) {
      await accountGroupService.addAccountToGroup(newAccount.id, groupId, newAccount.platform)
    }

    logger.success(`🏢 Admin created new Claude account: ${name} (${accountType || 'shared'})`)
    return res.json({ success: true, data: newAccount })
  } catch (error) {
    logger.error('❌ Failed to create Claude account:', error)
    return res
      .status(500)
      .json({ error: 'Failed to create Claude account', message: error.message })
  }
})

// 更新Claude账户
router.put('/claude-accounts/:accountId', authenticateAdmin, async (req, res) => {
  try {
    const { accountId } = req.params
    const updates = req.body

    // 验证priority的有效性
    if (
      updates.priority !== undefined &&
      (typeof updates.priority !== 'number' || updates.priority < 1 || updates.priority > 100)
    ) {
      return res.status(400).json({ error: 'Priority must be a number between 1 and 100' })
    }

    // 验证accountType的有效性
    if (updates.accountType && !['shared', 'dedicated', 'group'].includes(updates.accountType)) {
      return res
        .status(400)
        .json({ error: 'Invalid account type. Must be "shared", "dedicated" or "group"' })
    }

    // 如果更新为分组类型，验证groupId
    if (updates.accountType === 'group' && !updates.groupId) {
      return res.status(400).json({ error: 'Group ID is required for group type accounts' })
    }

    // 使用验证工具验证调度策略字段（只验证提供的字段）
    const schedulingFields = {}
    if (updates.schedulingStrategy !== undefined) {
      schedulingFields.schedulingStrategy = updates.schedulingStrategy
    }
    if (updates.schedulingWeight !== undefined) {
      schedulingFields.schedulingWeight = updates.schedulingWeight
    }
    if (updates.sequentialOrder !== undefined) {
      schedulingFields.sequentialOrder = updates.sequentialOrder
    }

    if (Object.keys(schedulingFields).length > 0) {
      const schedulingValidation = schedulingValidator.validateSchedulingFields(schedulingFields)

      if (!schedulingValidation.valid) {
        return res.status(400).json({
          error: 'Invalid scheduling fields',
          details: schedulingValidation.errors
        })
      }
    }

    // 获取账户当前信息以处理分组变更
    const currentAccount = await claudeAccountService.getAccount(accountId)
    if (!currentAccount) {
      return res.status(404).json({ error: 'Account not found' })
    }

    // 处理分组的变更
    if (updates.accountType !== undefined) {
      // 如果之前是分组类型，需要从原分组中移除
      if (currentAccount.accountType === 'group') {
        const oldGroup = await accountGroupService.getAccountGroup(accountId)
        if (oldGroup) {
          await accountGroupService.removeAccountFromGroup(accountId, oldGroup.id)
        }
      }

      // 如果新类型是分组，添加到新分组
      if (updates.accountType === 'group' && updates.groupId) {
        // 从路由知道这是 Claude OAuth 账户，平台为 'claude'
        await accountGroupService.addAccountToGroup(accountId, updates.groupId, 'claude')
      }
    }

    await claudeAccountService.updateAccount(accountId, updates)

    logger.success(`📝 Admin updated Claude account: ${accountId}`)
    return res.json({ success: true, message: 'Claude account updated successfully' })
  } catch (error) {
    logger.error('❌ Failed to update Claude account:', error)
    return res
      .status(500)
      .json({ error: 'Failed to update Claude account', message: error.message })
  }
})

// 删除Claude账户
router.delete('/claude-accounts/:accountId', authenticateAdmin, async (req, res) => {
  try {
    const { accountId } = req.params

    // 获取账户信息以检查是否在分组中
    const account = await claudeAccountService.getAccount(accountId)
    if (account && account.accountType === 'group') {
      const group = await accountGroupService.getAccountGroup(accountId)
      if (group) {
        await accountGroupService.removeAccountFromGroup(accountId, group.id)
      }
    }

    await claudeAccountService.deleteAccount(accountId)

    logger.success(`🗑️ Admin deleted Claude account: ${accountId}`)
    return res.json({ success: true, message: 'Claude account deleted successfully' })
  } catch (error) {
    logger.error('❌ Failed to delete Claude account:', error)
    return res
      .status(500)
      .json({ error: 'Failed to delete Claude account', message: error.message })
  }
})

// 更新单个Claude账户的Profile信息
router.post('/claude-accounts/:accountId/update-profile', authenticateAdmin, async (req, res) => {
  try {
    const { accountId } = req.params

    const profileInfo = await claudeAccountService.fetchAndUpdateAccountProfile(accountId)

    logger.success(`✅ Updated profile for Claude account: ${accountId}`)
    return res.json({
      success: true,
      message: 'Account profile updated successfully',
      data: profileInfo
    })
  } catch (error) {
    logger.error('❌ Failed to update account profile:', error)
    return res
      .status(500)
      .json({ error: 'Failed to update account profile', message: error.message })
  }
})

// 批量更新所有Claude账户的Profile信息
router.post('/claude-accounts/update-all-profiles', authenticateAdmin, async (req, res) => {
  try {
    const result = await claudeAccountService.updateAllAccountProfiles()

    logger.success('✅ Batch profile update completed')
    return res.json({
      success: true,
      message: 'Batch profile update completed',
      data: result
    })
  } catch (error) {
    logger.error('❌ Failed to update all account profiles:', error)
    return res
      .status(500)
      .json({ error: 'Failed to update all account profiles', message: error.message })
  }
})

// 刷新Claude账户token
router.post('/claude-accounts/:accountId/refresh', authenticateAdmin, async (req, res) => {
  try {
    const { accountId } = req.params

    const result = await claudeAccountService.refreshAccountToken(accountId)

    logger.success(`🔄 Admin refreshed token for Claude account: ${accountId}`)
    return res.json({ success: true, data: result })
  } catch (error) {
    logger.error('❌ Failed to refresh Claude account token:', error)
    return res.status(500).json({ error: 'Failed to refresh token', message: error.message })
  }
})

// 重置Claude账户状态（清除所有异常状态）
router.post('/claude-accounts/:accountId/reset-status', authenticateAdmin, async (req, res) => {
  try {
    const { accountId } = req.params

    const result = await claudeAccountService.resetAccountStatus(accountId)

    logger.success(`✅ Admin reset status for Claude account: ${accountId}`)
    return res.json({ success: true, data: result })
  } catch (error) {
    logger.error('❌ Failed to reset Claude account status:', error)
    return res.status(500).json({ error: 'Failed to reset status', message: error.message })
  }
})

// 切换Claude账户调度状态
router.put(
  '/claude-accounts/:accountId/toggle-schedulable',
  authenticateAdmin,
  async (req, res) => {
    try {
      const { accountId } = req.params

      const accounts = await claudeAccountService.getAllAccounts()
      const account = accounts.find((acc) => acc.id === accountId)

      if (!account) {
        return res.status(404).json({ error: 'Account not found' })
      }

      const newSchedulable = !account.schedulable
      await claudeAccountService.updateAccount(accountId, { schedulable: newSchedulable })

      // 如果账号被禁用，发送webhook通知
      if (!newSchedulable) {
        await webhookNotifier.sendAccountAnomalyNotification({
          accountId: account.id,
          accountName: account.name || account.claudeAiOauth?.email || 'Claude Account',
          platform: 'claude-oauth',
          status: 'disabled',
          errorCode: 'CLAUDE_OAUTH_MANUALLY_DISABLED',
          reason: '账号已被管理员手动禁用调度',
          timestamp: new Date().toISOString()
        })
      }

      logger.success(
        `🔄 Admin toggled Claude account schedulable status: ${accountId} -> ${newSchedulable ? 'schedulable' : 'not schedulable'}`
      )
      return res.json({ success: true, schedulable: newSchedulable })
    } catch (error) {
      logger.error('❌ Failed to toggle Claude account schedulable status:', error)
      return res
        .status(500)
        .json({ error: 'Failed to toggle schedulable status', message: error.message })
    }
  }
)

// 获取Claude账户费用统计
router.get('/claude-accounts/:accountId/cost-stats', authenticateAdmin, async (req, res) => {
  try {
    const { accountId } = req.params
    const { period } = req.query // 可选参数：daily, weekly, monthly, all

    logger.debug(`📊 获取Claude账户费用统计: ${accountId}, period: ${period || 'all'}`)

    // 验证账户是否存在
    const account = await claudeAccountService.getAccount(accountId)
    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Account not found',
        message: '指定的账户不存在'
      })
    }

    // 获取费用统计
    const costStats = await claudeAccountService.getAccountCostStats(accountId, {
      period: period || 'all'
    })

    logger.success(
      `📊 成功获取账户费用统计: ${accountId} - $${(costStats.totalCost || 0).toFixed(6)}`
    )

    return res.json({
      success: true,
      data: costStats
    })
  } catch (error) {
    logger.error(`❌ 获取账户费用统计失败 (${req.params.accountId}):`, error)
    return res.status(500).json({
      success: false,
      error: 'Failed to get account cost stats',
      message: error.message
    })
  }
})

// 🎮 Claude Console 账户管理

// 获取所有Claude Console账户
router.get('/claude-console-accounts', authenticateAdmin, async (req, res) => {
  try {
    const { platform, groupId } = req.query
    let accounts = await claudeConsoleAccountService.getAllAccounts()

    // 根据查询参数进行筛选
    if (platform && platform !== 'all' && platform !== 'claude-console') {
      // 如果指定了其他平台，返回空数组
      accounts = []
    }

    // 如果指定了分组筛选
    if (groupId && groupId !== 'all') {
      if (groupId === 'ungrouped') {
        // 筛选未分组账户
        accounts = accounts.filter((account) => !account.groupInfo)
      } else {
        // 筛选特定分组的账户
        accounts = accounts.filter(
          (account) => account.groupInfo && account.groupInfo.id === groupId
        )
      }
    }

    // 为每个账户添加使用统计信息
    const accountsWithStats = await Promise.all(
      accounts.map(async (account) => {
        try {
          const usageStats = await database.getAccountUsageStats(account.id)
          return {
            ...account,
            usage: {
              daily: usageStats.daily,
              total: usageStats.total,
              averages: usageStats.averages
            }
          }
        } catch (statsError) {
          logger.warn(
            `⚠️ Failed to get usage stats for Claude Console account ${account.id}:`,
            statsError.message
          )
          return {
            ...account,
            usage: {
              daily: { tokens: 0, requests: 0, allTokens: 0 },
              total: { tokens: 0, requests: 0, allTokens: 0 },
              averages: { rpm: 0, tpm: 0 }
            }
          }
        }
      })
    )

    return res.json({ success: true, data: accountsWithStats })
  } catch (error) {
    logger.error('❌ Failed to get Claude Console accounts:', error)
    return res
      .status(500)
      .json({ error: 'Failed to get Claude Console accounts', message: error.message })
  }
})

// 创建新的Claude Console账户
router.post('/claude-console-accounts', authenticateAdmin, async (req, res) => {
  try {
    const {
      name,
      description,
      apiUrl,
      apiKey,
      priority,
      supportedModels,
      userAgent,
      rateLimitDuration,
      proxy,
      accountType,
      groupId
    } = req.body

    if (!name || !apiUrl || !apiKey) {
      return res.status(400).json({ error: 'Name, API URL and API Key are required' })
    }

    // 验证priority的有效性（1-100）
    if (priority !== undefined && (priority < 1 || priority > 100)) {
      return res.status(400).json({ error: 'Priority must be between 1 and 100' })
    }

    // 验证accountType的有效性
    if (accountType && !['shared', 'dedicated', 'group'].includes(accountType)) {
      return res
        .status(400)
        .json({ error: 'Invalid account type. Must be "shared", "dedicated" or "group"' })
    }

    // 如果是分组类型，验证groupId
    if (accountType === 'group' && !groupId) {
      return res.status(400).json({ error: 'Group ID is required for group type accounts' })
    }

    const newAccount = await claudeConsoleAccountService.createAccount({
      name,
      description,
      apiUrl,
      apiKey,
      priority: priority || 50,
      supportedModels: supportedModels || [],
      userAgent,
      rateLimitDuration:
        rateLimitDuration !== undefined && rateLimitDuration !== null ? rateLimitDuration : 60,
      proxy,
      accountType: accountType || 'shared'
    })

    // 如果是分组类型，将账户添加到分组
    if (accountType === 'group' && groupId) {
      await accountGroupService.addAccountToGroup(newAccount.id, groupId, 'claude')
    }

    logger.success(`🎮 Admin created Claude Console account: ${name}`)
    return res.json({ success: true, data: newAccount })
  } catch (error) {
    logger.error('❌ Failed to create Claude Console account:', error)
    return res
      .status(500)
      .json({ error: 'Failed to create Claude Console account', message: error.message })
  }
})

// 更新Claude Console账户
router.put('/claude-console-accounts/:accountId', authenticateAdmin, async (req, res) => {
  try {
    const { accountId } = req.params
    const updates = req.body

    // 验证priority的有效性（1-100）
    if (updates.priority !== undefined && (updates.priority < 1 || updates.priority > 100)) {
      return res.status(400).json({ error: 'Priority must be between 1 and 100' })
    }

    // 验证accountType的有效性
    if (updates.accountType && !['shared', 'dedicated', 'group'].includes(updates.accountType)) {
      return res
        .status(400)
        .json({ error: 'Invalid account type. Must be "shared", "dedicated" or "group"' })
    }

    // 如果更新为分组类型，验证groupId
    if (updates.accountType === 'group' && !updates.groupId) {
      return res.status(400).json({ error: 'Group ID is required for group type accounts' })
    }

    // 获取账户当前信息以处理分组变更
    const currentAccount = await claudeConsoleAccountService.getAccount(accountId)
    if (!currentAccount) {
      return res.status(404).json({ error: 'Account not found' })
    }

    // 处理分组的变更
    if (updates.accountType !== undefined) {
      // 如果之前是分组类型，需要从原分组中移除
      if (currentAccount.accountType === 'group') {
        const oldGroup = await accountGroupService.getAccountGroup(accountId)
        if (oldGroup) {
          await accountGroupService.removeAccountFromGroup(accountId, oldGroup.id)
        }
      }
      // 如果新类型是分组，添加到新分组
      if (updates.accountType === 'group' && updates.groupId) {
        // Claude Console 账户在分组中被视为 'claude' 平台
        await accountGroupService.addAccountToGroup(accountId, updates.groupId, 'claude')
      }
    }

    await claudeConsoleAccountService.updateAccount(accountId, updates)

    logger.success(`📝 Admin updated Claude Console account: ${accountId}`)
    return res.json({ success: true, message: 'Claude Console account updated successfully' })
  } catch (error) {
    logger.error('❌ Failed to update Claude Console account:', error)
    return res
      .status(500)
      .json({ error: 'Failed to update Claude Console account', message: error.message })
  }
})

// 删除Claude Console账户
router.delete('/claude-console-accounts/:accountId', authenticateAdmin, async (req, res) => {
  try {
    const { accountId } = req.params

    // 获取账户信息以检查是否在分组中
    const account = await claudeConsoleAccountService.getAccount(accountId)
    if (account && account.accountType === 'group') {
      const group = await accountGroupService.getAccountGroup(accountId)
      if (group) {
        await accountGroupService.removeAccountFromGroup(accountId, group.id)
      }
    }

    await claudeConsoleAccountService.deleteAccount(accountId)

    logger.success(`🗑️ Admin deleted Claude Console account: ${accountId}`)
    return res.json({ success: true, message: 'Claude Console account deleted successfully' })
  } catch (error) {
    logger.error('❌ Failed to delete Claude Console account:', error)
    return res
      .status(500)
      .json({ error: 'Failed to delete Claude Console account', message: error.message })
  }
})

// 切换Claude Console账户状态
router.put('/claude-console-accounts/:accountId/toggle', authenticateAdmin, async (req, res) => {
  try {
    const { accountId } = req.params

    const account = await claudeConsoleAccountService.getAccount(accountId)
    if (!account) {
      return res.status(404).json({ error: 'Account not found' })
    }

    const newStatus = !account.isActive
    await claudeConsoleAccountService.updateAccount(accountId, { isActive: newStatus })

    logger.success(
      `🔄 Admin toggled Claude Console account status: ${accountId} -> ${newStatus ? 'active' : 'inactive'}`
    )
    return res.json({ success: true, isActive: newStatus })
  } catch (error) {
    logger.error('❌ Failed to toggle Claude Console account status:', error)
    return res
      .status(500)
      .json({ error: 'Failed to toggle account status', message: error.message })
  }
})

// 切换Claude Console账户调度状态
router.put(
  '/claude-console-accounts/:accountId/toggle-schedulable',
  authenticateAdmin,
  async (req, res) => {
    try {
      const { accountId } = req.params

      const account = await claudeConsoleAccountService.getAccount(accountId)
      if (!account) {
        return res.status(404).json({ error: 'Account not found' })
      }

      const newSchedulable = !account.schedulable
      await claudeConsoleAccountService.updateAccount(accountId, { schedulable: newSchedulable })

      // 如果账号被禁用，发送webhook通知
      if (!newSchedulable) {
        await webhookNotifier.sendAccountAnomalyNotification({
          accountId: account.id,
          accountName: account.name || 'Claude Console Account',
          platform: 'claude-console',
          status: 'disabled',
          errorCode: 'CLAUDE_CONSOLE_MANUALLY_DISABLED',
          reason: '账号已被管理员手动禁用调度',
          timestamp: new Date().toISOString()
        })
      }

      logger.success(
        `🔄 Admin toggled Claude Console account schedulable status: ${accountId} -> ${newSchedulable ? 'schedulable' : 'not schedulable'}`
      )
      return res.json({ success: true, schedulable: newSchedulable })
    } catch (error) {
      logger.error('❌ Failed to toggle Claude Console account schedulable status:', error)
      return res
        .status(500)
        .json({ error: 'Failed to toggle schedulable status', message: error.message })
    }
  }
)

// 获取Claude Console账户费用统计
router.get(
  '/claude-console-accounts/:accountId/cost-stats',
  authenticateAdmin,
  async (req, res) => {
    try {
      const { accountId } = req.params
      const { period } = req.query

      logger.debug(`📊 获取Claude Console账户费用统计: ${accountId}, period: ${period || 'all'}`)

      // 验证账户是否存在
      const account = await claudeConsoleAccountService.getAccount(accountId)
      if (!account) {
        return res.status(404).json({
          success: false,
          error: 'Account not found',
          message: '指定的账户不存在'
        })
      }

      // 获取费用统计
      const costStats = await claudeConsoleAccountService.getAccountCostStats(accountId, {
        period: period || 'all'
      })

      logger.success(
        `📊 成功获取Claude Console账户费用统计: ${accountId} - $${(costStats.totalCost || 0).toFixed(6)}`
      )

      return res.json({
        success: true,
        data: costStats
      })
    } catch (error) {
      logger.error(`❌ 获取Claude Console账户费用统计失败 (${req.params.accountId}):`, error)
      return res.status(500).json({
        success: false,
        error: 'Failed to get account cost stats',
        message: error.message
      })
    }
  }
)

// ☁️ Bedrock 账户管理

// 获取所有Bedrock账户
router.get('/bedrock-accounts', authenticateAdmin, async (req, res) => {
  try {
    const { platform, groupId } = req.query
    const result = await bedrockAccountService.getAllAccounts()
    if (!result.success) {
      return res
        .status(500)
        .json({ error: 'Failed to get Bedrock accounts', message: result.error })
    }

    let accounts = result.data

    // 根据查询参数进行筛选
    if (platform && platform !== 'all' && platform !== 'bedrock') {
      // 如果指定了其他平台，返回空数组
      accounts = []
    }

    // 如果指定了分组筛选
    if (groupId && groupId !== 'all') {
      if (groupId === 'ungrouped') {
        // 筛选未分组账户
        accounts = accounts.filter((account) => !account.groupInfo)
      } else {
        // 筛选特定分组的账户
        accounts = accounts.filter(
          (account) => account.groupInfo && account.groupInfo.id === groupId
        )
      }
    }

    // 为每个账户添加使用统计信息
    const accountsWithStats = await Promise.all(
      accounts.map(async (account) => {
        try {
          const usageStats = await database.getAccountUsageStats(account.id)
          return {
            ...account,
            usage: {
              daily: usageStats.daily,
              total: usageStats.total,
              averages: usageStats.averages
            }
          }
        } catch (statsError) {
          logger.warn(
            `⚠️ Failed to get usage stats for Bedrock account ${account.id}:`,
            statsError.message
          )
          return {
            ...account,
            usage: {
              daily: { tokens: 0, requests: 0, allTokens: 0 },
              total: { tokens: 0, requests: 0, allTokens: 0 },
              averages: { rpm: 0, tpm: 0 }
            }
          }
        }
      })
    )

    return res.json({ success: true, data: accountsWithStats })
  } catch (error) {
    logger.error('❌ Failed to get Bedrock accounts:', error)
    return res.status(500).json({ error: 'Failed to get Bedrock accounts', message: error.message })
  }
})

// 创建新的Bedrock账户
router.post('/bedrock-accounts', authenticateAdmin, async (req, res) => {
  try {
    const {
      name,
      description,
      region,
      awsCredentials,
      defaultModel,
      priority,
      accountType,
      credentialType
    } = req.body

    if (!name) {
      return res.status(400).json({ error: 'Name is required' })
    }

    // 验证priority的有效性（1-100）
    if (priority !== undefined && (priority < 1 || priority > 100)) {
      return res.status(400).json({ error: 'Priority must be between 1 and 100' })
    }

    // 验证accountType的有效性
    if (accountType && !['shared', 'dedicated'].includes(accountType)) {
      return res
        .status(400)
        .json({ error: 'Invalid account type. Must be "shared" or "dedicated"' })
    }

    // 验证credentialType的有效性
    if (credentialType && !['default', 'access_key', 'bearer_token'].includes(credentialType)) {
      return res.status(400).json({
        error: 'Invalid credential type. Must be "default", "access_key", or "bearer_token"'
      })
    }

    const result = await bedrockAccountService.createAccount({
      name,
      description: description || '',
      region: region || 'us-east-1',
      awsCredentials,
      defaultModel,
      priority: priority || 50,
      accountType: accountType || 'shared',
      credentialType: credentialType || 'default'
    })

    if (!result.success) {
      return res
        .status(500)
        .json({ error: 'Failed to create Bedrock account', message: result.error })
    }

    logger.success(`☁️ Admin created Bedrock account: ${name}`)
    return res.json({ success: true, data: result.data })
  } catch (error) {
    logger.error('❌ Failed to create Bedrock account:', error)
    return res
      .status(500)
      .json({ error: 'Failed to create Bedrock account', message: error.message })
  }
})

// 更新Bedrock账户
router.put('/bedrock-accounts/:accountId', authenticateAdmin, async (req, res) => {
  try {
    const { accountId } = req.params
    const updates = req.body

    // 验证priority的有效性（1-100）
    if (updates.priority !== undefined && (updates.priority < 1 || updates.priority > 100)) {
      return res.status(400).json({ error: 'Priority must be between 1 and 100' })
    }

    // 验证accountType的有效性
    if (updates.accountType && !['shared', 'dedicated'].includes(updates.accountType)) {
      return res
        .status(400)
        .json({ error: 'Invalid account type. Must be "shared" or "dedicated"' })
    }

    // 验证credentialType的有效性
    if (
      updates.credentialType &&
      !['default', 'access_key', 'bearer_token'].includes(updates.credentialType)
    ) {
      return res.status(400).json({
        error: 'Invalid credential type. Must be "default", "access_key", or "bearer_token"'
      })
    }

    const result = await bedrockAccountService.updateAccount(accountId, updates)

    if (!result.success) {
      return res
        .status(500)
        .json({ error: 'Failed to update Bedrock account', message: result.error })
    }

    logger.success(`📝 Admin updated Bedrock account: ${accountId}`)
    return res.json({ success: true, message: 'Bedrock account updated successfully' })
  } catch (error) {
    logger.error('❌ Failed to update Bedrock account:', error)
    return res
      .status(500)
      .json({ error: 'Failed to update Bedrock account', message: error.message })
  }
})

// 删除Bedrock账户
router.delete('/bedrock-accounts/:accountId', authenticateAdmin, async (req, res) => {
  try {
    const { accountId } = req.params

    const result = await bedrockAccountService.deleteAccount(accountId)

    if (!result.success) {
      return res
        .status(500)
        .json({ error: 'Failed to delete Bedrock account', message: result.error })
    }

    logger.success(`🗑️ Admin deleted Bedrock account: ${accountId}`)
    return res.json({ success: true, message: 'Bedrock account deleted successfully' })
  } catch (error) {
    logger.error('❌ Failed to delete Bedrock account:', error)
    return res
      .status(500)
      .json({ error: 'Failed to delete Bedrock account', message: error.message })
  }
})

// 切换Bedrock账户状态
router.put('/bedrock-accounts/:accountId/toggle', authenticateAdmin, async (req, res) => {
  try {
    const { accountId } = req.params

    const accountResult = await bedrockAccountService.getAccount(accountId)
    if (!accountResult.success) {
      return res.status(404).json({ error: 'Account not found' })
    }

    const newStatus = !accountResult.data.isActive
    const updateResult = await bedrockAccountService.updateAccount(accountId, {
      isActive: newStatus
    })

    if (!updateResult.success) {
      return res
        .status(500)
        .json({ error: 'Failed to toggle account status', message: updateResult.error })
    }

    logger.success(
      `🔄 Admin toggled Bedrock account status: ${accountId} -> ${newStatus ? 'active' : 'inactive'}`
    )
    return res.json({ success: true, isActive: newStatus })
  } catch (error) {
    logger.error('❌ Failed to toggle Bedrock account status:', error)
    return res
      .status(500)
      .json({ error: 'Failed to toggle account status', message: error.message })
  }
})

// 切换Bedrock账户调度状态
router.put(
  '/bedrock-accounts/:accountId/toggle-schedulable',
  authenticateAdmin,
  async (req, res) => {
    try {
      const { accountId } = req.params

      const accountResult = await bedrockAccountService.getAccount(accountId)
      if (!accountResult.success) {
        return res.status(404).json({ error: 'Account not found' })
      }

      const newSchedulable = !accountResult.data.schedulable
      const updateResult = await bedrockAccountService.updateAccount(accountId, {
        schedulable: newSchedulable
      })

      if (!updateResult.success) {
        return res
          .status(500)
          .json({ error: 'Failed to toggle schedulable status', message: updateResult.error })
      }

      // 如果账号被禁用，发送webhook通知
      if (!newSchedulable) {
        await webhookNotifier.sendAccountAnomalyNotification({
          accountId: accountResult.data.id,
          accountName: accountResult.data.name || 'Bedrock Account',
          platform: 'bedrock',
          status: 'disabled',
          errorCode: 'BEDROCK_MANUALLY_DISABLED',
          reason: '账号已被管理员手动禁用调度',
          timestamp: new Date().toISOString()
        })
      }

      logger.success(
        `🔄 Admin toggled Bedrock account schedulable status: ${accountId} -> ${newSchedulable ? 'schedulable' : 'not schedulable'}`
      )
      return res.json({ success: true, schedulable: newSchedulable })
    } catch (error) {
      logger.error('❌ Failed to toggle Bedrock account schedulable status:', error)
      return res
        .status(500)
        .json({ error: 'Failed to toggle schedulable status', message: error.message })
    }
  }
)

// 测试Bedrock账户连接
router.post('/bedrock-accounts/:accountId/test', authenticateAdmin, async (req, res) => {
  try {
    const { accountId } = req.params

    const result = await bedrockAccountService.testAccount(accountId)

    if (!result.success) {
      return res.status(500).json({ error: 'Account test failed', message: result.error })
    }

    logger.success(`🧪 Admin tested Bedrock account: ${accountId} - ${result.data.status}`)
    return res.json({ success: true, data: result.data })
  } catch (error) {
    logger.error('❌ Failed to test Bedrock account:', error)
    return res.status(500).json({ error: 'Failed to test Bedrock account', message: error.message })
  }
})

// 🤖 Gemini 账户管理

// 生成 Gemini OAuth 授权 URL
router.post('/gemini-accounts/generate-auth-url', authenticateAdmin, async (req, res) => {
  try {
    const { state, proxy } = req.body // 接收代理配置

    // 使用新的 codeassist.google.com 回调地址
    const redirectUri = 'https://codeassist.google.com/authcode'

    logger.info(`Generating Gemini OAuth URL with redirect_uri: ${redirectUri}`)

    const {
      authUrl,
      state: authState,
      codeVerifier,
      redirectUri: finalRedirectUri
    } = await geminiAccountService.generateAuthUrl(state, redirectUri)

    // 创建 OAuth 会话，包含 codeVerifier 和代理配置
    const sessionId = authState
    await database.setOAuthSession(sessionId, {
      state: authState,
      type: 'gemini',
      redirectUri: finalRedirectUri,
      codeVerifier, // 保存 PKCE code verifier
      proxy: proxy || null, // 保存代理配置
      createdAt: new Date().toISOString()
    })

    logger.info(`Generated Gemini OAuth URL with session: ${sessionId}`)
    return res.json({
      success: true,
      data: {
        authUrl,
        sessionId
      }
    })
  } catch (error) {
    logger.error('❌ Failed to generate Gemini auth URL:', error)
    return res.status(500).json({ error: 'Failed to generate auth URL', message: error.message })
  }
})

// 轮询 Gemini OAuth 授权状态
router.post('/gemini-accounts/poll-auth-status', authenticateAdmin, async (req, res) => {
  try {
    const { sessionId } = req.body

    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' })
    }

    const result = await geminiAccountService.pollAuthorizationStatus(sessionId)

    if (result.success) {
      logger.success(`✅ Gemini OAuth authorization successful for session: ${sessionId}`)
      return res.json({ success: true, data: { tokens: result.tokens } })
    } else {
      return res.json({ success: false, error: result.error })
    }
  } catch (error) {
    logger.error('❌ Failed to poll Gemini auth status:', error)
    return res.status(500).json({ error: 'Failed to poll auth status', message: error.message })
  }
})

// 交换 Gemini 授权码
router.post('/gemini-accounts/exchange-code', authenticateAdmin, async (req, res) => {
  try {
    const { code, sessionId, proxy: requestProxy } = req.body

    if (!code) {
      return res.status(400).json({ error: 'Authorization code is required' })
    }

    let redirectUri = 'https://codeassist.google.com/authcode'
    let codeVerifier = null
    let proxyConfig = null

    // 如果提供了 sessionId，从 OAuth 会话中获取信息
    if (sessionId) {
      const sessionData = await database.getOAuthSession(sessionId)
      if (sessionData) {
        const {
          redirectUri: sessionRedirectUri,
          codeVerifier: sessionCodeVerifier,
          proxy
        } = sessionData
        redirectUri = sessionRedirectUri || redirectUri
        codeVerifier = sessionCodeVerifier
        proxyConfig = proxy // 获取代理配置
        logger.info(
          `Using session redirect_uri: ${redirectUri}, has codeVerifier: ${!!codeVerifier}, has proxy from session: ${!!proxyConfig}`
        )
      }
    }

    // 如果请求体中直接提供了代理配置，优先使用它
    if (requestProxy) {
      proxyConfig = requestProxy
      logger.info(
        `Using proxy from request body: ${proxyConfig ? JSON.stringify(proxyConfig) : 'none'}`
      )
    }

    const tokens = await geminiAccountService.exchangeCodeForTokens(
      code,
      redirectUri,
      codeVerifier,
      proxyConfig // 传递代理配置
    )

    // 清理 OAuth 会话
    if (sessionId) {
      await database.deleteOAuthSession(sessionId)
    }

    logger.success('✅ Successfully exchanged Gemini authorization code')
    return res.json({ success: true, data: { tokens } })
  } catch (error) {
    logger.error('❌ Failed to exchange Gemini authorization code:', error)
    return res.status(500).json({ error: 'Failed to exchange code', message: error.message })
  }
})

// 获取所有 Gemini 账户
router.get('/gemini-accounts', authenticateAdmin, async (req, res) => {
  try {
    const { platform, groupId } = req.query
    let accounts = await geminiAccountService.getAllAccounts()

    // 根据查询参数进行筛选
    if (platform && platform !== 'all' && platform !== 'gemini') {
      // 如果指定了其他平台，返回空数组
      accounts = []
    }

    // 如果指定了分组筛选
    if (groupId && groupId !== 'all') {
      if (groupId === 'ungrouped') {
        // 筛选未分组账户
        accounts = accounts.filter((account) => !account.groupInfo)
      } else {
        // 筛选特定分组的账户
        accounts = accounts.filter(
          (account) => account.groupInfo && account.groupInfo.id === groupId
        )
      }
    }

    // 为每个账户添加使用统计信息（与Claude账户相同的逻辑）
    const accountsWithStats = await Promise.all(
      accounts.map(async (account) => {
        try {
          const usageStats = await database.getAccountUsageStats(account.id)
          return {
            ...account,
            usage: {
              daily: usageStats.daily,
              total: usageStats.total,
              averages: usageStats.averages
            }
          }
        } catch (statsError) {
          logger.warn(
            `⚠️ Failed to get usage stats for Gemini account ${account.id}:`,
            statsError.message
          )
          // 如果获取统计失败，返回空统计
          return {
            ...account,
            usage: {
              daily: { tokens: 0, requests: 0, allTokens: 0 },
              total: { tokens: 0, requests: 0, allTokens: 0 },
              averages: { rpm: 0, tpm: 0 }
            }
          }
        }
      })
    )

    return res.json({ success: true, data: accountsWithStats })
  } catch (error) {
    logger.error('❌ Failed to get Gemini accounts:', error)
    return res.status(500).json({ error: 'Failed to get accounts', message: error.message })
  }
})

// 创建新的 Gemini 账户
router.post('/gemini-accounts', authenticateAdmin, async (req, res) => {
  try {
    const accountData = req.body

    // 输入验证
    if (!accountData.name) {
      return res.status(400).json({ error: 'Account name is required' })
    }

    // 验证accountType的有效性
    if (
      accountData.accountType &&
      !['shared', 'dedicated', 'group'].includes(accountData.accountType)
    ) {
      return res
        .status(400)
        .json({ error: 'Invalid account type. Must be "shared", "dedicated" or "group"' })
    }

    // 如果是分组类型，验证groupId
    if (accountData.accountType === 'group' && !accountData.groupId) {
      return res.status(400).json({ error: 'Group ID is required for group type accounts' })
    }

    const newAccount = await geminiAccountService.createAccount(accountData)

    // 如果是分组类型，将账户添加到分组
    if (accountData.accountType === 'group' && accountData.groupId) {
      await accountGroupService.addAccountToGroup(newAccount.id, accountData.groupId, 'gemini')
    }

    logger.success(`🏢 Admin created new Gemini account: ${accountData.name}`)
    return res.json({ success: true, data: newAccount })
  } catch (error) {
    logger.error('❌ Failed to create Gemini account:', error)
    return res.status(500).json({ error: 'Failed to create account', message: error.message })
  }
})

// 更新 Gemini 账户
router.put('/gemini-accounts/:accountId', authenticateAdmin, async (req, res) => {
  try {
    const { accountId } = req.params
    const updates = req.body

    // 验证accountType的有效性
    if (updates.accountType && !['shared', 'dedicated', 'group'].includes(updates.accountType)) {
      return res
        .status(400)
        .json({ error: 'Invalid account type. Must be "shared", "dedicated" or "group"' })
    }

    // 如果更新为分组类型，验证groupId
    if (updates.accountType === 'group' && !updates.groupId) {
      return res.status(400).json({ error: 'Group ID is required for group type accounts' })
    }

    // 获取账户当前信息以处理分组变更
    const currentAccount = await geminiAccountService.getAccount(accountId)
    if (!currentAccount) {
      return res.status(404).json({ error: 'Account not found' })
    }

    // 处理分组的变更
    if (updates.accountType !== undefined) {
      // 如果之前是分组类型，需要从原分组中移除
      if (currentAccount.accountType === 'group') {
        const oldGroup = await accountGroupService.getAccountGroup(accountId)
        if (oldGroup) {
          await accountGroupService.removeAccountFromGroup(accountId, oldGroup.id)
        }
      }
      // 如果新类型是分组，添加到新分组
      if (updates.accountType === 'group' && updates.groupId) {
        await accountGroupService.addAccountToGroup(accountId, updates.groupId, 'gemini')
      }
    }

    const updatedAccount = await geminiAccountService.updateAccount(accountId, updates)

    logger.success(`📝 Admin updated Gemini account: ${accountId}`)
    return res.json({ success: true, data: updatedAccount })
  } catch (error) {
    logger.error('❌ Failed to update Gemini account:', error)
    return res.status(500).json({ error: 'Failed to update account', message: error.message })
  }
})

// 删除 Gemini 账户
router.delete('/gemini-accounts/:accountId', authenticateAdmin, async (req, res) => {
  try {
    const { accountId } = req.params

    // 获取账户信息以检查是否在分组中
    const account = await geminiAccountService.getAccount(accountId)
    if (account && account.accountType === 'group') {
      const group = await accountGroupService.getAccountGroup(accountId)
      if (group) {
        await accountGroupService.removeAccountFromGroup(accountId, group.id)
      }
    }

    await geminiAccountService.deleteAccount(accountId)

    logger.success(`🗑️ Admin deleted Gemini account: ${accountId}`)
    return res.json({ success: true, message: 'Gemini account deleted successfully' })
  } catch (error) {
    logger.error('❌ Failed to delete Gemini account:', error)
    return res.status(500).json({ error: 'Failed to delete account', message: error.message })
  }
})

// 刷新 Gemini 账户 token
router.post('/gemini-accounts/:accountId/refresh', authenticateAdmin, async (req, res) => {
  try {
    const { accountId } = req.params

    const result = await geminiAccountService.refreshAccountToken(accountId)

    logger.success(`🔄 Admin refreshed token for Gemini account: ${accountId}`)
    return res.json({ success: true, data: result })
  } catch (error) {
    logger.error('❌ Failed to refresh Gemini account token:', error)
    return res.status(500).json({ error: 'Failed to refresh token', message: error.message })
  }
})

// 切换 Gemini 账户调度状态
router.put(
  '/gemini-accounts/:accountId/toggle-schedulable',
  authenticateAdmin,
  async (req, res) => {
    try {
      const { accountId } = req.params

      const account = await geminiAccountService.getAccount(accountId)
      if (!account) {
        return res.status(404).json({ error: 'Account not found' })
      }

      // 现在 account.schedulable 已经是布尔值了，直接取反即可
      const newSchedulable = !account.schedulable

      await geminiAccountService.updateAccount(accountId, { schedulable: String(newSchedulable) })

      // 验证更新是否成功，重新获取账户信息
      const updatedAccount = await geminiAccountService.getAccount(accountId)
      const actualSchedulable = updatedAccount ? updatedAccount.schedulable : newSchedulable

      // 如果账号被禁用，发送webhook通知
      if (!actualSchedulable) {
        await webhookNotifier.sendAccountAnomalyNotification({
          accountId: account.id,
          accountName: account.accountName || 'Gemini Account',
          platform: 'gemini',
          status: 'disabled',
          errorCode: 'GEMINI_MANUALLY_DISABLED',
          reason: '账号已被管理员手动禁用调度',
          timestamp: new Date().toISOString()
        })
      }

      logger.success(
        `🔄 Admin toggled Gemini account schedulable status: ${accountId} -> ${actualSchedulable ? 'schedulable' : 'not schedulable'}`
      )

      // 返回实际的数据库值，确保前端状态与后端一致
      return res.json({ success: true, schedulable: actualSchedulable })
    } catch (error) {
      logger.error('❌ Failed to toggle Gemini account schedulable status:', error)
      return res
        .status(500)
        .json({ error: 'Failed to toggle schedulable status', message: error.message })
    }
  }
)

// 获取Gemini账户费用统计
router.get('/gemini-accounts/:accountId/cost-stats', authenticateAdmin, async (req, res) => {
  try {
    const { accountId } = req.params
    const { period } = req.query

    logger.debug(`📊 获取Gemini账户费用统计: ${accountId}, period: ${period || 'all'}`)

    // 验证账户是否存在
    const account = await geminiAccountService.getAccount(accountId)
    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Account not found',
        message: '指定的账户不存在'
      })
    }

    // 获取费用统计
    const costStats = await geminiAccountService.getAccountCostStats(accountId, {
      period: period || 'all'
    })

    logger.success(
      `📊 成功获取Gemini账户费用统计: ${accountId} - $${(costStats.totalCost || 0).toFixed(6)}`
    )

    return res.json({
      success: true,
      data: costStats
    })
  } catch (error) {
    logger.error(`❌ 获取Gemini账户费用统计失败 (${req.params.accountId}):`, error)
    return res.status(500).json({
      success: false,
      error: 'Failed to get account cost stats',
      message: error.message
    })
  }
})

// 📊 账户使用统计

// 获取所有账户的使用统计
router.get('/accounts/usage-stats', authenticateAdmin, async (req, res) => {
  try {
    const accountsStats = await database.getAllAccountsUsageStats()

    return res.json({
      success: true,
      data: accountsStats,
      summary: {
        totalAccounts: accountsStats.length,
        activeToday: accountsStats.filter((account) => account.daily.requests > 0).length,
        totalDailyTokens: accountsStats.reduce(
          (sum, account) => sum + (account.daily.allTokens || 0),
          0
        ),
        totalDailyRequests: accountsStats.reduce(
          (sum, account) => sum + (account.daily.requests || 0),
          0
        )
      },
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    logger.error('❌ Failed to get accounts usage stats:', error)
    return res.status(500).json({
      success: false,
      error: 'Failed to get accounts usage stats',
      message: error.message
    })
  }
})

// 获取单个账户的使用统计
router.get('/accounts/:accountId/usage-stats', authenticateAdmin, async (req, res) => {
  try {
    const { accountId } = req.params
    const accountStats = await database.getAccountUsageStats(accountId)

    // 获取账户基本信息
    const accountData = await claudeAccountService.getAccount(accountId)
    if (!accountData) {
      return res.status(404).json({
        success: false,
        error: 'Account not found'
      })
    }

    return res.json({
      success: true,
      data: {
        ...accountStats,
        accountInfo: {
          name: accountData.name,
          email: accountData.email,
          status: accountData.status,
          isActive: accountData.isActive,
          createdAt: accountData.createdAt
        }
      },
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    logger.error('❌ Failed to get account usage stats:', error)
    return res.status(500).json({
      success: false,
      error: 'Failed to get account usage stats',
      message: error.message
    })
  }
})

// 📊 系统统计

// 获取系统概览
router.get('/dashboard', authenticateAdmin, async (req, res) => {
  try {
    const [
      ,
      apiKeys,
      claudeAccounts,
      claudeConsoleAccounts,
      geminiAccounts,
      bedrockAccountsResult,
      openaiAccounts,
      todayStats,
      systemAverages,
      realtimeMetrics
    ] = await Promise.all([
      database.getSystemStats(),
      apiKeyService.getAllApiKeys(),
      claudeAccountService.getAllAccounts(),
      claudeConsoleAccountService.getAllAccounts(),
      geminiAccountService.getAllAccounts(),
      bedrockAccountService.getAllAccounts(),
      database.getAllOpenAIAccounts(),
      database.getTodayStats(),
      database.getSystemAverages(),
      database.getRealtimeSystemMetrics()
    ])

    // 处理Bedrock账户数据
    const bedrockAccounts = bedrockAccountsResult.success ? bedrockAccountsResult.data : []

    // 计算使用统计（统一使用allTokens）
    const totalTokensUsed = apiKeys.reduce(
      (sum, key) => sum + (key.usage?.total?.allTokens || 0),
      0
    )
    const totalRequestsUsed = apiKeys.reduce(
      (sum, key) => sum + (key.usage?.total?.requests || 0),
      0
    )
    const totalInputTokensUsed = apiKeys.reduce(
      (sum, key) => sum + (key.usage?.total?.inputTokens || 0),
      0
    )
    const totalOutputTokensUsed = apiKeys.reduce(
      (sum, key) => sum + (key.usage?.total?.outputTokens || 0),
      0
    )
    const totalCacheCreateTokensUsed = apiKeys.reduce(
      (sum, key) => sum + (key.usage?.total?.cacheCreateTokens || 0),
      0
    )
    const totalCacheReadTokensUsed = apiKeys.reduce(
      (sum, key) => sum + (key.usage?.total?.cacheReadTokens || 0),
      0
    )
    const totalAllTokensUsed = apiKeys.reduce(
      (sum, key) => sum + (key.usage?.total?.allTokens || 0),
      0
    )

    const activeApiKeys = apiKeys.filter((key) => key.isActive).length

    // Claude账户统计 - 根据账户管理页面的判断逻辑
    const normalClaudeAccounts = claudeAccounts.filter(
      (acc) =>
        acc.isActive &&
        acc.status !== 'blocked' &&
        acc.status !== 'unauthorized' &&
        acc.schedulable !== false &&
        !(acc.rateLimitStatus && acc.rateLimitStatus.isRateLimited)
    ).length
    const abnormalClaudeAccounts = claudeAccounts.filter(
      (acc) => !acc.isActive || acc.status === 'blocked' || acc.status === 'unauthorized'
    ).length
    const pausedClaudeAccounts = claudeAccounts.filter(
      (acc) =>
        acc.schedulable === false &&
        acc.isActive &&
        acc.status !== 'blocked' &&
        acc.status !== 'unauthorized'
    ).length
    const rateLimitedClaudeAccounts = claudeAccounts.filter(
      (acc) => acc.rateLimitStatus && acc.rateLimitStatus.isRateLimited
    ).length

    // Claude Console账户统计
    const normalClaudeConsoleAccounts = claudeConsoleAccounts.filter(
      (acc) =>
        acc.isActive &&
        acc.status !== 'blocked' &&
        acc.status !== 'unauthorized' &&
        acc.schedulable !== false &&
        !(acc.rateLimitStatus && acc.rateLimitStatus.isRateLimited)
    ).length
    const abnormalClaudeConsoleAccounts = claudeConsoleAccounts.filter(
      (acc) => !acc.isActive || acc.status === 'blocked' || acc.status === 'unauthorized'
    ).length
    const pausedClaudeConsoleAccounts = claudeConsoleAccounts.filter(
      (acc) =>
        acc.schedulable === false &&
        acc.isActive &&
        acc.status !== 'blocked' &&
        acc.status !== 'unauthorized'
    ).length
    const rateLimitedClaudeConsoleAccounts = claudeConsoleAccounts.filter(
      (acc) => acc.rateLimitStatus && acc.rateLimitStatus.isRateLimited
    ).length

    // Gemini账户统计
    const normalGeminiAccounts = geminiAccounts.filter(
      (acc) =>
        acc.isActive &&
        acc.status !== 'blocked' &&
        acc.status !== 'unauthorized' &&
        acc.schedulable !== false &&
        !(
          acc.rateLimitStatus === 'limited' ||
          (acc.rateLimitStatus && acc.rateLimitStatus.isRateLimited)
        )
    ).length
    const abnormalGeminiAccounts = geminiAccounts.filter(
      (acc) => !acc.isActive || acc.status === 'blocked' || acc.status === 'unauthorized'
    ).length
    const pausedGeminiAccounts = geminiAccounts.filter(
      (acc) =>
        acc.schedulable === false &&
        acc.isActive &&
        acc.status !== 'blocked' &&
        acc.status !== 'unauthorized'
    ).length
    const rateLimitedGeminiAccounts = geminiAccounts.filter(
      (acc) =>
        acc.rateLimitStatus === 'limited' ||
        (acc.rateLimitStatus && acc.rateLimitStatus.isRateLimited)
    ).length

    // Bedrock账户统计
    const normalBedrockAccounts = bedrockAccounts.filter(
      (acc) =>
        acc.isActive &&
        acc.status !== 'blocked' &&
        acc.status !== 'unauthorized' &&
        acc.schedulable !== false &&
        !(acc.rateLimitStatus && acc.rateLimitStatus.isRateLimited)
    ).length
    const abnormalBedrockAccounts = bedrockAccounts.filter(
      (acc) => !acc.isActive || acc.status === 'blocked' || acc.status === 'unauthorized'
    ).length
    const pausedBedrockAccounts = bedrockAccounts.filter(
      (acc) =>
        acc.schedulable === false &&
        acc.isActive &&
        acc.status !== 'blocked' &&
        acc.status !== 'unauthorized'
    ).length
    const rateLimitedBedrockAccounts = bedrockAccounts.filter(
      (acc) => acc.rateLimitStatus && acc.rateLimitStatus.isRateLimited
    ).length

    // OpenAI账户统计
    // 注意：OpenAI账户的isActive和schedulable是字符串类型，默认值为'true'
    const normalOpenAIAccounts = openaiAccounts.filter(
      (acc) =>
        (acc.isActive === 'true' ||
          acc.isActive === true ||
          (!acc.isActive && acc.isActive !== 'false' && acc.isActive !== false)) &&
        acc.status !== 'blocked' &&
        acc.status !== 'unauthorized' &&
        acc.schedulable !== 'false' &&
        acc.schedulable !== false && // 包括'true'、true和undefined
        !(acc.rateLimitStatus && acc.rateLimitStatus.isRateLimited)
    ).length
    const abnormalOpenAIAccounts = openaiAccounts.filter(
      (acc) =>
        acc.isActive === 'false' ||
        acc.isActive === false ||
        acc.status === 'blocked' ||
        acc.status === 'unauthorized'
    ).length
    const pausedOpenAIAccounts = openaiAccounts.filter(
      (acc) =>
        (acc.schedulable === 'false' || acc.schedulable === false) &&
        (acc.isActive === 'true' ||
          acc.isActive === true ||
          (!acc.isActive && acc.isActive !== 'false' && acc.isActive !== false)) &&
        acc.status !== 'blocked' &&
        acc.status !== 'unauthorized'
    ).length
    const rateLimitedOpenAIAccounts = openaiAccounts.filter(
      (acc) => acc.rateLimitStatus && acc.rateLimitStatus.isRateLimited
    ).length

    const dashboard = {
      overview: {
        totalApiKeys: apiKeys.length,
        activeApiKeys,
        // 总账户统计（所有平台）
        totalAccounts:
          claudeAccounts.length +
          claudeConsoleAccounts.length +
          geminiAccounts.length +
          bedrockAccounts.length +
          openaiAccounts.length,
        normalAccounts:
          normalClaudeAccounts +
          normalClaudeConsoleAccounts +
          normalGeminiAccounts +
          normalBedrockAccounts +
          normalOpenAIAccounts,
        abnormalAccounts:
          abnormalClaudeAccounts +
          abnormalClaudeConsoleAccounts +
          abnormalGeminiAccounts +
          abnormalBedrockAccounts +
          abnormalOpenAIAccounts,
        pausedAccounts:
          pausedClaudeAccounts +
          pausedClaudeConsoleAccounts +
          pausedGeminiAccounts +
          pausedBedrockAccounts +
          pausedOpenAIAccounts,
        rateLimitedAccounts:
          rateLimitedClaudeAccounts +
          rateLimitedClaudeConsoleAccounts +
          rateLimitedGeminiAccounts +
          rateLimitedBedrockAccounts +
          rateLimitedOpenAIAccounts,
        // 各平台详细统计
        accountsByPlatform: {
          claude: {
            total: claudeAccounts.length,
            normal: normalClaudeAccounts,
            abnormal: abnormalClaudeAccounts,
            paused: pausedClaudeAccounts,
            rateLimited: rateLimitedClaudeAccounts
          },
          'claude-console': {
            total: claudeConsoleAccounts.length,
            normal: normalClaudeConsoleAccounts,
            abnormal: abnormalClaudeConsoleAccounts,
            paused: pausedClaudeConsoleAccounts,
            rateLimited: rateLimitedClaudeConsoleAccounts
          },
          gemini: {
            total: geminiAccounts.length,
            normal: normalGeminiAccounts,
            abnormal: abnormalGeminiAccounts,
            paused: pausedGeminiAccounts,
            rateLimited: rateLimitedGeminiAccounts
          },
          bedrock: {
            total: bedrockAccounts.length,
            normal: normalBedrockAccounts,
            abnormal: abnormalBedrockAccounts,
            paused: pausedBedrockAccounts,
            rateLimited: rateLimitedBedrockAccounts
          },
          openai: {
            total: openaiAccounts.length,
            normal: normalOpenAIAccounts,
            abnormal: abnormalOpenAIAccounts,
            paused: pausedOpenAIAccounts,
            rateLimited: rateLimitedOpenAIAccounts
          }
        },
        // 保留旧字段以兼容
        activeAccounts:
          normalClaudeAccounts +
          normalClaudeConsoleAccounts +
          normalGeminiAccounts +
          normalBedrockAccounts +
          normalOpenAIAccounts,
        totalClaudeAccounts: claudeAccounts.length + claudeConsoleAccounts.length,
        activeClaudeAccounts: normalClaudeAccounts + normalClaudeConsoleAccounts,
        rateLimitedClaudeAccounts: rateLimitedClaudeAccounts + rateLimitedClaudeConsoleAccounts,
        totalGeminiAccounts: geminiAccounts.length,
        activeGeminiAccounts: normalGeminiAccounts,
        rateLimitedGeminiAccounts,
        totalTokensUsed,
        totalRequestsUsed,
        totalInputTokensUsed,
        totalOutputTokensUsed,
        totalCacheCreateTokensUsed,
        totalCacheReadTokensUsed,
        totalAllTokensUsed
      },
      recentActivity: {
        apiKeysCreatedToday: todayStats.apiKeysCreatedToday,
        requestsToday: todayStats.requestsToday,
        tokensToday: todayStats.tokensToday,
        inputTokensToday: todayStats.inputTokensToday,
        outputTokensToday: todayStats.outputTokensToday,
        cacheCreateTokensToday: todayStats.cacheCreateTokensToday || 0,
        cacheReadTokensToday: todayStats.cacheReadTokensToday || 0
      },
      systemAverages: {
        rpm: systemAverages.systemRPM,
        tpm: systemAverages.systemTPM
      },
      realtimeMetrics: {
        rpm: realtimeMetrics.realtimeRPM,
        tpm: realtimeMetrics.realtimeTPM,
        windowMinutes: realtimeMetrics.windowMinutes,
        isHistorical: realtimeMetrics.windowMinutes === 0 // 标识是否使用了历史数据
      },
      systemHealth: {
        databaseConnected: await database
          .getDatabase()
          .then((instance) => instance.isConnected)
          .catch(() => false),
        claudeAccountsHealthy: normalClaudeAccounts + normalClaudeConsoleAccounts > 0,
        geminiAccountsHealthy: normalGeminiAccounts > 0,
        uptime: process.uptime()
      },
      systemTimezone: config.system.timezoneOffset || 8
    }

    return res.json({ success: true, data: dashboard })
  } catch (error) {
    logger.error('❌ Failed to get dashboard data:', error)
    return res.status(500).json({ error: 'Failed to get dashboard data', message: error.message })
  }
})

// 获取使用统计
router.get('/usage-stats', authenticateAdmin, async (req, res) => {
  try {
    const { period = 'daily' } = req.query // daily, monthly

    // 获取基础API Key统计
    const apiKeys = await apiKeyService.getAllApiKeys()

    const stats = apiKeys.map((key) => ({
      keyId: key.id,
      keyName: key.name,
      usage: key.usage
    }))

    return res.json({ success: true, data: { period, stats } })
  } catch (error) {
    logger.error('❌ Failed to get usage stats:', error)
    return res.status(500).json({ error: 'Failed to get usage stats', message: error.message })
  }
})

// 获取按模型的使用统计和费用
router.get('/model-stats', authenticateAdmin, async (req, res) => {
  try {
    const { period = 'daily', startDate, endDate } = req.query // daily, monthly, 支持自定义时间范围
    const today = database.getDateStringInTimezone()
    const tzDate = database.getDateInTimezone()
    const currentMonth = `${tzDate.getUTCFullYear()}-${String(tzDate.getUTCMonth() + 1).padStart(2, '0')}`

    logger.info(
      `📊 Getting global model stats, period: ${period}, startDate: ${startDate}, endDate: ${endDate}, today: ${today}, currentMonth: ${currentMonth}`
    )

    const client = database.getClient()

    // 获取所有模型的统计数据
    let searchPatterns = []

    if (startDate && endDate) {
      // 自定义日期范围，生成多个日期的搜索模式
      const start = new Date(startDate)
      const end = new Date(endDate)

      // 确保日期范围有效
      if (start > end) {
        return res.status(400).json({ error: 'Start date must be before or equal to end date' })
      }

      // 限制最大范围为31天
      const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1
      if (daysDiff > 31) {
        return res.status(400).json({ error: 'Date range cannot exceed 31 days' })
      }

      // 生成日期范围内所有日期的搜索模式
      const currentDate = new Date(start)
      while (currentDate <= end) {
        const dateStr = database.getDateStringInTimezone(currentDate)
        searchPatterns.push(`usage:model:daily:*:${dateStr}`)
        currentDate.setDate(currentDate.getDate() + 1)
      }

      logger.info(`📊 Generated ${searchPatterns.length} search patterns for date range`)
    } else {
      // 使用默认的period
      const pattern =
        period === 'daily'
          ? `usage:model:daily:*:${today}`
          : `usage:model:monthly:*:${currentMonth}`
      searchPatterns = [pattern]
    }

    logger.info('📊 Searching patterns:', searchPatterns)

    // 获取所有匹配的keys
    const allKeys = []
    for (const pattern of searchPatterns) {
      const keys = await client.keys(pattern)
      allKeys.push(...keys)
    }

    logger.info(`📊 Found ${allKeys.length} matching keys in total`)

    // 模型名标准化函数（与database.js保持一致）
    const normalizeModelName = (model) => {
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
      return model.replace(/-v\d+:\d+$|:latest$|\[\d+[a-zA-Z]*\]$/, '')
    }

    // 聚合相同模型的数据
    const modelStatsMap = new Map()

    for (const key of allKeys) {
      const match = key.match(/usage:model:daily:(.+):\d{4}-\d{2}-\d{2}$/)

      if (!match) {
        logger.warn(`📊 Pattern mismatch for key: ${key}`)
        continue
      }

      const rawModel = match[1]
      const normalizedModel = normalizeModelName(rawModel)
      const data = await client.hgetall(key)

      if (data && Object.keys(data).length > 0) {
        const stats = modelStatsMap.get(normalizedModel) || {
          requests: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheCreateTokens: 0,
          cacheReadTokens: 0,
          allTokens: 0
        }

        stats.requests += parseInt(data.requests) || 0
        stats.inputTokens += parseInt(data.inputTokens) || 0
        stats.outputTokens += parseInt(data.outputTokens) || 0
        stats.cacheCreateTokens += parseInt(data.cacheCreateTokens) || 0
        stats.cacheReadTokens += parseInt(data.cacheReadTokens) || 0
        stats.allTokens += parseInt(data.allTokens) || 0

        modelStatsMap.set(normalizedModel, stats)
      }
    }

    // 转换为数组并计算费用
    const modelStats = []

    for (const [model, stats] of modelStatsMap) {
      const usage = {
        input_tokens: stats.inputTokens,
        output_tokens: stats.outputTokens,
        cache_creation_input_tokens: stats.cacheCreateTokens,
        cache_read_input_tokens: stats.cacheReadTokens
      }

      // 计算费用
      const costData = CostCalculator.calculateCost(usage, model)

      modelStats.push({
        model,
        period: startDate && endDate ? 'custom' : period,
        requests: stats.requests,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheCreateTokens: usage.cache_creation_input_tokens,
        cacheReadTokens: usage.cache_read_input_tokens,
        allTokens: stats.allTokens,
        usage: {
          requests: stats.requests,
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          cacheCreateTokens: usage.cache_creation_input_tokens,
          cacheReadTokens: usage.cache_read_input_tokens,
          totalTokens:
            usage.input_tokens +
            usage.output_tokens +
            usage.cache_creation_input_tokens +
            usage.cache_read_input_tokens
        },
        costs: costData.costs,
        formatted: costData.formatted,
        pricing: costData.pricing
      })
    }

    // 按总费用排序
    modelStats.sort((a, b) => b.costs.total - a.costs.total)

    logger.info(
      `📊 Returning ${modelStats.length} global model stats for period ${period}:`,
      modelStats
    )

    return res.json({ success: true, data: modelStats })
  } catch (error) {
    logger.error('❌ Failed to get model stats:', error)
    return res.status(500).json({ error: 'Failed to get model stats', message: error.message })
  }
})

// 🔧 系统管理

// 清理过期数据
router.post('/cleanup', authenticateAdmin, async (req, res) => {
  try {
    const [expiredKeys, errorAccounts] = await Promise.all([
      apiKeyService.cleanupExpiredKeys(),
      claudeAccountService.cleanupErrorAccounts()
    ])

    await database.cleanup()

    logger.success(
      `🧹 Admin triggered cleanup: ${expiredKeys} expired keys, ${errorAccounts} error accounts`
    )

    return res.json({
      success: true,
      message: 'Cleanup completed',
      data: {
        expiredKeysRemoved: expiredKeys,
        errorAccountsReset: errorAccounts
      }
    })
  } catch (error) {
    logger.error('❌ Cleanup failed:', error)
    return res.status(500).json({ error: 'Cleanup failed', message: error.message })
  }
})

// 获取使用趋势数据
router.get('/usage-trend', authenticateAdmin, async (req, res) => {
  try {
    const { days = 7, granularity = 'day', startDate, endDate } = req.query
    const client = database.getClient()

    const trendData = []

    if (granularity === 'hour') {
      // 小时粒度统计
      let startTime, endTime

      if (startDate && endDate) {
        // 使用自定义时间范围
        startTime = new Date(startDate)
        endTime = new Date(endDate)

        // 调试日志
        logger.info('📊 Usage trend hour granularity - received times:')
        logger.info(`  startDate (raw): ${startDate}`)
        logger.info(`  endDate (raw): ${endDate}`)
        logger.info(`  startTime (parsed): ${startTime.toISOString()}`)
        logger.info(`  endTime (parsed): ${endTime.toISOString()}`)
        logger.info(`  System timezone offset: ${config.system.timezoneOffset || 8}`)
      } else {
        // 默认最近24小时
        endTime = new Date()
        startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000)
      }

      // 确保时间范围不超过24小时
      const timeDiff = endTime - startTime
      if (timeDiff > 24 * 60 * 60 * 1000) {
        return res.status(400).json({
          error: '小时粒度查询时间范围不能超过24小时'
        })
      }

      // 按小时遍历
      const currentHour = new Date(startTime)
      currentHour.setMinutes(0, 0, 0)

      while (currentHour <= endTime) {
        // 注意：前端发送的时间已经是UTC时间，不需要再次转换
        // 直接从currentHour生成对应系统时区的日期和小时
        const tzCurrentHour = database.getDateInTimezone(currentHour)
        const dateStr = database.getDateStringInTimezone(currentHour)
        const hour = String(tzCurrentHour.getUTCHours()).padStart(2, '0')
        const hourKey = `${dateStr}:${hour}`

        // 获取当前小时的模型统计数据
        const modelPattern = `usage:model:hourly:*:${hourKey}`
        const modelKeys = await client.keys(modelPattern)

        let hourInputTokens = 0
        let hourOutputTokens = 0
        let hourRequests = 0
        let hourCacheCreateTokens = 0
        let hourCacheReadTokens = 0
        let hourCost = 0

        for (const modelKey of modelKeys) {
          const modelMatch = modelKey.match(/usage:model:hourly:(.+):\d{4}-\d{2}-\d{2}:\d{2}$/)
          if (!modelMatch) {
            continue
          }

          const model = modelMatch[1]
          const data = await client.hgetall(modelKey)

          if (data && Object.keys(data).length > 0) {
            const modelInputTokens = parseInt(data.inputTokens) || 0
            const modelOutputTokens = parseInt(data.outputTokens) || 0
            const modelCacheCreateTokens = parseInt(data.cacheCreateTokens) || 0
            const modelCacheReadTokens = parseInt(data.cacheReadTokens) || 0
            const modelRequests = parseInt(data.requests) || 0

            hourInputTokens += modelInputTokens
            hourOutputTokens += modelOutputTokens
            hourCacheCreateTokens += modelCacheCreateTokens
            hourCacheReadTokens += modelCacheReadTokens
            hourRequests += modelRequests

            const modelUsage = {
              input_tokens: modelInputTokens,
              output_tokens: modelOutputTokens,
              cache_creation_input_tokens: modelCacheCreateTokens,
              cache_read_input_tokens: modelCacheReadTokens
            }
            const modelCostResult = CostCalculator.calculateCost(modelUsage, model)
            hourCost += modelCostResult.costs.total
          }
        }

        // 如果没有模型级别的数据，尝试API Key级别的数据
        if (modelKeys.length === 0) {
          const pattern = `usage:hourly:*:${hourKey}`
          const keys = await client.keys(pattern)

          for (const key of keys) {
            const data = await client.hgetall(key)
            if (data) {
              hourInputTokens += parseInt(data.inputTokens) || 0
              hourOutputTokens += parseInt(data.outputTokens) || 0
              hourRequests += parseInt(data.requests) || 0
              hourCacheCreateTokens += parseInt(data.cacheCreateTokens) || 0
              hourCacheReadTokens += parseInt(data.cacheReadTokens) || 0
            }
          }

          const usage = {
            input_tokens: hourInputTokens,
            output_tokens: hourOutputTokens,
            cache_creation_input_tokens: hourCacheCreateTokens,
            cache_read_input_tokens: hourCacheReadTokens
          }
          const costResult = CostCalculator.calculateCost(usage, 'unknown')
          hourCost = costResult.costs.total
        }

        // 格式化时间标签 - 使用系统时区的显示
        const tzDateForLabel = database.getDateInTimezone(currentHour)
        const month = String(tzDateForLabel.getUTCMonth() + 1).padStart(2, '0')
        const day = String(tzDateForLabel.getUTCDate()).padStart(2, '0')
        const hourStr = String(tzDateForLabel.getUTCHours()).padStart(2, '0')

        trendData.push({
          // 对于小时粒度，只返回hour字段，不返回date字段
          hour: currentHour.toISOString(), // 保留原始ISO时间用于排序
          label: `${month}/${day} ${hourStr}:00`, // 添加格式化的标签
          inputTokens: hourInputTokens,
          outputTokens: hourOutputTokens,
          requests: hourRequests,
          cacheCreateTokens: hourCacheCreateTokens,
          cacheReadTokens: hourCacheReadTokens,
          totalTokens:
            hourInputTokens + hourOutputTokens + hourCacheCreateTokens + hourCacheReadTokens,
          cost: hourCost
        })

        // 移到下一个小时
        currentHour.setHours(currentHour.getHours() + 1)
      }
    } else {
      // 天粒度统计（保持原有逻辑）
      const daysCount = parseInt(days) || 7
      const today = new Date()

      // 获取过去N天的数据
      for (let i = 0; i < daysCount; i++) {
        const date = new Date(today)
        date.setDate(date.getDate() - i)
        const dateStr = database.getDateStringInTimezone(date)

        // 汇总当天所有API Key的使用数据
        const pattern = `usage:daily:*:${dateStr}`
        const keys = await client.keys(pattern)

        let dayInputTokens = 0
        let dayOutputTokens = 0
        let dayRequests = 0
        let dayCacheCreateTokens = 0
        let dayCacheReadTokens = 0
        let dayCost = 0

        // 按模型统计使用量
        // const modelUsageMap = new Map();

        // 获取当天所有模型的使用数据
        const modelPattern = `usage:model:daily:*:${dateStr}`
        const modelKeys = await client.keys(modelPattern)

        for (const modelKey of modelKeys) {
          // 解析模型名称
          const modelMatch = modelKey.match(/usage:model:daily:(.+):\d{4}-\d{2}-\d{2}$/)
          if (!modelMatch) {
            continue
          }

          const model = modelMatch[1]
          const data = await client.hgetall(modelKey)

          if (data && Object.keys(data).length > 0) {
            const modelInputTokens = parseInt(data.inputTokens) || 0
            const modelOutputTokens = parseInt(data.outputTokens) || 0
            const modelCacheCreateTokens = parseInt(data.cacheCreateTokens) || 0
            const modelCacheReadTokens = parseInt(data.cacheReadTokens) || 0
            const modelRequests = parseInt(data.requests) || 0

            // 累加总数
            dayInputTokens += modelInputTokens
            dayOutputTokens += modelOutputTokens
            dayCacheCreateTokens += modelCacheCreateTokens
            dayCacheReadTokens += modelCacheReadTokens
            dayRequests += modelRequests

            // 按模型计算费用
            const modelUsage = {
              input_tokens: modelInputTokens,
              output_tokens: modelOutputTokens,
              cache_creation_input_tokens: modelCacheCreateTokens,
              cache_read_input_tokens: modelCacheReadTokens
            }
            const modelCostResult = CostCalculator.calculateCost(modelUsage, model)
            dayCost += modelCostResult.costs.total
          }
        }

        // 如果没有模型级别的数据，回退到原始方法
        if (modelKeys.length === 0 && keys.length > 0) {
          for (const key of keys) {
            const data = await client.hgetall(key)
            if (data) {
              dayInputTokens += parseInt(data.inputTokens) || 0
              dayOutputTokens += parseInt(data.outputTokens) || 0
              dayRequests += parseInt(data.requests) || 0
              dayCacheCreateTokens += parseInt(data.cacheCreateTokens) || 0
              dayCacheReadTokens += parseInt(data.cacheReadTokens) || 0
            }
          }

          // 使用默认模型价格计算
          const usage = {
            input_tokens: dayInputTokens,
            output_tokens: dayOutputTokens,
            cache_creation_input_tokens: dayCacheCreateTokens,
            cache_read_input_tokens: dayCacheReadTokens
          }
          const costResult = CostCalculator.calculateCost(usage, 'unknown')
          dayCost = costResult.costs.total
        }

        trendData.push({
          date: dateStr,
          inputTokens: dayInputTokens,
          outputTokens: dayOutputTokens,
          requests: dayRequests,
          cacheCreateTokens: dayCacheCreateTokens,
          cacheReadTokens: dayCacheReadTokens,
          totalTokens: dayInputTokens + dayOutputTokens + dayCacheCreateTokens + dayCacheReadTokens,
          cost: dayCost,
          formattedCost: CostCalculator.formatCost(dayCost)
        })
      }
    }

    // 按日期正序排列
    if (granularity === 'hour') {
      trendData.sort((a, b) => new Date(a.hour) - new Date(b.hour))
    } else {
      trendData.sort((a, b) => new Date(a.date) - new Date(b.date))
    }

    return res.json({ success: true, data: trendData, granularity })
  } catch (error) {
    logger.error('❌ Failed to get usage trend:', error)
    return res.status(500).json({ error: 'Failed to get usage trend', message: error.message })
  }
})

// 获取单个API Key的模型统计
router.get('/api-keys/:keyId/model-stats', authenticateAdmin, async (req, res) => {
  try {
    const { keyId } = req.params
    const { period = 'monthly', startDate, endDate } = req.query

    logger.info(
      `📊 Getting model stats for API key: ${keyId}, period: ${period}, startDate: ${startDate}, endDate: ${endDate}`
    )

    const client = database.getClient()
    const today = database.getDateStringInTimezone()
    const tzDate = database.getDateInTimezone()
    const currentMonth = `${tzDate.getUTCFullYear()}-${String(tzDate.getUTCMonth() + 1).padStart(2, '0')}`

    let searchPatterns = []

    if (period === 'custom' && startDate && endDate) {
      // 自定义日期范围，生成多个日期的搜索模式
      const start = new Date(startDate)
      const end = new Date(endDate)

      // 确保日期范围有效
      if (start > end) {
        return res.status(400).json({ error: 'Start date must be before or equal to end date' })
      }

      // 限制最大范围为31天
      const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1
      if (daysDiff > 31) {
        return res.status(400).json({ error: 'Date range cannot exceed 31 days' })
      }

      // 生成日期范围内所有日期的搜索模式
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = database.getDateStringInTimezone(d)
        searchPatterns.push(`usage:${keyId}:model:daily:*:${dateStr}`)
      }

      logger.info(
        `📊 Custom date range patterns: ${searchPatterns.length} days from ${startDate} to ${endDate}`
      )
    } else {
      // 原有的预设期间逻辑
      const pattern =
        period === 'daily'
          ? `usage:${keyId}:model:daily:*:${today}`
          : `usage:${keyId}:model:monthly:*:${currentMonth}`
      searchPatterns = [pattern]
      logger.info(`📊 Preset period pattern: ${pattern}`)
    }

    // 汇总所有匹配的数据
    const modelStatsMap = new Map()
    const modelStats = [] // 定义结果数组

    for (const pattern of searchPatterns) {
      const keys = await client.keys(pattern)
      logger.info(`📊 Pattern ${pattern} found ${keys.length} keys`)

      for (const key of keys) {
        const match =
          key.match(/usage:.+:model:daily:(.+):\d{4}-\d{2}-\d{2}$/) ||
          key.match(/usage:.+:model:monthly:(.+):\d{4}-\d{2}$/)

        if (!match) {
          logger.warn(`📊 Pattern mismatch for key: ${key}`)
          continue
        }

        const model = match[1]
        const data = await client.hgetall(key)

        if (data && Object.keys(data).length > 0) {
          // 累加同一模型的数据
          if (!modelStatsMap.has(model)) {
            modelStatsMap.set(model, {
              requests: 0,
              inputTokens: 0,
              outputTokens: 0,
              cacheCreateTokens: 0,
              cacheReadTokens: 0,
              allTokens: 0
            })
          }

          const stats = modelStatsMap.get(model)
          stats.requests += parseInt(data.requests) || 0
          stats.inputTokens += parseInt(data.inputTokens) || 0
          stats.outputTokens += parseInt(data.outputTokens) || 0
          stats.cacheCreateTokens += parseInt(data.cacheCreateTokens) || 0
          stats.cacheReadTokens += parseInt(data.cacheReadTokens) || 0
          stats.allTokens += parseInt(data.allTokens) || 0
        }
      }
    }

    // 将汇总的数据转换为最终结果
    for (const [model, stats] of modelStatsMap) {
      logger.info(`📊 Model ${model} aggregated data:`, stats)

      const usage = {
        input_tokens: stats.inputTokens,
        output_tokens: stats.outputTokens,
        cache_creation_input_tokens: stats.cacheCreateTokens,
        cache_read_input_tokens: stats.cacheReadTokens
      }

      // 使用CostCalculator计算费用
      const costData = CostCalculator.calculateCost(usage, model)

      modelStats.push({
        model,
        requests: stats.requests,
        inputTokens: stats.inputTokens,
        outputTokens: stats.outputTokens,
        cacheCreateTokens: stats.cacheCreateTokens,
        cacheReadTokens: stats.cacheReadTokens,
        allTokens: stats.allTokens,
        // 添加费用信息
        costs: costData.costs,
        formatted: costData.formatted,
        pricing: costData.pricing,
        usingDynamicPricing: costData.usingDynamicPricing
      })
    }

    // 如果没有找到模型级别的详细数据，尝试从汇总数据中生成展示
    if (modelStats.length === 0) {
      logger.info(
        `📊 No detailed model stats found, trying to get aggregate data for API key ${keyId}`
      )

      // 尝试从API Keys列表中获取usage数据作为备选方案
      try {
        const apiKeys = await apiKeyService.getAllApiKeys()
        const targetApiKey = apiKeys.find((key) => key.id === keyId)

        if (targetApiKey && targetApiKey.usage) {
          logger.info(
            `📊 Found API key usage data from getAllApiKeys for ${keyId}:`,
            targetApiKey.usage
          )

          // 从汇总数据创建展示条目
          let usageData
          if (period === 'custom' || period === 'daily') {
            // 对于自定义或日统计，使用daily数据或total数据
            usageData = targetApiKey.usage.daily || targetApiKey.usage.total
          } else {
            // 对于月统计，使用monthly数据或total数据
            usageData = targetApiKey.usage.monthly || targetApiKey.usage.total
          }

          if (usageData && usageData.allTokens > 0) {
            const usage = {
              input_tokens: usageData.inputTokens || 0,
              output_tokens: usageData.outputTokens || 0,
              cache_creation_input_tokens: usageData.cacheCreateTokens || 0,
              cache_read_input_tokens: usageData.cacheReadTokens || 0
            }

            // 对于汇总数据，使用默认模型计算费用
            const costData = CostCalculator.calculateCost(usage, 'claude-3-5-sonnet-20241022')

            modelStats.push({
              model: '总体使用 (历史数据)',
              requests: usageData.requests || 0,
              inputTokens: usageData.inputTokens || 0,
              outputTokens: usageData.outputTokens || 0,
              cacheCreateTokens: usageData.cacheCreateTokens || 0,
              cacheReadTokens: usageData.cacheReadTokens || 0,
              allTokens: usageData.allTokens || 0,
              // 添加费用信息
              costs: costData.costs,
              formatted: costData.formatted,
              pricing: costData.pricing,
              usingDynamicPricing: costData.usingDynamicPricing
            })

            logger.info('📊 Generated display data from API key usage stats')
          } else {
            logger.info(`📊 No usage data found for period ${period} in API key data`)
          }
        } else {
          logger.info(`📊 API key ${keyId} not found or has no usage data`)
        }
      } catch (error) {
        logger.error('❌ Error fetching API key usage data:', error)
      }
    }

    // 按总token数降序排列
    modelStats.sort((a, b) => b.allTokens - a.allTokens)

    logger.info(`📊 Returning ${modelStats.length} model stats for API key ${keyId}:`, modelStats)

    return res.json({ success: true, data: modelStats })
  } catch (error) {
    logger.error('❌ Failed to get API key model stats:', error)
    return res
      .status(500)
      .json({ error: 'Failed to get API key model stats', message: error.message })
  }
})

// 获取按API Key分组的使用趋势
router.get('/api-keys-usage-trend', authenticateAdmin, async (req, res) => {
  try {
    const { granularity = 'day', days = 7, startDate, endDate } = req.query

    logger.info(`📊 Getting API keys usage trend, granularity: ${granularity}, days: ${days}`)

    const client = database.getClient()
    const trendData = []

    // 获取所有API Keys
    const apiKeys = await apiKeyService.getAllApiKeys()
    const apiKeyMap = new Map(apiKeys.map((key) => [key.id, key]))

    if (granularity === 'hour') {
      // 小时粒度统计
      let endTime, startTime

      if (startDate && endDate) {
        // 自定义时间范围
        startTime = new Date(startDate)
        endTime = new Date(endDate)
      } else {
        // 默认近24小时
        endTime = new Date()
        startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000)
      }

      // 按小时遍历
      const currentHour = new Date(startTime)
      currentHour.setMinutes(0, 0, 0)

      while (currentHour <= endTime) {
        // 使用时区转换后的时间来生成键
        const tzCurrentHour = database.getDateInTimezone(currentHour)
        const dateStr = database.getDateStringInTimezone(currentHour)
        const hour = String(tzCurrentHour.getUTCHours()).padStart(2, '0')
        const hourKey = `${dateStr}:${hour}`

        // 获取这个小时所有API Key的数据
        const pattern = `usage:hourly:*:${hourKey}`
        const keys = await client.keys(pattern)

        // 格式化时间标签
        const tzDateForLabel = database.getDateInTimezone(currentHour)
        const monthLabel = String(tzDateForLabel.getUTCMonth() + 1).padStart(2, '0')
        const dayLabel = String(tzDateForLabel.getUTCDate()).padStart(2, '0')
        const hourLabel = String(tzDateForLabel.getUTCHours()).padStart(2, '0')

        const hourData = {
          hour: currentHour.toISOString(), // 使用原始时间，不进行时区转换
          label: `${monthLabel}/${dayLabel} ${hourLabel}:00`, // 添加格式化的标签
          apiKeys: {}
        }

        // 先收集基础数据
        const apiKeyDataMap = new Map()
        for (const key of keys) {
          const match = key.match(/usage:hourly:(.+?):\d{4}-\d{2}-\d{2}:\d{2}/)
          if (!match) {
            continue
          }

          const apiKeyId = match[1]
          const data = await client.hgetall(key)

          if (data && apiKeyMap.has(apiKeyId)) {
            const inputTokens = parseInt(data.inputTokens) || 0
            const outputTokens = parseInt(data.outputTokens) || 0
            const cacheCreateTokens = parseInt(data.cacheCreateTokens) || 0
            const cacheReadTokens = parseInt(data.cacheReadTokens) || 0
            const totalTokens = inputTokens + outputTokens + cacheCreateTokens + cacheReadTokens

            apiKeyDataMap.set(apiKeyId, {
              name: apiKeyMap.get(apiKeyId).name,
              tokens: totalTokens,
              requests: parseInt(data.requests) || 0,
              inputTokens,
              outputTokens,
              cacheCreateTokens,
              cacheReadTokens
            })
          }
        }

        // 获取该小时的模型级别数据来计算准确费用
        const modelPattern = `usage:*:model:hourly:*:${hourKey}`
        const modelKeys = await client.keys(modelPattern)
        const apiKeyCostMap = new Map()

        for (const modelKey of modelKeys) {
          const match = modelKey.match(/usage:(.+?):model:hourly:(.+?):\d{4}-\d{2}-\d{2}:\d{2}/)
          if (!match) {
            continue
          }

          const apiKeyId = match[1]
          const model = match[2]
          const modelData = await client.hgetall(modelKey)

          if (modelData && apiKeyDataMap.has(apiKeyId)) {
            const usage = {
              input_tokens: parseInt(modelData.inputTokens) || 0,
              output_tokens: parseInt(modelData.outputTokens) || 0,
              cache_creation_input_tokens: parseInt(modelData.cacheCreateTokens) || 0,
              cache_read_input_tokens: parseInt(modelData.cacheReadTokens) || 0
            }

            const costResult = CostCalculator.calculateCost(usage, model)
            const currentCost = apiKeyCostMap.get(apiKeyId) || 0
            apiKeyCostMap.set(apiKeyId, currentCost + costResult.costs.total)
          }
        }

        // 组合数据
        for (const [apiKeyId, data] of apiKeyDataMap) {
          const cost = apiKeyCostMap.get(apiKeyId) || 0

          // 如果没有模型级别数据，使用默认模型计算（降级方案）
          let finalCost = cost
          let formattedCost = CostCalculator.formatCost(cost)

          if (cost === 0 && data.tokens > 0) {
            const usage = {
              input_tokens: data.inputTokens,
              output_tokens: data.outputTokens,
              cache_creation_input_tokens: data.cacheCreateTokens,
              cache_read_input_tokens: data.cacheReadTokens
            }
            const fallbackResult = CostCalculator.calculateCost(usage, 'claude-3-5-sonnet-20241022')
            finalCost = fallbackResult.costs.total
            formattedCost = fallbackResult.formatted.total
          }

          hourData.apiKeys[apiKeyId] = {
            name: data.name,
            tokens: data.tokens,
            requests: data.requests,
            cost: finalCost,
            formattedCost
          }
        }

        trendData.push(hourData)
        currentHour.setHours(currentHour.getHours() + 1)
      }
    } else {
      // 天粒度统计
      const daysCount = parseInt(days) || 7
      const today = new Date()

      // 获取过去N天的数据
      for (let i = 0; i < daysCount; i++) {
        const date = new Date(today)
        date.setDate(date.getDate() - i)
        const dateStr = database.getDateStringInTimezone(date)

        // 获取这一天所有API Key的数据
        const pattern = `usage:daily:*:${dateStr}`
        const keys = await client.keys(pattern)

        const dayData = {
          date: dateStr,
          apiKeys: {}
        }

        // 先收集基础数据
        const apiKeyDataMap = new Map()
        for (const key of keys) {
          const match = key.match(/usage:daily:(.+?):\d{4}-\d{2}-\d{2}/)
          if (!match) {
            continue
          }

          const apiKeyId = match[1]
          const data = await client.hgetall(key)

          if (data && apiKeyMap.has(apiKeyId)) {
            const inputTokens = parseInt(data.inputTokens) || 0
            const outputTokens = parseInt(data.outputTokens) || 0
            const cacheCreateTokens = parseInt(data.cacheCreateTokens) || 0
            const cacheReadTokens = parseInt(data.cacheReadTokens) || 0
            const totalTokens = inputTokens + outputTokens + cacheCreateTokens + cacheReadTokens

            apiKeyDataMap.set(apiKeyId, {
              name: apiKeyMap.get(apiKeyId).name,
              tokens: totalTokens,
              requests: parseInt(data.requests) || 0,
              inputTokens,
              outputTokens,
              cacheCreateTokens,
              cacheReadTokens
            })
          }
        }

        // 获取该天的模型级别数据来计算准确费用
        const modelPattern = `usage:*:model:daily:*:${dateStr}`
        const modelKeys = await client.keys(modelPattern)
        const apiKeyCostMap = new Map()

        for (const modelKey of modelKeys) {
          const match = modelKey.match(/usage:(.+?):model:daily:(.+?):\d{4}-\d{2}-\d{2}/)
          if (!match) {
            continue
          }

          const apiKeyId = match[1]
          const model = match[2]
          const modelData = await client.hgetall(modelKey)

          if (modelData && apiKeyDataMap.has(apiKeyId)) {
            const usage = {
              input_tokens: parseInt(modelData.inputTokens) || 0,
              output_tokens: parseInt(modelData.outputTokens) || 0,
              cache_creation_input_tokens: parseInt(modelData.cacheCreateTokens) || 0,
              cache_read_input_tokens: parseInt(modelData.cacheReadTokens) || 0
            }

            const costResult = CostCalculator.calculateCost(usage, model)
            const currentCost = apiKeyCostMap.get(apiKeyId) || 0
            apiKeyCostMap.set(apiKeyId, currentCost + costResult.costs.total)
          }
        }

        // 组合数据
        for (const [apiKeyId, data] of apiKeyDataMap) {
          const cost = apiKeyCostMap.get(apiKeyId) || 0

          // 如果没有模型级别数据，使用默认模型计算（降级方案）
          let finalCost = cost
          let formattedCost = CostCalculator.formatCost(cost)

          if (cost === 0 && data.tokens > 0) {
            const usage = {
              input_tokens: data.inputTokens,
              output_tokens: data.outputTokens,
              cache_creation_input_tokens: data.cacheCreateTokens,
              cache_read_input_tokens: data.cacheReadTokens
            }
            const fallbackResult = CostCalculator.calculateCost(usage, 'claude-3-5-sonnet-20241022')
            finalCost = fallbackResult.costs.total
            formattedCost = fallbackResult.formatted.total
          }

          dayData.apiKeys[apiKeyId] = {
            name: data.name,
            tokens: data.tokens,
            requests: data.requests,
            cost: finalCost,
            formattedCost
          }
        }

        trendData.push(dayData)
      }
    }

    // 按时间正序排列
    if (granularity === 'hour') {
      trendData.sort((a, b) => new Date(a.hour) - new Date(b.hour))
    } else {
      trendData.sort((a, b) => new Date(a.date) - new Date(b.date))
    }

    // 计算每个API Key的总token数，用于排序
    const apiKeyTotals = new Map()
    for (const point of trendData) {
      for (const [apiKeyId, data] of Object.entries(point.apiKeys)) {
        apiKeyTotals.set(apiKeyId, (apiKeyTotals.get(apiKeyId) || 0) + data.tokens)
      }
    }

    // 获取前10个使用量最多的API Key
    const topApiKeys = Array.from(apiKeyTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([apiKeyId]) => apiKeyId)

    return res.json({
      success: true,
      data: trendData,
      granularity,
      topApiKeys,
      totalApiKeys: apiKeyTotals.size
    })
  } catch (error) {
    logger.error('❌ Failed to get API keys usage trend:', error)
    return res
      .status(500)
      .json({ error: 'Failed to get API keys usage trend', message: error.message })
  }
})

// 计算总体使用费用
router.get('/usage-costs', authenticateAdmin, async (req, res) => {
  try {
    const { period = 'all' } = req.query // all, today, monthly, 7days

    logger.info(`💰 Calculating usage costs for period: ${period}`)

    // 模型名标准化函数（与database.js保持一致）
    const normalizeModelName = (model) => {
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
      return model.replace(/-v\d+:\d+$|:latest$|\[\d+[a-zA-Z]*\]$/, '')
    }

    // 获取所有API Keys的使用统计
    const apiKeys = await apiKeyService.getAllApiKeys()

    const totalCosts = {
      inputCost: 0,
      outputCost: 0,
      cacheCreateCost: 0,
      cacheReadCost: 0,
      totalCost: 0
    }

    const modelCosts = {}

    // 按模型统计费用
    const client = database.getClient()
    const today = database.getDateStringInTimezone()
    const tzDate = database.getDateInTimezone()
    const currentMonth = `${tzDate.getUTCFullYear()}-${String(tzDate.getUTCMonth() + 1).padStart(2, '0')}`

    let pattern
    if (period === 'today') {
      pattern = `usage:model:daily:*:${today}`
    } else if (period === 'monthly') {
      pattern = `usage:model:monthly:*:${currentMonth}`
    } else if (period === '7days') {
      // 最近7天：汇总daily数据
      const modelUsageMap = new Map()

      // 获取最近7天的所有daily统计数据
      for (let i = 0; i < 7; i++) {
        const date = new Date()
        date.setDate(date.getDate() - i)
        const currentTzDate = database.getDateInTimezone(date)
        const dateStr = `${currentTzDate.getUTCFullYear()}-${String(currentTzDate.getUTCMonth() + 1).padStart(2, '0')}-${String(currentTzDate.getUTCDate()).padStart(2, '0')}`
        const dayPattern = `usage:model:daily:*:${dateStr}`

        const dayKeys = await client.keys(dayPattern)

        for (const key of dayKeys) {
          const modelMatch = key.match(/usage:model:daily:(.+):\d{4}-\d{2}-\d{2}$/)
          if (!modelMatch) {
            continue
          }

          const rawModel = modelMatch[1]
          const normalizedModel = normalizeModelName(rawModel)
          const data = await client.hgetall(key)

          if (data && Object.keys(data).length > 0) {
            if (!modelUsageMap.has(normalizedModel)) {
              modelUsageMap.set(normalizedModel, {
                inputTokens: 0,
                outputTokens: 0,
                cacheCreateTokens: 0,
                cacheReadTokens: 0
              })
            }

            const modelUsage = modelUsageMap.get(normalizedModel)
            modelUsage.inputTokens += parseInt(data.inputTokens) || 0
            modelUsage.outputTokens += parseInt(data.outputTokens) || 0
            modelUsage.cacheCreateTokens += parseInt(data.cacheCreateTokens) || 0
            modelUsage.cacheReadTokens += parseInt(data.cacheReadTokens) || 0
          }
        }
      }

      // 计算7天统计的费用
      logger.info(`💰 Processing ${modelUsageMap.size} unique models for 7days cost calculation`)

      for (const [model, usage] of modelUsageMap) {
        const usageData = {
          input_tokens: usage.inputTokens,
          output_tokens: usage.outputTokens,
          cache_creation_input_tokens: usage.cacheCreateTokens,
          cache_read_input_tokens: usage.cacheReadTokens
        }

        const costResult = CostCalculator.calculateCost(usageData, model)
        totalCosts.inputCost += costResult.costs.input
        totalCosts.outputCost += costResult.costs.output
        totalCosts.cacheCreateCost += costResult.costs.cacheWrite
        totalCosts.cacheReadCost += costResult.costs.cacheRead
        totalCosts.totalCost += costResult.costs.total

        logger.info(
          `💰 Model ${model} (7days): ${usage.inputTokens + usage.outputTokens + usage.cacheCreateTokens + usage.cacheReadTokens} tokens, cost: ${costResult.formatted.total}`
        )

        // 记录模型费用
        modelCosts[model] = {
          model,
          requests: 0, // 7天汇总数据没有请求数统计
          usage: usageData,
          costs: costResult.costs,
          formatted: costResult.formatted,
          usingDynamicPricing: costResult.usingDynamicPricing
        }
      }

      // 返回7天统计结果
      return res.json({
        success: true,
        data: {
          period,
          totalCosts: {
            ...totalCosts,
            formatted: {
              inputCost: CostCalculator.formatCost(totalCosts.inputCost),
              outputCost: CostCalculator.formatCost(totalCosts.outputCost),
              cacheCreateCost: CostCalculator.formatCost(totalCosts.cacheCreateCost),
              cacheReadCost: CostCalculator.formatCost(totalCosts.cacheReadCost),
              totalCost: CostCalculator.formatCost(totalCosts.totalCost)
            }
          },
          modelCosts: Object.values(modelCosts)
        }
      })
    } else {
      // 全部时间，先尝试从Redis获取所有历史模型统计数据（只使用monthly数据避免重复计算）
      const allModelKeys = await client.keys('usage:model:monthly:*:*')
      logger.info(`💰 Total period calculation: found ${allModelKeys.length} monthly model keys`)

      if (allModelKeys.length > 0) {
        // 如果有详细的模型统计数据，使用模型级别的计算
        const modelUsageMap = new Map()

        for (const key of allModelKeys) {
          // 解析模型名称（只处理monthly数据）
          const modelMatch = key.match(/usage:model:monthly:(.+):(\d{4}-\d{2})$/)
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

        // 使用模型级别的数据计算费用
        logger.info(`💰 Processing ${modelUsageMap.size} unique models for total cost calculation`)

        for (const [model, usage] of modelUsageMap) {
          const usageData = {
            input_tokens: usage.inputTokens,
            output_tokens: usage.outputTokens,
            cache_creation_input_tokens: usage.cacheCreateTokens,
            cache_read_input_tokens: usage.cacheReadTokens
          }

          const costResult = CostCalculator.calculateCost(usageData, model)
          totalCosts.inputCost += costResult.costs.input
          totalCosts.outputCost += costResult.costs.output
          totalCosts.cacheCreateCost += costResult.costs.cacheWrite
          totalCosts.cacheReadCost += costResult.costs.cacheRead
          totalCosts.totalCost += costResult.costs.total

          logger.info(
            `💰 Model ${model}: ${usage.inputTokens + usage.outputTokens + usage.cacheCreateTokens + usage.cacheReadTokens} tokens, cost: ${costResult.formatted.total}`
          )

          // 记录模型费用
          modelCosts[model] = {
            model,
            requests: 0, // 历史汇总数据没有请求数
            usage: usageData,
            costs: costResult.costs,
            formatted: costResult.formatted,
            usingDynamicPricing: costResult.usingDynamicPricing
          }
        }
      } else {
        // 如果没有详细的模型统计数据，回退到API Key汇总数据
        logger.warn('No detailed model statistics found, falling back to API Key aggregated data')

        for (const apiKey of apiKeys) {
          if (apiKey.usage && apiKey.usage.total) {
            const usage = {
              input_tokens: apiKey.usage.total.inputTokens || 0,
              output_tokens: apiKey.usage.total.outputTokens || 0,
              cache_creation_input_tokens: apiKey.usage.total.cacheCreateTokens || 0,
              cache_read_input_tokens: apiKey.usage.total.cacheReadTokens || 0
            }

            // 使用加权平均价格计算（基于当前活跃模型的价格分布）
            const costResult = CostCalculator.calculateCost(usage, 'claude-3-5-haiku-20241022')
            totalCosts.inputCost += costResult.costs.input
            totalCosts.outputCost += costResult.costs.output
            totalCosts.cacheCreateCost += costResult.costs.cacheWrite
            totalCosts.cacheReadCost += costResult.costs.cacheRead
            totalCosts.totalCost += costResult.costs.total
          }
        }
      }

      return res.json({
        success: true,
        data: {
          period,
          totalCosts: {
            ...totalCosts,
            formatted: {
              inputCost: CostCalculator.formatCost(totalCosts.inputCost),
              outputCost: CostCalculator.formatCost(totalCosts.outputCost),
              cacheCreateCost: CostCalculator.formatCost(totalCosts.cacheCreateCost),
              cacheReadCost: CostCalculator.formatCost(totalCosts.cacheReadCost),
              totalCost: CostCalculator.formatCost(totalCosts.totalCost)
            }
          },
          modelCosts: Object.values(modelCosts).sort((a, b) => b.costs.total - a.costs.total),
          pricingServiceStatus: pricingService.getStatus()
        }
      })
    }

    // 对于今日或本月，从Redis获取详细的模型统计
    const keys = await client.keys(pattern)

    for (const key of keys) {
      const match = key.match(
        period === 'today'
          ? /usage:model:daily:(.+):\d{4}-\d{2}-\d{2}$/
          : /usage:model:monthly:(.+):\d{4}-\d{2}$/
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

        const costResult = CostCalculator.calculateCost(usage, model)

        // 累加总费用
        totalCosts.inputCost += costResult.costs.input
        totalCosts.outputCost += costResult.costs.output
        totalCosts.cacheCreateCost += costResult.costs.cacheWrite
        totalCosts.cacheReadCost += costResult.costs.cacheRead
        totalCosts.totalCost += costResult.costs.total

        // 记录模型费用
        modelCosts[model] = {
          model,
          requests: parseInt(data.requests) || 0,
          usage,
          costs: costResult.costs,
          formatted: costResult.formatted,
          usingDynamicPricing: costResult.usingDynamicPricing
        }
      }
    }

    return res.json({
      success: true,
      data: {
        period,
        totalCosts: {
          ...totalCosts,
          formatted: {
            inputCost: CostCalculator.formatCost(totalCosts.inputCost),
            outputCost: CostCalculator.formatCost(totalCosts.outputCost),
            cacheCreateCost: CostCalculator.formatCost(totalCosts.cacheCreateCost),
            cacheReadCost: CostCalculator.formatCost(totalCosts.cacheReadCost),
            totalCost: CostCalculator.formatCost(totalCosts.totalCost)
          }
        },
        modelCosts: Object.values(modelCosts).sort((a, b) => b.costs.total - a.costs.total),
        pricingServiceStatus: pricingService.getStatus()
      }
    })
  } catch (error) {
    logger.error('❌ Failed to calculate usage costs:', error)
    return res
      .status(500)
      .json({ error: 'Failed to calculate usage costs', message: error.message })
  }
})

// 📋 获取所有账号的 Claude Code headers 信息
router.get('/claude-code-headers', authenticateAdmin, async (req, res) => {
  try {
    const allHeaders = await claudeCodeHeadersService.getAllAccountHeaders()

    // 获取所有 Claude 账号信息
    const accounts = await claudeAccountService.getAllAccounts()
    const accountMap = {}
    accounts.forEach((account) => {
      accountMap[account.id] = account.name
    })

    // 格式化输出
    const formattedData = Object.entries(allHeaders).map(([accountId, data]) => ({
      accountId,
      accountName: accountMap[accountId] || 'Unknown',
      version: data.version,
      userAgent: data.headers['user-agent'],
      updatedAt: data.updatedAt,
      headers: data.headers
    }))

    return res.json({
      success: true,
      data: formattedData
    })
  } catch (error) {
    logger.error('❌ Failed to get Claude Code headers:', error)
    return res
      .status(500)
      .json({ error: 'Failed to get Claude Code headers', message: error.message })
  }
})

// 🗑️ 清除指定账号的 Claude Code headers
router.delete('/claude-code-headers/:accountId', authenticateAdmin, async (req, res) => {
  try {
    const { accountId } = req.params
    await claudeCodeHeadersService.clearAccountHeaders(accountId)

    return res.json({
      success: true,
      message: `Claude Code headers cleared for account ${accountId}`
    })
  } catch (error) {
    logger.error('❌ Failed to clear Claude Code headers:', error)
    return res
      .status(500)
      .json({ error: 'Failed to clear Claude Code headers', message: error.message })
  }
})

// 🔄 版本检查
router.get('/check-updates', authenticateAdmin, async (req, res) => {
  // 读取当前版本
  const versionPath = path.join(__dirname, '../../VERSION')
  let currentVersion = '1.0.0'
  try {
    currentVersion = fs.readFileSync(versionPath, 'utf8').trim()
  } catch (err) {
    logger.warn('⚠️ Could not read VERSION file:', err.message)
  }

  try {
    // 从缓存获取
    const cacheKey = 'version_check_cache'
    const cached = await database.getClient().get(cacheKey)

    if (cached && !req.query.force) {
      const cachedData = JSON.parse(cached)
      const cacheAge = Date.now() - cachedData.timestamp

      // 缓存有效期1小时
      if (cacheAge < 3600000) {
        // 实时计算 hasUpdate，不使用缓存的值
        const hasUpdate = compareVersions(currentVersion, cachedData.latest) < 0

        return res.json({
          success: true,
          data: {
            current: currentVersion,
            latest: cachedData.latest,
            hasUpdate, // 实时计算，不用缓存
            releaseInfo: cachedData.releaseInfo,
            cached: true
          }
        })
      }
    }

    // 请求 GitHub API
    const githubRepo = 'Await-d/claude-relay-service'
    const response = await axios.get(`https://api.github.com/repos/${githubRepo}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'Claude-Relay-Service'
      },
      timeout: 10000
    })

    const release = response.data
    const latestVersion = release.tag_name.replace(/^v/, '')

    // 比较版本
    const hasUpdate = compareVersions(currentVersion, latestVersion) < 0

    const releaseInfo = {
      name: release.name,
      body: release.body,
      publishedAt: release.published_at,
      htmlUrl: release.html_url
    }

    // 缓存结果（不缓存 hasUpdate，因为它应该实时计算）
    await database.getClient().set(
      cacheKey,
      JSON.stringify({
        latest: latestVersion,
        releaseInfo,
        timestamp: Date.now()
      }),
      'EX',
      3600
    ) // 1小时过期

    return res.json({
      success: true,
      data: {
        current: currentVersion,
        latest: latestVersion,
        hasUpdate,
        releaseInfo,
        cached: false
      }
    })
  } catch (error) {
    // 改进错误日志记录
    const errorDetails = {
      message: error.message || 'Unknown error',
      code: error.code,
      response: error.response
        ? {
            status: error.response.status,
            statusText: error.response.statusText,
            data: error.response.data
          }
        : null,
      request: error.request ? 'Request was made but no response received' : null
    }

    logger.error('❌ Failed to check for updates:', errorDetails.message)

    // 处理 404 错误 - 仓库或版本不存在
    if (error.response && error.response.status === 404) {
      return res.json({
        success: true,
        data: {
          current: currentVersion,
          latest: currentVersion,
          hasUpdate: false,
          releaseInfo: {
            name: 'No releases found',
            body: 'The GitHub repository has no releases yet.',
            publishedAt: new Date().toISOString(),
            htmlUrl: '#'
          },
          warning: 'GitHub repository has no releases'
        }
      })
    }

    // 如果是网络错误，尝试返回缓存的数据
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
      const cacheKey = 'version_check_cache'
      const cached = await database.getClient().get(cacheKey)

      if (cached) {
        const cachedData = JSON.parse(cached)
        // 实时计算 hasUpdate
        const hasUpdate = compareVersions(currentVersion, cachedData.latest) < 0

        return res.json({
          success: true,
          data: {
            current: currentVersion,
            latest: cachedData.latest,
            hasUpdate, // 实时计算
            releaseInfo: cachedData.releaseInfo,
            cached: true,
            warning: 'Using cached data due to network error'
          }
        })
      }
    }

    // 其他错误返回当前版本信息
    return res.json({
      success: true,
      data: {
        current: currentVersion,
        latest: currentVersion,
        hasUpdate: false,
        releaseInfo: {
          name: 'Update check failed',
          body: `Unable to check for updates: ${error.message || 'Unknown error'}`,
          publishedAt: new Date().toISOString(),
          htmlUrl: '#'
        },
        error: true,
        warning: error.message || 'Failed to check for updates'
      }
    })
  }
})

// 版本比较函数
function compareVersions(current, latest) {
  const parseVersion = (v) => {
    const parts = v.split('.').map(Number)
    return {
      major: parts[0] || 0,
      minor: parts[1] || 0,
      patch: parts[2] || 0
    }
  }

  const currentV = parseVersion(current)
  const latestV = parseVersion(latest)

  if (currentV.major !== latestV.major) {
    return currentV.major - latestV.major
  }
  if (currentV.minor !== latestV.minor) {
    return currentV.minor - latestV.minor
  }
  return currentV.patch - latestV.patch
}

// 🎨 OEM设置管理

// 获取OEM设置（公开接口，用于显示）
router.get('/oem-settings', async (req, res) => {
  try {
    const client = database.getClient()
    const oemSettings = await client.get('oem:settings')

    // 默认设置
    const defaultSettings = {
      siteName: 'Claude Relay Service',
      siteIcon: '',
      siteIconData: '', // Base64编码的图标数据
      updatedAt: new Date().toISOString()
    }

    let settings = defaultSettings
    if (oemSettings) {
      try {
        settings = { ...defaultSettings, ...JSON.parse(oemSettings) }
      } catch (err) {
        logger.warn('⚠️ Failed to parse OEM settings, using defaults:', err.message)
      }
    }

    return res.json({
      success: true,
      data: settings
    })
  } catch (error) {
    logger.error('❌ Failed to get OEM settings:', error)
    return res.status(500).json({ error: 'Failed to get OEM settings', message: error.message })
  }
})

// 更新OEM设置
router.put('/oem-settings', authenticateAdmin, async (req, res) => {
  try {
    const { siteName, siteIcon, siteIconData } = req.body

    // 验证输入
    if (!siteName || typeof siteName !== 'string' || siteName.trim().length === 0) {
      return res.status(400).json({ error: 'Site name is required' })
    }

    if (siteName.length > 100) {
      return res.status(400).json({ error: 'Site name must be less than 100 characters' })
    }

    // 验证图标数据大小（如果是base64）
    if (siteIconData && siteIconData.length > 500000) {
      // 约375KB
      return res.status(400).json({ error: 'Icon file must be less than 350KB' })
    }

    // 验证图标URL（如果提供）
    if (siteIcon && !siteIconData) {
      // 简单验证URL格式
      try {
        new URL(siteIcon)
      } catch (err) {
        return res.status(400).json({ error: 'Invalid icon URL format' })
      }
    }

    const settings = {
      siteName: siteName.trim(),
      siteIcon: (siteIcon || '').trim(),
      siteIconData: (siteIconData || '').trim(), // Base64数据
      updatedAt: new Date().toISOString()
    }

    const client = database.getClient()
    await client.set('oem:settings', JSON.stringify(settings))

    logger.info(`✅ OEM settings updated: ${siteName}`)

    return res.json({
      success: true,
      message: 'OEM settings updated successfully',
      data: settings
    })
  } catch (error) {
    logger.error('❌ Failed to update OEM settings:', error)
    return res.status(500).json({ error: 'Failed to update OEM settings', message: error.message })
  }
})

// 🤖 OpenAI 账户管理

// OpenAI OAuth 配置
const OPENAI_CONFIG = {
  BASE_URL: 'https://auth.openai.com',
  CLIENT_ID: 'app_EMoamEEZ73f0CkXaXp7hrann',
  REDIRECT_URI: 'http://localhost:1455/auth/callback',
  SCOPE: 'openid profile email offline_access'
}

// 生成 PKCE 参数
function generateOpenAIPKCE() {
  const codeVerifier = crypto.randomBytes(64).toString('hex')
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')

  return {
    codeVerifier,
    codeChallenge
  }
}

// 生成 OpenAI OAuth 授权 URL
router.post('/openai-accounts/generate-auth-url', authenticateAdmin, async (req, res) => {
  try {
    const { proxy } = req.body

    // 生成 PKCE 参数
    const pkce = generateOpenAIPKCE()

    // 生成随机 state
    const state = crypto.randomBytes(32).toString('hex')

    // 创建会话 ID
    const sessionId = crypto.randomUUID()

    // 将 PKCE 参数和代理配置存储到数据库
    await database.setOAuthSession(sessionId, {
      codeVerifier: pkce.codeVerifier,
      codeChallenge: pkce.codeChallenge,
      state,
      proxy: proxy || null,
      platform: 'openai',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
    })

    // 构建授权 URL 参数
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: OPENAI_CONFIG.CLIENT_ID,
      redirect_uri: OPENAI_CONFIG.REDIRECT_URI,
      scope: OPENAI_CONFIG.SCOPE,
      code_challenge: pkce.codeChallenge,
      code_challenge_method: 'S256',
      state,
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true'
    })

    const authUrl = `${OPENAI_CONFIG.BASE_URL}/oauth/authorize?${params.toString()}`

    logger.success('🔗 Generated OpenAI OAuth authorization URL')

    return res.json({
      success: true,
      data: {
        authUrl,
        sessionId,
        instructions: [
          '1. 复制上面的链接到浏览器中打开',
          '2. 登录您的 OpenAI 账户',
          '3. 同意应用权限',
          '4. 复制浏览器地址栏中的完整 URL（包含 code 参数）',
          '5. 在添加账户表单中粘贴完整的回调 URL'
        ]
      }
    })
  } catch (error) {
    logger.error('生成 OpenAI OAuth URL 失败:', error)
    return res.status(500).json({
      success: false,
      message: '生成授权链接失败',
      error: error.message
    })
  }
})

// 交换 OpenAI 授权码
router.post('/openai-accounts/exchange-code', authenticateAdmin, async (req, res) => {
  try {
    const { code, sessionId } = req.body

    if (!code || !sessionId) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数'
      })
    }

    // 从数据库获取会话数据
    const sessionData = await database.getOAuthSession(sessionId)
    if (!sessionData) {
      return res.status(400).json({
        success: false,
        message: '会话已过期或无效'
      })
    }

    // 准备 token 交换请求
    const tokenData = {
      grant_type: 'authorization_code',
      code: code.trim(),
      redirect_uri: OPENAI_CONFIG.REDIRECT_URI,
      client_id: OPENAI_CONFIG.CLIENT_ID,
      code_verifier: sessionData.codeVerifier
    }

    logger.info('Exchanging OpenAI authorization code:', {
      sessionId,
      codeLength: code.length,
      hasCodeVerifier: !!sessionData.codeVerifier
    })

    // 配置代理（如果有）
    const axiosConfig = {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }

    // 配置代理（如果有）
    const proxyAgent = ProxyHelper.createProxyAgent(sessionData.proxy)
    if (proxyAgent) {
      axiosConfig.httpsAgent = proxyAgent
    }

    // 交换 authorization code 获取 tokens
    const tokenResponse = await axios.post(
      `${OPENAI_CONFIG.BASE_URL}/oauth/token`,
      new URLSearchParams(tokenData).toString(),
      axiosConfig
    )

    const { id_token, access_token, refresh_token, expires_in } = tokenResponse.data

    // 解析 ID token 获取用户信息
    const idTokenParts = id_token.split('.')
    if (idTokenParts.length !== 3) {
      throw new Error('Invalid ID token format')
    }

    // 解码 JWT payload
    const payload = JSON.parse(Buffer.from(idTokenParts[1], 'base64url').toString())

    // 获取 OpenAI 特定的声明
    const authClaims = payload['https://api.openai.com/auth'] || {}
    const accountId = authClaims.chatgpt_account_id || ''
    const chatgptUserId = authClaims.chatgpt_user_id || authClaims.user_id || ''
    const planType = authClaims.chatgpt_plan_type || ''

    // 获取组织信息
    const organizations = authClaims.organizations || []
    const defaultOrg = organizations.find((org) => org.is_default) || organizations[0] || {}
    const organizationId = defaultOrg.id || ''
    const organizationRole = defaultOrg.role || ''
    const organizationTitle = defaultOrg.title || ''

    // 清理数据库会话
    await database.deleteOAuthSession(sessionId)

    logger.success('✅ OpenAI OAuth token exchange successful')

    return res.json({
      success: true,
      data: {
        tokens: {
          idToken: id_token,
          accessToken: access_token,
          refreshToken: refresh_token,
          expires_in
        },
        accountInfo: {
          accountId,
          chatgptUserId,
          organizationId,
          organizationRole,
          organizationTitle,
          planType,
          email: payload.email || '',
          name: payload.name || '',
          emailVerified: payload.email_verified || false,
          organizations
        }
      }
    })
  } catch (error) {
    logger.error('OpenAI OAuth token exchange failed:', error)
    return res.status(500).json({
      success: false,
      message: '交换授权码失败',
      error: error.message
    })
  }
})

// 获取所有 OpenAI 账户
router.get('/openai-accounts', authenticateAdmin, async (req, res) => {
  try {
    const { platform, groupId } = req.query
    let accounts = await openaiAccountService.getAllAccounts()

    // 根据查询参数进行筛选
    if (platform && platform !== 'all' && platform !== 'openai') {
      // 如果指定了其他平台，返回空数组
      accounts = []
    }

    // 如果指定了分组筛选
    if (groupId && groupId !== 'all') {
      if (groupId === 'ungrouped') {
        // 筛选未分组账户
        accounts = accounts.filter((account) => !account.groupInfo)
      } else {
        // 筛选特定分组的账户
        accounts = accounts.filter(
          (account) => account.groupInfo && account.groupInfo.id === groupId
        )
      }
    }

    // 为每个账户添加使用统计信息
    const accountsWithStats = await Promise.all(
      accounts.map(async (account) => {
        try {
          const usageStats = await database.getAccountUsageStats(account.id)
          return {
            ...account,
            usage: {
              daily: usageStats.daily,
              total: usageStats.total,
              monthly: usageStats.monthly
            }
          }
        } catch (error) {
          logger.debug(`Failed to get usage stats for OpenAI account ${account.id}:`, error)
          return {
            ...account,
            usage: {
              daily: { requests: 0, tokens: 0, allTokens: 0 },
              total: { requests: 0, tokens: 0, allTokens: 0 },
              monthly: { requests: 0, tokens: 0, allTokens: 0 }
            }
          }
        }
      })
    )

    logger.info(`获取 OpenAI 账户列表: ${accountsWithStats.length} 个账户`)

    return res.json({
      success: true,
      data: accountsWithStats
    })
  } catch (error) {
    logger.error('获取 OpenAI 账户列表失败:', error)
    return res.status(500).json({
      success: false,
      message: '获取账户列表失败',
      error: error.message
    })
  }
})

// 创建 OpenAI 账户
router.post('/openai-accounts', authenticateAdmin, async (req, res) => {
  try {
    const {
      name,
      description,
      openaiOauth,
      accountInfo,
      proxy,
      accountType,
      groupId,
      rateLimitDuration,
      priority
    } = req.body

    if (!name) {
      return res.status(400).json({
        success: false,
        message: '账户名称不能为空'
      })
    }
    // 创建账户数据
    const accountData = {
      name,
      description: description || '',
      accountType: accountType || 'shared',
      priority: priority || 50,
      rateLimitDuration:
        rateLimitDuration !== undefined && rateLimitDuration !== null ? rateLimitDuration : 60,
      openaiOauth: openaiOauth || {},
      accountInfo: accountInfo || {},
      proxy: proxy || null,
      isActive: true,
      schedulable: true
    }

    // 创建账户
    const createdAccount = await openaiAccountService.createAccount(accountData)

    // 如果是分组类型，添加到分组
    if (accountType === 'group' && groupId) {
      await accountGroupService.addAccountToGroup(createdAccount.id, groupId, 'openai')
    }

    logger.success(`✅ 创建 OpenAI 账户成功: ${name} (ID: ${createdAccount.id})`)

    return res.json({
      success: true,
      data: createdAccount
    })
  } catch (error) {
    logger.error('创建 OpenAI 账户失败:', error)
    return res.status(500).json({
      success: false,
      message: '创建账户失败',
      error: error.message
    })
  }
})

// 更新 OpenAI 账户
router.put('/openai-accounts/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const updates = req.body

    // 验证accountType的有效性
    if (updates.accountType && !['shared', 'dedicated', 'group'].includes(updates.accountType)) {
      return res
        .status(400)
        .json({ error: 'Invalid account type. Must be "shared", "dedicated" or "group"' })
    }

    // 如果更新为分组类型，验证groupId
    if (updates.accountType === 'group' && !updates.groupId) {
      return res.status(400).json({ error: 'Group ID is required for group type accounts' })
    }

    // 获取账户当前信息以处理分组变更
    const currentAccount = await openaiAccountService.getAccount(id)
    if (!currentAccount) {
      return res.status(404).json({ error: 'Account not found' })
    }

    // 处理分组的变更
    if (updates.accountType !== undefined) {
      // 如果之前是分组类型，需要从原分组中移除
      if (currentAccount.accountType === 'group') {
        const oldGroup = await accountGroupService.getAccountGroup(id)
        if (oldGroup) {
          await accountGroupService.removeAccountFromGroup(id, oldGroup.id)
        }
      }
      // 如果新类型是分组，添加到新分组
      if (updates.accountType === 'group' && updates.groupId) {
        await accountGroupService.addAccountToGroup(id, updates.groupId, 'openai')
      }
    }

    // 准备更新数据
    const updateData = { ...updates }

    // 处理敏感数据加密
    if (updates.openaiOauth) {
      updateData.openaiOauth = updates.openaiOauth
      if (updates.openaiOauth.idToken) {
        updateData.idToken = updates.openaiOauth.idToken
      }
      if (updates.openaiOauth.accessToken) {
        updateData.accessToken = updates.openaiOauth.accessToken
      }
      if (updates.openaiOauth.refreshToken) {
        updateData.refreshToken = updates.openaiOauth.refreshToken
      }
      if (updates.openaiOauth.expires_in) {
        updateData.expiresAt = new Date(
          Date.now() + updates.openaiOauth.expires_in * 1000
        ).toISOString()
      }
    }

    // 更新账户信息
    if (updates.accountInfo) {
      updateData.accountId = updates.accountInfo.accountId || currentAccount.accountId
      updateData.chatgptUserId = updates.accountInfo.chatgptUserId || currentAccount.chatgptUserId
      updateData.organizationId =
        updates.accountInfo.organizationId || currentAccount.organizationId
      updateData.organizationRole =
        updates.accountInfo.organizationRole || currentAccount.organizationRole
      updateData.organizationTitle =
        updates.accountInfo.organizationTitle || currentAccount.organizationTitle
      updateData.planType = updates.accountInfo.planType || currentAccount.planType
      updateData.email = updates.accountInfo.email || currentAccount.email
      updateData.emailVerified =
        updates.accountInfo.emailVerified !== undefined
          ? updates.accountInfo.emailVerified
          : currentAccount.emailVerified
    }

    const updatedAccount = await openaiAccountService.updateAccount(id, updateData)

    logger.success(`📝 Admin updated OpenAI account: ${id}`)
    return res.json({ success: true, data: updatedAccount })
  } catch (error) {
    logger.error('❌ Failed to update OpenAI account:', error)
    return res.status(500).json({ error: 'Failed to update account', message: error.message })
  }
})

// 删除 OpenAI 账户
router.delete('/openai-accounts/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params

    const account = await openaiAccountService.getAccount(id)
    if (!account) {
      return res.status(404).json({
        success: false,
        message: '账户不存在'
      })
    }

    // 如果账户在分组中，从分组中移除
    if (account.accountType === 'group') {
      const group = await accountGroupService.getAccountGroup(id)
      if (group) {
        await accountGroupService.removeAccountFromGroup(id, group.id)
      }
    }

    await openaiAccountService.deleteAccount(id)

    logger.success(`✅ 删除 OpenAI 账户成功: ${account.name} (ID: ${id})`)

    return res.json({
      success: true,
      message: '账户删除成功'
    })
  } catch (error) {
    logger.error('删除 OpenAI 账户失败:', error)
    return res.status(500).json({
      success: false,
      message: '删除账户失败',
      error: error.message
    })
  }
})

// 切换 OpenAI 账户状态
router.put('/openai-accounts/:id/toggle', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params

    const account = await database.getOpenAiAccount(id)
    if (!account) {
      return res.status(404).json({
        success: false,
        message: '账户不存在'
      })
    }

    // 切换启用状态
    account.enabled = !account.enabled
    account.updatedAt = new Date().toISOString()

    // TODO: 更新方法
    // await database.updateOpenAiAccount(id, account)

    logger.success(
      `✅ ${account.enabled ? '启用' : '禁用'} OpenAI 账户: ${account.name} (ID: ${id})`
    )

    return res.json({
      success: true,
      data: account
    })
  } catch (error) {
    logger.error('切换 OpenAI 账户状态失败:', error)
    return res.status(500).json({
      success: false,
      message: '切换账户状态失败',
      error: error.message
    })
  }
})

// 切换 OpenAI 账户调度状态
router.put(
  '/openai-accounts/:accountId/toggle-schedulable',
  authenticateAdmin,
  async (req, res) => {
    try {
      const { accountId } = req.params

      const result = await openaiAccountService.toggleSchedulable(accountId)

      // 如果账号被禁用，发送webhook通知
      if (!result.schedulable) {
        // 获取账号信息
        const account = await database.getOpenAiAccount(accountId)
        if (account) {
          await webhookNotifier.sendAccountAnomalyNotification({
            accountId: account.id,
            accountName: account.name || 'OpenAI Account',
            platform: 'openai',
            status: 'disabled',
            errorCode: 'OPENAI_MANUALLY_DISABLED',
            reason: '账号已被管理员手动禁用调度',
            timestamp: new Date().toISOString()
          })
        }
      }

      return res.json({
        success: result.success,
        schedulable: result.schedulable,
        message: result.schedulable ? '已启用调度' : '已禁用调度'
      })
    } catch (error) {
      logger.error('切换 OpenAI 账户调度状态失败:', error)
      return res.status(500).json({
        success: false,
        message: '切换调度状态失败',
        error: error.message
      })
    }
  }
)

// 🌐 Azure OpenAI 账户管理

// 获取所有 Azure OpenAI 账户
router.get('/azure-openai-accounts', authenticateAdmin, async (req, res) => {
  try {
    const accounts = await azureOpenaiAccountService.getAllAccounts()
    res.json({
      success: true,
      data: accounts
    })
  } catch (error) {
    logger.error('Failed to fetch Azure OpenAI accounts:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch accounts',
      error: error.message
    })
  }
})

// 创建 Azure OpenAI 账户
router.post('/azure-openai-accounts', authenticateAdmin, async (req, res) => {
  try {
    const {
      name,
      description,
      accountType,
      azureEndpoint,
      apiVersion,
      deploymentName,
      apiKey,
      supportedModels,
      proxy,
      groupId,
      priority,
      isActive,
      schedulable
    } = req.body

    // 验证必填字段
    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Account name is required'
      })
    }

    if (!azureEndpoint) {
      return res.status(400).json({
        success: false,
        message: 'Azure endpoint is required'
      })
    }

    if (!apiKey) {
      return res.status(400).json({
        success: false,
        message: 'API key is required'
      })
    }

    if (!deploymentName) {
      return res.status(400).json({
        success: false,
        message: 'Deployment name is required'
      })
    }

    // 验证 Azure endpoint 格式
    if (!azureEndpoint.match(/^https:\/\/[\w-]+\.openai\.azure\.com$/)) {
      return res.status(400).json({
        success: false,
        message:
          'Invalid Azure OpenAI endpoint format. Expected: https://your-resource.openai.azure.com'
      })
    }

    // 测试连接
    try {
      const testUrl = `${azureEndpoint}/openai/deployments/${deploymentName}?api-version=${apiVersion || '2024-02-01'}`
      await axios.get(testUrl, {
        headers: {
          'api-key': apiKey
        },
        timeout: 5000
      })
    } catch (testError) {
      if (testError.response?.status === 404) {
        logger.warn('Azure OpenAI deployment not found, but continuing with account creation')
      } else if (testError.response?.status === 401) {
        return res.status(400).json({
          success: false,
          message: 'Invalid API key or unauthorized access'
        })
      }
    }

    const account = await azureOpenaiAccountService.createAccount({
      name,
      description,
      accountType: accountType || 'shared',
      azureEndpoint,
      apiVersion: apiVersion || '2024-02-01',
      deploymentName,
      apiKey,
      supportedModels,
      proxy,
      groupId,
      priority: priority || 50,
      isActive: isActive !== false,
      schedulable: schedulable !== false
    })

    res.json({
      success: true,
      data: account,
      message: 'Azure OpenAI account created successfully'
    })
  } catch (error) {
    logger.error('Failed to create Azure OpenAI account:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to create account',
      error: error.message
    })
  }
})

// 更新 Azure OpenAI 账户
router.put('/azure-openai-accounts/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const updates = req.body

    const account = await azureOpenaiAccountService.updateAccount(id, updates)

    res.json({
      success: true,
      data: account,
      message: 'Azure OpenAI account updated successfully'
    })
  } catch (error) {
    logger.error('Failed to update Azure OpenAI account:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to update account',
      error: error.message
    })
  }
})

// 删除 Azure OpenAI 账户
router.delete('/azure-openai-accounts/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params

    await azureOpenaiAccountService.deleteAccount(id)

    res.json({
      success: true,
      message: 'Azure OpenAI account deleted successfully'
    })
  } catch (error) {
    logger.error('Failed to delete Azure OpenAI account:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to delete account',
      error: error.message
    })
  }
})

// 切换 Azure OpenAI 账户状态
router.put('/azure-openai-accounts/:id/toggle', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params

    const account = await azureOpenaiAccountService.getAccount(id)
    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found'
      })
    }

    const newStatus = account.isActive === 'true' ? 'false' : 'true'
    await azureOpenaiAccountService.updateAccount(id, { isActive: newStatus })

    res.json({
      success: true,
      message: `Account ${newStatus === 'true' ? 'activated' : 'deactivated'} successfully`,
      isActive: newStatus === 'true'
    })
  } catch (error) {
    logger.error('Failed to toggle Azure OpenAI account status:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to toggle account status',
      error: error.message
    })
  }
})

// 切换 Azure OpenAI 账户调度状态
router.put(
  '/azure-openai-accounts/:accountId/toggle-schedulable',
  authenticateAdmin,
  async (req, res) => {
    try {
      const { accountId } = req.params

      const result = await azureOpenaiAccountService.toggleSchedulable(accountId)

      // 如果账号被禁用，发送webhook通知
      if (!result.schedulable) {
        // 获取账号信息
        const account = await azureOpenaiAccountService.getAccount(accountId)
        if (account) {
          await webhookNotifier.sendAccountAnomalyNotification({
            accountId: account.id,
            accountName: account.name || 'Azure OpenAI Account',
            platform: 'azure-openai',
            status: 'disabled',
            errorCode: 'AZURE_OPENAI_MANUALLY_DISABLED',
            reason: '账号已被管理员手动禁用调度',
            timestamp: new Date().toISOString()
          })
        }
      }

      return res.json({
        success: true,
        schedulable: result.schedulable,
        message: result.schedulable ? '已启用调度' : '已禁用调度'
      })
    } catch (error) {
      logger.error('切换 Azure OpenAI 账户调度状态失败:', error)
      return res.status(500).json({
        success: false,
        message: '切换调度状态失败',
        error: error.message
      })
    }
  }
)

// 健康检查单个 Azure OpenAI 账户
router.post('/azure-openai-accounts/:id/health-check', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const healthResult = await azureOpenaiAccountService.healthCheckAccount(id)

    res.json({
      success: true,
      data: healthResult
    })
  } catch (error) {
    logger.error('Failed to perform health check:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to perform health check',
      error: error.message
    })
  }
})

// 批量健康检查所有 Azure OpenAI 账户
router.post('/azure-openai-accounts/health-check-all', authenticateAdmin, async (req, res) => {
  try {
    const healthResults = await azureOpenaiAccountService.performHealthChecks()

    res.json({
      success: true,
      data: healthResults
    })
  } catch (error) {
    logger.error('Failed to perform batch health check:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to perform batch health check',
      error: error.message
    })
  }
})

// 迁移 API Keys 以支持 Azure OpenAI
router.post('/migrate-api-keys-azure', authenticateAdmin, async (req, res) => {
  try {
    const migratedCount = await azureOpenaiAccountService.migrateApiKeysForAzureSupport()

    res.json({
      success: true,
      message: `Successfully migrated ${migratedCount} API keys for Azure OpenAI support`
    })
  } catch (error) {
    logger.error('Failed to migrate API keys:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to migrate API keys',
      error: error.message
    })
  }
})

// 🎯 系统调度配置管理

// 获取系统调度配置
router.get('/scheduling/config', authenticateAdmin, async (req, res) => {
  try {
    const schedulingConfig = await database.getSystemSchedulingConfig()

    return res.json({
      success: true,
      data: schedulingConfig
    })
  } catch (error) {
    logger.error('❌ Failed to get system scheduling config:', error)
    return res.status(500).json({
      error: 'Failed to get system scheduling config',
      message: error.message
    })
  }
})

// 获取系统调度统计信息
router.get('/scheduling/stats', authenticateAdmin, async (req, res) => {
  try {
    // 获取所有Claude账户
    const claudeAccounts = await claudeAccountService.getAllAccounts()

    // 获取所有账户组
    const accountGroups = await accountGroupService.getAllGroups()

    // 获取系统默认调度策略
    const schedulingConfig = await database.getSystemSchedulingConfig()
    const globalDefaultStrategy = schedulingConfig?.defaultStrategy || 'least_recent'

    // 计算使用全局策略的账户数量（没有设置自定义策略或策略为空）
    const globalStrategyCount = claudeAccounts.filter(
      (account) =>
        !account.schedulingStrategy ||
        account.schedulingStrategy === '' ||
        account.schedulingStrategy === globalDefaultStrategy
    ).length

    // 计算使用自定义策略的账户数量
    const customStrategyCount = claudeAccounts.filter(
      (account) =>
        account.schedulingStrategy &&
        account.schedulingStrategy !== '' &&
        account.schedulingStrategy !== globalDefaultStrategy
    ).length

    // 分组策略数量就是账户组的数量
    const groupStrategyCount = accountGroups.length

    return res.json({
      success: true,
      stats: {
        globalStrategyCount,
        customStrategyCount,
        groupStrategyCount
      }
    })
  } catch (error) {
    logger.error('❌ Failed to get scheduling stats:', error)
    return res.status(500).json({
      error: 'Failed to get scheduling stats',
      message: error.message
    })
  }
})

// 更新系统调度配置
router.post('/scheduling/config', authenticateAdmin, async (req, res) => {
  try {
    const {
      globalDefaultStrategy,
      globalDefaultWeight,
      globalDefaultOrder,
      enableAccountOverride,
      enableGroupOverride,
      // 支持旧格式
      defaultStrategy
    } = req.body

    // 兼容新旧字段格式
    const strategy = globalDefaultStrategy || defaultStrategy

    // 验证调度策略
    if (strategy && !schedulingValidator.isValidSchedulingStrategy(strategy)) {
      return res.status(400).json({
        error: 'Invalid scheduling strategy',
        message: `Must be one of: ${schedulingValidator.VALID_SCHEDULING_STRATEGIES.join(', ')}`
      })
    }

    // 准备配置数据
    const configData = {}

    if (strategy !== undefined) {
      configData.defaultStrategy = strategy
    }

    if (globalDefaultWeight !== undefined) {
      configData.globalDefaultWeight = globalDefaultWeight.toString()
    }

    if (globalDefaultOrder !== undefined) {
      configData.globalDefaultOrder = globalDefaultOrder.toString()
    }

    if (enableAccountOverride !== undefined) {
      configData.enableAccountOverride = enableAccountOverride.toString()
    }

    if (enableGroupOverride !== undefined) {
      configData.enableGroupOverride = enableGroupOverride.toString()
    }

    // 更新配置
    await database.setSystemSchedulingConfig(configData)

    // 获取更新后的完整配置
    const updatedConfig = await database.getSystemSchedulingConfig()

    logger.success(`✅ System scheduling configuration updated by admin`)

    return res.json({
      success: true,
      message: 'System scheduling configuration updated successfully',
      data: updatedConfig
    })
  } catch (error) {
    logger.error('❌ Failed to update system scheduling config:', error)
    return res.status(500).json({
      error: 'Failed to update system scheduling config',
      message: error.message
    })
  }
})

// 重置系统调度配置
router.post('/scheduling/config/reset', authenticateAdmin, async (req, res) => {
  try {
    // 删除现有配置，让系统使用默认值
    await database.deleteSystemSchedulingConfig()

    // 获取重置后的配置（会返回默认配置）
    const defaultConfig = await database.getSystemSchedulingConfig()

    logger.success(`✅ System scheduling configuration reset to defaults by admin`)

    return res.json({
      success: true,
      message: 'System scheduling configuration reset to defaults successfully',
      data: defaultConfig
    })
  } catch (error) {
    logger.error('❌ Failed to reset system scheduling config:', error)
    return res.status(500).json({
      error: 'Failed to reset system scheduling config',
      message: error.message
    })
  }
})

// ==================== 其他平台费用统计端点 ====================

// 获取Bedrock账户费用统计
router.get('/bedrock-accounts/:accountId/cost-stats', authenticateAdmin, async (req, res) => {
  try {
    const { accountId } = req.params
    const { period } = req.query

    logger.debug(`📊 获取Bedrock账户费用统计: ${accountId}, period: ${period || 'all'}`)

    // 验证账户是否存在
    const accountResult = await bedrockAccountService.getAccount(accountId)
    if (!accountResult.success) {
      return res.status(404).json({
        success: false,
        error: 'Account not found',
        message: '指定的账户不存在'
      })
    }

    // 获取费用统计
    const costStats = await bedrockAccountService.getAccountCostStats(accountId, {
      period: period || 'all'
    })

    logger.success(
      `📊 成功获取Bedrock账户费用统计: ${accountId} - $${(costStats.totalCost || 0).toFixed(6)}`
    )

    return res.json({
      success: true,
      data: costStats
    })
  } catch (error) {
    logger.error(`❌ 获取Bedrock账户费用统计失败 (${req.params.accountId}):`, error)
    return res.status(500).json({
      success: false,
      error: 'Failed to get account cost stats',
      message: error.message
    })
  }
})

// 获取OpenAI账户费用统计
router.get('/openai-accounts/:accountId/cost-stats', authenticateAdmin, async (req, res) => {
  try {
    const { accountId } = req.params
    const { period } = req.query

    logger.debug(`📊 获取OpenAI账户费用统计: ${accountId}, period: ${period || 'all'}`)

    // 验证账户是否存在
    const account = await openaiAccountService.getAccount(accountId)
    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Account not found',
        message: '指定的账户不存在'
      })
    }

    // 获取费用统计
    const costStats = await openaiAccountService.getAccountCostStats(accountId, {
      period: period || 'all'
    })

    logger.success(
      `📊 成功获取OpenAI账户费用统计: ${accountId} - $${(costStats.totalCost || 0).toFixed(6)}`
    )

    return res.json({
      success: true,
      data: costStats
    })
  } catch (error) {
    logger.error(`❌ 获取OpenAI账户费用统计失败 (${req.params.accountId}):`, error)
    return res.status(500).json({
      success: false,
      error: 'Failed to get account cost stats',
      message: error.message
    })
  }
})

// 获取Azure OpenAI账户费用统计
router.get('/azure-openai-accounts/:accountId/cost-stats', authenticateAdmin, async (req, res) => {
  try {
    const { accountId } = req.params
    const { period } = req.query

    logger.debug(`📊 获取Azure OpenAI账户费用统计: ${accountId}, period: ${period || 'all'}`)

    // 验证账户是否存在
    const account = await azureOpenaiAccountService.getAccount(accountId)
    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Account not found',
        message: '指定的账户不存在'
      })
    }

    // 获取费用统计
    const costStats = await azureOpenaiAccountService.getAccountCostStats(accountId, {
      period: period || 'all'
    })

    logger.success(
      `📊 成功获取Azure OpenAI账户费用统计: ${accountId} - $${(costStats.totalCost || 0).toFixed(6)}`
    )

    return res.json({
      success: true,
      data: costStats
    })
  } catch (error) {
    logger.error(`❌ 获取Azure OpenAI账户费用统计失败 (${req.params.accountId}):`, error)
    return res.status(500).json({
      success: false,
      error: 'Failed to get account cost stats',
      message: error.message
    })
  }
})

// 👥 用户管理系统
// ====================================

// 获取用户列表（分页、搜索、过滤）
router.get('/users', authenticateAdmin, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      status = '',
      role = '',
      authMethod = '',
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query

    // 参数验证
    const pageNum = Math.max(1, parseInt(page))
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)))
    const offset = (pageNum - 1) * limitNum

    // 构建搜索和过滤条件
    const filters = {
      search: search.trim(),
      status: status || undefined,
      role: role || undefined,
      authMethod: authMethod || undefined
    }

    // 获取用户列表
    const result = await userService.getUserList({
      offset,
      limit: limitNum,
      filters,
      sortBy,
      sortOrder
    })

    logger.info(
      `👥 管理员 ${req.user?.id} 查看用户列表: page=${pageNum}, limit=${limitNum}, total=${result.total}`
    )

    return res.json({
      success: true,
      data: {
        users: result.users,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: result.total,
          pages: Math.ceil(result.total / limitNum)
        },
        filters: {
          applied: Object.keys(filters).filter((k) => filters[k] !== undefined),
          available: {
            status: ['active', 'inactive', 'locked', 'suspended'],
            role: ['admin', 'user', 'viewer'],
            authMethod: ['local', 'ldap']
          }
        }
      }
    })
  } catch (error) {
    logger.error('❌ 获取用户列表失败:', error)
    return res.status(500).json({
      success: false,
      error: 'Failed to get users list',
      message: error.message
    })
  }
})

// 获取用户详情
router.get('/users/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params

    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      })
    }

    const user = await userService.getUserById(id)
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      })
    }

    // 获取用户会话信息
    const sessions = await userService.getUserSessions(id)
    const stats = await userService.getUserStats(id)

    logger.info(`👤 管理员 ${req.user?.id} 查看用户详情: ${id}`)

    return res.json({
      success: true,
      data: {
        user,
        sessions: {
          active: sessions.filter((s) => s.isActive).length,
          total: sessions.length,
          lastActivity: sessions.length > 0 ? sessions[0].lastActivity : null
        },
        stats
      }
    })
  } catch (error) {
    logger.error(`❌ 获取用户详情失败 (${req.params.id}):`, error)
    return res.status(500).json({
      success: false,
      error: 'Failed to get user details',
      message: error.message
    })
  }
})

// 创建新用户
router.post('/users', authenticateAdmin, async (req, res) => {
  try {
    const {
      username,
      password,
      email,
      fullName,
      role = 'user',
      authMethod = 'local',
      status = 'active',
      metadata = {}
    } = req.body

    // 输入验证
    if (!username || typeof username !== 'string' || username.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Username is required and must be a non-empty string'
      })
    }

    if (username.length < 3 || username.length > 50) {
      return res.status(400).json({
        success: false,
        error: 'Username must be between 3 and 50 characters'
      })
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      return res.status(400).json({
        success: false,
        error: 'Username can only contain letters, numbers, underscores, and hyphens'
      })
    }

    if (authMethod === 'local' && (!password || password.length < 6)) {
      return res.status(400).json({
        success: false,
        error: 'Password is required for local authentication and must be at least 6 characters'
      })
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format'
      })
    }

    if (!['admin', 'user', 'viewer'].includes(role)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid role. Must be admin, user, or viewer'
      })
    }

    if (!['local', 'ldap'].includes(authMethod)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid auth method. Must be local or ldap'
      })
    }

    if (!['active', 'inactive', 'locked', 'suspended'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status. Must be active, inactive, locked, or suspended'
      })
    }

    // 创建用户
    const userData = {
      username: username.trim(),
      password,
      email: email?.trim(),
      fullName: fullName?.trim(),
      role,
      authMethod,
      status,
      metadata
    }

    const newUser = await userService.createUser(userData)

    logger.info(`✅ 管理员 ${req.user?.id} 创建用户: ${newUser.username} (${newUser.id})`)

    return res.status(201).json({
      success: true,
      data: {
        user: newUser,
        message: 'User created successfully'
      }
    })
  } catch (error) {
    logger.error('❌ 创建用户失败:', error)

    if (error.message.includes('already exists')) {
      return res.status(409).json({
        success: false,
        error: 'User already exists',
        message: error.message
      })
    }

    return res.status(500).json({
      success: false,
      error: 'Failed to create user',
      message: error.message
    })
  }
})

// 更新用户信息
router.put('/users/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { username, email, fullName, role, status, authMethod, metadata } = req.body

    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      })
    }

    // 检查用户是否存在
    const existingUser = await userService.getUserById(id)
    if (!existingUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      })
    }

    // 输入验证
    const updates = {}

    if (username !== undefined) {
      if (!username || typeof username !== 'string' || username.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Username must be a non-empty string'
        })
      }
      if (username.length < 3 || username.length > 50) {
        return res.status(400).json({
          success: false,
          error: 'Username must be between 3 and 50 characters'
        })
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
        return res.status(400).json({
          success: false,
          error: 'Username can only contain letters, numbers, underscores, and hyphens'
        })
      }
      updates.username = username.trim()
    }

    if (email !== undefined) {
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid email format'
        })
      }
      updates.email = email?.trim() || null
    }

    if (fullName !== undefined) {
      updates.fullName = fullName?.trim() || null
    }

    if (role !== undefined) {
      if (!['admin', 'user', 'viewer'].includes(role)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid role. Must be admin, user, or viewer'
        })
      }
      updates.role = role
    }

    if (status !== undefined) {
      if (!['active', 'inactive', 'locked', 'suspended'].includes(status)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid status. Must be active, inactive, locked, or suspended'
        })
      }
      updates.status = status
    }

    if (authMethod !== undefined) {
      if (!['local', 'ldap'].includes(authMethod)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid auth method. Must be local or ldap'
        })
      }
      updates.authMethod = authMethod
    }

    if (metadata !== undefined) {
      updates.metadata = metadata || {}
    }

    // 防止自己修改自己的角色和状态（安全措施）
    if (req.user?.id === id) {
      if (updates.role && updates.role !== existingUser.role) {
        return res.status(403).json({
          success: false,
          error: 'Cannot change your own role'
        })
      }
      if (updates.status && updates.status !== existingUser.status) {
        return res.status(403).json({
          success: false,
          error: 'Cannot change your own status'
        })
      }
    }

    const updatedUser = await userService.updateUser(id, updates)

    logger.info(`📝 管理员 ${req.user?.id} 更新用户: ${id} (${Object.keys(updates).join(', ')})`)

    return res.json({
      success: true,
      data: {
        user: updatedUser,
        message: 'User updated successfully'
      }
    })
  } catch (error) {
    logger.error(`❌ 更新用户失败 (${req.params.id}):`, error)

    if (error.message.includes('already exists')) {
      return res.status(409).json({
        success: false,
        error: 'Username already exists',
        message: error.message
      })
    }

    return res.status(500).json({
      success: false,
      error: 'Failed to update user',
      message: error.message
    })
  }
})

// 删除用户
router.delete('/users/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params

    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      })
    }

    // 检查用户是否存在
    const existingUser = await userService.getUserById(id)
    if (!existingUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      })
    }

    // 防止删除自己
    if (req.user?.id === id) {
      return res.status(403).json({
        success: false,
        error: 'Cannot delete your own account'
      })
    }

    // 软删除用户（保留数据但标记为已删除）
    await userService.deleteUser(id, { soft: true })

    logger.warn(`🗑️ 管理员 ${req.user?.id} 删除用户: ${existingUser.username} (${id})`)

    return res.json({
      success: true,
      data: {
        message: 'User deleted successfully',
        deletedUser: {
          id: existingUser.id,
          username: existingUser.username
        }
      }
    })
  } catch (error) {
    logger.error(`❌ 删除用户失败 (${req.params.id}):`, error)
    return res.status(500).json({
      success: false,
      error: 'Failed to delete user',
      message: error.message
    })
  }
})

// 重置用户密码
router.post('/users/:id/reset-password', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { newPassword, forceChange = true } = req.body

    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      })
    }

    // 检查用户是否存在
    const existingUser = await userService.getUserById(id)
    if (!existingUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      })
    }

    // 验证用户认证方式
    if (existingUser.authMethod !== 'local') {
      return res.status(400).json({
        success: false,
        error: 'Password reset is only available for local authentication users'
      })
    }

    // 密码验证
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'New password must be at least 6 characters long'
      })
    }

    if (newPassword.length > 128) {
      return res.status(400).json({
        success: false,
        error: 'Password cannot exceed 128 characters'
      })
    }

    // 重置密码
    const result = await userService.resetPassword(id, {
      newPassword,
      forceChange: Boolean(forceChange),
      adminReset: true,
      adminId: req.user?.id
    })

    logger.security(`🔑 管理员 ${req.user?.id} 重置用户密码: ${existingUser.username} (${id})`)

    return res.json({
      success: true,
      data: {
        message: 'Password reset successfully',
        forceChange: result.forceChange,
        expiresAt: result.expiresAt
      }
    })
  } catch (error) {
    logger.error(`❌ 重置用户密码失败 (${req.params.id}):`, error)
    return res.status(500).json({
      success: false,
      error: 'Failed to reset password',
      message: error.message
    })
  }
})

// 解锁用户账户
router.post('/users/:id/unlock', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params

    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      })
    }

    // 检查用户是否存在
    const existingUser = await userService.getUserById(id)
    if (!existingUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      })
    }

    // 解锁账户
    const result = await userService.unlockUser(id, {
      adminId: req.user?.id,
      reason: 'Admin unlock'
    })

    logger.security(`🔓 管理员 ${req.user?.id} 解锁用户账户: ${existingUser.username} (${id})`)

    return res.json({
      success: true,
      data: {
        message: 'User account unlocked successfully',
        user: {
          id: result.user.id,
          username: result.user.username,
          status: result.user.status,
          failedLoginAttempts: result.user.failedLoginAttempts,
          lockedUntil: result.user.lockedUntil
        }
      }
    })
  } catch (error) {
    logger.error(`❌ 解锁用户账户失败 (${req.params.id}):`, error)

    if (error.message.includes('not locked')) {
      return res.status(400).json({
        success: false,
        error: 'User account is not locked',
        message: error.message
      })
    }

    return res.status(500).json({
      success: false,
      error: 'Failed to unlock user account',
      message: error.message
    })
  }
})

// 获取用户会话列表
router.get('/users/:id/sessions', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { includeExpired = 'false', limit = 50 } = req.query

    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      })
    }

    // 检查用户是否存在
    const existingUser = await userService.getUserById(id)
    if (!existingUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      })
    }

    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50))

    const sessions = await userService.getUserSessions(id, {
      includeExpired: includeExpired === 'true',
      limit: limitNum
    })

    logger.info(`🎫 管理员 ${req.user?.id} 查看用户会话: ${existingUser.username} (${id})`)

    return res.json({
      success: true,
      data: {
        user: {
          id: existingUser.id,
          username: existingUser.username
        },
        sessions,
        summary: {
          total: sessions.length,
          active: sessions.filter((s) => s.isActive).length,
          expired: sessions.filter((s) => !s.isActive).length
        }
      }
    })
  } catch (error) {
    logger.error(`❌ 获取用户会话失败 (${req.params.id}):`, error)
    return res.status(500).json({
      success: false,
      error: 'Failed to get user sessions',
      message: error.message
    })
  }
})

// 删除特定会话
router.delete('/users/:id/sessions/:sessionId', authenticateAdmin, async (req, res) => {
  try {
    const { id, sessionId } = req.params

    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      })
    }

    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Session ID is required'
      })
    }

    // 检查用户是否存在
    const existingUser = await userService.getUserById(id)
    if (!existingUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      })
    }

    // 防止管理员删除自己的当前会话
    if (req.user?.id === id && req.user?.sessionId === sessionId) {
      return res.status(403).json({
        success: false,
        error: 'Cannot delete your own current session'
      })
    }

    // 删除会话
    const result = await userService.invalidateSession(sessionId, {
      adminAction: true,
      adminId: req.user?.id,
      userId: id
    })

    if (!result.found) {
      return res.status(404).json({
        success: false,
        error: 'Session not found or already expired'
      })
    }

    logger.security(
      `🎫❌ 管理员 ${req.user?.id} 删除用户会话: ${existingUser.username} (session: ${sessionId})`
    )

    return res.json({
      success: true,
      data: {
        message: 'Session deleted successfully',
        sessionId,
        user: {
          id: existingUser.id,
          username: existingUser.username
        }
      }
    })
  } catch (error) {
    logger.error(
      `❌ 删除用户会话失败 (user: ${req.params.id}, session: ${req.params.sessionId}):`,
      error
    )
    return res.status(500).json({
      success: false,
      error: 'Failed to delete session',
      message: error.message
    })
  }
})

// ==================== 👥 Group Management Routes ====================

// 获取所有组列表（支持分页和搜索）
router.get('/groups', authenticateAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 20, search, parentId, includeInactive = false } = req.query

    logger.debug('📋 Getting groups list', {
      page: parseInt(page),
      limit: parseInt(limit),
      search,
      parentId,
      includeInactive: includeInactive === 'true'
    })

    // 获取所有组
    const allGroups = await groupService.getAllGroups({
      includeInactive: includeInactive === 'true',
      parentId: parentId || undefined
    })

    // 应用搜索过滤
    let filteredGroups = allGroups
    if (search) {
      const searchLower = search.toLowerCase()
      filteredGroups = allGroups.filter(
        (group) =>
          group.name.toLowerCase().includes(searchLower) ||
          (group.description && group.description.toLowerCase().includes(searchLower))
      )
    }

    // 分页
    const pageInt = parseInt(page)
    const limitInt = parseInt(limit)
    const startIndex = (pageInt - 1) * limitInt
    const endIndex = startIndex + limitInt

    const paginatedGroups = filteredGroups.slice(startIndex, endIndex)

    // 为每个组添加额外的统计信息
    const groupsWithStats = await Promise.all(
      paginatedGroups.map(async (group) => {
        try {
          const members = await groupService.getGroupMembers(group.id)
          const accounts = await groupService.getGroupAccounts(group.id)

          const accountCount =
            (accounts.claudeAccounts?.length || 0) +
            (accounts.geminiAccounts?.length || 0) +
            (accounts.openaiAccounts?.length || 0)

          return {
            ...group,
            memberCount: members.length,
            accountCount,
            hasParent: !!group.parentId,
            childCount: allGroups.filter((g) => g.parentId === group.id).length
          }
        } catch (error) {
          logger.warn(`⚠️ Failed to get stats for group ${group.id}:`, error.message)
          return {
            ...group,
            memberCount: 0,
            accountCount: 0,
            hasParent: !!group.parentId,
            childCount: 0
          }
        }
      })
    )

    const response = {
      success: true,
      data: {
        groups: groupsWithStats,
        pagination: {
          page: pageInt,
          limit: limitInt,
          total: filteredGroups.length,
          totalPages: Math.ceil(filteredGroups.length / limitInt),
          hasNext: endIndex < filteredGroups.length,
          hasPrev: pageInt > 1
        }
      }
    }

    logger.success(`📋 Successfully retrieved ${groupsWithStats.length} groups`)
    return res.json(response)
  } catch (error) {
    logger.error('❌ Failed to get groups:', error)
    return res.status(500).json({
      success: false,
      error: 'Failed to get groups',
      message: error.message
    })
  }
})

// 获取单个组详情
router.get('/groups/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Group ID is required'
      })
    }

    logger.debug(`📄 Getting group details for: ${id}`)

    const group = await groupService.getGroupById(id)
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found'
      })
    }

    // 获取组的详细信息
    const [members, accounts, parentGroup, childGroups] = await Promise.all([
      groupService.getGroupMembers(id),
      groupService.getGroupAccounts(id),
      group.parentId ? groupService.getGroupById(group.parentId) : null,
      groupService.getAllGroups().then((allGroups) => allGroups.filter((g) => g.parentId === id))
    ])

    // 构建详细响应
    const detailedGroup = {
      ...group,
      members,
      accounts,
      parentGroup: parentGroup
        ? {
            id: parentGroup.id,
            name: parentGroup.name,
            description: parentGroup.description
          }
        : null,
      childGroups: childGroups.map((child) => ({
        id: child.id,
        name: child.name,
        description: child.description,
        isActive: child.isActive
      })),
      statistics: {
        memberCount: members.length,
        accountCount:
          (accounts.claudeAccounts?.length || 0) +
          (accounts.geminiAccounts?.length || 0) +
          (accounts.openaiAccounts?.length || 0),
        childCount: childGroups.length
      }
    }

    logger.success(`📄 Successfully retrieved group details: ${group.name}`)
    return res.json({
      success: true,
      data: detailedGroup
    })
  } catch (error) {
    logger.error(`❌ Failed to get group ${req.params.id}:`, error)
    return res.status(500).json({
      success: false,
      error: 'Failed to get group details',
      message: error.message
    })
  }
})

// 创建新组
router.post('/groups', authenticateAdmin, async (req, res) => {
  try {
    const {
      name,
      description,
      parentId,
      permissions,
      accounts,
      schedulingConfig,
      isActive = true
    } = req.body

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Group name is required'
      })
    }

    logger.debug('🏢 Creating new group', {
      name,
      parentId,
      hasPermissions: !!permissions,
      hasAccounts: !!accounts,
      hasSchedulingConfig: !!schedulingConfig
    })

    // 准备组数据
    const groupData = {
      name: name.trim(),
      description: description?.trim() || '',
      parentId: parentId || null,
      permissions: permissions || {},
      accounts: accounts || {},
      schedulingConfig: schedulingConfig || {},
      isActive,
      createdBy: req.user?.id || 'admin'
    }

    // 创建组
    const result = await groupService.createGroup(groupData)

    logger.success(`🏢 Successfully created group: ${result.name} (${result.id})`)
    return res.status(201).json({
      success: true,
      data: result,
      message: `Group '${result.name}' created successfully`
    })
  } catch (error) {
    logger.error('❌ Failed to create group:', error)

    // 提供更具体的错误信息
    let statusCode = 500
    const errorMessage = error.message

    if (error.message.includes('already exists')) {
      statusCode = 409
    } else if (error.message.includes('not found')) {
      statusCode = 404
    } else if (error.message.includes('Invalid') || error.message.includes('required')) {
      statusCode = 400
    }

    return res.status(statusCode).json({
      success: false,
      error: 'Failed to create group',
      message: errorMessage
    })
  }
})

// 更新组信息
router.put('/groups/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const updateData = req.body

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Group ID is required'
      })
    }

    // 移除不允许直接更新的字段
    const restrictedFields = ['id', 'createdAt', 'createdBy', 'members']
    for (const field of restrictedFields) {
      delete updateData[field]
    }

    logger.debug(`📝 Updating group: ${id}`, {
      hasName: !!updateData.name,
      hasDescription: !!updateData.description,
      hasPermissions: !!updateData.permissions,
      hasAccounts: !!updateData.accounts,
      hasSchedulingConfig: !!updateData.schedulingConfig
    })

    // 验证组是否存在
    const existingGroup = await groupService.getGroupById(id)
    if (!existingGroup) {
      return res.status(404).json({
        success: false,
        error: 'Group not found'
      })
    }

    // 更新组
    await groupService.updateGroup(id, updateData)

    // 获取更新后的组信息
    const updatedGroup = await groupService.getGroupById(id)

    logger.success(`📝 Successfully updated group: ${updatedGroup.name} (${id})`)
    return res.json({
      success: true,
      data: updatedGroup,
      message: `Group '${updatedGroup.name}' updated successfully`
    })
  } catch (error) {
    logger.error(`❌ Failed to update group ${req.params.id}:`, error)

    let statusCode = 500
    const errorMessage = error.message

    if (error.message.includes('not found')) {
      statusCode = 404
    } else if (error.message.includes('already exists')) {
      statusCode = 409
    } else if (error.message.includes('Invalid') || error.message.includes('circular')) {
      statusCode = 400
    }

    return res.status(statusCode).json({
      success: false,
      error: 'Failed to update group',
      message: errorMessage
    })
  }
})

// 删除组
router.delete('/groups/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { force = false } = req.query

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Group ID is required'
      })
    }

    logger.debug(`🗑️ Deleting group: ${id}`, { force: force === 'true' })

    // 验证组是否存在
    const group = await groupService.getGroupById(id)
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found'
      })
    }

    // 删除组
    await groupService.deleteGroup(id, force === 'true')

    logger.success(`🗑️ Successfully deleted group: ${group.name} (${id})`)
    return res.json({
      success: true,
      message: `Group '${group.name}' deleted successfully`
    })
  } catch (error) {
    logger.error(`❌ Failed to delete group ${req.params.id}:`, error)

    let statusCode = 500
    const errorMessage = error.message

    if (error.message.includes('not found')) {
      statusCode = 404
    } else if (
      error.message.includes('has') &&
      (error.message.includes('members') || error.message.includes('child'))
    ) {
      statusCode = 409
    }

    return res.status(statusCode).json({
      success: false,
      error: 'Failed to delete group',
      message: errorMessage
    })
  }
})

// ==================== 👥 Group Member Management ====================

// 获取组成员列表
router.get('/groups/:id/members', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { includeUserDetails = false } = req.query

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Group ID is required'
      })
    }

    logger.debug(`👥 Getting members for group: ${id}`)

    // 验证组是否存在
    const group = await groupService.getGroupById(id)
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found'
      })
    }

    // 获取成员列表
    const memberIds = await groupService.getGroupMembers(id)

    let members = memberIds

    // 如果需要详细信息，获取用户详情
    if (includeUserDetails === 'true' && memberIds.length > 0) {
      try {
        const memberDetails = await Promise.all(
          memberIds.map(async (userId) => {
            try {
              const user = await userService.getUserById(userId)
              return user
                ? {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    displayName: user.displayName,
                    role: user.role,
                    status: user.status,
                    lastLoginAt: user.lastLoginAt
                  }
                : {
                    id: userId,
                    username: 'Unknown',
                    status: 'not_found'
                  }
            } catch (error) {
              logger.warn(`⚠️ Failed to get user details for ${userId}:`, error.message)
              return {
                id: userId,
                username: 'Unknown',
                status: 'error'
              }
            }
          })
        )
        members = memberDetails
      } catch (error) {
        logger.warn('⚠️ Failed to get member details, returning IDs only:', error.message)
      }
    }

    logger.success(`👥 Successfully retrieved ${members.length} members for group: ${group.name}`)
    return res.json({
      success: true,
      data: {
        groupId: id,
        groupName: group.name,
        memberCount: members.length,
        members
      }
    })
  } catch (error) {
    logger.error(`❌ Failed to get group members ${req.params.id}:`, error)
    return res.status(500).json({
      success: false,
      error: 'Failed to get group members',
      message: error.message
    })
  }
})

// 添加用户到组
router.post('/groups/:id/members', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { userIds } = req.body

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Group ID is required'
      })
    }

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'userIds array is required and must not be empty'
      })
    }

    logger.debug(`👥 Adding ${userIds.length} users to group: ${id}`)

    // 验证组是否存在
    const group = await groupService.getGroupById(id)
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found'
      })
    }

    // 批量添加用户到组
    const results = []
    const errors = []

    for (const userId of userIds) {
      try {
        // 验证用户是否存在
        const user = await userService.getUserById(userId)
        if (!user) {
          errors.push({
            userId,
            error: 'User not found'
          })
          continue
        }

        // 添加用户到组
        await groupService.assignUserToGroup(userId, id)
        results.push({
          userId,
          username: user.username,
          success: true
        })
      } catch (error) {
        errors.push({
          userId,
          error: error.message
        })
      }
    }

    const successCount = results.length
    const errorCount = errors.length

    if (successCount > 0) {
      logger.success(`👥 Successfully added ${successCount} users to group: ${group.name}`)
    }

    if (errorCount > 0) {
      logger.warn(`⚠️ Failed to add ${errorCount} users to group: ${group.name}`)
    }

    return res.status(successCount > 0 ? 200 : 400).json({
      success: successCount > 0,
      data: {
        groupId: id,
        groupName: group.name,
        totalRequested: userIds.length,
        successCount,
        errorCount,
        results,
        errors
      },
      message:
        successCount > 0
          ? `Successfully added ${successCount} users to group${errorCount > 0 ? ` (${errorCount} failed)` : ''}`
          : 'Failed to add any users to group'
    })
  } catch (error) {
    logger.error(`❌ Failed to add members to group ${req.params.id}:`, error)
    return res.status(500).json({
      success: false,
      error: 'Failed to add members to group',
      message: error.message
    })
  }
})

// 从组中移除用户
router.delete('/groups/:id/members/:userId', authenticateAdmin, async (req, res) => {
  try {
    const { id, userId } = req.params

    if (!id || !userId) {
      return res.status(400).json({
        success: false,
        error: 'Group ID and User ID are required'
      })
    }

    logger.debug(`👥 Removing user ${userId} from group: ${id}`)

    // 验证组是否存在
    const group = await groupService.getGroupById(id)
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found'
      })
    }

    // 验证用户是否存在
    const user = await userService.getUserById(userId)
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      })
    }

    // 从组中移除用户
    await groupService.removeUserFromGroup(userId, id)

    logger.success(`👥 Successfully removed user ${user.username} from group: ${group.name}`)
    return res.json({
      success: true,
      data: {
        groupId: id,
        groupName: group.name,
        userId,
        username: user.username
      },
      message: `Successfully removed user '${user.username}' from group '${group.name}'`
    })
  } catch (error) {
    logger.error(
      `❌ Failed to remove user ${req.params.userId} from group ${req.params.id}:`,
      error
    )
    return res.status(500).json({
      success: false,
      error: 'Failed to remove user from group',
      message: error.message
    })
  }
})

// ==================== 🔗 Group Account Assignment ====================

// 获取组关联的账户
router.get('/groups/:id/accounts', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { includeAccountDetails = false } = req.query

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Group ID is required'
      })
    }

    logger.debug(`🔗 Getting accounts for group: ${id}`)

    // 验证组是否存在
    const group = await groupService.getGroupById(id)
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found'
      })
    }

    // 获取账户分配
    const accounts = await groupService.getGroupAccounts(id)

    const response = {
      success: true,
      data: {
        groupId: id,
        groupName: group.name,
        accounts: {
          claudeAccounts: accounts.claudeAccounts || [],
          geminiAccounts: accounts.geminiAccounts || [],
          openaiAccounts: accounts.openaiAccounts || []
        },
        totalAccountCount:
          (accounts.claudeAccounts?.length || 0) +
          (accounts.geminiAccounts?.length || 0) +
          (accounts.openaiAccounts?.length || 0)
      }
    }

    // 如果需要详细信息，获取账户详情
    if (includeAccountDetails === 'true') {
      try {
        const [claudeDetails, geminiDetails] = await Promise.all([
          Promise.all(
            (accounts.claudeAccounts || []).map(async (accountId) => {
              try {
                const account = await database.getClaudeAccount(accountId)
                return account
                  ? {
                      id: account.id,
                      name: account.name,
                      email: account.email,
                      status: account.status,
                      accountType: account.accountType,
                      platform: 'claude'
                    }
                  : {
                      id: accountId,
                      name: 'Unknown',
                      status: 'not_found',
                      platform: 'claude'
                    }
              } catch (error) {
                return {
                  id: accountId,
                  name: 'Error',
                  status: 'error',
                  platform: 'claude'
                }
              }
            })
          ),
          Promise.all(
            (accounts.geminiAccounts || []).map(async (accountId) => {
              try {
                const account = await database.getGeminiAccount(accountId)
                return account
                  ? {
                      id: account.id,
                      name: account.name,
                      email: account.email,
                      status: account.status,
                      accountType: account.accountType,
                      platform: 'gemini'
                    }
                  : {
                      id: accountId,
                      name: 'Unknown',
                      status: 'not_found',
                      platform: 'gemini'
                    }
              } catch (error) {
                return {
                  id: accountId,
                  name: 'Error',
                  status: 'error',
                  platform: 'gemini'
                }
              }
            })
          )
        ])

        response.data.accountDetails = {
          claudeAccounts: claudeDetails,
          geminiAccounts: geminiDetails,
          openaiAccounts: [] // Will be implemented when OpenAI support is added
        }
      } catch (error) {
        logger.warn('⚠️ Failed to get account details:', error.message)
      }
    }

    logger.success(
      `🔗 Successfully retrieved ${response.data.totalAccountCount} accounts for group: ${group.name}`
    )
    return res.json(response)
  } catch (error) {
    logger.error(`❌ Failed to get group accounts ${req.params.id}:`, error)
    return res.status(500).json({
      success: false,
      error: 'Failed to get group accounts',
      message: error.message
    })
  }
})

// 为组分配账户
router.post('/groups/:id/accounts', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { claudeAccounts, geminiAccounts, openaiAccounts } = req.body

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Group ID is required'
      })
    }

    if (!claudeAccounts && !geminiAccounts && !openaiAccounts) {
      return res.status(400).json({
        success: false,
        error: 'At least one account type must be provided'
      })
    }

    logger.debug(`🔗 Assigning accounts to group: ${id}`, {
      claudeCount: claudeAccounts?.length || 0,
      geminiCount: geminiAccounts?.length || 0,
      openaiCount: openaiAccounts?.length || 0
    })

    // 验证组是否存在
    const group = await groupService.getGroupById(id)
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found'
      })
    }

    // 准备账户数据
    const accounts = {}
    if (claudeAccounts && Array.isArray(claudeAccounts)) {
      accounts.claudeAccounts = claudeAccounts
    }
    if (geminiAccounts && Array.isArray(geminiAccounts)) {
      accounts.geminiAccounts = geminiAccounts
    }
    if (openaiAccounts && Array.isArray(openaiAccounts)) {
      accounts.openaiAccounts = openaiAccounts
    }

    // 分配账户到组
    await groupService.assignAccountsToGroup(id, accounts)

    // 获取更新后的账户信息
    const updatedAccounts = await groupService.getGroupAccounts(id)
    const totalCount =
      (updatedAccounts.claudeAccounts?.length || 0) +
      (updatedAccounts.geminiAccounts?.length || 0) +
      (updatedAccounts.openaiAccounts?.length || 0)

    logger.success(`🔗 Successfully assigned accounts to group: ${group.name}`)
    return res.json({
      success: true,
      data: {
        groupId: id,
        groupName: group.name,
        accounts: updatedAccounts,
        totalAccountCount: totalCount
      },
      message: `Successfully assigned accounts to group '${group.name}'`
    })
  } catch (error) {
    logger.error(`❌ Failed to assign accounts to group ${req.params.id}:`, error)

    let statusCode = 500
    if (error.message.includes('not found')) {
      statusCode = 404
    } else if (error.message.includes('Invalid')) {
      statusCode = 400
    }

    return res.status(statusCode).json({
      success: false,
      error: 'Failed to assign accounts to group',
      message: error.message
    })
  }
})

// 移除组的账户分配
router.delete('/groups/:id/accounts/:accountId', authenticateAdmin, async (req, res) => {
  try {
    const { id, accountId } = req.params
    const { accountType } = req.query

    if (!id || !accountId) {
      return res.status(400).json({
        success: false,
        error: 'Group ID and Account ID are required'
      })
    }

    if (!accountType || !['claude', 'gemini', 'openai'].includes(accountType)) {
      return res.status(400).json({
        success: false,
        error: 'Valid account type is required (claude, gemini, or openai)'
      })
    }

    logger.debug(`🔗 Removing ${accountType} account ${accountId} from group: ${id}`)

    // 验证组是否存在
    const group = await groupService.getGroupById(id)
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found'
      })
    }

    // 准备移除数据
    const accountsToRemove = {}
    accountsToRemove[`${accountType}Accounts`] = [accountId]

    // 从组中移除账户
    await groupService.removeAccountsFromGroup(id, accountsToRemove)

    logger.success(
      `🔗 Successfully removed ${accountType} account ${accountId} from group: ${group.name}`
    )
    return res.json({
      success: true,
      data: {
        groupId: id,
        groupName: group.name,
        removedAccountId: accountId,
        accountType
      },
      message: `Successfully removed ${accountType} account from group '${group.name}'`
    })
  } catch (error) {
    logger.error(
      `❌ Failed to remove account ${req.params.accountId} from group ${req.params.id}:`,
      error
    )
    return res.status(500).json({
      success: false,
      error: 'Failed to remove account from group',
      message: error.message
    })
  }
})

// ==================== 🔐 Group Permissions Management ====================

// 更新组权限配置
router.put('/groups/:id/permissions', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { permissions } = req.body

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Group ID is required'
      })
    }

    if (!permissions || typeof permissions !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Permissions object is required'
      })
    }

    logger.debug(`🔐 Updating permissions for group: ${id}`)

    // 验证组是否存在
    const group = await groupService.getGroupById(id)
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found'
      })
    }

    // 更新权限
    await groupService.updateGroupPermissions(id, permissions)

    // 获取更新后的组信息
    const updatedGroup = await groupService.getGroupById(id)

    logger.success(`🔐 Successfully updated permissions for group: ${group.name}`)
    return res.json({
      success: true,
      data: {
        groupId: id,
        groupName: group.name,
        permissions: updatedGroup.permissions
      },
      message: `Successfully updated permissions for group '${group.name}'`
    })
  } catch (error) {
    logger.error(`❌ Failed to update permissions for group ${req.params.id}:`, error)

    let statusCode = 500
    if (error.message.includes('not found')) {
      statusCode = 404
    } else if (error.message.includes('Invalid')) {
      statusCode = 400
    }

    return res.status(statusCode).json({
      success: false,
      error: 'Failed to update group permissions',
      message: error.message
    })
  }
})

// ==================== ⚙️ Group Scheduling Configuration ====================

// 获取组调度配置
router.get('/groups/:id/scheduling', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Group ID is required'
      })
    }

    logger.debug(`⚙️ Getting scheduling config for group: ${id}`)

    // 验证组是否存在
    const group = await groupService.getGroupById(id)
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found'
      })
    }

    // 获取调度配置
    const schedulingConfig = await groupService.getSchedulingConfig(id)

    logger.success(`⚙️ Successfully retrieved scheduling config for group: ${group.name}`)
    return res.json({
      success: true,
      data: {
        groupId: id,
        groupName: group.name,
        schedulingConfig
      }
    })
  } catch (error) {
    logger.error(`❌ Failed to get scheduling config for group ${req.params.id}:`, error)
    return res.status(500).json({
      success: false,
      error: 'Failed to get scheduling configuration',
      message: error.message
    })
  }
})

// 更新组调度策略配置
router.put('/groups/:id/scheduling', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { schedulingConfig } = req.body

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Group ID is required'
      })
    }

    if (!schedulingConfig || typeof schedulingConfig !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Scheduling configuration object is required'
      })
    }

    logger.debug(`⚙️ Updating scheduling config for group: ${id}`, {
      strategy: schedulingConfig.strategy,
      hasWeights: !!schedulingConfig.weights,
      fallbackToGlobal: schedulingConfig.fallbackToGlobal,
      healthCheckEnabled: schedulingConfig.healthCheckEnabled
    })

    // 验证组是否存在
    const group = await groupService.getGroupById(id)
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found'
      })
    }

    // 更新调度配置
    await groupService.updateSchedulingConfig(id, schedulingConfig)

    // 获取更新后的配置
    const updatedConfig = await groupService.getSchedulingConfig(id)

    logger.success(`⚙️ Successfully updated scheduling config for group: ${group.name}`)
    return res.json({
      success: true,
      data: {
        groupId: id,
        groupName: group.name,
        schedulingConfig: updatedConfig
      },
      message: `Successfully updated scheduling configuration for group '${group.name}'`
    })
  } catch (error) {
    logger.error(`❌ Failed to update scheduling config for group ${req.params.id}:`, error)

    let statusCode = 500
    if (error.message.includes('not found')) {
      statusCode = 404
    } else if (error.message.includes('Invalid')) {
      statusCode = 400
    }

    return res.status(statusCode).json({
      success: false,
      error: 'Failed to update scheduling configuration',
      message: error.message
    })
  }
})

module.exports = router
