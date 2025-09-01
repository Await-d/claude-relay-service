const express = require('express')
const { authenticateAdmin } = require('../middleware/auth')
const database = require('../models/database')
const winston = require('winston')
const fs = require('fs')
const { requestLogger } = require('../services/requestLoggerService')

const router = express.Router()

// 默认日志配置
const DEFAULT_LOG_CONFIG = {
  retention: 30, // 日志保留天数
  logLevel: 'info', // 日志级别
  enableDetailedLogging: true // 是否启用详细日志
}

/**
 * 获取日志配置处理器 - 包含实时状态信息
 *
 * 返回数据包括：
 * 1. 完整的配置信息
 * 2. 实时的服务状态
 * 3. 性能指标概要
 *
 * @param {Object} req Express请求对象
 * @param {Object} res Express响应对象
 * @returns {Promise<void>}
 */
router.get('/config', authenticateAdmin, async (req, res) => {
  try {
    const legacyConfig = (await database.getRequestLogsConfig()) || DEFAULT_LOG_CONFIG
    // 2. 从动态配置系统获取最新状态
    let dynamicEnabled = legacyConfig.enabled
    try {
      const { dynamicConfigManager } = require('../services/dynamicConfigService')
      // 优先使用动态配置系统的enabled状态
      const currentEnabled = await dynamicConfigManager.getConfig('requestLogging.enabled')
      if (currentEnabled !== undefined) {
        dynamicEnabled = currentEnabled
      }
    } catch (dynamicError) {
      winston.warn('⚠️ Failed to get dynamic config, using legacy config:', dynamicError.message)
    }

    // 3. 构建响应配置，优先使用动态配置的enabled状态
    const responseConfig = {
      enabled: dynamicEnabled,
      level: legacyConfig.level || legacyConfig.logLevel || DEFAULT_LOG_CONFIG.logLevel,
      retentionDays:
        legacyConfig.retentionDays || legacyConfig.retention || DEFAULT_LOG_CONFIG.retention,
      maxFileSize: legacyConfig.maxFileSize || 10,
      maxFiles: legacyConfig.maxFiles || 10,
      includeHeaders:
        legacyConfig.includeHeaders !== undefined ? legacyConfig.includeHeaders : true,
      includeBody: legacyConfig.includeBody !== undefined ? legacyConfig.includeBody : true,
      includeResponse:
        legacyConfig.includeResponse !== undefined ? legacyConfig.includeResponse : true,
      includeErrors: legacyConfig.includeErrors !== undefined ? legacyConfig.includeErrors : true,
      filterSensitiveData:
        legacyConfig.filterSensitiveData !== undefined ? legacyConfig.filterSensitiveData : true,
      updatedAt: legacyConfig.updatedAt || null
    }

    // 获取实时服务状态
    const serviceStatus = {
      available: false,
      currentlyEnabled: false,
      supportsHotReload: false,
      metrics: null
    }

    try {
      if (requestLogger) {
        serviceStatus.available = true
        serviceStatus.supportsHotReload = typeof requestLogger.reloadConfig === 'function'

        if (typeof requestLogger.isCurrentlyEnabled === 'function') {
          serviceStatus.currentlyEnabled = requestLogger.isCurrentlyEnabled()
        }

        if (typeof requestLogger.getMetrics === 'function') {
          const metrics = requestLogger.getMetrics()
          serviceStatus.metrics = {
            enabled: metrics.enabled,
            queueLength: metrics.queue?.length || 0,
            uptime: metrics.uptime?.formatted || 'Unknown',
            totalProcessed: metrics.throughput?.totalWritten || 0
          }
        }
      }
    } catch (statusError) {
      winston.warn('⚠️ Failed to get request logger status:', statusError)
    }

    const response = {
      ...responseConfig,
      serviceStatus,
      timestamp: new Date().toISOString()
    }
    res.json({
      success: true,
      data: response
    })
  } catch (error) {
    winston.error('获取日志配置错误', { error })
    res.status(500).json({
      error: '获取日志配置失败',
      code: 'LOG_CONFIG_RETRIEVAL_ERROR',
      timestamp: new Date().toISOString()
    })
  }
})

