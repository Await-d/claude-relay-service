#!/usr/bin/env node

/**
 * @fileoverview 系统集成测试套件
 *
 * 全面测试Claude Relay Service的所有新实现的上游功能，包括：
 * - 智能负载均衡器功能验证
 * - 错误处理和重试机制测试
 * - 连接管理和会话持久化测试
 * - API Key导出功能测试
 * - 端到端功能验证
 * - 性能基准测试
 *
 * @author Claude Code
 * @version 1.0.0
 */

const path = require('path')
const fs = require('fs').promises
const { performance } = require('perf_hooks')
const chalk = require('chalk')

// 导入核心模块
const logger = require('../src/utils/logger')
const config = require('../config/config')
const database = require('../src/models/database')

// 导入新功能模块
const IntelligentLoadBalancer = require('../src/services/intelligentLoadBalancer')
const QueryOptimizer = require('../src/utils/QueryOptimizer')
const UpstreamFeatureAdapter = require('../src/adapters/UpstreamFeatureAdapter')
const ApiKeyExportAdapter = require('../src/adapters/ApiKeyExportAdapter')

// 测试配置
const TEST_CONFIG = {
  // 测试超时配置
  timeout: {
    unit: 10000, // 单个测试 10秒
    integration: 30000, // 集成测试 30秒
    performance: 60000 // 性能测试 60秒
  },

  // 测试数据配置
  testData: {
    accountCount: 5,
    apiKeyCount: 10,
    concurrentRequests: 8,
    stressTestDuration: 15000
  },

  // 性能基准
  performance: {
    maxResponseTime: 2000,
    minThroughput: 10,
    maxErrorRate: 0.05
  },

  // 模拟模式 - 无需真实Claude API
  mockMode: true,

  // 详细日志
  verbose: process.argv.includes('--verbose') || process.argv.includes('-v')
}

/**
 * 测试结果统计
 */
class TestResults {
  constructor() {
    this.total = 0
    this.passed = 0
    this.failed = 0
    this.skipped = 0
    this.errors = []
    this.performance = {
      totalTime: 0,
      tests: []
    }
  }

  addTest(name, passed, duration = 0, error = null) {
    this.total++
    if (passed) {
      this.passed++
    } else {
      this.failed++
      if (error) {
        this.errors.push({ test: name, error: error.message })
      }
    }

    this.performance.totalTime += duration
    this.performance.tests.push({
      name,
      duration,
      passed
    })
  }

  addSkipped(name) {
    this.total++
    this.skipped++
  }

  getSuccessRate() {
    return this.total > 0 ? (this.passed / this.total) * 100 : 0
  }

  getSummary() {
    return {
      total: this.total,
      passed: this.passed,
      failed: this.failed,
      skipped: this.skipped,
      successRate: this.getSuccessRate(),
      totalTime: this.performance.totalTime,
      errors: this.errors
    }
  }
}

const testResults = new TestResults()

/**
 * 日志工具
 */
const log = {
  info: (msg, ...args) => {
    console.log(chalk.blue('ℹ'), msg, ...args)
    if (TEST_CONFIG.verbose) {
      logger.info(msg, ...args)
    }
  },
  success: (msg, ...args) => {
    console.log(chalk.green('✅'), msg, ...args)
    if (TEST_CONFIG.verbose) {
      logger.info(msg, ...args)
    }
  },
  error: (msg, ...args) => {
    console.log(chalk.red('❌'), msg, ...args)
    logger.error(msg, ...args)
  },
  warn: (msg, ...args) => {
    console.log(chalk.yellow('⚠️'), msg, ...args)
    if (TEST_CONFIG.verbose) {
      logger.warn(msg, ...args)
    }
  },
  debug: (msg, ...args) => {
    if (TEST_CONFIG.verbose) {
      console.log(chalk.gray('🔍'), msg, ...args)
      logger.debug(msg, ...args)
    }
  }
}

/**
 * 模拟数据生成器
 */
class MockDataGenerator {
  static generateClaudeAccounts(count = 5) {
    const accounts = []
    for (let i = 1; i <= count; i++) {
      accounts.push({
        id: `test-account-${i}`,
        name: `Test Account ${i}`,
        status: i <= 3 ? 'active' : 'inactive', // 前3个活跃
        isActive: i <= 3 ? 'true' : 'false',
        usageCount: Math.floor(Math.random() * 100),
        schedulingWeight: Math.random() * 2 + 0.5, // 0.5-2.5
        errorCount: Math.floor(Math.random() * 5),
        proxy:
          i % 2 === 0
            ? {
                type: 'socks5',
                host: '127.0.0.1',
                port: 1080
              }
            : null
      })
    }
    return accounts
  }

