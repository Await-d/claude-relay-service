/**
 * @fileoverview GroupService - User group management service
 *
 * Provides comprehensive group management functionality including:
 * - Group CRUD operations
 * - User-group relationships
 * - Permission management and inheritance
 * - Account assignment for scheduling
 * - Group-based access control
 *
 * @author Claude Code
 * @version 1.0.0
 */

const { v4: uuidv4 } = require('uuid')
const database = require('../models/database')
const logger = require('../utils/logger')
const config = require('../../config/config')

/**
 * Group Service Class
 *
 * Manages user groups, permissions, and account assignments for the Claude Relay Service.
 * Supports hierarchical groups, permission inheritance, and scheduling configuration.
 */
class GroupService {
  constructor() {
    // Supported account types for assignment
    this.ACCOUNT_TYPES = ['claude', 'gemini', 'openai']

    // Available scheduling strategies
    this.SCHEDULING_STRATEGIES = ['random', 'round_robin', 'weighted', 'priority', 'least_recent']

    // Default permissions for new groups
    this.DEFAULT_PERMISSIONS = {
      'chat.create': false,
      'chat.history': false,
      'models.list': false,
      'usage.view': false,
      'admin.read': false,
      'admin.write': false
    }

    // Permission categories and their capabilities
    this.PERMISSION_CATEGORIES = {
      chat: ['chat.create', 'chat.history', 'chat.export'],
      models: ['models.list', 'models.access'],
      usage: ['usage.view', 'usage.export'],
      admin: ['admin.read', 'admin.write', 'admin.manage']
    }
  }

  // ==================== Group CRUD Operations ====================

  /**
   * Create a new group
   *
   * @param {Object} groupData Group configuration
   * @param {string} groupData.name Group name (must be unique)
   * @param {string} [groupData.description] Group description
   * @param {string} [groupData.parentId] Parent group ID for hierarchy
   * @param {Object} [groupData.permissions] Permission settings
   * @param {Object} [groupData.accounts] Account assignments
   * @param {Object} [groupData.schedulingConfig] Scheduling configuration
   * @param {boolean} [groupData.isActive=true] Whether group is active
   * @returns {Promise<Object>} Created group object
   * @throws {Error} If group creation fails
   */
  async createGroup(groupData) {
    try {
      // Validate required fields
      this.validateGroupData(groupData)

      // Check for name uniqueness
      const existingGroups = await this.getAllGroups()
      const nameExists = existingGroups.some(
        (group) => group.name.toLowerCase() === groupData.name.toLowerCase()
      )
      if (nameExists) {
        throw new Error(`Group name '${groupData.name}' already exists`)
      }

      // Validate parent group if specified
      if (groupData.parentId) {
        const parentGroup = await this.getGroupById(groupData.parentId)
        if (!parentGroup) {
          throw new Error(`Parent group '${groupData.parentId}' not found`)
        }

        // Check for circular dependencies
        if (await this._wouldCreateCircularDependency(groupData.parentId, null)) {
          throw new Error('Cannot create group: would create circular dependency')
        }
      }

      const groupId = uuidv4()
      const now = new Date().toISOString()

      // Prepare group data with defaults
      const group = {
        id: groupId,
        name: groupData.name.trim(),
        description: groupData.description || '',
        parentId: groupData.parentId || null,
        permissions: { ...this.DEFAULT_PERMISSIONS, ...(groupData.permissions || {}) },
        accounts: {
          claudeAccounts: groupData.accounts?.claudeAccounts || [],
          geminiAccounts: groupData.accounts?.geminiAccounts || [],
          openaiAccounts: groupData.accounts?.openaiAccounts || []
        },
        schedulingConfig: {
          strategy: groupData.schedulingConfig?.strategy || 'round_robin',
          weights: groupData.schedulingConfig?.weights || {},
          fallbackToGlobal: groupData.schedulingConfig?.fallbackToGlobal !== false,
          healthCheckEnabled: groupData.schedulingConfig?.healthCheckEnabled !== false
        },
        isActive: groupData.isActive !== false,
        createdAt: now,
        updatedAt: now,
        createdBy: groupData.createdBy || 'system',
        members: [], // User IDs in this group
        metadata: {
          memberCount: 0,
          accountCount: 0,
          lastActivity: null
        }
      }

      // Validate permissions
      this.validatePermissions(group.permissions)

      // Validate scheduling configuration
      this.validateSchedulingConfig(group.schedulingConfig)

      // Create the group in database
      await database.createGroup(group)

      logger.success(`🏢 Created group: ${group.name} (${groupId})`)

      return {
        id: groupId,
        name: group.name,
        description: group.description,
        parentId: group.parentId,
        permissions: group.permissions,
        accounts: group.accounts,
        schedulingConfig: group.schedulingConfig,
        isActive: group.isActive,
        createdAt: group.createdAt,
        memberCount: 0
      }
    } catch (error) {
      logger.error('❌ Failed to create group:', error)
      throw error
    }
  }

