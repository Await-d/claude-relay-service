# LDAP Integration Guide

## Overview

The LDAP Helper (`src/utils/ldapHelper.js`) provides comprehensive LDAP integration capabilities for enterprise directory authentication and user synchronization in the Claude Relay Service.

## Features

- **Connection Management**: Connection pooling, auto-reconnect, and proxy support
- **Enterprise Authentication**: LDAP bind authentication with user search capabilities  
- **User Synchronization**: Attribute mapping and group synchronization
- **Performance Optimization**: Built-in caching (users, groups, DN lookup)
- **Error Handling**: Comprehensive error handling and retry logic
- **Monitoring**: Statistics tracking and health monitoring

## Quick Start

### Basic Usage

```javascript
const ldapHelper = require('../src/utils/ldapHelper')

// LDAP Configuration
const ldapConfig = {
  url: 'ldap://your-ldap-server:389',
  bindDN: 'cn=admin,dc=company,dc=com',
  bindPassword: 'admin_password',
  baseDN: 'ou=users,dc=company,dc=com',
  groupBaseDN: 'ou=groups,dc=company,dc=com',
  usernameAttribute: 'uid'
}

// Test Connection
const testResult = await ldapHelper.testConnection(ldapConfig)
console.log('Connection test:', testResult.success ? 'PASS' : 'FAIL')

// Authenticate User
const authResult = await ldapHelper.authenticateLDAP(
  'john.doe', 
  'password123', 
  ldapConfig
)

if (authResult.success) {
  console.log('User authenticated:', authResult.userDN)
  console.log('User groups:', authResult.groups)
}
```

### Integration with User Service

```javascript
// In your UserService class
const ldapHelper = require('../utils/ldapHelper')

class UserService {
  async authenticateUser(username, password, authMethod = 'local') {
    if (authMethod === 'ldap') {
      // LDAP Authentication
      const ldapConfig = this.getLDAPConfig() // Your LDAP config
      const result = await ldapHelper.authenticateLDAP(
        username, 
        password, 
        ldapConfig
      )
      
      if (result.success) {
        // Sync user from LDAP
        const syncResult = await ldapHelper.syncLDAPUser(
          result.userInfo, 
          ldapConfig
        )
        
        // Create or update local user
        return await this.createOrUpdateUser(syncResult.user, syncResult.groups)
      }
    }
    
    // Fallback to local authentication
    return await this.authenticateLocal(username, password)
  }
}
```

## Configuration Options

### Basic Connection

```javascript
const ldapConfig = {
  // Server Settings
  url: 'ldap://server:389',           // LDAP server URL
  timeout: 30000,                     // Connection timeout (ms)
  connectTimeout: 10000,              // Initial connection timeout (ms)
  
  // Authentication
  bindDN: 'cn=admin,dc=example,dc=com',     // Admin bind DN
  bindPassword: 'admin_password',            // Admin password
  
  // Search Base
  baseDN: 'ou=users,dc=example,dc=com',     // User search base
  groupBaseDN: 'ou=groups,dc=example,dc=com', // Group search base
  
  // User Attributes
  usernameAttribute: 'uid',           // Username field
  userAttributes: ['uid', 'cn', 'mail', 'givenName', 'sn']
}
```

### Advanced Configuration

```javascript
const advancedConfig = {
  ...ldapConfig,
  
  // Proxy Support
  proxy: {
    type: 'socks5',
    host: '127.0.0.1',
    port: 1080,
    username: 'proxy_user',
    password: 'proxy_pass'
  },
  
  // TLS/SSL
  tlsOptions: {
    rejectUnauthorized: true,
    ca: [/* CA certificates */],
    cert: '/* client certificate */',
    key: '/* client key */'
  },
  
  // Attribute Mapping
  attributeMapping: {
    username: 'uid',
    email: 'mail',
    firstName: 'givenName',
    lastName: 'sn',
    displayName: 'cn',
    phone: 'telephoneNumber',
    department: 'ou',
    title: 'title'
  },
  
  // Group Mapping
  groupMapping: {
    'ldap-admins': 'administrator',
    'ldap-users': 'standard_user',
    'developers': {
      name: 'developer',
      role: 'dev',
      permissions: ['read', 'write', 'debug']
    },
    '*': true // Default: keep original group names
  }
}
```