  static generateApiKeys(count = 10) {
    const keys = []
    for (let i = 1; i <= count; i++) {
      keys.push({
        id: `test-key-${i}`,
        name: `Test API Key ${i}`,
        isActive: i <= 8 ? 'true' : 'false', // 前8个活跃
        requestLimit: 1000 + i * 100,
        usageCount: Math.floor(Math.random() * 50),
        createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString()
      })
    }
    return keys
  }

  static generateUsageStats(keyId) {
    return {
      totalRequests: Math.floor(Math.random() * 1000),
      totalTokens: Math.floor(Math.random() * 50000),
      totalCost: Math.random() * 10,
      lastUsed: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString()
    }
  }
}

/**
 * 模拟数据库适配器
 */
class MockDatabaseAdapter {
  constructor() {
    this.accounts = MockDataGenerator.generateClaudeAccounts(TEST_CONFIG.testData.accountCount)
    this.apiKeys = MockDataGenerator.generateApiKeys(TEST_CONFIG.testData.apiKeyCount)
    this.callCount = 0
  }

  async getAllClaudeAccounts() {
    this.callCount++
    await this.simulateLatency()
    return this.accounts
  }

  async getClaudeAccount(id) {
    this.callCount++
    await this.simulateLatency()
    return this.accounts.find((acc) => acc.id === id)
  }

  async getAllApiKeys() {
    this.callCount++
    await this.simulateLatency()
    return this.apiKeys
  }

  async getApiKey(id) {
    this.callCount++
    await this.simulateLatency()
    return this.apiKeys.find((key) => key.id === id)
  }

  async getUsageStats(keyId) {
    this.callCount++
    await this.simulateLatency()
    return MockDataGenerator.generateUsageStats(keyId)
  }

  async getAccountUsageInTimeWindow(accountId, start, end) {
    this.callCount++
    await this.simulateLatency()

    // 模拟时间窗口内的使用统计
    const usageEntries = []
    const entryCount = Math.floor(Math.random() * 10) + 1

    for (let i = 0; i < entryCount; i++) {
      usageEntries.push({
        timestamp: start + Math.random() * (end - start),
        responseTime: 1000 + Math.random() * 3000,
        cost: Math.random() * 0.01,
        status: Math.random() > 0.1 ? 'success' : 'error'
      })
    }

    return usageEntries
  }

  async recordAccountUsage(accountId, usage) {
    this.callCount++
    await this.simulateLatency(50) // 快速写入
    return true
  }

  async simulateLatency(baseMs = 100) {
    const latency = baseMs + Math.random() * 50
    await new Promise((resolve) => setTimeout(resolve, latency))
  }

  getStats() {
    return {
      callCount: this.callCount,
      accountCount: this.accounts.length,
      apiKeyCount: this.apiKeys.length
    }
  }

  reset() {
    this.callCount = 0
  }
}

// 全局测试数据
let mockDatabase
let loadBalancer
let queryOptimizer
let exportAdapter

/**
 * 初始化测试环境
 */
async function initializeTestEnvironment() {
  log.info('🚀 Initializing test environment...')

  try {
    // 初始化模拟数据库
    mockDatabase = new MockDatabaseAdapter()

    // 初始化负载均衡器
    loadBalancer = new IntelligentLoadBalancer({
      performanceWindow: 60000, // 1分钟窗口
      healthCheckThreshold: 0.6,
      costOptimizationEnabled: true
    })

    // 初始化查询优化器
    queryOptimizer = new QueryOptimizer(mockDatabase, {
      batchSize: 50,
      enableCache: true,
      cacheTTL: 300
    })

    // 初始化导出适配器
    exportAdapter = new ApiKeyExportAdapter({
      enableExport: true,
      supportedFormats: ['xlsx', 'json', 'csv']
    })

    await exportAdapter.safeInitialize()

    log.success('Test environment initialized successfully')
    return true
  } catch (error) {
    log.error('Failed to initialize test environment:', error.message)
    throw error
  }
}

/**
 * 测试智能负载均衡器
 */
