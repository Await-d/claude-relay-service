const openaiAccountService = require('./openaiAccountService')
const accountGroupService = require('./accountGroupService')
const redis = require('../models/redis')
const logger = require('../utils/logger')
const config = require('../../config/config')

class UnifiedOpenAIScheduler {
  constructor() {
    this.SESSION_MAPPING_PREFIX = 'unified_openai_session_mapping:'
    this.ROUND_ROBIN_KEY = 'scheduler:openai:round_robin:index'
    this.SEQUENTIAL_KEY = 'scheduler:openai:sequential:position'
    this.USAGE_STATS_PREFIX = 'scheduler:openai:usage_stats:'

    // 支持的调度策略
    this.SUPPORTED_STRATEGIES = [
      'round_robin',
      'least_used',
      'least_recent',
      'random',
      'weighted_random',
      'sequential'
    ]
  }

  // 🎯 获取系统默认调度策略
  async _getSystemDefaultStrategy() {
    try {
      // 首先尝试从Redis获取动态配置
      const systemConfig = await redis.getSystemSchedulingConfig()
      if (systemConfig && systemConfig.defaultStrategy) {
        return systemConfig.defaultStrategy
      }

      // 回退到配置文件中的默认值
      return config.scheduling?.defaultStrategy || 'least_recent'
    } catch (error) {
      logger.debug('Failed to get system scheduling config, using fallback:', error)
      // 出错时使用配置文件默认值或硬编码默认值
      return config.scheduling?.defaultStrategy || 'least_recent'
    }
  }

  // 🔧 辅助方法：检查账户是否可调度（兼容字符串和布尔值）
  _isSchedulable(schedulable) {
    // 如果是 undefined 或 null，默认为可调度
    if (schedulable === undefined || schedulable === null) {
      return true
    }
    // 明确设置为 false（布尔值）或 'false'（字符串）时不可调度
    return schedulable !== false && schedulable !== 'false'
  }

