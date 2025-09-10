#!/usr/bin/env node

/**
 * @fileoverview 智能负载均衡器专项测试
 *
 * 专门测试智能负载均衡算法的核心功能：
 * - 成本计算和账户选择逻辑验证
 * - 不同策略切换和回退机制测试
 * - 权重配置和动态调整验证
 * - 健康检查和故障检测测试
 * - 性能监控和统计分析
 * - 并发负载均衡准确性验证
 *
 * @author Claude Code
 * @version 1.0.0
 */

const { performance } = require('perf_hooks')
const chalk = require('chalk')

// 导入核心模块
const logger = require('../src/utils/logger')
const IntelligentLoadBalancer = require('../src/services/intelligentLoadBalancer')
const CostCalculator = require('../src/utils/costCalculator')

// 测试配置
const TEST_CONFIG = {
  scenarios: {
    basic: true,
    advanced: true,
    stress: true,
    algorithm: true
  },

  performance: {
    maxSelectionTime: 100, // 最大选择时间 100ms
    minThroughput: 50, // 最小吞吐量 50 selections/sec
    maxMemoryGrowth: 50 // 最大内存增长 50MB
  },

  testData: {
    accountCount: 10,
    concurrentSelections: 20,
    stressTestDuration: 10000, // 10秒压力测试
    algorithmIterations: 100
  },

  verbose: process.argv.includes('--verbose') || process.argv.includes('-v'),
  profile: process.argv.includes('--profile') || process.argv.includes('-p')
}

/**
 * 测试结果收集器
 */
class LoadBalancerTestResults {
  constructor() {
    this.tests = []
    this.performance = {
      selections: [],
      totalTime: 0,
      memoryUsage: []
    }
    this.algorithmStats = {
      selections: new Map(),
      scoreDistribution: [],
      weightEffectiveness: []
    }
  }

  addTest(name, passed, duration = 0, details = {}) {
    this.tests.push({
      name,
      passed,
      duration,
      details,
      timestamp: new Date()
    })

    if (TEST_CONFIG.verbose) {
      const status = passed ? chalk.green('✅') : chalk.red('❌')
      const time = duration > 0 ? chalk.gray(`(${duration.toFixed(2)}ms)`) : ''
      console.log(`${status} ${name} ${time}`)
    }
  }

  addPerformanceData(operation, duration, metadata = {}) {
    this.performance.selections.push({
      operation,
      duration,
      metadata,
      timestamp: Date.now()
    })
  }

  addAlgorithmData(accountId, score, breakdown) {
    const count = this.algorithmStats.selections.get(accountId) || 0
    this.algorithmStats.selections.set(accountId, count + 1)

    this.algorithmStats.scoreDistribution.push({
      accountId,
      score,
      breakdown,
      timestamp: Date.now()
    })
  }

  getSummary() {
    const passed = this.tests.filter((t) => t.passed).length
    const total = this.tests.length

    return {
      total,
      passed,
      failed: total - passed,
      successRate: total > 0 ? (passed / total) * 100 : 0,
      totalDuration: this.tests.reduce((sum, t) => sum + t.duration, 0),
      avgSelectionTime:
        this.performance.selections.length > 0
          ? this.performance.selections.reduce((sum, s) => sum + s.duration, 0) /
            this.performance.selections.length
          : 0
    }
  }
}

const testResults = new LoadBalancerTestResults()

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
  },
  error: (msg, ...args) => {
    console.log(chalk.red('❌'), msg, ...args)
    logger.error(msg, ...args)
  },
  warn: (msg, ...args) => {
    console.log(chalk.yellow('⚠️'), msg, ...args)
  },
  debug: (msg, ...args) => {
    if (TEST_CONFIG.verbose) {
      console.log(chalk.gray('🔍'), msg, ...args)
    }
  }
}

/**
 * 模拟数据生成器
 */
