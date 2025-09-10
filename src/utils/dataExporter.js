/**
 * @fileoverview 数据导出工具类
 *
 * 安全的数据导出功能，支持CSV和Excel格式
 * 遵循项目现有的安全标准和代码风格
 *
 * @author Claude Code
 * @version 1.0.0
 */

const fs = require('fs').promises
const path = require('path')
const crypto = require('crypto')
const logger = require('./logger')

class DataExporter {
  constructor() {
    this.tempDir = path.join(process.cwd(), 'temp')
    this.maxFileSize = 50 * 1024 * 1024 // 50MB限制
    this.cleanupDelay = 10000 // 10秒后清理临时文件
  }

  /**
   * 导出数据到指定格式
   * @param {Array} data 要导出的数据数组
   * @param {string} format 导出格式 ('csv' | 'xlsx')
   * @param {Object} options 导出选项
   * @returns {Object} 导出结果 {filename, filePath, size}
   */
  async export(data, format = 'csv', _options = {}) {
    try {
      // 数据验证
      this._validateExportData(data)

      // 确保临时目录存在
      await this._ensureTempDirectory()

      // 根据格式选择导出方法
      switch (format.toLowerCase()) {
        case 'csv':
          return await this._exportToCsv(data, _options)
        case 'xlsx':
          return await this._exportToExcel(data, _options)
        default:
          throw new Error(`不支持的导出格式: ${format}`)
      }
    } catch (error) {
      logger.error('📤 数据导出失败:', {
        error: error.message,
        format,
        dataLength: data?.length || 0,
        stack: error.stack
      })
      throw error
    }
  }

  /**
   * CSV导出实现
   * @param {Array} data 数据数组
   * @param {Object} options 导出选项
   * @returns {Object} 导出结果
   */
  async _exportToCsv(data, _options = {}) {
    if (!data || data.length === 0) {
      throw new Error('没有可导出的数据')
    }

    try {
      // 获取表头
      const headers = Object.keys(data[0])

      // 构建CSV内容
      const csvRows = [
        // 表头行 - 添加BOM以支持Excel正确显示中文
        headers.join(',')
      ]

      // 数据行
      for (const row of data) {
        const csvRow = headers.map((header) => {
          const value = row[header]

          // 处理空值
          if (value === null || value === undefined) {
            return ''
          }

          // 转换为字符串并处理特殊字符
          let cellValue = String(value)

          // 如果包含逗号、换行符或双引号，需要用双引号包围
          if (cellValue.includes(',') || cellValue.includes('\n') || cellValue.includes('"')) {
            // 双引号需要转义
            cellValue = cellValue.replace(/"/g, '""')
            cellValue = `"${cellValue}"`
          }

          return cellValue
        })

        csvRows.push(csvRow.join(','))
      }

      // 添加BOM以支持Excel正确显示中文
      const csvContent = `\uFEFF${csvRows.join('\n')}`

      // 生成唯一文件名
      const filename = this._generateFilename('api_keys_export', 'csv')
      const filePath = path.join(this.tempDir, filename)

      // 写入文件
      await fs.writeFile(filePath, csvContent, 'utf8')

      // 获取文件大小
      const stats = await fs.stat(filePath)

      // 检查文件大小
      if (stats.size > this.maxFileSize) {
        await fs.unlink(filePath) // 删除过大的文件
        throw new Error('导出文件过大，请缩小导出范围')
      }

      logger.info('📤 CSV导出成功:', {
        filename,
        size: stats.size,
        records: data.length
      })

      // 设置自动清理
      this._scheduleCleanup(filePath)

      return {
        filename,
        filePath,
        size: stats.size,
        mimeType: 'text/csv'
      }
    } catch (error) {
      logger.error('❌ CSV导出失败:', error)
      throw error
    }
  }

  /**
   * Excel导出实现
   * @param {Array} data 数据数组
   * @param {Object} options 导出选项
   * @returns {Object} 导出结果
   */
  async _exportToExcel(data, _options = {}) {
    // 检查xlsx依赖是否安装
    let XLSX
    try {
      XLSX = require('xlsx')
    } catch (error) {
      logger.warn('📦 xlsx依赖未安装，降级到CSV导出')
      // 如果xlsx未安装，降级到CSV导出
      return await this._exportToCsv(data, _options)
    }

    if (!data || data.length === 0) {
      throw new Error('没有可导出的数据')
    }

    try {
      // 创建工作表
      const worksheet = XLSX.utils.json_to_sheet(data)

      // 创建工作簿
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, worksheet, 'API Keys')

      // 设置列宽（可选）
      const colWidths = this._calculateColumnWidths(data)
      worksheet['!cols'] = colWidths

      // 生成唯一文件名
      const filename = this._generateFilename('api_keys_export', 'xlsx')
      const filePath = path.join(this.tempDir, filename)

      // 写入Excel文件
      XLSX.writeFile(workbook, filePath)

      // 获取文件大小
      const stats = await fs.stat(filePath)

      // 检查文件大小
      if (stats.size > this.maxFileSize) {
        await fs.unlink(filePath) // 删除过大的文件
        throw new Error('导出文件过大，请缩小导出范围')
      }

      logger.info('📤 Excel导出成功:', {
        filename,
        size: stats.size,
        records: data.length
      })

      // 设置自动清理
      this._scheduleCleanup(filePath)

      return {
        filename,
        filePath,
        size: stats.size,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }
    } catch (error) {
      logger.error('❌ Excel导出失败:', error)
      throw error
    }
  }

