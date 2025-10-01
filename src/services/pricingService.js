const fs = require('fs')
const path = require('path')
const https = require('https')
const logger = require('../utils/logger')

class PricingService {
  constructor() {
    this.dataDir = path.join(process.cwd(), 'data')
    this.pricingFile = path.join(this.dataDir, 'model_pricing.json')
    this.pricingUrl =
      'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'
    this.fallbackFile = path.join(
      process.cwd(),
      'resources',
      'model-pricing',
      'model_prices_and_context_window.json'
    )
    this.pricingData = null
    this.lastUpdated = null
    this.updateInterval = 24 * 60 * 60 * 1000 // 24小时
    this.fileWatcher = null // 文件监听器
    this.reloadDebounceTimer = null // 防抖定时器

    // 硬编码的 1 小时缓存价格（美元/百万 token）
    // ephemeral_5m 的价格使用 model_pricing.json 中的 cache_creation_input_token_cost
    // ephemeral_1h 的价格需要硬编码
    this.ephemeral1hPricing = {
      // Opus 系列: $30/MTok
      'claude-opus-4-1': 0.00003,
      'claude-opus-4-1-20250805': 0.00003,
      'claude-opus-4': 0.00003,
      'claude-opus-4-20250514': 0.00003,
      'claude-opus-4-20250514[1M]': 0.00003, // 1M上下文版本
      'claude-3-opus': 0.00003,
      'claude-3-opus-latest': 0.00003,
      'claude-3-opus-20240229': 0.00003,

      // Sonnet 系列: $6/MTok
      'claude-3-5-sonnet': 0.000006,
      'claude-3-5-sonnet-latest': 0.000006,
      'claude-3-5-sonnet-20241022': 0.000006,
      'claude-3-5-sonnet-20240620': 0.000006,
      'claude-3-sonnet': 0.000006,
      'claude-3-sonnet-20240307': 0.000006,
      'claude-sonnet-3': 0.000006,
      'claude-sonnet-3-5': 0.000006,
      'claude-sonnet-3-7': 0.000006,
      'claude-sonnet-4': 0.000006,
      'claude-sonnet-4-20250514': 0.000006,
      'claude-sonnet-4-20250514[1M]': 0.000006, // 1M上下文版本

      // Haiku 系列: $1.6/MTok
      'claude-3-5-haiku': 0.0000016,
      'claude-3-5-haiku-latest': 0.0000016,
      'claude-3-5-haiku-20241022': 0.0000016,
      'claude-3-haiku': 0.0000016,
      'claude-3-haiku-20240307': 0.0000016,
      'claude-haiku-3': 0.0000016,
      'claude-haiku-3-5': 0.0000016
    }

    this.longContextPricing = {
      'claude-sonnet-4-20250514[1m]': {
        input: 0.000006,
        output: 0.0000225
      },
      'claude-sonnet-4-20250514[1M]': {
        input: 0.000006,
        output: 0.0000225
      }
    }
  }

