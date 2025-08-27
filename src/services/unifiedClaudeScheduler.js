const claudeAccountService = require('./claudeAccountService')
const claudeConsoleAccountService = require('./claudeConsoleAccountService')
const bedrockAccountService = require('./bedrockAccountService')
const geminiAccountService = require('./geminiAccountService')
const openaiAccountService = require('./openaiAccountService')
const azureOpenaiAccountService = require('./azureOpenaiAccountService')
const accountGroupService = require('./accountGroupService')
const database = require('../models/database')
const logger = require('../utils/logger')
const config = require('../../config/config')

class UnifiedClaudeScheduler {
  constructor() {
    this.SESSION_MAPPING_PREFIX = 'unified_claude_session_mapping:'
    this.ROUND_ROBIN_KEY = 'scheduler:round_robin:index'
    this.SEQUENTIAL_KEY = 'scheduler:sequential:position'
    this.USAGE_STATS_PREFIX = 'scheduler:usage_stats:'

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

  // 🔧 辅助方法：检查账户是否可调度（兼容字符串和布尔值）
  _isSchedulable(schedulable) {
    // 如果是 undefined 或 null，默认为可调度
    if (schedulable === undefined || schedulable === null) {
      return true
    }
    // 明确设置为 false（布尔值）或 'false'（字符串）时不可调度
    return schedulable !== false && schedulable !== 'false'
  }

  // 🎯 获取系统默认调度策略
  async _getSystemDefaultStrategy() {
    try {
      // 首先尝试从Redis获取动态配置
      const systemConfig = await database.getSystemSchedulingConfig()
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

  // 🎯 统一调度Claude账号（官方和Console）
  async selectAccountForApiKey(apiKeyData, sessionHash = null, requestedModel = null) {
    try {
      // 如果API Key绑定了专属账户或分组，优先使用
      if (apiKeyData.claudeAccountId) {
        // 检查是否是分组
        if (apiKeyData.claudeAccountId.startsWith('group:')) {
          const groupId = apiKeyData.claudeAccountId.replace('group:', '')
          logger.info(
            `🎯 API key ${apiKeyData.name} is bound to group ${groupId}, selecting from group`
          )
          return await this.selectAccountFromGroup(groupId, sessionHash, requestedModel)
        }

        // 普通专属账户
        const boundAccount = await database.getClaudeAccount(apiKeyData.claudeAccountId)
        if (boundAccount && boundAccount.isActive === 'true' && boundAccount.status !== 'error') {
          logger.info(
            `🎯 Using bound dedicated Claude OAuth account: ${boundAccount.name} (${apiKeyData.claudeAccountId}) for API key ${apiKeyData.name}`
          )
          return {
            accountId: apiKeyData.claudeAccountId,
            accountType: 'claude-official'
          }
        } else {
          logger.warn(
            `⚠️ Bound Claude OAuth account ${apiKeyData.claudeAccountId} is not available, falling back to pool`
          )
        }
      }

      // 2. 检查Claude Console账户绑定
      if (apiKeyData.claudeConsoleAccountId) {
        const boundConsoleAccount = await claudeConsoleAccountService.getAccount(
          apiKeyData.claudeConsoleAccountId
        )
        if (
          boundConsoleAccount &&
          boundConsoleAccount.isActive === true &&
          boundConsoleAccount.status === 'active'
        ) {
          logger.info(
            `🎯 Using bound dedicated Claude Console account: ${boundConsoleAccount.name} (${apiKeyData.claudeConsoleAccountId}) for API key ${apiKeyData.name}`
          )
          return {
            accountId: apiKeyData.claudeConsoleAccountId,
            accountType: 'claude-console'
          }
        } else {
          logger.warn(
            `⚠️ Bound Claude Console account ${apiKeyData.claudeConsoleAccountId} is not available, falling back to pool`
          )
        }
      }

      // 3. 检查Bedrock账户绑定
      if (apiKeyData.bedrockAccountId) {
        const boundBedrockAccountResult = await bedrockAccountService.getAccount(
          apiKeyData.bedrockAccountId
        )
        if (boundBedrockAccountResult.success && boundBedrockAccountResult.data.isActive === true) {
          logger.info(
            `🎯 Using bound dedicated Bedrock account: ${boundBedrockAccountResult.data.name} (${apiKeyData.bedrockAccountId}) for API key ${apiKeyData.name}`
          )
          return {
            accountId: apiKeyData.bedrockAccountId,
            accountType: 'bedrock'
          }
        } else {
          logger.warn(
            `⚠️ Bound Bedrock account ${apiKeyData.bedrockAccountId} is not available, falling back to pool`
          )
        }
      }

      // 4. 检查Gemini账户绑定
      if (apiKeyData.geminiAccountId) {
        const boundGeminiAccount = await geminiAccountService.getAccount(apiKeyData.geminiAccountId)
        if (boundGeminiAccount && boundGeminiAccount.isActive === true) {
          logger.info(
            `🎯 Using bound dedicated Gemini account: ${boundGeminiAccount.name} (${apiKeyData.geminiAccountId}) for API key ${apiKeyData.name}`
          )
          return {
            accountId: apiKeyData.geminiAccountId,
            accountType: 'gemini'
          }
        } else {
          logger.warn(
            `⚠️ Bound Gemini account ${apiKeyData.geminiAccountId} is not available, falling back to pool`
          )
        }
      }

      // 5. 检查OpenAI账户绑定
      if (apiKeyData.openaiAccountId) {
        const boundOpenAIAccountResult = await openaiAccountService.getAccount(
          apiKeyData.openaiAccountId
        )
        if (boundOpenAIAccountResult.success && boundOpenAIAccountResult.data.isActive === true) {
          logger.info(
            `🎯 Using bound dedicated OpenAI account: ${boundOpenAIAccountResult.data.name} (${apiKeyData.openaiAccountId}) for API key ${apiKeyData.name}`
          )
          return {
            accountId: apiKeyData.openaiAccountId,
            accountType: 'openai'
          }
        } else {
          logger.warn(
            `⚠️ Bound OpenAI account ${apiKeyData.openaiAccountId} is not available, falling back to pool`
          )
        }
      }

      // 6. 检查Azure OpenAI账户绑定
      if (apiKeyData.azureOpenaiAccountId) {
        const boundAzureOpenAIAccountResult = await azureOpenaiAccountService.getAccount(
          apiKeyData.azureOpenaiAccountId
        )
        if (
          boundAzureOpenAIAccountResult.success &&
          boundAzureOpenAIAccountResult.data.isActive === true
        ) {
          logger.info(
            `🎯 Using bound dedicated Azure OpenAI account: ${boundAzureOpenAIAccountResult.data.name} (${apiKeyData.azureOpenaiAccountId}) for API key ${apiKeyData.name}`
          )
          return {
            accountId: apiKeyData.azureOpenaiAccountId,
            accountType: 'azure-openai'
          }
        } else {
          logger.warn(
            `⚠️ Bound Azure OpenAI account ${apiKeyData.azureOpenaiAccountId} is not available, falling back to pool`
          )
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
            return mappedAccount
          } else {
            logger.warn(
              `⚠️ Mapped account ${mappedAccount.accountId} is no longer available, selecting new account`
            )
            await this._deleteSessionMapping(sessionHash)
          }
        }
      }

      // 获取所有可用账户（传递请求的模型进行过滤）
      const availableAccounts = await this._getAllAvailableAccounts(apiKeyData, requestedModel)

      if (availableAccounts.length === 0) {
        // 提供更详细的错误信息
        if (requestedModel) {
          throw new Error(
            `No available Claude accounts support the requested model: ${requestedModel}`
          )
        } else {
          throw new Error('No available Claude accounts (neither official nor console)')
        }
      }

      // 按优先级和调度策略排序（现在每个账户可以有自己的调度策略）
      // 优先级：API Key调度策略 > 系统默认策略
      const systemDefaultStrategy = await this._getSystemDefaultStrategy()
      const defaultStrategy = apiKeyData.schedulingStrategy || systemDefaultStrategy

      logger.info(
        `🎯 Using scheduling strategy for API Key ${apiKeyData.name}: ${defaultStrategy} ${apiKeyData.schedulingStrategy ? '(from API Key config)' : '(system default)'}`
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

      // 更新使用统计
      await this.updateAccountUsageStats(selectedAccount.accountId, selectedAccount.accountType)

      logger.info(
        `🎯 Selected account: ${selectedAccount.name} (${selectedAccount.accountId}, ${selectedAccount.accountType}) with priority ${selectedAccount.priority} using strategy ${selectedAccount.schedulingStrategy || defaultStrategy} for API key ${apiKeyData.name}`
      )

      return {
        accountId: selectedAccount.accountId,
        accountType: selectedAccount.accountType
      }
    } catch (error) {
      logger.error('❌ Failed to select account for API key:', error)
      throw error
    }
  }

  // 📋 获取所有可用账户（合并官方和Console）
  async _getAllAvailableAccounts(apiKeyData, requestedModel = null) {
    const availableAccounts = []

    // 如果API Key绑定了专属账户，优先返回
    // 1. 检查Claude OAuth账户绑定
    if (apiKeyData.claudeAccountId) {
      const boundAccount = await database.getClaudeAccount(apiKeyData.claudeAccountId)
      if (
        boundAccount &&
        boundAccount.isActive === 'true' &&
        boundAccount.status !== 'error' &&
        boundAccount.status !== 'blocked'
      ) {
        const isRateLimited = await claudeAccountService.isAccountRateLimited(boundAccount.id)
        if (!isRateLimited) {
          logger.info(
            `🎯 Using bound dedicated Claude OAuth account: ${boundAccount.name} (${apiKeyData.claudeAccountId})`
          )
          return [
            {
              ...boundAccount,
              accountId: boundAccount.id,
              accountType: 'claude-official',
              priority: parseInt(boundAccount.priority) || 50,
              lastUsedAt: boundAccount.lastUsedAt || '0',
              // 包含调度策略字段
              schedulingStrategy:
                boundAccount.schedulingStrategy || (await this._getSystemDefaultStrategy()),
              schedulingWeight: parseInt(boundAccount.schedulingWeight) || 1,
              sequentialOrder: parseInt(boundAccount.sequentialOrder) || 1,
              usageCount: parseInt(boundAccount.usageCount) || 0,
              lastScheduledAt: boundAccount.lastScheduledAt || ''
            }
          ]
        }
      } else {
        logger.warn(`⚠️ Bound Claude OAuth account ${apiKeyData.claudeAccountId} is not available`)
      }
    }

    // 2. 检查Claude Console账户绑定
    if (apiKeyData.claudeConsoleAccountId) {
      const boundConsoleAccount = await claudeConsoleAccountService.getAccount(
        apiKeyData.claudeConsoleAccountId
      )
      if (
        boundConsoleAccount &&
        boundConsoleAccount.isActive === true &&
        boundConsoleAccount.status === 'active'
      ) {
        const isRateLimited = await claudeConsoleAccountService.isAccountRateLimited(
          boundConsoleAccount.id
        )
        if (!isRateLimited) {
          logger.info(
            `🎯 Using bound dedicated Claude Console account: ${boundConsoleAccount.name} (${apiKeyData.claudeConsoleAccountId})`
          )
          return [
            {
              ...boundConsoleAccount,
              accountId: boundConsoleAccount.id,
              accountType: 'claude-console',
              priority: parseInt(boundConsoleAccount.priority) || 50,
              lastUsedAt: boundConsoleAccount.lastUsedAt || '0',
              // 包含调度策略字段
              schedulingStrategy:
                boundConsoleAccount.schedulingStrategy || (await this._getSystemDefaultStrategy()),
              schedulingWeight: parseInt(boundConsoleAccount.schedulingWeight) || 1,
              sequentialOrder: parseInt(boundConsoleAccount.sequentialOrder) || 1,
              usageCount: parseInt(boundConsoleAccount.usageCount) || 0,
              lastScheduledAt: boundConsoleAccount.lastScheduledAt || ''
            }
          ]
        }
      } else {
        logger.warn(
          `⚠️ Bound Claude Console account ${apiKeyData.claudeConsoleAccountId} is not available`
        )
      }
    }

    // 3. 检查Bedrock账户绑定
    if (apiKeyData.bedrockAccountId) {
      const boundBedrockAccountResult = await bedrockAccountService.getAccount(
        apiKeyData.bedrockAccountId
      )
      if (boundBedrockAccountResult.success && boundBedrockAccountResult.data.isActive === true) {
        logger.info(
          `🎯 Using bound dedicated Bedrock account: ${boundBedrockAccountResult.data.name} (${apiKeyData.bedrockAccountId})`
        )
        return [
          {
            ...boundBedrockAccountResult.data,
            accountId: boundBedrockAccountResult.data.id,
            accountType: 'bedrock',
            priority: parseInt(boundBedrockAccountResult.data.priority) || 50,
            lastUsedAt: boundBedrockAccountResult.data.lastUsedAt || '0',
            // 包含调度策略字段
            schedulingStrategy:
              boundBedrockAccountResult.data.schedulingStrategy ||
              (await this._getSystemDefaultStrategy()),
            schedulingWeight: parseInt(boundBedrockAccountResult.data.schedulingWeight) || 1,
            sequentialOrder: parseInt(boundBedrockAccountResult.data.sequentialOrder) || 1,
            usageCount: parseInt(boundBedrockAccountResult.data.usageCount) || 0,
            lastScheduledAt: boundBedrockAccountResult.data.lastScheduledAt || ''
          }
        ]
      } else {
        logger.warn(`⚠️ Bound Bedrock account ${apiKeyData.bedrockAccountId} is not available`)
      }
    }

    // 4. 检查Gemini账户绑定
    if (apiKeyData.geminiAccountId) {
      const boundGeminiAccount = await geminiAccountService.getAccount(apiKeyData.geminiAccountId)
      if (boundGeminiAccount && boundGeminiAccount.isActive === true) {
        logger.info(
          `🎯 Using bound dedicated Gemini account: ${boundGeminiAccount.name} (${apiKeyData.geminiAccountId})`
        )
        return [
          {
            ...boundGeminiAccount,
            accountId: boundGeminiAccount.id,
            accountType: 'gemini',
            priority: parseInt(boundGeminiAccount.priority) || 50,
            lastUsedAt: boundGeminiAccount.lastUsedAt || '0',
            // 包含调度策略字段
            schedulingStrategy:
              boundGeminiAccount.schedulingStrategy || (await this._getSystemDefaultStrategy()),
            schedulingWeight: parseInt(boundGeminiAccount.schedulingWeight) || 1,
            sequentialOrder: parseInt(boundGeminiAccount.sequentialOrder) || 1,
            usageCount: parseInt(boundGeminiAccount.usageCount) || 0,
            lastScheduledAt: boundGeminiAccount.lastScheduledAt || ''
          }
        ]
      } else {
        logger.warn(`⚠️ Bound Gemini account ${apiKeyData.geminiAccountId} is not available`)
      }
    }

    // 5. 检查OpenAI账户绑定
    if (apiKeyData.openaiAccountId) {
      const boundOpenAIAccountResult = await openaiAccountService.getAccount(
        apiKeyData.openaiAccountId
      )
      if (boundOpenAIAccountResult.success && boundOpenAIAccountResult.data.isActive === true) {
        logger.info(
          `🎯 Using bound dedicated OpenAI account: ${boundOpenAIAccountResult.data.name} (${apiKeyData.openaiAccountId})`
        )
        return [
          {
            ...boundOpenAIAccountResult.data,
            accountId: boundOpenAIAccountResult.data.id,
            accountType: 'openai',
            priority: parseInt(boundOpenAIAccountResult.data.priority) || 50,
            lastUsedAt: boundOpenAIAccountResult.data.lastUsedAt || '0',
            // 包含调度策略字段
            schedulingStrategy:
              boundOpenAIAccountResult.data.schedulingStrategy ||
              (await this._getSystemDefaultStrategy()),
            schedulingWeight: parseInt(boundOpenAIAccountResult.data.schedulingWeight) || 1,
            sequentialOrder: parseInt(boundOpenAIAccountResult.data.sequentialOrder) || 1,
            usageCount: parseInt(boundOpenAIAccountResult.data.usageCount) || 0,
            lastScheduledAt: boundOpenAIAccountResult.data.lastScheduledAt || ''
          }
        ]
      } else {
        logger.warn(`⚠️ Bound OpenAI account ${apiKeyData.openaiAccountId} is not available`)
      }
    }

    // 6. 检查Azure OpenAI账户绑定
    if (apiKeyData.azureOpenaiAccountId) {
      const boundAzureOpenAIAccountResult = await azureOpenaiAccountService.getAccount(
        apiKeyData.azureOpenaiAccountId
      )
      if (
        boundAzureOpenAIAccountResult.success &&
        boundAzureOpenAIAccountResult.data.isActive === true
      ) {
        logger.info(
          `🎯 Using bound dedicated Azure OpenAI account: ${boundAzureOpenAIAccountResult.data.name} (${apiKeyData.azureOpenaiAccountId})`
        )
        return [
          {
            ...boundAzureOpenAIAccountResult.data,
            accountId: boundAzureOpenAIAccountResult.data.id,
            accountType: 'azure-openai',
            priority: parseInt(boundAzureOpenAIAccountResult.data.priority) || 50,
            lastUsedAt: boundAzureOpenAIAccountResult.data.lastUsedAt || '0',
            // 包含调度策略字段
            schedulingStrategy:
              boundAzureOpenAIAccountResult.data.schedulingStrategy ||
              (await this._getSystemDefaultStrategy()),
            schedulingWeight: parseInt(boundAzureOpenAIAccountResult.data.schedulingWeight) || 1,
            sequentialOrder: parseInt(boundAzureOpenAIAccountResult.data.sequentialOrder) || 1,
            usageCount: parseInt(boundAzureOpenAIAccountResult.data.usageCount) || 0,
            lastScheduledAt: boundAzureOpenAIAccountResult.data.lastScheduledAt || ''
          }
        ]
      } else {
        logger.warn(
          `⚠️ Bound Azure OpenAI account ${apiKeyData.azureOpenaiAccountId} is not available`
        )
      }
    }

    // 获取官方Claude账户（共享池）
    const claudeAccounts = await database.getAllClaudeAccounts()
    for (const account of claudeAccounts) {
      if (
        account.isActive === 'true' &&
        account.status !== 'error' &&
        account.status !== 'blocked' &&
        (account.accountType === 'shared' || !account.accountType) && // 兼容旧数据
        this._isSchedulable(account.schedulable)
      ) {
        // 检查是否可调度

        // 检查模型支持（如果请求的是 Opus 模型）
        if (requestedModel && requestedModel.toLowerCase().includes('opus')) {
          // 检查账号的订阅信息
          if (account.subscriptionInfo) {
            try {
              const info =
                typeof account.subscriptionInfo === 'string'
                  ? JSON.parse(account.subscriptionInfo)
                  : account.subscriptionInfo

              // Pro 和 Free 账号不支持 Opus
              if (info.hasClaudePro === true && info.hasClaudeMax !== true) {
                logger.info(`🚫 Claude account ${account.name} (Pro) does not support Opus model`)
                continue // Claude Pro 不支持 Opus
              }
              if (info.accountType === 'claude_pro' || info.accountType === 'claude_free') {
                logger.info(
                  `🚫 Claude account ${account.name} (${info.accountType}) does not support Opus model`
                )
                continue // 明确标记为 Pro 或 Free 的账号不支持
              }
            } catch (e) {
              // 解析失败，假设为旧数据，默认支持（兼容旧数据为 Max）
              logger.debug(`Account ${account.name} has invalid subscriptionInfo, assuming Max`)
            }
          }
          // 没有订阅信息的账号，默认当作支持（兼容旧数据）
        }

        // 检查是否被限流
        const isRateLimited = await claudeAccountService.isAccountRateLimited(account.id)
        if (!isRateLimited) {
          availableAccounts.push({
            ...account,
            accountId: account.id,
            accountType: 'claude-official',
            priority: parseInt(account.priority) || 50, // 默认优先级50
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
    }

    // 获取Claude Console账户
    const consoleAccounts = await claudeConsoleAccountService.getAllAccounts()
    logger.info(`📋 Found ${consoleAccounts.length} total Claude Console accounts`)

    for (const account of consoleAccounts) {
      logger.info(
        `🔍 Checking Claude Console account: ${account.name} - isActive: ${account.isActive}, status: ${account.status}, accountType: ${account.accountType}, schedulable: ${account.schedulable}`
      )

      // 注意：getAllAccounts返回的isActive是布尔值
      if (
        account.isActive === true &&
        account.status === 'active' &&
        account.accountType === 'shared' &&
        this._isSchedulable(account.schedulable)
      ) {
        // 检查是否可调度

        // 检查模型支持（如果有请求的模型）
        if (requestedModel && account.supportedModels) {
          // 兼容旧格式（数组）和新格式（对象）
          if (Array.isArray(account.supportedModels)) {
            // 旧格式：数组
            if (
              account.supportedModels.length > 0 &&
              !account.supportedModels.includes(requestedModel)
            ) {
              logger.info(
                `🚫 Claude Console account ${account.name} does not support model ${requestedModel}`
              )
              continue
            }
          } else if (typeof account.supportedModels === 'object') {
            // 新格式：映射表
            if (
              Object.keys(account.supportedModels).length > 0 &&
              !claudeConsoleAccountService.isModelSupported(account.supportedModels, requestedModel)
            ) {
              logger.info(
                `🚫 Claude Console account ${account.name} does not support model ${requestedModel}`
              )
              continue
            }
          }
        }

        // 检查是否被限流
        const isRateLimited = await claudeConsoleAccountService.isAccountRateLimited(account.id)
        if (!isRateLimited) {
          availableAccounts.push({
            ...account,
            accountId: account.id,
            accountType: 'claude-console',
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
          logger.info(
            `✅ Added Claude Console account to available pool: ${account.name} (priority: ${account.priority})`
          )
        } else {
          logger.warn(`⚠️ Claude Console account ${account.name} is rate limited`)
        }
      } else {
        logger.info(
          `❌ Claude Console account ${account.name} not eligible - isActive: ${account.isActive}, status: ${account.status}, accountType: ${account.accountType}, schedulable: ${account.schedulable}`
        )
      }
    }

    // 获取Bedrock账户（共享池）
    const bedrockAccountsResult = await bedrockAccountService.getAllAccounts()
    if (bedrockAccountsResult.success) {
      const bedrockAccounts = bedrockAccountsResult.data
      logger.info(`📋 Found ${bedrockAccounts.length} total Bedrock accounts`)

      for (const account of bedrockAccounts) {
        logger.info(
          `🔍 Checking Bedrock account: ${account.name} - isActive: ${account.isActive}, accountType: ${account.accountType}, schedulable: ${account.schedulable}`
        )

        if (
          account.isActive === true &&
          account.accountType === 'shared' &&
          this._isSchedulable(account.schedulable)
        ) {
          // 检查是否可调度

          availableAccounts.push({
            ...account,
            accountId: account.id,
            accountType: 'bedrock',
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
          logger.info(
            `✅ Added Bedrock account to available pool: ${account.name} (priority: ${account.priority})`
          )
        } else {
          logger.info(
            `❌ Bedrock account ${account.name} not eligible - isActive: ${account.isActive}, accountType: ${account.accountType}, schedulable: ${account.schedulable}`
          )
        }
      }
    }

    // 获取Gemini账户（共享池）
    const geminiAccountsResult = await geminiAccountService.getAllAccounts()
    if (geminiAccountsResult.success) {
      const geminiAccounts = geminiAccountsResult.data
      logger.info(`📋 Found ${geminiAccounts.length} total Gemini accounts`)

      for (const account of geminiAccounts) {
        logger.info(
          `🔍 Checking Gemini account: ${account.name} - isActive: ${account.isActive}, accountType: ${account.accountType}, schedulable: ${account.schedulable}`
        )

        if (
          account.isActive === true &&
          account.accountType === 'shared' &&
          this._isSchedulable(account.schedulable)
        ) {
          // 检查是否被限流（如果Gemini支持限流检查）
          // 目前假设Gemini账户不需要限流检查
          availableAccounts.push({
            ...account,
            accountId: account.id,
            accountType: 'gemini',
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
          logger.info(
            `✅ Added Gemini account to available pool: ${account.name} (priority: ${account.priority})`
          )
        } else {
          logger.info(
            `❌ Gemini account ${account.name} not eligible - isActive: ${account.isActive}, accountType: ${account.accountType}, schedulable: ${account.schedulable}`
          )
        }
      }
    }

    // 获取OpenAI账户（共享池）
    const openaiAccountsResult = await openaiAccountService.getAllAccounts()
    if (openaiAccountsResult.success) {
      const openaiAccounts = openaiAccountsResult.data
      logger.info(`📋 Found ${openaiAccounts.length} total OpenAI accounts`)

      for (const account of openaiAccounts) {
        logger.info(
          `🔍 Checking OpenAI account: ${account.name} - isActive: ${account.isActive}, accountType: ${account.accountType}, schedulable: ${account.schedulable}`
        )

        if (
          account.isActive === true &&
          account.accountType === 'shared' &&
          this._isSchedulable(account.schedulable)
        ) {
          // 检查是否被限流（如果OpenAI支持限流检查）
          // 目前假设OpenAI账户不需要限流检查
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
          logger.info(
            `✅ Added OpenAI account to available pool: ${account.name} (priority: ${account.priority})`
          )
        } else {
          logger.info(
            `❌ OpenAI account ${account.name} not eligible - isActive: ${account.isActive}, accountType: ${account.accountType}, schedulable: ${account.schedulable}`
          )
        }
      }
    }

    // 获取Azure OpenAI账户（共享池）
    const azureOpenaiAccountsResult = await azureOpenaiAccountService.getAllAccounts()
    if (azureOpenaiAccountsResult.success) {
      const azureOpenaiAccounts = azureOpenaiAccountsResult.data
      logger.info(`📋 Found ${azureOpenaiAccounts.length} total Azure OpenAI accounts`)

      for (const account of azureOpenaiAccounts) {
        logger.info(
          `🔍 Checking Azure OpenAI account: ${account.name} - isActive: ${account.isActive}, accountType: ${account.accountType}, schedulable: ${account.schedulable}`
        )

        if (
          account.isActive === true &&
          account.accountType === 'shared' &&
          this._isSchedulable(account.schedulable)
        ) {
          // 检查是否被限流（如果Azure OpenAI支持限流检查）
          // 目前假设Azure OpenAI账户不需要限流检查
          availableAccounts.push({
            ...account,
            accountId: account.id,
            accountType: 'azure-openai',
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
          logger.info(
            `✅ Added Azure OpenAI account to available pool: ${account.name} (priority: ${account.priority})`
          )
        } else {
          logger.info(
            `❌ Azure OpenAI account ${account.name} not eligible - isActive: ${account.isActive}, accountType: ${account.accountType}, schedulable: ${account.schedulable}`
          )
        }
      }
    }

    logger.info(
      `📊 Total available accounts: ${availableAccounts.length} (Claude: ${availableAccounts.filter((a) => a.accountType === 'claude-official').length}, Console: ${availableAccounts.filter((a) => a.accountType === 'claude-console').length}, Bedrock: ${availableAccounts.filter((a) => a.accountType === 'bedrock').length}, Gemini: ${availableAccounts.filter((a) => a.accountType === 'gemini').length}, OpenAI: ${availableAccounts.filter((a) => a.accountType === 'openai').length}, Azure OpenAI: ${availableAccounts.filter((a) => a.accountType === 'azure-openai').length})`
    )
    return availableAccounts
  }

  // 📊 更新账户使用统计
  async updateAccountUsageStats(accountId, accountType) {
    try {
      // 调用相应服务的recordAccountUsage方法以正确更新调度字段
      if (accountType === 'claude-official') {
        await claudeAccountService.recordAccountUsage(accountId)
      } else if (accountType === 'claude-console') {
        await claudeConsoleAccountService.recordAccountUsage(accountId)
      } else if (accountType === 'bedrock') {
        await bedrockAccountService.recordAccountUsage(accountId)
      } else if (accountType === 'gemini') {
        await geminiAccountService.recordAccountUsage(accountId)
      } else if (accountType === 'openai') {
        await openaiAccountService.recordAccountUsage(accountId)
      } else if (accountType === 'azure-openai') {
        await azureOpenaiAccountService.recordAccountUsage(accountId)
      }

      // 保持原有的统计逻辑用于调度器内部统计
      const client = database.getClientSafe()
      const statsKey = `${this.USAGE_STATS_PREFIX}${accountType}:${accountId}`

      // 增加使用次数
      await client.incr(statsKey)

      // 设置过期时间为30天，避免统计数据无限增长
      await client.expire(statsKey, 30 * 24 * 60 * 60)

      logger.debug(`📊 Updated usage stats for account ${accountId} (${accountType})`)
    } catch (error) {
      logger.warn('⚠️ Failed to update account usage stats:', error)
    }
  }

  // 📈 获取账户使用统计
  async getAccountUsageCount(accountId, accountType) {
    try {
      const client = database.getClientSafe()
      const statsKey = `${this.USAGE_STATS_PREFIX}${accountType}:${accountId}`
      const count = await client.get(statsKey)
      return parseInt(count) || 0
    } catch (error) {
      logger.warn('⚠️ Failed to get account usage stats:', error)
      return 0
    }
  }

  // 🔢 按优先级和调度策略排序账户（支持个别账户的自定义策略）
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
          `🎯 Applying ${strategy} strategy to ${priorityAccounts.length} accounts with priority ${priority}`
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
          `🎯 Mixed strategies in priority ${priority}: ${uniqueStrategies.join(', ')}, applying account-level strategies`
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

  // 🔢 按优先级和调度策略排序账户（原有方法，保持向后兼容）
  async _sortAccountsByPriority(accounts, strategy = null) {
    // 如果没有提供策略，从系统配置获取
    if (!strategy) {
      strategy = await this._getSystemDefaultStrategy()
    }

    // 验证调度策略
    if (!this.SUPPORTED_STRATEGIES.includes(strategy)) {
      logger.warn(`⚠️ Unknown scheduling strategy: ${strategy}, falling back to system default`)
      strategy = await this._getSystemDefaultStrategy()
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

    // 对每个优先级组应用调度策略
    for (const priority of sortedPriorities) {
      const priorityAccounts = groupsByPriority[priority]

      logger.info(
        `🎯 Applying ${strategy} strategy to ${priorityAccounts.length} accounts with priority ${priority}`
      )

      let strategyAccounts
      try {
        strategyAccounts = await this._applySchedulingStrategy(priorityAccounts, strategy, priority)
      } catch (error) {
        logger.error(`❌ Failed to apply strategy ${strategy} for priority ${priority}:`, error)
        // 回退到默认策略
        strategyAccounts = await this._applySchedulingStrategy(
          priorityAccounts,
          'least_recent',
          priority
        )
      }

      sortedAccounts.push(...strategyAccounts)
    }

    return sortedAccounts
  }

  // 🎯 应用调度策略
  async _applySchedulingStrategy(accounts, strategy, priority = null) {
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
      const client = database.getClientSafe()

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
        `🔄 Round robin selected index ${selectedIndex}: ${selectedAccount.name} (${selectedAccount.accountId})`
      )

      return reorderedAccounts
    } catch (error) {
      logger.error('❌ Round robin strategy failed:', error)
      return this._leastRecentStrategy(accounts)
    }
  }

  // 📊 最少使用调度策略
  async _leastUsedStrategy(accounts) {
    try {
      // 获取所有账户的使用统计
      const accountsWithUsage = await Promise.all(
        accounts.map(async (account) => {
          const usageCount = await this.getAccountUsageCount(account.accountId, account.accountType)
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
        `📊 Least used selected: ${sortedAccounts[0].name} (usage: ${sortedAccounts[0].usageCount})`
      )

      return sortedAccounts
    } catch (error) {
      logger.error('❌ Least used strategy failed:', error)
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
      `⏰ Least recent selected: ${sortedAccounts[0].name} (last used: ${sortedAccounts[0].lastUsedAt || 'never'})`
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
      `🎲 Random selected: ${shuffledAccounts[0].name} (${shuffledAccounts[0].accountId})`
    )

    return shuffledAccounts
  }

  // ⚖️ 加权随机调度策略
  _weightedRandomStrategy(accounts) {
    try {
      // 为每个账户分配权重（weight 字段，默认为1）
      const accountsWithWeight = accounts.map((account) => ({
        ...account,
        weight: parseFloat(account.weight) || 1.0
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
            `⚖️ Weighted random selected: ${selectedAccount.name} (weight: ${selectedAccount.weight})`
          )

          return reorderedAccounts
        }
      }

      // 如果没有选中（不应该发生），返回第一个
      logger.info(`⚖️ Weighted random fallback to first: ${accountsWithWeight[0].name}`)
      return accountsWithWeight
    } catch (error) {
      logger.error('❌ Weighted random strategy failed:', error)
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

      const client = database.getClientSafe()

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
        `🔢 Sequential selected position ${selectedIndex}: ${selectedAccount.name} (order: ${selectedAccount.sequentialOrder || 'undefined'})`
      )

      return reorderedAccounts
    } catch (error) {
      logger.error('❌ Sequential strategy failed:', error)
      return this._leastRecentStrategy(accounts)
    }
  }

  // 🔍 检查账户是否可用
  async _isAccountAvailable(accountId, accountType) {
    try {
      if (accountType === 'claude-official') {
        const account = await database.getClaudeAccount(accountId)
        if (!account || account.isActive !== 'true' || account.status === 'error') {
          return false
        }
        // 检查是否可调度
        if (!this._isSchedulable(account.schedulable)) {
          logger.info(`🚫 Account ${accountId} is not schedulable`)
          return false
        }
        return !(await claudeAccountService.isAccountRateLimited(accountId))
      } else if (accountType === 'claude-console') {
        const account = await claudeConsoleAccountService.getAccount(accountId)
        if (!account || !account.isActive || account.status !== 'active') {
          return false
        }
        // 检查是否可调度
        if (!this._isSchedulable(account.schedulable)) {
          logger.info(`🚫 Claude Console account ${accountId} is not schedulable`)
          return false
        }
        return !(await claudeConsoleAccountService.isAccountRateLimited(accountId))
      } else if (accountType === 'bedrock') {
        const accountResult = await bedrockAccountService.getAccount(accountId)
        if (!accountResult.success || !accountResult.data.isActive) {
          return false
        }
        // 检查是否可调度
        if (!this._isSchedulable(accountResult.data.schedulable)) {
          logger.info(`🚫 Bedrock account ${accountId} is not schedulable`)
          return false
        }
        // Bedrock账户暂不需要限流检查，因为AWS管理限流
        return true
      } else if (accountType === 'gemini') {
        const account = await geminiAccountService.getAccount(accountId)
        if (!account || !account.isActive) {
          return false
        }
        // 检查是否可调度
        if (!this._isSchedulable(account.schedulable)) {
          logger.info(`🚫 Gemini account ${accountId} is not schedulable`)
          return false
        }
        // Gemini账户暂不需要限流检查
        return true
      } else if (accountType === 'openai') {
        const accountResult = await openaiAccountService.getAccount(accountId)
        if (!accountResult.success || !accountResult.data.isActive) {
          return false
        }
        // 检查是否可调度
        if (!this._isSchedulable(accountResult.data.schedulable)) {
          logger.info(`🚫 OpenAI account ${accountId} is not schedulable`)
          return false
        }
        // OpenAI账户暂不需要限流检查
        return true
      } else if (accountType === 'azure-openai') {
        const accountResult = await azureOpenaiAccountService.getAccount(accountId)
        if (!accountResult.success || !accountResult.data.isActive) {
          return false
        }
        // 检查是否可调度
        if (!this._isSchedulable(accountResult.data.schedulable)) {
          logger.info(`🚫 Azure OpenAI account ${accountId} is not schedulable`)
          return false
        }
        // Azure OpenAI账户暂不需要限流检查
        return true
      }
      return false
    } catch (error) {
      logger.warn(`⚠️ Failed to check account availability: ${accountId}`, error)
      return false
    }
  }

  // 🔗 获取会话映射
  async _getSessionMapping(sessionHash) {
    const client = database.getClientSafe()
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
    const client = database.getClientSafe()
    const mappingData = JSON.stringify({ accountId, accountType })

    // 设置1小时过期
    await client.setex(`${this.SESSION_MAPPING_PREFIX}${sessionHash}`, 3600, mappingData)
  }

  // 🗑️ 删除会话映射
  async _deleteSessionMapping(sessionHash) {
    const client = database.getClientSafe()
    await client.del(`${this.SESSION_MAPPING_PREFIX}${sessionHash}`)
  }

  // 🚫 标记账户为限流状态
  async markAccountRateLimited(
    accountId,
    accountType,
    sessionHash = null,
    rateLimitResetTimestamp = null
  ) {
    try {
      if (accountType === 'claude-official') {
        await claudeAccountService.markAccountRateLimited(
          accountId,
          sessionHash,
          rateLimitResetTimestamp
        )
      } else if (accountType === 'claude-console') {
        await claudeConsoleAccountService.markAccountRateLimited(accountId)
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
      if (accountType === 'claude-official') {
        await claudeAccountService.removeAccountRateLimit(accountId)
      } else if (accountType === 'claude-console') {
        await claudeConsoleAccountService.removeAccountRateLimit(accountId)
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
  async isAccountRateLimited(accountId, accountType) {
    try {
      if (accountType === 'claude-official') {
        return await claudeAccountService.isAccountRateLimited(accountId)
      } else if (accountType === 'claude-console') {
        return await claudeConsoleAccountService.isAccountRateLimited(accountId)
      }
      return false
    } catch (error) {
      logger.error(`❌ Failed to check rate limit status: ${accountId} (${accountType})`, error)
      return false
    }
  }

  // 🚫 标记账户为未授权状态（401错误）
  async markAccountUnauthorized(accountId, accountType, sessionHash = null) {
    try {
      // 只处理claude-official类型的账户，不处理claude-console和gemini
      if (accountType === 'claude-official') {
        await claudeAccountService.markAccountUnauthorized(accountId, sessionHash)

        // 删除会话映射
        if (sessionHash) {
          await this._deleteSessionMapping(sessionHash)
        }

        logger.warn(`🚫 Account ${accountId} marked as unauthorized due to consecutive 401 errors`)
      } else {
        logger.info(
          `ℹ️ Skipping unauthorized marking for non-Claude OAuth account: ${accountId} (${accountType})`
        )
      }

      return { success: true }
    } catch (error) {
      logger.error(
        `❌ Failed to mark account as unauthorized: ${accountId} (${accountType})`,
        error
      )
      throw error
    }
  }

  // 🚫 标记Claude Console账户为封锁状态（模型不支持）
  async blockConsoleAccount(accountId, reason) {
    try {
      await claudeConsoleAccountService.blockAccount(accountId, reason)
      return { success: true }
    } catch (error) {
      logger.error(`❌ Failed to block console account: ${accountId}`, error)
      throw error
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

      logger.info(`👥 Selecting account from group: ${group.name} (${group.platform})`)

      // 如果有会话哈希，检查是否有已映射的账户
      if (sessionHash) {
        const mappedAccount = await this._getSessionMapping(sessionHash)
        if (mappedAccount) {
          // 验证映射的账户是否属于这个分组
          const memberIds = await accountGroupService.getGroupMembers(groupId)
          if (memberIds.includes(mappedAccount.accountId)) {
            const isAvailable = await this._isAccountAvailable(
              mappedAccount.accountId,
              mappedAccount.accountType
            )
            if (isAvailable) {
              logger.info(
                `🎯 Using sticky session account from group: ${mappedAccount.accountId} (${mappedAccount.accountType}) for session ${sessionHash}`
              )
              return mappedAccount
            }
          }
          // 如果映射的账户不可用或不在分组中，删除映射
          await this._deleteSessionMapping(sessionHash)
        }
      }

      // 获取分组内的所有账户
      const memberIds = await accountGroupService.getGroupMembers(groupId)
      if (memberIds.length === 0) {
        throw new Error(`Group ${group.name} has no members`)
      }

      const availableAccounts = []

      // 获取所有成员账户的详细信息
      for (const memberId of memberIds) {
        let account = null
        let accountType = null

        // 根据平台类型获取账户
        if (group.platform === 'claude') {
          // 先尝试官方账户
          account = await database.getClaudeAccount(memberId)
          if (account?.id) {
            accountType = 'claude-official'
          } else {
            // 尝试Console账户
            account = await claudeConsoleAccountService.getAccount(memberId)
            if (account) {
              accountType = 'claude-console'
            }
          }
        } else if (group.platform === 'gemini') {
          // Gemini暂时不支持，预留接口
          logger.warn('⚠️ Gemini group scheduling not yet implemented')
          continue
        }

        if (!account) {
          logger.warn(`⚠️ Account ${memberId} not found in group ${group.name}`)
          continue
        }

        // 检查账户是否可用
        const isActive =
          accountType === 'claude-official'
            ? account.isActive === 'true'
            : account.isActive === true

        const status =
          accountType === 'claude-official'
            ? account.status !== 'error' && account.status !== 'blocked'
            : account.status === 'active'

        if (isActive && status && this._isSchedulable(account.schedulable)) {
          // 检查模型支持（Console账户）
          if (
            accountType === 'claude-console' &&
            requestedModel &&
            account.supportedModels &&
            account.supportedModels.length > 0
          ) {
            if (!account.supportedModels.includes(requestedModel)) {
              logger.info(
                `🚫 Account ${account.name} in group does not support model ${requestedModel}`
              )
              continue
            }
          }

          // 检查是否被限流
          const isRateLimited = await this.isAccountRateLimited(account.id, accountType)
          if (!isRateLimited) {
            availableAccounts.push({
              ...account,
              accountId: account.id,
              accountType,
              priority: parseInt(account.priority) || 50,
              lastUsedAt: account.lastUsedAt || '0'
            })
          }
        }
      }

      if (availableAccounts.length === 0) {
        throw new Error(`No available accounts in group ${group.name}`)
      }

      // 使用分组的调度策略，如果分组没有配置则使用系统默认策略
      const schedulingStrategy =
        group.schedulingStrategy || (await this._getSystemDefaultStrategy())
      logger.info(
        `🎯 Using scheduling strategy for Claude group ${group.name}: ${schedulingStrategy} ${group.schedulingStrategy ? '(from group config)' : '(system default)'}`
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
          `🎯 Created new sticky session mapping in group: ${selectedAccount.name} (${selectedAccount.accountId}, ${selectedAccount.accountType}) for session ${sessionHash}`
        )
      }

      // 更新使用统计
      await this.updateAccountUsageStats(selectedAccount.accountId, selectedAccount.accountType)

      logger.info(
        `🎯 Selected account from group ${group.name}: ${selectedAccount.name} (${selectedAccount.accountId}, ${selectedAccount.accountType}) with priority ${selectedAccount.priority} using strategy ${schedulingStrategy}`
      )

      return {
        accountId: selectedAccount.accountId,
        accountType: selectedAccount.accountType
      }
    } catch (error) {
      logger.error(`❌ Failed to select account from group ${groupId}:`, error)
      throw error
    }
  }
}

module.exports = new UnifiedClaudeScheduler()