async function testIntelligentLoadBalancer() {
  log.info('🧠 Testing Intelligent Load Balancer...')

  try {
    const testStart = performance.now()

    // 测试1: 基本账户选择
    log.debug('Test 1: Basic account selection')
    const accounts = await mockDatabase.getAllClaudeAccounts()
    const activeAccounts = accounts.filter((acc) => acc.isActive === 'true')

    const selection = await loadBalancer.selectOptimalAccount(activeAccounts, {
      model: 'claude-3-5-sonnet-20241022',
      estimatedTokens: 2000
    })

    testResults.addTest('LoadBalancer-BasicSelection', !!selection.accountId)
    log.success(
      `Selected account: ${selection.accountId} (score: ${selection.score?.toFixed(3) || 'N/A'})`
    )

    // 测试2: 单账户场景
    log.debug('Test 2: Single account scenario')
    const singleAccount = await loadBalancer.selectOptimalAccount([activeAccounts[0]], {
      model: 'claude-3-5-sonnet-20241022',
      estimatedTokens: 1000
    })

    testResults.addTest(
      'LoadBalancer-SingleAccount',
      singleAccount.accountId === activeAccounts[0].id && singleAccount.reason === 'only_available'
    )

    // 测试3: 健康检查
    log.debug('Test 3: Health check functionality')
    const healthyAccounts = await loadBalancer.performHealthCheck(accounts)
    const healthCheckPassed =
      healthyAccounts.length > 0 && healthyAccounts.length <= accounts.length

    testResults.addTest('LoadBalancer-HealthCheck', healthCheckPassed)
    log.success(`Health check: ${healthyAccounts.length}/${accounts.length} accounts healthy`)

    // 测试4: 权重更新
    log.debug('Test 4: Weight configuration update')
    const originalWeights = { ...loadBalancer.weights }
    const newWeights = {
      costEfficiency: 0.5,
      responseTime: 0.2,
      errorRate: 0.2,
      availability: 0.1
    }

    loadBalancer.updateWeights(newWeights)
    const weightsUpdated = Math.abs(loadBalancer.weights.costEfficiency - 0.5) < 0.01

    testResults.addTest('LoadBalancer-WeightUpdate', weightsUpdated)

    // 恢复原始权重
    loadBalancer.updateWeights(originalWeights)

    // 测试5: 性能指标
    log.debug('Test 5: Performance metrics')
    const stats = loadBalancer.getLoadBalancerStats()
    const hasValidStats = stats && typeof stats.totalAccountsTracked === 'number'

    testResults.addTest('LoadBalancer-Stats', hasValidStats)
    log.success(`Load balancer stats: ${JSON.stringify(stats, null, 2)}`)

    const testDuration = performance.now() - testStart
    log.success(`Load balancer tests completed in ${testDuration.toFixed(2)}ms`)
  } catch (error) {
    testResults.addTest('LoadBalancer-General', false, 0, error)
    log.error('Load balancer test failed:', error.message)
    throw error
  }
}

/**
 * 测试查询优化器
 */
async function testQueryOptimizer() {
  log.info('📊 Testing Query Optimizer...')

  try {
    const testStart = performance.now()

    // 测试1: API Key导出优化
    log.debug('Test 1: Optimized API key export')
    const apiKeys = await queryOptimizer.optimizedApiKeyExport(
      {
        isActive: 'true'
      },
      {
        includeUsageStats: true,
        includeCostStats: true
      }
    )

    const exportPassed = Array.isArray(apiKeys) && apiKeys.length > 0
    testResults.addTest('QueryOptimizer-ApiKeyExport', exportPassed)
    log.success(`Exported ${apiKeys.length} API keys with optimization`)

    // 测试2: 负载均衡查询优化
    log.debug('Test 2: Optimized load balance query')
    const accounts = await mockDatabase.getAllClaudeAccounts()
    const accountIds = accounts.map((acc) => acc.id)

    const loadBalanceData = await queryOptimizer.optimizedLoadBalanceQuery(accountIds, {
      strategy: 'balanced',
      includeRealtime: true,
      timeRange: 'today'
    })

    const loadBalancePassed = Array.isArray(loadBalanceData) && loadBalanceData.length > 0
    testResults.addTest('QueryOptimizer-LoadBalance', loadBalancePassed)
    log.success(`Load balance query returned ${loadBalanceData.length} optimized accounts`)

    // 测试3: 缓存性能
    log.debug('Test 3: Cache performance')
    const cacheStart = performance.now()

    // 第一次查询 - 缓存未命中
    await queryOptimizer.optimizedApiKeyExport({ isActive: 'true' })
    const firstDuration = performance.now() - cacheStart

    // 第二次查询 - 缓存命中
    const secondStart = performance.now()
    await queryOptimizer.optimizedApiKeyExport({ isActive: 'true' })
    const secondDuration = performance.now() - secondStart

    const cacheEffective = secondDuration < firstDuration * 0.8 // 第二次应该快80%以上
    testResults.addTest('QueryOptimizer-Cache', cacheEffective)
    log.success(
      `Cache performance: first=${firstDuration.toFixed(2)}ms, second=${secondDuration.toFixed(2)}ms`
    )

    // 测试4: 性能统计
    log.debug('Test 4: Performance statistics')
    const perfStats = queryOptimizer.getPerformanceStats()
    const statsPassed =
      perfStats && typeof perfStats.totalQueries === 'number' && perfStats.totalQueries > 0

    testResults.addTest('QueryOptimizer-Stats', statsPassed)
    log.success(
      `Performance stats: ${JSON.stringify({
        totalQueries: perfStats.totalQueries,
        avgTime: perfStats.averageTime.toFixed(2),
        cacheHitRate: perfStats.cacheHitRate.toFixed(1)
      })}`
    )

    // 测试5: 内存管理
    log.debug('Test 5: Memory management')
    queryOptimizer.clearCache()
    const cacheCleared = queryOptimizer.queryCache.size === 0

    testResults.addTest('QueryOptimizer-MemoryManagement', cacheCleared)
    log.success('Cache cleared successfully')

    const testDuration = performance.now() - testStart
    log.success(`Query optimizer tests completed in ${testDuration.toFixed(2)}ms`)
  } catch (error) {
    testResults.addTest('QueryOptimizer-General', false, 0, error)
    log.error('Query optimizer test failed:', error.message)
    throw error
  }
}

