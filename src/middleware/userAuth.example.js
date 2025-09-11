/**
 * @fileoverview 用户授权中间件使用示例
 *
 * 展示如何在路由中使用用户授权中间件进行细粒度的访问控制
 *
 * @author Claude Code
 * @version 1.0.0
 */

const express = require('express')
const { authenticateUserSession } = require('./auth')
const {
  requireRole,
  requirePermission,
  requireResourceAccess,
  requireAccess,
  RESOURCE_TYPES
} = require('./userAuth')

const router = express.Router()

// ==================== 基于角色的访问控制示例 ====================

/**
 * 只有管理员才能访问的端点
 */
router.get(
  '/admin/dashboard',
  authenticateUserSession, // 首先验证用户会话
  requireRole('admin'), // 然后检查管理员角色
  (req, res) => {
    res.json({
      message: 'Welcome to admin dashboard',
      user: req.user.username
    })
  }
)

/**
 * 管理员或用户都可以访问的端点
 */
router.get(
  '/user/profile',
  authenticateUserSession,
  requireRole(['admin', 'user']), // 允许多个角色
  (req, res) => {
    res.json({
      message: 'User profile',
      user: req.user
    })
  }
)

// ==================== 基于权限的访问控制示例 ====================

/**
 * 需要特定权限的端点
 */
router.get(
  '/api/users',
  authenticateUserSession,
  requirePermission('users.read'), // 需要用户读取权限
  (req, res) => {
    res.json({ message: 'Users list' })
  }
)

/**
 * 需要多个权限的端点 (AND 操作)
 */
router.post(
  '/api/users',
  authenticateUserSession,
  requirePermission(['users.create', 'users.write'], 'AND'),
  (req, res) => {
    res.json({ message: 'User created successfully' })
  }
)

/**
 * 需要任一权限的端点 (OR 操作)
 */
router.get(
  '/api/dashboard',
  authenticateUserSession,
  requirePermission(['admin.read', 'users.read'], 'OR'),
  (req, res) => {
    res.json({ message: 'Dashboard data' })
  }
)

// ==================== 基于资源的访问控制示例 ====================

/**
 * 用户只能访问自己的信息
 */
router.get(
  '/api/users/:userId',
  authenticateUserSession,
  requireResourceAccess(RESOURCE_TYPES.USER, 'read'),
  (req, res) => {
    res.json({
      message: 'User details',
      userId: req.params.userId,
      resourceInfo: req.resource
    })
  }
)

/**
 * 用户只能修改自己所属的组
 */
router.put(
  '/api/groups/:groupId',
  authenticateUserSession,
  requireResourceAccess(RESOURCE_TYPES.GROUP, 'write'),
  (req, res) => {
    res.json({
      message: 'Group updated',
      groupId: req.params.groupId
    })
  }
)

/**
 * 自定义资源ID提取器示例
 */
router.get(
  '/api/custom/:resourceId/data',
  authenticateUserSession,
  requireResourceAccess(
    RESOURCE_TYPES.USER,
    'read',
    (req) => req.params.resourceId // 自定义资源ID提取函数
  ),
  (req, res) => {
    res.json({ message: 'Custom resource data' })
  }
)

// ==================== 复杂权限组合示例 ====================

/**
 * 复杂的权限检查：需要特定角色和权限
 */
router.delete(
  '/api/users/:userId',
  authenticateUserSession,
  requireAccess({
    roles: ['admin'], // 必须是管理员
    permissions: ['users.delete'], // 并且有删除权限
    operator: 'AND', // 所有条件都必须满足
    customCheck: async (req, _res) =>
      // 自定义检查逻辑
      // 不能删除自己的账户
      req.params.userId !== req.user.id
  }),
  (req, res) => {
    res.json({
      message: 'User deleted successfully',
      deletedUserId: req.params.userId
    })
  }
)

/**
 * 灵活的权限检查：管理员或拥有特定权限的用户
 */
router.get(
  '/api/sensitive-data',
  authenticateUserSession,
  requireAccess({
    roles: ['admin'],
    permissions: ['system.read', 'admin.read'],
    operator: 'OR', // 满足任一条件即可
    customCheck: async (_req, _res) => {
      // 额外的业务逻辑检查
      const currentHour = new Date().getHours()
      // 只在工作时间 (9-17点) 允许访问
      return currentHour >= 9 && currentHour <= 17
    }
  }),
  (req, res) => {
    res.json({
      message: 'Sensitive data access granted',
      timestamp: new Date().toISOString(),
      user: req.user.username,
      permissions: req.userPermissions
    })
  }
)

// ==================== 错误处理示例 ====================

/**
 * 全局错误处理中间件
 * 处理权限验证失败的情况
 */
router.use((error, req, res, next) => {
  if (error.status === 401) {
    return res.status(401).json({
      error: 'Authentication required',
      message: 'Please login first',
      redirectTo: '/login'
    })
  }

  if (error.status === 403) {
    return res.status(403).json({
      error: 'Access denied',
      message: 'You do not have permission to access this resource',
      required: error.required,
      current: error.current
    })
  }

  next(error)
})

// ==================== 权限信息端点示例 ====================

/**
 * 获取当前用户的权限信息
 */
router.get('/api/user/permissions', authenticateUserSession, async (req, res) => {
  try {
    const { calculateUserPermissions } = require('./userAuth')
    const userPermissions = await calculateUserPermissions(req.user.id)

    res.json({
      user: {
        id: req.user.id,
        username: req.user.username,
        role: req.user.role,
        groups: req.user.groups
      },
      permissions: userPermissions,
      effectivePermissions: Object.keys(userPermissions).filter((p) => userPermissions[p])
    })
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get permissions',
      message: error.message
    })
  }
})

module.exports = router
