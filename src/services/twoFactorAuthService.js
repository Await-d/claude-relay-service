/**
 * @fileoverview 双因素认证（2FA）服务
 *
 * 基于TOTP（Time-based One-Time Password）实现的2FA验证系统
 * 用于保护敏感操作如数据导出等功能
 *
 * @author Claude Code
 * @version 1.0.0
 */

const crypto = require('crypto')
const speakeasy = require('speakeasy')
const QRCode = require('qrcode')
const logger = require('../utils/logger')
const database = require('../models/database')

/**
 * 双因素认证服务
 *
 * 核心特性：
 * - TOTP算法实现，兼容Google Authenticator、Authy等
 * - 管理员级别的2FA配置和验证
 * - 安全的密钥存储和会话管理
 * - 备份码生成和验证机制
 * - 防暴力破解保护
 */
class TwoFactorAuthService {
  constructor() {
    this.rateLimitAttempts = new Map() // IP -> {attempts, lastAttempt}
    this.maxAttempts = 5
    this.blockDuration = 15 * 60 * 1000 // 15分钟
  }

  /**
   * 为管理员生成2FA密钥和二维码
   * @param {string} adminId 管理员ID
   * @param {string} adminUsername 管理员用户名
   * @returns {Promise<Object>} 2FA配置信息
   */
  async generate2FASecret(adminId, adminUsername) {
    logger.info(`🔐 为管理员 ${adminUsername} 生成2FA密钥`)

    try {
      // 生成密钥
      const secret = speakeasy.generateSecret({
        name: `Claude Relay Service (${adminUsername})`,
        issuer: 'Claude Relay Service',
        length: 32
      })

      // 生成二维码
      const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url)

      // 生成备份码（10个8位数字码）
      const backupCodes = this.generateBackupCodes()

      // 存储2FA配置到数据库
      const twoFAConfig = {
        adminId,
        secret: secret.base32,
        isEnabled: false, // 需要验证后才启用
        backupCodes: backupCodes.map((code) => this.hashBackupCode(code)),
        createdAt: new Date().toISOString(),
        lastUsedAt: null
      }

      await database.setSession(`2fa_setup:${adminId}`, twoFAConfig, 600) // 10分钟有效期

      return {
        secret: secret.base32,
        qrCode: qrCodeUrl,
        manualEntryKey: secret.base32,
        backupCodes, // 明文返回给用户保存
        setupToken: adminId // 用于完成设置的token
      }
    } catch (error) {
      logger.error('❌ 2FA密钥生成失败:', error)
      throw new Error('2FA密钥生成失败')
    }
  }

  /**
   * 验证并启用2FA
   * @param {string} adminId 管理员ID
   * @param {string} token 用户输入的6位验证码
   * @returns {Promise<boolean>} 验证结果
   */
  async enable2FA(adminId, token) {
    logger.info(`🔐 为管理员 ${adminId} 启用2FA`)

    try {
      // 获取设置中的2FA配置
      const twoFAConfig = await database.getSession(`2fa_setup:${adminId}`)
      if (!twoFAConfig) {
        throw new Error('2FA设置会话已过期，请重新生成')
      }

      // 验证token
      const isValid = speakeasy.totp.verify({
        secret: twoFAConfig.secret,
        encoding: 'base32',
        token,
        window: 2 // 允许时间偏差
      })

      if (!isValid) {
        throw new Error('验证码无效')
      }

      // 启用2FA
      twoFAConfig.isEnabled = 'true' // 明确存储为字符串，确保Redis兼容性
      twoFAConfig.enabledAt = new Date().toISOString()

      // 保存到永久存储
      await database.setSession(`2fa_config:${adminId}`, twoFAConfig, 0) // 永久有效

      // 清除设置会话
      await database.deleteSession(`2fa_setup:${adminId}`)

      logger.info(`✅ 管理员 ${adminId} 2FA启用成功`)
      return true
    } catch (error) {
      logger.error('❌ 2FA启用失败:', error)
      throw error
    }
  }

  /**
   * 验证2FA码（用于敏感操作）
   * @param {string} adminId 管理员ID
   * @param {string} token 6位验证码或8位备份码
   * @param {string} clientIP 客户端IP（用于防暴力破解）
   * @returns {Promise<boolean>} 验证结果
   */
  async verify2FA(adminId, token, clientIP) {
    // 防暴力破解检查
    if (!this.checkRateLimit(clientIP)) {
      throw new Error('验证失败次数过多，请稍后重试')
    }

    try {
      const twoFAConfig = await database.getSession(`2fa_config:${adminId}`)
      if (!twoFAConfig || !twoFAConfig.isEnabled) {
        throw new Error('管理员未启用2FA')
      }

      let isValid = false

      // 检查是否为6位TOTP验证码
      if (token.length === 6 && /^\d{6}$/.test(token)) {
        isValid = speakeasy.totp.verify({
          secret: twoFAConfig.secret,
          encoding: 'base32',
          token,
          window: 2
        })
      }
      // 检查是否为8位备份码
      else if (token.length === 8 && /^\d{8}$/.test(token)) {
        isValid = this.verifyBackupCode(token, twoFAConfig.backupCodes)

        if (isValid) {
          // 使用后的备份码需要标记为已用
          await this.markBackupCodeUsed(adminId, token, twoFAConfig)
        }
      }

      if (isValid) {
        // 重置失败计数
        this.rateLimitAttempts.delete(clientIP)

        // 更新最后使用时间
        twoFAConfig.lastUsedAt = new Date().toISOString()
        await database.setSession(`2fa_config:${adminId}`, twoFAConfig, 0)

        logger.info(`✅ 管理员 ${adminId} 2FA验证成功`)
        return true
      } else {
        // 增加失败计数
        this.recordFailedAttempt(clientIP)
        throw new Error('验证码无效')
      }
    } catch (error) {
      this.recordFailedAttempt(clientIP)
      logger.error('❌ 2FA验证失败:', error)
      throw error
    }
  }

  /**
   * 检查管理员是否启用了2FA
   * @param {string} adminId 管理员ID
   * @returns {Promise<boolean>} 是否启用
   */
  async is2FAEnabled(adminId) {
    try {
      logger.debug(`🔍 检查2FA配置键: 2fa_config:${adminId}`)
      const twoFAConfig = await database.getSession(`2fa_config:${adminId}`)
      logger.debug(`🔍 2FA配置数据:`, twoFAConfig)

      // 检查配置是否存在且有内容
      if (!twoFAConfig || Object.keys(twoFAConfig).length === 0) {
        logger.debug(`🔍 2FA配置不存在或为空`)
        return false
      }

      // Redis哈希存储的值都是字符串，需要转换
      const isEnabled = twoFAConfig.isEnabled === 'true' || twoFAConfig.isEnabled === true
      logger.debug(
        `🔍 2FA启用状态: ${isEnabled} (原始值: ${twoFAConfig.isEnabled}, 类型: ${typeof twoFAConfig.isEnabled})`
      )
      return isEnabled
    } catch (error) {
      logger.error('❌ 检查2FA状态失败:', error)
      return false
    }
  }

  /**
   * 禁用2FA（需要管理员密码验证）
   * @param {string} adminId 管理员ID
   * @returns {Promise<void>}
   */
  async disable2FA(adminId) {
    logger.info(`🔐 禁用管理员 ${adminId} 的2FA`)

    try {
      await database.deleteSession(`2fa_config:${adminId}`)
      logger.info(`✅ 管理员 ${adminId} 2FA已禁用`)
    } catch (error) {
      logger.error('❌ 禁用2FA失败:', error)
      throw error
    }
  }

  /**
   * 重新生成备份码
   * @param {string} adminId 管理员ID
   * @returns {Promise<Array<string>>} 新的备份码列表
   */
  async regenerateBackupCodes(adminId) {
    logger.info(`🔐 为管理员 ${adminId} 重新生成备份码`)

    try {
      const twoFAConfig = await database.getSession(`2fa_config:${adminId}`)
      if (!twoFAConfig || !twoFAConfig.isEnabled) {
        throw new Error('管理员未启用2FA')
      }

      // 生成新的备份码
      const backupCodes = this.generateBackupCodes()

      // 更新配置
      twoFAConfig.backupCodes = backupCodes.map((code) => this.hashBackupCode(code))
      twoFAConfig.backupCodesRegeneratedAt = new Date().toISOString()

      await database.setSession(`2fa_config:${adminId}`, twoFAConfig, 0)

      logger.info(`✅ 管理员 ${adminId} 备份码重新生成成功`)
      return backupCodes
    } catch (error) {
      logger.error('❌ 重新生成备份码失败:', error)
      throw error
    }
  }

  // ==================== 私有方法 ====================

  /**
   * 生成备份码
   * @private
   * @returns {Array<string>} 备份码数组
   */
  generateBackupCodes() {
    const codes = []
    for (let i = 0; i < 10; i++) {
      const code = crypto.randomInt(10000000, 99999999).toString()
      codes.push(code)
    }
    return codes
  }

  /**
   * 哈希备份码用于存储
   * @private
   * @param {string} code 备份码
   * @returns {string} 哈希值
   */
  hashBackupCode(code) {
    return crypto.createHash('sha256').update(code).digest('hex')
  }

  /**
   * 验证备份码
   * @private
   * @param {string} inputCode 输入的备份码
   * @param {Array<string>} storedHashes 存储的备份码哈希数组
   * @returns {boolean} 验证结果
   */
  verifyBackupCode(inputCode, storedHashes) {
    const inputHash = this.hashBackupCode(inputCode)
    return storedHashes.some((hash) => hash === inputHash && hash !== 'used')
  }

  /**
   * 标记备份码为已使用
   * @private
   * @param {string} adminId 管理员ID
   * @param {string} usedCode 已使用的备份码
   * @param {Object} twoFAConfig 2FA配置
   */
  async markBackupCodeUsed(adminId, usedCode, twoFAConfig) {
    const usedHash = this.hashBackupCode(usedCode)
    const index = twoFAConfig.backupCodes.findIndex((hash) => hash === usedHash)

    if (index !== -1) {
      twoFAConfig.backupCodes[index] = 'used'
      await database.setSession(`2fa_config:${adminId}`, twoFAConfig, 0)
    }
  }

  /**
   * 检查速率限制
   * @private
   * @param {string} clientIP 客户端IP
   * @returns {boolean} 是否允许继续尝试
   */
  checkRateLimit(clientIP) {
    const now = Date.now()
    const attempts = this.rateLimitAttempts.get(clientIP)

    if (!attempts) {
      return true
    }

    // 检查是否在阻止期内
    if (now - attempts.lastAttempt < this.blockDuration && attempts.count >= this.maxAttempts) {
      return false
    }

    // 如果超过阻止时间，重置计数
    if (now - attempts.lastAttempt >= this.blockDuration) {
      this.rateLimitAttempts.delete(clientIP)
      return true
    }

    return attempts.count < this.maxAttempts
  }

  /**
   * 记录失败尝试
   * @private
   * @param {string} clientIP 客户端IP
   */
  recordFailedAttempt(clientIP) {
    const now = Date.now()
    const attempts = this.rateLimitAttempts.get(clientIP) || { count: 0, lastAttempt: 0 }

    // 如果距离上次尝试超过阻止时间，重置计数
    if (now - attempts.lastAttempt >= this.blockDuration) {
      attempts.count = 1
    } else {
      attempts.count++
    }

    attempts.lastAttempt = now
    this.rateLimitAttempts.set(clientIP, attempts)
  }
}

// 导出单例实例
const twoFactorAuthService = new TwoFactorAuthService()
module.exports = twoFactorAuthService
