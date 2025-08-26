/**
 * @fileoverview 数据库迁移服务
 *
 * 提供数据库间数据迁移的统一接口，支持零停机迁移策略
 * 遵循SOLID原则，支持多种迁移模式和策略
 *
 * @author Claude Code
 * @version 1.0.0
 */

const logger = require('../utils/logger')
const DataExportService = require('./dataExportService')
const DataImportService = require('./dataImportService')
const DatabaseFactory = require('../models/database/DatabaseFactory')
const path = require('path')
const fs = require('fs').promises

/**
 * 数据库迁移服务
 *
 * 核心特性：
 * - 支持任意数据库之间的迁移（Redis → MongoDB/PostgreSQL/MySQL）
 * - 零停机迁移策略：导出 → 验证 → 导入 → 切换
 * - 数据完整性验证和回滚机制
 * - 支持增量迁移和测试模式
 * - 遵循 DIP：依赖抽象的 DatabaseAdapter
 */
class DataMigrationService {
  constructor() {
    this.currentDatabase = null
    this.targetDatabase = null
    this.migrationDir = null
  }

  /**
   * 执行完整的数据库迁移
   * @param {Object} sourceConfig 源数据库配置
   * @param {Object} targetConfig 目标数据库配置
   * @param {Object} options 迁移选项
   * @param {string} options.migrationDir 迁移工作目录（默认：./migrations/timestamp）
   * @param {string} options.strategy 迁移策略：'export-import'|'live-sync'（默认：'export-import'）
   * @param {boolean} options.validateOnly 仅验证迁移可行性（默认：false）
   * @param {boolean} options.backupTarget 是否备份目标数据库（默认：true）
   * @param {Array<string>} options.includeCategories 要迁移的数据类别
   * @returns {Promise<Object>} 迁移结果
   */
  async migrate(sourceConfig, targetConfig, options = {}) {
    const {
      migrationDir = path.join(process.cwd(), 'migrations', Date.now().toString()),
      strategy = 'export-import',
      validateOnly = false,
      backupTarget = true,
      includeCategories = null
    } = options

    this.migrationDir = migrationDir

    logger.info('🚀 开始数据库迁移')
    logger.info(`📂 迁移工作目录: ${migrationDir}`)
    logger.info(`🎯 迁移策略: ${strategy}`)

    const migrationStats = {
      startTime: new Date().toISOString(),
      sourceDatabase: sourceConfig.database?.type || 'redis',
      targetDatabase: targetConfig.database?.type || 'redis',
      strategy,
      validateOnly,
      phases: {},
      totalRecords: 0,
      errors: []
    }

    try {
      // 确保迁移目录存在
      await fs.mkdir(migrationDir, { recursive: true })

      // Phase 1: 初始化数据库连接
      migrationStats.phases.initialization = await this.initializeDatabases(
        sourceConfig,
        targetConfig
      )

      // Phase 2: 预迁移验证
      migrationStats.phases.validation = await this.validateMigration(includeCategories)

      if (validateOnly) {
        logger.info('✅ 迁移验证完成，跳过实际迁移')
        return migrationStats
      }

      // Phase 3: 备份目标数据库（如果存在数据）
      if (backupTarget) {
        migrationStats.phases.backup = await this.backupTargetDatabase()
      }

      // Phase 4: 执行迁移策略
      if (strategy === 'export-import') {
        migrationStats.phases.migration = await this.executeExportImportMigration(includeCategories)
      } else {
        throw new Error(`不支持的迁移策略: ${strategy}`)
      }

      // Phase 5: 数据完整性验证
      migrationStats.phases.verification = await this.verifyMigration()

      // Phase 6: 迁移后清理
      migrationStats.phases.cleanup = await this.cleanupMigration()

      migrationStats.endTime = new Date().toISOString()
      migrationStats.totalRecords = migrationStats.phases.migration?.totalRecords || 0

      logger.info('✅ 数据库迁移完成!')
      logger.info(`📊 迁移统计: ${migrationStats.totalRecords} 条记录`)

      return migrationStats
    } catch (error) {
      migrationStats.errors.push({
        message: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      })
      logger.error('💥 数据库迁移失败:', error)

      // 尝试回滚
      await this.rollbackMigration(migrationStats).catch((rollbackError) => {
        logger.error('❌ 回滚失败:', rollbackError)
      })

      throw error
    }
  }

  /**
   * 初始化源和目标数据库连接
   * @param {Object} sourceConfig 源数据库配置
   * @param {Object} targetConfig 目标数据库配置
   * @returns {Promise<Object>} 初始化结果
   */
  async initializeDatabases(sourceConfig, targetConfig) {
    logger.info('🔌 初始化数据库连接...')

    try {
      // 创建数据库适配器实例
      this.currentDatabase = DatabaseFactory.create(sourceConfig)
      this.targetDatabase = DatabaseFactory.create(targetConfig)

      // 连接到数据库
      await this.currentDatabase.connect()
      await this.targetDatabase.connect()

      logger.info(`✅ 源数据库连接成功: ${sourceConfig.database?.type || 'redis'}`)
      logger.info(`✅ 目标数据库连接成功: ${targetConfig.database?.type || 'redis'}`)

      return {
        status: 'success',
        sourceType: sourceConfig.database?.type || 'redis',
        targetType: targetConfig.database?.type || 'redis'
      }
    } catch (error) {
      logger.error('❌ 数据库连接失败:', error)
      throw error
    }
  }

