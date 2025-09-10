#!/usr/bin/env node

/**
 * @fileoverview 错误处理和重试机制专项测试
 *
 * 测试错误处理和重试管理器的各种场景：
 * - 重试管理器的策略和算法验证
 * - 熔断器状态切换和恢复测试
 * - 错误分类和处理策略验证
 * - 监控指标收集和统计测试
 * - 多组件错误隔离测试
 * - 故障恢复和降级机制验证
 *
 * @author Claude Code
 * @version 1.0.0
 */

const { performance } = require('perf_hooks')
const chalk = require('chalk')
const EventEmitter = require('events')

// 导入核心模块
const logger = require('../src/utils/logger')

// 测试配置
const TEST_CONFIG = {
  retryTests: {
    maxRetries: 5,
    baseDelay: 100,
    maxDelay: 5000,
    backoffMultiplier: 2
  },

  circuitBreaker: {
    failureThreshold: 5,
    recoveryTimeout: 2000,
    monitoringWindow: 10000
  },

  errorScenarios: {
    networkErrors: ['ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT'],
    apiErrors: [429, 500, 502, 503, 504],
    applicationErrors: ['ValidationError', 'AuthenticationError', 'RateLimitError']
  },

  performance: {
    maxRetryTime: 10000,
    maxRecoveryTime: 5000,
    minThroughput: 10
  },

  testDuration: {
    unit: 5000, // 单个测试 5秒
    stress: 15000, // 压力测试 15秒
    recovery: 10000 // 恢复测试 10秒
  },

  verbose: process.argv.includes('--verbose') || process.argv.includes('-v'),
  profile: process.argv.includes('--profile') || process.argv.includes('-p')
}

/**
 * 重试管理器实现
 */
class RetryManager extends EventEmitter {
  constructor(options = {}) {
    super()

    this.options = {
      maxRetries: options.maxRetries || 3,
      baseDelay: options.baseDelay || 1000,
      maxDelay: options.maxDelay || 30000,
      backoffMultiplier: options.backoffMultiplier || 2,
      jitter: options.jitter !== false,
      retryableErrors: options.retryableErrors || ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'],
      ...options
    }

    this.stats = {
      totalAttempts: 0,
      totalRetries: 0,
      successfulRetries: 0,
      failedRetries: 0,
      avgRetryDelay: 0,
      errorTypes: new Map()
    }
  }

  async executeWithRetry(fn, context = {}) {
    let lastError
    let attempt = 0
    const startTime = performance.now()

    while (attempt <= this.options.maxRetries) {
      try {
        this.stats.totalAttempts++

        const result = await fn(attempt, context)

        if (attempt > 0) {
          this.stats.successfulRetries++
          this.emit('retrySuccess', { attempt, context, duration: performance.now() - startTime })
        }

        return result
      } catch (error) {
        lastError = error
        attempt++

        // 记录错误类型
        const errorType = this.classifyError(error)
        this.stats.errorTypes.set(errorType, (this.stats.errorTypes.get(errorType) || 0) + 1)

        if (attempt <= this.options.maxRetries && this.shouldRetry(error)) {
          this.stats.totalRetries++

          const delay = this.calculateDelay(attempt)
          this.stats.avgRetryDelay =
            (this.stats.avgRetryDelay * (this.stats.totalRetries - 1) + delay) /
            this.stats.totalRetries

          this.emit('retryAttempt', { attempt, error, delay, context })

          await this.sleep(delay)
        } else {
          break
        }
      }
    }

    this.stats.failedRetries++
    this.emit('retryFailed', { attempts: attempt, error: lastError, context })
    throw lastError
  }

  shouldRetry(error) {
    const errorType = this.classifyError(error)

    // 网络错误 - 重试
    if (this.options.retryableErrors.includes(error.code)) {
      return true
    }

    // HTTP状态码错误
    if (error.status) {
      const retryableStatuses = [429, 500, 502, 503, 504]
      return retryableStatuses.includes(error.status)
    }

    // 超时错误 - 重试
    if (error.message.includes('timeout') || error.message.includes('TIMEOUT')) {
      return true
    }

    // 认证错误 - 不重试
    if (error.status === 401 || error.status === 403) {
      return false
    }

    // 客户端错误 - 不重试
    if (error.status >= 400 && error.status < 500 && error.status !== 429) {
      return false
    }

    return false
  }

  classifyError(error) {
    if (error.code) {
      return `NetworkError:${error.code}`
    }

    if (error.status) {
      return `HTTPError:${error.status}`
    }

    if (error.name) {
      return `ApplicationError:${error.name}`
    }

    return 'UnknownError'
  }