  /**
   * Update an existing group
   *
   * @param {string} groupId Group ID
   * @param {Object} updateData Update data
   * @returns {Promise<Object>} Update result
   * @throws {Error} If update fails
   */
  async updateGroup(groupId, updateData) {
    try {
      if (!groupId) {
        throw new Error('Group ID is required')
      }

      // Get existing group
      const existingGroup = await this.getGroupById(groupId)
      if (!existingGroup) {
        throw new Error('Group not found')
      }

      // Check name uniqueness if name is being updated
      if (updateData.name && updateData.name !== existingGroup.name) {
        const allGroups = await this.getAllGroups()
        const nameExists = allGroups.some(
          (group) =>
            group.id !== groupId && group.name.toLowerCase() === updateData.name.toLowerCase()
        )
        if (nameExists) {
          throw new Error(`Group name '${updateData.name}' already exists`)
        }
      }

      // Check for circular dependencies if parent is changing
      if (updateData.parentId !== undefined && updateData.parentId !== existingGroup.parentId) {
        if (
          updateData.parentId &&
          (await this._wouldCreateCircularDependency(updateData.parentId, groupId))
        ) {
          throw new Error('Cannot update group: would create circular dependency')
        }
      }

      // Prepare update data
      const allowedFields = [
        'name',
        'description',
        'parentId',
        'permissions',
        'accounts',
        'schedulingConfig',
        'isActive'
      ]

      const updates = { updatedAt: new Date().toISOString() }

      for (const [field, value] of Object.entries(updateData)) {
        if (allowedFields.includes(field)) {
          if (field === 'name' && value) {
            updates[field] = value.trim()
          } else if (field === 'permissions' && value) {
            this.validatePermissions(value)
            updates[field] = { ...existingGroup.permissions, ...value }
          } else if (field === 'accounts' && value) {
            updates[field] = {
              claudeAccounts: value.claudeAccounts || existingGroup.accounts.claudeAccounts || [],
              geminiAccounts: value.geminiAccounts || existingGroup.accounts.geminiAccounts || [],
              openaiAccounts: value.openaiAccounts || existingGroup.accounts.openaiAccounts || []
            }
          } else if (field === 'schedulingConfig' && value) {
            const newConfig = { ...existingGroup.schedulingConfig, ...value }
            this.validateSchedulingConfig(newConfig)
            updates[field] = newConfig
          } else {
            updates[field] = value
          }
        }
      }

      // Update metadata
      if (updates.accounts) {
        const accountCount =
          (updates.accounts.claudeAccounts?.length || 0) +
          (updates.accounts.geminiAccounts?.length || 0) +
          (updates.accounts.openaiAccounts?.length || 0)
        updates['metadata.accountCount'] = accountCount
      }

      // Update in database
      const success = await database.updateGroup(groupId, updates)
      if (!success) {
        throw new Error('Failed to update group in database')
      }

      logger.success(`📝 Updated group: ${existingGroup.name} (${groupId})`)

      return { success: true }
    } catch (error) {
      logger.error('❌ Failed to update group:', error)
      throw error
    }
  }

