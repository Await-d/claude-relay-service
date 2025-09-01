#!/usr/bin/env node

/**
 * @fileoverview 增强日志系统数据迁移脚本
 *
 * 此脚本用于处理增强日志系统的数据迁移和兼容性检查
 * 确保现有系统可以平滑升级到增强日志功能
 *
 * @author Claude Code
 * @version 1.0.0
 */

const path = require('path')
const fs = require('fs')

// 添加项目根目录到模块搜索路径
const projectRoot = path.resolve(__dirname, '..')
process.chdir(projectRoot)

// 引入必要的模块
const logger = require('../src/utils/logger')
const database = require('../src/models/database')
const { enhancedLogService } = require('../src/services/EnhancedLogService')
const { requestLoggingIntegration } = require('../src/services/RequestLoggingIntegration')

/**
 * 数据迁移管理器
 */
class EnhancedLoggingMigration {
  constructor() {
    this.migrationStats = {
      startTime: null,
      endTime: null,
      totalLogEntries: 0,
      migratedEntries: 0,
      skippedEntries: 0,
      errorEntries: 0,
      backupCreated: false,
      validationPassed: false
    }

    this.config = {
      batchSize: 100,
      backupEnabled: true,
      dryRun: false,
      validateAfterMigration: true
    }
  }

  /**
   * 执行完整的迁移流程
   */
  async runMigration(options = {}) {
    this.config = { ...this.config, ...options }
    this.migrationStats.startTime = new Date()

    try {
      logger.info('🚀 Starting Enhanced Logging System Migration')
      logger.info(`📋 Configuration:`, this.config)

      // 1. 环境检查
      await this.checkEnvironment()

      // 2. 数据库连接检查
      await this.checkDatabaseConnection()

      // 3. 创建备份（如果启用）
      if (this.config.backupEnabled) {
        await this.createBackup()
      }

      // 4. 检查现有日志结构
      await this.analyzeExistingLogs()

      // 5. 执行配置迁移
      await this.migrateConfiguration()

      // 6. 验证新系统功能
      if (this.config.validateAfterMigration) {
        await this.validateEnhancedLogging()
      }

      // 7. 生成迁移报告
      await this.generateMigrationReport()

      this.migrationStats.endTime = new Date()
      logger.info('✅ Enhanced Logging System Migration Completed Successfully')

      return {
        success: true,
        stats: this.migrationStats,
        duration: this.migrationStats.endTime - this.migrationStats.startTime
      }
    } catch (error) {
      this.migrationStats.endTime = new Date()
      logger.error('❌ Migration failed:', error)

      return {
        success: false,
        error: error.message,
        stats: this.migrationStats
      }
    }
  }

  /**
   * 检查运行环境
   */
  async checkEnvironment() {
    logger.info('🔍 Checking environment compatibility...')

    // 检查Node.js版本
    const nodeVersion = process.version
    logger.info(`📍 Node.js version: ${nodeVersion}`)

    // 检查必要的模块是否存在
    const requiredModules = [
      '../src/services/EnhancedLogService',
      '../src/services/HeadersFilterService',
      '../src/services/RequestLoggingIntegration'
    ]

    for (const module of requiredModules) {
      try {
        require(module)
        logger.info(`✅ Module ${module} loaded successfully`)
      } catch (error) {
        throw new Error(`❌ Required module ${module} not found: ${error.message}`)
      }
    }

    // 检查配置文件
    const configPath = path.join(projectRoot, 'config', 'config.js')
    if (!fs.existsSync(configPath)) {
      throw new Error(`❌ Configuration file not found: ${configPath}`)
    }

    logger.info('✅ Environment check completed')
  }

  /**
   * 检查数据库连接
   */
  async checkDatabaseConnection() {
    logger.info('🔍 Checking database connection...')

    try {
      const client = database.getClient()
      if (!client) {
        throw new Error('Database client not available')
      }

      // 测试Redis连接
      await client.ping()
      logger.info('✅ Database connection successful')

      // 检查现有数据结构
      const sampleKeys = await client.keys('request_log:*')
      this.migrationStats.totalLogEntries = sampleKeys.length
      logger.info(`📊 Found ${this.migrationStats.totalLogEntries} existing log entries`)
    } catch (error) {
      throw new Error(`❌ Database connection failed: ${error.message}`)
    }
  }

  /**
   * 创建数据备份
   */
  async createBackup() {
    if (this.config.dryRun) {
      logger.info('🔄 Dry run mode: Skipping backup creation')
      return
    }

    logger.info('💾 Creating data backup...')

    try {
      const backupDir = path.join(projectRoot, 'backups')
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true })
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const backupFile = path.join(backupDir, `enhanced-logging-migration-${timestamp}.json`)

