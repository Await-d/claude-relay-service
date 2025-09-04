const CostCalculator = require('./costCalculator')
const logger = require('./logger')

/**
 * 费用预估工具类
 * 在请求处理前基于请求内容预估费用，用于费用限制检查
 */
class CostEstimator {
  constructor() {
    // 默认token预估配置
    this.estimationConfig = {
      // 基于字符数估算token数的比例 (1 token ≈ 4 characters for English, 2 for Chinese)
      charsPerTokenEnglish: 4,
      charsPerTokenChinese: 2,

      // 默认输出token比例（相对于输入）
      defaultOutputRatio: 0.3,

      // 不同模型的输出比例调整
      modelOutputRatios: {
        'claude-3-opus-20240229': 0.4, // Opus通常输出较长
        'claude-3-5-sonnet-20241022': 0.35,
        'claude-sonnet-4-20250514': 0.35,
        'claude-3-5-haiku-20241022': 0.25, // Haiku通常输出较短
        'claude-3-haiku-20240307': 0.25
      },

      // 缓存使用率预估（保守估计）
      averageCacheHitRate: 0.1, // 10% 的输入可能命中缓存
      averageCacheCreateRate: 0.05, // 5% 的输入可能创建缓存

      // 安全系数（预估费用乘以此系数，避免低估）
      safetyMultiplier: 1.2 // 增加20%的安全余量
    }
  }

  /**
   * 预估单次请求的费用
   * @param {Object} requestBody - 请求体
   * @param {string} model - 模型名称
   * @returns {Object} 预估结果
   */
  estimateRequestCost(requestBody, model = 'unknown') {
    try {
      const startTime = Date.now()

      // 验证输入
      if (!requestBody || !requestBody.messages || !Array.isArray(requestBody.messages)) {
        logger.debug('Invalid request body for cost estimation')
        return {
          estimatedCost: 0,
          breakdown: {},
          confidence: 'low',
          error: 'Invalid request structure'
        }
      }

      // 提取文本内容
      const textContent = this._extractTextFromMessages(requestBody.messages)
      if (!textContent || textContent.length === 0) {
        logger.debug('No text content found for cost estimation')
        return {
          estimatedCost: 0,
          breakdown: {
            inputTokens: 0,
            outputTokens: 0,
            cacheCreateTokens: 0,
            cacheReadTokens: 0
          },
          confidence: 'high',
          estimationTime: Date.now() - startTime
        }
      }

      // 预估输入token数
      const estimatedInputTokens = this._estimateTokenCount(textContent)

      // 预估输出token数
      const outputRatio =
        this.estimationConfig.modelOutputRatios[model] || this.estimationConfig.defaultOutputRatio
      const estimatedOutputTokens = Math.round(estimatedInputTokens * outputRatio)

      // 预估缓存相关token数（保守估计）
      const estimatedCacheReadTokens = Math.round(
        estimatedInputTokens * this.estimationConfig.averageCacheHitRate
      )
      const estimatedCacheCreateTokens = Math.round(
        estimatedInputTokens * this.estimationConfig.averageCacheCreateRate
      )

      // 构建usage对象用于费用计算
      const estimatedUsage = {
        input_tokens: estimatedInputTokens,
        output_tokens: estimatedOutputTokens,
        cache_creation_input_tokens: estimatedCacheCreateTokens,
        cache_read_input_tokens: estimatedCacheReadTokens
      }

      // 计算费用
      const costResult = CostCalculator.calculateCost(estimatedUsage, model)

      // 应用安全系数
      const safeEstimatedCost = costResult.costs.total * this.estimationConfig.safetyMultiplier

      const estimationTime = Date.now() - startTime

      logger.debug(
        `💰 Cost estimation completed: ${model}, estimated: $${safeEstimatedCost.toFixed(4)}, time: ${estimationTime}ms`
      )

      return {
        estimatedCost: safeEstimatedCost,
        breakdown: {
          inputTokens: estimatedInputTokens,
          outputTokens: estimatedOutputTokens,
          cacheCreateTokens: estimatedCacheCreateTokens,
          cacheReadTokens: estimatedCacheReadTokens,
          totalTokens:
            estimatedInputTokens +
            estimatedOutputTokens +
            estimatedCacheCreateTokens +
            estimatedCacheReadTokens
        },
        costBreakdown: costResult.costs,
        confidence: this._assessConfidence(textContent, model),
        model,
        safetyMultiplier: this.estimationConfig.safetyMultiplier,
        estimationTime,
        usingDynamicPricing: costResult.usingDynamicPricing
      }
    } catch (error) {
      logger.warn(`⚠️ Cost estimation error for model ${model}:`, error.message)
      return {
        estimatedCost: 0,
        breakdown: {},
        confidence: 'low',
        error: error.message,
        model
      }
    }
  }

