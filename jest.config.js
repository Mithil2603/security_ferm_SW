/**
 * jest.config.js
 * 
 * Jest configuration for security_ferm_SW test suite.
 * Tests run against a separate SQLite database to avoid corrupting production data.
 */

module.exports = {
  testEnvironment: 'node',

  // Where to find tests
  testMatch: [
    '**/src/services/**/__tests__/**/*.test.js',
    '**/tests/**/*.test.js',
  ],

  // Coverage settings
  collectCoverageFrom: [
    'src/services/**/*.js',
    '!src/services/**/index.js',
    '!src/services/**/__tests__/**',
  ],

  coverageThreshold: {
    global: {
      branches: 70,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },

  coverageDirectory: 'coverage',

  // Ignore patterns
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/frontend-dist/',
  ],

  // Timeouts for integration tests
  testTimeout: 30000,

  // Global setup file for test database
  setupFilesAfterEnv: ['<rootDir>/tests/jest.setup.js'],

  // Verbose output
  verbose: true,
};
