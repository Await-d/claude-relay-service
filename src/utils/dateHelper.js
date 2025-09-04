const config = require('../../config/config')

/**
 * 统一时区处理工具
 * 
 * 提供全项目的时区转换、格式化和边界计算功能
 * 确保所有时区相关操作的一致性和准确性
 * 
 * 核心设计原则：
 * 1. 基于 config.system.timezoneOffset 配置进行时区转换
 * 2. 提供 UTC 和目标时区的双向转换
 * 3. 支持多种日期格式化选项
 * 4. 提供时区边界计算（日、周、月的开始和结束）
 * 5. 向下兼容现有的时区处理函数
 */

/**
 * 获取配置的时区偏移量（小时）
 * @returns {number} 时区偏移小时数，默认 +8 (UTC+8)
 */
function getTimezoneOffset() {
  return config.system.timezoneOffset || 8
}

/**
 * 将 UTC 时间转换为配置时区的时间
 * 注意：这个函数的目的是获取某个时间点在目标时区的"本地"表示
 * 例如：UTC时间 2025-07-30 01:00:00 在 UTC+8 时区表示为 2025-07-30 09:00:00
 * 
 * @param {Date} date - 要转换的日期对象，默认为当前时间
 * @returns {Date} 调整后的日期对象，使用 getUTCXXX 方法可得到目标时区的值
 */
function getDateInTimezone(date = new Date()) {
  const offset = getTimezoneOffset()
  
  // 方法：创建一个偏移后的Date对象，使其getUTCXXX方法返回目标时区的值
  // 这样可以避免本地时区对计算的干扰
  const offsetMs = offset * 60 * 60 * 1000
  return new Date(date.getTime() + offsetMs)
}

/**
 * 获取配置时区的日期字符串 (YYYY-MM-DD)
 * @param {Date} date - 日期对象，默认为当前时间
 * @returns {string} 格式化的日期字符串
 */
function getDateStringInTimezone(date = new Date()) {
  const tzDate = getDateInTimezone(date)
  // 使用UTC方法获取偏移后的日期部分
  return `${tzDate.getUTCFullYear()}-${String(tzDate.getUTCMonth() + 1).padStart(2, '0')}-${String(tzDate.getUTCDate()).padStart(2, '0')}`
}

/**
 * 获取配置时区的小时 (0-23)
 * @param {Date} date - 日期对象，默认为当前时间
 * @returns {number} 小时值 (0-23)
 */
function getHourInTimezone(date = new Date()) {
  const tzDate = getDateInTimezone(date)
  return tzDate.getUTCHours()
}

/**
 * 格式化日期为带时区的字符串
 * @param {Date} date - 日期对象，默认为当前时间
 * @param {string} format - 格式选项：'datetime', 'date', 'time', 'iso'
 * @returns {string} 格式化的日期时间字符串
 */
function formatDateWithTimezone(date = new Date(), format = 'datetime') {
  const tzDate = getDateInTimezone(date)
  const year = tzDate.getUTCFullYear()
  const month = String(tzDate.getUTCMonth() + 1).padStart(2, '0')
  const day = String(tzDate.getUTCDate()).padStart(2, '0')
  const hour = String(tzDate.getUTCHours()).padStart(2, '0')
  const minute = String(tzDate.getUTCMinutes()).padStart(2, '0')
  const second = String(tzDate.getUTCSeconds()).padStart(2, '0')
  
  const offset = getTimezoneOffset()
  const offsetString = offset >= 0 ? `+${String(Math.floor(offset)).padStart(2, '0')}:${String((offset % 1) * 60).padStart(2, '0')}` : 
                      `-${String(Math.floor(Math.abs(offset))).padStart(2, '0')}:${String((Math.abs(offset) % 1) * 60).padStart(2, '0')}`
  
  switch (format) {
    case 'date':
      return `${year}-${month}-${day}`
    case 'time':
      return `${hour}:${minute}:${second}`
    case 'iso':
      return `${year}-${month}-${day}T${hour}:${minute}:${second}${offsetString}`
    case 'datetime':
    default:
      return `${year}-${month}-${day} ${hour}:${minute}:${second}`
  }
}

/**
 * 获取 ISO 格式的时区字符串
 * @param {Date} date - 日期对象，默认为当前时间
 * @returns {string} ISO格式的时区日期字符串
 */
