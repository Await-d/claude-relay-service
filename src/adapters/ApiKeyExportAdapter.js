/**
 * @fileoverview API Key导出适配器
 *
 * 基于UpstreamFeatureAdapter，专门处理API Key数据的导出和格式转换
 * 支持多种导出格式：JSON、CSV、Excel等
 * 支持数据过滤、脱敏和批量处理
 *
 * 核心功能：
 * - API Key数据导出（支持敏感信息过滤）
 * - 使用统计数据导出
 * - 多格式转换（JSON/CSV/Excel）
 * - 批量处理和分页导出
 * - 数据验证和完整性检查
 *
 * @author Claude Code
 * @version 1.0.0
 */

const UpstreamFeatureAdapter = require('./UpstreamFeatureAdapter')
const logger = require('../utils/logger')
const fs = require('fs').promises
const path = require('path')

/**
 * API Key导出适配器
 *
 * 继承UpstreamFeatureAdapter，实现API Key数据的导出和格式转换功能
 *
 * 特性:
 * - 多格式导出支持（JSON、CSV）
 * - 敏感数据自动脱敏处理
 * - 分页和批量处理支持
 * - 数据过滤和自定义字段选择
 * - 完整的错误处理和日志记录
 */
class ApiKeyExportAdapter extends UpstreamFeatureAdapter {
  /**
   * 构造函数
   * @param {Object} options 适配器配置选项
   * @param {string} options.outputDir 输出目录，默认为temp
   * @param {boolean} options.sanitizeData 是否脱敏敏感数据，默认为true
   * @param {Array} options.defaultFields 默认导出字段
   * @param {number} options.batchSize 批处理大小，默认为100
   */
  constructor(options = {}) {
    const {
      outputDir = path.join(process.cwd(), 'temp', 'exports'),
      sanitizeData = true,
      defaultFields = [
        'id',
        'name',
        'description',
        'tokenLimit',
        'concurrencyLimit',
        'rateLimitWindow',
        'rateLimitRequests',
        'permissions',
        'isActive',
        'dailyCostLimit',
        'tags',
        'createdAt',
        'updatedAt'
      ],
      batchSize = 100,
      ...baseOptions
    } = options

    super({
      name: 'ApiKeyExportAdapter',
      version: '1.0.0',
      ...baseOptions
    })

    this.outputDir = outputDir
    this.sanitizeData = sanitizeData
    this.defaultFields = defaultFields
    this.batchSize = batchSize

    // 支持的导出格式
    this.supportedFormats = ['json', 'csv']

    // 敏感字段列表（需要脱敏的字段）
    this.sensitiveFields = ['apiKey', 'hashedKey', 'refreshToken', 'accessToken']

    logger.debug(
      `ApiKeyExportAdapter configured: outputDir=${this.outputDir}, batchSize=${this.batchSize}`
    )
  }

  /**
   * 初始化适配器
   * 创建必要的目录和检查权限
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      // 确保输出目录存在
      await fs.mkdir(this.outputDir, { recursive: true })

      // 检查目录写权限
      await fs.access(this.outputDir, fs.constants.W_OK)

      logger.info(`ApiKeyExportAdapter initialized: outputDir=${this.outputDir}`)
    } catch (error) {
      throw new Error(`Failed to initialize ApiKeyExportAdapter: ${error.message}`)
    }
  }

  /**
   * 验证输入数据
   * @param {Object|Array} input 输入数据
   * @param {Object} options 验证选项
   * @returns {Promise<boolean>} 验证结果
   */
  async validate(input, options = {}) {
    const { format = 'json' } = options

    // 检查支持的格式
    if (!this.supportedFormats.includes(format.toLowerCase())) {
      logger.error(`Unsupported export format: ${format}`)
      return false
    }

    // 基本的输入验证
    if (!input) {
      logger.error('Input data is required for export')
      return false
    }

    // 如果是查询条件对象，验证其结构
    if (typeof input === 'object' && !Array.isArray(input)) {
      // 查询条件应该包含有效的属性
      if (Object.keys(input).length === 0) {
        logger.debug('Empty query object, will export all API keys')
      }
    }

    return true
  }

