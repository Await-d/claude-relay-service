const openaiAccountService = require('./openaiAccountService')
const openaiResponsesAccountService = require('./openaiResponsesAccountService')
const accountGroupService = require('./accountGroupService')
const redis = require('../models/redis')
const logger = require('../utils/logger')

class UnifiedOpenAIScheduler {
  constructor() {
    this.SESSION_MAPPING_PREFIX = 'unified_openai_session_mapping:'
  }

  // 🔢 按优先级和最后使用时间排序账户（与 Claude/Gemini 调度保持一致）
  _sortAccountsByPriority(accounts) {
    return accounts.sort((a, b) => {
      const aPriority = Number.parseInt(a.priority, 10)
      const bPriority = Number.parseInt(b.priority, 10)
      const normalizedAPriority = Number.isFinite(aPriority) ? aPriority : 50
      const normalizedBPriority = Number.isFinite(bPriority) ? bPriority : 50

      // 首先按优先级排序（数字越小优先级越高）
      if (normalizedAPriority !== normalizedBPriority) {
        return normalizedAPriority - normalizedBPriority
      }

      // 优先级相同时，按最后使用时间排序（最久未使用的优先）
      const aLastUsed = new Date(a.lastUsedAt || 0).getTime()
      const bLastUsed = new Date(b.lastUsedAt || 0).getTime()
      return aLastUsed - bLastUsed
    })
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

  // 🔧 辅助方法：检查账户是否被限流（兼容字符串和对象格式）
  _isRateLimited(rateLimitStatus) {
    if (!rateLimitStatus) {
      return false
    }

    // 兼容字符串格式（Redis 原始数据）
    if (typeof rateLimitStatus === 'string') {
      return rateLimitStatus === 'limited'
    }

    // 兼容对象格式（getAllAccounts 返回的数据）
    if (typeof rateLimitStatus === 'object') {
      if (rateLimitStatus.isRateLimited === false) {
        return false
      }
      // 检查对象中的 status 字段
      return rateLimitStatus.status === 'limited' || rateLimitStatus.isRateLimited === true
    }

    return false
  }

  // 🔍 判断账号是否带有限流标记（即便已过期，用于自动恢复）
  _hasRateLimitFlag(rateLimitStatus) {
    if (!rateLimitStatus) {
      return false
    }

    if (typeof rateLimitStatus === 'string') {
      return rateLimitStatus === 'limited'
    }

    if (typeof rateLimitStatus === 'object') {
      return rateLimitStatus.status === 'limited' || rateLimitStatus.isRateLimited === true
    }

    return false
  }

  // ✅ 确保账号在调度前完成限流恢复与 schedulable 校正
  async _ensureAccountReadyForScheduling(account, accountId, { sanitized = true } = {}) {
    const hasRateLimitFlag = this._hasRateLimitFlag(account.rateLimitStatus)
    let rateLimitChecked = false
    let stillLimited = false

    let isSchedulable = this._isSchedulable(account.schedulable)

    if (!isSchedulable) {
      if (!hasRateLimitFlag) {
        return { canUse: false, reason: 'not_schedulable' }
      }

      stillLimited = await this.isAccountRateLimited(accountId)
      rateLimitChecked = true
      if (stillLimited) {
        return { canUse: false, reason: 'rate_limited' }
      }

      // 限流已恢复，矫正本地状态
      if (sanitized) {
        account.schedulable = true
      } else {
        account.schedulable = 'true'
      }
      isSchedulable = true
      logger.info(`✅ OpenAI账号 ${account.name || accountId} 已解除限流，恢复调度权限`)
    }

    if (hasRateLimitFlag) {
      if (!rateLimitChecked) {
        stillLimited = await this.isAccountRateLimited(accountId)
        rateLimitChecked = true
      }
      if (stillLimited) {
        return { canUse: false, reason: 'rate_limited' }
      }

      // 更新本地限流状态，避免重复判定
      if (sanitized) {
        account.rateLimitStatus = {
          status: 'normal',
          isRateLimited: false,
          rateLimitedAt: null,
          rateLimitResetAt: null,
          minutesRemaining: 0
        }
      } else {
        account.rateLimitStatus = 'normal'
        account.rateLimitedAt = null
        account.rateLimitResetAt = null
      }

      if (account.status === 'rateLimited') {
        account.status = 'active'
      }
    }

    if (!rateLimitChecked) {
      stillLimited = await this.isAccountRateLimited(accountId)
      if (stillLimited) {
        return { canUse: false, reason: 'rate_limited' }
      }
    }

    return { canUse: true }
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

        // 普通专属账户 - 根据前缀判断是 OpenAI 还是 OpenAI-Responses 类型
        let boundAccount = null
        let accountType = 'openai'

        // 检查是否有 responses: 前缀（用于区分 OpenAI-Responses 账户）
        if (apiKeyData.openaiAccountId.startsWith('responses:')) {
          const accountId = apiKeyData.openaiAccountId.replace('responses:', '')
          boundAccount = await openaiResponsesAccountService.getAccount(accountId)
          accountType = 'openai-responses'

          // 🔧 在检查 isActive 之前，先尝试自动恢复 error 状态
          if (boundAccount && boundAccount.status === 'error') {
            const isErrorCleared =
              await openaiResponsesAccountService.checkAndClearErrorStatus(accountId)
            if (isErrorCleared) {
              // 刷新账户状态
              boundAccount = await openaiResponsesAccountService.getAccount(accountId)
              logger.info(
                `✅ Dedicated OpenAI-Responses account ${boundAccount?.name || accountId} auto-recovered from error state`
              )
            }
          }
        } else {
          // 普通 OpenAI 账户
          boundAccount = await openaiAccountService.getAccount(apiKeyData.openaiAccountId)
          accountType = 'openai'

          // 🔧 在检查 isActive 之前，先尝试自动恢复 error 状态
          if (boundAccount && boundAccount.status === 'error') {
            const isErrorCleared = await openaiAccountService.checkAndClearErrorStatus(
              apiKeyData.openaiAccountId
            )
            if (isErrorCleared) {
              // 刷新账户状态
              boundAccount = await openaiAccountService.getAccount(apiKeyData.openaiAccountId)
              logger.info(
                `✅ Dedicated OpenAI account ${boundAccount?.name || apiKeyData.openaiAccountId} auto-recovered from error state`
              )
            }
          }
        }

        // 对 OpenAI-Responses 放宽：存在即可继续调度；OpenAI 仍要求 active 且无错误状态
        const isActiveBoundAccount =
          accountType === 'openai-responses'
            ? !!boundAccount
            : boundAccount &&
              (boundAccount.isActive === true || boundAccount.isActive === 'true') &&
              boundAccount.status !== 'error' &&
              boundAccount.status !== 'unauthorized'

        if (isActiveBoundAccount) {
          if (accountType === 'openai') {
            const readiness = await this._ensureAccountReadyForScheduling(
              boundAccount,
              boundAccount.id,
              { sanitized: false }
            )

            if (!readiness.canUse) {
              const isRateLimited = readiness.reason === 'rate_limited'
              const errorMsg = isRateLimited
                ? `Dedicated account ${boundAccount.name} is currently rate limited`
                : `Dedicated account ${boundAccount.name} is not schedulable`
              logger.warn(`⚠️ ${errorMsg}`)
              const error = new Error(errorMsg)
              error.statusCode = isRateLimited ? 429 : 403
              throw error
            }
          } else {
            // OpenAI-Responses 专属账号：不做限流/可调度/订阅检查，遇到错误也继续调度
            logger.info(
              `ℹ️ Skipping rate limit & schedulable checks for OpenAI-Responses account ${boundAccount.name}`
            )
          }

          // 专属账户：可选的模型检查（只有明确配置了supportedModels且不为空才检查）
          // OpenAI-Responses 账户默认支持所有模型
          if (
            accountType === 'openai' &&
            requestedModel &&
            boundAccount.supportedModels &&
            boundAccount.supportedModels.length > 0
          ) {
            const modelSupported = boundAccount.supportedModels.includes(requestedModel)
            if (!modelSupported) {
              const errorMsg = `Dedicated account ${boundAccount.name} does not support model ${requestedModel}`
              logger.warn(`⚠️ ${errorMsg}`)
              const error = new Error(errorMsg)
              error.statusCode = 400 // Bad Request - 请求参数错误
              throw error
            }
          }

          logger.info(
            `🎯 Using bound dedicated ${accountType} account: ${boundAccount.name} (${boundAccount.id}) for API key ${apiKeyData.name}`
          )
          // 更新账户的最后使用时间
          await this.updateAccountLastUsed(boundAccount.id, accountType)
          return {
            accountId: boundAccount.id,
            accountType
          }
        } else {
          let errorMsg
          if (!boundAccount) {
            errorMsg = `Dedicated account ${apiKeyData.openaiAccountId} not found`
          } else if (!(boundAccount.isActive === true || boundAccount.isActive === 'true')) {
            errorMsg = `Dedicated account ${boundAccount.name} is not active`
          } else if (boundAccount.status === 'unauthorized') {
            errorMsg = `Dedicated account ${boundAccount.name} is unauthorized`
          } else if (boundAccount.status === 'error') {
            errorMsg = `Dedicated account ${boundAccount.name} is not available (error status)`
          } else {
            errorMsg = `Dedicated account ${boundAccount.name} is not available (inactive or forbidden)`
          }

          if (accountType === 'openai-responses') {
            // 对 OpenAI-Responses：仅记录日志并继续共享池调度
            logger.warn(`⚠️ ${errorMsg}, falling back to shared pool scheduling`)
          } else {
            // 默认 OpenAI 保持原行为：抛错，不调度
            logger.warn(`⚠️ ${errorMsg}`)
            const error = new Error(errorMsg)
            error.statusCode = boundAccount ? 403 : 404
            throw error
          }
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
            // 🚀 智能会话续期（续期 unified 映射键，按配置）
            await this._extendSessionMappingTTL(sessionHash)
            logger.info(
              `🎯 Using sticky session account: ${mappedAccount.accountId} (${mappedAccount.accountType}) for session ${sessionHash}`
            )
            // 更新账户的最后使用时间
            await this.updateAccountLastUsed(mappedAccount.accountId, mappedAccount.accountType)
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
          const error = new Error(
            `No available OpenAI accounts support the requested model: ${requestedModel}`
          )
          error.statusCode = 400 // Bad Request - 模型不支持
          throw error
        } else {
          const error = new Error('No available OpenAI accounts')
          error.statusCode = 402 // Payment Required - 资源耗尽
          throw error
        }
      }

      // 按优先级和最后使用时间排序（与 Claude/Gemini 调度保持一致）
      const sortedAccounts = this._sortAccountsByPriority(availableAccounts)

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
        `🎯 Selected account: ${selectedAccount.name} (${selectedAccount.accountId}, ${selectedAccount.accountType}, priority: ${selectedAccount.priority || 50}) for API key ${apiKeyData.name}`
      )

