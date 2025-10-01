const axios = require('axios')
const ProxyHelper = require('../utils/proxyHelper')
const logger = require('../utils/logger')
const config = require('../../config/config')
const apiKeyService = require('./apiKeyService')

// Gemini API 配置
const GEMINI_API_BASE = 'https://cloudcode.googleapis.com/v1'
const DEFAULT_MODEL = 'models/gemini-2.0-flash-exp'

// 创建代理 agent（使用统一的代理工具）
function createProxyAgent(proxyConfig) {
  return ProxyHelper.createProxyAgent(proxyConfig)
}

// 转换 OpenAI 消息格式到 Gemini 格式
function convertMessagesToGemini(messages) {
  const contents = []
  let systemInstruction = ''

  for (const message of messages) {
    if (message.role === 'system') {
      systemInstruction += (systemInstruction ? '\n\n' : '') + message.content
    } else if (message.role === 'user') {
      contents.push({
        role: 'user',
        parts: [{ text: message.content }]
      })
    } else if (message.role === 'assistant') {
      contents.push({
        role: 'model',
        parts: [{ text: message.content }]
      })
    }
  }

  return { contents, systemInstruction }
}

// 转换 Gemini 响应到 OpenAI 格式
function convertGeminiResponse(geminiResponse, model, stream = false) {
  // 🔍 增强的输入验证
  if (!geminiResponse) {
    logger.warn('Empty Gemini response received')
    return null
  }

  // 🚨 处理API错误响应
  if (geminiResponse.error) {
    const error = new Error(geminiResponse.error.message || 'Gemini API error')
    error.status = geminiResponse.error.code === 'PERMISSION_DENIED' ? 403 : 400
    error.error = {
      message: geminiResponse.error.message || 'Gemini API error',
      type: 'api_error',
      code: geminiResponse.error.code || 'unknown'
    }
    throw error
  }

  if (stream) {
    // 流式响应
    const candidate = geminiResponse.candidates?.[0]
    if (!candidate) {
      return null
    }

    const content = candidate.content?.parts?.[0]?.text || ''
    // 🔧 改进的finishReason处理 - 支持更多v1beta格式
    let { finishReason } = candidate
    if (finishReason) {
      finishReason = finishReason.toLowerCase()
      // 标准化不同的结束原因格式
      if (finishReason === 'finish_reason_stop' || finishReason === 'stop') {
        finishReason = 'stop'
      }
    }

    return {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          delta: {
            content
          },
          finish_reason: finishReason === 'stop' ? 'stop' : null
        }
      ]
    }
  } else {
    // 非流式响应 - 增强的v1beta兼容性
    const candidate = geminiResponse.candidates?.[0]
    if (!candidate) {
      // 🔧 更详细的错误信息，帮助调试v1beta问题
      const errorMsg = geminiResponse.promptFeedback
        ? `Gemini blocked request: ${geminiResponse.promptFeedback.blockReason || 'unknown reason'}`
        : 'No response candidates from Gemini'
      throw new Error(errorMsg)
    }

    const content = candidate.content?.parts?.[0]?.text || ''
    // 🔧 改进的finishReason处理
    let finishReason = candidate.finishReason?.toLowerCase() || 'stop'
    if (finishReason === 'finish_reason_stop') {
      finishReason = 'stop'
    }

    // 计算 token 使用量 - 支持v1beta的不同响应格式
    const usage = geminiResponse.usageMetadata ||
      geminiResponse.usage || {
        promptTokenCount: 0,
        candidatesTokenCount: 0,
        totalTokenCount: 0
      }

    return {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content
          },
          finish_reason: finishReason
        }
      ],
      usage: {
        prompt_tokens: usage.promptTokenCount || usage.prompt_tokens || 0,
        completion_tokens: usage.candidatesTokenCount || usage.completion_tokens || 0,
        total_tokens: usage.totalTokenCount || usage.total_tokens || 0
      }
    }
  }
}

