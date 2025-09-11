/**
 * @fileoverview 用户管理服务
 *
 * 提供完整的用户管理功能，包括：
 * - 本地用户认证和LDAP认证集成
 * - 用户CRUD操作和数据验证
 * - 会话管理和JWT令牌处理
 * - 密码管理和安全策略
 * - 权限验证和用户组管理
 * - 审计日志和安全监控
 *
 * @author Claude Code
 * @version 1.0.0
 */

const { v4: uuidv4 } = require('uuid')
const database = require('../models/database')
const userAuth = require('../utils/userAuth')
const logger = require('../utils/logger')
const _config = require('../../config/config')

class UserService {
  constructor() {
    // 认证配置
    this.authConfig = {
      maxLoginAttempts: 5,
      lockoutDuration: 15 * 60 * 1000, // 15分钟
      sessionTimeout: 24 * 60 * 60 * 1000, // 24小时
      passwordResetExpiry: 15 * 60 * 1000 // 15分钟
    }

    // 用户状态枚举
    this.userStatus = {
      ACTIVE: 'active',
      INACTIVE: 'inactive',
      LOCKED: 'locked',
      SUSPENDED: 'suspended'
    }

    // 用户角色枚举
    this.userRoles = {
      ADMIN: 'admin',
      USER: 'user',
      VIEWER: 'viewer'
    }

    // 认证方法
    this.authMethods = {
      LOCAL: 'local',
      LDAP: 'ldap',
      AUTO: 'auto'
    }

    logger.info('🔐 UserService initialized successfully')
  }

  // ==================== 认证方法 ====================

  /**
   * 本地用户认证
   * @param {string} username - 用户名
   * @param {string} password - 密码
   * @param {Object} authContext - 认证上下文（IP、UA等）
   * @returns {Promise<Object>} 认证结果
   */
  async authenticateLocal(username, password, authContext = {}) {
    try {
      if (!username || !password) {
        throw new Error('Username and password are required')
      }

      logger.debug('🔐 Starting local authentication', { username })

      // 检查用户是否存在
      const user = await database.getUserByUsername(username)
      if (!user) {
        await this._recordFailedAttempt(username, 'user_not_found', authContext)
        throw new Error('Invalid username or password')
      }

      // 检查用户状态
      if (user.status !== this.userStatus.ACTIVE) {
        await this._recordFailedAttempt(username, 'user_inactive', authContext)
        throw new Error(`User account is ${user.status}`)
      }

      // 检查账户锁定状态
      const lockStatus = await this._checkAccountLock(user.id)
      if (lockStatus.locked) {
        throw new Error(
          `Account is locked. Try again after ${Math.ceil(lockStatus.remainingMinutes)} minutes`
        )
      }

      // 验证密码
      const isValidPassword = await userAuth.validatePassword(password, user.passwordHash)
      if (!isValidPassword) {
        await this._recordFailedAttempt(username, 'invalid_password', authContext)
        await this._incrementFailedAttempts(user.id)
        throw new Error('Invalid username or password')
      }

      // 认证成功，清除失败记录
      await this._clearFailedAttempts(user.id)
      await this._recordSuccessfulLogin(user.id, authContext)

      // 返回用户信息（不包含敏感数据）
      const userInfo = this._sanitizeUserData(user)

      logger.success('✅ Local authentication successful', {
        userId: user.id,
        username: user.username
      })

      return {
        success: true,
        user: userInfo,
        authMethod: this.authMethods.LOCAL
      }
    } catch (error) {
      logger.error('❌ Local authentication failed:', error)
      throw error
    }
  }

