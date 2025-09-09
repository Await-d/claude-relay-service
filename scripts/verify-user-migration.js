#!/usr/bin/env node

/**
 * @fileoverview 用户管理系统迁移验证脚本
 *
 * 此脚本用于验证用户管理系统迁移后的系统状态
 * 确保所有功能正常工作，API Key正确迁移
 *
 * @author Claude Code
 * @version 1.0.0
 */

const path = require('path')
const fs = require('fs')
const chalk = require('chalk')
const ora = require('ora')
const axios = require('axios')

// 添加项目根目录到模块搜索路径
const projectRoot = path.resolve(__dirname, '..')
process.chdir(projectRoot)

// 引入必要的模块
const database = require('../src/models/database')
const config = require('../config/config')
const logger = require('../src/utils/logger')

/**
 * 用户管理系统迁移验证器
 */
class UserMigrationVerifier {
  constructor() {
    this.verificationResults = []
    this.systemInfo = {}
    this.apiEndpoint = `http://localhost:${config.server.port}`
  }

  /**
   * 运行完整的验证流程
   */
  async runVerification() {
    console.log(chalk.blue.bold('\n🔍 用户管理系统迁移验证工具'))
    console.log(chalk.gray('验证迁移后系统的完整性和功能性\n'))

    try {
      // 执行各项验证
      await this.verifyEnvironment()
      await this.verifyDatabase()
      await this.verifyUserData()
      await this.verifyApiKeys()
      await this.verifySystemConfiguration()
      await this.verifyWebInterface()
      await this.verifyApiEndpoints()

      // 生成验证报告
      this.generateVerificationReport()

      const passedTests = this.verificationResults.filter((r) => r.success).length
      const totalTests = this.verificationResults.length

      if (passedTests === totalTests) {
        console.log(chalk.green.bold('\n✅ 所有验证通过！用户管理系统迁移成功！'))
      } else {
        console.log(chalk.yellow.bold(`\n⚠️ ${totalTests - passedTests} 项验证失败，请检查问题`))
      }

      return {
        success: passedTests === totalTests,
        passed: passedTests,
        total: totalTests,
        results: this.verificationResults
      }
    } catch (error) {
      console.error(chalk.red.bold('\n💥 验证过程中发生错误:'))
      console.error(chalk.red(error.message))
      return { success: false, error: error.message }
    }
  }

  /**
   * 验证环境配置
   */
  async verifyEnvironment() {
    const spinner = ora('验证环境配置').start()

    try {
      // 检查必要的环境变量
      const requiredEnvVars = ['JWT_SECRET', 'ENCRYPTION_KEY']
      const missingVars = []

      for (const envVar of requiredEnvVars) {
        if (!process.env[envVar] || process.env[envVar].includes('CHANGE-THIS')) {
          missingVars.push(envVar)
        }
      }

      if (missingVars.length > 0) {
        throw new Error(`缺少或无效的环境变量: ${missingVars.join(', ')}`)
      }

      // 检查配置文件
      const configPath = path.join(projectRoot, 'config', 'config.js')
      if (!fs.existsSync(configPath)) {
        throw new Error('配置文件不存在')
      }

      // 记录系统信息
      this.systemInfo = {
        nodeVersion: process.version,
        platform: process.platform,
        serverPort: config.server.port,
        databaseType: config.database?.type || 'redis'
      }

      spinner.succeed('环境配置验证通过')
      this.recordResult('环境配置验证', true, '所有必需的环境变量和配置文件存在')
    } catch (error) {
      spinner.fail('环境配置验证失败')
      this.recordResult('环境配置验证', false, error.message)
      throw error
    }
  }