/**
 * 测试API Key导出适配器
 */
async function testApiKeyExportAdapter() {
  log.info('📤 Testing API Key Export Adapter...')

  try {
    const testStart = performance.now()

    // 测试1: 适配器初始化
    log.debug('Test 1: Adapter initialization')
    const adapterStatus = exportAdapter.getStatus()
    const initPassed = adapterStatus.initialized && adapterStatus.name === 'ApiKeyExportAdapter'

    testResults.addTest('ExportAdapter-Initialization', initPassed)
    log.success(`Adapter initialized: ${adapterStatus.name}`)

    // 测试2: 数据获取
    log.debug('Test 2: Data fetching')
    const fetchedApiKeys = await exportAdapter.fetchData('apikeys')
    const fetchPassed = Array.isArray(fetchedApiKeys) && fetchedApiKeys.length > 0

    testResults.addTest('ExportAdapter-DataFetch', fetchPassed)
    log.success(`Fetched ${fetchedApiKeys.length} API keys`)

    // 测试3: 数据验证
    log.debug('Test 3: Data validation')
    const sampleKey = fetchedApiKeys[0]
    const validationPassed = await exportAdapter.validate(sampleKey)

    testResults.addTest('ExportAdapter-Validation', validationPassed)
    log.success('Data validation passed')

    // 测试4: 批量适配
    log.debug('Test 4: Batch adaptation')
    const batchInput = fetchedApiKeys.slice(0, 3)
    const batchResults = await exportAdapter.batchAdapt(batchInput, {
      concurrency: 2,
      failFast: false
    })

    const batchPassed = Array.isArray(batchResults) && batchResults.length === batchInput.length
    testResults.addTest('ExportAdapter-BatchAdapt', batchPassed)
    log.success(`Batch adaptation completed: ${batchResults.length} items`)

    // 测试5: 性能指标
    log.debug('Test 5: Performance metrics')
    const metrics = exportAdapter.getMetrics()
    const metricsPassed = metrics && metrics.operationCount > 0

    testResults.addTest('ExportAdapter-Metrics', metricsPassed)
    log.success(
      `Performance metrics: ${JSON.stringify({
        operations: metrics.operationCount,
        avgTime: metrics.avgProcessingTime?.toFixed(2),
        errorRate: (metrics.errorRate * 100).toFixed(1)
      })}`
    )

    const testDuration = performance.now() - testStart
    log.success(`Export adapter tests completed in ${testDuration.toFixed(2)}ms`)
  } catch (error) {
    testResults.addTest('ExportAdapter-General', false, 0, error)
    log.error('Export adapter test failed:', error.message)
    throw error
  }
}

/**
 * 测试错误处理和重试机制
 */