  /**
   * LDAP用户认证
   * @param {string} username - 用户名
   * @param {string} password - 密码
   * @param {Object} authContext - 认证上下文
   * @returns {Promise<Object>} 认证结果
   */
  async authenticateLDAP(username, password, authContext = {}) {
    try {
      if (!username || !password) {
        throw new Error('Username and password are required')
      }

      logger.debug('🔐 Starting LDAP authentication', { username })

      // 检查LDAP是否可用
      let ldapHelper
      try {
        ldapHelper = require('../utils/ldapHelper')
      } catch (error) {
        logger.warn('⚠️ LDAP helper not available, falling back to local auth')
        return await this.authenticateLocal(username, password, authContext)
      }

      // LDAP认证
      let ldapResult
      try {
        ldapResult = await ldapHelper.authenticateUser(username, password)
      } catch (ldapError) {
        logger.warn('⚠️ LDAP authentication failed, falling back to local auth:', ldapError.message)
        return await this.authenticateLocal(username, password, authContext)
      }

      if (!ldapResult.success) {
        await this._recordFailedAttempt(username, 'ldap_auth_failed', authContext)
        throw new Error('LDAP authentication failed')
      }

      // 检查本地用户是否存在，如果不存在则创建
      let user = await database.getUserByUsername(username)
      if (!user) {
        logger.info('🆕 Creating new user from LDAP data', { username })

        const userData = {
          username,
          email: ldapResult.userInfo.email || '',
          fullName: ldapResult.userInfo.fullName || username,
          authMethod: this.authMethods.LDAP,
          status: this.userStatus.ACTIVE,
          role: this.userRoles.USER,
          groups: ldapResult.userInfo.groups || [],
          ldapDn: ldapResult.userInfo.dn,
          // LDAP用户不需要本地密码
          passwordHash: null
        }

        user = await this.createUser(userData)
      } else {
        // 同步LDAP用户信息
        const updateData = {
          email: ldapResult.userInfo.email || user.email,
          fullName: ldapResult.userInfo.fullName || user.fullName,
          groups: ldapResult.userInfo.groups || user.groups,
          ldapDn: ldapResult.userInfo.dn,
          lastLdapSync: new Date().toISOString()
        }

        await this.updateUser(user.id, updateData)
        user = { ...user, ...updateData }
      }

      // 检查用户状态
      if (user.status !== this.userStatus.ACTIVE) {
        throw new Error(`User account is ${user.status}`)
      }

      // 记录成功登录
      await this._recordSuccessfulLogin(user.id, authContext)

      const userInfo = this._sanitizeUserData(user)

      logger.success('✅ LDAP authentication successful', {
        userId: user.id,
        username: user.username
      })

      return {
        success: true,
        user: userInfo,
        authMethod: this.authMethods.LDAP
      }
    } catch (error) {
      logger.error('❌ LDAP authentication failed:', error)
      throw error
    }
  }

  /**
   * 统一认证入口（自动选择认证方式）
   * @param {string} username - 用户名
   * @param {string} password - 密码
   * @param {string} method - 认证方法 ('auto', 'local', 'ldap')
   * @param {Object} authContext - 认证上下文
   * @returns {Promise<Object>} 认证结果
   */
  async authenticate(username, password, method = 'auto', authContext = {}) {
    try {
      logger.debug('🔐 Starting authentication', { username, method })

      // 参数验证
      if (!username || !password) {
        throw new Error('Username and password are required')
      }

      if (!Object.values(this.authMethods).includes(method)) {
        throw new Error(`Invalid authentication method: ${method}`)
      }

      let result

      switch (method) {
        case this.authMethods.LOCAL:
          result = await this.authenticateLocal(username, password, authContext)
          break

        case this.authMethods.LDAP:
          result = await this.authenticateLDAP(username, password, authContext)
          break

        case this.authMethods.AUTO:
        default:
          // 自动选择：优先尝试本地认证，失败则尝试LDAP
          try {
            result = await this.authenticateLocal(username, password, authContext)
          } catch (localError) {
            if (localError.message.includes('Invalid username or password')) {
              logger.debug('🔄 Local auth failed, trying LDAP')
              result = await this.authenticateLDAP(username, password, authContext)
            } else {
              throw localError
            }
          }
          break
      }

      return result
    } catch (error) {
      logger.error('❌ Authentication failed:', error)
      throw error
    }
  }

  // ==================== 用户CRUD操作 ====================

  /**
   * 创建用户
   * @param {Object} userData - 用户数据
   * @returns {Promise<Object>} 创建的用户信息
   */
  async createUser(userData) {
    try {
      logger.debug('👤 Creating new user', { username: userData.username })

      // 数据验证
      const validationResult = this.validateUserData(userData)
      if (!validationResult.valid) {
        throw new Error(`User data validation failed: ${validationResult.errors.join(', ')}`)
      }

      // 检查用户名是否已存在
      const existingUser = await database.getUserByUsername(userData.username)
      if (existingUser) {
        throw new Error(`Username '${userData.username}' already exists`)
      }

      // 检查邮箱是否已存在
      if (userData.email) {
        const existingEmailUser = await this._getUserByEmail(userData.email)
        if (existingEmailUser) {
          throw new Error(`Email '${userData.email}' already exists`)
        }
      }

      // 处理密码哈希（仅本地用户）
      let passwordHash = null
      if (userData.password && userData.authMethod !== this.authMethods.LDAP) {
        passwordHash = await userAuth.hashPassword(userData.password)
      }

      // 构建用户数据
      const userId = uuidv4()
      const now = new Date().toISOString()

      const newUser = {
        id: userId,
        username: userData.username,
        email: userData.email || '',
        fullName: userData.fullName || '',
        passwordHash,
        status: userData.status || this.userStatus.ACTIVE,
        role: userData.role || this.userRoles.USER,
        authMethod: userData.authMethod || this.authMethods.LOCAL,
        groups: userData.groups || [],
        metadata: userData.metadata || {},
        ldapDn: userData.ldapDn || '',
        createdAt: now,
        updatedAt: now,
        lastLoginAt: '',
        failedLoginAttempts: 0,
        lockedUntil: '',
        passwordChangedAt: passwordHash ? now : '',
        emailVerified: userData.emailVerified || false,
        isActive: true
      }

      // 保存到数据库
      await database.createUser(newUser)

      // 记录审计日志
      await this._recordAuditLog('user_created', userId, null, { username: userData.username })

      const userInfo = this._sanitizeUserData(newUser)

      logger.success('✅ User created successfully', {
        userId,
        username: userData.username
      })

      return userInfo
    } catch (error) {
      logger.error('❌ User creation failed:', error)
      throw error
    }
  }

