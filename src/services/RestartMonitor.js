/**
 * CRS重启监控和告警服务
 * 提供重启性能监控、异常检测和自动告警功能
 */

const EventEmitter = require('events')
const fs = require('fs').promises
const path = require('path')

class RestartMonitor extends EventEmitter {
  constructor(config = {}) {
    super()
    
    this.config = {
      // 监控配置
      enablePerformanceTracking: config.enablePerformanceTracking !== false,
      enableAlerts: config.enableAlerts || false,
      metricsRetentionHours: config.metricsRetention || 168, // 7天
      
      // 告警阈值
      alertThresholds: {
        maxRestartTime: config.maxRestartTime || 60000, // 60秒
        minSuccessRate: config.minSuccessRate || 95, // 95%
        maxConsecutiveFailures: config.maxConsecutiveFailures || 3,
        maxRestartsPerHour: config.maxRestartsPerHour || 10,
        ...config.alertThresholds
      },
      
      // 文件路径
      metricsFile: config.metricsFile || path.join(__dirname, '../../logs/restart-metrics.log'),
      alertLogFile: config.alertLogFile || path.join(__dirname, '../../logs/restart-alerts.log'),
      
      // 日志配置
      logLevel: config.logLevel || 'info',
      
      ...config
    }
    
    // 监控状态
    this.isMonitoring = false
    this.metrics = {
      restartHistory: [],
      alertHistory: [],
      performanceStats: {},
      currentWindow: {
        startTime: Date.now(),
        restartCount: 0,
        failureCount: 0
      }
    }
    
    this.logger = this.createLogger()
  }
  
  createLogger() {
    const logLevels = { error: 0, warn: 1, info: 2, debug: 3 }
    const currentLevel = logLevels[this.config.logLevel] || 2
    
    return {
      error: (msg, ...args) => {
        if (currentLevel >= 0) console.error(`[RestartMonitor ERROR]`, msg, ...args)
      },
      warn: (msg, ...args) => {
        if (currentLevel >= 1) console.warn(`[RestartMonitor WARN]`, msg, ...args)
      },
      info: (msg, ...args) => {
        if (currentLevel >= 2) console.log(`[RestartMonitor INFO]`, msg, ...args)
      },
      debug: (msg, ...args) => {
        if (currentLevel >= 3) console.log(`[RestartMonitor DEBUG]`, msg, ...args)
      }
    }
  }
  
  /**
   * 启动监控
   */
  async startMonitoring() {
    if (this.isMonitoring) return
    
    this.isMonitoring = true
    this.logger.info('重启监控服务已启动')
    
    // 加载历史指标
    await this.loadHistoricalMetrics()
    
    // 启动定期清理
    this.startPeriodicCleanup()
    
    this.emit('monitoring:started')
  }
  
  /**
   * 停止监控
   */
  stopMonitoring() {
    this.isMonitoring = false
    this.logger.info('重启监控服务已停止')
    this.emit('monitoring:stopped')
  }
  
  /**
   * 记录重启事件
   */
  async recordRestart(restartData) {
    if (!this.config.enablePerformanceTracking) return
    
    const record = {
      timestamp: Date.now(),
      strategy: restartData.strategy || 'unknown',
      duration: restartData.duration || 0,
      success: restartData.success !== false,
      pid: restartData.pid,
      error: restartData.error,
      ...restartData
    }
    
    // 添加到历史记录
    this.metrics.restartHistory.push(record)
    
    // 更新当前窗口统计
    this.updateCurrentWindow(record)
    
    // 写入指标文件
    await this.writeMetrics(record)
    
    // 检查告警条件
    if (this.config.enableAlerts) {
      await this.checkAlertConditions(record)
    }
    
    this.logger.debug('重启事件已记录:', record)
    this.emit('restart:recorded', record)
  }
  