  // 🎯 统一调度OpenAI账号
  async selectAccountForApiKey(apiKeyData, sessionHash = null, requestedModel = null) {
    try {
      // 如果API Key绑定了专属账户或分组，优先使用
      if (apiKeyData.openaiAccountId) {
        // 检查是否是分组
        if (apiKeyData.openaiAccountId.startsWith('group:')) {
          const groupId = apiKeyData.openaiAccountId.replace('group:', '')
          logger.info(
            `🎯 API key ${apiKeyData.name} is bound to group ${groupId}, selecting from group`
          )
          return await this.selectAccountFromGroup(groupId, sessionHash, requestedModel, apiKeyData)
        }

        // 普通专属账户
        const boundAccount = await openaiAccountService.getAccount(apiKeyData.openaiAccountId)
        if (boundAccount && boundAccount.isActive === 'true' && boundAccount.status !== 'error') {
          // 检查是否被限流
          const isRateLimited = await this.isAccountRateLimited(boundAccount.id)
          if (isRateLimited) {
            const errorMsg = `Dedicated account ${boundAccount.name} is currently rate limited`
            logger.warn(`⚠️ ${errorMsg}`)
            throw new Error(errorMsg)
          }

          // 专属账户：可选的模型检查（只有明确配置了supportedModels且不为空才检查）
          if (
            requestedModel &&
            boundAccount.supportedModels &&
            boundAccount.supportedModels.length > 0
          ) {
            const modelSupported = boundAccount.supportedModels.includes(requestedModel)
            if (!modelSupported) {
              const errorMsg = `Dedicated account ${boundAccount.name} does not support model ${requestedModel}`
              logger.warn(`⚠️ ${errorMsg}`)
              throw new Error(errorMsg)
            }
          }

          logger.info(
            `🎯 Using bound dedicated OpenAI account: ${boundAccount.name} (${apiKeyData.openaiAccountId}) for API key ${apiKeyData.name}`
          )
          // 更新账户的最后使用时间
          await openaiAccountService.recordUsage(apiKeyData.openaiAccountId, 0)
          return {
            accountId: apiKeyData.openaiAccountId,
            accountType: 'openai'
          }
        } else {
          // 专属账户不可用时直接报错，不降级到共享池
          const errorMsg = boundAccount
            ? `Dedicated account ${boundAccount.name} is not available (inactive or error status)`
            : `Dedicated account ${apiKeyData.openaiAccountId} not found`
          logger.warn(`⚠️ ${errorMsg}`)
          throw new Error(errorMsg)
        }
      }

      // 如果有会话哈希，检查是否有已映射的账户
      if (sessionHash) {
        const mappedAccount = await this._getSessionMapping(sessionHash)
        if (mappedAccount) {
          // 验证映射的账户是否仍然可用
          const isAvailable = await this._isAccountAvailable(
            mappedAccount.accountId,
            mappedAccount.accountType
          )
          if (isAvailable) {
            logger.info(
              `🎯 Using sticky session account: ${mappedAccount.accountId} (${mappedAccount.accountType}) for session ${sessionHash}`
            )
            // 更新账户的最后使用时间
            await openaiAccountService.recordUsage(mappedAccount.accountId, 0)
            return mappedAccount
          } else {
            logger.warn(
              `⚠️ Mapped account ${mappedAccount.accountId} is no longer available, selecting new account`
            )
            await this._deleteSessionMapping(sessionHash)
          }
        }
      }

      // 获取所有可用账户
      const availableAccounts = await this._getAllAvailableAccounts(apiKeyData, requestedModel)

      if (availableAccounts.length === 0) {
        // 提供更详细的错误信息
        if (requestedModel) {
          throw new Error(
            `No available OpenAI accounts support the requested model: ${requestedModel}`
          )
        } else {
          throw new Error('No available OpenAI accounts')
        }
      }

      // 按优先级和调度策略排序（现在支持每个账户的自定义策略）
      // 优先级：API Key调度策略 > 系统默认策略
      const systemDefaultStrategy = await this._getSystemDefaultStrategy()
      const defaultStrategy = apiKeyData.schedulingStrategy || systemDefaultStrategy

      logger.info(
        `🎯 Using scheduling strategy for OpenAI API Key ${apiKeyData.name}: ${defaultStrategy} ${apiKeyData.schedulingStrategy ? '(from API Key config)' : '(system default)'}`
      )

      const sortedAccounts = await this._sortAccountsByPriorityAndStrategy(
        availableAccounts,
        defaultStrategy
      )

      // 选择第一个账户
      const selectedAccount = sortedAccounts[0]

      // 如果有会话哈希，建立新的映射
      if (sessionHash) {
        await this._setSessionMapping(
          sessionHash,
          selectedAccount.accountId,
          selectedAccount.accountType
        )
        logger.info(
          `🎯 Created new sticky session mapping: ${selectedAccount.name} (${selectedAccount.accountId}, ${selectedAccount.accountType}) for session ${sessionHash}`
        )
      }

      logger.info(
        `🎯 Selected account: ${selectedAccount.name} (${selectedAccount.accountId}, ${selectedAccount.accountType}) for API key ${apiKeyData.name}`
      )

      // 更新账户的最后使用时间
      await openaiAccountService.recordUsage(selectedAccount.accountId, 0)

      return {
        accountId: selectedAccount.accountId,
        accountType: selectedAccount.accountType
      }
    } catch (error) {
      logger.error('❌ Failed to select account for API key:', error)
      throw error
    }
  }

