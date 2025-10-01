const database = require('../models/database')
const logger = require('../utils/logger')
const { v4: uuidv4 } = require('uuid')

class WebhookConfigService {
  constructor() {
    this.KEY_PREFIX = 'webhook_config'
    this.DEFAULT_CONFIG_KEY = `${this.KEY_PREFIX}:default`
  }

  /**
   * 获取webhook配置
   */
  async getConfig() {
    try {
      const configStr = await database.client.get(this.DEFAULT_CONFIG_KEY)
      if (!configStr) {
        // 返回默认配置
        return this.getDefaultConfig()
      }
      return JSON.parse(configStr)
    } catch (error) {
      logger.error('获取webhook配置失败:', error)
      return this.getDefaultConfig()
    }
  }

  /**
   * 保存webhook配置
   */
  async saveConfig(config) {
    try {
      // 验证配置
      this.validateConfig(config)

      // 添加更新时间
      config.updatedAt = new Date().toISOString()

      await database.client.set(this.DEFAULT_CONFIG_KEY, JSON.stringify(config))
      logger.info('✅ Webhook配置已保存')

      return config
    } catch (error) {
      logger.error('保存webhook配置失败:', error)
      throw error
    }
  }

  /**
   * 验证配置
   */
  validateConfig(config) {
    if (!config || typeof config !== 'object') {
      throw new Error('无效的配置格式')
    }

    // 验证平台配置
    if (config.platforms) {
      const validPlatforms = [
        'wechat_work',
        'dingtalk',
        'feishu',
        'slack',
        'discord',
        'telegram',
        'custom',
        'bark',
        'iyuu',
        'smtp'
      ]

      for (const platform of config.platforms) {
        if (!validPlatforms.includes(platform.type)) {
          throw new Error(`不支持的平台类型: ${platform.type}`)
        }

        // 特殊平台验证处理
        if (['bark', 'smtp', 'telegram'].includes(platform.type)) {
          // 这些平台不强制要求 URL
        } else {
          if (!platform.url || !this.isValidUrl(platform.url)) {
            throw new Error(`无效的webhook URL: ${platform.url}`)
          }
        }

        if (platform.type === 'bark') {
          this.validateBarkConfig(platform)
        } else if (platform.type === 'iyuu') {
          this.validateIYUUConfig(platform)
        } else if (platform.type === 'telegram') {
          this.validateTelegramConfig(platform)
        } else if (platform.type === 'smtp') {
          this.validateSMTPConfig(platform)
        }

        // 验证平台特定的配置
        this.validatePlatformConfig(platform)
      }
    }
  }

  /**
   * 验证平台特定配置
   */
  validatePlatformConfig(platform) {
    switch (platform.type) {
      case 'wechat_work':
        // 企业微信不需要额外配置
        break
      case 'dingtalk':
        // 钉钉可能需要secret用于签名
        if (platform.enableSign && !platform.secret) {
          throw new Error('钉钉启用签名时必须提供secret')
        }
        break
      case 'feishu':
        // 飞书可能需要签名
        if (platform.enableSign && !platform.secret) {
          throw new Error('飞书启用签名时必须提供secret')
        }
        break
      case 'slack':
        // Slack webhook URL通常包含token
        if (!platform.url.includes('hooks.slack.com')) {
          logger.warn('⚠️ Slack webhook URL格式可能不正确')
        }
        break
      case 'discord':
        // Discord webhook URL格式检查
        if (!platform.url.includes('discord.com/api/webhooks')) {
          logger.warn('⚠️ Discord webhook URL格式可能不正确')
        }
        break
      case 'telegram':
        // Telegram 配置已单独验证
        break
      case 'bark':
        // Bark配置已在 validateBarkConfig 中验证
        break
      case 'iyuu':
        // IYUU配置已在 validateIYUUConfig 中验证
        break
      case 'smtp':
        // SMTP 配置已在 validateSMTPConfig 中验证
        break
      case 'custom':
        // 自定义webhook，用户自行负责格式
        break
    }
  }

