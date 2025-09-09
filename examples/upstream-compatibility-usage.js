/**
 * @fileoverview 上游兼容性桥接器使用示例
 * 
 * 展示如何使用UpstreamCompatibilityBridge来适配上游代码
 * 
 * @author Claude Code
 * @version 1.0.0
 */

const database = require('../src/models/database')
const UpstreamCompatibilityBridge = require('../src/utils/UpstreamCompatibilityBridge')

/**
 * 初始化桥接器示例
 */
async function initializeBridge() {
  console.log('🌉 Initializing UpstreamCompatibilityBridge...')
  
  try {
    // 获取数据库适配器实例
    const dbAdapter = await database.getCurrentAdapter()
    
    // 创建桥接器实例
    const bridge = new UpstreamCompatibilityBridge(dbAdapter)
    
    console.log('✅ Bridge initialized successfully')
    return bridge
    
  } catch (error) {
    console.error('❌ Failed to initialize bridge:', error)
    throw error
  }
}

/**
 * 基础Redis操作示例
 */
async function basicRedisOperationsExample(bridge) {
  console.log('\n📋 Testing Basic Redis Operations...')
  
  try {
    // 设置键值
    await bridge.set('test:key1', 'Hello World')
    console.log('✅ SET operation successful')
    
    // 获取键值
    const value = await bridge.get('test:key1')
    console.log('✅ GET operation successful:', value)
    
    // 设置带过期时间的键值
    await bridge.setex('test:key2', 60, 'Expires in 60 seconds')
    console.log('✅ SETEX operation successful')
    
    // 检查键是否存在
    const exists = await bridge.exists('test:key1')
    console.log('✅ EXISTS operation successful:', exists)
    
    // 获取TTL
    const ttl = await bridge.ttl('test:key2')
    console.log('✅ TTL operation successful:', ttl)
    
    // 删除键
    const deleted = await bridge.del('test:key1', 'test:key2')
    console.log('✅ DEL operation successful, deleted:', deleted)
    
  } catch (error) {
    console.error('❌ Basic Redis operations failed:', error)
  }
}

/**
 * Hash操作示例
 */
async function hashOperationsExample(bridge) {
  console.log('\n📦 Testing Hash Operations...')
  
  try {
    // 设置Hash字段
    await bridge.hset('test:hash', 'field1', 'value1', 'field2', 'value2')
    console.log('✅ HSET operation successful')
    
    // 获取Hash字段
    const fieldValue = await bridge.hget('test:hash', 'field1')
    console.log('✅ HGET operation successful:', fieldValue)
    
    // 获取Hash所有字段
    const allFields = await bridge.hgetall('test:hash')
    console.log('✅ HGETALL operation successful:', allFields)
    
    // Hash字段递增
    await bridge.hincrby('test:hash', 'counter', 5)
    const counterValue = await bridge.hget('test:hash', 'counter')
    console.log('✅ HINCRBY operation successful:', counterValue)
    
    // 删除Hash字段
    const deletedFields = await bridge.hdel('test:hash', 'field1', 'field2')
    console.log('✅ HDEL operation successful, deleted:', deletedFields)
    
    // 清理
    await bridge.del('test:hash')
    
  } catch (error) {
    console.error('❌ Hash operations failed:', error)
  }
}

/**
 * API Key管理示例
 */
async function apiKeyManagementExample(bridge) {
  console.log('\n🔑 Testing API Key Management...')
  
  try {
    // 创建测试API Key数据
    const keyId = 'test-key-' + Date.now()
    const keyData = {
      name: 'Test Key',
      description: 'Test API Key for bridge example',
      tokenLimit: '1000',
      isActive: 'true',
      createdAt: new Date().toISOString()
    }
    const hashedKey = 'hashed_' + keyId
    
    // 保存API Key
    await bridge.setApiKey(keyId, keyData, hashedKey)
    console.log('✅ API Key saved successfully')
    
    // 获取API Key
    const retrievedKey = await bridge.getApiKey(keyId)
    console.log('✅ API Key retrieved:', retrievedKey?.name)
    
    // 根据哈希查找API Key
    const foundKey = await bridge.findApiKeyByHash(hashedKey)
    console.log('✅ API Key found by hash:', foundKey?.name)
    
    // 获取所有API Keys
    const allKeys = await bridge.getAllApiKeys()
    console.log('✅ Total API Keys count:', allKeys.length)
    
    // 删除测试API Key
    await bridge.deleteApiKey(keyId)
    console.log('✅ Test API Key deleted')
    
  } catch (error) {
    console.error('❌ API Key management failed:', error)
  }
}

/**
 * 批量操作示例
 */
async function batchOperationsExample(bridge) {
  console.log('\n📊 Testing Batch Operations...')
  
  try {
    // 批量设置键值
    await bridge.mset(
      'batch:key1', 'value1',
      'batch:key2', 'value2',
      'batch:key3', 'value3'
    )
    console.log('✅ MSET operation successful')
    
    // 批量获取键值
    const values = await bridge.mget('batch:key1', 'batch:key2', 'batch:key3')
    console.log('✅ MGET operation successful:', values)
    
    // 管道操作示例
    const pipeline = bridge.pipeline()
    pipeline.set('pipeline:key1', 'value1')
    pipeline.set('pipeline:key2', 'value2')
    pipeline.get('pipeline:key1')
    
    const pipelineResults = await bridge.exec(pipeline)
    console.log('✅ Pipeline operations successful:', pipelineResults)
    
    // 清理
    await bridge.del('batch:key1', 'batch:key2', 'batch:key3', 'pipeline:key1', 'pipeline:key2')
    
  } catch (error) {
    console.error('❌ Batch operations failed:', error)
  }
}