  // 📋 获取所有可用账户（仅共享池）
  async _getAllAvailableAccounts(apiKeyData, requestedModel = null) {
    const availableAccounts = []

    // 注意：专属账户的处理已经在 selectAccountForApiKey 中完成
    // 这里只处理共享池账户

    // 获取所有OpenAI账户（共享池）
    const openaiAccounts = await openaiAccountService.getAllAccounts()
    for (const account of openaiAccounts) {
      if (
        account.isActive === 'true' &&
        account.status !== 'error' &&
        (account.accountType === 'shared' || !account.accountType) && // 兼容旧数据
        this._isSchedulable(account.schedulable)
      ) {
        // 检查是否可调度

        // 检查token是否过期
        const isExpired = openaiAccountService.isTokenExpired(account)
        if (isExpired && !account.refreshToken) {
          logger.warn(
            `⚠️ OpenAI account ${account.name} token expired and no refresh token available`
          )
          continue
        }

        // 检查模型支持（仅在明确设置了supportedModels且不为空时才检查）
        // 如果没有设置supportedModels或为空数组，则支持所有模型
        if (requestedModel && account.supportedModels && account.supportedModels.length > 0) {
          const modelSupported = account.supportedModels.includes(requestedModel)
          if (!modelSupported) {
            logger.debug(
              `⏭️ Skipping OpenAI account ${account.name} - doesn't support model ${requestedModel}`
            )
            continue
          }
        }

        // 检查是否被限流
        const isRateLimited = await this.isAccountRateLimited(account.id)
        if (isRateLimited) {
          logger.debug(`⏭️ Skipping OpenAI account ${account.name} - rate limited`)
          continue
        }

        availableAccounts.push({
          ...account,
          accountId: account.id,
          accountType: 'openai',
          priority: parseInt(account.priority) || 50,
          lastUsedAt: account.lastUsedAt || '0',
          // 包含调度策略字段
          schedulingStrategy:
            account.schedulingStrategy || (await this._getSystemDefaultStrategy()),
          schedulingWeight: parseInt(account.schedulingWeight) || 1,
          sequentialOrder: parseInt(account.sequentialOrder) || 1,
          usageCount: parseInt(account.usageCount) || 0,
          lastScheduledAt: account.lastScheduledAt || ''
        })
      }
    }

    return availableAccounts
  }

  // 🔢 按优先级和最后使用时间排序账户（已废弃，改为与 Claude 保持一致，只按最后使用时间排序）
  // _sortAccountsByPriority(accounts) {
  //   return accounts.sort((a, b) => {
  //     // 首先按优先级排序（数字越小优先级越高）
  //     if (a.priority !== b.priority) {
  //       return a.priority - b.priority
  //     }

  //     // 优先级相同时，按最后使用时间排序（最久未使用的优先）
  //     const aLastUsed = new Date(a.lastUsedAt || 0).getTime()
  //     const bLastUsed = new Date(b.lastUsedAt || 0).getTime()
  //     return aLastUsed - bLastUsed
  //   })
  // }

  // 🔍 检查账户是否可用
  async _isAccountAvailable(accountId, accountType) {
    try {
      if (accountType === 'openai') {
        const account = await openaiAccountService.getAccount(accountId)
        if (!account || account.isActive !== 'true' || account.status === 'error') {
          return false
        }
        // 检查是否可调度
        if (!this._isSchedulable(account.schedulable)) {
          logger.info(`🚫 OpenAI account ${accountId} is not schedulable`)
          return false
        }
        return !(await this.isAccountRateLimited(accountId))
      }
      return false
    } catch (error) {
      logger.warn(`⚠️ Failed to check account availability: ${accountId}`, error)
      return false
    }
  }

  // 🔗 获取会话映射
  async _getSessionMapping(sessionHash) {
    const client = redis.getClientSafe()
    const mappingData = await client.get(`${this.SESSION_MAPPING_PREFIX}${sessionHash}`)

    if (mappingData) {
      try {
        return JSON.parse(mappingData)
      } catch (error) {
        logger.warn('⚠️ Failed to parse session mapping:', error)
        return null
      }
    }

    return null
  }

  // 💾 设置会话映射
  async _setSessionMapping(sessionHash, accountId, accountType) {
    const client = redis.getClientSafe()
    const mappingData = JSON.stringify({ accountId, accountType })

    // 设置1小时过期
    await client.setex(`${this.SESSION_MAPPING_PREFIX}${sessionHash}`, 3600, mappingData)
  }

  // 🗑️ 删除会话映射
  async _deleteSessionMapping(sessionHash) {
    const client = redis.getClientSafe()
    await client.del(`${this.SESSION_MAPPING_PREFIX}${sessionHash}`)
  }

  // 🚫 标记账户为限流状态
  async markAccountRateLimited(accountId, accountType, sessionHash = null) {
    try {
      if (accountType === 'openai') {
        await openaiAccountService.setAccountRateLimited(accountId, true)
      }

      // 删除会话映射
      if (sessionHash) {
        await this._deleteSessionMapping(sessionHash)
      }

      return { success: true }
    } catch (error) {
      logger.error(
        `❌ Failed to mark account as rate limited: ${accountId} (${accountType})`,
        error
      )
      throw error
    }
  }