  /**
   * Delete a group
   *
   * @param {string} groupId Group ID
   * @param {boolean} [force=false] Force delete even with members
   * @returns {Promise<Object>} Delete result
   * @throws {Error} If delete fails
   */
  async deleteGroup(groupId, force = false) {
    try {
      if (!groupId) {
        throw new Error('Group ID is required')
      }

      const group = await this.getGroupById(groupId)
      if (!group) {
        throw new Error('Group not found')
      }

      // Check for members unless force delete
      if (!force && group.members && group.members.length > 0) {
        throw new Error(
          `Cannot delete group '${group.name}': has ${group.members.length} members. Use force=true to delete anyway.`
        )
      }

      // Check for child groups
      const childGroups = await this._getChildGroups(groupId)
      if (childGroups.length > 0) {
        if (!force) {
          throw new Error(
            `Cannot delete group '${group.name}': has ${childGroups.length} child groups. Use force=true to delete anyway.`
          )
        }

        // Update child groups to remove parent
        for (const child of childGroups) {
          await this.updateGroup(child.id, { parentId: null })
          logger.info(`🔗 Removed parent from child group: ${child.name}`)
        }
      }

      // Remove users from group
      if (group.members && group.members.length > 0) {
        for (const userId of group.members) {
          try {
            await this.removeUserFromGroup(userId, groupId)
          } catch (error) {
            logger.warn(`⚠️ Failed to remove user ${userId} from group: ${error.message}`)
          }
        }
      }

      // Delete from database
      const success = await database.deleteGroup(groupId)
      if (!success) {
        throw new Error('Failed to delete group from database')
      }

      logger.success(`🗑️ Deleted group: ${group.name} (${groupId})`)

      return { success: true }
    } catch (error) {
      logger.error('❌ Failed to delete group:', error)
      throw error
    }
  }

  /**
   * Get group by ID
   *
   * @param {string} groupId Group ID
   * @returns {Promise<Object|null>} Group object or null if not found
   */
  async getGroupById(groupId) {
    try {
      if (!groupId) {
        return null
      }

      const groupData = await database.getGroupById(groupId)
      return groupData
    } catch (error) {
      logger.error(`❌ Failed to get group ${groupId}:`, error)
      return null
    }
  }

  /**
   * Get all groups
   *
   * @param {Object} [options] Query options
   * @param {boolean} [options.includeInactive=false] Include inactive groups
   * @param {string} [options.parentId] Filter by parent group
   * @returns {Promise<Array>} Array of group objects
   */
  async getAllGroups(options = {}) {
    try {
      const groups = await database.getAllGroups()

      let filteredGroups = groups

      // Filter by active status
      if (!options.includeInactive) {
        filteredGroups = filteredGroups.filter((group) => group.isActive !== false)
      }

      // Filter by parent
      if (options.parentId !== undefined) {
        filteredGroups = filteredGroups.filter((group) => group.parentId === options.parentId)
      }

      return filteredGroups
    } catch (error) {
      logger.error('❌ Failed to get all groups:', error)
      throw error
    }
  }

  // ==================== User-Group Management ====================

  /**
   * Assign user to group
   *
   * @param {string} userId User ID
   * @param {string} groupId Group ID
   * @returns {Promise<Object>} Assignment result
   * @throws {Error} If assignment fails
   */
  async assignUserToGroup(userId, groupId) {
    try {
      if (!userId || !groupId) {
        throw new Error('User ID and Group ID are required')
      }

      // Verify group exists and is active
      const group = await this.getGroupById(groupId)
      if (!group) {
        throw new Error('Group not found')
      }
      if (!group.isActive) {
        throw new Error('Cannot assign to inactive group')
      }

      // Use database method for assignment
      const success = await database.assignUserToGroup(userId, groupId)
      if (!success) {
        throw new Error('Failed to assign user to group')
      }

      // Update group metadata
      const memberCount = (group.members?.length || 0) + 1
      await database.updateGroup(groupId, {
        'metadata.memberCount': memberCount,
        'metadata.lastActivity': new Date().toISOString()
      })

      logger.success(`👥 Assigned user ${userId} to group ${group.name} (${groupId})`)

      return { success: true }
    } catch (error) {
      logger.error('❌ Failed to assign user to group:', error)
      throw error
    }
  }

