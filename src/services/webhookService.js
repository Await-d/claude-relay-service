const axios = require('axios')
const crypto = require('crypto')
const nodemailer = require('nodemailer')
const { HttpsProxyAgent } = require('https-proxy-agent')
const { SocksProxyAgent } = require('socks-proxy-agent')
const logger = require('../utils/logger')
const webhookConfigService = require('./webhookConfigService')
const { getISOStringWithTimezone } = require('../utils/dateHelper')
const appConfig = require('../../config/config')

class WebhookService {
  constructor() {
    this.platformHandlers = {
      wechat_work: this.sendToWechatWork.bind(this),
      dingtalk: this.sendToDingTalk.bind(this),
      feishu: this.sendToFeishu.bind(this),
      slack: this.sendToSlack.bind(this),
      discord: this.sendToDiscord.bind(this),
      telegram: this.sendToTelegram.bind(this),
      custom: this.sendToCustom.bind(this),
      bark: this.sendToBark.bind(this),
      iyuu: this.sendToIYUU.bind(this),
      smtp: this.sendToSMTP.bind(this)
    }
    this.timezone = appConfig.system?.timezone || 'Asia/Shanghai'
  }

  getLocalizedTimestamp(date = new Date()) {
    return date.toLocaleString('zh-CN', { timeZone: this.timezone })
  }

  /**
   * 发送通知到所有启用的平台
   */
  async sendNotification(type, data) {
    try {
      const config = await webhookConfigService.getConfig()

      // 检查是否启用webhook
      if (!config.enabled) {
        logger.debug('Webhook通知已禁用')
        return
      }

      // 检查通知类型是否启用（test类型始终允许发送）
      if (type !== 'test' && config.notificationTypes && !config.notificationTypes[type]) {
        logger.debug(`通知类型 ${type} 已禁用`)
        return
      }

      // 获取启用的平台
      const enabledPlatforms = await webhookConfigService.getEnabledPlatforms()
      if (enabledPlatforms.length === 0) {
        logger.debug('没有启用的webhook平台')
        return
      }

      logger.info(`📢 发送 ${type} 通知到 ${enabledPlatforms.length} 个平台`)

      // 并发发送到所有平台
      const promises = enabledPlatforms.map((platform) =>
        this.sendToPlatform(platform, type, data, config.retrySettings)
      )

      const results = await Promise.allSettled(promises)

      // 记录结果
      const succeeded = results.filter((r) => r.status === 'fulfilled').length
      const failed = results.filter((r) => r.status === 'rejected').length

      if (failed > 0) {
        logger.warn(`⚠️ Webhook通知: ${succeeded}成功, ${failed}失败`)
      } else {
        logger.info(`✅ 所有webhook通知发送成功`)
      }

      return { succeeded, failed }
    } catch (error) {
      logger.error('发送webhook通知失败:', error)
      throw error
    }
  }

  /**
   * 发送到特定平台
   */
  async sendToPlatform(platform, type, data, retrySettings) {
    try {
      const handler = this.platformHandlers[platform.type]
      if (!handler) {
        throw new Error(`不支持的平台类型: ${platform.type}`)
      }

      // 使用平台特定的处理器
      await this.retryWithBackoff(
        () => handler(platform, type, data),
        retrySettings?.maxRetries || 3,
        retrySettings?.retryDelay || 1000
      )

      logger.info(`✅ 成功发送到 ${platform.name || platform.type}`)
    } catch (error) {
      logger.error(`❌ 发送到 ${platform.name || platform.type} 失败:`, error.message)
      throw error
    }
  }

  /**
   * 企业微信webhook
   */
  async sendToWechatWork(platform, type, data) {
    const content = this.formatMessageForWechatWork(type, data)

    const payload = {
      msgtype: 'markdown',
      markdown: {
        content
      }
    }

    await this.sendHttpRequest(platform.url, payload, platform.timeout || 10000)
  }