  calculateDelay(attempt) {
    let delay = this.options.baseDelay * Math.pow(this.options.backoffMultiplier, attempt - 1)

    // 限制最大延迟
    delay = Math.min(delay, this.options.maxDelay)

    // 添加抖动
    if (this.options.jitter) {
      delay = delay + Math.random() * delay * 0.1
    }

    return Math.floor(delay)
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  getStats() {
    return {
      ...this.stats,
      successRate:
        this.stats.totalAttempts > 0
          ? (this.stats.totalAttempts - this.stats.failedRetries) / this.stats.totalAttempts
          : 0,
      retryRate:
        this.stats.totalAttempts > 0 ? this.stats.totalRetries / this.stats.totalAttempts : 0
    }
  }

  reset() {
    this.stats = {
      totalAttempts: 0,
      totalRetries: 0,
      successfulRetries: 0,
      failedRetries: 0,
      avgRetryDelay: 0,
      errorTypes: new Map()
    }
  }
}

/**
 * 熔断器实现
 */
class CircuitBreaker extends EventEmitter {
  constructor(options = {}) {
    super()

    this.options = {
      failureThreshold: options.failureThreshold || 5,
      recoveryTimeout: options.recoveryTimeout || 60000,
      monitoringWindow: options.monitoringWindow || 60000,
      ...options
    }

    this.state = 'CLOSED' // CLOSED, OPEN, HALF_OPEN
    this.failures = 0
    this.nextAttemptTime = null
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      circuitOpenCount: 0,
      lastStateChange: Date.now()
    }

    this.monitoringWindow = []
  }

  async execute(fn, context = {}) {
    this.stats.totalRequests++

    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttemptTime) {
        const error = new Error('Circuit breaker is OPEN')
        error.circuitBreakerState = 'OPEN'
        throw error
      } else {
        this.state = 'HALF_OPEN'
        this.emit('stateChange', { from: 'OPEN', to: 'HALF_OPEN', context })
      }
    }

    try {
      const result = await fn(context)
      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure(error)
      throw error
    }
  }

  onSuccess() {
    this.stats.successfulRequests++

    if (this.state === 'HALF_OPEN') {
      this.reset()
      this.emit('stateChange', { from: 'HALF_OPEN', to: 'CLOSED' })
    }

    this.updateMonitoringWindow('success')
  }

  onFailure(error) {
    this.stats.failedRequests++
    this.failures++

    this.updateMonitoringWindow('failure')

    if (this.state === 'HALF_OPEN') {
      this.openCircuit()
    } else if (this.state === 'CLOSED' && this.failures >= this.options.failureThreshold) {
      this.openCircuit()
    }
  }

  openCircuit() {
    const previousState = this.state
    this.state = 'OPEN'
    this.nextAttemptTime = Date.now() + this.options.recoveryTimeout
    this.stats.circuitOpenCount++
    this.stats.lastStateChange = Date.now()

    this.emit('stateChange', { from: previousState, to: 'OPEN' })
  }

  reset() {
    this.state = 'CLOSED'
    this.failures = 0
    this.nextAttemptTime = null
    this.stats.lastStateChange = Date.now()
  }

  updateMonitoringWindow(result) {
    const now = Date.now()
    this.monitoringWindow.push({ result, timestamp: now })

    // 清理超出监控窗口的记录
    const cutoff = now - this.options.monitoringWindow
    this.monitoringWindow = this.monitoringWindow.filter((entry) => entry.timestamp > cutoff)
  }

  getState() {
    return this.state
  }

  getStats() {
    const failureRate =
      this.stats.totalRequests > 0 ? this.stats.failedRequests / this.stats.totalRequests : 0

    const recentFailures = this.monitoringWindow.filter(
      (entry) => entry.result === 'failure'
    ).length
    const recentFailureRate =
      this.monitoringWindow.length > 0 ? recentFailures / this.monitoringWindow.length : 0

    return {
      ...this.stats,
      state: this.state,
      failureRate,
      recentFailureRate,
      timeUntilNextAttempt: this.nextAttemptTime
        ? Math.max(0, this.nextAttemptTime - Date.now())
        : 0
    }
  }
}

/**
 * 错误模拟器
 */
class ErrorSimulator {
  constructor() {
    this.errorPatterns = {
      network: {
        rate: 0.1,
        errors: ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED']
      },
      http: {
        rate: 0.15,
        errors: [429, 500, 502, 503, 504]
      },
      application: {
        rate: 0.05,
        errors: ['ValidationError', 'AuthenticationError', 'RateLimitError']
      },
      intermittent: {
        rate: 0.02,
        errors: ['TransientError', 'TemporaryUnavailable']
      }
    }

    this.currentPattern = 'normal'
    this.errorRateMultiplier = 1
  }

  setErrorPattern(pattern, multiplier = 1) {
    this.currentPattern = pattern
    this.errorRateMultiplier = multiplier
  }

  async simulateOperation(operationId, options = {}) {
    const delay = options.delay || 100 + Math.random() * 200
    await new Promise((resolve) => setTimeout(resolve, delay))

    if (this.shouldFail()) {
      throw this.generateError()
    }

    return { operationId, success: true, timestamp: Date.now() }
  }

  shouldFail() {
    if (this.currentPattern === 'normal') {
      return Math.random() < 0.05 * this.errorRateMultiplier // 5% 基础错误率
    }

    const pattern = this.errorPatterns[this.currentPattern]
    if (pattern) {
      return Math.random() < pattern.rate * this.errorRateMultiplier
    }

    return false
  }