  /**
   * 验证Bark配置
   */
  validateBarkConfig(platform) {
    // Bark有两种配置模式：
    // 1. 传统模式：提供完整的API URL (如 https://api.day.app) 和设备密钥
    // 2. POST模式：提供完整的推送URL和设备密钥

    if (platform.usePost) {
      // POST模式验证
      if (!platform.url || !this.isValidUrl(platform.url)) {
        throw new Error('Bark POST模式需要有效的推送URL')
      }
      if (!platform.deviceKey) {
        throw new Error('Bark POST模式需要设备密钥 (deviceKey)')
      }
    } else {
      // GET模式验证 (传统Bark API)
      if (!platform.url || !this.isValidUrl(platform.url)) {
        throw new Error('Bark需要有效的API URL (如 https://api.day.app)')
      }
      if (!platform.deviceKey) {
        throw new Error('Bark需要设备密钥 (deviceKey)')
      }

      // 检查URL格式
      const url = new URL(platform.url)
      if (!url.hostname.includes('day.app') && !url.hostname.includes('bark')) {
        logger.warn('⚠️ Bark服务器URL格式可能不正确，请确认是否为有效的Bark服务器')
      }
    }

    // 验证可选参数
    if (platform.sound) {
      const validSounds = [
        'alarm',
        'alert',
        'anticipate',
        'bell',
        'birdsong',
        'bloom',
        'calypso',
        'chime',
        'choo',
        'descent',
        'electronic',
        'fanfare',
        'glass',
        'gotosleep',
        'healthnotification',
        'horn',
        'ladder',
        'mailsent',
        'minuet',
        'multiwayinvitation',
        'newmail',
        'newsflash',
        'noir',
        'paymentsuccess',
        'shake',
        'sherwoodforest',
        'silence',
        'spell',
        'suspense',
        'telegraph',
        'tiptoes',
        'typewriters',
        'update'
      ]

      if (!validSounds.includes(platform.sound)) {
        logger.warn(`⚠️ Bark声音 "${platform.sound}" 可能不被支持`)
      }
    }

    if (platform.level) {
      const validLevels = ['passive', 'active', 'critical', 'timeSensitive']
      if (!validLevels.includes(platform.level)) {
        throw new Error(`Bark中断级别必须是: ${validLevels.join(', ')}`)
      }
    }
  }

  /**
   * 验证IYUU配置
   */
  validateIYUUConfig(platform) {
    // IYUU必须提供token
    if (!platform.token || typeof platform.token !== 'string') {
      throw new Error('IYUU推送需要有效的Token')
    }

    // 验证token格式
    const tokenRegex = /^[a-zA-Z0-9]{8,64}$/
    if (!tokenRegex.test(platform.token)) {
      throw new Error('IYUU Token格式无效，应为8-64位字母数字组合')
    }

    // 验证超时设置
    if (platform.timeout && (platform.timeout < 1000 || platform.timeout > 30000)) {
      throw new Error('IYUU请求超时时间应在1000-30000毫秒之间')
    }

    // 验证强制POST模式设置
    if (platform.forcePost && typeof platform.forcePost !== 'boolean') {
      throw new Error('IYUU强制POST模式设置必须为布尔值')
    }

    logger.debug('✅ IYUU配置验证通过', {
      token: `${platform.token.substring(0, 8)}***`,
      timeout: platform.timeout || 10000,
      forcePost: platform.forcePost || false
    })
  }

  validateTelegramConfig(platform) {
    if (!platform.botToken || typeof platform.botToken !== 'string') {
      throw new Error('Telegram 平台必须提供机器人 Token')
    }

    if (!platform.chatId) {
      throw new Error('Telegram 平台必须提供 Chat ID')
    }

    if (platform.apiBaseUrl && !this.isValidUrl(platform.apiBaseUrl)) {
      throw new Error('Telegram API 基础地址格式无效')
    }

    if (platform.proxyUrl && !this.isValidUrl(platform.proxyUrl)) {
      throw new Error('Telegram 代理地址格式无效')
    }
  }

  validateSMTPConfig(platform) {
    if (!platform.host) {
      throw new Error('SMTP 平台必须提供 host')
    }

    if (!platform.port) {
      throw new Error('SMTP 平台必须提供 port')
    }

    if (!platform.username) {
      throw new Error('SMTP 平台必须提供用户名 (username)')
    }

    if (!platform.password) {
      throw new Error('SMTP 平台必须提供密码 (password)')
    }

    if (!platform.to) {
      throw new Error('SMTP 平台必须提供接收邮箱 (to)')
    }

    if (platform.port < 1 || platform.port > 65535) {
      throw new Error('SMTP 端口必须在 1-65535 之间')
    }

    const emails = Array.isArray(platform.to) ? platform.to : [platform.to]
    for (const email of emails) {
      if (!this.isValidEmailAddress(email)) {
        throw new Error(`无效的接收邮箱格式: ${email}`)
      }
    }

    if (platform.from && !this.isValidEmailAddress(platform.from)) {
      throw new Error(`无效的发送邮箱格式: ${platform.from}`)
    }
  }

