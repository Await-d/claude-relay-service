#!/usr/bin/env node
/**
 * 用户管理系统性能监控脚本
 * 提供实时性能监控和预警功能
 */

const chalk = require('chalk')
const ora = require('ora')
const { promisify } = require('util')
const fs = require('fs')
const path = require('path')

const writeFileAsync = promisify(fs.writeFile)
const readFileAsync = promisify(fs.readFile)

const UnifiedLogService = require('../src/services/UnifiedLogService').UnifiedLogService
const database = require('../src/models/database')
const logger = require('../src/utils/logger')

class PerformanceMonitor {
  constructor(dependencies) {
    this.logService = new UnifiedLogService(dependencies)
    this.reportDir = path.join(__dirname, '..', 'reports', 'performance')
  }

  /**
   * 生成性能报告
   */
  async generatePerformanceReport() {
    const spinner = ora('生成性能报告').start()

    try {
      const performanceReport = this.logService.getPerformanceReport()
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const reportFile = path.join(this.reportDir, `performance-${timestamp}.json`)

      // 确保目录存在
      await fs.promises.mkdir(this.reportDir, { recursive: true })

      // 写入性能报告
      await writeFileAsync(reportFile, JSON.stringify(performanceReport, null, 2))

      spinner.succeed(`性能报告已保存: ${reportFile}`)
      return performanceReport
    } catch (error) {
      spinner.fail(`生成性能报告失败: ${error.message}`)
      throw error
    }
  }

  /**
   * 性能预警检查
   */
  checkPerformanceAlerts(performanceReport) {
    const alerts = []

    // QPS预警
    if (performanceReport.qps.current > 100) {
      alerts.push(`⚠️ 高QPS警告: 当前QPS ${performanceReport.qps.current} 超过阈值`)
    }

    // 响应时间预警
    if (performanceReport.averageResponseTime > 500) {
      alerts.push(`⚠️ 响应时间警告: 平均响应时间 ${performanceReport.averageResponseTime}ms 过长`)
    }

    // 内存使用预警
    if (performanceReport.memory.heapUsedMB > 512) {
      alerts.push(`⚠️ 内存使用警告: 堆内存使用 ${performanceReport.memory.heapUsedMB}MB 超过阈值`)
    }

    // 错误率预警
    if (performanceReport.successRate < 95) {
      alerts.push(`⚠️ 错误率警告: 成功率 ${performanceReport.successRate}% 低于预期`)
    }

    return alerts
  }

  /**
   * 发送性能预警通知
   */
  async sendAlertNotification(alerts) {
    if (alerts.length === 0) return

    console.log(chalk.yellow('\n🚨 性能预警通知 🚨'))
    alerts.forEach(alert => console.log(chalk.red(alert)))

    // 可以在这里添加邮件、短信或其他通知渠道
    const notificationLog = {
      timestamp: new Date().toISOString(),
      alerts,
      severity: alerts.length > 2 ? 'high' : 'medium'
    }

    const notificationFile = path.join(this.reportDir, `alert-${notificationLog.timestamp.replace(/[:.]/g, '-')}.json`)
    await writeFileAsync(notificationFile, JSON.stringify(notificationLog, null, 2))
  }

  /**
   * 性能监控主流程
   */
  async monitor() {
    console.log(chalk.blue.bold('🔍 用户管理系统性能监控'))

    try {
      const performanceReport = await this.generatePerformanceReport()
      const alerts = this.checkPerformanceAlerts(performanceReport)
      
      if (alerts.length > 0) {
        await this.sendAlertNotification(alerts)
      } else {
        console.log(chalk.green('✅ 系统性能正常'))
      }
    } catch (error) {
      console.error(chalk.red('❌ 性能监控异常:'), error)
      logger.error('性能监控失败', error)
    }
  }
}

async function main() {
  try {
    const dependencies = {
      database: database.getClient(),
      headersFilter: {
        filterHeaders: async (headers) => headers // 简化实现
      }
    }

    const monitor = new PerformanceMonitor(dependencies)
    await monitor.monitor()
  } catch (error) {
    console.error(chalk.red('💥 监控初始化失败:'), error)
    process.exit(1)
  }
}

if (require.main === module) {
  main()
}

module.exports = { PerformanceMonitor }