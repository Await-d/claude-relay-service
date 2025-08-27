/**
 * @fileoverview 数据库适配器抽象基类
 *
 * 定义统一的数据库访问接口，支持不同数据库后端的实现
 * 基于现有Redis实现的49个核心方法建立抽象层
 *
 * @author Claude Code
 * @version 1.0.0
 */

/**
 * 数据库适配器抽象基类
 *
 * 提供统一的数据库访问接口，各具体数据库实现需要继承此类并实现所有抽象方法
 *
 * 架构特性:
 * - 遵循依赖倒置原则，上层业务逻辑依赖抽象而非具体实现
 * - 按功能分组，便于理解和维护
 * - 完整映射现有Redis实现的所有方法
 * - 支持未来扩展到其他数据库系统
 */
class DatabaseAdapter {
  constructor() {
    this.isConnected = false
  }

  // ==================== 连接管理 (4个方法) ====================

  /**
   * 连接到数据库
   * @returns {Promise<any>} 数据库连接实例
   * @throws {Error} 连接失败时抛出错误
   */
  async connect() {
    throw new Error('connect method must be implemented by subclass')
  }

  /**
   * 断开数据库连接
   * @returns {Promise<void>}
   */
  async disconnect() {
    throw new Error('disconnect method must be implemented by subclass')
  }

  /**
   * 获取数据库客户端实例（可能为null）
   * @returns {any|null} 数据库客户端实例或null
   */
  getClient() {
    throw new Error('getClient method must be implemented by subclass')
  }

  /**
   * 安全获取数据库客户端（必须存在）
   * @returns {any} 数据库客户端实例
   * @throws {Error} 客户端不存在时抛出错误
   */
  getClientSafe() {
    throw new Error('getClientSafe method must be implemented by subclass')
  }

  // ==================== API Key 操作 (5个方法) ====================

  /**
   * 设置API Key数据
   * @param {string} keyId API Key ID
   * @param {Object} keyData API Key数据对象
   * @param {string|null} hashedKey 哈希后的Key值，用于快速查找
   * @returns {Promise<void>}
   */
  async setApiKey(keyId, keyData, hashedKey = null) {
    throw new Error('setApiKey method must be implemented by subclass')
  }

  /**
   * 获取API Key数据
   * @param {string} keyId API Key ID
   * @returns {Promise<Object>} API Key数据对象
   */
  async getApiKey(keyId) {
    throw new Error('getApiKey method must be implemented by subclass')
  }

  /**
   * 删除API Key
   * @param {string} keyId API Key ID
   * @returns {Promise<number>} 删除的记录数
   */
  async deleteApiKey(keyId) {
    throw new Error('deleteApiKey method must be implemented by subclass')
  }

  /**
   * 获取所有API Keys
   * @returns {Promise<Array>} API Key列表
   */
  async getAllApiKeys() {
    throw new Error('getAllApiKeys method must be implemented by subclass')
  }

  /**
   * 通过哈希值查找API Key（性能优化）
   * @param {string} hashedKey 哈希后的Key值
   * @returns {Promise<Object|null>} API Key数据对象或null
   */
  async findApiKeyByHash(hashedKey) {
    throw new Error('findApiKeyByHash method must be implemented by subclass')
  }

  // ==================== 使用统计 (9个方法) ====================

  /**
   * 增加Token使用统计
   * @param {string} keyId API Key ID
   * @param {number} tokens 总Token数
   * @param {number} inputTokens 输入Token数
   * @param {number} outputTokens 输出Token数
   * @param {number} cacheCreateTokens 缓存创建Token数
   * @param {number} cacheReadTokens 缓存读取Token数
   * @param {string} model 模型名称
   * @param {number} ephemeral5mTokens 5分钟缓存Token数
   * @param {number} ephemeral1hTokens 1小时缓存Token数
   * @returns {Promise<void>}
   */
  async incrementTokenUsage(
    keyId,
    tokens,
    inputTokens = 0,
    outputTokens = 0,
    cacheCreateTokens = 0,
    cacheReadTokens = 0,
    model = 'unknown',
    ephemeral5mTokens = 0,
    ephemeral1hTokens = 0
  ) {
    throw new Error('incrementTokenUsage method must be implemented by subclass')
  }

  /**
   * 增加账户级别的使用统计
   * @param {string} accountId 账户ID
   * @param {number} totalTokens 总Token数
   * @param {number} inputTokens 输入Token数
   * @param {number} outputTokens 输出Token数
   * @param {number} cacheCreateTokens 缓存创建Token数
   * @param {number} cacheReadTokens 缓存读取Token数
   * @param {string} model 模型名称
   * @returns {Promise<void>}
   */
  async incrementAccountUsage(
    accountId,
    totalTokens,
    inputTokens = 0,
    outputTokens = 0,
    cacheCreateTokens = 0,
    cacheReadTokens = 0,
    model = 'unknown'
  ) {
    throw new Error('incrementAccountUsage method must be implemented by subclass')
  }

