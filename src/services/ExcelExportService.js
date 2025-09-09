/**
 * @fileoverview Excel导出核心服务
 *
 * 提供完整的API Keys数据Excel导出功能，包括：
 * - 多维度数据查询和聚合
 * - Excel文件生成和格式化
 * - 异步导出和任务管理
 * - 与多数据库架构的兼容性
 *
 * @author Claude Code
 * @version 1.0.0
 */

const { v4: uuidv4 } = require('uuid')
const path = require('path')
const fs = require('fs')
const os = require('os')
const moment = require('moment')
const ExcelDataQueryAdapter = require('../utils/ExcelDataQueryAdapter')
const ExcelFormatter = require('../utils/ExcelFormatter')
const UpstreamCompatibilityBridge = require('../utils/UpstreamCompatibilityBridge')
const logger = require('../utils/logger')

/**
 * Excel导出服务
 *
 * 功能特性：
 * - 支持多种导出内容（基础信息、使用统计、成本分析等）
 * - 异步任务管理和进度跟踪
 * - 多数据库兼容性
 * - 高性能大数据处理
 * - 临时文件自动管理
 */
class ExcelExportService {
  constructor(databaseAdapter) {
    if (!databaseAdapter) {
      throw new Error('DatabaseAdapter is required for ExcelExportService')
    }

    // 核心组件
    this.db = databaseAdapter
    this.bridge = new UpstreamCompatibilityBridge(databaseAdapter)
    this.queryAdapter = new ExcelDataQueryAdapter(this.bridge)
    this.formatter = new ExcelFormatter()

    // 任务管理
    this.tasks = new Map()
    this.taskQueue = []
    this.processing = new Map()
    this.maxConcurrentTasks = 3

    // 临时文件管理
    this.tempDir = path.join(os.tmpdir(), 'excel-exports')
    this.ensureTempDir()

    // 统计信息
    this.stats = {
      totalExports: 0,
      successfulExports: 0,
      failedExports: 0,
      totalRecordsExported: 0,
      averageExportTime: 0
    }

    logger.info('📊 ExcelExportService initialized successfully')
    this.startTaskProcessor()
    this.startCleanupTimer()
  }

  // ==================== 主要导出方法 ====================

  /**
   * 导出API Keys到Excel
   * @param {Object} options 导出选项
   * @returns {Promise<string>} 任务ID
   */
  async exportApiKeysToExcel(options = {}) {
    try {
      // 参数验证
      const validatedOptions = this._validateExportOptions(options)

      // 创建导出任务
      const taskId = uuidv4()
      const task = {
        id: taskId,
        type: 'api-keys-export',
        options: validatedOptions,
        status: 'pending',
        progress: 0,
        currentStep: '准备导出任务',
        createdAt: new Date(),
        startedAt: null,
        completedAt: null,
        result: null,
        error: null
      }

      // 添加到任务队列
      this.tasks.set(taskId, task)
      this.taskQueue.push(task)

      logger.info(`📊 Excel export task created: ${taskId}`)

      // 触发任务处理
      this.processTaskQueue()

      return taskId

    } catch (error) {
      logger.error('❌ Failed to create Excel export task:', error)
      throw error
    }
  }

  /**
   * 获取导出任务状态
   * @param {string} taskId 任务ID
   * @returns {Object|null} 任务状态信息
   */
  getTaskStatus(taskId) {
    const task = this.tasks.get(taskId)
    if (!task) {
      return null
    }

    return {
      taskId: task.id,
      status: task.status,
      progress: task.progress,
      currentStep: task.currentStep,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      result: task.result,
      error: task.error,
      estimatedTime: this._estimateRemainingTime(task)
    }
  }

  /**
   * 取消导出任务
   * @param {string} taskId 任务ID
   * @returns {boolean} 是否成功取消
   */
  cancelTask(taskId) {
    const task = this.tasks.get(taskId)
    if (!task) {
      return false
    }

    if (task.status === 'pending') {
      // 从队列中移除
      const queueIndex = this.taskQueue.findIndex(t => t.id === taskId)
      if (queueIndex !== -1) {
        this.taskQueue.splice(queueIndex, 1)
      }

      task.status = 'cancelled'
      task.error = 'Task cancelled by user'
      logger.info(`📊 Export task cancelled: ${taskId}`)
      return true
    }

    if (task.status === 'processing') {
      // 标记为取消，让处理器检测到
      task.status = 'cancelling'
      logger.info(`📊 Export task marked for cancellation: ${taskId}`)
      return true
    }

    return false
  }

  // ==================== 任务处理器 ====================

  /**
   * 启动任务处理器
   * @private
   */
  startTaskProcessor() {
    setInterval(() => {
      this.processTaskQueue()
    }, 1000) // 每秒检查一次队列
  }

