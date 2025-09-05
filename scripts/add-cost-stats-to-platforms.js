#!/usr/bin/env node

/**
 * 批量为各平台账户服务添加费用统计方法
 * 这个脚本会为每个平台账户服务添加 getAccountCostStats 方法
 */

const fs = require('fs')
const path = require('path')

// 平台配置
const PLATFORMS = [
  {
    file: 'bedrockAccountService.js',
    platform: 'bedrock',
    serviceName: 'bedrockAccountService'
  },
  {
    file: 'azureOpenaiAccountService.js',
    platform: 'azure_openai',
    serviceName: 'azureOpenaiAccountService'
  },
  {
    file: 'claudeConsoleAccountService.js',
    platform: 'claude-console',
    serviceName: 'claudeConsoleAccountService'
  }
]

// 生成费用统计方法代码
function generateCostStatsMethod(platform, serviceName) {
  return `  // 费用统计方法
  getAccountCostStats: async (accountId, options = {}) => {
    const AccountCostService = require('./accountCostService')
    const { getAccount } = require('./${serviceName}')
    const logger = require('../utils/logger')
    
    try {
      if (!accountId) throw new Error('Account ID is required')
      
      const accountData = await getAccount(accountId)
      if (!accountData) throw new Error('Account not found')
      
      const costStats = await AccountCostService.getAccountCostStats(accountId, '${platform}', options)
      costStats.accountName = accountData.name
      
      logger.debug(\`📊 Retrieved cost stats for ${platform} account \${accountId}: $\${(costStats.totalCost || 0).toFixed(6)} (\${options.period || 'all'})\`)
      
      return costStats
    } catch (error) {
      logger.error(\`❌ Failed to get cost stats for ${platform} account \${accountId}:\`, error)
      throw error
    }
  },`
}

// 处理单个文件
async function processFile(platformConfig) {
  const filePath = path.join(__dirname, '..', 'src', 'services', platformConfig.file)

  if (!fs.existsSync(filePath)) {
    console.log(`⚠️  File not found: ${platformConfig.file}`)
    return
  }

  const content = fs.readFileSync(filePath, 'utf8')

  // 检查是否已经包含费用统计方法
  if (content.includes('getAccountCostStats')) {
    console.log(`✅ ${platformConfig.file} already has cost stats method`)
    return
  }

  // 查找 module.exports 部分的结尾
  const moduleExportsPattern = /module\.exports\s*=\s*{([^}]+)}/s
  const match = content.match(moduleExportsPattern)

  if (!match) {
    console.log(`⚠️  Could not find module.exports in ${platformConfig.file}`)
    return
  }

  const exportsContent = match[1]
  const costStatsMethod = generateCostStatsMethod(
    platformConfig.platform,
    platformConfig.serviceName
  )

  // 在最后一个逗号后插入费用统计方法
  const lastCommaIndex = exportsContent.lastIndexOf(',')
  if (lastCommaIndex === -1) {
    console.log(`⚠️  Could not find exports structure in ${platformConfig.file}`)
    return
  }

  const newExportsContent = `${exportsContent.substring(0, lastCommaIndex + 1)}\n${
    costStatsMethod
  }\n${exportsContent.substring(lastCommaIndex + 1)}`

  const newContent = content.replace(
    /module\.exports\s*=\s*{[^}]+}/s,
    `module.exports = {${newExportsContent}}`
  )

  // 备份原文件
  fs.writeFileSync(`${filePath}.backup`, content)

  // 写入新内容
  fs.writeFileSync(filePath, newContent)

  console.log(`✅ Added cost stats method to ${platformConfig.file}`)
}

// 主函数
async function main() {
  console.log('🚀 Adding cost stats methods to platform account services...')

  for (const platformConfig of PLATFORMS) {
    try {
      await processFile(platformConfig)
    } catch (error) {
      console.error(`❌ Failed to process ${platformConfig.file}:`, error.message)
    }
  }

  console.log('\n✅ Completed adding cost stats methods to all platforms!')
  console.log('\n📝 Next steps:')
  console.log('1. Update admin routes to add cost stats endpoints for all platforms')
  console.log('2. Update frontend to load cost stats for all platforms')
  console.log('3. Test the new cost stats functionality')
}

if (require.main === module) {
  main().catch(console.error)
}
