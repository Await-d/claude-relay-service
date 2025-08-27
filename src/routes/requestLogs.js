const express = require('express')
const { authenticateAdmin } = require('../middleware/auth')
const database = require('../models/database')
const winston = require('winston')
const fs = require('fs')

const router = express.Router()

// 默认日志配置
const DEFAULT_LOG_CONFIG = {
  retention: 30, // 日志保留天数
  logLevel: 'info', // 日志级别
  enableDetailedLogging: true // 是否启用详细日志
}

// 获取日志配置
router.get('/config', authenticateAdmin, async (req, res) => {
  try {
    const config = (await database.getRequestLogsConfig()) || DEFAULT_LOG_CONFIG

    // 确保返回前端期望的字段格式
    const responseConfig = {
      enabled: config.enabled !== undefined ? config.enabled : false,
      level: config.level || config.logLevel || DEFAULT_LOG_CONFIG.logLevel,
      retentionDays: config.retentionDays || config.retention || DEFAULT_LOG_CONFIG.retention,
      maxFileSize: config.maxFileSize || 10,
      maxFiles: config.maxFiles || 10,
      includeHeaders: config.includeHeaders !== undefined ? config.includeHeaders : true,
      includeBody: config.includeBody !== undefined ? config.includeBody : true,
      includeResponse: config.includeResponse !== undefined ? config.includeResponse : true,
      includeErrors: config.includeErrors !== undefined ? config.includeErrors : true,
      filterSensitiveData:
        config.filterSensitiveData !== undefined ? config.filterSensitiveData : true,
      updatedAt: config.updatedAt || null
    }

    res.json(responseConfig)
  } catch (error) {
    winston.error('获取日志配置错误', { error })
    res.status(500).json({
      error: '获取日志配置失败',
      code: 'LOG_CONFIG_RETRIEVAL_ERROR',
      timestamp: new Date().toISOString()
    })
  }
})

// 更新日志配置 (支持 PUT 和 POST 方法)
const updateConfigHandler = async (req, res) => {
  try {
    const {
      retention,
      logLevel,
      enableDetailedLogging,
      enabled,
      level,
      retentionDays,
      maxFileSize,
      maxFiles,
      includeHeaders,
      includeBody,
      includeResponse,
      includeErrors,
      filterSensitiveData
    } = req.body

    const newConfig = {
      // 兼容老的配置字段名
      retention: retention || retentionDays || DEFAULT_LOG_CONFIG.retention,
      logLevel: logLevel || level || DEFAULT_LOG_CONFIG.logLevel,
      enableDetailedLogging:
        enableDetailedLogging !== undefined
          ? enableDetailedLogging
          : DEFAULT_LOG_CONFIG.enableDetailedLogging,
      // 兼容新的配置字段
      enabled: enabled !== undefined ? enabled : false,
      maxFileSize: maxFileSize || 10,
      maxFiles: maxFiles || 10,
      includeHeaders: includeHeaders !== undefined ? includeHeaders : true,
      includeBody: includeBody !== undefined ? includeBody : true,
      includeResponse: includeResponse !== undefined ? includeResponse : true,
      includeErrors: includeErrors !== undefined ? includeErrors : true,
      filterSensitiveData: filterSensitiveData !== undefined ? filterSensitiveData : true,
      updatedAt: new Date().toISOString()
    }

    await database.setRequestLogsConfig(newConfig)
    res.json(newConfig)
  } catch (error) {
    winston.error('更新日志配置错误', { error })
    res.status(500).json({
      error: '更新日志配置失败',
      code: 'LOG_CONFIG_UPDATE_ERROR',
      timestamp: new Date().toISOString()
    })
  }
}

router.put('/config', authenticateAdmin, updateConfigHandler)
router.post('/config', authenticateAdmin, updateConfigHandler)

// 查询请求日志
router.get('/', authenticateAdmin, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      startDate,
      endDate,
      keyId,
      method,
      status,
      model,
      sortBy = 'timestamp',
      sortOrder = 'desc'
    } = req.query

    const offset = (page - 1) * limit
    const query = {}

    if (keyId) {
      query.keyId = keyId
    }
    if (method) {
      query.method = method
    }
    if (status) {
      query.status = parseInt(status)
    }
    if (model) {
      query.model = model
    }
    if (startDate || endDate) {
      query.timestamp = {}
      if (startDate) {
        query.timestamp.$gte = new Date(startDate).getTime()
      }
      if (endDate) {
        query.timestamp.$lte = new Date(endDate).getTime()
      }
    }

    const logs = await database.searchLogs(query, {
      offset: parseInt(offset),
      limit: parseInt(limit),
      sortBy,
      sortOrder
    })

    const totalLogs = await database.countLogs(query)

    res.json({
      logs,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: totalLogs,
        totalPages: Math.ceil(totalLogs / limit)
      }
    })
  } catch (error) {
    winston.error('查询请求日志错误', { error })
    res.status(500).json({
      error: '查询日志失败',
      code: 'LOG_SEARCH_ERROR',
      timestamp: new Date().toISOString()
    })
  }
})