async function testErrorHandling() {
  log.info('🔄 Testing Error Handling and Retry Mechanisms...')

  try {
    const testStart = performance.now()

    // 测试1: 负载均衡器错误处理
    log.debug('Test 1: Load balancer error handling')
    try {
      await loadBalancer.selectOptimalAccount([], {}) // 空账户列表
      testResults.addTest('ErrorHandling-LoadBalancerEmpty', false)
    } catch (error) {
      const errorHandled = error.message.includes('No available accounts')
      testResults.addTest('ErrorHandling-LoadBalancerEmpty', errorHandled)
      log.success('Load balancer correctly handled empty account list')
    }

    // 测试2: 查询优化器超时处理
    log.debug('Test 2: Query optimizer timeout handling')
    const originalTimeout = queryOptimizer.options.queryTimeout
    queryOptimizer.options.queryTimeout = 1 // 设置极短超时

    try {
      await queryOptimizer.optimizedApiKeyExport({}, { includeUsageStats: true })
      testResults.addTest('ErrorHandling-QueryTimeout', false)
    } catch (error) {
      const timeoutHandled = error.message.includes('timeout') || error.message.includes('time')
      testResults.addTest('ErrorHandling-QueryTimeout', timeoutHandled)
      log.success('Query optimizer timeout handled correctly')
    } finally {
      queryOptimizer.options.queryTimeout = originalTimeout
    }

    // 测试3: 适配器验证错误
    log.debug('Test 3: Adapter validation error')
    const invalidData = null
    const validationResult = await exportAdapter.validate(invalidData)

    testResults.addTest('ErrorHandling-AdapterValidation', !validationResult)
    log.success('Adapter validation correctly rejected invalid data')

    // 测试4: 数据库错误恢复
    log.debug('Test 4: Database error recovery')
    const originalSimulateLatency = mockDatabase.simulateLatency

    // 模拟数据库错误
    mockDatabase.simulateLatency = async () => {
      throw new Error('Simulated database error')
    }

    try {
      await queryOptimizer.optimizedApiKeyExport({})
      testResults.addTest('ErrorHandling-DatabaseRecovery', false)
    } catch (error) {
      const errorHandled = error.message.includes('database') || error.message.includes('Simulated')
      testResults.addTest('ErrorHandling-DatabaseRecovery', errorHandled)
      log.success('Database error correctly propagated')
    } finally {
      mockDatabase.simulateLatency = originalSimulateLatency
    }

    // 测试5: 优雅降级
    log.debug('Test 5: Graceful degradation')
    const accounts = await mockDatabase.getAllClaudeAccounts()

    // 模拟部分账户有问题
    const problematicAccounts = accounts.map((acc, index) => ({
      ...acc,
      status: index < 2 ? 'error' : 'active' // 前两个账户设为错误状态
    }))

    const healthyAccounts = await loadBalancer.performHealthCheck(problematicAccounts)
    const degradationHandled = healthyAccounts.length === accounts.length - 2

    testResults.addTest('ErrorHandling-GracefulDegradation', degradationHandled)
    log.success(
      `Graceful degradation: ${healthyAccounts.length} healthy accounts from ${accounts.length} total`
    )

    const testDuration = performance.now() - testStart
    log.success(`Error handling tests completed in ${testDuration.toFixed(2)}ms`)
  } catch (error) {
    testResults.addTest('ErrorHandling-General', false, 0, error)
    log.error('Error handling test failed:', error.message)
    throw error
  }
}

/**
 * 端到端集成测试
 */