      const client = database.getClient()

      // 备份请求日志相关的键
      const logKeys = await client.keys('request_log*')
      const configKeys = await client.keys('*config*')
      const allKeys = [...logKeys, ...configKeys]

      const backupData = {}
      for (const key of allKeys.slice(0, 1000)) {
        // 限制备份大小
        const type = await client.type(key)
        if (type === 'hash') {
          backupData[key] = await client.hgetall(key)
        } else if (type === 'string') {
          backupData[key] = await client.get(key)
        } else if (type === 'set') {
          backupData[key] = await client.smembers(key)
        }
      }

      fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2))
      this.migrationStats.backupCreated = true

      logger.info(`✅ Backup created: ${backupFile}`)
      logger.info(`📊 Backed up ${allKeys.length} keys`)
    } catch (error) {
      logger.warn(`⚠️ Backup creation failed: ${error.message}`)
      // 备份失败不应该阻止迁移
    }
  }

  /**
   * 分析现有日志结构
   */
  async analyzeExistingLogs() {
    logger.info('📊 Analyzing existing log structure...')

    try {
      const client = database.getClient()
      const sampleKeys = await client.keys('request_log:*')

      if (sampleKeys.length === 0) {
        logger.info('📝 No existing logs found - fresh installation')
        return
      }

      // 分析样本日志的结构
      const sampleKey = sampleKeys[0]
      const sampleLog = await client.hgetall(sampleKey)

      logger.info('📋 Sample log structure:', Object.keys(sampleLog))

      // 检查是否已经有增强字段
      const enhancedFields = ['requestHeaders', 'responseHeaders', 'tokenDetails', 'costDetails']
      const existingEnhancedFields = enhancedFields.filter((field) =>
        Object.prototype.hasOwnProperty.call(sampleLog, field)
      )

      if (existingEnhancedFields.length > 0) {
        logger.info(`✅ Found existing enhanced fields: ${existingEnhancedFields.join(', ')}`)
        logger.info('🔄 System appears to be partially or fully migrated')
      } else {
        logger.info('📝 No enhanced fields found - standard log format')
      }
    } catch (error) {
      logger.warn(`⚠️ Log analysis failed: ${error.message}`)
    }
  }

  /**
   * 迁移配置
   */
  async migrateConfiguration() {
    logger.info('⚙️ Migrating system configuration...')

    try {
      // 启用增强日志服务
      enhancedLogService.enable()
      logger.info('✅ Enhanced log service enabled')

      // 配置请求日志集成
      requestLoggingIntegration.setEnabled(true)
      requestLoggingIntegration.setSamplingRate(1.0) // 100%采样率

      logger.info('✅ Request logging integration configured')

      // 设置合理的默认配置
      const defaultConfig = {
        enableHeadersCapture: true,
        enableTokenDetails: true,
        enableCostDetails: true,
        asyncLogging: true,
        maxLogSize: 500000
      }

      requestLoggingIntegration.updateConfig(defaultConfig)
      logger.info('✅ Default configuration applied:', defaultConfig)
    } catch (error) {
      throw new Error(`❌ Configuration migration failed: ${error.message}`)
    }
  }

  /**
   * 验证增强日志功能
   */
  async validateEnhancedLogging() {
    logger.info('🔍 Validating enhanced logging functionality...')

    try {
      // 1. 测试HeadersFilterService
      const HeadersFilterService = require('../src/services/HeadersFilterService')
      const headersFilter = new HeadersFilterService()

      const testHeaders = {
        'user-agent': 'test-agent',
        authorization: 'Bearer secret-token', // 应该被过滤
        'content-type': 'application/json'
      }

      const filteredHeaders = headersFilter.filterRequestHeaders(testHeaders)

      if (filteredHeaders['authorization']) {
        throw new Error('Headers filtering failed - sensitive data not filtered')
      }

      if (!filteredHeaders['user-agent']) {
        throw new Error('Headers filtering failed - safe headers were removed')
      }

      logger.info('✅ Headers filtering validation passed')

      // 2. 测试EnhancedLogService
      const testLogData = {
        keyId: 'test-key',
        method: 'POST',
        path: '/api/v1/messages',
        status: 200,
        model: 'claude-3-sonnet',
        tokens: 100,
        responseTime: 1500
      }

      const testTokenDetails = {
        totalTokens: 100,
        inputTokens: 80,
        outputTokens: 20,
        model: 'claude-3-sonnet'
      }

      const logId = await enhancedLogService.logRequestWithDetails(
        testLogData,
        { 'user-agent': 'test' },
        { 'content-type': 'text/event-stream' },
        testTokenDetails,
        { totalCost: 0.01 }
      )

      if (!logId) {
        throw new Error('Enhanced log service test failed - no log ID returned')
      }

      logger.info(`✅ Enhanced log service validation passed - Log ID: ${logId}`)

      // 3. 验证日志读取
      const verification = await enhancedLogService.validateLogData(logId)
      if (!verification.isValid) {
        throw new Error('Log validation failed - data integrity issue')
      }

      logger.info('✅ Log data validation passed')
      this.migrationStats.validationPassed = true
    } catch (error) {
      throw new Error(`❌ Enhanced logging validation failed: ${error.message}`)
    }
  }

  /**
   * 生成迁移报告
   */
  async generateMigrationReport() {
    logger.info('📊 Generating migration report...')

    const report = {
      migrationInfo: {
        timestamp: new Date().toISOString(),
        version: '2.1.0',
        duration: this.migrationStats.endTime - this.migrationStats.startTime
      },
      statistics: this.migrationStats,
      systemStatus: {
        enhancedLogServiceEnabled: enhancedLogService.getStats().isEnabled,
        requestLoggingIntegrationEnabled: requestLoggingIntegration.getStats().isEnabled,
        headersFilteringActive: true
      },
      configuration: {
        ...this.config,
        ...requestLoggingIntegration.getStats().config
      },
      recommendations: this.generateRecommendations()
    }

    // 保存报告到文件
    const reportsDir = path.join(projectRoot, 'reports')
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true })
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const reportFile = path.join(reportsDir, `enhanced-logging-migration-report-${timestamp}.json`)

    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2))

    logger.info(`📋 Migration report saved: ${reportFile}`)
    logger.info('📊 Migration Summary:')
    logger.info(`   - Total duration: ${report.migrationInfo.duration}ms`)
    logger.info(`   - Validation passed: ${this.migrationStats.validationPassed ? '✅' : '❌'}`)
    logger.info(`   - Backup created: ${this.migrationStats.backupCreated ? '✅' : '❌'}`)

    return report
  }

  /**
   * 生成建议
   */
  generateRecommendations() {
    const recommendations = []

    if (this.migrationStats.totalLogEntries > 100000) {
      recommendations.push('Consider setting up log rotation for large log volumes')
    }

    if (!this.migrationStats.backupCreated) {
      recommendations.push('Create manual backup before production deployment')
    }

    recommendations.push('Monitor system performance after deployment')
    recommendations.push('Adjust sampling rate based on system load')
    recommendations.push('Review headers filtering whitelist for your specific use case')

    return recommendations
  }
}

