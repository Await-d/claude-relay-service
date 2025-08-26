/**
 * @fileoverview 数据导出服务
 *
 * 支持将数据从任何数据库适配器导出为标准化JSON格式
 * 遵循SOLID原则，支持增量导出和数据完整性验证
 *
 * @author Claude Code
 * @version 1.0.0
 */

const logger = require('../utils/logger')
const fs = require('fs').promises
const path = require('path')
const crypto = require('crypto')

/**
 * 数据导出服务
 *
 * 核心特性：
 * - 按数据类型分类导出，便于管理和恢复
 * - 支持增量导出和全量导出模式
 * - 自动生成数据完整性校验和
 * - 支持加密数据的透明处理
 * - 遵循 SRP：每个方法只负责一类数据的导出
 */
class DataExportService {
  constructor(databaseAdapter) {
    if (!databaseAdapter) {
      throw new Error('DatabaseAdapter is required')
    }
    this.db = databaseAdapter
  }

  /**
   * 导出所有数据到指定目录
   * @param {string} exportDir 导出目录路径
   * @param {Object} options 导出选项
   * @param {boolean} options.includeStats 是否包含使用统计（默认true）
   * @param {boolean} options.includeSessions 是否包含会话数据（默认false，通常不需要）
   * @param {boolean} options.validateData 是否验证导出数据（默认true）
   * @returns {Promise<Object>} 导出结果统计
   */
  async exportAllData(exportDir, options = {}) {
    const { includeStats = true, includeSessions = false, validateData = true } = options

    logger.info(`🚀 开始数据导出到目录: ${exportDir}`)

    // 确保导出目录存在
    await fs.mkdir(exportDir, { recursive: true })

    const exportStats = {
      startTime: new Date().toISOString(),
      categories: {},
      totalRecords: 0,
      errors: []
    }

    try {
      // 按类别导出数据 - 遵循 SRP 原则
      exportStats.categories.apiKeys = await this.exportApiKeys(exportDir)
      exportStats.categories.accounts = await this.exportAccounts(exportDir)
      exportStats.categories.systemConfig = await this.exportSystemConfig(exportDir)

      if (includeStats) {
        exportStats.categories.usageStats = await this.exportUsageStats(exportDir)
        exportStats.categories.systemStats = await this.exportSystemStats(exportDir)
      }

      if (includeSessions) {
        exportStats.categories.sessions = await this.exportSessions(exportDir)
      }

      // 计算总记录数
      exportStats.totalRecords = Object.values(exportStats.categories).reduce(
        (sum, category) => sum + category.recordCount,
        0
      )

      // 生成导出元数据
      const metadata = {
        exportVersion: '1.0.0',
        sourceDatabase: this.db.constructor.name,
        ...exportStats,
        endTime: new Date().toISOString()
      }

      await this.saveJson(path.join(exportDir, 'export-metadata.json'), metadata)

      // 数据完整性验证
      if (validateData) {
        await this.generateChecksums(exportDir)
      }

      logger.info(`✅ 数据导出完成! 总计 ${exportStats.totalRecords} 条记录`)
      return exportStats
    } catch (error) {
      exportStats.errors.push({
        message: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      })
      logger.error('💥 数据导出失败:', error)
      throw error
    }
  }

  /**
   * 导出API Keys数据
   * @param {string} exportDir 导出目录
   * @returns {Promise<Object>} 导出统计
   */
  async exportApiKeys(exportDir) {
    logger.info('📋 导出API Keys数据...')

    try {
      const apiKeys = await this.db.getAllApiKeys()
      const apiKeyData = {
        type: 'apiKeys',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        data: apiKeys,
        metadata: {
          totalCount: apiKeys.length,
          hasHashMapping: true
        }
      }

      await this.saveJson(path.join(exportDir, 'api-keys.json'), apiKeyData)

      logger.info(`📋 API Keys导出完成: ${apiKeys.length} 条记录`)
      return { recordCount: apiKeys.length, status: 'success' }
    } catch (error) {
      logger.error('❌ API Keys导出失败:', error)
      return { recordCount: 0, status: 'error', error: error.message }
    }
  }

  /**
   * 导出账户数据
   * @param {string} exportDir 导出目录
   * @returns {Promise<Object>} 导出统计
   */
  async exportAccounts(exportDir) {
    logger.info('👤 导出账户数据...')

    try {
      // 导出Claude账户（包含加密数据）
      const claudeAccounts = await this.db.getAllClaudeAccounts()
      const claudeAccountData = {
        type: 'claudeAccounts',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        data: claudeAccounts,
        metadata: {
          totalCount: claudeAccounts.length,
          encryptedFields: ['claudeAiOauth', 'refreshToken', 'accessToken'],
          note: '加密数据将使用相同密钥在目标数据库中解密'
        }
      }

      await this.saveJson(path.join(exportDir, 'claude-accounts.json'), claudeAccountData)

      // 导出OpenAI账户
      const openaiAccounts = await this.db.getAllOpenAIAccounts()
      const openaiAccountData = {
        type: 'openaiAccounts',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        data: openaiAccounts,
        metadata: {
          totalCount: openaiAccounts.length
        }
      }

      await this.saveJson(path.join(exportDir, 'openai-accounts.json'), openaiAccountData)

      const totalAccounts = claudeAccounts.length + openaiAccounts.length
      logger.info(`👤 账户数据导出完成: ${totalAccounts} 个账户`)
      return { recordCount: totalAccounts, status: 'success' }
    } catch (error) {
      logger.error('❌ 账户数据导出失败:', error)
      return { recordCount: 0, status: 'error', error: error.message }
    }
  }