  /**
   * 更新用户信息
   * @param {string} userId - 用户ID
   * @param {Object} updateData - 更新数据
   * @returns {Promise<Object>} 更新后的用户信息
   */
  async updateUser(userId, updateData) {
    try {
      logger.debug('📝 Updating user', { userId })

      // 检查用户是否存在
      const existingUser = await database.getUserById(userId)
      if (!existingUser) {
        throw new Error('User not found')
      }

      // 验证更新数据
      const allowedFields = [
        'email',
        'fullName',
        'status',
        'role',
        'groups',
        'metadata',
        'ldapDn',
        'emailVerified',
        'isActive'
      ]

      const filteredUpdate = {}
      for (const [field, value] of Object.entries(updateData)) {
        if (allowedFields.includes(field)) {
          filteredUpdate[field] = value
        }
      }

      // 检查邮箱唯一性
      if (filteredUpdate.email && filteredUpdate.email !== existingUser.email) {
        const existingEmailUser = await this._getUserByEmail(filteredUpdate.email)
        if (existingEmailUser && existingEmailUser.id !== userId) {
          throw new Error(`Email '${filteredUpdate.email}' already exists`)
        }
      }

      // 添加更新时间
      filteredUpdate.updatedAt = new Date().toISOString()

      // 更新数据库
      await database.updateUser(userId, filteredUpdate)

      // 获取更新后的用户信息
      const updatedUser = await database.getUserById(userId)

      // 记录审计日志
      await this._recordAuditLog('user_updated', userId, null, filteredUpdate)

      const userInfo = this._sanitizeUserData(updatedUser)

      logger.success('✅ User updated successfully', { userId })

      return userInfo
    } catch (error) {
      logger.error('❌ User update failed:', error)
      throw error
    }
  }

  /**
   * 删除用户（软删除）
   * @param {string} userId - 用户ID
   * @returns {Promise<Object>} 操作结果
   */
  async deleteUser(userId) {
    try {
      logger.debug('🗑️ Deleting user', { userId })

      // 检查用户是否存在
      const existingUser = await database.getUserById(userId)
      if (!existingUser) {
        throw new Error('User not found')
      }

      // 软删除：设置状态为inactive并添加删除标记
      const updateData = {
        status: this.userStatus.INACTIVE,
        isActive: false,
        deletedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }

      await database.updateUser(userId, updateData)

      // 清除用户的所有活跃会话
      await this._clearAllUserSessions(userId)

      // 记录审计日志
      await this._recordAuditLog('user_deleted', userId, null, { username: existingUser.username })

      logger.success('✅ User deleted successfully', { userId })

      return { success: true, userId }
    } catch (error) {
      logger.error('❌ User deletion failed:', error)
      throw error
    }
  }

  /**
   * 根据ID获取用户
   * @param {string} userId - 用户ID
   * @returns {Promise<Object|null>} 用户信息
   */
  async getUserById(userId) {
    try {
      const user = await database.getUserById(userId)
      return user ? this._sanitizeUserData(user) : null
    } catch (error) {
      logger.error('❌ Get user by ID failed:', error)
      throw error
    }
  }

  /**
   * 根据用户名获取用户
   * @param {string} username - 用户名
   * @returns {Promise<Object|null>} 用户信息
   */
  async getUserByUsername(username) {
    try {
      const user = await database.getUserByUsername(username)
      return user ? this._sanitizeUserData(user) : null
    } catch (error) {
      logger.error('❌ Get user by username failed:', error)
      throw error
    }
  }

  // ==================== 会话管理 ====================

  /**
   * 创建用户会话
   * @param {string} userId - 用户ID
   * @param {Object} sessionInfo - 会话信息
   * @returns {Promise<Object>} 会话数据
   */
  async createUserSession(userId, sessionInfo = {}) {
    try {
      logger.debug('🎫 Creating user session', { userId })

      // 验证用户存在
      const user = await database.getUserById(userId)
      if (!user) {
        throw new Error('User not found')
      }

      if (user.status !== this.userStatus.ACTIVE) {
        throw new Error(`User account is ${user.status}`)
      }

      // 生成会话数据
      const sessionData = userAuth.createSessionData(userId, sessionInfo)

      // 生成JWT令牌
      const tokenPayload = {
        userId,
        username: user.username,
        role: user.role,
        sessionId: sessionData.sessionId
      }

      const jwtToken = userAuth.generateJWT(tokenPayload)

      // 存储会话
      const sessionExpiry = Math.floor((Date.parse(sessionData.expiresAt) - Date.now()) / 1000)

      await database.createSession(
        userId,
        {
          ...sessionData,
          jwtToken
        },
        sessionExpiry
      )

      // 更新用户最后登录时间
      await this.updateUser(userId, {
        lastLoginAt: new Date().toISOString()
      })

      logger.success('✅ User session created successfully', {
        userId,
        sessionId: sessionData.sessionId
      })

      return {
        sessionToken: jwtToken,
        sessionId: sessionData.sessionId,
        expiresAt: sessionData.expiresAt,
        user: this._sanitizeUserData(user)
      }
    } catch (error) {
      logger.error('❌ Session creation failed:', error)
      throw error
    }
  }

