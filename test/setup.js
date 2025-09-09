/**
 * Jest Test Setup
 * 
 * Global test setup for user management system
 * Configures mocks, test utilities, and environment
 */

const path = require('path')

// Set test environment variables
process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only'
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-char-long'
process.env.REDIS_HOST = 'localhost'
process.env.REDIS_PORT = '6379'
process.env.LOG_LEVEL = 'error' // Reduce log noise during tests

// Mock Redis client for testing
const mockRedisClient = {
  get: jest.fn(),
  set: jest.fn(),
  setex: jest.fn(),
  del: jest.fn(),
  exists: jest.fn(),
  hgetall: jest.fn(),
  hset: jest.fn(),
  hdel: jest.fn(),
  keys: jest.fn(),
  lpush: jest.fn(),
  ltrim: jest.fn(),
  expire: jest.fn(),
  incr: jest.fn(),
  quit: jest.fn(),
  on: jest.fn(),
  flushdb: jest.fn()
}

// Mock database adapter
jest.mock('../src/models/database', () => ({
  client: mockRedisClient,
  
  // User operations
  createUser: jest.fn(),
  getUserById: jest.fn(),
  getUserByUsername: jest.fn(),
  updateUser: jest.fn(),
  deleteUser: jest.fn(),
  
  // Session operations
  createSession: jest.fn(),
  validateSession: jest.fn(),
  destroySession: jest.fn(),
  
  // General operations
  connect: jest.fn().mockResolvedValue(true),
  disconnect: jest.fn().mockResolvedValue(true),
  isConnected: jest.fn().mockReturnValue(true)
}))

// Mock logger to prevent test output noise
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  success: jest.fn(),
  security: jest.fn()
}))

// Mock LDAP helper (optional dependency)
jest.mock('../src/utils/ldapHelper', () => ({
  authenticateUser: jest.fn(),
  isAvailable: jest.fn().mockReturnValue(false)
}), { virtual: true })

// Mock config
jest.mock('../../config/config', () => ({
  redis: {
    host: 'localhost',
    port: 6379,
    password: null
  },
  jwt: {
    secret: 'test-jwt-secret-key-for-testing-only',
    expiresIn: '24h'
  },
  encryption: {
    key: 'test-encryption-key-32-char-long'
  },
  auth: {
    maxLoginAttempts: 5,
    lockoutDuration: 900000 // 15 minutes
  }
}), { virtual: true })

// Global test utilities
global.testUtils = {
  // Helper to create mock user data
  createMockUser: (overrides = {}) => ({
    id: 'test-user-id',
    username: 'testuser',
    email: 'test@example.com',
    fullName: 'Test User',
    passwordHash: '$2b$10$test.hash.value',
    status: 'active',
    role: 'user',
    authMethod: 'local',
    groups: [],
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastLoginAt: '',
    failedLoginAttempts: 0,
    lockedUntil: '',
    passwordChangedAt: new Date().toISOString(),
    emailVerified: false,
    isActive: true,
    ...overrides
  }),

  // Helper to create mock session data
  createMockSession: (overrides = {}) => ({
    sessionId: 'test-session-id',
    userId: 'test-user-id',
    jwtToken: 'mock.jwt.token',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    lastActivity: new Date().toISOString(),
    ipAddress: '127.0.0.1',
    userAgent: 'Test User Agent',
    ...overrides
  }),

  // Helper to create mock request object
  createMockRequest: (overrides = {}) => ({
    headers: {},
    body: {},
    params: {},
    query: {},
    ip: '127.0.0.1',
    originalUrl: '/test',
    user: null,
    ...overrides
  }),

  // Helper to create mock response object
  createMockResponse: () => {
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      cookie: jest.fn().mockReturnThis(),
      clearCookie: jest.fn().mockReturnThis()
    }
    return res
  },

  // Helper to create mock next function
  createMockNext: () => jest.fn(),

  // Helper to wait for async operations
  wait: (ms = 0) => new Promise(resolve => setTimeout(resolve, ms)),

  // Helper to clear all mocks
  clearAllMocks: () => {
    jest.clearAllMocks()
  }
}

// Reset mocks before each test
beforeEach(() => {
  global.testUtils.clearAllMocks()
})

// Global test timeout
jest.setTimeout(10000)