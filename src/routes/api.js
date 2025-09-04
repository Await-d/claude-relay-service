const express = require('express')
const claudeRelayService = require('../services/claudeRelayService')
const claudeConsoleRelayService = require('../services/claudeConsoleRelayService')
const bedrockRelayService = require('../services/bedrockRelayService')
const bedrockAccountService = require('../services/bedrockAccountService')
const unifiedClaudeScheduler = require('../services/unifiedClaudeScheduler')
const apiKeyService = require('../services/apiKeyService')
const claudeAccountService = require('../services/claudeAccountService')
const { authenticateApiKey } = require('../middleware/auth')
const logger = require('../utils/logger')
const database = require('../models/database')
const sessionHelper = require('../utils/sessionHelper')
const { unifiedLogServiceFactory } = require('../services/UnifiedLogServiceFactory')
const { costLimitService } = require('../services/costLimitService')
const { costEstimator } = require('../utils/costEstimator')

const router = express.Router()

// 💰 统一账户费用记录函数
const recordAccountCostAsync = async (accountId, usageData, model) => {
  if (!accountId || !usageData || !model) {
    return
  }

  // 异步记录账户费用，不阻塞主流程
  setImmediate(async () => {
    try {
      await claudeAccountService.recordAccountCost(accountId, usageData, model)
    } catch (error) {
      logger.warn(`⚠️ Account cost recording failed for ${accountId}:`, error.message)
    }
  })
}

// 🔧 统一日志服务实例获取
let unifiedLogService = null
const getUnifiedLogService = async () => {
  if (!unifiedLogService) {
    try {
      unifiedLogService = await unifiedLogServiceFactory.getSingleton()
    } catch (error) {
      logger.error('❌ Failed to get UnifiedLogService instance:', error)
      throw error
    }
  }
  return unifiedLogService
}

// 🔧 统一日志记录函数
const logRequestWithUnifiedService = async (req, res, usageData, startTime, accountId) => {
  try {
    const logService = await getUnifiedLogService()

    // 构建统一的日志数据
    const logData = {
      // 基础请求信息
      path: req.originalUrl,
      method: req.method,
      statusCode: res.statusCode,
      responseTime: Date.now() - startTime,
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,

      // 请求和响应数据
      requestHeaders: req.headers,
      responseHeaders: res.getHeaders(),
      requestBody: req.body,

      // Token 和使用统计
      inputTokens: usageData?.input_tokens || 0,
      outputTokens: usageData?.output_tokens || 0,
      totalTokens: (usageData?.input_tokens || 0) + (usageData?.output_tokens || 0),
      cacheCreateTokens: usageData?.cache_creation_input_tokens || 0,
      cacheReadTokens: usageData?.cache_read_input_tokens || 0,

      // 详细缓存信息
      ephemeral5mTokens: usageData?.cache_creation?.ephemeral_5m_input_tokens || 0,
      ephemeral1hTokens: usageData?.cache_creation?.ephemeral_1h_input_tokens || 0,

      // 账户和模型信息
      accountId,
      model: usageData?.model || 'unknown',

      // 流式标识
      isStreaming: true,

      // 时间戳
      timestamp: Date.now()
    }

    // 记录日志
    const logId = await logService.logRequest(req.apiKey.id, logData)
    logger.debug(`✅ Request logged with UnifiedLogService: ${logId}`)

    return logId
  } catch (error) {
    logger.error('❌ UnifiedLogService logging failed:', error)
    // 不抛出错误，避免影响主流程
    return null
  }
}

