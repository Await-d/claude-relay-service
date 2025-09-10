/**
 * @fileoverview UpstreamFeatureAdapter集成测试
 *
 * 验证适配器与现有DatabaseAdapter的兼容性和基本功能
 * 包含基础功能测试、错误处理测试和性能测试
 *
 * 测试范围：
 * - UpstreamFeatureAdapter基础功能
 * - ApiKeyExportAdapter具体实现
 * - 数据库适配器集成
 * - 错误处理和日志记录
 * - 性能监控功能
 *
 * @author Claude Code
 * @version 1.0.0
 */

const path = require('path')
const fs = require('fs').promises
const UpstreamFeatureAdapter = require('../UpstreamFeatureAdapter')
const ApiKeyExportAdapter = require('../ApiKeyExportAdapter')
const logger = require('../../utils/logger')

/**
 * 测试用的模拟适配器类
 * 用于测试基础适配器功能
 */
class MockAdapter extends UpstreamFeatureAdapter {
  constructor(options = {}) {
    super({
      name: 'MockAdapter',
      version: '1.0.0-test',
      ...options
    })
    this.initCount = 0
    this.adaptCount = 0
  }

  async initialize() {
    this.initCount++
    logger.debug(`MockAdapter initialized ${this.initCount} times`)
  }

  async adapt(input, options = {}) {
    this.adaptCount++
    return {
      input,
      options,
      adaptCount: this.adaptCount,
      timestamp: new Date()
    }
  }

  async validate(input, options = {}) {
    return input !== null && input !== undefined && input !== 'invalid'
  }
}

/**
 * 集成测试主函数
 */
async function runIntegrationTests() {
  logger.info('Starting UpstreamFeatureAdapter Integration Tests')

  const results = {
    passed: 0,
    failed: 0,
    errors: [],
    startTime: Date.now()
  }

  // 测试套件
  const tests = [
    { name: 'Basic Adapter Functionality', fn: testBasicAdapterFunctionality },
    { name: 'MockAdapter Implementation', fn: testMockAdapter },
    { name: 'ApiKeyExportAdapter Initialization', fn: testApiKeyExportAdapterInit },
    { name: 'ApiKeyExportAdapter Validation', fn: testApiKeyExportValidation },
    { name: 'Database Integration', fn: testDatabaseIntegration },
    { name: 'Performance Metrics', fn: testPerformanceMetrics },
    { name: 'Error Handling', fn: testErrorHandling },
    { name: 'Batch Processing', fn: testBatchProcessing }
  ]

  for (const test of tests) {
    try {
      logger.info(`Running test: ${test.name}`)
      await test.fn()
      results.passed++
      logger.info(`✅ ${test.name} - PASSED`)
    } catch (error) {
      results.failed++
      results.errors.push({ test: test.name, error: error.message })
      logger.error(`❌ ${test.name} - FAILED: ${error.message}`)
    }
  }

  // 输出测试结果
  const duration = Date.now() - results.startTime
  logger.info(`\n=== Integration Test Results ===`)
  logger.info(`Total Tests: ${tests.length}`)
  logger.info(`Passed: ${results.passed}`)
  logger.info(`Failed: ${results.failed}`)
  logger.info(`Duration: ${duration}ms`)

  if (results.errors.length > 0) {
    logger.error(`\nErrors:`)
    results.errors.forEach((error) => {
      logger.error(`- ${error.test}: ${error.error}`)
    })
  }

  return results
}

/**
 * 测试基础适配器功能
 */
async function testBasicAdapterFunctionality() {
  const adapter = new MockAdapter({
    enableMetrics: true,
    timeout: 5000
  })

  // 测试初始状态
  assert(adapter.name === 'MockAdapter', 'Adapter name should be set')
  assert(adapter.version === '1.0.0-test', 'Adapter version should be set')
  assert(adapter.initialized === false, 'Adapter should not be initialized initially')
  assert(adapter.enableMetrics === true, 'Metrics should be enabled')

  // 测试状态获取
  const status = adapter.getStatus()
  assert(status.name === 'MockAdapter', 'Status should include name')
  assert(status.initialized === false, 'Status should show not initialized')

  // 测试配置更新
  adapter.updateConfig({ testSetting: 'value' })
  assert(adapter.config.testSetting === 'value', 'Config should be updated')
}