  /**
   * 验证导出数据
   * @param {Array} data 数据数组
   */
  _validateExportData(data) {
    if (!Array.isArray(data)) {
      throw new Error('导出数据必须是数组格式')
    }

    if (data.length === 0) {
      throw new Error('没有可导出的数据')
    }

    if (data.length > 50000) {
      throw new Error('导出数据量过大，请分批导出或添加过滤条件')
    }

    // 检查数据结构一致性
    const firstRowKeys = Object.keys(data[0])
    for (let i = 1; i < Math.min(data.length, 10); i++) {
      const currentRowKeys = Object.keys(data[i])
      if (currentRowKeys.length !== firstRowKeys.length) {
        logger.warn(`数据行 ${i} 的字段数量与第一行不一致`)
      }
    }
  }

  /**
   * 确保临时目录存在
   */
  async _ensureTempDirectory() {
    try {
      await fs.access(this.tempDir)
    } catch (error) {
      // 目录不存在，创建它
      await fs.mkdir(this.tempDir, { recursive: true })
      logger.info('📁 创建临时目录:', this.tempDir)
    }
  }

  /**
   * 生成唯一文件名
   * @param {string} prefix 文件名前缀
   * @param {string} extension 文件扩展名
   * @returns {string} 唯一文件名
   */
  _generateFilename(prefix, extension) {
    const timestamp = Date.now()
    const random = crypto.randomBytes(4).toString('hex')
    return `${prefix}_${timestamp}_${random}.${extension}`
  }

  /**
   * 计算Excel列宽
   * @param {Array} data 数据数组
   * @returns {Array} 列宽配置
   */
  _calculateColumnWidths(data) {
    if (!data || data.length === 0) {
      return []
    }

    const headers = Object.keys(data[0])
    const widths = []

    headers.forEach((header) => {
      // 计算表头长度
      let maxWidth = header.length

      // 检查前100行数据（性能考虑）
      const sampleSize = Math.min(data.length, 100)
      for (let i = 0; i < sampleSize; i++) {
        const cellValue = String(data[i][header] || '')
        if (cellValue.length > maxWidth) {
          maxWidth = cellValue.length
        }
      }

      // 设置合理的最小和最大宽度
      const width = Math.min(Math.max(maxWidth, 10), 50)
      widths.push({ wch: width })
    })

    return widths
  }

  /**
   * 安排文件清理
   * @param {string} filePath 文件路径
   */
  _scheduleCleanup(filePath) {
    setTimeout(async () => {
      try {
        await fs.unlink(filePath)
        logger.debug('🧹 临时文件已清理:', filePath)
      } catch (error) {
        logger.warn('⚠️ 临时文件清理失败:', {
          filePath,
          error: error.message
        })
      }
    }, this.cleanupDelay)
  }

  /**
   * 手动清理临时文件
   * @param {string} filePath 文件路径
   */
  async cleanupFile(filePath) {
    try {
      await fs.unlink(filePath)
      logger.info('🧹 手动清理临时文件:', filePath)
    } catch (error) {
      logger.warn('⚠️ 文件清理失败:', {
        filePath,
        error: error.message
      })
    }
  }

  /**
   * 清理所有临时文件
   */
  async cleanupAllTempFiles() {
    try {
      const files = await fs.readdir(this.tempDir)
      let cleanedCount = 0

      for (const file of files) {
        const filePath = path.join(this.tempDir, file)
        const stats = await fs.stat(filePath)

        // 清理超过1小时的临时文件
        if (Date.now() - stats.mtime.getTime() > 3600000) {
          await fs.unlink(filePath)
          cleanedCount++
        }
      }

      if (cleanedCount > 0) {
        logger.info(`🧹 清理了 ${cleanedCount} 个过期临时文件`)
      }

      return cleanedCount
    } catch (error) {
      logger.error('❌ 批量清理临时文件失败:', error)
      return 0
    }
  }

  /**
   * 获取临时目录状态
   * @returns {Object} 临时目录状态信息
   */
  async getTempDirectoryStatus() {
    try {
      const files = await fs.readdir(this.tempDir)
      let totalSize = 0
      const fileList = []

      for (const file of files) {
        const filePath = path.join(this.tempDir, file)
        const stats = await fs.stat(filePath)
        totalSize += stats.size
        fileList.push({
          name: file,
          size: stats.size,
          created: stats.mtime
        })
      }

      return {
        fileCount: files.length,
        totalSize,
        files: fileList
      }
    } catch (error) {
      logger.error('❌ 获取临时目录状态失败:', error)
      return {
        fileCount: 0,
        totalSize: 0,
        files: []
      }
    }
  }
}

// 导出单例实例
module.exports = new DataExporter()