// 处理流式响应
async function* handleStreamResponse(response, model, apiKeyId, accountId = null) {
  let buffer = ''
  let totalUsage = {
    promptTokenCount: 0,
    candidatesTokenCount: 0,
    totalTokenCount: 0
  }

  try {
    for await (const chunk of response.data) {
      buffer += chunk.toString()

      // 处理 SSE 格式的数据
      const lines = buffer.split('\n')
      buffer = lines.pop() || '' // 保留最后一个不完整的行

      for (const line of lines) {
        if (!line.trim()) {
          continue
        }

        // 处理 SSE 格式: "data: {...}"
        let jsonData = line
        if (line.startsWith('data: ')) {
          jsonData = line.substring(6).trim()
        }

        if (!jsonData || jsonData === '[DONE]') {
          continue
        }

        try {
          const data = JSON.parse(jsonData)

          // 🔍 增强的错误检查：处理v1beta可能出现的异常数据结构
          if (data.error) {
            logger.error('Gemini API error in stream:', data.error)
            yield `data: ${JSON.stringify({
              error: {
                message: data.error.message || 'Gemini API error',
                type: 'api_error',
                code: data.error.code || 'unknown'
              }
            })}\n\n`
            continue
          }

          // 更新使用量统计
          if (data.usageMetadata) {
            totalUsage = data.usageMetadata
          }

          // 转换并发送响应 - 增加空响应处理
          const openaiResponse = convertGeminiResponse(data, model, true)
          if (openaiResponse) {
            yield `data: ${JSON.stringify(openaiResponse)}\n\n`
          }

          // 检查是否结束 - 增强结束条件检测
          const finishReason = data.candidates?.[0]?.finishReason
          if (finishReason === 'STOP' || finishReason === 'FINISH_REASON_STOP') {
            // 记录使用量
            if (apiKeyId && totalUsage.totalTokenCount > 0) {
              await apiKeyService
                .recordUsage(
                  apiKeyId,
                  totalUsage.promptTokenCount || 0, // inputTokens
                  totalUsage.candidatesTokenCount || 0, // outputTokens
                  0, // cacheCreateTokens (Gemini 没有这个概念)
                  0, // cacheReadTokens (Gemini 没有这个概念)
                  model,
                  accountId
                )
                .catch((error) => {
                  logger.error('❌ Failed to record Gemini usage:', error)
                })
            }

            yield 'data: [DONE]\n\n'
            return
          }
        } catch (e) {
          // 🔧 改进的JSON解析错误处理
          logger.debug('Error parsing JSON line:', e.message, 'Line:', jsonData?.substring(0, 100))
          // 对于无法解析的数据，尝试直接转发（某些情况下可能是原始SSE数据）
          if (jsonData && !jsonData.includes('error')) {
            logger.debug('Attempting to forward unparsed data as-is')
          }
        }
      }
    }

    // 处理剩余的 buffer
    if (buffer.trim()) {
      try {
        let jsonData = buffer.trim()
        if (jsonData.startsWith('data: ')) {
          jsonData = jsonData.substring(6).trim()
        }

        if (jsonData && jsonData !== '[DONE]') {
          const data = JSON.parse(jsonData)
          const openaiResponse = convertGeminiResponse(data, model, true)
          if (openaiResponse) {
            yield `data: ${JSON.stringify(openaiResponse)}\n\n`
          }
        }
      } catch (e) {
        logger.debug('Error parsing final buffer:', e.message)
      }
    }

    yield 'data: [DONE]\n\n'
  } catch (error) {
    // 检查是否是请求被中止
    if (error.name === 'CanceledError' || error.code === 'ECONNABORTED') {
      logger.info('Stream request was aborted by client')
    } else {
      logger.error('Stream processing error:', error)
      yield `data: ${JSON.stringify({
        error: {
          message: error.message,
          type: 'stream_error'
        }
      })}\n\n`
    }
  }
}

