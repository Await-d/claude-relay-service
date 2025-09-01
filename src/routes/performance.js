/**
 * @fileoverview 性能监控API路由
 *
 * 提供UnifiedLogService的性能数据查询接口
 * 支持实时性能指标、健康状态检查和详细报告
 *
 * @author Claude Code
 * @version 1.0.0
 */

const express = require('express')
const router = express.Router()
const { unifiedLogServiceFactory } = require('../services/UnifiedLogServiceFactory')

/**
 * 获取UnifiedLogService实例（通过工厂）
 * @returns {Promise<UnifiedLogService|null>} 服务实例
 */
async function getUnifiedLogService() {
  try {
    return await unifiedLogServiceFactory.getSingleton()
  } catch (error) {
    console.error('Failed to get UnifiedLogService instance:', error)
    return null
  }
}

/**
 * GET /admin/performance/stats
 * 获取基础性能统计信息
 */
router.get('/stats', async (req, res) => {
  try {
    const logService = await getUnifiedLogService()

    if (!logService) {
      return res.status(503).json({
        error: 'UnifiedLogService not available',
        message: 'Service is not initialized or factory is not ready'
      })
    }

    const stats = logService.getStats()

    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
      timestamp: new Date().toISOString()
    })
  }
})

/**
 * GET /admin/performance/report
 * 获取详细的性能报告
 */
router.get('/report', async (req, res) => {
  try {
    const logService = await getUnifiedLogService()

    if (!logService) {
      return res.status(503).json({
        error: 'UnifiedLogService not available',
        message: 'Service is not initialized or factory is not ready'
      })
    }

    const report = logService.getPerformanceReport()

    res.json({
      success: true,
      data: report,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
      timestamp: new Date().toISOString()
    })
  }
})

/**
 * GET /admin/performance/health
 * 获取服务健康状态
 */
router.get('/health', async (req, res) => {
  try {
    const logService = await getUnifiedLogService()

    if (!logService) {
      return res.status(503).json({
        success: false,
        healthStatus: 'unavailable',
        message: 'UnifiedLogService not available',
        timestamp: new Date().toISOString()
      })
    }

    const stats = logService.getStats()
    const report = logService.getPerformanceReport()

    // 构建健康检查响应
    const healthData = {
      healthStatus: stats.healthStatus,
      uptime: Date.now() - stats.lastResetTime,
      successRate: stats.successRate,
      averageResponseTime: stats.averageProcessingTime,
      currentQps: report.qps.current,
      memoryUsageMB: report.memory.heapUsedMB,
      totalRequests: stats.totalRequests,
      failedLogs: stats.failedLogs
    }

    // 根据健康状态设置HTTP状态码
    let httpStatusCode = 200
    if (stats.healthStatus === 'degraded') {
      httpStatusCode = 206 // Partial Content
    } else if (stats.healthStatus === 'unhealthy') {
      httpStatusCode = 503 // Service Unavailable
    }

    res.status(httpStatusCode).json({
      success: stats.healthStatus !== 'unhealthy',
      data: healthData,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      healthStatus: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    })
  }
})

/**
 * GET /admin/performance/metrics
 * 获取实时指标（轻量级）
 */
router.get('/metrics', async (req, res) => {
  try {
    const logService = await getUnifiedLogService()

    if (!logService) {
      return res.status(503).json({
        error: 'Service unavailable',
        timestamp: new Date().toISOString()
      })
    }

    const stats = logService.getStats()

    // 提取关键实时指标
    const metrics = {
      qps: {
        current: stats.qpsMetrics?.current || 0,
        peak: stats.qpsMetrics?.peak || 0,
        average: stats.qpsMetrics?.average || 0
      },
      responseTime: {
        average: stats.averageProcessingTime || 0
      },
      requests: {
        total: stats.totalRequests || 0,
        successful: stats.successfulLogs || 0,
        failed: stats.failedLogs || 0,
        successRate: stats.successRate || 0
      },
      memory: {
        heapUsedMB: Math.round(((stats.memoryMetrics?.heapUsed || 0) / (1024 * 1024)) * 100) / 100
      },
      health: stats.healthStatus || 'unknown'
    }

    res.json({
      success: true,
      data: metrics,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    })
  }
})

/**
 * POST /admin/performance/reset
 * 重置性能统计数据
 */
router.post('/reset', async (req, res) => {
  try {
    const logService = await getUnifiedLogService()

    if (!logService) {
      return res.status(503).json({
        error: 'UnifiedLogService not available',
        message: 'Service is not initialized'
      })
    }

    logService.resetStats()

    res.json({
      success: true,
      message: 'Performance statistics have been reset',
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    res.status(500).json({
      error: 'Failed to reset statistics',
      message: error.message,
      timestamp: new Date().toISOString()
    })
  }
})

/**
 * GET /admin/performance/benchmark
 * 运行性能基准测试
 */
router.get('/benchmark', async (req, res) => {
  try {
    const PerformanceBenchmark = require('../../scripts/performance-benchmark')
    const benchmark = new PerformanceBenchmark()

    // 设置响应头，表示这是一个长时间运行的操作
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'X-Performance-Test': 'running'
    })

    // 异步运行基准测试
    const reportPath = await benchmark.runAllTests()

    res.end(
      JSON.stringify({
        success: true,
        message: 'Performance benchmark completed',
        reportPath,
        timestamp: new Date().toISOString()
      })
    )
  } catch (error) {
    res.status(500).json({
      error: 'Benchmark test failed',
      message: error.message,
      timestamp: new Date().toISOString()
    })
  }
})

/**
 * 错误处理中间件
 */
router.use((error, req, res, _next) => {
  console.error('Performance API Error:', error)

  res.status(500).json({
    error: 'Performance API Error',
    message: error.message,
    path: req.path,
    timestamp: new Date().toISOString()
  })
})

module.exports = router