  /**
   * Remove user from group
   *
   * @param {string} userId User ID
   * @param {string} groupId Group ID
   * @returns {Promise<Object>} Removal result
   * @throws {Error} If removal fails
   */
  async removeUserFromGroup(userId, groupId) {
    try {
      if (!userId || !groupId) {
        throw new Error('User ID and Group ID are required')
      }

      // Get user's current groups
      const userGroups = await this.getUserGroups(userId)
      const isInGroup = userGroups.some((group) => group.id === groupId)

      if (!isInGroup) {
        logger.info(`ℹ️ User ${userId} is not in group ${groupId}`)
        return { success: true }
      }

      // Remove from database
      const success = await database.removeUserFromGroup(userId, groupId)
      if (!success) {
        throw new Error('Failed to remove user from group')
      }

      // Update group metadata
      const group = await this.getGroupById(groupId)
      if (group) {
        const memberCount = Math.max(0, (group.members?.length || 0) - 1)
        await database.updateGroup(groupId, {
          'metadata.memberCount': memberCount,
          'metadata.lastActivity': new Date().toISOString()
        })
      }

      logger.success(`👥 Removed user ${userId} from group ${groupId}`)

      return { success: true }
    } catch (error) {
      logger.error('❌ Failed to remove user from group:', error)
      throw error
    }
  }

  /**
   * Get user's groups
   *
   * @param {string} userId User ID
   * @param {boolean} [includeInactive=false] Include inactive groups
   * @returns {Promise<Array>} Array of group objects
   */
  async getUserGroups(userId, includeInactive = false) {
    try {
      if (!userId) {
        return []
      }

      const groups = await database.getUserGroups(userId)

      if (!includeInactive) {
        return groups.filter((group) => group.isActive !== false)
      }

      return groups
    } catch (error) {
      logger.error(`❌ Failed to get user groups for ${userId}:`, error)
      return []
    }
  }

  /**
   * Get group members
   *
   * @param {string} groupId Group ID
   * @returns {Promise<Array>} Array of user IDs
   */
  async getGroupMembers(groupId) {
    try {
      if (!groupId) {
        return []
      }

      const group = await this.getGroupById(groupId)
      return group?.members || []
    } catch (error) {
      logger.error(`❌ Failed to get group members for ${groupId}:`, error)
      return []
    }
  }

  // ==================== Permission Management ====================

  /**
   * Calculate user's effective permissions (user + all groups)
   *
   * @param {string} userId User ID
   * @returns {Promise<Object>} Combined permissions object
   */
  async calculateUserPermissions(userId) {
    try {
      if (!userId) {
        return { ...this.DEFAULT_PERMISSIONS }
      }

      // Get user's direct permissions (if UserService is available)
      let userPermissions = {}
      try {
        const userService = require('./userService')
        const user = await userService.getUserById(userId)
        userPermissions = user?.permissions || {}
      } catch (error) {
        logger.debug(`No direct user permissions found for ${userId}: ${error.message}`)
      }

      // Get user's groups
      const userGroups = await this.getUserGroups(userId)

      // Combine permissions from all groups (union approach - most permissive wins)
      const combinedPermissions = { ...this.DEFAULT_PERMISSIONS, ...userPermissions }

      for (const group of userGroups) {
        if (group.permissions) {
          for (const [permission, value] of Object.entries(group.permissions)) {
            // Most permissive wins - if any group allows it, user can do it
            if (value === true) {
              combinedPermissions[permission] = true
            }
          }
        }
      }

      // Include parent group permissions (inheritance)
      for (const group of userGroups) {
        if (group.parentId) {
          const parentPermissions = await this._getInheritedPermissions(group.parentId, new Set())
          for (const [permission, value] of Object.entries(parentPermissions)) {
            if (value === true) {
              combinedPermissions[permission] = true
            }
          }
        }
      }

      return combinedPermissions
    } catch (error) {
      logger.error(`❌ Failed to calculate permissions for user ${userId}:`, error)
      return { ...this.DEFAULT_PERMISSIONS }
    }
  }

  /**
   * Check if group has specific permission
   *
   * @param {string} groupId Group ID
   * @param {string} permission Permission name
   * @returns {Promise<boolean>} Whether group has permission
   */
  async checkGroupPermission(groupId, permission) {
    try {
      const group = await this.getGroupById(groupId)
      if (!group) {
        return false
      }

      // Check direct permission
      if (group.permissions && group.permissions[permission] === true) {
        return true
      }

      // Check inherited permissions
      if (group.parentId) {
        const inheritedPermissions = await this._getInheritedPermissions(group.parentId, new Set())
        return inheritedPermissions[permission] === true
      }

      return false
    } catch (error) {
      logger.error(`❌ Failed to check group permission ${permission} for ${groupId}:`, error)
      return false
    }
  }