class LoadBalancerTestData {
  static generateDiverseAccounts(count = 10) {
    const accounts = []

    for (let i = 1; i <= count; i++) {
      const account = {
        id: `lb-test-account-${i}`,
        name: `Load Balancer Test Account ${i}`,
        isActive: 'true',
        status: 'active',

        // 模拟不同的使用模式
        usageCount: this.generateUsagePattern(i),
        schedulingWeight: this.generateWeight(i),
        errorCount: this.generateErrorPattern(i),

        // 模拟成本差异
        costMultiplier: 0.8 + (i % 3) * 0.1, // 0.8, 0.9, 1.0循环

        // 模拟性能差异
        avgResponseTime: 1000 + (i % 4) * 500, // 1s, 1.5s, 2s, 2.5s循环

        // 模拟代理配置
        proxy:
          i % 3 === 0
            ? {
                type: 'socks5',
                host: '127.0.0.1',
                port: 1080 + i
              }
            : null,

        // 模拟区域
        region: ['us-east', 'us-west', 'eu-west', 'ap-southeast'][i % 4],

        // 模拟账户类型
        tier: ['free', 'pro', 'enterprise'][i % 3]
      }

      accounts.push(account)
    }

    return accounts
  }

  static generateUsagePattern(index) {
    const patterns = [
      () => Math.floor(Math.random() * 10), // 低使用
      () => Math.floor(Math.random() * 50) + 50, // 中等使用
      () => Math.floor(Math.random() * 100) + 100, // 高使用
      () => Math.floor(Math.random() * 20) + 200 // 极高使用
    ]

    return patterns[index % patterns.length]()
  }

  static generateWeight(index) {
    const weights = [2.0, 1.5, 1.0, 0.8, 0.5] // 不同权重等级
    return weights[index % weights.length]
  }

  static generateErrorPattern(index) {
    const errorRates = [0, 1, 3, 5, 10] // 不同错误率
    return errorRates[index % errorRates.length]
  }

  static generateProblemAccount() {
    return {
      id: 'problem-account',
      name: 'Problem Account',
      isActive: 'true',
      status: 'error',
      usageCount: 1000,
      schedulingWeight: 0.1,
      errorCount: 50,
      avgResponseTime: 10000 // 10秒响应时间
    }
  }

  static generateHealthyAccount() {
    return {
      id: 'healthy-account',
      name: 'Healthy Account',
      isActive: 'true',
      status: 'active',
      usageCount: 10,
      schedulingWeight: 2.0,
      errorCount: 0,
      avgResponseTime: 800
    }
  }
}

/**
 * 模拟数据库适配器
 */
class MockLoadBalancerDatabase {
  constructor() {
    this.accounts = LoadBalancerTestData.generateDiverseAccounts(TEST_CONFIG.testData.accountCount)
    this.usageHistory = new Map()
    this.callStats = {
      getAccountUsageInTimeWindow: 0,
      recordAccountUsage: 0
    }
  }

  async getAccountUsageInTimeWindow(accountId, startTime, endTime) {
    this.callStats.getAccountUsageInTimeWindow++

    // 模拟延迟
    await new Promise((resolve) => setTimeout(resolve, 10 + Math.random() * 20))

    const account = this.accounts.find((acc) => acc.id === accountId)
    if (!account) {
      return []
    }

    // 生成模拟使用历史
    const entries = []
    const entryCount = Math.floor(Math.random() * 20) + 5

    for (let i = 0; i < entryCount; i++) {
      const timestamp = startTime + Math.random() * (endTime - startTime)
      entries.push({
        timestamp,
        responseTime: account.avgResponseTime + (Math.random() - 0.5) * 1000,
        cost: (account.costMultiplier || 1) * 0.001 * (1 + Math.random()),
        status: account.errorCount > 5 && Math.random() < 0.1 ? 'error' : 'success'
      })
    }

    return entries
  }

  async recordAccountUsage(accountId, usage) {
    this.callStats.recordAccountUsage++

    // 记录使用历史
    if (!this.usageHistory.has(accountId)) {
      this.usageHistory.set(accountId, [])
    }
    this.usageHistory.get(accountId).push(usage)

    // 模拟快速写入
    await new Promise((resolve) => setTimeout(resolve, 5))
    return true
  }

  getAccount(accountId) {
    return this.accounts.find((acc) => acc.id === accountId)
  }

  updateAccount(accountId, updates) {
    const account = this.getAccount(accountId)
    if (account) {
      Object.assign(account, updates)
    }
  }

  getStats() {
    return {
      accountCount: this.accounts.length,
      ...this.callStats,
      usageHistorySize: this.usageHistory.size
    }
  }

  reset() {
    this.callStats = {
      getAccountUsageInTimeWindow: 0,
      recordAccountUsage: 0
    }
    this.usageHistory.clear()
  }
}

// 全局测试对象
let loadBalancer
let mockDatabase

/**
 * 初始化测试环境
 */
