#!/usr/bin/env node

/**
 * @fileoverview 用户管理系统数据迁移脚本
 *
 * 此脚本用于将现有系统从纯API Key认证迁移到用户管理系统
 * 确保现有生产环境可以零中断升级到新的用户管理功能
 *
 * @author Claude Code
 * @version 1.0.0
 */

const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const chalk = require('chalk')
const ora = require('ora')
const inquirer = require('inquirer')

// 添加项目根目录到模块搜索路径
const projectRoot = path.resolve(__dirname, '..')
process.chdir(projectRoot)

// 引入必要的模块
const logger = require('../src/utils/logger')
const database = require('../src/models/database')
const config = require('../config/config')

/**
 * 用户管理系统数据迁移管理器
 */
class UserManagementMigration {
  constructor() {
    this.migrationStats = {
      startTime: null,
      endTime: null,
      totalApiKeys: 0,
      migratedApiKeys: 0,
      createdUsers: 0,
      backupCreated: false,
      rollbackDataCreated: false,
      validationPassed: false,
      migrationVersion: '1.0.0'
    }

    this.config = {
      dryRun: false,
      force: false,
      skipBackup: false,
      skipValidation: false,
      batchSize: 50,
      autoCreateDefaultUser: true,
      preserveExistingData: true,
      enableRollback: true
    }

    this.rollbackData = {
      originalApiKeys: new Map(),
      originalUsers: new Map(),
      operations: []
    }

    // 迁移进度跟踪
    this.progress = {
      currentStep: 0,
      totalSteps: 8,
      spinner: null
    }
  }

  /**
   * 执行完整的迁移流程
   */
  async runMigration(options = {}) {
    this.config = { ...this.config, ...options }
    this.migrationStats.startTime = new Date()

    try {
      console.log(chalk.blue.bold('\n🚀 用户管理系统数据迁移工具'))
      console.log(chalk.gray('从纯API Key认证系统迁移到用户管理系统\n'))

      // 显示配置信息
      if (this.config.dryRun) {
        console.log(chalk.yellow('🔍 运行模式: 试运行 (不会修改数据)'))
      } else {
        console.log(chalk.green('🔄 运行模式: 实际迁移'))
      }

      // 确认迁移操作
      if (!this.config.force && !this.config.dryRun) {
        const confirmation = await this.confirmMigration()
        if (!confirmation) {
          console.log(chalk.yellow('❌ 迁移已取消'))
          return { success: false, cancelled: true }
        }
      }

      // 执行迁移步骤
      await this.updateProgress(1, '环境检查')
      await this.checkEnvironment()

      await this.updateProgress(2, '数据库连接检查')
      await this.checkDatabaseConnection()

      await this.updateProgress(3, '现有数据分析')
      await this.analyzeExistingData()

      if (!this.config.skipBackup && !this.config.dryRun) {
        await this.updateProgress(4, '创建数据备份')
        await this.createBackup()
      }

      await this.updateProgress(5, '用户数据结构创建')
      await this.createUserDataStructure()

      await this.updateProgress(6, 'API Key数据迁移')
      await this.migrateApiKeysToUsers()

      if (!this.config.skipValidation) {
        await this.updateProgress(7, '数据验证')
        await this.validateMigration()
      }

      await this.updateProgress(8, '生成迁移报告')
      const report = await this.generateMigrationReport()

      this.migrationStats.endTime = new Date()

      if (this.progress.spinner) {
        this.progress.spinner.succeed('迁移完成！')
      }

      console.log(chalk.green.bold('\n✅ 用户管理系统迁移成功完成！'))
      console.log(
        chalk.cyan(`⏱️  总耗时: ${this.migrationStats.endTime - this.migrationStats.startTime}ms`)
      )

      return {
        success: true,
        stats: this.migrationStats,
        report,
        rollbackData: this.rollbackData
      }
    } catch (error) {
      this.migrationStats.endTime = new Date()

      if (this.progress.spinner) {
        this.progress.spinner.fail(`迁移失败: ${error.message}`)
      }

      console.error(chalk.red.bold('\n💥 迁移失败！'))
      console.error(chalk.red(`❌ 错误: ${error.message}`))

      // 如果不是试运行模式，提供回滚选项
      if (!this.config.dryRun && this.rollbackData.operations.length > 0) {
        console.log(chalk.yellow('\n🔄 检测到部分操作已执行，建议回滚'))
        const shouldRollback = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'rollback',
            message: '是否立即执行回滚操作？',
            default: true
          }
        ])

