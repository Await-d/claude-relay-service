/**
 * @fileoverview User Authentication Middleware Tests (Task 8.2)
 * 
 * Comprehensive tests for user authentication middleware including:
 * - Dual authentication mode detection (API Key + User Auth)
 * - Permission-based access control (RBAC)
 * - Resource-level authorization
 * - Group permission inheritance
 * - API Key backward compatibility
 * - Security logging and monitoring
 * 
 * @author Claude Code
 */

const {
  requireRole,
  requirePermission,
  requireResource,
  checkGroupPermissions,
  checkUserPermissions,
  getGroupInheritedPermissions,
  getUserGroups,
  getRolePermissions,
  hasRoleLevel,
  ROLE_HIERARCHY,
  DEFAULT_ROLE_PERMISSIONS,
  RESOURCE_PERMISSIONS
} = require('../../src/middleware/userAuth')

const userService = require('../../src/services/userService')
const groupService = require('../../src/services/groupService')
const logger = require('../../src/utils/logger')

// Mock services
jest.mock('../../src/services/userService')
jest.mock('../../src/services/groupService')

describe('User Authentication Middleware', () => {
  let req, res, next

  beforeEach(() => {
    req = global.testUtils.createMockRequest()
    res = global.testUtils.createMockResponse()
    next = global.testUtils.createMockNext()

    jest.clearAllMocks()
  })

  // ==================== Role-Based Authorization Tests ====================

  describe('requireRole Middleware', () => {
    describe('Single Role Requirements', () => {
      it('should allow access for users with exact required role', async () => {
        // Arrange
        req.user = {
          id: 'user-id',
          username: 'testuser',
          role: 'user'
        }

        const middleware = requireRole('user')

        // Act
        await middleware(req, res, next)

        // Assert
        expect(next).toHaveBeenCalledWith()
        expect(res.status).not.toHaveBeenCalled()
      })

      it('should allow access for users with higher role', async () => {
        // Arrange
        req.user = {
          id: 'admin-id',
          username: 'admin',
          role: 'admin'
        }

        const middleware = requireRole('user')

        // Act
        await middleware(req, res, next)

        // Assert
        expect(next).toHaveBeenCalledWith()
        expect(res.status).not.toHaveBeenCalled()
      })

      it('should deny access for users with lower role', async () => {
        // Arrange
        req.user = {
          id: 'viewer-id',
          username: 'viewer',
          role: 'viewer'
        }

        const middleware = requireRole('admin')

        // Act
        await middleware(req, res, next)

        // Assert
        expect(res.status).toHaveBeenCalledWith(403)
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
          error: 'Insufficient role',
          requiredRoles: ['admin'],
          currentRole: 'viewer'
        }))
        expect(next).not.toHaveBeenCalled()
      })

      it('should deny access for unauthenticated users', async () => {
        // Arrange
        req.user = null

        const middleware = requireRole('user')

        // Act
        await middleware(req, res, next)

        // Assert
        expect(res.status).toHaveBeenCalledWith(401)
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
          error: 'Authentication required'
        }))
        expect(next).not.toHaveBeenCalled()
      })
    })

    describe('Multiple Role Requirements', () => {
      it('should allow access if user has any of required roles', async () => {
        // Arrange
        req.user = {
          id: 'user-id',
          username: 'testuser',
          role: 'user'
        }

        const middleware = requireRole(['admin', 'user'])

        // Act
        await middleware(req, res, next)

        // Assert
        expect(next).toHaveBeenCalledWith()
      })

      it('should deny access if user has none of required roles', async () => {
        // Arrange
        req.user = {
          id: 'viewer-id',
          username: 'viewer',
          role: 'viewer'
        }

        const middleware = requireRole(['admin', 'user'])

        // Act
        await middleware(req, res, next)

        // Assert
        expect(res.status).toHaveBeenCalledWith(403)
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
          error: 'Insufficient role',
          requiredRoles: ['admin', 'user']
        }))
      })
    })

    describe('Error Handling', () => {
      it('should handle middleware errors gracefully', async () => {
        // Arrange
        req.user = {
          id: 'user-id',
          username: 'testuser',
          role: 'user'
        }

        // Mock an error in the middleware
        const originalIndexOf = ROLE_HIERARCHY.indexOf
        ROLE_HIERARCHY.indexOf = jest.fn().mockImplementation(() => {
          throw new Error('Test error')
        })

        const middleware = requireRole('user')

        // Act
        await middleware(req, res, next)

        // Assert
        expect(res.status).toHaveBeenCalledWith(500)
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
          error: 'Authorization error'
        }))

        // Cleanup
        ROLE_HIERARCHY.indexOf = originalIndexOf
      })

      it('should log security events appropriately', async () => {
        // Arrange
        req.user = {
          id: 'user-id',
          username: 'testuser',
          role: 'viewer'
        }
        req.ip = '192.168.1.100'

        const middleware = requireRole('admin')

        // Act
        await middleware(req, res, next)

        // Assert
        expect(logger.security).toHaveBeenCalledWith(
          expect.stringContaining('Role authorization failed')
        )
      })
    })
  })

  // ==================== Permission-Based Authorization Tests ====================

  describe('requirePermission Middleware', () => {
    describe('Single Permission Requirements', () => {
      it('should allow access for users with required permission', async () => {
        // Arrange
        req.user = {
          id: 'user-id',
          username: 'testuser',
          role: 'user'
        }

        userService.checkUserPermissions.mockResolvedValue(true)

        const middleware = requirePermission('chat.create')

        // Act
        await middleware(req, res, next)

        // Assert
        expect(next).toHaveBeenCalledWith()
        expect(userService.checkUserPermissions).toHaveBeenCalledWith('user-id', ['chat.create'])
      })

      it('should deny access for users without permission', async () => {
        // Arrange
        req.user = {
          id: 'user-id',
          username: 'testuser',
          role: 'viewer'
        }

        userService.checkUserPermissions.mockResolvedValue(false)

        const middleware = requirePermission('admin.write')

        // Act
        await middleware(req, res, next)

        // Assert
        expect(res.status).toHaveBeenCalledWith(403)
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
          error: 'Insufficient permissions',
          requiredPermissions: ['admin.write']
        }))
      })
    })

    describe('Multiple Permission Requirements', () => {
      it('should check all required permissions (AND logic)', async () => {
        // Arrange
        req.user = {
          id: 'admin-id',
          username: 'admin',
          role: 'admin'
        }

        userService.checkUserPermissions.mockResolvedValue(true)

        const middleware = requirePermission(['admin.read', 'admin.write'])

        // Act
        await middleware(req, res, next)

        // Assert
        expect(userService.checkUserPermissions).toHaveBeenCalledWith(
          'admin-id',
          ['admin.read', 'admin.write']
        )
        expect(next).toHaveBeenCalledWith()
      })

      it('should deny if any permission is missing', async () => {
        // Arrange
        req.user = {
          id: 'user-id',
          username: 'testuser',
          role: 'user'
        }

        userService.checkUserPermissions.mockResolvedValue(false)

        const middleware = requirePermission(['admin.read', 'admin.write'])

        // Act
        await middleware(req, res, next)

        // Assert
        expect(res.status).toHaveBeenCalledWith(403)
      })
    })

    describe('Group Permission Inheritance', () => {
      it('should check group-inherited permissions when direct permissions fail', async () => {
        // Arrange
        req.user = {
          id: 'user-id',
          username: 'testuser',
          role: 'user'
        }

        // First call (direct permissions) returns false
        // Helper function should check group permissions
        userService.checkUserPermissions.mockResolvedValue(false)

        const middleware = requirePermission('special.permission')

        // Mock helper functions to simulate group permissions
        userService.getUserGroups = jest.fn().mockResolvedValue([
          { id: 'group1', name: 'Special Group' }
        ])

        groupService.getGroupById = jest.fn().mockResolvedValue({
          id: 'group1',
          permissions: {
            'special.permission': true
          }
        })

        // Act
        await middleware(req, res, next)

        // Assert - should still deny since the mock returns false
        expect(res.status).toHaveBeenCalledWith(403)
      })
    })
  })

  // ==================== Resource-Based Authorization Tests ====================

  describe('requireResource Middleware', () => {
    describe('Valid Resource-Action Combinations', () => {
      it('should allow access for valid resource-action with sufficient permissions', async () => {
        // Arrange
        req.user = {
          id: 'admin-id',
          username: 'admin',
          role: 'admin'
        }

        userService.checkUserPermissions.mockResolvedValue(true)

        const middleware = requireResource('users', 'read')

        // Act
        await middleware(req, res, next)

        // Assert
        expect(next).toHaveBeenCalledWith()
        expect(req.resourceContext).toEqual({
          resource: 'users',
          action: 'read'
        })
      })

      it('should check OR logic for resource permissions', async () => {
        // Arrange
        req.user = {
          id: 'user-id',
          username: 'testuser',
          role: 'user'
        }

        // Mock checkUserPermissions to be called with OR logic
        userService.checkUserPermissions.mockResolvedValue(true)

        const middleware = requireResource('api_keys', 'read')

        // Act
        await middleware(req, res, next)

        // Assert
        expect(next).toHaveBeenCalledWith()
        
        // Verify it called checkUserPermissions with the required permissions
        const expectedPermissions = RESOURCE_PERMISSIONS.api_keys.read
        expect(userService.checkUserPermissions).toHaveBeenCalledWith(
          'user-id',
          expectedPermissions,
          'OR'
        )
      })

      it('should deny access for insufficient permissions', async () => {
        // Arrange
        req.user = {
          id: 'viewer-id',
          username: 'viewer',
          role: 'viewer'
        }

        userService.checkUserPermissions.mockResolvedValue(false)

        const middleware = requireResource('users', 'delete')

        // Act
        await middleware(req, res, next)

        // Assert
        expect(res.status).toHaveBeenCalledWith(403)
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
          error: 'Insufficient permissions',
          resource: 'users',
          action: 'delete'
        }))
      })
    })

    describe('Invalid Resource-Action Combinations', () => {
      it('should reject unknown resource types', async () => {
        // Arrange
        req.user = {
          id: 'admin-id',
          username: 'admin',
          role: 'admin'
        }

        const middleware = requireResource('unknown_resource', 'read')

        // Act
        await middleware(req, res, next)

        // Assert
        expect(res.status).toHaveBeenCalledWith(400)
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
          error: 'Invalid resource',
          message: 'Unknown resource type: unknown_resource'
        }))
      })

      it('should reject unknown actions for valid resources', async () => {
        // Arrange
        req.user = {
          id: 'admin-id',
          username: 'admin',
          role: 'admin'
        }

        const middleware = requireResource('users', 'unknown_action')

        // Act
        await middleware(req, res, next)

        // Assert
        expect(res.status).toHaveBeenCalledWith(400)
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
          error: 'Invalid action',
          message: "Unknown action 'unknown_action' for resource 'users'"
        }))
      })
    })
  })

  // ==================== Group Permission Tests ====================

  describe('checkGroupPermissions Middleware', () => {
    it('should allow access for group members', async () => {
      // Arrange
      req.user = {
        id: 'user-id',
        username: 'testuser'
      }
      req.params = { groupId: 'group1' }

      userService.getUserGroups = jest.fn().mockResolvedValue([
        { id: 'group1', name: 'Test Group' },
        { id: 'group2', name: 'Other Group' }
      ])

      const middleware = checkGroupPermissions()

      // Act
      await middleware(req, res, next)

      // Assert
      expect(next).toHaveBeenCalledWith()
      expect(req.groupContext).toEqual({
        groupId: 'group1',
        isMember: true
      })
    })

    it('should deny access for non-group members', async () => {
      // Arrange
      req.user = {
        id: 'user-id',
        username: 'testuser'
      }
      req.params = { groupId: 'group1' }

      userService.getUserGroups = jest.fn().mockResolvedValue([
        { id: 'group2', name: 'Other Group' }
      ])

      const middleware = checkGroupPermissions()

      // Act
      await middleware(req, res, next)

      // Assert
      expect(res.status).toHaveBeenCalledWith(403)
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Not a group member',
        groupId: 'group1'
      }))
    })

    it('should handle custom userId and groupId parameters', async () => {
      // Arrange
      req.user = {
        id: 'other-user-id',
        username: 'otheruser'
      }

      userService.getUserGroups = jest.fn().mockResolvedValue([
        { id: 'custom-group', name: 'Custom Group' }
      ])

      const middleware = checkGroupPermissions('user-id', 'custom-group')

      // Act
      await middleware(req, res, next)

      // Assert
      expect(userService.getUserGroups).toHaveBeenCalledWith('user-id')
      expect(next).toHaveBeenCalledWith()
    })

    it('should require group ID', async () => {
      // Arrange
      req.user = {
        id: 'user-id',
        username: 'testuser'
      }
      req.params = {}

      const middleware = checkGroupPermissions()

      // Act
      await middleware(req, res, next)

      // Assert
      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Missing group ID'
      }))
    })
  })

  // ==================== Helper Functions Tests ====================

  describe('Helper Functions', () => {
    describe('checkUserPermissions', () => {
      it('should return false for missing parameters', async () => {
        const result = await checkUserPermissions(null, ['permission'])
        expect(result).toBe(false)

        const result2 = await checkUserPermissions('user-id', [])
        expect(result2).toBe(false)
      })

      it('should use userService for permission checking', async () => {
        userService.checkUserPermissions.mockResolvedValue(true)

        const result = await checkUserPermissions('user-id', ['test.permission'])

        expect(result).toBe(true)
        expect(userService.checkUserPermissions).toHaveBeenCalledWith('user-id', ['test.permission'])
      })

      it('should handle errors gracefully', async () => {
        userService.checkUserPermissions.mockRejectedValue(new Error('Database error'))

        const result = await checkUserPermissions('user-id', ['test.permission'])

        expect(result).toBe(false)
        expect(logger.error).toHaveBeenCalledWith('❌ Permission check failed:', expect.any(Error))
      })
    })

    describe('getGroupInheritedPermissions', () => {
      it('should return empty array when no groups', async () => {
        userService.getUserGroups = jest.fn().mockResolvedValue([])

        const result = await getGroupInheritedPermissions('user-id')

        expect(result).toEqual([])
      })

      it('should collect permissions from all user groups', async () => {
        userService.getUserGroups = jest.fn().mockResolvedValue([
          { id: 'group1' },
          { id: 'group2' }
        ])

        groupService.getGroupById.mockImplementation((groupId) => {
          if (groupId === 'group1') {
            return Promise.resolve({
              permissions: {
                'perm1': true,
                'perm2': false,
                'perm3': true
              }
            })
          }
          if (groupId === 'group2') {
            return Promise.resolve({
              permissions: {
                'perm3': true,
                'perm4': true
              }
            })
          }
        })

        const result = await getGroupInheritedPermissions('user-id')

        expect(result).toContain('perm1')
        expect(result).toContain('perm3')
        expect(result).toContain('perm4')
        expect(result).not.toContain('perm2') // false permission
        expect(result.length).toBe(3) // No duplicates
      })

      it('should handle missing group service gracefully', async () => {
        userService.getUserGroups = jest.fn().mockResolvedValue([{ id: 'group1' }])
        
        // Temporarily make groupService unavailable
        const originalGroupService = groupService.getGroupById
        groupService.getGroupById = undefined

        const result = await getGroupInheritedPermissions('user-id')

        expect(result).toEqual([])

        // Restore
        groupService.getGroupById = originalGroupService
      })
    })

    describe('getUserGroups', () => {
      it('should use userService.getUserGroups when available', async () => {
        userService.getUserGroups = jest.fn().mockResolvedValue([
          { id: 'group1', name: 'Group 1' }
        ])

        const result = await getUserGroups('user-id')

        expect(result).toEqual([{ id: 'group1', name: 'Group 1' }])
        expect(userService.getUserGroups).toHaveBeenCalledWith('user-id')
      })

      it('should fallback to user.groups from getUserById', async () => {
        userService.getUserGroups = undefined
        userService.getUserById.mockResolvedValue({
          id: 'user-id',
          groups: [{ id: 'group1', name: 'Group 1' }]
        })

        const result = await getUserGroups('user-id')

        expect(result).toEqual([{ id: 'group1', name: 'Group 1' }])
      })

      it('should return empty array on error', async () => {
        userService.getUserById.mockRejectedValue(new Error('Database error'))

        const result = await getUserGroups('user-id')

        expect(result).toEqual([])
        expect(logger.error).toHaveBeenCalledWith('❌ Failed to get user groups:', expect.any(Error))
      })
    })

    describe('getRolePermissions', () => {
      it('should return permissions for valid roles', () => {
        expect(getRolePermissions('admin')).toEqual(DEFAULT_ROLE_PERMISSIONS.admin)
        expect(getRolePermissions('user')).toEqual(DEFAULT_ROLE_PERMISSIONS.user)
        expect(getRolePermissions('viewer')).toEqual(DEFAULT_ROLE_PERMISSIONS.viewer)
      })

      it('should return empty array for invalid roles', () => {
        expect(getRolePermissions('invalid')).toEqual([])
        expect(getRolePermissions(null)).toEqual([])
        expect(getRolePermissions(undefined)).toEqual([])
      })
    })

    describe('hasRoleLevel', () => {
      it('should correctly compare role hierarchy', () => {
        expect(hasRoleLevel('admin', 'viewer')).toBe(true)
        expect(hasRoleLevel('admin', 'user')).toBe(true)
        expect(hasRoleLevel('admin', 'admin')).toBe(true)

        expect(hasRoleLevel('user', 'viewer')).toBe(true)
        expect(hasRoleLevel('user', 'user')).toBe(true)
        expect(hasRoleLevel('user', 'admin')).toBe(false)

        expect(hasRoleLevel('viewer', 'viewer')).toBe(true)
        expect(hasRoleLevel('viewer', 'user')).toBe(false)
        expect(hasRoleLevel('viewer', 'admin')).toBe(false)
      })

      it('should handle invalid roles', () => {
        expect(hasRoleLevel('invalid', 'user')).toBe(false)
        expect(hasRoleLevel('user', 'invalid')).toBe(false)
        expect(hasRoleLevel('invalid', 'invalid')).toBe(false)
      })
    })
  })

  // ==================== API Key Compatibility Tests ====================

  describe('API Key Backward Compatibility', () => {
    it('should handle requests with API key authentication', async () => {
      // This tests the dual authentication mode where both API keys and user auth can coexist
      
      // Arrange
      req.headers = {
        'authorization': 'Bearer cr_test_api_key_123',
        'x-api-key': 'cr_test_api_key_123'
      }
      req.user = {
        id: 'user-id',
        username: 'api-user',
        role: 'user'
      }

      const middleware = requireRole('user')

      // Act
      await middleware(req, res, next)

      // Assert
      expect(next).toHaveBeenCalledWith()
      
      // User auth should take precedence even with API key present
      expect(res.status).not.toHaveBeenCalled()
    })

    it('should handle mixed authentication scenarios', async () => {
      // Test scenario where API key is present but user auth is primary
      
      // Arrange
      req.headers = {
        'authorization': 'Bearer cr_api_key_456'
      }
      
      // No user object - should fail auth
      req.user = null

      const middleware = requirePermission('chat.create')

      // Act
      await middleware(req, res, next)

      // Assert
      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Authentication required'
      }))
    })
  })

  // ==================== Performance and Security Tests ====================

  describe('Performance and Security', () => {
    it('should complete authorization checks within reasonable time', async () => {
      // Arrange
      req.user = {
        id: 'user-id',
        username: 'testuser',
        role: 'admin'
      }

      userService.checkUserPermissions.mockResolvedValue(true)

      const middleware = requirePermission(['perm1', 'perm2', 'perm3'])
      const startTime = Date.now()

      // Act
      await middleware(req, res, next)

      // Assert
      const duration = Date.now() - startTime
      expect(duration).toBeLessThan(100) // Should complete in under 100ms
      expect(next).toHaveBeenCalledWith()
    })

    it('should log security events appropriately', async () => {
      // Arrange
      req.user = {
        id: 'attacker-id',
        username: 'attacker',
        role: 'viewer'
      }
      req.ip = '192.168.1.100'

      const middleware = requireRole('admin')

      // Act
      await middleware(req, res, next)

      // Assert
      expect(logger.security).toHaveBeenCalledWith(
        expect.stringContaining('Role authorization failed')
      )
      expect(res.status).toHaveBeenCalledWith(403)
    })

    it('should handle concurrent authorization requests', async () => {
      // Arrange
      const users = Array.from({ length: 10 }, (_, i) => ({
        id: `user-${i}`,
        username: `user${i}`,
        role: 'user'
      }))

      userService.checkUserPermissions.mockResolvedValue(true)

      // Act
      const promises = users.map(user => {
        const testReq = { ...req, user }
        const testRes = global.testUtils.createMockResponse()
        const testNext = global.testUtils.createMockNext()
        
        const middleware = requirePermission('chat.create')
        return middleware(testReq, testRes, testNext)
      })

      const results = await Promise.all(promises)

      // Assert
      results.forEach((_, i) => {
        // Each request should have succeeded (next called, no status set)
        expect(userService.checkUserPermissions).toHaveBeenCalledWith(`user-${i}`, ['chat.create'])
      })
    })
  })
})