  // ✅ 移除账户的限流状态
  async removeAccountRateLimit(accountId, accountType) {
    try {
      if (accountType === 'openai') {
        await openaiAccountService.setAccountRateLimited(accountId, false)
      }

      return { success: true }
    } catch (error) {
      logger.error(
        `❌ Failed to remove rate limit for account: ${accountId} (${accountType})`,
        error
      )
      throw error
    }
  }

  // 🔍 检查账户是否处于限流状态
  async isAccountRateLimited(accountId) {
    try {
      const account = await openaiAccountService.getAccount(accountId)
      if (!account) {
        return false
      }

      if (account.rateLimitStatus === 'limited' && account.rateLimitedAt) {
        const limitedAt = new Date(account.rateLimitedAt).getTime()
        const now = Date.now()
        const limitDuration = 60 * 60 * 1000 // 1小时

        return now < limitedAt + limitDuration
      }
      return false
    } catch (error) {
      logger.error(`❌ Failed to check rate limit status: ${accountId}`, error)
      return false
    }
  }

  // 👥 从分组中选择账户
  async selectAccountFromGroup(groupId, sessionHash = null, requestedModel = null) {
    try {
      // 获取分组信息
      const group = await accountGroupService.getGroup(groupId)
      if (!group) {
        throw new Error(`Group ${groupId} not found`)
      }

      if (group.platform !== 'openai') {
        throw new Error(`Group ${group.name} is not an OpenAI group`)
      }

      logger.info(`👥 Selecting account from OpenAI group: ${group.name}`)

      // 如果有会话哈希，检查是否有已映射的账户
      if (sessionHash) {
        const mappedAccount = await this._getSessionMapping(sessionHash)
        if (mappedAccount) {
          // 验证映射的账户是否仍然可用并且在分组中
          const isInGroup = await this._isAccountInGroup(mappedAccount.accountId, groupId)
          if (isInGroup) {
            const isAvailable = await this._isAccountAvailable(
              mappedAccount.accountId,
              mappedAccount.accountType
            )
            if (isAvailable) {
              logger.info(
                `🎯 Using sticky session account from group: ${mappedAccount.accountId} (${mappedAccount.accountType})`
              )
              // 更新账户的最后使用时间
              await openaiAccountService.recordUsage(mappedAccount.accountId, 0)
              return mappedAccount
            }
          }
          // 如果账户不可用或不在分组中，删除映射
          await this._deleteSessionMapping(sessionHash)
        }
      }

      // 获取分组成员
      const memberIds = await accountGroupService.getGroupMembers(groupId)
      if (memberIds.length === 0) {
        throw new Error(`Group ${group.name} has no members`)
      }

      // 获取可用的分组成员账户
      const availableAccounts = []
      for (const memberId of memberIds) {
        const account = await openaiAccountService.getAccount(memberId)
        if (
          account &&
          account.isActive === 'true' &&
          account.status !== 'error' &&
          this._isSchedulable(account.schedulable)
        ) {
          // 检查token是否过期
          const isExpired = openaiAccountService.isTokenExpired(account)
          if (isExpired && !account.refreshToken) {
            logger.warn(
              `⚠️ Group member OpenAI account ${account.name} token expired and no refresh token available`
            )
            continue
          }

          // 检查模型支持（仅在明确设置了supportedModels且不为空时才检查）
          // 如果没有设置supportedModels或为空数组，则支持所有模型
          if (requestedModel && account.supportedModels && account.supportedModels.length > 0) {
            const modelSupported = account.supportedModels.includes(requestedModel)
            if (!modelSupported) {
              logger.debug(
                `⏭️ Skipping group member OpenAI account ${account.name} - doesn't support model ${requestedModel}`
              )
              continue
            }
          }

          // 检查是否被限流
          const isRateLimited = await this.isAccountRateLimited(account.id)
          if (isRateLimited) {
            logger.debug(`⏭️ Skipping group member OpenAI account ${account.name} - rate limited`)
            continue
          }

          availableAccounts.push({
            ...account,
            accountId: account.id,
            accountType: 'openai',
            priority: parseInt(account.priority) || 50,
            lastUsedAt: account.lastUsedAt || '0',
            // 包含调度策略字段
            schedulingStrategy:
              account.schedulingStrategy || (await this._getSystemDefaultStrategy()),
            schedulingWeight: parseInt(account.schedulingWeight) || 1,
            sequentialOrder: parseInt(account.sequentialOrder) || 1,
            usageCount: parseInt(account.usageCount) || 0,
            lastScheduledAt: account.lastScheduledAt || ''
          })
        }
      }

      if (availableAccounts.length === 0) {
        throw new Error(`No available accounts in group ${group.name}`)
      }

      // 使用分组的调度策略，如果分组没有配置则使用系统默认策略
      const schedulingStrategy =
        group.schedulingStrategy || (await this._getSystemDefaultStrategy())
      logger.info(
        `🎯 Using scheduling strategy for OpenAI group ${group.name}: ${schedulingStrategy} ${group.schedulingStrategy ? '(from group config)' : '(system default)'}`
      )

      const sortedAccounts = await this._sortAccountsByPriorityAndStrategy(
        availableAccounts,
        schedulingStrategy
      )

      // 选择第一个账户
      const selectedAccount = sortedAccounts[0]

      // 如果有会话哈希，建立新的映射
      if (sessionHash) {
        await this._setSessionMapping(
          sessionHash,
          selectedAccount.accountId,
          selectedAccount.accountType
        )
        logger.info(
          `🎯 Created new sticky session mapping from group: ${selectedAccount.name} (${selectedAccount.accountId})`
        )
      }

      logger.info(
        `🎯 Selected account from group: ${selectedAccount.name} (${selectedAccount.accountId})`
      )

      // 更新账户的最后使用时间
      await openaiAccountService.recordUsage(selectedAccount.accountId, 0)

      return {
        accountId: selectedAccount.accountId,
        accountType: selectedAccount.accountType
      }
    } catch (error) {
      logger.error(`❌ Failed to select account from group ${groupId}:`, error)
      throw error
    }
  }