  /**
   * 钉钉webhook
   */
  async sendToDingTalk(platform, type, data) {
    const content = this.formatMessageForDingTalk(type, data)

    let { url } = platform
    const payload = {
      msgtype: 'markdown',
      markdown: {
        title: this.getNotificationTitle(type),
        text: content
      }
    }

    // 如果启用签名
    if (platform.enableSign && platform.secret) {
      const timestamp = Date.now()
      const sign = this.generateDingTalkSign(platform.secret, timestamp)
      url = `${url}&timestamp=${timestamp}&sign=${encodeURIComponent(sign)}`
    }

    await this.sendHttpRequest(url, payload, platform.timeout || 10000)
  }

  /**
   * 飞书webhook
   */
  async sendToFeishu(platform, type, data) {
    const content = this.formatMessageForFeishu(type, data)

    const payload = {
      msg_type: 'interactive',
      card: {
        elements: [
          {
            tag: 'markdown',
            content
          }
        ],
        header: {
          title: {
            tag: 'plain_text',
            content: this.getNotificationTitle(type)
          },
          template: this.getFeishuCardColor(type)
        }
      }
    }

    // 如果启用签名
    if (platform.enableSign && platform.secret) {
      const timestamp = Math.floor(Date.now() / 1000)
      const sign = this.generateFeishuSign(platform.secret, timestamp)
      payload.timestamp = timestamp.toString()
      payload.sign = sign
    }

    await this.sendHttpRequest(platform.url, payload, platform.timeout || 10000)
  }

  /**
   * Slack webhook
   */
  async sendToSlack(platform, type, data) {
    const text = this.formatMessageForSlack(type, data)

    const payload = {
      text,
      username: 'Claude Relay Service',
      icon_emoji: this.getSlackEmoji(type)
    }

    await this.sendHttpRequest(platform.url, payload, platform.timeout || 10000)
  }

  /**
   * Discord webhook
   */
  async sendToDiscord(platform, type, data) {
    const embed = this.formatMessageForDiscord(type, data)

    const payload = {
      username: 'Claude Relay Service',
      embeds: [embed]
    }

    await this.sendHttpRequest(platform.url, payload, platform.timeout || 10000)
  }

  /**
   * Telegram Bot 通知
   */
  async sendToTelegram(platform, type, data) {
    if (!platform.botToken) {
      throw new Error('Telegram 配置缺少 botToken')
    }

    if (!platform.chatId) {
      throw new Error('Telegram 配置缺少 chatId')
    }

    const title = this.getNotificationTitle(type)
    const timestamp = this.getLocalizedTimestamp()
    const details = this.buildNotificationDetails(data)

    const lines = details.map(
      (detail) => `<b>${this.escapeHtml(detail.label)}</b>: ${this.escapeHtml(detail.value)}`
    )

    const htmlMessage = `
<b>${this.escapeHtml(title)}</b>

<b>服务</b>: Claude Relay Service
<b>时间</b>: ${this.escapeHtml(timestamp)}

${lines.join('\n')}
    `.trim()

    const apiBase = platform.apiBaseUrl || 'https://api.telegram.org'
    const url = `${apiBase.replace(/\/$/, '')}/bot${platform.botToken}/sendMessage`
    const payload = {
      chat_id: platform.chatId,
      text: htmlMessage,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    }

    if (platform.messageThreadId) {
      payload.message_thread_id = platform.messageThreadId
    }

    const axiosConfig = this.getProxyAxiosConfig(platform.proxyUrl)

    await this.sendHttpRequest(url, payload, platform.timeout || 10000, axiosConfig)
  }

  /**
   * SMTP 邮件通知
   */
  async sendToSMTP(platform, type, data) {
    if (!platform.host) {
      throw new Error('SMTP 配置缺少 host')
    }
    if (!platform.port) {
      throw new Error('SMTP 配置缺少 port')
    }
    if (!platform.to) {
      throw new Error('SMTP 配置缺少收件人 (to)')
    }

    const transportOptions = {
      host: platform.host,
      port: platform.port,
      secure:
        typeof platform.secure === 'boolean' ? platform.secure : Number(platform.port) === 465,
      auth: platform.username
        ? {
            user: platform.username,
            pass: platform.password
          }
        : undefined,
      tls: platform.rejectUnauthorized === false ? { rejectUnauthorized: false } : undefined
    }

    if (platform.proxyUrl) {
      transportOptions.proxy = platform.proxyUrl
    }

    const transporter = nodemailer.createTransport(transportOptions)

    const title = this.getNotificationTitle(type)
    const html = this.formatMessageForEmail(type, data)
    const text = this.formatMessageForEmailText(type, data)

    const mailOptions = {
      from: platform.from || platform.username,
      to: this.normalizeRecipients(platform.to),
      subject: title.replace(/^([\p{Emoji}\p{Extended_Pictographic}]+\s*)/u, ''),
      text,
      html
    }

    if (platform.cc) {
      mailOptions.cc = this.normalizeRecipients(platform.cc)
    }
    if (platform.bcc) {
      mailOptions.bcc = this.normalizeRecipients(platform.bcc)
    }

    await transporter.sendMail(mailOptions)
  }

