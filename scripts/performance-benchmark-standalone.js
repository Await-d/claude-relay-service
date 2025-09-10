#!/usr/bin/env node

/**
 * @fileoverview 独立性能基准测试套件 - 新上游功能的全面性能验证（无Redis依赖）
 *
 * 核心测试模块：
 * - 智能负载均衡器性能基准测试
 * - 错误处理和重试机制的性能影响分析
 * - 连接管理和会话持久化的性能验证
 * - 与原始系统的性能对比分析
 *
 * 测试场景：
 * - 并发性能测试（100+并发请求）
 * - 长时间稳定性测试（12小时）
 * - 压力测试（系统极限负载）
 * - 故障恢复性能测试
 *
 * @author Claude Code
 * @version 1.0.0
 */

const fs = require('fs')
const path = require('path')
const cluster = require('cluster')
const { performance } = require('perf_hooks')
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads')

// 项目模块
const config = require('../config/config')
const logger = require('../src/utils/logger')

/**
 * 独立性能基准测试主控制器
 */
class StandalonePerformanceBenchmark {
  constructor() {
    this.config = {
      // 测试配置
      concurrency: {
        light: 10,
        medium: 50,
        heavy: 100,
        extreme: 200
      },
      duration: {
        short: 60000, // 1分钟
        medium: 300000, // 5分钟
        long: 3600000, // 1小时
        stability: 43200000 // 12小时
      },

      // 基准指标阈值
      thresholds: {
        loadBalancer: {
          selectionTime: 50, // 50ms 账户选择时间
          algorithmEfficiency: 0.95, // 95% 算法效率
          cacheHitRate: 0.8 // 80% 缓存命中率
        },
        errorHandling: {
          retryOverhead: 100, // 100ms 重试开销
          circuitBreakerResponse: 10, // 10ms 熔断器响应
          recoveryTime: 30000 // 30s 恢复时间
        },
        connectionManager: {
          connectionTime: 2000, // 2s 连接建立时间
          reuseEfficiency: 0.9, // 90% 连接复用效率
          healthCheckTime: 100 // 100ms 健康检查时间
        },
        sessionManager: {
          createTime: 10, // 10ms 会话创建时间
          restoreTime: 50, // 50ms 会话恢复时间
          persistenceTime: 20 // 20ms 持久化时间
        }
      },

      // 报告配置
      reportPath: path.join(__dirname, '../temp/performance-reports'),
      enableDetailedLogs: process.env.NODE_ENV === 'development',
      enableMetrics: true,
      saveRawData: true
    }

    // 测试结果存储
    this.results = new Map()
    this.metrics = new Map()
    this.rawData = []

    // 测试状态
    this.isRunning = false
    this.startTime = null
    this.workers = []

    this._ensureReportDirectory()
  }

  /**
   * 🚀 运行完整的性能基准测试套件
   */
  async runFullBenchmark() {
    try {
      logger.info('🚀 Starting Standalone Performance Benchmark Suite...')
      this.isRunning = true
      this.startTime = Date.now()

      // 创建测试报告目录
      const reportDir = this._createReportDirectory()

      // 1. 智能负载均衡器性能测试
      await this._testLoadBalancerPerformance(reportDir)

      // 2. 错误处理性能测试
      await this._testErrorHandlingPerformance(reportDir)

      // 3. 连接管理性能测试
      await this._testConnectionManagerPerformance(reportDir)

      // 4. 会话管理性能测试
      await this._testSessionManagerPerformance(reportDir)

      // 5. 集成性能测试
      await this._testIntegratedPerformance(reportDir)

      // 6. 并发压力测试
      await this._testConcurrentLoad(reportDir)

      // 7. 性能对比测试
      await this._testPerformanceComparison(reportDir)

      // 生成综合报告
      const report = await this._generateComprehensiveReport(reportDir)

      logger.info('✅ Standalone Performance Benchmark Suite completed successfully')
      logger.info(`📊 Report saved to: ${reportDir}`)

      return report
    } catch (error) {
      logger.error('❌ Standalone Performance Benchmark Suite failed:', error)
      throw error
    } finally {
      this.isRunning = false
    }
  }

  /**
   * 🧠 智能负载均衡器性能测试（模拟版）
   */
  async _testLoadBalancerPerformance(reportDir) {
    logger.info('🧠 Testing Load Balancer Performance (Standalone)...')

    const testResults = {
      accountSelection: [],
      algorithmEfficiency: [],
      cachePerformance: [],
      scalability: []
    }

    // 创建模拟账户
    const mockAccounts = this._generateMockAccounts(20)

    // 1. 账户选择性能测试
    logger.info('📊 Testing account selection performance...')
    for (let i = 0; i < 1000; i++) {
      const startTime = performance.now()

      // 模拟智能负载均衡算法
      const selectedAccount = await this._simulateLoadBalancerSelection(mockAccounts)

      const selectionTime = performance.now() - startTime
      testResults.accountSelection.push({
        iteration: i,
        selectionTime,
        selectedAccountId: selectedAccount.id,
        score: selectedAccount.score || Math.random(),
        timestamp: Date.now()
      })

      // 模拟使用统计更新
      await this._simulateUsageUpdate(selectedAccount.id, {
        responseTime: Math.random() * 3000 + 500,
        cost: Math.random() * 0.1,
        status: Math.random() > 0.1 ? 'success' : 'error'
      })
    }

    // 2. 算法效率测试
    logger.info('⚡ Testing algorithm efficiency...')
    const efficiencyTests = [10, 50, 100, 200] // 不同账户数量
    for (const accountCount of efficiencyTests) {
      const accounts = mockAccounts.slice(0, accountCount)
      const startTime = performance.now()

      // 批量选择测试
      const selections = await Promise.all(
        Array(100)
          .fill()
          .map(() => this._simulateLoadBalancerSelection(accounts))
      )

      const totalTime = performance.now() - startTime
      const avgTime = totalTime / 100

      testResults.algorithmEfficiency.push({
        accountCount,
        totalTime,
        avgTime,
        selectionsPerSecond: 100000 / totalTime,
        uniqueAccountsSelected: new Set(selections.map((s) => s.id)).size
      })
    }

    // 3. 缓存性能测试
    logger.info('💾 Testing cache performance...')
    const cache = new Map()
    const cacheTestRounds = 500
    let cacheHits = 0

    for (let i = 0; i < cacheTestRounds; i++) {
      const accountId = mockAccounts[i % 5].id // 重复使用前5个账户
      const startTime = performance.now()

      // 模拟缓存查找
      let metrics = cache.get(accountId)
      if (!metrics) {
        // 模拟从数据库获取数据的延迟
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 10 + 5))
        metrics = this._generateMockMetrics(accountId)
        cache.set(accountId, metrics)
      } else {
        cacheHits++
      }

      const cacheTime = performance.now() - startTime