  /**
   * 验证数据库连接和状态
   */
  async verifyDatabase() {
    const spinner = ora('验证数据库连接').start()

    try {
      await database.connect()
      const client = database.getClient()

      if (!client) {
        throw new Error('无法获取数据库客户端')
      }

      // 测试数据库连接
      await client.ping()

      // 检查数据库中的关键数据
      const systemConfig = await client.hgetall('system_config')
      const userCount = (await client.get('user_count')) || '0'
      const apiKeyCount = await client.keys('api_key:*')

      spinner.succeed('数据库连接验证通过')
      this.recordResult(
        '数据库连接验证',
        true,
        `Redis连接正常，API Key数量: ${apiKeyCount.length}，用户数量: ${userCount}`
      )
    } catch (error) {
      spinner.fail('数据库连接验证失败')
      this.recordResult('数据库连接验证', false, error.message)
      throw error
    }
  }

  /**
   * 验证用户数据结构
   */
  async verifyUserData() {
    const spinner = ora('验证用户数据结构').start()

    try {
      const client = database.getClient()

      // 检查用户记录
      const userKeys = await client.keys('user:*')
      if (userKeys.length === 0) {
        throw new Error('没有找到用户记录')
      }

      // 检查默认用户
      const defaultUserExists = await client.exists('user:user_default_migration')
      if (!defaultUserExists) {
        throw new Error('默认迁移用户不存在')
      }

      // 验证用户数据完整性
      const defaultUserData = await client.hgetall('user:user_default_migration')
      const requiredFields = ['id', 'username', 'email', 'role', 'status', 'createdAt']
      const missingFields = requiredFields.filter((field) => !defaultUserData[field])

      if (missingFields.length > 0) {
        throw new Error(`用户数据缺少字段: ${missingFields.join(', ')}`)
      }

      // 检查用户名映射
      const usernameMapping = await client.get('user_username:default_user')
      if (!usernameMapping) {
        throw new Error('用户名映射缺失')
      }

      spinner.succeed('用户数据结构验证通过')
      this.recordResult(
        '用户数据结构验证',
        true,
        `找到 ${userKeys.length} 个用户记录，数据结构完整`
      )
    } catch (error) {
      spinner.fail('用户数据结构验证失败')
      this.recordResult('用户数据结构验证', false, error.message)
    }
  }

  /**
   * 验证API Key迁移
   */
  async verifyApiKeys() {
    const spinner = ora('验证API Key迁移').start()

    try {
      const client = database.getClient()

      // 获取所有API Key
      const apiKeyKeys = await client.keys('api_key:*')
      if (apiKeyKeys.length === 0) {
        throw new Error('没有找到API Key记录')
      }

      // 检查API Key迁移状态
      let migratedCount = 0
      let unmatchedCount = 0

      for (const keyName of apiKeyKeys) {
        const keyData = await client.hgetall(keyName)

        if (keyData.userId && keyData.migratedAt) {
          migratedCount++

          // 验证用户-API Key关联
          const userApiKeysKey = `user_api_keys:${keyData.userId}`
          const isLinked = await client.sismember(userApiKeysKey, keyData.id)
          if (!isLinked) {
            unmatchedCount++
          }
        }
      }

      if (migratedCount === 0) {
        throw new Error('没有API Key被迁移到用户系统')
      }

      if (unmatchedCount > 0) {
        throw new Error(`${unmatchedCount} 个API Key的用户关联不匹配`)
      }

      spinner.succeed('API Key迁移验证通过')
      this.recordResult(
        'API Key迁移验证',
        true,
        `${migratedCount}/${apiKeyKeys.length} API Key成功迁移并建立用户关联`
      )
    } catch (error) {
      spinner.fail('API Key迁移验证失败')
      this.recordResult('API Key迁移验证', false, error.message)
    }
  }

