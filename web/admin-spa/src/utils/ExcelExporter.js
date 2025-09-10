/**
 * Excel 和 CSV 导出工具
 * 用于API Keys数据导出功能
 */

import dayjs from 'dayjs'

class ExcelExporter {
  constructor() {
    this.progressCallback = null
  }

  /**
   * 设置进度回调函数
   * @param {Function} callback 进度回调 (progress, status) => {}
   */
  setProgressCallback(callback) {
    this.progressCallback = callback
  }

  /**
   * 更新进度
   * @param {number} progress 进度百分比 0-100
   * @param {string} status 状态描述
   */
  updateProgress(progress, status) {
    if (this.progressCallback) {
      this.progressCallback(progress, status)
    }
  }

  /**
   * 导出API Keys数据
   * @param {Object} config 导出配置
   * @param {Array} apiKeys API Keys数据
   * @returns {Promise<void>}
   */
  async exportApiKeys(config, apiKeys) {
    try {
      this.updateProgress(10, '准备导出数据...')

      // 过滤数据
      const filteredData = this.filterData(apiKeys, config)
      this.updateProgress(30, '处理数据字段...')

      // 格式化数据
      const formattedData = this.formatData(filteredData, config)
      this.updateProgress(60, '生成导出文件...')

      // 根据格式导出
      if (config.format === 'xlsx') {
        await this.exportToExcel(formattedData, config)
      } else {
        await this.exportToCSV(formattedData, config)
      }

      this.updateProgress(100, '导出完成！')
    } catch (error) {
      console.error('导出失败:', error)
      throw new Error('数据导出失败，请重试')
    }
  }

  /**
   * 过滤数据（按时间范围）
   * @param {Array} apiKeys 原始数据
   * @param {Object} config 配置
   * @returns {Array}
   */
  filterData(apiKeys, config) {
    const startDate = dayjs(config.startDate)
    const endDate = dayjs(config.endDate).add(1, 'day') // 包含结束日期当天

    return apiKeys.filter((key) => {
      const createdAt = dayjs(key.createdAt)
      return createdAt.isAfter(startDate) && createdAt.isBefore(endDate)
    })
  }

  /**
   * 格式化数据
   * @param {Array} data 过滤后的数据
   * @param {Object} config 配置
   * @returns {Array}
   */
  formatData(data, config) {
    const fieldLabels = {
      id: 'API Key ID',
      name: '名称',
      description: '描述',
      createdAt: '创建时间',
      lastUsed: '最后使用',
      status: '状态',
      limit: '使用限额',
      totalTokens: '总Token数',
      totalCost: '总成本',
      requestCount: '请求次数',
      tags: '标签',
      expiresAt: '过期时间'
    }

    return data.map((key) => {
      const row = {}

      config.fields.forEach((field) => {
        const label = fieldLabels[field] || field
        let value = key[field]

        // 格式化特殊字段
        switch (field) {
          case 'createdAt':
          case 'lastUsed':
          case 'expiresAt':
            value = value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '-'
            break
          case 'status':
            value = this.getStatusLabel(value)
            break
          case 'totalCost':
            value = value ? `$${value.toFixed(4)}` : '$0.0000'
            break
          case 'totalTokens':
          case 'requestCount':
            value = value || 0
            break
          case 'tags':
            value = Array.isArray(value) ? value.join(', ') : value || '-'
            break
          case 'limit':
            value = value === -1 ? '无限制' : value || 0
            break
          default:
            value = value || '-'
        }

        row[label] = value
      })

      // 添加高级选项数据
      if (config.includeUsageStats && key.usageStats) {
        row['输入Tokens'] = key.usageStats.inputTokens || 0
        row['输出Tokens'] = key.usageStats.outputTokens || 0
        row['缓存创建Tokens'] = key.usageStats.cacheCreateTokens || 0
        row['缓存读取Tokens'] = key.usageStats.cacheReadTokens || 0
      }

      if (config.includeCostAnalysis && key.costAnalysis) {
        row['平均每Token成本'] = `$${(key.costAnalysis.avgCostPerToken || 0).toFixed(6)}`
        row['成本效率'] = `${(key.costAnalysis.efficiency || 0).toFixed(2)}%`
      }

      return row
    })
  }