  /**
   * 验证用户会话
   * @param {string} sessionToken - 会话令牌
   * @returns {Promise<Object|null>} 会话验证结果
   */
  async validateUserSession(sessionToken) {
    try {
      if (!sessionToken) {
        return null
      }

      // 验证JWT令牌
      const decoded = userAuth.validateJWT(sessionToken)
      if (!decoded) {
        return null
      }

      // 从数据库验证会话
      const sessionData = await database.validateSession(sessionToken)
      if (!sessionData) {
        return null
      }

      // 验证会话有效性
      if (!userAuth.isSessionValid(sessionData)) {
        await database.destroySession(sessionToken)
        return null
      }

      // 更新会话活动时间
      const updatedSession = userAuth.updateSessionActivity(sessionData)
      await database.createSession(
        sessionData.userId,
        updatedSession,
        Math.floor((Date.parse(updatedSession.expiresAt) - Date.now()) / 1000)
      )

      logger.debug('✅ Session validation successful', {
        userId: sessionData.userId,
        sessionId: sessionData.sessionId
      })

      return {
        valid: true,
        userId: sessionData.userId,
        sessionId: sessionData.sessionId,
        user: sessionData.user
      }
    } catch (error) {
      logger.error('❌ Session validation failed:', error)
      return null
    }
  }

  /**
   * 刷新用户会话
   * @param {string} sessionToken - 当前会话令牌
   * @returns {Promise<Object|null>} 新的会话信息
   */
  async refreshUserSession(sessionToken) {
    try {
      logger.debug('🔄 Refreshing user session')

      // 验证当前会话
      const sessionData = await this.validateUserSession(sessionToken)
      if (!sessionData) {
        throw new Error('Invalid session token')
      }

      // 生成新的JWT令牌
      const newToken = userAuth.refreshJWT(sessionToken)
      if (!newToken) {
        throw new Error('Cannot refresh session token')
      }

      // 获取用户信息
      const user = await database.getUserById(sessionData.userId)
      if (!user) {
        throw new Error('User not found')
      }

      // 更新会话数据
      const newSessionData = {
        ...sessionData,
        jwtToken: newToken,
        lastActivity: new Date().toISOString()
      }

      await database.createSession(
        sessionData.userId,
        newSessionData,
        Math.floor((Date.parse(newSessionData.expiresAt) - Date.now()) / 1000)
      )

      logger.success('✅ Session refreshed successfully', {
        userId: sessionData.userId
      })

      return {
        sessionToken: newToken,
        sessionId: sessionData.sessionId,
        expiresAt: newSessionData.expiresAt,
        user: this._sanitizeUserData(user)
      }
    } catch (error) {
      logger.error('❌ Session refresh failed:', error)
      throw error
    }
  }

  /**
   * 销毁用户会话
   * @param {string} sessionToken - 会话令牌
   * @returns {Promise<Object>} 操作结果
   */
  async destroyUserSession(sessionToken) {
    try {
      logger.debug('🗑️ Destroying user session')

      // 获取会话信息
      const sessionData = await database.validateSession(sessionToken)

      // 删除会话
      await database.destroySession(sessionToken)

      // 记录审计日志
      if (sessionData) {
        await this._recordAuditLog('session_destroyed', sessionData.userId, null, {
          sessionId: sessionData.sessionId
        })
      }

      logger.success('✅ Session destroyed successfully')

      return { success: true }
    } catch (error) {
      logger.error('❌ Session destruction failed:', error)
      throw error
    }
  }

  // ==================== 密码管理 ====================