  /**
   * 验证系统配置
   */
  async verifySystemConfiguration() {
    const spinner = ora('验证系统配置').start()

    try {
      const client = database.getClient()

      // 检查系统配置
      const systemConfig = await client.hgetall('system_config')

      if (systemConfig.user_management_enabled !== 'true') {
        throw new Error('用户管理功能未启用')
      }

      if (!systemConfig.migration_completed) {
        throw new Error('迁移完成标记缺失')
      }

      // 检查配置的一致性
      const userCount = await client.get('user_count')
      const actualUserCount = (await client.keys('user:*')).length

      if (parseInt(userCount || '0') !== actualUserCount) {
        throw new Error(`用户计数不一致: 配置${userCount}，实际${actualUserCount}`)
      }

      spinner.succeed('系统配置验证通过')
      this.recordResult('系统配置验证', true, '用户管理功能已启用，配置一致')
    } catch (error) {
      spinner.fail('系统配置验证失败')
      this.recordResult('系统配置验证', false, error.message)
    }
  }

  /**
   * 验证Web界面可访问性
   */
  async verifyWebInterface() {
    const spinner = ora('验证Web界面').start()

    try {
      // 检查主Web界面
      const webResponse = await axios.get(`${this.apiEndpoint}/web`, {
        timeout: 5000,
        validateStatus: (status) => status < 500
      })

      if (webResponse.status !== 200) {
        throw new Error(`Web界面返回状态码: ${webResponse.status}`)
      }

      // 检查管理界面（可能需要认证，返回401是正常的）
      try {
        await axios.get(`${this.apiEndpoint}/admin/users`, {
          timeout: 5000,
          validateStatus: (status) => status === 401 || status === 200
        })
      } catch (error) {
        if (error.code !== 'ECONNREFUSED') {
          // 忽略连接拒绝以外的错误
        }
      }

      spinner.succeed('Web界面验证通过')
      this.recordResult('Web界面验证', true, 'Web界面可正常访问')
    } catch (error) {
      spinner.fail('Web界面验证失败')
      this.recordResult('Web界面验证', false, `无法访问Web界面: ${error.message}`)
    }
  }

  /**
   * 验证API端点
   */
  async verifyApiEndpoints() {
    const spinner = ora('验证API端点').start()

    try {
      // 检查健康检查端点
      const healthResponse = await axios.get(`${this.apiEndpoint}/health`, {
        timeout: 5000
      })

      if (healthResponse.status !== 200) {
        throw new Error(`健康检查端点返回状态码: ${healthResponse.status}`)
      }

      // 检查模型列表端点（需要API Key，但应该返回401而不是500）
      try {
        const modelsResponse = await axios.get(`${this.apiEndpoint}/api/v1/models`, {
          timeout: 5000,
          validateStatus: (status) => status === 401 || status === 200
        })

        if (modelsResponse.status !== 401 && modelsResponse.status !== 200) {
          throw new Error(`模型列表端点返回意外状态码: ${modelsResponse.status}`)
        }
      } catch (error) {
        if (error.response && error.response.status === 401) {
          // 401 是预期的，因为没有提供API Key
        } else {
          throw error
        }
      }

      spinner.succeed('API端点验证通过')
      this.recordResult('API端点验证', true, '关键API端点正常响应')
    } catch (error) {
      spinner.fail('API端点验证失败')
      this.recordResult('API端点验证', false, `API端点错误: ${error.message}`)
    }
  }

  /**
   * 记录验证结果
   */
  recordResult(testName, success, message) {
    this.verificationResults.push({
      testName,
      success,
      message,
      timestamp: new Date().toISOString()
    })
  }

