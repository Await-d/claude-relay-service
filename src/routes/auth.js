/**
 * @fileoverview 用户认证路由
 *
 * 提供用户认证操作的HTTP端点，包括：
 * - 用户登录/登出操作
 * - 会话刷新和验证
 * - 密码更改和重置功能
 *
 * 支持本地用户认证和LDAP集成，提供安全的会话管理
 *
 * @author Claude Code
 * @version 1.0.0
 */

const express = require('express')
const userService = require('../services/userService')
const { authenticateUserSession } = require('../middleware/auth')
const logger = require('../utils/logger')
const { RateLimiterRedis } = require('rate-limiter-flexible')
const database = require('../models/database')

const router = express.Router()

// 速率限制配置
const createRateLimiter = (options) => {
  try {
    const client = database.getClient()
    if (!client) {
      logger.warn('⚠️ Database client not available for rate limiter, using memory fallback')
      return null
    }

    return new RateLimiterRedis({
      storeClient: client,
      ...options
    })
  } catch (error) {
    logger.warn('⚠️ Rate limiter initialization failed:', error.message)
    return null
  }
}

// 登录速率限制：每个IP每15分钟最多5次登录尝试
const loginLimiter = createRateLimiter({
  keyPrefix: 'auth_login_ip',
  points: 5,
  duration: 15 * 60, // 15分钟
  blockDuration: 15 * 60 // 阻塞15分钟
})

// 密码重置速率限制：每个IP每小时最多3次重置请求
const resetPasswordLimiter = createRateLimiter({
  keyPrefix: 'auth_reset_ip',
  points: 3,
  duration: 60 * 60, // 1小时
  blockDuration: 60 * 60 // 阻塞1小时
})

// 密码修改速率限制：每个用户每小时最多5次修改请求
const changePasswordLimiter = createRateLimiter({
  keyPrefix: 'auth_change_user',
  points: 5,
  duration: 60 * 60, // 1小时
  blockDuration: 30 * 60 // 阻塞30分钟
})

/**
 * 应用速率限制
 * @param {Object} limiter - 速率限制器
 * @param {string} key - 限制键
 * @param {Object} req - 请求对象
 * @param {Object} res - 响应对象
 * @returns {Promise<boolean>} 是否通过限制
 */
const applyRateLimit = async (limiter, key, req, res) => {
  if (!limiter) {
    return true // 如果限制器不可用，则跳过限制
  }

  try {
    await limiter.consume(key)
    return true
  } catch (rejRes) {
    const remainingPoints = rejRes.remainingPoints || 0
    const msBeforeNext = rejRes.msBeforeNext || 900000

    logger.security(`🚦 Rate limit exceeded for ${key} from ${req.ip || 'unknown'}`)

    res.set({
      'Retry-After': Math.round(msBeforeNext / 1000) || 900,
      'X-RateLimit-Remaining': remainingPoints,
      'X-RateLimit-Reset': new Date(Date.now() + msBeforeNext).toISOString()
    })

    res.status(429).json({
      error: 'Rate limit exceeded',
      message: 'Too many attempts, please try again later',
      retryAfter: Math.round(msBeforeNext / 1000)
    })

    return false
  }
}

/**
 * 输入验证辅助函数
 */
const validateInput = {
  /**
   * 验证用户名
   * @param {string} username - 用户名
   * @returns {Object} 验证结果
   */
  username: (username) => {
    const result = { valid: false, errors: [] }

    if (!username) {
      result.errors.push('Username is required')
      return result
    }

    if (typeof username !== 'string') {
      result.errors.push('Username must be a string')
      return result
    }

    if (username.length < 3 || username.length > 50) {
      result.errors.push('Username must be between 3 and 50 characters')
      return result
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      result.errors.push('Username can only contain letters, numbers, underscores, and hyphens')
      return result
    }

    result.valid = true
    return result
  },

  /**
   * 验证密码
   * @param {string} password - 密码
   * @returns {Object} 验证结果
   */
  password: (password) => {
    const result = { valid: false, errors: [] }

    if (!password) {
      result.errors.push('Password is required')
      return result
    }

    if (typeof password !== 'string') {
      result.errors.push('Password must be a string')
      return result
    }

    if (password.length < 1) {
      result.errors.push('Password cannot be empty')
      return result
    }

    result.valid = true
    return result
  },

  /**
   * 验证认证方法
   * @param {string} method - 认证方法
   * @returns {Object} 验证结果
   */
  authMethod: (method) => {
    const result = { valid: false, errors: [] }
    const validMethods = ['auto', 'local', 'ldap']

    if (method && !validMethods.includes(method)) {
      result.errors.push(
        `Invalid authentication method. Must be one of: ${validMethods.join(', ')}`
      )
      return result
    }

    result.valid = true
    return result
  }
}

