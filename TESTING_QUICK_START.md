# 🚀 Claude Relay Service 测试套件快速开始

## 概述

本项目包含完整的测试套件，用于验证所有新实现的上游功能。测试套件设计为独立运行，无需外部依赖。

## ⚡ 快速运行

### 1. 环境验证
首先运行健康检查确保环境准备就绪：

```bash
npm run test:health-check
```

### 2. 运行单个测试套件

#### 智能负载均衡器测试
```bash
# 基础测试
npm run test:load-balancer

# 详细日志
npm run test:load-balancer:verbose

# 性能分析
npm run test:load-balancer:profile
```

#### 错误重试机制测试
```bash
# 基础测试
npm run test:error-retry

# 详细日志
npm run test:error-retry:verbose

# 性能分析
npm run test:error-retry:profile
```

#### 完整集成测试
```bash
# 基础测试
npm run test:integration

# 详细日志
npm run test:integration:verbose
```

### 3. 运行所有测试
```bash
# 运行所有新功能测试
npm run test:upstream

# 或者
npm run test:all-features
```

## 🎯 测试模式

### 模拟模式（默认）
所有测试默认运行在模拟模式下：
- ✅ 无需 Redis 连接
- ✅ 无需真实 Claude API
- ✅ 完全离线运行
- ✅ 快速执行

### 实际环境测试
如需测试实际环境，需要：
1. 启动 Redis 服务
2. 配置环境变量
3. 设置 Claude 账户

## 📊 测试覆盖

### 智能负载均衡器
- ✅ 基础账户选择逻辑
- ✅ 成本效率计算
- ✅ 权重配置影响
- ✅ 健康检查机制
- ✅ 性能和并发测试
- ✅ 压力和边界测试

### 错误处理和重试
- ✅ 重试策略验证
- ✅ 熔断器功能
- ✅ 错误分类处理
- ✅ 集成恢复场景
- ✅ 性能压力测试

### 系统集成
- ✅ 端到端数据流
- ✅ 组件协同工作
- ✅ 错误隔离测试
- ✅ 资源管理验证
- ✅ 性能基准验证

## 🔧 故障排除

### 常见问题

#### 1. Redis 连接错误
```bash
# 这是正常的，测试运行在模拟模式
# 忽略 Redis 连接错误，关注测试结果
```

#### 2. 内存不足
```bash
# 增加 Node.js 内存限制
node --max-old-space-size=4096 scripts/integration-test-suite.js
```

#### 3. 测试超时
```bash
# 单独运行问题测试
npm run test:load-balancer:verbose
```

#### 4. 权限错误
```bash
# 确保日志目录可写
mkdir -p logs
chmod 755 logs
```

### 调试技巧

#### 启用详细日志
```bash
npm run test:integration:verbose
```

#### 查看测试报告
```bash
# 报告保存在 logs/ 目录
cat logs/integration-test-report.json
cat logs/load-balancer-test-report.json
cat logs/error-retry-test-report.json
```

#### 单步调试
```bash
node --inspect-brk scripts/test-load-balancer.js
```

## 📈 性能基准

### 期望指标
- **选择时间**: < 100ms
- **吞吐量**: > 50 selections/sec
- **内存增长**: < 50MB
- **成功率**: > 95%
- **缓存命中率**: > 70%

### 性能监控
```bash
# 运行性能分析
npm run test:load-balancer:profile
npm run test:error-retry:profile
```

## 📋 测试报告

### 控制台输出
测试完成后显示：
- 📊 测试统计摘要
- ⚡ 性能指标
- 🧮 算法分析
- 🔧 组件状态
- ❌ 错误详情

### 文件报告
报告保存位置：
- `logs/integration-test-report.json`
- `logs/load-balancer-test-report.json`
- `logs/error-retry-test-report.json`
- `logs/health-check-report.json`

## 🚢 CI/CD 集成

### GitHub Actions 示例
```yaml
name: Test Upstream Features
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3
    - uses: actions/setup-node@v3
    - run: npm ci
    - run: npm run test:health-check
    - run: npm run test:upstream
```

### 预提交钩子
```bash
#!/bin/bash
# .git/hooks/pre-commit
echo "Running upstream feature tests..."
npm run test:upstream || {
  echo "❌ Tests failed! Commit aborted."
  exit 1
}
echo "✅ All tests passed!"
```

## 📚 进一步阅读

- [完整测试套件指南](./TEST_SUITE_GUIDE.md)
- [项目总体文档](./CLAUDE.md)
- [API 文档](./docs/)

## 🆘 获取帮助

如果遇到问题：

1. **运行健康检查**: `npm run test:health-check`
2. **查看详细日志**: 使用 `:verbose` 版本的命令
3. **检查系统状态**: `npm run status`
4. **查看项目文档**: 阅读 `CLAUDE.md`

---

**记住**: 这些测试专门验证新实现的上游功能（智能负载均衡、错误重试、查询优化等）。对于其他系统组件的测试，请使用标准的 `npm test` 命令。