  /**
   * Update group permissions
   *
   * @param {string} groupId Group ID
   * @param {Object} permissions New permissions object
   * @returns {Promise<Object>} Update result
   * @throws {Error} If update fails
   */
  async updateGroupPermissions(groupId, permissions) {
    try {
      this.validatePermissions(permissions)
      return await this.updateGroup(groupId, { permissions })
    } catch (error) {
      logger.error(`❌ Failed to update permissions for group ${groupId}:`, error)
      throw error
    }
  }

  // ==================== Account Assignment ====================

  /**
   * Assign accounts to group
   *
   * @param {string} groupId Group ID
   * @param {Object} accounts Account assignments
   * @param {Array} [accounts.claudeAccounts] Claude account IDs
   * @param {Array} [accounts.geminiAccounts] Gemini account IDs
   * @param {Array} [accounts.openaiAccounts] OpenAI account IDs
   * @returns {Promise<Object>} Assignment result
   */
  async assignAccountsToGroup(groupId, accounts) {
    try {
      if (!groupId) {
        throw new Error('Group ID is required')
      }

      const group = await this.getGroupById(groupId)
      if (!group) {
        throw new Error('Group not found')
      }

      // Validate account assignments
      await this._validateAccountAssignments(accounts)

      // Merge with existing accounts
      const newAccounts = {
        claudeAccounts: [
          ...(group.accounts?.claudeAccounts || []),
          ...(accounts.claudeAccounts || [])
        ],
        geminiAccounts: [
          ...(group.accounts?.geminiAccounts || []),
          ...(accounts.geminiAccounts || [])
        ],
        openaiAccounts: [
          ...(group.accounts?.openaiAccounts || []),
          ...(accounts.openaiAccounts || [])
        ]
      }

      // Remove duplicates
      newAccounts.claudeAccounts = [...new Set(newAccounts.claudeAccounts)]
      newAccounts.geminiAccounts = [...new Set(newAccounts.geminiAccounts)]
      newAccounts.openaiAccounts = [...new Set(newAccounts.openaiAccounts)]

      await this.updateGroup(groupId, { accounts: newAccounts })

      logger.success(`🔗 Assigned accounts to group ${group.name} (${groupId})`)

      return { success: true }
    } catch (error) {
      logger.error('❌ Failed to assign accounts to group:', error)
      throw error
    }
  }

  /**
   * Remove accounts from group
   *
   * @param {string} groupId Group ID
   * @param {Object} accounts Accounts to remove
   * @returns {Promise<Object>} Removal result
   */
  async removeAccountsFromGroup(groupId, accounts) {
    try {
      if (!groupId) {
        throw new Error('Group ID is required')
      }

      const group = await this.getGroupById(groupId)
      if (!group) {
        throw new Error('Group not found')
      }

      const newAccounts = {
        claudeAccounts: (group.accounts?.claudeAccounts || []).filter(
          (id) => !(accounts.claudeAccounts || []).includes(id)
        ),
        geminiAccounts: (group.accounts?.geminiAccounts || []).filter(
          (id) => !(accounts.geminiAccounts || []).includes(id)
        ),
        openaiAccounts: (group.accounts?.openaiAccounts || []).filter(
          (id) => !(accounts.openaiAccounts || []).includes(id)
        )
      }

      await this.updateGroup(groupId, { accounts: newAccounts })

      logger.success(`🔗 Removed accounts from group ${group.name} (${groupId})`)

      return { success: true }
    } catch (error) {
      logger.error('❌ Failed to remove accounts from group:', error)
      throw error
    }
  }

  /**
   * Get group's assigned accounts
   *
   * @param {string} groupId Group ID
   * @returns {Promise<Object>} Account assignments
   */
  async getGroupAccounts(groupId) {
    try {
      if (!groupId) {
        return { claudeAccounts: [], geminiAccounts: [], openaiAccounts: [] }
      }

      return await database.getGroupAccounts(groupId)
    } catch (error) {
      logger.error(`❌ Failed to get group accounts for ${groupId}:`, error)
      return { claudeAccounts: [], geminiAccounts: [], openaiAccounts: [] }
    }
  }

