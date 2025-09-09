/**
 * @fileoverview User Authorization Middleware
 *
 * Provides fine-grained access control for authenticated users including:
 * - Role-based access control (RBAC)
 * - Permission-based authorization
 * - Resource-level access control
 * - Group permission inheritance
 * - Hierarchical role and permission checking
 *
 * Integrates seamlessly with the existing authentication middleware
 * and supports both individual user permissions and group-inherited permissions.
 *
 * @author Claude Code
 * @version 1.0.0
 */

const userService = require('../services/userService')
const groupService = require('../services/groupService')
const logger = require('../utils/logger')

/**
 * User roles hierarchy definition
 * Higher index = higher privilege level
 */
const ROLE_HIERARCHY = ['viewer', 'user', 'admin']

/**
 * Default permissions for each role
 */
const DEFAULT_ROLE_PERMISSIONS = {
  viewer: ['models.list', 'usage.view'],
  user: ['models.list', 'usage.view', 'chat.create', 'chat.history'],
  admin: [
    'models.list',
    'usage.view',
    'chat.create',
    'chat.history',
    'chat.export',
    'admin.read',
    'admin.write',
    'admin.manage'
  ]
}

/**
 * Resource-action permission mapping
 */
const RESOURCE_PERMISSIONS = {
  api_keys: {
    read: ['usage.view', 'admin.read'],
    write: ['admin.write', 'admin.manage'],
    delete: ['admin.manage']
  },
  users: {
    read: ['admin.read'],
    write: ['admin.write'],
    delete: ['admin.manage']
  },
  groups: {
    read: ['admin.read'],
    write: ['admin.write'],
    delete: ['admin.manage']
  },
  accounts: {
    read: ['admin.read'],
    write: ['admin.write'],
    delete: ['admin.manage']
  },
  chat: {
    create: ['chat.create'],
    read: ['chat.history'],
    export: ['chat.export']
  },
  models: {
    list: ['models.list'],
    access: ['models.access']
  },
  usage: {
    view: ['usage.view'],
    export: ['usage.export']
  }
}

/**
 * Middleware to require a specific role
 * Checks if the authenticated user has the required role or higher
 *
 * @param {string|Array<string>} requiredRole - Required role(s)
 * @returns {Function} Express middleware function
 *
 * @example
 * router.get('/admin/users', requireRole('admin'), (req, res) => {...})
 * router.get('/dashboard', requireRole(['user', 'admin']), (req, res) => {...})
 */
const requireRole = (requiredRole) => async (req, res, next) => {
  const startTime = Date.now()

  try {
    // Ensure user is authenticated
    if (!req.user) {
      logger.security(`🔒 Role check failed: User not authenticated from ${req.ip || 'unknown'}`)
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Please authenticate first'
      })
    }

    const userRole = req.user.role
    const requiredRoles = Array.isArray(requiredRole) ? requiredRole : [requiredRole]

    // Check if user has any of the required roles
    const hasRequiredRole = requiredRoles.some((role) => {
      const userRoleIndex = ROLE_HIERARCHY.indexOf(userRole)
      const requiredRoleIndex = ROLE_HIERARCHY.indexOf(role)

      // User must have equal or higher role
      return userRoleIndex >= requiredRoleIndex && userRoleIndex !== -1 && requiredRoleIndex !== -1
    })

    if (!hasRequiredRole) {
      const authDuration = Date.now() - startTime
      logger.security(
        `🔐 Role authorization failed for user ${req.user.username} (${req.user.id}): ` +
          `required=${requiredRoles.join('|')}, actual=${userRole} | ${authDuration}ms`
      )

      return res.status(403).json({
        error: 'Insufficient role',
        message: `Access denied. Required role: ${requiredRoles.join(' or ')}`,
        requiredRoles,
        currentRole: userRole
      })
    }

    const authDuration = Date.now() - startTime
    logger.debug(
      `✅ Role authorization passed for user ${req.user.username}: ` +
        `required=${requiredRoles.join('|')}, actual=${userRole} | ${authDuration}ms`
    )

    return next()
  } catch (error) {
    const authDuration = Date.now() - startTime
    logger.error(`❌ Role authorization error (${authDuration}ms):`, {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      username: req.user?.username,
      requiredRole,
      url: req.originalUrl
    })

    return res.status(500).json({
      error: 'Authorization error',
      message: 'Internal server error during role check'
    })
  }
}