/**
 * 更新日志配置处理器 - 支持热重载
 *
 * 主要功能：
 * 1. 验证和标准化配置参数
 * 2. 保存配置到Redis
 * 3. 触发requestLoggerService热重载
 * 4. 返回详细的操作结果状态
 *
 * @param {Object} req Express请求对象
 * @param {Object} res Express响应对象
 * @returns {Promise<void>}
 */
const updateConfigHandler = async (req, res) => {
  let savedConfig = null

  try {
    // 1. 提取和验证配置参数
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

    // 2. 构建标准化配置对象
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

    winston.info('📝 Updating request logs configuration:', {
      enabled: newConfig.enabled,
      logLevel: newConfig.logLevel,
      retention: newConfig.retention
    })

    // 3. 保存配置到Redis（传统方式）
    await database.setRequestLogsConfig(newConfig)
    savedConfig = newConfig

    // 4. 同步保存到动态配置系统（新方式）
    try {
      const { dynamicConfigManager } = require('../services/dynamicConfigService')

      // 将传统配置字段映射到动态配置格式
      await dynamicConfigManager.setConfig('requestLogging.enabled', newConfig.enabled)

      if (newConfig.logLevel) {
        await dynamicConfigManager.setConfig(
          'requestLogging.mode',
          newConfig.logLevel === 'debug' ? 'detailed' : 'basic'
        )
      }

      winston.info('✅ Configuration synchronized to dynamic config system')
    } catch (syncError) {
      winston.error('❌ Failed to sync to dynamic config system:', syncError)
      // 不中断主流程，但记录错误
    }

    // 4. 触发requestLoggerService热重载（异步非阻塞）
    let reloadResult = { success: false, message: 'Hot reload not attempted' }

    try {
      if (requestLogger && typeof requestLogger.reloadConfig === 'function') {
        winston.debug('🔄 Triggering request logger hot reload...')
        reloadResult = await requestLogger.reloadConfig(newConfig)
        winston.info('🔄 Request logger hot reload result:', {
          success: reloadResult.success,
          statusChange: reloadResult.statusChange
        })
      } else {
        winston.warn('⚠️ Request logger service not available for hot reload')
        reloadResult = {
          success: false,
          message: 'Request logger service not available',
          requiresRestart: true
        }
      }
    } catch (reloadError) {
      winston.error('❌ Request logger hot reload failed:', reloadError)
      reloadResult = {
        success: false,
        error: reloadError.message,
        requiresRestart: true
      }
    }

    // 5. 构建响应数据
    const response = {
      ...newConfig,
      hotReload: {
        attempted: true,
        ...reloadResult
      },
      operationSuccess: true,
      message: reloadResult.success
        ? '配置已更新并成功热重载'
        : '配置已保存，但热重载失败，可能需要重启服务'
    }

    res.json(response)
  } catch (error) {
    winston.error('❌ Failed to update request logs configuration:', error)

    // 构建详细的错误响应
    const errorResponse = {
      error: '更新日志配置失败',
      code: 'LOG_CONFIG_UPDATE_ERROR',
      timestamp: new Date().toISOString(),
      details: error.message,
      savedConfig, // 显示是否至少保存了配置
      hotReload: {
        attempted: false,
        message: 'Hot reload skipped due to configuration save failure'
      }
    }

    res.status(500).json(errorResponse)
  }
}

router.put('/config', authenticateAdmin, updateConfigHandler)
router.post('/config', authenticateAdmin, updateConfigHandler)

/**
 * 触发配置热重载的测试端点
 *
 * 此端点专门用于测试配置热重载功能，不更改配置，
 * 只是重新加载现有配置到运行中的服务
 *
 * @route POST /admin/request-logs/reload
 */