  /**
   * 更新当前时间窗口统计
   */
  updateCurrentWindow(record) {
    const now = Date.now()
    const oneHour = 60 * 60 * 1000
    
    // 如果超过1小时，重置窗口
    if (now - this.metrics.currentWindow.startTime > oneHour) {
      this.metrics.currentWindow = {
        startTime: now,
        restartCount: 0,
        failureCount: 0
      }
    }
    
    this.metrics.currentWindow.restartCount++
    
    if (!record.success) {
      this.metrics.currentWindow.failureCount++
    }
  }
  
  /**
   * 检查告警条件
   */
  async checkAlertConditions(record) {
    const alerts = []
    
    // 检查重启时间
    if (record.duration > this.config.alertThresholds.maxRestartTime) {
      alerts.push({
        type: 'SLOW_RESTART',
        severity: 'warning',
        message: `重启耗时过长: ${record.duration}ms (阈值: ${this.config.alertThresholds.maxRestartTime}ms)`,
        threshold: this.config.alertThresholds.maxRestartTime,
        value: record.duration
      })
    }
    
    // 检查连续失败
    const recentFailures = this.getConsecutiveFailures()
    if (recentFailures >= this.config.alertThresholds.maxConsecutiveFailures) {
      alerts.push({
        type: 'CONSECUTIVE_FAILURES',
        severity: 'critical',
        message: `连续重启失败 ${recentFailures} 次`,
        threshold: this.config.alertThresholds.maxConsecutiveFailures,
        value: recentFailures
      })
    }
    
    // 检查单个小时内重启频率
    if (this.metrics.currentWindow.restartCount > this.config.alertThresholds.maxRestartsPerHour) {
      alerts.push({
        type: 'HIGH_RESTART_FREQUENCY',
        severity: 'warning',
        message: `一小时内重启次数过多: ${this.metrics.currentWindow.restartCount} 次`,
        threshold: this.config.alertThresholds.maxRestartsPerHour,
        value: this.metrics.currentWindow.restartCount
      })
    }
    
    // 检查成功率
    const successRate = this.calculateRecentSuccessRate()
    if (successRate < this.config.alertThresholds.minSuccessRate) {
      alerts.push({
        type: 'LOW_SUCCESS_RATE',
        severity: 'critical',
        message: `重启成功率过低: ${successRate}% (阈值: ${this.config.alertThresholds.minSuccessRate}%)`,
        threshold: this.config.alertThresholds.minSuccessRate,
        value: successRate
      })
    }
    
    // 处理告警
    for (const alert of alerts) {
      await this.triggerAlert(alert, record)
    }
  }
  
  /**
   * 获取连续失败次数
   */
  getConsecutiveFailures() {
    let failures = 0
    const history = this.metrics.restartHistory.slice().reverse() // 从最新开始
    
    for (const record of history) {
      if (!record.success) {
        failures++
      } else {
        break // 遇到成功的就停止计数
      }
    }
    
    return failures
  }
  
  /**
   * 计算最近的成功率
   */
  calculateRecentSuccessRate(windowSize = 10) {
    const recent = this.metrics.restartHistory.slice(-windowSize)
    if (recent.length === 0) return 100
    
    const successCount = recent.filter(r => r.success).length
    return Math.round((successCount / recent.length) * 100)
  }
  
  /**
   * 触发告警
   */
  async triggerAlert(alert, triggerRecord) {
    const alertRecord = {
      ...alert,
      timestamp: Date.now(),
      triggerRecord: {
        timestamp: triggerRecord.timestamp,
        strategy: triggerRecord.strategy,
        duration: triggerRecord.duration,
        success: triggerRecord.success
      }
    }
    
    // 记录告警历史
    this.metrics.alertHistory.push(alertRecord)
    
    // 写入告警日志
    await this.writeAlert(alertRecord)
    
    // 发出告警事件
    this.emit('alert:triggered', alertRecord)
    
    this.logger.warn(`重启告警: ${alert.type} - ${alert.message}`)
    
    // 执行告警操作
    await this.executeAlertActions(alertRecord)
  }
  
