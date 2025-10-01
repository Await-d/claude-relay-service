const { v4: uuidv4 } = require('uuid')
const crypto = require('crypto')
const database = require('../models/database')
const logger = require('../utils/logger')
const config = require('../../config/config')
const LRUCache = require('../utils/lruCache')

class OpenAIResponsesAccountService {
  constructor() {
    this.ENCRYPTION_ALGORITHM = 'aes-256-cbc'
    this.ENCRYPTION_SALT = 'openai-responses-salt'

    this.ACCOUNT_KEY_PREFIX = 'openai_responses_account:'
    this.SHARED_ACCOUNTS_KEY = 'shared_openai_responses_accounts'

    this._encryptionKeyCache = null
    this._decryptCache = new LRUCache(500)

    setInterval(
      () => {
        this._decryptCache.cleanup()
        logger.info('🧹 OpenAI-Responses decrypt cache cleanup', this._decryptCache.getStats())
      },
      10 * 60 * 1000
    )
  }

  async createAccount(options = {}) {
    const {
      name = 'OpenAI Responses Account',
      description = '',
      baseApi = '',
      apiKey = '',
      userAgent = '',
      priority = 50,
      proxy = null,
      isActive = true,
      accountType = 'shared',
      schedulable = true,
      dailyQuota = 0,
      quotaResetTime = '00:00',
      rateLimitDuration = 60
    } = options

    if (!baseApi || !apiKey) {
      throw new Error('Base API URL and API Key are required for OpenAI-Responses account')
    }

    const normalizedBaseApi = baseApi.endsWith('/') ? baseApi.slice(0, -1) : baseApi
    const accountId = uuidv4()
    const now = new Date().toISOString()

    const accountData = {
      id: accountId,
      platform: 'openai-responses',
      name,
      description,
      baseApi: normalizedBaseApi,
      apiKey: this._encryptSensitiveData(apiKey),
      userAgent,
      priority: priority.toString(),
      proxy: proxy ? JSON.stringify(proxy) : '',
      isActive: isActive ? 'true' : 'false',
      accountType,
      schedulable: schedulable ? 'true' : 'false',
      createdAt: now,
      lastUsedAt: '',
      status: 'active',
      errorMessage: '',
      rateLimitedAt: '',
      rateLimitStatus: '',
      rateLimitDuration: rateLimitDuration.toString(),
      rateLimitResetAt: '',
      dailyQuota: dailyQuota.toString(),
      dailyUsage: '0',
      lastResetDate: database.getDateStringInTimezone(),
      quotaResetTime,
      quotaStoppedAt: '',
      totalUsedTokens: '0',
      unauthorizedCount: '0',
      unauthorizedAt: ''
    }

    await this._saveAccount(accountId, accountData)
    logger.success(`Created OpenAI-Responses account: ${name} (${accountId})`)

    return { ...accountData, apiKey: '***' }
  }

  async getAccount(accountId) {
    const client = database.getClientSafe()
    const key = `${this.ACCOUNT_KEY_PREFIX}${accountId}`
    const accountData = await client.hgetall(key)

    if (!accountData || !accountData.id) {
      return null
    }

    if (accountData.apiKey) {
      accountData.apiKey = this._decryptSensitiveData(accountData.apiKey)
    }

    if (accountData.proxy) {
      try {
        accountData.proxy = JSON.parse(accountData.proxy)
      } catch (_) {
        accountData.proxy = null
      }
    }

    return accountData
  }

  async updateAccount(accountId, updates) {
    const account = await this.getAccount(accountId)
    if (!account) {
      throw new Error('Account not found')
    }

    const payload = { ...updates }

    if (payload.apiKey) {
      payload.apiKey = this._encryptSensitiveData(payload.apiKey)
    }

    if (payload.proxy !== undefined) {
      payload.proxy = payload.proxy ? JSON.stringify(payload.proxy) : ''
    }

    if (payload.baseApi) {
      payload.baseApi = payload.baseApi.endsWith('/')
        ? payload.baseApi.slice(0, -1)
        : payload.baseApi
    }

    const client = database.getClientSafe()
    await client.hset(`${this.ACCOUNT_KEY_PREFIX}${accountId}`, payload)

    logger.info(`Updated OpenAI-Responses account: ${account.name}`)
    return { success: true }
  }

  async deleteAccount(accountId) {
    const client = database.getClientSafe()
    const key = `${this.ACCOUNT_KEY_PREFIX}${accountId}`

    await client.srem(this.SHARED_ACCOUNTS_KEY, accountId)
    await client.del(key)

    logger.info(`Deleted OpenAI-Responses account: ${accountId}`)
    return { success: true }
  }

