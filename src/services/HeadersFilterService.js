/**
 * @fileoverview Headers过滤服务 - 安全过滤请求头和响应头信息
 *
 * 提供安全的HTTP头部过滤功能，支持白名单和黑名单机制
 * 保护敏感信息的同时保留日志记录所需的关键信息
 *
 * @author Claude Code
 * @version 1.0.0
 */

const logger = require('../utils/logger')

/**
 * Headers过滤服务类
 *
 * 功能特性：
 * - 安全的请求头白名单过滤
 * - 敏感头信息黑名单过滤
 * - 支持请求头和响应头分别处理
 * - 可配置的过滤规则
 * - 数据压缩优化存储性能
 */
class HeadersFilterService {
  constructor() {
    // 请求头白名单 - 允许记录的安全头部信息
    this.requestHeaderWhitelist = [
      'user-agent',
      'accept',
      'accept-language',
      'accept-encoding',
      'content-type',
      'content-length',
      'cache-control',
      'connection',
      'origin',
      'referer',
      'sec-fetch-dest',
      'sec-fetch-mode',
      'sec-fetch-site',
      'x-forwarded-for',
      'x-real-ip',
      'x-request-id',
      'x-trace-id',
      'x-app',
      'x-client-version',
      // Claude Code 特定头部
      'x-stainless-retry-count',
      'x-stainless-timeout',
      'x-stainless-lang',
      'x-stainless-package-version',
      'x-stainless-os',
      'x-stainless-arch',
      'x-stainless-runtime',
      'x-stainless-runtime-version',
      'anthropic-dangerous-direct-browser-access'
    ]

    // 响应头白名单 - 允许记录的响应头信息
    this.responseHeaderWhitelist = [
      'content-type',
      'content-length',
      'cache-control',
      'connection',
      'date',
      'server',
      'x-request-id',
      'x-trace-id',
      'x-ratelimit-limit',
      'x-ratelimit-remaining',
      'x-ratelimit-reset',
      // Anthropic API 特定头部
      'anthropic-ratelimit-unified-reset',
      'anthropic-ratelimit-requests-limit',
      'anthropic-ratelimit-requests-remaining',
      'anthropic-ratelimit-requests-reset',
      'anthropic-ratelimit-tokens-limit',
      'anthropic-ratelimit-tokens-remaining',
      'anthropic-ratelimit-tokens-reset'
    ]

    // 敏感头信息黑名单 - 绝对不能记录的敏感信息
    this.sensitiveHeaderBlacklist = [
      'authorization',
      'cookie',
      'set-cookie',
      'x-api-key',
      'x-auth-token',
      'x-access-token',
      'x-session-token',
      'x-csrf-token',
      'x-refresh-token',
      'bearer',
      'basic',
      'api-key',
      'auth-token',
      'access-token',
      'session-token',
      'csrf-token',
      'refresh-token'
    ]

    // 敏感值模式 - 用于检测敏感数据的正则表达式
    this.sensitiveValuePatterns = [
      /bearer\s+[a-zA-Z0-9\-._~+/]+=*/i, // Bearer tokens
      /sk-[a-zA-Z0-9]{48}/i, // OpenAI style API keys
      /xoxb-[0-9]+-[0-9]+-[a-zA-Z0-9]+/i, // Slack bot tokens
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, // UUID tokens
      /ghp_[a-zA-Z0-9]{36}/i, // GitHub personal access tokens
      /ghs_[a-zA-Z0-9]{36}/i, // GitHub server tokens
      /[A-Za-z0-9+/]{40,}={0,2}/i, // Base64 encoded tokens (40+ chars)
      /cr_[a-zA-Z0-9]{32,}/i, // Claude Relay API keys
      /AKIA[0-9A-Z]{16}/i, // AWS Access Key IDs
      /ya29\.[0-9A-Za-z\-_]+/i, // Google OAuth 2.0 access tokens
      /EAA[A-Za-z0-9]+/i, // Facebook access tokens
      /[0-9]{10,}:[A-Za-z0-9\-_]{35}/i, // Discord bot tokens
      /rk_live_[a-zA-Z0-9]+/i, // Stripe live keys
      /rk_test_[a-zA-Z0-9]+/i, // Stripe test keys
      /password=[\w]+/i, // Password parameters
      /pwd=[\w]+/i, // Password parameters
      /pass=[\w]+/i, // Password parameters
      /token=[\w\-._~+/]+=*/i, // Generic token parameters
      /secret=[\w\-._~+/]+=*/i, // Generic secret parameters
      /key=[\w\-._~+/]+=*/i // Generic key parameters
    ]

    // 统计信息
    this.stats = {
      totalRequests: 0,
      blockedHeaders: 0,
      blockedValues: 0,
      compressedHeaders: 0
    }

    // IP地址检测模式（用于识别真实IP地址）
    this.ipPatterns = [
      /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/, // IPv4
      /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/, // IPv6 basic
      /^::1$/, // IPv6 localhost
      /^127\.0\.0\.1$/ // IPv4 localhost
    ]
  }

