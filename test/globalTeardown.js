/**
 * Jest Global Teardown
 * 
 * Performs cleanup after all tests complete
 */

module.exports = async () => {
  console.log('🧹 Cleaning up test environment...')
  
  // Cleanup any global resources if needed
  // (In this case, mocked Redis doesn't need cleanup)
  
  console.log('✅ Test environment cleanup complete')
}