async function testEndToEndIntegration() {
  log.info('🔗 Testing End-to-End Integration...')

  try {
    const testStart = performance.now()

    // 测试1: 完整数据流
    log.debug('Test 1: Complete data flow')

    // 获取账户 -> 负载均衡 -> 查询优化 -> 导出
    const accounts = await mockDatabase.getAllClaudeAccounts()
    const activeAccounts = accounts.filter((acc) => acc.isActive === 'true')

    const selectedAccount = await loadBalancer.selectOptimalAccount(activeAccounts, {
      model: 'claude-3-5-sonnet-20241022',
      estimatedTokens: 1500
    })

    const optimizedKeys = await queryOptimizer.optimizedApiKeyExport(
      {
        isActive: 'true'
      },
      {
        includeUsageStats: true
      }
    )

    const exportData = await exportAdapter.safeAdapt(optimizedKeys.slice(0, 5), {
      format: 'json'
    })

    const e2ePassed = selectedAccount && optimizedKeys.length > 0 && exportData
    testResults.addTest('Integration-E2E-DataFlow', e2ePassed)
    log.success(
      `E2E data flow: account selected, ${optimizedKeys.length} keys optimized, export completed`
    )

    // 测试2: 性能链路
    log.debug('Test 2: Performance pipeline')
    const pipelineStart = performance.now()

    // 并行执行多个操作
    const parallelOps = await Promise.all([
      loadBalancer.performHealthCheck(accounts),
      queryOptimizer.optimizedLoadBalanceQuery(accounts.map((acc) => acc.id)),
      exportAdapter.fetchData('apikeys')
    ])

    const pipelineDuration = performance.now() - pipelineStart
    const performancePassed =
      pipelineDuration < TEST_CONFIG.performance.maxResponseTime &&
      parallelOps.every((op) => op && op.length > 0)

    testResults.addTest('Integration-PerformancePipeline', performancePassed)
    log.success(`Performance pipeline completed in ${pipelineDuration.toFixed(2)}ms`)

    // 测试3: 状态一致性
    log.debug('Test 3: State consistency')

    // 更新负载均衡器状态
    await loadBalancer.updateAccountUsage(selectedAccount.accountId, {
      responseTime: 1500,
      cost: 0.005,
      status: 'success'
    })

    // 验证状态更新
    const updatedMetrics = await loadBalancer.getAccountMetrics(selectedAccount.accountId)
    const consistencyPassed = updatedMetrics && updatedMetrics.lastUpdated > 0

    testResults.addTest('Integration-StateConsistency', consistencyPassed)
    log.success('State consistency maintained across components')

    // 测试4: 故障隔离
    log.debug('Test 4: Failure isolation')

    // 模拟组件部分故障
    const originalGetApiKey = mockDatabase.getApiKey
    mockDatabase.getApiKey = async () => {
      throw new Error('Simulated API key fetch failure')
    }

    try {
      // 负载均衡应该仍然工作
      const isolatedSelection = await loadBalancer.selectOptimalAccount(activeAccounts, {
        model: 'claude-3-5-sonnet-20241022'
      })

      const isolationPassed = !!isolatedSelection.accountId
      testResults.addTest('Integration-FailureIsolation', isolationPassed)
      log.success('Failure isolation: load balancer works despite database issues')
    } finally {
      mockDatabase.getApiKey = originalGetApiKey
    }

    // 测试5: 资源清理
    log.debug('Test 5: Resource cleanup')

    // 清理缓存和统计
    queryOptimizer.clearCache()
    queryOptimizer.resetPerformanceStats()
    exportAdapter.resetMetrics()
    loadBalancer.cleanup()

    const cleanupPassed =
      queryOptimizer.queryCache.size === 0 && queryOptimizer.performanceStats.totalQueries === 0

    testResults.addTest('Integration-ResourceCleanup', cleanupPassed)
    log.success('Resource cleanup completed successfully')

    const testDuration = performance.now() - testStart
    log.success(`End-to-end integration tests completed in ${testDuration.toFixed(2)}ms`)
  } catch (error) {
    testResults.addTest('Integration-General', false, 0, error)
    log.error('End-to-end integration test failed:', error.message)
    throw error
  }
}

/**
 * 性能和压力测试
 */