  /**
   * 修改用户密码
   * @param {string} userId - 用户ID
   * @param {string} oldPassword - 旧密码
   * @param {string} newPassword - 新密码
   * @returns {Promise<Object>} 操作结果
   */
  async changePassword(userId, oldPassword, newPassword) {
    try {
      logger.debug('🔐 Changing user password', { userId })

      // 获取用户信息
      const user = await database.getUserById(userId)
      if (!user) {
        throw new Error('User not found')
      }

      // LDAP用户不能修改密码
      if (user.authMethod === this.authMethods.LDAP) {
        throw new Error('LDAP users cannot change password locally')
      }

      // 验证旧密码
      if (user.passwordHash) {
        const isValidOldPassword = await userAuth.validatePassword(oldPassword, user.passwordHash)
        if (!isValidOldPassword) {
          throw new Error('Current password is incorrect')
        }
      }

      // 验证新密码强度
      const passwordValidation = userAuth.validatePasswordStrength(newPassword)
      if (!passwordValidation.valid) {
        throw new Error(`New password validation failed: ${passwordValidation.errors.join(', ')}`)
      }

      // 哈希新密码
      const newPasswordHash = await userAuth.hashPassword(newPassword)

      // 更新密码
      await database.updateUser(userId, {
        passwordHash: newPasswordHash,
        passwordChangedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })

      // 清除用户的所有其他会话（强制重新登录）
      await this._clearAllUserSessions(userId)

      // 记录审计日志
      await this._recordAuditLog('password_changed', userId, null, {})

      logger.success('✅ Password changed successfully', { userId })

      return { success: true }
    } catch (error) {
      logger.error('❌ Password change failed:', error)
      throw error
    }
  }

  /**
   * 请求重置用户密码（生成重置令牌）
   * @param {string} userId - 用户ID
   * @returns {Promise<Object>} 重置信息
   */
  async requestPasswordReset(userId) {
    try {
      logger.debug('🔄 Resetting user password', { userId })

      // 获取用户信息
      const user = await database.getUserById(userId)
      if (!user) {
        throw new Error('User not found')
      }

      // LDAP用户不能重置密码
      if (user.authMethod === this.authMethods.LDAP) {
        throw new Error('LDAP users cannot reset password locally')
      }

      // 生成重置令牌
      const resetTokenData = userAuth.generatePasswordResetToken(userId)

      // 存储重置令牌（15分钟过期）
      const tokenKey = `password_reset:${userId}:${resetTokenData.token}`
      await database.client.setex(tokenKey, 15 * 60, JSON.stringify(resetTokenData))

      // 记录审计日志
      await this._recordAuditLog('password_reset_requested', userId, null, {})

      logger.success('✅ Password reset token generated', { userId })

      return {
        success: true,
        resetToken: resetTokenData.token,
        expiresAt: resetTokenData.expiresAt,
        email: user.email
      }
    } catch (error) {
      logger.error('❌ Password reset failed:', error)
      throw error
    }
  }

  // ==================== 数据验证 ====================