// 发送请求到 Gemini
async function sendGeminiRequest({
  messages,
  model = DEFAULT_MODEL,
  temperature = 0.7,
  maxTokens = 4096,
  stream = false,
  accessToken,
  proxy,
  apiKeyId,
  signal,
  projectId,
  location = 'us-central1',
  accountId = null,
  integrationType = 'oauth',
  baseUrl = '',
  apiKey = '',
  userAgent = ''
}) {
  // 确保模型名称格式正确
  if (!model.startsWith('models/')) {
    model = `models/${model}`
  }

  const { contents, systemInstruction } = convertMessagesToGemini(messages)

  const requestBody = {
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      candidateCount: 1
    }
  }

  if (systemInstruction) {
    requestBody.systemInstruction = { parts: [{ text: systemInstruction }] }
  }

  const isThirdParty = integrationType === 'third_party'
  const headers = {
    'Content-Type': 'application/json'
  }
  let apiUrl

  if (isThirdParty) {
    if (!baseUrl || !baseUrl.trim()) {
      throw new Error('Base URL is required for third-party Gemini account')
    }
    if (!apiKey || !apiKey.trim()) {
      throw new Error('API key is required for third-party Gemini account')
    }

    let normalizedBaseUrl = baseUrl.trim()
    if (normalizedBaseUrl.endsWith('/')) {
      normalizedBaseUrl = normalizedBaseUrl.slice(0, -1)
    }

    apiUrl = `${normalizedBaseUrl}/${model}:${stream ? 'streamGenerateContent' : 'generateContent'}`
    headers.Authorization = `Bearer ${apiKey.trim()}`
    headers['x-api-key'] = apiKey.trim()
    if (userAgent) {
      headers['User-Agent'] = userAgent
    }
    logger.debug(`Using third-party Gemini endpoint: ${apiUrl}`)
  } else {
    if (!accessToken) {
      throw new Error('Access token is required for Gemini OAuth account')
    }

    if (projectId) {
      apiUrl = `${GEMINI_API_BASE}/projects/${projectId}/locations/${location}/${model}:${stream ? 'streamGenerateContent' : 'generateContent'}?alt=sse`
      logger.debug(`Using project-specific URL with projectId: ${projectId}, location: ${location}`)
    } else {
      apiUrl = `${GEMINI_API_BASE}/${model}:${stream ? 'streamGenerateContent' : 'generateContent'}?alt=sse`
      logger.debug('Using standard URL without projectId')
    }

    headers.Authorization = `Bearer ${accessToken}`
  }

  const axiosConfig = {
    method: 'POST',
    url: apiUrl,
    headers,
    data: requestBody,
    timeout: config.requestTimeout || 120000
  }

  const proxyAgent = createProxyAgent(proxy)
  if (proxyAgent) {
    axiosConfig.httpsAgent = proxyAgent
    logger.info(`🌐 Using proxy for Gemini API request: ${ProxyHelper.getProxyDescription(proxy)}`)
  } else {
    logger.debug('🌐 No proxy configured for Gemini API request')
  }

  if (signal) {
    axiosConfig.signal = signal
    logger.debug('AbortController signal attached to request')
  }

  if (stream) {
    axiosConfig.responseType = 'stream'
  }

  try {
    logger.debug(`Sending request to Gemini API (${integrationType})`)
    const response = await axios(axiosConfig)

    if (stream) {
      return handleStreamResponse(response, model, apiKeyId, accountId)
    }

    const openaiResponse = convertGeminiResponse(response.data, model, false)

    if (apiKeyId && openaiResponse.usage) {
      await apiKeyService
        .recordUsage(
          apiKeyId,
          openaiResponse.usage.prompt_tokens || 0,
          openaiResponse.usage.completion_tokens || 0,
          0,
          0,
          model,
          accountId
        )
        .catch((error) => {
          logger.error('❌ Failed to record Gemini usage:', error)
        })
    }

    return openaiResponse
  } catch (error) {
    if (error.name === 'CanceledError' || error.code === 'ECONNABORTED') {
      logger.info('Gemini request was aborted by client')
      const err = new Error('Request canceled by client')
      err.status = 499
      err.error = {
        message: 'Request canceled by client',
        type: 'canceled',
        code: 'request_canceled'
      }
      throw err
    }

    logger.error('Gemini API request failed:', error.response?.data || error.message)

    if (error.response) {
      const geminiError = error.response.data?.error
      const err = new Error(geminiError?.message || 'Gemini API request failed')
      err.status = error.response.status
      err.error = {
        message: geminiError?.message || 'Gemini API request failed',
        type: geminiError?.code || 'api_error',
        code: geminiError?.code
      }
      throw err
    }

    const err = new Error(error.message)
    err.status = 500
    err.error = {
      message: error.message,
      type: 'network_error'
    }
    throw err
  }
}

// 获取可用模型列表
async function getAvailableModels({
  integrationType = 'oauth',
  accessToken,
  proxy,
  projectId,
  location = 'us-central1',
  baseUrl = '',
  apiKey = '',
  userAgent = ''
}) {
  const isThirdParty = integrationType === 'third_party'
  const headers = {}
  let apiUrl

  if (isThirdParty) {
    if (!baseUrl || !baseUrl.trim() || !apiKey || !apiKey.trim()) {
      logger.warn('Third-party Gemini account missing baseUrl or apiKey when listing models')
      return []
    }

    let normalizedBaseUrl = baseUrl.trim()
    if (normalizedBaseUrl.endsWith('/')) {
      normalizedBaseUrl = normalizedBaseUrl.slice(0, -1)
    }

    apiUrl = `${normalizedBaseUrl}/models`
    headers.Authorization = `Bearer ${apiKey.trim()}`
    headers['x-api-key'] = apiKey.trim()
    if (userAgent) {
      headers['User-Agent'] = userAgent
    }
    logger.debug(`Fetching models from third-party Gemini endpoint: ${apiUrl}`)
  } else {
    if (!accessToken) {
      throw new Error('Access token is required for Gemini OAuth account')
    }

    if (projectId) {
      apiUrl = `${GEMINI_API_BASE}/projects/${projectId}/locations/${location}/models`
      logger.debug(`Fetching models with projectId: ${projectId}, location: ${location}`)
    } else {
      apiUrl = `${GEMINI_API_BASE}/models`
      logger.debug('Fetching models without projectId')
    }

    headers.Authorization = `Bearer ${accessToken}`
  }

  const axiosConfig = {
    method: 'GET',
    url: apiUrl,
    headers,
    timeout: 30000
  }

  const proxyAgent = createProxyAgent(proxy)
  if (proxyAgent) {
    axiosConfig.httpsAgent = proxyAgent
    logger.info(
      `🌐 Using proxy for Gemini models request: ${ProxyHelper.getProxyDescription(proxy)}`
    )
  } else {
    logger.debug('🌐 No proxy configured for Gemini models request')
  }

  try {
    const response = await axios(axiosConfig)
    const models = response.data.models || []

    return models
      .filter((model) => model.supportedGenerationMethods?.includes('generateContent'))
      .map((model) => ({
        id: model.name.replace('models/', ''),
        object: 'model',
        created: Date.now() / 1000,
        owned_by: 'google'
      }))
  } catch (error) {
    logger.error('Failed to get Gemini models:', error)
    return [
      {
        id: 'gemini-2.0-flash-exp',
        object: 'model',
        created: Date.now() / 1000,
        owned_by: 'google'
      }
    ]
  }
}