  /**
   * Bark推送 - iOS推送通知服务
   */
  async sendToBark(platform, type, data) {
    const title = this.getNotificationTitle(type)
    const body = this.formatBarkMessage(data)

    // Bark API格式: https://api.day.app/[key]/[title]/[body]?[params]
    // 或者使用POST方式发送JSON

    let { url } = platform
    let method = 'GET'
    let payload = null

    // 检查URL格式，决定使用GET还是POST方式
    if (platform.usePost || platform.url.includes('/push')) {
      // POST方式 - 适用于自建Bark服务器或需要复杂参数的情况
      method = 'POST'
      payload = {
        title,
        body,
        device_key: platform.deviceKey, // Bark设备密钥
        ...this.getBarkExtraParams(platform, type)
      }
    } else {
      // GET方式 - 传统Bark URL格式
      // 确保URL格式正确: https://api.day.app/[deviceKey]/
      if (!platform.deviceKey) {
        throw new Error('Bark推送需要设备密钥 (deviceKey)')
      }

      // 构建GET请求URL
      const encodedTitle = encodeURIComponent(title)
      const encodedBody = encodeURIComponent(body)
      const extraParams = this.getBarkExtraParams(platform, type)
      const paramString = new URLSearchParams(extraParams).toString()

      url = `${platform.url.replace(/\/$/, '')}/${platform.deviceKey}/${encodedTitle}/${encodedBody}`
      if (paramString) {
        url += `?${paramString}`
      }
    }

    if (method === 'POST') {
      await this.sendHttpRequest(url, payload, platform.timeout || 10000)
    } else {
      // GET请求
      await this.sendHttpGetRequest(url, platform.timeout || 10000)
    }
  }

  /**
   * IYUU推送 - 支持GET/POST双模式和智能切换
   */
  async sendToIYUU(platform, type, data) {
    const title = this.getNotificationTitle(type)
    const content = this.formatMessageForIYUU(type, data)

    // 构建IYUU API URL
    const baseUrl = `https://iyuu.cn/${platform.token}.send`

    // 准备参数
    const params = {
      text: title,
      desp: content
    }

    // 检查参数长度，决定使用GET还是POST
    const paramString = new URLSearchParams(params).toString()
    const usePost = paramString.length > 1800 || platform.forcePost // URL长度限制或强制使用POST

    try {
      if (usePost) {
        // POST方式发送
        await this.sendHttpRequest(baseUrl, params, platform.timeout || 10000)
      } else {
        // GET方式发送
        const url = `${baseUrl}?${paramString}`
        await this.sendHttpGetRequest(url, platform.timeout || 10000)
      }

      logger.debug(`✅ IYUU推送成功 (${usePost ? 'POST' : 'GET'}方式)`, {
        platform: platform.name || 'IYUU',
        type,
        titleLength: title.length,
        contentLength: content.length
      })
    } catch (error) {
      // 如果GET方式失败且是413错误，尝试POST方式
      if (!usePost && error.response && error.response.status === 413) {
        logger.warn('📝 IYUU GET请求过大，自动切换到POST方式重试')
        await this.sendHttpRequest(baseUrl, params, platform.timeout || 10000)
        logger.debug('✅ IYUU POST重试成功')
      } else {
        // 处理特定错误
        this.handleIYUUError(error)
        throw error
      }
    }
  }