  async getAllAccounts(includeInactive = false) {
    const client = database.getClientSafe()
    const accounts = []

    const addAccount = (data) => {
      if (!data || !data.id) {
        return
      }

      const active = data.isActive === 'true'
      if (!includeInactive && !active) {
        return
      }

      const cloned = { ...data }
      cloned.apiKey = '***'

      if (cloned.proxy) {
        try {
          cloned.proxy = JSON.parse(cloned.proxy)
        } catch (_) {
          cloned.proxy = null
        }
      }

      const rateInfo = this._getRateLimitInfo(cloned)
      cloned.rateLimitStatus = rateInfo.isRateLimited
        ? {
            isRateLimited: true,
            rateLimitedAt: cloned.rateLimitedAt || null,
            minutesRemaining: rateInfo.remainingMinutes || 0
          }
        : {
            isRateLimited: false,
            rateLimitedAt: null,
            minutesRemaining: 0
          }

      cloned.schedulable = cloned.schedulable !== 'false'
      cloned.isActive = active

      accounts.push(cloned)
    }

    const sharedIds = await client.smembers(this.SHARED_ACCOUNTS_KEY)
    for (const id of sharedIds) {
      const data = await client.hgetall(`${this.ACCOUNT_KEY_PREFIX}${id}`)
      addAccount(data)
    }

    const keys = await client.keys(`${this.ACCOUNT_KEY_PREFIX}*`)
    for (const key of keys) {
      const id = key.replace(this.ACCOUNT_KEY_PREFIX, '')
      if (!sharedIds.includes(id)) {
        const data = await client.hgetall(key)
        addAccount(data)
      }
    }

    return accounts
  }

  async markAccountRateLimited(accountId, durationMinutes = null) {
    const account = await this.getAccount(accountId)
    if (!account) {
      return
    }

    const minutes = durationMinutes || parseInt(account.rateLimitDuration || '60', 10)
    const now = new Date()
    const resetAt = new Date(now.getTime() + minutes * 60000)

    await this.updateAccount(accountId, {
      rateLimitedAt: now.toISOString(),
      rateLimitStatus: 'limited',
      rateLimitResetAt: resetAt.toISOString(),
      rateLimitDuration: minutes.toString(),
      status: 'rateLimited',
      schedulable: 'false',
      errorMessage: `Rate limited until ${resetAt.toISOString()}`
    })
  }

  async markAccountUnauthorized(accountId, reason = 'OpenAI Responses账号认证失败（401错误）') {
    const account = await this.getAccount(accountId)
    if (!account) {
      return
    }

    const now = new Date().toISOString()
    const currentCount = parseInt(account.unauthorizedCount || '0', 10)
    const newCount = Number.isFinite(currentCount) ? currentCount + 1 : 1

    await this.updateAccount(accountId, {
      status: 'unauthorized',
      schedulable: 'false',
      errorMessage: reason,
      unauthorizedAt: now,
      unauthorizedCount: newCount.toString()
    })
  }

  async checkAndClearRateLimit(accountId) {
    const account = await this.getAccount(accountId)
    if (!account || account.rateLimitStatus !== 'limited') {
      return false
    }

    const now = new Date()
    let shouldClear = false

    if (account.rateLimitResetAt) {
      shouldClear = now >= new Date(account.rateLimitResetAt)
    } else if (account.rateLimitedAt) {
      const duration = parseInt(account.rateLimitDuration || '60', 10)
      shouldClear = now - new Date(account.rateLimitedAt) > duration * 60000
    }

    if (shouldClear) {
      await this.updateAccount(accountId, {
        rateLimitedAt: '',
        rateLimitStatus: '',
        rateLimitResetAt: '',
        status: 'active',
        schedulable: 'true',
        errorMessage: ''
      })
      return true
    }

    return false
  }

  async toggleSchedulable(accountId) {
    const account = await this.getAccount(accountId)
    if (!account) {
      throw new Error('Account not found')
    }

    const next = account.schedulable === 'true' ? 'false' : 'true'
    await this.updateAccount(accountId, { schedulable: next })
    return { success: true, schedulable: next === 'true' }
  }

