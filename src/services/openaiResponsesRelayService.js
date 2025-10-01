const axios = require('axios')
const ProxyHelper = require('../utils/proxyHelper')
const logger = require('../utils/logger')
const openaiResponsesAccountService = require('./openaiResponsesAccountService')
const apiKeyService = require('./apiKeyService')
const unifiedOpenAIScheduler = require('./unifiedOpenAIScheduler')
const config = require('../../config/config')
const crypto = require('crypto')

class OpenAIResponsesRelayService {
  constructor() {
    this.defaultTimeout = config.requestTimeout || 600000
  }

  async handleRequest(req, res, account, apiKeyData) {
    const sessionId = req.headers['session_id'] || req.body?.session_id || null
    const sessionHash = sessionId
      ? crypto.createHash('sha256').update(sessionId).digest('hex')
      : null

    let abortController = null

    try {
      const fullAccount = await openaiResponsesAccountService.getAccount(account.id)
      if (!fullAccount) {
        throw new Error('Account not found')
      }

      abortController = new AbortController()

      const handleClientDisconnect = () => {
        if (abortController && !abortController.signal.aborted) {
          logger.info('🔌 Client disconnected, aborting OpenAI-Responses request')
          abortController.abort()
        }
      }

      req.once('close', handleClientDisconnect)
      res.once('close', handleClientDisconnect)

      const targetUrl = `${fullAccount.baseApi}${req.path}`
      logger.info(`🎯 Forwarding OpenAI-Responses request to ${targetUrl}`)

      const headers = {
        ...this._filterRequestHeaders(req.headers),
        Authorization: `Bearer ${fullAccount.apiKey}`,
        'Content-Type': 'application/json'
      }

      if (fullAccount.userAgent) {
        headers['User-Agent'] = fullAccount.userAgent
      } else if (req.headers['user-agent']) {
        headers['User-Agent'] = req.headers['user-agent']
      }

      const requestOptions = {
        method: req.method,
        url: targetUrl,
        headers,
        data: req.body,
        timeout: this.defaultTimeout,
        responseType: req.body?.stream ? 'stream' : 'json',
        validateStatus: () => true,
        signal: abortController.signal
      }

      if (fullAccount.proxy) {
        const proxyAgent = ProxyHelper.createProxyAgent(fullAccount.proxy)
        if (proxyAgent) {
          requestOptions.httpsAgent = proxyAgent
          requestOptions.proxy = false
          logger.info(
            `🌐 Using proxy for OpenAI-Responses: ${ProxyHelper.getProxyDescription(fullAccount.proxy)}`
          )
        }
      }

      const response = await axios(requestOptions)

      if (response.status === 429) {
        const { resetsInSeconds, errorData } = await this._handle429Error(
          account,
          response,
          req.body?.stream,
          sessionHash
        )

        const payload = errorData || {
          error: {
            message: 'Rate limit exceeded',
            type: 'rate_limit_error',
            code: 'rate_limit_exceeded',
            resets_in_seconds: resetsInSeconds
          }
        }

        return res.status(429).json(payload)
      }

      if (response.status >= 400) {
        const payload = await this._normalizeErrorResponse(response)

        if (response.status === 401) {
          let reason = 'OpenAI Responses账号认证失败（401错误）'
          const messageCandidate =
            (typeof payload === 'string' && payload.trim()) ||
            payload?.error?.message ||
            payload?.message ||
            null

          if (messageCandidate) {
            reason = `OpenAI Responses账号认证失败（401错误）：${messageCandidate.trim()}`
          }

          try {
            await unifiedOpenAIScheduler.markAccountUnauthorized(
              account.id,
              'openai-responses',
              sessionHash,
              reason
            )
          } catch (error) {
            logger.error('❌ Failed to mark OpenAI-Responses unauthorized:', error)
          }

          return res
            .status(401)
            .json(typeof payload === 'object' && payload ? payload : { error: { message: reason } })
        }

        return res.status(response.status).json(payload)
      }

      await openaiResponsesAccountService.updateAccount(account.id, {
        lastUsedAt: new Date().toISOString()
      })

      if (req.body?.stream && response.data && typeof response.data.pipe === 'function') {
        return this._handleStreamResponse(
          response,
          res,
          account,
          apiKeyData,
          req.body?.model,
          handleClientDisconnect,
          req
        )
      }

      return this._handleNormalResponse(response, res, account, apiKeyData, req.body?.model)
    } catch (error) {
      if (abortController && !abortController.signal.aborted) {
        abortController.abort()
      }

      const errorInfo = {
        message: error.message,
        code: error.code,
        status: error.response?.status,
        statusText: error.response?.statusText
      }
      logger.error('OpenAI-Responses relay error:', errorInfo)

      if (res.headersSent) {
        return res.end()
      }

      if (error.response) {
        let payload = await this._normalizeErrorResponse(error.response)
        if (error.response.status === 401) {
          let reason = 'OpenAI Responses账号认证失败（401错误）'
          const messageCandidate =
            (typeof payload === 'string' && payload.trim()) ||
            payload?.error?.message ||
            payload?.message ||
            null

          if (messageCandidate) {
            reason = `OpenAI Responses账号认证失败（401错误）：${messageCandidate.trim()}`
          }

          try {
            await unifiedOpenAIScheduler.markAccountUnauthorized(
              account.id,
              'openai-responses',
              sessionHash,
              reason
            )
          } catch (markError) {
            logger.error('❌ Failed to mark unauthorized in catch handler:', markError)
          }

          payload =
            typeof payload === 'object' && payload
              ? payload
              : { error: { message: reason, type: 'unauthorized' } }

          return res.status(401).json(payload)
        }

        return res
          .status(error.response.status || 500)
          .json(
            typeof payload === 'object' && payload
              ? payload
              : { error: { message: 'Request failed' } }
          )
      }

      return res.status(500).json({
        error: {
          message: 'Internal server error',
          type: 'internal_error',
          details: error.message
        }
      })
    }
  }