  /**
   * 处理任务队列
   * @private
   */
  async processTaskQueue() {
    // 检查是否有可用的处理槽位
    if (this.processing.size >= this.maxConcurrentTasks) {
      return
    }

    // 获取待处理任务
    const task = this.taskQueue.shift()
    if (!task) {
      return
    }

    // 开始处理任务
    this.processing.set(task.id, task)
    
    try {
      await this._processExportTask(task)
    } catch (error) {
      logger.error(`❌ Export task failed: ${task.id}`, error)
      task.status = 'failed'
      task.error = error.message
      task.completedAt = new Date()
    } finally {
      this.processing.delete(task.id)
      
      // 继续处理队列中的下一个任务
      setTimeout(() => this.processTaskQueue(), 100)
    }
  }

  /**
   * 处理单个导出任务
   * @private
   * @param {Object} task 任务对象
   */
  async _processExportTask(task) {
    const startTime = Date.now()
    
    try {
      task.status = 'processing'
      task.startedAt = new Date()
      task.progress = 0
      
      logger.info(`📊 Starting export task: ${task.id}`)

      // 步骤1: 查询数据 (0-30%)
      task.currentStep = '查询API Keys数据'
      const apiKeysData = await this.queryAdapter.getApiKeysWithStats(
        task.options.keyIds,
        task.options.timeRange
      )
      
      if (task.status === 'cancelling') {
        task.status = 'cancelled'
        return
      }
      
      task.progress = 30

      // 步骤2: 查询使用统计 (30-60%)
      task.currentStep = '聚合使用统计数据'
      const usageData = await this.queryAdapter.getUsageStatistics(
        task.options.keyIds,
        task.options.timeRange
      )
      
      if (task.status === 'cancelling') {
        task.status = 'cancelled'
        return
      }
      
      task.progress = 60

      // 步骤3: 查询成本分析 (60-80%)
      task.currentStep = '计算成本分析数据'
      const costData = await this.queryAdapter.getCostStatistics(
        task.options.keyIds,
        task.options.timeRange
      )
      
      if (task.status === 'cancelling') {
        task.status = 'cancelled'
        return
      }
      
      task.progress = 80

      // 步骤4: 生成Excel文件 (80-100%)
      task.currentStep = '生成Excel文件'
      const exportData = {
        apiKeys: apiKeysData,
        usage: usageData,
        costs: costData,
        options: task.options
      }

      const filePath = await this.formatter.createExcelFile(exportData)
      
      task.progress = 100
      task.status = 'completed'
      task.completedAt = new Date()
      task.currentStep = '导出完成'

      // 生成下载信息
      const fileName = path.basename(filePath)
      const fileSize = fs.statSync(filePath).size
      
      task.result = {
        downloadUrl: `/admin/api-keys/export/download/${fileName}`,
        fileName: fileName,
        fileSize: fileSize,
        exportedCount: apiKeysData.length,
        generatedAt: new Date().toISOString()
      }

      // 更新统计信息
      this.stats.totalExports++
      this.stats.successfulExports++
      this.stats.totalRecordsExported += apiKeysData.length
      
      const exportTime = Date.now() - startTime
      this.stats.averageExportTime = 
        (this.stats.averageExportTime * (this.stats.totalExports - 1) + exportTime) / 
        this.stats.totalExports

      logger.success(`✅ Export task completed: ${task.id}, ${apiKeysData.length} records, ${exportTime}ms`)

    } catch (error) {
      task.status = 'failed'
      task.error = error.message
      task.completedAt = new Date()
      
      this.stats.totalExports++
      this.stats.failedExports++
      
      logger.error(`❌ Export task failed: ${task.id}`, error)
      throw error
    }
  }

  // ==================== 数据验证 ====================

  /**
   * 验证导出选项
   * @private
   * @param {Object} options 导出选项
   * @returns {Object} 验证后的选项
   */
  _validateExportOptions(options) {
    const defaults = {
      keyIds: [],
      timeRange: {
        preset: 'month',
        start: moment().startOf('month').format('YYYY-MM-DD'),
        end: moment().format('YYYY-MM-DD')
      },
      exportOptions: {
        includeBasicInfo: true,
        includeUsageStats: true,
        includeCostAnalysis: true,
        includeModelBreakdown: false,
        includeTrendAnalysis: false
      },
      format: {
        styling: true,
        charts: false,
        pivot: false
      }
    }

    const validated = { ...defaults, ...options }

    // 时间范围处理
    if (validated.timeRange.preset && validated.timeRange.preset !== 'custom') {
      switch (validated.timeRange.preset) {
        case 'today':
          validated.timeRange.start = moment().format('YYYY-MM-DD')
          validated.timeRange.end = moment().format('YYYY-MM-DD')
          break
        case '7days':
          validated.timeRange.start = moment().subtract(7, 'days').format('YYYY-MM-DD')
          validated.timeRange.end = moment().format('YYYY-MM-DD')
          break
        case 'month':
          validated.timeRange.start = moment().startOf('month').format('YYYY-MM-DD')
          validated.timeRange.end = moment().format('YYYY-MM-DD')
          break
      }
    }

    // 日期格式验证
    if (!moment(validated.timeRange.start).isValid() || 
        !moment(validated.timeRange.end).isValid()) {
      throw new Error('Invalid date range')
    }

    // 日期范围验证
    if (moment(validated.timeRange.start).isAfter(moment(validated.timeRange.end))) {
      throw new Error('Start date must be before end date')
    }

    // 时间范围不能超过1年
    if (moment(validated.timeRange.end).diff(moment(validated.timeRange.start), 'days') > 365) {
      throw new Error('Date range cannot exceed 1 year')
    }

    return validated
  }

