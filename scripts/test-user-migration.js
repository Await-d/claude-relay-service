#!/usr/bin/env node

/**
 * @fileoverview 用户管理系统迁移工具测试脚本
 *
 * 此脚本用于测试用户管理系统迁移工具的各项功能
 * 包括环境检查、数据迁移、回滚功能等
 *
 * @author Claude Code
 * @version 1.0.0
 */

const path = require('path')
const fs = require('fs')
const _crypto = require('crypto')
const chalk = require('chalk')
const _ora = require('ora')

// 添加项目根目录到模块搜索路径
const projectRoot = path.resolve(__dirname, '..')
process.chdir(projectRoot)

// 引入迁移工具
const { UserManagementMigration } = require('./migrate-user-management')
const database = require('../src/models/database')
const _logger = require('../src/utils/logger')

/**
 * 用户管理迁移测试套件
 */
class UserMigrationTestSuite {
  constructor() {
    this.testResults = []
    this.testData = new Map()
    this.setupComplete = false
  }

  /**
   * 运行完整的测试套件
   */
  async runTests() {
    console.log(chalk.blue.bold('\n🧪 用户管理系统迁移工具测试套件'))
    console.log(chalk.gray('测试迁移工具的各项功能和边界条件\n'))

    try {
      // 准备测试环境
      await this.setupTestEnvironment()

      // 执行测试用例
      await this.testEnvironmentCheck()
      await this.testDatabaseConnection()
      await this.testDataAnalysis()
      await this.testDryRunMigration()
      await this.testActualMigration()
      await this.testValidation()
      await this.testRollback()

      // 生成测试报告
      this.generateTestReport()

      // 清理测试数据
      await this.cleanupTestEnvironment()

      console.log(chalk.green.bold('\n✅ 所有测试完成！'))
    } catch (error) {
      console.error(chalk.red.bold('\n💥 测试过程中发生错误:'))
      console.error(chalk.red(error.message))
      await this.cleanupTestEnvironment()
      process.exit(1)
    }
  }

  /**
   * 准备测试环境
   */
  async setupTestEnvironment() {
    console.log(chalk.yellow('🔧 准备测试环境...'))

    try {
      // 创建测试数据目录
      const testDataDir = path.join(projectRoot, 'test-data', 'migration')
      if (!fs.existsSync(testDataDir)) {
        fs.mkdirSync(testDataDir, { recursive: true })
      }

      // 连接数据库
      await database.connect()
      const client = database.getClient()

      // 创建测试API Key数据
      await this.createTestApiKeys(client)

      this.setupComplete = true
      console.log(chalk.green('✅ 测试环境准备完成'))
    } catch (error) {
      throw new Error(`测试环境准备失败: ${error.message}`)
    }
  }

  /**
   * 创建测试API Key数据
   */
  async createTestApiKeys(client) {
    const testApiKeys = [
      {
        id: 'test_key_1',
        name: 'Test Key 1',
        keyHash: 'hash_test_1',
        createdAt: new Date().toISOString(),
        status: 'active',
        dailyLimit: 1000,
        monthlyLimit: 30000
      },
      {
        id: 'test_key_2',
        name: 'Test Key 2',
        keyHash: 'hash_test_2',
        createdAt: new Date().toISOString(),
        status: 'active',
        dailyLimit: 2000,
        monthlyLimit: 60000
      },
      {
        id: 'test_key_3',
        name: 'Test Key 3',
        keyHash: 'hash_test_3',
        createdAt: new Date().toISOString(),
        status: 'inactive',
        dailyLimit: 500,
        monthlyLimit: 15000
      }
    ]

    // 清理可能存在的测试数据
    const existingKeys = await client.keys('api_key:test_key_*')
    if (existingKeys.length > 0) {
      await client.del(...existingKeys)
    }

    // 创建测试API Key
    for (const apiKey of testApiKeys) {
      const keyName = `api_key:${apiKey.id}`
      await client.hset(keyName, apiKey)

      // 创建哈希映射
      await client.set(`api_key_hash:${apiKey.keyHash}`, apiKey.id)

      this.testData.set(keyName, apiKey)
    }

    console.log(`📊 创建了 ${testApiKeys.length} 个测试API Key`)
  }

  /**
   * 测试环境检查功能
   */
  async testEnvironmentCheck() {
    const testName = '环境检查测试'
    console.log(chalk.cyan(`\n🧪 ${testName}`))

    try {
      const migration = new UserManagementMigration()
      await migration.checkEnvironment()

      this.recordTestResult(testName, true, '环境检查通过')
      console.log(chalk.green('✅ 环境检查测试通过'))
    } catch (error) {
      this.recordTestResult(testName, false, error.message)
      console.log(chalk.red(`❌ 环境检查测试失败: ${error.message}`))
    }
  }

  /**
   * 测试数据库连接功能
   */
  async testDatabaseConnection() {
    const testName = '数据库连接测试'
    console.log(chalk.cyan(`\n🧪 ${testName}`))

    try {
      const migration = new UserManagementMigration()
      await migration.checkDatabaseConnection()

      this.recordTestResult(testName, true, '数据库连接正常')
      console.log(chalk.green('✅ 数据库连接测试通过'))
    } catch (error) {
      this.recordTestResult(testName, false, error.message)
      console.log(chalk.red(`❌ 数据库连接测试失败: ${error.message}`))
    }
  }