async function initializeTestEnvironment() {
  log.info('🚀 Initializing Load Balancer Test Environment...')

  try {
    mockDatabase = new MockLoadBalancerDatabase()

    // 注入模拟数据库
    const databaseModule = require('../src/models/database')
    const originalMethods = {}

    // 备份原始方法
    originalMethods.getAccountUsageInTimeWindow = databaseModule.getAccountUsageInTimeWindow
    originalMethods.recordAccountUsage = databaseModule.recordAccountUsage

    // 注入模拟方法
    databaseModule.getAccountUsageInTimeWindow =
      mockDatabase.getAccountUsageInTimeWindow.bind(mockDatabase)
    databaseModule.recordAccountUsage = mockDatabase.recordAccountUsage.bind(mockDatabase)

    loadBalancer = new IntelligentLoadBalancer({
      performanceWindow: 60000,
      maxHistorySize: 500,
      healthCheckThreshold: 0.6,
      costOptimizationEnabled: true
    })

    log.success('Test environment initialized successfully')
    log.debug(`Generated ${mockDatabase.accounts.length} test accounts`)

    return { originalMethods }
  } catch (error) {
    log.error('Failed to initialize test environment:', error.message)
    throw error
  }
}

/**
 * 基础负载均衡测试
 */
async function testBasicLoadBalancing() {
  log.info('📊 Testing Basic Load Balancing...')

  try {
    const testStart = performance.now()
    const accounts = mockDatabase.accounts.filter((acc) => acc.isActive === 'true')

    // 测试1: 单账户选择
    log.debug('Test 1: Single account selection')
    const singleResult = await loadBalancer.selectOptimalAccount([accounts[0]], {
      model: 'claude-3-5-sonnet-20241022',
      estimatedTokens: 1000
    })

    const singlePassed =
      singleResult.accountId === accounts[0].id && singleResult.reason === 'only_available'
    testResults.addTest('Basic-SingleAccount', singlePassed)

    // 测试2: 多账户选择
    log.debug('Test 2: Multiple account selection')
    const multipleStart = performance.now()
    const multipleResult = await loadBalancer.selectOptimalAccount(accounts.slice(0, 5), {
      model: 'claude-3-5-sonnet-20241022',
      estimatedTokens: 2000
    })
    const multipleTime = performance.now() - multipleStart

    const multiplePassed =
      !!multipleResult.accountId &&
      multipleResult.reason === 'intelligent_optimization' &&
      !!multipleResult.score
    testResults.addTest('Basic-MultipleAccounts', multiplePassed, multipleTime)
    testResults.addPerformanceData('multipleAccountSelection', multipleTime, {
      accountCount: 5,
      selectedAccount: multipleResult.accountId
    })

    // 测试3: 空账户列表处理
    log.debug('Test 3: Empty account list handling')
    try {
      await loadBalancer.selectOptimalAccount([], {})
      testResults.addTest('Basic-EmptyAccountList', false)
    } catch (error) {
      const errorHandled = error.message.includes('No available accounts')
      testResults.addTest('Basic-EmptyAccountList', errorHandled)
    }

    // 测试4: 无效账户过滤
    log.debug('Test 4: Invalid account filtering')
    const invalidAccounts = [
      { id: 'invalid-1', isActive: 'false', status: 'inactive' },
      { id: 'invalid-2', isActive: 'true', status: 'error' }
    ]

    const healthyAccounts = await loadBalancer.performHealthCheck([
      ...accounts.slice(0, 3),
      ...invalidAccounts
    ])
    const filterPassed = healthyAccounts.length === 3

    testResults.addTest('Basic-AccountFiltering', filterPassed)

    const testDuration = performance.now() - testStart
    log.success(`Basic load balancing tests completed in ${testDuration.toFixed(2)}ms`)
  } catch (error) {
    testResults.addTest('Basic-General', false, 0, { error: error.message })
    log.error('Basic load balancing test failed:', error.message)
    throw error
  }
}

/**
 * 算法准确性测试
 */