      // 更新账户的最后使用时间
      await this.updateAccountLastUsed(selectedAccount.accountId, selectedAccount.accountType)

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
    for (let account of openaiAccounts) {
      // 🔧 自动恢复检查
      if (account.status === 'error') {
        const isErrorCleared = await openaiAccountService.checkAndClearErrorStatus(account.id)
        if (isErrorCleared) {
          account.status = 'active'
          account.schedulable = 'true'
          account.errorMessage = ''
          logger.info(
            `✅ OpenAI account ${account.name} (${account.id}) auto-recovered from error state`
          )
        }
      }

      if (
        account.isActive &&
        account.status !== 'error' &&
        (account.accountType === 'shared' || !account.accountType) // 兼容旧数据
      ) {
        const accountId = account.id || account.accountId

        const readiness = await this._ensureAccountReadyForScheduling(account, accountId, {
          sanitized: true
        })

        if (!readiness.canUse) {
          if (readiness.reason === 'rate_limited') {
            logger.debug(`⏭️ 跳过 OpenAI 账号 ${account.name} - 仍处于限流状态`)
          } else {
            logger.debug(`⏭️ 跳过 OpenAI 账号 ${account.name} - 已被管理员禁用调度`)
          }
          continue
        }

        // 检查token是否过期并自动刷新
        const isExpired = openaiAccountService.isTokenExpired(account)
        if (isExpired) {
          if (!account.refreshToken) {
            logger.warn(
              `⚠️ OpenAI account ${account.name} token expired and no refresh token available`
            )
            continue
          }

          // 自动刷新过期的 token
          try {
            logger.info(`🔄 Auto-refreshing expired token for OpenAI account ${account.name}`)
            await openaiAccountService.refreshAccountToken(account.id)
            // 重新获取更新后的账户信息
            account = await openaiAccountService.getAccount(account.id)
            logger.info(`✅ Token refreshed successfully for ${account.name}`)
          } catch (refreshError) {
            logger.error(`❌ Failed to refresh token for ${account.name}:`, refreshError.message)
            continue // 刷新失败，跳过此账户
          }
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

        availableAccounts.push({
          ...account,
          accountId: account.id,
          accountType: 'openai',
          priority: parseInt(account.priority) || 50,
          lastUsedAt: account.lastUsedAt || '0'
        })
      }
    }

    // 获取所有 OpenAI-Responses 账户（共享池）
    const openaiResponsesAccounts = await openaiResponsesAccountService.getAllAccounts()
    for (const account of openaiResponsesAccounts) {
      if (
        (account.isActive === true || account.isActive === 'true') &&
        (account.accountType === 'shared' || !account.accountType)
      ) {
        // 🔧 检查并自动恢复 error 状态
        if (account.status === 'error') {
          const isErrorCleared = await openaiResponsesAccountService.checkAndClearErrorStatus(
            account.id
          )
          if (!isErrorCleared) {
            logger.debug(
              `⏭️ Skipping OpenAI-Responses account ${account.name} - still in error state`
            )
            continue
          }
          // Error 状态已解除，更新本地账户信息
          account.status = 'active'
          account.schedulable = 'true'
          account.errorMessage = ''
          logger.info(`✅ OpenAI-Responses账号 ${account.name} 已自动从错误状态恢复`)
        }

        // 跳过其他非正常状态
        if (account.status !== 'active' && account.status !== 'rateLimited') {
          logger.debug(
            `⏭️ Skipping OpenAI-Responses account ${account.name} - status: ${account.status}`
          )
          continue
        }

        const hasRateLimitFlag = this._hasRateLimitFlag(account.rateLimitStatus)
        const schedulable = this._isSchedulable(account.schedulable)

        if (!schedulable && !hasRateLimitFlag) {
          logger.debug(`⏭️ Skipping OpenAI-Responses account ${account.name} - not schedulable`)
          continue
        }

        let isRateLimitCleared = false
        if (hasRateLimitFlag) {
          isRateLimitCleared = await openaiResponsesAccountService.checkAndClearRateLimit(
            account.id
          )

          if (!isRateLimitCleared) {
            logger.debug(`⏭️ Skipping OpenAI-Responses account ${account.name} - rate limited`)
            continue
          }

          if (!schedulable) {
            account.schedulable = 'true'
            account.status = 'active'
            logger.info(`✅ OpenAI-Responses账号 ${account.name} 已解除限流，恢复调度权限`)
          }
        }

        // ⏰ 检查订阅是否过期
        if (openaiResponsesAccountService.isSubscriptionExpired(account)) {
          logger.debug(
            `⏭️ Skipping OpenAI-Responses account ${account.name} - subscription expired`
          )
          continue
        }

        // OpenAI-Responses 账户默认支持所有模型
        // 因为它们是第三方兼容 API，模型支持由第三方决定

        availableAccounts.push({
          ...account,
          accountId: account.id,
          accountType: 'openai-responses',
          priority: parseInt(account.priority) || 50,
          lastUsedAt: account.lastUsedAt || '0'
        })
      }
    }

    return availableAccounts
  }

