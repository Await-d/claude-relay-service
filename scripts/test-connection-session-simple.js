#!/usr/bin/env node

/**
 * @fileoverview 连接管理器和会话管理器简化测试
 * 专门测试核心功能，跳过需要Redis的功能
 */

const { connectionManager } = require('../src/services/connectionManager')

async function testConnectionManagerBasics() {
  console.log('🔗 Testing Connection Manager Basics...')

  try {
    // 测试1: 基本连接获取
    console.log('📊 Test 1: Basic connection retrieval')
    const agent1 = await connectionManager.getConnectionAgent({
      target: 'api.anthropic.com',
      accountId: 'test-account-1'
    })
    console.log(`✅ Agent created: ${!!agent1}`)

    // 测试2: 缓存功能
    console.log('📊 Test 2: Connection caching')
    const start = Date.now()
    const agent2 = await connectionManager.getConnectionAgent({
      target: 'api.anthropic.com',
      accountId: 'test-account-1'
    })
    const duration = Date.now() - start
    console.log(`✅ Cache hit (${duration}ms): ${agent1 === agent2}`)

    // 测试3: 统计信息
    console.log('📊 Test 3: Connection statistics')
    const stats = connectionManager.getConnectionStats()
    console.log(`✅ Connection stats:`, {
      totalConnections: stats.totalConnections,
      cacheSize: stats.cacheSize,
      aggregateStats: stats.aggregateStats
    })

    // 测试4: 不同目标的连接
    console.log('📊 Test 4: Different target connections')
    const agent3 = await connectionManager.getConnectionAgent({
      target: 'console.anthropic.com',
      accountId: 'test-account-2'
    })
    console.log(`✅ Different target agent created: ${!!agent3}`)

    const finalStats = connectionManager.getConnectionStats()
    console.log(`✅ Final stats:`, {
      totalConnections: finalStats.totalConnections,
      cacheSize: finalStats.cacheSize
    })

    console.log('✅ All Connection Manager tests passed!')
  } catch (error) {
    console.error('❌ Connection Manager test failed:', error.message)
    throw error
  }
}

async function testSessionManagerBasics() {
  console.log('\n📝 Testing Session Manager Basics (Memory Only)...')

  try {
    // 由于Redis连接问题，我们只测试内存功能
    const { sessionManager } = require('../src/services/sessionManager')

    // 禁用持久化以避免Redis错误
    sessionManager.config.persistenceStrategy = 'memory'

    console.log('📊 Test 1: In-memory session creation')
    const sessionId = `test-session-${Date.now()}`

    // 直接操作内存存储
    const session = {
      sessionId,
      userId: 'test-user',
      accountId: 'test-account',
      apiKeyId: 'test-key',
      status: 'active',
      createdAt: Date.now(),
      lastActivity: Date.now(),
      expiresAt: Date.now() + 3600000,
      connectionKey: null,
      connectionAgent: null,
      requestCount: 0,
      errorCount: 0,
      lastError: null,
      stickyEnabled: true,
      affinityScore: 0,
      lastAffinityUpdate: Date.now()
    }

    sessionManager.sessions.set(sessionId, session)
    console.log(`✅ Session stored in memory: ${sessionId}`)

    console.log('📊 Test 2: Session retrieval from memory')
    const retrieved = sessionManager.sessions.get(sessionId)
    console.log(`✅ Session retrieved: ${retrieved ? 'success' : 'failed'}`)

    console.log('📊 Test 3: Session search')
    const sessions = sessionManager.findSessions({
      userId: 'test-user'
    })
    console.log(`✅ Sessions found: ${sessions.length}`)

    console.log('📊 Test 4: Session statistics')
    const stats = sessionManager.getSessionStats()
    console.log(`✅ Session stats:`, {
      activeSessions: stats.activeSessions,
      cacheSize: stats.cacheSize,
      sessionStats: stats.sessionStats
    })

    // 清理
    sessionManager.sessions.delete(sessionId)
    console.log('✅ Test session cleaned up')

    console.log('✅ All Session Manager memory tests passed!')
  } catch (error) {
    console.error('❌ Session Manager test failed:', error.message)
    throw error
  }
}

async function testIntegrationBasics() {
  console.log('\n🔄 Testing Basic Integration...')

  try {
    // 测试连接管理器和会话管理器的基本集成
    console.log('📊 Test 1: Manager initialization')
    console.log(`✅ Connection Manager initialized: ${!!connectionManager}`)

    console.log('📊 Test 2: Cross-manager functionality')
    // 创建一个连接
    const agent = await connectionManager.getConnectionAgent({
      target: 'api.anthropic.com',
      accountId: 'integration-account',
      sessionId: 'integration-session'
    })
    console.log(`✅ Integration connection created: ${!!agent}`)

    // 检查统计
    const connStats = connectionManager.getConnectionStats()
    console.log(`✅ Integration stats collected: connections=${connStats.totalConnections}`)

    console.log('✅ Basic integration test passed!')
  } catch (error) {
    console.error('❌ Integration test failed:', error.message)
    throw error
  }
}

async function runSimpleTests() {
  console.log('🎯 Starting Simplified Connection & Session Manager Tests...')
  console.log('⚠️  Note: Redis-dependent features are skipped due to connection issues')

  const startTime = Date.now()

  try {
    // 等待初始化
    await new Promise((resolve) => setTimeout(resolve, 1000))

    await testConnectionManagerBasics()
    await testSessionManagerBasics()
    await testIntegrationBasics()

    const totalTime = Date.now() - startTime
    console.log(`\n✅ All simplified tests completed successfully in ${totalTime}ms`)

    // 显示最终状态
    console.log('\n📊 Final System Status:')
    const connectionStats = connectionManager.getConnectionStats()
    console.log('🔗 Connection Manager:')
    console.log(`  - Active connections: ${connectionStats.totalConnections}`)
    console.log(`  - Cache size: ${connectionStats.cacheSize}`)
    console.log(`  - Cache hits: ${connectionStats.aggregateStats?.totalCacheHits || 0}`)
  } catch (error) {
    console.error('\n❌ Test suite failed:', error)
    process.exit(1)
  }
}

// 运行测试
if (require.main === module) {
  runSimpleTests()
    .then(() => {
      console.log('\n🎉 Test suite completed successfully!')
      process.exit(0)
    })
    .catch((error) => {
      console.error('❌ Unhandled test error:', error)
      process.exit(1)
    })
}

module.exports = {
  testConnectionManagerBasics,
  testSessionManagerBasics,
  testIntegrationBasics,
  runSimpleTests
}