  /**
   * 执行告警操作
   */
  async executeAlertActions(alert) {
    // 这里可以集成各种告警通知方式
    // 例如: 邮件、Slack、钉钉、短信等
    
    try {
      // 控制台输出
      const severityColors = {
        info: '\x1b[36m',
        warning: '\x1b[33m',
        critical: '\x1b[31m'
      }
      
      const color = severityColors[alert.severity] || '\x1b[0m'
      const reset = '\x1b[0m'
      
      console.warn(`${color}[CRS ALERT ${alert.severity.toUpperCase()}]${reset} ${alert.message}`)
      
      // 可以在这里添加其他通知方式
      // await this.sendEmailAlert(alert)
      // await this.sendSlackAlert(alert)
      // await this.sendWebhookAlert(alert)
      
    } catch (error) {
      this.logger.error('告警执行失败:', error.message)
    }
  }
  
  /**
   * 写入指标数据
   */
  async writeMetrics(record) {
    try {
      const logEntry = this.formatMetricLogEntry(record)
      await fs.mkdir(path.dirname(this.config.metricsFile), { recursive: true })
      await fs.appendFile(this.config.metricsFile, logEntry + '\n')
    } catch (error) {
      this.logger.error('写入指标失败:', error.message)
    }
  }
  
  /**
   * 写入告警日志
   */
  async writeAlert(alert) {
    try {
      const logEntry = this.formatAlertLogEntry(alert)
      await fs.mkdir(path.dirname(this.config.alertLogFile), { recursive: true })
      await fs.appendFile(this.config.alertLogFile, logEntry + '\n')
    } catch (error) {
      this.logger.error('写入告警日志失败:', error.message)
    }
  }
  
  /**
   * 格式化指标日志条目
   */
  formatMetricLogEntry(record) {
    const timestamp = new Date(record.timestamp).toISOString()
    return `[${timestamp}] strategy=${record.strategy} duration=${record.duration}ms success=${record.success} pid=${record.pid || 'unknown'}`
  }
  
  /**
   * 格式化告警日志条目
   */
  formatAlertLogEntry(alert) {
    const timestamp = new Date(alert.timestamp).toISOString()
    return `[${timestamp}] ALERT ${alert.type} ${alert.severity}: ${alert.message} (value=${alert.value}, threshold=${alert.threshold})`
  }
  
  /**
   * 加载历史指标
   */
  async loadHistoricalMetrics() {
    try {
      const content = await fs.readFile(this.config.metricsFile, 'utf8')
      const lines = content.trim().split('\n').filter(line => line)
      
      const cutoffTime = Date.now() - (this.config.metricsRetentionHours * 60 * 60 * 1000)
      
      for (const line of lines) {
        const record = this.parseMetricLogEntry(line)
        if (record && record.timestamp > cutoffTime) {
          this.metrics.restartHistory.push(record)
        }
      }
      
      this.logger.debug(`加载了 ${this.metrics.restartHistory.length} 条历史指标`)
    } catch (error) {
      this.logger.debug('无历史指标文件或读取失败:', error.message)
    }
  }
  
  /**
   * 解析指标日志条目
   */
  parseMetricLogEntry(line) {
    const match = line.match(/\[(.+?)\] strategy=(\w+) duration=(\d+)ms success=(true|false) pid=(.+)/)
    if (!match) return null
    
    return {
      timestamp: new Date(match[1]).getTime(),
      strategy: match[2],
      duration: parseInt(match[3]),
      success: match[4] === 'true',
      pid: match[5] === 'unknown' ? null : parseInt(match[5])
    }
  }
  
  /**
   * 启动定期清理
   */
  startPeriodicCleanup() {
    const cleanupInterval = 60 * 60 * 1000 // 每小时清理一次
    
    setInterval(async () => {
      await this.cleanupOldMetrics()
    }, cleanupInterval)
  }
  
  /**
   * 清理过期指标
   */
  async cleanupOldMetrics() {
    const cutoffTime = Date.now() - (this.config.metricsRetentionHours * 60 * 60 * 1000)
    
    // 清理内存中的历史记录
    this.metrics.restartHistory = this.metrics.restartHistory.filter(
      record => record.timestamp > cutoffTime
    )
    
    this.metrics.alertHistory = this.metrics.alertHistory.filter(
      alert => alert.timestamp > cutoffTime
    )
    
    this.logger.debug('已清理过期指标数据')
  }
  