// 获取特定API Key的日志
router.get('/:keyId', authenticateAdmin, async (req, res) => {
  try {
    const { keyId } = req.params
    const {
      page = 1,
      limit = 20,
      startDate,
      endDate,
      sortBy = 'timestamp',
      sortOrder = 'desc'
    } = req.query

    const offset = (page - 1) * limit
    const query = { keyId }

    if (startDate || endDate) {
      query.timestamp = {}
      if (startDate) {
        query.timestamp.$gte = new Date(startDate).getTime()
      }
      if (endDate) {
        query.timestamp.$lte = new Date(endDate).getTime()
      }
    }

    const logs = await database.searchLogs(query, {
      offset: parseInt(offset),
      limit: parseInt(limit),
      sortBy,
      sortOrder
    })

    const totalLogs = await database.countLogs(query)

    res.json({
      logs,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: totalLogs,
        totalPages: Math.ceil(totalLogs / limit)
      }
    })
  } catch (error) {
    winston.error('获取API Key日志错误', { error })
    res.status(500).json({
      error: '获取日志失败',
      code: 'API_KEY_LOG_RETRIEVAL_ERROR',
      timestamp: new Date().toISOString()
    })
  }
})

// 清理指定API Key的日志
router.delete('/:keyId', authenticateAdmin, async (req, res) => {
  try {
    const { keyId } = req.params
    const deletedLogsCount = await database.deleteLogs({ keyId })

    res.json({
      message: `已成功删除API Key ${keyId} 的所有日志`,
      deletedLogsCount
    })
  } catch (error) {
    winston.error('删除API Key日志错误', { error })
    res.status(500).json({
      error: '删除日志失败',
      code: 'API_KEY_LOG_DELETION_ERROR',
      timestamp: new Date().toISOString()
    })
  }
})

// 日志统计信息
router.get('/stats', authenticateAdmin, async (req, res) => {
  try {
    const { startDate, endDate } = req.query
    const query = {}

    if (startDate || endDate) {
      query.timestamp = {}
      if (startDate) {
        query.timestamp.$gte = new Date(startDate).getTime()
      }
      if (endDate) {
        query.timestamp.$lte = new Date(endDate).getTime()
      }
    }

    const stats = await database.aggregateLogs(query)
    res.json(stats)
  } catch (error) {
    winston.error('获取日志统计错误', { error })
    res.status(500).json({
      error: '获取统计信息失败',
      code: 'LOG_STATS_ERROR',
      timestamp: new Date().toISOString()
    })
  }
})

// 导出日志
router.post('/export', authenticateAdmin, async (req, res) => {
  try {
    const { startDate, endDate, keyId, format = 'csv' } = req.body

    const query = {}
    if (keyId) {
      query.keyId = keyId
    }
    if (startDate || endDate) {
      query.timestamp = {}
      if (startDate) {
        query.timestamp.$gte = new Date(startDate).getTime()
      }
      if (endDate) {
        query.timestamp.$lte = new Date(endDate).getTime()
      }
    }

    const exportFileName = `request_logs_${Date.now()}.${format}`
    const exportPath = await database.exportLogs(query, format, exportFileName)

    // 发送文件
    res.download(exportPath, exportFileName, (err) => {
      if (err) {
        winston.error('日志导出下载错误', { error: err })
        res.status(500).json({
          error: '导出日志失败',
          code: 'LOG_EXPORT_ERROR',
          timestamp: new Date().toISOString()
        })
      }

      // 可选：在一段时间后删除导出的文件
      setTimeout(
        () => {
          try {
            fs.unlinkSync(exportPath)
          } catch (cleanupError) {
            winston.warn('导出文件清理错误', { error: cleanupError })
          }
        },
        30 * 60 * 1000
      ) // 30分钟后删除
    })
  } catch (error) {
    winston.error('导出日志错误', { error })
    res.status(500).json({
      error: '导出日志失败',
      code: 'LOG_EXPORT_ERROR',
      timestamp: new Date().toISOString()
    })
  }
})

// 清理日志数据
router.post('/cleanup', authenticateAdmin, async (req, res) => {
  try {
    const { days = 30 } = req.body
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - days)

    // 删除过期的日志记录
    const deletedCount = await database.deleteExpiredLogs(cutoffDate.toISOString())

    winston.info('日志清理完成', {
      deletedCount,
      cutoffDate: cutoffDate.toISOString()
    })

    res.json({
      success: true,
      deletedCount,
      cutoffDate: cutoffDate.toISOString(),
      message: `成功清理 ${deletedCount} 条过期日志`
    })
  } catch (error) {
    winston.error('清理日志错误', { error })
    res.status(500).json({
      error: '清理日志失败',
      code: 'LOG_CLEANUP_ERROR',
      timestamp: new Date().toISOString()
    })
  }
})

module.exports = router
