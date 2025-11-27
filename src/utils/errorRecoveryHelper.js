/**
 * 通用错误恢复助手
 * 为所有账户类型提供统一的自动错误恢复功能
 */

const logger = require('./logger')

class ErrorRecoveryHelper {
  /**
   * 检查账户是否启用了自动错误恢复
   * @param {Object} account - 账户对象
   * @returns {boolean}
   */
  static isAutoRecoveryEnabled(account) {
    if (!account) return false
    return account.autoRecoverErrors === 'true' || account.autoRecoverErrors === true
  }

  /**
   * 获取错误恢复持续时间（分钟）
   * @param {Object} account - 账户对象
   * @param {number} defaultDuration - 默认持续时间（分钟）
   * @returns {number}
   */
  static getRecoveryDuration(account, defaultDuration = 5) {
    if (!account) return defaultDuration
    const duration = parseInt(account.errorRecoveryDuration)
    return Number.isFinite(duration) && duration > 0 ? duration : defaultDuration
  }

  /**
   * 为网络错误创建错误恢复数据
   * @param {Object} account - 账户对象
   * @param {string} errorCode - 错误代码 (ECONNREFUSED, ETIMEDOUT等)
   * @param {string} platform - 平台名称
   * @returns {Object|null} 更新数据或null（如果未启用自动恢复）
   */
  static createErrorRecoveryData(account, errorCode, platform = '') {
    const autoRecover = this.isAutoRecoveryEnabled(account)

    if (autoRecover) {
      const recoveryMinutes = this.getRecoveryDuration(account)
      const errorOccurredAt = new Date()
      const errorRecoveryAt = new Date(errorOccurredAt.getTime() + recoveryMinutes * 60000)

      logger.warn(
        `⏳ ${platform} account ${account.name || account.id} marked as temporary error, will auto-recover in ${recoveryMinutes} minutes (auto-recover enabled)`
      )

      return {
        status: 'error',
        errorMessage: `Connection error: ${errorCode} (auto-recover in ${recoveryMinutes} min at ${errorRecoveryAt.toISOString()})`,
        errorOccurredAt: errorOccurredAt.toISOString(),
        errorRecoveryAt: errorRecoveryAt.toISOString(),
        schedulable: 'false'
      }
    } else {
      logger.warn(
        `🚫 ${platform} account ${account.name || account.id} marked as error (auto-recover disabled, manual reset required)`
      )

      return {
        status: 'error',
        errorMessage: `Connection error: ${errorCode}`,
        schedulable: 'false'
      }
    }
  }

  /**
   * 检查并清除过期的 error 状态（自动恢复）
   * @param {Object} account - 账户对象
   * @param {string} accountId - 账户ID
   * @param {string} platform - 平台名称
   * @returns {boolean} 是否已清除错误状态
   */
  static shouldClearErrorStatus(account, accountId, platform = '') {
    if (!account || account.status !== 'error') {
      return false
    }

    // 如果没有设置自动恢复时间，则不自动恢复（保持旧行为）
    if (!account.errorRecoveryAt) {
      return false
    }

    const now = new Date()
    const recoveryAt = new Date(account.errorRecoveryAt)

    if (now >= recoveryAt) {
      logger.info(`✅ Auto-recovering error status for ${platform} account ${account.name || accountId}`)
      return true
    }

    return false
  }

  /**
   * 创建清除错误状态的更新数据
   * @returns {Object}
   */
  static createClearErrorData() {
    return {
      status: 'active',
      schedulable: 'true',
      errorMessage: '',
      errorOccurredAt: '',
      errorRecoveryAt: ''
    }
  }

  /**
   * 检查是否是网络错误
   * @param {string} errorCode - 错误代码
   * @returns {boolean}
   */
  static isNetworkError(errorCode) {
    return errorCode === 'ECONNREFUSED' || errorCode === 'ETIMEDOUT' || errorCode === 'ECONNABORTED'
  }

  /**
   * 获取错误恢复状态信息（用于前端显示）
   * @param {Object} account - 账户对象
   * @returns {Object}
   */
  static getRecoveryStatusInfo(account) {
    if (!account || account.status !== 'error' || !account.errorRecoveryAt) {
      return {
        isRecovering: false,
        remainingMinutes: 0,
        willRecoverAt: null
      }
    }

    const now = new Date()
    const recoveryAt = new Date(account.errorRecoveryAt)
    const remainingMs = recoveryAt - now
    const remainingMinutes = Math.max(0, Math.ceil(remainingMs / 60000))

    return {
      isRecovering: remainingMinutes > 0,
      remainingMinutes,
      willRecoverAt: recoveryAt.toISOString()
    }
  }
}

module.exports = ErrorRecoveryHelper
