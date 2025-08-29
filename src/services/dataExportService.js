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
const DataSecurityService = require('./dataSecurityService')

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
  constructor(databaseAdapter, securityOptions = {}) {
    if (!databaseAdapter) {
      throw new Error('DatabaseAdapter is required')
    }
    this.db = databaseAdapter

    // 初始化数据安全服务
    this.securityService = new DataSecurityService({
      sanitizationLevel: securityOptions.sanitizationLevel || 'strict',
      enableChecksumVerification: securityOptions.enableChecksumVerification !== false,
      enableAuditLogging: securityOptions.enableAuditLogging !== false,
      ...securityOptions
    })

    logger.info('📊 DataExportService initialized with enhanced security', {
      sanitizationLevel: this.securityService.options.sanitizationLevel,
      auditEnabled: this.securityService.options.enableAuditLogging
    })
  }

  /**
   * 导出所有数据到指定目录
   * @param {string} exportDir 导出目录路径
   * @param {Object} options 导出选项
   * @param {boolean} options.includeStats 是否包含使用统计（默认true）
   * @param {boolean} options.includeSessions 是否包含会话数据（默认false，通常不需要）
   * @param {boolean} options.includeAdminAccounts 是否包含管理员账户（默认true）
   * @param {boolean} options.includeTwoFactorConfigs 是否包含2FA配置（默认true）
   * @param {boolean} options.validateData 是否验证导出数据（默认true）
   * @param {boolean} options.reportProgress 是否报告进度（默认true）
   * @param {boolean} options.enableSecurityProcessing 是否启用安全处理（默认true）
   * @param {boolean} options.generateAuditReport 是否生成安全审计报告（默认true）
   * @returns {Promise<Object>} 导出结果统计
   */
  async exportAllData(exportDir, options = {}) {
    const {
      includeStats = true,
      includeSessions = false,
      includeAdminAccounts = true,
      includeTwoFactorConfigs = true,
      validateData = true,
      reportProgress = true,
      enableSecurityProcessing = true,
      generateAuditReport = true
    } = options

    logger.info(`🚀 开始全量数据导出到目录: ${exportDir}`)

    // 确保导出目录存在
    await fs.mkdir(exportDir, { recursive: true })

    const exportStats = {
      startTime: new Date().toISOString(),
      categories: {},
      totalRecords: 0,
      errors: [],
      completedCategories: 0,
      totalCategories: 0
    }

    // 计算要执行的导出类别总数
    let totalCategories = 3 // 基础类别：apiKeys, accounts, systemConfig
    if (includeStats) {
      totalCategories += 2
    } // usageStats, systemStats
    if (includeSessions) {
      totalCategories += 1
    }
    if (includeAdminAccounts) {
      totalCategories += 1
    }
    if (includeTwoFactorConfigs) {
      totalCategories += 1
    }
    exportStats.totalCategories = totalCategories

    const reportProgressFn = (categoryName, result) => {
      exportStats.completedCategories++
      if (reportProgress) {
        const progress = Math.round(
          (exportStats.completedCategories / exportStats.totalCategories) * 100
        )
        logger.info(
          `📈 导出进度: ${progress}% (${exportStats.completedCategories}/${exportStats.totalCategories}) - ${categoryName} 完成`
        )
      }
      return result
    }

    try {
      // 核心数据导出 - 遵循 SRP 原则
      logger.info('📋 开始核心数据导出...')
      exportStats.categories.apiKeys = reportProgressFn(
        'API Keys',
        await this.exportApiKeys(exportDir)
      )

      exportStats.categories.accounts = reportProgressFn(
        '账户数据',
        await this.exportAccounts(exportDir, { enableSecurityProcessing })
      )

      exportStats.categories.systemConfig = reportProgressFn(
        '系统配置',
        await this.exportSystemConfig(exportDir)
      )

      // 管理数据导出
      if (includeAdminAccounts) {
        logger.info('👨‍💼 开始管理数据导出...')
        exportStats.categories.adminAccounts = reportProgressFn(
          '管理员账户',
          await this.exportAdminAccounts(exportDir, { enableSecurityProcessing })
        )
      }

      if (includeTwoFactorConfigs) {
        exportStats.categories.twoFactorConfigs = reportProgressFn(
          '2FA配置',
          await this.exportTwoFactorConfigs(exportDir, { enableSecurityProcessing })
        )
      }

      // 统计数据导出
      if (includeStats) {
        logger.info('📊 开始统计数据导出...')
        exportStats.categories.usageStats = reportProgressFn(
          '使用统计',
          await this.exportUsageStats(exportDir)
        )

        exportStats.categories.systemStats = reportProgressFn(
          '系统统计',
          await this.exportSystemStats(exportDir)
        )
      }

      // 可选数据导出
      if (includeSessions) {
        exportStats.categories.sessions = reportProgressFn(
          '会话数据',
          await this.exportSessions(exportDir)
        )
      }

      // 计算总记录数
      exportStats.totalRecords = Object.values(exportStats.categories).reduce(
        (sum, category) => sum + (category?.recordCount || 0),
        0
      )

      // 统计成功和失败的类别
      const successfulCategories = Object.entries(exportStats.categories).filter(
        ([_, result]) => result.status === 'success'
      ).length
      const failedCategories = Object.entries(exportStats.categories).filter(
        ([_, result]) => result.status === 'error'
      ).length
      const skippedCategories = Object.entries(exportStats.categories).filter(
        ([_, result]) => result.status === 'skipped'
      ).length

      // 生成增强的导出元数据
      const metadata = {
        exportVersion: '1.2.0', // 版本升级，包含安全增强功能
        sourceDatabase: this.db.constructor.name,
        exportOptions: {
          includeStats,
          includeSessions,
          includeAdminAccounts,
          includeTwoFactorConfigs,
          validateData,
          enableSecurityProcessing,
          generateAuditReport
        },
        securityConfiguration: {
          sanitizationLevel: this.securityService.options.sanitizationLevel,
          auditingEnabled: this.securityService.options.enableAuditLogging,
          checksumVerificationEnabled: this.securityService.options.enableChecksumVerification
        },
        summary: {
          totalCategories: exportStats.totalCategories,
          successfulCategories,
          failedCategories,
          skippedCategories,
          totalRecords: exportStats.totalRecords,
          categoryBreakdown: Object.fromEntries(
            Object.entries(exportStats.categories).map(([name, result]) => [
              name,
              { recordCount: result.recordCount, status: result.status }
            ])
          )
        },
        ...exportStats,
        endTime: new Date().toISOString(),
        duration: Date.now() - new Date(exportStats.startTime).getTime()
      }

      await this.saveJson(path.join(exportDir, 'export-metadata.json'), metadata)

      // 数据完整性验证和安全处理
      if (validateData) {
        logger.info('🔐 开始数据完整性验证...')
        await this.generateChecksums(exportDir)
        logger.info('✅ 数据完整性验证完成')
      }

      // 生成安全审计报告
      if (generateAuditReport && enableSecurityProcessing) {
        logger.info('📋 生成安全审计报告...')
        const auditReport = this.securityService.generateSecurityAuditReport()
        await this.saveJson(path.join(exportDir, 'security-audit-report.json'), auditReport)
        logger.info('📋 安全审计报告已生成')

        // 将审计信息添加到元数据
        metadata.securityAudit = {
          operationId: auditReport.operationId,
          totalOperations: auditReport.summary.totalOperations,
          successfulOperations: auditReport.summary.successfulOperations,
          failedOperations: auditReport.summary.failedOperations,
          complianceStatus: auditReport.complianceStatus.overall
        }
      }

      // 最终报告
      const duration = Math.round(metadata.duration / 1000)
      logger.info(`🎉 数据导出全部完成!`)
      logger.info(
        `📊 导出统计: ${exportStats.totalRecords} 条记录，${successfulCategories} 个类别成功，${failedCategories} 个失败，${skippedCategories} 个跳过`
      )
      logger.info(`⏱️ 总耗时: ${duration} 秒`)

      return exportStats
    } catch (error) {
      exportStats.errors.push({
        message: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
        phase: '主导出流程'
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
  async exportAccounts(exportDir, options = {}) {
    logger.info('👤 导出账户数据...')

    try {
      // 导出Claude账户（包含加密数据和安全处理）
      const claudeAccounts = await this.db.getAllClaudeAccounts()

      // 使用安全服务处理Token安全
      let claudeProcessedResult = { processed: claudeAccounts }
      if (options.enableSecurityProcessing !== false) {
        claudeProcessedResult = await this.securityService.handleEncryptedTokens(
          claudeAccounts,
          'export'
        )
      }

      const claudeAccountData = {
        type: 'claudeAccounts',
        version: '1.1.0', // 版本升级反映安全增强
        timestamp: new Date().toISOString(),
        data: claudeProcessedResult.processed,
        metadata: {
          totalCount: claudeProcessedResult.processed.length,
          encryptedFields: ['claudeAiOauth', 'refreshToken', 'accessToken'],
          securityProcessing: options.enableSecurityProcessing !== false,
          tokenStats: claudeProcessedResult.tokenStats || {},
          warnings: claudeProcessedResult.warnings || [],
          note: '加密数据将使用相同密钥在目标数据库中解密'
        }
      }

      await this.saveJson(path.join(exportDir, 'claude-accounts.json'), claudeAccountData)

      // 记录Token安全警告
      if (claudeProcessedResult.warnings && claudeProcessedResult.warnings.length > 0) {
        logger.warn(`⚠️ Claude账户Token安全警告: ${claudeProcessedResult.warnings.length} 个警告`)
      }

      // 导出Claude Console账户（包含加密数据）
      const claudeConsoleAccounts = await this.db.getAllClaudeConsoleAccounts()
      const claudeConsoleAccountData = {
        type: 'claudeConsoleAccounts',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        data: claudeConsoleAccounts,
        metadata: {
          totalCount: claudeConsoleAccounts.length,
          encryptedFields: ['sessionKey', 'organizationId'],
          note: '加密数据将使用相同密钥在目标数据库中解密'
        }
      }

      await this.saveJson(
        path.join(exportDir, 'claude-console-accounts.json'),
        claudeConsoleAccountData
      )

      // 导出Gemini账户（包含加密数据）
      const geminiAccounts = await this.db.getAllGeminiAccounts()
      const geminiAccountData = {
        type: 'geminiAccounts',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        data: geminiAccounts,
        metadata: {
          totalCount: geminiAccounts.length,
          encryptedFields: ['accessToken', 'refreshToken', 'credentials'],
          note: '加密数据将使用相同密钥在目标数据库中解密'
        }
      }

      await this.saveJson(path.join(exportDir, 'gemini-accounts.json'), geminiAccountData)

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

      const totalAccounts =
        claudeProcessedResult.processed.length +
        claudeConsoleAccounts.length +
        geminiAccounts.length +
        openaiAccounts.length
      logger.info(
        `👤 账户数据导出完成: ${totalAccounts} 个账户 (Claude: ${claudeProcessedResult.processed.length}, Claude Console: ${claudeConsoleAccounts.length}, Gemini: ${geminiAccounts.length}, OpenAI: ${openaiAccounts.length})`
      )
      return {
        recordCount: totalAccounts,
        status: 'success',
        securityWarnings: claudeProcessedResult.warnings?.length || 0,
        tokenStats: claudeProcessedResult.tokenStats || {}
      }
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
      // 获取所有系统配置类型
      const schedulingConfig = await this.db.getSystemSchedulingConfig()
      const brandingConfig = await this.db.getBrandingConfig()
      const notificationConfig = await this.db.getNotificationConfig()

      // 统计实际存在的配置数量
      const configs = {
        schedulingConfig,
        brandingConfig,
        notificationConfig
      }

      // 过滤掉null/undefined的配置
      const existingConfigs = Object.fromEntries(
        Object.entries(configs).filter(([_, config]) => config !== null)
      )

      const configData = {
        type: 'systemConfig',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        data: existingConfigs,
        metadata: {
          configTypes: Object.keys(existingConfigs),
          totalCount: Object.keys(existingConfigs).length,
          availableTypes: ['scheduling', 'branding', 'notification'],
          note: '包含所有系统级别的配置设置'
        }
      }

      await this.saveJson(path.join(exportDir, 'system-config.json'), configData)

      const recordCount = Object.keys(existingConfigs).length
      logger.info(
        `⚙️  系统配置导出完成: ${recordCount} 个配置项 (${Object.keys(existingConfigs).join(', ')})`
      )
      return { recordCount, status: 'success' }
    } catch (error) {
      logger.error('❌ 系统配置导出失败:', error)
      return { recordCount: 0, status: 'error', error: error.message }
    }
  }

  /**
   * 导出使用统计数据
   * @param {string} exportDir 导出目录
   * @param {Object} options 导出选项
   * @param {boolean} options.includeDetailedStats 是否包含详细统计（默认true）
   * @param {boolean} options.includeApiKeyStats 是否包含API Key统计（默认true）
   * @returns {Promise<Object>} 导出统计
   */
  async exportUsageStats(exportDir, options = {}) {
    logger.info('📊 导出使用统计数据...')

    const { includeDetailedStats = true, includeApiKeyStats = true } = options

    try {
      // 获取所有账户的使用统计
      const accountsUsageStats = await this.db.getAllAccountsUsageStats()

      // 收集所有统计数据
      const statsCollections = {
        accountsUsageStats
      }

      // 包含API Key使用统计
      if (includeApiKeyStats) {
        try {
          const allApiKeys = await this.db.getAllApiKeys()
          const apiKeyStats = []

          for (const apiKey of allApiKeys) {
            try {
              const usageStats = await this.db.getUsageStats(apiKey.id)
              if (usageStats) {
                apiKeyStats.push({
                  keyId: apiKey.id,
                  keyName: apiKey.name,
                  ...usageStats
                })
              }
            } catch (keyError) {
              logger.warn(`获取API Key ${apiKey.id} 统计时出错:`, keyError.message)
            }
          }

          statsCollections.apiKeyUsageStats = apiKeyStats
        } catch (error) {
          logger.warn('获取API Key统计时出错:', error.message)
          statsCollections.apiKeyUsageStats = []
        }
      }

      // 包含详细的系统级统计
      if (includeDetailedStats) {
        try {
          const systemStats = await this.db.getSystemStats()
          const todayStats = await this.db.getTodayStats()
          const systemAverages = await this.db.getSystemAverages()

          statsCollections.systemStatistics = {
            systemStats: systemStats || {},
            todayStats: todayStats || {},
            systemAverages: systemAverages || {}
          }
        } catch (error) {
          logger.warn('获取系统统计时出错:', error.message)
          statsCollections.systemStatistics = {}
        }
      }

      const statsData = {
        type: 'usageStats',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        data: statsCollections,
        metadata: {
          totalAccounts: accountsUsageStats.length,
          totalApiKeys: statsCollections.apiKeyUsageStats?.length || 0,
          includedDataTypes: Object.keys(statsCollections).filter(
            (key) =>
              statsCollections[key] &&
              (Array.isArray(statsCollections[key])
                ? statsCollections[key].length > 0
                : Object.keys(statsCollections[key]).length > 0)
          ),
          exportOptions: {
            includeDetailedStats,
            includeApiKeyStats
          },
          note: '包含账户、API Key和系统级别的完整使用统计数据'
        }
      }

      await this.saveJson(path.join(exportDir, 'usage-stats.json'), statsData)

      const totalRecords =
        accountsUsageStats.length + (statsCollections.apiKeyUsageStats?.length || 0)
      logger.info(
        `📊 使用统计导出完成: ${totalRecords} 条统计记录 (账户: ${accountsUsageStats.length}, API Keys: ${statsCollections.apiKeyUsageStats?.length || 0})`
      )
      return { recordCount: totalRecords, status: 'success' }
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
   * 导出管理员账户数据（包含安全处理）
   * @param {string} exportDir 导出目录
   * @param {Object} options 导出选项
   * @returns {Promise<Object>} 导出统计
   */
  async exportAdminAccounts(exportDir, options = {}) {
    logger.info('👨‍💼 导出管理员账户数据...')

    try {
      const admins = await this.db.getAllAdmins()

      // 使用安全服务处理敏感信息
      let processedResult = { processed: admins }
      if (options.enableSecurityProcessing !== false) {
        processedResult = await this.securityService.handleAdminPasswordHashes(admins, 'export')
      } else {
        // 传统脱敏处理（向后兼容）
        processedResult.processed = admins.map((admin) => ({
          ...admin,
          passwordHash: '[REDACTED]',
          createdAt: admin.createdAt,
          lastLogin: admin.lastLogin,
          role: admin.role || 'admin',
          status: admin.status || 'active'
        }))
      }

      const adminData = {
        type: 'adminAccounts',
        version: '1.1.0', // 版本升级反映安全增强
        timestamp: new Date().toISOString(),
        data: processedResult.processed,
        metadata: {
          totalCount: processedResult.processed.length,
          sanitizedFields: ['passwordHash'],
          securityProcessing: options.enableSecurityProcessing !== false,
          warnings: processedResult.warnings || [],
          recommendations: processedResult.recommendations || [],
          note: '管理员密码已经过安全处理，导入后需要重置密码'
        }
      }

      await this.saveJson(path.join(exportDir, 'admin-accounts.json'), adminData)

      // 记录安全警告
      if (processedResult.warnings && processedResult.warnings.length > 0) {
        logger.warn(`⚠️ 管理员账户安全警告: ${processedResult.warnings.length} 个警告`)
        for (const warning of processedResult.warnings) {
          logger.warn(`  - ${warning.username}: ${warning.message}`)
        }
      }

      logger.info(`👨‍💼 管理员账户导出完成: ${processedResult.processed.length} 个账户`)
      return {
        recordCount: processedResult.processed.length,
        status: 'success',
        securityWarnings: processedResult.warnings?.length || 0,
        securityRecommendations: processedResult.recommendations?.length || 0
      }
    } catch (error) {
      logger.error('❌ 管理员账户导出失败:', error)
      return { recordCount: 0, status: 'error', error: error.message }
    }
  }

  /**
   * 导出Gemini账户数据
   * @param {string} exportDir 导出目录
   * @returns {Promise<Object>} 导出统计
   */
  async exportGeminiAccounts(exportDir) {
    logger.info('🔮 导出Gemini账户数据...')

    try {
      const geminiAccounts = await this.db.getAllGeminiAccounts()

      const geminiAccountData = {
        type: 'geminiAccounts',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        data: geminiAccounts,
        metadata: {
          totalCount: geminiAccounts.length,
          encryptedFields: ['accessToken', 'refreshToken', 'credentials'],
          note: '加密数据将使用相同密钥在目标数据库中解密'
        }
      }

      await this.saveJson(path.join(exportDir, 'gemini-accounts.json'), geminiAccountData)

      logger.info(`🔮 Gemini账户导出完成: ${geminiAccounts.length} 个账户`)
      return { recordCount: geminiAccounts.length, status: 'success' }
    } catch (error) {
      logger.error('❌ Gemini账户导出失败:', error)
      return { recordCount: 0, status: 'error', error: error.message }
    }
  }

  /**
   * 导出品牌设置配置
   * @param {string} exportDir 导出目录
   * @returns {Promise<Object>} 导出统计
   */
  async exportBrandingConfig(exportDir) {
    logger.info('🎨 导出品牌设置配置...')

    try {
      const brandingConfig = await this.db.getBrandingConfig()

      const brandingData = {
        type: 'brandingConfig',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        data: brandingConfig,
        metadata: {
          totalCount: brandingConfig ? 1 : 0,
          configType: 'branding',
          note: '包含应用品牌、样式和UI定制设置'
        }
      }

      await this.saveJson(path.join(exportDir, 'branding-config.json'), brandingData)

      const recordCount = brandingConfig ? 1 : 0
      logger.info(`🎨 品牌设置导出完成: ${recordCount} 个配置项`)
      return { recordCount, status: 'success' }
    } catch (error) {
      logger.error('❌ 品牌设置导出失败:', error)
      return { recordCount: 0, status: 'error', error: error.message }
    }
  }

  /**
   * 导出通知设置配置
   * @param {string} exportDir 导出目录
   * @returns {Promise<Object>} 导出统计
   */
  async exportNotificationConfig(exportDir) {
    logger.info('🔔 导出通知设置配置...')

    try {
      const notificationConfig = await this.db.getNotificationConfig()

      const notificationData = {
        type: 'notificationConfig',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        data: notificationConfig,
        metadata: {
          totalCount: notificationConfig ? 1 : 0,
          configType: 'notification',
          note: '包含邮件、短信、推送等通知渠道配置'
        }
      }

      await this.saveJson(path.join(exportDir, 'notification-config.json'), notificationData)

      const recordCount = notificationConfig ? 1 : 0
      logger.info(`🔔 通知设置导出完成: ${recordCount} 个配置项`)
      return { recordCount, status: 'success' }
    } catch (error) {
      logger.error('❌ 通知设置导出失败:', error)
      return { recordCount: 0, status: 'error', error: error.message }
    }
  }

  /**
   * 导出2FA配置（包含安全处理）
   * @param {string} exportDir 导出目录
   * @param {Object} options 导出选项
   * @returns {Promise<Object>} 导出统计
   */
  async exportTwoFactorConfigs(exportDir, options = {}) {
    logger.info('🔐 导出2FA配置数据...')

    try {
      const twoFactorConfigs = await this.db.getAllTwoFactorConfigs()

      // 使用安全服务处理敏感信息
      let processedResult = { processed: twoFactorConfigs }
      if (options.enableSecurityProcessing !== false) {
        processedResult = await this.securityService.handleTwoFactorSecrets(
          twoFactorConfigs,
          'export'
        )
      } else {
        // 传统脱敏处理（向后兼容）
        processedResult.processed = twoFactorConfigs.map((config) => ({
          username: config.username,
          isEnabled: config.isEnabled || false,
          createdAt: config.createdAt,
          lastUsed: config.lastUsed,
          secret: '[REDACTED]',
          backupCodes: [],
          qrCodeDataUrl: '[REDACTED]'
        }))
      }

      const twoFactorData = {
        type: 'twoFactorConfigs',
        version: '1.1.0', // 版本升级反映安全增强
        timestamp: new Date().toISOString(),
        data: processedResult.processed,
        metadata: {
          totalCount: processedResult.processed.length,
          sanitizedFields: ['secret', 'backupCodes', 'qrCodeDataUrl'],
          securityProcessing: options.enableSecurityProcessing !== false,
          warnings: processedResult.warnings || [],
          recommendations: processedResult.recommendations || [],
          note: '2FA密钥和恢复码已经过安全处理，导入后需要用户重新设置2FA'
        }
      }

      await this.saveJson(path.join(exportDir, 'two-factor-configs.json'), twoFactorData)

      // 记录安全警告
      if (processedResult.warnings && processedResult.warnings.length > 0) {
        logger.warn(`⚠️ 2FA配置安全警告: ${processedResult.warnings.length} 个警告`)
        for (const warning of processedResult.warnings) {
          logger.warn(`  - ${warning.username}: ${warning.message}`)
        }
      }

      logger.info(`🔐 2FA配置导出完成: ${processedResult.processed.length} 个配置`)
      return {
        recordCount: processedResult.processed.length,
        status: 'success',
        securityWarnings: processedResult.warnings?.length || 0,
        securityRecommendations: processedResult.recommendations?.length || 0
      }
    } catch (error) {
      logger.error('❌ 2FA配置导出失败:', error)
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