async function testAlgorithmAccuracy() {
  log.info('🧮 Testing Algorithm Accuracy...')

  try {
    const testStart = performance.now()
    const accounts = mockDatabase.accounts.filter((acc) => acc.isActive === 'true')

    // 测试1: 成本效率计算
    log.debug('Test 1: Cost efficiency calculation')
    const costScores = []

    for (const account of accounts.slice(0, 3)) {
      const score = loadBalancer.calculateCostEfficiencyScore(
        account,
        'claude-3-5-sonnet-20241022',
        1000
      )
      costScores.push({ accountId: account.id, score, costMultiplier: account.costMultiplier })
    }

    // 成本低的账户应该有更高的分数
    const costRankingCorrect = costScores.every((item, index, array) => {
      if (index === 0) {
        return true
      }
      const prev = array[index - 1]
      return item.costMultiplier >= prev.costMultiplier
        ? item.score <= prev.score
        : item.score >= prev.score
    })

    testResults.addTest('Algorithm-CostEfficiency', costRankingCorrect)

    // 测试2: 权重配置影响
    log.debug('Test 2: Weight configuration impact')

    // 测试成本权重为100%的情况
    const originalWeights = { ...loadBalancer.weights }
    loadBalancer.updateWeights({
      costEfficiency: 1.0,
      responseTime: 0.0,
      errorRate: 0.0,
      availability: 0.0
    })

    const costOnlyResult = await loadBalancer.selectOptimalAccount(accounts.slice(0, 5), {
      model: 'claude-3-5-sonnet-20241022',
      estimatedTokens: 1000
    })

    // 恢复原始权重
    loadBalancer.updateWeights(originalWeights)

    const weightImpactPassed = !!costOnlyResult.accountId
    testResults.addTest('Algorithm-WeightImpact', weightImpactPassed)

    // 测试3: 健康评分准确性
    log.debug('Test 3: Health score accuracy')
    const healthyAccount = LoadBalancerTestData.generateHealthyAccount()
    const problemAccount = LoadBalancerTestData.generateProblemAccount()

    const healthyMetrics = {
      totalRequests: 100,
      errorCount: 0,
      avgResponseTime: 1000,
      avgCostPerRequest: 0.001
    }

    const problemMetrics = {
      totalRequests: 100,
      errorCount: 20,
      avgResponseTime: 8000,
      avgCostPerRequest: 0.01
    }

    const healthyScore = loadBalancer.calculateHealthScore(healthyMetrics)
    const problemScore = loadBalancer.calculateHealthScore(problemMetrics)

    const healthScoreAccurate =
      healthyScore > problemScore && healthyScore > 0.8 && problemScore < 0.5
    testResults.addTest('Algorithm-HealthScore', healthScoreAccurate)

    log.debug(
      `Health scores - Healthy: ${healthyScore.toFixed(3)}, Problem: ${problemScore.toFixed(3)}`
    )

    // 测试4: 负载分布均匀性
    log.debug('Test 4: Load distribution fairness')
    const selections = new Map()
    const selectionCount = 50

    for (let i = 0; i < selectionCount; i++) {
      const result = await loadBalancer.selectOptimalAccount(accounts.slice(0, 5), {
        model: 'claude-3-5-sonnet-20241022',
        estimatedTokens: 1000 + i * 50
      })

      const count = selections.get(result.accountId) || 0
      selections.set(result.accountId, count + 1)

      testResults.addAlgorithmData(result.accountId, result.score, result.breakdown)
    }

    // 计算分布均匀性（使用基尼系数的简化版本）
    const selectionCounts = Array.from(selections.values())
    const totalSelections = selectionCounts.reduce((sum, count) => sum + count, 0)
    const avgSelections = totalSelections / selectionCounts.length
    const variance =
      selectionCounts.reduce((sum, count) => sum + Math.pow(count - avgSelections, 2), 0) /
      selectionCounts.length
    const fairnessScore = 1 - Math.sqrt(variance) / avgSelections // 越接近1越公平

    const distributionFair = fairnessScore > 0.3 // 允许一定程度的不均匀，因为算法是智能的
    testResults.addTest('Algorithm-LoadDistribution', distributionFair)

    log.debug(`Load distribution fairness score: ${fairnessScore.toFixed(3)}`)
    log.debug('Selection distribution:', Object.fromEntries(selections))

    const testDuration = performance.now() - testStart
    log.success(`Algorithm accuracy tests completed in ${testDuration.toFixed(2)}ms`)
  } catch (error) {
    testResults.addTest('Algorithm-General', false, 0, { error: error.message })
    log.error('Algorithm accuracy test failed:', error.message)
    throw error
  }
}

/**
 * 性能和并发测试
 */
