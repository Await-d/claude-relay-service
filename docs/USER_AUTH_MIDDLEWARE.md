# User Authorization Middleware

用户授权中间件为 Claude Relay Service 提供细粒度的访问控制功能，支持基于角色、权限和资源的授权机制。

## 特性

- ✅ **角色层级授权** - 支持 viewer、user、admin 三级角色
- ✅ **权限级授权** - 细粒度权限控制（如 chat.create、admin.read 等）
- ✅ **资源级授权** - 基于资源和操作的权限验证
- ✅ **组权限继承** - 支持从用户组继承权限
- ✅ **性能优化** - 快速权限检查和缓存机制
- ✅ **详细日志** - 完整的安全审计日志
- ✅ **错误处理** - 友好的错误消息和状态码

## 快速开始

### 1. 导入中间件

```javascript
const { authenticateUserSession } = require('../middleware/auth')
const {
  requireRole,
  requirePermission,
  requireResource,
  checkGroupPermissions
} = require('../middleware/userAuth')
```

### 2. 基本用法

```javascript
// 需要管理员角色
router.get('/admin/users', 
  authenticateUserSession, 
  requireRole('admin'), 
  (req, res) => {
    // 处理逻辑
  }
)

// 需要特定权限
router.post('/api/chat', 
  authenticateUserSession,
  requirePermission('chat.create'),
  (req, res) => {
    // 处理逻辑
  }
)
```

## API 参考

### requireRole(roles)

检查用户是否具有指定角色或更高级别的角色。

**参数：**
- `roles` - 字符串或数组，需要的角色

**示例：**
```javascript
// 单个角色
requireRole('admin')

// 多个角色（满足其一即可）
requireRole(['user', 'admin'])
```

### requirePermission(permissions)

检查用户是否具有指定权限（包括组继承权限）。

**参数：**
- `permissions` - 字符串或数组，需要的权限

**示例：**
```javascript
// 单个权限
requirePermission('chat.create')

// 多个权限（必须全部满足）
requirePermission(['admin.read', 'usage.view'])
```

### requireResource(resource, action)

基于资源和操作的权限检查。

**参数：**
- `resource` - 资源类型（如 'users', 'api_keys', 'chat'）
- `action` - 操作类型（如 'read', 'write', 'delete'）

**示例：**
```javascript
// 读取 API Keys
requireResource('api_keys', 'read')

// 删除用户
requireResource('users', 'delete')
```

### checkGroupPermissions(userId?, groupId?)

检查用户是否为指定组的成员。

**参数：**
- `userId` - 可选，用户ID（默认使用 req.user.id）
- `groupId` - 可选，组ID（默认使用 req.params.groupId）

## 角色层级

```
viewer (级别 0) → user (级别 1) → admin (级别 2)
```

- **viewer**: 只读权限，可查看模型列表和使用统计
- **user**: 普通用户权限，可创建聊天和查看历史
- **admin**: 管理员权限，可管理用户、API Keys 和系统配置

## 默认权限

### viewer 角色
- `models.list` - 查看可用模型
- `usage.view` - 查看使用统计

### user 角色
- 包含 viewer 的所有权限，plus:
- `chat.create` - 创建聊天
- `chat.history` - 查看聊天历史

### admin 角色
- 包含 user 的所有权限，plus:
- `chat.export` - 导出聊天数据
- `admin.read` - 读取管理数据
- `admin.write` - 修改管理配置
- `admin.manage` - 完全管理权限

## 资源权限映射

| 资源 | 读取 | 写入 | 删除 |
|------|------|------|------|
| api_keys | usage.view, admin.read | admin.write, admin.manage | admin.manage |
| users | admin.read | admin.write | admin.manage |
| groups | admin.read | admin.write | admin.manage |
| accounts | admin.read | admin.write | admin.manage |
| chat | chat.history | chat.create | admin.manage |
| models | models.list | models.access | admin.manage |
| usage | usage.view | admin.write | admin.manage |

## 使用示例

### 简单授权

```javascript
// 管理员专用路由
router.get('/admin/dashboard', 
  authenticateUserSession,
  requireRole('admin'),
  (req, res) => {
    res.json({ message: 'Admin dashboard' })
  }
)
```

### 权限组合

```javascript
// 需要多个权限
router.get('/admin/reports',
  authenticateUserSession,
  requirePermission(['admin.read', 'usage.view']),
  (req, res) => {
    res.json({ message: 'Advanced reports' })
  }
)
```

### 资源级授权

```javascript
// API Key 管理
router.get('/admin/api-keys',
  authenticateUserSession,
  requireResource('api_keys', 'read'),
  (req, res) => {
    res.json({ message: 'API Keys list' })
  }
)

router.delete('/admin/api-keys/:keyId',
  authenticateUserSession,
  requireResource('api_keys', 'delete'),
  (req, res) => {
    res.json({ message: 'API Key deleted' })
  }
)
```

### 复合授权

```javascript
// 多层授权检查
router.post('/admin/system/reset',
  authenticateUserSession,
  requireRole('admin'),                    // 必须是管理员
  requirePermission('admin.manage'),       // 必须有管理权限
  requireResource('accounts', 'write'),    // 必须能写入账户
  (req, res) => {
    res.json({ message: 'System reset authorized' })
  }
)
```

