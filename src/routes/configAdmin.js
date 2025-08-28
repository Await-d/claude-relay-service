/**
 * @fileoverview 动态配置管理路由
 *
 * 提供管理员界面用于管理动态配置的API端点
 * 支持配置项的读取、更新和状态查询
 *
 * @author Claude Code
 * @version 1.0.0
 */

const express = require('express')
const router = express.Router()
const { authenticateAdmin } = require('../middleware/auth')
const { dynamicConfigManager } = require('../services/dynamicConfigService')
const logger = require('../utils/logger')

/**
 * 获取请求日志配置
 * GET /admin/config/request-logging
 */
router.get('/request-logging', authenticateAdmin, async (req, res) => {
  try {
    const config = await dynamicConfigManager.getRequestLoggingConfig()

    res.json({
      success: true,
      data: config,
      timestamp: new Date().toISOString()
    })

    logger.info(`📊 Admin ${req.admin.username} retrieved request logging config`)
  } catch (error) {
    logger.error('❌ Failed to get request logging config:', error)

    res.status(500).json({
      success: false,
      error: 'Failed to get request logging config',
      message: error.message
    })
  }
})

/**
 * 更新请求日志配置
 * PUT /admin/config/request-logging
 */
router.put('/request-logging', authenticateAdmin, async (req, res) => {
  try {
    const { enabled, mode, sampling } = req.body

    // 验证请求体
    if (typeof enabled !== 'undefined' && typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'Invalid parameter',
        message: 'enabled must be a boolean'
      })
    }

    const results = {}

    // 更新enabled配置
    if (typeof enabled !== 'undefined') {
      const success = await dynamicConfigManager.setConfig('requestLogging.enabled', enabled)
      results.enabled = { value: enabled, success }
    }

    // 更新mode配置
    if (mode) {
      const success = await dynamicConfigManager.setConfig('requestLogging.mode', mode)
      results.mode = { value: mode, success }
    }

    // 更新采样率配置
    if (sampling?.rate !== undefined) {
      const success = await dynamicConfigManager.setConfig(
        'requestLogging.sampling.rate',
        sampling.rate
      )
      results.samplingRate = { value: sampling.rate, success }
    }

    logger.info(`📊 Admin ${req.admin.username} updated request logging config:`, results)

    res.json({
      success: true,
      data: results,
      message: 'Request logging configuration updated successfully',
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    logger.error('❌ Failed to update request logging config:', error)

    res.status(500).json({
      success: false,
      error: 'Failed to update request logging config',
      message: error.message
    })
  }
})

/**
 * 获取动态配置管理器状态
 * GET /admin/config/status
 */
router.get('/status', authenticateAdmin, async (req, res) => {
  try {
    const status = dynamicConfigManager.getStatus()

    res.json({
      success: true,
      data: status,
      timestamp: new Date().toISOString()
    })

    logger.debug(`📊 Admin ${req.admin.username} retrieved config manager status`)
  } catch (error) {
    logger.error('❌ Failed to get config manager status:', error)

    res.status(500).json({
      success: false,
      error: 'Failed to get config manager status',
      message: error.message
    })
  }
})

/**
 * 清理配置缓存
 * POST /admin/config/cache/clear
 */
router.post('/cache/clear', authenticateAdmin, async (req, res) => {
  try {
    dynamicConfigManager.cleanupCache()

    logger.info(`🧹 Admin ${req.admin.username} cleared config cache`)

    res.json({
      success: true,
      message: 'Configuration cache cleared successfully',
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    logger.error('❌ Failed to clear config cache:', error)

    res.status(500).json({
      success: false,
      error: 'Failed to clear config cache',
      message: error.message
    })
  }
})

module.exports = router
