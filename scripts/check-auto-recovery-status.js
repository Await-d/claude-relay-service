#!/usr/bin/env node

/**
 * 检查所有账户类型的自动错误恢复功能实现状态
 *
 * 使用方法:
 *   node scripts/check-auto-recovery-status.js
 */

const redis = require('../src/models/redis')
const logger = require('../src/utils/logger')
const fs = require('fs')
const path = require('path')

const ACCOUNT_TYPES = [
  {
    name: 'Claude Official',
    pattern: 'claude_account:*',
    service: 'claudeAccountService.js',
    relay: 'claudeRelayService.js'
  },
  {
    name: 'Claude Console',
    pattern: 'claude_console_account:*',
    service: 'claudeConsoleAccountService.js',
    relay: 'claudeConsoleRelayService.js'
  },
  {
    name: 'Gemini OAuth',
    pattern: 'gemini_account:*',
    service: 'geminiAccountService.js',
    relay: 'geminiRelayService.js'
  },
  {
    name: 'Gemini API',
    pattern: 'gemini_api_account:*',
    service: 'geminiApiAccountService.js',
    relay: 'geminiRelayService.js'
  },
  {
    name: 'OpenAI',
    pattern: 'openai_account:*',
    service: 'openaiAccountService.js',
    relay: null
  },
  {
    name: 'OpenAI-Responses',
    pattern: 'openai_responses_account:*',
    service: 'openaiResponsesAccountService.js',
    relay: 'openaiResponsesRelayService.js'
  },
  {
    name: 'AWS Bedrock',
    pattern: 'bedrock_account:*',
    service: 'bedrockAccountService.js',
    relay: 'bedrockRelayService.js'
  },
  {
    name: 'Azure OpenAI',
    pattern: 'azure_openai_account:*',
    service: 'azureOpenaiAccountService.js',
    relay: 'azureOpenaiRelayService.js'
  },
  {
    name: 'Droid',
    pattern: 'droid_account:*',
    service: 'droidAccountService.js',
    relay: 'droidRelayService.js'
  },
  {
    name: 'CCR',
    pattern: 'ccr_account:*',
    service: 'ccrAccountService.js',
    relay: 'ccrRelayService.js'
  }
]

function checkServiceFile(filename, checks) {
  const filePath = path.join(__dirname, '../src/services', filename)

  if (!fs.existsSync(filePath)) {
    return { exists: false }
  }

  const content = fs.readFileSync(filePath, 'utf-8')
  const results = { exists: true }

  for (const [key, pattern] of Object.entries(checks)) {
    results[key] = content.includes(pattern)
  }

  return results
}

async function checkRedisAccounts(pattern) {
  const client = redis.getClient()
  const keys = await client.keys(pattern)

  const stats = {
    total: keys.length,
    withAutoRecovery: 0,
    enabled: 0,
    disabled: 0
  }

  for (const key of keys) {
    const data = await client.hgetall(key)

    if (data.autoRecoverErrors !== undefined) {
      stats.withAutoRecovery++

      if (data.autoRecoverErrors === 'true') {
        stats.enabled++
      } else {
        stats.disabled++
      }
    }
  }

  return stats
}

async function main() {
  logger.info('🔍 检查所有账户类型的自动错误恢复功能状态...\n')

  const table = []

  for (const type of ACCOUNT_TYPES) {
    // 检查服务文件
    const serviceCheck = checkServiceFile(type.service, {
      hasAutoRecoverField: 'autoRecoverErrors',
      hasCheckMethod: 'checkAndClearErrorStatus',
      hasErrorRecoveryHelper: 'errorRecoveryHelper'
    })

    const relayCheck = type.relay
      ? checkServiceFile(type.relay, {
          hasNetworkErrorHandling: 'ECONNREFUSED',
          hasErrorRecoveryHelper: 'errorRecoveryHelper'
        })
      : { exists: false, hasNetworkErrorHandling: false, hasErrorRecoveryHelper: false }

    // 检查 Redis 账户
    const redisStats = await checkRedisAccounts(type.pattern)

    table.push({
      name: type.name,
      total: redisStats.total,
      configured: redisStats.withAutoRecovery,
      enabled: redisStats.enabled,
      serviceImpl: serviceCheck.hasAutoRecoverField && serviceCheck.hasCheckMethod,
      relayImpl: !type.relay || relayCheck.hasErrorRecoveryHelper,
      status:
        serviceCheck.hasAutoRecoverField && (!type.relay || relayCheck.hasErrorRecoveryHelper)
          ? '✅ 完整'
          : redisStats.withAutoRecovery > 0
            ? '⚠️  部分'
            : '❌ 未实现'
    })
  }

  // 输出表格
  console.log(`┌─${'─'.repeat(78)}─┐`)
  console.log('│ 账户类型           │ 总数 │ 已配置 │ 已启用 │ Service │ Relay │ 状态      │')
  console.log(`├─${'─'.repeat(78)}─┤`)

  for (const row of table) {
    console.log(
      `│ ${row.name.padEnd(17)} │ ${String(row.total).padStart(4)} │ ${String(row.configured).padStart(6)} │ ${String(row.enabled).padStart(6)} │ ${row.serviceImpl ? '   ✅   ' : '   ❌   '} │ ${row.relayImpl ? '  ✅  ' : '  ❌  '} │ ${row.status.padEnd(9)} │`
    )
  }

  console.log(`└─${'─'.repeat(78)}─┘`)

  // 汇总统计
  const totalAccounts = table.reduce((sum, row) => sum + row.total, 0)
  const fullyImplemented = table.filter((row) => row.status === '✅ 完整').length
  const partiallyImplemented = table.filter((row) => row.status === '⚠️  部分').length
  const notImplemented = table.filter((row) => row.status === '❌ 未实现').length

  logger.info('\n📊 汇总统计:')
  logger.info(`   总账户类型: ${ACCOUNT_TYPES.length}`)
  logger.info(`   完整实现: ${fullyImplemented}`)
  logger.info(`   部分实现: ${partiallyImplemented}`)
  logger.info(`   未实现: ${notImplemented}`)
  logger.info(`   总账户数: ${totalAccounts}`)

  if (notImplemented > 0 || partiallyImplemented > 0) {
    logger.info('\n💡 建议:')
    logger.info('   运行以下命令为所有账户添加配置字段:')
    logger.info('   node scripts/add-auto-recovery-to-all-accounts.js --dry-run')
    logger.info('   node scripts/add-auto-recovery-to-all-accounts.js')
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error('检查失败:', error)
      process.exit(1)
    })
}

module.exports = { ACCOUNT_TYPES, checkServiceFile, checkRedisAccounts }