  async _handleStreamResponse(
    response,
    res,
    account,
    apiKeyData,
    requestedModel,
    handleDisconnect,
    req
  ) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')

    let buffer = ''
    let usageData = null
    let actualModel = null
    let rateLimitDetected = false
    let rateLimitResetsInSeconds = null
    let streamEnded = false

    const parseSSE = (payload) => {
      const lines = payload.split('\n')
      for (const line of lines) {
        if (!line.startsWith('data: ')) {
          continue
        }

        const jsonStr = line.slice(6).trim()
        if (!jsonStr || jsonStr === '[DONE]') {
          continue
        }

        try {
          const eventData = JSON.parse(jsonStr)
          if (eventData.type === 'response.completed' && eventData.response) {
            actualModel = eventData.response.model || actualModel
            usageData = eventData.response.usage || usageData
          }

          if (eventData.error) {
            if (
              eventData.error.type === 'rate_limit_error' ||
              eventData.error.type === 'usage_limit_reached' ||
              eventData.error.type === 'rate_limit_exceeded'
            ) {
              rateLimitDetected = true
              if (eventData.error.resets_in_seconds) {
                rateLimitResetsInSeconds = eventData.error.resets_in_seconds
              }
            }
          }
        } catch (_) {
          // ignore parse errors
        }
      }
    }

    response.data.on('data', (chunk) => {
      const chunkStr = chunk.toString()
      buffer += chunkStr
      if (!res.destroyed) {
        res.write(chunk)
      }

      if (buffer.includes('\n\n')) {
        const events = buffer.split('\n\n')
        buffer = events.pop() || ''
        events.forEach(parseSSE)
      }
    })

    response.data.on('end', async () => {
      streamEnded = true
      if (buffer.trim()) {
        parseSSE(buffer)
      }

      await this._recordUsage(usageData, actualModel, apiKeyData, account, requestedModel)

      if (rateLimitDetected) {
        await unifiedOpenAIScheduler.markAccountRateLimited(
          account.id,
          'openai-responses',
          req.headers['session_id']
            ? crypto.createHash('sha256').update(req.headers['session_id']).digest('hex')
            : null,
          rateLimitResetsInSeconds
        )
      }

      req.removeListener('close', handleDisconnect)
      res.removeListener('close', handleDisconnect)

      if (!res.destroyed) {
        res.end()
      }
    })

    response.data.on('error', (error) => {
      streamEnded = true
      logger.error('OpenAI-Responses stream error:', error)
      req.removeListener('close', handleDisconnect)
      res.removeListener('close', handleDisconnect)

      if (!res.headersSent) {
        res.status(502).json({ error: { message: 'Upstream stream error' } })
      } else if (!res.destroyed) {
        res.end()
      }
    })