/**
 * Middleware to require specific permission(s)
 * Checks both user direct permissions and group-inherited permissions
 *
 * @param {string|Array<string>} requiredPermissions - Required permission(s)
 * @returns {Function} Express middleware function
 *
 * @example
 * router.post('/api/chat', requirePermission('chat.create'), (req, res) => {...})
 * router.get('/admin/stats', requirePermission(['admin.read', 'usage.view']), (req, res) => {...})
 */
const requirePermission = (requiredPermissions) => async (req, res, next) => {
  const startTime = Date.now()

  try {
    // Ensure user is authenticated
    if (!req.user) {
      logger.security(
        `🔒 Permission check failed: User not authenticated from ${req.ip || 'unknown'}`
      )
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Please authenticate first'
      })
    }

    const permissions = Array.isArray(requiredPermissions)
      ? requiredPermissions
      : [requiredPermissions]
    const userId = req.user.id
    const { username } = req.user

    // Check if user has all required permissions
    const hasAllPermissions = await checkUserPermissions(userId, permissions)

    if (!hasAllPermissions) {
      const authDuration = Date.now() - startTime
      logger.security(
        `🔐 Permission authorization failed for user ${username} (${userId}): ` +
          `required=${permissions.join(', ')} | ${authDuration}ms`
      )

      return res.status(403).json({
        error: 'Insufficient permissions',
        message: `Access denied. Missing required permissions: ${permissions.join(', ')}`,
        requiredPermissions: permissions
      })
    }

    const authDuration = Date.now() - startTime
    logger.debug(
      `✅ Permission authorization passed for user ${username}: ` +
        `permissions=${permissions.join(', ')} | ${authDuration}ms`
    )

    return next()
  } catch (error) {
    const authDuration = Date.now() - startTime
    logger.error(`❌ Permission authorization error (${authDuration}ms):`, {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      username: req.user?.username,
      requiredPermissions,
      url: req.originalUrl
    })

    return res.status(500).json({
      error: 'Authorization error',
      message: 'Internal server error during permission check'
    })
  }
}

/**
 * Middleware for resource-based authorization
 * Checks if user has permission to perform specific action on a resource
 *
 * @param {string} resource - Resource type (e.g., 'users', 'api_keys', 'chat')
 * @param {string} action - Action to perform (e.g., 'read', 'write', 'delete')
 * @returns {Function} Express middleware function
 *
 * @example
 * router.get('/admin/api-keys', requireResource('api_keys', 'read'), (req, res) => {...})
 * router.delete('/admin/users/:id', requireResource('users', 'delete'), (req, res) => {...})
 */