/**
 * 测试MockAdapter实现
 */
async function testMockAdapter() {
  const adapter = new MockAdapter()

  // 测试安全初始化
  await adapter.safeInitialize()
  assert(adapter.initialized === true, 'Adapter should be initialized')
  assert(adapter.initCount === 1, 'Initialize should be called once')

  // 重复初始化应该被忽略
  await adapter.safeInitialize()
  assert(adapter.initCount === 1, 'Initialize should not be called again')

  // 测试适配功能
  const testInput = { test: 'data' }
  const result = await adapter.safeAdapt(testInput, { option: 'value' })

  assert(result.input.test === 'data', 'Input should be preserved')
  assert(result.options.option === 'value', 'Options should be preserved')
  assert(result.adaptCount === 1, 'Adapt count should be incremented')

  // 测试指标
  const metrics = adapter.getMetrics()
  assert(metrics.operationCount === 2, 'Should have 2 operations (init + adapt)')
  assert(metrics.errorCount === 0, 'Should have no errors')
}

/**
 * 测试ApiKeyExportAdapter初始化
 */
async function testApiKeyExportAdapterInit() {
  const tempDir = path.join(process.cwd(), 'temp', 'test-exports')

  const adapter = new ApiKeyExportAdapter({
    outputDir: tempDir,
    sanitizeData: true
  })

  // 测试基本属性
  assert(adapter.name === 'ApiKeyExportAdapter', 'Name should be correct')
  assert(adapter.outputDir === tempDir, 'Output directory should be set')
  assert(adapter.sanitizeData === true, 'Sanitize should be enabled')
  assert(adapter.supportedFormats.includes('json'), 'Should support JSON')
  assert(adapter.supportedFormats.includes('csv'), 'Should support CSV')

  // 测试初始化
  await adapter.safeInitialize()
  assert(adapter.initialized === true, 'Should be initialized')

  // 验证目录创建
  const stats = await fs.stat(tempDir)
  assert(stats.isDirectory(), 'Output directory should exist')

  // 清理
  await fs.rm(tempDir, { recursive: true })
}

/**
 * 测试ApiKeyExportAdapter验证功能
 */
async function testApiKeyExportValidation() {
  const adapter = new ApiKeyExportAdapter()

  // 测试有效输入
  const validResult1 = await adapter.validate({}, { format: 'json' })
  assert(validResult1 === true, 'Empty object with JSON format should be valid')

  const validResult2 = await adapter.validate([], { format: 'csv' })
  assert(validResult2 === true, 'Array with CSV format should be valid')

  // 测试无效输入
  const invalidResult1 = await adapter.validate(null)
  assert(invalidResult1 === false, 'Null input should be invalid')

  const invalidResult2 = await adapter.validate({}, { format: 'xml' })
  assert(invalidResult2 === false, 'Unsupported format should be invalid')
}

/**
 * 测试数据库集成
 */
async function testDatabaseIntegration() {
  const adapter = new MockAdapter()

  // 测试数据库连接存在
  assert(adapter.database !== null, 'Database should be available')
  assert(typeof adapter.database === 'object', 'Database should be an object')

  // 测试fetchData方法（这里只测试方法存在，不实际调用数据库）
  assert(typeof adapter.fetchData === 'function', 'fetchData method should exist')

  // 测试错误处理
  try {
    await adapter.fetchData('invalid-type', 'test-id')
    assert(false, 'Should throw error for invalid data type')
  } catch (error) {
    assert(error.message.includes('Unsupported data type'), 'Should throw appropriate error')
  }
}