  /**
   * 估算剩余时间
   * @private
   * @param {Object} task 任务对象
   * @returns {number} 估算剩余秒数
   */
  _estimateRemainingTime(task) {
    if (task.status !== 'processing' || !task.startedAt) {
      return null
    }

    const elapsedTime = Date.now() - task.startedAt.getTime()
    if (task.progress === 0) {
      return null
    }

    const totalEstimatedTime = (elapsedTime / task.progress) * 100
    const remainingTime = Math.max(0, totalEstimatedTime - elapsedTime)
    
    return Math.ceil(remainingTime / 1000) // 转换为秒
  }

  // ==================== 临时文件管理 ====================

  /**
   * 确保临时目录存在
   * @private
   */
  ensureTempDir() {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true })
    }
  }

  /**
   * 启动清理计时器
   * @private
   */
  startCleanupTimer() {
    // 每30分钟清理一次过期文件和任务
    setInterval(() => {
      this.cleanupExpiredTasks()
      this.cleanupTempFiles()
    }, 30 * 60 * 1000)
  }

  /**
   * 清理过期任务
   * @private
   */
  cleanupExpiredTasks() {
    const now = Date.now()
    const maxAge = 2 * 60 * 60 * 1000 // 2小时

    for (const [taskId, task] of this.tasks.entries()) {
      const taskAge = now - task.createdAt.getTime()
      
      if (taskAge > maxAge && 
          (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled')) {
        this.tasks.delete(taskId)
        logger.debug(`🧹 Cleaned up expired task: ${taskId}`)
      }
    }
  }

  /**
   * 清理临时文件
   * @private
   */
  cleanupTempFiles() {
    if (!fs.existsSync(this.tempDir)) {
      return
    }

    const files = fs.readdirSync(this.tempDir)
    const now = Date.now()
    const maxAge = 2 * 60 * 60 * 1000 // 2小时

    for (const file of files) {
      try {
        const filePath = path.join(this.tempDir, file)
        const stats = fs.statSync(filePath)
        
        if (now - stats.mtime.getTime() > maxAge) {
          fs.unlinkSync(filePath)
          logger.debug(`🧹 Cleaned up expired file: ${file}`)
        }
      } catch (error) {
        logger.warn(`⚠️ Failed to cleanup file ${file}:`, error.message)
      }
    }
  }

  // ==================== 统计和监控 ====================

  /**
   * 获取服务统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    return {
      ...this.stats,
      activeTasks: this.tasks.size,
      processingTasks: this.processing.size,
      queuedTasks: this.taskQueue.length,
      successRate: this.stats.totalExports > 0 
        ? (this.stats.successfulExports / this.stats.totalExports * 100).toFixed(2) + '%'
        : '0%'
    }
  }

  /**
   * 获取活跃任务列表
   * @returns {Array} 活跃任务列表
   */
  getActiveTasks() {
    const activeTasks = []
    
    for (const task of this.tasks.values()) {
      if (task.status === 'pending' || task.status === 'processing') {
        activeTasks.push({
          id: task.id,
          status: task.status,
          progress: task.progress,
          currentStep: task.currentStep,
          createdAt: task.createdAt,
          startedAt: task.startedAt
        })
      }
    }
    
    return activeTasks.sort((a, b) => a.createdAt - b.createdAt)
  }

  // ==================== 服务生命周期 ====================

  /**
   * 关闭服务
   */
  async shutdown() {
    logger.info('📊 Shutting down ExcelExportService...')

    // 等待所有正在处理的任务完成
    const maxWaitTime = 30000 // 最多等待30秒
    const waitStart = Date.now()

    while (this.processing.size > 0 && (Date.now() - waitStart) < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    // 强制取消剩余任务
    for (const task of this.processing.values()) {
      task.status = 'cancelled'
      task.error = 'Service shutdown'
    }

    logger.info('📊 ExcelExportService shutdown completed')
  }
}

module.exports = ExcelExportService