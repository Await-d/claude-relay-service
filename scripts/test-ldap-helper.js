#!/usr/bin/env node

/**
 * @fileoverview LDAP Helper Test Script
 *
 * 测试脚本展示LDAP Helper的基本功能
 * 用于验证LDAP连接、认证和用户同步功能
 *
 * 使用方法:
 * node scripts/test-ldap-helper.js
 */

const ldapHelper = require('../src/utils/ldapHelper')
const logger = require('../src/utils/logger')

// 示例LDAP配置
const EXAMPLE_LDAP_CONFIG = {
  // LDAP服务器配置
  url: 'ldap://localhost:389', // 替换为实际的LDAP服务器地址

  // 管理员绑定信息（用于搜索用户）
  bindDN: 'cn=admin,dc=example,dc=com',
  bindPassword: 'admin_password',

  // 搜索配置
  baseDN: 'ou=users,dc=example,dc=com',
  groupBaseDN: 'ou=groups,dc=example,dc=com',

  // 用户属性配置
  usernameAttribute: 'uid', // 用户名属性
  userAttributes: [
    // 要获取的用户属性
    'uid',
    'cn',
    'mail',
    'givenName',
    'sn',
    'displayName',
    'telephoneNumber',
    'ou',
    'title'
  ],

  // 属性映射配置
  attributeMapping: {
    username: 'uid',
    email: 'mail',
    firstName: 'givenName',
    lastName: 'sn',
    displayName: 'cn',
    phone: 'telephoneNumber',
    department: 'ou',
    title: 'title'
  },

  // 组映射配置
  groupMapping: {
    admin: 'administrator',
    users: 'standard_user',
    developers: {
      name: 'developer',
      role: 'dev',
      permissions: ['read', 'write', 'debug']
    },
    '*': true // 默认映射：保持原组名
  },

  // 代理配置（可选）
  proxy: null,
  // proxy: {
  //   type: 'socks5',
  //   host: '127.0.0.1',
  //   port: 1080,
  //   username: 'proxy_user',
  //   password: 'proxy_password'
  // },

  // TLS配置（可选）
  tlsOptions: {
    rejectUnauthorized: false // 开发环境可设为false，生产环境建议true
  }
}

/**
 * 测试LDAP连接
 */
async function testConnection() {
  logger.info('🔍 Testing LDAP connection...')

  try {
    const result = await ldapHelper.testConnection(EXAMPLE_LDAP_CONFIG)

    if (result.success) {
      logger.success('LDAP connection test passed!', {
        duration: result.duration,
        server: result.server,
        connection: result.connection
      })
    } else {
      logger.error('LDAP connection test failed:', {
        error: result.error,
        duration: result.duration
      })
    }

    return result.success
  } catch (error) {
    logger.error('Connection test error:', error)
    return false
  }
}

/**
 * 测试用户认证
 */
async function testAuthentication() {
  logger.info('🔐 Testing LDAP authentication...')

  // 示例用户凭据（请替换为实际的测试用户）
  const testCredentials = [
    { username: 'testuser1', password: 'password123' },
    { username: 'john.doe', password: 'secret456' }
  ]

  for (const cred of testCredentials) {
    try {
      logger.info(`Testing authentication for user: ${cred.username}`)

      const result = await ldapHelper.authenticateLDAP(
        cred.username,
        cred.password,
        EXAMPLE_LDAP_CONFIG,
        {
          retrieveUserInfo: true, // 获取用户详细信息
          retrieveGroups: true // 获取用户组信息
        }
      )

      if (result.success) {
        logger.success(`Authentication successful for ${cred.username}`, {
          userDN: result.userDN,
          groupCount: result.groups?.length || 0,
          duration: result.duration
        })

        // 显示用户信息
        if (result.userInfo?.attributes) {
          logger.info('User attributes:', result.userInfo.attributes)
        }

        // 显示用户组
        if (result.groups?.length > 0) {
          logger.info(
            'User groups:',
            result.groups.map((g) => g.name || g.dn)
          )
        }
      } else {
        logger.warn(`Authentication failed for ${cred.username}:`, result.error)
      }
    } catch (error) {
      logger.error(`Authentication error for ${cred.username}:`, error)
    }
  }
}