  /**
   * 过滤请求头信息
   * @param {Object} headers 原始请求头对象
   * @param {Object} options 过滤选项
   * @param {boolean} options.enableCompression 是否启用数据压缩
   * @param {number} options.maxValueLength 最大值长度限制
   * @returns {Object} 过滤后的安全请求头对象
   */
  filterRequestHeaders(headers, options = {}) {
    const { enableCompression = true, maxValueLength = 2000, includeIpInfo = true } = options

    this.stats.totalRequests++

    try {
      if (!headers || typeof headers !== 'object') {
        return {}
      }

      const filteredHeaders = {}
      const originalCount = Object.keys(headers).length

      // 转换为小写键进行比较，但保持原始大小写存储
      const lowerCaseMap = {}
      Object.keys(headers).forEach((key) => {
        lowerCaseMap[key.toLowerCase()] = key
      })

      // 应用白名单过滤
      this.requestHeaderWhitelist.forEach((whitelistedKey) => {
        const lowerKey = whitelistedKey.toLowerCase()
        const originalKey = lowerCaseMap[lowerKey]

        if (originalKey && headers[originalKey]) {
          const value = headers[originalKey]

          // 安全性检查
          if (this._isSafeHeaderValue(originalKey, value, 'request')) {
            // 处理IP地址相关头部
            let processedValue = value
            if (includeIpInfo && this._isIpRelatedHeader(originalKey)) {
              processedValue = this._processIpAddress(value)
            }

            // 截断过长的值
            const truncatedValue = this._truncateValue(processedValue, maxValueLength)
            filteredHeaders[originalKey] = truncatedValue
          } else {
            this.stats.blockedHeaders++
          }
        }
      })

      logger.debug(
        `📋 Filtered request headers: ${originalCount} → ${Object.keys(filteredHeaders).length}`
      )

      // 可选的数据压缩
      if (enableCompression && Object.keys(filteredHeaders).length > 10) {
        this.stats.compressedHeaders++
        return this._compressHeadersData(filteredHeaders)
      }

      return filteredHeaders
    } catch (error) {
      logger.error('❌ Failed to filter request headers:', error)
      return {}
    }
  }

  /**
   * 过滤响应头信息
   * @param {Object} headers 原始响应头对象
   * @param {Object} options 过滤选项
   * @param {boolean} options.enableCompression 是否启用数据压缩
   * @param {number} options.maxValueLength 最大值长度限制
   * @returns {Object} 过滤后的安全响应头对象
   */
  filterResponseHeaders(headers, options = {}) {
    const { enableCompression = true, maxValueLength = 2000 } = options

    try {
      if (!headers || typeof headers !== 'object') {
        return {}
      }

      const filteredHeaders = {}
      const originalCount = Object.keys(headers).length

      // 转换为小写键进行比较，但保持原始大小写存储
      const lowerCaseMap = {}
      Object.keys(headers).forEach((key) => {
        lowerCaseMap[key.toLowerCase()] = key
      })

      // 应用白名单过滤
      this.responseHeaderWhitelist.forEach((whitelistedKey) => {
        const lowerKey = whitelistedKey.toLowerCase()
        const originalKey = lowerCaseMap[lowerKey]

        if (originalKey && headers[originalKey]) {
          const value = headers[originalKey]

          // 安全性检查
          if (this._isSafeHeaderValue(originalKey, value, 'response')) {
            // 截断过长的值
            const truncatedValue = this._truncateValue(value, maxValueLength)
            filteredHeaders[originalKey] = truncatedValue
          } else {
            this.stats.blockedHeaders++
          }
        }
      })

      logger.debug(
        `📋 Filtered response headers: ${originalCount} → ${Object.keys(filteredHeaders).length}`
      )

      // 可选的数据压缩
      if (enableCompression && Object.keys(filteredHeaders).length > 10) {
        this.stats.compressedHeaders++
        return this._compressHeadersData(filteredHeaders)
      }

      return filteredHeaders
    } catch (error) {
      logger.error('❌ Failed to filter response headers:', error)
      return {}
    }
  }