## API Reference

### Core Methods

#### `testConnection(ldapConfig)`
Tests LDAP connection and basic functionality.

**Returns:** `Promise<Object>` - Test result with success status and details

#### `authenticateLDAP(username, password, ldapConfig, options)`
Authenticates user against LDAP directory.

**Parameters:**
- `username` - User identifier
- `password` - User password
- `ldapConfig` - LDAP configuration object
- `options` - Authentication options

**Returns:** `Promise<Object>` - Authentication result with user info and groups

#### `syncLDAPUser(ldapUserData, ldapConfig, options)`
Synchronizes LDAP user data to local format.

**Parameters:**
- `ldapUserData` - Raw LDAP user data
- `ldapConfig` - LDAP configuration
- `options` - Sync options (e.g., required fields)

**Returns:** `Promise<Object>` - Synchronized user and group data

#### `getLDAPGroups(userDN, ldapConfig)`
Retrieves user's group memberships.

**Parameters:**
- `userDN` - User distinguished name
- `ldapConfig` - LDAP configuration

**Returns:** `Promise<Array>` - Array of group objects

### Utility Methods

#### `getStats()`
Returns performance and usage statistics.

#### `cleanup(force = false)`
Cleans up connections and caches. Set `force=true` to reset statistics.

## Error Handling

The LDAP Helper provides comprehensive error handling:

```javascript
try {
  const result = await ldapHelper.authenticateLDAP(username, password, config)
  
  if (!result.success) {
    // Authentication failed - check result.error for details
    console.error('Auth failed:', result.error)
  }
} catch (error) {
  // Connection or system error
  console.error('LDAP error:', error.message)
}
```

## Performance Considerations

### Connection Pooling

The helper automatically manages connection pools to optimize performance:

- Minimum connections: 1
- Maximum connections: 10 (configurable)
- Idle timeout: 5 minutes
- Automatic cleanup every 5 minutes

### Caching

Built-in caching reduces LDAP queries:

- **User Cache**: 15 minutes (1000 entries)
- **Group Cache**: 30 minutes (500 entries)  
- **DN Cache**: 1 hour (2000 entries)

### Monitoring

Use `getStats()` to monitor performance:

```javascript
const stats = ldapHelper.getStats()
console.log('Cache hit ratio:', 
  stats.cache.hits / (stats.cache.hits + stats.cache.misses))
console.log('Active connections:', stats.connections.active)
```

## Testing

Use the provided test script to verify LDAP functionality:

```bash
# Run LDAP tests
node scripts/test-ldap-helper.js
```

The test script validates:
- Connection establishment
- User authentication  
- User synchronization
- Statistics collection

## Security Best Practices

1. **Use TLS/SSL** for production LDAP connections
2. **Limit bind account permissions** - read-only access preferred
3. **Configure proxy properly** if network isolation required
4. **Validate user input** before LDAP queries
5. **Monitor failed authentication attempts**
6. **Use connection pooling limits** to prevent resource exhaustion

## Troubleshooting

### Common Issues

**Connection Timeout**
```
Error: LDAP connection timeout
```
- Check network connectivity to LDAP server
- Verify firewall rules and proxy configuration
- Increase `connectTimeout` value

**Authentication Failed**
```
Error: User not found: username
```
- Verify `baseDN` and `usernameAttribute` configuration
- Check user DN construction or search filters
- Ensure bind account has search permissions

**SSL/TLS Issues**
```
Error: certificate verification failed
```
- Set `rejectUnauthorized: false` for development
- Configure proper CA certificates for production
- Check certificate validity and hostname matching

### Debug Logging

Enable debug logging for detailed troubleshooting:

```javascript
// Set LOG_LEVEL environment variable
process.env.LOG_LEVEL = 'debug'

// Or configure in your application
const logger = require('./src/utils/logger')
logger.level = 'debug'
```

## Integration Examples

See the test script (`scripts/test-ldap-helper.js`) for comprehensive usage examples and configuration patterns.