        if (shouldRollback.rollback) {
          await this.executeRollback()
        }
      }

      return {
        success: false,
        error: error.message,
        stats: this.migrationStats,
        rollbackAvailable: this.rollbackData.operations.length > 0
      }
    }
  }

  /**
   * 更新进度显示
   */
  async updateProgress(step, message) {
    this.progress.currentStep = step

    if (this.progress.spinner) {
      this.progress.spinner.stop()
    }

    const progressText = `[${step}/${this.progress.totalSteps}] ${message}`
    this.progress.spinner = ora(progressText).start()
  }

  /**
   * 确认迁移操作
   */
  async confirmMigration() {
    console.log(chalk.yellow('\n⚠️  重要提示:'))
    console.log('1. 此操作将修改数据库结构，添加用户管理功能')
    console.log('2. 现有API Key将迁移到默认用户账户下')
    console.log('3. 建议在低峰时段执行迁移操作')
    console.log('4. 迁移前已创建数据备份\n')

    const answers = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'proceed',
        message: '确认执行用户管理系统迁移？',
        default: false
      }
    ])

    return answers.proceed
  }

  /**
   * 检查运行环境
   */
  async checkEnvironment() {
    logger.info('🔍 检查迁移环境兼容性...')

    // 检查Node.js版本
    const nodeVersion = process.version
    const majorVersion = parseInt(nodeVersion.split('.')[0].substring(1))
    if (majorVersion < 14) {
      throw new Error(`Node.js版本过低: ${nodeVersion}，需要14.x或更高版本`)
    }

    // 检查配置文件
    const configPath = path.join(projectRoot, 'config', 'config.js')
    if (!fs.existsSync(configPath)) {
      throw new Error(`配置文件不存在: ${configPath}`)
    }

    // 检查必要的目录
    const requiredDirs = ['logs', 'data']
    for (const dir of requiredDirs) {
      const dirPath = path.join(projectRoot, dir)
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true })
        logger.info(`✅ 创建目录: ${dir}`)
      }
    }

    // 检查加密密钥
    if (!config.security.encryptionKey || config.security.encryptionKey.length < 32) {
      throw new Error('ENCRYPTION_KEY配置无效，需要32字符的加密密钥')
    }

    // 检查JWT密钥
    if (
      !config.security.jwtSecret ||
      config.security.jwtSecret === 'CHANGE-THIS-JWT-SECRET-IN-PRODUCTION'
    ) {
      throw new Error('JWT_SECRET配置无效，请设置安全的JWT密钥')
    }

    logger.info('✅ 环境检查通过')
  }

  /**
   * 检查数据库连接
   */
  async checkDatabaseConnection() {
    logger.info('🔍 检查数据库连接状态...')

    try {
      const client = database.getClient()
      if (!client) {
        throw new Error('数据库客户端未初始化')
      }

      // 测试Redis连接
      await client.ping()
      logger.info('✅ 数据库连接正常')

      // 检查数据库权限
      await client.set('migration_test_key', 'test_value', 'EX', 60)
      const testValue = await client.get('migration_test_key')
      if (testValue !== 'test_value') {
        throw new Error('数据库读写权限检查失败')
      }
      await client.del('migration_test_key')

      logger.info('✅ 数据库权限检查通过')
    } catch (error) {
      throw new Error(`数据库连接失败: ${error.message}`)
    }
  }

  /**
   * 分析现有数据
   */
  async analyzeExistingData() {
    logger.info('📊 分析现有系统数据...')

    try {
      const client = database.getClient()

      // 检查现有API Key
      const apiKeyPattern = 'api_key:*'
      const apiKeyKeys = await client.keys(apiKeyPattern)
      this.migrationStats.totalApiKeys = apiKeyKeys.length

      logger.info(`📊 发现 ${this.migrationStats.totalApiKeys} 个API Key`)

      // 检查是否已存在用户数据
      const userKeys = await client.keys('user:*')
      if (userKeys.length > 0) {
        logger.warn(`⚠️ 检测到 ${userKeys.length} 个现有用户记录`)

        if (!this.config.force) {
          throw new Error('系统已包含用户数据，请使用 --force 参数强制执行迁移')
        }
      }

      // 检查管理员数据
      const adminKeys = await client.keys('admin:*')
      logger.info(`📊 发现 ${adminKeys.length} 个管理员账户`)

      // 分析数据大小
      const allKeys = await client.keys('*')
      logger.info(`📊 数据库总key数量: ${allKeys.length}`)

      // 样本数据分析
      if (apiKeyKeys.length > 0) {
        const sampleKey = apiKeyKeys[0]
        const sampleData = await client.hgetall(sampleKey)
        logger.info('📋 API Key样本结构:', Object.keys(sampleData))
      }

      logger.info('✅ 数据分析完成')
    } catch (error) {
      throw new Error(`数据分析失败: ${error.message}`)
    }
  }

  /**
   * 创建数据备份
   */
  async createBackup() {
    logger.info('💾 创建迁移前数据备份...')

    try {
      const backupDir = path.join(projectRoot, 'backups', 'user-management-migration')
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true })
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const backupFile = path.join(backupDir, `pre-migration-backup-${timestamp}.json`)
      const rollbackFile = path.join(backupDir, `rollback-data-${timestamp}.json`)

      const client = database.getClient()
      const backupData = {
        timestamp,
        migrationVersion: this.migrationStats.migrationVersion,
        systemInfo: {
          nodeVersion: process.version,
          platform: process.platform,
          config: {
            server: config.server,
            database: { type: config.database?.type || 'redis' }
          }
        },
        data: {}
      }

      // 备份所有相关数据
      const patterns = [
        'api_key:*',
        'api_key_hash:*',
        'admin:*',
        'admin_username:*',
        'session:*',
        'system_info',
        'usage:*'
      ]

      for (const pattern of patterns) {
        const keys = await client.keys(pattern)
        logger.info(`💾 备份 ${keys.length} 个 ${pattern} 相关记录`)

        for (const key of keys) {
          const type = await client.type(key)

          if (type === 'hash') {
            backupData.data[key] = {
              type: 'hash',
              data: await client.hgetall(key),
              ttl: await client.ttl(key)
            }
          } else if (type === 'string') {
            backupData.data[key] = {
              type: 'string',
              data: await client.get(key),
              ttl: await client.ttl(key)
            }
          } else if (type === 'set') {
            backupData.data[key] = {
              type: 'set',
              data: await client.smembers(key),
              ttl: await client.ttl(key)
            }
          } else if (type === 'list') {
            backupData.data[key] = {
              type: 'list',
              data: await client.lrange(key, 0, -1),
              ttl: await client.ttl(key)
            }
          } else if (type === 'zset') {
            backupData.data[key] = {
              type: 'zset',
              data: await client.zrange(key, 0, -1, 'WITHSCORES'),
              ttl: await client.ttl(key)
            }
          }
        }
      }

      // 保存备份文件
      fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2))
      this.migrationStats.backupCreated = true

      // 创建回滚数据文件
      fs.writeFileSync(
        rollbackFile,
        JSON.stringify(
          {
            timestamp,
            backupFile,
            rollbackInstructions: this.generateRollbackInstructions()
          },
          null,
          2
        )
      )

      this.migrationStats.rollbackDataCreated = true

      logger.info(`✅ 备份完成: ${backupFile}`)
      logger.info(`🔄 回滚数据: ${rollbackFile}`)
      logger.info(`📊 备份了 ${Object.keys(backupData.data).length} 个数据项`)

      // 存储备份信息供回滚使用
      this.rollbackData.backupFile = backupFile
      this.rollbackData.rollbackFile = rollbackFile
    } catch (error) {
      throw new Error(`创建备份失败: ${error.message}`)
    }
  }

  /**
   * 创建用户数据结构
   */
  async createUserDataStructure() {
    logger.info('🏗️ 创建用户管理数据结构...')

    if (this.config.dryRun) {
      logger.info('🔍 试运行模式: 跳过实际数据结构创建')
      return
    }

    try {
      const client = database.getClient()

      // 创建默认用户（如果不存在）
      const defaultUserId = 'user_default_migration'
      const defaultUserKey = `user:${defaultUserId}`

      const existingUser = await client.exists(defaultUserKey)
      if (!existingUser && this.config.autoCreateDefaultUser) {
        const defaultUserData = {
          id: defaultUserId,
          username: 'default_user',
          email: 'migration@system.local',
          displayName: '默认用户 (迁移创建)',
          role: 'user',
          status: 'active',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          migrated: 'true',
          migrationVersion: this.migrationStats.migrationVersion,
          // 用户配置
          settings: JSON.stringify({
            theme: 'auto',
            language: 'zh-CN',
            timezone: 'Asia/Shanghai'
          }),
          // 使用限额
          limits: JSON.stringify({
            dailyRequests: 10000,
            monthlyRequests: 300000,
            maxTokensPerRequest: 200000
          }),
          // 统计数据
          stats: JSON.stringify({
            totalRequests: 0,
            totalTokens: 0,
            totalCost: 0
          })
        }

        await client.hset(defaultUserKey, defaultUserData)

        // 创建用户名映射
        await client.set(`user_username:${defaultUserData.username}`, defaultUserId)

        // 创建邮箱映射
        await client.set(`user_email:${defaultUserData.email}`, defaultUserId)

        this.migrationStats.createdUsers++
        this.rollbackData.operations.push({
          type: 'create_user',
          userId: defaultUserId,
          timestamp: new Date().toISOString()
        })

        logger.info(`✅ 创建默认用户: ${defaultUserData.username}`)
      }

      // 创建用户管理相关的索引和配置
      if (!this.config.dryRun) {
        // 用户计数器
        const userCountKey = 'user_count'
        if (!(await client.exists(userCountKey))) {
          await client.set(userCountKey, this.migrationStats.createdUsers)
        }

        // 系统配置更新
        const systemConfigKey = 'system_config'
        await client.hset(systemConfigKey, {
          user_management_enabled: 'true',
          migration_completed: new Date().toISOString(),
          migration_version: this.migrationStats.migrationVersion
        })

        this.rollbackData.operations.push({
          type: 'update_system_config',
          key: systemConfigKey,
          timestamp: new Date().toISOString()
        })
      }

      logger.info('✅ 用户数据结构创建完成')
    } catch (error) {
      throw new Error(`创建用户数据结构失败: ${error.message}`)
    }
  }

  /**
   * 迁移API Key到用户系统
   */
  async migrateApiKeysToUsers() {
    logger.info('🔄 开始API Key到用户系统迁移...')

    if (this.config.dryRun) {
      logger.info('🔍 试运行模式: 模拟API Key迁移过程')
    }

    try {
      const client = database.getClient()
      const apiKeyPattern = 'api_key:*'
      const apiKeyKeys = await client.keys(apiKeyPattern)

      const defaultUserId = 'user_default_migration'
      let batchCount = 0

      for (const apiKeyKey of apiKeyKeys) {
        const apiKeyData = await client.hgetall(apiKeyKey)

        if (!apiKeyData || !apiKeyData.id) {
          logger.warn(`⚠️ 跳过无效API Key: ${apiKeyKey}`)
          continue
        }

        // 保存原始数据用于回滚
        this.rollbackData.originalApiKeys.set(apiKeyKey, { ...apiKeyData })

        if (!this.config.dryRun) {
          // 更新API Key数据，添加用户关联
          const updatedApiKeyData = {
            ...apiKeyData,
            userId: defaultUserId,
            migratedAt: new Date().toISOString(),
            migrationVersion: this.migrationStats.migrationVersion
          }

          await client.hset(apiKeyKey, updatedApiKeyData)

          // 创建用户-API Key关联索引
          const userApiKeysKey = `user_api_keys:${defaultUserId}`
          await client.sadd(userApiKeysKey, apiKeyData.id)

          this.rollbackData.operations.push({
            type: 'migrate_api_key',
            apiKeyId: apiKeyData.id,
            originalKey: apiKeyKey,
            userId: defaultUserId,
            timestamp: new Date().toISOString()
          })
        }

        this.migrationStats.migratedApiKeys++
        batchCount++

        // 批量处理进度报告
        if (batchCount >= this.config.batchSize) {
          logger.info(
            `📊 已迁移 ${this.migrationStats.migratedApiKeys}/${this.migrationStats.totalApiKeys} 个API Key`
          )
          batchCount = 0
        }
      }

      logger.info(
        `✅ API Key迁移完成: ${this.migrationStats.migratedApiKeys}/${this.migrationStats.totalApiKeys}`
      )
    } catch (error) {
      throw new Error(`API Key迁移失败: ${error.message}`)
    }
  }

  /**
   * 验证迁移结果
   */
  async validateMigration() {
    logger.info('🔍 验证迁移结果...')

    try {
      const client = database.getClient()
      const validationErrors = []

      // 1. 验证用户数据完整性
      const defaultUserId = 'user_default_migration'
      const defaultUserKey = `user:${defaultUserId}`
      const userData = await client.hgetall(defaultUserKey)

      if (!userData.id) {
        validationErrors.push('默认用户数据不完整')
      }

      // 2. 验证API Key迁移
      const apiKeyPattern = 'api_key:*'
      const apiKeyKeys = await client.keys(apiKeyPattern)
      let migratedKeyCount = 0

      for (const apiKeyKey of apiKeyKeys) {
        const apiKeyData = await client.hgetall(apiKeyKey)
        if (apiKeyData.userId === defaultUserId && apiKeyData.migratedAt) {
          migratedKeyCount++
        }
      }

      if (migratedKeyCount !== this.migrationStats.migratedApiKeys) {
        validationErrors.push(
          `API Key迁移数量不匹配: 预期 ${this.migrationStats.migratedApiKeys}, 实际 ${migratedKeyCount}`
        )
      }

      // 3. 验证索引完整性
      const userApiKeysKey = `user_api_keys:${defaultUserId}`
      const userApiKeys = await client.smembers(userApiKeysKey)

      if (userApiKeys.length !== this.migrationStats.migratedApiKeys) {
        validationErrors.push(
          `用户API Key索引不匹配: 预期 ${this.migrationStats.migratedApiKeys}, 实际 ${userApiKeys.length}`
        )
      }

      // 4. 验证系统配置
      const systemConfig = await client.hgetall('system_config')
      if (systemConfig.user_management_enabled !== 'true') {
        validationErrors.push('系统配置未正确更新')
      }

      if (validationErrors.length > 0) {
        throw new Error(`验证失败:\n${validationErrors.join('\n')}`)
      }

      this.migrationStats.validationPassed = true
      logger.info('✅ 迁移验证通过')
    } catch (error) {
      throw new Error(`迁移验证失败: ${error.message}`)
    }
  }

  /**
   * 生成迁移报告
   */
  async generateMigrationReport() {
    logger.info('📊 生成迁移报告...')

    const duration = this.migrationStats.endTime - this.migrationStats.startTime
    const report = {
      migrationInfo: {
        version: this.migrationStats.migrationVersion,
        timestamp: new Date().toISOString(),
        duration,
        mode: this.config.dryRun ? 'dry-run' : 'actual'
      },
      statistics: {
        ...this.migrationStats,
        successRate:
          this.migrationStats.totalApiKeys > 0
            ? (
                (this.migrationStats.migratedApiKeys / this.migrationStats.totalApiKeys) *
                100
              ).toFixed(2)
            : 100
      },
      systemStatus: {
        userManagementEnabled: true,
        defaultUserCreated: this.migrationStats.createdUsers > 0,
        backupCreated: this.migrationStats.backupCreated,
        rollbackAvailable: this.migrationStats.rollbackDataCreated
      },
      configuration: this.config,
      rollbackInfo: {
        available: this.rollbackData.operations.length > 0,
        operationsCount: this.rollbackData.operations.length,
        backupFile: this.rollbackData.backupFile
      },
      recommendations: this.generateRecommendations(),
      postMigrationSteps: [
        '1. 重启服务以加载新的用户管理功能',
        '2. 访问Web管理界面验证用户管理功能',
        '3. 测试API Key在新系统下的工作状态',
        '4. 监控系统性能和错误日志',
        '5. 根据需要创建其他用户账户'
      ]
    }

    // 保存报告到文件
    const reportsDir = path.join(projectRoot, 'reports')
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true })
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const reportFile = path.join(reportsDir, `user-management-migration-report-${timestamp}.json`)

    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2))

    logger.info(`📋 迁移报告已保存: ${reportFile}`)

    // 显示摘要信息
    console.log(chalk.cyan('\n📊 迁移摘要:'))
    console.log(`   - 总API Key数量: ${this.migrationStats.totalApiKeys}`)
    console.log(`   - 成功迁移: ${this.migrationStats.migratedApiKeys}`)
    console.log(`   - 创建用户: ${this.migrationStats.createdUsers}`)
    console.log(`   - 成功率: ${report.statistics.successRate}%`)
    console.log(`   - 耗时: ${duration}ms`)

    if (this.migrationStats.backupCreated) {
      console.log(chalk.green('   - 数据备份: ✅ 已创建'))
    }

    if (this.migrationStats.rollbackDataCreated) {
      console.log(chalk.green('   - 回滚数据: ✅ 已准备'))
    }

    return report
  }

  /**
   * 生成建议
   */
  generateRecommendations() {
    const recommendations = []

    if (this.migrationStats.totalApiKeys > 100) {
      recommendations.push('考虑为高使用量用户创建独立账户')
    }

    if (!this.migrationStats.backupCreated) {
      recommendations.push('强烈建议在生产环境创建完整数据备份')
    }

    recommendations.push('重启服务后测试API功能完整性')
    recommendations.push('监控用户管理界面的性能表现')
    recommendations.push('根据业务需求配置用户权限和限额')

    if (this.config.dryRun) {
      recommendations.push('试运行验证完成，可以执行实际迁移')
    }

    return recommendations
  }

  /**
   * 生成回滚指令
   */
  generateRollbackInstructions() {
    return {
      description: '用户管理系统迁移回滚指令',
      steps: [
        '1. 停止服务',
        '2. 运行回滚脚本: node scripts/migrate-user-management.js --rollback',
        '3. 验证数据完整性',
        '4. 重启服务'
      ],
      automaticRollback: true,
      manualSteps: [
        '如果自动回滚失败，请手动删除以下key模式:',
        '- user:*',
        '- user_username:*',
        '- user_email:*',
        '- user_api_keys:*',
        '- system_config (恢复user_management_enabled为false)'
      ]
    }
  }

  /**
   * 执行回滚操作
   */
  async executeRollback() {
    console.log(chalk.yellow('\n🔄 开始执行回滚操作...'))

    const rollbackSpinner = ora('执行回滚操作').start()

    try {
      const client = database.getClient()

      // 逆序执行回滚操作
      const operations = [...this.rollbackData.operations].reverse()

      for (const operation of operations) {
        switch (operation.type) {
          case 'create_user':
            await client.del(`user:${operation.userId}`)
            await client.del(`user_username:default_user`)
            await client.del(`user_email:migration@system.local`)
            break

          case 'migrate_api_key':
            // 恢复原始API Key数据
            const originalData = this.rollbackData.originalApiKeys.get(operation.originalKey)
            if (originalData) {
              await client.hset(operation.originalKey, originalData)
            }
            // 删除用户关联
            await client.srem(`user_api_keys:${operation.userId}`, operation.apiKeyId)
            break

          case 'update_system_config':
            await client.hdel(
              'system_config',
              'user_management_enabled',
              'migration_completed',
              'migration_version'
            )
            break
        }
      }

      // 清理用户相关数据
      const userKeys = await client.keys('user:*')
      const userUsernameKeys = await client.keys('user_username:*')
      const userEmailKeys = await client.keys('user_email:*')
      const userApiKeysKeys = await client.keys('user_api_keys:*')

      const allUserKeys = [...userKeys, ...userUsernameKeys, ...userEmailKeys, ...userApiKeysKeys]

      if (allUserKeys.length > 0) {
        await client.del(...allUserKeys)
      }

      await client.del('user_count')

      rollbackSpinner.succeed('回滚操作完成')
      console.log(chalk.green('✅ 系统已成功回滚到迁移前状态'))
      console.log(chalk.yellow('⚠️ 请重启服务以确保配置生效'))
    } catch (error) {
      rollbackSpinner.fail('回滚操作失败')
      console.error(chalk.red(`❌ 回滚失败: ${error.message}`))

      if (this.rollbackData.backupFile) {
        console.log(chalk.yellow(`🔄 建议使用备份文件手动恢复: ${this.rollbackData.backupFile}`))
      }

      throw error
    }
  }

  /**
   * 从备份文件回滚
   */
  async rollbackFromBackup(backupFile) {
    console.log(chalk.yellow(`\n🔄 从备份文件回滚: ${backupFile}`))

    if (!fs.existsSync(backupFile)) {
      throw new Error(`备份文件不存在: ${backupFile}`)
    }

    const rollbackSpinner = ora('从备份恢复数据').start()

    try {
      const backupData = JSON.parse(fs.readFileSync(backupFile, 'utf8'))
      const client = database.getClient()

      // 先清理现有的用户管理相关数据
      const userKeys = await client.keys('user:*')
      const userUsernameKeys = await client.keys('user_username:*')
      const userEmailKeys = await client.keys('user_email:*')
      const userApiKeysKeys = await client.keys('user_api_keys:*')

      const allUserKeys = [...userKeys, ...userUsernameKeys, ...userEmailKeys, ...userApiKeysKeys]

      if (allUserKeys.length > 0) {
        await client.del(...allUserKeys)
      }

      // 恢复备份数据
      for (const [key, value] of Object.entries(backupData.data)) {
        if (value.type === 'hash') {
          await client.hset(key, value.data)
        } else if (value.type === 'string') {
          await client.set(key, value.data)
        } else if (value.type === 'set') {
          await client.sadd(key, ...value.data)
        } else if (value.type === 'list') {
          await client.lpush(key, ...value.data.reverse())
        } else if (value.type === 'zset') {
          const args = []
          for (let i = 0; i < value.data.length; i += 2) {
            args.push(value.data[i + 1], value.data[i]) // score, member
          }
          if (args.length > 0) {
            await client.zadd(key, ...args)
          }
        }

        // 恢复TTL
        if (value.ttl && value.ttl > 0) {
          await client.expire(key, value.ttl)
        }
      }

      rollbackSpinner.succeed('备份恢复完成')
      console.log(chalk.green('✅ 数据已从备份完全恢复'))
      console.log(chalk.yellow('⚠️ 请重启服务以确保配置生效'))
    } catch (error) {
      rollbackSpinner.fail('备份恢复失败')
      throw new Error(`备份恢复失败: ${error.message}`)
    }
  }
}