/**
 * 获取客户端认证上下文
 * @param {Object} req - 请求对象
 * @returns {Object} 认证上下文
 */
const getAuthContext = (req) => ({
  ipAddress: req.ip || req.connection?.remoteAddress || 'unknown',
  userAgent: req.get('User-Agent') || 'unknown',
  timestamp: new Date().toISOString()
})

// ==================== 认证路由 ====================

/**
 * POST /auth/login - 用户登录
 * 支持本地用户认证和LDAP集成
 */
router.post('/login', async (req, res) => {
  const startTime = Date.now()
  const clientIP = req.ip || 'unknown'

  try {
    // 应用登录速率限制
    const rateLimitPassed = await applyRateLimit(loginLimiter, clientIP, req, res)
    if (!rateLimitPassed) {
      return
    }

    // 输入验证
    const { username, password, authMethod = 'auto' } = req.body

    const usernameValidation = validateInput.username(username)
    if (!usernameValidation.valid) {
      logger.security(`🔒 Login attempt with invalid username from ${clientIP}`)
      return res.status(400).json({
        error: 'Validation failed',
        message: usernameValidation.errors.join(', ')
      })
    }

    const passwordValidation = validateInput.password(password)
    if (!passwordValidation.valid) {
      logger.security(`🔒 Login attempt with invalid password from ${clientIP}`)
      return res.status(400).json({
        error: 'Validation failed',
        message: passwordValidation.errors.join(', ')
      })
    }

    const authMethodValidation = validateInput.authMethod(authMethod)
    if (!authMethodValidation.valid) {
      return res.status(400).json({
        error: 'Validation failed',
        message: authMethodValidation.errors.join(', ')
      })
    }

    // 获取认证上下文
    const authContext = getAuthContext(req)

    logger.info(`🔐 Login attempt for user: ${username} using method: ${authMethod}`)

    // 进行用户认证
    const authResult = await userService.authenticate(username, password, authMethod, authContext)

    if (!authResult.success) {
      logger.security(`🔒 Login failed for user: ${username} from ${clientIP}`)
      return res.status(401).json({
        error: 'Authentication failed',
        message: 'Invalid username or password'
      })
    }

    // 创建用户会话
    const sessionInfo = {
      ...authContext,
      authMethod: authResult.authMethod
    }

    const sessionResult = await userService.createUserSession(authResult.user.id, sessionInfo)

    const authDuration = Date.now() - startTime

    logger.success(
      `✅ User login successful: ${username} (${authResult.user.id}) in ${authDuration}ms using ${authResult.authMethod}`
    )

    // 返回登录结果（不包含敏感信息）
    res.json({
      success: true,
      message: 'Login successful',
      data: {
        sessionToken: sessionResult.sessionToken,
        sessionId: sessionResult.sessionId,
        expiresAt: sessionResult.expiresAt,
        user: {
          id: authResult.user.id,
          username: authResult.user.username,
          email: authResult.user.email,
          fullName: authResult.user.fullName,
          role: authResult.user.role,
          status: authResult.user.status,
          authMethod: authResult.user.authMethod,
          groups: authResult.user.groups || []
        },
        authMethod: authResult.authMethod
      }
    })
  } catch (error) {
    const authDuration = Date.now() - startTime
    logger.error(`❌ Login error (${authDuration}ms):`, {
      error: error.message,
      username: req.body?.username,
      ip: clientIP,
      userAgent: req.get('User-Agent')
    })

    res.status(500).json({
      error: 'Login failed',
      message: 'Internal server error during authentication'
    })
  }
})