async function testPerformanceAndConcurrency() {
  log.info('🚀 Testing Performance and Concurrency...')

  try {
    const testStart = performance.now()
    const accounts = mockDatabase.accounts.filter((acc) => acc.isActive === 'true')

    // 测试1: 单次选择性能
    log.debug('Test 1: Single selection performance')
    const singleSelectionTimes = []

    for (let i = 0; i < 20; i++) {
      const start = performance.now()
      await loadBalancer.selectOptimalAccount(accounts, {
        model: 'claude-3-5-sonnet-20241022',
        estimatedTokens: 1000
      })
      const duration = performance.now() - start
      singleSelectionTimes.push(duration)
      testResults.addPerformanceData('singleSelection', duration)
    }

    const avgSingleTime =
      singleSelectionTimes.reduce((sum, t) => sum + t, 0) / singleSelectionTimes.length
    const maxSingleTime = Math.max(...singleSelectionTimes)

    const singlePerformancePassed = avgSingleTime < TEST_CONFIG.performance.maxSelectionTime
    testResults.addTest('Performance-SingleSelection', singlePerformancePassed, avgSingleTime)

    log.debug(
      `Single selection - Avg: ${avgSingleTime.toFixed(2)}ms, Max: ${maxSingleTime.toFixed(2)}ms`
    )

    // 测试2: 并发选择测试
    log.debug('Test 2: Concurrent selection performance')
    const concurrentCount = TEST_CONFIG.testData.concurrentSelections

    const concurrentStart = performance.now()
    const concurrentPromises = Array(concurrentCount)
      .fill()
      .map(async (_, index) => {
        const start = performance.now()
        const result = await loadBalancer.selectOptimalAccount(accounts, {
          model: 'claude-3-5-sonnet-20241022',
          estimatedTokens: 1000 + index * 100
        })
        const duration = performance.now() - start
        return { result, duration, index }
      })

    const concurrentResults = await Promise.all(concurrentPromises)
    const concurrentDuration = performance.now() - concurrentStart

    const allSuccessful = concurrentResults.every((r) => !!r.result.accountId)
    const throughput = concurrentCount / (concurrentDuration / 1000) // selections per second

    const concurrentPassed = allSuccessful && throughput >= TEST_CONFIG.performance.minThroughput
    testResults.addTest('Performance-Concurrent', concurrentPassed, concurrentDuration)

    log.debug(
      `Concurrent test - ${concurrentCount} selections in ${concurrentDuration.toFixed(2)}ms, throughput: ${throughput.toFixed(1)} sel/sec`
    )

    // 测试3: 内存使用测试
    log.debug('Test 3: Memory usage stability')
    const memStart = process.memoryUsage()

    // 执行大量选择操作
    for (let i = 0; i < 100; i++) {
      await loadBalancer.selectOptimalAccount(accounts, {
        model: 'claude-3-5-sonnet-20241022',
        estimatedTokens: 1000 + i * 10
      })

      if (i % 20 === 0) {
        const currentMem = process.memoryUsage()
        testResults.performance.memoryUsage.push({
          iteration: i,
          heapUsed: currentMem.heapUsed,
          timestamp: Date.now()
        })
      }
    }

    const memEnd = process.memoryUsage()
    const memoryGrowth = (memEnd.heapUsed - memStart.heapUsed) / 1024 / 1024 // MB

    const memoryStable = memoryGrowth < TEST_CONFIG.performance.maxMemoryGrowth
    testResults.addTest('Performance-MemoryStability', memoryStable, 0, {
      memoryGrowthMB: memoryGrowth
    })

    log.debug(`Memory growth: ${memoryGrowth.toFixed(2)}MB`)

    // 测试4: 缓存效率
    log.debug('Test 4: Cache efficiency')
    const cacheTestAccount = accounts[0]

    // 清除缓存
    loadBalancer.accountMetrics.clear()

    // 第一次访问 - 缓存未命中
    const firstAccessStart = performance.now()
    await loadBalancer.getAccountMetrics(cacheTestAccount.id)
    const firstAccessTime = performance.now() - firstAccessStart

    // 第二次访问 - 缓存命中
    const secondAccessStart = performance.now()
    await loadBalancer.getAccountMetrics(cacheTestAccount.id)
    const secondAccessTime = performance.now() - secondAccessStart

    const cacheEffective = secondAccessTime < firstAccessTime * 0.5 // 第二次应该快50%以上
    testResults.addTest('Performance-CacheEfficiency', cacheEffective, 0, {
      firstAccess: firstAccessTime,
      secondAccess: secondAccessTime,
      improvement: `${(((firstAccessTime - secondAccessTime) / firstAccessTime) * 100).toFixed(1)}%`
    })

    const testDuration = performance.now() - testStart
    log.success(`Performance and concurrency tests completed in ${testDuration.toFixed(2)}ms`)
  } catch (error) {
    testResults.addTest('Performance-General', false, 0, { error: error.message })
    log.error('Performance and concurrency test failed:', error.message)
    throw error
  }
}

