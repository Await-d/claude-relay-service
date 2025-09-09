/**
 * @fileoverview Test Suite Runner
 * 
 * Comprehensive test runner for user management system
 * Runs all test categories and generates coverage reports
 * 
 * @author Claude Code
 */

const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

console.log('🧪 Starting User Management System Test Suite')
console.log('=============================================\n')

// Test categories
const testCategories = [
  {
    name: 'Unit Tests - User Service',
    path: 'test/unit/userService.test.js',
    description: '用户服务单元测试 - 认证流程、CRUD操作、会话管理'
  },
  {
    name: 'Middleware Tests - Authentication',
    path: 'test/middleware/userAuth.test.js',
    description: '认证中间件测试 - 双重认证、权限控制、API Key兼容'
  },
  {
    name: 'Integration Tests - User Management',
    path: 'test/integration/userManagement.test.js',
    description: '集成测试 - 端到端流程、组调度、系统集成'
  },
  {
    name: 'Frontend Tests - Vue Components',
    path: 'test/frontend/userComponents.test.js',
    description: '前端组件测试 - Vue组件、UI交互、响应式设计 (需要单独运行)'
  }
]

// Test results
const results = {
  categories: [],
  totalTests: 0,
  passedTests: 0,
  failedTests: 0,
  coverage: null,
  startTime: new Date(),
  endTime: null,
  duration: 0
}

// Helper function to run Jest tests
function runJestTests(testPath, categoryName) {
  console.log(`\n📋 Running ${categoryName}...`)
  console.log(`   Path: ${testPath}`)
  
  try {
    const output = execSync(`npx jest ${testPath} --verbose --json`, {
      encoding: 'utf8',
      cwd: process.cwd(),
      stdio: 'pipe'
    })

    // Parse Jest output
    const testResult = JSON.parse(output)
    
    const categoryResult = {
      name: categoryName,
      path: testPath,
      success: testResult.success,
      numTotalTests: testResult.numTotalTests,
      numPassedTests: testResult.numPassedTests,
      numFailedTests: testResult.numFailedTests,
      testResults: testResult.testResults
    }

    results.categories.push(categoryResult)
    results.totalTests += testResult.numTotalTests
    results.passedTests += testResult.numPassedTests
    results.failedTests += testResult.numFailedTests

    console.log(`   ✅ ${testResult.numPassedTests} passed`)
    if (testResult.numFailedTests > 0) {
      console.log(`   ❌ ${testResult.numFailedTests} failed`)
    }
    console.log(`   📊 Total: ${testResult.numTotalTests} tests`)

    return true
  } catch (error) {
    console.log(`   ❌ Test execution failed:`)
    console.log(`   ${error.message}`)
    
    results.categories.push({
      name: categoryName,
      path: testPath,
      success: false,
      error: error.message,
      numTotalTests: 0,
      numPassedTests: 0,
      numFailedTests: 0
    })

    return false
  }
}

// Run coverage report
function generateCoverageReport() {
  console.log('\n📊 Generating Coverage Report...')
  
  try {
    const coverageOutput = execSync('npx jest --coverage --json', {
      encoding: 'utf8',
      cwd: process.cwd(),
      stdio: 'pipe'
    })

    // Parse coverage data
    const coverageData = JSON.parse(coverageOutput)
    
    if (coverageData.coverageMap) {
      const summary = coverageData.coverageMap.getCoverageSummary()
      
      results.coverage = {
        lines: {
          total: summary.lines.total,
          covered: summary.lines.covered,
          pct: summary.lines.pct
        },
        functions: {
          total: summary.functions.total,
          covered: summary.functions.covered,
          pct: summary.functions.pct
        },
        branches: {
          total: summary.branches.total,
          covered: summary.branches.covered,
          pct: summary.branches.pct
        },
        statements: {
          total: summary.statements.total,
          covered: summary.statements.covered,
          pct: summary.statements.pct
        }
      }

      console.log('   Coverage Summary:')
      console.log(`   📈 Lines: ${summary.lines.pct}% (${summary.lines.covered}/${summary.lines.total})`)
      console.log(`   🔧 Functions: ${summary.functions.pct}% (${summary.functions.covered}/${summary.functions.total})`)
      console.log(`   🌿 Branches: ${summary.branches.pct}% (${summary.branches.covered}/${summary.branches.total})`)
      console.log(`   📝 Statements: ${summary.statements.pct}% (${summary.statements.covered}/${summary.statements.total})`)
    }

    console.log('\n   💾 Coverage report saved to: coverage/lcov-report/index.html')
    return true
  } catch (error) {
    console.log(`   ❌ Coverage generation failed: ${error.message}`)
    return false
  }
}