router.post('/reload', authenticateAdmin, async (req, res) => {
  try {
    winston.info('🔄 Manual hot reload requested for request logger configuration')

    // 检查服务可用性
    if (!requestLogger) {
      return res.status(503).json({
        success: false,
        error: 'Request logger service not available',
        message: '请求日志服务不可用',
        timestamp: new Date().toISOString()
      })
    }

    if (typeof requestLogger.reloadConfig !== 'function') {
      return res.status(503).json({
        success: false,
        error: 'Hot reload not supported',
        message: '当前服务版本不支持热重载功能',
        timestamp: new Date().toISOString()
      })
    }

    // 获取当前配置
    const currentConfig = await database.getRequestLogsConfig()
    if (!currentConfig) {
      return res.status(404).json({
        success: false,
        error: 'No configuration found',
        message: '未找到要重载的配置',
        timestamp: new Date().toISOString()
      })
    }

    // 执行热重载
    winston.debug('🔄 Performing manual hot reload with config:', {
      enabled: currentConfig.enabled,
      configKeys: Object.keys(currentConfig)
    })

    const reloadResult = await requestLogger.reloadConfig(currentConfig)

    const response = {
      success: reloadResult.success,
      message: reloadResult.success ? '配置热重载成功完成' : '配置热重载失败',
      reloadResult,
      configReloaded: currentConfig,
      timestamp: new Date().toISOString()
    }

    if (reloadResult.success) {
      winston.info('✅ Manual hot reload completed successfully')
      res.json(response)
    } else {
      winston.error('❌ Manual hot reload failed:', reloadResult.error)
      res.status(500).json(response)
    }
  } catch (error) {
    winston.error('❌ Manual hot reload error:', error)
    res.status(500).json({
      success: false,
      error: error.message,
      message: '热重载过程中发生错误',
      timestamp: new Date().toISOString()
    })
  }
})

/**
 * 获取详细的服务状态信息
 *
 * 提供请求日志服务的完整状态信息，包括：
 * - 服务可用性和配置状态
 * - 实时性能指标
 * - 队列状态和处理统计
 * - 采样器状态
 *
 * @route GET /admin/request-logs/status
 */
router.get('/status', authenticateAdmin, async (req, res) => {
  try {
    winston.debug('📊 Request logger status requested')

    const status = {
      timestamp: new Date().toISOString(),
      service: {
        available: false,
        initialized: false,
        supportsHotReload: false,
        version: 'unknown'
      },
      configuration: {
        stored: null,
        loaded: null,
        synchronized: false
      },
      runtime: {
        enabled: false,
        metrics: null,
        errors: []
      }
    }

    // 检查存储的配置
    try {
      status.configuration.stored = await database.getRequestLogsConfig()
    } catch (configError) {
      status.runtime.errors.push({
        type: 'configuration_retrieval',
        message: configError.message,
        timestamp: new Date().toISOString()
      })
    }

    // 检查服务状态
    try {
      if (requestLogger) {
        status.service.available = true
        status.service.initialized = true
        status.service.supportsHotReload = typeof requestLogger.reloadConfig === 'function'

        // 检查当前启用状态
        if (typeof requestLogger.isCurrentlyEnabled === 'function') {
          status.runtime.enabled = requestLogger.isCurrentlyEnabled()
        }

        // 获取详细指标
        if (typeof requestLogger.getMetrics === 'function') {
          status.runtime.metrics = requestLogger.getMetrics()
        }

        // 检查配置同步状态
        if (status.configuration.stored) {
          const storedEnabled = status.configuration.stored.enabled !== false
          status.configuration.synchronized = storedEnabled === status.runtime.enabled
        }
      } else {
        status.runtime.errors.push({
          type: 'service_unavailable',
          message: 'Request logger service instance not found',
          timestamp: new Date().toISOString()
        })
      }
    } catch (serviceError) {
      status.runtime.errors.push({
        type: 'service_error',
        message: serviceError.message,
        timestamp: new Date().toISOString()
      })
    }

    // 基于状态设置HTTP状态码
    let httpStatus = 200
    if (!status.service.available) {
      httpStatus = 503
    } else if (status.runtime.errors.length > 0) {
      httpStatus = 206 // Partial Content - 部分功能异常
    }

    res.status(httpStatus).json(status)
  } catch (error) {
    winston.error('❌ Failed to get request logger status:', error)
    res.status(500).json({
      error: '获取服务状态失败',
      message: error.message,
      timestamp: new Date().toISOString()
    })
  }
})

// 日志统计信息 - 必须放在 /:keyId 路由之前，避免路由冲突
router.get('/stats', authenticateAdmin, async (req, res) => {
  try {
    const { startDate, endDate, search } = req.query
    const query = {}
    if (search) {
      query.search = search
    }
    if (startDate || endDate) {
      query.dateRange = {}
      if (startDate) {
        query.dateRange.start = startDate
      }
      if (endDate) {
        query.dateRange.end = endDate
      }
    }
    const stats = await database.aggregateLogs(query)
    res.json({
      success: true,
      data: stats
    })
  } catch (error) {
    winston.error('获取日志统计错误', { error })
    res.status(500).json({
      success: false,
      error: '获取统计信息失败',
      code: 'LOG_STATS_ERROR',
      timestamp: new Date().toISOString()
    })
  }
})