// Count Tokens API - 用于Gemini CLI兼容性
async function countTokens({
  model,
  content,
  accessToken,
  proxy,
  projectId,
  location = 'us-central1',
  integrationType = 'oauth',
  baseUrl = '',
  apiKey = '',
  userAgent = ''
}) {
  if (!model.startsWith('models/')) {
    model = `models/${model}`
  }

  let requestBody
  if (Array.isArray(content)) {
    requestBody = { contents: content }
  } else if (typeof content === 'string') {
    requestBody = {
      contents: [
        {
          parts: [{ text: content }]
        }
      ]
    }
  } else if (content.parts || content.role) {
    requestBody = { contents: [content] }
  } else {
    requestBody = { contents: content }
  }

  const isThirdParty = integrationType === 'third_party'
  let apiUrl
  const headers = {
    'Content-Type': 'application/json'
  }

  if (isThirdParty) {
    if (!baseUrl || !baseUrl.trim() || !apiKey || !apiKey.trim()) {
      throw new Error('Third-party Gemini account requires baseUrl and apiKey for countTokens')
    }

    let normalizedBaseUrl = baseUrl.trim()
    if (normalizedBaseUrl.endsWith('/')) {
      normalizedBaseUrl = normalizedBaseUrl.slice(0, -1)
    }

    apiUrl = `${normalizedBaseUrl}/${model}:countTokens`
    headers.Authorization = `Bearer ${apiKey.trim()}`
    headers['x-api-key'] = apiKey.trim()
    if (userAgent) {
      headers['User-Agent'] = userAgent
    }
  } else {
    if (!accessToken) {
      throw new Error('Access token is required for Gemini OAuth account')
    }

    const GENERATIVE_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'
    if (projectId) {
      apiUrl = `${GENERATIVE_API_BASE}/projects/${projectId}/locations/${location}/${model}:countTokens`
      logger.debug(
        `Using project-specific countTokens URL with projectId: ${projectId}, location: ${location}`
      )
    } else {
      apiUrl = `${GENERATIVE_API_BASE}/${model}:countTokens`
      logger.debug('Using standard countTokens URL without projectId')
    }

    headers.Authorization = `Bearer ${accessToken}`
    headers['X-Goog-User-Project'] = projectId || undefined
  }

  const axiosConfig = {
    method: 'POST',
    url: apiUrl,
    headers,
    data: requestBody,
    timeout: 30000
  }

  const proxyAgent = createProxyAgent(proxy)
  if (proxyAgent) {
    axiosConfig.httpsAgent = proxyAgent
    logger.info(
      `🌐 Using proxy for Gemini countTokens request: ${ProxyHelper.getProxyDescription(proxy)}`
    )
  } else {
    logger.debug('🌐 No proxy configured for Gemini countTokens request')
  }

  try {
    logger.debug(`Sending countTokens request to: ${apiUrl}`)
    logger.debug(`Request body: ${JSON.stringify(requestBody, null, 2)}`)
    const response = await axios(axiosConfig)

    return {
      totalTokens: response.data.totalTokens || response.data.total_tokens || 0,
      promptTokens: response.data.promptTokens || response.data.prompt_tokens || 0,
      candidatesTokens: response.data.candidatesTokens || response.data.completion_tokens || 0
    }
  } catch (error) {
    logger.error('Gemini countTokens API request failed:', {
      message: error.message,
      response: error.response?.data
    })
    throw error
  }
}

module.exports = {
  sendGeminiRequest,
  getAvailableModels,
  convertMessagesToGemini,
  convertGeminiResponse,
  countTokens
}