/**
 * 主函数 - 处理命令行参数并执行迁移
 */
async function main() {
  const args = process.argv.slice(2)
  const options = {}

  // 解析命令行参数
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--dry-run':
        options.dryRun = true
        break
      case '--no-backup':
        options.backupEnabled = false
        break
      case '--no-validation':
        options.validateAfterMigration = false
        break
      case '--batch-size':
        options.batchSize = parseInt(args[++i]) || 100
        break
      case '--help':
        console.log(`
Enhanced Logging Migration Script

Usage: node enhanced-logging-migration.js [options]

Options:
  --dry-run              Run migration checks without making changes
  --no-backup           Skip creating backup (not recommended)
  --no-validation       Skip post-migration validation
  --batch-size <n>      Set batch size for processing (default: 100)
  --help                Show this help message

Examples:
  node enhanced-logging-migration.js                    # Full migration
  node enhanced-logging-migration.js --dry-run          # Check only
  node enhanced-logging-migration.js --no-backup        # Skip backup
        `)
        process.exit(0)
        break
    }
  }

  try {
    const migration = new EnhancedLoggingMigration()
    const result = await migration.runMigration(options)

    if (result.success) {
      console.log('\n🎉 Migration completed successfully!')
      console.log(`⏱️ Duration: ${result.duration}ms`)
      process.exit(0)
    } else {
      console.error('\n💥 Migration failed!')
      console.error(`❌ Error: ${result.error}`)
      process.exit(1)
    }
  } catch (error) {
    console.error('\n💥 Unexpected error during migration:')
    console.error(error)
    process.exit(1)
  }
}

// 如果直接运行此脚本，执行主函数
if (require.main === module) {
  main().catch(console.error)
}

module.exports = {
  EnhancedLoggingMigration
}