const requireResource = (resource, action) => async (req, res, next) => {
  const startTime = Date.now()

  try {
    // Ensure user is authenticated
    if (!req.user) {
      logger.security(
        `🔒 Resource check failed: User not authenticated from ${req.ip || 'unknown'}`
      )
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Please authenticate first'
      })
    }

    const userId = req.user.id
    const { username } = req.user

    // Get required permissions for this resource-action combination
    const resourceConfig = RESOURCE_PERMISSIONS[resource]
    if (!resourceConfig) {
      logger.warn(`⚠️ Unknown resource type: ${resource}`)
      return res.status(400).json({
        error: 'Invalid resource',
        message: `Unknown resource type: ${resource}`
      })
    }

    const requiredPermissions = resourceConfig[action]
    if (!requiredPermissions) {
      logger.warn(`⚠️ Unknown action '${action}' for resource '${resource}'`)
      return res.status(400).json({
        error: 'Invalid action',
        message: `Unknown action '${action}' for resource '${resource}'`
      })
    }

    // Check if user has any of the required permissions (OR logic)
    const hasPermission = await checkUserPermissions(userId, requiredPermissions, 'OR')

    if (!hasPermission) {
      const authDuration = Date.now() - startTime
      logger.security(
        `🔐 Resource authorization failed for user ${username} (${userId}): ` +
          `resource=${resource}, action=${action}, required=${requiredPermissions.join('|')} | ${authDuration}ms`
      )

      return res.status(403).json({
        error: 'Insufficient permissions',
        message: `Access denied for ${action} on ${resource}`,
        resource,
        action,
        requiredPermissions
      })
    }

    const authDuration = Date.now() - startTime
    logger.debug(
      `✅ Resource authorization passed for user ${username}: ` +
        `resource=${resource}, action=${action} | ${authDuration}ms`
    )

    // Store resource context for potential use in route handlers
    req.resourceContext = { resource, action }

    return next()
  } catch (error) {
    const authDuration = Date.now() - startTime
    logger.error(`❌ Resource authorization error (${authDuration}ms):`, {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      username: req.user?.username,
      resource,
      action,
      url: req.originalUrl
    })

    return res.status(500).json({
      error: 'Authorization error',
      message: 'Internal server error during resource authorization'
    })
  }
}

/**
 * Middleware to check group permissions inheritance
 * Validates if user has access through group membership
 *
 * @param {string} userId - User ID to check
 * @param {string} groupId - Group ID to check permissions for
 * @returns {Function} Express middleware function
 *
 * @example
 * router.get('/groups/:groupId/resources', checkGroupPermissions, (req, res) => {...})
 */
const checkGroupPermissions = (userId, groupId) => async (req, res, next) => {
  const startTime = Date.now()

  try {
    const targetUserId = userId || req.user?.id
    const targetGroupId = groupId || req.params.groupId

    if (!targetUserId) {
      logger.security(
        `🔒 Group permission check failed: User not authenticated from ${req.ip || 'unknown'}`
      )
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Please authenticate first'
      })
    }

    if (!targetGroupId) {
      return res.status(400).json({
        error: 'Missing group ID',
        message: 'Group ID is required for permission check'
      })
    }

    // Check if user is a member of the group
    const userGroups = await getUserGroups(targetUserId)
    const isMember = userGroups.some((group) => group.id === targetGroupId)

    if (!isMember) {
      const authDuration = Date.now() - startTime
      logger.security(
        `🔐 Group membership check failed for user ${req.user?.username} (${targetUserId}): ` +
          `groupId=${targetGroupId} | ${authDuration}ms`
      )

      return res.status(403).json({
        error: 'Not a group member',
        message: 'Access denied. You are not a member of this group',
        groupId: targetGroupId
      })
    }

    const authDuration = Date.now() - startTime
    logger.debug(
      `✅ Group membership validated for user ${req.user?.username}: ` +
        `groupId=${targetGroupId} | ${authDuration}ms`
    )

    // Store group context for potential use in route handlers
    req.groupContext = { groupId: targetGroupId, isMember: true }

    return next()
  } catch (error) {
    const authDuration = Date.now() - startTime
    logger.error(`❌ Group permission check error (${authDuration}ms):`, {
      error: error.message,
      stack: error.stack,
      userId,
      groupId,
      url: req.originalUrl
    })

    return res.status(500).json({
      error: 'Authorization error',
      message: 'Internal server error during group permission check'
    })
  }
}

// ==================== Helper Functions ====================

/**
 * Check if user has required permissions (including group inheritance)
 *
 * @param {string} userId - User ID
 * @param {Array<string>} requiredPermissions - Required permissions
 * @param {string} logic - 'AND' (default) or 'OR' logic
 * @returns {Promise<boolean>} True if user has permissions
 */