### 组权限检查

```javascript
// 组资源访问
router.get('/groups/:groupId/settings',
  authenticateUserSession,
  checkGroupPermissions(),  // 检查组成员身份
  (req, res) => {
    const { groupId } = req.params
    const { isMember } = req.groupContext
    
    res.json({
      message: 'Group settings',
      groupId,
      isMember
    })
  }
)
```

## 错误响应

### 401 - 未认证
```json
{
  "error": "Authentication required",
  "message": "Please authenticate first"
}
```

### 403 - 角色不足
```json
{
  "error": "Insufficient role",
  "message": "Access denied. Required role: admin",
  "requiredRoles": ["admin"],
  "currentRole": "user"
}
```

### 403 - 权限不足
```json
{
  "error": "Insufficient permissions",
  "message": "Access denied. Missing required permissions: admin.read",
  "requiredPermissions": ["admin.read"]
}
```

### 403 - 资源访问被拒绝
```json
{
  "error": "Insufficient permissions", 
  "message": "Access denied for delete on users",
  "resource": "users",
  "action": "delete",
  "requiredPermissions": ["admin.manage"]
}
```

## 最佳实践

### 1. 中间件顺序

```javascript
router.post('/protected-route',
  authenticateUserSession,  // 1. 先认证
  requireRole('admin'),     // 2. 再检查角色
  requirePermission(...),   // 3. 然后检查权限
  requireResource(...),     // 4. 最后检查资源
  handler                   // 5. 处理业务逻辑
)
```

### 2. 错误处理

```javascript
router.use((error, req, res, next) => {
  if (error.name === 'UnauthorizedError') {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication failed'
    })
  }
  next(error)
})
```

### 3. 日志记录

中间件会自动记录详细的安全日志：

```
🔐 Role authorization failed for user john_doe (user123): required=admin, actual=user | 15ms
✅ Permission authorization passed for user admin_user: permissions=admin.read,usage.view | 8ms
🔐 Resource authorization failed for user viewer_user: resource=users, action=delete | 12ms
```

### 4. 性能优化

- 权限检查被缓存以提高性能
- 支持异步权限验证
- 组权限继承优化查询

## 集成指南

### 与现有路由集成

```javascript
const express = require('express')
const { authenticateUserSession } = require('./middleware/auth')
const { requireRole, requirePermission } = require('./middleware/userAuth')

const app = express()

// 现有 API 路由
app.use('/api/v1/messages', authenticateApiKey, claudeRelay)

// 新增用户会话路由
app.use('/api/user/chat', authenticateUserSession, requirePermission('chat.create'), userChatHandler)
app.use('/admin/*', authenticateUserSession, requireRole('admin'), adminRoutes)
```

### 双重认证模式

```javascript
const { authenticateDual } = require('./middleware/auth')

// 支持 API Key 或用户会话
app.use('/api/hybrid/*', authenticateDual, hybridRoutes)
```

## 故障排除

### 常见问题

1. **权限检查失败**
   - 检查用户是否已正确认证
   - 验证用户角色和权限设置
   - 查看安全日志获取详细信息

2. **组权限不生效**
   - 确认用户已正确添加到组
   - 检查组权限配置
   - 验证 groupService 可用性

3. **性能问题**
   - 检查 Redis 连接状态
   - 优化权限检查逻辑
   - 考虑使用权限缓存

### 调试技巧

```javascript
// 启用详细日志
process.env.LOG_LEVEL = 'debug'

// 检查用户权限
console.log('User permissions:', req.user.permissions)
console.log('User groups:', req.user.groups)
console.log('Resource context:', req.resourceContext)
```

## 扩展开发

### 自定义权限检查

```javascript
const customPermissionCheck = async (req, res, next) => {
  try {
    // 自定义逻辑
    const hasCustomPermission = await checkCustomCondition(req.user)
    
    if (!hasCustomPermission) {
      return res.status(403).json({
        error: 'Custom permission denied',
        message: 'Special condition not met'
      })
    }
    
    next()
  } catch (error) {
    res.status(500).json({
      error: 'Permission check failed',
      message: error.message
    })
  }
}
```

### 动态权限

```javascript
const dynamicPermission = (getRequiredPermission) => {
  return async (req, res, next) => {
    const requiredPermission = await getRequiredPermission(req)
    return requirePermission(requiredPermission)(req, res, next)
  }
}

// 使用
router.get('/dynamic/:type',
  authenticateUserSession,
  dynamicPermission(async (req) => {
    return req.params.type === 'sensitive' ? 'admin.manage' : 'usage.view'
  }),
  handler
)
```

## 安全注意事项

1. **始终先认证后授权** - 确保用户已通过身份验证
2. **最小权限原则** - 只授予必要的权限
3. **定期权限审计** - 检查和更新用户权限
4. **日志监控** - 监控异常的权限访问模式
5. **错误信息** - 避免泄露敏感的系统信息

## 版本历史

- **v1.0.0** - 初始版本
  - 基础角色和权限检查
  - 资源级授权
  - 组权限继承
  - 性能优化和错误处理