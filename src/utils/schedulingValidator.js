/**
 * 调度策略字段验证工具
 * 用于验证和规范化调度相关的参数
 */

// const logger = require('./logger')

/**
 * 有效的调度策略列表
 */
const VALID_SCHEDULING_STRATEGIES = [
  'least_recent', // 最少最近使用
  'least_used', // 最少使用
  'round_robin', // 轮询
  'weighted_random', // 加权随机
  'sequential', // 顺序调度
  'random' // 随机调度
]

/**
 * 调度策略字段的默认值
 */
const DEFAULT_SCHEDULING_VALUES = {
  schedulingStrategy: 'least_recent',
  schedulingWeight: 1,
  sequentialOrder: 1,
  roundRobinIndex: 0,
  usageCount: 0,
  lastScheduledAt: ''
}

/**
 * 验证调度策略
 * @param {string} strategy - 调度策略
 * @returns {boolean} 是否有效
 */
function isValidSchedulingStrategy(strategy) {
  return VALID_SCHEDULING_STRATEGIES.includes(strategy)
}

/**
 * 验证调度权重
 * @param {number} weight - 调度权重
 * @returns {boolean} 是否有效
 */
function isValidSchedulingWeight(weight) {
  return typeof weight === 'number' && weight >= 1 && weight <= 10 && Number.isInteger(weight)
}

/**
 * 验证顺序号
 * @param {number} order - 顺序号
 * @returns {boolean} 是否有效
 */
function isValidSequentialOrder(order) {
  return typeof order === 'number' && order >= 1 && Number.isInteger(order)
}

/**
 * 验证调度策略字段的完整对象
 * @param {Object} fields - 要验证的字段对象
 * @returns {Object} 验证结果 { valid: boolean, errors: string[] }
 */
function validateSchedulingFields(fields) {
  const errors = []

  if (fields.schedulingStrategy !== undefined) {
    if (!isValidSchedulingStrategy(fields.schedulingStrategy)) {
      errors.push(
        `Invalid scheduling strategy '${fields.schedulingStrategy}'. Must be one of: ${VALID_SCHEDULING_STRATEGIES.join(', ')}`
      )
    }
  }

  if (fields.schedulingWeight !== undefined) {
    if (!isValidSchedulingWeight(fields.schedulingWeight)) {
      errors.push(
        `Invalid scheduling weight '${fields.schedulingWeight}'. Must be an integer between 1 and 10`
      )
    }
  }

  if (fields.sequentialOrder !== undefined) {
    if (!isValidSequentialOrder(fields.sequentialOrder)) {
      errors.push(
        `Invalid sequential order '${fields.sequentialOrder}'. Must be a positive integer`
      )
    }
  }

  return {
    valid: errors.length === 0,
    errors
  }
}

/**
 * 规范化调度字段，确保它们有有效的默认值
 * @param {Object} accountData - 账户数据
 * @returns {Object} 规范化后的调度字段
 */
function normalizeSchedulingFields(accountData) {
  const normalized = {}

  // 确保所有调度字段都有默认值
  for (const [key, defaultValue] of Object.entries(DEFAULT_SCHEDULING_VALUES)) {
    if (accountData[key] !== undefined && accountData[key] !== '') {
      if (
        key === 'schedulingWeight' ||
        key === 'sequentialOrder' ||
        key === 'roundRobinIndex' ||
        key === 'usageCount'
      ) {
        // 数字字段：从字符串转换为数字
        normalized[key] = parseInt(accountData[key], 10) || defaultValue
      } else {
        // 字符串字段：直接使用或使用默认值
        normalized[key] = accountData[key] || defaultValue
      }
    } else {
      normalized[key] = defaultValue
    }
  }

  return normalized
}

/**
 * 将调度字段转换为Redis存储格式（所有字段转为字符串）
 * @param {Object} fields - 调度字段
 * @returns {Object} Redis存储格式的字段
 */
function prepareFieldsForRedis(fields) {
  const redisFields = {}

  for (const [key, value] of Object.entries(fields)) {
    if (Object.prototype.hasOwnProperty.call(DEFAULT_SCHEDULING_VALUES, key)) {
      redisFields[key] = value !== null && value !== undefined ? value.toString() : ''
    }
  }

  return redisFields
}

/**
 * 验证并准备调度字段用于创建账户
 * @param {Object} inputFields - 输入的调度字段
 * @returns {Object} 处理后的字段 { valid: boolean, errors: string[], fields: Object }
 */
function validateAndPrepareSchedulingFields(inputFields) {
  const validation = validateSchedulingFields(inputFields)

  if (!validation.valid) {
    return {
      valid: false,
      errors: validation.errors,
      fields: null
    }
  }

  // 创建包含默认值的完整字段集
  const completeFields = {
    ...DEFAULT_SCHEDULING_VALUES,
    ...inputFields
  }

  const normalizedFields = normalizeSchedulingFields(completeFields)

  return {
    valid: true,
    errors: [],
    fields: normalizedFields
  }
}

module.exports = {
  VALID_SCHEDULING_STRATEGIES,
  DEFAULT_SCHEDULING_VALUES,
  isValidSchedulingStrategy,
  isValidSchedulingWeight,
  isValidSequentialOrder,
  validateSchedulingFields,
  normalizeSchedulingFields,
  prepareFieldsForRedis,
  validateAndPrepareSchedulingFields
}