  /**
   * 获取使用统计
   * @param {string} keyId API Key ID
   * @returns {Promise<Object>} 使用统计数据
   */
  async getUsageStats(keyId) {
    throw new Error('getUsageStats method must be implemented by subclass')
  }

  /**
   * 获取当日费用
   * @param {string} keyId API Key ID
   * @returns {Promise<number>} 当日费用
   */
  async getDailyCost(keyId) {
    throw new Error('getDailyCost method must be implemented by subclass')
  }

  /**
   * 增加当日费用
   * @param {string} keyId API Key ID
   * @param {number} amount 费用金额
   * @returns {Promise<void>}
   */
  async incrementDailyCost(keyId, amount) {
    throw new Error('incrementDailyCost method must be implemented by subclass')
  }

  /**
   * 获取费用统计
   * @param {string} keyId API Key ID
   * @returns {Promise<Object>} 费用统计数据
   */
  async getCostStats(keyId) {
    throw new Error('getCostStats method must be implemented by subclass')
  }

  /**
   * 获取账户使用统计
   * @param {string} accountId 账户ID
   * @returns {Promise<Object>} 账户使用统计数据
   */
  async getAccountUsageStats(accountId) {
    throw new Error('getAccountUsageStats method must be implemented by subclass')
  }

  /**
   * 获取所有账户的使用统计
   * @returns {Promise<Array>} 所有账户使用统计列表
   */
  async getAllAccountsUsageStats() {
    throw new Error('getAllAccountsUsageStats method must be implemented by subclass')
  }

  /**
   * 重置所有使用统计数据
   * @returns {Promise<Object>} 重置统计信息
   */
  async resetAllUsageStats() {
    throw new Error('resetAllUsageStats method must be implemented by subclass')
  }

  // ==================== 账户管理 (10个方法) ====================

  /**
   * 设置Claude账户数据
   * @param {string} accountId 账户ID
   * @param {Object} accountData 账户数据
   * @returns {Promise<void>}
   */
  async setClaudeAccount(accountId, accountData) {
    throw new Error('setClaudeAccount method must be implemented by subclass')
  }

  /**
   * 获取Claude账户数据
   * @param {string} accountId 账户ID
   * @returns {Promise<Object>} 账户数据
   */
  async getClaudeAccount(accountId) {
    throw new Error('getClaudeAccount method must be implemented by subclass')
  }

  /**
   * 获取所有Claude账户
   * @returns {Promise<Array>} Claude账户列表
   */
  async getAllClaudeAccounts() {
    throw new Error('getAllClaudeAccounts method must be implemented by subclass')
  }

  /**
   * 删除Claude账户
   * @param {string} accountId 账户ID
   * @returns {Promise<number>} 删除的记录数
   */
  async deleteClaudeAccount(accountId) {
    throw new Error('deleteClaudeAccount method must be implemented by subclass')
  }

  /**
   * 更新Claude账户调度相关字段
   * @param {string} accountId 账户ID
   * @param {Object} updates 更新的字段
   * @returns {Promise<void>}
   */
  async updateClaudeAccountSchedulingFields(accountId, updates) {
    throw new Error('updateClaudeAccountSchedulingFields method must be implemented by subclass')
  }

  /**
   * 原子性地增加账户使用计数
   * @param {string} accountId 账户ID
   * @returns {Promise<number>} 新的计数值
   */
  async incrementClaudeAccountUsageCount(accountId) {
    throw new Error('incrementClaudeAccountUsageCount method must be implemented by subclass')
  }

  /**
   * 设置OpenAI账户数据
   * @param {string} accountId 账户ID
   * @param {Object} accountData 账户数据
   * @returns {Promise<void>}
   */
  async setOpenAiAccount(accountId, accountData) {
    throw new Error('setOpenAiAccount method must be implemented by subclass')
  }

  /**
   * 获取OpenAI账户数据
   * @param {string} accountId 账户ID
   * @returns {Promise<Object>} 账户数据
   */
  async getOpenAiAccount(accountId) {
    throw new Error('getOpenAiAccount method must be implemented by subclass')
  }

  /**
   * 删除OpenAI账户
   * @param {string} accountId 账户ID
   * @returns {Promise<number>} 删除的记录数
   */
  async deleteOpenAiAccount(accountId) {
    throw new Error('deleteOpenAiAccount method must be implemented by subclass')
  }