  /**
   * 批量过滤头部信息
   * @param {Object} requestHeaders 请求头
   * @param {Object} responseHeaders 响应头
   * @param {Object} options 过滤选项
   * @returns {Object} 包含过滤后请求头和响应头的对象
   */
  filterHeaders(requestHeaders, responseHeaders, options = {}) {
    return {
      requestHeaders: this.filterRequestHeaders(requestHeaders, options),
      responseHeaders: this.filterResponseHeaders(responseHeaders, options)
    }
  }

  /**
   * 检查头部值是否安全
   * @private
   * @param {string} key 头部键名
   * @param {string} value 头部值
   * @param {string} type 类型 ('request' | 'response')
   * @returns {boolean} 是否安全
   */
  _isSafeHeaderValue(key, value, _type) {
    if (!value || typeof value !== 'string') {
      return false
    }

    const lowerKey = key.toLowerCase()
    const lowerValue = value.toLowerCase()

    // 检查黑名单
    if (
      this.sensitiveHeaderBlacklist.some(
        (blacklisted) => lowerKey.includes(blacklisted) || lowerValue.includes(blacklisted)
      )
    ) {
      logger.debug(`🚫 Blocked sensitive header: ${key}`)
      this.stats.blockedValues++
      return false
    }

    // 检查敏感值模式
    if (this.sensitiveValuePatterns.some((pattern) => pattern.test(value))) {
      logger.debug(`🚫 Blocked header with sensitive pattern: ${key}`)
      this.stats.blockedValues++
      return false
    }

    // 额外的安全检查
    if (value.length > 10000) {
      logger.debug(`🚫 Blocked oversized header value: ${key} (${value.length} chars)`)
      this.stats.blockedValues++
      return false
    }

    return true
  }

  /**
   * 截断过长的值
   * @private
   * @param {string} value 原始值
   * @param {number} maxLength 最大长度
   * @returns {string} 截断后的值
   */
  _truncateValue(value, maxLength) {
    if (!value || typeof value !== 'string') {
      return value
    }

    if (value.length <= maxLength) {
      return value
    }

    const truncated = `${value.substring(0, maxLength - 10)}...[truncated]`
    logger.debug(`✂️ Truncated header value: ${value.length} → ${truncated.length} chars`)
    return truncated
  }

  /**
   * 压缩头部数据
   * @private
   * @param {Object} headers 头部数据
   * @returns {Object} 压缩后的头部数据
   */
  _compressHeadersData(headers) {
    try {
      // 简单的数据压缩策略：移除重复值，简化常见值
      const compressed = {}
      const valueMap = new Map()

      Object.entries(headers).forEach(([key, value]) => {
        // 如果值已经出现过，使用引用
        if (valueMap.has(value)) {
          compressed[key] = `@ref:${valueMap.get(value)}`
        } else {
          // 简化常见值
          const simplifiedValue = this._simplifyCommonValues(value)
          compressed[key] = simplifiedValue
          valueMap.set(value, key)
        }
      })

      logger.debug(`🗜️ Compressed headers data: ${Object.keys(headers).length} entries`)
      return compressed
    } catch (error) {
      logger.debug('Failed to compress headers, returning original:', error)
      return headers
    }
  }

  /**
   * 简化常见值
   * @private
   * @param {string} value 原始值
   * @returns {string} 简化后的值
   */
  _simplifyCommonValues(value) {
    // 简化常见的用户代理字符串
    if (value.includes('Mozilla') && value.length > 100) {
      const match = value.match(/(Chrome|Firefox|Safari|Edge)\/[\d.]+/)
      if (match) {
        return `${match[0]} (simplified)`
      }
    }

    // 简化长的Accept头部
    if (value.includes('text/html') && value.length > 50) {
      return 'text/html,application/xhtml+xml,*/*'
    }

    return value
  }