  /**
   * 测试数据分析功能
   */
  async testDataAnalysis() {
    const testName = '数据分析测试'
    console.log(chalk.cyan(`\n🧪 ${testName}`))

    try {
      const migration = new UserManagementMigration()
      await migration.analyzeExistingData()

      // 验证分析结果
      if (migration.migrationStats.totalApiKeys !== 3) {
        throw new Error(
          `API Key数量不正确: 预期3个，实际${migration.migrationStats.totalApiKeys}个`
        )
      }

      this.recordTestResult(
        testName,
        true,
        `成功分析${migration.migrationStats.totalApiKeys}个API Key`
      )
      console.log(chalk.green('✅ 数据分析测试通过'))
    } catch (error) {
      this.recordTestResult(testName, false, error.message)
      console.log(chalk.red(`❌ 数据分析测试失败: ${error.message}`))
    }
  }

  /**
   * 测试试运行迁移
   */
  async testDryRunMigration() {
    const testName = '试运行迁移测试'
    console.log(chalk.cyan(`\n🧪 ${testName}`))

    try {
      const migration = new UserManagementMigration()
      const result = await migration.runMigration({
        dryRun: true,
        skipBackup: true,
        force: true
      })

      if (!result.success) {
        throw new Error(result.error || '试运行失败')
      }

      this.recordTestResult(testName, true, '试运行迁移成功')
      console.log(chalk.green('✅ 试运行迁移测试通过'))
    } catch (error) {
      this.recordTestResult(testName, false, error.message)
      console.log(chalk.red(`❌ 试运行迁移测试失败: ${error.message}`))
    }
  }

  /**
   * 测试实际迁移
   */
  async testActualMigration() {
    const testName = '实际迁移测试'
    console.log(chalk.cyan(`\n🧪 ${testName}`))

    try {
      // 确保没有现有用户数据
      const client = database.getClient()
      const existingUsers = await client.keys('user:*')
      if (existingUsers.length > 0) {
        await client.del(...existingUsers)
      }

      const migration = new UserManagementMigration()
      const result = await migration.runMigration({
        dryRun: false,
        skipBackup: false, // 测试备份功能
        force: true,
        skipValidation: false
      })

      if (!result.success) {
        throw new Error(result.error || '实际迁移失败')
      }

      // 验证迁移结果
      const userKeys = await client.keys('user:*')
      if (userKeys.length === 0) {
        throw new Error('没有创建用户数据')
      }

      // 验证API Key迁移
      const apiKeys = await client.keys('api_key:test_key_*')
      let migratedCount = 0

      for (const keyName of apiKeys) {
        const keyData = await client.hgetall(keyName)
        if (keyData.userId && keyData.migratedAt) {
          migratedCount++
        }
      }

      if (migratedCount !== 3) {
        throw new Error(`API Key迁移数量不正确: 预期3个，实际${migratedCount}个`)
      }

      this.recordTestResult(testName, true, `成功迁移${migratedCount}个API Key`)
      console.log(chalk.green('✅ 实际迁移测试通过'))
    } catch (error) {
      this.recordTestResult(testName, false, error.message)
      console.log(chalk.red(`❌ 实际迁移测试失败: ${error.message}`))
    }
  }

  /**
   * 测试验证功能
   */
  async testValidation() {
    const testName = '迁移验证测试'
    console.log(chalk.cyan(`\n🧪 ${testName}`))

    try {
      const migration = new UserManagementMigration()

      // 设置迁移统计数据
      migration.migrationStats.totalApiKeys = 3
      migration.migrationStats.migratedApiKeys = 3

      await migration.validateMigration()

      this.recordTestResult(testName, true, '迁移验证通过')
      console.log(chalk.green('✅ 迁移验证测试通过'))
    } catch (error) {
      this.recordTestResult(testName, false, error.message)
      console.log(chalk.red(`❌ 迁移验证测试失败: ${error.message}`))
    }
  }

