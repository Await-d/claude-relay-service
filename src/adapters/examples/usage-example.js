/**
 * @fileoverview UpstreamFeatureAdapter使用示例
 *
 * 演示如何使用UpstreamFeatureAdapter和ApiKeyExportAdapter
 * 包含完整的使用场景、配置选项和最佳实践
 *
 * 使用场景：
 * - 基本适配器创建和使用
 * - API Key数据导出（JSON/CSV）
 * - 批量处理和错误处理
 * - 性能监控和日志记录
 * - 自定义适配器扩展
 *
 * @author Claude Code
 * @version 1.0.0
 */

const UpstreamFeatureAdapter = require('../UpstreamFeatureAdapter')
const ApiKeyExportAdapter = require('../ApiKeyExportAdapter')
const logger = require('../../utils/logger')
const path = require('path')

/**
 * 示例1: 基本的API Key导出
 */
async function basicApiKeyExportExample() {
  console.log('\n=== 示例1: 基本API Key导出 ===')

  try {
    // 创建导出适配器
    const exporter = new ApiKeyExportAdapter({
      outputDir: path.join(process.cwd(), 'temp', 'examples'),
      sanitizeData: true
    })

    // 初始化适配器
    await exporter.safeInitialize()
    console.log('✅ 导出适配器初始化成功')

    // 导出所有API Keys为JSON格式
    const jsonResult = await exporter.safeAdapt(
      {},
      {
        format: 'json',
        includeUsage: false,
        filename: 'example_apikeys.json'
      }
    )

    console.log('📄 JSON导出完成:', {
      文件路径: jsonResult.filePath,
      记录数量: jsonResult.recordCount,
      文件大小: `${jsonResult.fileSize} bytes`,
      导出时间: jsonResult.exportedAt
    })

    // 导出为CSV格式
    const csvResult = await exporter.safeAdapt(
      {},
      {
        format: 'csv',
        includeUsage: true,
        filename: 'example_apikeys.csv',
        fields: ['id', 'name', 'tokenLimit', 'isActive', 'createdAt']
      }
    )

    console.log('📊 CSV导出完成:', {
      文件路径: csvResult.filePath,
      记录数量: csvResult.recordCount,
      文件大小: `${csvResult.fileSize} bytes`
    })
  } catch (error) {
    console.error('❌ 导出失败:', error.message)
  }
}

/**
 * 示例2: 带过滤条件的导出
 */
async function filteredApiKeyExportExample() {
  console.log('\n=== 示例2: 带过滤条件的导出 ===')

  try {
    const exporter = new ApiKeyExportAdapter({
      sanitizeData: false // 演示用，生产环境建议保持true
    })

    await exporter.safeInitialize()

    // 使用过滤条件导出
    const filterResult = await exporter.safeAdapt(
      {
        isActive: true,
        permissions: 'all'
      },
      {
        format: 'json',
        includeUsage: true,
        fields: ['id', 'name', 'description', 'tokenLimit', 'permissions', 'tags']
      }
    )

    console.log('🔍 过滤导出完成:', {
      记录数量: filterResult.recordCount,
      包含使用统计: filterResult.includeUsage,
      数据已脱敏: filterResult.sanitized
    })
  } catch (error) {
    console.error('❌ 过滤导出失败:', error.message)
  }
}

/**
 * 示例3: 批量处理示例
 */
async function batchProcessingExample() {
  console.log('\n=== 示例3: 批量处理示例 ===')

  try {
    const exporter = new ApiKeyExportAdapter()
    await exporter.safeInitialize()

    // 模拟多个导出任务
    const exportTasks = [
      { format: 'json', filter: { isActive: true } },
      { format: 'csv', filter: { permissions: 'claude' } },
      { format: 'json', filter: { permissions: 'gemini' } }
    ]

    console.log(`📋 开始批量处理 ${exportTasks.length} 个导出任务...`)

    const batchResults = await exporter.batchAdapt(exportTasks, {
      concurrency: 2,
      failFast: false
    })

    console.log('✅ 批量处理完成:')
    batchResults.forEach((result, index) => {
      if (result) {
        console.log(`  任务${index + 1}: 成功 - ${result.recordCount} 记录`)
      } else {
        console.log(`  任务${index + 1}: 失败`)
      }
    })
  } catch (error) {
    console.error('❌ 批量处理失败:', error.message)
  }
}

/**
 * 示例4: 性能监控和统计
 */