  /**
   * 验证用户数据
   * @param {Object} userData - 用户数据
   * @returns {Object} 验证结果
   */
  validateUserData(userData) {
    const result = {
      valid: false,
      errors: []
    }

    if (!userData || typeof userData !== 'object') {
      result.errors.push('User data is required')
      return result
    }

    // 用户名验证
    if (!userData.username) {
      result.errors.push('Username is required')
    } else if (typeof userData.username !== 'string') {
      result.errors.push('Username must be a string')
    } else if (userData.username.length < 3) {
      result.errors.push('Username must be at least 3 characters long')
    } else if (userData.username.length > 50) {
      result.errors.push('Username must not exceed 50 characters')
    } else if (!/^[a-zA-Z0-9_-]+$/.test(userData.username)) {
      result.errors.push('Username can only contain letters, numbers, underscores, and hyphens')
    }

    // 邮箱验证
    if (userData.email && typeof userData.email === 'string') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(userData.email)) {
        result.errors.push('Invalid email format')
      }
    }

    // 密码验证（仅本地用户）
    if (userData.password && userData.authMethod !== this.authMethods.LDAP) {
      const passwordValidation = userAuth.validatePasswordStrength(userData.password)
      if (!passwordValidation.valid) {
        result.errors.push(...passwordValidation.errors)
      }
    }

    // 状态验证
    if (userData.status && !Object.values(this.userStatus).includes(userData.status)) {
      result.errors.push('Invalid user status')
    }

    // 角色验证
    if (userData.role && !Object.values(this.userRoles).includes(userData.role)) {
      result.errors.push('Invalid user role')
    }

    // 认证方法验证
    if (userData.authMethod && !Object.values(this.authMethods).includes(userData.authMethod)) {
      result.errors.push('Invalid authentication method')
    }

    // 用户组验证
    if (userData.groups && !Array.isArray(userData.groups)) {
      result.errors.push('User groups must be an array')
    }

    result.valid = result.errors.length === 0
    return result
  }

  /**
   * 检查用户权限
   * @param {string} userId - 用户ID
   * @param {string|Array} requiredPermissions - 需要的权限
   * @returns {Promise<boolean>} 是否有权限
   */
  async checkUserPermissions(userId, requiredPermissions) {
    try {
      const user = await database.getUserById(userId)
      if (!user || user.status !== this.userStatus.ACTIVE) {
        return false
      }

      // 管理员拥有所有权限
      if (user.role === this.userRoles.ADMIN) {
        return true
      }

      // 将权限转换为数组
      const permissions = Array.isArray(requiredPermissions)
        ? requiredPermissions
        : [requiredPermissions]

      // 基于角色的简单权限检查
      const rolePermissions = {
        [this.userRoles.ADMIN]: ['*'], // 所有权限
        [this.userRoles.USER]: ['read', 'write'],
        [this.userRoles.VIEWER]: ['read']
      }

      const userPermissions = rolePermissions[user.role] || []

      // 检查是否拥有所需权限
      return permissions.every(
        (permission) => userPermissions.includes('*') || userPermissions.includes(permission)
      )
    } catch (error) {
      logger.error('❌ Permission check failed:', error)
      return false
    }
  }

  // ==================== 私有辅助方法 ====================

  /**
   * 清理用户数据（移除敏感信息）
   */
  _sanitizeUserData(user) {
    if (!user) {
      return null
    }

    const { passwordHash: _passwordHash, ...sanitized } = user
    return sanitized
  }

  /**
   * 记录失败登录尝试
   */
  async _recordFailedAttempt(username, reason, authContext) {
    try {
      const attemptKey = `failed_login:${username}`
      await database.client.lpush(
        attemptKey,
        JSON.stringify({
          reason,
          timestamp: new Date().toISOString(),
          ipAddress: authContext.ipAddress || '',
          userAgent: authContext.userAgent || ''
        })
      )
      await database.client.expire(attemptKey, 3600) // 1小时过期

      logger.warn('⚠️ Failed login attempt recorded', { username, reason })
    } catch (error) {
      logger.error('❌ Failed to record login attempt:', error)
    }
  }

  /**
   * 检查账户锁定状态
   */
  async _checkAccountLock(userId) {
    try {
      const lockKey = `account_lock:${userId}`
      const lockData = await database.client.get(lockKey)

      if (lockData) {
        const { lockedUntil } = JSON.parse(lockData)
        const now = Date.now()
        const lockExpiry = Date.parse(lockedUntil)

        if (now < lockExpiry) {
          return {
            locked: true,
            remainingMinutes: (lockExpiry - now) / (1000 * 60)
          }
        } else {
          // 锁定已过期，删除
          await database.client.del(lockKey)
        }
      }

      return { locked: false }
    } catch (error) {
      logger.error('❌ Failed to check account lock:', error)
      return { locked: false }
    }
  }

  /**
   * 增加失败登录次数
   */
  async _incrementFailedAttempts(userId) {
    try {
      const attemptsKey = `login_attempts:${userId}`
      const attempts = await database.client.incr(attemptsKey)
      await database.client.expire(attemptsKey, 3600) // 1小时过期

      if (attempts >= this.authConfig.maxLoginAttempts) {
        const lockKey = `account_lock:${userId}`
        const lockedUntil = new Date(Date.now() + this.authConfig.lockoutDuration).toISOString()

        await database.client.setex(
          lockKey,
          Math.ceil(this.authConfig.lockoutDuration / 1000),
          JSON.stringify({ lockedUntil })
        )

        logger.warn('🔒 Account locked due to too many failed attempts', { userId })
      }
    } catch (error) {
      logger.error('❌ Failed to increment login attempts:', error)
    }
  }

  /**
   * 清除失败登录记录
   */
  async _clearFailedAttempts(userId) {
    try {
      const attemptsKey = `login_attempts:${userId}`
      await database.client.del(attemptsKey)
    } catch (error) {
      logger.error('❌ Failed to clear login attempts:', error)
    }
  }

  /**
   * 记录成功登录
   */
  async _recordSuccessfulLogin(userId, authContext) {
    try {
      const loginData = {
        userId,
        timestamp: new Date().toISOString(),
        ipAddress: authContext.ipAddress || '',
        userAgent: authContext.userAgent || ''
      }

      const loginKey = `successful_login:${userId}`
      await database.client.lpush(loginKey, JSON.stringify(loginData))
      await database.client.ltrim(loginKey, 0, 9) // 保留最近10次登录
      await database.client.expire(loginKey, 30 * 24 * 3600) // 30天过期
    } catch (error) {
      logger.error('❌ Failed to record successful login:', error)
    }
  }

  /**
   * 记录审计日志
   */
  async _recordAuditLog(action, userId, operatorId = null, details = {}) {
    try {
      const auditData = {
        action,
        userId,
        operatorId: operatorId || userId,
        details,
        timestamp: new Date().toISOString()
      }

      const auditKey = `audit_log:${new Date().toISOString().split('T')[0]}`
      await database.client.lpush(auditKey, JSON.stringify(auditData))
      await database.client.expire(auditKey, 90 * 24 * 3600) // 90天过期

      logger.debug('📝 Audit log recorded', { action, userId })
    } catch (error) {
      logger.error('❌ Failed to record audit log:', error)
    }
  }

  /**
   * 根据邮箱获取用户
   */
  async _getUserByEmail(email) {
    try {
      // 这里需要数据库适配器支持按邮箱查询
      // 暂时使用简单的扫描方法，实际应该建立邮箱索引
      const emailKey = `user_email:${email.toLowerCase()}`
      const userId = await database.client.get(emailKey)

      if (userId) {
        return await database.getUserById(userId)
      }

      return null
    } catch (error) {
      logger.error('❌ Failed to get user by email:', error)
      return null
    }
  }

  /**
   * 清除用户的所有会话
   */
  async _clearAllUserSessions(userId) {
    try {
      // 获取用户的所有会话
      const sessionPattern = `session:*`
      const keys = await database.client.keys(sessionPattern)

      for (const key of keys) {
        const sessionData = await database.client.get(key)
        if (sessionData) {
          const parsed = JSON.parse(sessionData)
          if (parsed.userId === userId) {
            await database.client.del(key)
          }
        }
      }

      logger.debug('🧹 Cleared all user sessions', { userId })
    } catch (error) {
      logger.error('❌ Failed to clear user sessions:', error)
    }
  }

  /**
   * 获取用户列表（分页、搜索、过滤）
   */
  async getUserList(options = {}) {
    try {
      const {
        offset = 0,
        limit = 20,
        filters = {},
        sortBy = 'createdAt',
        sortOrder = 'desc'
      } = options

      // 获取所有用户ID
      const userPattern = 'user:*'
      const keys = await database.client.keys(userPattern)

      const users = []
      for (const key of keys) {
        try {
          const userData = await database.client.hgetall(key)
          if (userData && userData.id && !userData.deleted) {
            // 解析JSON字段
            const user = {
              ...userData,
              metadata: userData.metadata ? JSON.parse(userData.metadata) : {},
              createdAt: userData.createdAt ? new Date(userData.createdAt) : new Date(),
              updatedAt: userData.updatedAt ? new Date(userData.updatedAt) : new Date(),
              lastLoginAt: userData.lastLoginAt ? new Date(userData.lastLoginAt) : null,
              lockedUntil: userData.lockedUntil ? new Date(userData.lockedUntil) : null,
              failedLoginAttempts: parseInt(userData.failedLoginAttempts) || 0
            }

            // 应用过滤器
            let include = true

            if (filters.search && filters.search.trim()) {
              const search = filters.search.toLowerCase()
              include =
                include &&
                (user.username?.toLowerCase().includes(search) ||
                  user.email?.toLowerCase().includes(search) ||
                  user.fullName?.toLowerCase().includes(search))
            }

            if (filters.status) {
              include = include && user.status === filters.status
            }

            if (filters.role) {
              include = include && user.role === filters.role
            }

            if (filters.authMethod) {
              include = include && user.authMethod === filters.authMethod
            }

            if (include) {
              users.push(user)
            }
          }
        } catch (parseError) {
          logger.warn(`跳过无效用户数据: ${key}`, parseError)
        }
      }

      // 排序
      users.sort((a, b) => {
        let valueA = a[sortBy]
        let valueB = b[sortBy]

        if (sortBy === 'createdAt' || sortBy === 'updatedAt' || sortBy === 'lastLoginAt') {
          valueA = valueA?.getTime() || 0
          valueB = valueB?.getTime() || 0
        } else if (typeof valueA === 'string') {
          valueA = valueA.toLowerCase()
          valueB = valueB?.toLowerCase() || ''
        }

        if (sortOrder === 'desc') {
          return valueB > valueA ? 1 : valueB < valueA ? -1 : 0
        } else {
          return valueA > valueB ? 1 : valueA < valueB ? -1 : 0
        }
      })

      // 分页
      const total = users.length
      const paginatedUsers = users.slice(offset, offset + limit)

      // 移除敏感信息
      const cleanUsers = paginatedUsers.map((user) => {
        const { passwordHash: _passwordHash, salt: _salt, ...cleanUser } = user
        return cleanUser
      })

      logger.debug(`获取用户列表: total=${total}, offset=${offset}, limit=${limit}`)

      return {
        users: cleanUsers,
        total
      }
    } catch (error) {
      logger.error('❌ Failed to get user list:', error)
      throw new Error('Failed to get user list')
    }
  }

  /**
   * 获取用户统计信息
   */
  async getUserStats(userId) {
    try {
      const user = await this.getUserById(userId)
      if (!user) {
        throw new Error('User not found')
      }

      // 获取用户会话信息
      const sessions = await this.getUserSessions(userId)
      const activeSessions = sessions.filter((s) => s.isActive)

      // 基本统计
      const stats = {
        totalSessions: sessions.length,
        activeSessions: activeSessions.length,
        lastLoginAt: user.lastLoginAt,
        failedLoginAttempts: user.failedLoginAttempts || 0,
        accountStatus: user.status,
        isLocked: user.lockedUntil && new Date(user.lockedUntil) > new Date(),
        createdAt: user.createdAt,
        lastActivity: sessions.length > 0 ? sessions[0].lastActivity : null
      }

      return stats
    } catch (error) {
      logger.error(`❌ Failed to get user stats (${userId}):`, error)
      throw new Error('Failed to get user stats')
    }
  }

  /**
   * 解锁用户账户
   */
  async unlockUser(userId, options = {}) {
    try {
      const user = await this.getUserById(userId)
      if (!user) {
        throw new Error('User not found')
      }

      const isLocked = user.lockedUntil && new Date(user.lockedUntil) > new Date()
      if (!isLocked) {
        throw new Error('User account is not locked')
      }

      // 解锁账户
      await this.updateUser(userId, {
        lockedUntil: null,
        failedLoginAttempts: 0,
        status: 'active'
      })

      // 记录审计日志
      await this._recordAuditLog('unlock_user', userId, options.adminId, {
        reason: options.reason || 'Manual unlock',
        unlockTime: new Date().toISOString()
      })

      const updatedUser = await this.getUserById(userId)

      logger.info(`🔓 User account unlocked: ${user.username} (${userId})`)

      return { user: updatedUser }
    } catch (error) {
      logger.error(`❌ Failed to unlock user (${userId}):`, error)
      throw error
    }
  }

  /**
   * 重置用户密码（管理员操作）
   */
  async resetPassword(userId, options = {}) {
    try {
      const user = await this.getUserById(userId)
      if (!user) {
        throw new Error('User not found')
      }

      if (user.authMethod !== 'local') {
        throw new Error('Password reset is only available for local authentication users')
      }

      const { newPassword, forceChange = true, adminReset = false, adminId } = options

      // 生成新的盐值和密码哈希
      const salt = userAuth.generateSalt()
      const passwordHash = userAuth.hashPassword(newPassword, salt)

      // 计算密码过期时间（如果强制更改）
      const passwordExpiresAt = forceChange
        ? new Date(Date.now() + 24 * 60 * 60 * 1000) // 24小时后过期
        : null

      // 更新用户密码
      await this.updateUser(userId, {
        passwordHash,
        salt,
        passwordExpiresAt: passwordExpiresAt?.toISOString(),
        updatedAt: new Date().toISOString()
      })

      // 清除所有现有会话（强制重新登录）
      await this._clearAllUserSessions(userId)

      // 记录审计日志
      await this._recordAuditLog('reset_password', userId, adminId, {
        adminReset,
        forceChange,
        expiresAt: passwordExpiresAt?.toISOString()
      })

      logger.info(`🔑 Password reset: ${user.username} (${userId}), forceChange=${forceChange}`)

      return {
        forceChange,
        expiresAt: passwordExpiresAt?.toISOString()
      }
    } catch (error) {
      logger.error(`❌ Failed to reset password (${userId}):`, error)
      throw error
    }
  }

  /**
   * 获取用户会话列表
   */
  async getUserSessions(userId, options = {}) {
    try {
      const { includeExpired = false, limit = 50 } = options

      const sessionPattern = 'session:*'
      const keys = await database.client.keys(sessionPattern)

      let userSessions = []

      for (const key of keys) {
        try {
          const sessionData = await database.client.get(key)
          if (!sessionData) {
            continue
          }

          const session = JSON.parse(sessionData)
          if (session.userId !== userId) {
            continue
          }

          const isActive = new Date(session.expiresAt) > new Date()

          if (!includeExpired && !isActive) {
            continue
          }

          userSessions.push({
            sessionId: session.sessionId || key.replace('session:', ''),
            userId: session.userId,
            createdAt: session.createdAt,
            expiresAt: session.expiresAt,
            lastActivity: session.lastActivity || session.createdAt,
            ipAddress: session.ipAddress,
            userAgent: session.userAgent,
            isActive
          })
        } catch (parseError) {
          logger.warn(`跳过无效会话数据: ${key}`, parseError)
        }
      }

      // 按最后活动时间排序
      userSessions.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity))

      // 限制数量
      if (limit > 0) {
        userSessions = userSessions.slice(0, limit)
      }

      return userSessions
    } catch (error) {
      logger.error(`❌ Failed to get user sessions (${userId}):`, error)
      throw new Error('Failed to get user sessions')
    }
  }

  /**
   * 删除特定会话
   */
  async invalidateSession(sessionId, options = {}) {
    try {
      const sessionKey = sessionId.startsWith('session:') ? sessionId : `session:${sessionId}`
      const sessionData = await database.client.get(sessionKey)

      if (!sessionData) {
        return { found: false }
      }

      const session = JSON.parse(sessionData)

      // 删除会话
      await database.client.del(sessionKey)

      // 记录审计日志
      if (options.adminAction && options.adminId) {
        await this._recordAuditLog(
          'invalidate_session',
          options.userId || session.userId,
          options.adminId,
          {
            sessionId,
            reason: 'Admin action'
          }
        )
      }

      logger.info(`🎫❌ Session invalidated: ${sessionId}`)

      return {
        found: true,
        session: {
          sessionId,
          userId: session.userId
        }
      }
    } catch (error) {
      logger.error(`❌ Failed to invalidate session (${sessionId}):`, error)
      throw new Error('Failed to invalidate session')
    }
  }
}

// 创建单例实例
const userService = new UserService()

module.exports = userService
