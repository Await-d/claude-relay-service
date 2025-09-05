const database = require('../models/database')
const CostCalculator = require('../utils/costCalculator')
const logger = require('../utils/logger')

/**
 * 通用账户费用统计服务
 * 支持所有平台（Claude、Gemini、OpenAI、Bedrock、Azure OpenAI）的账户级费用统计
 */
class AccountCostService {
  /**
   * 平台配置映射
   */
  static PLATFORM_CONFIG = {
    claude: {
      name: 'Claude',
      keyPrefix: '', // Claude保持向后兼容，不使用平台前缀
      supportsCostStats: true
    },
    'claude-console': {
      name: 'Claude Console',
      keyPrefix: 'claude-console',
      supportsCostStats: true
    },
    gemini: {
      name: 'Gemini',
      keyPrefix: 'gemini',
      supportsCostStats: true
    },
    openai: {
      name: 'OpenAI',
      keyPrefix: 'openai',
      supportsCostStats: true
    },
    azure_openai: {
      name: 'Azure OpenAI',
      keyPrefix: 'azure-openai',
      supportsCostStats: true
    },
    bedrock: {
      name: 'Bedrock',
      keyPrefix: 'bedrock',
      supportsCostStats: true
    }
  }

  /**
   * 获取账户费用统计
   * @param {string} accountId - 账户ID
   * @param {string} platform - 平台类型
   * @param {Object} options - 选项
   * @param {string} options.period - 时间范围 ('today', 'week', 'month', 'all')
   * @returns {Promise<Object>} 费用统计数据
   */
  static async getAccountCostStats(accountId, platform, options = {}) {
    try {
      if (!accountId || !platform) {
        throw new Error('Account ID and platform are required')
      }

      const platformConfig = this.PLATFORM_CONFIG[platform]
      if (!platformConfig) {
        throw new Error(`Unsupported platform: ${platform}`)
      }

      if (!platformConfig.supportsCostStats) {
        return {
          accountId,
          platform,
          platformName: platformConfig.name,
          period: options.period || 'all',
          totalCost: 0,
          modelStats: {},
          formatted: {
            totalCost: '$0.00'
          },
          hasCostStats: false
        }
      }

      // 获取费用统计数据
      const costStats = await database.getAccountCostStats(accountId, options.period, platform)

      // 格式化结果
      const result = {
        accountId,
        platform,
        platformName: platformConfig.name,
        period: options.period || 'all',
        ...costStats,
        // 添加格式化的费用显示
        formatted: {
          totalCost: CostCalculator.formatCost(costStats.totalCost || 0),
          dailyCost: CostCalculator.formatCost(costStats.dailyCost || 0),
          monthlyCost: CostCalculator.formatCost(costStats.monthlyCost || 0),
          hourlyCost: CostCalculator.formatCost(costStats.hourlyCost || 0)
        },
        hasCostStats: true
      }

      // 格式化模型级别的费用
      if (costStats.modelStats) {
        Object.keys(costStats.modelStats).forEach((period) => {
          if (costStats.modelStats[period] && typeof costStats.modelStats[period] === 'object') {
            Object.keys(costStats.modelStats[period]).forEach((model) => {
              if (
                costStats.modelStats[period][model] &&
                typeof costStats.modelStats[period][model] === 'object'
              ) {
                costStats.modelStats[period][model].formatted = {
                  cost: CostCalculator.formatCost(costStats.modelStats[period][model].cost || 0)
                }
              }
            })
          }
        })
      }

      result.modelStats = costStats.modelStats || {}

      return result
    } catch (error) {
      logger.error(`Failed to get account cost stats for ${platform} account ${accountId}:`, error)

      // 返回默认结果而不是抛出错误，确保前端不会因费用统计失败而崩溃
      return {
        accountId,
        platform,
        platformName: this.PLATFORM_CONFIG[platform]?.name || platform,
        period: options.period || 'all',
        totalCost: 0,
        dailyCost: 0,
        monthlyCost: 0,
        hourlyCost: 0,
        modelStats: {},
        formatted: {
          totalCost: '$0.00',
          dailyCost: '$0.00',
          monthlyCost: '$0.00',
          hourlyCost: '$0.00'
        },
        hasCostStats: false,
        error: error.message
      }
    }
  }

  /**
   * 获取多个账户的费用统计
   * @param {Array<{id: string, platform: string}>} accounts - 账户列表
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 账户费用统计映射
   */
  static async getMultipleAccountsCostStats(accounts, options = {}) {
    try {
      if (!Array.isArray(accounts)) {
        throw new Error('Accounts must be an array')
      }

      const results = {}

      // 并行获取所有账户的费用统计
      const promises = accounts.map(async (account) => {
        try {
          const stats = await this.getAccountCostStats(account.id, account.platform, options)
          results[account.id] = stats
        } catch (error) {
          logger.warn(
            `Failed to get cost stats for account ${account.id} (${account.platform}):`,
            error
          )
          results[account.id] = {
            accountId: account.id,
            platform: account.platform,
            totalCost: 0,
            hasCostStats: false,
            error: error.message
          }
        }
      })

      await Promise.all(promises)
      return results
    } catch (error) {
      logger.error('Failed to get multiple accounts cost stats:', error)
      return {}
    }
  }

  /**
   * 检查平台是否支持费用统计
   * @param {string} platform - 平台类型
   * @returns {boolean} 是否支持费用统计
   */
  static supportsCostStats(platform) {
    const config = this.PLATFORM_CONFIG[platform]
    return config && config.supportsCostStats
  }

  /**
   * 获取所有支持的平台列表
   * @returns {Array<string>} 支持的平台列表
   */
  static getSupportedPlatforms() {
    return Object.keys(this.PLATFORM_CONFIG).filter(
      (platform) => this.PLATFORM_CONFIG[platform].supportsCostStats
    )
  }

  /**
   * 获取平台显示名称
   * @param {string} platform - 平台类型
   * @returns {string} 平台显示名称
   */
  static getPlatformDisplayName(platform) {
    const config = this.PLATFORM_CONFIG[platform]
    return config ? config.name : platform
  }

  /**
   * 获取平台的数据库键前缀
   * @param {string} platform - 平台类型
   * @returns {string} 键前缀
   */
  static getPlatformKeyPrefix(platform) {
    const config = this.PLATFORM_CONFIG[platform]
    return config ? config.keyPrefix : platform
  }
}

module.exports = AccountCostService