  async updateUsageQuota(accountId, amount) {
    const account = await this.getAccount(accountId)
    if (!account) {
      return
    }

    const today = database.getDateStringInTimezone()
    if (account.lastResetDate !== today) {
      await this.updateAccount(accountId, {
        dailyUsage: amount.toString(),
        lastResetDate: today,
        quotaStoppedAt: ''
      })
      return
    }

    const currentUsage = parseFloat(account.dailyUsage) || 0
    const newUsage = currentUsage + amount
    const dailyQuota = parseFloat(account.dailyQuota) || 0

    const updates = {
      dailyUsage: newUsage.toString()
    }

    if (dailyQuota > 0 && newUsage >= dailyQuota) {
      updates.status = 'quotaExceeded'
      updates.quotaStoppedAt = new Date().toISOString()
      updates.errorMessage = `Daily quota exceeded: $${newUsage.toFixed(2)} / $${dailyQuota.toFixed(2)}`
    }

    await this.updateAccount(accountId, updates)
  }

  async updateAccountUsage(accountId, tokens = 0) {
    const account = await this.getAccount(accountId)
    if (!account) {
      return
    }

    const updates = { lastUsedAt: new Date().toISOString() }

    if (tokens > 0) {
      const currentTokens = parseInt(account.totalUsedTokens || '0', 10)
      updates.totalUsedTokens = (currentTokens + tokens).toString()
    }

    await this.updateAccount(accountId, updates)
  }

  async recordUsage(accountId, tokens = 0) {
    return this.updateAccountUsage(accountId, tokens)
  }

  async resetAccountStatus(accountId) {
    const account = await this.getAccount(accountId)
    if (!account) {
      throw new Error('Account not found')
    }

    await this.updateAccount(accountId, {
      status: account.apiKey ? 'active' : 'created',
      schedulable: 'true',
      errorMessage: '',
      rateLimitedAt: '',
      rateLimitStatus: '',
      rateLimitResetAt: '',
      rateLimitDuration: ''
    })

    logger.info(`Reset OpenAI-Responses account status for ${accountId}`)
  }

  _getRateLimitInfo(accountData) {
    if (accountData.rateLimitStatus !== 'limited') {
      return { isRateLimited: false }
    }

    const now = new Date()
    let remainingMinutes = 0

    if (accountData.rateLimitResetAt) {
      const resetAt = new Date(accountData.rateLimitResetAt)
      remainingMinutes = Math.max(0, Math.ceil((resetAt - now) / 60000))
    } else if (accountData.rateLimitedAt) {
      const limitedAt = new Date(accountData.rateLimitedAt)
      const duration = parseInt(accountData.rateLimitDuration || '60', 10)
      const elapsed = Math.floor((now - limitedAt) / 60000)
      remainingMinutes = Math.max(0, duration - elapsed)
    }

    return {
      isRateLimited: remainingMinutes > 0,
      remainingMinutes
    }
  }

  _encryptSensitiveData(text) {
    if (!text) {
      return ''
    }

    const key = this._getEncryptionKey()
    const iv = crypto.randomBytes(16)
    const cipher = crypto.createCipheriv(this.ENCRYPTION_ALGORITHM, key, iv)

    let encrypted = cipher.update(text)
    encrypted = Buffer.concat([encrypted, cipher.final()])

    return `${iv.toString('hex')}:${encrypted.toString('hex')}`
  }

  _decryptSensitiveData(text) {
    if (!text) {
      return ''
    }

    const cacheKey = crypto.createHash('sha256').update(text).digest('hex')
    const cached = this._decryptCache.get(cacheKey)
    if (cached !== undefined) {
      return cached
    }

    try {
      const key = this._getEncryptionKey()
      const [ivHex, encryptedHex] = text.split(':')
      const iv = Buffer.from(ivHex, 'hex')
      const encrypted = Buffer.from(encryptedHex, 'hex')

      const decipher = crypto.createDecipheriv(this.ENCRYPTION_ALGORITHM, key, iv)
      let decrypted = decipher.update(encrypted)
      decrypted = Buffer.concat([decrypted, decipher.final()])
      const result = decrypted.toString()

      this._decryptCache.set(cacheKey, result, 5 * 60 * 1000)
      return result
    } catch (error) {
      logger.error('Decryption error:', error)
      return ''
    }
  }

  _getEncryptionKey() {
    if (!this._encryptionKeyCache) {
      this._encryptionKeyCache = crypto.scryptSync(
        config.security.encryptionKey,
        this.ENCRYPTION_SALT,
        32
      )
    }

    return this._encryptionKeyCache
  }

  async _saveAccount(accountId, accountData) {
    const client = database.getClientSafe()
    await client.hset(`${this.ACCOUNT_KEY_PREFIX}${accountId}`, accountData)

    if (accountData.accountType === 'shared') {
      await client.sadd(this.SHARED_ACCOUNTS_KEY, accountId)
    }
  }
}

module.exports = new OpenAIResponsesAccountService()
