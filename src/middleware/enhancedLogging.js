/**
 * @fileoverview 增强日志集成模块 - 将Headers过滤集成到现有中间件
 *
 * 这个模块提供了与现有系统无缝集成的增强日志功能
 * 可以作为现有日志记录的补充或替代方案
 *
 * @author Claude Code
 * @version 1.0.0
 */

const logger = require('../utils/logger')
const { enhancedLogService } = require('../services/EnhancedLogService')

/**
 * 增强日志中间件
 *
 * 这个中间件可以集成到现有的请求处理流程中
 * 提供Headers过滤和详细信息记录功能
 */
class EnhancedLogMiddleware {
  constructor(options = {}) {
    this.options = {
      enableHeadersCapture: options.enableHeadersCapture !== false,
      enableTokenDetails: options.enableTokenDetails !== false,
      enableCostDetails: options.enableCostDetails !== false,
      async: options.async !== false, // 默认异步处理
      ...options
    }

    this.pendingLogs = new Map() // 存储待完成的日志记录
  }

  /**
   * 请求开始时的中间件
   * 捕获请求信息和Headers
   */
  captureRequest = (req, res, next) => {
    // 初始化增强日志上下文
    req._enhancedLogContext = {
      startTime: Date.now(),
      requestId:
        req._logContext?.requestId ||
        `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      capturedHeaders: {},
      tokenDetails: {},
      costDetails: {}
    }

    // 捕获请求Headers (如果启用)
    if (this.options.enableHeadersCapture) {
      req._enhancedLogContext.capturedHeaders.request = { ...req.headers }
    }

    // 拦截res.setHeader以捕获响应头
    if (this.options.enableHeadersCapture) {
      const originalSetHeader = res.setHeader.bind(res)
      const originalEnd = res.end.bind(res)

      req._enhancedLogContext.capturedHeaders.response = {}

      res.setHeader = function (name, value) {
        req._enhancedLogContext.capturedHeaders.response[name] = value
        return originalSetHeader(name, value)
      }

      // 确保在响应结束前记录所有Headers
      res.end = function (chunk, encoding) {
        // 捕获最终的响应头
        Object.assign(req._enhancedLogContext.capturedHeaders.response, res.getHeaders())
        return originalEnd(chunk, encoding)
      }
    }

    next()
  }

  /**
   * 记录Token详细信息
   * @param {Object} req 请求对象
   * @param {Object} tokenData Token数据
   */
  recordTokenDetails = (req, tokenData) => {
    if (!req._enhancedLogContext || !this.options.enableTokenDetails) {
      return
    }

    req._enhancedLogContext.tokenDetails = {
      ...req._enhancedLogContext.tokenDetails,
      ...tokenData,
      recordedAt: new Date().toISOString()
    }

    logger.debug(`📊 Token details captured for ${req._enhancedLogContext.requestId}:`, tokenData)
  }

  /**
   * 记录费用详细信息
   * @param {Object} req 请求对象
   * @param {Object} costData 费用数据
   */
  recordCostDetails = (req, costData) => {
    if (!req._enhancedLogContext || !this.options.enableCostDetails) {
      return
    }

    req._enhancedLogContext.costDetails = {
      ...req._enhancedLogContext.costDetails,
      ...costData,
      recordedAt: new Date().toISOString()
    }

    logger.debug(`💰 Cost details captured for ${req._enhancedLogContext.requestId}:`, costData)
  }

  /**
   * 完成日志记录
   * @param {Object} req 请求对象
   * @param {Object} res 响应对象
   * @param {Object} baseLogData 基础日志数据
   * @returns {Promise<string|null>} 日志ID
   */
  completeLog = async (req, res, baseLogData) => {
    if (!req._enhancedLogContext) {
      logger.debug('No enhanced log context found, skipping enhanced logging')
      return null
    }

    const context = req._enhancedLogContext
    const responseTime = Date.now() - context.startTime

    try {
      // 构建完整的日志数据
      const enhancedLogData = {
        ...baseLogData,
        requestId: context.requestId,
        responseTime,
        timestamp: context.startTime,
        // 确保基础字段存在
        keyId: baseLogData.keyId || req.apiKey?.id,
        method: baseLogData.method || req.method,
        path: baseLogData.path || req.originalUrl,
        status: baseLogData.status || res.statusCode,
        userAgent: baseLogData.userAgent || req.headers['user-agent'],
        ipAddress: baseLogData.ipAddress || req.ip
      }

      // 异步或同步记录日志
      if (this.options.async) {
        // 异步记录，不阻塞响应
        setImmediate(async () => {
          try {
            const logId = await enhancedLogService.logRequestWithDetails(
              enhancedLogData,
              context.capturedHeaders.request,
              context.capturedHeaders.response,
              context.tokenDetails,
              context.costDetails
            )

            if (logId) {
              logger.debug(`📝 Enhanced log recorded asynchronously: ${logId}`)
            }
          } catch (error) {
            logger.error('❌ Async enhanced logging failed:', error.message)
          }
        })
        return null
      } else {
        // 同步记录
        const logId = await enhancedLogService.logRequestWithDetails(
          enhancedLogData,
          context.capturedHeaders.request,
          context.capturedHeaders.response,
          context.tokenDetails,
          context.costDetails
        )

        return logId
      }
    } catch (error) {
      logger.error('❌ Enhanced logging failed:', error.message)
      return null
    } finally {
      // 清理上下文以释放内存
      delete req._enhancedLogContext
    }
  }

  /**
   * 获取中间件统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    return {
      middleware: {
        options: this.options,
        pendingLogsCount: this.pendingLogs.size
      },
      service: enhancedLogService.getStats()
    }
  }

  /**
   * 启用/禁用特定功能
   * @param {string} feature 功能名称
   * @param {boolean} enabled 是否启用
   */
  setFeature(feature, enabled) {
    if (Object.prototype.hasOwnProperty.call(this.options, feature)) {
      this.options[feature] = enabled
      logger.info(
        `🔄 Enhanced log middleware feature '${feature}' ${enabled ? 'enabled' : 'disabled'}`
      )
    }
  }
}

/**
 * 便利函数：为现有中间件添加增强日志功能
 * @param {Function} originalMiddleware 原始中间件
 * @param {Object} options 增强选项
 * @returns {Function} 增强后的中间件
 */
function enhanceExistingMiddleware(originalMiddleware, options = {}) {
  const enhancedMiddleware = new EnhancedLogMiddleware(options)

  return (req, res, next) => {
    // 首先设置增强日志上下文
    enhancedMiddleware.captureRequest(req, res, () => {
      // 然后调用原始中间件
      originalMiddleware(req, res, (error) => {
        if (error) {
          next(error)
          return
        }

        // 在响应完成时自动记录增强日志
        res.once('finish', async () => {
          if (req.apiKey && req._logContext) {
            // 构建基础日志数据
            const baseLogData = {
              keyId: req.apiKey.id,
              method: req.method,
              path: req.originalUrl,
              status: res.statusCode,
              userAgent: req.headers['user-agent'],
              ipAddress: req.ip,
              model: req.body?.model || '',
              tokens: req._tokenUsage?.total || 0,
              inputTokens: req._tokenUsage?.input || 0,
              outputTokens: req._tokenUsage?.output || 0
            }

            await enhancedMiddleware.completeLog(req, res, baseLogData)
          }
        })

        next()
      })
    })
  }
}

/**
 * Express中间件工厂函数
 * @param {Object} options 配置选项
 * @returns {Object} 中间件对象
 */
function createEnhancedLogMiddleware(options = {}) {
  const middleware = new EnhancedLogMiddleware(options)

  return {
    // 请求捕获中间件
    capture: middleware.captureRequest,

    // 工具方法
    recordTokens: middleware.recordTokenDetails,
    recordCosts: middleware.recordCostDetails,
    complete: middleware.completeLog,

    // 管理方法
    getStats: middleware.getStats.bind(middleware),
    setFeature: middleware.setFeature.bind(middleware)
  }
}

module.exports = {
  EnhancedLogMiddleware,
  enhanceExistingMiddleware,
  createEnhancedLogMiddleware,
  enhancedLogService
}