/**
 * POST /auth/logout - 用户登出
 * 销毁当前用户会话
 */
router.post('/logout', authenticateUserSession, async (req, res) => {
  try {
    const { user, session } = req

    logger.info(`🚪 Logout request from user: ${user.username} (${user.id})`)

    // 销毁用户会话
    await userService.destroyUserSession(session.token)

    logger.success(`✅ User logout successful: ${user.username} (${user.id})`)

    res.json({
      success: true,
      message: 'Logout successful'
    })
  } catch (error) {
    logger.error('❌ Logout error:', {
      error: error.message,
      userId: req.user?.id,
      sessionId: req.session?.sessionId
    })

    res.status(500).json({
      error: 'Logout failed',
      message: 'Internal server error during logout'
    })
  }
})

/**
 * POST /auth/refresh - 刷新会话token
 * 更新当前会话的过期时间并返回新的token
 */
router.post('/refresh', async (req, res) => {
  try {
    // 从请求中提取会话token
    const sessionToken =
      req.headers['authorization']?.replace(/^Bearer\s+/i, '') ||
      req.headers['x-session-token'] ||
      req.cookies?.sessionToken

    if (!sessionToken) {
      return res.status(401).json({
        error: 'Missing session token',
        message: 'Please provide a valid session token'
      })
    }

    logger.info(`🔄 Session refresh request`)

    // 刷新用户会话
    const refreshResult = await userService.refreshUserSession(sessionToken)

    if (!refreshResult) {
      return res.status(401).json({
        error: 'Session refresh failed',
        message: 'Invalid or expired session token'
      })
    }

    logger.success(
      `✅ Session refresh successful for user: ${refreshResult.user.username} (${refreshResult.user.id})`
    )

    res.json({
      success: true,
      message: 'Session refreshed successfully',
      data: {
        sessionToken: refreshResult.sessionToken,
        sessionId: refreshResult.sessionId,
        expiresAt: refreshResult.expiresAt,
        user: refreshResult.user
      }
    })
  } catch (error) {
    logger.error('❌ Session refresh error:', {
      error: error.message,
      hasToken: !!req.headers['authorization']
    })

    res.status(500).json({
      error: 'Session refresh failed',
      message: 'Internal server error during session refresh'
    })
  }
})

/**
 * GET /auth/validate - 验证当前会话
 * 检查会话token的有效性并返回用户信息
 */
router.get('/validate', authenticateUserSession, async (req, res) => {
  try {
    const { user, session } = req

    logger.debug(`🔍 Session validation request from user: ${user.username} (${user.id})`)

    // 如果通过了authenticateUserSession中间件，说明会话有效
    res.json({
      success: true,
      message: 'Session is valid',
      data: {
        valid: true,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          status: user.status,
          authMethod: user.authMethod,
          groups: user.groups || []
        },
        session: {
          sessionId: session.sessionId,
          userId: session.userId
        }
      }
    })
  } catch (error) {
    logger.error('❌ Session validation error:', {
      error: error.message,
      userId: req.user?.id
    })

    res.status(500).json({
      error: 'Session validation failed',
      message: 'Internal server error during session validation'
    })
  }
})

/**
 * POST /auth/change-password - 修改用户密码
 * 用户修改自己的密码，需要提供当前密码
 */