/**
 * 性能监控示例
 */
async function performanceMonitoringExample(bridge) {
  console.log('\n📈 Testing Performance Monitoring...')
  
  try {
    // 重置统计信息
    bridge.resetStats()
    
    // 执行一些操作来生成统计数据
    for (let i = 0; i < 10; i++) {
      await bridge.set(`perf:key${i}`, `value${i}`)
      await bridge.get(`perf:key${i}`)
    }
    
    // 获取统计信息
    const stats = bridge.getStats()
    console.log('✅ Bridge Statistics:')
    console.log('   Total Calls:', stats.totalCalls)
    console.log('   Success Rate:', stats.successRate)
    console.log('   Average Response Time:', stats.averageResponseTime)
    console.log('   Calls by Method:', JSON.stringify(stats.callsByMethod, null, 2))
    
    // 获取性能报告
    const performanceReport = bridge.getPerformanceReport()
    console.log('✅ Performance Report:')
    console.log('   Average Time:', performanceReport.averageTime)
    console.log('   Median Time:', performanceReport.medianTime)
    
    // 清理
    for (let i = 0; i < 10; i++) {
      await bridge.del(`perf:key${i}`)
    }
    
  } catch (error) {
    console.error('❌ Performance monitoring failed:', error)
  }
}

/**
 * 上游代码适配示例
 */
async function upstreamCodeAdaptationExample(bridge) {
  console.log('\n🔄 Testing Upstream Code Adaptation...')
  
  try {
    // 模拟上游代码的Redis调用方式
    
    // 1. API Key存储（上游方式）
    const keyId = 'upstream-key-example'
    const apiKeyData = {
      name: 'Upstream API Key',
      tokenLimit: '2000',
      isActive: 'true',
      createdAt: new Date().toISOString()
    }
    
    // 上游代码通常会这样调用：
    await bridge.hset(`api_key:${keyId}`, 
      'name', apiKeyData.name,
      'tokenLimit', apiKeyData.tokenLimit,
      'isActive', apiKeyData.isActive,
      'createdAt', apiKeyData.createdAt
    )
    
    // 2. 使用统计（上游方式）
    const usageKey = `usage:daily:${keyId}:${new Date().toISOString().split('T')[0]}`
    await bridge.hincrby(usageKey, 'inputTokens', 100)
    await bridge.hincrby(usageKey, 'outputTokens', 50)
    
    // 3. 成本统计（上游方式）
    const costKey = `cost:daily:${keyId}:${new Date().toISOString().split('T')[0]}`
    await bridge.set(costKey, '0.015', 'EX', 86400) // 24小时过期
    
    // 4. 会话管理（上游方式）
    const sessionToken = 'session_' + Date.now()
    const sessionData = JSON.stringify({
      userId: 'user123',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString() // 1小时后过期
    })
    await bridge.setex(`session:${sessionToken}`, 3600, sessionData)
    
    // 验证数据
    const retrievedApiKey = await bridge.hgetall(`api_key:${keyId}`)
    const retrievedUsage = await bridge.hgetall(usageKey)
    const retrievedCost = await bridge.get(costKey)
    const retrievedSession = await bridge.get(`session:${sessionToken}`)
    
    console.log('✅ Upstream Code Adaptation Results:')
    console.log('   API Key:', retrievedApiKey.name)
    console.log('   Usage Stats:', `${retrievedUsage.inputTokens} input, ${retrievedUsage.outputTokens} output tokens`)
    console.log('   Daily Cost:', retrievedCost)
    console.log('   Session Stored:', retrievedSession ? 'Yes' : 'No')
    
    // 清理
    await bridge.del(`api_key:${keyId}`, usageKey, costKey, `session:${sessionToken}`)
    
  } catch (error) {
    console.error('❌ Upstream code adaptation failed:', error)
  }
}

/**
 * 主函数 - 运行所有示例
 */
async function main() {
  console.log('🚀 UpstreamCompatibilityBridge Usage Examples')
  console.log('=' .repeat(60))
  
  try {
    // 初始化桥接器
    const bridge = await initializeBridge()
    
    // 运行各种示例
    await basicRedisOperationsExample(bridge)
    await hashOperationsExample(bridge)
    await apiKeyManagementExample(bridge)
    await batchOperationsExample(bridge)
    await performanceMonitoringExample(bridge)
    await upstreamCodeAdaptationExample(bridge)
    
    // 最终统计
    console.log('\n📊 Final Bridge Statistics:')
    console.log(JSON.stringify(bridge.getStats(), null, 2))
    
    console.log('\n✅ All examples completed successfully!')
    
  } catch (error) {
    console.error('❌ Examples failed:', error)
    process.exit(1)
  }
}

// 如果直接运行此脚本，执行示例
if (require.main === module) {
  main().catch(console.error)
}

module.exports = {
  initializeBridge,
  basicRedisOperationsExample,
  hashOperationsExample,
  apiKeyManagementExample,
  batchOperationsExample,
  performanceMonitoringExample,
  upstreamCodeAdaptationExample
}