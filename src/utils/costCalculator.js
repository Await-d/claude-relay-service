const pricingService = require('../services/pricingService')

// Azure OpenAI 专用定价数据 (USD per 1K tokens)
const AZURE_OPENAI_PRICING = {
  // GPT-4o 系列
  'gpt-4o': { input: 2.5, output: 10.0, cacheRead: 1.25 },
  'gpt-4o-2024-11-20': { input: 2.5, output: 10.0, cacheRead: 1.25 },
  'gpt-4o-2024-08-06': { input: 2.5, output: 10.0, cacheRead: 1.25 },
  'gpt-4o-2024-05-13': { input: 2.5, output: 10.0, cacheRead: 1.25 },
  'gpt-4o-mini': { input: 0.15, output: 0.6, cacheRead: 0.075 },
  'gpt-4o-mini-2024-07-18': { input: 0.15, output: 0.6, cacheRead: 0.075 },

  // GPT-4 Turbo 系列
  'gpt-4-turbo': { input: 10.0, output: 30.0, cacheRead: 5.0 },
  'gpt-4-turbo-2024-04-09': { input: 10.0, output: 30.0, cacheRead: 5.0 },
  'gpt-4-0125-preview': { input: 10.0, output: 30.0, cacheRead: 5.0 },
  'gpt-4-1106-preview': { input: 10.0, output: 30.0, cacheRead: 5.0 },

  // GPT-4 经典版本
  'gpt-4': { input: 30.0, output: 60.0, cacheRead: 15.0 },
  'gpt-4-0613': { input: 30.0, output: 60.0, cacheRead: 15.0 },
  'gpt-4-32k': { input: 60.0, output: 120.0, cacheRead: 30.0 },
  'gpt-4-32k-0613': { input: 60.0, output: 120.0, cacheRead: 30.0 },

  // GPT-3.5 Turbo 系列
  'gpt-35-turbo': { input: 0.5, output: 1.5, cacheRead: 0.25 },
  'gpt-35-turbo-0125': { input: 0.5, output: 1.5, cacheRead: 0.25 },
  'gpt-35-turbo-1106': { input: 1.0, output: 2.0, cacheRead: 0.5 },
  'gpt-35-turbo-16k': { input: 3.0, output: 4.0, cacheRead: 1.5 },
  'gpt-35-turbo-16k-0613': { input: 3.0, output: 4.0, cacheRead: 1.5 },

  // O1 系列 (推理模型 - 更高定价)
  'o1-preview': { input: 15.0, output: 60.0, cacheRead: 7.5 },
  'o1-preview-2024-09-12': { input: 15.0, output: 60.0, cacheRead: 7.5 },
  'o1-mini': { input: 3.0, output: 12.0, cacheRead: 1.5 },
  'o1-mini-2024-09-12': { input: 3.0, output: 12.0, cacheRead: 1.5 },

  // O3 系列 (最新推理模型)
  'o3-mini': { input: 3.5, output: 14.0, cacheRead: 1.75 },
  'o3-mini-2025-01-31': { input: 3.5, output: 14.0, cacheRead: 1.75 },

  // 嵌入模型
  'text-embedding-ada-002': { input: 0.1, output: 0, cacheRead: 0 },
  'text-embedding-3-small': { input: 0.02, output: 0, cacheRead: 0 },
  'text-embedding-3-large': { input: 0.13, output: 0, cacheRead: 0 },

  // DALL-E 模型 (按图像计费)
  'dall-e-2': { input: 0, output: 0, cacheRead: 0, imagePrice: 20.0 }, // $0.02/image = $20/1K images
  'dall-e-3': { input: 0, output: 0, cacheRead: 0, imagePrice: 40.0 } // $0.04/image = $40/1K images
}