  /**
   * 生成验证报告
   */
  generateVerificationReport() {
    console.log(chalk.blue.bold('\n📊 验证报告'))

    const totalTests = this.verificationResults.length
    const passedTests = this.verificationResults.filter((r) => r.success).length
    const failedTests = totalTests - passedTests

    console.log(chalk.cyan(`总验证项: ${totalTests}`))
    console.log(chalk.green(`通过: ${passedTests}`))
    console.log(chalk.red(`失败: ${failedTests}`))
    console.log(chalk.yellow(`成功率: ${((passedTests / totalTests) * 100).toFixed(1)}%`))

    console.log(chalk.cyan('\n📋 详细结果:'))
    for (const result of this.verificationResults) {
      const icon = result.success ? '✅' : '❌'
      const color = result.success ? chalk.green : chalk.red
      console.log(color(`${icon} ${result.testName}: ${result.message}`))
    }

    // 显示系统信息
    console.log(chalk.blue('\n🖥️ 系统信息:'))
    console.log(`   Node.js版本: ${this.systemInfo.nodeVersion}`)
    console.log(`   平台: ${this.systemInfo.platform}`)
    console.log(`   服务端口: ${this.systemInfo.serverPort}`)
    console.log(`   数据库类型: ${this.systemInfo.databaseType}`)

    // 保存验证报告到文件
    const reportsDir = path.join(projectRoot, 'reports')
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true })
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const reportFile = path.join(reportsDir, `user-migration-verification-report-${timestamp}.json`)

    const report = {
      summary: {
        totalTests,
        passedTests,
        failedTests,
        successRate: ((passedTests / totalTests) * 100).toFixed(1),
        timestamp: new Date().toISOString()
      },
      systemInfo: this.systemInfo,
      results: this.verificationResults,
      recommendations: this.generateRecommendations()
    }

    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2))
    console.log(chalk.gray(`\n📄 验证报告已保存: ${reportFile}`))
  }

  /**
   * 生成建议
   */
  generateRecommendations() {
    const recommendations = []
    const failedTests = this.verificationResults.filter((r) => !r.success)

    if (failedTests.length === 0) {
      recommendations.push('✅ 所有验证通过，系统迁移成功')
      recommendations.push('💡 建议定期运行此验证脚本检查系统状态')
      recommendations.push('📊 监控用户管理功能的使用情况和性能')
    } else {
      recommendations.push('⚠️ 存在验证失败项，需要立即修复')

      for (const failedTest of failedTests) {
        switch (failedTest.testName) {
          case '环境配置验证':
            recommendations.push('🔧 检查环境变量配置，运行 npm run setup')
            break
          case '数据库连接验证':
            recommendations.push('🗄️ 检查Redis服务状态和连接配置')
            break
          case '用户数据结构验证':
            recommendations.push('👤 重新运行用户管理迁移脚本')
            break
          case 'API Key迁移验证':
            recommendations.push('🔑 检查API Key迁移完整性，考虑回滚并重新迁移')
            break
          case 'Web界面验证':
            recommendations.push('🌐 重启服务，检查端口占用情况')
            break
        }
      }
    }

    return recommendations
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
用户管理系统迁移验证工具

用法: node verify-user-migration.js [选项]

选项:
  --help     显示帮助信息

功能:
- 验证环境配置完整性
- 验证数据库连接状态
- 验证用户数据结构
- 验证API Key迁移状态
- 验证系统配置更新
- 验证Web界面可访问性
- 验证API端点响应
- 生成详细验证报告

使用场景:
1. 迁移完成后的系统验证
2. 定期系统健康检查
3. 故障排查辅助工具
4. 部署后验证

示例:
  node verify-user-migration.js              # 运行完整验证
    `)
    )
    return
  }

  console.log(chalk.yellow('⚠️ 注意: 请确保服务正在运行，否则部分验证会失败'))

  try {
    const verifier = new UserMigrationVerifier()
    const result = await verifier.runVerification()

    if (result.success) {
      console.log(chalk.green('\n🎉 验证完成，系统状态良好！'))
      process.exit(0)
    } else {
      console.log(chalk.red('\n⚠️ 发现问题，请根据报告修复'))
      process.exit(1)
    }
  } catch (error) {
    console.error(chalk.red('💥 验证过程中发生错误:'), error)
    process.exit(1)
  }
}

// 如果直接运行此脚本，执行主函数
if (require.main === module) {
  main().catch(console.error)
}

module.exports = {
  UserMigrationVerifier
}