async function checkUserPermissions(userId, requiredPermissions, logic = 'AND') {
  try {
    if (!userId || !requiredPermissions || requiredPermissions.length === 0) {
      return false
    }

    // Use existing userService method for permission checking
    const hasPermissions = await userService.checkUserPermissions(userId, requiredPermissions)

    if (hasPermissions) {
      return true
    }

    // Additional check for group-inherited permissions
    const groupPermissions = await getGroupInheritedPermissions(userId)
    const allUserPermissions = [...new Set([...groupPermissions])]

    if (logic === 'OR') {
      // User needs at least one of the required permissions
      return requiredPermissions.some((permission) => allUserPermissions.includes(permission))
    } else {
      // User needs all required permissions (AND logic)
      return requiredPermissions.every((permission) => allUserPermissions.includes(permission))
    }
  } catch (error) {
    logger.error('❌ Permission check failed:', error)
    return false
  }
}

/**
 * Get permissions inherited from user's groups
 *
 * @param {string} userId - User ID
 * @returns {Promise<Array<string>>} Array of inherited permissions
 */
async function getGroupInheritedPermissions(userId) {
  try {
    const userGroups = await getUserGroups(userId)
    const inheritedPermissions = new Set()

    for (const group of userGroups) {
      try {
        // Get group permissions through groupService
        const hasGroupService = groupService && typeof groupService.getGroupById === 'function'

        if (hasGroupService) {
          const groupDetails = await groupService.getGroupById(group.id)
          if (groupDetails && groupDetails.permissions) {
            // Add group permissions to inherited set
            Object.keys(groupDetails.permissions).forEach((permission) => {
              if (groupDetails.permissions[permission] === true) {
                inheritedPermissions.add(permission)
              }
            })
          }
        }
      } catch (groupError) {
        logger.debug(`⚠️ Could not get permissions for group ${group.id}:`, groupError.message)
      }
    }

    return Array.from(inheritedPermissions)
  } catch (error) {
    logger.error('❌ Failed to get group inherited permissions:', error)
    return []
  }
}

/**
 * Get user's group memberships
 *
 * @param {string} userId - User ID
 * @returns {Promise<Array<Object>>} Array of group objects
 */
async function getUserGroups(userId) {
  try {
    // First try to use userService method if available
    if (userService && typeof userService.getUserGroups === 'function') {
      return await userService.getUserGroups(userId)
    }

    // Fallback: get user and extract groups
    const user = await userService.getUserById(userId)
    if (user && user.groups) {
      return user.groups
    }

    return []
  } catch (error) {
    logger.error('❌ Failed to get user groups:', error)
    return []
  }
}

/**
 * Get default permissions for a role
 *
 * @param {string} role - User role
 * @returns {Array<string>} Array of default permissions for the role
 */
function getRolePermissions(role) {
  return DEFAULT_ROLE_PERMISSIONS[role] || []
}

/**
 * Check if role has higher or equal privilege than required role
 *
 * @param {string} userRole - User's role
 * @param {string} requiredRole - Required role
 * @returns {boolean} True if user role meets requirement
 */
function hasRoleLevel(userRole, requiredRole) {
  const userRoleIndex = ROLE_HIERARCHY.indexOf(userRole)
  const requiredRoleIndex = ROLE_HIERARCHY.indexOf(requiredRole)

  return userRoleIndex >= requiredRoleIndex && userRoleIndex !== -1 && requiredRoleIndex !== -1
}

module.exports = {
  requireRole,
  requirePermission,
  requireResource,
  checkGroupPermissions,
  checkUserPermissions,
  getGroupInheritedPermissions,
  getUserGroups,
  getRolePermissions,
  hasRoleLevel,

  // Export constants for external use
  ROLE_HIERARCHY,
  DEFAULT_ROLE_PERMISSIONS,
  RESOURCE_PERMISSIONS
}