  /**
   * 执行适配操作 - 核心导出逻辑
   * @param {Object|Array} input 输入数据（查询条件或API Key数组）
   * @param {Object} options 导出选项
   * @param {string} options.format 导出格式 ('json'|'csv')
   * @param {string} options.filename 输出文件名
   * @param {Array} options.fields 要导出的字段
   * @param {boolean} options.includeUsage 是否包含使用统计
   * @param {boolean} options.sanitize 是否脱敏，覆盖默认设置
   * @returns {Promise<Object>} 导出结果
   */
  async adapt(input, options = {}) {
    const {
      format = 'json',
      filename = this.generateFilename(format),
      fields = this.defaultFields,
      includeUsage = false,
      sanitize = this.sanitizeData
    } = options

    logger.info(`Starting API Key export: format=${format}, includeUsage=${includeUsage}`)

    try {
      // 1. 获取数据
      let apiKeys
      if (Array.isArray(input)) {
        // 直接使用提供的API Key数组
        apiKeys = input
      } else {
        // 从数据库获取API Keys
        apiKeys = await this.fetchAllApiKeys(input)
      }

      logger.debug(`Retrieved ${apiKeys.length} API keys for export`)

      // 2. 处理数据（脱敏、字段过滤）
      const processedData = await this.processApiKeysData(apiKeys, {
        fields,
        includeUsage,
        sanitize
      })

      // 3. 根据格式导出
      const outputPath = path.join(this.outputDir, filename)
      let exportResult

      switch (format.toLowerCase()) {
        case 'json':
          exportResult = await this.exportToJson(processedData, outputPath)
          break
        case 'csv':
          exportResult = await this.exportToCsv(processedData, outputPath, fields)
          break
        default:
          throw new Error(`Unsupported format: ${format}`)
      }

      const result = {
        success: true,
        format,
        filename,
        filePath: outputPath,
        recordCount: processedData.length,
        fileSize: exportResult.fileSize,
        exportedAt: new Date(),
        fields,
        includeUsage,
        sanitized: sanitize
      }

      logger.info(
        `API Key export completed: ${result.recordCount} records, ${result.fileSize} bytes`
      )
      return result
    } catch (error) {
      logger.error('API Key export failed:', {
        error: error.message,
        stack: error.stack,
        format,
        filename
      })
      throw error
    }
  }

  /**
   * 获取所有API Keys数据
   * @param {Object} queryConditions 查询条件
   * @returns {Promise<Array>} API Keys数组
   * @private
   */
  async fetchAllApiKeys(queryConditions = {}) {
    try {
      // 使用基类的fetchData方法获取所有API Keys
      const apiKeys = await this.fetchData('apikeys')

      // 应用查询条件过滤（如果有）
      if (queryConditions && Object.keys(queryConditions).length > 0) {
        return this.filterApiKeys(apiKeys, queryConditions)
      }

      return apiKeys
    } catch (error) {
      logger.error('Failed to fetch API keys:', error)
      throw error
    }
  }

  /**
   * 根据查询条件过滤API Keys
   * @param {Array} apiKeys API Keys数组
   * @param {Object} conditions 过滤条件
   * @returns {Array} 过滤后的API Keys
   * @private
   */
  filterApiKeys(apiKeys, conditions) {
    return apiKeys.filter((apiKey) =>
      Object.entries(conditions).every(([key, value]) => {
        if (value === null || value === undefined) {
          return true
        }

        // 支持部分匹配（字符串）
        if (typeof value === 'string' && typeof apiKey[key] === 'string') {
          return apiKey[key].toLowerCase().includes(value.toLowerCase())
        }

        // 精确匹配
        return apiKey[key] === value
      })
    )
  }