// Claude模型价格配置 (USD per 1M tokens) - 备用定价
const MODEL_PRICING = {
  // Claude 3.5 Sonnet
  'claude-3-5-sonnet-20241022': {
    input: 3.0,
    output: 15.0,
    cacheWrite: 3.75,
    cacheRead: 0.3
  },
  'claude-sonnet-4-20250514': {
    input: 3.0,
    output: 15.0,
    cacheWrite: 3.75,
    cacheRead: 0.3
  },

  // Claude 3.5 Haiku
  'claude-3-5-haiku-20241022': {
    input: 0.25,
    output: 1.25,
    cacheWrite: 0.3,
    cacheRead: 0.03
  },

  // Claude 3 Opus
  'claude-3-opus-20240229': {
    input: 15.0,
    output: 75.0,
    cacheWrite: 18.75,
    cacheRead: 1.5
  },

  // Claude Opus 4.1 (新模型)
  'claude-opus-4-1-20250805': {
    input: 15.0,
    output: 75.0,
    cacheWrite: 18.75,
    cacheRead: 1.5
  },

  // Claude 3 Sonnet
  'claude-3-sonnet-20240229': {
    input: 3.0,
    output: 15.0,
    cacheWrite: 3.75,
    cacheRead: 0.3
  },

  // Claude 3 Haiku
  'claude-3-haiku-20240307': {
    input: 0.25,
    output: 1.25,
    cacheWrite: 0.3,
    cacheRead: 0.03
  },

  // 默认定价（用于未知模型）
  unknown: {
    input: 3.0,
    output: 15.0,
    cacheWrite: 3.75,
    cacheRead: 0.3
  }
}

