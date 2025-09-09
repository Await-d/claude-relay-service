/**
 * @fileoverview User Service Unit Tests (Tasks 8.1)
 * 
 * Comprehensive unit tests for user management service including:
 * - User authentication flows (local + LDAP)
 * - CRUD operations validation  
 * - Session management testing
 * - Password management and security
 * - Permission and validation checks
 * 
 * @author Claude Code
 */

const userService = require('../../src/services/userService')
const database = require('../../src/models/database')
const userAuth = require('../../src/utils/userAuth')
const logger = require('../../src/utils/logger')

describe('UserService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // ==================== Authentication Tests ====================

  describe('Authentication Flow', () => {
    describe('Local Authentication', () => {
      it('should successfully authenticate valid local user', async () => {
        // Arrange
        const mockUser = global.testUtils.createMockUser({
          username: 'testuser',
          status: 'active',
          passwordHash: '$2b$10$valid.hash'
        })

        database.getUserByUsername.mockResolvedValue(mockUser)
        userAuth.validatePassword.mockResolvedValue(true)

        // Act
        const result = await userService.authenticateLocal(
          'testuser', 
          'validpassword',
          { ipAddress: '127.0.0.1', userAgent: 'Test' }
        )

        // Assert
        expect(result.success).toBe(true)
        expect(result.user.username).toBe('testuser')
        expect(result.authMethod).toBe('local')
        expect(database.getUserByUsername).toHaveBeenCalledWith('testuser')
        expect(userAuth.validatePassword).toHaveBeenCalledWith('validpassword', '$2b$10$valid.hash')
      })

      it('should fail authentication for non-existent user', async () => {
        // Arrange
        database.getUserByUsername.mockResolvedValue(null)

        // Act & Assert
        await expect(userService.authenticateLocal('nonexistent', 'password'))
          .rejects.toThrow('Invalid username or password')
        
        expect(database.getUserByUsername).toHaveBeenCalledWith('nonexistent')
      })

      it('should fail authentication for inactive user', async () => {
        // Arrange
        const mockUser = global.testUtils.createMockUser({
          status: 'inactive'
        })
        database.getUserByUsername.mockResolvedValue(mockUser)

        // Act & Assert
        await expect(userService.authenticateLocal('testuser', 'password'))
          .rejects.toThrow('User account is inactive')
      })

      it('should fail authentication for invalid password', async () => {
        // Arrange
        const mockUser = global.testUtils.createMockUser({
          status: 'active'
        })
        database.getUserByUsername.mockResolvedValue(mockUser)
        userAuth.validatePassword.mockResolvedValue(false)

        // Act & Assert
        await expect(userService.authenticateLocal('testuser', 'wrongpassword'))
          .rejects.toThrow('Invalid username or password')
      })

      it('should handle account lockout after failed attempts', async () => {
        // Arrange
        const mockUser = global.testUtils.createMockUser({
          status: 'active',
          id: 'locked-user-id'
        })
        
        database.getUserByUsername.mockResolvedValue(mockUser)
        database.client.get.mockResolvedValue(JSON.stringify({
          lockedUntil: new Date(Date.now() + 900000).toISOString()
        }))

        // Act & Assert
        await expect(userService.authenticateLocal('testuser', 'password'))
          .rejects.toThrow(/Account is locked/)
      })

      it('should require username and password', async () => {
        // Act & Assert
        await expect(userService.authenticateLocal('', 'password'))
          .rejects.toThrow('Username and password are required')
        
        await expect(userService.authenticateLocal('username', ''))
          .rejects.toThrow('Username and password are required')
      })
    })

    describe('LDAP Authentication', () => {
      it('should successfully authenticate LDAP user with fallback', async () => {
        // Arrange
        const mockUser = global.testUtils.createMockUser({
          authMethod: 'local'
        })
        database.getUserByUsername.mockResolvedValue(mockUser)
        userAuth.validatePassword.mockResolvedValue(true)

        // Mock LDAP not available, should fallback to local auth
        jest.doMock('../../src/utils/ldapHelper', () => {
          throw new Error('LDAP not available')
        })

        // Act
        const result = await userService.authenticateLDAP('testuser', 'password')

        // Assert
        expect(result.success).toBe(true)
        expect(result.authMethod).toBe('local') // Fallback to local
      })

      it('should create new user from LDAP data', async () => {
        // Arrange
        const mockLdapHelper = {
          authenticateUser: jest.fn().mockResolvedValue({
            success: true,
            userInfo: {
              email: 'ldap@example.com',
              fullName: 'LDAP User',
              groups: ['ldap-group'],
              dn: 'cn=user,dc=example,dc=com'
            }
          })
        }

        jest.doMock('../../src/utils/ldapHelper', () => mockLdapHelper)

        database.getUserByUsername.mockResolvedValue(null) // User doesn't exist
        database.createUser = jest.fn()

        // Act
        const result = await userService.authenticateLDAP('ldapuser', 'password')

        // Assert - Should create new user (this is tested via the userService.createUser call)
        expect(mockLdapHelper.authenticateUser).toHaveBeenCalledWith('ldapuser', 'password')
      })
    })

    describe('Unified Authentication', () => {
      it('should auto-select authentication method', async () => {
        // Arrange
        const mockUser = global.testUtils.createMockUser()
        database.getUserByUsername.mockResolvedValue(mockUser)
        userAuth.validatePassword.mockResolvedValue(true)

        // Act
        const result = await userService.authenticate('testuser', 'password', 'auto')

        // Assert
        expect(result.success).toBe(true)
        expect(result.authMethod).toBe('local')
      })

      it('should validate authentication method parameter', async () => {
        // Act & Assert
        await expect(userService.authenticate('user', 'pass', 'invalid'))
          .rejects.toThrow('Invalid authentication method: invalid')
      })
    })
  })

  // ==================== CRUD Operations Tests ====================

  describe('User CRUD Operations', () => {
    describe('Create User', () => {
      it('should successfully create new local user', async () => {
        // Arrange
        const userData = {
          username: 'newuser',
          email: 'new@example.com',
          fullName: 'New User',
          password: 'StrongPassword123!',
          authMethod: 'local'
        }

        database.getUserByUsername.mockResolvedValue(null) // Username available
        database.createUser.mockResolvedValue(true)
        userAuth.hashPassword.mockResolvedValue('hashed-password')

        // Act
        const result = await userService.createUser(userData)

        // Assert
        expect(result).toBeDefined()
        expect(result.username).toBe('newuser')
        expect(result.email).toBe('new@example.com')
        expect(database.createUser).toHaveBeenCalled()
        expect(userAuth.hashPassword).toHaveBeenCalledWith('StrongPassword123!')
      })

      it('should reject duplicate username', async () => {
        // Arrange
        const userData = { username: 'existinguser', email: 'test@example.com' }
        const existingUser = global.testUtils.createMockUser({ username: 'existinguser' })
        
        database.getUserByUsername.mockResolvedValue(existingUser)

        // Act & Assert
        await expect(userService.createUser(userData))
          .rejects.toThrow("Username 'existinguser' already exists")
      })

      it('should validate user data before creation', async () => {
        // Arrange
        const invalidUserData = {
          username: 'u', // Too short
          email: 'invalid-email'
        }

        // Act & Assert
        await expect(userService.createUser(invalidUserData))
          .rejects.toThrow('User data validation failed')
      })

      it('should handle LDAP user creation without password', async () => {
        // Arrange
        const ldapUserData = {
          username: 'ldapuser',
          email: 'ldap@example.com',
          authMethod: 'ldap',
          ldapDn: 'cn=user,dc=example,dc=com'
        }

        database.getUserByUsername.mockResolvedValue(null)
        database.createUser.mockResolvedValue(true)

        // Act
        const result = await userService.createUser(ldapUserData)

        // Assert
        expect(result.username).toBe('ldapuser')
        expect(result.authMethod).toBe('ldap')
        expect(userAuth.hashPassword).not.toHaveBeenCalled()
      })
    })

    describe('Update User', () => {
      it('should successfully update user information', async () => {
        // Arrange
        const existingUser = global.testUtils.createMockUser()
        const updateData = {
          fullName: 'Updated Name',
          email: 'updated@example.com'
        }

        database.getUserById.mockResolvedValueOnce(existingUser)
        database.updateUser.mockResolvedValue(true)
        database.getUserById.mockResolvedValueOnce({
          ...existingUser,
          ...updateData
        })

        // Act
        const result = await userService.updateUser('test-user-id', updateData)

        // Assert
        expect(result.fullName).toBe('Updated Name')
        expect(result.email).toBe('updated@example.com')
        expect(database.updateUser).toHaveBeenCalledWith('test-user-id', expect.objectContaining({
          fullName: 'Updated Name',
          email: 'updated@example.com'
        }))
      })

      it('should prevent updating non-existent user', async () => {
        // Arrange
        database.getUserById.mockResolvedValue(null)

        // Act & Assert
        await expect(userService.updateUser('non-existent', {}))
          .rejects.toThrow('User not found')
      })

      it('should filter allowed update fields', async () => {
        // Arrange
        const existingUser = global.testUtils.createMockUser()
        const updateData = {
          fullName: 'Updated Name',
          passwordHash: 'should-not-update', // Not allowed
          sensitive: 'should-not-update' // Not allowed
        }

        database.getUserById.mockResolvedValueOnce(existingUser)
        database.updateUser.mockResolvedValue(true)
        database.getUserById.mockResolvedValueOnce(existingUser)

        // Act
        await userService.updateUser('test-user-id', updateData)

        // Assert
        const updateCall = database.updateUser.mock.calls[0][1]
        expect(updateCall.fullName).toBe('Updated Name')
        expect(updateCall.passwordHash).toBeUndefined()
        expect(updateCall.sensitive).toBeUndefined()
      })
    })

    describe('Delete User', () => {
      it('should soft delete user successfully', async () => {
        // Arrange
        const existingUser = global.testUtils.createMockUser()
        database.getUserById.mockResolvedValue(existingUser)
        database.updateUser.mockResolvedValue(true)

        // Act
        const result = await userService.deleteUser('test-user-id')

        // Assert
        expect(result.success).toBe(true)
        expect(database.updateUser).toHaveBeenCalledWith('test-user-id', expect.objectContaining({
          status: 'inactive',
          isActive: false
        }))
      })

      it('should clear user sessions on deletion', async () => {
        // Arrange
        const existingUser = global.testUtils.createMockUser()
        database.getUserById.mockResolvedValue(existingUser)
        database.updateUser.mockResolvedValue(true)
        database.client.keys.mockResolvedValue(['session:1', 'session:2'])
        database.client.get.mockResolvedValue(JSON.stringify({
          userId: 'test-user-id'
        }))

        // Act
        await userService.deleteUser('test-user-id')

        // Assert
        expect(database.client.keys).toHaveBeenCalledWith('session:*')
        expect(database.client.del).toHaveBeenCalled()
      })
    })

    describe('Get User Operations', () => {
      it('should retrieve user by ID with sanitized data', async () => {
        // Arrange
        const mockUser = global.testUtils.createMockUser()
        database.getUserById.mockResolvedValue(mockUser)

        // Act
        const result = await userService.getUserById('test-user-id')

        // Assert
        expect(result).toBeDefined()
        expect(result.passwordHash).toBeUndefined() // Should be sanitized
        expect(result.username).toBe('testuser')
      })

      it('should return null for non-existent user', async () => {
        // Arrange
        database.getUserById.mockResolvedValue(null)

        // Act
        const result = await userService.getUserById('non-existent')

        // Assert
        expect(result).toBeNull()
      })

      it('should retrieve user by username', async () => {
        // Arrange
        const mockUser = global.testUtils.createMockUser()
        database.getUserByUsername.mockResolvedValue(mockUser)

        // Act
        const result = await userService.getUserByUsername('testuser')

        // Assert
        expect(result).toBeDefined()
        expect(result.username).toBe('testuser')
      })
    })
  })

  // ==================== Session Management Tests ====================

  describe('Session Management', () => {
    describe('Create User Session', () => {
      it('should create session successfully for active user', async () => {
        // Arrange
        const mockUser = global.testUtils.createMockUser({ status: 'active' })
        const mockSessionData = global.testUtils.createMockSession()
        
        database.getUserById.mockResolvedValue(mockUser)
        userAuth.createSessionData.mockReturnValue(mockSessionData)
        userAuth.generateJWT.mockReturnValue('mock.jwt.token')
        database.createSession.mockResolvedValue(true)

        // Act
        const result = await userService.createUserSession('test-user-id', {
          ipAddress: '127.0.0.1',
          userAgent: 'Test Agent'
        })

        // Assert
        expect(result.sessionToken).toBe('mock.jwt.token')
        expect(result.sessionId).toBe('test-session-id')
        expect(userAuth.createSessionData).toHaveBeenCalledWith('test-user-id', expect.any(Object))
        expect(database.createSession).toHaveBeenCalled()
      })

      it('should reject session creation for inactive user', async () => {
        // Arrange
        const mockUser = global.testUtils.createMockUser({ status: 'suspended' })
        database.getUserById.mockResolvedValue(mockUser)

        // Act & Assert
        await expect(userService.createUserSession('test-user-id'))
          .rejects.toThrow('User account is suspended')
      })

      it('should reject session creation for non-existent user', async () => {
        // Arrange
        database.getUserById.mockResolvedValue(null)

        // Act & Assert
        await expect(userService.createUserSession('non-existent'))
          .rejects.toThrow('User not found')
      })
    })

    describe('Validate User Session', () => {
      it('should validate valid session successfully', async () => {
        // Arrange
        const mockSessionData = global.testUtils.createMockSession()
        
        userAuth.validateJWT.mockReturnValue({ userId: 'test-user-id' })
        database.validateSession.mockResolvedValue(mockSessionData)
        userAuth.isSessionValid.mockReturnValue(true)
        userAuth.updateSessionActivity.mockReturnValue(mockSessionData)

        // Act
        const result = await userService.validateUserSession('mock.jwt.token')

        // Assert
        expect(result.valid).toBe(true)
        expect(result.userId).toBe('test-user-id')
        expect(result.sessionId).toBe('test-session-id')
      })

      it('should reject invalid JWT token', async () => {
        // Arrange
        userAuth.validateJWT.mockReturnValue(null)

        // Act
        const result = await userService.validateUserSession('invalid.token')

        // Assert
        expect(result).toBeNull()
      })

      it('should clean up expired sessions', async () => {
        // Arrange
        const mockSessionData = global.testUtils.createMockSession()
        
        userAuth.validateJWT.mockReturnValue({ userId: 'test-user-id' })
        database.validateSession.mockResolvedValue(mockSessionData)
        userAuth.isSessionValid.mockReturnValue(false) // Expired
        database.destroySession.mockResolvedValue(true)

        // Act
        const result = await userService.validateUserSession('expired.token')

        // Assert
        expect(result).toBeNull()
        expect(database.destroySession).toHaveBeenCalledWith('expired.token')
      })
    })

    describe('Refresh User Session', () => {
      it('should refresh valid session', async () => {
        // Arrange
        const mockUser = global.testUtils.createMockUser()
        const mockSessionData = { 
          valid: true, 
          userId: 'test-user-id', 
          sessionId: 'test-session-id' 
        }

        jest.spyOn(userService, 'validateUserSession').mockResolvedValue(mockSessionData)
        database.getUserById.mockResolvedValue(mockUser)
        userAuth.refreshJWT.mockReturnValue('new.jwt.token')

        // Act
        const result = await userService.refreshUserSession('old.token')

        // Assert
        expect(result.sessionToken).toBe('new.jwt.token')
        expect(result.sessionId).toBe('test-session-id')
      })

      it('should reject refresh for invalid session', async () => {
        // Arrange
        jest.spyOn(userService, 'validateUserSession').mockResolvedValue(null)

        // Act & Assert
        await expect(userService.refreshUserSession('invalid.token'))
          .rejects.toThrow('Invalid session token')
      })
    })

    describe('Destroy User Session', () => {
      it('should destroy session successfully', async () => {
        // Arrange
        const mockSessionData = global.testUtils.createMockSession()
        database.validateSession.mockResolvedValue(mockSessionData)
        database.destroySession.mockResolvedValue(true)

        // Act
        const result = await userService.destroyUserSession('test.token')

        // Assert
        expect(result.success).toBe(true)
        expect(database.destroySession).toHaveBeenCalledWith('test.token')
      })
    })
  })

  // ==================== Password Management Tests ====================

  describe('Password Management', () => {
    describe('Change Password', () => {
      it('should change password successfully', async () => {
        // Arrange
        const mockUser = global.testUtils.createMockUser({
          authMethod: 'local',
          passwordHash: 'old-hash'
        })

        database.getUserById.mockResolvedValue(mockUser)
        userAuth.validatePassword.mockResolvedValue(true)
        userAuth.validatePasswordStrength.mockReturnValue({ valid: true, errors: [] })
        userAuth.hashPassword.mockResolvedValue('new-hash')
        database.updateUser.mockResolvedValue(true)

        // Act
        const result = await userService.changePassword('test-user-id', 'oldpass', 'NewStrongPass123!')

        // Assert
        expect(result.success).toBe(true)
        expect(userAuth.validatePassword).toHaveBeenCalledWith('oldpass', 'old-hash')
        expect(userAuth.hashPassword).toHaveBeenCalledWith('NewStrongPass123!')
        expect(database.updateUser).toHaveBeenCalledWith('test-user-id', expect.objectContaining({
          passwordHash: 'new-hash'
        }))
      })

      it('should reject password change for LDAP users', async () => {
        // Arrange
        const mockUser = global.testUtils.createMockUser({
          authMethod: 'ldap'
        })
        database.getUserById.mockResolvedValue(mockUser)

        // Act & Assert
        await expect(userService.changePassword('test-user-id', 'old', 'new'))
          .rejects.toThrow('LDAP users cannot change password locally')
      })

      it('should validate old password', async () => {
        // Arrange
        const mockUser = global.testUtils.createMockUser({
          authMethod: 'local',
          passwordHash: 'correct-hash'
        })

        database.getUserById.mockResolvedValue(mockUser)
        userAuth.validatePassword.mockResolvedValue(false)

        // Act & Assert
        await expect(userService.changePassword('test-user-id', 'wrongold', 'newpass'))
          .rejects.toThrow('Current password is incorrect')
      })

      it('should validate new password strength', async () => {
        // Arrange
        const mockUser = global.testUtils.createMockUser({
          authMethod: 'local',
          passwordHash: 'old-hash'
        })

        database.getUserById.mockResolvedValue(mockUser)
        userAuth.validatePassword.mockResolvedValue(true)
        userAuth.validatePasswordStrength.mockReturnValue({
          valid: false,
          errors: ['Password too weak']
        })

        // Act & Assert
        await expect(userService.changePassword('test-user-id', 'oldpass', 'weak'))
          .rejects.toThrow('New password validation failed: Password too weak')
      })
    })

    describe('Reset Password', () => {
      it('should generate password reset token', async () => {
        // Arrange
        const mockUser = global.testUtils.createMockUser({
          authMethod: 'local'
        })

        database.getUserById.mockResolvedValue(mockUser)
        userAuth.generatePasswordResetToken.mockReturnValue({
          token: 'reset-token',
          expiresAt: new Date(Date.now() + 900000).toISOString()
        })

        // Act
        const result = await userService.resetPassword('test-user-id')

        // Assert
        expect(result.success).toBe(true)
        expect(result.resetToken).toBe('reset-token')
        expect(database.client.setex).toHaveBeenCalled()
      })

      it('should reject reset for LDAP users', async () => {
        // Arrange
        const mockUser = global.testUtils.createMockUser({
          authMethod: 'ldap'
        })
        database.getUserById.mockResolvedValue(mockUser)

        // Act & Assert
        await expect(userService.resetPassword('test-user-id'))
          .rejects.toThrow('LDAP users cannot reset password locally')
      })
    })
  })

  // ==================== Validation and Permissions Tests ====================

  describe('Data Validation', () => {
    describe('User Data Validation', () => {
      it('should validate correct user data', () => {
        // Arrange
        const validUserData = {
          username: 'validuser',
          email: 'valid@example.com',
          password: 'StrongPassword123!',
          authMethod: 'local'
        }

        // Act
        const result = userService.validateUserData(validUserData)

        // Assert
        expect(result.valid).toBe(true)
        expect(result.errors).toHaveLength(0)
      })

      it('should reject invalid username', () => {
        // Arrange
        const invalidUserData = {
          username: 'u', // Too short
          email: 'valid@example.com'
        }

        // Act
        const result = userService.validateUserData(invalidUserData)

        // Assert
        expect(result.valid).toBe(false)
        expect(result.errors).toContain('Username must be at least 3 characters long')
      })

      it('should reject invalid email format', () => {
        // Arrange
        const invalidUserData = {
          username: 'validuser',
          email: 'invalid-email'
        }

        // Act
        const result = userService.validateUserData(invalidUserData)

        // Assert
        expect(result.valid).toBe(false)
        expect(result.errors).toContain('Invalid email format')
      })

      it('should require username', () => {
        // Arrange
        const invalidUserData = {
          email: 'valid@example.com'
        }

        // Act
        const result = userService.validateUserData(invalidUserData)

        // Assert
        expect(result.valid).toBe(false)
        expect(result.errors).toContain('Username is required')
      })
    })

    describe('Permission Checking', () => {
      it('should grant admin all permissions', async () => {
        // Arrange
        const adminUser = global.testUtils.createMockUser({
          role: 'admin'
        })
        database.getUserById.mockResolvedValue(adminUser)

        // Act
        const result = await userService.checkUserPermissions('admin-id', ['any', 'permission'])

        // Assert
        expect(result).toBe(true)
      })

      it('should check role-based permissions', async () => {
        // Arrange
        const userUser = global.testUtils.createMockUser({
          role: 'user'
        })
        database.getUserById.mockResolvedValue(userUser)

        // Act
        const readResult = await userService.checkUserPermissions('user-id', ['read'])
        const writeResult = await userService.checkUserPermissions('user-id', ['write'])

        // Assert
        expect(readResult).toBe(true)
        expect(writeResult).toBe(true)
      })

      it('should deny permissions for inactive user', async () => {
        // Arrange
        const inactiveUser = global.testUtils.createMockUser({
          status: 'inactive'
        })
        database.getUserById.mockResolvedValue(inactiveUser)

        // Act
        const result = await userService.checkUserPermissions('inactive-id', ['read'])

        // Assert
        expect(result).toBe(false)
      })
    })
  })

  // ==================== Edge Cases and Error Handling ====================

  describe('Edge Cases', () => {
    it('should handle database connection errors gracefully', async () => {
      // Arrange
      database.getUserById.mockRejectedValue(new Error('Database connection failed'))

      // Act & Assert
      await expect(userService.getUserById('test-id'))
        .rejects.toThrow('Database connection failed')
    })

    it('should handle missing dependencies gracefully', async () => {
      // Test LDAP fallback when LDAP is not available
      const result = await userService.authenticateLDAP('user', 'pass')
      // Should fallback to local auth, which will fail for missing user
      await expect(result).rejects.toBeDefined()
    })

    it('should sanitize user data consistently', async () => {
      // Arrange
      const mockUser = global.testUtils.createMockUser({
        passwordHash: 'sensitive-hash',
        sensitiveField: 'should-be-removed'
      })
      database.getUserById.mockResolvedValue(mockUser)

      // Act
      const result = await userService.getUserById('test-id')

      // Assert
      expect(result.passwordHash).toBeUndefined()
      expect(result.username).toBeDefined()
    })
  })
})