  /**
   * 处理API Keys数据（脱敏、字段过滤、使用统计）
   * @param {Array} apiKeys 原始API Keys数组
   * @param {Object} options 处理选项
   * @returns {Promise<Array>} 处理后的数据
   * @private
   */
  async processApiKeysData(apiKeys, options = {}) {
    const { fields, includeUsage, sanitize } = options
    const processedData = []

    for (const apiKey of apiKeys) {
      try {
        // 1. 基础数据处理
        let processedItem = this.selectFields(apiKey, fields)

        // 2. 脱敏处理
        if (sanitize) {
          processedItem = this.sanitizeApiKeyData(processedItem)
        }

        // 3. 添加使用统计（如果需要）
        if (includeUsage) {
          const usageStats = await this.getApiKeyUsageStats(apiKey.id)
          processedItem.usageStats = usageStats
        }

        processedData.push(processedItem)
      } catch (error) {
        logger.warn(`Failed to process API key ${apiKey.id}:`, error.message)
        // 继续处理其他API Key，不中断整个流程
      }
    }

    return processedData
  }

  /**
   * 选择指定字段
   * @param {Object} data 数据对象
   * @param {Array} fields 字段列表
   * @returns {Object} 过滤后的对象
   * @private
   */
  selectFields(data, fields) {
    const result = {}
    fields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(data, field)) {
        result[field] = data[field]
      }
    })
    return result
  }

  /**
   * 脱敏API Key数据
   * @param {Object} apiKey API Key数据
   * @returns {Object} 脱敏后的数据
   * @private
   */
  sanitizeApiKeyData(apiKey) {
    const sanitized = { ...apiKey }

    this.sensitiveFields.forEach((field) => {
      if (sanitized[field]) {
        // 只保留前4位和后4位，中间用星号替换
        const value = sanitized[field]
        if (typeof value === 'string' && value.length > 8) {
          sanitized[field] =
            `${value.substring(0, 4)}${'*'.repeat(value.length - 8)}${value.substring(value.length - 4)}`
        } else {
          sanitized[field] = '****'
        }
      }
    })

    return sanitized
  }

  /**
   * 获取API Key使用统计
   * @param {string} keyId API Key ID
   * @returns {Promise<Object>} 使用统计数据
   * @private
   */
  async getApiKeyUsageStats(keyId) {
    try {
      const usageStats = await this.fetchData('usage', keyId)
      return (
        usageStats || {
          totalTokens: 0,
          totalRequests: 0,
          totalCost: 0,
          lastUsed: null
        }
      )
    } catch (error) {
      logger.warn(`Failed to get usage stats for API key ${keyId}:`, error.message)
      return {
        totalTokens: 0,
        totalRequests: 0,
        totalCost: 0,
        lastUsed: null,
        error: 'Failed to retrieve stats'
      }
    }
  }

  /**
   * 导出为JSON格式
   * @param {Array} data 数据数组
   * @param {string} outputPath 输出路径
   * @returns {Promise<Object>} 导出结果
   * @private
   */
  async exportToJson(data, outputPath) {
    try {
      const jsonContent = JSON.stringify(data, null, 2)
      await fs.writeFile(outputPath, jsonContent, 'utf8')

      const stats = await fs.stat(outputPath)
      return {
        fileSize: stats.size,
        encoding: 'utf8'
      }
    } catch (error) {
      throw new Error(`Failed to export JSON: ${error.message}`)
    }
  }

  /**
   * 导出为CSV格式
   * @param {Array} data 数据数组
   * @param {string} outputPath 输出路径
   * @param {Array} fields 字段列表
   * @returns {Promise<Object>} 导出结果
   * @private
   */
  async exportToCsv(data, outputPath, fields) {
    try {
      if (data.length === 0) {
        // 空数据，创建空文件
        await fs.writeFile(outputPath, '', 'utf8')
        return { fileSize: 0, encoding: 'utf8' }
      }

      // 处理嵌套对象（如usageStats）
      const flattenedData = data.map((item) => this.flattenObject(item))

      // 生成CSV内容
      const csvContent = this.generateCsvContent(flattenedData, fields)

      // 写入文件
      await fs.writeFile(outputPath, csvContent, 'utf8')

      const stats = await fs.stat(outputPath)
      return {
        fileSize: stats.size,
        encoding: 'utf8'
      }
    } catch (error) {
      throw new Error(`Failed to export CSV: ${error.message}`)
    }
  }

  /**
   * 生成CSV内容
   * @param {Array} data 扁平化的数据数组
   * @param {Array} fields 字段列表
   * @returns {string} CSV内容
   * @private
   */
  generateCsvContent(data, fields) {
    // 生成CSV头部
    const headers = fields.map((field) => this.formatFieldTitle(field))
    const csvRows = [headers.join(',')]

    // 生成数据行
    data.forEach((item) => {
      const row = fields.map((field) => {
        const value = item[field] || ''
        // 处理包含逗号或引号的值
        if (
          typeof value === 'string' &&
          (value.includes(',') || value.includes('"') || value.includes('\n'))
        ) {
          return `"${value.replace(/"/g, '""')}"`
        }
        return value
      })
      csvRows.push(row.join(','))
    })

    return csvRows.join('\n')
  }

  /**
   * 扁平化对象（处理嵌套结构）
   * @param {Object} obj 要扁平化的对象
   * @param {string} prefix 前缀
   * @returns {Object} 扁平化后的对象
   * @private
   */
  flattenObject(obj, prefix = '') {
    const flattened = {}

    Object.keys(obj).forEach((key) => {
      const value = obj[key]
      const newKey = prefix ? `${prefix}.${key}` : key

      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        // 递归处理嵌套对象
        Object.assign(flattened, this.flattenObject(value, newKey))
      } else if (Array.isArray(value)) {
        // 数组转换为字符串
        flattened[newKey] = value.join(', ')
      } else {
        flattened[newKey] = value
      }
    })

    return flattened
  }

  /**
   * 格式化字段标题（用于CSV头部）
   * @param {string} fieldName 字段名
   * @returns {string} 格式化后的标题
   * @private
   */
  formatFieldTitle(fieldName) {
    return fieldName
      .replace(/([A-Z])/g, ' $1') // 在大写字母前添加空格
      .replace(/^./, (str) => str.toUpperCase()) // 首字母大写
      .trim()
  }

  /**
   * 生成导出文件名
   * @param {string} format 文件格式
   * @returns {string} 文件名
   * @private
   */
  generateFilename(format) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
    return `apikeys_export_${timestamp}.${format}`
  }

  /**
   * 获取导出统计信息
   * @returns {Promise<Object>} 统计信息
   */
  async getExportStats() {
    try {
      const files = await fs.readdir(this.outputDir)
      const exportFiles = files.filter((file) => file.startsWith('apikeys_export_'))

      const stats = []
      for (const file of exportFiles) {
        const filePath = path.join(this.outputDir, file)
        const fileStat = await fs.stat(filePath)
        stats.push({
          filename: file,
          size: fileStat.size,
          createdAt: fileStat.birthtime,
          modifiedAt: fileStat.mtime
        })
      }

      return {
        totalExports: exportFiles.length,
        outputDir: this.outputDir,
        files: stats.sort((a, b) => b.createdAt - a.createdAt)
      }
    } catch (error) {
      logger.error('Failed to get export stats:', error)
      throw error
    }
  }

  /**
   * 清理过期的导出文件
   * @param {number} maxAgeHours 最大保存时间（小时）
   * @returns {Promise<number>} 清理的文件数量
   */
  async cleanupExpiredExports(maxAgeHours = 24) {
    try {
      const files = await fs.readdir(this.outputDir)
      const exportFiles = files.filter((file) => file.startsWith('apikeys_export_'))

      const cutoffTime = Date.now() - maxAgeHours * 60 * 60 * 1000
      let cleanedCount = 0

      for (const file of exportFiles) {
        const filePath = path.join(this.outputDir, file)
        const fileStat = await fs.stat(filePath)

        if (fileStat.mtime.getTime() < cutoffTime) {
          await fs.unlink(filePath)
          cleanedCount++
          logger.debug(`Cleaned up expired export file: ${file}`)
        }
      }

      if (cleanedCount > 0) {
        logger.info(`Cleaned up ${cleanedCount} expired export files`)
      }

      return cleanedCount
    } catch (error) {
      logger.error('Failed to cleanup expired exports:', error)
      throw error
    }
  }
}

module.exports = ApiKeyExportAdapter