  // 🔍 检查账户是否在分组中
  async _isAccountInGroup(accountId, groupId) {
    const members = await accountGroupService.getGroupMembers(groupId)
    return members.includes(accountId)
  }

  // 📊 更新账户使用统计（用于调度算法）
  async updateAccountUsageStats(accountId, accountType) {
    try {
      // 调用相应服务的recordAccountUsage方法以正确更新调度字段
      if (accountType === 'openai') {
        await openaiAccountService.recordAccountUsage(accountId)
      }

      // 保持原有的统计逻辑用于调度器内部统计
      const client = redis.getClientSafe()
      const statsKey = `${this.USAGE_STATS_PREFIX}${accountType}:${accountId}`

      // 增加使用次数
      await client.incr(statsKey)
      // 设置过期时间为30天，避免统计数据无限增长
      await client.expire(statsKey, 30 * 24 * 60 * 60)

      logger.debug(`📊 Updated usage stats for OpenAI account ${accountId} (${accountType})`)
    } catch (error) {
      logger.warn('⚠️ Failed to update OpenAI account usage stats:', error)
    }
  }

  // 📊 更新账户最后使用时间
  async updateAccountLastUsed(accountId, accountType) {
    try {
      if (accountType === 'openai') {
        await openaiAccountService.updateAccount(accountId, {
          lastUsedAt: new Date().toISOString()
        })
      }
    } catch (error) {
      logger.warn(`⚠️ Failed to update last used time for account ${accountId}:`, error)
    }
  }