/**
 * 测试用户同步
 */
async function testUserSync() {
  logger.info('👤 Testing LDAP user sync...')

  // 模拟LDAP用户数据
  const mockLdapUser = {
    dn: 'uid=testuser,ou=users,dc=example,dc=com',
    attributes: {
      uid: 'testuser',
      cn: 'Test User',
      mail: 'testuser@example.com',
      givenName: 'Test',
      sn: 'User',
      displayName: 'Test User',
      telephoneNumber: '+1-555-0123',
      ou: 'Engineering',
      title: 'Software Developer',
      memberOf: [
        'cn=developers,ou=groups,dc=example,dc=com',
        'cn=users,ou=groups,dc=example,dc=com'
      ]
    },
    groups: [
      { dn: 'cn=developers,ou=groups,dc=example,dc=com', name: 'developers' },
      { dn: 'cn=users,ou=groups,dc=example,dc=com', name: 'users' }
    ]
  }

  try {
    const syncResult = await ldapHelper.syncLDAPUser(mockLdapUser, EXAMPLE_LDAP_CONFIG, {
      requiredFields: ['username', 'email']
    })

    logger.success('User sync completed successfully', {
      username: syncResult.user.username,
      email: syncResult.user.email,
      groupCount: syncResult.groups.length,
      duration: syncResult.metadata.syncDuration
    })

    logger.info('Synced user data:', {
      user: syncResult.user,
      groups: syncResult.groups
    })

    return syncResult
  } catch (error) {
    logger.error('User sync failed:', error)
    return null
  }
}

/**
 * 测试统计信息
 */
function testStats() {
  logger.info('📊 LDAP Helper Statistics:')

  const stats = ldapHelper.getStats()
  logger.info('Current stats:', stats)

  return stats
}

/**
 * 主测试函数
 */
async function runTests() {
  logger.start('Starting LDAP Helper Tests')

  const results = {
    connection: false,
    authentication: false,
    userSync: false,
    stats: null
  }

  try {
    // 1. 测试连接
    logger.info('\n=== Phase 1: Connection Test ===')
    results.connection = await testConnection()

    // 如果连接失败，跳过其他测试
    if (!results.connection) {
      logger.warn('Skipping further tests due to connection failure')
      logger.warn('Please check LDAP configuration in EXAMPLE_LDAP_CONFIG')
      return results
    }

    // 2. 测试认证
    logger.info('\n=== Phase 2: Authentication Test ===')
    await testAuthentication()
    results.authentication = true

    // 3. 测试用户同步
    logger.info('\n=== Phase 3: User Sync Test ===')
    const syncResult = await testUserSync()
    results.userSync = Boolean(syncResult)

    // 4. 显示统计信息
    logger.info('\n=== Phase 4: Statistics ===')
    results.stats = testStats()
  } catch (error) {
    logger.error('Test execution error:', error)
  } finally {
    // 清理资源
    logger.info('\n=== Cleanup ===')
    await ldapHelper.cleanup()
    logger.success('Tests completed')
  }

  // 测试结果汇总
  logger.info('\n=== Test Summary ===')
  logger.info('Results:', {
    connection: results.connection ? '✅ PASS' : '❌ FAIL',
    authentication: results.authentication ? '✅ PASS' : '❌ FAIL',
    userSync: results.userSync ? '✅ PASS' : '❌ FAIL',
    hasStats: results.stats ? '✅ PASS' : '❌ FAIL'
  })

  return results
}

// 运行测试
if (require.main === module) {
  runTests()
    .then((results) => {
      const success = Boolean(results.connection)
      process.exit(success ? 0 : 1)
    })
    .catch((error) => {
      logger.error('Unhandled test error:', error)
      process.exit(1)
    })
}

module.exports = {
  runTests,
  testConnection,
  testAuthentication,
  testUserSync,
  testStats,
  EXAMPLE_LDAP_CONFIG
}
