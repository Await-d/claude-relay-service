#!/usr/bin/env node

/**
 * 批量为所有账户类型添加自动错误恢复功能
 *
 * 使用方法:
 *   node scripts/add-auto-recovery-to-all-accounts.js [--dry-run]
 *
 * 功能:
 *   1. 为所有账户在 Redis 中添加 autoRecoverErrors 和 errorRecoveryDuration 字段
 *   2. 默认值: autoRecoverErrors=false, errorRecoveryDuration=5
 */

const redis = require('../src/models/redis')
const logger = require('../src/utils/logger')

const ACCOUNT_TYPES = [
  { prefix: 'claude_account:', name: 'Claude Official', pattern: 'claude_account:*' },
  { prefix: 'claude_console_account:', name: 'Claude Console', pattern: 'claude_console_account:*' },
  { prefix: 'gemini_account:', name: 'Gemini OAuth', pattern: 'gemini_account:*' },
  { prefix: 'gemini_api_account:', name: 'Gemini API', pattern: 'gemini_api_account:*' },
  { prefix: 'openai_account:', name: 'OpenAI', pattern: 'openai_account:*' },
  { prefix: 'openai_responses_account:', name: 'OpenAI-Responses', pattern: 'openai_responses_account:*' },
  { prefix: 'bedrock_account:', name: 'AWS Bedrock', pattern: 'bedrock_account:*' },
  { prefix: 'azure_openai_account:', name: 'Azure OpenAI', pattern: 'azure_openai_account:*' },
  { prefix: 'droid_account:', name: 'Droid', pattern: 'droid_account:*' },
  { prefix: 'ccr_account:', name: 'CCR', pattern: 'ccr_account:*' }
]

async function addAutoRecoveryFields(dryRun = false) {
  const client = redis.getClient()
  const stats = {
    total: 0,
    updated: 0,
    skipped: 0,
    byType: {}
  }

  logger.info('🚀 开始为所有账户类型添加自动错误恢复字段...')
  if (dryRun) {
    logger.info('📝 DRY RUN 模式 - 不会实际修改数据')
  }

  for (const accountType of ACCOUNT_TYPES) {
    logger.info(`\n📁 处理 ${accountType.name} 账户...`)

    try {
      const keys = await client.keys(accountType.pattern)
      logger.info(`   找到 ${keys.length} 个账户`)

      stats.byType[accountType.name] = {
        total: keys.length,
        updated: 0,
        skipped: 0
      }

      for (const key of keys) {
        const accountData = await client.hgetall(key)
        stats.total++

        // 检查是否已有自动恢复字段
        if (accountData.autoRecoverErrors !== undefined) {
          logger.debug(`   ⏭️  跳过 ${key} - 已有自动恢复配置`)
          stats.skipped++
          stats.byType[accountType.name].skipped++
          continue
        }

        // 添加默认配置
        if (!dryRun) {
          await client.hset(key, {
            autoRecoverErrors: 'false', // 默认禁用，需用户主动启用
            errorRecoveryDuration: '5'  // 默认5分钟
          })
          logger.info(`   ✅ 已更新 ${key}`)
        } else {
          logger.info(`   [DRY RUN] 将更新 ${key}`)
        }

        stats.updated++
        stats.byType[accountType.name].updated++
      }
    } catch (error) {
      logger.error(`   ❌ 处理 ${accountType.name} 时出错:`, error.message)
    }
  }

  // 输出统计信息
  logger.info('\n' + '='.repeat(60))
  logger.info('📊 执行统计:')
  logger.info(`   总账户数: ${stats.total}`)
  logger.info(`   已更新: ${stats.updated}`)
  logger.info(`   已跳过: ${stats.skipped}`)
  logger.info('\n按账户类型统计:')

  for (const [type, typeStats] of Object.entries(stats.byType)) {
    if (typeStats.total > 0) {
      logger.info(`   ${type}:`)
      logger.info(`      总数: ${typeStats.total}`)
      logger.info(`      更新: ${typeStats.updated}`)
      logger.info(`      跳过: ${typeStats.skipped}`)
    }
  }

  logger.info('='.repeat(60))

  if (dryRun) {
    logger.info('\n💡 这是 DRY RUN 模式的结果。要实际执行，请运行:')
    logger.info('   node scripts/add-auto-recovery-to-all-accounts.js')
  } else {
    logger.success('\n✅ 所有账户的自动错误恢复字段已添加完成！')
    logger.info('\n📝 下一步:')
    logger.info('   1. 在 Web 界面中为需要的账户启用"自动错误恢复"')
    logger.info('   2. 设置合适的恢复时间（建议 5-15 分钟）')
    logger.info('   3. 重启服务以应用更改')
  }

  return stats
}

// 主函数
async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')

  try {
    await addAutoRecoveryFields(dryRun)
    process.exit(0)
  } catch (error) {
    logger.error('执行失败:', error)
    process.exit(1)
  }
}

if (require.main === module) {
  main()
}

module.exports = { addAutoRecoveryFields }
