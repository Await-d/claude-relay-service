/**
 * @fileoverview 模型名称处理工具
 *
 * 提供模型名称的标准化、识别和处理功能
 * 支持检测 1M 上下文模型变体
 *
 * @author Claude Code
 * @version 1.0.0
 */

const logger = require('./logger')

/**
 * 检测请求是否使用了 1M 上下文模型
 * @param {Object} requestBody - 请求体
 * @returns {boolean} 是否使用 1M 上下文
 */
function isContext1MRequest(requestBody) {
  if (!requestBody || !requestBody.betas) {
    return false
  }

  // 检查 betas 数组中是否包含 1M 上下文标识
  if (Array.isArray(requestBody.betas)) {
    return requestBody.betas.includes('context-1m-2025-08-07')
  }

  return false
}

/**
 * 根据请求体获取实际的模型名称
 * 如果使用了 1M 上下文，返回带 [1M] 后缀的模型名称
 * @param {Object} requestBody - 请求体
 * @returns {string} 实际的模型名称
 */
function getActualModelName(requestBody) {
  if (!requestBody || !requestBody.model) {
    return 'unknown'
  }

  const baseModel = requestBody.model
  const isContext1M = isContext1MRequest(requestBody)

  if (isContext1M) {
    // 只对支持 1M 上下文的模型添加后缀
    if (isSupportedContext1MModel(baseModel)) {
      return `${baseModel}[1M]`
    } else {
      logger.warn(`⚠️ Model ${baseModel} does not support 1M context, ignoring betas parameter`)
      return baseModel
    }
  }

  return baseModel
}

/**
 * 检查模型是否支持 1M 上下文
 * @param {string} modelName - 模型名称
 * @returns {boolean} 是否支持 1M 上下文
 */
function isSupportedContext1MModel(modelName) {
  const supported1MModels = ['claude-sonnet-4-20250514', 'claude-opus-4-20250514']

  return supported1MModels.includes(modelName)
}

/**
 * 标准化模型名称，用于统计和定价
 * 移除 [1M] 等后缀，返回基础模型名称
 * @param {string} modelName - 包含后缀的模型名称
 * @returns {string} 基础模型名称
 */
function getBaseModelName(modelName) {
  if (!modelName) {
    return 'unknown'
  }

  // 移除 [1M] 后缀
  return modelName.replace(/\[1M\]$/, '')
}

/**
 * 检查模型名称是否为 1M 上下文变体
 * @param {string} modelName - 模型名称
 * @returns {boolean} 是否为 1M 上下文变体
 */
function isContext1MModel(modelName) {
  return modelName && modelName.endsWith('[1M]')
}

/**
 * 获取模型的显示名称（用于日志和统计显示）
 * @param {string} modelName - 模型名称
 * @returns {string} 显示名称
 */
function getModelDisplayName(modelName) {
  if (!modelName) {
    return 'unknown'
  }

  // 保持原有格式，包括 [1M] 后缀
  return modelName
}

/**
 * 为请求体处理模型名称
 * 根据 betas 参数自动调整模型名称
 * @param {Object} requestBody - 请求体
 * @returns {Object} 处理后的请求体
 */
function processModelNameInRequest(requestBody) {
  if (!requestBody) {
    return requestBody
  }

  // 创建副本避免修改原始对象
  const processedBody = { ...requestBody }

  // 获取实际模型名称
  const actualModelName = getActualModelName(requestBody)

  // 更新请求体中的模型名称
  processedBody.model = actualModelName

  // 记录模型名称变更（如果有）
  if (actualModelName !== requestBody.model) {
    logger.debug(`📝 Model name updated: ${requestBody.model} -> ${actualModelName}`)
  }

  return processedBody
}

module.exports = {
  isContext1MRequest,
  getActualModelName,
  isSupportedContext1MModel,
  getBaseModelName,
  isContext1MModel,
  getModelDisplayName,
  processModelNameInRequest
}