function getISOStringWithTimezone(date = new Date()) {
  return formatDateWithTimezone(date, 'iso')
}

/**
 * 获取时区调整后的 Date 对象（用于边界计算）
 * 与 getDateInTimezone 的区别：这个函数返回的是真正的目标时区时间
 * @param {Date} date - 日期对象，默认为当前时间
 * @returns {Date} 时区调整后的 Date 对象
 */
function getTimezoneDate(date = new Date()) {
  const offset = getTimezoneOffset()
  const offsetMs = offset * 60 * 60 * 1000
  return new Date(date.getTime() + offsetMs)
}

/**
 * 获取时区的一天开始时间 (00:00:00.000)
 * @param {Date} date - 日期对象，默认为当前时间
 * @returns {Date} 该日期在目标时区的开始时间（UTC时间）
 */
function getTimezoneStartOfDay(date = new Date()) {
  const tzDate = getDateInTimezone(date)
  const startOfDay = new Date(Date.UTC(
    tzDate.getUTCFullYear(),
    tzDate.getUTCMonth(),
    tzDate.getUTCDate(),
    0, 0, 0, 0
  ))
  
  // 转换回UTC时间
  const offset = getTimezoneOffset()
  const offsetMs = offset * 60 * 60 * 1000
  return new Date(startOfDay.getTime() - offsetMs)
}

/**
 * 获取时区的一天结束时间 (23:59:59.999)
 * @param {Date} date - 日期对象，默认为当前时间
 * @returns {Date} 该日期在目标时区的结束时间（UTC时间）
 */
function getTimezoneEndOfDay(date = new Date()) {
  const tzDate = getDateInTimezone(date)
  const endOfDay = new Date(Date.UTC(
    tzDate.getUTCFullYear(),
    tzDate.getUTCMonth(),
    tzDate.getUTCDate(),
    23, 59, 59, 999
  ))
  
  // 转换回UTC时间
  const offset = getTimezoneOffset()
  const offsetMs = offset * 60 * 60 * 1000
  return new Date(endOfDay.getTime() - offsetMs)
}

/**
 * 获取时区的一周开始时间（周一 00:00:00.000）
 * @param {Date} date - 日期对象，默认为当前时间
 * @returns {Date} 该周在目标时区的开始时间（UTC时间）
 */
function getTimezoneStartOfWeek(date = new Date()) {
  const tzDate = getDateInTimezone(date)
  const dayOfWeek = tzDate.getUTCDay()
  
  // 计算到周一的天数差（周日=0，周一=1）
  const daysToMonday = dayOfWeek === 0 ? -6 : -(dayOfWeek - 1)
  
  const startOfWeek = new Date(Date.UTC(
    tzDate.getUTCFullYear(),
    tzDate.getUTCMonth(),
    tzDate.getUTCDate() + daysToMonday,
    0, 0, 0, 0
  ))
  
  // 转换回UTC时间
  const offset = getTimezoneOffset()
  const offsetMs = offset * 60 * 60 * 1000
  return new Date(startOfWeek.getTime() - offsetMs)
}

/**
 * 获取时区的一周结束时间（周日 23:59:59.999）
 * @param {Date} date - 日期对象，默认为当前时间
 * @returns {Date} 该周在目标时区的结束时间（UTC时间）
 */
function getTimezoneEndOfWeek(date = new Date()) {
  const tzDate = getDateInTimezone(date)
  const dayOfWeek = tzDate.getUTCDay()
  
  // 计算到周日的天数差
  const daysToSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek
  
  const endOfWeek = new Date(Date.UTC(
    tzDate.getUTCFullYear(),
    tzDate.getUTCMonth(),
    tzDate.getUTCDate() + daysToSunday,
    23, 59, 59, 999
  ))
  
  // 转换回UTC时间
  const offset = getTimezoneOffset()
  const offsetMs = offset * 60 * 60 * 1000
  return new Date(endOfWeek.getTime() - offsetMs)
}

/**
 * 获取时区的一月开始时间（1号 00:00:00.000）
 * @param {Date} date - 日期对象，默认为当前时间
 * @returns {Date} 该月在目标时区的开始时间（UTC时间）
 */
function getTimezoneStartOfMonth(date = new Date()) {
  const tzDate = getDateInTimezone(date)
  const startOfMonth = new Date(Date.UTC(
    tzDate.getUTCFullYear(),
    tzDate.getUTCMonth(),
    1,
    0, 0, 0, 0
  ))
  
  // 转换回UTC时间
  const offset = getTimezoneOffset()
  const offsetMs = offset * 60 * 60 * 1000
  return new Date(startOfMonth.getTime() - offsetMs)
}