  /**
   * 获取所有OpenAI账户
   * @returns {Promise<Array>} OpenAI账户列表
   */
  async getAllOpenAIAccounts() {
    throw new Error('getAllOpenAIAccounts method must be implemented by subclass')
  }

  // ==================== 会话管理 (9个方法) ====================

  /**
   * 设置会话数据
   * @param {string} sessionId 会话ID
   * @param {Object} sessionData 会话数据
   * @param {number} ttl 过期时间（秒）
   * @returns {Promise<void>}
   */
  async setSession(sessionId, sessionData, ttl = 86400) {
    throw new Error('setSession method must be implemented by subclass')
  }

  /**
   * 获取会话数据
   * @param {string} sessionId 会话ID
   * @returns {Promise<Object>} 会话数据
   */
  async getSession(sessionId) {
    throw new Error('getSession method must be implemented by subclass')
  }

  /**
   * 删除会话
   * @param {string} sessionId 会话ID
   * @returns {Promise<number>} 删除的记录数
   */
  async deleteSession(sessionId) {
    throw new Error('deleteSession method must be implemented by subclass')
  }

  /**
   * 设置API Key哈希索引
   * @param {string} hashedKey 哈希后的Key
   * @param {Object} keyData Key数据
   * @param {number} ttl 过期时间（秒，0表示不过期）
   * @returns {Promise<void>}
   */
  async setApiKeyHash(hashedKey, keyData, ttl = 0) {
    throw new Error('setApiKeyHash method must be implemented by subclass')
  }

  /**
   * 获取API Key哈希数据
   * @param {string} hashedKey 哈希后的Key
   * @returns {Promise<Object>} Key数据
   */
  async getApiKeyHash(hashedKey) {
    throw new Error('getApiKeyHash method must be implemented by subclass')
  }

  /**
   * 删除API Key哈希索引
   * @param {string} hashedKey 哈希后的Key
   * @returns {Promise<number>} 删除的记录数
   */
  async deleteApiKeyHash(hashedKey) {
    throw new Error('deleteApiKeyHash method must be implemented by subclass')
  }

  /**
   * 设置OAuth会话数据
   * @param {string} sessionId 会话ID
   * @param {Object} sessionData 会话数据
   * @param {number} ttl 过期时间（秒）
   * @returns {Promise<void>}
   */
  async setOAuthSession(sessionId, sessionData, ttl = 600) {
    throw new Error('setOAuthSession method must be implemented by subclass')
  }

  /**
   * 获取OAuth会话数据
   * @param {string} sessionId 会话ID
   * @returns {Promise<Object>} OAuth会话数据
   */
  async getOAuthSession(sessionId) {
    throw new Error('getOAuthSession method must be implemented by subclass')
  }

  /**
   * 删除OAuth会话
   * @param {string} sessionId 会话ID
   * @returns {Promise<number>} 删除的记录数
   */
  async deleteOAuthSession(sessionId) {
    throw new Error('deleteOAuthSession method must be implemented by subclass')
  }

  // ==================== 系统统计 (4个方法) ====================

  /**
   * 获取系统统计数据
   * @returns {Promise<Object>} 系统统计数据
   */
  async getSystemStats() {
    throw new Error('getSystemStats method must be implemented by subclass')
  }

  /**
   * 获取今日统计数据
   * @returns {Promise<Object>} 今日统计数据
   */
  async getTodayStats() {
    throw new Error('getTodayStats method must be implemented by subclass')
  }

  /**
   * 获取系统平均值
   * @returns {Promise<Object>} 系统平均值数据
   */
  async getSystemAverages() {
    throw new Error('getSystemAverages method must be implemented by subclass')
  }

  /**
   * 获取实时系统指标
   * @returns {Promise<Object>} 实时系统指标数据
   */
  async getRealtimeSystemMetrics() {
    throw new Error('getRealtimeSystemMetrics method must be implemented by subclass')
  }

  // ==================== 维护功能 (4个方法) ====================

  /**
   * 设置会话账户映射
   * @param {string} sessionHash 会话哈希
   * @param {string} accountId 账户ID
   * @param {number} ttl 过期时间（秒）
   * @returns {Promise<void>}
   */
  async setSessionAccountMapping(sessionHash, accountId, ttl = 3600) {
    throw new Error('setSessionAccountMapping method must be implemented by subclass')
  }

  /**
   * 获取会话账户映射
   * @param {string} sessionHash 会话哈希
   * @returns {Promise<string|null>} 账户ID或null
   */
  async getSessionAccountMapping(sessionHash) {
    throw new Error('getSessionAccountMapping method must be implemented by subclass')
  }