async function handleMessagesRequest(req, res) {
  const startTime = Date.now()
  let shouldLogRequest = false

  try {
    // 严格的输入验证
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Request body must be a valid JSON object'
      })
    }

    if (!req.body.messages || !Array.isArray(req.body.messages)) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Missing or invalid field: messages (must be an array)'
      })
    }

    if (req.body.messages.length === 0) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Messages array cannot be empty'
      })
    }

    // 检查是否为流式请求
    const isStream = req.body.stream === true
    const requestedModel = req.body.model || 'unknown'

    logger.api(
      `🚀 Processing ${isStream ? 'stream' : 'non-stream'} request for key: ${req.apiKey.name}, model: ${requestedModel}`
    )

    // 💰 费用预估和限制检查（P1.2 核心功能）
    let estimatedCost = 0
    let costEstimation = null

    try {
      // 1. 预估请求费用
      costEstimation = costEstimator.estimateRequestCost(req.body, requestedModel)
      estimatedCost = costEstimation.estimatedCost || 0

      logger.debug(
        `💰 Request cost estimation: $${estimatedCost.toFixed(4)} (confidence: ${costEstimation.confidence})`
      )

      // 2. 执行API Key级别的费用限制检查（包含预估费用）
      const apiKeyCostCheck = await costLimitService.checkApiKeyCostLimit(
        req.apiKey.id,
        estimatedCost
      )

      if (!apiKeyCostCheck.allowed) {
        const violationResponse = costLimitService.formatViolationResponse(
          apiKeyCostCheck.violations
        )

        logger.security(
          `💰 API Key cost limit exceeded before request: ${req.apiKey.id} (${req.apiKey.name}), estimated: $${estimatedCost.toFixed(4)}`
        )

        return res.status(429).json({
          ...violationResponse,
          type: 'api_key_cost_limit',
          estimatedCost: estimatedCost,
          estimation: {
            breakdown: costEstimation.breakdown,
            confidence: costEstimation.confidence
          }
        })
      }

      // 3. 添加预估费用信息到请求对象（供后续使用）
      req.costEstimation = costEstimation
      req.estimatedCost = estimatedCost
    } catch (costError) {
      // 费用预估失败不应阻塞请求，但需要记录日志
      logger.warn(`⚠️ Cost estimation failed for request: ${costError.message}`)
      estimatedCost = 0
      req.estimatedCost = 0
    }

    // 智能采样决策：检查是否应该记录此请求到日志系统
    shouldLogRequest = false
    try {
      // 🔧 UnifiedLogService 内置智能重复检测，默认启用日志记录
      shouldLogRequest = true
      logger.debug('🔍 Request logging enabled with UnifiedLogService')
    } catch (samplingError) {
      logger.warn('⚠️ Request logging initialization failed:', samplingError.message)
      shouldLogRequest = false
    }

    if (isStream) {
      // 流式响应 - 只使用官方真实usage数据
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('X-Accel-Buffering', 'no') // 禁用 Nginx 缓冲

      // 禁用 Nagle 算法，确保数据立即发送
      if (res.socket && typeof res.socket.setNoDelay === 'function') {
        res.socket.setNoDelay(true)
      }

      // 流式响应不需要额外处理，中间件已经设置了监听器

      let usageDataCaptured = false

      // 生成会话哈希用于sticky会话
      const sessionHash = sessionHelper.generateSessionHash(req.body)

      // 使用统一调度选择账号（传递请求的模型）
      const { accountId, accountType } = await unifiedClaudeScheduler.selectAccountForApiKey(
        req.apiKey,
        sessionHash,
        requestedModel
      )

      // 💰 执行账户级别的费用限制检查（P1.2 核心功能 - 流式请求）
      if (accountId && (accountType === 'claude-official' || accountType === 'claude-console')) {
        try {
          const accountCostCheck = await costLimitService.checkAccountCostLimit(
            accountId,
            estimatedCost
          )

          if (!accountCostCheck.allowed) {
            const violationResponse = costLimitService.formatViolationResponse(
              accountCostCheck.violations
            )

            logger.security(
              `💰 Account cost limit exceeded before stream request: ${accountId}, estimated: $${estimatedCost.toFixed(4)}`
            )

            return res.status(429).json({
              ...violationResponse,
              type: 'account_cost_limit',
              accountId: accountId,
              estimatedCost: estimatedCost,
              estimation: {
                breakdown: costEstimation?.breakdown,
                confidence: costEstimation?.confidence
              }
            })
          }

          // 记录账户费用预警（如果有）
          if (accountCostCheck.warnings && accountCostCheck.warnings.length > 0) {
            logger.warn(
              `💰 Account cost usage warning for stream request: ${accountId}, warnings: ${accountCostCheck.warnings.length}, estimated: $${estimatedCost.toFixed(4)}`
            )
          }
        } catch (accountCostError) {
          // 账户费用检查失败不应阻塞请求，但需要记录日志
          logger.warn(
            `⚠️ Account cost limit check failed for stream request ${accountId}: ${accountCostError.message}`
          )
        }
      }

      // 根据账号类型选择对应的转发服务并调用
      if (accountType === 'claude-official') {
        // 官方Claude账号使用原有的转发服务（会自己选择账号）
        await claudeRelayService.relayStreamRequestWithUsageCapture(
          req.body,
          req.apiKey,
          res,
          req.headers,
          (usageData) => {
            // 回调函数：当检测到完整usage数据时记录真实token使用量
            logger.info(
              '🎯 Usage callback triggered with complete data:',
              JSON.stringify(usageData, null, 2)
            )

            if (
              usageData &&
              usageData.input_tokens !== undefined &&
              usageData.output_tokens !== undefined
            ) {
              const inputTokens = usageData.input_tokens || 0
              const outputTokens = usageData.output_tokens || 0
              // 兼容处理：如果有详细的 cache_creation 对象，使用它；否则使用总的 cache_creation_input_tokens
              let cacheCreateTokens = usageData.cache_creation_input_tokens || 0
              let ephemeral5mTokens = 0
              let ephemeral1hTokens = 0

              if (usageData.cache_creation && typeof usageData.cache_creation === 'object') {
                ephemeral5mTokens = usageData.cache_creation.ephemeral_5m_input_tokens || 0
                ephemeral1hTokens = usageData.cache_creation.ephemeral_1h_input_tokens || 0
                // 总的缓存创建 tokens 是两者之和
                cacheCreateTokens = ephemeral5mTokens + ephemeral1hTokens
              }

              const cacheReadTokens = usageData.cache_read_input_tokens || 0
              const model = usageData.model || 'unknown'

              // 记录真实的token使用量（包含模型信息和所有4种token以及账户ID）
              const { accountId: usageAccountId } = usageData

              // 构建 usage 对象以传递给 recordUsage
              const usageObject = {
                input_tokens: inputTokens,
                output_tokens: outputTokens,
                cache_creation_input_tokens: cacheCreateTokens,
                cache_read_input_tokens: cacheReadTokens
              }

              // 如果有详细的缓存创建数据，添加到 usage 对象中
              if (ephemeral5mTokens > 0 || ephemeral1hTokens > 0) {
                usageObject.cache_creation = {
                  ephemeral_5m_input_tokens: ephemeral5mTokens,
                  ephemeral_1h_input_tokens: ephemeral1hTokens
                }
              }

              apiKeyService
                .recordUsageWithDetails(req.apiKey.id, usageObject, model, usageAccountId)
                .catch((error) => {
                  logger.error('❌ Failed to record stream usage:', error)
                })

              // 更新时间窗口内的token计数
              if (req.rateLimitInfo) {
                const totalTokens = inputTokens + outputTokens + cacheCreateTokens + cacheReadTokens
                database
                  .getClient()
                  .incrby(req.rateLimitInfo.tokenCountKey, totalTokens)
                  .catch((error) => {
                    logger.error('❌ Failed to update rate limit token count:', error)
                  })
                logger.api(`📊 Updated rate limit token count: +${totalTokens} tokens`)
              }

              usageDataCaptured = true

              // 💰 记录账户费用（异步，不阻塞主流程）
              recordAccountCostAsync(usageAccountId, usageObject, model)

              // 🔍 使用统一日志服务记录 (Claude Official)
              if (shouldLogRequest) {
                logger.info(`🚀 Logging with UnifiedLogService (Claude Official)`)
                logRequestWithUnifiedService(req, res, usageData, startTime, usageAccountId).catch(
                  (error) => {
                    logger.error(
                      '❌ UnifiedLogService logging failed (Claude Official):',
                      error.message
                    )
                  }
                )
              }

              logger.api(
                `📊 Stream usage recorded (real) - Model: ${model}, Input: ${inputTokens}, Output: ${outputTokens}, Cache Create: ${cacheCreateTokens}, Cache Read: ${cacheReadTokens}, Total: ${inputTokens + outputTokens + cacheCreateTokens + cacheReadTokens} tokens`
              )
            } else {
              logger.warn(
                '⚠️ Usage callback triggered but data is incomplete:',
                JSON.stringify(usageData)
              )
            }
          }
        )
      } else if (accountType === 'claude-console') {
        // Claude Console账号使用Console转发服务（需要传递accountId）
        await claudeConsoleRelayService.relayStreamRequestWithUsageCapture(
          req.body,
          req.apiKey,
          res,
          req.headers,
          (usageData) => {
            // 回调函数：当检测到完整usage数据时记录真实token使用量
            logger.info(
              '🎯 Usage callback triggered with complete data:',
              JSON.stringify(usageData, null, 2)
            )

            if (
              usageData &&
              usageData.input_tokens !== undefined &&
              usageData.output_tokens !== undefined
            ) {
              const inputTokens = usageData.input_tokens || 0
              const outputTokens = usageData.output_tokens || 0
              // 兼容处理：如果有详细的 cache_creation 对象，使用它；否则使用总的 cache_creation_input_tokens
              let cacheCreateTokens = usageData.cache_creation_input_tokens || 0
              let ephemeral5mTokens = 0
              let ephemeral1hTokens = 0

              if (usageData.cache_creation && typeof usageData.cache_creation === 'object') {
                ephemeral5mTokens = usageData.cache_creation.ephemeral_5m_input_tokens || 0
                ephemeral1hTokens = usageData.cache_creation.ephemeral_1h_input_tokens || 0
                // 总的缓存创建 tokens 是两者之和
                cacheCreateTokens = ephemeral5mTokens + ephemeral1hTokens
              }

              const cacheReadTokens = usageData.cache_read_input_tokens || 0
              const model = usageData.model || 'unknown'

              // 记录真实的token使用量（包含模型信息和所有4种token以及账户ID）
              const usageAccountId = usageData.accountId

              // 构建 usage 对象以传递给 recordUsage
              const usageObject = {
                input_tokens: inputTokens,
                output_tokens: outputTokens,
                cache_creation_input_tokens: cacheCreateTokens,
                cache_read_input_tokens: cacheReadTokens
              }

              // 如果有详细的缓存创建数据，添加到 usage 对象中
              if (ephemeral5mTokens > 0 || ephemeral1hTokens > 0) {
                usageObject.cache_creation = {
                  ephemeral_5m_input_tokens: ephemeral5mTokens,
                  ephemeral_1h_input_tokens: ephemeral1hTokens
                }
              }

              apiKeyService
                .recordUsageWithDetails(req.apiKey.id, usageObject, model, usageAccountId)
                .catch((error) => {
                  logger.error('❌ Failed to record stream usage:', error)
                })

              // 更新时间窗口内的token计数
              if (req.rateLimitInfo) {
                const totalTokens = inputTokens + outputTokens + cacheCreateTokens + cacheReadTokens
                database
                  .getClient()
                  .incrby(req.rateLimitInfo.tokenCountKey, totalTokens)
                  .catch((error) => {
                    logger.error('❌ Failed to update rate limit token count:', error)
                  })
                logger.api(`📊 Updated rate limit token count: +${totalTokens} tokens`)
              }

              usageDataCaptured = true

              // 💰 记录账户费用（异步，不阻塞主流程）
              recordAccountCostAsync(usageAccountId, usageObject, model)

              // 🔍 使用统一日志服务记录 (Claude Console)
              if (shouldLogRequest) {
                logger.info(`🚀 Logging with UnifiedLogService (Claude Console)`)
                logRequestWithUnifiedService(req, res, usageData, startTime, usageAccountId).catch(
                  (error) => {
                    logger.error(
                      '❌ UnifiedLogService logging failed (Claude Console):',
                      error.message
                    )
                  }
                )
              }

              logger.api(
                `📊 Stream usage recorded (real) - Model: ${model}, Input: ${inputTokens}, Output: ${outputTokens}, Cache Create: ${cacheCreateTokens}, Cache Read: ${cacheReadTokens}, Total: ${inputTokens + outputTokens + cacheCreateTokens + cacheReadTokens} tokens`
              )
            } else {
              logger.warn(
                '⚠️ Usage callback triggered but data is incomplete:',
                JSON.stringify(usageData)
              )
            }
          },
          accountId
        )
      } else if (accountType === 'bedrock') {
        // Bedrock账号使用Bedrock转发服务
        try {
          const bedrockAccountResult = await bedrockAccountService.getAccount(accountId)
          if (!bedrockAccountResult.success) {
            throw new Error('Failed to get Bedrock account details')
          }

          const result = await bedrockRelayService.handleStreamRequest(
            req.body,
            bedrockAccountResult.data,
            res
          )

          // 记录Bedrock使用统计
          if (result.usage) {
            const inputTokens = result.usage.input_tokens || 0
            const outputTokens = result.usage.output_tokens || 0

            apiKeyService
              .recordUsage(req.apiKey.id, inputTokens, outputTokens, 0, 0, result.model, accountId)
              .catch((error) => {
                logger.error('❌ Failed to record Bedrock stream usage:', error)
              })

            // 更新时间窗口内的token计数
            if (req.rateLimitInfo) {
              const totalTokens = inputTokens + outputTokens
              database
                .getClient()
                .incrby(req.rateLimitInfo.tokenCountKey, totalTokens)
                .catch((error) => {
                  logger.error('❌ Failed to update rate limit token count:', error)
                })
              logger.api(`📊 Updated rate limit token count: +${totalTokens} tokens`)
            }

            usageDataCaptured = true
            logger.api(
              `📊 Bedrock stream usage recorded - Model: ${result.model}, Input: ${inputTokens}, Output: ${outputTokens}, Total: ${inputTokens + outputTokens} tokens`
            )
          }
        } catch (error) {
          logger.error('❌ Bedrock stream request failed:', error)
          if (!res.headersSent) {
            return res.status(500).json({ error: 'Bedrock service error', message: error.message })
          }
          return undefined
        }
      }

      // 流式请求完成后 - 如果没有捕获到usage数据，记录警告但不进行估算
      setTimeout(() => {
        if (!usageDataCaptured) {
          logger.warn(
            '⚠️ No usage data captured from SSE stream - no statistics recorded (official data only)'
          )
        }
      }, 1000) // 1秒后检查
    } else {
      // 非流式响应 - 只使用官方真实usage数据
      logger.info('📄 Starting non-streaming request', {
        apiKeyId: req.apiKey.id,
        apiKeyName: req.apiKey.name
      })

      // 生成会话哈希用于sticky会话
      const sessionHash = sessionHelper.generateSessionHash(req.body)

      // 使用统一调度选择账号（传递请求的模型）
      const { accountId, accountType } = await unifiedClaudeScheduler.selectAccountForApiKey(
        req.apiKey,
        sessionHash,
        requestedModel
      )

      // 💰 执行账户级别的费用限制检查（P1.2 核心功能 - 非流式请求）
      if (accountId && (accountType === 'claude-official' || accountType === 'claude-console')) {
        try {
          const accountCostCheck = await costLimitService.checkAccountCostLimit(
            accountId,
            estimatedCost
          )

          if (!accountCostCheck.allowed) {
            const violationResponse = costLimitService.formatViolationResponse(
              accountCostCheck.violations
            )

            logger.security(
              `💰 Account cost limit exceeded before non-stream request: ${accountId}, estimated: $${estimatedCost.toFixed(4)}`
            )

            return res.status(429).json({
              ...violationResponse,
              type: 'account_cost_limit',
              accountId: accountId,
              estimatedCost: estimatedCost,
              estimation: {
                breakdown: costEstimation?.breakdown,
                confidence: costEstimation?.confidence
              }
            })
          }

          // 记录账户费用预警（如果有）
          if (accountCostCheck.warnings && accountCostCheck.warnings.length > 0) {
            logger.warn(
              `💰 Account cost usage warning for non-stream request: ${accountId}, warnings: ${accountCostCheck.warnings.length}, estimated: $${estimatedCost.toFixed(4)}`
            )
          }
        } catch (accountCostError) {
          // 账户费用检查失败不应阻塞请求，但需要记录日志
          logger.warn(
            `⚠️ Account cost limit check failed for non-stream request ${accountId}: ${accountCostError.message}`
          )
        }
      }

      // 根据账号类型选择对应的转发服务
      let response
      if (accountType === 'claude-official') {
        // 官方Claude账号使用原有的转发服务
        response = await claudeRelayService.relayRequest(
          req.body,
          req.apiKey,
          req,
          res,
          req.headers
        )
      } else if (accountType === 'claude-console') {
        response = await claudeConsoleRelayService.relayRequest(
          req.body,
          req.apiKey,
          req,
          res,
          req.headers,
          accountId
        )
      } else if (accountType === 'bedrock') {
        // Bedrock账号使用Bedrock转发服务
        try {
          const bedrockAccountResult = await bedrockAccountService.getAccount(accountId)
          if (!bedrockAccountResult.success) {
            throw new Error('Failed to get Bedrock account details')
          }

          const result = await bedrockRelayService.handleNonStreamRequest(
            req.body,
            bedrockAccountResult.data,
            req.headers
          )

          // 构建标准响应格式
          response = {
            statusCode: result.success ? 200 : 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(result.success ? result.data : { error: result.error }),
            accountId
          }

          // 如果成功，添加使用统计到响应数据中
          if (result.success && result.usage) {
            const responseData = JSON.parse(response.body)
            responseData.usage = result.usage
            response.body = JSON.stringify(responseData)
          }
        } catch (error) {
          logger.error('❌ Bedrock non-stream request failed:', error)
          response = {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Bedrock service error', message: error.message }),
            accountId
          }
        }
      }

      logger.info('📡 Claude API response received', {
        statusCode: response.statusCode,
        headers: JSON.stringify(response.headers),
        bodyLength: response.body ? response.body.length : 0
      })

      res.status(response.statusCode)

      // 设置响应头，避免 Content-Length 和 Transfer-Encoding 冲突
      const skipHeaders = ['content-encoding', 'transfer-encoding', 'content-length']
      Object.keys(response.headers).forEach((key) => {
        if (!skipHeaders.includes(key.toLowerCase())) {
          res.setHeader(key, response.headers[key])
        }
      })

      let usageRecorded = false

      // 尝试解析JSON响应并提取usage信息
      try {
        const jsonData = JSON.parse(response.body)

        logger.info('📊 Parsed Claude API response:', JSON.stringify(jsonData, null, 2))

        // 从Claude API响应中提取usage信息（完整的token分类体系）
        if (
          jsonData.usage &&
          jsonData.usage.input_tokens !== undefined &&
          jsonData.usage.output_tokens !== undefined
        ) {
          const inputTokens = jsonData.usage.input_tokens || 0
          const outputTokens = jsonData.usage.output_tokens || 0
          const cacheCreateTokens = jsonData.usage.cache_creation_input_tokens || 0
          const cacheReadTokens = jsonData.usage.cache_read_input_tokens || 0
          const model = jsonData.model || req.body.model || 'unknown'

          // 记录真实的token使用量（包含模型信息和所有4种token以及账户ID）
          const { accountId: responseAccountId } = response
          await apiKeyService.recordUsage(
            req.apiKey.id,
            inputTokens,
            outputTokens,
            cacheCreateTokens,
            cacheReadTokens,
            model,
            responseAccountId
          )

          // 更新时间窗口内的token计数
          if (req.rateLimitInfo) {
            const totalTokens = inputTokens + outputTokens + cacheCreateTokens + cacheReadTokens
            await database.getClient().incrby(req.rateLimitInfo.tokenCountKey, totalTokens)
            logger.api(`📊 Updated rate limit token count: +${totalTokens} tokens`)
          }

          usageRecorded = true

          // 💰 记录账户费用（异步，不阻塞主流程）
          const nonStreamUsageObject = {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cache_creation_input_tokens: cacheCreateTokens,
            cache_read_input_tokens: cacheReadTokens
          }
          recordAccountCostAsync(responseAccountId, nonStreamUsageObject, model)

          logger.api(
            `📊 Non-stream usage recorded (real) - Model: ${model}, Input: ${inputTokens}, Output: ${outputTokens}, Cache Create: ${cacheCreateTokens}, Cache Read: ${cacheReadTokens}, Total: ${inputTokens + outputTokens + cacheCreateTokens + cacheReadTokens} tokens`
          )
        } else {
          logger.warn('⚠️ No usage data found in Claude API JSON response')
        }

        res.json(jsonData)
      } catch (parseError) {
        logger.warn('⚠️ Failed to parse Claude API response as JSON:', parseError.message)
        logger.info('📄 Raw response body:', response.body)
        res.send(response.body)
      }

      // 如果没有记录usage，只记录警告，不进行估算
      if (!usageRecorded) {
        logger.warn(
          '⚠️ No usage data recorded for non-stream request - no statistics recorded (official data only)'
        )
      }
    }

    const duration = Date.now() - startTime
    logger.api(`✅ Request completed in ${duration}ms for key: ${req.apiKey.name}`)

    // 请求完成后的日志记录
    if (shouldLogRequest) {
      try {
        const logEntry = {
          keyId: req.apiKey.id,
          method: req.method,
          path: req.path,
          statusCode: res.statusCode || 200,
          responseTime: duration,
          userAgent: req.get('User-Agent') || '',
          ipAddress: req.ip || req.connection.remoteAddress || '',
          model: req.body.model || 'unknown',
          tokens: 0, // Token信息从usage统计中获取，这里设为0
          inputTokens: 0,
          outputTokens: 0,
          error: null
        }

        // 🔧 使用统一日志服务记录完成的请求
        try {
          const logService = await getUnifiedLogService()
          await logService.logRequest(req.apiKey.id, logEntry)
          logger.debug(`📝 Request completed and logged successfully for key: ${req.apiKey.name}`)
        } catch (logError) {
          logger.warn(
            `⚠️ UnifiedLogService logging failed for key: ${req.apiKey.name}:`,
            logError.message
          )
        }
      } catch (loggingError) {
        logger.warn('⚠️ Request logging failed:', loggingError.message)
        // 不影响响应，只记录警告
      }
    }

    return undefined
  } catch (error) {
    const duration = Date.now() - startTime
    logger.error('❌ Claude relay error:', error.message, {
      code: error.code,
      stack: error.stack
    })

    // 错误情况下的日志记录
    // 🔧 UnifiedLogService 处理错误请求，默认启用
    const shouldLogError = true

    if (shouldLogError) {
      try {
        const logEntry = {
          keyId: req.apiKey.id,
          method: req.method,
          path: req.path,
          statusCode: 500, // 错误状态码
          responseTime: duration,
          userAgent: req.get('User-Agent') || '',
          ipAddress: req.ip || req.connection.remoteAddress || '',
          model: req.body?.model || 'unknown',
          tokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          error: error.message || 'An unexpected error occurred'
        }

        // 🔧 使用统一日志服务记录错误请求
        try {
          const logService = await getUnifiedLogService()
          await logService.logRequest(req.apiKey.id, logEntry)
          logger.debug(`📝 Error request logged successfully for key: ${req.apiKey.name}`)
        } catch (logError) {
          logger.warn(
            `⚠️ UnifiedLogService error logging failed for key: ${req.apiKey.name}:`,
            logError.message
          )
        }
      } catch (loggingError) {
        logger.warn('⚠️ Error request logging failed:', loggingError.message)
      }
    }

    // 确保在任何情况下都能返回有效的JSON响应
    if (!res.headersSent) {
      // 根据错误类型设置适当的状态码
      let statusCode = 500
      let errorType = 'Relay service error'

      if (error.message.includes('Connection reset') || error.message.includes('socket hang up')) {
        statusCode = 502
        errorType = 'Upstream connection error'
      } else if (error.message.includes('Connection refused')) {
        statusCode = 502
        errorType = 'Upstream service unavailable'
      } else if (error.message.includes('timeout')) {
        statusCode = 504
        errorType = 'Upstream timeout'
      } else if (error.message.includes('resolve') || error.message.includes('ENOTFOUND')) {
        statusCode = 502
        errorType = 'Upstream hostname resolution failed'
      }

      return res.status(statusCode).json({
        error: errorType,
        message: error.message || 'An unexpected error occurred',
        timestamp: new Date().toISOString()
      })
    } else {
      // 如果响应头已经发送，尝试结束响应
      if (!res.destroyed && !res.finished) {
        res.end()
      }
      return undefined
    }
  }
}