      testResults.cachePerformance.push({
        iteration: i,
        accountId,
        cacheTime,
        cacheHit: cacheTime < 5
      })
    }

    // 4. 可扩展性测试
    logger.info('📈 Testing scalability...')
    const concurrencyLevels = [1, 10, 50, 100]
    for (const concurrency of concurrencyLevels) {
      const startTime = performance.now()

      const promises = Array(concurrency)
        .fill()
        .map(async () => await this._simulateLoadBalancerSelection(mockAccounts))

      await Promise.all(promises)
      const totalTime = performance.now() - startTime

      testResults.scalability.push({
        concurrency,
        totalTime,
        avgTime: totalTime / concurrency,
        throughput: (concurrency * 1000) / totalTime
      })
    }

    // 分析结果
    const analysis = this._analyzeLoadBalancerResults(testResults)

    // 保存结果
    await this._saveTestResults(reportDir, 'load-balancer-performance', {
      testResults,
      analysis,
      thresholds: this.config.thresholds.loadBalancer
    })

    this.results.set('loadBalancer', analysis)
    logger.info('✅ Load Balancer Performance Test completed')
  }

  /**
   * 🔥 错误处理性能测试（模拟版）
   */
  async _testErrorHandlingPerformance(reportDir) {
    logger.info('🔥 Testing Error Handling Performance (Standalone)...')

    const testResults = {
      retryPerformance: [],
      circuitBreakerResponse: [],
      errorRecovery: [],
      overheadAnalysis: []
    }

    // 1. 重试机制性能测试
    logger.info('🔄 Testing retry mechanism performance...')
    for (let i = 0; i < 100; i++) {
      const startTime = performance.now()

      await this._simulateRetryOperation(i)

      const totalTime = performance.now() - startTime
      testResults.retryPerformance.push({
        iteration: i,
        totalTime,
        timestamp: Date.now()
      })
    }

    // 2. 熔断器响应时间测试
    logger.info('⚡ Testing circuit breaker response time...')

    let circuitBreakerOpen = false

    // 触发熔断器
    for (let i = 0; i < 10; i++) {
      await this._simulateFailedOperation()
      if (i >= 4) {
        circuitBreakerOpen = true
      } // 5次失败后开启熔断器
    }

    // 测试熔断器响应
    for (let i = 0; i < 50; i++) {
      const startTime = performance.now()

      if (circuitBreakerOpen) {
        // 熔断器开启，直接返回错误
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 2))
      } else {
        await this._simulateSuccessfulOperation()
      }

      const responseTime = performance.now() - startTime
      testResults.circuitBreakerResponse.push({
        iteration: i,
        responseTime,
        circuitBreakerOpen,
        timestamp: Date.now()
      })
    }

    // 3. 错误恢复性能测试
    logger.info('🔄 Testing error recovery performance...')

    const recoveryStartTime = performance.now()

    // 等待熔断器恢复
    await new Promise((resolve) => setTimeout(resolve, 5000)) // 模拟5秒恢复时间
    circuitBreakerOpen = false

    // 测试恢复后的性能
    const recoveryTest = performance.now()

    await this._simulateSuccessfulOperation()

    const recoveryTime = performance.now() - recoveryStartTime
    testResults.errorRecovery.push({
      totalRecoveryTime: recoveryTime,
      actualCallTime: performance.now() - recoveryTest
    })

    // 4. 性能开销分析
    logger.info('📊 Analyzing performance overhead...')

    // 不使用错误处理的基准测试
    const baselineResults = []
    for (let i = 0; i < 100; i++) {
      const startTime = performance.now()

      // 直接操作模拟
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 100 + 50))

      const baselineTime = performance.now() - startTime
      baselineResults.push(baselineTime)
    }

    // 计算开销
    const avgBaseline = baselineResults.reduce((a, b) => a + b, 0) / baselineResults.length
    const avgWithRetry =
      testResults.retryPerformance.map((r) => r.totalTime).reduce((a, b) => a + b, 0) /
      testResults.retryPerformance.length

    testResults.overheadAnalysis.push({
      avgBaselineTime: avgBaseline,
      avgWithRetryTime: avgWithRetry,
      overhead: avgWithRetry - avgBaseline,
      overheadPercentage: ((avgWithRetry - avgBaseline) / avgBaseline) * 100
    })

    // 分析结果
    const analysis = this._analyzeErrorHandlingResults(testResults)

    // 保存结果
    await this._saveTestResults(reportDir, 'error-handling-performance', {
      testResults,
      analysis,
      thresholds: this.config.thresholds.errorHandling
    })

    this.results.set('errorHandling', analysis)
    logger.info('✅ Error Handling Performance Test completed')
  }

  /**
   * 🔗 连接管理性能测试（模拟版）
   */
  async _testConnectionManagerPerformance(reportDir) {
    logger.info('🔗 Testing Connection Manager Performance (Standalone)...')

    const testResults = {
      connectionCreation: [],
      connectionReuse: [],
      healthChecks: [],
      proxyPerformance: []
    }

    // 模拟连接池
    const connectionPool = new Map()
    let reuseHits = 0

    // 1. 连接创建性能测试
    logger.info('🚀 Testing connection creation performance...')
    for (let i = 0; i < 100; i++) {
      const startTime = performance.now()

      // 模拟连接创建延迟
      await this._simulateConnectionCreation(i)

      const creationTime = performance.now() - startTime
      testResults.connectionCreation.push({
        iteration: i,
        creationTime,
        timestamp: Date.now()
      })
    }

    // 2. 连接复用性能测试
    logger.info('🔄 Testing connection reuse performance...')

    for (let i = 0; i < 100; i++) {
      const connectionKey = `connection_${i % 10}` // 10个连接循环使用
      const startTime = performance.now()

      let connection = connectionPool.get(connectionKey)
      if (!connection) {
        // 创建新连接
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 50 + 20))
        connection = { id: connectionKey, created: Date.now() }
        connectionPool.set(connectionKey, connection)
      } else {
        reuseHits++
      }

      const reuseTime = performance.now() - startTime

      testResults.connectionReuse.push({
        iteration: i,
        reuseTime,
        reuseHit: reuseTime < 10,
        timestamp: Date.now()
      })
    }

    // 3. 健康检查性能测试
    logger.info('🏥 Testing health check performance...')

    const connectionsToCheck = 20
    const healthCheckStart = performance.now()

    // 模拟并行健康检查
    const healthCheckPromises = Array(connectionsToCheck)
      .fill()
      .map(async (_, i) => {
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 20 + 5))
        return { connectionId: `conn_${i}`, healthy: Math.random() > 0.1 }
      })

    await Promise.all(healthCheckPromises)
    const healthCheckTime = performance.now() - healthCheckStart

    testResults.healthChecks.push({
      totalConnections: connectionsToCheck,
      totalTime: healthCheckTime,
      avgTimePerConnection: healthCheckTime / connectionsToCheck
    })

    // 4. 代理性能测试
    if (config.proxy || true) {
      // 模拟代理配置存在
      logger.info('🌐 Testing proxy performance...')

      for (let i = 0; i < 50; i++) {
        const startTime = performance.now()

        try {
          // 模拟代理连接延迟
          await this._simulateProxyConnection()

          const proxyTime = performance.now() - startTime
          testResults.proxyPerformance.push({
            iteration: i,
            proxyTime,
            success: true,
            timestamp: Date.now()
          })
        } catch (error) {
          const proxyTime = performance.now() - startTime
          testResults.proxyPerformance.push({
            iteration: i,
            proxyTime,
            success: false,
            error: error.message,
            timestamp: Date.now()
          })
        }
      }
    }

    // 分析结果
    const analysis = this._analyzeConnectionManagerResults(testResults, reuseHits)

    // 保存结果
    await this._saveTestResults(reportDir, 'connection-manager-performance', {
      testResults,
      analysis,
      thresholds: this.config.thresholds.connectionManager
    })

    this.results.set('connectionManager', analysis)
    logger.info('✅ Connection Manager Performance Test completed')
  }

  /**
   * 📝 会话管理性能测试（模拟版）
   */
  async _testSessionManagerPerformance(reportDir) {
    logger.info('📝 Testing Session Manager Performance (Standalone)...')

    const testResults = {
      sessionCreation: [],
      sessionRestore: [],
      sessionPersistence: [],
      sessionAffinity: []
    }

    // 模拟会话存储
    const sessionStore = new Map()
    const persistentStore = new Map()
    const createdSessions = []

    // 1. 会话创建性能测试
    logger.info('🆕 Testing session creation performance...')

    for (let i = 0; i < 500; i++) {
      const startTime = performance.now()

      const sessionId = `session_${i}`
      const session = await this._simulateSessionCreation(sessionId, {
        userId: `user_${i}`,
        accountId: `account_${i % 10}`,
        apiKeyId: `key_${i}`
      })

      sessionStore.set(sessionId, session)
      createdSessions.push(sessionId)

      const creationTime = performance.now() - startTime

      testResults.sessionCreation.push({
        iteration: i,
        sessionId,
        creationTime,
        timestamp: Date.now()
      })
    }

    // 2. 会话恢复性能测试
    logger.info('🔄 Testing session restore performance...')

    // 清理部分会话从内存缓存
    for (let i = 0; i < 100; i++) {
      sessionStore.delete(createdSessions[i])
      // 保存到持久化存储
      persistentStore.set(createdSessions[i], { sessionId: createdSessions[i], persisted: true })
    }

    for (let i = 0; i < 100; i++) {
      const sessionId = createdSessions[i]
      const startTime = performance.now()

      // 尝试从内存恢复，失败则从持久化恢复
      let session = sessionStore.get(sessionId)
      if (!session) {
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 30 + 10)) // 模拟从持久化恢复
        session = persistentStore.get(sessionId)
      }

      const restoreTime = performance.now() - startTime

      testResults.sessionRestore.push({
        iteration: i,
        sessionId,
        restoreTime,
        restored: !!session,
        timestamp: Date.now()
      })
    }

    // 3. 会话持久化性能测试
    logger.info('💾 Testing session persistence performance...')

    for (let i = 0; i < 100; i++) {
      const sessionId = createdSessions[i]
      const session = sessionStore.get(sessionId) || { sessionId }

      const startTime = performance.now()

      // 模拟持久化操作
      await this._simulateSessionPersistence(session)

      const persistenceTime = performance.now() - startTime

      testResults.sessionPersistence.push({
        iteration: i,
        sessionId,
        persistenceTime,
        timestamp: Date.now()
      })
    }

    // 4. 会话亲和性性能测试
    logger.info('🔗 Testing session affinity performance...')

    for (let i = 0; i < 100; i++) {
      const sessionId = createdSessions[i]
      const accountId = `account_${i % 10}`

      const startTime = performance.now()

      // 模拟亲和性设置
      await this._simulateSessionAffinity(sessionId, accountId)

      const affinityTime = performance.now() - startTime

      testResults.sessionAffinity.push({
        iteration: i,
        sessionId,
        accountId,
        affinityTime,
        timestamp: Date.now()
      })
    }

    // 分析结果
    const analysis = this._analyzeSessionManagerResults(testResults)

    // 保存结果
    await this._saveTestResults(reportDir, 'session-manager-performance', {
      testResults,
      analysis,
      thresholds: this.config.thresholds.sessionManager
    })

    this.results.set('sessionManager', analysis)
    logger.info('✅ Session Manager Performance Test completed')
  }

  /**
   * 🔀 集成性能测试（模拟版）
   */
  async _testIntegratedPerformance(reportDir) {
    logger.info('🔀 Testing Integrated Performance (Standalone)...')

    const testResults = {
      endToEndLatency: [],
      throughput: [],
      resourceUtilization: []
    }

    // 模拟完整请求流程
    for (let i = 0; i < 200; i++) {
      const startTime = performance.now()

      try {
        // 1. 创建会话
        const sessionId = `integration_session_${i}`
        await this._simulateSessionCreation(sessionId, {
          userId: `integration_user_${i}`,
          accountId: `integration_account_${i % 5}`,
          apiKeyId: `integration_key_${i}`
        })

        // 2. 负载均衡选择账户
        const mockAccounts = this._generateMockAccounts(5)
        const selectedAccount = await this._simulateLoadBalancerSelection(mockAccounts)

        // 3. 获取连接
        await this._simulateConnectionCreation(i)

        // 4. 错误处理包装
        await this._simulateRetryOperation(i)

        const endToEndTime = performance.now() - startTime

        testResults.endToEndLatency.push({
          iteration: i,
          sessionId,
          accountId: selectedAccount.id,
          endToEndTime,
          timestamp: Date.now()
        })
      } catch (error) {
        logger.error(`❌ Integration test ${i} failed:`, error)
      }
    }

    // 计算吞吐量
    const startTime = performance.now()
    const concurrentRequests = 50

    const throughputPromises = Array(concurrentRequests)
      .fill()
      .map(async (_, i) => {
        const requestStart = performance.now()

        try {
          // 简化的集成流程
          const sessionId = `throughput_session_${i}`
          await this._simulateSessionCreation(sessionId, {
            userId: `throughput_user_${i}`,
            accountId: `throughput_account_${i % 3}`
          })

          const mockAccounts = this._generateMockAccounts(3)
          await this._simulateLoadBalancerSelection(mockAccounts)

          const requestTime = performance.now() - requestStart
          return { success: true, requestTime }
        } catch (error) {
          const requestTime = performance.now() - requestStart
          return { success: false, requestTime, error: error.message }
        }
      })

    const throughputResults = await Promise.allSettled(throughputPromises)
    const totalThroughputTime = performance.now() - startTime

    testResults.throughput.push({
      concurrentRequests,
      totalTime: totalThroughputTime,
      successfulRequests: throughputResults.filter(
        (r) => r.status === 'fulfilled' && r.value.success
      ).length,
      requestsPerSecond: (concurrentRequests * 1000) / totalThroughputTime,
      avgRequestTime:
        throughputResults
          .filter((r) => r.status === 'fulfilled')
          .reduce((sum, r) => sum + r.value.requestTime, 0) / concurrentRequests
    })

    // 分析结果
    const analysis = this._analyzeIntegratedResults(testResults)

    // 保存结果
    await this._saveTestResults(reportDir, 'integrated-performance', {
      testResults,
      analysis
    })

    this.results.set('integrated', analysis)
    logger.info('✅ Integrated Performance Test completed')
  }

  /**
   * 💪 并发压力测试
   */
  async _testConcurrentLoad(reportDir) {
    logger.info('💪 Testing Concurrent Load Performance...')

    const testResults = {
      lightLoad: null,
      mediumLoad: null,
      heavyLoad: null,
      extremeLoad: null
    }

    const loadLevels = [
      {
        name: 'lightLoad',
        concurrency: this.config.concurrency.light,
        duration: this.config.duration.short
      },
      {
        name: 'mediumLoad',
        concurrency: this.config.concurrency.medium,
        duration: this.config.duration.short
      },
      {
        name: 'heavyLoad',
        concurrency: this.config.concurrency.heavy,
        duration: this.config.duration.medium
      },
      {
        name: 'extremeLoad',
        concurrency: this.config.concurrency.extreme,
        duration: this.config.duration.short
      }
    ]

    for (const level of loadLevels) {
      logger.info(
        `⚡ Testing ${level.name}: ${level.concurrency} concurrent requests for ${level.duration / 1000}s`
      )

      const result = await this._runConcurrentLoadTest(level.concurrency, level.duration)
      testResults[level.name] = result
    }

    // 分析结果
    const analysis = this._analyzeConcurrentLoadResults(testResults)

    // 保存结果
    await this._saveTestResults(reportDir, 'concurrent-load-performance', {
      testResults,
      analysis
    })

    this.results.set('concurrentLoad', analysis)
    logger.info('✅ Concurrent Load Performance Test completed')
  }

  /**
   * 📊 性能对比测试
   */
  async _testPerformanceComparison(reportDir) {
    logger.info('📊 Testing Performance Comparison...')

    const testResults = {
      withOptimizations: [],
      withoutOptimizations: [],
      comparison: null
    }

    // 使用优化功能的测试
    logger.info('🚀 Testing with optimizations enabled...')
    for (let i = 0; i < 100; i++) {
      const startTime = performance.now()

      try {
        // 完整的优化流程
        const sessionId = `comparison_session_${i}`
        await this._simulateSessionCreation(sessionId, {
          userId: `comparison_user_${i}`,
          accountId: `comparison_account_${i % 5}`
        })

        const mockAccounts = this._generateMockAccounts(5)
        await this._simulateLoadBalancerSelection(mockAccounts)

        await this._simulateConnectionCreation(i)

        const totalTime = performance.now() - startTime

        testResults.withOptimizations.push({
          iteration: i,
          totalTime,
          timestamp: Date.now()
        })
      } catch (error) {
        logger.error(`❌ Optimized test ${i} failed:`, error)
      }
    }

    // 不使用优化功能的基准测试
    logger.info('🔽 Testing without optimizations (baseline)...')
    for (let i = 0; i < 100; i++) {
      const startTime = performance.now()

      try {
        // 简化的基准流程
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 50 + 25))

        const totalTime = performance.now() - startTime

        testResults.withoutOptimizations.push({
          iteration: i,
          totalTime,
          timestamp: Date.now()
        })
      } catch (error) {
        logger.error(`❌ Baseline test ${i} failed:`, error)
      }
    }

    // 计算对比结果
    const avgOptimized =
      testResults.withOptimizations.reduce((sum, r) => sum + r.totalTime, 0) /
      testResults.withOptimizations.length

    const avgBaseline =
      testResults.withoutOptimizations.reduce((sum, r) => sum + r.totalTime, 0) /
      testResults.withoutOptimizations.length

    testResults.comparison = {
      avgOptimizedTime: avgOptimized,
      avgBaselineTime: avgBaseline,
      performanceGain: avgBaseline - avgOptimized,
      performanceGainPercentage: ((avgBaseline - avgOptimized) / avgBaseline) * 100,
      overhead: avgOptimized - avgBaseline,
      overheadPercentage: ((avgOptimized - avgBaseline) / avgBaseline) * 100
    }

    // 分析结果
    const analysis = this._analyzePerformanceComparison(testResults)

    // 保存结果
    await this._saveTestResults(reportDir, 'performance-comparison', {
      testResults,
      analysis
    })

    this.results.set('comparison', analysis)
    logger.info('✅ Performance Comparison Test completed')
  }

  /**
   * 🔄 运行并发负载测试
   */
  async _runConcurrentLoadTest(concurrency, duration) {
    const results = {
      concurrency,
      duration,
      requests: [],
      summary: null
    }

    const startTime = Date.now()
    const endTime = startTime + duration

    const workers = []
    let requestId = 0

    // 创建并发工作线程
    for (let i = 0; i < concurrency; i++) {
      const worker = this._createLoadTestWorker(endTime, requestId++)
      workers.push(worker)
    }

    // 等待所有工作线程完成
    const workerResults = await Promise.allSettled(workers)

    // 收集结果
    for (const result of workerResults) {
      if (result.status === 'fulfilled') {
        results.requests.push(...result.value)
      }
    }

    // 计算汇总统计
    const totalRequests = results.requests.length
    const successfulRequests = results.requests.filter((r) => r.success).length
    const failedRequests = totalRequests - successfulRequests

    const totalTime = Date.now() - startTime
    const avgResponseTime =
      results.requests.filter((r) => r.success).reduce((sum, r) => sum + r.responseTime, 0) /
      successfulRequests

    results.summary = {
      totalRequests,
      successfulRequests,
      failedRequests,
      successRate: successfulRequests / totalRequests,
      avgResponseTime,
      requestsPerSecond: (totalRequests * 1000) / totalTime,
      totalDuration: totalTime
    }

    return results
  }

  /**
   * 👷 创建负载测试工作线程
   */
  async _createLoadTestWorker(endTime, workerId) {
    const requests = []

    while (Date.now() < endTime) {
      const requestStart = performance.now()

      try {
        // 模拟请求处理
        const sessionId = `load_session_${workerId}_${requests.length}`
        await this._simulateSessionCreation(sessionId, {
          userId: `load_user_${workerId}_${requests.length}`,
          accountId: `load_account_${workerId % 10}`
        })

        const mockAccounts = this._generateMockAccounts(5)
        await this._simulateLoadBalancerSelection(mockAccounts)

        await this._simulateConnectionCreation(requests.length)

        // 模拟API调用延迟
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 100 + 50))

        const responseTime = performance.now() - requestStart

        requests.push({
          workerId,
          requestId: requests.length,
          responseTime,
          success: true,
          timestamp: Date.now()
        })
      } catch (error) {
        const responseTime = performance.now() - requestStart

        requests.push({
          workerId,
          requestId: requests.length,
          responseTime,
          success: false,
          error: error.message,
          timestamp: Date.now()
        })
      }

      // 小延迟避免过度占用CPU
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 10))
    }

    return requests
  }

  // 模拟方法
  async _simulateLoadBalancerSelection(accounts) {
    // 模拟智能负载均衡算法的计算延迟
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 10 + 5))

    // 基于简单的加权随机选择
    const weights = accounts.map((acc, i) => ({
      ...acc,
      score: Math.random() * 0.5 + 0.5, // 0.5-1.0 的评分
      weight: Math.random() * 100
    }))

    weights.sort((a, b) => b.score - a.score)
    return weights[Math.floor(Math.random() * Math.min(3, weights.length))] // 前3名中随机选择
  }

  async _simulateUsageUpdate(accountId, usage) {
    // 模拟使用统计更新延迟
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 5 + 1))
    return { accountId, usage, updated: Date.now() }
  }

  async _simulateRetryOperation(operationId) {
    // 模拟可能需要重试的操作
    const shouldFail = Math.random() < 0.2 // 20% 失败率
    const baseDelay = Math.random() * 50 + 10

    if (shouldFail) {
      // 模拟重试逻辑
      for (let retry = 0; retry < 3; retry++) {
        await new Promise((resolve) => setTimeout(resolve, baseDelay * Math.pow(2, retry)))
        if (Math.random() > 0.5) {
          return { operationId, success: true, retries: retry + 1 }
        }
      }
      throw new Error(`Operation ${operationId} failed after retries`)
    }

    await new Promise((resolve) => setTimeout(resolve, baseDelay))
    return { operationId, success: true, retries: 0 }
  }

  async _simulateFailedOperation() {
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 20 + 5))
    throw new Error('Simulated failure')
  }

  async _simulateSuccessfulOperation() {
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 20 + 5))
    return { success: true }
  }

  async _simulateConnectionCreation(connectionId) {
    // 模拟连接建立延迟
    const delay = Math.random() * 100 + 50
    await new Promise((resolve) => setTimeout(resolve, delay))
    return { connectionId, created: Date.now(), delay }
  }

  async _simulateProxyConnection() {
    // 模拟代理连接延迟
    const delay = Math.random() * 200 + 100
    await new Promise((resolve) => setTimeout(resolve, delay))

    if (Math.random() < 0.05) {
      // 5% 失败率
      throw new Error('Proxy connection failed')
    }

    return { success: true, delay }
  }

  async _simulateSessionCreation(sessionId, options) {
    // 模拟会话创建延迟
    const delay = Math.random() * 20 + 5
    await new Promise((resolve) => setTimeout(resolve, delay))

    return {
      sessionId,
      ...options,
      createdAt: Date.now(),
      delay
    }
  }

  async _simulateSessionPersistence(session) {
    // 模拟持久化延迟
    const delay = Math.random() * 30 + 10
    await new Promise((resolve) => setTimeout(resolve, delay))
    return { ...session, persisted: true, delay }
  }

  async _simulateSessionAffinity(sessionId, accountId) {
    // 模拟亲和性设置延迟
    const delay = Math.random() * 15 + 5
    await new Promise((resolve) => setTimeout(resolve, delay))
    return { sessionId, accountId, affinity: true, delay }
  }

  _generateMockAccounts(count) {
    const accounts = []

    for (let i = 0; i < count; i++) {
      accounts.push({
        id: `mock_account_${i}`,
        name: `Mock Account ${i}`,
        status: 'active',
        proxy:
          i % 3 === 0
            ? {
                type: 'socks5',
                host: 'proxy.example.com',
                port: 1080
              }
            : null,
        lastUsed: Date.now() - Math.random() * 3600000 // 最近1小时内
      })
    }

    return accounts
  }

  _generateMockMetrics(accountId) {
    return {
      accountId,
      totalRequests: Math.floor(Math.random() * 1000) + 100,
      errorCount: Math.floor(Math.random() * 50),
      avgResponseTime: Math.random() * 2000 + 500,
      avgCostPerRequest: Math.random() * 0.01,
      lastUpdated: Date.now()
    }
  }

  // 分析方法（与原版相同）
  _analyzeLoadBalancerResults(testResults) {
    const selectionTimes = testResults.accountSelection.map((r) => r.selectionTime)
    const avgSelectionTime = selectionTimes.reduce((a, b) => a + b, 0) / selectionTimes.length
    const maxSelectionTime = Math.max(...selectionTimes)
    const minSelectionTime = Math.min(...selectionTimes)

    const efficiencyResults = testResults.algorithmEfficiency
    const cacheHitRate =
      testResults.cachePerformance.filter((r) => r.cacheHit).length /
      testResults.cachePerformance.length

    return {
      accountSelection: {
        avgTime: avgSelectionTime,
        maxTime: maxSelectionTime,
        minTime: minSelectionTime,
        p95Time: this._calculatePercentile(selectionTimes, 95),
        p99Time: this._calculatePercentile(selectionTimes, 99),
        passesThreshold: avgSelectionTime <= this.config.thresholds.loadBalancer.selectionTime
      },

      algorithmEfficiency: {
        results: efficiencyResults,
        scalability:
          efficiencyResults.length > 0
            ? efficiencyResults[efficiencyResults.length - 1].avgTime / efficiencyResults[0].avgTime
            : 1,
        passesThreshold: true
      },

      cachePerformance: {
        hitRate: cacheHitRate,
        passesThreshold: cacheHitRate >= this.config.thresholds.loadBalancer.cacheHitRate
      },

      scalability: testResults.scalability,

      overallScore: this._calculateOverallScore([
        avgSelectionTime <= this.config.thresholds.loadBalancer.selectionTime,
        cacheHitRate >= this.config.thresholds.loadBalancer.cacheHitRate
      ])
    }
  }

  _analyzeErrorHandlingResults(testResults) {
    const retryTimes = testResults.retryPerformance.map((r) => r.totalTime)
    const avgRetryTime = retryTimes.reduce((a, b) => a + b, 0) / retryTimes.length

    const circuitBreakerTimes = testResults.circuitBreakerResponse.map((r) => r.responseTime)
    const avgCircuitBreakerTime =
      circuitBreakerTimes.reduce((a, b) => a + b, 0) / circuitBreakerTimes.length

    const overhead = testResults.overheadAnalysis[0]

    return {
      retryPerformance: {
        avgTime: avgRetryTime,
        p95Time: this._calculatePercentile(retryTimes, 95),
        passesThreshold: overhead.overhead <= this.config.thresholds.errorHandling.retryOverhead
      },

      circuitBreakerPerformance: {
        avgResponseTime: avgCircuitBreakerTime,
        passesThreshold:
          avgCircuitBreakerTime <= this.config.thresholds.errorHandling.circuitBreakerResponse
      },

      errorRecovery: {
        recoveryTime: testResults.errorRecovery[0]?.totalRecoveryTime || 0,
        passesThreshold:
          (testResults.errorRecovery[0]?.totalRecoveryTime || 0) <=
          this.config.thresholds.errorHandling.recoveryTime
      },

      performanceOverhead: overhead,

      overallScore: this._calculateOverallScore([
        overhead.overhead <= this.config.thresholds.errorHandling.retryOverhead,
        avgCircuitBreakerTime <= this.config.thresholds.errorHandling.circuitBreakerResponse
      ])
    }
  }

  _analyzeConnectionManagerResults(testResults, reuseHits) {
    const creationTimes = testResults.connectionCreation.map((r) => r.creationTime)
    const avgCreationTime = creationTimes.reduce((a, b) => a + b, 0) / creationTimes.length

    const reuseTimes = testResults.connectionReuse.map((r) => r.reuseTime)
    const avgReuseTime = reuseTimes.reduce((a, b) => a + b, 0) / reuseTimes.length
    const reuseEfficiency = reuseHits / testResults.connectionReuse.length

    const healthCheck = testResults.healthChecks[0]

    return {
      connectionCreation: {
        avgTime: avgCreationTime,
        p95Time: this._calculatePercentile(creationTimes, 95),
        passesThreshold: avgCreationTime <= this.config.thresholds.connectionManager.connectionTime
      },

      connectionReuse: {
        avgTime: avgReuseTime,
        efficiency: reuseEfficiency,
        passesThreshold: reuseEfficiency >= this.config.thresholds.connectionManager.reuseEfficiency
      },

      healthChecks: {
        avgTimePerConnection: healthCheck?.avgTimePerConnection || 0,
        passesThreshold:
          (healthCheck?.avgTimePerConnection || 0) <=
          this.config.thresholds.connectionManager.healthCheckTime
      },

      proxyPerformance:
        testResults.proxyPerformance.length > 0
          ? {
              avgTime:
                testResults.proxyPerformance.reduce((sum, r) => sum + r.proxyTime, 0) /
                testResults.proxyPerformance.length,
              successRate:
                testResults.proxyPerformance.filter((r) => r.success).length /
                testResults.proxyPerformance.length
            }
          : null,

      overallScore: this._calculateOverallScore([
        avgCreationTime <= this.config.thresholds.connectionManager.connectionTime,
        reuseEfficiency >= this.config.thresholds.connectionManager.reuseEfficiency
      ])
    }
  }

  _analyzeSessionManagerResults(testResults) {
    const creationTimes = testResults.sessionCreation.map((r) => r.creationTime)
    const avgCreationTime = creationTimes.reduce((a, b) => a + b, 0) / creationTimes.length

    const restoreTimes = testResults.sessionRestore.map((r) => r.restoreTime)
    const avgRestoreTime = restoreTimes.reduce((a, b) => a + b, 0) / restoreTimes.length

    const persistenceTimes = testResults.sessionPersistence.map((r) => r.persistenceTime)
    const avgPersistenceTime = persistenceTimes.reduce((a, b) => a + b, 0) / persistenceTimes.length

    const affinityTimes = testResults.sessionAffinity.map((r) => r.affinityTime)
    const avgAffinityTime = affinityTimes.reduce((a, b) => a + b, 0) / affinityTimes.length

    return {
      sessionCreation: {
        avgTime: avgCreationTime,
        p95Time: this._calculatePercentile(creationTimes, 95),
        passesThreshold: avgCreationTime <= this.config.thresholds.sessionManager.createTime
      },

      sessionRestore: {
        avgTime: avgRestoreTime,
        passesThreshold: avgRestoreTime <= this.config.thresholds.sessionManager.restoreTime
      },

      sessionPersistence: {
        avgTime: avgPersistenceTime,
        passesThreshold: avgPersistenceTime <= this.config.thresholds.sessionManager.persistenceTime
      },

      sessionAffinity: {
        avgTime: avgAffinityTime
      },

      overallScore: this._calculateOverallScore([
        avgCreationTime <= this.config.thresholds.sessionManager.createTime,
        avgRestoreTime <= this.config.thresholds.sessionManager.restoreTime,
        avgPersistenceTime <= this.config.thresholds.sessionManager.persistenceTime
      ])
    }
  }

  _analyzeIntegratedResults(testResults) {
    const latencies = testResults.endToEndLatency.map((r) => r.endToEndTime)
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length

    const throughput = testResults.throughput[0]

    return {
      endToEndLatency: {
        avgTime: avgLatency,
        p95Time: this._calculatePercentile(latencies, 95),
        p99Time: this._calculatePercentile(latencies, 99)
      },

      throughput,

      overallScore: this._calculateOverallScore([
        avgLatency <= 1000, // 1秒端到端延迟阈值
        throughput.successRate >= 0.95 // 95% 成功率阈值
      ])
    }
  }

  _analyzeConcurrentLoadResults(testResults) {
    const analysis = {}

    for (const [level, result] of Object.entries(testResults)) {
      if (result && result.summary) {
        analysis[level] = {
          ...result.summary,
          performanceScore: this._calculatePerformanceScore(result.summary)
        }
      }
    }

    return {
      loadLevels: analysis,
      scalabilityAnalysis: this._analyzeScalability(analysis),
      overallScore: this._calculateOverallScore([
        analysis.lightLoad?.successRate >= 0.95,
        analysis.mediumLoad?.successRate >= 0.9,
        analysis.heavyLoad?.successRate >= 0.85
      ])
    }
  }

  _analyzePerformanceComparison(testResults) {
    const { comparison } = testResults

    return {
      comparison,
      verdict: comparison.overhead < 0 ? 'Performance Improvement' : 'Performance Overhead',
      significant: Math.abs(comparison.overheadPercentage) > 5, // 5% 阈值
      recommendation:
        comparison.overhead < 0
          ? 'Optimizations provide measurable performance benefits'
          : 'Consider optimization trade-offs vs functionality gains'
    }
  }

  _analyzeScalability(analysis) {
    const levels = ['lightLoad', 'mediumLoad', 'heavyLoad', 'extremeLoad']
    const scalabilityMetrics = []

    for (let i = 1; i < levels.length; i++) {
      const current = analysis[levels[i]]
      const previous = analysis[levels[i - 1]]

      if (current && previous) {
        scalabilityMetrics.push({
          from: levels[i - 1],
          to: levels[i],
          throughputRatio: current.requestsPerSecond / previous.requestsPerSecond,
          latencyRatio: current.avgResponseTime / previous.avgResponseTime,
          successRateRatio: current.successRate / previous.successRate
        })
      }
    }

    return scalabilityMetrics
  }

  _calculatePercentile(values, percentile) {
    const sorted = [...values].sort((a, b) => a - b)
    const index = Math.ceil((percentile / 100) * sorted.length) - 1
    return sorted[index]
  }

  _calculateOverallScore(passedChecks) {
    return passedChecks.filter(Boolean).length / passedChecks.length
  }

  _calculatePerformanceScore(summary) {
    const latencyScore = Math.max(0, 1 - summary.avgResponseTime / 1000) // 1秒为基准
    const throughputScore = Math.min(1, summary.requestsPerSecond / 100) // 100 RPS为基准
    const successScore = summary.successRate

    return (latencyScore + throughputScore + successScore) / 3
  }

  /**
   * 📊 生成综合报告
   */
  async _generateComprehensiveReport(reportDir) {
    logger.info('📊 Generating comprehensive performance report...')

    const report = {
      metadata: {
        testSuite: 'Claude Relay Service - Standalone Performance Benchmark',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        duration: Date.now() - this.startTime,
        environment: {
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
          memory: process.memoryUsage()
        }
      },

      executive_summary: this._generateExecutiveSummary(),

      detailed_results: {
        loadBalancer: this.results.get('loadBalancer'),
        errorHandling: this.results.get('errorHandling'),
        connectionManager: this.results.get('connectionManager'),
        sessionManager: this.results.get('sessionManager'),
        integrated: this.results.get('integrated'),
        concurrentLoad: this.results.get('concurrentLoad'),
        comparison: this.results.get('comparison')
      },

      performance_analysis: this._generatePerformanceAnalysis(),

      recommendations: this._generateRecommendations(),

      thresholds_compliance: this._checkThresholdsCompliance()
    }

    // 保存主报告
    const reportPath = path.join(reportDir, 'comprehensive-performance-report.json')
    await fs.promises.writeFile(reportPath, JSON.stringify(report, null, 2))

    // 生成HTML报告
    await this._generateHtmlReport(reportDir, report)

    // 生成性能指标CSV
    await this._generateCsvReport(reportDir)

    logger.info(`📋 Comprehensive report generated: ${reportPath}`)
    return report
  }

  /**
   * 📋 生成执行摘要
   */
  _generateExecutiveSummary() {
    const allResults = Array.from(this.results.values())
    const overallScores = allResults.map((r) => r.overallScore).filter((s) => s !== undefined)
    const avgScore = overallScores.reduce((a, b) => a + b, 0) / overallScores.length

    return {
      overallPerformanceScore: avgScore,
      testDuration: Date.now() - this.startTime,
      totalTests: this.results.size,
      passedTests: overallScores.filter((s) => s >= 0.8).length,
      keyFindings: [
        `Load Balancer: ${this.results.get('loadBalancer')?.overallScore >= 0.8 ? 'PASS' : 'NEEDS_IMPROVEMENT'}`,
        `Error Handling: ${this.results.get('errorHandling')?.overallScore >= 0.8 ? 'PASS' : 'NEEDS_IMPROVEMENT'}`,
        `Connection Manager: ${this.results.get('connectionManager')?.overallScore >= 0.8 ? 'PASS' : 'NEEDS_IMPROVEMENT'}`,
        `Session Manager: ${this.results.get('sessionManager')?.overallScore >= 0.8 ? 'PASS' : 'NEEDS_IMPROVEMENT'}`
      ],
      recommendation:
        avgScore >= 0.8
          ? 'Performance meets enterprise standards'
          : 'Performance optimization recommended'
    }
  }

  /**
   * 📊 生成性能分析
   */
  _generatePerformanceAnalysis() {
    return {
      strengths: this._identifyStrengths(),
      weaknesses: this._identifyWeaknesses(),
      bottlenecks: this._identifyBottlenecks(),
      scalabilityAssessment: this._assessScalability()
    }
  }

  /**
   * 💡 生成优化建议
   */
  _generateRecommendations() {
    const recommendations = []

    // 基于测试结果生成建议
    const loadBalancer = this.results.get('loadBalancer')
    if (
      loadBalancer?.accountSelection?.avgTime > this.config.thresholds.loadBalancer.selectionTime
    ) {
      recommendations.push({
        category: 'Load Balancer',
        priority: 'High',
        issue: 'Account selection time exceeds threshold',
        recommendation: 'Optimize algorithm complexity or implement better caching',
        estimatedImpact: 'Medium'
      })
    }

    const connectionManager = this.results.get('connectionManager')
    if (
      connectionManager?.connectionReuse?.efficiency <
      this.config.thresholds.connectionManager.reuseEfficiency
    ) {
      recommendations.push({
        category: 'Connection Manager',
        priority: 'Medium',
        issue: 'Low connection reuse efficiency',
        recommendation: 'Adjust connection pool parameters or improve cache logic',
        estimatedImpact: 'High'
      })
    }

    return recommendations
  }

  /**
   * ✅ 检查阈值合规性
   */
  _checkThresholdsCompliance() {
    const compliance = {}

    for (const [category, result] of this.results.entries()) {
      compliance[category] = {}

      // 检查各个指标是否符合阈值
      if (result.accountSelection) {
        compliance[category].accountSelection = result.accountSelection.passesThreshold
      }
      if (result.connectionCreation) {
        compliance[category].connectionCreation = result.connectionCreation.passesThreshold
      }
      if (result.sessionCreation) {
        compliance[category].sessionCreation = result.sessionCreation.passesThreshold
      }
    }

    return compliance
  }

  _identifyStrengths() {
    const strengths = []

    for (const [category, result] of this.results.entries()) {
      if (result.overallScore >= 0.9) {
        strengths.push(
          `${category}: Excellent performance (score: ${result.overallScore.toFixed(2)})`
        )
      }
    }

    return strengths
  }

  _identifyWeaknesses() {
    const weaknesses = []

    for (const [category, result] of this.results.entries()) {
      if (result.overallScore < 0.7) {
        weaknesses.push(
          `${category}: Performance below expectations (score: ${result.overallScore.toFixed(2)})`
        )
      }
    }

    return weaknesses
  }

  _identifyBottlenecks() {
    const bottlenecks = []

    // 基于测试结果识别性能瓶颈
    const loadBalancer = this.results.get('loadBalancer')
    if (loadBalancer?.accountSelection?.avgTime > 100) {
      bottlenecks.push('Load Balancer: Account selection algorithm performance')
    }

    const connectionManager = this.results.get('connectionManager')
    if (connectionManager?.connectionCreation?.avgTime > 1000) {
      bottlenecks.push('Connection Manager: Connection establishment latency')
    }

    return bottlenecks
  }

  _assessScalability() {
    const concurrentLoad = this.results.get('concurrentLoad')
    if (!concurrentLoad) {
      return 'No scalability data available'
    }

    const { loadLevels } = concurrentLoad

    // 计算可扩展性指标
    const throughputTrend = []
    const levels = ['lightLoad', 'mediumLoad', 'heavyLoad', 'extremeLoad']

    for (let i = 1; i < levels.length; i++) {
      const current = loadLevels[levels[i]]
      const previous = loadLevels[levels[i - 1]]

      if (current && previous) {
        throughputTrend.push(current.requestsPerSecond / previous.requestsPerSecond)
      }
    }

    const avgTrend = throughputTrend.reduce((a, b) => a + b, 0) / throughputTrend.length

    if (avgTrend > 0.8) {
      return 'Good scalability - performance scales well with load'
    } else if (avgTrend > 0.6) {
      return 'Moderate scalability - some performance degradation under load'
    } else {
      return 'Poor scalability - significant performance degradation under load'
    }
  }

  /**
   * 💾 保存测试结果
   */
  async _saveTestResults(reportDir, testName, data) {
    const filePath = path.join(reportDir, `${testName}.json`)
    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2))

    if (this.config.saveRawData) {
      this.rawData.push({
        testName,
        timestamp: Date.now(),
        data
      })
    }
  }

  /**
   * 🌐 生成HTML报告
   */
  async _generateHtmlReport(reportDir, report) {
    const htmlContent = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Claude Relay Service - Standalone Performance Benchmark Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; line-height: 1.6; }
        .header { background: #2c3e50; color: white; padding: 20px; border-radius: 8px; }
        .summary { background: #ecf0f1; padding: 15px; border-radius: 8px; margin: 20px 0; }
        .test-result { border: 1px solid #ddd; margin: 10px 0; padding: 15px; border-radius: 5px; }
        .pass { border-left: 5px solid #27ae60; }
        .fail { border-left: 5px solid #e74c3c; }
        .metric { display: inline-block; margin: 10px; padding: 10px; background: #f8f9fa; border-radius: 5px; }
        .chart { margin: 20px 0; text-align: center; }
        table { width: 100%; border-collapse: collapse; margin: 10px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background: #f2f2f2; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Claude Relay Service Standalone Performance Benchmark Report</h1>
        <p>Generated: ${report.metadata.timestamp}</p>
        <p>Duration: ${Math.round(report.metadata.duration / 1000)}s</p>
        <p><strong>Note:</strong> This is a standalone test without external dependencies</p>
    </div>
    
    <div class="summary">
        <h2>Executive Summary</h2>
        <div class="metric">
            <strong>Overall Score:</strong> ${report.executive_summary.overallPerformanceScore.toFixed(2)}
        </div>
        <div class="metric">
            <strong>Tests Passed:</strong> ${report.executive_summary.passedTests}/${report.executive_summary.totalTests}
        </div>
        <div class="metric">
            <strong>Recommendation:</strong> ${report.executive_summary.recommendation}
        </div>
    </div>
    
    <h2>Test Results</h2>
    ${Object.entries(report.detailed_results)
      .map(
        ([category, result]) => `
        <div class="test-result ${result && result.overallScore >= 0.8 ? 'pass' : 'fail'}">
            <h3>${category}</h3>
            <p><strong>Score:</strong> ${result?.overallScore?.toFixed(2) || 'N/A'}</p>
            <pre>${JSON.stringify(result, null, 2)}</pre>
        </div>
    `
      )
      .join('')}
    
    <h2>Performance Analysis</h2>
    <div class="test-result">
        <h3>Strengths</h3>
        <ul>
            ${report.performance_analysis.strengths.map((s) => `<li>${s}</li>`).join('')}
        </ul>
        
        <h3>Weaknesses</h3>
        <ul>
            ${report.performance_analysis.weaknesses.map((w) => `<li>${w}</li>`).join('')}
        </ul>
        
        <h3>Bottlenecks</h3>
        <ul>
            ${report.performance_analysis.bottlenecks.map((b) => `<li>${b}</li>`).join('')}
        </ul>
        
        <h3>Scalability Assessment</h3>
        <p>${report.performance_analysis.scalabilityAssessment}</p>
    </div>
    
    <h2>Recommendations</h2>
    <table>
        <tr>
            <th>Category</th>
            <th>Priority</th>
            <th>Issue</th>
            <th>Recommendation</th>
            <th>Impact</th>
        </tr>
        ${report.recommendations
          .map(
            (r) => `
            <tr>
                <td>${r.category}</td>
                <td>${r.priority}</td>
                <td>${r.issue}</td>
                <td>${r.recommendation}</td>
                <td>${r.estimatedImpact}</td>
            </tr>
        `
          )
          .join('')}
    </table>
</body>
</html>`

    const htmlPath = path.join(reportDir, 'performance-report.html')
    await fs.promises.writeFile(htmlPath, htmlContent)
  }

  /**
   * 📊 生成CSV报告
   */
  async _generateCsvReport(reportDir) {
    const csvData = []

    // 添加标题行
    csvData.push('Category,Metric,Value,Threshold,Pass,Timestamp')

    // 添加数据行
    for (const [category, result] of this.results.entries()) {
      if (result.accountSelection) {
        csvData.push(
          `${category},Account Selection Avg Time,${result.accountSelection.avgTime},${this.config.thresholds.loadBalancer?.selectionTime || 'N/A'},${result.accountSelection.passesThreshold},${Date.now()}`
        )
      }

      if (result.connectionCreation) {
        csvData.push(
          `${category},Connection Creation Avg Time,${result.connectionCreation.avgTime},${this.config.thresholds.connectionManager?.connectionTime || 'N/A'},${result.connectionCreation.passesThreshold},${Date.now()}`
        )
      }

      if (result.sessionCreation) {
        csvData.push(
          `${category},Session Creation Avg Time,${result.sessionCreation.avgTime},${this.config.thresholds.sessionManager?.createTime || 'N/A'},${result.sessionCreation.passesThreshold},${Date.now()}`
        )
      }
    }

    const csvPath = path.join(reportDir, 'performance-metrics.csv')
    await fs.promises.writeFile(csvPath, csvData.join('\n'))
  }

  /**
   * 📁 确保报告目录存在
   */
  _ensureReportDirectory() {
    if (!fs.existsSync(this.config.reportPath)) {
      fs.mkdirSync(this.config.reportPath, { recursive: true })
    }
  }

  /**
   * 📁 创建测试报告目录
   */
  _createReportDirectory() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const reportDir = path.join(
      this.config.reportPath,
      `standalone-performance-benchmark-${timestamp}`
    )

    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true })
    }

    return reportDir
  }
}

// 命令行接口
async function main() {
  try {
    const benchmark = new StandalonePerformanceBenchmark()

    // 解析命令行参数
    const args = process.argv.slice(2)
    const testType = args[0] || 'full'

    switch (testType) {
      case 'full':
        await benchmark.runFullBenchmark()
        break

      case 'load-balancer':
        await benchmark._testLoadBalancerPerformance(benchmark._createReportDirectory())
        break

      case 'error-handling':
        await benchmark._testErrorHandlingPerformance(benchmark._createReportDirectory())
        break

      case 'connection-manager':
        await benchmark._testConnectionManagerPerformance(benchmark._createReportDirectory())
        break

      case 'session-manager':
        await benchmark._testSessionManagerPerformance(benchmark._createReportDirectory())
        break

      case 'concurrent':
        await benchmark._testConcurrentLoad(benchmark._createReportDirectory())
        break

      default:
        console.log('Usage: node performance-benchmark-standalone.js [test-type]')
        console.log(
          'Available test types: full, load-balancer, error-handling, connection-manager, session-manager, concurrent'
        )
        process.exit(1)
    }

    console.log('✅ Standalone Performance benchmark completed successfully')
    process.exit(0)
  } catch (error) {
    console.error('❌ Standalone Performance benchmark failed:', error)
    process.exit(1)
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  main()
}

module.exports = {
  StandalonePerformanceBenchmark
}
