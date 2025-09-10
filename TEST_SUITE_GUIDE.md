# Claude Relay Service 集成测试套件指南

## 概述

本测试套件为 Claude Relay Service 的所有新实现上游功能提供全面的验证，包括智能负载均衡器、错误处理机制、连接管理、会话持久化和 API Key 导出功能。

## 测试套件组成

### 1. 主要集成测试套件 (`scripts/integration-test-suite.js`)

**目标**: 全面测试所有新功能的端到端集成

**覆盖功能**:
- ✅ 智能负载均衡器功能验证
- ✅ 错误处理和重试机制测试  
- ✅ 连接管理和会话持久化测试
- ✅ API Key 导出功能测试
- ✅ 端到端功能验证
- ✅ 性能基准测试

**运行命令**:
```bash
# 基础测试
npm run test:integration

# 详细日志模式
npm run test:integration:verbose
```

### 2. 智能负载均衡器专项测试 (`scripts/test-load-balancer.js`)

**目标**: 专门测试智能负载均衡算法的核心功能

**覆盖功能**:
- ✅ 成本计算和账户选择逻辑验证
- ✅ 不同策略切换和回退机制测试
- ✅ 权重配置和动态调整验证
- ✅ 健康检查和故障检测测试
- ✅ 性能监控和统计分析
- ✅ 并发负载均衡准确性验证

**运行命令**:
```bash
# 基础测试
npm run test:load-balancer

# 详细日志模式
npm run test:load-balancer:verbose

# 性能分析模式
npm run test:load-balancer:profile
```

### 3. 错误处理和重试机制测试 (`scripts/test-error-retry.js`)

**目标**: 测试错误处理和重试管理器的各种场景

**覆盖功能**:
- ✅ 重试管理器的策略和算法验证
- ✅ 熔断器状态切换和恢复测试
- ✅ 错误分类和处理策略验证
- ✅ 监控指标收集和统计测试
- ✅ 多组件错误隔离测试
- ✅ 故障恢复和降级机制验证

**运行命令**:
```bash
# 基础测试
npm run test:error-retry

# 详细日志模式
npm run test:error-retry:verbose

# 性能分析模式
npm run test:error-retry:profile
```

## 快速开始

### 运行所有上游功能测试

```bash
# 运行所有新功能测试
npm run test:upstream

# 或者分别运行
npm run test:all-features
```

### 单独运行测试模块

```bash
# 只测试负载均衡器
npm run test:load-balancer

# 只测试错误重试机制
npm run test:error-retry

# 只测试完整集成
npm run test:integration
```

## 测试特性

### 🎯 模拟模式
所有测试默认运行在模拟模式下，无需真实的 Claude API 连接：
- 模拟数据库操作
- 模拟网络请求
- 模拟错误场景
- 模拟性能指标

### 📊 性能基准
测试套件包含性能基准验证：
- **响应时间**: 最大选择时间 < 100ms
- **吞吐量**: 最小吞吐量 > 50 selections/sec  
- **内存使用**: 增长 < 50MB
- **错误率**: < 5%

### 🔧 配置选项

#### 命令行参数
- `--verbose` / `-v`: 启用详细日志输出
- `--profile` / `-p`: 启用性能分析模式

#### 环境变量
```bash
# 设置测试超时时间
export TEST_TIMEOUT=60000

# 启用详细模式
export TEST_VERBOSE=true
```

## 测试报告

### 控制台输出
测试完成后会生成详细的控制台报告，包括：
- 📊 测试统计摘要
- ⚡ 性能指标分析
- 🧮 算法效果评估
- 🔧 组件状态检查
- ❌ 错误详情（如有）

### 文件报告
测试报告会保存到：
- `logs/integration-test-report.json` - 完整集成测试报告
- `logs/load-balancer-test-report.json` - 负载均衡器测试报告  
- `logs/error-retry-test-report.json` - 错误重试测试报告

## CI/CD 集成

### GitHub Actions
```yaml
name: Upstream Features Test
on: [push, pull_request]
jobs:
  test-upstream:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3
    - uses: actions/setup-node@v3
      with:
        node-version: '18'
    - run: npm install
    - run: npm run test:upstream
```

### 预提交钩子
```bash
# .git/hooks/pre-commit
#!/bin/bash
npm run test:load-balancer || exit 1
npm run test:error-retry || exit 1
echo "✅ All upstream feature tests passed"
```

## 故障排除

### 常见问题

#### 1. 测试超时
```bash
# 增加超时时间
TEST_TIMEOUT=120000 npm run test:integration
```

#### 2. 内存不足
```bash
# 设置Node.js内存限制
node --max-old-space-size=4096 scripts/integration-test-suite.js
```

#### 3. 并发测试失败
```bash
# 减少并发数量
TEST_CONCURRENCY=5 npm run test:load-balancer
```

### 调试模式

#### 启用详细日志
```bash
npm run test:integration:verbose
```

#### 性能分析
```bash
npm run test:load-balancer:profile
```

#### 单步调试
```bash
node --inspect-brk scripts/test-load-balancer.js
```

## 测试数据

### 模拟账户数据
- **账户数量**: 5-50个测试账户
- **使用模式**: 低、中、高、极高使用量模拟
- **错误模式**: 0-50个错误计数模拟
- **性能差异**: 0.8s-2.5s响应时间模拟

### 模拟API Key数据  
- **Key数量**: 8-50个测试Key
- **状态分布**: 80%活跃，20%非活跃
- **使用统计**: 随机生成的使用量和成本数据

### 错误场景模拟
- **网络错误**: ECONNRESET, ETIMEDOUT, ENOTFOUND
- **HTTP错误**: 429, 500, 502, 503, 504
- **应用错误**: ValidationError, AuthenticationError, RateLimitError

## 扩展测试

### 添加新测试场景

#### 1. 扩展集成测试
```javascript
// 在 scripts/integration-test-suite.js 中添加
async function testNewFeature() {
  log.info('🔧 Testing New Feature...')
  // 测试逻辑
  testResults.addTest('NewFeature-BasicTest', passed)
}
```

#### 2. 添加性能基准
```javascript
// 设置新的性能基准
const PERFORMANCE_BENCHMARKS = {
  newFeatureMaxTime: 500,
  newFeatureMinThroughput: 20
}
```

#### 3. 扩展错误模拟
```javascript
// 在 ErrorSimulator 中添加新错误模式
this.errorPatterns.newPattern = {
  rate: 0.1,
  errors: ['NewError1', 'NewError2']
}
```

## 最佳实践

### 📋 测试前检查清单
- [ ] 确保 Node.js 版本 >= 18
- [ ] 安装所有依赖: `npm install`
- [ ] 检查磁盘空间 (> 1GB)
- [ ] 确保无其他测试进程运行

### 🔄 定期测试建议
- **开发阶段**: 每次代码修改后运行相关测试
- **提交前**: 运行完整测试套件
- **发布前**: 运行所有测试包括性能测试
- **生产监控**: 定期运行健康检查测试

### 📈 性能监控
- 跟踪测试执行时间趋势
- 监控内存使用模式
- 关注错误率变化
- 分析算法效果指标

## 支持和贡献

### 问题报告
如果测试失败或发现问题，请提供：
1. 完整的错误日志
2. 测试环境信息 (Node.js版本、操作系统等)
3. 复现步骤
4. 期望行为描述

### 贡献指南
欢迎提交改进建议：
1. Fork 项目并创建特性分支
2. 添加相应的测试用例
3. 确保所有测试通过
4. 提交 Pull Request

---

**注意**: 这些测试专门针对新实现的上游功能。如需测试其他系统组件，请参考项目的其他测试文档。