class CostCalculator {
  /**
   * 计算单次请求的费用
   * @param {Object} usage - 使用量数据
   * @param {number} usage.input_tokens - 输入token数量
   * @param {number} usage.output_tokens - 输出token数量
   * @param {number} usage.cache_creation_input_tokens - 缓存创建token数量
   * @param {number} usage.cache_read_input_tokens - 缓存读取token数量
   * @param {string} model - 模型名称
   * @returns {Object} 费用详情
   */
  /**
   * 计算单次请求的费用
   * @param {Object} usage - 使用量数据
   * @param {number} usage.input_tokens - 输入token数量
   * @param {number} usage.output_tokens - 输出token数量
   * @param {number} usage.cache_creation_input_tokens - 缓存创建token数量
   * @param {number} usage.cache_read_input_tokens - 缓存读取token数量
   * @param {string} model - 模型名称
   * @param {string} platform - 平台类型 (optional: 'azure_openai', 'openai', 'claude')
   * @returns {Object} 费用详情
   */
  static calculateCost(usage, model = 'unknown', platform = null) {
    // 输入参数验证
    if (!usage || typeof usage !== 'object') {
      usage = {}
    }

    // 如果 usage 包含详细的 cache_creation 对象，使用 pricingService 来处理
    if (usage.cache_creation && typeof usage.cache_creation === 'object') {
      return pricingService.calculateCost(usage, model)
    }

    // 否则使用旧的逻辑（向后兼容）
    // 处理负数输入，将其设为0
    const inputTokens = Math.max(0, usage.input_tokens || 0)
    const outputTokens = Math.max(0, usage.output_tokens || 0)
    const cacheCreateTokens = Math.max(0, usage.cache_creation_input_tokens || 0)
    const cacheReadTokens = Math.max(0, usage.cache_read_input_tokens || 0)

    // 处理Azure OpenAI平台的特殊定价
    if (platform === 'azure_openai' || platform === 'azure-openai') {
      const azurePricing = AZURE_OPENAI_PRICING[model]
      if (azurePricing) {
        const pricing = {
          input: azurePricing.input,
          output: azurePricing.output,
          cacheWrite: azurePricing.input * 1.25, // Azure OpenAI 缓存写入通常是输入价格的1.25倍
          cacheRead: azurePricing.cacheRead || azurePricing.input * 0.1
        }

        // 计算各类型token的费用 (USD)
        const inputCost = (inputTokens / 1000) * pricing.input
        const outputCost = (outputTokens / 1000) * pricing.output
        const cacheWriteCost = (cacheCreateTokens / 1000) * pricing.cacheWrite
        const cacheReadCost = (cacheReadTokens / 1000) * pricing.cacheRead

        const totalCost = inputCost + outputCost + cacheWriteCost + cacheReadCost

        return {
          model,
          platform: 'azure_openai',
          pricing,
          usingDynamicPricing: false,
          usage: {
            inputTokens,
            outputTokens,
            cacheCreateTokens,
            cacheReadTokens,
            totalTokens: inputTokens + outputTokens + cacheCreateTokens + cacheReadTokens
          },
          costs: {
            input: inputCost,
            output: outputCost,
            cacheWrite: cacheWriteCost,
            cacheRead: cacheReadCost,
            total: totalCost
          },
          // 格式化的费用字符串
          formatted: {
            input: this.formatCost(inputCost),
            output: this.formatCost(outputCost),
            cacheWrite: this.formatCost(cacheWriteCost),
            cacheRead: this.formatCost(cacheReadCost),
            total: this.formatCost(totalCost)
          },
          // 添加调试信息
          debug: {
            isAzureOpenAI: true,
            hasCacheCreatePrice: true,
            cacheCreateTokens,
            cacheWritePriceUsed: pricing.cacheWrite
          }
        }
      }
    }

    // 优先使用动态价格服务
    const pricingData = pricingService.getModelPricing(model)
    let pricing
    let usingDynamicPricing = false

    if (pricingData) {
      // 转换动态价格格式为内部格式
      const inputPrice = (pricingData.input_cost_per_token || 0) * 1000000 // 转换为per 1M tokens
      const outputPrice = (pricingData.output_cost_per_token || 0) * 1000000
      const cacheReadPrice = (pricingData.cache_read_input_token_cost || 0) * 1000000

      // OpenAI 模型的特殊处理：
      // - 如果没有 cache_creation_input_token_cost，缓存创建按普通 input 价格计费
      // - Claude 模型有专门的 cache_creation_input_token_cost
      let cacheWritePrice = (pricingData.cache_creation_input_token_cost || 0) * 1000000

      // 检测是否为 OpenAI 模型（通过模型名或 litellm_provider）
      const isOpenAIModel =
        model.includes('gpt') || model.includes('o1') || pricingData.litellm_provider === 'openai'

      if (isOpenAIModel && !pricingData.cache_creation_input_token_cost && cacheCreateTokens > 0) {
        // OpenAI 模型：缓存创建按普通 input 价格计费
        cacheWritePrice = inputPrice
      }

      pricing = {
        input: inputPrice,
        output: outputPrice,
        cacheWrite: cacheWritePrice,
        cacheRead: cacheReadPrice
      }
      usingDynamicPricing = true
    } else {
      // 回退到静态价格
      pricing = MODEL_PRICING[model] || MODEL_PRICING['unknown']
    }

    // 计算各类型token的费用 (USD)
    const inputCost = (inputTokens / 1000000) * pricing.input
    const outputCost = (outputTokens / 1000000) * pricing.output
    const cacheWriteCost = (cacheCreateTokens / 1000000) * pricing.cacheWrite
    const cacheReadCost = (cacheReadTokens / 1000000) * pricing.cacheRead

    const totalCost = inputCost + outputCost + cacheWriteCost + cacheReadCost

    return {
      model,
      pricing,
      usingDynamicPricing,
      usage: {
        inputTokens,
        outputTokens,
        cacheCreateTokens,
        cacheReadTokens,
        totalTokens: inputTokens + outputTokens + cacheCreateTokens + cacheReadTokens
      },
      costs: {
        input: inputCost,
        output: outputCost,
        cacheWrite: cacheWriteCost,
        cacheRead: cacheReadCost,
        total: totalCost
      },
      // 格式化的费用字符串
      formatted: {
        input: this.formatCost(inputCost),
        output: this.formatCost(outputCost),
        cacheWrite: this.formatCost(cacheWriteCost),
        cacheRead: this.formatCost(cacheReadCost),
        total: this.formatCost(totalCost)
      },
      // 添加调试信息
      debug: {
        isOpenAIModel: model.includes('gpt') || model.includes('o1'),
        hasCacheCreatePrice: !!pricingData?.cache_creation_input_token_cost,
        cacheCreateTokens,
        cacheWritePriceUsed: pricing.cacheWrite
      }
    }
  }