  /**
   * 从消息数组中提取文本内容
   * @param {Array} messages - 消息数组
   * @returns {string} 合并后的文本内容
   */
  _extractTextFromMessages(messages) {
    try {
      let totalText = ''

      for (const message of messages) {
        if (!message || typeof message !== 'object') continue

        // 处理简单文本内容
        if (typeof message.content === 'string') {
          totalText += message.content + '\n'
          continue
        }

        // 处理结构化内容
        if (Array.isArray(message.content)) {
          for (const contentItem of message.content) {
            if (contentItem && typeof contentItem === 'object') {
              // 提取文本类型的内容
              if (contentItem.type === 'text' && typeof contentItem.text === 'string') {
                totalText += contentItem.text + '\n'
              }
              // 其他类型（图像、文档等）暂时不计算，但可能影响费用
            }
          }
        }

        // 处理system prompt等
        if (message.role === 'system' && typeof message.content === 'string') {
          totalText += message.content + '\n'
        }
      }

      return totalText.trim()
    } catch (error) {
      logger.debug('Error extracting text from messages:', error.message)
      return ''
    }
  }

  /**
   * 估算文本的token数量
   * @param {string} text - 文本内容
   * @returns {number} 预估的token数量
   */
  _estimateTokenCount(text) {
    if (!text || typeof text !== 'string') return 0

    // 简单启发式算法：
    // 1. 检测中英文比例
    // 2. 根据不同语言使用不同的字符/token比例
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length
    const totalChars = text.length
    const chineseRatio = totalChars > 0 ? chineseChars / totalChars : 0

    // 基于语言比例计算平均每token的字符数
    const avgCharsPerToken =
      chineseRatio * this.estimationConfig.charsPerTokenChinese +
      (1 - chineseRatio) * this.estimationConfig.charsPerTokenEnglish

    return Math.max(1, Math.round(totalChars / avgCharsPerToken))
  }

  /**
   * 评估预估的置信度
   * @param {string} textContent - 文本内容
   * @param {string} model - 模型名称
   * @returns {string} 置信度等级
   */
  _assessConfidence(textContent, model) {
    // 影响置信度的因素：
    // 1. 文本长度（太短或太长都不太准确）
    // 2. 模型是否有特定的输出比例配置
    // 3. 文本复杂度

    const textLength = textContent.length
    const hasModelConfig = !!this.estimationConfig.modelOutputRatios[model]

    if (textLength < 50) return 'low' // 文本太短
    if (textLength > 10000) return 'medium' // 文本很长，预估可能不准确
    if (hasModelConfig && textLength > 100 && textLength < 5000) return 'high'

    return 'medium'
  }

  /**
   * 快速预估请求费用（用于高频检查）
   * @param {Object} requestBody - 请求体
   * @param {string} model - 模型名称
   * @returns {number} 预估费用（美元）
   */
  quickEstimate(requestBody, model = 'unknown') {
    try {
      if (!requestBody || !requestBody.messages) return 0

      // 快速估算：仅基于字符数和模型基础价格
      const textContent = this._extractTextFromMessages(requestBody.messages)
      if (!textContent) return 0

      const estimatedInputTokens = this._estimateTokenCount(textContent)
      const outputRatio =
        this.estimationConfig.modelOutputRatios[model] || this.estimationConfig.defaultOutputRatio
      const estimatedOutputTokens = Math.round(estimatedInputTokens * outputRatio)

      // 使用模型基础价格快速计算
      const modelPricing = CostCalculator.getModelPricing(model)
      const estimatedCost =
        (estimatedInputTokens / 1000000) * modelPricing.input +
        (estimatedOutputTokens / 1000000) * modelPricing.output

      return estimatedCost * this.estimationConfig.safetyMultiplier
    } catch (error) {
      logger.debug(`Quick cost estimation error: ${error.message}`)
      return 0
    }
  }

  /**
   * 更新预估配置
   * @param {Object} newConfig - 新的配置
   */
  updateConfig(newConfig) {
    if (newConfig && typeof newConfig === 'object') {
      this.estimationConfig = { ...this.estimationConfig, ...newConfig }
      logger.info('💰 Cost estimation config updated:', newConfig)
    }
  }

  /**
   * 获取当前配置
   * @returns {Object} 当前配置
   */
  getConfig() {
    return { ...this.estimationConfig }
  }
}

// 创建单例实例
const costEstimator = new CostEstimator()

module.exports = {
  CostEstimator,
  costEstimator
}
