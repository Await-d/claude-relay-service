/**
 * @fileoverview 用户认证工具类
 *
 * 提供用户密码哈希、JWT令牌管理和会话验证等功能
 * 支持本地用户认证和会话管理
 *
 * @author Claude Code
 * @version 1.0.0
 */

const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const config = require('../../config/config')
const logger = require('./logger')

class UserAuthHelper {
  constructor() {
    // 密码哈希参数
    this.SALT_ROUNDS = 12 // bcrypt salt rounds，平衡安全性与性能
    this.MIN_PASSWORD_LENGTH = 8
    this.MAX_PASSWORD_LENGTH = 128

    // JWT 配置
    this.JWT_SECRET =
      config.security?.jwtSecret || config.security?.encryptionKey || 'default-secret'
    this.JWT_EXPIRES_IN = '24h'
    this.JWT_ISSUER = 'claude-relay-service'

    // 会话配置
    this.DEFAULT_SESSION_DURATION = 24 * 60 * 60 // 24小时（秒）
    this.SESSION_CLEANUP_INTERVAL = 60 * 60 * 1000 // 1小时清理一次过期会话

    if (this.JWT_SECRET === 'default-secret') {
      logger.warn('⚠️ Using default JWT secret. Please configure security.jwtSecret in config')
    }
  }

  // ==================== 密码管理 ====================

  /**
   * 验证密码强度
   * @param {string} password - 密码
   * @returns {Object} 验证结果
   */
  validatePasswordStrength(password) {
    const result = {
      valid: false,
      errors: [],
      score: 0
    }

    if (!password || typeof password !== 'string') {
      result.errors.push('Password is required')
      return result
    }

    // 长度检查
    if (password.length < this.MIN_PASSWORD_LENGTH) {
      result.errors.push(`Password must be at least ${this.MIN_PASSWORD_LENGTH} characters long`)
    }

    if (password.length > this.MAX_PASSWORD_LENGTH) {
      result.errors.push(`Password must not exceed ${this.MAX_PASSWORD_LENGTH} characters`)
    }

    // 复杂度检查
    const hasLower = /[a-z]/.test(password)
    const hasUpper = /[A-Z]/.test(password)
    const hasNumbers = /\d/.test(password)
    const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password)

    let score = 0
    if (hasLower) {
      score++
    }
    if (hasUpper) {
      score++
    }
    if (hasNumbers) {
      score++
    }
    if (hasSpecial) {
      score++
    }
    if (password.length >= 12) {
      score++
    }

    result.score = score

    // 至少需要3种字符类型
    const typeCount = [hasLower, hasUpper, hasNumbers, hasSpecial].filter(Boolean).length
    if (typeCount < 3) {
      result.errors.push(
        'Password must contain at least 3 types of characters (lowercase, uppercase, numbers, special)'
      )
    }

    // 常见密码检查
    const commonPasswords = ['password', '123456', 'qwerty', 'admin', 'letmein']
    if (commonPasswords.some((common) => password.toLowerCase().includes(common))) {
      result.errors.push('Password contains common words and is not secure')
    }