/**
 * 测试性能监控功能
 */
async function testPerformanceMetrics() {
  const adapter = new MockAdapter({ enableMetrics: true })

  // 初始指标
  let metrics = adapter.getMetrics()
  assert(metrics.operationCount === 0, 'Initial operation count should be 0')
  assert(metrics.errorCount === 0, 'Initial error count should be 0')

  // 执行操作
  await adapter.safeAdapt('test')
  await adapter.safeAdapt('test2')

  // 检查更新的指标
  metrics = adapter.getMetrics()
  assert(metrics.operationCount === 3, 'Should have 3 operations (1 init + 2 adapt)')
  assert(metrics.errorCount === 0, 'Should have no errors')
  assert(metrics.avgProcessingTime >= 0, 'Should have average processing time')
  assert(metrics.errorRate === 0, 'Error rate should be 0')

  // 测试指标重置
  adapter.resetMetrics()
  metrics = adapter.getMetrics()
  assert(metrics.operationCount === 0, 'Operation count should be reset')
}

/**
 * 测试错误处理
 */
async function testErrorHandling() {
  const adapter = new MockAdapter()

  // 测试验证失败
  try {
    await adapter.safeAdapt('invalid')
    assert(false, 'Should throw error for invalid input')
  } catch (error) {
    assert(error.message.includes('Invalid input data'), 'Should throw validation error')
  }

  // 测试超时处理
  const timeoutAdapter = new MockAdapter({ timeout: 100 })

  // 模拟缓慢的适配操作
  timeoutAdapter.adapt = async (input) => {
    await new Promise((resolve) => setTimeout(resolve, 200))
    return input
  }

  try {
    await timeoutAdapter.safeAdapt('test')
    assert(false, 'Should throw timeout error')
  } catch (error) {
    assert(error.message.includes('timeout'), 'Should throw timeout error')
  }

  // 检查错误指标
  const metrics = timeoutAdapter.getMetrics()
  assert(metrics.errorCount > 0, 'Should have recorded errors')
}

/**
 * 测试批量处理
 */
async function testBatchProcessing() {
  const adapter = new MockAdapter()

  // 测试正常批量处理
  const inputs = ['test1', 'test2', 'test3']
  const results = await adapter.batchAdapt(inputs, { concurrency: 2 })

  assert(results.length === 3, 'Should return 3 results')
  assert(results[0].input === 'test1', 'First result should match input')

  // 测试空数组
  const emptyResults = await adapter.batchAdapt([])
  assert(emptyResults.length === 0, 'Empty input should return empty array')

  // 测试错误输入
  try {
    await adapter.batchAdapt('not-an-array')
    assert(false, 'Should throw error for non-array input')
  } catch (error) {
    assert(error.message.includes('must be an array'), 'Should throw array error')
  }

  // 测试部分失败的批量处理
  const mixedInputs = ['valid1', 'invalid', 'valid2']
  const mixedResults = await adapter.batchAdapt(mixedInputs, { failFast: false })

  // 应该有结果（成功的）和null（失败的）
  assert(mixedResults.length === 3, 'Should return 3 results')
  assert(mixedResults[0] !== null, 'First result should be successful')
  assert(mixedResults[1] === null, 'Second result should be null (failed)')
  assert(mixedResults[2] !== null, 'Third result should be successful')
}

/**
 * 简单断言函数
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed')
  }
}

/**
 * 主入口函数
 */
async function main() {
  try {
    const results = await runIntegrationTests()

    if (results.failed === 0) {
      logger.info('🎉 All integration tests passed!')
      process.exit(0)
    } else {
      logger.error(`💥 ${results.failed} test(s) failed`)
      process.exit(1)
    }
  } catch (error) {
    logger.error('Fatal error running integration tests:', error)
    process.exit(1)
  }
}

// 如果直接运行此文件，则执行测试
if (require.main === module) {
  main()
}

module.exports = {
  runIntegrationTests,
  MockAdapter
}