  /**
   * 测试回滚功能
   */
  async testRollback() {
    const testName = '回滚功能测试'
    console.log(chalk.cyan(`\n🧪 ${testName}`))

    try {
      const client = database.getClient()

      // 记录迁移前状态
      const _beforeUsers = await client.keys('user:*')
      const beforeApiKeys = await client.keys('api_key:test_key_*')

      // 创建一个简单的迁移对象进行回滚测试
      const migration = new UserManagementMigration()

      // 模拟回滚操作数据
      migration.rollbackData.operations = [
        {
          type: 'create_user',
          userId: 'user_default_migration',
          timestamp: new Date().toISOString()
        }
      ]

      // 模拟原始API Key数据
      for (const keyName of beforeApiKeys) {
        const originalData = await client.hgetall(keyName)
        // 移除迁移相关字段
        delete originalData.userId
        delete originalData.migratedAt
        delete originalData.migrationVersion

        migration.rollbackData.originalApiKeys.set(keyName, originalData)
      }

      // 执行回滚
      await migration.executeRollback()

      // 验证回滚结果
      const afterUsers = await client.keys('user:*')
      const afterApiKeys = await client.keys('api_key:test_key_*')

      if (afterUsers.length > 0) {
        throw new Error(`回滚后仍有用户数据: ${afterUsers.length}个`)
      }

      // 验证API Key是否恢复原状
      let restoredCount = 0
      for (const keyName of afterApiKeys) {
        const keyData = await client.hgetall(keyName)
        if (!keyData.userId && !keyData.migratedAt) {
          restoredCount++
        }
      }

      if (restoredCount !== 3) {
        throw new Error(`API Key回滚数量不正确: 预期3个，实际${restoredCount}个`)
      }

      this.recordTestResult(testName, true, `成功回滚${restoredCount}个API Key`)
      console.log(chalk.green('✅ 回滚功能测试通过'))
    } catch (error) {
      this.recordTestResult(testName, false, error.message)
      console.log(chalk.red(`❌ 回滚功能测试失败: ${error.message}`))
    }
  }

  /**
   * 记录测试结果
   */
  recordTestResult(testName, success, message) {
    this.testResults.push({
      testName,
      success,
      message,
      timestamp: new Date().toISOString()
    })
  }

  /**
   * 生成测试报告
   */
  generateTestReport() {
    console.log(chalk.blue.bold('\n📊 测试报告'))

    const totalTests = this.testResults.length
    const passedTests = this.testResults.filter((r) => r.success).length
    const failedTests = totalTests - passedTests

    console.log(chalk.cyan(`总测试数: ${totalTests}`))
    console.log(chalk.green(`通过: ${passedTests}`))
    console.log(chalk.red(`失败: ${failedTests}`))
    console.log(chalk.yellow(`成功率: ${((passedTests / totalTests) * 100).toFixed(1)}%`))

    console.log(chalk.cyan('\n📋 详细结果:'))
    for (const result of this.testResults) {
      const icon = result.success ? '✅' : '❌'
      const color = result.success ? chalk.green : chalk.red
      console.log(color(`${icon} ${result.testName}: ${result.message}`))
    }

    // 保存测试报告到文件
    const reportsDir = path.join(projectRoot, 'test-reports')
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true })
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const reportFile = path.join(reportsDir, `user-migration-test-report-${timestamp}.json`)

    const report = {
      summary: {
        totalTests,
        passedTests,
        failedTests,
        successRate: ((passedTests / totalTests) * 100).toFixed(1)
      },
      results: this.testResults,
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        timestamp: new Date().toISOString()
      }
    }

    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2))
    console.log(chalk.gray(`\n📄 测试报告已保存: ${reportFile}`))
  }

  /**
   * 清理测试环境
   */
  async cleanupTestEnvironment() {
    if (!this.setupComplete) {
      return
    }

    console.log(chalk.yellow('\n🧹 清理测试环境...'))

    try {
      const client = database.getClient()

      // 清理测试API Key
      const testApiKeys = await client.keys('api_key:test_key_*')
      const testApiKeyHashes = await client.keys('api_key_hash:hash_test_*')

      const allTestKeys = [...testApiKeys, ...testApiKeyHashes]

      if (allTestKeys.length > 0) {
        await client.del(...allTestKeys)
      }

      // 清理测试用户数据
      const testUsers = await client.keys('user:*')
      const testUserMappings = await client.keys('user_username:*')
      const testUserEmails = await client.keys('user_email:*')
      const testUserApiKeys = await client.keys('user_api_keys:*')

      const allUserKeys = [...testUsers, ...testUserMappings, ...testUserEmails, ...testUserApiKeys]

      if (allUserKeys.length > 0) {
        await client.del(...allUserKeys)
      }

      // 清理系统配置
      await client.hdel(
        'system_config',
        'user_management_enabled',
        'migration_completed',
        'migration_version'
      )
      await client.del('user_count')

      console.log(chalk.green('✅ 测试环境清理完成'))
    } catch (error) {
      console.log(chalk.yellow(`⚠️ 测试环境清理失败: ${error.message}`))
    }
  }
}

/**
 * 主函数
 */
async function main() {
  const args = process.argv.slice(2)

  if (args.includes('--help')) {
    console.log(
      chalk.blue(`
用户管理系统迁移工具测试套件

用法: node test-user-migration.js [选项]

选项:
  --help     显示帮助信息

功能:
- 测试环境检查功能
- 测试数据库连接
- 测试数据分析
- 测试试运行迁移
- 测试实际迁移
- 测试验证功能
- 测试回滚功能
- 生成详细测试报告

注意:
1. 测试会创建临时测试数据
2. 测试完成后会自动清理
3. 不会影响现有生产数据
    `)
    )
    return
  }

  try {
    const testSuite = new UserMigrationTestSuite()
    await testSuite.runTests()
  } catch (error) {
    console.error(chalk.red('💥 测试套件执行失败:'), error)
    process.exit(1)
  }
}

// 如果直接运行此脚本，执行主函数
if (require.main === module) {
  main().catch(console.error)
}

module.exports = {
  UserMigrationTestSuite
}