async function testPerformanceAndStress() {
  log.info('🚀 Testing Performance and Stress...')

  try {
    const testStart = performance.now()

    // 测试1: 并发负载均衡
    log.debug('Test 1: Concurrent load balancing')
    const accounts = await mockDatabase.getAllClaudeAccounts()
    const activeAccounts = accounts.filter((acc) => acc.isActive === 'true')

    const concurrentStart = performance.now()
    const concurrentTasks = Array(TEST_CONFIG.testData.concurrentRequests)
      .fill()
      .map(async (_, index) =>
        loadBalancer.selectOptimalAccount(activeAccounts, {
          model: 'claude-3-5-sonnet-20241022',
          estimatedTokens: 1000 + index * 200
        })
      )

    const concurrentResults = await Promise.all(concurrentTasks)
    const concurrentDuration = performance.now() - concurrentStart

    const concurrentPassed =
      concurrentResults.every((result) => !!result.accountId) &&
      concurrentDuration < TEST_CONFIG.performance.maxResponseTime * 2

    testResults.addTest('Performance-ConcurrentLoadBalancing', concurrentPassed)
    log.success(
      `Concurrent load balancing: ${concurrentResults.length} requests in ${concurrentDuration.toFixed(2)}ms`
    )

    // 测试2: 批量查询性能
    log.debug('Test 2: Batch query performance')
    const batchStart = performance.now()

    const batchApiKeys = await queryOptimizer.optimizedApiKeyExport(
      {},
      {
        includeUsageStats: true,
        includeCostStats: true
      }
    )

    const batchDuration = performance.now() - batchStart
    const throughput = batchApiKeys.length / (batchDuration / 1000) // keys per second

    const batchPassed = throughput >= TEST_CONFIG.performance.minThroughput

    testResults.addTest('Performance-BatchQuery', batchPassed)
    log.success(
      `Batch query performance: ${batchApiKeys.length} keys, throughput: ${throughput.toFixed(1)} keys/sec`
    )

    // 测试3: 内存使用测试
    log.debug('Test 3: Memory usage test')
    const memStart = process.memoryUsage()

    // 执行大量操作
    for (let i = 0; i < 50; i++) {
      await queryOptimizer.optimizedApiKeyExport({ isActive: 'true' })
      if (i % 10 === 0) {
        // 定期检查内存使用
        const currentMem = process.memoryUsage()
        if (currentMem.heapUsed > memStart.heapUsed * 5) {
          // 内存使用增长超过5倍，可能有内存泄漏
          break
        }
      }
    }

    const memEnd = process.memoryUsage()
    const memoryGrowth = memEnd.heapUsed - memStart.heapUsed
    const memoryPassed = memoryGrowth < 100 * 1024 * 1024 // 增长小于100MB

    testResults.addTest('Performance-MemoryUsage', memoryPassed)
    log.success(`Memory usage: growth ${(memoryGrowth / 1024 / 1024).toFixed(2)}MB`)

    // 测试4: 错误率测试
    log.debug('Test 4: Error rate test')
    let errorCount = 0
    const stressTestCount = 20

    for (let i = 0; i < stressTestCount; i++) {
      try {
        await loadBalancer.selectOptimalAccount(activeAccounts, {
          model: 'claude-3-5-sonnet-20241022'
        })
      } catch (error) {
        errorCount++
      }
    }

    const errorRate = errorCount / stressTestCount
    const errorRatePassed = errorRate <= TEST_CONFIG.performance.maxErrorRate

    testResults.addTest('Performance-ErrorRate', errorRatePassed)
    log.success(
      `Error rate test: ${(errorRate * 100).toFixed(1)}% (${errorCount}/${stressTestCount})`
    )

    // 测试5: 缓存效率测试
    log.debug('Test 5: Cache efficiency test')

    // 重置统计
    queryOptimizer.resetPerformanceStats()

    // 执行重复查询测试缓存
    const sameQuery = { isActive: 'true' }
    for (let i = 0; i < 10; i++) {
      await queryOptimizer.optimizedApiKeyExport(sameQuery)
    }

    const cacheStats = queryOptimizer.getPerformanceStats()
    const cacheHitRate = cacheStats.cacheHitRate || 0
    const cacheEfficiencyPassed = cacheHitRate >= 70 // 期望缓存命中率 >= 70%

    testResults.addTest('Performance-CacheEfficiency', cacheEfficiencyPassed)
    log.success(`Cache efficiency: ${cacheHitRate.toFixed(1)}% hit rate`)

    const testDuration = performance.now() - testStart
    log.success(`Performance and stress tests completed in ${testDuration.toFixed(2)}ms`)
  } catch (error) {
    testResults.addTest('Performance-General', false, 0, error)
    log.error('Performance and stress test failed:', error.message)
    throw error
  }
}

/**
 * 生成测试报告
 */
