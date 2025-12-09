const crypto = require('crypto')
const express = require('express')
const { authenticateApiKey } = require('../middleware/auth')
const droidRelayService = require('../services/droidRelayService')
const sessionHelper = require('../utils/sessionHelper')
const logger = require('../utils/logger')

const router = express.Router()

function hasDroidPermission(apiKeyData) {
  const permissions = apiKeyData?.permissions || 'all'
  return permissions === 'all' || permissions === 'droid'
}

/**
 * Droid API 转发路由
 *
 * 支持的 Factory.ai 端点:
 * - /droid/claude - Anthropic (Claude) Messages API
 * - /droid/openai - OpenAI Responses API
 * - /droid/comm   - OpenAI Chat Completions API
 */

// Claude (Anthropic) 端点 - /v1/messages/count_tokens
router.post('/claude/v1/messages/count_tokens', authenticateApiKey, async (req, res) => {
  try {
    if (!hasDroidPermission(req.apiKey)) {
      logger.security(
        `🚫 API Key ${req.apiKey?.id || 'unknown'} 缺少 Droid 权限，拒绝访问 ${req.originalUrl}`
      )
      return res.status(403).json({
        error: 'permission_denied',
        message: '此 API Key 未启用 Droid 权限'
      })
    }

    // 简单估算 token 数量（Factory.ai 可能不支持 count_tokens）
    const messages = req.body?.messages || []
    const system = req.body?.system || ''
    let totalChars = 0

    // 计算 system prompt 长度
    if (typeof system === 'string') {
      totalChars += system.length
    } else if (Array.isArray(system)) {
      system.forEach((s) => {
        if (s?.text) {
          totalChars += s.text.length
        }
      })
    }

    // 计算 messages 长度
    messages.forEach((msg) => {
      if (typeof msg.content === 'string') {
        totalChars += msg.content.length
      } else if (Array.isArray(msg.content)) {
        msg.content.forEach((c) => {
          if (c?.text) {
            totalChars += c.text.length
          }
        })
      }
    })

    // 估算 token 数量（约 4 字符 = 1 token）
    const estimatedTokens = Math.ceil(totalChars / 4)

    res.json({
      input_tokens: estimatedTokens
    })
  } catch (error) {
    logger.error('Droid count_tokens error:', error)
    res.status(500).json({
      error: 'internal_server_error',
      message: error.message
    })
  }
})

// Claude (Anthropic) 端点 - /v1/messages
router.post('/claude/v1/messages', authenticateApiKey, async (req, res) => {
  try {
    const sessionHash = sessionHelper.generateSessionHash(req.body)

    if (!hasDroidPermission(req.apiKey)) {
      logger.security(
        `🚫 API Key ${req.apiKey?.id || 'unknown'} 缺少 Droid 权限，拒绝访问 ${req.originalUrl}`
      )
      return res.status(403).json({
        error: 'permission_denied',
        message: '此 API Key 未启用 Droid 权限'
      })
    }

    const result = await droidRelayService.relayRequest(
      req.body,
      req.apiKey,
      req,
      res,
      req.headers,
      { endpointType: 'anthropic', sessionHash }
    )

    // 如果是流式响应，已经在 relayService 中处理了
    if (result.streaming) {
      return
    }

    // 非流式响应
    res.status(result.statusCode).set(result.headers).send(result.body)
  } catch (error) {
    logger.error('Droid Claude relay error:', error)
    res.status(500).json({
      error: 'internal_server_error',
      message: error.message
    })
  }
})

// Comm 端点 - /v1/chat/completions（OpenAI Chat Completions 格式）
router.post('/comm/v1/chat/completions', authenticateApiKey, async (req, res) => {
  try {
    const sessionId =
      req.headers['session_id'] ||
      req.headers['x-session-id'] ||
      req.body?.session_id ||
      req.body?.conversation_id ||
      null

    const sessionHash = sessionId
      ? crypto.createHash('sha256').update(String(sessionId)).digest('hex')
      : null

    if (!hasDroidPermission(req.apiKey)) {
      logger.security(
        `🚫 API Key ${req.apiKey?.id || 'unknown'} 缺少 Droid 权限，拒绝访问 ${req.originalUrl}`
      )
      return res.status(403).json({
        error: 'permission_denied',
        message: '此 API Key 未启用 Droid 权限'
      })
    }

    const result = await droidRelayService.relayRequest(
      req.body,
      req.apiKey,
      req,
      res,
      req.headers,
      { endpointType: 'comm', sessionHash }
    )

    if (result.streaming) {
      return
    }

    res.status(result.statusCode).set(result.headers).send(result.body)
  } catch (error) {
    logger.error('Droid Comm relay error:', error)
    res.status(500).json({
      error: 'internal_server_error',
      message: error.message
    })
  }
})

// OpenAI 端点 - /v1/responses
router.post(['/openai/v1/responses', '/openai/responses'], authenticateApiKey, async (req, res) => {
  try {
    const sessionId =
      req.headers['session_id'] ||
      req.headers['x-session-id'] ||
      req.body?.session_id ||
      req.body?.conversation_id ||
      null

    const sessionHash = sessionId
      ? crypto.createHash('sha256').update(String(sessionId)).digest('hex')
      : null

    if (!hasDroidPermission(req.apiKey)) {
      logger.security(
        `🚫 API Key ${req.apiKey?.id || 'unknown'} 缺少 Droid 权限，拒绝访问 ${req.originalUrl}`
      )
      return res.status(403).json({
        error: 'permission_denied',
        message: '此 API Key 未启用 Droid 权限'
      })
    }

    const result = await droidRelayService.relayRequest(
      req.body,
      req.apiKey,
      req,
      res,
      req.headers,
      { endpointType: 'openai', sessionHash }
    )

    if (result.streaming) {
      return
    }

    res.status(result.statusCode).set(result.headers).send(result.body)
  } catch (error) {
    logger.error('Droid OpenAI relay error:', error)
    res.status(500).json({
      error: 'internal_server_error',
      message: error.message
    })
  }
})

// 模型列表端点（兼容性）
router.get('/*/v1/models', authenticateApiKey, async (req, res) => {
  try {
    // 返回可用的模型列表
    const models = [
      {
        id: 'claude-opus-4-1-20250805',
        object: 'model',
        created: Date.now(),
        owned_by: 'anthropic'
      },
      {
        id: 'claude-sonnet-4-5-20250929',
        object: 'model',
        created: Date.now(),
        owned_by: 'anthropic'
      },
      {
        id: 'gpt-5-2025-08-07',
        object: 'model',
        created: Date.now(),
        owned_by: 'openai'
      }
    ]

    res.json({
      object: 'list',
      data: models
    })
  } catch (error) {
    logger.error('Droid models list error:', error)
    res.status(500).json({
      error: 'internal_server_error',
      message: error.message
    })
  }
})

module.exports = router