  /**
   * 获取性能统计
   */
  getPerformanceStats() {
    const history = this.metrics.restartHistory
    if (history.length === 0) {
      return {
        totalRestarts: 0,
        successRate: 100,
        averageDuration: 0,
        fastestRestart: 0,
        slowestRestart: 0,
        byStrategy: {}
      }
    }
    
    const successful = history.filter(r => r.success)
    const durations = successful.map(r => r.duration)
    
    const stats = {
      totalRestarts: history.length,
      successfulRestarts: successful.length,
      failedRestarts: history.length - successful.length,
      successRate: Math.round((successful.length / history.length) * 100),
      averageDuration: durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
      fastestRestart: durations.length > 0 ? Math.min(...durations) : 0,
      slowestRestart: durations.length > 0 ? Math.max(...durations) : 0,
      currentWindowRestarts: this.metrics.currentWindow.restartCount,
      consecutiveFailures: this.getConsecutiveFailures(),
      recentSuccessRate: this.calculateRecentSuccessRate(),
      byStrategy: {}
    }
    
    // 按策略统计
    const strategies = {}
    for (const record of history) {
      if (!strategies[record.strategy]) {
        strategies[record.strategy] = []
      }
      strategies[record.strategy].push(record)
    }
    
    for (const [strategy, records] of Object.entries(strategies)) {
      const successfulRecords = records.filter(r => r.success)
      const strategyDurations = successfulRecords.map(r => r.duration)
      
      stats.byStrategy[strategy] = {
        count: records.length,
        successRate: Math.round((successfulRecords.length / records.length) * 100),
        averageDuration: strategyDurations.length > 0 ? Math.round(strategyDurations.reduce((a, b) => a + b, 0) / strategyDurations.length) : 0,
        fastestRestart: strategyDurations.length > 0 ? Math.min(...strategyDurations) : 0,
        slowestRestart: strategyDurations.length > 0 ? Math.max(...strategyDurations) : 0
      }
    }
    
    return stats
  }
  
  /**
   * 获取告警历史
   */
  getAlertHistory(limit = 50) {
    return this.metrics.alertHistory
      .slice(-limit)
      .reverse() // 最新的在前
  }
  
  /**
   * 获取健康状态
   */
  getHealthStatus() {
    const stats = this.getPerformanceStats()
    const consecutiveFailures = this.getConsecutiveFailures()
    const recentSuccessRate = this.calculateRecentSuccessRate()
    
    let status = 'healthy'
    const issues = []
    
    // 检查连续失败
    if (consecutiveFailures >= this.config.alertThresholds.maxConsecutiveFailures) {
      status = 'critical'
      issues.push(`连续失败 ${consecutiveFailures} 次`)
    }
    
    // 检查成功率
    if (recentSuccessRate < this.config.alertThresholds.minSuccessRate) {
      status = status === 'critical' ? 'critical' : 'warning'
      issues.push(`成功率过低 ${recentSuccessRate}%`)
    }
    
    // 检查重启频率
    if (this.metrics.currentWindow.restartCount > this.config.alertThresholds.maxRestartsPerHour) {
      status = status === 'critical' ? 'critical' : 'warning'
      issues.push(`重启频率过高 ${this.metrics.currentWindow.restartCount}/小时`)
    }
    
    return {
      status,
      issues,
      consecutiveFailures,
      recentSuccessRate,
      currentHourRestarts: this.metrics.currentWindow.restartCount,
      isMonitoring: this.isMonitoring
    }
  }
  
  /**
   * 重置指标
   */
  resetMetrics() {
    this.metrics = {
      restartHistory: [],
      alertHistory: [],
      performanceStats: {},
      currentWindow: {
        startTime: Date.now(),
        restartCount: 0,
        failureCount: 0
      }
    }
    
    this.logger.info('监控指标已重置')
    this.emit('metrics:reset')
  }
}

module.exports = RestartMonitor