  /**
   * Get which groups have specific account assigned
   *
   * @param {string} accountId Account ID
   * @param {string} accountType Account type ('claude', 'gemini', 'openai')
   * @returns {Promise<Array>} Array of group objects
   */
  async getAccountGroups(accountId, accountType) {
    try {
      if (!accountId || !accountType) {
        return []
      }

      if (!this.ACCOUNT_TYPES.includes(accountType)) {
        throw new Error(`Invalid account type: ${accountType}`)
      }

      const allGroups = await this.getAllGroups()
      const accountField = `${accountType}Accounts`

      return allGroups.filter(
        (group) =>
          group.accounts &&
          group.accounts[accountField] &&
          group.accounts[accountField].includes(accountId)
      )
    } catch (error) {
      logger.error(`❌ Failed to get account groups for ${accountId}:`, error)
      return []
    }
  }

  // ==================== Scheduling Support ====================

  /**
   * Get scheduling configuration for group
   *
   * @param {string} groupId Group ID
   * @returns {Promise<Object>} Scheduling configuration
   */
  async getSchedulingConfig(groupId) {
    try {
      const group = await this.getGroupById(groupId)
      return (
        group?.schedulingConfig || {
          strategy: 'round_robin',
          weights: {},
          fallbackToGlobal: true,
          healthCheckEnabled: true
        }
      )
    } catch (error) {
      logger.error(`❌ Failed to get scheduling config for group ${groupId}:`, error)
      return null
    }
  }

  /**
   * Update scheduling configuration
   *
   * @param {string} groupId Group ID
   * @param {Object} config New scheduling configuration
   * @returns {Promise<Object>} Update result
   */
  async updateSchedulingConfig(groupId, config) {
    try {
      this.validateSchedulingConfig(config)
      return await this.updateGroup(groupId, { schedulingConfig: config })
    } catch (error) {
      logger.error(`❌ Failed to update scheduling config for group ${groupId}:`, error)
      throw error
    }
  }

  // ==================== Validation Methods ====================

  /**
   * Validate group data
   *
   * @param {Object} groupData Group data to validate
   * @throws {Error} If validation fails
   */
  validateGroupData(groupData) {
    if (!groupData || typeof groupData !== 'object') {
      throw new Error('Group data is required')
    }

    if (!groupData.name || typeof groupData.name !== 'string' || !groupData.name.trim()) {
      throw new Error('Group name is required')
    }

    if (groupData.name.length > 100) {
      throw new Error('Group name must be 100 characters or less')
    }

    if (groupData.description && typeof groupData.description !== 'string') {
      throw new Error('Group description must be a string')
    }

    if (groupData.description && groupData.description.length > 500) {
      throw new Error('Group description must be 500 characters or less')
    }

    if (groupData.parentId && typeof groupData.parentId !== 'string') {
      throw new Error('Parent ID must be a string')
    }
  }

  /**
   * Validate permissions object
   *
   * @param {Object} permissions Permissions to validate
   * @throws {Error} If validation fails
   */
  validatePermissions(permissions) {
    if (!permissions || typeof permissions !== 'object') {
      throw new Error('Permissions must be an object')
    }

    const allValidPermissions = Object.values(this.PERMISSION_CATEGORIES).flat()

    for (const [permission, value] of Object.entries(permissions)) {
      if (
        !allValidPermissions.includes(permission) &&
        !Object.keys(this.DEFAULT_PERMISSIONS).includes(permission)
      ) {
        throw new Error(`Invalid permission: ${permission}`)
      }

      if (typeof value !== 'boolean') {
        throw new Error(`Permission value for '${permission}' must be boolean`)
      }
    }
  }

  /**
   * Validate scheduling configuration
   *
   * @param {Object} config Scheduling config to validate
   * @throws {Error} If validation fails
   */
  validateSchedulingConfig(config) {
    if (!config || typeof config !== 'object') {
      throw new Error('Scheduling config must be an object')
    }

    if (config.strategy && !this.SCHEDULING_STRATEGIES.includes(config.strategy)) {
      throw new Error(
        `Invalid scheduling strategy: ${config.strategy}. Must be one of: ${this.SCHEDULING_STRATEGIES.join(', ')}`
      )
    }

    if (config.weights && typeof config.weights !== 'object') {
      throw new Error('Scheduling weights must be an object')
    }

    if (config.weights) {
      for (const [accountId, weight] of Object.entries(config.weights)) {
        if (typeof weight !== 'number' || weight < 0 || weight > 1) {
          throw new Error(`Invalid weight for account ${accountId}: must be number between 0 and 1`)
        }
      }
    }

    if (config.fallbackToGlobal !== undefined && typeof config.fallbackToGlobal !== 'boolean') {
      throw new Error('fallbackToGlobal must be boolean')
    }

    if (config.healthCheckEnabled !== undefined && typeof config.healthCheckEnabled !== 'boolean') {
      throw new Error('healthCheckEnabled must be boolean')
    }
  }

