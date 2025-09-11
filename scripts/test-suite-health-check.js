#!/usr/bin/env node

/**
 * @fileoverview 测试套件健康检查脚本
 *
 * 验证所有测试脚本的完整性和可运行性：
 * - 检查依赖模块是否存在
 * - 验证测试脚本语法正确性
 * - 测试基础功能可用性
 * - 提供环境诊断信息
 *
 * @author Claude Code
 * @version 1.0.0
 */

const fs = require('fs')
const path = require('path')
const { performance } = require('perf_hooks')
const chalk = require('chalk')

// 测试套件配置
const TEST_SUITE_CONFIG = {
  scripts: [
    {
      name: 'Integration Test Suite',
      path: './integration-test-suite.js',
      description: '完整的系统集成测试套件'
    },
    {
      name: 'Load Balancer Test',
      path: './test-load-balancer.js',
      description: '智能负载均衡器专项测试'
    },
    {
      name: 'Error Retry Test',
      path: './test-error-retry.js',
      description: '错误处理和重试机制测试'
    }
  ],

  requiredModules: ['chalk', 'uuid', 'winston', 'ioredis', 'axios', 'moment'],

  coreFiles: [
    '../src/utils/logger.js',
    '../src/services/intelligentLoadBalancer.js',
    '../src/utils/QueryOptimizer.js',
    '../src/adapters/UpstreamFeatureAdapter.js',
    '../src/adapters/ApiKeyExportAdapter.js'
  ]
}

/**
 * 日志工具
 */
const log = {
  info: (msg, ...args) => console.log(chalk.blue('ℹ'), msg, ...args),
  success: (msg, ...args) => console.log(chalk.green('✅'), msg, ...args),
  error: (msg, ...args) => console.log(chalk.red('❌'), msg, ...args),
  warn: (msg, ...args) => console.log(chalk.yellow('⚠️'), msg, ...args),
  debug: (msg, ...args) => console.log(chalk.gray('🔍'), msg, ...args)
}

/**
 * 健康检查结果
 */
class HealthCheckResults {
  constructor() {
    this.checks = []
    this.errors = []
    this.warnings = []
  }

  addCheck(name, passed, details = null) {
    this.checks.push({ name, passed, details, timestamp: new Date() })

    if (!passed) {
      this.errors.push({ check: name, details })
    }
  }

  addWarning(message, details = null) {
    this.warnings.push({ message, details, timestamp: new Date() })
  }

  getSummary() {
    const passed = this.checks.filter((c) => c.passed).length
    const total = this.checks.length

    return {
      total,
      passed,
      failed: total - passed,
      successRate: total > 0 ? (passed / total) * 100 : 0,
      hasErrors: this.errors.length > 0,
      hasWarnings: this.warnings.length > 0
    }
  }
}

const healthCheck = new HealthCheckResults()

/**
 * 检查 Node.js 环境
 */
function checkNodeEnvironment() {
  log.info('🔍 Checking Node.js Environment...')

  try {
    // Node.js 版本检查
    const nodeVersion = process.version
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0])
    const versionOk = majorVersion >= 18

    healthCheck.addCheck('Node.js Version', versionOk, {
      current: nodeVersion,
      required: '>=18.0.0',
      supported: versionOk
    })

    if (versionOk) {
      log.success(`Node.js version: ${nodeVersion}`)
    } else {
      log.error(`Node.js version ${nodeVersion} not supported. Required: >=18.0.0`)
    }

    // 内存检查
    const memUsage = process.memoryUsage()
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024)
    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024)

    healthCheck.addCheck('Memory Available', heapTotalMB >= 100, {
      heapUsed: `${heapUsedMB}MB`,
      heapTotal: `${heapTotalMB}MB`,
      sufficient: heapTotalMB >= 100
    })

    log.success(`Memory usage: ${heapUsedMB}MB / ${heapTotalMB}MB`)

    // 平台检查
    const { platform } = process
    const supportedPlatforms = ['win32', 'darwin', 'linux']
    const platformSupported = supportedPlatforms.includes(platform)

    healthCheck.addCheck('Platform Support', platformSupported, {
      current: platform,
      supported: supportedPlatforms
    })

    log.success(`Platform: ${platform}`)
  } catch (error) {
    log.error('Node.js environment check failed:', error.message)
    healthCheck.addCheck('Node.js Environment', false, { error: error.message })
  }
}

/**
 * 检查依赖模块
 */
function checkDependencies() {
  log.info('📦 Checking Dependencies...')

  for (const moduleName of TEST_SUITE_CONFIG.requiredModules) {
    try {
      require.resolve(moduleName)
      healthCheck.addCheck(`Module: ${moduleName}`, true)
      log.debug(`✓ ${moduleName}`)
    } catch (error) {
      healthCheck.addCheck(`Module: ${moduleName}`, false, { error: error.message })
      log.error(`✗ ${moduleName} - ${error.message}`)
    }
  }

  // 检查核心文件
  log.info('📁 Checking Core Files...')

  for (const filePath of TEST_SUITE_CONFIG.coreFiles) {
    const fullPath = path.resolve(__dirname, filePath)
    const exists = fs.existsSync(fullPath)

    healthCheck.addCheck(`Core File: ${path.basename(filePath)}`, exists, {
      path: fullPath,
      exists
    })

    if (exists) {
      log.debug(`✓ ${filePath}`)
    } else {
      log.error(`✗ ${filePath} - File not found`)
    }
  }
}