  /**
   * 验证URL格式
   */
  isValidUrl(url) {
    try {
      new URL(url)
      return true
    } catch {
      return false
    }
  }

  isValidEmailAddress(value) {
    if (!value) {
      return false
    }

    const extractEmail = (input) => {
      if (typeof input !== 'string') {
        return ''
      }
      const match = input.match(/<([^>]+)>/)
      return match ? match[1] : input
    }

    const email = extractEmail(value).trim()
    const simpleEmailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return simpleEmailRegex.test(email)
  }

  /**
   * 获取默认配置
   */
  getDefaultConfig() {
    return {
      enabled: false,
      platforms: [],
      notificationTypes: {
        accountAnomaly: true, // 账号异常
        quotaWarning: true, // 配额警告
        systemError: true, // 系统错误
        securityAlert: true, // 安全警报
        test: true, // 测试通知
        rateLimitRecovery: true
      },
      retrySettings: {
        maxRetries: 3,
        retryDelay: 1000, // 毫秒
        timeout: 10000 // 毫秒
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  }

  /**
   * 添加webhook平台
   */
  async addPlatform(platform) {
    try {
      const config = await this.getConfig()

      // 生成唯一ID
      platform.id = platform.id || uuidv4()
      platform.enabled = platform.enabled !== false
      platform.createdAt = new Date().toISOString()

      // 验证平台配置
      this.validateConfig({ platforms: [platform] })

      // 添加到配置
      config.platforms = config.platforms || []
      config.platforms.push(platform)

      await this.saveConfig(config)

      return platform
    } catch (error) {
      logger.error('添加webhook平台失败:', error)
      throw error
    }
  }

  /**
   * 更新webhook平台
   */
  async updatePlatform(platformId, updates) {
    try {
      const config = await this.getConfig()

      const index = config.platforms.findIndex((p) => p.id === platformId)
      if (index === -1) {
        throw new Error('找不到指定的webhook平台')
      }

      // 合并更新
      config.platforms[index] = {
        ...config.platforms[index],
        ...updates,
        updatedAt: new Date().toISOString()
      }

      // 验证更新后的配置
      this.validateConfig({ platforms: [config.platforms[index]] })

      await this.saveConfig(config)

      return config.platforms[index]
    } catch (error) {
      logger.error('更新webhook平台失败:', error)
      throw error
    }
  }

  /**
   * 删除webhook平台
   */
  async deletePlatform(platformId) {
    try {
      const config = await this.getConfig()

      config.platforms = config.platforms.filter((p) => p.id !== platformId)

      await this.saveConfig(config)

      logger.info(`✅ 已删除webhook平台: ${platformId}`)
      return true
    } catch (error) {
      logger.error('删除webhook平台失败:', error)
      throw error
    }
  }

  /**
   * 切换webhook平台启用状态
   */
  async togglePlatform(platformId) {
    try {
      const config = await this.getConfig()

      const platform = config.platforms.find((p) => p.id === platformId)
      if (!platform) {
        throw new Error('找不到指定的webhook平台')
      }

      platform.enabled = !platform.enabled
      platform.updatedAt = new Date().toISOString()

      await this.saveConfig(config)

      logger.info(`✅ Webhook平台 ${platformId} 已${platform.enabled ? '启用' : '禁用'}`)
      return platform
    } catch (error) {
      logger.error('切换webhook平台状态失败:', error)
      throw error
    }
  }

  /**
   * 获取启用的平台列表
   */
  async getEnabledPlatforms() {
    try {
      const config = await this.getConfig()

      if (!config.enabled || !config.platforms) {
        return []
      }

      return config.platforms.filter((p) => p.enabled)
    } catch (error) {
      logger.error('获取启用的webhook平台失败:', error)
      return []
    }
  }
}

module.exports = new WebhookConfigService()
