#!/usr/bin/env node

const costInitService = require('../services/costInitService')
const logger = require('../utils/logger')
const database = require('../models/database')
const config = require('../../config/config')

async function main() {
  try {
    // 连接数据库
    await database.connect()

    // 确保数据库模块初始化
    const { initDatabase } = require('../models/database')
    await initDatabase(config.database)

    console.log('💰 Starting cost data initialization...\n')

    // 执行初始化
    const result = await costInitService.initializeAllCosts()

    console.log('\n✅ Cost initialization completed!')
    console.log(`   Processed: ${result.processed} API Keys`)
    console.log(`   Errors: ${result.errors}`)

    // 断开连接
    await database._manager.cleanup()
    throw new Error('INIT_COSTS_SUCCESS')
  } catch (error) {
    if (error.message === 'INIT_COSTS_SUCCESS') {
      return
    }
    console.error('\n❌ Cost initialization failed:', error.message)
    logger.error('Cost initialization failed:', error)

    // 确保断开数据库连接
    try {
      await database._manager.cleanup()
    } catch (disconnectError) {
      logger.error('Failed to disconnect database:', disconnectError)
    }

    throw error
  }
}

// 运行主函数
main()