    req.on('close', () => {
      if (!streamEnded) {
        try {
          response.data?.destroy?.()
        } catch (_) {
          // ignore
        }
      }
    })
  }

  async _handleNormalResponse(response, res, account, apiKeyData, requestedModel) {
    const payload = response.data
    const usageData = payload?.usage || payload?.response?.usage
    const actualModel = payload?.model || payload?.response?.model || requestedModel || 'gpt-4'

    await this._recordUsage(usageData, actualModel, apiKeyData, account, requestedModel)

    return res.status(response.status).json(payload)
  }

  async _recordUsage(usageData, model, apiKeyData, account, requestedModel) {
    if (!usageData) {
      return
    }

    try {
      const totalInputTokens = usageData.input_tokens || usageData.prompt_tokens || 0
      const outputTokens = usageData.output_tokens || usageData.completion_tokens || 0
      const cacheReadTokens = usageData.input_tokens_details?.cached_tokens || 0
      const actualInputTokens = Math.max(0, totalInputTokens - cacheReadTokens)
      const totalTokens = usageData.total_tokens || totalInputTokens + outputTokens
      const modelName = model || requestedModel || 'gpt-4'

      await apiKeyService.recordUsage(
        apiKeyData.id,
        actualInputTokens,
        outputTokens,
        0,
        cacheReadTokens,
        modelName,
        account.id
      )

      await openaiResponsesAccountService.updateAccountUsage(account.id, totalTokens)

      if (parseFloat(account.dailyQuota) > 0) {
        const CostCalculator = require('../utils/costCalculator')
        const costInfo = CostCalculator.calculateCost(
          {
            input_tokens: actualInputTokens,
            output_tokens: outputTokens,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: cacheReadTokens
          },
          modelName
        )
        await openaiResponsesAccountService.updateUsageQuota(account.id, costInfo.costs.total)
      }
    } catch (error) {
      logger.error('Failed to record OpenAI-Responses usage:', error)
    }
  }

  async _handle429Error(account, response, isStream = false, sessionHash = null) {
    let resetsInSeconds = null
    let errorData = null

    try {
      if (isStream && response.data && typeof response.data.pipe === 'function') {
        const chunks = []
        await new Promise((resolve, reject) => {
          response.data.on('data', (chunk) => chunks.push(chunk))
          response.data.on('end', resolve)
          response.data.on('error', reject)
          setTimeout(resolve, 5000)
        })

        const payload = Buffer.concat(chunks).toString()
        if (payload.includes('data: ')) {
          const lines = payload.split('\n')
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const jsonStr = line.slice(6).trim()
                if (jsonStr && jsonStr !== '[DONE]') {
                  errorData = JSON.parse(jsonStr)
                  break
                }
              } catch (_) {
                // ignore parse errors
              }
            }
          }
        }

        if (!errorData) {
          try {
            errorData = JSON.parse(payload)
          } catch (err) {
            logger.error('Failed to parse 429 stream payload:', err)
            logger.debug('Raw 429 payload:', payload)
          }
        }
      } else if (response.data && typeof response.data !== 'object') {
        try {
          errorData = JSON.parse(response.data)
        } catch (err) {
          logger.error('Failed to parse 429 response as JSON:', err)
          errorData = { error: { message: response.data } }
        }
      } else if (response.data && typeof response.data === 'object') {
        errorData = response.data
      }

      if (errorData?.error?.resets_in_seconds) {
        resetsInSeconds = errorData.error.resets_in_seconds
      } else if (errorData?.error?.resets_in) {
        resetsInSeconds = parseInt(errorData.error.resets_in, 10)
      }
    } catch (error) {
      logger.error('Failed to parse OpenAI-Responses 429 response:', error)
    }

    await unifiedOpenAIScheduler.markAccountRateLimited(
      account.id,
      'openai-responses',
      sessionHash,
      resetsInSeconds
    )

    return { resetsInSeconds, errorData }
  }

  async _normalizeErrorResponse(response) {
    if (!response) {
      return { error: { message: 'Unknown error' } }
    }

    if (response.data && typeof response.data === 'object' && !response.data.pipe) {
      return response.data
    }

    if (response.data && typeof response.data === 'string') {
      try {
        return JSON.parse(response.data)
      } catch (error) {
        return { error: { message: response.data } }
      }
    }

    if (response.data && typeof response.data.pipe === 'function') {
      const chunks = []
      await new Promise((resolve) => {
        response.data.on('data', (chunk) => chunks.push(chunk))
        response.data.on('end', resolve)
        response.data.on('error', resolve)
        setTimeout(resolve, 5000)
      })

      const payload = Buffer.concat(chunks).toString()
      try {
        return JSON.parse(payload)
      } catch (error) {
        return { error: { message: payload || response.statusText || 'Request failed' } }
      }
    }

    return { error: { message: response.statusText || 'Request failed', code: response.status } }
  }

  _filterRequestHeaders(headers) {
    const filtered = {}
    const skip = [
      'host',
      'content-length',
      'authorization',
      'x-api-key',
      'x-cr-api-key',
      'connection',
      'upgrade',
      'sec-websocket-key',
      'sec-websocket-version',
      'sec-websocket-extensions'
    ]

    for (const [key, value] of Object.entries(headers || {})) {
      if (!skip.includes(key.toLowerCase())) {
        filtered[key] = value
      }
    }

    return filtered
  }
}

module.exports = new OpenAIResponsesRelayService()
