/**
 * @fileoverview User Authorization Middleware Usage Examples
 *
 * This file demonstrates how to use the user authorization middleware
 * in various scenarios with Express.js routes.
 *
 * @author Claude Code
 * @version 1.0.0
 */

const express = require('express')
const { authenticateUserSession } = require('../src/middleware/auth')
const {
  requireRole,
  requirePermission,
  requireResource,
  checkGroupPermissions
} = require('../src/middleware/userAuth')

const router = express.Router()

// ==================== Role-based Access Examples ====================

/**
 * Admin-only route - requires admin role
 */
router.get('/admin/dashboard', authenticateUserSession, requireRole('admin'), (req, res) => {
  res.json({
    message: 'Admin dashboard data',
    user: req.user.username,
    role: req.user.role
  })
})

/**
 * Multi-role access - user or admin can access
 */
router.get(
  '/dashboard',
  authenticateUserSession,
  requireRole(['user', 'admin']),
  (req, res) => {
    res.json({
      message: 'User dashboard data',
      user: req.user.username,
      role: req.user.role
    })
  }
)

// ==================== Permission-based Access Examples ====================

/**
 * Chat creation - requires specific permission
 */
router.post(
  '/api/chat/create',
  authenticateUserSession,
  requirePermission('chat.create'),
  (req, res) => {
    res.json({
      message: 'Chat created successfully',
      user: req.user.username,
      permissions: req.user.permissions
    })
  }
)

/**
 * Multiple permissions required
 */
router.get(
  '/admin/analytics',
  authenticateUserSession,
  requirePermission(['admin.read', 'usage.view']),
  (req, res) => {
    res.json({
      message: 'Analytics data',
      user: req.user.username,
      requiredPermissions: ['admin.read', 'usage.view']
    })
  }
)

// ==================== Resource-based Access Examples ====================

/**
 * View API Keys - uses resource-based authorization
 */
router.get(
  '/admin/api-keys',
  authenticateUserSession,
  requireResource('api_keys', 'read'),
  (req, res) => {
    res.json({
      message: 'API Keys list',
      user: req.user.username,
      resourceContext: req.resourceContext
    })
  }
)

/**
 * Delete user account - requires highest level permissions
 */
router.delete(
  '/admin/users/:userId',
  authenticateUserSession,
  requireResource('users', 'delete'),
  (req, res) => {
    res.json({
      message: 'User deletion authorized',
      targetUserId: req.params.userId,
      authorizedBy: req.user.username,
      resourceContext: req.resourceContext
    })
  }
)

/**
 * Manage groups - administrative resource access
 */
router.post(
  '/admin/groups',
  authenticateUserSession,
  requireResource('groups', 'write'),
  (req, res) => {
    res.json({
      message: 'Group creation authorized',
      user: req.user.username,
      resourceContext: req.resourceContext
    })
  }
)

// ==================== Group-based Access Examples ====================

/**
 * Access group-specific resources
 */
router.get(
  '/groups/:groupId/resources',
  authenticateUserSession,
  checkGroupPermissions(),
  (req, res) => {
    res.json({
      message: 'Group resources access granted',
      user: req.user.username,
      groupContext: req.groupContext
    })
  }
)

// ==================== Combined Authorization Examples ====================

/**
 * Complex authorization - multiple checks
 */
router.post(
  '/admin/system/config',
  authenticateUserSession,
  requireRole('admin'),
  requirePermission(['admin.write', 'admin.manage']),
  requireResource('accounts', 'write'),
  (req, res) => {
    res.json({
      message: 'System configuration update authorized',
      user: req.user.username,
      role: req.user.role,
      resourceContext: req.resourceContext,
      timestamp: new Date().toISOString()
    })
  }
)

// ==================== Error Handling Examples ====================

/**
 * Route with custom error handling
 */
router.get('/protected-resource', authenticateUserSession, requireRole('admin'), (req, res) => {
  try {
    // Protected resource logic here
    res.json({
      message: 'Protected resource accessed successfully',
      user: req.user.username
    })
  } catch (error) {
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to access protected resource'
    })
  }
})

// ==================== Dynamic Permission Checking ====================

/**
 * Route with dynamic permission checking based on request
 */
router.put('/api/content/:contentId', authenticateUserSession, async (req, res, next) => {
  try {
    // Dynamic permission based on content ownership
    const contentId = req.params.contentId
    const userId = req.user.id

    // Simulate content ownership check
    const isOwner = await checkContentOwnership(contentId, userId)

    if (isOwner) {
      // Owner can always edit
      return next()
    } else {
      // Non-owners need admin permission
      return requirePermission('admin.write')(req, res, next)
    }
  } catch (error) {
    res.status(500).json({
      error: 'Permission check failed',
      message: error.message
    })
  }
})

/**
 * Simulate content ownership check
 * In real implementation, this would query the database
 */
async function checkContentOwnership(contentId, userId) {
  // Simulate async database call
  return new Promise((resolve) => {
    setTimeout(() => {
      // Mock logic: content IDs ending with user ID belong to that user
      resolve(contentId.endsWith(userId.slice(-2)))
    }, 10)
  })
}

// ==================== Middleware Chain Examples ====================

/**
 * Complex middleware chain with custom logic
 */
router.post(
  '/api/sensitive-action',
  authenticateUserSession,
  requireRole(['admin', 'user']),
  requirePermission('admin.write'),
  (req, res, next) => {
    // Custom middleware: additional security check
    const userAgent = req.get('User-Agent')
    if (!userAgent || userAgent.includes('suspicious')) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Suspicious request detected'
      })
    }
    next()
  },
  (req, res) => {
    res.json({
      message: 'Sensitive action completed',
      user: req.user.username,
      timestamp: new Date().toISOString()
    })
  }
)

// ==================== Export Router ====================

module.exports = router

// ==================== Usage Instructions ====================

/*
Usage in your main app.js or server.js:

const express = require('express')
const userAuthExamples = require('./examples/userAuth-usage')

const app = express()

// Use the example routes
app.use('/examples', userAuthExamples)

// Start server
app.listen(3000, () => {
  console.log('Server running on port 3000')
})

Example API calls:

1. Admin dashboard (requires admin role):
   GET /examples/admin/dashboard
   Headers: Authorization: Bearer <user_session_token>

2. Create chat (requires chat.create permission):
   POST /examples/api/chat/create
   Headers: Authorization: Bearer <user_session_token>

3. View API keys (requires api_keys read permission):
   GET /examples/admin/api-keys
   Headers: Authorization: Bearer <user_session_token>

4. Access group resources (requires group membership):
   GET /examples/groups/group-123/resources
   Headers: Authorization: Bearer <user_session_token>

Expected responses:
- 401: Authentication required (no token or invalid token)
- 403: Insufficient role/permissions (valid token but insufficient access)
- 200: Success with authorized data

Error response format:
{
  "error": "Insufficient permissions",
  "message": "Access denied. Missing required permissions: admin.read",
  "requiredPermissions": ["admin.read"]
}

Success response format:
{
  "message": "Resource accessed successfully",
  "user": "john_doe",
  "role": "admin",
  "resourceContext": {
    "resource": "api_keys",
    "action": "read"
  }
}
*/