router.post('/change-password', authenticateUserSession, async (req, res) => {
  const clientIP = req.ip || 'unknown'

  try {
    const { user } = req
    const { oldPassword, newPassword } = req.body

    // 应用密码修改速率限制（按用户ID）
    const rateLimitPassed = await applyRateLimit(changePasswordLimiter, user.id, req, res)
    if (!rateLimitPassed) {
      return
    }

    // 输入验证
    if (!oldPassword || typeof oldPassword !== 'string') {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Current password is required'
      })
    }

    const newPasswordValidation = validateInput.password(newPassword)
    if (!newPasswordValidation.valid) {
      return res.status(400).json({
        error: 'Validation failed',
        message: newPasswordValidation.errors.join(', ')
      })
    }

    logger.info(`🔐 Password change request from user: ${user.username} (${user.id})`)

    // 检查用户是否为LDAP用户
    if (user.authMethod === 'ldap') {
      logger.security(`🔒 LDAP user attempted password change: ${user.username}`)
      return res.status(400).json({
        error: 'Operation not allowed',
        message: 'LDAP users cannot change password locally'
      })
    }

    // 修改密码
    await userService.changePassword(user.id, oldPassword, newPassword)

    logger.success(`✅ Password changed successfully for user: ${user.username} (${user.id})`)

    res.json({
      success: true,
      message: 'Password changed successfully'
    })
  } catch (error) {
    logger.error('❌ Password change error:', {
      error: error.message,
      userId: req.user?.id,
      ip: clientIP
    })

    // 根据错误类型返回适当的状态码
    let statusCode = 500
    if (error.message.includes('Current password is incorrect')) {
      statusCode = 400
    } else if (error.message.includes('validation failed')) {
      statusCode = 400
    }

    res.status(statusCode).json({
      error: 'Password change failed',
      message: error.message
    })
  }
})

/**
 * POST /auth/reset-password - 重置用户密码
 * 管理员或用户自己重置密码，生成重置令牌
 */
router.post('/reset-password', async (req, res) => {
  const clientIP = req.ip || 'unknown'

  try {
    const { username } = req.body

    // 应用密码重置速率限制
    const rateLimitPassed = await applyRateLimit(resetPasswordLimiter, clientIP, req, res)
    if (!rateLimitPassed) {
      return
    }

    // 输入验证
    const usernameValidation = validateInput.username(username)
    if (!usernameValidation.valid) {
      return res.status(400).json({
        error: 'Validation failed',
        message: usernameValidation.errors.join(', ')
      })
    }

    logger.info(`🔄 Password reset request for user: ${username}`)

    // 获取用户信息
    const user = await userService.getUserByUsername(username)
    if (!user) {
      // 为了安全，不透露用户是否存在
      logger.security(
        `🔒 Password reset attempt for non-existent user: ${username} from ${clientIP}`
      )
      return res.json({
        success: true,
        message: 'If the user exists, a password reset token has been generated'
      })
    }

    // 检查用户是否为LDAP用户
    if (user.authMethod === 'ldap') {
      logger.security(`🔒 LDAP user attempted password reset: ${username}`)
      return res.status(400).json({
        error: 'Operation not allowed',
        message: 'LDAP users cannot reset password locally'
      })
    }

    // 生成密码重置令牌
    const resetResult = await userService.resetPassword(user.id)

    logger.success(`✅ Password reset token generated for user: ${username}`)

    res.json({
      success: true,
      message: 'Password reset token generated successfully',
      data: {
        resetToken: resetResult.resetToken,
        expiresAt: resetResult.expiresAt,
        email: resetResult.email || 'Email not available'
      }
    })
  } catch (error) {
    logger.error('❌ Password reset error:', {
      error: error.message,
      username: req.body?.username,
      ip: clientIP
    })

    res.status(500).json({
      error: 'Password reset failed',
      message: 'Internal server error during password reset'
    })
  }
})

/**
 * GET /auth/me - 获取当前用户信息
 * 返回当前登录用户的详细信息
 */
router.get('/me', authenticateUserSession, async (req, res) => {
  try {
    const { user } = req

    logger.debug(`👤 User info request from: ${user.username} (${user.id})`)

    res.json({
      success: true,
      data: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        status: user.status,
        authMethod: user.authMethod,
        groups: user.groups || []
      }
    })
  } catch (error) {
    logger.error('❌ Get user info error:', {
      error: error.message,
      userId: req.user?.id
    })

    res.status(500).json({
      error: 'Failed to get user info',
      message: 'Internal server error'
    })
  }
})

module.exports = router