  // 初始化价格服务
  async initialize() {
    try {
      // 确保data目录存在
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true })
        logger.info('📁 Created data directory')
      }

      // 检查是否需要下载或更新价格数据
      await this.checkAndUpdatePricing()

      // 设置定时更新
      setInterval(() => {
        this.checkAndUpdatePricing()
      }, this.updateInterval)

      // 设置文件监听器
      this.setupFileWatcher()

      logger.success('💰 Pricing service initialized successfully')
    } catch (error) {
      logger.error('❌ Failed to initialize pricing service:', error)
    }
  }

  // 检查并更新价格数据
  async checkAndUpdatePricing() {
    try {
      const needsUpdate = this.needsUpdate()

      if (needsUpdate) {
        logger.info('🔄 Updating model pricing data...')
        await this.downloadPricingData()
      } else {
        // 如果不需要更新，加载现有数据
        await this.loadPricingData()
      }
    } catch (error) {
      logger.error('❌ Failed to check/update pricing:', error)
      // 如果更新失败，尝试使用fallback
      await this.useFallbackPricing()
    }
  }

  // 检查是否需要更新
  needsUpdate() {
    if (!fs.existsSync(this.pricingFile)) {
      logger.info('📋 Pricing file not found, will download')
      return true
    }

    const stats = fs.statSync(this.pricingFile)
    const fileAge = Date.now() - stats.mtime.getTime()

    if (fileAge > this.updateInterval) {
      logger.info(
        `📋 Pricing file is ${Math.round(fileAge / (60 * 60 * 1000))} hours old, will update`
      )
      return true
    }

    return false
  }

  // 下载价格数据
  async downloadPricingData() {
    try {
      await this._downloadFromRemote()
    } catch (downloadError) {
      logger.warn(`⚠️  Failed to download pricing data: ${downloadError.message}`)
      logger.info('📋 Using local fallback pricing data...')
      await this.useFallbackPricing()
    }
  }

  // 实际的下载逻辑
  _downloadFromRemote() {
    return new Promise((resolve, reject) => {
      const request = https.get(this.pricingUrl, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`))
          return
        }

        let data = ''
        response.on('data', (chunk) => {
          data += chunk
        })

        response.on('end', () => {
          try {
            const jsonData = JSON.parse(data)

            // 保存到文件
            fs.writeFileSync(this.pricingFile, JSON.stringify(jsonData, null, 2))

            // 更新内存中的数据
            this.pricingData = jsonData
            this.lastUpdated = new Date()

            logger.success(`💰 Downloaded pricing data for ${Object.keys(jsonData).length} models`)

            // 设置或重新设置文件监听器
            this.setupFileWatcher()

            resolve()
          } catch (error) {
            reject(new Error(`Failed to parse pricing data: ${error.message}`))
          }
        })
      })

      request.on('error', (error) => {
        reject(new Error(`Network error: ${error.message}`))
      })

      request.setTimeout(30000, () => {
        request.destroy()
        reject(new Error('Download timeout after 30 seconds'))
      })
    })
  }

  // 加载本地价格数据
  async loadPricingData() {
    try {
      if (fs.existsSync(this.pricingFile)) {
        const data = fs.readFileSync(this.pricingFile, 'utf8')
        this.pricingData = JSON.parse(data)

        const stats = fs.statSync(this.pricingFile)
        this.lastUpdated = stats.mtime

        logger.info(
          `💰 Loaded pricing data for ${Object.keys(this.pricingData).length} models from cache`
        )
      } else {
        logger.warn('💰 No pricing data file found, will use fallback')
        await this.useFallbackPricing()
      }
    } catch (error) {
      logger.error('❌ Failed to load pricing data:', error)
      await this.useFallbackPricing()
    }
  }

  // 使用fallback价格数据
  async useFallbackPricing() {
    try {
      if (fs.existsSync(this.fallbackFile)) {
        logger.info('📋 Copying fallback pricing data to data directory...')

        // 读取fallback文件
        const fallbackData = fs.readFileSync(this.fallbackFile, 'utf8')
        const jsonData = JSON.parse(fallbackData)

        // 保存到data目录
        fs.writeFileSync(this.pricingFile, JSON.stringify(jsonData, null, 2))

        // 更新内存中的数据
        this.pricingData = jsonData
        this.lastUpdated = new Date()

        // 设置或重新设置文件监听器
        this.setupFileWatcher()

        logger.warn(`⚠️  Using fallback pricing data for ${Object.keys(jsonData).length} models`)
        logger.info(
          '💡 Note: This fallback data may be outdated. The system will try to update from the remote source on next check.'
        )
      } else {
        logger.error('❌ Fallback pricing file not found at:', this.fallbackFile)
        logger.error(
          '❌ Please ensure the resources/model-pricing directory exists with the pricing file'
        )
        this.pricingData = {}
      }
    } catch (error) {
      logger.error('❌ Failed to use fallback pricing data:', error)
      this.pricingData = {}
    }
  }

  // 获取模型价格信息
  getModelPricing(modelName) {
    if (!this.pricingData || !modelName) {
      return null
    }

    // 尝试直接匹配
    if (this.pricingData[modelName]) {
      logger.debug(`💰 Found exact pricing match for ${modelName}`)
      return this.ensureCachePricing(this.pricingData[modelName])
    }

    // 对于带有 1M 后缀的模型，尝试使用基础模型定价（兼容大小写）
    if (/\[1m\]$/i.test(modelName)) {
      const baseModel = modelName.replace(/\[1m\]$/i, '')
      if (this.pricingData[baseModel]) {
        logger.debug(`💰 Found pricing for ${modelName} using base model: ${baseModel}`)
        return this.ensureCachePricing(this.pricingData[baseModel])
      }
    }

    if (modelName === 'gpt-5-codex' && this.pricingData['gpt-5']) {
      logger.info('💰 Using gpt-5 pricing as fallback for gpt-5-codex')
      return this.ensureCachePricing(this.pricingData['gpt-5'])
    }

    // 对于Bedrock区域前缀模型（如 us.anthropic.claude-sonnet-4-20250514-v1:0），
    // 尝试去掉区域前缀进行匹配
    if (modelName.includes('.anthropic.') || modelName.includes('.claude')) {
      // 提取不带区域前缀的模型名
      const withoutRegion = modelName.replace(/^(us|eu|apac)\./, '')
      if (this.pricingData[withoutRegion]) {
        logger.debug(
          `💰 Found pricing for ${modelName} by removing region prefix: ${withoutRegion}`
        )
        return this.ensureCachePricing(this.pricingData[withoutRegion])
      }
    }

    // 尝试模糊匹配（处理版本号等变化）
    const normalizedModel = modelName.toLowerCase().replace(/[_-]/g, '')

    for (const [key, value] of Object.entries(this.pricingData)) {
      const normalizedKey = key.toLowerCase().replace(/[_-]/g, '')
      if (normalizedKey.includes(normalizedModel) || normalizedModel.includes(normalizedKey)) {
        logger.debug(`💰 Found pricing for ${modelName} using fuzzy match: ${key}`)
        return this.ensureCachePricing(value)
      }
    }

    // 对于Bedrock模型，尝试更智能的匹配
    if (modelName.includes('anthropic.claude')) {
      // 提取核心模型名部分（去掉区域和前缀）
      const coreModel = modelName.replace(/^(us|eu|apac)\./, '').replace('anthropic.', '')

      for (const [key, value] of Object.entries(this.pricingData)) {
        if (key.includes(coreModel) || key.replace('anthropic.', '').includes(coreModel)) {
          logger.debug(`💰 Found pricing for ${modelName} using Bedrock core model match: ${key}`)
          return this.ensureCachePricing(value)
        }
      }
    }

    logger.debug(`💰 No pricing found for model: ${modelName}`)
    return null
  }

  // 获取 1 小时缓存价格
  getEphemeral1hPricing(modelName) {
    if (!modelName) {
      return 0
    }

    // 尝试直接匹配
    if (this.ephemeral1hPricing[modelName]) {
      return this.ephemeral1hPricing[modelName]
    }

    // 处理各种模型名称变体
    const modelLower = modelName.toLowerCase()

    // 检查是否是 Opus 系列
    if (modelLower.includes('opus')) {
      return 0.00003 // $30/MTok
    }

    // 检查是否是 Sonnet 系列
    if (modelLower.includes('sonnet')) {
      return 0.000006 // $6/MTok
    }

    // 检查是否是 Haiku 系列
    if (modelLower.includes('haiku')) {
      return 0.0000016 // $1.6/MTok
    }

    // 默认返回 0（未知模型）
    logger.debug(`💰 No 1h cache pricing found for model: ${modelName}`)
    return 0
  }

  // 确保价格对象包含缓存价格
  ensureCachePricing(pricing) {
    if (!pricing) {
      return pricing
    }

    // 如果缺少缓存价格，根据输入价格计算（缓存创建价格通常是输入价格的1.25倍，缓存读取是0.1倍）
    if (!pricing.cache_creation_input_token_cost && pricing.input_cost_per_token) {
      pricing.cache_creation_input_token_cost = pricing.input_cost_per_token * 1.25
    }
    if (!pricing.cache_read_input_token_cost && pricing.input_cost_per_token) {
      pricing.cache_read_input_token_cost = pricing.input_cost_per_token * 0.1
    }
    return pricing
  }

  // 计算使用费用
  calculateCost(usage = {}, modelName) {
    const pricing = this.ensureCachePricing(this.getModelPricing(modelName))

    const findLongContextPricing = (name) => {
      if (!name) {
        return null
      }
      if (this.longContextPricing[name]) {
        return this.longContextPricing[name]
      }
      const lowerName = name.toLowerCase()
      return this.longContextPricing[lowerName] || null
    }

    const longContextPricing = findLongContextPricing(modelName)
    const totalInputTokens =
      (usage.input_tokens || 0) +
      (usage.cache_creation_input_tokens || 0) +
      (usage.cache_read_input_tokens || 0)

    const isLongContextModel = !!modelName && /\[1m\]$/i.test(modelName)
    const isLongContextRequest = isLongContextModel && totalInputTokens > 200000
    const useLongContextPricing = isLongContextRequest && !!longContextPricing

    if (!pricing && !useLongContextPricing) {
      return {
        inputCost: 0,
        outputCost: 0,
        cacheCreateCost: 0,
        cacheReadCost: 0,
        ephemeral5mCost: 0,
        ephemeral1hCost: 0,
        totalCost: 0,
        hasPricing: false,
        isLongContextRequest: false
      }
    }

    let inputCost = 0
    let outputCost = 0

    if (useLongContextPricing) {
      const resolvedLongPricing =
        longContextPricing || this.longContextPricing[Object.keys(this.longContextPricing)[0]]

      if (resolvedLongPricing) {
        logger.info(
          `💰 Using 1M context pricing for ${modelName}: input=$${resolvedLongPricing.input}/token, output=$${resolvedLongPricing.output}/token`
        )
        inputCost = (usage.input_tokens || 0) * resolvedLongPricing.input
        outputCost = (usage.output_tokens || 0) * resolvedLongPricing.output
      }
    } else {
      inputCost = (usage.input_tokens || 0) * (pricing?.input_cost_per_token || 0)
      outputCost = (usage.output_tokens || 0) * (pricing?.output_cost_per_token || 0)
    }

    const cacheReadCost =
      (usage.cache_read_input_tokens || 0) * (pricing?.cache_read_input_token_cost || 0)

    let ephemeral5mCost = 0
    let ephemeral1hCost = 0
    let cacheCreateCost = 0

    if (usage.cache_creation && typeof usage.cache_creation === 'object') {
      const ephemeral5mTokens = usage.cache_creation.ephemeral_5m_input_tokens || 0
      const ephemeral1hTokens = usage.cache_creation.ephemeral_1h_input_tokens || 0

      ephemeral5mCost = ephemeral5mTokens * (pricing?.cache_creation_input_token_cost || 0)

      const ephemeral1hPrice = this.getEphemeral1hPricing(modelName)
      ephemeral1hCost = ephemeral1hTokens * ephemeral1hPrice

      cacheCreateCost = ephemeral5mCost + ephemeral1hCost
    } else if (usage.cache_creation_input_tokens) {
      cacheCreateCost =
        (usage.cache_creation_input_tokens || 0) * (pricing?.cache_creation_input_token_cost || 0)
      ephemeral5mCost = cacheCreateCost
    }

    const totalCost = inputCost + outputCost + cacheCreateCost + cacheReadCost

    const resolvedLongPricing =
      longContextPricing || this.longContextPricing[Object.keys(this.longContextPricing)[0]]

    return {
      inputCost,
      outputCost,
      cacheCreateCost,
      cacheReadCost,
      ephemeral5mCost,
      ephemeral1hCost,
      totalCost,
      hasPricing: !!pricing || useLongContextPricing,
      isLongContextRequest,
      pricing: {
        input: useLongContextPricing
          ? resolvedLongPricing?.input || 0
          : pricing?.input_cost_per_token || 0,
        output: useLongContextPricing
          ? resolvedLongPricing?.output || 0
          : pricing?.output_cost_per_token || 0,
        cacheCreate: pricing?.cache_creation_input_token_cost || 0,
        cacheRead: pricing?.cache_read_input_token_cost || 0,
        ephemeral1h: this.getEphemeral1hPricing(modelName)
      }
    }
  }

  // 格式化价格显示
  formatCost(cost) {
    if (cost === 0) {
      return '$0.000000'
    }
    if (cost < 0.000001) {
      return `$${cost.toExponential(2)}`
    }
    if (cost < 0.01) {
      return `$${cost.toFixed(6)}`
    }
    if (cost < 1) {
      return `$${cost.toFixed(4)}`
    }
    return `$${cost.toFixed(2)}`
  }

  // 获取服务状态
  getStatus() {
    return {
      initialized: this.pricingData !== null,
      lastUpdated: this.lastUpdated,
      modelCount: this.pricingData ? Object.keys(this.pricingData).length : 0,
      nextUpdate: this.lastUpdated
        ? new Date(this.lastUpdated.getTime() + this.updateInterval)
        : null
    }
  }

  // 强制更新价格数据
  async forceUpdate() {
    try {
      await this._downloadFromRemote()
      return { success: true, message: 'Pricing data updated successfully' }
    } catch (error) {
      logger.error('❌ Force update failed:', error)
      logger.info('📋 Force update failed, using fallback pricing data...')
      await this.useFallbackPricing()
      return {
        success: false,
        message: `Download failed: ${error.message}. Using fallback pricing data instead.`
      }
    }
  }

  // 设置文件监听器
  setupFileWatcher() {
    try {
      // 如果已有监听器，先关闭
      if (this.fileWatcher) {
        this.fileWatcher.close()
        this.fileWatcher = null
      }

      // 只有文件存在时才设置监听器
      if (!fs.existsSync(this.pricingFile)) {
        logger.debug('💰 Pricing file does not exist yet, skipping file watcher setup')
        return
      }

      // 使用 fs.watchFile 作为更可靠的文件监听方式
      // 它使用轮询，虽然性能稍差，但更可靠
      const watchOptions = {
        persistent: true,
        interval: 60000 // 每60秒检查一次
      }

      // 记录初始的修改时间
      let lastMtime = fs.statSync(this.pricingFile).mtimeMs

      fs.watchFile(this.pricingFile, watchOptions, (curr, _prev) => {
        // 检查文件是否真的被修改了（不仅仅是访问）
        if (curr.mtimeMs !== lastMtime) {
          lastMtime = curr.mtimeMs
          logger.debug(
            `💰 Detected change in pricing file (mtime: ${new Date(curr.mtime).toISOString()})`
          )
          this.handleFileChange()
        }
      })

      // 保存引用以便清理
      this.fileWatcher = {
        close: () => fs.unwatchFile(this.pricingFile)
      }

      logger.info('👁️  File watcher set up for model_pricing.json (polling every 60s)')
    } catch (error) {
      logger.error('❌ Failed to setup file watcher:', error)
    }
  }

  // 处理文件变化（带防抖）
  handleFileChange() {
    // 清除之前的定时器
    if (this.reloadDebounceTimer) {
      clearTimeout(this.reloadDebounceTimer)
    }

    // 设置新的定时器（防抖500ms）
    this.reloadDebounceTimer = setTimeout(async () => {
      logger.info('🔄 Reloading pricing data due to file change...')
      await this.reloadPricingData()
    }, 500)
  }

  // 重新加载价格数据
  async reloadPricingData() {
    try {
      // 验证文件是否存在
      if (!fs.existsSync(this.pricingFile)) {
        logger.warn('💰 Pricing file was deleted, using fallback')
        await this.useFallbackPricing()
        // 重新设置文件监听器（fallback会创建新文件）
        this.setupFileWatcher()
        return
      }

      // 读取文件内容
      const data = fs.readFileSync(this.pricingFile, 'utf8')

      // 尝试解析JSON
      const jsonData = JSON.parse(data)

      // 验证数据结构
      if (typeof jsonData !== 'object' || Object.keys(jsonData).length === 0) {
        throw new Error('Invalid pricing data structure')
      }

      // 更新内存中的数据
      this.pricingData = jsonData
      this.lastUpdated = new Date()

      const modelCount = Object.keys(jsonData).length
      logger.success(`💰 Reloaded pricing data for ${modelCount} models from file`)

      // 显示一些统计信息
      const claudeModels = Object.keys(jsonData).filter((k) => k.includes('claude')).length
      const gptModels = Object.keys(jsonData).filter((k) => k.includes('gpt')).length
      const geminiModels = Object.keys(jsonData).filter((k) => k.includes('gemini')).length

      logger.debug(
        `💰 Model breakdown: Claude=${claudeModels}, GPT=${gptModels}, Gemini=${geminiModels}`
      )
    } catch (error) {
      logger.error('❌ Failed to reload pricing data:', error)
      logger.warn('💰 Keeping existing pricing data in memory')
    }
  }

  // 清理资源
  cleanup() {
    if (this.fileWatcher) {
      this.fileWatcher.close()
      this.fileWatcher = null
      logger.debug('💰 File watcher closed')
    }
    if (this.reloadDebounceTimer) {
      clearTimeout(this.reloadDebounceTimer)
      this.reloadDebounceTimer = null
    }
  }
}

module.exports = new PricingService()
