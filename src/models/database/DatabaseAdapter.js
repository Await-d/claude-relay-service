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
  async setApiKey(_keyId, _keyData, _hashedKey = null) {
    throw new Error('setApiKey method must be implemented by subclass')
  }

  /**
   * 获取API Key数据
   * @param {string} keyId API Key ID
   * @returns {Promise<Object>} API Key数据对象
   */
  async getApiKey(_keyId) {
    throw new Error('getApiKey method must be implemented by subclass')
  }

  /**
   * 删除API Key
   * @param {string} keyId API Key ID
   * @returns {Promise<number>} 删除的记录数
   */
  async deleteApiKey(_keyId) {
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
  async findApiKeyByHash(_hashedKey) {
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
    _keyId,
    _tokens,
    _inputTokens = 0,
    _outputTokens = 0,
    _cacheCreateTokens = 0,
    _cacheReadTokens = 0,
    _model = 'unknown',
    _ephemeral5mTokens = 0,
    _ephemeral1hTokens = 0
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
    _accountId,
    _totalTokens,
    _inputTokens = 0,
    _outputTokens = 0,
    _cacheCreateTokens = 0,
    _cacheReadTokens = 0,
    _model = 'unknown'
  ) {
    throw new Error('incrementAccountUsage method must be implemented by subclass')
  }

  /**
   * 获取使用统计
   * @param {string} keyId API Key ID
   * @returns {Promise<Object>} 使用统计数据
   */
  async getUsageStats(_keyId) {
    throw new Error('getUsageStats method must be implemented by subclass')
  }

  /**
   * 获取当日费用
   * @param {string} keyId API Key ID
   * @returns {Promise<number>} 当日费用
   */
  async getDailyCost(_keyId) {
    throw new Error('getDailyCost method must be implemented by subclass')
  }

  /**
   * 增加当日费用
   * @param {string} keyId API Key ID
   * @param {number} amount 费用金额
   * @returns {Promise<void>}
   */
  async incrementDailyCost(_keyId, _amount) {
    throw new Error('incrementDailyCost method must be implemented by subclass')
  }

  /**
   * 获取费用统计
   * @param {string} keyId API Key ID
   * @returns {Promise<Object>} 费用统计数据
   */
  async getCostStats(_keyId) {
    throw new Error('getCostStats method must be implemented by subclass')
  }

  /**
   * 获取账户每日费用
   * @param {string} accountId 账户ID
   * @param {Date|string} date 日期（可选，默认当天）
   * @returns {Promise<number>} 账户指定日期的费用
   */
  async getAccountDailyCost(_accountId, _date = null) {
    throw new Error('getAccountDailyCost method must be implemented by subclass')
  }

  /**
   * 根据日期范围获取账户费用
   * @param {string} accountId 账户ID
   * @param {Date} startDate 开始日期
   * @param {Date} endDate 结束日期
   * @returns {Promise<number>} 指定日期范围内的账户费用
   */
  async getAccountCostByDateRange(_accountId, _startDate, _endDate) {
    throw new Error('getAccountCostByDateRange method must be implemented by subclass')
  }

  /**
   * 增加账户费用
   * @param {string} accountId 账户ID
   * @param {number} amount 费用金额
   * @param {Date|string} date 日期（可选，默认当天）
   * @returns {Promise<void>}
   */
  async incrementAccountCost(_accountId, _amount, _date = null) {
    throw new Error('incrementAccountCost method must be implemented by subclass')
  }

  /**
   * 获取总费用（根据日期范围）
   * @param {string} keyId API Key ID
   * @param {Date} startDate 开始日期
   * @param {Date} endDate 结束日期
   * @returns {Promise<number>} 指定日期范围内的总费用
   */
  async getCostByDateRange(_keyId, _startDate, _endDate) {
    throw new Error('getCostByDateRange method must be implemented by subclass')
  }

  /**
   * 获取API Key总费用
   * @param {string} keyId API Key ID
   * @returns {Promise<number>} 总费用
   */
  async getTotalCost(_keyId) {
    throw new Error('getTotalCost method must be implemented by subclass')
  }

  /**
   * 获取账户使用统计
   * @param {string} accountId 账户ID
   * @returns {Promise<Object>} 账户使用统计数据
   */
  async getAccountUsageStats(_accountId) {
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
  async setClaudeAccount(_accountId, _accountData) {
    throw new Error('setClaudeAccount method must be implemented by subclass')
  }

  /**
   * 获取Claude账户数据
   * @param {string} accountId 账户ID
   * @returns {Promise<Object>} 账户数据
   */
  async getClaudeAccount(_accountId) {
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
  async deleteClaudeAccount(_accountId) {
    throw new Error('deleteClaudeAccount method must be implemented by subclass')
  }

  /**
   * 更新Claude账户调度相关字段
   * @param {string} accountId 账户ID
   * @param {Object} updates 更新的字段
   * @returns {Promise<void>}
   */
  async updateClaudeAccountSchedulingFields(_accountId, _updates) {
    throw new Error('updateClaudeAccountSchedulingFields method must be implemented by subclass')
  }

  /**
   * 原子性地增加账户使用计数
   * @param {string} accountId 账户ID
   * @returns {Promise<number>} 新的计数值
   */
  async incrementClaudeAccountUsageCount(_accountId) {
    throw new Error('incrementClaudeAccountUsageCount method must be implemented by subclass')
  }

  /**
   * 设置OpenAI账户数据
   * @param {string} accountId 账户ID
   * @param {Object} accountData 账户数据
   * @returns {Promise<void>}
   */
  async setOpenAiAccount(_accountId, _accountData) {
    throw new Error('setOpenAiAccount method must be implemented by subclass')
  }

  /**
   * 获取OpenAI账户数据
   * @param {string} accountId 账户ID
   * @returns {Promise<Object>} 账户数据
   */
  async getOpenAiAccount(_accountId) {
    throw new Error('getOpenAiAccount method must be implemented by subclass')
  }

  /**
   * 删除OpenAI账户
   * @param {string} accountId 账户ID
   * @returns {Promise<number>} 删除的记录数
   */
  async deleteOpenAiAccount(_accountId) {
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
  async setSession(_sessionId, _sessionData, _ttl = 86400) {
    throw new Error('setSession method must be implemented by subclass')
  }

  /**
   * 获取会话数据
   * @param {string} sessionId 会话ID
   * @returns {Promise<Object>} 会话数据
   */
  async getSession(_sessionId) {
    throw new Error('getSession method must be implemented by subclass')
  }

  /**
   * 删除会话
   * @param {string} sessionId 会话ID
   * @returns {Promise<number>} 删除的记录数
   */
  async deleteSession(_sessionId) {
    throw new Error('deleteSession method must be implemented by subclass')
  }

  /**
   * 设置API Key哈希索引
   * @param {string} hashedKey 哈希后的Key
   * @param {Object} keyData Key数据
   * @param {number} ttl 过期时间（秒，0表示不过期）
   * @returns {Promise<void>}
   */
  async setApiKeyHash(_hashedKey, _keyData, _ttl = 0) {
    throw new Error('setApiKeyHash method must be implemented by subclass')
  }

  /**
   * 获取API Key哈希数据
   * @param {string} hashedKey 哈希后的Key
   * @returns {Promise<Object>} Key数据
   */
  async getApiKeyHash(_hashedKey) {
    throw new Error('getApiKeyHash method must be implemented by subclass')
  }

  /**
   * 删除API Key哈希索引
   * @param {string} hashedKey 哈希后的Key
   * @returns {Promise<number>} 删除的记录数
   */
  async deleteApiKeyHash(_hashedKey) {
    throw new Error('deleteApiKeyHash method must be implemented by subclass')
  }

  /**
   * 设置OAuth会话数据
   * @param {string} sessionId 会话ID
   * @param {Object} sessionData 会话数据
   * @param {number} ttl 过期时间（秒）
   * @returns {Promise<void>}
   */
  async setOAuthSession(_sessionId, _sessionData, _ttl = 600) {
    throw new Error('setOAuthSession method must be implemented by subclass')
  }

  /**
   * 获取OAuth会话数据
   * @param {string} sessionId 会话ID
   * @returns {Promise<Object>} OAuth会话数据
   */
  async getOAuthSession(_sessionId) {
    throw new Error('getOAuthSession method must be implemented by subclass')
  }

  /**
   * 删除OAuth会话
   * @param {string} sessionId 会话ID
   * @returns {Promise<number>} 删除的记录数
   */
  async deleteOAuthSession(_sessionId) {
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
  async setSessionAccountMapping(_sessionHash, _accountId, _ttl = 3600) {
    throw new Error('setSessionAccountMapping method must be implemented by subclass')
  }

  /**
   * 获取会话账户映射
   * @param {string} sessionHash 会话哈希
   * @returns {Promise<string|null>} 账户ID或null
   */
  async getSessionAccountMapping(_sessionHash) {
    throw new Error('getSessionAccountMapping method must be implemented by subclass')
  }

  /**
   * 删除会话账户映射
   * @param {string} sessionHash 会话哈希
   * @returns {Promise<number>} 删除的记录数
   */
  async deleteSessionAccountMapping(_sessionHash) {
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
  async incrConcurrency(_apiKeyId) {
    throw new Error('incrConcurrency method must be implemented by subclass')
  }

  /**
   * 减少并发计数
   * @param {string} apiKeyId API Key ID
   * @returns {Promise<number>} 当前并发数
   */
  async decrConcurrency(_apiKeyId) {
    throw new Error('decrConcurrency method must be implemented by subclass')
  }

  /**
   * 获取当前并发数
   * @param {string} apiKeyId API Key ID
   * @returns {Promise<number>} 当前并发数
   */
  async getConcurrency(_apiKeyId) {
    throw new Error('getConcurrency method must be implemented by subclass')
  }

  // ==================== 配置管理 (3个方法) ====================

  /**
   * 设置系统调度配置
   * @param {Object} configData 配置数据
   * @returns {Promise<void>}
   */
  async setSystemSchedulingConfig(_configData) {
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

  // ==================== 请求日志管理 (11个方法) ====================

  /**
   * 记录请求日志（增强版本 - 支持智能合并）
   * @param {string} keyId API Key ID
   * @param {Object} logData 日志数据对象
   * @param {number} ttl 过期时间（秒），默认604800秒（7天）
   * @param {Object} mergeOptions 日志合并配置选项
   * @param {boolean} mergeOptions.enabled 是否启用合并功能，默认false
   * @param {number} mergeOptions.windowMs 合并时间窗口（毫秒），默认15000（15秒）
   * @param {string} mergeOptions.priority 日志优先级（enhanced|basic|unknown），默认'unknown'
   * @param {boolean} mergeOptions.forceWrite 是否强制写入（忽略合并），默认false
   * @param {Function} mergeOptions.onDuplicate 处理重复日志的回调函数
   * @returns {Promise<string>} 日志唯一ID
   */
  async logRequest(_keyId, _logData, _ttl = 604800, _mergeOptions = {}) {
    throw new Error('logRequest method must be implemented by subclass')
  }

  /**
   * 检测和查找重复的日志条目
   * @param {string} keyId API Key ID
   * @param {Object} logData 待检测的日志数据
   * @param {number} windowMs 检测时间窗口（毫秒）
   * @returns {Promise<Array>} 重复日志条目数组，格式：[{logId, timestamp, priority, similarity}]
   */
  async detectDuplicateLogs(_keyId, _logData, _windowMs = 15000) {
    throw new Error('detectDuplicateLogs method must be implemented by subclass')
  }

  /**
   * 合并多个日志条目
   * @param {string} primaryLogId 主要日志ID（保留的日志）
   * @param {Array} duplicateLogIds 重复日志ID数组（将被合并删除）
   * @param {Object} mergeStrategy 合并策略配置
   * @param {string} mergeStrategy.priority 优先级合并方式（higher|lower|newest|oldest）
   * @param {boolean} mergeStrategy.preserveHeaders 是否保留所有Headers信息
   * @param {boolean} mergeStrategy.aggregateTokens 是否聚合Token统计信息
   * @returns {Promise<Object>} 合并结果 {success: boolean, mergedLogId: string, details: Object}
   */
  async mergeLogEntries(_primaryLogId, _duplicateLogIds, _mergeStrategy = {}) {
    throw new Error('mergeLogEntries method must be implemented by subclass')
  }

  /**
   * 搜索请求日志
   * @param {Object} query 查询条件
   * @param {Object} options 查询选项（分页、排序等）
   * @returns {Promise<Array>} 日志数组
   */
  async searchLogs(_query = {}, _options = {}) {
    throw new Error('searchLogs method must be implemented by subclass')
  }

  /**
   * 计算符合条件的日志数量
   * @param {Object} query 查询条件
   * @returns {Promise<number>} 日志数量
   */
  async countLogs(_query = {}) {
    throw new Error('countLogs method must be implemented by subclass')
  }

  /**
   * 删除符合条件的日志
   * @param {Object} query 删除条件
   * @returns {Promise<number>} 删除的日志数量
   */
  async deleteLogs(_query = {}) {
    throw new Error('deleteLogs method must be implemented by subclass')
  }

  /**
   * 聚合统计日志数据
   * @param {Object} query 统计条件
   * @returns {Promise<Object>} 统计结果
   */
  async aggregateLogs(_query = {}) {
    throw new Error('aggregateLogs method must be implemented by subclass')
  }

  /**
   * 导出日志数据
   * @param {Object} query 导出条件
   * @param {string} format 导出格式（json/csv）
   * @param {string} filename 文件名
   * @returns {Promise<string>} 导出文件路径
   */
  async exportLogs(_query = {}, _format = 'json', _filename = 'logs') {
    throw new Error('exportLogs method must be implemented by subclass')
  }

  /**
   * 删除过期的日志记录
   * @param {string} cutoffDate 截止日期（ISO字符串）
   * @returns {Promise<number>} 删除的日志数量
   */
  async deleteExpiredLogs(_cutoffDate) {
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
  async setRequestLogsConfig(_config) {
    throw new Error('setRequestLogsConfig method must be implemented by subclass')
  }

  // ==================== 日志合并统计和监控 (3个方法) ====================

  /**
   * 获取日志合并统计信息
   * @param {Object} filters 过滤条件
   * @param {string} filters.keyId 特定API Key ID
   * @param {string} filters.dateRange 日期范围
   * @param {string} filters.priority 日志优先级
   * @returns {Promise<Object>} 合并统计信息
   */
  async getLogMergeStats(_filters = {}) {
    throw new Error('getLogMergeStats method must be implemented by subclass')
  }

  /**
   * 批量日志操作（高级功能）
   * @param {Array} operations 批量操作数组
   * @param {Object} batchOptions 批量处理选项
   * @param {number} batchOptions.concurrency 并发度，默认5
   * @param {boolean} batchOptions.atomicTransaction 是否原子事务，默认false
   * @param {Function} batchOptions.onProgress 进度回调函数
   * @returns {Promise<Array>} 批量操作结果数组
   */
  async batchLogOperations(_operations, _batchOptions = {}) {
    throw new Error('batchLogOperations method must be implemented by subclass')
  }

  /**
   * 日志系统性能监控
   * @param {Object} monitorOptions 监控选项
   * @param {Array} monitorOptions.metrics 监控指标名称数组
   * @param {number} monitorOptions.windowSize 监控时间窗口大小
   * @returns {Promise<Object>} 性能监控数据
   */
  async getLogPerformanceMetrics(_monitorOptions = {}) {
    throw new Error('getLogPerformanceMetrics method must be implemented by subclass')
  }
}

module.exports = DatabaseAdapter
