/**
 * Jest Global Setup
 * 
 * Performs one-time setup before all tests run
 */

module.exports = async () => {
  // Set test environment
  process.env.NODE_ENV = 'test'
  
  console.log('🧪 Setting up test environment...')
  
  // Initialize test database if needed
  // (In this case, we're using mocked Redis)
  
  // Set global test timeout
  process.env.JEST_TIMEOUT = '10000'
  
  console.log('✅ Test environment setup complete')
}