// 🚀 Claude API messages 端点 - /api/v1/messages
router.post('/v1/messages', authenticateApiKey, handleMessagesRequest)

// 🚀 Claude API messages 端点 - /claude/v1/messages (别名)
router.post('/claude/v1/messages', authenticateApiKey, handleMessagesRequest)

// 📋 模型列表端点 - Claude Code 客户端需要
router.get('/v1/models', authenticateApiKey, async (req, res) => {
  try {
    // 返回支持的模型列表
    const models = [
      {
        id: 'claude-3-5-sonnet-20241022',
        object: 'model',
        created: 1669599635,
        owned_by: 'anthropic'
      },
      {
        id: 'claude-3-5-haiku-20241022',
        object: 'model',
        created: 1669599635,
        owned_by: 'anthropic'
      },
      {
        id: 'claude-3-opus-20240229',
        object: 'model',
        created: 1669599635,
        owned_by: 'anthropic'
      },
      {
        id: 'claude-sonnet-4-20250514',
        object: 'model',
        created: 1669599635,
        owned_by: 'anthropic'
      }
    ]

    res.json({
      object: 'list',
      data: models
    })
  } catch (error) {
    logger.error('❌ Models list error:', error)
    res.status(500).json({
      error: 'Failed to get models list',
      message: error.message
    })
  }
})