/**
 * 获取时区的一月结束时间（最后一天 23:59:59.999）
 * @param {Date} date - 日期对象，默认为当前时间
 * @returns {Date} 该月在目标时区的结束时间（UTC时间）
 */
function getTimezoneEndOfMonth(date = new Date()) {
  const tzDate = getDateInTimezone(date)
  const endOfMonth = new Date(Date.UTC(
    tzDate.getUTCFullYear(),
    tzDate.getUTCMonth() + 1,
    0, // 下个月的第0天，即当月最后一天
    23, 59, 59, 999
  ))
  
  // 转换回UTC时间
  const offset = getTimezoneOffset()
  const offsetMs = offset * 60 * 60 * 1000
  return new Date(endOfMonth.getTime() - offsetMs)
}

/**
 * 获取下一个重置时间（用于费用限制等功能）
 * @param {string} period - 周期类型：'daily', 'weekly', 'monthly'
 * @param {Date} date - 基准日期，默认为当前时间
 * @returns {Date} 下一个重置时间（UTC时间）
 */
function getNextResetTime(period, date = new Date()) {
  const tzDate = getDateInTimezone(date)
  
  switch (period) {
    case 'daily':
      // 明天的0点
      return getTimezoneStartOfDay(new Date(tzDate.getTime() + 24 * 60 * 60 * 1000))
    case 'weekly':
      // 下周一的0点
      const currentWeekEnd = getTimezoneEndOfWeek(date)
      return getTimezoneStartOfDay(new Date(currentWeekEnd.getTime() + 1000)) // 加1秒到下一天
    case 'monthly':
      // 下个月1号的0点
      return getTimezoneStartOfMonth(new Date(tzDate.getUTCFullYear(), tzDate.getUTCMonth() + 1, 1))
    default:
      // 默认24小时后
      return new Date(date.getTime() + 24 * 60 * 60 * 1000)
  }
}

/**
 * 计算两个时间之间的完整天数（按时区边界）
 * @param {Date} startDate - 开始日期
 * @param {Date} endDate - 结束日期
 * @returns {number} 天数差
 */
function getDaysBetween(startDate, endDate) {
  const start = getTimezoneStartOfDay(startDate)
  const end = getTimezoneStartOfDay(endDate)
  return Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000))
}

/**
 * 验证时区配置是否有效
 * @returns {Object} 验证结果
 */
function validateTimezoneConfig() {
  const offset = getTimezoneOffset()
  
  return {
    valid: typeof offset === 'number' && offset >= -12 && offset <= 14,
    offset,
    timezone: config.system.timezone || 'Unknown',
    message: typeof offset === 'number' && offset >= -12 && offset <= 14 
      ? `时区配置有效：UTC${offset >= 0 ? '+' : ''}${offset}`
      : `时区配置无效：${offset}，应为-12到+14之间的数字`
  }
}

/**
 * 获取时区信息摘要
 * @returns {Object} 时区信息
 */
function getTimezoneInfo() {
  const offset = getTimezoneOffset()
  const now = new Date()
  const tzNow = getDateInTimezone(now)
  
  return {
    offset,
    timezone: config.system.timezone || 'Custom',
    offsetString: offset >= 0 ? `UTC+${offset}` : `UTC${offset}`,
    currentUTC: now.toISOString(),
    currentLocal: formatDateWithTimezone(now, 'iso'),
    validation: validateTimezoneConfig()
  }
}

// 导出所有函数
module.exports = {
  // 核心转换函数
  getTimezoneOffset,
  getDateInTimezone,
  getDateStringInTimezone,
  getHourInTimezone,
  getTimezoneDate,
  
  // 格式化函数
  formatDateWithTimezone,
  getISOStringWithTimezone,
  
  // 边界时间函数
  getTimezoneStartOfDay,
  getTimezoneEndOfDay,
  getTimezoneStartOfWeek,
  getTimezoneEndOfWeek,
  getTimezoneStartOfMonth,
  getTimezoneEndOfMonth,
  
  // 实用工具函数
  getNextResetTime,
  getDaysBetween,
  validateTimezoneConfig,
  getTimezoneInfo
}