  /**
   * 计算聚合使用量的费用
   * @param {Object} aggregatedUsage - 聚合使用量数据
   * @param {string} model - 模型名称
   * @returns {Object} 费用详情
   */
  static calculateAggregatedCost(aggregatedUsage, model = 'unknown') {
    const usage = {
      input_tokens: aggregatedUsage.inputTokens || aggregatedUsage.totalInputTokens || 0,
      output_tokens: aggregatedUsage.outputTokens || aggregatedUsage.totalOutputTokens || 0,
      cache_creation_input_tokens:
        aggregatedUsage.cacheCreateTokens || aggregatedUsage.totalCacheCreateTokens || 0,
      cache_read_input_tokens:
        aggregatedUsage.cacheReadTokens || aggregatedUsage.totalCacheReadTokens || 0
    }

    return this.calculateCost(usage, model)
  }

  /**
   * 获取模型定价信息
   * @param {string} model - 模型名称
   * @returns {Object} 定价信息
   */
  static getModelPricing(model = 'unknown') {
    return MODEL_PRICING[model] || MODEL_PRICING['unknown']
  }

  /**
   * 获取所有支持的模型和定价
   * @returns {Object} 所有模型定价
   */
  static getAllModelPricing() {
    return { ...MODEL_PRICING }
  }

  /**
   * 验证模型是否支持
   * @param {string} model - 模型名称
   * @returns {boolean} 是否支持
   */
  static isModelSupported(model) {
    return !!MODEL_PRICING[model]
  }

  /**
   * 格式化费用显示
   * @param {number} cost - 费用金额
   * @param {number} decimals - 小数位数
   * @returns {string} 格式化的费用字符串
   */
  static formatCost(cost, decimals = 6) {
    if (cost >= 1) {
      return `$${cost.toFixed(2)}`
    } else if (cost >= 0.001) {
      return `$${cost.toFixed(4)}`
    } else {
      return `$${cost.toFixed(decimals)}`
    }
  }

  /**
   * 专门为Azure OpenAI计算费用
   * @param {Object} usage - 使用量数据
   * @param {string} model - 模型名称
   * @returns {Object} 费用详情
   */
  static calculateAzureOpenAICost(usage, model = 'unknown') {
    return this.calculateCost(usage, model, 'azure_openai')
  }

  /**
   * 获取Azure OpenAI模型定价
   * @param {string} model - 模型名称
   * @returns {Object|null} 定价信息
   */
  static getAzureOpenAIModelPricing(model) {
    return AZURE_OPENAI_PRICING[model] || null
  }

  /**
   * 获取Azure OpenAI所有支持的模型和定价
   * @returns {Object} 所有Azure OpenAI模型定价
   */
  static getAllAzureOpenAIModelPricing() {
    return { ...AZURE_OPENAI_PRICING }
  }

  /**
   * 验证Azure OpenAI模型是否支持
   * @param {string} model - 模型名称
   * @returns {boolean} 是否支持
   */
  static isAzureOpenAIModelSupported(model) {
    return !!AZURE_OPENAI_PRICING[model]
  }