  /**
   * 处理IYUU推送错误
   */
  handleIYUUError(error) {
    if (error.response) {
      const { status } = error.response
      const { data } = error.response

      switch (status) {
        case 404:
          throw new Error('IYUU Token无效或不存在')
        case 413:
          throw new Error('请求参数过大，建议使用POST方式或减少内容长度')
        case 429:
          throw new Error('IYUU推送频率限制，请稍后再试')
        case 500:
          throw new Error('IYUU服务器内部错误，请稍后再试')
        default:
          if (data && data.errmsg) {
            throw new Error(`IYUU推送失败: ${data.errmsg}`)
          }
          throw new Error(`IYUU推送失败: HTTP ${status}`)
      }
    } else if (error.code === 'ECONNREFUSED') {
      throw new Error('无法连接到IYUU服务器，请检查网络连接')
    } else if (error.code === 'ETIMEDOUT') {
      throw new Error('IYUU推送超时，请稍后再试')
    } else {
      throw new Error(`IYUU推送失败: ${error.message}`)
    }
  }

  /**
   * 格式化IYUU消息内容
   */
  formatMessageForIYUU(type, data) {
    const lines = []

    // 添加服务信息
    lines.push('**服务**: Claude Relay Service')
    lines.push(`**时间**: ${this.getLocalizedTimestamp()}`)
    lines.push('')

    // 添加详细信息
    if (data.accountName) {
      lines.push(`**账号**: ${data.accountName}`)
    }

    if (data.platform) {
      lines.push(`**平台**: ${data.platform}`)
    }

    if (data.status) {
      lines.push(`**状态**: ${data.status}`)
    }

    if (data.errorCode) {
      lines.push(`**错误代码**: ${data.errorCode}`)
    }

    if (data.reason) {
      lines.push(`**原因**: ${data.reason}`)
    }

    if (data.message) {
      lines.push(`**消息**: ${data.message}`)
    }

    if (data.quota) {
      lines.push(`**配额信息**: ${data.quota.remaining}/${data.quota.total} 剩余`)
      if (data.quota.percentage !== undefined) {
        lines.push(`**使用率**: ${data.quota.percentage}%`)
      }
    }

    if (data.usage) {
      lines.push(`**使用率**: ${data.usage}%`)
    }

    // 添加操作建议（根据通知类型）
    switch (type) {
      case 'accountAnomaly':
        lines.push('')
        lines.push('🔧 **建议操作**:')
        lines.push('- 检查账号登录状态')
        lines.push('- 验证代理配置')
        lines.push('- 查看详细日志')
        break
      case 'quotaWarning':
        lines.push('')
        lines.push('📈 **建议操作**:')
        lines.push('- 监控使用情况')
        lines.push('- 考虑增加配额')
        lines.push('- 优化使用策略')
        break
      case 'systemError':
        lines.push('')
        lines.push('🚨 **建议操作**:')
        lines.push('- 立即检查系统状态')
        lines.push('- 查看错误日志')
        lines.push('- 必要时重启服务')
        break
      case 'securityAlert':
        lines.push('')
        lines.push('🔒 **建议操作**:')
        lines.push('- 立即检查安全设置')
        lines.push('- 审查访问日志')
        lines.push('- 更新安全配置')
        break
    }

    return lines.join('\n')
  }

  /**
   * 自定义webhook
   */
  async sendToCustom(platform, type, data) {
    // 使用通用格式
    const payload = {
      type,
      service: 'claude-relay-service',
      timestamp: getISOStringWithTimezone(new Date()),
      data
    }

    await this.sendHttpRequest(platform.url, payload, platform.timeout || 10000)
  }

  /**
   * 发送HTTP请求
   */
  async sendHttpRequest(url, payload, timeout, extraConfig = {}) {
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'claude-relay-service/2.0',
      ...(extraConfig.headers || {})
    }

    const axiosConfig = {
      timeout,
      ...extraConfig,
      headers
    }

