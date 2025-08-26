/**
 * @fileoverview 数据库模块统一导出入口
 *
 * 提供数据库抽象层的统一接口，简化模块使用
 * 支持向后兼容和渐进式迁移
 *
 * @author Claude Code
 * @version 1.0.0
 */

const DatabaseAdapter = require('./DatabaseAdapter')
const { DatabaseFactory, databaseFactory, DATABASE_TYPES } = require('./DatabaseFactory')
const logger = require('../../utils/logger')

/**
 * 数据库模块主要接口
 *
 * 提供以下功能：
 * - 统一的数据库访问接口
 * - 工厂模式的适配器创建
 * - 向后兼容的Redis访问
 * - 配置驱动的数据库选择
 */

// 缓存当前数据库实例以提高性能
let currentDatabase = null
let isInitialized = false

/**
 * 初始化数据库模块
 * @param {Object} config 数据库配置
 * @param {string} config.type 数据库类型 (redis|mongodb|mysql|postgresql|sqlite)
 * @param {Object} config.options 数据库连接选项
 * @param {Object} config.fallback 降级配置
 * @returns {Promise<DatabaseAdapter>} 数据库适配器实例
 */
async function initDatabase(config = null) {
  try {
    // 如果没有提供配置，使用默认Redis配置
    const dbConfig = config || {
      type: DATABASE_TYPES.REDIS,
      options: {},
      fallback: {
        enabled: true,
        type: DATABASE_TYPES.REDIS,
        options: {}
      }
    }

    // 初始化工厂
    databaseFactory.init(dbConfig)

    // 创建并连接适配器
    currentDatabase = await databaseFactory.createAdapter()

    // 确保连接成功
    if (typeof currentDatabase.connect === 'function') {
      await currentDatabase.connect()
    }

    isInitialized = true
    logger.info(`🎯 Database module initialized successfully with ${dbConfig.type}`)

    return currentDatabase
  } catch (error) {
    logger.error('❌ Failed to initialize database module:', error)
    throw error
  }
}

/**
 * 获取当前数据库实例
 * @returns {Promise<DatabaseAdapter>} 数据库适配器实例
 */
async function getDatabase() {
  if (!isInitialized || !currentDatabase) {
    // 自动初始化为Redis（保持向后兼容）
    logger.warn('⚠️ Database not initialized, auto-initializing with Redis...')
    await initDatabase()
  }

  return currentDatabase
}

/**
 * 向后兼容的Redis客户端获取
 * @deprecated 建议使用 getDatabase() 方法
 * @returns {Promise<any>} Redis客户端实例
 */
async function getRedisClient() {
  logger.warn('⚠️ getRedisClient() is deprecated, use getDatabase() instead')
  const db = await getDatabase()

  // 如果当前数据库是Redis，返回原始客户端
  if (db && typeof db.getClient === 'function') {
    return db.getClient()
  }

  // 如果不是Redis，抛出警告但尝试返回兼容接口
  logger.warn('⚠️ Current database is not Redis, returning database adapter instead')
  return db
}

/**
 * 切换数据库类型（主要用于测试和迁移）
 * @param {string} type 数据库类型
 * @param {Object} options 连接选项
 * @returns {Promise<DatabaseAdapter>} 新的数据库适配器实例
 */
async function switchDatabase(type, options) {
  logger.info(`🔄 Switching database to ${type}`)

  if (!isInitialized) {
    throw new Error('Database module is not initialized')
  }

  currentDatabase = await databaseFactory.switchAdapter(type, options)
  return currentDatabase
}

/**
 * 获取数据库状态和统计信息
 * @returns {Object} 状态信息
 */
function getDatabaseStatus() {
  return {
    initialized: isInitialized,
    connected: currentDatabase ? currentDatabase.isConnected : false,
    factory: databaseFactory.getStats(),
    currentAdapter: currentDatabase ? currentDatabase.constructor.name : null
  }
}

/**
 * 清理数据库模块
 * @returns {Promise<void>}
 */
async function cleanup() {
  logger.info('🧹 Cleaning up database module...')

  if (currentDatabase && typeof currentDatabase.disconnect === 'function') {
    try {
      await currentDatabase.disconnect()
    } catch (error) {
      logger.warn('⚠️ Error disconnecting current database:', error)
    }
  }

  await databaseFactory.cleanup()

  currentDatabase = null
  isInitialized = false

  logger.info('✅ Database module cleanup completed')
}

// 优雅退出处理
process.on('SIGINT', async () => {
  logger.info('📟 Received SIGINT, cleaning up database connections...')
  await cleanup()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  logger.info('📟 Received SIGTERM, cleaning up database connections...')
  await cleanup()
  process.exit(0)
})

// 主要导出接口
module.exports = {
  // 核心类和接口
  DatabaseAdapter,
  DatabaseFactory,
  DATABASE_TYPES,

  // 工厂实例（单例）
  databaseFactory,

  // 主要方法
  initDatabase,
  getDatabase,
  switchDatabase,
  getDatabaseStatus,
  cleanup,

  // 向后兼容（废弃）
  getRedisClient,

  // 便捷访问常用数据库类型
  REDIS: DATABASE_TYPES.REDIS,
  MONGODB: DATABASE_TYPES.MONGODB,
  MYSQL: DATABASE_TYPES.MYSQL,
  POSTGRESQL: DATABASE_TYPES.POSTGRESQL,
  SQLITE: DATABASE_TYPES.SQLITE
}

// 提供默认的数据库实例导出（向后兼容）
module.exports.default = getDatabase