  // ==================== Private Helper Methods ====================

  /**
   * Check if adding parent would create circular dependency
   *
   * @param {string} parentId Parent group ID
   * @param {string} childId Child group ID
   * @param {Set} [visited] Visited groups (for recursion)
   * @returns {Promise<boolean>} Whether it would create circular dependency
   * @private
   */
  async _wouldCreateCircularDependency(parentId, childId, visited = new Set()) {
    if (!parentId || !childId) {
      return false
    }

    if (parentId === childId) {
      return true
    }

    if (visited.has(parentId)) {
      return true
    }

    visited.add(parentId)

    const parent = await this.getGroupById(parentId)
    if (!parent || !parent.parentId) {
      return false
    }

    return await this._wouldCreateCircularDependency(parent.parentId, childId, visited)
  }

  /**
   * Get inherited permissions from parent groups
   *
   * @param {string} parentId Parent group ID
   * @param {Set} visited Visited groups (prevent circular references)
   * @returns {Promise<Object>} Inherited permissions
   * @private
   */
  async _getInheritedPermissions(parentId, visited = new Set()) {
    if (!parentId || visited.has(parentId)) {
      return {}
    }

    visited.add(parentId)

    const parent = await this.getGroupById(parentId)
    if (!parent) {
      return {}
    }

    let permissions = { ...parent.permissions }

    // Recursively get permissions from higher parents
    if (parent.parentId) {
      const grandParentPermissions = await this._getInheritedPermissions(parent.parentId, visited)
      permissions = { ...grandParentPermissions, ...permissions }
    }

    return permissions
  }

  /**
   * Get child groups
   *
   * @param {string} parentId Parent group ID
   * @returns {Promise<Array>} Array of child groups
   * @private
   */
  async _getChildGroups(parentId) {
    try {
      const allGroups = await this.getAllGroups()
      return allGroups.filter((group) => group.parentId === parentId)
    } catch (error) {
      logger.error(`❌ Failed to get child groups for ${parentId}:`, error)
      return []
    }
  }

  /**
   * Validate account assignments
   *
   * @param {Object} accounts Account assignments to validate
   * @returns {Promise<void>}
   * @throws {Error} If validation fails
   * @private
   */
  async _validateAccountAssignments(accounts) {
    if (!accounts || typeof accounts !== 'object') {
      return
    }

    const { claudeAccounts, geminiAccounts, openaiAccounts } = accounts

    // Validate Claude accounts
    if (claudeAccounts) {
      if (!Array.isArray(claudeAccounts)) {
        throw new Error('claudeAccounts must be an array')
      }

      for (const accountId of claudeAccounts) {
        try {
          const account = await database.getClaudeAccount(accountId)
          if (!account) {
            throw new Error(`Claude account ${accountId} not found`)
          }
        } catch (error) {
          throw new Error(`Invalid Claude account ${accountId}: ${error.message}`)
        }
      }
    }

    // Validate Gemini accounts
    if (geminiAccounts) {
      if (!Array.isArray(geminiAccounts)) {
        throw new Error('geminiAccounts must be an array')
      }

      for (const accountId of geminiAccounts) {
        try {
          const account = await database.getGeminiAccount(accountId)
          if (!account) {
            throw new Error(`Gemini account ${accountId} not found`)
          }
        } catch (error) {
          throw new Error(`Invalid Gemini account ${accountId}: ${error.message}`)
        }
      }
    }

    // Validate OpenAI accounts (if implemented)
    if (openaiAccounts) {
      if (!Array.isArray(openaiAccounts)) {
        throw new Error('openaiAccounts must be an array')
      }
      // Note: OpenAI account validation would be implemented when OpenAI support is added
    }
  }
}

module.exports = new GroupService()
