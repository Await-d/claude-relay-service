#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

// 测试定价服务的 fallback 机制
async function testPricingFallback() {
  console.log('🧪 Testing pricing service fallback mechanism...\n')

  const dataDir = path.join(process.cwd(), 'data')
  const pricingFile = path.join(dataDir, 'model_pricing.json')
  const backupFile = path.join(dataDir, 'model_pricing.backup.json')

  if (fs.existsSync(pricingFile)) {
    console.log('📦 Backing up existing pricing file...')
    fs.copyFileSync(pricingFile, backupFile)
  }

  try {
    if (fs.existsSync(pricingFile)) {
      console.log('🗑️  Removing existing pricing file to test fallback...')
      fs.unlinkSync(pricingFile)
    }

    console.log('🚀 Initializing pricing service...\n')

    delete require.cache[require.resolve('../src/services/pricingService')]
    const pricingService = require('../src/services/pricingService')

    const originalDownload = pricingService._downloadFromRemote
    pricingService._downloadFromRemote = function () {
      return Promise.reject(new Error('Simulated network failure for testing'))
    }

    await pricingService.initialize()

    console.log('\n📊 Verifying fallback data...')
    const status = pricingService.getStatus()
    console.log(`   - Initialized: ${status.initialized}`)
    console.log(`   - Model count: ${status.modelCount}`)
    console.log(`   - Last updated: ${status.lastUpdated}`)

    const testModels = ['claude-3-opus-20240229', 'gpt-4', 'gemini-pro']
    console.log('\n💰 Testing model pricing retrieval:')

    for (const model of testModels) {
      const pricing = pricingService.getModelPricing(model)
      if (pricing) {
        console.log(`   ✅ ${model}: Found pricing data`)
      } else {
        console.log(`   ❌ ${model}: No pricing data`)
      }
    }

    if (fs.existsSync(pricingFile)) {
      console.log('\n✅ Fallback successfully created pricing file in data directory')
      const fileStats = fs.statSync(pricingFile)
      console.log(`   - File size: ${(fileStats.size / 1024).toFixed(2)} KB`)
    } else {
      console.log('\n❌ Fallback failed to create pricing file')
    }

    pricingService._downloadFromRemote = originalDownload
  } finally {
    if (fs.existsSync(backupFile)) {
      console.log('\n📦 Restoring original pricing file...')
      fs.copyFileSync(backupFile, pricingFile)
      fs.unlinkSync(backupFile)
    }
  }

  console.log('\n✨ Fallback mechanism test completed!')
}

testPricingFallback().catch((error) => {
  console.error('❌ Test failed:', error)
  process.exit(1)
})
