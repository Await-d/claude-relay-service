/**
 * @fileoverview 数据管理API路由
 *
 * 提供Web界面数据导出/导入功能的API接口
 * 集成2FA双因素验证保护敏感操作
 *
 * @author Claude Code
 * @version 1.0.0
 */

const express = require('express')
const path = require('path')
const fs = require('fs').promises
const multer = require('multer')
const archiver = require('archiver')
const logger = require('../utils/logger')
const twoFactorAuthService = require('../services/twoFactorAuthService')
const DataExportService = require('../services/dataExportService')
const DataImportService = require('../services/dataImportService')
const DataMigrationService = require('../services/dataMigrationService')
const { DatabaseFactory } = require('../models/database/DatabaseFactory')
const { authenticateAdmin } = require('../middleware/auth')

const router = express.Router()

// 配置文件上传
const upload = multer({
  dest: './temp/uploads/',
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB限制
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/zip' || file.mimetype === 'application/json') {
      cb(null, true)
    } else {
      cb(new Error('仅支持ZIP和JSON文件'))
    }
  }
})

/**
 * 获取数据管理概览
 */
router.get('/overview', authenticateAdmin, async (req, res) => {
  try {
    logger.info(`📊 管理员 ${req.admin.username} 获取数据管理概览`)

    const database = DatabaseFactory.create(require('../../config/config'))
    await database.connect()

    // 获取数据统计
    const stats = {
      apiKeys: 0,
      claudeAccounts: 0,
      openaiAccounts: 0,
      systemConfig: 0,
      is2FAEnabled: false,
      lastExport: null
    }

    try {
      const apiKeys = await database.getAllApiKeys()
      stats.apiKeys = apiKeys.length
    } catch (error) {
      logger.warn('获取API Keys统计失败:', error.message)
    }

    try {
      const claudeAccounts = await database.getAllClaudeAccounts()
      stats.claudeAccounts = claudeAccounts.length
    } catch (error) {
      logger.warn('获取Claude账户统计失败:', error.message)
    }

    try {
      const openaiAccounts = await database.getAllOpenAIAccounts()
      stats.openaiAccounts = openaiAccounts.length
    } catch (error) {
      logger.warn('获取OpenAI账户统计失败:', error.message)
    }

    try {
      const config = await database.getSystemSchedulingConfig()
      stats.systemConfig = config ? 1 : 0
    } catch (error) {
      logger.warn('获取系统配置统计失败:', error.message)
    }

    // 检查2FA状态
    stats.is2FAEnabled = await twoFactorAuthService.is2FAEnabled(req.admin.id)

    // 获取最后导出时间（如果有）
    try {
      const lastExportInfo = await database.getSession('last_data_export')
      stats.lastExport = lastExportInfo?.timestamp || null
    } catch (error) {
      // 忽略获取最后导出时间的错误
    }

    await database.disconnect()

    res.json({
      success: true,
      data: stats
    })
  } catch (error) {
    logger.error('❌ 获取数据管理概览失败:', error)
    res.status(500).json({
      success: false,
      error: '获取数据概览失败'
    })
  }
})

/**
 * 生成2FA密钥
 */