// 查询请求日志（增强版本）
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
      search,
      sortBy = 'timestamp',
      sortOrder = 'desc',
      enhancedStats = 'true' // 新增参数
    } = req.query

    const offset = (page - 1) * limit
    const query = {}

    // 🔍 调试：检查Redis中的键
    winston.info('🔍 DEBUGGING: Query request logs with params:', {
      page,
      limit,
      keyId,
      method,
      status,
      model,
      search,
      sortBy,
      sortOrder,
      enhancedStats
    })

    // 🔍 调试：检查Redis中存在的键
    try {
      const client = database.getClient()
      if (client) {
        const allKeys = await client.keys('*request*log*')
        winston.info('🔍 DEBUGGING: Found Redis keys matching *request*log*:', {
          count: allKeys.length,
          keys: allKeys.slice(0, 10), // 只显示前10个
          patterns: [...new Set(allKeys.map((key) => key.split(':').slice(0, 2).join(':')))]
        })

        // 检查具体的键模式
        const requestLogKeys = await client.keys('request_log:*')
        winston.info('🔍 DEBUGGING: Found Redis keys matching request_log:*:', {
          count: requestLogKeys.length,
          keys: requestLogKeys.slice(0, 5)
        })
      }
    } catch (debugError) {
      winston.warn('🔍 DEBUGGING: Failed to check Redis keys:', debugError.message)
    }

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
    if (search) {
      query.search = search
    }
    if (startDate || endDate) {
      query.dateRange = {}
      if (startDate) {
        query.dateRange.start = startDate
      }
      if (endDate) {
        query.dateRange.end = endDate
      }
    }

    const logs = await database.searchLogs(query, {
      offset: parseInt(offset),
      limit: parseInt(limit),
      sortBy,
      sortOrder,
      includeEnhancedStats: enhancedStats === 'true' // 启用增强统计
    })

    const totalLogs = await database.countLogs(query)

    // 为每个日志添加增强的简化统计信息和标志（主日志列表）
    const enhancedLogs = logs.map((log) => {
      // 增强的tokenSummary（支持缓存token）
      if (!log.tokenSummary) {
        log.tokenSummary = {
          totalTokens: log.totalTokens || log.tokens || 0,
          inputTokens: log.inputTokens || 0,
          outputTokens: log.outputTokens || 0,
          cacheCreateTokens: log.cacheCreateTokens || 0, // 新增
          cacheReadTokens: log.cacheReadTokens || 0, // 新增
          cost: log.cost || 0,
          efficiency: 0 // 计算token效率
        }

        // 计算token使用效率
        if (log.tokenSummary.totalTokens > 0) {
          log.tokenSummary.efficiency = parseFloat(
            ((log.tokenSummary.outputTokens / log.tokenSummary.totalTokens) * 100).toFixed(2)
          )
        }
      }

      // 增强的headers检查
      if (log.hasHeaders === undefined) {
        const hasRequestHeaders = !!(
          log.requestHeaders &&
          typeof log.requestHeaders === 'object' &&
          Object.keys(log.requestHeaders).length > 0
        )
        const hasResponseHeaders = !!(
          log.responseHeaders &&
          typeof log.responseHeaders === 'object' &&
          Object.keys(log.responseHeaders).length > 0
        )
        log.hasHeaders = hasRequestHeaders || hasResponseHeaders

        // 添加详细的header统计
        log.headerStats = {
          requestCount: hasRequestHeaders ? Object.keys(log.requestHeaders).length : 0,
          responseCount: hasResponseHeaders ? Object.keys(log.responseHeaders).length : 0,
          totalCount:
            (hasRequestHeaders ? Object.keys(log.requestHeaders).length : 0) +
            (hasResponseHeaders ? Object.keys(log.responseHeaders).length : 0)
        }
      }

      // 增强的body检查
      if (log.hasBody === undefined) {
        const hasRequestBody = !!(log.requestBody && log.requestBody.trim().length > 0)
        const hasResponseBody = !!(log.responseBody && log.responseBody.trim().length > 0)
        log.hasBody = hasRequestBody || hasResponseBody

        // 添加body大小统计（仅在有body时计算）
        if (hasRequestBody || hasResponseBody) {
          log.bodyStats = {
            requestSize: hasRequestBody ? log.requestBody.length : 0,
            responseSize: hasResponseBody ? log.responseBody.length : 0,
            totalSize:
              (hasRequestBody ? log.requestBody.length : 0) +
              (hasResponseBody ? log.responseBody.length : 0)
          }
        }
      }

      // 增强的错误分类
      if (log.isError === undefined) {
        const statusCode = log.status || 0
        log.isError = statusCode >= 400

        // 详细的状态分类
        log.statusCategory =
          statusCode >= 500
            ? 'server_error'
            : statusCode >= 400
              ? 'client_error'
              : statusCode >= 300
                ? 'redirect'
                : statusCode >= 200
                  ? 'success'
                  : 'unknown'
      }

      // 增强的时间信息
      if (log.dateTime === undefined) {
        log.dateTime = log.timestamp ? new Date(parseInt(log.timestamp)).toISOString() : null
      }

      // 性能分析
      const responseTime = log.duration || log.responseTime || 0
      log.performanceLevel =
        responseTime > 10000
          ? 'very_slow'
          : responseTime > 5000
            ? 'slow'
            : responseTime > 1000
              ? 'normal'
              : 'fast'

      // 标准化必要字段
      log.duration = responseTime
      log.model = log.model || 'unknown'
      log.method = log.method || 'POST'
      log.path = log.path || '/unknown'

      // 添加数据完整性标志
      log.dataCompleteness = {
        hasAllBasicFields: !!(log.keyId && log.timestamp && log.status && log.model),
        hasPerformanceData: !!(responseTime && responseTime > 0),
        hasTokenData: !!(log.tokenSummary.totalTokens > 0),
        hasCostData: !!(log.cost && log.cost > 0),
        completenessScore: 0
      }

      // 计算完整性评分
      const completenessChecks = Object.values(log.dataCompleteness).slice(0, 4)
      log.dataCompleteness.completenessScore = (
        (completenessChecks.filter(Boolean).length / completenessChecks.length) *
        100
      ).toFixed(0)

      return log
    })

    res.json({
      success: true,
      data: {
        logs: enhancedLogs,
        page: Number(page),
        limit: Number(limit),
        total: totalLogs,
        totalPages: Math.ceil(totalLogs / limit),
        enhancedStats: enhancedStats === 'true' // 返回是否启用了增强统计
      }
    })
  } catch (error) {
    winston.error('查询请求日志错误', { error })
    res.status(500).json({
      success: false,
      error: '查询日志失败',
      code: 'LOG_SEARCH_ERROR',
      timestamp: new Date().toISOString()
    })
  }
})