async function performanceMonitoringExample() {
  console.log('\n=== 示例4: 性能监控示例 ===')

  try {
    const exporter = new ApiKeyExportAdapter({
      enableMetrics: true
    })

    await exporter.safeInitialize()

    // 执行几个导出操作
    await exporter.safeAdapt({}, { format: 'json' })
    await exporter.safeAdapt({}, { format: 'csv' })

    // 获取性能指标
    const metrics = exporter.getMetrics()
    console.log('📊 性能指标:', {
      总操作数: metrics.operationCount,
      总处理时间: `${metrics.totalProcessingTime}ms`,
      平均处理时间: `${Math.round(metrics.avgProcessingTime)}ms`,
      错误率: `${(metrics.errorRate * 100).toFixed(1)}%`,
      运行时间: `${Math.round(metrics.uptime / 1000)}s`
    })

    // 获取导出统计
    const exportStats = await exporter.getExportStats()
    console.log('📁 导出文件统计:', {
      总导出数: exportStats.totalExports,
      输出目录: exportStats.outputDir,
      最新文件: exportStats.files[0]?.filename || '无'
    })
  } catch (error) {
    console.error('❌ 性能监控示例失败:', error.message)
  }
}

/**
 * 示例5: 自定义适配器扩展
 */
class CustomDataAdapter extends UpstreamFeatureAdapter {
  constructor(options = {}) {
    super({
      name: 'CustomDataAdapter',
      version: '1.0.0',
      ...options
    })

    this.dataSource = options.dataSource || 'default'
  }

  async initialize() {
    logger.info(`初始化自定义适配器，数据源: ${this.dataSource}`)
    // 这里可以添加自定义初始化逻辑
  }

  async adapt(input, options = {}) {
    const { transform = 'uppercase' } = options

    // 自定义适配逻辑
    if (typeof input === 'string') {
      switch (transform) {
        case 'uppercase':
          return input.toUpperCase()
        case 'lowercase':
          return input.toLowerCase()
        case 'reverse':
          return input.split('').reverse().join('')
        default:
          return input
      }
    }

    return input
  }

  async validate(input, options = {}) {
    return typeof input === 'string' && input.length > 0
  }
}

async function customAdapterExample() {
  console.log('\n=== 示例5: 自定义适配器扩展 ===')

  try {
    const customAdapter = new CustomDataAdapter({
      dataSource: 'custom-api',
      enableMetrics: true
    })

    await customAdapter.safeInitialize()

    // 测试不同的转换
    const results = await Promise.all([
      customAdapter.safeAdapt('hello world', { transform: 'uppercase' }),
      customAdapter.safeAdapt('HELLO WORLD', { transform: 'lowercase' }),
      customAdapter.safeAdapt('hello', { transform: 'reverse' })
    ])

    console.log('🔄 自定义转换结果:', {
      大写转换: results[0],
      小写转换: results[1],
      反转字符: results[2]
    })

    // 显示适配器状态
    const status = customAdapter.getStatus()
    console.log('📋 适配器状态:', {
      名称: status.name,
      版本: status.version,
      已初始化: status.initialized,
      操作次数: status.metrics.operationCount
    })
  } catch (error) {
    console.error('❌ 自定义适配器示例失败:', error.message)
  }
}

/**
 * 示例6: 错误处理和恢复
 */
async function errorHandlingExample() {
  console.log('\n=== 示例6: 错误处理和恢复示例 ===')

  try {
    const exporter = new ApiKeyExportAdapter({
      timeout: 1000 // 设置短超时用于演示
    })

    await exporter.safeInitialize()

    // 测试无效格式
    try {
      await exporter.safeAdapt({}, { format: 'xml' })
    } catch (error) {
      console.log('⚠️  预期的格式验证错误:', error.message)
    }

    // 测试空输入
    try {
      await exporter.safeAdapt(null)
    } catch (error) {
      console.log('⚠️  预期的输入验证错误:', error.message)
    }

    // 显示错误统计
    const metrics = exporter.getMetrics()
    console.log('📈 错误统计:', {
      总操作数: metrics.operationCount,
      错误数: metrics.errorCount,
      错误率: `${(metrics.errorRate * 100).toFixed(1)}%`
    })
  } catch (error) {
    console.error('❌ 错误处理示例失败:', error.message)
  }
}

/**
 * 主执行函数
 */
async function runAllExamples() {
  console.log('🚀 UpstreamFeatureAdapter 使用示例演示')
  console.log('='.repeat(50))

  try {
    await basicApiKeyExportExample()
    await filteredApiKeyExportExample()
    await batchProcessingExample()
    await performanceMonitoringExample()
    await customAdapterExample()
    await errorHandlingExample()

    console.log('\n🎉 所有示例执行完成!')
    console.log('\n💡 使用建议:')
    console.log('  1. 生产环境请启用数据脱敏 (sanitizeData: true)')
    console.log('  2. 根据需要调整超时时间和并发数')
    console.log('  3. 定期清理过期的导出文件')
    console.log('  4. 监控性能指标以优化性能')
    console.log('  5. 实现自定义验证逻辑以确保数据质量')
  } catch (error) {
    console.error('💥 示例执行过程中发生错误:', error.message)
  }
}

/**
 * 如果直接运行此文件，则执行所有示例
 */
if (require.main === module) {
  runAllExamples().catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
}

module.exports = {
  basicApiKeyExportExample,
  filteredApiKeyExportExample,
  batchProcessingExample,
  performanceMonitoringExample,
  customAdapterExample,
  errorHandlingExample,
  CustomDataAdapter
}