    const response = await axios.post(url, payload, axiosConfig)

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    return response.data
  }

  /**
   * 发送HTTP GET请求 (用于Bark等GET方式的webhook)
   */
  async sendHttpGetRequest(url, timeout) {
    const response = await axios.get(url, {
      timeout,
      headers: {
        'User-Agent': 'claude-relay-service/2.0'
      }
    })

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    return response.data
  }

  /**
   * 重试机制
   */
  async retryWithBackoff(fn, maxRetries, baseDelay) {
    let lastError

    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn()
      } catch (error) {
        lastError = error

        if (i < maxRetries - 1) {
          const delay = baseDelay * Math.pow(2, i) // 指数退避
          logger.debug(`🔄 重试 ${i + 1}/${maxRetries}，等待 ${delay}ms`)
          await new Promise((resolve) => setTimeout(resolve, delay))
        }
      }
    }

    throw lastError
  }

  /**
   * 生成钉钉签名
   */
  generateDingTalkSign(secret, timestamp) {
    const stringToSign = `${timestamp}\n${secret}`
    const hmac = crypto.createHmac('sha256', secret)
    hmac.update(stringToSign)
    return hmac.digest('base64')
  }

  /**
   * 生成飞书签名
   */
  generateFeishuSign(secret, timestamp) {
    const stringToSign = `${timestamp}\n${secret}`
    const hmac = crypto.createHmac('sha256', stringToSign)
    hmac.update('')
    return hmac.digest('base64')
  }

  /**
   * 格式化企业微信消息
   */
  formatMessageForWechatWork(type, data) {
    const title = this.getNotificationTitle(type)
    const details = this.formatNotificationDetails(data)

    const timestamp = this.getLocalizedTimestamp()
    return `## ${title}\n\n> **服务**: Claude Relay Service\n> **时间**: ${timestamp}\n\n${details}`
  }

  /**
   * 格式化钉钉消息
   */
  formatMessageForDingTalk(type, data) {
    const details = this.formatNotificationDetails(data)

    const timestamp = this.getLocalizedTimestamp()
    return `#### 服务: Claude Relay Service\n#### 时间: ${timestamp}\n\n${details}`
  }

  /**
   * 格式化飞书消息
   */
  formatMessageForFeishu(type, data) {
    return this.formatNotificationDetails(data)
  }

  /**
   * 格式化Slack消息
   */
  formatMessageForSlack(type, data) {
    const title = this.getNotificationTitle(type)
    const timestamp = this.getLocalizedTimestamp()
    const details = this.formatNotificationDetails(data)

    return `*${title}*\n服务: Claude Relay Service\n时间: ${timestamp}\n\n${details}`
  }

  /**
   * 格式化Discord消息
   */
  formatMessageForDiscord(type, data) {
    const title = this.getNotificationTitle(type)
    const color = this.getDiscordColor(type)
    const fields = this.formatNotificationFields(data)

    return {
      title,
      color,
      fields,
      timestamp: new Date().toISOString(),
      footer: {
        text: 'Claude Relay Service'
      }
    }
  }

  /**
   * 格式化Bark消息内容
   */
  formatBarkMessage(data) {
    const lines = []

    if (data.accountName) {
      lines.push(`账号: ${data.accountName}`)
    }

    if (data.platform) {
      lines.push(`平台: ${data.platform}`)
    }

    if (data.status) {
      lines.push(`状态: ${data.status}`)
    }

    if (data.errorCode) {
      lines.push(`错误代码: ${data.errorCode}`)
    }

    if (data.reason) {
      lines.push(`原因: ${data.reason}`)
    }

    if (data.message) {
      lines.push(`消息: ${data.message}`)
    }

    if (data.quota) {
      lines.push(`剩余配额: ${data.quota.remaining}/${data.quota.total}`)
    }

    if (data.usage) {
      lines.push(`使用率: ${data.usage}%`)
    }

    // 添加时间戳
    lines.push(`时间: ${this.getLocalizedTimestamp()}`)

    return lines.join('\n')
  }

  /**
   * 获取Bark额外参数
   */
  getBarkExtraParams(platform, type) {
    const params = {}

    // 设置声音
    if (platform.sound) {
      params.sound = platform.sound
    } else {
      // 根据通知类型设置不同声音
      const sounds = {
        systemError: 'alarm',
        securityAlert: 'multiwayinvitation',
        accountAnomaly: 'calypso',
        quotaWarning: 'bell',
        test: 'birdsong'
      }
      params.sound = sounds[type] || 'bell'
    }

    // 设置徽章数字
    if (platform.badge !== undefined) {
      params.badge = platform.badge
    }

    // 设置分组
    if (platform.group) {
      params.group = platform.group
    } else {
      params.group = 'claude-relay-service'
    }

    // 设置图标
    if (platform.icon) {
      params.icon = platform.icon
    }

    // 设置URL (点击通知时打开) - 这应该是点击通知后要打开的URL，不是推送服务的URL
    if (platform.clickUrl) {
      params.url = platform.clickUrl
    }

    // 自动复制到剪贴板
    if (platform.copy) {
      params.copy = platform.copy
    }

    // 设置中断级别 (iOS 15+)
    if (platform.level) {
      params.level = platform.level // passive, active, critical
    } else {
      // 根据通知类型设置中断级别
      const levels = {
        systemError: 'critical',
        securityAlert: 'critical',
        accountAnomaly: 'active',
        quotaWarning: 'active',
        test: 'passive'
      }
      params.level = levels[type] || 'active'
    }

    return params
  }

  /**
   * 获取通知标题
   */
  getNotificationTitle(type) {
    const titles = {
      accountAnomaly: '⚠️ 账号异常通知',
      quotaWarning: '📊 配额警告',
      systemError: '❌ 系统错误',
      securityAlert: '🔒 安全警报',
      rateLimitRecovery: '🎉 限流恢复通知',
      test: '🧪 测试通知'
    }

    return titles[type] || '📢 系统通知'
  }

  buildNotificationDetails(data = {}) {
    const details = []

    if (data.accountName) {
      details.push({ label: '账号', value: data.accountName })
    }

    if (data.platform) {
      details.push({ label: '平台', value: data.platform })
    }

    if (data.platforms && Array.isArray(data.platforms) && data.platforms.length > 0) {
      details.push({ label: '涉及平台', value: data.platforms.join(', ') })
    }

    if (data.totalAccounts !== undefined) {
      details.push({ label: '涉及账户数', value: String(data.totalAccounts) })
    }

    if (data.status) {
      const color = this.getStatusColor(data.status)
      details.push({ label: '状态', value: data.status, color })
    }

    if (data.errorCode) {
      details.push({ label: '错误代码', value: data.errorCode, isCode: true })
    }

    if (data.reason) {
      details.push({ label: '原因', value: data.reason })
    }

    if (data.message) {
      details.push({ label: '消息', value: data.message })
    }

    if (data.quota) {
      const quotaLine = `${data.quota.remaining}/${data.quota.total}`
      details.push({ label: '剩余配额', value: quotaLine })
      if (data.quota.percentage !== undefined) {
        details.push({ label: '使用率', value: `${data.quota.percentage}%` })
      }
    }

    if (data.usage !== undefined) {
      details.push({ label: '使用率', value: `${data.usage}%` })
    }

    if (data.metadata && typeof data.metadata === 'object') {
      Object.entries(data.metadata).forEach(([key, value]) => {
        details.push({
          label: key,
          value: typeof value === 'object' ? JSON.stringify(value) : value
        })
      })
    }

    return details
  }

  getStatusColor(status) {
    const colors = {
      error: '#dc3545',
      unauthorized: '#fd7e14',
      blocked: '#6f42c1',
      disabled: '#6c757d',
      active: '#28a745',
      warning: '#ffc107',
      recovered: '#28a745'
    }

    return colors[status] || '#007bff'
  }

  /**
   * 格式化通知详情
   */
  formatNotificationDetails(data) {
    const details = this.buildNotificationDetails(data)
    return details.map((detail) => `**${detail.label}**: ${detail.value}`).join('\n')
  }

  /**
   * 格式化Discord字段
   */
  formatNotificationFields(data) {
    const details = this.buildNotificationDetails(data)
    return details.map((detail) => ({
      name: detail.label,
      value: String(detail.value),
      inline: detail.value && String(detail.value).length <= 32
    }))
  }

  formatMessageForEmail(type, data) {
    const title = this.getNotificationTitle(type)
    const timestamp = this.getLocalizedTimestamp()
    const details = this.buildNotificationDetails(data)

    const detailHtml = details
      .map((detail) => {
        const label = this.escapeHtml(detail.label)
        const value = this.escapeHtml(detail.value)
        if (detail.color) {
          return `<p><strong>${label}:</strong> <span style="color: ${detail.color};">${value}</span></p>`
        }
        if (detail.isCode) {
          return `<p><strong>${label}:</strong> <code style="background: #f1f3f4; padding: 2px 6px; border-radius: 4px;">${value}</code></p>`
        }
        return `<p><strong>${label}:</strong> ${value}</p>`
      })
      .join('\n')

    return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif; background: #f6f8fb; padding: 24px;">
  <div style="max-width: 640px; margin: 0 auto; background: #ffffff; border-radius: 12px; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08); overflow: hidden;">
    <div style="background: linear-gradient(135deg, #4f46e5, #7c3aed); color: white; padding: 20px 24px;">
      <h2 style="margin: 0; font-size: 20px; font-weight: 600;">${this.escapeHtml(title)}</h2>
      <p style="margin: 6px 0 0; opacity: 0.85;">Claude Relay Service</p>
    </div>
    <div style="padding: 24px;">
      ${detailHtml || '<p>暂无更多详情</p>'}
    </div>
    <div style="padding: 16px 24px; background: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 13px; color: #475569;">
      <p style="margin: 0 0 8px;"><strong>发送时间:</strong> ${this.escapeHtml(timestamp)}</p>
      <p style="margin: 0;">此邮件由 Claude Relay Service 自动发送，请勿直接回复。</p>
    </div>
  </div>
</div>
    `.trim()
  }

  formatMessageForEmailText(type, data) {
    const title = this.getNotificationTitle(type)
    const timestamp = this.getLocalizedTimestamp()
    const details = this.buildNotificationDetails(data)

    const body = details.map((detail) => `${detail.label}: ${detail.value}`).join('\n')

    return `${title}\n=====================================\n服务: Claude Relay Service\n时间: ${timestamp}\n\n${body}\n\n此邮件由系统自动发送，请勿回复。`
  }

  /**
   * 获取飞书卡片颜色
   */
  getFeishuCardColor(type) {
    const colors = {
      accountAnomaly: 'orange',
      quotaWarning: 'yellow',
      systemError: 'red',
      securityAlert: 'red',
      rateLimitRecovery: 'green',
      test: 'blue'
    }

    return colors[type] || 'blue'
  }

  /**
   * 获取Slack emoji
   */
  getSlackEmoji(type) {
    const emojis = {
      accountAnomaly: ':warning:',
      quotaWarning: ':chart_with_downwards_trend:',
      systemError: ':x:',
      securityAlert: ':lock:',
      rateLimitRecovery: ':tada:',
      test: ':test_tube:'
    }

    return emojis[type] || ':bell:'
  }

  /**
   * 获取Discord颜色
   */
  getDiscordColor(type) {
    const colors = {
      accountAnomaly: 0xff9800, // 橙色
      quotaWarning: 0xffeb3b, // 黄色
      systemError: 0xf44336, // 红色
      securityAlert: 0xf44336, // 红色
      rateLimitRecovery: 0x4caf50, // 绿色
      test: 0x2196f3 // 蓝色
    }

    return colors[type] || 0x9e9e9e // 灰色
  }

  normalizeRecipients(value) {
    if (!value) {
      return undefined
    }

    if (Array.isArray(value)) {
      return value.join(', ')
    }

    if (typeof value === 'string') {
      return value
        .split(/[;,]/)
        .map((item) => item.trim())
        .filter(Boolean)
        .join(', ')
    }

    return value
  }

  escapeHtml(value) {
    if (value === undefined || value === null) {
      return ''
    }

    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  getProxyAxiosConfig(proxyUrl) {
    if (!proxyUrl) {
      return {}
    }

    const agent = /^socks/i.test(proxyUrl)
      ? new SocksProxyAgent(proxyUrl)
      : new HttpsProxyAgent(proxyUrl)

    return {
      httpsAgent: agent,
      httpAgent: agent,
      proxy: false
    }
  }

  /**
   * 测试webhook连接
   */
  async testWebhook(platform) {
    try {
      const testData = {
        message: 'Claude Relay Service webhook测试',
        timestamp: getISOStringWithTimezone(new Date())
      }

      await this.sendToPlatform(platform, 'test', testData, { maxRetries: 1, retryDelay: 1000 })

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error.message
      }
    }
  }
}

module.exports = new WebhookService()