/**
 * 压力和边界测试
 */
async function testStressAndEdgeCases() {
  log.info('💪 Testing Stress and Edge Cases...')

  try {
    const testStart = performance.now()

    // 测试1: 大量账户处理
    log.debug('Test 1: Large account set handling')
    const largeAccountSet = LoadBalancerTestData.generateDiverseAccounts(50)

    const largeSetStart = performance.now()
    const largeSetResult = await loadBalancer.selectOptimalAccount(largeAccountSet, {
      model: 'claude-3-5-sonnet-20241022',
      estimatedTokens: 2000
    })
    const largeSetTime = performance.now() - largeSetStart

    const largeSetPassed = !!largeSetResult.accountId && largeSetTime < 500 // 500ms内完成
    testResults.addTest('Stress-LargeAccountSet', largeSetPassed, largeSetTime)

    // 测试2: 持续压力测试
    log.debug('Test 2: Sustained stress test')
    const stressTestStart = performance.now()
    const stressResults = []

    const stressEndTime = stressTestStart + 5000 // 5秒压力测试
    let stressIterations = 0

    while (performance.now() < stressEndTime) {
      const start = performance.now()
      const result = await loadBalancer.selectOptimalAccount(largeAccountSet.slice(0, 10), {
        model: 'claude-3-5-sonnet-20241022',
        estimatedTokens: 1000 + stressIterations * 10
      })
      const duration = performance.now() - start

      stressResults.push({ iteration: stressIterations, duration, success: !!result.accountId })
      stressIterations++
    }

    const stressDuration = performance.now() - stressTestStart
    const stressSuccessRate = stressResults.filter((r) => r.success).length / stressResults.length
    const stressAvgTime =
      stressResults.reduce((sum, r) => sum + r.duration, 0) / stressResults.length

    const stressPassed =
      stressSuccessRate > 0.95 && stressAvgTime < TEST_CONFIG.performance.maxSelectionTime * 2
    testResults.addTest('Stress-SustainedLoad', stressPassed, stressDuration, {
      iterations: stressIterations,
      successRate: `${(stressSuccessRate * 100).toFixed(1)}%`,
      avgTime: `${stressAvgTime.toFixed(2)}ms`
    })

    log.debug(
      `Stress test: ${stressIterations} iterations, ${(stressSuccessRate * 100).toFixed(1)}% success, avg ${stressAvgTime.toFixed(2)}ms`
    )

    // 测试3: 极端权重配置
    log.debug('Test 3: Extreme weight configurations')
    const originalWeights = { ...loadBalancer.weights }

    const extremeWeights = [
      { costEfficiency: 1.0, responseTime: 0.0, errorRate: 0.0, availability: 0.0 },
      { costEfficiency: 0.0, responseTime: 1.0, errorRate: 0.0, availability: 0.0 },
      { costEfficiency: 0.25, responseTime: 0.25, errorRate: 0.25, availability: 0.25 }
    ]

    let extremeWeightsPassed = true

    for (const weights of extremeWeights) {
      try {
        loadBalancer.updateWeights(weights)
        const result = await loadBalancer.selectOptimalAccount(mockDatabase.accounts.slice(0, 5), {
          model: 'claude-3-5-sonnet-20241022',
          estimatedTokens: 1000
        })

        if (!result.accountId) {
          extremeWeightsPassed = false
          break
        }
      } catch (error) {
        extremeWeightsPassed = false
        break
      }
    }

    // 恢复原始权重
    loadBalancer.updateWeights(originalWeights)
    testResults.addTest('Stress-ExtremeWeights', extremeWeightsPassed)

    // 测试4: 账户动态变化
    log.debug('Test 4: Dynamic account changes')
    const dynamicAccounts = [...mockDatabase.accounts.slice(0, 5)]

    // 模拟账户状态快速变化
    for (let i = 0; i < 10; i++) {
      // 随机改变账户状态
      const randomAccount = dynamicAccounts[Math.floor(Math.random() * dynamicAccounts.length)]
      const originalStatus = randomAccount.status
      randomAccount.status = Math.random() > 0.5 ? 'active' : 'error'

      const result = await loadBalancer.selectOptimalAccount(dynamicAccounts, {
        model: 'claude-3-5-sonnet-20241022',
        estimatedTokens: 1000
      })

      // 恢复状态
      randomAccount.status = originalStatus

      if (!result.accountId) {
        extremeWeightsPassed = false
        break
      }
    }

    testResults.addTest('Stress-DynamicChanges', extremeWeightsPassed)

    // 测试5: 资源清理测试
    log.debug('Test 5: Resource cleanup effectiveness')
    const beforeCleanup = {
      metricsSize: loadBalancer.accountMetrics.size,
      healthCheckSize: loadBalancer.lastHealthCheck.size
    }

    // 添加一些过期数据
    const oldTimestamp = Date.now() - loadBalancer.performanceWindow * 3
    loadBalancer.accountMetrics.set('expired-1', { lastUpdated: oldTimestamp })
    loadBalancer.lastHealthCheck.set('expired-2', { timestamp: oldTimestamp })

    // 执行清理
    loadBalancer.cleanup()

    const afterCleanup = {
      metricsSize: loadBalancer.accountMetrics.size,
      healthCheckSize: loadBalancer.lastHealthCheck.size
    }

    const cleanupEffective =
      afterCleanup.metricsSize <= beforeCleanup.metricsSize &&
      afterCleanup.healthCheckSize <= beforeCleanup.healthCheckSize

    testResults.addTest('Stress-ResourceCleanup', cleanupEffective, 0, {
      beforeCleanup,
      afterCleanup
    })

    const testDuration = performance.now() - testStart
    log.success(`Stress and edge case tests completed in ${testDuration.toFixed(2)}ms`)
  } catch (error) {
    testResults.addTest('Stress-General', false, 0, { error: error.message })
    log.error('Stress and edge case test failed:', error.message)
    throw error
  }
}