router.post('/2fa/generate', authenticateAdmin, async (req, res) => {
  try {
    logger.info(`🔐 管理员 ${req.admin.username} 生成2FA密钥`)

    const twoFAConfig = await twoFactorAuthService.generate2FASecret(
      req.admin.id,
      req.admin.username
    )

    res.json({
      success: true,
      data: {
        qrCode: twoFAConfig.qrCode,
        manualEntryKey: twoFAConfig.manualEntryKey,
        backupCodes: twoFAConfig.backupCodes,
        setupToken: twoFAConfig.setupToken
      }
    })
  } catch (error) {
    logger.error('❌ 生成2FA密钥失败:', error)
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * 启用2FA
 */
router.post('/2fa/enable', authenticateAdmin, async (req, res) => {
  try {
    const { token } = req.body

    if (!token || !/^\d{6}$/.test(token)) {
      return res.status(400).json({
        success: false,
        error: '请输入6位验证码'
      })
    }

    await twoFactorAuthService.enable2FA(req.admin.id, token)

    logger.info(`✅ 管理员 ${req.admin.username} 成功启用2FA`)

    res.json({
      success: true,
      message: '2FA启用成功'
    })
  } catch (error) {
    logger.error('❌ 启用2FA失败:', error)
    res.status(400).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * 验证2FA并创建敏感操作会话
 */
router.post('/2fa/verify', authenticateAdmin, async (req, res) => {
  try {
    const { password, token } = req.body
    const clientIP = req.ip || req.connection.remoteAddress

    // 验证管理员密码
    const bcrypt = require('bcryptjs')
    const isPasswordValid = await bcrypt.compare(password, req.admin.hashedPassword)

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        error: '管理员密码错误'
      })
    }

    // 验证2FA
    const is2FAEnabled = await twoFactorAuthService.is2FAEnabled(req.admin.id)

    if (!is2FAEnabled) {
      return res.status(400).json({
        success: false,
        error: '请先启用2FA'
      })
    }

    if (!token) {
      return res.status(400).json({
        success: false,
        error: '请输入2FA验证码'
      })
    }

    await twoFactorAuthService.verify2FA(req.admin.id, token, clientIP)

    // 创建敏感操作会话（15分钟有效期）
    const sensitiveSessionToken = require('crypto').randomUUID()
    const database = DatabaseFactory.create(require('../../config/config'))
    await database.connect()

    await database.setSession(
      `sensitive_session:${sensitiveSessionToken}`,
      {
        adminId: req.admin.id,
        createdAt: new Date().toISOString(),
        clientIP
      },
      15 * 60
    ) // 15分钟

    await database.disconnect()

    logger.info(`✅ 管理员 ${req.admin.username} 通过敏感操作验证`)

    res.json({
      success: true,
      data: {
        sessionToken: sensitiveSessionToken,
        expiresIn: 15 * 60 // 秒
      }
    })
  } catch (error) {
    logger.error('❌ 2FA验证失败:', error)
    res.status(400).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * 数据导出
 */
router.post('/export', authenticateAdmin, async (req, res) => {
  try {
    const { sessionToken, includeStats = true } = req.body

    // 验证敏感操作会话
    const database = DatabaseFactory.create(require('../../config/config'))
    await database.connect()

    const sensitiveSession = await database.getSession(`sensitive_session:${sessionToken}`)
    if (!sensitiveSession || sensitiveSession.adminId !== req.admin.id) {
      await database.disconnect()
      return res.status(401).json({
        success: false,
        error: '敏感操作会话无效或已过期'
      })
    }

    logger.info(`📤 管理员 ${req.admin.username} 开始数据导出`)

    // 创建导出目录
    const exportId = Date.now().toString()
    const exportDir = path.join('./temp/exports', exportId)
    await fs.mkdir(exportDir, { recursive: true })

    // 执行数据导出
    const exportService = new DataExportService(database)
    const exportResult = await exportService.exportAllData(exportDir, {
      includeStats,
      includeSessions: false, // 会话数据不导出
      validateData: true
    })

    // 创建ZIP压缩包
    const zipPath = path.join('./temp/exports', `data-export-${exportId}.zip`)
    await createZipArchive(exportDir, zipPath)

    // 记录导出信息
    await database.setSession(
      'last_data_export',
      {
        timestamp: new Date().toISOString(),
        adminId: req.admin.id,
        adminUsername: req.admin.username,
        exportId,
        recordCount: exportResult.totalRecords
      },
      30 * 24 * 60 * 60
    ) // 保存30天

    await database.disconnect()

    // 设置下载响应
    const stats = await fs.stat(zipPath)
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="claude-relay-data-${exportId}.zip"`)
    res.setHeader('Content-Length', stats.size)

    // 发送文件
    const fileStream = require('fs').createReadStream(zipPath)
    fileStream.pipe(res)

    // 清理敏感操作会话
    await database.deleteSession(`sensitive_session:${sessionToken}`)

    logger.info(`✅ 管理员 ${req.admin.username} 数据导出完成: ${exportResult.totalRecords} 条记录`)

    // 异步清理临时文件
    setTimeout(async () => {
      try {
        await fs.rm(exportDir, { recursive: true, force: true })
        await fs.unlink(zipPath)
      } catch (error) {
        logger.warn('清理导出临时文件失败:', error.message)
      }
    }, 60000) // 1分钟后清理
  } catch (error) {
    logger.error('❌ 数据导出失败:', error)
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * 数据导入
 */
router.post('/import', authenticateAdmin, upload.single('dataFile'), async (req, res) => {
  try {
    const { sessionToken, conflictStrategy = 'skip' } = req.body

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: '请选择要导入的数据文件'
      })
    }

    // 验证敏感操作会话
    const database = DatabaseFactory.create(require('../../config/config'))
    await database.connect()

    const sensitiveSession = await database.getSession(`sensitive_session:${sessionToken}`)
    if (!sensitiveSession || sensitiveSession.adminId !== req.admin.id) {
      await database.disconnect()
      return res.status(401).json({
        success: false,
        error: '敏感操作会话无效或已过期'
      })
    }

    logger.info(`📥 管理员 ${req.admin.username} 开始数据导入`)

    let importDir = req.file.path

    // 如果是ZIP文件，先解压
    if (req.file.mimetype === 'application/zip') {
      const extractDir = path.join('./temp/imports', Date.now().toString())
      await extractZipArchive(req.file.path, extractDir)
      importDir = extractDir
    }

    // 执行数据导入
    const importService = new DataImportService(database)
    const importResult = await importService.importAllData(importDir, {
      validateChecksums: true,
      conflictStrategy,
      includeCategories: null, // 导入所有类别
      dryRun: false
    })

    await database.disconnect()

    // 清理敏感操作会话
    await database.deleteSession(`sensitive_session:${sessionToken}`)

    logger.info(`✅ 管理员 ${req.admin.username} 数据导入完成: ${importResult.totalRecords} 条记录`)

    res.json({
      success: true,
      data: {
        importedRecords: importResult.totalRecords,
        skippedRecords: importResult.skippedRecords,
        categories: importResult.categories,
        conflictStrategy: importResult.conflictStrategy
      }
    })

    // 异步清理临时文件
    setTimeout(async () => {
      try {
        await fs.unlink(req.file.path)
        if (importDir !== req.file.path) {
          await fs.rm(importDir, { recursive: true, force: true })
        }
      } catch (error) {
        logger.warn('清理导入临时文件失败:', error.message)
      }
    }, 5000) // 5秒后清理
  } catch (error) {
    logger.error('❌ 数据导入失败:', error)
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * 数据库迁移
 */
router.post('/migrate', authenticateAdmin, upload.single('configFile'), async (req, res) => {
  try {
    const { sessionToken, validateOnly = false } = req.body

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: '请上传目标数据库配置文件'
      })
    }

    // 验证敏感操作会话
    const database = DatabaseFactory.create(require('../../config/config'))
    await database.connect()

    const sensitiveSession = await database.getSession(`sensitive_session:${sessionToken}`)
    if (!sensitiveSession || sensitiveSession.adminId !== req.admin.id) {
      await database.disconnect()
      return res.status(401).json({
        success: false,
        error: '敏感操作会话无效或已过期'
      })
    }

    logger.info(`🔄 管理员 ${req.admin.username} 开始数据库迁移`)

    // 读取目标数据库配置
    const configContent = await fs.readFile(req.file.path, 'utf8')
    const targetConfig = JSON.parse(configContent)

    // 执行迁移
    const migrationService = new DataMigrationService()
    const migrationResult = await migrationService.migrate(
      require('../../config/config'),
      targetConfig,
      {
        migrationDir: path.join('./temp/migrations', Date.now().toString()),
        strategy: 'export-import',
        validateOnly,
        backupTarget: !validateOnly,
        includeCategories: null
      }
    )

    await database.disconnect()

    // 清理敏感操作会话
    await database.deleteSession(`sensitive_session:${sessionToken}`)

    logger.info(`✅ 管理员 ${req.admin.username} 数据库迁移完成`)

    res.json({
      success: true,
      data: {
        sourceDatabase: migrationResult.sourceDatabase,
        targetDatabase: migrationResult.targetDatabase,
        totalRecords: migrationResult.totalRecords,
        phases: migrationResult.phases,
        validateOnly,
        errors: migrationResult.errors
      }
    })
  } catch (error) {
    logger.error('❌ 数据库迁移失败:', error)
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

// ==================== 辅助方法 ====================

/**
 * 创建ZIP压缩包
 */
async function createZipArchive(sourceDir, outputPath) {
  return new Promise((resolve, reject) => {
    const output = require('fs').createWriteStream(outputPath)
    const archive = archiver('zip', { zlib: { level: 9 } })

    output.on('close', () => resolve())
    archive.on('error', reject)

    archive.pipe(output)
    archive.directory(sourceDir, false)
    archive.finalize()
  })
}

/**
 * 解压ZIP文件
 */
async function extractZipArchive(zipPath, extractDir) {
  const yauzl = require('yauzl')
  await fs.mkdir(extractDir, { recursive: true })

  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) {
        return reject(err)
      }

      zipfile.readEntry()
      zipfile.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) {
          zipfile.readEntry()
        } else {
          zipfile.openReadStream(entry, (error, readStream) => {
            if (error) {
              return reject(error)
            }

            const outputPath = path.join(extractDir, entry.fileName)
            const outputDir = path.dirname(outputPath)

            fs.mkdir(outputDir, { recursive: true })
              .then(() => {
                const writeStream = require('fs').createWriteStream(outputPath)
                readStream.pipe(writeStream)
                writeStream.on('close', () => zipfile.readEntry())
              })
              .catch(reject)
          })
        }
      })

      zipfile.on('end', resolve)
    })
  })
}

module.exports = router