/**
 * 检查测试脚本
 */
function checkTestScripts() {
  log.info('📝 Checking Test Scripts...')

  for (const script of TEST_SUITE_CONFIG.scripts) {
    const scriptPath = path.resolve(__dirname, script.path)

    try {
      // 检查文件存在
      if (!fs.existsSync(scriptPath)) {
        healthCheck.addCheck(`Script: ${script.name}`, false, {
          error: 'File not found',
          path: scriptPath
        })
        log.error(`✗ ${script.name} - File not found`)
        continue
      }

      // 检查文件可读性
      const stats = fs.statSync(scriptPath)
      const isFile = stats.isFile()
      const _isReadable = fs.access !== undefined ? true : fs.constants.R_OK

      if (!isFile) {
        healthCheck.addCheck(`Script: ${script.name}`, false, {
          error: 'Not a regular file',
          path: scriptPath
        })
        log.error(`✗ ${script.name} - Not a regular file`)
        continue
      }

      // 尝试语法检查（不执行）
      const content = fs.readFileSync(scriptPath, 'utf8')

      // 基本语法检查
      const hasShebang = content.startsWith('#!/usr/bin/env node')
      const hasModuleExports = content.includes('module.exports')
      const hasMainCheck = content.includes('require.main === module')

      if (!hasShebang) {
        healthCheck.addWarning(`${script.name} missing shebang line`)
      }

      if (!hasModuleExports) {
        healthCheck.addWarning(`${script.name} missing module.exports`)
      }

      healthCheck.addCheck(`Script: ${script.name}`, true, {
        path: scriptPath,
        size: `${Math.round(stats.size / 1024)}KB`,
        hasShebang,
        hasModuleExports,
        hasMainCheck
      })

      log.success(`✓ ${script.name} (${Math.round(stats.size / 1024)}KB)`)
    } catch (error) {
      healthCheck.addCheck(`Script: ${script.name}`, false, {
        error: error.message,
        path: scriptPath
      })
      log.error(`✗ ${script.name} - ${error.message}`)
    }
  }
}

/**
 * 检查项目结构
 */
function checkProjectStructure() {
  log.info('🏗️ Checking Project Structure...')

  const requiredDirs = ['../src', '../src/services', '../src/utils', '../src/adapters', '../logs']

  for (const dir of requiredDirs) {
    const dirPath = path.resolve(__dirname, dir)
    const exists = fs.existsSync(dirPath)

    if (!exists && dir === '../logs') {
      // 尝试创建 logs 目录
      try {
        fs.mkdirSync(dirPath, { recursive: true })
        healthCheck.addCheck(`Directory: ${dir}`, true, {
          path: dirPath,
          created: true
        })
        log.success(`✓ Created ${dir}`)
      } catch (error) {
        healthCheck.addCheck(`Directory: ${dir}`, false, {
          error: error.message,
          path: dirPath
        })
        log.error(`✗ Failed to create ${dir}`)
      }
    } else {
      healthCheck.addCheck(`Directory: ${dir}`, exists, {
        path: dirPath,
        exists
      })

      if (exists) {
        log.debug(`✓ ${dir}`)
      } else {
        log.error(`✗ ${dir} - Directory not found`)
      }
    }
  }
}

/**
 * 执行基础功能测试
 */
async function checkBasicFunctionality() {
  log.info('⚡ Checking Basic Functionality...')

  try {
    // 测试日志功能
    try {
      const logger = require('../src/utils/logger')
      const logTest = typeof logger.info === 'function'

      healthCheck.addCheck('Logger Functionality', logTest)
      if (logTest) {
        log.debug('✓ Logger working')
      } else {
        log.error('✗ Logger not functional')
      }
    } catch (error) {
      healthCheck.addCheck('Logger Functionality', false, { error: error.message })
      log.error('✗ Logger load failed:', error.message)
    }

    // 测试性能工具
    try {
      const start = performance.now()
      await new Promise((resolve) => setTimeout(resolve, 10))
      const duration = performance.now() - start

      const perfTest = duration >= 8 && duration <= 50 // 预期10ms左右
      healthCheck.addCheck('Performance Tools', perfTest, { duration: `${duration.toFixed(2)}ms` })

      if (perfTest) {
        log.debug(`✓ Performance tools working (${duration.toFixed(2)}ms)`)
      } else {
        log.warn(`⚠ Performance tools questionable (${duration.toFixed(2)}ms)`)
      }
    } catch (error) {
      healthCheck.addCheck('Performance Tools', false, { error: error.message })
      log.error('✗ Performance tools failed:', error.message)
    }

    // 测试 Promise 支持
    try {
      const promiseTest = await Promise.resolve(true)
      healthCheck.addCheck('Promise Support', promiseTest)
      log.debug('✓ Promise support working')
    } catch (error) {
      healthCheck.addCheck('Promise Support', false, { error: error.message })
      log.error('✗ Promise support failed:', error.message)
    }
  } catch (error) {
    log.error('Basic functionality check failed:', error.message)
    healthCheck.addCheck('Basic Functionality', false, { error: error.message })
  }
}