  // 🎯 按优先级和调度策略排序账户（支持个别账户的自定义策略）
  async _sortAccountsByPriorityAndStrategy(accounts, defaultStrategy = null) {
    // 如果没有提供默认策略，从系统配置获取
    if (!defaultStrategy) {
      defaultStrategy = await this._getSystemDefaultStrategy()
    }

    // 按优先级分组
    const groupsByPriority = {}
    for (const account of accounts) {
      const { priority } = account
      if (!groupsByPriority[priority]) {
        groupsByPriority[priority] = []
      }
      groupsByPriority[priority].push(account)
    }

    // 按优先级排序（数字越小优先级越高）
    const sortedPriorities = Object.keys(groupsByPriority).sort((a, b) => parseInt(a) - parseInt(b))

    const sortedAccounts = []

    // 对每个优先级组应用调度策略（支持账户级别的策略）
    for (const priority of sortedPriorities) {
      const priorityAccounts = groupsByPriority[priority]

      // 检查这个优先级组的账户是否有统一的调度策略
      const strategies = priorityAccounts.map((acc) => acc.schedulingStrategy || defaultStrategy)
      const uniqueStrategies = [...new Set(strategies)]

      if (uniqueStrategies.length === 1) {
        // 所有账户使用同一策略，可以统一处理
        const strategy = uniqueStrategies[0]
        logger.info(
          `🎯 Applying ${strategy} strategy to ${priorityAccounts.length} OpenAI accounts with priority ${priority}`
        )

        try {
          const strategyAccounts = await this._applySchedulingStrategy(
            priorityAccounts,
            strategy,
            priority
          )
          sortedAccounts.push(...strategyAccounts)
        } catch (error) {
          logger.error(`❌ Failed to apply strategy ${strategy} for priority ${priority}:`, error)
          // 回退到默认策略
          const fallbackAccounts = await this._applySchedulingStrategy(
            priorityAccounts,
            'least_recent',
            priority
          )
          sortedAccounts.push(...fallbackAccounts)
        }
      } else {
        // 账户使用不同策略，需要分组处理
        logger.info(
          `🎯 Mixed strategies in OpenAI priority ${priority}: ${uniqueStrategies.join(', ')}, applying account-level strategies`
        )

        const strategyGroups = {}
        for (const account of priorityAccounts) {
          const strategy = account.schedulingStrategy || defaultStrategy
          if (!strategyGroups[strategy]) {
            strategyGroups[strategy] = []
          }
          strategyGroups[strategy].push(account)
        }

        // 对每个策略组分别处理，然后合并结果
        const strategyResults = []
        for (const [strategy, strategyAccounts] of Object.entries(strategyGroups)) {
          try {
            const processedAccounts = await this._applySchedulingStrategy(
              strategyAccounts,
              strategy,
              priority
            )
            strategyResults.push({
              strategy,
              accounts: processedAccounts,
              weight: strategyAccounts.length
            })
          } catch (error) {
            logger.error(`❌ Failed to apply strategy ${strategy}:`, error)
            const fallbackAccounts = await this._applySchedulingStrategy(
              strategyAccounts,
              'least_recent',
              priority
            )
            strategyResults.push({
              strategy: 'least_recent',
              accounts: fallbackAccounts,
              weight: strategyAccounts.length
            })
          }
        }

        // 按权重（账户数量）排序策略组，账户多的策略优先
        strategyResults.sort((a, b) => b.weight - a.weight)

        // 合并结果（权重高的策略组的第一个账户优先）
        const maxLength = Math.max(...strategyResults.map((r) => r.accounts.length))
        for (let i = 0; i < maxLength; i++) {
          for (const result of strategyResults) {
            if (i < result.accounts.length) {
              sortedAccounts.push(result.accounts[i])
            }
          }
        }
      }
    }

    return sortedAccounts
  }

  // 🎯 应用调度策略（完整版本，支持所有策略）
  async _applySchedulingStrategy(accounts, strategy, priority = null) {
    if (!this.SUPPORTED_STRATEGIES.includes(strategy)) {
      logger.warn(`⚠️ Unknown OpenAI scheduling strategy: ${strategy}, using least_recent`)
      strategy = 'least_recent'
    }

    switch (strategy) {
      case 'round_robin':
        return await this._roundRobinStrategy(accounts, priority)
      case 'least_used':
        return await this._leastUsedStrategy(accounts)
      case 'least_recent':
        return this._leastRecentStrategy(accounts)
      case 'random':
        return this._randomStrategy(accounts)
      case 'weighted_random':
        return this._weightedRandomStrategy(accounts)
      case 'sequential':
        return await this._sequentialStrategy(accounts, priority)
      default:
        logger.warn(`⚠️ Unknown strategy: ${strategy}, using least_recent`)
        return this._leastRecentStrategy(accounts)
    }
  }