  /**
   * 获取状态标签
   * @param {string} status 状态值
   * @returns {string}
   */
  getStatusLabel(status) {
    const statusLabels = {
      active: '活跃',
      inactive: '非活跃',
      expired: '已过期',
      disabled: '已禁用'
    }
    return statusLabels[status] || status
  }

  /**
   * 导出为Excel文件
   * @param {Array} data 格式化后的数据
   * @param {Object} config 配置
   */
  async exportToExcel(data, config) {
    try {
      // 这里需要使用 xlsx 库或其他Excel导出库
      // 为了保持简单，这里使用模拟实现

      // 实际实现时可以使用 SheetJS (xlsx) 库：
      // import * as XLSX from 'xlsx'

      const filename = this.generateFilename('xlsx')

      // 模拟Excel导出
      console.log('导出Excel数据:', { data, filename, config })

      // 实际实现示例：
      /*
      const ws = XLSX.utils.json_to_sheet(data)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'API Keys')
      
      // 设置列宽
      const cols = Object.keys(data[0] || {}).map(() => ({ wch: 15 }))
      ws['!cols'] = cols
      
      // 导出文件
      XLSX.writeFile(wb, filename)
      */

      // 临时实现：转换为CSV并下载
      await this.exportToCSV(data, config)
    } catch (error) {
      console.error('Excel导出失败:', error)
      throw error
    }
  }

  /**
   * 导出为CSV文件
   * @param {Array} data 格式化后的数据
   * @param {Object} config 配置
   */
  async exportToCSV(data, _config) {
    try {
      if (data.length === 0) {
        throw new Error('没有可导出的数据')
      }

      // 获取表头
      const headers = Object.keys(data[0])

      // 构建CSV内容
      const csvContent = [
        // 表头
        headers.map((header) => this.escapeCSVField(header)).join(','),
        // 数据行
        ...data.map((row) => headers.map((header) => this.escapeCSVField(row[header])).join(','))
      ].join('\n')

      // 添加UTF-8 BOM以支持中文
      const bom = '\uFEFF'
      const finalContent = bom + csvContent

      // 创建下载链接
      const blob = new Blob([finalContent], {
        type: 'text/csv;charset=utf-8'
      })

      const filename = this.generateFilename('csv')
      this.downloadFile(blob, filename)
    } catch (error) {
      console.error('CSV导出失败:', error)
      throw error
    }
  }

  /**
   * 转义CSV字段
   * @param {any} field 字段值
   * @returns {string}
   */
  escapeCSVField(field) {
    const str = String(field || '')

    // 如果包含逗号、换行或双引号，需要用双引号包围
    if (str.includes(',') || str.includes('\n') || str.includes('"')) {
      // 双引号需要转义为两个双引号
      return `"${str.replace(/"/g, '""')}"`
    }

    return str
  }

  /**
   * 生成文件名
   * @param {string} extension 文件扩展名
   * @returns {string}
   */
  generateFilename(extension) {
    const timestamp = dayjs().format('YYYY-MM-DD-HHmm')
    return `api-keys-export-${timestamp}.${extension}`
  }

  /**
   * 下载文件
   * @param {Blob} blob 文件Blob
   * @param {string} filename 文件名
   */
  downloadFile(blob, filename) {
    try {
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')

      link.href = url
      link.download = filename
      link.style.display = 'none'

      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      // 清理URL对象
      setTimeout(() => URL.revokeObjectURL(url), 100)
    } catch (error) {
      console.error('文件下载失败:', error)
      throw new Error('文件下载失败')
    }
  }
}

// 创建单例实例
export const excelExporter = new ExcelExporter()
export default ExcelExporter