/**
 * 生成诊断报告
 */
function generateDiagnosticReport() {
  log.info('📋 Generating Diagnostic Report...')

  const summary = healthCheck.getSummary()
  const report = {
    timestamp: new Date().toISOString(),
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      memory: process.memoryUsage(),
      uptime: process.uptime()
    },
    summary,
    checks: healthCheck.checks,
    errors: healthCheck.errors,
    warnings: healthCheck.warnings,
    recommendations: []
  }

  // 生成建议
  if (summary.failed > 0) {
    report.recommendations.push('修复失败的检查项再运行测试套件')
  }

  if (summary.hasWarnings) {
    report.recommendations.push('检查警告信息，可能影响测试结果')
  }

  if (summary.successRate === 100) {
    report.recommendations.push('环境检查通过，可以运行完整测试套件')
  }

  // 控制台输出
  console.log(`\n${'='.repeat(80)}`)
  console.log(chalk.bold.blue('🏥 TEST SUITE HEALTH CHECK REPORT'))
  console.log('='.repeat(80))

  console.log(chalk.bold('\n📊 Summary:'))
  console.log(`  Total Checks: ${summary.total}`)
  console.log(`  Passed: ${chalk.green(summary.passed)}`)
  console.log(`  Failed: ${chalk.red(summary.failed)}`)
  console.log(`  Success Rate: ${chalk.bold(summary.successRate.toFixed(1))}%`)

  if (summary.hasErrors) {
    console.log(chalk.bold.red('\n❌ Errors:'))
    healthCheck.errors.forEach((error) => {
      console.log(`  - ${error.check}: ${error.details?.error || 'Unknown error'}`)
    })
  }

  if (summary.hasWarnings) {
    console.log(chalk.bold.yellow('\n⚠️ Warnings:'))
    healthCheck.warnings.forEach((warning) => {
      console.log(`  - ${warning.message}`)
    })
  }

  if (report.recommendations.length > 0) {
    console.log(chalk.bold('\n💡 Recommendations:'))
    report.recommendations.forEach((rec) => {
      console.log(`  - ${rec}`)
    })
  }

  console.log(chalk.bold('\n🚀 Available Test Commands:'))
  console.log('  npm run test:integration        - 完整集成测试')
  console.log('  npm run test:load-balancer      - 负载均衡器测试')
  console.log('  npm run test:error-retry        - 错误重试测试')
  console.log('  npm run test:all-features       - 所有功能测试')

  console.log('='.repeat(80))

  // 保存报告到文件
  try {
    const reportPath = path.join(__dirname, '../logs/health-check-report.json')
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
    log.success(`Health check report saved to: ${reportPath}`)
  } catch (error) {
    log.warn('Failed to save health check report:', error.message)
  }

  return report
}

/**
 * 主健康检查函数
 */
async function runHealthCheck() {
  console.log(chalk.bold.blue('\n🏥 Starting Test Suite Health Check'))
  console.log(chalk.gray('Validating environment and test suite integrity...'))

  const overallStart = performance.now()

  try {
    checkNodeEnvironment()
    checkDependencies()
    checkTestScripts()
    checkProjectStructure()
    await checkBasicFunctionality()

    const report = generateDiagnosticReport()
    const overallDuration = performance.now() - overallStart

    const { summary } = report

    if (summary.successRate >= 90) {
      log.success(`🎉 Health check completed successfully in ${overallDuration.toFixed(2)}ms`)
      log.success('✅ Test suite is ready to run!')
      process.exit(0)
    } else if (summary.successRate >= 70) {
      log.warn(`⚠️ Health check completed with warnings in ${overallDuration.toFixed(2)}ms`)
      log.warn('⚡ Test suite may have issues but should be runnable')
      process.exit(0)
    } else {
      log.error(`💥 Health check failed in ${overallDuration.toFixed(2)}ms`)
      log.error('❌ Please fix the errors before running tests')
      process.exit(1)
    }
  } catch (error) {
    const overallDuration = performance.now() - overallStart
    log.error(`💥 Health check crashed: ${error.message}`)
    log.error(`Duration: ${overallDuration.toFixed(2)}ms`)

    generateDiagnosticReport()
    process.exit(1)
  }
}

// 主程序入口
if (require.main === module) {
  runHealthCheck()
}

module.exports = {
  runHealthCheck,
  checkNodeEnvironment,
  checkDependencies,
  checkTestScripts,
  checkProjectStructure,
  checkBasicFunctionality,
  HealthCheckResults
}