/**
 * 生成负载均衡器测试报告
 */
async function generateLoadBalancerReport() {
  log.info('📋 Generating Load Balancer Test Report...')

  const summary = testResults.getSummary()
  const stats = loadBalancer.getLoadBalancerStats()
  const dbStats = mockDatabase.getStats()

  const report = {
    timestamp: new Date().toISOString(),
    testConfig: TEST_CONFIG,
    summary,

    performance: {
      avgSelectionTime: summary.avgSelectionTime,
      totalSelections: testResults.performance.selections.length,
      selectionTimeDistribution: testResults.performance.selections.map((s) => s.duration),
      memoryUsage: testResults.performance.memoryUsage
    },

    algorithm: {
      selectionDistribution: Object.fromEntries(testResults.algorithmStats.selections),
      scoreStats: {
        count: testResults.algorithmStats.scoreDistribution.length,
        avgScore:
          testResults.algorithmStats.scoreDistribution.reduce((sum, s) => sum + s.score, 0) /
          (testResults.algorithmStats.scoreDistribution.length || 1),
        scoreRange: {
          min: Math.min(...testResults.algorithmStats.scoreDistribution.map((s) => s.score)),
          max: Math.max(...testResults.algorithmStats.scoreDistribution.map((s) => s.score))
        }
      }
    },

    loadBalancerStats: stats,
    databaseStats: dbStats,
    testDetails: testResults.tests
  }

  // 控制台输出
  console.log(`\n${'='.repeat(80)}`)
  console.log(chalk.bold.blue('🧠 INTELLIGENT LOAD BALANCER TEST REPORT'))
  console.log('='.repeat(80))

  console.log(chalk.bold('\n📊 Test Summary:'))
  console.log(`  Total Tests: ${summary.total}`)
  console.log(`  Passed: ${chalk.green(summary.passed)}`)
  console.log(`  Failed: ${chalk.red(summary.failed)}`)
  console.log(`  Success Rate: ${chalk.bold(summary.successRate.toFixed(1))}%`)
  console.log(`  Total Duration: ${summary.totalDuration.toFixed(2)}ms`)

  console.log(chalk.bold('\n⚡ Performance Metrics:'))
  console.log(`  Average Selection Time: ${summary.avgSelectionTime.toFixed(2)}ms`)
  console.log(`  Total Selections: ${report.performance.totalSelections}`)
  console.log(
    `  Selection Time Range: ${Math.min(...report.performance.selectionTimeDistribution).toFixed(2)}ms - ${Math.max(...report.performance.selectionTimeDistribution).toFixed(2)}ms`
  )

  console.log(chalk.bold('\n🧮 Algorithm Analysis:'))
  console.log(
    `  Score Range: ${report.algorithm.scoreStats.scoreRange.min.toFixed(3)} - ${report.algorithm.scoreStats.scoreRange.max.toFixed(3)}`
  )
  console.log(`  Average Score: ${report.algorithm.scoreStats.avgScore.toFixed(3)}`)
  console.log(`  Selection Distribution:`)

  Object.entries(report.algorithm.selectionDistribution)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .forEach(([accountId, count]) => {
      console.log(`    ${accountId}: ${count} selections`)
    })

  console.log(chalk.bold('\n🔧 Component Status:'))
  console.log(`  Load Balancer: ${stats.totalAccountsTracked} accounts tracked`)
  console.log(`  Database: ${dbStats.callCount} total calls`)
  console.log(`  Cache Efficiency: ${stats.cacheStats?.accountMetrics || 0} cached metrics`)

  if (summary.failed > 0) {
    console.log(chalk.bold.red('\n❌ Failed Tests:'))
    testResults.tests
      .filter((t) => !t.passed)
      .forEach((test) => {
        console.log(`  - ${test.name}: ${test.details?.error || 'Unknown error'}`)
      })
  }

  console.log('='.repeat(80))

  return report
}