  // 🔄 轮询调度策略
  async _roundRobinStrategy(accounts, priority = null) {
    try {
      const client = redis.getClientSafe()

      // 为每个优先级组使用独立的轮询键
      const roundRobinKey =
        priority !== null ? `${this.ROUND_ROBIN_KEY}:priority:${priority}` : this.ROUND_ROBIN_KEY

      // 获取当前轮询索引
      let currentIndex = await client.get(roundRobinKey)
      currentIndex = parseInt(currentIndex) || 0

      // 确保索引在有效范围内
      const selectedIndex = currentIndex % accounts.length

      // 更新索引为下一位置
      const nextIndex = (currentIndex + 1) % accounts.length
      await client.set(roundRobinKey, nextIndex)

      // 将选中的账户移到首位
      const selectedAccount = accounts[selectedIndex]
      const reorderedAccounts = [selectedAccount, ...accounts.filter((_, i) => i !== selectedIndex)]

      logger.info(
        `🔄 OpenAI round robin selected index ${selectedIndex}: ${selectedAccount.name} (${selectedAccount.accountId})`
      )

      return reorderedAccounts
    } catch (error) {
      logger.error('❌ OpenAI round robin strategy failed:', error)
      return this._leastRecentStrategy(accounts)
    }
  }

  // 📊 最少使用调度策略
  async _leastUsedStrategy(accounts) {
    try {
      // 获取所有账户的使用统计
      const accountsWithUsage = await Promise.all(
        accounts.map(async (account) => {
          const usageCount = await this.getAccountUsageCount(account.accountId)
          return {
            ...account,
            usageCount
          }
        })
      )

      // 按使用次数排序（最少使用的优先）
      const sortedAccounts = accountsWithUsage.sort((a, b) => {
        if (a.usageCount !== b.usageCount) {
          return a.usageCount - b.usageCount
        }
        // 使用次数相同时，按最后使用时间排序
        const aLastUsed = new Date(a.lastUsedAt || 0).getTime()
        const bLastUsed = new Date(b.lastUsedAt || 0).getTime()
        return aLastUsed - bLastUsed
      })

      logger.info(
        `📊 OpenAI least used selected: ${sortedAccounts[0].name} (usage: ${sortedAccounts[0].usageCount})`
      )

      return sortedAccounts
    } catch (error) {
      logger.error('❌ OpenAI least used strategy failed:', error)
      return this._leastRecentStrategy(accounts)
    }
  }

  // ⏰ 最近最少使用调度策略（默认策略）
  _leastRecentStrategy(accounts) {
    const sortedAccounts = accounts.sort((a, b) => {
      const aLastUsed = new Date(a.lastUsedAt || 0).getTime()
      const bLastUsed = new Date(b.lastUsedAt || 0).getTime()
      return aLastUsed - bLastUsed
    })

    logger.info(
      `⏰ OpenAI least recent selected: ${sortedAccounts[0].name} (last used: ${sortedAccounts[0].lastUsedAt || 'never'})`
    )

    return sortedAccounts
  }

  // 🎲 随机调度策略
  _randomStrategy(accounts) {
    const shuffledAccounts = [...accounts]

    // Fisher-Yates shuffle algorithm
    for (let i = shuffledAccounts.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffledAccounts[i], shuffledAccounts[j]] = [shuffledAccounts[j], shuffledAccounts[i]]
    }

    logger.info(
      `🎲 OpenAI random selected: ${shuffledAccounts[0].name} (${shuffledAccounts[0].accountId})`
    )

