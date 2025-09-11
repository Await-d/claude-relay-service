const database = require('../models/database')
const { v4: uuidv4 } = require('uuid')
const crypto = require('crypto')
const config = require('../../config/config')
const logger = require('../utils/logger')

// 加密相关常量
const ALGORITHM = 'aes-256-cbc'
const IV_LENGTH = 16

// 🚀 安全的加密密钥生成，支持动态salt
const ENCRYPTION_SALT = config.security?.azureOpenaiSalt || 'azure-openai-account-default-salt'

class EncryptionKeyManager {
  constructor() {
    this.keyCache = new Map()
    this.keyRotationInterval = 24 * 60 * 60 * 1000 // 24小时
  }

  getKey(version = 'current') {
    const cached = this.keyCache.get(version)
    if (cached && Date.now() - cached.timestamp < this.keyRotationInterval) {
      return cached.key
    }

    // 生成新密钥
    const key = crypto.scryptSync(config.security.encryptionKey, ENCRYPTION_SALT, 32)
    this.keyCache.set(version, {
      key,
      timestamp: Date.now()
    })

    logger.debug('🔑 Azure OpenAI encryption key generated/refreshed')
    return key
  }

  // 清理过期密钥
  cleanup() {
    const now = Date.now()
    for (const [version, cached] of this.keyCache.entries()) {
      if (now - cached.timestamp > this.keyRotationInterval) {
        this.keyCache.delete(version)
      }
    }
  }
}

const encryptionKeyManager = new EncryptionKeyManager()

// 定期清理过期密钥
setInterval(
  () => {
    encryptionKeyManager.cleanup()
  },
  60 * 60 * 1000
) // 每小时清理一次

// 生成加密密钥 - 使用安全的密钥管理器
function generateEncryptionKey() {
  return encryptionKeyManager.getKey()
}

// Azure OpenAI 账户键前缀
const AZURE_OPENAI_ACCOUNT_KEY_PREFIX = 'azure_openai:account:'
const SHARED_AZURE_OPENAI_ACCOUNTS_KEY = 'shared_azure_openai_accounts'
const ACCOUNT_SESSION_MAPPING_PREFIX = 'azure_openai_session_account_mapping:'