  // 🔍 检查账户是否可用
  async _isAccountAvailable(accountId, accountType) {
    try {
      if (accountType === 'openai') {
        const account = await openaiAccountService.getAccount(accountId)
        if (
          !account ||
          !account.isActive ||
          account.status === 'error' ||
          account.status === 'unauthorized'
        ) {
          return false
        }
        const readiness = await this._ensureAccountReadyForScheduling(account, accountId, {
          sanitized: false
        })

        if (!readiness.canUse) {
          if (readiness.reason === 'rate_limited') {
            logger.debug(
              `🚫 OpenAI account ${accountId} still rate limited when checking availability`
            )
          } else {
            logger.info(`🚫 OpenAI account ${accountId} is not schedulable`)
          }
          return false
        }

        return true
      } else if (accountType === 'openai-responses') {
        const account = await openaiResponsesAccountService.getAccount(accountId)
        // OpenAI-Responses：只要账户存在就视为可用，不阻断调度
        if (!account) {
          return false
        }
        logger.debug(`✅ OpenAI-Responses account ${accountId} treated as available (no checks)`)
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
    // 依据配置设置TTL（小时）
    const appConfig = require('../../config/config')
    const ttlHours = appConfig.session?.stickyTtlHours || 1
    const ttlSeconds = Math.max(1, Math.floor(ttlHours * 60 * 60))
    await client.setex(`${this.SESSION_MAPPING_PREFIX}${sessionHash}`, ttlSeconds, mappingData)
  }

  // 🗑️ 删除会话映射
  async _deleteSessionMapping(sessionHash) {
    const client = redis.getClientSafe()
    await client.del(`${this.SESSION_MAPPING_PREFIX}${sessionHash}`)
  }

  // 🔁 续期统一调度会话映射TTL（针对 unified_openai_session_mapping:* 键），遵循会话配置
  async _extendSessionMappingTTL(sessionHash) {
    try {
      const client = redis.getClientSafe()
      const key = `${this.SESSION_MAPPING_PREFIX}${sessionHash}`
      const remainingTTL = await client.ttl(key)

      if (remainingTTL === -2) {
        return false
      }
      if (remainingTTL === -1) {
        return true
      }

      const appConfig = require('../../config/config')
      const ttlHours = appConfig.session?.stickyTtlHours || 1
      const renewalThresholdMinutes = appConfig.session?.renewalThresholdMinutes || 0
      if (!renewalThresholdMinutes) {
        return true
      }

      const fullTTL = Math.max(1, Math.floor(ttlHours * 60 * 60))
      const threshold = Math.max(0, Math.floor(renewalThresholdMinutes * 60))

      if (remainingTTL < threshold) {
        await client.expire(key, fullTTL)
        logger.debug(
          `🔄 Renewed unified OpenAI session TTL: ${sessionHash} (was ${Math.round(remainingTTL / 60)}m, renewed to ${ttlHours}h)`
        )
      } else {
        logger.debug(
          `✅ Unified OpenAI session TTL sufficient: ${sessionHash} (remaining ${Math.round(remainingTTL / 60)}m)`
        )
      }
      return true
    } catch (error) {
      logger.error('❌ Failed to extend unified OpenAI session TTL:', error)
      return false
    }
  }

  // 🚫 标记账户为限流状态
  async markAccountRateLimited(accountId, accountType, sessionHash = null, resetsInSeconds = null) {
    try {
      if (accountType === 'openai') {
        await openaiAccountService.setAccountRateLimited(accountId, true, resetsInSeconds)
      } else if (accountType === 'openai-responses') {
        // 对 OpenAI-Responses 不做限流状态处理，保持可调度
        logger.warn(
          `⚠️ Skip marking OpenAI-Responses account ${accountId} as rate limited (continue scheduling)`
        )
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

  // 🚫 标记账户为未授权状态
  async markAccountUnauthorized(
    accountId,
    accountType,
    sessionHash = null,
    reason = 'OpenAI账号认证失败（401错误）'
  ) {
    try {
      if (accountType === 'openai') {
        await openaiAccountService.markAccountUnauthorized(accountId, reason)
      } else if (accountType === 'openai-responses') {
        // 对 OpenAI-Responses 不标记未授权，保持可调度
        logger.warn(
          `⚠️ Skip marking OpenAI-Responses account ${accountId} unauthorized (continue scheduling)`
        )
      } else {
        logger.warn(
          `⚠️ Unsupported account type ${accountType} when marking unauthorized for account ${accountId}`
        )
        return { success: false }
      }

      if (sessionHash) {
        await this._deleteSessionMapping(sessionHash)
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

  // ✅ 移除账户的限流状态
  async removeAccountRateLimit(accountId, accountType) {
    try {
      if (accountType === 'openai') {
        await openaiAccountService.setAccountRateLimited(accountId, false)
      } else if (accountType === 'openai-responses') {
        // 清除 OpenAI-Responses 账户的限流状态
        await openaiResponsesAccountService.updateAccount(accountId, {
          rateLimitedAt: '',
          rateLimitStatus: '',
          rateLimitResetAt: '',
          status: 'active',
          errorMessage: '',
          schedulable: 'true'
        })
        logger.info(`✅ Rate limit cleared for OpenAI-Responses account ${accountId}`)
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

      if (this._isRateLimited(account.rateLimitStatus)) {
        // 如果有具体的重置时间，使用它
        if (account.rateLimitResetAt) {
          const resetTime = new Date(account.rateLimitResetAt).getTime()
          const now = Date.now()
          const isStillLimited = now < resetTime

          // 如果已经过了重置时间，自动清除限流状态
          if (!isStillLimited) {
            logger.info(`✅ Auto-clearing rate limit for account ${accountId} (reset time reached)`)
            await openaiAccountService.setAccountRateLimited(accountId, false)
            return false
          }

          return isStillLimited
        }

        // 如果没有具体的重置时间，使用默认的1小时
        if (account.rateLimitedAt) {
          const limitedAt = new Date(account.rateLimitedAt).getTime()
          const now = Date.now()
          const limitDuration = 60 * 60 * 1000 // 1小时
          return now < limitedAt + limitDuration
        }
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
        const error = new Error(`Group ${groupId} not found`)
        error.statusCode = 404 // Not Found - 资源不存在
        throw error
      }

      if (group.platform !== 'openai') {
        const error = new Error(`Group ${group.name} is not an OpenAI group`)
        error.statusCode = 400 // Bad Request - 请求参数错误
        throw error
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
              // 🚀 智能会话续期（续期 unified 映射键，按配置）
              await this._extendSessionMappingTTL(sessionHash)
              logger.info(
                `🎯 Using sticky session account from group: ${mappedAccount.accountId} (${mappedAccount.accountType})`
              )
              // 更新账户的最后使用时间
              await this.updateAccountLastUsed(mappedAccount.accountId, mappedAccount.accountType)
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
        const error = new Error(`Group ${group.name} has no members`)
        error.statusCode = 402 // Payment Required - 资源耗尽
        throw error
      }

      // 获取可用的分组成员账户（支持 OpenAI 和 OpenAI-Responses 两种类型）
      const availableAccounts = []
      for (const memberId of memberIds) {
        // 首先尝试从 OpenAI 账户服务获取
        let account = await openaiAccountService.getAccount(memberId)
        let accountType = 'openai'

        // 如果 OpenAI 账户不存在，尝试从 OpenAI-Responses 账户服务获取
        if (!account) {
          account = await openaiResponsesAccountService.getAccount(memberId)
          accountType = 'openai-responses'
        }

        if (
          account &&
          (account.isActive === true || account.isActive === 'true') &&
          account.status !== 'error'
        ) {
          const readiness = await this._ensureAccountReadyForScheduling(account, account.id, {
            sanitized: false
          })

          if (!readiness.canUse) {
            if (readiness.reason === 'rate_limited') {
              logger.debug(
                `⏭️ Skipping group member ${accountType} account ${account.name} - still rate limited`
              )
            } else {
              logger.debug(
                `⏭️ Skipping group member ${accountType} account ${account.name} - not schedulable`
              )
            }
            continue
          }

          // 检查token是否过期（仅对 OpenAI OAuth 账户检查）
          if (accountType === 'openai') {
            const isExpired = openaiAccountService.isTokenExpired(account)
            if (isExpired && !account.refreshToken) {
              logger.warn(
                `⚠️ Group member OpenAI account ${account.name} token expired and no refresh token available`
              )
              continue
            }
          }

          // 检查模型支持（仅在明确设置了supportedModels且不为空时才检查）
          // 如果没有设置supportedModels或为空数组，则支持所有模型
          if (requestedModel && account.supportedModels && account.supportedModels.length > 0) {
            const modelSupported = account.supportedModels.includes(requestedModel)
            if (!modelSupported) {
              logger.debug(
                `⏭️ Skipping group member ${accountType} account ${account.name} - doesn't support model ${requestedModel}`
              )
              continue
            }
          }

          // 添加到可用账户列表
          availableAccounts.push({
            ...account,
            accountId: account.id,
            accountType,
            priority: parseInt(account.priority) || 50,
            lastUsedAt: account.lastUsedAt || '0'
          })
        }
      }

      if (availableAccounts.length === 0) {
        const error = new Error(`No available accounts in group ${group.name}`)
        error.statusCode = 402 // Payment Required - 资源耗尽
        throw error
      }

      // 按优先级和最后使用时间排序（与 Claude/Gemini 调度保持一致）
      const sortedAccounts = this._sortAccountsByPriority(availableAccounts)

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
        `🎯 Selected account from group: ${selectedAccount.name} (${selectedAccount.accountId}, ${selectedAccount.accountType}, priority: ${selectedAccount.priority || 50})`
      )

      // 更新账户的最后使用时间
      await this.updateAccountLastUsed(selectedAccount.accountId, selectedAccount.accountType)

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

  // 📊 更新账户最后使用时间
  async updateAccountLastUsed(accountId, accountType) {
    try {
      if (accountType === 'openai') {
        await openaiAccountService.recordUsage(accountId, 0)
        return
      }

      if (accountType === 'openai-responses') {
        await openaiResponsesAccountService.recordUsage(accountId, 0)
      }
    } catch (error) {
      logger.warn(`⚠️ Failed to update last used time for account ${accountId}:`, error)
    }
  }
}

module.exports = new UnifiedOpenAIScheduler()