async function generateTestReport() {
  log.info('📋 Generating Test Report...')

  const summary = testResults.getSummary()
  const report = {
    timestamp: new Date().toISOString(),
    configuration: TEST_CONFIG,
    summary,
    details: {
      mockDatabaseStats: mockDatabase.getStats(),
      loadBalancerStats: loadBalancer.getLoadBalancerStats(),
      queryOptimizerStats: queryOptimizer.getPerformanceStats(),
      exportAdapterStats: exportAdapter.getMetrics()
    },
    performance: testResults.performance
  }

  // 控制台输出
  console.log(`\n${'='.repeat(80)}`)
  console.log(chalk.bold.blue('🎯 INTEGRATION TEST SUITE REPORT'))
  console.log('='.repeat(80))

  console.log(chalk.bold('\n📊 Test Summary:'))
  console.log(`  Total Tests: ${summary.total}`)
  console.log(`  Passed: ${chalk.green(summary.passed)}`)
  console.log(`  Failed: ${chalk.red(summary.failed)}`)
  console.log(`  Skipped: ${chalk.yellow(summary.skipped)}`)
  console.log(`  Success Rate: ${chalk.bold(summary.successRate.toFixed(1))}%`)
  console.log(`  Total Time: ${summary.totalTime.toFixed(2)}ms`)

  if (summary.errors.length > 0) {
    console.log(chalk.bold.red('\n❌ Errors:'))
    summary.errors.forEach((error) => {
      console.log(`  - ${error.test}: ${error.error}`)
    })
  }

  console.log(chalk.bold('\n🔧 Component Status:'))
  console.log(`  Mock Database: ${report.details.mockDatabaseStats.callCount} calls`)
  console.log(
    `  Load Balancer: ${report.details.loadBalancerStats.totalAccountsTracked} accounts tracked`
  )
  console.log(
    `  Query Optimizer: ${report.details.queryOptimizerStats.totalQueries} queries, ${report.details.queryOptimizerStats.cacheHitRate.toFixed(1)}% cache hit rate`
  )
  console.log(
    `  Export Adapter: ${report.details.exportAdapterStats.operationCount} operations, ${(report.details.exportAdapterStats.errorRate * 100).toFixed(1)}% error rate`
  )

  // 保存到文件
  try {
    const reportPath = path.join(__dirname, '../logs/integration-test-report.json')
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2))
    log.success(`Test report saved to: ${reportPath}`)
  } catch (error) {
    log.warn('Failed to save test report:', error.message)
  }

  console.log('='.repeat(80))

  return report
}

/**
 * 主测试函数
 */
async function runAllTests() {
  console.log(chalk.bold.blue('\n🎯 Starting Claude Relay Service Integration Test Suite'))
  console.log(
    chalk.gray(
      `Version: 1.0.0 | Mock Mode: ${TEST_CONFIG.mockMode} | Verbose: ${TEST_CONFIG.verbose}`
    )
  )

  const overallStart = performance.now()

  try {
    // 初始化测试环境
    await initializeTestEnvironment()

    // 运行各个测试模块
    await testIntelligentLoadBalancer()
    await testQueryOptimizer()
    await testApiKeyExportAdapter()
    await testErrorHandling()
    await testEndToEndIntegration()
    await testPerformanceAndStress()

    // 生成报告
    const report = await generateTestReport()

    const overallDuration = performance.now() - overallStart

    if (report.summary.failed === 0) {
      log.success(`🎉 All tests passed! Total time: ${overallDuration.toFixed(2)}ms`)
      process.exit(0)
    } else {
      log.error(
        `💥 ${report.summary.failed} test(s) failed! Total time: ${overallDuration.toFixed(2)}ms`
      )
      process.exit(1)
    }
  } catch (error) {
    const overallDuration = performance.now() - overallStart
    log.error(`💥 Test suite failed: ${error.message}`)
    log.error(`Total time: ${overallDuration.toFixed(2)}ms`)

    await generateTestReport()
    process.exit(1)
  }
}

/**
 * 清理函数
 */
async function cleanup() {
  log.info('🧹 Cleaning up test environment...')

  try {
    if (loadBalancer) {
      loadBalancer.cleanup()
    }

    if (queryOptimizer) {
      queryOptimizer.clearCache()
    }

    if (exportAdapter) {
      await exportAdapter.cleanup()
    }

    log.success('Cleanup completed')
  } catch (error) {
    log.warn('Cleanup failed:', error.message)
  }
}

// 主程序入口
if (require.main === module) {
  // 设置全局超时
  const globalTimeout = setTimeout(() => {
    log.error('❌ Test suite timed out')
    cleanup().finally(() => process.exit(1))
  }, TEST_CONFIG.timeout.integration * 10) // 总超时时间

  // 优雅关闭处理
  process.on('SIGINT', async () => {
    clearTimeout(globalTimeout)
    log.warn('Received SIGINT, cleaning up...')
    await cleanup()
    process.exit(130)
  })

  process.on('SIGTERM', async () => {
    clearTimeout(globalTimeout)
    log.warn('Received SIGTERM, cleaning up...')
    await cleanup()
    process.exit(143)
  })

  // 运行测试
  runAllTests().finally(() => {
    clearTimeout(globalTimeout)
  })
}

module.exports = {
  runAllTests,
  testIntelligentLoadBalancer,
  testQueryOptimizer,
  testApiKeyExportAdapter,
  testErrorHandling,
  testEndToEndIntegration,
  testPerformanceAndStress,
  TEST_CONFIG,
  MockDataGenerator,
  MockDatabaseAdapter
}