  /**
   * 验证过滤结果
   * @param {Object} originalHeaders 原始头部
   * @param {Object} filteredHeaders 过滤后的头部
   * @returns {Object} 验证结果
   */
  validateFilterResult(originalHeaders, filteredHeaders) {
    const result = {
      isValid: true,
      originalCount: Object.keys(originalHeaders || {}).length,
      filteredCount: Object.keys(filteredHeaders || {}).length,
      removedCount: 0,
      warnings: []
    }

    result.removedCount = result.originalCount - result.filteredCount

    // 检查是否移除了过多的头部
    if (result.removedCount > result.originalCount * 0.8) {
      result.warnings.push('High header removal rate - may be too restrictive')
    }

    // 检查关键头部是否保留
    const criticalHeaders = ['user-agent', 'content-type']
    criticalHeaders.forEach((header) => {
      if (originalHeaders[header] && !filteredHeaders[header]) {
        result.warnings.push(`Critical header '${header}' was removed`)
      }
    })

    logger.debug(`✅ Header filter validation: ${result.originalCount} → ${result.filteredCount}`)

    return result
  }

  /**
   * 更新白名单配置
   * @param {string} type 类型 ('request' | 'response')
   * @param {Array<string>} whitelist 新的白名单数组
   */
  updateWhitelist(type, whitelist) {
    if (!Array.isArray(whitelist)) {
      throw new Error('Whitelist must be an array')
    }

    if (type === 'request') {
      this.requestHeaderWhitelist = [...whitelist]
      logger.info(`🔄 Updated request header whitelist: ${whitelist.length} entries`)
    } else if (type === 'response') {
      this.responseHeaderWhitelist = [...whitelist]
      logger.info(`🔄 Updated response header whitelist: ${whitelist.length} entries`)
    } else {
      throw new Error("Type must be 'request' or 'response'")
    }
  }

  /**
   * 检查是否是IP相关的头部
   * @private
   * @param {string} headerName 头部名称
   * @returns {boolean} 是否是IP相关头部
   */
  _isIpRelatedHeader(headerName) {
    const lowerHeader = headerName.toLowerCase()
    return ['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip', 'x-client-ip'].includes(lowerHeader)
  }

  /**
   * 处理IP地址，屏蔽最后一段保护隐私
   * @private
   * @param {string} ipValue IP地址值
   * @returns {string} 处理后的IP地址
   */
  _processIpAddress(ipValue) {
    if (!ipValue || typeof ipValue !== 'string') {
      return ipValue
    }

    // 处理逗号分隔的多个IP（常见于X-Forwarded-For）
    const ips = ipValue.split(',').map((ip) => ip.trim())

    return ips
      .map((ip) => {
        // 检查是否是有效的IPv4地址
        if (this.ipPatterns[0].test(ip)) {
          const parts = ip.split('.')
          // 屏蔽最后一段：192.168.1.100 -> 192.168.1.***
          return `${parts[0]}.${parts[1]}.${parts[2]}.***`
        }

        // 检查是否是IPv6地址
        if (this.ipPatterns[1].test(ip)) {
          // 屏蔽IPv6地址的后半部分
          const parts = ip.split(':')
          if (parts.length >= 4) {
            return `${parts.slice(0, 4).join(':')}:***`
          }
        }

        // 如果不是标准IP格式，返回原值或模糊处理
        return ip.length > 10 ? `${ip.substring(0, 8)}***` : ip
      })
      .join(', ')
  }

  /**
   * 重置统计信息
   */
  resetStats() {
    this.stats = {
      totalRequests: 0,
      blockedHeaders: 0,
      blockedValues: 0,
      compressedHeaders: 0
    }
    logger.info('🔄 Headers filter stats reset')
  }

  /**
   * 获取当前配置统计
   * @returns {Object} 配置统计信息
   */
  getFilterStats() {
    return {
      requestWhitelistCount: this.requestHeaderWhitelist.length,
      responseWhitelistCount: this.responseHeaderWhitelist.length,
      sensitiveBlacklistCount: this.sensitiveHeaderBlacklist.length,
      sensitivePatternCount: this.sensitiveValuePatterns.length,
      stats: this.stats,
      version: '1.1.0'
    }
  }
}

module.exports = HeadersFilterService