  /**
   * 计算费用节省（使用缓存的节省）
   * @param {Object} usage - 使用量数据
   * @param {string} model - 模型名称
   * @param {string} platform - 平台类型
   * @returns {Object} 节省信息
   */
  static calculateCacheSavings(usage, model = 'unknown', platform = null) {
    let pricing

    // 根据平台获取不同的定价
    if (platform === 'azure_openai' || platform === 'azure-openai') {
      const azurePricing = AZURE_OPENAI_PRICING[model]
      if (azurePricing) {
        pricing = {
          input: azurePricing.input,
          cacheRead: azurePricing.cacheRead || azurePricing.input * 0.1
        }
      } else {
        pricing = this.getModelPricing(model)
      }
    } else {
      pricing = this.getModelPricing(model)
    }
    const cacheReadTokens = usage.cache_read_input_tokens || 0

    // 如果这些token不使用缓存，需要按正常input价格计费
    const normalCost = (cacheReadTokens / 1000000) * pricing.input
    const cacheCost = (cacheReadTokens / 1000000) * pricing.cacheRead
    const savings = normalCost - cacheCost
    const savingsPercentage = normalCost > 0 ? (savings / normalCost) * 100 : 0

    return {
      normalCost,
      cacheCost,
      savings,
      savingsPercentage,
      formatted: {
        normalCost: this.formatCost(normalCost),
        cacheCost: this.formatCost(cacheCost),
        savings: this.formatCost(savings),
        savingsPercentage: `${savingsPercentage.toFixed(1)}%`
      }
    }
  }

  /**
   * 计算成本效率评分（用于智能负载均衡）
   * @param {string} model - 模型名称
   * @param {number} estimatedTokens - 预估token数量
   * @param {Object} options - 配置选项
   * @returns {Object} 成本效率信息
   */
  static calculateCostEfficiency(model = 'unknown', estimatedTokens = 2000, options = {}) {
    const {
      platform = null,
      inputRatio = 0.7, // 输入token占比
      outputRatio = 0.3, // 输出token占比
      cacheHitRatio = 0.0 // 缓存命中率
    } = options

    try {
      // 模拟使用量数据
      const inputTokens = Math.floor(estimatedTokens * inputRatio)
      const outputTokens = Math.floor(estimatedTokens * outputRatio)
      const cacheReadTokens = Math.floor(inputTokens * cacheHitRatio)
      const actualInputTokens = inputTokens - cacheReadTokens

      const mockUsage = {
        input_tokens: actualInputTokens,
        output_tokens: outputTokens,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: cacheReadTokens
      }

      const costResult = this.calculateCost(mockUsage, model, platform)
      const totalCost = costResult.costs.total

      // 计算每千token成本
      const costPer1KTokens = (totalCost / estimatedTokens) * 1000

      // 计算成本效率评分 (0-1, 成本越低评分越高)
      const maxReasonableCost = 0.1 // $0.1 per 1K tokens 作为参考基准
      const efficiencyScore = Math.max(0, Math.min(1, 1 - costPer1KTokens / maxReasonableCost))

      // 计算成本等级
      let costTier = 'premium'
      if (costPer1KTokens < 0.001) {
        costTier = 'ultra-low'
      } else if (costPer1KTokens < 0.01) {
        costTier = 'low'
      } else if (costPer1KTokens < 0.05) {
        costTier = 'moderate'
      } else if (costPer1KTokens < 0.1) {
        costTier = 'high'
      }

      return {
        model,
        platform,
        estimatedTokens,
        breakdown: {
          inputTokens: actualInputTokens,
          outputTokens,
          cacheReadTokens,
          cacheHitRatio
        },
        costs: {
          total: totalCost,
          per1KTokens: costPer1KTokens,
          per1MTokens: costPer1KTokens * 1000
        },
        efficiency: {
          score: efficiencyScore,
          tier: costTier,
          isOptimal: efficiencyScore > 0.7
        },
        formatted: {
          totalCost: this.formatCost(totalCost),
          costPer1KTokens: this.formatCost(costPer1KTokens),
          costPer1MTokens: this.formatCost(costPer1KTokens * 1000)
        },
        recommendations: this.generateCostRecommendations(costPer1KTokens, cacheHitRatio)
      }
    } catch (error) {
      // 返回安全的默认值
      return {
        model,
        platform,
        estimatedTokens,
        error: error.message,
        efficiency: {
          score: 0.5,
          tier: 'unknown',
          isOptimal: false
        },
        costs: {
          total: 0,
          per1KTokens: 0,
          per1MTokens: 0
        }
      }
    }
  }