    return shuffledAccounts
  }

  // ⚖️ 加权随机调度策略
  _weightedRandomStrategy(accounts) {
    try {
      // 为每个账户分配权重（schedulingWeight 字段，默认为1）
      const accountsWithWeight = accounts.map((account) => ({
        ...account,
        weight: parseFloat(account.schedulingWeight) || 1.0
      }))

      // 计算总权重
      const totalWeight = accountsWithWeight.reduce((sum, account) => sum + account.weight, 0)

      // 生成随机数
      let random = Math.random() * totalWeight

      // 根据权重选择账户
      for (let i = 0; i < accountsWithWeight.length; i++) {
        random -= accountsWithWeight[i].weight
        if (random <= 0) {
          const selectedAccount = accountsWithWeight[i]
          // 将选中的账户移到首位
          const reorderedAccounts = [
            selectedAccount,
            ...accountsWithWeight.filter((_, idx) => idx !== i)
          ]

          logger.info(
            `⚖️ OpenAI weighted random selected: ${selectedAccount.name} (weight: ${selectedAccount.weight})`
          )

          return reorderedAccounts
        }
      }

      // 如果没有选中（不应该发生），返回第一个
      logger.info(`⚖️ OpenAI weighted random fallback to first: ${accountsWithWeight[0].name}`)
      return accountsWithWeight
    } catch (error) {
      logger.error('❌ OpenAI weighted random strategy failed:', error)
      return this._randomStrategy(accounts)
    }
  }

  // 🔢 顺序调度策略
  async _sequentialStrategy(accounts, priority = null) {
    try {
      // 按 sequentialOrder 字段排序
      const sortedByOrder = accounts.sort((a, b) => {
        const aOrder = parseInt(a.sequentialOrder) || Number.MAX_SAFE_INTEGER
        const bOrder = parseInt(b.sequentialOrder) || Number.MAX_SAFE_INTEGER

        if (aOrder !== bOrder) {
          return aOrder - bOrder
        }

        // sequentialOrder 相同时，按账户ID排序保证一致性
        return a.accountId.localeCompare(b.accountId)
      })

      const client = redis.getClientSafe()

      // 为每个优先级组使用独立的顺序键
      const sequentialKey =
        priority !== null ? `${this.SEQUENTIAL_KEY}:priority:${priority}` : this.SEQUENTIAL_KEY

      // 获取当前位置
      let currentPosition = await client.get(sequentialKey)
      currentPosition = parseInt(currentPosition) || 0

      // 确保位置在有效范围内
      const selectedIndex = currentPosition % sortedByOrder.length

      // 更新位置为下一个
      const nextPosition = (currentPosition + 1) % sortedByOrder.length
      await client.set(sequentialKey, nextPosition)

      // 将选中的账户移到首位
      const selectedAccount = sortedByOrder[selectedIndex]
      const reorderedAccounts = [
        selectedAccount,
        ...sortedByOrder.filter((_, i) => i !== selectedIndex)
      ]

      logger.info(
        `🔢 OpenAI sequential selected position ${selectedIndex}: ${selectedAccount.name} (order: ${selectedAccount.sequentialOrder || 'undefined'})`
      )

      return reorderedAccounts
    } catch (error) {
      logger.error('❌ OpenAI sequential strategy failed:', error)
      return this._leastRecentStrategy(accounts)
    }
  }

  // 📈 获取账户使用统计
  async getAccountUsageCount(accountId) {
    try {
      const client = redis.getClientSafe()
      const statsKey = `${this.USAGE_STATS_PREFIX}${accountId}`
      const count = await client.get(statsKey)
      return parseInt(count) || 0
    } catch (error) {
      logger.warn('⚠️ Failed to get OpenAI account usage stats:', error)
      return 0
    }
  }

  // 🎯 应用调度策略 (旧版本，保持向后兼容)
  _applySortingStrategy(accounts, strategy) {
    logger.debug(`🎯 Applying OpenAI sorting strategy: ${strategy}`)

    if (strategy !== 'least_recent') {
      logger.warn(
        `⚠️ Using legacy sorting method. Strategy '${strategy}' will fallback to 'least_recent'. Consider using the new _sortAccountsByPriorityAndStrategy method.`
      )
    }

    // 为了保持向后兼容，保留原有的简单实现
    return accounts.sort((a, b) => {
      const aLastUsed = new Date(a.lastUsedAt || 0).getTime()
      const bLastUsed = new Date(b.lastUsedAt || 0).getTime()
      return aLastUsed - bLastUsed // 最久未使用的优先
    })
  }
}

module.exports = new UnifiedOpenAIScheduler()