  /**
   * 验证迁移可行性
   * @param {Array<string>} includeCategories 要验证的数据类别
   * @returns {Promise<Object>} 验证结果
   */
  async validateMigration() {
    logger.info('🔍 验证迁移可行性...')

    try {
      const validation = {
        sourceDataExists: false,
        estimatedRecords: 0,
        categories: {},
        issues: [],
        warnings: []
      }

      // 检查源数据库中的数据
      try {
        const apiKeys = await this.currentDatabase.getAllApiKeys()
        validation.categories.apiKeys = apiKeys.length
        validation.estimatedRecords += apiKeys.length
        if (apiKeys.length > 0) {
          validation.sourceDataExists = true
        }
      } catch (error) {
        validation.issues.push(`API Keys检查失败: ${error.message}`)
      }

      try {
        const claudeAccounts = await this.currentDatabase.getAllClaudeAccounts()
        validation.categories.claudeAccounts = claudeAccounts.length
        validation.estimatedRecords += claudeAccounts.length
        if (claudeAccounts.length > 0) {
          validation.sourceDataExists = true
        }
      } catch (error) {
        validation.issues.push(`Claude账户检查失败: ${error.message}`)
      }

      // 检查目标数据库是否为空
      try {
        const targetApiKeys = await this.targetDatabase.getAllApiKeys()
        if (targetApiKeys.length > 0) {
          validation.warnings.push(
            `目标数据库已存在 ${targetApiKeys.length} 个API Keys，可能发生冲突`
          )
        }
      } catch (error) {
        validation.warnings.push(`无法检查目标数据库状态: ${error.message}`)
      }

      // 检查加密配置一致性（对于加密数据）
      if (validation.categories.claudeAccounts > 0) {
        validation.warnings.push('检测到加密的Claude账户数据，请确保源和目标环境使用相同的加密密钥')
      }

      if (!validation.sourceDataExists) {
        validation.warnings.push('源数据库中未检测到数据，可能无需迁移')
      }

      logger.info(`🔍 验证完成: 预估 ${validation.estimatedRecords} 条记录`)
      if (validation.issues.length > 0) {
        logger.warn(`⚠️  发现 ${validation.issues.length} 个问题`)
      }
      if (validation.warnings.length > 0) {
        logger.warn(`⚠️  发现 ${validation.warnings.length} 个警告`)
      }

      return validation
    } catch (error) {
      logger.error('❌ 迁移验证失败:', error)
      throw error
    }
  }

  /**
   * 备份目标数据库
   * @returns {Promise<Object>} 备份结果
   */
  async backupTargetDatabase() {
    logger.info('💾 备份目标数据库...')

    try {
      const backupDir = path.join(this.migrationDir, 'target-backup')
      const exportService = new DataExportService(this.targetDatabase)

      const backupResult = await exportService.exportAllData(backupDir, {
        includeStats: false, // 备份时跳过统计数据
        includeSessions: false
      })

      logger.info(`💾 目标数据库备份完成: ${backupResult.totalRecords} 条记录`)
      return { status: 'success', ...backupResult }
    } catch (error) {
      logger.error('❌ 目标数据库备份失败:', error)
      throw error
    }
  }

  /**
   * 执行导出-导入迁移策略
   * @param {Array<string>} includeCategories 要迁移的数据类别
   * @returns {Promise<Object>} 迁移结果
   */
  async executeExportImportMigration(includeCategories) {
    logger.info('🔄 执行导出-导入迁移...')

    try {
      // Phase 1: 从源数据库导出数据
      logger.info('📤 从源数据库导出数据...')
      const exportDir = path.join(this.migrationDir, 'export')
      const exportService = new DataExportService(this.currentDatabase)

      const exportResult = await exportService.exportAllData(exportDir, {
        includeStats: true,
        includeSessions: false, // 会话数据不迁移
        validateData: true
      })

      logger.info(`📤 数据导出完成: ${exportResult.totalRecords} 条记录`)

      // Phase 2: 导入数据到目标数据库
      logger.info('📥 向目标数据库导入数据...')
      const importService = new DataImportService(this.targetDatabase)

      const importResult = await importService.importAllData(exportDir, {
        validateChecksums: true,
        conflictStrategy: 'merge', // 使用合并策略处理冲突
        includeCategories,
        dryRun: false
      })

      logger.info(`📥 数据导入完成: ${importResult.totalRecords} 条记录`)

      return {
        status: 'success',
        exportResult,
        importResult,
        totalRecords: importResult.totalRecords
      }
    } catch (error) {
      logger.error('❌ 导出-导入迁移失败:', error)
      throw error
    }
  }