    result.valid = result.errors.length === 0 && password.length >= this.MIN_PASSWORD_LENGTH
    return result
  }

  /**
   * 哈希密码
   * @param {string} password - 明文密码
   * @returns {Promise<string>} 哈希后的密码
   */
  async hashPassword(password) {
    try {
      if (!password) {
        throw new Error('Password is required for hashing')
      }

      const validation = this.validatePasswordStrength(password)
      if (!validation.valid) {
        throw new Error(`Password validation failed: ${validation.errors.join(', ')}`)
      }

      const hash = await bcrypt.hash(password, this.SALT_ROUNDS)
      logger.debug('🔐 Password hashed successfully')
      return hash
    } catch (error) {
      logger.error('❌ Password hashing failed:', error)
      throw error
    }
  }

  /**
   * 验证密码
   * @param {string} password - 明文密码
   * @param {string} hash - 哈希密码
   * @returns {Promise<boolean>} 密码是否匹配
   */
  async validatePassword(password, hash) {
    try {
      if (!password || !hash) {
        return false
      }

      const isValid = await bcrypt.compare(password, hash)
      if (isValid) {
        logger.debug('🔐 Password validation successful')
      } else {
        logger.debug('🔒 Password validation failed')
      }

      return isValid
    } catch (error) {
      logger.error('❌ Password validation error:', error)
      return false
    }
  }

  // ==================== JWT 令牌管理 ====================

  /**
   * 生成 JWT 令牌
   * @param {Object} payload - 载荷数据
   * @param {Object} options - 令牌选项
   * @returns {string} JWT 令牌
   */
  generateJWT(payload, options = {}) {
    try {
      if (!payload || typeof payload !== 'object') {
        throw new Error('Payload is required and must be an object')
      }

      const jwtOptions = {
        expiresIn: options.expiresIn || this.JWT_EXPIRES_IN,
        issuer: options.issuer || this.JWT_ISSUER,
        audience: options.audience || 'claude-relay-users',
        subject: payload.userId || payload.sub,
        jwtid: options.jwtid || crypto.randomBytes(16).toString('hex')
      }

      const token = jwt.sign(payload, this.JWT_SECRET, jwtOptions)
      logger.debug('🎫 JWT token generated successfully', {
        subject: jwtOptions.subject,
        jti: jwtOptions.jwtid
      })

      return token
    } catch (error) {
      logger.error('❌ JWT generation failed:', error)
      throw error
    }
  }

  /**
   * 验证 JWT 令牌
   * @param {string} token - JWT 令牌
   * @param {Object} options - 验证选项
   * @returns {Object|null} 解码后的载荷或 null
   */
  validateJWT(token, options = {}) {
    try {
      if (!token || typeof token !== 'string') {
        return null
      }

      const jwtOptions = {
        issuer: options.issuer || this.JWT_ISSUER,
        audience: options.audience || 'claude-relay-users',
        clockTolerance: options.clockTolerance || 30, // 30秒时钟偏移容忍
        ignoreExpiration: options.ignoreExpiration || false
      }

      const decoded = jwt.verify(token, this.JWT_SECRET, jwtOptions)
      logger.debug('🎫 JWT token validated successfully', {
        subject: decoded.sub,
        jti: decoded.jti
      })

      return decoded
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        logger.debug('🕐 JWT token expired')
      } else if (error.name === 'JsonWebTokenError') {
        logger.debug('🚫 JWT token invalid:', error.message)
      } else {
        logger.error('❌ JWT validation error:', error)
      }
      return null
    }
  }

  /**
   * 刷新 JWT 令牌
   * @param {string} token - 当前令牌
   * @param {Object} newPayload - 新的载荷数据（可选）
   * @returns {string|null} 新的 JWT 令牌或 null
   */
  refreshJWT(token, newPayload = {}) {
    try {
      // 验证现有令牌，允许过期令牌在刷新窗口内使用
      const decoded = this.validateJWT(token, { ignoreExpiration: true })
      if (!decoded) {
        return null
      }

      // 检查令牌是否在可刷新时间窗口内（例如过期后1小时内）
      const now = Math.floor(Date.now() / 1000)
      const expiredTime = decoded.exp
      const refreshWindow = 60 * 60 // 1小时刷新窗口

      if (now > expiredTime + refreshWindow) {
        logger.debug('🕐 JWT token outside refresh window')
        return null
      }

      // 创建新的载荷，保留原有数据并合并新数据
      const refreshedPayload = {
        ...decoded,
        ...newPayload,
        iat: now, // 重新设置签发时间
        exp: undefined, // 移除旧的过期时间，让新令牌重新设置
        jti: crypto.randomBytes(16).toString('hex') // 新的令牌ID
      }

      // 清理 JWT 标准声明，避免重复
      delete refreshedPayload.iss
      delete refreshedPayload.aud
      delete refreshedPayload.sub

      return this.generateJWT(refreshedPayload, { subject: decoded.sub })
    } catch (error) {
      logger.error('❌ JWT refresh failed:', error)
      return null
    }
  }

  // ==================== 会话工具函数 ====================

  /**
   * 生成安全的会话ID
   * @param {number} length - ID长度（默认32字节，64字符）
   * @returns {string} 十六进制会话ID
   */
  generateSessionId(length = 32) {
    return crypto.randomBytes(length).toString('hex')
  }

  /**
   * 生成会话数据结构
   * @param {string} userId - 用户ID
   * @param {Object} sessionInfo - 会话信息
   * @returns {Object} 会话数据
   */
  createSessionData(userId, sessionInfo = {}) {
    const now = new Date().toISOString()
    const sessionId = this.generateSessionId()

    return {
      sessionId,
      userId,
      createdAt: now,
      lastActivity: now,
      expiresAt: new Date(Date.now() + this.DEFAULT_SESSION_DURATION * 1000).toISOString(),
      ipAddress: sessionInfo.ipAddress || '',
      userAgent: sessionInfo.userAgent || '',
      deviceFingerprint: sessionInfo.deviceFingerprint || '',
      metadata: sessionInfo.metadata || {}
    }
  }

  /**
   * 验证会话是否有效
   * @param {Object} sessionData - 会话数据
   * @returns {boolean} 会话是否有效
   */
  isSessionValid(sessionData) {
    if (!sessionData || typeof sessionData !== 'object') {
      return false
    }

    // 检查必需字段
    if (!sessionData.sessionId || !sessionData.userId || !sessionData.expiresAt) {
      return false
    }

    // 检查过期时间
    const now = new Date()
    const expiresAt = new Date(sessionData.expiresAt)

    if (now > expiresAt) {
      return false
    }

    return true
  }

  /**
   * 更新会话活动时间
   * @param {Object} sessionData - 会话数据
   * @returns {Object} 更新后的会话数据
   */
  updateSessionActivity(sessionData) {
    if (!sessionData || typeof sessionData !== 'object') {
      return sessionData
    }

    return {
      ...sessionData,
      lastActivity: new Date().toISOString()
    }
  }

  // ==================== 安全工具函数 ====================

  /**
   * 生成安全的随机字符串
   * @param {number} length - 字符串长度
   * @param {string} charset - 字符集（默认：字母数字）
   * @returns {string} 随机字符串
   */
  generateSecureRandom(
    length = 32,
    charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  ) {
    const randomBytes = crypto.randomBytes(length)
    let result = ''

    for (let i = 0; i < length; i++) {
      result += charset[randomBytes[i] % charset.length]
    }

    return result
  }

  /**
   * 生成密码重置令牌
   * @param {string} userId - 用户ID
   * @param {number} expiresInMinutes - 过期时间（分钟）
   * @returns {Object} 重置令牌信息
   */
  generatePasswordResetToken(userId, expiresInMinutes = 15) {
    try {
      const token = this.generateSecureRandom(64)
      const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000)

      const tokenData = {
        token,
        userId,
        type: 'password_reset',
        createdAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString(),
        used: false
      }

      logger.debug('🔑 Password reset token generated', { userId, expiresAt })
      return tokenData
    } catch (error) {
      logger.error('❌ Password reset token generation failed:', error)
      throw error
    }
  }

  /**
   * 验证密码重置令牌
   * @param {Object} tokenData - 令牌数据
   * @param {string} providedToken - 提供的令牌
   * @returns {boolean} 令牌是否有效
   */
  validatePasswordResetToken(tokenData, providedToken) {
    try {
      if (!tokenData || !providedToken) {
        return false
      }

      // 检查令牌匹配
      if (tokenData.token !== providedToken) {
        return false
      }

      // 检查令牌类型
      if (tokenData.type !== 'password_reset') {
        return false
      }

      // 检查是否已使用
      if (tokenData.used) {
        return false
      }

      // 检查过期时间
      const now = new Date()
      const expiresAt = new Date(tokenData.expiresAt)

      if (now > expiresAt) {
        return false
      }

      return true
    } catch (error) {
      logger.error('❌ Password reset token validation failed:', error)
      return false
    }
  }

  /**
   * 计算密码哈希的时间常数比较
   * 防止时序攻击
   * @param {string} hash1 - 哈希1
   * @param {string} hash2 - 哈希2
   * @returns {boolean} 是否相等
   */
  constantTimeEquals(hash1, hash2) {
    if (!hash1 || !hash2 || hash1.length !== hash2.length) {
      return false
    }

    let result = 0
    for (let i = 0; i < hash1.length; i++) {
      result |= hash1.charCodeAt(i) ^ hash2.charCodeAt(i)
    }

    return result === 0
  }
}

// 创建单例实例
const userAuthHelper = new UserAuthHelper()

module.exports = userAuthHelper