/**
 * 主函数 - 处理命令行参数并执行迁移
 */
async function main() {
  const args = process.argv.slice(2)
  const options = {}
  let rollbackFile = null

  // 解析命令行参数
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--dry-run':
        options.dryRun = true
        break
      case '--force':
        options.force = true
        break
      case '--skip-backup':
        options.skipBackup = true
        break
      case '--skip-validation':
        options.skipValidation = false
        break
      case '--no-default-user':
        options.autoCreateDefaultUser = false
        break
      case '--batch-size':
        options.batchSize = parseInt(args[++i]) || 50
        break
      case '--rollback':
        if (args[i + 1] && !args[i + 1].startsWith('--')) {
          rollbackFile = args[++i]
        } else {
          // 自动回滚模式
          options.executeRollback = true
        }
        break
      case '--help':
        console.log(
          chalk.blue(`
用户管理系统数据迁移工具

用法: node migrate-user-management.js [选项]

选项:
  --dry-run              试运行模式，不修改数据
  --force                强制执行迁移（即使检测到现有用户数据）
  --skip-backup          跳过备份创建（不推荐）
  --skip-validation      跳过迁移后验证
  --no-default-user      不自动创建默认用户
  --batch-size <n>       批处理大小（默认: 50）
  --rollback [backup]    回滚操作，可指定备份文件
  --help                 显示帮助信息

示例:
  node migrate-user-management.js                    # 完整迁移
  node migrate-user-management.js --dry-run          # 试运行检查
  node migrate-user-management.js --force            # 强制迁移
  node migrate-user-management.js --rollback         # 自动回滚
  node migrate-user-management.js --rollback backup.json  # 从备份回滚

注意事项:
1. 建议先使用 --dry-run 参数测试迁移过程
2. 生产环境迁移前请确保已创建完整备份
3. 迁移过程中请勿重启或停止服务
4. 迁移完成后需要重启服务以加载新功能
        `)
        )
        process.exit(0)
        break
    }
  }

  try {
    const migration = new UserManagementMigration()

    // 处理回滚操作
    if (rollbackFile || options.executeRollback) {
      console.log(chalk.yellow('🔄 执行回滚操作'))

      if (rollbackFile) {
        await migration.rollbackFromBackup(rollbackFile)
      } else {
        console.log(chalk.red('❌ 自动回滚需要在迁移失败时执行'))
        console.log(chalk.yellow('💡 请指定备份文件: --rollback <backup-file>'))
        process.exit(1)
      }
      return
    }

    // 执行迁移
    const result = await migration.runMigration(options)

    if (result.success) {
      console.log(chalk.green.bold('\n🎉 用户管理系统迁移成功！'))

      if (!options.dryRun) {
        console.log(chalk.cyan('\n📋 后续步骤:'))
        console.log('1. 重启服务: npm restart 或 npm run service:restart')
        console.log('2. 访问Web界面验证用户管理功能')
        console.log('3. 测试现有API Key是否正常工作')
        console.log('4. 根据需要创建新的用户账户\n')
      }

      process.exit(0)
    } else if (!result.cancelled) {
      console.error(chalk.red.bold('\n💥 迁移失败！'))
      console.error(chalk.red(`❌ 错误: ${result.error}`))
      process.exit(1)
    }
  } catch (error) {
    console.error(chalk.red.bold('\n💥 迁移过程中发生意外错误:'))
    console.error(chalk.red(error.message))
    console.error(chalk.gray(error.stack))
    process.exit(1)
  }
}

// 如果直接运行此脚本，执行主函数
if (require.main === module) {
  main().catch((error) => {
    console.error(chalk.red('💥 致命错误:'), error)
    process.exit(1)
  })
}

module.exports = {
  UserManagementMigration
}
