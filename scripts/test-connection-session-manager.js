#!/usr/bin/env node

/**
 * @fileoverview 连接管理器和会话管理器集成测试
 *
 * 测试功能：
 * - 连接管理器的基本功能
 * - 会话管理器的基本功能
 * - 集成使用情况
 * - 性能和资源管理
 *
 * @author Claude Code
 * @version 1.0.0
 */

const { connectionManager } = require('../src/services/connectionManager')
const { sessionManager } = require('../src/services/sessionManager')
const _logger = require('../src/utils/logger')
const _config = require('../config/config')

// 🧪 测试配置
const TEST_CONFIG = {
  connectionTests: 5,
  sessionTests: 10,
  concurrentTests: 3,
  testTimeout: 30000
}

/**
 * 🔗 测试连接管理器
 */
async function testConnectionManager() {
  console.log('\n🔗 Testing Connection Manager...')

  try {
    // 测试基本连接获取
    console.log('📊 Test 1: Basic connection retrieval')
    const agent1 = await connectionManager.getConnectionAgent({
      target: 'api.anthropic.com',
      accountId: 'test-account-1'
    })
    console.log(`✅ Agent created: ${!!agent1}`)

    // 测试缓存命中
    console.log('📊 Test 2: Connection caching')
    const start = Date.now()
    const agent2 = await connectionManager.getConnectionAgent({
      target: 'api.anthropic.com',
      accountId: 'test-account-1'
    })
    const duration = Date.now() - start
    console.log(`✅ Cache hit (${duration}ms): ${!!agent2}`)

    // 测试代理连接（跳过 - 需要实际代理服务器）
    console.log('📊 Test 3: Proxy connection (SKIPPED - no proxy server available)')
    console.log(`✅ Proxy test skipped (would test against 127.0.0.1:8080)`)

    // 测试统计信息
    console.log('📊 Test 4: Connection statistics')
    const stats = connectionManager.getConnectionStats()
    console.log(`✅ Connection stats:`, {
      totalConnections: stats.totalConnections,
      cacheSize: stats.cacheSize,
      aggregateStats: stats.aggregateStats
    })
  } catch (error) {
    console.error('❌ Connection Manager test failed:', error.message)
    throw error
  }
}

/**
 * 📝 测试会话管理器
 */
async function testSessionManager() {
  console.log('\n📝 Testing Session Manager...')

  try {
    // 测试会话创建
    console.log('📊 Test 1: Session creation')
    const session1 = await sessionManager.createSession({
      userId: 'test-user-1',
      accountId: 'test-account-1',
      apiKeyId: 'test-key-1',
      metadata: { test: 'data' }
    })
    console.log(`✅ Session created: ${session1.sessionId}`)

    // 测试会话获取
    console.log('📊 Test 2: Session retrieval')
    const retrievedSession = await sessionManager.getSession(session1.sessionId)
    console.log(`✅ Session retrieved: ${retrievedSession ? 'success' : 'failed'}`)

    // 测试会话更新
    console.log('📊 Test 3: Session update')
    const updatedSession = await sessionManager.updateSession(session1.sessionId, {
      status: 'active',
      metadata: { updated: true }
    })
    console.log(`✅ Session updated: ${updatedSession ? 'success' : 'failed'}`)

    // 测试会话查找
    console.log('📊 Test 4: Session search')
    const sessions = sessionManager.findSessions({
      userId: 'test-user-1'
    })
    console.log(`✅ Sessions found: ${sessions.length}`)

    // 测试会话连接
    console.log('📊 Test 5: Session connection')
    const sessionConnection = await sessionManager.getSessionConnection(session1.sessionId, {
      target: 'api.anthropic.com'
    })
    console.log(`✅ Session connection: ${!!sessionConnection}`)

    // 测试会话统计
    console.log('📊 Test 6: Session statistics')
    const sessionStats = sessionManager.getSessionStats()
    console.log(`✅ Session stats:`, {
      activeSessions: sessionStats.activeSessions,
      cacheSize: sessionStats.cacheSize,
      sessionStats: sessionStats.sessionStats
    })

    // 清理测试会话
    await sessionManager.deleteSession(session1.sessionId)
    console.log(`✅ Test session cleaned up`)
  } catch (error) {
    console.error('❌ Session Manager test failed:', error.message)
    throw error
  }
}

/**
 * 🔄 测试集成功能
 */
async function testIntegration() {
  console.log('\n🔄 Testing Integration...')

  try {
    // 创建测试会话
    const session = await sessionManager.createSession({
      userId: 'integration-user',
      accountId: 'integration-account',
      apiKeyId: 'integration-key'
    })

    // 通过会话获取连接
    console.log('📊 Test 1: Session-based connection')
    const connection = await sessionManager.getSessionConnection(session.sessionId, {
      target: 'api.anthropic.com',
      accountId: 'integration-account'
    })
    console.log(`✅ Session connection established: ${!!connection}`)

    // 测试会话亲和性
    console.log('📊 Test 2: Session affinity')
    const connection2 = await sessionManager.getSessionConnection(session.sessionId, {
      target: 'api.anthropic.com',
      accountId: 'integration-account'
    })
    console.log(`✅ Session affinity maintained: ${connection === connection2}`)

    // 清理
    await sessionManager.deleteSession(session.sessionId)
    console.log(`✅ Integration test cleaned up`)
  } catch (error) {
    console.error('❌ Integration test failed:', error.message)
    throw error
  }
}