  /**
   * 生成成本优化建议
   * @param {number} costPer1KTokens - 每千token成本
   * @param {number} cacheHitRatio - 缓存命中率
   * @returns {Array} 建议列表
   */
  static generateCostRecommendations(costPer1KTokens, cacheHitRatio) {
    const recommendations = []

    if (costPer1KTokens > 0.05) {
      recommendations.push({
        type: 'high_cost_warning',
        message: 'Consider using a more cost-effective model for routine tasks',
        priority: 'high'
      })
    }

    if (cacheHitRatio < 0.1) {
      recommendations.push({
        type: 'cache_optimization',
        message: 'Enable prompt caching to reduce costs by up to 90%',
        priority: 'medium'
      })
    }

    if (costPer1KTokens < 0.001) {
      recommendations.push({
        type: 'cost_optimized',
        message: 'Excellent cost efficiency - model well-suited for high-volume usage',
        priority: 'info'
      })
    }

    return recommendations
  }

  /**
   * 比较多个模型的成本效率
   * @param {Array} models - 模型列表
   * @param {number} estimatedTokens - 预估token数量
   * @param {Object} options - 配置选项
   * @returns {Object} 比较结果
   */
  static compareModelCostEfficiency(models, estimatedTokens = 2000, options = {}) {
    try {
      const comparisons = models.map((model) =>
        this.calculateCostEfficiency(model, estimatedTokens, options)
      )

      // 按效率评分排序
      comparisons.sort((a, b) => b.efficiency.score - a.efficiency.score)

      const bestModel = comparisons[0]
      const worstModel = comparisons[comparisons.length - 1]
      const avgScore =
        comparisons.reduce((sum, comp) => sum + comp.efficiency.score, 0) / comparisons.length

      const savings = worstModel.costs.total - bestModel.costs.total
      const savingsPercentage =
        worstModel.costs.total > 0 ? (savings / worstModel.costs.total) * 100 : 0

      return {
        totalModels: models.length,
        estimatedTokens,
        bestModel: bestModel.model,
        worstModel: worstModel.model,
        avgEfficiencyScore: avgScore,
        potentialSavings: {
          absolute: savings,
          percentage: savingsPercentage,
          formatted: this.formatCost(savings)
        },
        comparisons,
        recommendation: bestModel.efficiency.isOptimal
          ? `${bestModel.model} offers optimal cost efficiency`
          : `Consider alternative models for better cost efficiency`
      }
    } catch (error) {
      return {
        error: error.message,
        comparisons: [],
        recommendation: 'Unable to compare model costs'
      }
    }
  }

  /**
   * 获取模型成本性能比
   * @param {string} model - 模型名称
   * @param {Object} options - 配置选项
   * @returns {Object} 成本性能比信息
   */
  static getModelCostPerformanceRatio(model, options = {}) {
    const { qualityScore = 0.8, platform = null } = options

    try {
      const costEfficiency = this.calculateCostEfficiency(model, 2000, { platform })

      // 成本性能比 = 质量评分 / 成本
      const costPerformanceRatio =
        costEfficiency.costs.per1KTokens > 0 ? qualityScore / costEfficiency.costs.per1KTokens : 0

      let performanceTier = 'balanced'
      if (costPerformanceRatio > 100) {
        performanceTier = 'exceptional'
      } else if (costPerformanceRatio > 50) {
        performanceTier = 'excellent'
      } else if (costPerformanceRatio > 20) {
        performanceTier = 'good'
      } else if (costPerformanceRatio < 5) {
        performanceTier = 'poor'
      }

      return {
        model,
        qualityScore,
        costEfficiency,
        costPerformanceRatio,
        performanceTier,
        isRecommended: costPerformanceRatio > 20 && costEfficiency.efficiency.score > 0.5
      }
    } catch (error) {
      return {
        model,
        error: error.message,
        costPerformanceRatio: 0,
        performanceTier: 'unknown',
        isRecommended: false
      }
    }
  }
}

module.exports = CostCalculator