/**
 * 主测试函数
 */
async function runLoadBalancerTests() {
  console.log(chalk.bold.blue('\n🧠 Starting Intelligent Load Balancer Tests'))
  console.log(chalk.gray(`Profile Mode: ${TEST_CONFIG.profile} | Verbose: ${TEST_CONFIG.verbose}`))

  const overallStart = performance.now()

  try {
    // 初始化
    const { originalMethods } = await initializeTestEnvironment()

    // 运行测试套件
    if (TEST_CONFIG.scenarios.basic) {
      await testBasicLoadBalancing()
    }

    if (TEST_CONFIG.scenarios.algorithm) {
      await testAlgorithmAccuracy()
    }

    if (TEST_CONFIG.scenarios.advanced) {
      await testPerformanceAndConcurrency()
    }

    if (TEST_CONFIG.scenarios.stress) {
      await testStressAndEdgeCases()
    }

    // 生成报告
    const report = await generateLoadBalancerReport()

    const overallDuration = performance.now() - overallStart

    if (report.summary.failed === 0) {
      log.success(`🎉 All load balancer tests passed! Total time: ${overallDuration.toFixed(2)}ms`)
      process.exit(0)
    } else {
      log.error(
        `💥 ${report.summary.failed} test(s) failed! Total time: ${overallDuration.toFixed(2)}ms`
      )
      process.exit(1)
    }
  } catch (error) {
    const overallDuration = performance.now() - overallStart
    log.error(`💥 Load balancer test suite failed: ${error.message}`)
    log.error(`Total time: ${overallDuration.toFixed(2)}ms`)

    await generateLoadBalancerReport()
    process.exit(1)
  }
}

/**
 * 清理函数
 */
async function cleanup() {
  log.info('🧹 Cleaning up load balancer test environment...')

  try {
    if (loadBalancer) {
      loadBalancer.cleanup()
    }

    if (mockDatabase) {
      mockDatabase.reset()
    }

    log.success('Load balancer test cleanup completed')
  } catch (error) {
    log.warn('Load balancer test cleanup failed:', error.message)
  }
}

// 主程序入口
if (require.main === module) {
  // 设置超时
  const globalTimeout = setTimeout(() => {
    log.error('❌ Load balancer tests timed out')
    cleanup().finally(() => process.exit(1))
  }, 60000) // 60秒超时

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
  runLoadBalancerTests().finally(() => {
    clearTimeout(globalTimeout)
  })
}

module.exports = {
  runLoadBalancerTests,
  testBasicLoadBalancing,
  testAlgorithmAccuracy,
  testPerformanceAndConcurrency,
  testStressAndEdgeCases,
  LoadBalancerTestData,
  MockLoadBalancerDatabase,
  TEST_CONFIG
}