// 加密函数
function encrypt(text) {
  if (!text) {
    return ''
  }
  const key = generateEncryptionKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  let encrypted = cipher.update(text)
  encrypted = Buffer.concat([encrypted, cipher.final()])
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`
}

// 解密函数 - 移除缓存以提高安全性
function decrypt(text) {
  if (!text) {
    return ''
  }

  try {
    const key = generateEncryptionKey()
    // IV 是固定长度的 32 个十六进制字符（16 字节）
    const ivHex = text.substring(0, 32)
    const encryptedHex = text.substring(33) // 跳过冒号

    if (ivHex.length !== 32 || !encryptedHex) {
      throw new Error('Invalid encrypted text format')
    }

    const iv = Buffer.from(ivHex, 'hex')
    const encryptedText = Buffer.from(encryptedHex, 'hex')
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    let decrypted = decipher.update(encryptedText)
    decrypted = Buffer.concat([decrypted, decipher.final()])
    const result = decrypted.toString()

    return result
  } catch (error) {
    logger.error('Azure OpenAI decryption error:', error.message)
    return ''
  }
}

// 创建账户
async function createAccount(accountData) {
  const accountId = uuidv4()
  const now = new Date().toISOString()

  const account = {
    id: accountId,
    name: accountData.name,
    description: accountData.description || '',
    accountType: accountData.accountType || 'shared',
    groupId: accountData.groupId || null,
    priority: accountData.priority || 50,
    // 新增调度策略字段
    schedulingStrategy: accountData.schedulingStrategy || 'least_recent', // 调度策略
    schedulingWeight: accountData.schedulingWeight || 1, // 调度权重 (1-10)
    sequentialOrder: accountData.sequentialOrder || 1, // 顺序调度的顺序号
    roundRobinIndex: 0, // 轮询索引，初始为0
    usageCount: 0, // 使用计数，初始为0
    lastScheduledAt: '', // 最后调度时间，初始为空
    // Azure OpenAI 特有字段
    azureEndpoint: accountData.azureEndpoint || '',
    apiVersion: accountData.apiVersion || '2024-10-21', // 使用最新稳定版本
    deploymentName: accountData.deploymentName || 'gpt-4o', // 使用默认部署名称
    apiKey: encrypt(accountData.apiKey || ''),
    // 支持的模型 - 更新为最新Azure OpenAI模型
    supportedModels: JSON.stringify(
      accountData.supportedModels || [
        // GPT-4o 系列 (最新推荐)
        'gpt-4o',
        'gpt-4o-2024-11-20',
        'gpt-4o-2024-08-06',
        'gpt-4o-2024-05-13',
        'gpt-4o-mini',
        'gpt-4o-mini-2024-07-18',
        // GPT-4 Turbo 系列
        'gpt-4-turbo',
        'gpt-4-turbo-2024-04-09',
        'gpt-4-0125-preview',
        'gpt-4-1106-preview',
        // GPT-4 经典版本
        'gpt-4',
        'gpt-4-0613',
        'gpt-4-32k',
        'gpt-4-32k-0613',
        // GPT-3.5 Turbo 系列
        'gpt-35-turbo',
        'gpt-35-turbo-0125',
        'gpt-35-turbo-1106',
        'gpt-35-turbo-16k',
        'gpt-35-turbo-16k-0613',
        // O1 系列 (推理模型)
        'o1-preview',
        'o1-preview-2024-09-12',
        'o1-mini',
        'o1-mini-2024-09-12',
        // O3 系列 (最新推理模型)
        'o3-mini',
        'o3-mini-2025-01-31',
        // 嵌入模型
        'text-embedding-ada-002',
        'text-embedding-3-small',
        'text-embedding-3-large',
        // DALL-E 模型
        'dall-e-2',
        'dall-e-3'
      ]
    ),
    // 状态字段
    isActive: accountData.isActive !== false ? 'true' : 'false',
    status: 'active',
    schedulable: accountData.schedulable !== false ? 'true' : 'false',
    createdAt: now,
    updatedAt: now
  }

  // 代理配置
  if (accountData.proxy) {
    account.proxy =
      typeof accountData.proxy === 'string' ? accountData.proxy : JSON.stringify(accountData.proxy)
  }

  const client = database.getClientSafe()
  await client.hset(`${AZURE_OPENAI_ACCOUNT_KEY_PREFIX}${accountId}`, account)

  // 如果是共享账户，添加到共享账户集合
  if (account.accountType === 'shared') {
    await client.sadd(SHARED_AZURE_OPENAI_ACCOUNTS_KEY, accountId)
  }

  logger.info(`Created Azure OpenAI account: ${accountId}`)
  return account
}

// 获取账户
async function getAccount(accountId) {
  const client = database.getClientSafe()
  const accountData = await client.hgetall(`${AZURE_OPENAI_ACCOUNT_KEY_PREFIX}${accountId}`)

  if (!accountData || Object.keys(accountData).length === 0) {
    return null
  }

  // 解密敏感数据（仅用于内部处理，不返回给前端）
  if (accountData.apiKey) {
    accountData.apiKey = decrypt(accountData.apiKey)
  }

  // 解析代理配置
  if (accountData.proxy && typeof accountData.proxy === 'string') {
    try {
      accountData.proxy = JSON.parse(accountData.proxy)
    } catch (e) {
      accountData.proxy = null
    }
  }

  // 解析支持的模型
  if (accountData.supportedModels && typeof accountData.supportedModels === 'string') {
    try {
      accountData.supportedModels = JSON.parse(accountData.supportedModels)
    } catch (e) {
      accountData.supportedModels = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-35-turbo']
    }
  }

  return accountData
}

// 更新账户
async function updateAccount(accountId, updates) {
  const existingAccount = await getAccount(accountId)
  if (!existingAccount) {
    throw new Error('Account not found')
  }

  updates.updatedAt = new Date().toISOString()

  // 加密敏感数据
  if (updates.apiKey) {
    updates.apiKey = encrypt(updates.apiKey)
  }

  // 处理代理配置
  if (updates.proxy) {
    updates.proxy =
      typeof updates.proxy === 'string' ? updates.proxy : JSON.stringify(updates.proxy)
  }

  // 处理支持的模型
  if (updates.supportedModels) {
    updates.supportedModels =
      typeof updates.supportedModels === 'string'
        ? updates.supportedModels
        : JSON.stringify(updates.supportedModels)
  }

  // 处理调度策略字段
  if (updates.schedulingWeight !== undefined) {
    updates.schedulingWeight = parseInt(updates.schedulingWeight) || 1
  }
  if (updates.sequentialOrder !== undefined) {
    updates.sequentialOrder = parseInt(updates.sequentialOrder) || 1
  }
  if (updates.roundRobinIndex !== undefined) {
    updates.roundRobinIndex = parseInt(updates.roundRobinIndex) || 0
  }
  if (updates.usageCount !== undefined) {
    updates.usageCount = parseInt(updates.usageCount) || 0
  }

  // 更新账户类型时处理共享账户集合
  const client = database.getClientSafe()
  if (updates.accountType && updates.accountType !== existingAccount.accountType) {
    if (updates.accountType === 'shared') {
      await client.sadd(SHARED_AZURE_OPENAI_ACCOUNTS_KEY, accountId)
    } else {
      await client.srem(SHARED_AZURE_OPENAI_ACCOUNTS_KEY, accountId)
    }
  }

  await client.hset(`${AZURE_OPENAI_ACCOUNT_KEY_PREFIX}${accountId}`, updates)

  logger.info(`Updated Azure OpenAI account: ${accountId}`)

  // 合并更新后的账户数据
  const updatedAccount = { ...existingAccount, ...updates }

  // 返回时解析代理配置
  if (updatedAccount.proxy && typeof updatedAccount.proxy === 'string') {
    try {
      updatedAccount.proxy = JSON.parse(updatedAccount.proxy)
    } catch (e) {
      updatedAccount.proxy = null
    }
  }

  return updatedAccount
}

// 删除账户
async function deleteAccount(accountId) {
  const client = database.getClientSafe()
  const accountKey = `${AZURE_OPENAI_ACCOUNT_KEY_PREFIX}${accountId}`

  // 从Redis中删除账户数据
  await client.del(accountKey)

  // 从共享账户集合中移除
  await client.srem(SHARED_AZURE_OPENAI_ACCOUNTS_KEY, accountId)

  logger.info(`Deleted Azure OpenAI account: ${accountId}`)
  return true
}

// 获取所有账户
async function getAllAccounts() {
  const client = database.getClientSafe()
  const keys = await client.keys(`${AZURE_OPENAI_ACCOUNT_KEY_PREFIX}*`)

  if (!keys || keys.length === 0) {
    return []
  }

  const accounts = []
  for (const key of keys) {
    const accountData = await client.hgetall(key)
    if (accountData && Object.keys(accountData).length > 0) {
      // 不返回敏感数据给前端
      delete accountData.apiKey

      // 解析代理配置
      if (accountData.proxy && typeof accountData.proxy === 'string') {
        try {
          accountData.proxy = JSON.parse(accountData.proxy)
        } catch (e) {
          accountData.proxy = null
        }
      }

      // 解析支持的模型
      if (accountData.supportedModels && typeof accountData.supportedModels === 'string') {
        try {
          accountData.supportedModels = JSON.parse(accountData.supportedModels)
        } catch (e) {
          accountData.supportedModels = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-35-turbo']
        }
      }

      accounts.push(accountData)
    }
  }

  return accounts
}

// 获取共享账户
async function getSharedAccounts() {
  const client = database.getClientSafe()
  const accountIds = await client.smembers(SHARED_AZURE_OPENAI_ACCOUNTS_KEY)

  if (!accountIds || accountIds.length === 0) {
    return []
  }

  const accounts = []
  for (const accountId of accountIds) {
    const account = await getAccount(accountId)
    if (account && account.isActive === 'true') {
      accounts.push(account)
    }
  }

  return accounts
}

// 选择可用账户
async function selectAvailableAccount(sessionId = null) {
  // 如果有会话ID，尝试获取之前分配的账户
  if (sessionId) {
    const client = database.getClientSafe()
    const mappingKey = `${ACCOUNT_SESSION_MAPPING_PREFIX}${sessionId}`
    const accountId = await client.get(mappingKey)

    if (accountId) {
      const account = await getAccount(accountId)
      if (account && account.isActive === 'true' && account.schedulable === 'true') {
        logger.debug(`Reusing Azure OpenAI account ${accountId} for session ${sessionId}`)
        return account
      }
    }
  }

  // 获取所有共享账户
  const sharedAccounts = await getSharedAccounts()

  // 过滤出可用的账户
  const availableAccounts = sharedAccounts.filter(
    (acc) => acc.isActive === 'true' && acc.schedulable === 'true'
  )

  if (availableAccounts.length === 0) {
    throw new Error('No available Azure OpenAI accounts')
  }

  // 按优先级排序并选择
  availableAccounts.sort((a, b) => (b.priority || 50) - (a.priority || 50))
  const selectedAccount = availableAccounts[0]

  // 如果有会话ID，保存映射关系
  if (sessionId && selectedAccount) {
    const client = database.getClientSafe()
    const mappingKey = `${ACCOUNT_SESSION_MAPPING_PREFIX}${sessionId}`
    await client.setex(mappingKey, 3600, selectedAccount.id) // 1小时过期
  }

  logger.debug(`Selected Azure OpenAI account: ${selectedAccount.id}`)
  return selectedAccount
}

// 更新账户使用量
async function updateAccountUsage(accountId, tokens) {
  const client = database.getClientSafe()
  const now = new Date().toISOString()

  // 使用 HINCRBY 原子操作更新使用量
  await client.hincrby(`${AZURE_OPENAI_ACCOUNT_KEY_PREFIX}${accountId}`, 'totalTokensUsed', tokens)
  await client.hset(`${AZURE_OPENAI_ACCOUNT_KEY_PREFIX}${accountId}`, 'lastUsedAt', now)

  logger.debug(`Updated Azure OpenAI account ${accountId} usage: ${tokens} tokens`)
}

// 增强的健康检查单个账户
async function healthCheckAccount(accountId, options = {}) {
  const { performApiTest = false, timeout = 10000 } = options

  try {
    const account = await getAccount(accountId)
    if (!account) {
      return {
        id: accountId,
        status: 'error',
        message: 'Account not found',
        timestamp: new Date().toISOString()
      }
    }

    const checks = {
      configuration: { status: 'unknown', details: {} },
      connectivity: { status: 'unknown', details: {} },
      model: { status: 'unknown', details: {} },
      endpoint: { status: 'unknown', details: {} }
    }

    // 1. 配置检查
    const configCheck = validateAccountConfiguration(account)
    checks.configuration = configCheck

    if (configCheck.status === 'error') {
      return {
        id: accountId,
        status: 'error',
        message: configCheck.message,
        checks,
        timestamp: new Date().toISOString()
      }
    }

    // 2. 模型支持检查
    const modelCheck = validateModelSupport(account.deploymentName)
    checks.model = {
      status: modelCheck.supported ? 'healthy' : 'warning',
      message: modelCheck.supported
        ? `Model '${account.deploymentName}' is supported`
        : modelCheck.message,
      details: {
        deploymentName: account.deploymentName,
        modelInfo: modelCheck.modelInfo || null,
        pricing: modelCheck.pricing || null,
        suggestions: modelCheck.suggestions || []
      }
    }

    // 3. 端点格式检查
    const endpointCheck = validateAzureEndpoint(account.azureEndpoint)
    checks.endpoint = endpointCheck

    // 4. 如果需要，执行API连接测试
    if (performApiTest) {
      try {
        const connectivityCheck = await testAzureOpenAIConnection(account, timeout)
        checks.connectivity = connectivityCheck
      } catch (error) {
        checks.connectivity = {
          status: 'error',
          message: `API connectivity test failed: ${error.message}`,
          details: { error: error.message }
        }
      }
    } else {
      checks.connectivity = {
        status: 'skipped',
        message: 'API connectivity test not requested',
        details: { reason: 'performApiTest option is false' }
      }
    }

    // 综合评估健康状态
    let overallStatus = 'healthy'
    const messages = []

    Object.values(checks).forEach((check) => {
      if (check.status === 'error') {
        overallStatus = 'error'
        messages.push(check.message)
      } else if (check.status === 'warning' && overallStatus !== 'error') {
        overallStatus = 'warning'
        messages.push(check.message)
      }
    })

    return {
      id: accountId,
      status: overallStatus,
      message: messages.length > 0 ? messages.join('; ') : 'All checks passed',
      checks,
      summary: {
        accountName: account.name || 'Unnamed Account',
        azureEndpoint: account.azureEndpoint,
        deploymentName: account.deploymentName,
        apiVersion: account.apiVersion,
        supportedModelsCount: account.supportedModels ? account.supportedModels.length : 0
      },
      timestamp: new Date().toISOString()
    }
  } catch (error) {
    logger.error(`Health check failed for Azure OpenAI account ${accountId}:`, error)
    return {
      id: accountId,
      status: 'error',
      message: `Health check failed: ${error.message}`,
      checks: {},
      timestamp: new Date().toISOString(),
      error: error.message
    }
  }
}

// 验证账户配置
function validateAccountConfiguration(account) {
  const requiredFields = {
    azureEndpoint: 'Azure endpoint URL',
    apiKey: 'API key',
    deploymentName: 'Deployment name',
    apiVersion: 'API version'
  }

  const missingFields = []
  const details = {}

  Object.entries(requiredFields).forEach(([field, description]) => {
    const value = account[field]
    if (!value || (typeof value === 'string' && value.trim() === '')) {
      missingFields.push(description)
    } else {
      details[field] = field === 'apiKey' ? '[PRESENT]' : value
    }
  })

  if (missingFields.length > 0) {
    return {
      status: 'error',
      message: `Missing required configuration: ${missingFields.join(', ')}`,
      details
    }
  }

  return {
    status: 'healthy',
    message: 'All required configuration fields are present',
    details
  }
}

// 验证Azure端点URL格式
function validateAzureEndpoint(endpoint) {
  if (!endpoint) {
    return {
      status: 'error',
      message: 'Azure endpoint is required',
      details: {}
    }
  }

  try {
    const url = new URL(endpoint)

    // 检查是否是Azure OpenAI的正确格式
    const isValidAzureEndpoint =
      url.hostname.endsWith('.openai.azure.com') ||
      url.hostname.endsWith('.cognitiveservices.azure.com')

    if (!isValidAzureEndpoint) {
      return {
        status: 'warning',
        message: 'Endpoint URL format may not be a valid Azure OpenAI endpoint',
        details: {
          endpoint,
          hostname: url.hostname,
          expectedFormat: 'https://your-resource.openai.azure.com'
        }
      }
    }

    return {
      status: 'healthy',
      message: 'Azure endpoint URL format is valid',
      details: {
        endpoint,
        hostname: url.hostname,
        protocol: url.protocol
      }
    }
  } catch (error) {
    return {
      status: 'error',
      message: `Invalid endpoint URL format: ${error.message}`,
      details: {
        endpoint,
        error: error.message
      }
    }
  }
}

// 测试Azure OpenAI API连接
async function testAzureOpenAIConnection(account, timeout = 10000) {
  const axios = require('axios')
  const ProxyHelper = require('../utils/proxyHelper')

  try {
    // 构建测试请求URL (使用deployments端点来测试连接)
    const testUrl = `${account.azureEndpoint}/openai/deployments/${account.deploymentName}/chat/completions?api-version=${account.apiVersion}`

    const requestOptions = {
      method: 'POST',
      url: testUrl,
      headers: {
        'Content-Type': 'application/json',
        'api-key': account.apiKey
      },
      data: {
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 1,
        temperature: 0
      },
      timeout,
      validateStatus: (status) => status < 500 // 接受400-499的状态码，只抒5xx作为错误
    }

    // 配置代理（如果有）
    const proxyAgent = ProxyHelper.createProxyAgent(account.proxy)
    if (proxyAgent) {
      requestOptions.httpsAgent = proxyAgent
    }

    const startTime = Date.now()
    const response = await axios(requestOptions)
    const responseTime = Date.now() - startTime

    // 分析响应
    if (response.status === 200) {
      return {
        status: 'healthy',
        message: 'API connection successful',
        details: {
          responseTime: `${responseTime}ms`,
          statusCode: response.status,
          hasValidResponse: true
        }
      }
    } else if (response.status === 400) {
      // 400状态可能意味着API可访问，但请求格式有问题
      return {
        status: 'warning',
        message: 'API accessible but request format may need adjustment',
        details: {
          responseTime: `${responseTime}ms`,
          statusCode: response.status,
          responseData: response.data
        }
      }
    } else if (response.status === 401) {
      return {
        status: 'error',
        message: 'Authentication failed - check API key',
        details: {
          responseTime: `${responseTime}ms`,
          statusCode: response.status
        }
      }
    } else if (response.status === 404) {
      return {
        status: 'error',
        message: 'Deployment not found - check deployment name',
        details: {
          responseTime: `${responseTime}ms`,
          statusCode: response.status,
          deploymentName: account.deploymentName
        }
      }
    } else {
      return {
        status: 'warning',
        message: `API responded with status ${response.status}`,
        details: {
          responseTime: `${responseTime}ms`,
          statusCode: response.status,
          responseData: response.data
        }
      }
    }
  } catch (error) {
    if (error.code === 'ECONNABORTED') {
      return {
        status: 'error',
        message: 'Connection timeout - check network or endpoint URL',
        details: {
          timeout,
          error: 'ECONNABORTED'
        }
      }
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return {
        status: 'error',
        message: 'Cannot reach Azure OpenAI endpoint - check URL and network',
        details: {
          error: error.code,
          hostname: error.hostname || 'unknown'
        }
      }
    } else {
      return {
        status: 'error',
        message: `Connection test failed: ${error.message}`,
        details: {
          error: error.message,
          code: error.code || 'unknown'
        }
      }
    }
  }
}

// 增强的批量健康检查
async function performHealthChecks(options = {}) {
  const {
    performApiTest = false,
    timeout = 10000,
    parallel = true,
    accountIds = null // 可选：指定要检查的账户ID列表
  } = options

  let accounts
  if (accountIds && Array.isArray(accountIds)) {
    // 只检查指定的账户
    accounts = []
    for (const accountId of accountIds) {
      const account = await getAccount(accountId)
      if (account) {
        accounts.push(account)
      }
    }
  } else {
    // 检查所有账户
    accounts = await getAllAccounts()
  }

  const startTime = Date.now()
  let results = []

  if (parallel) {
    // 并行执行健康检查
    const promises = accounts.map((account) =>
      healthCheckAccount(account.id, { performApiTest, timeout })
    )
    results = await Promise.all(promises)
  } else {
    // 串行执行健康检查
    for (const account of accounts) {
      const result = await healthCheckAccount(account.id, { performApiTest, timeout })
      results.push(result)
    }
  }

  const totalTime = Date.now() - startTime

  // 统计结果
  const summary = {
    total: results.length,
    healthy: results.filter((r) => r.status === 'healthy').length,
    warning: results.filter((r) => r.status === 'warning').length,
    error: results.filter((r) => r.status === 'error').length,
    executionTime: `${totalTime}ms`,
    executionMode: parallel ? 'parallel' : 'sequential',
    performedApiTests: performApiTest
  }

  logger.info(
    `Azure OpenAI health check completed: ${summary.healthy}/${summary.total} accounts healthy (${summary.executionTime})`
  )

  return {
    results,
    summary,
    timestamp: new Date().toISOString()
  }
}

// 切换账户的可调度状态
async function toggleSchedulable(accountId) {
  const account = await getAccount(accountId)
  if (!account) {
    throw new Error('Account not found')
  }

  const newSchedulable = account.schedulable === 'true' ? 'false' : 'true'
  await updateAccount(accountId, { schedulable: newSchedulable })

  return {
    id: accountId,
    schedulable: newSchedulable === 'true'
  }
}

// 迁移 API Keys 以支持 Azure OpenAI
async function migrateApiKeysForAzureSupport() {
  const client = database.getClientSafe()
  const apiKeyIds = await client.smembers('api_keys')

  let migratedCount = 0
  for (const keyId of apiKeyIds) {
    const keyData = await client.hgetall(`api_key:${keyId}`)
    if (keyData && !keyData.azureOpenaiAccountId) {
      // 添加 Azure OpenAI 账户ID字段（初始为空）
      await client.hset(`api_key:${keyId}`, 'azureOpenaiAccountId', '')
      migratedCount++
    }
  }

  logger.info(`Migrated ${migratedCount} API keys for Azure OpenAI support`)
  return migratedCount
}

// 🔄 更新账户调度相关字段（用于调度算法）
async function updateAccountSchedulingFields(accountId, updates) {
  try {
    const client = database.getClientSafe()
    const accountKey = `${AZURE_OPENAI_ACCOUNT_KEY_PREFIX}${accountId}`

    // 将数字字段转换为字符串存储
    const processedUpdates = {}
    Object.keys(updates).forEach((key) => {
      if (['schedulingWeight', 'sequentialOrder', 'roundRobinIndex', 'usageCount'].includes(key)) {
        processedUpdates[key] = updates[key].toString()
      } else {
        processedUpdates[key] = updates[key]
      }
    })

    // 添加更新时间
    processedUpdates.updatedAt = new Date().toISOString()

    await client.hmset(accountKey, processedUpdates)
    logger.debug(`🔄 Updated Azure OpenAI scheduling fields for account ${accountId}:`, updates)
    return { success: true }
  } catch (error) {
    logger.error(
      `❌ Failed to update Azure OpenAI scheduling fields for account ${accountId}:`,
      error
    )
    throw error
  }
}

// 🔢 增加账户使用计数并更新最后调度时间
async function recordAccountUsage(accountId) {
  try {
    const client = database.getClientSafe()
    const accountKey = `${AZURE_OPENAI_ACCOUNT_KEY_PREFIX}${accountId}`

    // 获取当前使用计数
    const currentUsageCount = await client.hget(accountKey, 'usageCount')
    const usageCount = parseInt(currentUsageCount || '0') + 1

    // 更新使用计数和最后调度时间
    await client.hmset(accountKey, {
      usageCount: usageCount.toString(),
      lastScheduledAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })

    logger.debug(
      `🔢 Recorded usage for Azure OpenAI account ${accountId}, new count: ${usageCount}`
    )
    return { success: true, usageCount }
  } catch (error) {
    logger.error(`❌ Failed to record usage for Azure OpenAI account ${accountId}:`, error)
    throw error
  }
}

// 更新完成任务状态
logger.info('Azure OpenAI Account Service updated with latest models and pricing information')

module.exports = {
  createAccount,
  getAccount,
  updateAccount,
  deleteAccount,
  getAllAccounts,
  getSharedAccounts,
  selectAvailableAccount,
  updateAccountUsage,
  healthCheckAccount,
  performHealthChecks,
  toggleSchedulable,
  migrateApiKeysForAzureSupport,
  // 新增调度相关方法
  updateAccountSchedulingFields,
  recordAccountUsage,
  // 增强的健康检查方法
  validateAccountConfiguration,
  validateAzureEndpoint,
  testAzureOpenAIConnection,
  // 模型能力检测方法
  detectModelCapabilities,
  analyzeRequestCapabilityNeeds,
  generateCapabilityRecommendations,
  getModelRecommendations,
  // 费用统计方法
  getAccountCostStats: async (accountId, options = {}) => {
    const AccountCostService = require('./accountCostService')
    const _localLogger = require('../utils/logger')

    try {
      if (!accountId) {
        throw new Error('Account ID is required')
      }

      const accountData = await require('./azureOpenaiAccountService').getAccount(accountId)
      if (!accountData) {
        throw new Error('Account not found')
      }

      const costStats = await AccountCostService.getAccountCostStats(
        accountId,
        'azure_openai',
        options
      )
      costStats.accountName = accountData.name

      logger.debug(
        `📊 Retrieved cost stats for Azure OpenAI account ${accountId}: $${(costStats.totalCost || 0).toFixed(6)} (${options.period || 'all'})`
      )

      return costStats
    } catch (error) {
      logger.error(`❌ Failed to get cost stats for Azure OpenAI account ${accountId}:`, error)
      throw error
    }
  },
  encrypt,
  decrypt,
  // 新增功能：Azure OpenAI模型信息
  getModelInfo,
  getSupportedModels,
  getModelPricing,
  validateModelSupport
}

// Azure OpenAI 模型信息配置
const AZURE_OPENAI_MODELS = {
  // GPT-4o 系列 (最新推荐)
  'gpt-4o': {
    name: 'GPT-4o',
    family: 'gpt-4o',
    contextWindow: 128000,
    maxOutput: 16384,
    capabilities: ['text', 'vision', 'json_mode', 'function_calling'],
    isLatest: true,
    recommended: true,
    description: 'GPT-4o是最先进的多模态模型，比GPT-4 Turbo更快更便宜，具有强大的视觉能力'
  },
  'gpt-4o-2024-11-20': {
    name: 'GPT-4o (2024-11-20)',
    family: 'gpt-4o',
    contextWindow: 128000,
    maxOutput: 16384,
    capabilities: ['text', 'vision', 'json_mode', 'function_calling'],
    isLatest: false,
    recommended: false
  },
  'gpt-4o-2024-08-06': {
    name: 'GPT-4o (2024-08-06)',
    family: 'gpt-4o',
    contextWindow: 128000,
    maxOutput: 16384,
    capabilities: ['text', 'vision', 'json_mode', 'function_calling'],
    isLatest: false,
    recommended: false
  },
  'gpt-4o-2024-05-13': {
    name: 'GPT-4o (2024-05-13)',
    family: 'gpt-4o',
    contextWindow: 128000,
    maxOutput: 4096,
    capabilities: ['text', 'vision', 'json_mode', 'function_calling'],
    isLatest: false,
    recommended: false
  },
  'gpt-4o-mini': {
    name: 'GPT-4o Mini',
    family: 'gpt-4o-mini',
    contextWindow: 128000,
    maxOutput: 16384,
    capabilities: ['text', 'vision', 'json_mode', 'function_calling'],
    isLatest: true,
    recommended: true,
    description: 'GPT-4o mini是最具成本效益的小型模型，具有视觉能力'
  },
  'gpt-4o-mini-2024-07-18': {
    name: 'GPT-4o Mini (2024-07-18)',
    family: 'gpt-4o-mini',
    contextWindow: 128000,
    maxOutput: 16384,
    capabilities: ['text', 'vision', 'json_mode', 'function_calling'],
    isLatest: false,
    recommended: false
  },

  // GPT-4 Turbo 系列
  'gpt-4-turbo': {
    name: 'GPT-4 Turbo',
    family: 'gpt-4-turbo',
    contextWindow: 128000,
    maxOutput: 4096,
    capabilities: ['text', 'vision', 'json_mode', 'function_calling'],
    isLatest: true,
    recommended: false,
    description: 'GPT-4 Turbo具有更大的上下文窗口和更新的知识库'
  },
  'gpt-4-turbo-2024-04-09': {
    name: 'GPT-4 Turbo (2024-04-09)',
    family: 'gpt-4-turbo',
    contextWindow: 128000,
    maxOutput: 4096,
    capabilities: ['text', 'vision', 'json_mode', 'function_calling'],
    isLatest: false,
    recommended: false
  },
  'gpt-4-0125-preview': {
    name: 'GPT-4 Turbo Preview (0125)',
    family: 'gpt-4-turbo',
    contextWindow: 128000,
    maxOutput: 4096,
    capabilities: ['text', 'json_mode', 'function_calling'],
    isLatest: false,
    recommended: false
  },
  'gpt-4-1106-preview': {
    name: 'GPT-4 Turbo Preview (1106)',
    family: 'gpt-4-turbo',
    contextWindow: 128000,
    maxOutput: 4096,
    capabilities: ['text', 'vision', 'json_mode', 'function_calling'],
    isLatest: false,
    recommended: false
  },

  // GPT-4 经典版本
  'gpt-4': {
    name: 'GPT-4',
    family: 'gpt-4',
    contextWindow: 8192,
    maxOutput: 4096,
    capabilities: ['text', 'function_calling'],
    isLatest: true,
    recommended: false,
    description: 'GPT-4是一个大型多模态模型，在复杂任务上表现出色'
  },
  'gpt-4-0613': {
    name: 'GPT-4 (0613)',
    family: 'gpt-4',
    contextWindow: 8192,
    maxOutput: 4096,
    capabilities: ['text', 'function_calling'],
    isLatest: false,
    recommended: false
  },
  'gpt-4-32k': {
    name: 'GPT-4 32K',
    family: 'gpt-4',
    contextWindow: 32768,
    maxOutput: 4096,
    capabilities: ['text', 'function_calling'],
    isLatest: true,
    recommended: false,
    description: 'GPT-4的32K上下文版本，适合长文档处理'
  },
  'gpt-4-32k-0613': {
    name: 'GPT-4 32K (0613)',
    family: 'gpt-4',
    contextWindow: 32768,
    maxOutput: 4096,
    capabilities: ['text', 'function_calling'],
    isLatest: false,
    recommended: false
  },

  // GPT-3.5 Turbo 系列
  'gpt-35-turbo': {
    name: 'GPT-3.5 Turbo',
    family: 'gpt-35-turbo',
    contextWindow: 16385,
    maxOutput: 4096,
    capabilities: ['text', 'function_calling'],
    isLatest: true,
    recommended: true,
    description: 'GPT-3.5 Turbo是针对对话进行优化的模型，响应速度快'
  },
  'gpt-35-turbo-0125': {
    name: 'GPT-3.5 Turbo (0125)',
    family: 'gpt-35-turbo',
    contextWindow: 16385,
    maxOutput: 4096,
    capabilities: ['text', 'function_calling'],
    isLatest: false,
    recommended: false
  },
  'gpt-35-turbo-1106': {
    name: 'GPT-3.5 Turbo (1106)',
    family: 'gpt-35-turbo',
    contextWindow: 16385,
    maxOutput: 4096,
    capabilities: ['text', 'json_mode', 'function_calling'],
    isLatest: false,
    recommended: false
  },
  'gpt-35-turbo-16k': {
    name: 'GPT-3.5 Turbo 16K',
    family: 'gpt-35-turbo',
    contextWindow: 16385,
    maxOutput: 4096,
    capabilities: ['text', 'function_calling'],
    isLatest: true,
    recommended: false,
    description: 'GPT-3.5 Turbo的16K上下文版本'
  },
  'gpt-35-turbo-16k-0613': {
    name: 'GPT-3.5 Turbo 16K (0613)',
    family: 'gpt-35-turbo',
    contextWindow: 16385,
    maxOutput: 4096,
    capabilities: ['text', 'function_calling'],
    isLatest: false,
    recommended: false
  },

  // O1 系列 (推理模型)
  'o1-preview': {
    name: 'O1 Preview',
    family: 'o1',
    contextWindow: 128000,
    maxOutput: 32768,
    capabilities: ['reasoning', 'text', 'complex_problem_solving'],
    isLatest: true,
    recommended: true,
    description: 'O1是一个强大的推理模型，在编码、数学、科学和视觉感知方面表现出色',
    specialNotes: '需要注册并基于Microsoft的资格标准授予访问权限'
  },
  'o1-preview-2024-09-12': {
    name: 'O1 Preview (2024-09-12)',
    family: 'o1',
    contextWindow: 128000,
    maxOutput: 32768,
    capabilities: ['reasoning', 'text', 'complex_problem_solving'],
    isLatest: false,
    recommended: false
  },
  'o1-mini': {
    name: 'O1 Mini',
    family: 'o1-mini',
    contextWindow: 128000,
    maxOutput: 65536,
    capabilities: ['reasoning', 'text', 'complex_problem_solving'],
    isLatest: true,
    recommended: true,
    description: 'O1 mini是更经济的推理模型版本，适合复杂的推理任务',
    specialNotes: '具有强化的推理能力和128K输入上下文'
  },
  'o1-mini-2024-09-12': {
    name: 'O1 Mini (2024-09-12)',
    family: 'o1-mini',
    contextWindow: 128000,
    maxOutput: 65536,
    capabilities: ['reasoning', 'text', 'complex_problem_solving'],
    isLatest: false,
    recommended: false
  },

  // O3 系列 (最新推理模型)
  'o3-mini': {
    name: 'O3 Mini',
    family: 'o3-mini',
    contextWindow: 200000,
    maxOutput: 100000,
    capabilities: ['reasoning', 'text', 'complex_problem_solving', 'multi_faceted_analysis'],
    isLatest: true,
    recommended: true,
    description: 'O3 mini是最新的推理模型，具有扩展的200K上下文输入窗口和100K最大输出',
    specialNotes: '推理模型前沿，在编码、数学、科学和视觉感知方面推进边界'
  },
  'o3-mini-2025-01-31': {
    name: 'O3 Mini (2025-01-31)',
    family: 'o3-mini',
    contextWindow: 200000,
    maxOutput: 100000,
    capabilities: ['reasoning', 'text', 'complex_problem_solving', 'multi_faceted_analysis'],
    isLatest: false,
    recommended: false
  },

  // 嵌入模型
  'text-embedding-ada-002': {
    name: 'Text Embedding Ada 002',
    family: 'embedding',
    contextWindow: 8191,
    maxOutput: null,
    capabilities: ['text_embedding'],
    isLatest: false,
    recommended: false,
    description: '第二代Ada嵌入模型'
  },
  'text-embedding-3-small': {
    name: 'Text Embedding 3 Small',
    family: 'embedding',
    contextWindow: 8191,
    maxOutput: null,
    capabilities: ['text_embedding'],
    isLatest: true,
    recommended: true,
    description: '第三代小型嵌入模型，性能更优'
  },
  'text-embedding-3-large': {
    name: 'Text Embedding 3 Large',
    family: 'embedding',
    contextWindow: 8191,
    maxOutput: null,
    capabilities: ['text_embedding'],
    isLatest: true,
    recommended: true,
    description: '第三代大型嵌入模型，最高性能'
  },

  // DALL-E 模型
  'dall-e-2': {
    name: 'DALL-E 2',
    family: 'dall-e',
    contextWindow: 1000,
    maxOutput: null,
    capabilities: ['image_generation'],
    isLatest: false,
    recommended: false,
    description: 'DALL-E 2图像生成模型'
  },
  'dall-e-3': {
    name: 'DALL-E 3',
    family: 'dall-e',
    contextWindow: 4000,
    maxOutput: null,
    capabilities: ['image_generation'],
    isLatest: true,
    recommended: true,
    description: 'DALL-E 3是最新的图像生成模型，质量更高'
  }
}

// Azure OpenAI 模型定价配置 (USD per 1K tokens)
// 注意：Azure OpenAI的定价可能因地区而异，这里提供基础定价参考
const AZURE_OPENAI_PRICING = {
  // GPT-4o 系列
  'gpt-4o': { input: 0.0025, output: 0.01, cached: 0.00125 },
  'gpt-4o-2024-11-20': { input: 0.0025, output: 0.01, cached: 0.00125 },
  'gpt-4o-2024-08-06': { input: 0.0025, output: 0.01, cached: 0.00125 },
  'gpt-4o-2024-05-13': { input: 0.0025, output: 0.01, cached: 0.00125 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006, cached: 0.000075 },
  'gpt-4o-mini-2024-07-18': { input: 0.00015, output: 0.0006, cached: 0.000075 },

  // GPT-4 Turbo 系列
  'gpt-4-turbo': { input: 0.01, output: 0.03, cached: 0.005 },
  'gpt-4-turbo-2024-04-09': { input: 0.01, output: 0.03, cached: 0.005 },
  'gpt-4-0125-preview': { input: 0.01, output: 0.03, cached: 0.005 },
  'gpt-4-1106-preview': { input: 0.01, output: 0.03, cached: 0.005 },

  // GPT-4 经典版本
  'gpt-4': { input: 0.03, output: 0.06, cached: 0.015 },
  'gpt-4-0613': { input: 0.03, output: 0.06, cached: 0.015 },
  'gpt-4-32k': { input: 0.06, output: 0.12, cached: 0.03 },
  'gpt-4-32k-0613': { input: 0.06, output: 0.12, cached: 0.03 },

  // GPT-3.5 Turbo 系列
  'gpt-35-turbo': { input: 0.0005, output: 0.0015, cached: 0.00025 },
  'gpt-35-turbo-0125': { input: 0.0005, output: 0.0015, cached: 0.00025 },
  'gpt-35-turbo-1106': { input: 0.001, output: 0.002, cached: 0.0005 },
  'gpt-35-turbo-16k': { input: 0.003, output: 0.004, cached: 0.0015 },
  'gpt-35-turbo-16k-0613': { input: 0.003, output: 0.004, cached: 0.0015 },

  // O1 系列 (推理模型 - 更高定价)
  'o1-preview': { input: 0.015, output: 0.06, cached: 0.0075 },
  'o1-preview-2024-09-12': { input: 0.015, output: 0.06, cached: 0.0075 },
  'o1-mini': { input: 0.003, output: 0.012, cached: 0.0015 },
  'o1-mini-2024-09-12': { input: 0.003, output: 0.012, cached: 0.0015 },

  // O3 系列 (最新推理模型)
  'o3-mini': { input: 0.0035, output: 0.014, cached: 0.00175 },
  'o3-mini-2025-01-31': { input: 0.0035, output: 0.014, cached: 0.00175 },

  // 嵌入模型
  'text-embedding-ada-002': { input: 0.0001, output: 0, cached: 0 },
  'text-embedding-3-small': { input: 0.00002, output: 0, cached: 0 },
  'text-embedding-3-large': { input: 0.00013, output: 0, cached: 0 },

  // DALL-E 模型 (按图像计费，这里用占位符)
  'dall-e-2': { input: 0, output: 0, cached: 0, imagePrice: 0.02 }, // $0.02/image (1024x1024)
  'dall-e-3': { input: 0, output: 0, cached: 0, imagePrice: 0.04 } // $0.04/image (1024x1024)
}

// 获取模型信息
function getModelInfo(modelName) {
  if (!modelName) {
    return null
  }

  // 直接匹配
  if (AZURE_OPENAI_MODELS[modelName]) {
    return AZURE_OPENAI_MODELS[modelName]
  }

  // 模糊匹配 - 处理版本变体
  const normalizedModel = modelName.toLowerCase().replace(/[-_]/g, '')

  for (const [key, modelInfo] of Object.entries(AZURE_OPENAI_MODELS)) {
    const normalizedKey = key.toLowerCase().replace(/[-_]/g, '')
    if (normalizedKey === normalizedModel) {
      return modelInfo
    }
  }

  logger.debug(`Azure OpenAI model info not found for: ${modelName}`)
  return null
}

// 获取所有支持的模型
function getSupportedModels(options = {}) {
  const { recommended = false, family = null, capabilities = null } = options

  let models = Object.entries(AZURE_OPENAI_MODELS)

  // 筛选推荐模型
  if (recommended) {
    models = models.filter(([, info]) => info.recommended)
  }

  // 筛选模型系列
  if (family) {
    models = models.filter(([, info]) => info.family === family)
  }

  // 筛选功能
  if (capabilities) {
    const requiredCaps = Array.isArray(capabilities) ? capabilities : [capabilities]
    models = models.filter(([, info]) =>
      requiredCaps.every((cap) => info.capabilities.includes(cap))
    )
  }

  return models.map(([name, info]) => ({ name, ...info }))
}

// 获取模型定价
function getModelPricing(modelName) {
  if (!modelName) {
    return null
  }

  return AZURE_OPENAI_PRICING[modelName] || null
}

// 验证模型是否支持
function validateModelSupport(modelName) {
  if (!modelName) {
    return {
      supported: false,
      message: 'Model name is required'
    }
  }

  const modelInfo = getModelInfo(modelName)
  if (!modelInfo) {
    return {
      supported: false,
      message: `Model '${modelName}' is not supported by Azure OpenAI service`,
      suggestions: getSupportedModels({ recommended: true })
        .map((m) => m.name)
        .slice(0, 3)
    }
  }

  return {
    supported: true,
    modelInfo,
    pricing: getModelPricing(modelName)
  }
}

// 检测模型能力
function detectModelCapabilities(modelName, requestPayload = {}) {
  const modelInfo = getModelInfo(modelName)
  if (!modelInfo) {
    return {
      supported: false,
      message: `Model '${modelName}' information not available`,
      capabilities: []
    }
  }

  const detectedCapabilities = {
    textGeneration: modelInfo.capabilities.includes('text'),
    visionSupport: modelInfo.capabilities.includes('vision'),
    functionCalling: modelInfo.capabilities.includes('function_calling'),
    jsonMode: modelInfo.capabilities.includes('json_mode'),
    reasoning: modelInfo.capabilities.includes('reasoning'),
    complexProblemSolving: modelInfo.capabilities.includes('complex_problem_solving'),
    multiModalAnalysis: modelInfo.capabilities.includes('multi_faceted_analysis'),
    textEmbedding: modelInfo.capabilities.includes('text_embedding'),
    imageGeneration: modelInfo.capabilities.includes('image_generation')
  }

  // 根据请求内容进行进一步分析
  const analysisResult = analyzeRequestCapabilityNeeds(requestPayload, detectedCapabilities)

  return {
    supported: true,
    modelName,
    modelInfo,
    capabilities: detectedCapabilities,
    analysis: analysisResult,
    recommendations: generateCapabilityRecommendations(
      modelInfo,
      detectedCapabilities,
      analysisResult
    )
  }
}

// 分析请求需要的能力
function analyzeRequestCapabilityNeeds(requestPayload, modelCapabilities) {
  const analysis = {
    needsVision: false,
    needsFunctionCalling: false,
    needsJsonMode: false,
    needsReasoning: false,
    hasImages: false,
    hasTools: false,
    complexPrompt: false,
    compatibilityIssues: []
  }

  if (!requestPayload || typeof requestPayload !== 'object') {
    return analysis
  }

  // 检查消息中是否包含图像
  if (requestPayload.messages && Array.isArray(requestPayload.messages)) {
    for (const message of requestPayload.messages) {
      if (message.content && Array.isArray(message.content)) {
        for (const content of message.content) {
          if (content.type === 'image' || content.type === 'image_url') {
            analysis.needsVision = true
            analysis.hasImages = true
            break
          }
        }
      }
    }
  }

  // 检查是否使用函数调用
  if (requestPayload.tools || requestPayload.functions) {
    analysis.needsFunctionCalling = true
    analysis.hasTools = true
  }

  // 检查JSON模式
  if (requestPayload.response_format && requestPayload.response_format.type === 'json_object') {
    analysis.needsJsonMode = true
  }

  // 检查是否是复杂推理任务
  if (requestPayload.messages && requestPayload.messages.length > 0) {
    const lastMessage = requestPayload.messages[requestPayload.messages.length - 1]
    if (lastMessage.content) {
      const content =
        typeof lastMessage.content === 'string'
          ? lastMessage.content
          : JSON.stringify(lastMessage.content)
      // 简单的复杂度检测
      if (
        content.length > 1000 ||
        content.includes('计算') ||
        content.includes('分析') ||
        content.includes('推理') ||
        content.includes('解决') ||
        content.includes('solve') ||
        content.includes('analyze') ||
        content.includes('calculate') ||
        content.includes('reasoning')
      ) {
        analysis.needsReasoning = true
        analysis.complexPrompt = true
      }
    }
  }

  // 检查兼容性问题
  if (analysis.needsVision && !modelCapabilities.visionSupport) {
    analysis.compatibilityIssues.push('Request contains images but model does not support vision')
  }
  if (analysis.needsFunctionCalling && !modelCapabilities.functionCalling) {
    analysis.compatibilityIssues.push('Request uses function calling but model does not support it')
  }
  if (analysis.needsJsonMode && !modelCapabilities.jsonMode) {
    analysis.compatibilityIssues.push('Request requires JSON mode but model does not support it')
  }
  if (analysis.needsReasoning && !modelCapabilities.reasoning) {
    analysis.compatibilityIssues.push(
      'Request appears to need reasoning capabilities but model is not optimized for reasoning'
    )
  }

  return analysis
}

// 生成能力推荐
function generateCapabilityRecommendations(modelInfo, capabilities, analysis) {
  const recommendations = {
    suitability: 'unknown',
    score: 0,
    reasons: [],
    alternatives: [],
    optimizations: []
  }

  let score = 50 // 基础分数

  // 按需求评分
  if (analysis.needsVision) {
    if (capabilities.visionSupport) {
      score += 20
      recommendations.reasons.push('支持视觉处理')
    } else {
      score -= 30
      recommendations.reasons.push('不支持视觉处理')
      // 推荐支持视觉的模型
      const visionModels = getSupportedModels({ capabilities: ['vision'] }).slice(0, 3)
      recommendations.alternatives = visionModels.map((m) => m.name)
    }
  }

  if (analysis.needsFunctionCalling) {
    if (capabilities.functionCalling) {
      score += 15
      recommendations.reasons.push('支持函数调用')
    } else {
      score -= 25
      recommendations.reasons.push('不支持函数调用')
    }
  }

  if (analysis.needsReasoning) {
    if (capabilities.reasoning) {
      score += 25
      recommendations.reasons.push('优化的推理能力')
    } else if (modelInfo.family === 'gpt-4' || modelInfo.family === 'gpt-4-turbo') {
      score += 10
      recommendations.reasons.push('具有基础推理能力')
    } else {
      score -= 15
      recommendations.reasons.push('推理能力有限')
      // 推荐推理模型
      const reasoningModels = getSupportedModels({ capabilities: ['reasoning'] }).slice(0, 3)
      if (reasoningModels.length > 0) {
        recommendations.alternatives = [
          ...recommendations.alternatives,
          ...reasoningModels.map((m) => m.name)
        ]
      }
    }
  }

  // 性能和成本考虑
  if (modelInfo.recommended) {
    score += 10
    recommendations.reasons.push('推荐模型')
  }

  // 上下文窗口评估
  if (modelInfo.contextWindow >= 128000) {
    score += 5
    recommendations.reasons.push('大上下文窗口')
  }

  // 判断适用性
  if (score >= 80) {
    recommendations.suitability = 'excellent'
  } else if (score >= 60) {
    recommendations.suitability = 'good'
  } else if (score >= 40) {
    recommendations.suitability = 'fair'
  } else {
    recommendations.suitability = 'poor'
  }

  recommendations.score = Math.min(100, Math.max(0, score))

  // 生成优化建议
  if (analysis.complexPrompt && !capabilities.reasoning) {
    recommendations.optimizations.push('考虑使用O1系列模型获得更好的推理性能')
  }
  if (analysis.hasImages && capabilities.visionSupport) {
    recommendations.optimizations.push('可以同时处理文本和图像内容')
  }
  if (modelInfo.family === 'gpt-4o-mini' && analysis.complexPrompt) {
    recommendations.optimizations.push('对于复杂任务，考虑升级到GPT-4o或GPT-4 Turbo')
  }

  // 去除重复的替代方案
  recommendations.alternatives = [...new Set(recommendations.alternatives)]

  return recommendations
}

// 获取模型推荐列表
function getModelRecommendations(requirements = {}) {
  const {
    needsVision = false,
    needsFunctionCalling = false,
    needsReasoning = false,
    needsEmbedding = false,
    needsImageGeneration = false,
    prioritySpeed = false,
    priorityCost = false,
    maxBudget: _maxBudget = null
  } = requirements

  const models = getSupportedModels()
  const scores = new Map()

  // 按需求筛选和评分
  models.forEach((model) => {
    let score = 50

    // 能力匹配
    if (needsVision && model.capabilities.includes('vision')) {
      score += 25
    }
    if (needsFunctionCalling && model.capabilities.includes('function_calling')) {
      score += 20
    }
    if (needsReasoning && model.capabilities.includes('reasoning')) {
      score += 30
    }
    if (needsEmbedding && model.capabilities.includes('text_embedding')) {
      score += 35
    }
    if (needsImageGeneration && model.capabilities.includes('image_generation')) {
      score += 35
    }

    // 性能优先级
    if (prioritySpeed) {
      if (model.family.includes('mini') || model.family.includes('35-turbo')) {
        score += 15
      }
      if (model.family.includes('4o')) {
        score += 10
      }
    }

    if (priorityCost) {
      if (model.family.includes('35-turbo')) {
        score += 20
      }
      if (model.family.includes('4o-mini')) {
        score += 15
      }
      if (model.family.includes('4') && !model.family.includes('4o')) {
        score -= 10
      }
    }

    // 推荐加分
    if (model.recommended) {
      score += 10
    }
    if (model.isLatest) {
      score += 5
    }

    scores.set(model.name, score)
  })

  // 按分数排序
  models.sort((a, b) => scores.get(b.name) - scores.get(a.name))

  return models.slice(0, 5).map((model) => ({
    ...model,
    suitabilityScore: scores.get(model.name),
    pricing: getModelPricing(model.name)
  }))
}