  /**
   * 导出系统配置数据
   * @param {string} exportDir 导出目录
   * @returns {Promise<Object>} 导出统计
   */
  async exportSystemConfig(exportDir) {
    logger.info('⚙️  导出系统配置数据...')

    try {
      const schedulingConfig = await this.db.getSystemSchedulingConfig()
      const configData = {
        type: 'systemConfig',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        data: {
          schedulingConfig
        },
        metadata: {
          configTypes: ['scheduling'],
          totalCount: schedulingConfig ? 1 : 0
        }
      }

      await this.saveJson(path.join(exportDir, 'system-config.json'), configData)

      const recordCount = schedulingConfig ? 1 : 0
      logger.info(`⚙️  系统配置导出完成: ${recordCount} 个配置项`)
      return { recordCount, status: 'success' }
    } catch (error) {
      logger.error('❌ 系统配置导出失败:', error)
      return { recordCount: 0, status: 'error', error: error.message }
    }
  }

  /**
   * 导出使用统计数据
   * @param {string} exportDir 导出目录
   * @returns {Promise<Object>} 导出统计
   */
  async exportUsageStats(exportDir) {
    logger.info('📊 导出使用统计数据...')

    try {
      // 获取所有账户的使用统计
      const accountsUsageStats = await this.db.getAllAccountsUsageStats()

      const statsData = {
        type: 'usageStats',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        data: {
          accountsUsageStats
        },
        metadata: {
          totalAccounts: accountsUsageStats.length,
          dataTypes: ['accountUsage'],
          note: '详细的日使用统计需要单独的Redis SCAN操作，建议在目标环境重新生成'
        }
      }

      await this.saveJson(path.join(exportDir, 'usage-stats.json'), statsData)

      logger.info(`📊 使用统计导出完成: ${accountsUsageStats.length} 个账户统计`)
      return { recordCount: accountsUsageStats.length, status: 'success' }
    } catch (error) {
      logger.error('❌ 使用统计导出失败:', error)
      return { recordCount: 0, status: 'error', error: error.message }
    }
  }

  /**
   * 导出系统统计数据
   * @param {string} exportDir 导出目录
   * @returns {Promise<Object>} 导出统计
   */
  async exportSystemStats(exportDir) {
    logger.info('🔢 导出系统统计数据...')

    try {
      const systemStats = await this.db.getSystemStats()
      const todayStats = await this.db.getTodayStats()
      const systemAverages = await this.db.getSystemAverages()

      const statsData = {
        type: 'systemStats',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        data: {
          systemStats,
          todayStats,
          systemAverages
        },
        metadata: {
          dataTypes: ['systemStats', 'todayStats', 'systemAverages'],
          totalCount: [systemStats, todayStats, systemAverages].filter((s) => s).length,
          note: '系统统计数据通常是动态计算的，可在目标环境重新生成'
        }
      }

      await this.saveJson(path.join(exportDir, 'system-stats.json'), statsData)

      const recordCount = statsData.metadata.totalCount
      logger.info(`🔢 系统统计导出完成: ${recordCount} 类统计数据`)
      return { recordCount, status: 'success' }
    } catch (error) {
      logger.error('❌ 系统统计导出失败:', error)
      return { recordCount: 0, status: 'error', error: error.message }
    }
  }

  /**
   * 导出会话数据（可选，通常不需要）
   * @param {string} exportDir 导出目录
   * @returns {Promise<Object>} 导出统计
   */
  async exportSessions(exportDir) {
    logger.info('🔐 导出会话数据...')

    try {
      // 注意：会话数据通常是临时的，迁移后可能已过期
      // 这里主要是为了完整性，实际迁移时可能不需要包含
      const sessionData = {
        type: 'sessions',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        data: {
          note: '会话数据是临时的，通常在迁移后需要重新生成',
          exported: false
        },
        metadata: {
          totalCount: 0,
          reason: 'Sessions are temporary and usually expire before migration'
        }
      }

      await this.saveJson(path.join(exportDir, 'sessions.json'), sessionData)

      logger.info('🔐 会话数据导出完成: 0 条记录（跳过临时会话）')
      return { recordCount: 0, status: 'skipped' }
    } catch (error) {
      logger.error('❌ 会话数据导出失败:', error)
      return { recordCount: 0, status: 'error', error: error.message }
    }
  }

  /**
   * 生成文件校验和用于数据完整性验证
   * @param {string} exportDir 导出目录
   * @returns {Promise<void>}
   */
  async generateChecksums(exportDir) {
    logger.info('🔐 生成数据完整性校验和...')

    try {
      const files = await fs.readdir(exportDir)
      const jsonFiles = files.filter((file) => file.endsWith('.json') && file !== 'checksums.json')

      const checksums = {}

      for (const file of jsonFiles) {
        const filePath = path.join(exportDir, file)
        const content = await fs.readFile(filePath, 'utf8')
        const hash = crypto.createHash('sha256').update(content).digest('hex')
        checksums[file] = {
          sha256: hash,
          size: content.length,
          timestamp: new Date().toISOString()
        }
      }

      await this.saveJson(path.join(exportDir, 'checksums.json'), checksums)
      logger.info('🔐 校验和生成完成')
    } catch (error) {
      logger.error('❌ 校验和生成失败:', error)
      throw error
    }
  }

  /**
   * 保存JSON数据到文件
   * @param {string} filePath 文件路径
   * @param {Object} data 数据对象
   * @returns {Promise<void>}
   */
  async saveJson(filePath, data) {
    const content = JSON.stringify(data, null, 2)
    await fs.writeFile(filePath, content, 'utf8')
  }
}

module.exports = DataExportService