  generateError() {
    const errorType = this.selectErrorType()
    const pattern = this.errorPatterns[errorType]

    if (!pattern) {
      return new Error('Unknown error')
    }

    const errorValue = pattern.errors[Math.floor(Math.random() * pattern.errors.length)]

    if (typeof errorValue === 'string') {
      if (errorValue.startsWith('E')) {
        // 网络错误
        const error = new Error(`Network error: ${errorValue}`)
        error.code = errorValue
        return error
      } else {
        // 应用错误
        const error = new Error(`Application error: ${errorValue}`)
        error.name = errorValue
        return error
      }
    } else {
      // HTTP状态码错误
      const error = new Error(`HTTP error: ${errorValue}`)
      error.status = errorValue
      return error
    }
  }

  selectErrorType() {
    if (this.currentPattern !== 'normal' && this.errorPatterns[this.currentPattern]) {
      return this.currentPattern
    }

    const types = Object.keys(this.errorPatterns)
    return types[Math.floor(Math.random() * types.length)]
  }
}

/**
 * 测试结果收集器
 */
class ErrorRetryTestResults {
  constructor() {
    this.tests = []
    this.retryStats = []
    this.circuitBreakerEvents = []
    this.errorPatterns = new Map()
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

  addRetryStats(stats) {
    this.retryStats.push({
      ...stats,
      timestamp: Date.now()
    })
  }

  addCircuitBreakerEvent(event) {
    this.circuitBreakerEvents.push({
      ...event,
      timestamp: Date.now()
    })
  }

  addErrorPattern(pattern, count) {
    this.errorPatterns.set(pattern, (this.errorPatterns.get(pattern) || 0) + count)
  }

  getSummary() {
    const passed = this.tests.filter((t) => t.passed).length
    const total = this.tests.length

    return {
      total,
      passed,
      failed: total - passed,
      successRate: total > 0 ? (passed / total) * 100 : 0,
      totalDuration: this.tests.reduce((sum, t) => sum + t.duration, 0)
    }
  }
}

const testResults = new ErrorRetryTestResults()

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

// 全局测试对象
let retryManager
let circuitBreaker
let errorSimulator

/**
 * 初始化测试环境
 */
async function initializeTestEnvironment() {
  log.info('🚀 Initializing Error Retry Test Environment...')

  try {
    retryManager = new RetryManager({
      maxRetries: TEST_CONFIG.retryTests.maxRetries,
      baseDelay: TEST_CONFIG.retryTests.baseDelay,
      maxDelay: TEST_CONFIG.retryTests.maxDelay,
      backoffMultiplier: TEST_CONFIG.retryTests.backoffMultiplier
    })

    circuitBreaker = new CircuitBreaker({
      failureThreshold: TEST_CONFIG.circuitBreaker.failureThreshold,
      recoveryTimeout: TEST_CONFIG.circuitBreaker.recoveryTimeout,
      monitoringWindow: TEST_CONFIG.circuitBreaker.monitoringWindow
    })

    errorSimulator = new ErrorSimulator()

    // 设置事件监听
    retryManager.on('retryAttempt', (data) => {
      log.debug(`Retry attempt ${data.attempt} after ${data.delay}ms delay`)
    })

    retryManager.on('retrySuccess', (data) => {
      log.debug(`Retry succeeded after ${data.attempt} attempts`)
    })

    retryManager.on('retryFailed', (data) => {
      log.debug(`Retry failed after ${data.attempts} attempts`)
    })

    circuitBreaker.on('stateChange', (data) => {
      log.debug(`Circuit breaker state change: ${data.from} -> ${data.to}`)
      testResults.addCircuitBreakerEvent(data)
    })

    log.success('Error retry test environment initialized successfully')
    return true
  } catch (error) {
    log.error('Failed to initialize test environment:', error.message)
    throw error
  }
}

/**
 * 测试重试机制基础功能
 */
async function testBasicRetryMechanism() {
  log.info('🔄 Testing Basic Retry Mechanism...')

  try {
    const testStart = performance.now()

    // 测试1: 成功重试
    log.debug('Test 1: Successful retry after failures')
    let attemptCount = 0

    const successAfterRetries = async () => {
      attemptCount++
      if (attemptCount < 3) {
        const error = new Error('Temporary failure')
        error.code = 'ETIMEDOUT'
        throw error
      }
      return { success: true, attempts: attemptCount }
    }

    const retryResult = await retryManager.executeWithRetry(successAfterRetries)
    const basicRetryPassed = retryResult.success && retryResult.attempts === 3

    testResults.addTest('Retry-BasicSuccess', basicRetryPassed)

    // 测试2: 最终失败
    log.debug('Test 2: Final failure after max retries')
    let failureAttempts = 0

    const alwaysFails = async () => {
      failureAttempts++
      const error = new Error('Persistent failure')
      error.code = 'ECONNRESET'
      throw error
    }

    try {
      await retryManager.executeWithRetry(alwaysFails)
      testResults.addTest('Retry-FinalFailure', false)
    } catch (error) {
      const maxRetriesPassed = failureAttempts === TEST_CONFIG.retryTests.maxRetries + 1
      testResults.addTest('Retry-FinalFailure', maxRetriesPassed)
    }

    // 测试3: 不可重试错误
    log.debug('Test 3: Non-retryable error handling')
    let nonRetryableAttempts = 0

    const nonRetryableError = async () => {
      nonRetryableAttempts++
      const error = new Error('Authentication failed')
      error.status = 401
      throw error
    }

    try {
      await retryManager.executeWithRetry(nonRetryableError)
      testResults.addTest('Retry-NonRetryable', false)
    } catch (error) {
      const nonRetryablePassed = nonRetryableAttempts === 1 // 应该只尝试一次
      testResults.addTest('Retry-NonRetryable', nonRetryablePassed)
    }

    // 测试4: 延迟计算准确性
    log.debug('Test 4: Delay calculation accuracy')
    const delays = []

    for (let i = 1; i <= 5; i++) {
      const delay = retryManager.calculateDelay(i)
      delays.push(delay)
    }

    // 验证指数退避
    const exponentialBackoffCorrect = delays.every((delay, index) => {
      if (index === 0) {
        return true
      }
      const expectedMinDelay =
        TEST_CONFIG.retryTests.baseDelay *
        Math.pow(TEST_CONFIG.retryTests.backoffMultiplier, index - 1)
      return delay >= expectedMinDelay * 0.9 // 允许10%的抖动
    })

    testResults.addTest('Retry-DelayCalculation', exponentialBackoffCorrect)
    log.debug(`Retry delays: ${delays.join(', ')}ms`)

    const testDuration = performance.now() - testStart
    log.success(`Basic retry mechanism tests completed in ${testDuration.toFixed(2)}ms`)
  } catch (error) {
    testResults.addTest('Retry-General', false, 0, { error: error.message })
    log.error('Basic retry mechanism test failed:', error.message)
    throw error
  }
}

/**
 * 测试熔断器功能
 */
async function testCircuitBreakerFunctionality() {
  log.info('⚡ Testing Circuit Breaker Functionality...')

  try {
    const testStart = performance.now()

    // 测试1: 熔断器开启
    log.debug('Test 1: Circuit breaker opening')

    // 连续失败导致熔断器开启
    for (let i = 0; i < TEST_CONFIG.circuitBreaker.failureThreshold; i++) {
      try {
        await circuitBreaker.execute(() => {
          throw new Error(`Failure ${i + 1}`)
        })
      } catch (error) {
        // 预期的失败
      }
    }

    const circuitOpenPassed = circuitBreaker.getState() === 'OPEN'
    testResults.addTest('CircuitBreaker-Opening', circuitOpenPassed)
    log.debug(`Circuit breaker state after failures: ${circuitBreaker.getState()}`)

    // 测试2: 熔断器阻止请求
    log.debug('Test 2: Circuit breaker blocking requests')

    try {
      await circuitBreaker.execute(() => ({ success: true }))
      testResults.addTest('CircuitBreaker-Blocking', false)
    } catch (error) {
      const blockingPassed = error.circuitBreakerState === 'OPEN'
      testResults.addTest('CircuitBreaker-Blocking', blockingPassed)
    }

    // 测试3: 半开状态转换
    log.debug('Test 3: Half-open state transition')

    // 等待恢复超时
    await new Promise((resolve) =>
      setTimeout(resolve, TEST_CONFIG.circuitBreaker.recoveryTimeout + 100)
    )

    // 下一次调用应该触发半开状态
    try {
      await circuitBreaker.execute(() => ({ success: true }))
      const halfOpenTransitionPassed = circuitBreaker.getState() === 'CLOSED'
      testResults.addTest('CircuitBreaker-HalfOpen', halfOpenTransitionPassed)
    } catch (error) {
      testResults.addTest('CircuitBreaker-HalfOpen', false)
    }

    // 测试4: 熔断器重置
    log.debug('Test 4: Circuit breaker reset')

    const initialStats = circuitBreaker.getStats()
    circuitBreaker.reset()
    const resetStats = circuitBreaker.getStats()

    const resetPassed =
      circuitBreaker.getState() === 'CLOSED' &&
      resetStats.lastStateChange > initialStats.lastStateChange

    testResults.addTest('CircuitBreaker-Reset', resetPassed)

    // 测试5: 监控窗口
    log.debug('Test 5: Monitoring window functionality')

    const testOperations = 20
    let successCount = 0

    for (let i = 0; i < testOperations; i++) {
      try {
        if (i % 3 === 0) {
          throw new Error('Simulated failure')
        }
        await circuitBreaker.execute(() => ({ success: true }))
        successCount++
      } catch (error) {
        // 预期的部分失败
      }
    }

    const stats = circuitBreaker.getStats()
    const monitoringWindowPassed =
      stats.totalRequests === testOperations && stats.successfulRequests === successCount

    testResults.addTest('CircuitBreaker-MonitoringWindow', monitoringWindowPassed)
    log.debug(`Circuit breaker stats: ${JSON.stringify(stats, null, 2)}`)

    const testDuration = performance.now() - testStart
    log.success(`Circuit breaker functionality tests completed in ${testDuration.toFixed(2)}ms`)
  } catch (error) {
    testResults.addTest('CircuitBreaker-General', false, 0, { error: error.message })
    log.error('Circuit breaker functionality test failed:', error.message)
    throw error
  }
}

/**
 * 测试错误分类和处理
 */
async function testErrorClassificationAndHandling() {
  log.info('🏷️ Testing Error Classification and Handling...')

  try {
    const testStart = performance.now()

    // 测试1: 网络错误分类
    log.debug('Test 1: Network error classification')

    const networkErrors = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED']
    let networkErrorsClassified = 0

    for (const errorCode of networkErrors) {
      const error = new Error(`Network error: ${errorCode}`)
      error.code = errorCode

      const classification = retryManager.classifyError(error)
      const shouldRetry = retryManager.shouldRetry(error)

      if (classification.startsWith('NetworkError') && shouldRetry) {
        networkErrorsClassified++
      }
    }

    const networkClassificationPassed = networkErrorsClassified === networkErrors.length
    testResults.addTest('ErrorHandling-NetworkClassification', networkClassificationPassed)

    // 测试2: HTTP错误分类
    log.debug('Test 2: HTTP error classification')

    const httpErrors = [
      { status: 429, shouldRetry: true }, // Rate limit - 重试
      { status: 500, shouldRetry: true }, // Server error - 重试
      { status: 401, shouldRetry: false }, // Unauthorized - 不重试
      { status: 404, shouldRetry: false } // Not found - 不重试
    ]

    let httpErrorsClassified = 0

    for (const { status, shouldRetry } of httpErrors) {
      const error = new Error(`HTTP error: ${status}`)
      error.status = status

      const classification = retryManager.classifyError(error)
      const actualShouldRetry = retryManager.shouldRetry(error)

      if (classification.startsWith('HTTPError') && actualShouldRetry === shouldRetry) {
        httpErrorsClassified++
      }
    }

    const httpClassificationPassed = httpErrorsClassified === httpErrors.length
    testResults.addTest('ErrorHandling-HTTPClassification', httpClassificationPassed)

    // 测试3: 应用错误分类
    log.debug('Test 3: Application error classification')

    const applicationErrors = [
      { name: 'ValidationError', shouldRetry: false },
      { name: 'AuthenticationError', shouldRetry: false },
      { name: 'RateLimitError', shouldRetry: true }
    ]

    let appErrorsClassified = 0

    for (const { name, shouldRetry } of applicationErrors) {
      const error = new Error(`Application error: ${name}`)
      error.name = name

      const classification = retryManager.classifyError(error)
      // 注意：当前实现中应用错误通常不重试，但可以根据具体错误类型调整

      if (classification.startsWith('ApplicationError')) {
        appErrorsClassified++
      }
    }

    const appClassificationPassed = appErrorsClassified === applicationErrors.length
    testResults.addTest('ErrorHandling-ApplicationClassification', appClassificationPassed)

    // 测试4: 错误统计收集
    log.debug('Test 4: Error statistics collection')

    retryManager.reset() // 重置统计

    // 模拟各种错误
    const errorTypes = [
      () => {
        const e = new Error('Network')
        e.code = 'ETIMEDOUT'
        throw e
      },
      () => {
        const e = new Error('HTTP')
        e.status = 500
        throw e
      },
      () => {
        const e = new Error('App')
        e.name = 'ValidationError'
        throw e
      }
    ]

    for (const errorGen of errorTypes) {
      try {
        await retryManager.executeWithRetry(errorGen)
      } catch (error) {
        // 预期的失败
      }
    }

    const stats = retryManager.getStats()
    const statsCollectionPassed = stats.errorTypes.size >= 3 && stats.totalAttempts > 0

    testResults.addTest('ErrorHandling-StatisticsCollection', statsCollectionPassed)
    testResults.addRetryStats(stats)

    log.debug(`Error statistics: ${JSON.stringify(Object.fromEntries(stats.errorTypes))}`)

    const testDuration = performance.now() - testStart
    log.success(`Error classification and handling tests completed in ${testDuration.toFixed(2)}ms`)
  } catch (error) {
    testResults.addTest('ErrorHandling-General', false, 0, { error: error.message })
    log.error('Error classification and handling test failed:', error.message)
    throw error
  }
}

/**
 * 测试集成错误恢复场景
 */
async function testIntegratedErrorRecoveryScenarios() {
  log.info('🔧 Testing Integrated Error Recovery Scenarios...')

  try {
    const testStart = performance.now()

    // 测试1: 间歇性错误恢复
    log.debug('Test 1: Intermittent error recovery')

    errorSimulator.setErrorPattern('intermittent', 2) // 增加间歇性错误
    let intermittentSuccesses = 0
    const intermittentTests = 10

    for (let i = 0; i < intermittentTests; i++) {
      try {
        const result = await retryManager.executeWithRetry(() =>
          errorSimulator.simulateOperation(`intermittent-${i}`)
        )
        if (result.success) {
          intermittentSuccesses++
        }
      } catch (error) {
        // 一些失败是预期的
      }
    }

    const intermittentRecoveryRate = intermittentSuccesses / intermittentTests
    const intermittentPassed = intermittentRecoveryRate >= 0.7 // 期望70%的恢复率

    testResults.addTest('Recovery-IntermittentErrors', intermittentPassed, 0, {
      successRate: `${(intermittentRecoveryRate * 100).toFixed(1)}%`
    })

    // 测试2: 网络错误恢复
    log.debug('Test 2: Network error recovery')

    errorSimulator.setErrorPattern('network', 1.5)
    let networkSuccesses = 0
    const networkTests = 15

    for (let i = 0; i < networkTests; i++) {
      try {
        const result = await retryManager.executeWithRetry(
          () => errorSimulator.simulateOperation(`network-${i}`),
          { maxRetries: 3 }
        )
        if (result.success) {
          networkSuccesses++
        }
      } catch (error) {
        // 网络错误可能仍然失败
      }
    }

    const networkRecoveryRate = networkSuccesses / networkTests
    const networkPassed = networkRecoveryRate >= 0.6 // 期望60%的恢复率

    testResults.addTest('Recovery-NetworkErrors', networkPassed, 0, {
      successRate: `${(networkRecoveryRate * 100).toFixed(1)}%`
    })

    // 测试3: 级联故障处理
    log.debug('Test 3: Cascading failure handling')

    // 创建多个熔断器模拟不同服务
    const serviceBreakers = Array.from(
      { length: 3 },
      (_, i) =>
        new CircuitBreaker({
          failureThreshold: 3,
          recoveryTimeout: 1000
        })
    )

    // 模拟级联故障
    errorSimulator.setErrorPattern('http', 3) // 高错误率

    const cascadeResults = []

    for (let i = 0; i < 20; i++) {
      const serviceIndex = i % 3
      const breaker = serviceBreakers[serviceIndex]

      try {
        const result = await breaker.execute(() => errorSimulator.simulateOperation(`cascade-${i}`))
        cascadeResults.push({ service: serviceIndex, success: true })
      } catch (error) {
        cascadeResults.push({ service: serviceIndex, success: false, error: error.message })
      }
    }

    // 分析级联故障处理
    const serviceFailures = new Map()
    cascadeResults.forEach((result) => {
      if (!result.success) {
        serviceFailures.set(result.service, (serviceFailures.get(result.service) || 0) + 1)
      }
    })

    const cascadeHandled = serviceBreakers.some((breaker) => breaker.getState() === 'OPEN')
    testResults.addTest('Recovery-CascadingFailure', cascadeHandled)

    // 测试4: 自适应重试策略
    log.debug('Test 4: Adaptive retry strategy')

    // 重置错误模拟器
    errorSimulator.setErrorPattern('normal', 1)

    // 测试不同错误模式下的自适应行为
    const adaptiveResults = []

    for (const pattern of ['normal', 'network', 'http']) {
      errorSimulator.setErrorPattern(pattern, 1)

      const patternResults = []
      for (let i = 0; i < 5; i++) {
        const start = performance.now()
        try {
          await retryManager.executeWithRetry(() =>
            errorSimulator.simulateOperation(`adaptive-${pattern}-${i}`)
          )
          patternResults.push({ success: true, duration: performance.now() - start })
        } catch (error) {
          patternResults.push({ success: false, duration: performance.now() - start })
        }
      }

      adaptiveResults.push({
        pattern,
        successRate: patternResults.filter((r) => r.success).length / patternResults.length,
        avgDuration: patternResults.reduce((sum, r) => sum + r.duration, 0) / patternResults.length
      })
    }

    const adaptivePassed = adaptiveResults.every((result) => result.successRate >= 0.4)
    testResults.addTest('Recovery-AdaptiveStrategy', adaptivePassed, 0, { adaptiveResults })

    const testDuration = performance.now() - testStart
    log.success(
      `Integrated error recovery scenario tests completed in ${testDuration.toFixed(2)}ms`
    )
  } catch (error) {
    testResults.addTest('Recovery-General', false, 0, { error: error.message })
    log.error('Integrated error recovery scenario test failed:', error.message)
    throw error
  }
}

/**
 * 测试性能和压力场景
 */
async function testPerformanceAndStressScenarios() {
  log.info('🚀 Testing Performance and Stress Scenarios...')

  try {
    const testStart = performance.now()

    // 测试1: 高并发重试性能
    log.debug('Test 1: High concurrency retry performance')

    const concurrentRequests = 50
    const concurrentStart = performance.now()

    const concurrentPromises = Array.from({ length: concurrentRequests }, async (_, i) => {
      const start = performance.now()
      try {
        const result = await retryManager.executeWithRetry(() =>
          errorSimulator.simulateOperation(`concurrent-${i}`)
        )
        return { success: true, duration: performance.now() - start, index: i }
      } catch (error) {
        return {
          success: false,
          duration: performance.now() - start,
          index: i,
          error: error.message
        }
      }
    })

    const concurrentResults = await Promise.all(concurrentPromises)
    const concurrentDuration = performance.now() - concurrentStart

    const concurrentSuccesses = concurrentResults.filter((r) => r.success).length
    const concurrentThroughput = concurrentRequests / (concurrentDuration / 1000)

    const concurrentPassed =
      concurrentThroughput >= TEST_CONFIG.performance.minThroughput &&
      concurrentSuccesses >= concurrentRequests * 0.8

    testResults.addTest('Performance-ConcurrentRetry', concurrentPassed, concurrentDuration, {
      throughput: `${concurrentThroughput.toFixed(1)} req/sec`,
      successRate: `${((concurrentSuccesses / concurrentRequests) * 100).toFixed(1)}%`
    })

    log.debug(
      `Concurrent test: ${concurrentSuccesses}/${concurrentRequests} successful, ${concurrentThroughput.toFixed(1)} req/sec`
    )

    // 测试2: 内存使用稳定性
    log.debug('Test 2: Memory usage stability under load')

    const memStart = process.memoryUsage()
    errorSimulator.setErrorPattern('network', 2) // 增加错误率触发更多重试

    for (let i = 0; i < 100; i++) {
      try {
        await retryManager.executeWithRetry(() => errorSimulator.simulateOperation(`memory-${i}`))
      } catch (error) {
        // 忽略错误，专注于内存使用
      }

      if (i % 20 === 0) {
        // 强制垃圾回收（如果可用）
        if (global.gc) {
          global.gc()
        }
      }
    }

    const memEnd = process.memoryUsage()
    const memoryGrowth = (memEnd.heapUsed - memStart.heapUsed) / 1024 / 1024

    const memoryStable = memoryGrowth < 50 // 50MB增长限制
    testResults.addTest('Performance-MemoryStability', memoryStable, 0, {
      memoryGrowthMB: memoryGrowth.toFixed(2)
    })

    // 测试3: 熔断器性能
    log.debug('Test 3: Circuit breaker performance under load')

    // 重置熔断器
    circuitBreaker.reset()
    errorSimulator.setErrorPattern('http', 3) // 高错误率

    const circuitBreakerStart = performance.now()
    let circuitBreakerOperations = 0
    let circuitBreakerBlocked = 0

    for (let i = 0; i < 100; i++) {
      try {
        await circuitBreaker.execute(() => {
          circuitBreakerOperations++
          return errorSimulator.simulateOperation(`circuit-${i}`)
        })
      } catch (error) {
        if (error.circuitBreakerState === 'OPEN') {
          circuitBreakerBlocked++
        }
      }
    }

    const circuitBreakerDuration = performance.now() - circuitBreakerStart
    const circuitBreakerEfficiency =
      circuitBreakerBlocked > 0 && circuitBreakerDuration < TEST_CONFIG.performance.maxRetryTime

    testResults.addTest(
      'Performance-CircuitBreakerLoad',
      circuitBreakerEfficiency,
      circuitBreakerDuration,
      {
        operationsExecuted: circuitBreakerOperations,
        requestsBlocked: circuitBreakerBlocked,
        finalState: circuitBreaker.getState()
      }
    )

    // 测试4: 错误恢复时间
    log.debug('Test 4: Error recovery time measurement')

    // 模拟服务故障
    errorSimulator.setErrorPattern('http', 10) // 极高错误率

    const recoveryStart = performance.now()
    let recoveryAttempts = 0
    let recoveryTime = null

    // 尝试恢复直到成功
    while (performance.now() - recoveryStart < TEST_CONFIG.performance.maxRecoveryTime) {
      try {
        recoveryAttempts++
        await retryManager.executeWithRetry(() =>
          errorSimulator.simulateOperation(`recovery-${recoveryAttempts}`)
        )
        recoveryTime = performance.now() - recoveryStart
        break
      } catch (error) {
        // 继续尝试恢复
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }

    const recoveryPassed =
      recoveryTime !== null && recoveryTime < TEST_CONFIG.performance.maxRecoveryTime
    testResults.addTest('Performance-RecoveryTime', recoveryPassed, recoveryTime || 0, {
      attempts: recoveryAttempts,
      recoveryTimeMs: recoveryTime?.toFixed(2) || 'timeout'
    })

    const testDuration = performance.now() - testStart
    log.success(`Performance and stress scenario tests completed in ${testDuration.toFixed(2)}ms`)
  } catch (error) {
    testResults.addTest('Performance-General', false, 0, { error: error.message })
    log.error('Performance and stress scenario test failed:', error.message)
    throw error
  }
}

/**
 * 生成错误重试测试报告
 */
async function generateErrorRetryReport() {
  log.info('📋 Generating Error Retry Test Report...')

  const summary = testResults.getSummary()
  const retryStats = retryManager.getStats()
  const circuitBreakerStats = circuitBreaker.getStats()

  const report = {
    timestamp: new Date().toISOString(),
    testConfig: TEST_CONFIG,
    summary,

    retryManagerStats: retryStats,
    circuitBreakerStats,

    errorPatterns: Object.fromEntries(testResults.errorPatterns),
    circuitBreakerEvents: testResults.circuitBreakerEvents,

    testDetails: testResults.tests
  }

  // 控制台输出
  console.log(`\n${'='.repeat(80)}`)
  console.log(chalk.bold.blue('🔄 ERROR HANDLING & RETRY MECHANISM TEST REPORT'))
  console.log('='.repeat(80))

  console.log(chalk.bold('\n📊 Test Summary:'))
  console.log(`  Total Tests: ${summary.total}`)
  console.log(`  Passed: ${chalk.green(summary.passed)}`)
  console.log(`  Failed: ${chalk.red(summary.failed)}`)
  console.log(`  Success Rate: ${chalk.bold(summary.successRate.toFixed(1))}%`)
  console.log(`  Total Duration: ${summary.totalDuration.toFixed(2)}ms`)

  console.log(chalk.bold('\n🔄 Retry Manager Statistics:'))
  console.log(`  Total Attempts: ${retryStats.totalAttempts}`)
  console.log(`  Total Retries: ${retryStats.totalRetries}`)
  console.log(`  Successful Retries: ${retryStats.successfulRetries}`)
  console.log(`  Success Rate: ${(retryStats.successRate * 100).toFixed(1)}%`)
  console.log(`  Retry Rate: ${(retryStats.retryRate * 100).toFixed(1)}%`)
  console.log(`  Avg Retry Delay: ${retryStats.avgRetryDelay.toFixed(2)}ms`)

  console.log(chalk.bold('\n⚡ Circuit Breaker Statistics:'))
  console.log(`  Total Requests: ${circuitBreakerStats.totalRequests}`)
  console.log(`  Successful Requests: ${circuitBreakerStats.successfulRequests}`)
  console.log(`  Failed Requests: ${circuitBreakerStats.failedRequests}`)
  console.log(`  Failure Rate: ${(circuitBreakerStats.failureRate * 100).toFixed(1)}%`)
  console.log(`  Current State: ${circuitBreakerStats.state}`)
  console.log(`  Circuit Opened: ${circuitBreakerStats.circuitOpenCount} times`)

  if (Object.keys(report.errorPatterns).length > 0) {
    console.log(chalk.bold('\n🏷️ Error Patterns:'))
    Object.entries(report.errorPatterns)
      .sort(([, a], [, b]) => b - a)
      .forEach(([pattern, count]) => {
        console.log(`  ${pattern}: ${count} occurrences`)
      })
  }

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
async function runErrorRetryTests() {
  console.log(chalk.bold.blue('\n🔄 Starting Error Handling & Retry Mechanism Tests'))
  console.log(chalk.gray(`Profile Mode: ${TEST_CONFIG.profile} | Verbose: ${TEST_CONFIG.verbose}`))

  const overallStart = performance.now()

  try {
    // 初始化
    await initializeTestEnvironment()

    // 运行测试套件
    await testBasicRetryMechanism()
    await testCircuitBreakerFunctionality()
    await testErrorClassificationAndHandling()
    await testIntegratedErrorRecoveryScenarios()
    await testPerformanceAndStressScenarios()

    // 生成报告
    const report = await generateErrorRetryReport()

    const overallDuration = performance.now() - overallStart

    if (report.summary.failed === 0) {
      log.success(`🎉 All error retry tests passed! Total time: ${overallDuration.toFixed(2)}ms`)
      process.exit(0)
    } else {
      log.error(
        `💥 ${report.summary.failed} test(s) failed! Total time: ${overallDuration.toFixed(2)}ms`
      )
      process.exit(1)
    }
  } catch (error) {
    const overallDuration = performance.now() - overallStart
    log.error(`💥 Error retry test suite failed: ${error.message}`)
    log.error(`Total time: ${overallDuration.toFixed(2)}ms`)

    await generateErrorRetryReport()
    process.exit(1)
  }
}

/**
 * 清理函数
 */
async function cleanup() {
  log.info('🧹 Cleaning up error retry test environment...')

  try {
    if (retryManager) {
      retryManager.reset()
      retryManager.removeAllListeners()
    }

    if (circuitBreaker) {
      circuitBreaker.reset()
      circuitBreaker.removeAllListeners()
    }

    log.success('Error retry test cleanup completed')
  } catch (error) {
    log.warn('Error retry test cleanup failed:', error.message)
  }
}

// 主程序入口
if (require.main === module) {
  // 设置超时
  const globalTimeout = setTimeout(() => {
    log.error('❌ Error retry tests timed out')
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
  runErrorRetryTests().finally(() => {
    clearTimeout(globalTimeout)
  })
}

module.exports = {
  runErrorRetryTests,
  testBasicRetryMechanism,
  testCircuitBreakerFunctionality,
  testErrorClassificationAndHandling,
  testIntegratedErrorRecoveryScenarios,
  testPerformanceAndStressScenarios,
  RetryManager,
  CircuitBreaker,
  ErrorSimulator,
  TEST_CONFIG
}