  /**
   * 删除会话账户映射
   * @param {string} sessionHash 会话哈希
   * @returns {Promise<number>} 删除的记录数
   */
  async deleteSessionAccountMapping(sessionHash) {
    throw new Error('deleteSessionAccountMapping method must be implemented by subclass')
  }

  /**
   * 清理过期数据
   * @returns {Promise<void>}
   */
  async cleanup() {
    throw new Error('cleanup method must be implemented by subclass')
  }

  // ==================== 并发控制 (3个方法) ====================

  /**
   * 增加并发计数
   * @param {string} apiKeyId API Key ID
   * @returns {Promise<number>} 当前并发数
   */
  async incrConcurrency(apiKeyId) {
    throw new Error('incrConcurrency method must be implemented by subclass')
  }

  /**
   * 减少并发计数
   * @param {string} apiKeyId API Key ID
   * @returns {Promise<number>} 当前并发数
   */
  async decrConcurrency(apiKeyId) {
    throw new Error('decrConcurrency method must be implemented by subclass')
  }

  /**
   * 获取当前并发数
   * @param {string} apiKeyId API Key ID
   * @returns {Promise<number>} 当前并发数
   */
  async getConcurrency(apiKeyId) {
    throw new Error('getConcurrency method must be implemented by subclass')
  }

  // ==================== 配置管理 (3个方法) ====================

  /**
   * 设置系统调度配置
   * @param {Object} configData 配置数据
   * @returns {Promise<void>}
   */
  async setSystemSchedulingConfig(configData) {
    throw new Error('setSystemSchedulingConfig method must be implemented by subclass')
  }

  /**
   * 获取系统调度配置
   * @returns {Promise<Object>} 调度配置数据
   */
  async getSystemSchedulingConfig() {
    throw new Error('getSystemSchedulingConfig method must be implemented by subclass')
  }

  /**
   * 删除系统调度配置
   * @returns {Promise<number>} 删除的记录数
   */
  async deleteSystemSchedulingConfig() {
    throw new Error('deleteSystemSchedulingConfig method must be implemented by subclass')
  }

  // ==================== 请求日志管理 (8个方法) ====================

  /**
   * 记录请求日志
   * @param {string} keyId API Key ID
   * @param {Object} logData 日志数据
   * @param {number} ttl 过期时间（秒），默认7天
   * @returns {Promise<string>} 日志ID
   */
  async logRequest(keyId, logData, ttl = 604800) {
    throw new Error('logRequest method must be implemented by subclass')
  }

  /**
   * 搜索请求日志
   * @param {Object} query 查询条件
   * @param {Object} options 查询选项（分页、排序等）
   * @returns {Promise<Array>} 日志数组
   */
  async searchLogs(query = {}, options = {}) {
    throw new Error('searchLogs method must be implemented by subclass')
  }

  /**
   * 计算符合条件的日志数量
   * @param {Object} query 查询条件
   * @returns {Promise<number>} 日志数量
   */
  async countLogs(query = {}) {
    throw new Error('countLogs method must be implemented by subclass')
  }

  /**
   * 删除符合条件的日志
   * @param {Object} query 删除条件
   * @returns {Promise<number>} 删除的日志数量
   */
  async deleteLogs(query = {}) {
    throw new Error('deleteLogs method must be implemented by subclass')
  }

  /**
   * 聚合统计日志数据
   * @param {Object} query 统计条件
   * @returns {Promise<Object>} 统计结果
   */
  async aggregateLogs(query = {}) {
    throw new Error('aggregateLogs method must be implemented by subclass')
  }

  /**
   * 导出日志数据
   * @param {Object} query 导出条件
   * @param {string} format 导出格式（json/csv）
   * @param {string} filename 文件名
   * @returns {Promise<string>} 导出文件路径
   */
  async exportLogs(query = {}, format = 'json', filename = 'logs') {
    throw new Error('exportLogs method must be implemented by subclass')
  }

  /**
   * 删除过期的日志记录
   * @param {string} cutoffDate 截止日期（ISO字符串）
   * @returns {Promise<number>} 删除的日志数量
   */
  async deleteExpiredLogs(cutoffDate) {
    throw new Error('deleteExpiredLogs method must be implemented by subclass')
  }

  /**
   * 获取请求日志配置
   * @returns {Promise<Object>} 日志配置对象
   */
  async getRequestLogsConfig() {
    throw new Error('getRequestLogsConfig method must be implemented by subclass')
  }

  /**
   * 设置请求日志配置
   * @param {Object} config 配置对象
   * @returns {Promise<void>}
   */
  async setRequestLogsConfig(config) {
    throw new Error('setRequestLogsConfig method must be implemented by subclass')
  }
}

module.exports = DatabaseAdapter
