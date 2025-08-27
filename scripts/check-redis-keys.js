/**
 * 检查 Redis 中的所有键
 */

const database = require('../src/models/database')

async function checkRedisKeys() {
  console.log('🔍 检查 Redis 中的所有键...\n')

  try {
    // 数据库会自动初始化和连接

    // 获取所有键
    const allKeys = await database.keys('*')
    console.log(`找到 ${allKeys.length} 个键\n`)

    // 按类型分组
    const keysByType = {}

    allKeys.forEach((key) => {
      const prefix = key.split(':')[0]
      if (!keysByType[prefix]) {
        keysByType[prefix] = []
      }
      keysByType[prefix].push(key)
    })

    // 显示各类型的键
    Object.keys(keysByType)
      .sort()
      .forEach((type) => {
        console.log(`\n📁 ${type}: ${keysByType[type].length} 个`)

        // 显示前 5 个键作为示例
        const keysToShow = keysByType[type].slice(0, 5)
        keysToShow.forEach((key) => {
          console.log(`  - ${key}`)
        })

        if (keysByType[type].length > 5) {
          console.log(`  ... 还有 ${keysByType[type].length - 5} 个`)
        }
      })
  } catch (error) {
    console.error('❌ 错误:', error)
    console.error(error.stack)
  } finally {
    if (typeof database._manager.cleanup === 'function') {
      await database._manager.cleanup()
    }
    process.exit(0)
  }
}

checkRedisKeys()