  /**
   * 验证迁移结果
   * @returns {Promise<Object>} 验证结果
   */
  async verifyMigration() {
    logger.info('✅ 验证迁移结果...')

    try {
      const verification = {
        apiKeysMatch: false,
        accountsMatch: false,
        issues: []
      }

      // 验证API Keys数量
      try {
        const sourceApiKeys = await this.currentDatabase.getAllApiKeys()
        const targetApiKeys = await this.targetDatabase.getAllApiKeys()

        verification.apiKeysMatch = sourceApiKeys.length === targetApiKeys.length
        logger.info(`📋 API Keys: 源 ${sourceApiKeys.length}, 目标 ${targetApiKeys.length}`)

        if (!verification.apiKeysMatch) {
          verification.issues.push(
            `API Keys数量不匹配: 源 ${sourceApiKeys.length}, 目标 ${targetApiKeys.length}`
          )
        }
      } catch (error) {
        verification.issues.push(`API Keys验证失败: ${error.message}`)
      }

      // 验证Claude账户数量
      try {
        const sourceClaude = await this.currentDatabase.getAllClaudeAccounts()
        const targetClaude = await this.targetDatabase.getAllClaudeAccounts()

        verification.accountsMatch = sourceClaude.length === targetClaude.length
        logger.info(`👤 Claude账户: 源 ${sourceClaude.length}, 目标 ${targetClaude.length}`)

        if (!verification.accountsMatch) {
          verification.issues.push(
            `Claude账户数量不匹配: 源 ${sourceClaude.length}, 目标 ${targetClaude.length}`
          )
        }
      } catch (error) {
        verification.issues.push(`Claude账户验证失败: ${error.message}`)
      }

      const isSuccessful =
        verification.apiKeysMatch && verification.accountsMatch && verification.issues.length === 0

      if (isSuccessful) {
        logger.info('✅ 迁移验证通过')
      } else {
        logger.warn(`⚠️  迁移验证发现 ${verification.issues.length} 个问题`)
      }

      return { status: isSuccessful ? 'success' : 'warning', ...verification }
    } catch (error) {
      logger.error('❌ 迁移验证失败:', error)
      throw error
    }
  }

  /**
   * 清理迁移过程中的临时数据
   * @returns {Promise<Object>} 清理结果
   */
  async cleanupMigration() {
    logger.info('🧹 清理迁移临时数据...')

    try {
      // 关闭数据库连接
      if (this.currentDatabase) {
        await this.currentDatabase.disconnect()
      }
      if (this.targetDatabase) {
        await this.targetDatabase.disconnect()
      }

      logger.info('✅ 迁移清理完成')
      return { status: 'success' }
    } catch (error) {
      logger.error('❌ 迁移清理失败:', error)
      return { status: 'warning', error: error.message }
    }
  }

  /**
   * 回滚迁移（从备份恢复）
   * @param {Object} migrationStats 迁移统计信息
   * @returns {Promise<void>}
   */
  async rollbackMigration() {
    logger.info('🔄 开始迁移回滚...')

    try {
      const backupDir = path.join(this.migrationDir, 'target-backup')

      // 检查是否存在备份
      try {
        await fs.access(backupDir)
      } catch (error) {
        logger.warn('⚠️  未找到备份数据，无法回滚')
        return
      }

      // 从备份恢复目标数据库
      const importService = new DataImportService(this.targetDatabase)
      await importService.importAllData(backupDir, {
        validateChecksums: false,
        conflictStrategy: 'overwrite'
      })

      logger.info('✅ 迁移回滚完成')
    } catch (error) {
      logger.error('❌ 迁移回滚失败:', error)
      throw error
    }
  }

  /**
   * 生成迁移报告
   * @param {Object} migrationStats 迁移统计信息
   * @returns {Promise<string>} 报告文件路径
   */
  async generateMigrationReport(migrationStats) {
    logger.info('📊 生成迁移报告...')

    try {
      const reportPath = path.join(this.migrationDir, 'migration-report.json')
      const report = {
        ...migrationStats,
        generatedAt: new Date().toISOString(),
        success: migrationStats.errors.length === 0,
        summary: {
          duration: migrationStats.endTime
            ? new Date(migrationStats.endTime).getTime() -
              new Date(migrationStats.startTime).getTime()
            : null,
          totalRecords: migrationStats.totalRecords,
          errorCount: migrationStats.errors.length
        }
      }

      await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')
      logger.info(`📊 迁移报告已生成: ${reportPath}`)

      return reportPath
    } catch (error) {
      logger.error('❌ 生成迁移报告失败:', error)
      throw error
    }
  }
}

module.exports = DataMigrationService
