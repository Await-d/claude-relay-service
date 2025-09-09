/**
 * Jest Configuration for Claude Relay Service
 * 
 * Complete test configuration for user management system testing
 */

module.exports = {
  // Test environment
  testEnvironment: 'node',

  // Test directory patterns
  testMatch: [
    '**/test/**/*.test.js',
    '**/__tests__/**/*.js'
  ],

  // Coverage configuration
  collectCoverage: false,
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.example.js',
    '!**/node_modules/**',
    '!**/vendor/**'
  ],
  coverageReporters: [
    'text',
    'text-summary',
    'html',
    'lcov'
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },

  // Setup and teardown
  setupFilesAfterEnv: ['<rootDir>/test/setup.js'],
  
  // Test timeout
  testTimeout: 10000,

  // Module paths
  moduleDirectories: ['node_modules', 'src'],
  
  // Clear mocks between tests
  clearMocks: true,
  
  // Verbose output
  verbose: true,

  // Exit on first failure in CI
  bail: process.env.CI ? 1 : 0,

  // Run tests in parallel
  maxWorkers: process.env.CI ? 2 : '50%',

  // Transform files (if needed for ES modules)
  transform: {},

  // Global setup for database mocking
  globalSetup: '<rootDir>/test/globalSetup.js',
  globalTeardown: '<rootDir>/test/globalTeardown.js',

  // Test reporter
  reporters: [
    'default',
    ['jest-junit', {
      outputDirectory: './test-results',
      outputName: 'junit.xml'
    }]
  ]
};