/**
 * 🚀 测试并发性能
 */
async function testConcurrentPerformance() {
  console.log('\n🚀 Testing Concurrent Performance...')

  try {
    const concurrentTasks = []

    // 创建并发连接任务
    for (let i = 0; i < TEST_CONFIG.concurrentTests; i++) {
      concurrentTasks.push(async () => {
        const start = Date.now()

        // 创建会话
        const session = await sessionManager.createSession({
          userId: `concurrent-user-${i}`,
          accountId: `concurrent-account-${i}`,
          apiKeyId: `concurrent-key-${i}`
        })

        // 获取连接
        const connection = await connectionManager.getConnectionAgent({
          target: 'api.anthropic.com',
          accountId: `concurrent-account-${i}`,
          sessionId: session.sessionId
        })

        const duration = Date.now() - start

        // 清理
        await sessionManager.deleteSession(session.sessionId)

        return {
          taskId: i,
          duration,
          success: !!(session && connection)
        }
      })
    }

    console.log(`📊 Running ${TEST_CONFIG.concurrentTests} concurrent tasks...`)
    const start = Date.now()
    const results = await Promise.all(concurrentTasks.map((task) => task()))
    const totalDuration = Date.now() - start

    const successful = results.filter((r) => r.success).length
    const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length

    console.log(`✅ Concurrent test completed:`)
    console.log(`  - Total time: ${totalDuration}ms`)
    console.log(`  - Successful tasks: ${successful}/${results.length}`)
    console.log(`  - Average task duration: ${Math.round(avgDuration)}ms`)
  } catch (error) {
    console.error('❌ Concurrent performance test failed:', error.message)
    throw error
  }
}

/**
 * 📊 显示系统状态
 */
async function showSystemStatus() {
  console.log('\n📊 System Status:')

  try {
    // 连接管理器状态
    const connectionStats = connectionManager.getConnectionStats()
    console.log('🔗 Connection Manager:')
    console.log(`  - Active connections: ${connectionStats.totalConnections}`)
    console.log(`  - Cache size: ${connectionStats.cacheSize}`)
    console.log(`  - Cache hits: ${connectionStats.aggregateStats?.totalCacheHits || 0}`)
    console.log(`  - Total errors: ${connectionStats.aggregateStats?.totalErrors || 0}`)

    // 会话管理器状态
    const sessionStats = sessionManager.getSessionStats()
    console.log('📝 Session Manager:')
    console.log(`  - Active sessions: ${sessionStats.activeSessions}`)
    console.log(`  - Persistent sessions: ${sessionStats.persistentSessions}`)
    console.log(`  - Cache size: ${sessionStats.cacheSize}`)
    console.log(`  - Sessions created: ${sessionStats.sessionStats?.created || 0}`)
    console.log(`  - Sessions restored: ${sessionStats.sessionStats?.restored || 0}`)
  } catch (error) {
    console.error('❌ Failed to show system status:', error.message)
  }
}

/**
 * 🎯 主测试函数
 */
async function runTests() {
  console.log('🎯 Starting Connection & Session Manager Integration Tests...')
  console.log(`📋 Test Configuration:`, TEST_CONFIG)

  const startTime = Date.now()

  try {
    // 等待服务初始化
    await new Promise((resolve) => setTimeout(resolve, 2000))

    // 运行测试套件
    await testConnectionManager()
    await testSessionManager()
    await testIntegration()
    await testConcurrentPerformance()

    // 显示最终状态
    await showSystemStatus()

    const totalTime = Date.now() - startTime
    console.log(`\n✅ All tests completed successfully in ${totalTime}ms`)
  } catch (error) {
    console.error('\n❌ Test suite failed:', error)
    process.exit(1)
  }
}

/**
 * 🧹 清理函数
 */
async function cleanup() {
  console.log('\n🧹 Cleaning up test environment...')

  try {
    // 这里可以添加额外的清理逻辑
    console.log('✅ Cleanup completed')
  } catch (error) {
    console.error('❌ Cleanup failed:', error)
  }
}

// 🚀 启动测试
if (require.main === module) {
  // 设置超时
  const timeout = setTimeout(() => {
    console.error('❌ Tests timed out')
    process.exit(1)
  }, TEST_CONFIG.testTimeout)

  // 优雅关闭处理
  process.on('SIGINT', async () => {
    clearTimeout(timeout)
    await cleanup()
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    clearTimeout(timeout)
    await cleanup()
    process.exit(0)
  })

  // 运行测试
  runTests()
    .then(() => {
      clearTimeout(timeout)
      process.exit(0)
    })
    .catch((error) => {
      clearTimeout(timeout)
      console.error('❌ Unhandled test error:', error)
      process.exit(1)
    })
}

module.exports = {
  testConnectionManager,
  testSessionManager,
  testIntegration,
  testConcurrentPerformance,
  runTests
}