// Main test execution
async function runTestSuite() {
  try {
    console.log('🚀 Initializing test environment...\n')

    // Ensure test directories exist
    const testDirs = ['test/unit', 'test/middleware', 'test/integration', 'test/frontend']
    testDirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
    })

    // Run Jest-based tests (first 3 categories)
    const jestTests = testCategories.slice(0, 3)
    
    for (const category of jestTests) {
      const success = runJestTests(category.path, category.name)
      
      if (!success) {
        console.log(`⚠️  ${category.name} failed - continuing with other tests...`)
      }

      // Add a small delay between test categories
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    // Generate coverage report
    console.log('\n' + '='.repeat(50))
    generateCoverageReport()

    // Note about frontend tests
    console.log('\n📝 Note: Frontend tests use Playwright and should be run separately:')
    console.log('   cd web/admin-spa && npm run test')

  } catch (error) {
    console.error('❌ Test suite execution failed:', error)
    process.exit(1)
  } finally {
    results.endTime = new Date()
    results.duration = results.endTime - results.startTime
    
    // Print final summary
    console.log('\n' + '='.repeat(50))
    console.log('📋 TEST SUITE SUMMARY')
    console.log('='.repeat(50))
    console.log(`⏱️  Duration: ${(results.duration / 1000).toFixed(2)}s`)
    console.log(`📊 Total Tests: ${results.totalTests}`)
    console.log(`✅ Passed: ${results.passedTests}`)
    console.log(`❌ Failed: ${results.failedTests}`)
    console.log(`📈 Success Rate: ${results.totalTests > 0 ? ((results.passedTests / results.totalTests) * 100).toFixed(1) : 0}%`)
    
    if (results.coverage) {
      console.log('\n📊 COVERAGE SUMMARY:')
      console.log(`   Lines: ${results.coverage.lines.pct}%`)
      console.log(`   Functions: ${results.coverage.functions.pct}%`)
      console.log(`   Branches: ${results.coverage.branches.pct}%`)
      console.log(`   Statements: ${results.coverage.statements.pct}%`)
    }

    console.log('\n🎯 Test Categories Completed:')
    results.categories.forEach(category => {
      const status = category.success ? '✅' : '❌'
      const testsInfo = category.success ? 
        `${category.numPassedTests}/${category.numTotalTests} passed` : 
        'Failed to execute'
      console.log(`   ${status} ${category.name}: ${testsInfo}`)
    })

    // Write detailed results to file
    const reportPath = path.join(process.cwd(), 'test-results', 'test-summary.json')
    fs.mkdirSync(path.dirname(reportPath), { recursive: true })
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2))
    
    console.log(`\n💾 Detailed results saved to: ${reportPath}`)
    console.log('\n🎉 Test Suite Execution Complete!')
  }
}

// Handle process signals
process.on('SIGINT', () => {
  console.log('\n\n⚠️  Test suite interrupted by user')
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('\n\n⚠️  Test suite terminated')
  process.exit(0)
})

// Run the test suite
if (require.main === module) {
  runTestSuite()
}

module.exports = { runTestSuite, results }