// 获取单个日志的详细信息（增强版本）
router.get('/:logId/details', authenticateAdmin, async (req, res) => {
  try {
    const { logId } = req.params

    // 参数验证和格式化
    if (!logId || logId.trim() === '') {
      return res.status(400).json({
        success: false,
        error: '无效的日志ID',
        code: 'INVALID_LOG_ID',
        message: '日志ID不能为空或包含无效字符',
        timestamp: new Date().toISOString()
      })
    }

    // 支持多种logId格式的识别和转换
    const normalizedLogId = logId.trim()
    winston.debug('获取日志详情请求', {
      originalLogId: logId,
      normalizedLogId,
      requestIP: req.ip || req.connection.remoteAddress
    })

    // 从数据库获取日志详情（使用增强的方法）
    const logDetails = await database.getRequestLogDetails(normalizedLogId)

    if (!logDetails) {
      return res.status(404).json({
        success: false,
        error: '日志不存在',
        code: 'LOG_NOT_FOUND',
        message: `未找到ID为 ${normalizedLogId} 的日志记录，请检查日志ID是否正确`,
        searchTips: [
          '确保日志ID格式正确（如: request_log:keyId:timestamp 或 keyId:timestamp）',
          '检查日志是否已过期或被清理',
          '验证您有权限查看此日志记录'
        ],
        timestamp: new Date().toISOString()
      })
    }

    // 增强的token统计信息
    const tokenSummary = {
      totalTokens: logDetails.totalTokens || logDetails.tokens || 0,
      inputTokens: logDetails.inputTokens || 0,
      outputTokens: logDetails.outputTokens || 0,
      cacheCreateTokens: logDetails.cacheCreateTokens || 0, // 新增缓存Token
      cacheReadTokens: logDetails.cacheReadTokens || 0, // 新增缓存Token
      cost: logDetails.cost || 0,
      costBreakdown: logDetails.costDetails || null // 详细费用分解
    }

    // 增强的header分析
    const headerAnalysis = {
      requestHeaders: {
        count: logDetails.requestHeaders ? Object.keys(logDetails.requestHeaders).length : 0,
        hasUserAgent: !!(
          logDetails.requestHeaders?.['user-agent'] || logDetails.requestHeaders?.['User-Agent']
        ),
        hasContentType: !!(
          logDetails.requestHeaders?.['content-type'] || logDetails.requestHeaders?.['Content-Type']
        ),
        hasAuthorization: !!(
          logDetails.requestHeaders?.['authorization'] ||
          logDetails.requestHeaders?.['Authorization']
        ),
        size: logDetails.requestHeaders ? JSON.stringify(logDetails.requestHeaders).length : 0
      },
      responseHeaders: {
        count: logDetails.responseHeaders ? Object.keys(logDetails.responseHeaders).length : 0,
        hasContentType: !!(
          logDetails.responseHeaders?.['content-type'] ||
          logDetails.responseHeaders?.['Content-Type']
        ),
        hasServer: !!(
          logDetails.responseHeaders?.['server'] || logDetails.responseHeaders?.['Server']
        ),
        size: logDetails.responseHeaders ? JSON.stringify(logDetails.responseHeaders).length : 0
      }
    }

    // 性能和错误分析
    const performanceAnalysis = {
      responseTimeMs: logDetails.responseTime || logDetails.duration || 0,
      isSlowRequest: (logDetails.responseTime || logDetails.duration || 0) > 5000, // 超过5秒
      tokenEfficiency:
        tokenSummary.totalTokens > 0
          ? ((tokenSummary.outputTokens / tokenSummary.totalTokens) * 100).toFixed(2)
          : '0.00',
      errorCategory:
        logDetails.status >= 500
          ? 'server_error'
          : logDetails.status >= 400
            ? 'client_error'
            : 'success'
    }

    // 构建增强的响应数据
    const responseData = {
      ...logDetails,
      logId: logDetails.logId || normalizedLogId,

      // 核心统计信息
      tokenSummary,

      // 详细分析信息
      headerAnalysis,
      performanceAnalysis,

      // 元数据标志
      metadata: {
        retrievedAt: new Date().toISOString(),

        // 数据可用性标志
        hasRequestHeaders: headerAnalysis.requestHeaders.count > 0,
        hasResponseHeaders: headerAnalysis.responseHeaders.count > 0,
        hasRequestBody: !!(logDetails.requestBody && logDetails.requestBody.trim().length > 0),
        hasResponseBody: !!(logDetails.responseBody && logDetails.responseBody.trim().length > 0),
        hasTokenDetails: !!(
          logDetails.tokenDetails && Object.keys(logDetails.tokenDetails || {}).length > 0
        ),
        hasCostDetails: !!(
          logDetails.costDetails && Object.keys(logDetails.costDetails || {}).length > 0
        ),

        // 数据完整性标志
        isComplete: !!(
          logDetails.requestHeaders &&
          logDetails.responseHeaders &&
          logDetails.tokenSummary
        ),
        hasError: logDetails.status >= 400,

        // 数据大小信息
        dataSize: {
          requestBodySize: logDetails.requestBody ? logDetails.requestBody.length : 0,
          responseBodySize: logDetails.responseBody ? logDetails.responseBody.length : 0,
          headersSize: headerAnalysis.requestHeaders.size + headerAnalysis.responseHeaders.size
        }
      }
    }

    winston.info('成功返回日志详情', {
      logId: normalizedLogId,
      hasHeaders:
        responseData.metadata.hasRequestHeaders || responseData.metadata.hasResponseHeaders,
      hasBody: responseData.metadata.hasRequestBody || responseData.metadata.hasResponseBody,
      tokenCount: tokenSummary.totalTokens,
      performanceMs: performanceAnalysis.responseTimeMs,
      errorCategory: performanceAnalysis.errorCategory
    })

    res.json({
      success: true,
      data: responseData,
      message: '日志详情获取成功',
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    winston.error('获取日志详情错误', {
      logId: req.params.logId,
      error: error.message,
      stack: error.stack
    })

    res.status(500).json({
      success: false,
      error: '获取日志详情失败',
      code: 'LOG_DETAILS_RETRIEVAL_ERROR',
      message: error.message || '内部服务器错误，请稍后重试',
      timestamp: new Date().toISOString()
    })
  }
})

// 获取特定API Key的日志（增强版本）
router.get('/:keyId', authenticateAdmin, async (req, res) => {
  try {
    const { keyId } = req.params
    const {
      page = 1,
      limit = 20,
      startDate,
      endDate,
      search,
      sortBy = 'timestamp',
      sortOrder = 'desc',
      enhancedStats = 'true' // 新增参数
    } = req.query

    const offset = (page - 1) * limit
    const query = { keyId }

    if (search) {
      query.search = search
    }
    if (startDate || endDate) {
      query.dateRange = {}
      if (startDate) {
        query.dateRange.start = startDate
      }
      if (endDate) {
        query.dateRange.end = endDate
      }
    }

    const logs = await database.searchLogs(query, {
      offset: parseInt(offset),
      limit: parseInt(limit),
      sortBy,
      sortOrder,
      includeEnhancedStats: enhancedStats === 'true' // 启用增强统计
    })

    const totalLogs = await database.countLogs(query)

    // 为每个日志添加增强的简化统计信息和标志（API Key专用日志）
    const enhancedLogs = logs.map((log) => {
      // 增强的tokenSummary（支持缓存token）
      if (!log.tokenSummary) {
        log.tokenSummary = {
          totalTokens: log.totalTokens || log.tokens || 0,
          inputTokens: log.inputTokens || 0,
          outputTokens: log.outputTokens || 0,
          cacheCreateTokens: log.cacheCreateTokens || 0, // 新增
          cacheReadTokens: log.cacheReadTokens || 0, // 新增
          cost: log.cost || 0,
          efficiency: 0 // 计算token效率
        }

        // 计算token使用效率
        if (log.tokenSummary.totalTokens > 0) {
          log.tokenSummary.efficiency = parseFloat(
            ((log.tokenSummary.outputTokens / log.tokenSummary.totalTokens) * 100).toFixed(2)
          )
        }
      }

      // 增强的headers检查
      if (log.hasHeaders === undefined) {
        const hasRequestHeaders = !!(
          log.requestHeaders &&
          typeof log.requestHeaders === 'object' &&
          Object.keys(log.requestHeaders).length > 0
        )
        const hasResponseHeaders = !!(
          log.responseHeaders &&
          typeof log.responseHeaders === 'object' &&
          Object.keys(log.responseHeaders).length > 0
        )
        log.hasHeaders = hasRequestHeaders || hasResponseHeaders

        // 添加详细的header统计
        log.headerStats = {
          requestCount: hasRequestHeaders ? Object.keys(log.requestHeaders).length : 0,
          responseCount: hasResponseHeaders ? Object.keys(log.responseHeaders).length : 0,
          totalCount:
            (hasRequestHeaders ? Object.keys(log.requestHeaders).length : 0) +
            (hasResponseHeaders ? Object.keys(log.responseHeaders).length : 0)
        }
      }

      // 增强的body检查
      if (log.hasBody === undefined) {
        const hasRequestBody = !!(log.requestBody && log.requestBody.trim().length > 0)
        const hasResponseBody = !!(log.responseBody && log.responseBody.trim().length > 0)
        log.hasBody = hasRequestBody || hasResponseBody

        // 添加body大小统计（仅在有body时计算）
        if (hasRequestBody || hasResponseBody) {
          log.bodyStats = {
            requestSize: hasRequestBody ? log.requestBody.length : 0,
            responseSize: hasResponseBody ? log.responseBody.length : 0,
            totalSize:
              (hasRequestBody ? log.requestBody.length : 0) +
              (hasResponseBody ? log.responseBody.length : 0)
          }
        }
      }

      // 增强的错误分类
      if (log.isError === undefined) {
        const statusCode = log.status || 0
        log.isError = statusCode >= 400

        // 详细的状态分类
        log.statusCategory =
          statusCode >= 500
            ? 'server_error'
            : statusCode >= 400
              ? 'client_error'
              : statusCode >= 300
                ? 'redirect'
                : statusCode >= 200
                  ? 'success'
                  : 'unknown'
      }

      // 增强的时间信息
      if (log.dateTime === undefined) {
        log.dateTime = log.timestamp ? new Date(parseInt(log.timestamp)).toISOString() : null
      }

      // 性能分析
      const responseTime = log.duration || log.responseTime || 0
      log.performanceLevel =
        responseTime > 10000
          ? 'very_slow'
          : responseTime > 5000
            ? 'slow'
            : responseTime > 1000
              ? 'normal'
              : 'fast'

      // 标准化必要字段
      log.duration = responseTime
      log.model = log.model || 'unknown'
      log.method = log.method || 'POST'
      log.path = log.path || '/unknown'

      // 添加数据完整性标志
      log.dataCompleteness = {
        hasAllBasicFields: !!(log.keyId && log.timestamp && log.status && log.model),
        hasPerformanceData: !!(responseTime && responseTime > 0),
        hasTokenData: !!(log.tokenSummary.totalTokens > 0),
        hasCostData: !!(log.cost && log.cost > 0),
        completenessScore: 0
      }

      // 计算完整性评分
      const completenessChecks = Object.values(log.dataCompleteness).slice(0, 4)
      log.dataCompleteness.completenessScore = (
        (completenessChecks.filter(Boolean).length / completenessChecks.length) *
        100
      ).toFixed(0)

      return log
    })

    res.json({
      success: true,
      data: {
        logs: enhancedLogs,
        page: Number(page),
        limit: Number(limit),
        total: totalLogs,
        totalPages: Math.ceil(totalLogs / limit),
        keyId, // 返回查询的API Key ID
        enhancedStats: enhancedStats === 'true' // 返回是否启用了增强统计
      }
    })
  } catch (error) {
    winston.error('获取API Key日志错误', { keyId: req.params.keyId, error })
    res.status(500).json({
      success: false,
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
      success: true,
      data: {
        deletedLogsCount
      },
      message: `已成功删除API Key ${keyId} 的所有日志`
    })
  } catch (error) {
    winston.error('删除API Key日志错误', { error })
    res.status(500).json({
      success: false,
      error: '删除日志失败',
      code: 'API_KEY_LOG_DELETION_ERROR',
      timestamp: new Date().toISOString()
    })
  }
})

// 导出日志处理函数（支持POST和GET请求）
const exportLogsHandler = async (req, res) => {
  try {
    // 从请求体或查询参数中获取参数
    const params = req.method === 'POST' ? req.body : req.query
    const { startDate, endDate, keyId, format = 'csv', status, method, model } = params

    const query = {}
    if (keyId) {
      query.keyId = keyId
    }
    if (status) {
      query.status = parseInt(status)
    }
    if (method) {
      query.method = method
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

    winston.info('导出日志请求', {
      method: req.method,
      query,
      format,
      userAgent: req.headers['user-agent']?.substring(0, 100)
    })

    const exportFileName = `request_logs_${Date.now()}.${format}`
    const exportPath = await database.exportLogs(query, format, exportFileName)

    // 设置响应头
    res.setHeader('Content-Disposition', `attachment; filename="${exportFileName}"`)
    res.setHeader('Content-Type', format === 'csv' ? 'text/csv' : 'application/json')

    // 发送文件
    res.download(exportPath, exportFileName, (err) => {
      if (err) {
        winston.error('日志导出下载错误', { error: err })
        if (!res.headersSent) {
          res.status(500).json({
            error: '导出日志失败',
            code: 'LOG_EXPORT_ERROR',
            timestamp: new Date().toISOString()
          })
        }
      }

      // 在一段时间后删除导出的文件
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
    if (!res.headersSent) {
      res.status(500).json({
        error: '导出日志失败',
        code: 'LOG_EXPORT_ERROR',
        timestamp: new Date().toISOString()
      })
    }
  }
}

// 同时支持POST和GET请求进行日志导出
router.post('/export', authenticateAdmin, exportLogsHandler)
router.get('/export', authenticateAdmin, exportLogsHandler)

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
      data: {
        deletedCount,
        cutoffDate: cutoffDate.toISOString()
      },
      message: `成功清理 ${deletedCount} 条过期日志`
    })
  } catch (error) {
    winston.error('清理日志错误', { error })
    res.status(500).json({
      success: false,
      error: '清理日志失败',
      code: 'LOG_CLEANUP_ERROR',
      timestamp: new Date().toISOString()
    })
  }
})

module.exports = router