// 🏥 健康检查端点
router.get('/health', async (req, res) => {
  try {
    const healthStatus = await claudeRelayService.healthCheck()

    res.status(healthStatus.healthy ? 200 : 503).json({
      status: healthStatus.healthy ? 'healthy' : 'unhealthy',
      service: 'claude-relay-service',
      version: '1.0.0',
      ...healthStatus
    })
  } catch (error) {
    logger.error('❌ Health check error:', error)
    res.status(503).json({
      status: 'unhealthy',
      service: 'claude-relay-service',
      error: error.message,
      timestamp: new Date().toISOString()
    })
  }
})

// 📊 API Key状态检查端点 - /api/v1/key-info
router.get('/v1/key-info', authenticateApiKey, async (req, res) => {
  try {
    const usage = await apiKeyService.getUsageStats(req.apiKey.id)

    res.json({
      keyInfo: {
        id: req.apiKey.id,
        name: req.apiKey.name,
        tokenLimit: req.apiKey.tokenLimit,
        usage
      },
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    logger.error('❌ Key info error:', error)
    res.status(500).json({
      error: 'Failed to get key info',
      message: error.message
    })
  }
})

// 📈 使用统计端点 - /api/v1/usage
router.get('/v1/usage', authenticateApiKey, async (req, res) => {
  try {
    const usage = await apiKeyService.getUsageStats(req.apiKey.id)

    res.json({
      usage,
      limits: {
        tokens: req.apiKey.tokenLimit,
        requests: 0 // 请求限制已移除
      },
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    logger.error('❌ Usage stats error:', error)
    res.status(500).json({
      error: 'Failed to get usage stats',
      message: error.message
    })
  }
})

// 👤 用户信息端点 - Claude Code 客户端需要
router.get('/v1/me', authenticateApiKey, async (req, res) => {
  try {
    // 返回基础用户信息
    res.json({
      id: `user_${req.apiKey.id}`,
      type: 'user',
      display_name: req.apiKey.name || 'API User',
      created_at: new Date().toISOString()
    })
  } catch (error) {
    logger.error('❌ User info error:', error)
    res.status(500).json({
      error: 'Failed to get user info',
      message: error.message
    })
  }
})

// 💰 余额/限制端点 - Claude Code 客户端需要
router.get('/v1/organizations/:org_id/usage', authenticateApiKey, async (req, res) => {
  try {
    const usage = await apiKeyService.getUsageStats(req.apiKey.id)

    res.json({
      object: 'usage',
      data: [
        {
          type: 'credit_balance',
          credit_balance: req.apiKey.tokenLimit - (usage.totalTokens || 0)
        }
      ]
    })
  } catch (error) {
    logger.error('❌ Organization usage error:', error)
    res.status(500).json({
      error: 'Failed to get usage info',
      message: error.message
    })
  }
})

// 🔢 Token计数端点 - count_tokens beta API
router.post('/v1/messages/count_tokens', authenticateApiKey, async (req, res) => {
  try {
    // 检查权限
    if (
      req.apiKey.permissions &&
      req.apiKey.permissions !== 'all' &&
      req.apiKey.permissions !== 'claude'
    ) {
      return res.status(403).json({
        error: {
          type: 'permission_error',
          message: 'This API key does not have permission to access Claude'
        }
      })
    }

    logger.info(`🔢 Processing token count request for key: ${req.apiKey.name}`)

    // 生成会话哈希用于sticky会话
    const sessionHash = sessionHelper.generateSessionHash(req.body)

    // 选择可用的Claude账户
    const requestedModel = req.body.model
    const { accountId, accountType } = await unifiedClaudeScheduler.selectAccountForApiKey(
      req.apiKey,
      sessionHash,
      requestedModel
    )

    let response
    if (accountType === 'claude-official') {
      // 使用官方Claude账号转发count_tokens请求
      response = await claudeRelayService.relayRequest(
        req.body,
        req.apiKey,
        req,
        res,
        req.headers,
        {
          skipUsageRecord: true, // 跳过usage记录，这只是计数请求
          customPath: '/v1/messages/count_tokens' // 指定count_tokens路径
        }
      )
    } else if (accountType === 'claude-console') {
      // 使用Console Claude账号转发count_tokens请求
      response = await claudeConsoleRelayService.relayRequest(
        req.body,
        req.apiKey,
        req,
        res,
        req.headers,
        accountId,
        {
          skipUsageRecord: true, // 跳过usage记录，这只是计数请求
          customPath: '/v1/messages/count_tokens' // 指定count_tokens路径
        }
      )
    } else {
      // Bedrock不支持count_tokens
      return res.status(501).json({
        error: {
          type: 'not_supported',
          message: 'Token counting is not supported for Bedrock accounts'
        }
      })
    }

    // 直接返回响应，不记录token使用量
    res.status(response.statusCode)

    // 设置响应头
    const skipHeaders = ['content-encoding', 'transfer-encoding', 'content-length']
    Object.keys(response.headers).forEach((key) => {
      if (!skipHeaders.includes(key.toLowerCase())) {
        res.setHeader(key, response.headers[key])
      }
    })

    // 尝试解析并返回JSON响应
    try {
      const jsonData = JSON.parse(response.body)
      res.json(jsonData)
    } catch (parseError) {
      res.send(response.body)
    }

    logger.info(`✅ Token count request completed for key: ${req.apiKey.name}`)
  } catch (error) {
    logger.error('❌ Token count error:', error)
    res.status(500).json({
      error: {
        type: 'server_error',
        message: 'Failed to count tokens'
      }
    })
  }
})

module.exports = router
