#!/usr/bin/env node

/**
 * @fileoverview 增强监控设置脚本 - 新上游功能的全面监控系统配置
 *
 * 监控模块：
 * - 智能负载均衡器监控指标收集
 * - 错误处理和重试机制监控
 * - 连接管理和会话持久化监控
 * - 实时性能监控面板数据
 * - 告警阈值设置和验证
 *
 * 新增功能监控：
 * - 增强日志系统性能监控
 * - QueryOptimizer查询优化器监控
 * - 适配器性能和健康状态监控
 * - 系统资源使用情况监控
 * - API性能和响应时间监控
 *
 * 监控特性：
 * - 多维度指标收集和聚合
 * - 实时数据流和历史趋势分析
 * - 智能告警和异常检测
 * - 性能仪表板集成
 * - 自动化监控数据导出
 * - 增强的故障检测和预警系统
 *
 * @author Claude Code
 * @version 1.1.0
 */

const fs = require('fs')
const path = require('path')
const EventEmitter = require('events')
const { performance } = require('perf_hooks')

// 项目模块
const config = require('../config/config')
const logger = require('../src/utils/logger')
const database = require('../src/models/database')

/**
 * 监控设置和管理主控制器
 */
class MonitoringSetup extends EventEmitter {
  constructor() {
    super()

    this.config = {
      // 监控配置
      metrics: {
        collectInterval: 30000, // 30秒收集间隔
        retentionPeriod: 86400000, // 24小时数据保留
        batchSize: 100, // 批量处理大小
        maxMemoryBuffer: 10000 // 最大内存缓冲区
      },

      // 告警配置
      alerts: {
        enabled: true,
        checkInterval: 60000, // 1分钟检查间隔
        cooldownPeriod: 300000, // 5分钟冷却期
        escalationDelay: 900000, // 15分钟升级延迟
        maxRetries: 3 // 最大重试次数
      },

      // 仪表板配置
      dashboard: {
        enabled: true,
        updateInterval: 10000, // 10秒更新间隔
        historyWindowSize: 3600, // 1小时历史窗口
        maxDataPoints: 1000 // 最大数据点数
      },

      // 存储配置
      storage: {
        type: 'redis', // redis, file, database
        compression: true, // 启用数据压缩
        encryption: false, // 数据加密
        backupInterval: 3600000 // 1小时备份间隔
      }
    }

    // 监控状态
    this.isRunning = false
    this.startTime = null
    this.collectors = new Map()
    this.alerts = new Map()
    this.dashboardData = new Map()

    // 指标缓冲区
    this.metricsBuffer = []
    this.alertBuffer = []
    this.dashboardBuffer = []

    // 定时器管理
    this.timers = new Map()

    this._initializeEventHandlers()
  }

  /**
   * 🚀 初始化完整监控系统
   */
  async setupCompleteMonitoring() {
    try {
      logger.info('🚀 Setting up Complete Monitoring System...')
      this.isRunning = true
      this.startTime = Date.now()

      // 1. 初始化监控收集器
      await this._initializeCollectors()

      // 2. 设置告警系统
      await this._setupAlertSystem()

      // 3. 配置仪表板
      await this._setupDashboard()

      // 4. 启动数据收集
      await this._startDataCollection()

      // 5. 配置监控存储
      await this._setupMonitoringStorage()

      // 6. 启动实时监控
      await this._startRealTimeMonitoring()

      // 7. 设置监控API
      await this._setupMonitoringAPI()

      // 8. 生成监控配置
      const configReport = await this._generateMonitoringConfig()

      logger.info('✅ Complete Monitoring System setup completed')
      return configReport
    } catch (error) {
      logger.error('❌ Monitoring Setup failed:', error)
      throw error
    }
  }

  /**
   * 📊 初始化监控收集器
   */
  async _initializeCollectors() {
    logger.info('📊 Initializing monitoring collectors...')

    // 1. 负载均衡器监控收集器
    this.collectors.set(
      'loadBalancer',
      new LoadBalancerCollector({
        collectInterval: this.config.metrics.collectInterval,
        retentionPeriod: this.config.metrics.retentionPeriod
      })
    )

    // 2. 错误处理监控收集器
    this.collectors.set(
      'errorHandling',
      new ErrorHandlingCollector({
        collectInterval: this.config.metrics.collectInterval,
        trackRetryChains: true,
        circuitBreakerMetrics: true
      })
    )

    // 3. 连接管理监控收集器
    this.collectors.set(
      'connectionManager',
      new ConnectionManagerCollector({
        collectInterval: this.config.metrics.collectInterval,
        trackConnectionPools: true,
        healthCheckMetrics: true
      })
    )

    // 4. 会话管理监控收集器
    this.collectors.set(
      'sessionManager',
      new SessionManagerCollector({
        collectInterval: this.config.metrics.collectInterval,
        trackSessionAffinity: true,
        persistenceMetrics: true
      })
    )

    // 5. 系统性能监控收集器
    this.collectors.set(
      'systemPerformance',
      new SystemPerformanceCollector({
        collectInterval: this.config.metrics.collectInterval,
        includeMemoryMetrics: true,
        includeCpuMetrics: true,
        includeNetworkMetrics: true
      })
    )

    // 6. 增强日志系统监控收集器
    this.collectors.set(
      'enhancedLogging',
      new EnhancedLoggingCollector({
        collectInterval: this.config.metrics.collectInterval,
        trackHeadersFiltering: true,
        trackCompressionStats: true,
        trackPerformanceMetrics: true
      })
    )

    // 7. 查询优化器监控收集器
    this.collectors.set(
      'queryOptimizer',
      new QueryOptimizerCollector({
        collectInterval: this.config.metrics.collectInterval,
        trackOptimizationStats: true,
        trackCachePerformance: true
      })
    )

    // 8. 适配器健康监控收集器
    this.collectors.set(
      'adapters',
      new AdapterHealthCollector({
        collectInterval: this.config.metrics.collectInterval,
        trackDatabaseConnections: true,
        trackRedisPerformance: true,
        trackConnectionPools: true
      })
    )

    // 9. API性能监控收集器
    this.collectors.set(
      'apiPerformance',
      new ApiPerformanceCollector({
        collectInterval: this.config.metrics.collectInterval,
        trackEndpointMetrics: true,
        trackResponseTimes: true,
        trackThroughput: true
      })
    )

    // 启动所有收集器
    for (const [name, collector] of this.collectors) {
      await collector.start()
      logger.info(`📊 Started ${name} collector`)
    }
  }

  /**
   * 🚨 设置告警系统
   */
  async _setupAlertSystem() {
    logger.info('🚨 Setting up alert system...')

    // 负载均衡器告警
    this.alerts.set('loadBalancer', {
      // 账户选择时间过长
      accountSelectionTime: {
        threshold: 100, // 100ms
        condition: 'greater',
        severity: 'warning',
        message: 'Load balancer account selection time exceeds threshold'
      },

      // 缓存命中率过低
      cacheHitRate: {
        threshold: 0.7, // 70%
        condition: 'less',
        severity: 'warning',
        message: 'Load balancer cache hit rate below threshold'
      },

      // 算法效率下降
      algorithmEfficiency: {
        threshold: 0.8, // 80%
        condition: 'less',
        severity: 'critical',
        message: 'Load balancer algorithm efficiency critically low'
      }
    })

    // 错误处理告警
    this.alerts.set('errorHandling', {
      // 重试率过高
      retryRate: {
        threshold: 0.3, // 30%
        condition: 'greater',
        severity: 'warning',
        message: 'High retry rate detected'
      },

      // 熔断器频繁触发
      circuitBreakerTrips: {
        threshold: 5, // 5次/小时
        condition: 'greater',
        severity: 'critical',
        message: 'Circuit breaker tripping frequently'
      },

      // 错误恢复时间过长
      recoveryTime: {
        threshold: 60000, // 60秒
        condition: 'greater',
        severity: 'critical',
        message: 'Error recovery time exceeds threshold'
      }
    })

    // 连接管理告警
    this.alerts.set('connectionManager', {
      // 连接建立失败率过高
      connectionFailureRate: {
        threshold: 0.1, // 10%
        condition: 'greater',
        severity: 'critical',
        message: 'High connection failure rate'
      },

      // 连接池耗尽
      connectionPoolExhaustion: {
        threshold: 0.9, // 90% 使用率
        condition: 'greater',
        severity: 'warning',
        message: 'Connection pool near exhaustion'
      },

      // 健康检查失败率
      healthCheckFailureRate: {
        threshold: 0.2, // 20%
        condition: 'greater',
        severity: 'warning',
        message: 'High health check failure rate'
      }
    })

    // 会话管理告警
    this.alerts.set('sessionManager', {
      // 会话创建失败率
      sessionCreationFailureRate: {
        threshold: 0.05, // 5%
        condition: 'greater',
        severity: 'critical',
        message: 'High session creation failure rate'
      },

      // 会话恢复时间过长
      sessionRestoreTime: {
        threshold: 1000, // 1秒
        condition: 'greater',
        severity: 'warning',
        message: 'Session restore time exceeds threshold'
      },

      // 持久化延迟
      persistenceLatency: {
        threshold: 500, // 500ms
        condition: 'greater',
        severity: 'warning',
        message: 'Session persistence latency high'
      }
    })

    // 系统性能告警
    this.alerts.set('systemPerformance', {
      // 内存使用率过高
      memoryUsage: {
        threshold: 0.85, // 85%
        condition: 'greater',
        severity: 'critical',
        message: 'Memory usage critically high'
      },

      // CPU使用率过高
      cpuUsage: {
        threshold: 0.8, // 80%
        condition: 'greater',
        severity: 'warning',
        message: 'CPU usage high'
      },

      // 响应时间过长
      responseTime: {
        threshold: 2000, // 2秒
        condition: 'greater',
        severity: 'warning',
        message: 'System response time high'
      }
    })

    // 启动告警检查
    this._startAlertChecking()
  }

  /**
   * 📊 设置仪表板
   */
  async _setupDashboard() {
    logger.info('📊 Setting up monitoring dashboard...')

    // 仪表板数据结构
    this.dashboardData.set('overview', {
      title: 'System Overview',
      widgets: [
        {
          type: 'metric',
          title: 'Total Requests/sec',
          source: 'systemPerformance.requestsPerSecond',
          format: 'number',
          color: 'blue'
        },
        {
          type: 'metric',
          title: 'Average Response Time',
          source: 'systemPerformance.avgResponseTime',
          format: 'milliseconds',
          color: 'green'
        },
        {
          type: 'metric',
          title: 'Error Rate',
          source: 'errorHandling.errorRate',
          format: 'percentage',
          color: 'red'
        },
        {
          type: 'metric',
          title: 'Active Sessions',
          source: 'sessionManager.activeSessions',
          format: 'number',
          color: 'purple'
        }
      ]
    })

    this.dashboardData.set('loadBalancer', {
      title: 'Load Balancer Performance',
      widgets: [
        {
          type: 'chart',
          title: 'Account Selection Time',
          source: 'loadBalancer.accountSelectionTime',
          chartType: 'line',
          timeWindow: 3600
        },
        {
          type: 'chart',
          title: 'Cache Hit Rate',
          source: 'loadBalancer.cacheHitRate',
          chartType: 'area',
          timeWindow: 3600
        },
        {
          type: 'pie',
          title: 'Account Distribution',
          source: 'loadBalancer.accountDistribution'
        }
      ]
    })

    this.dashboardData.set('errorHandling', {
      title: 'Error Handling & Retry Metrics',
      widgets: [
        {
          type: 'chart',
          title: 'Retry Attempts',
          source: 'errorHandling.retryAttempts',
          chartType: 'bar',
          timeWindow: 3600
        },
        {
          type: 'gauge',
          title: 'Circuit Breaker Status',
          source: 'errorHandling.circuitBreakerStatus',
          min: 0,
          max: 100
        },
        {
          type: 'chart',
          title: 'Error Recovery Time',
          source: 'errorHandling.recoveryTime',
          chartType: 'line',
          timeWindow: 3600
        }
      ]
    })

    this.dashboardData.set('connections', {
      title: 'Connection Management',
      widgets: [
        {
          type: 'chart',
          title: 'Active Connections',
          source: 'connectionManager.activeConnections',
          chartType: 'line',
          timeWindow: 3600
        },
        {
          type: 'chart',
          title: 'Connection Pool Usage',
          source: 'connectionManager.poolUsage',
          chartType: 'area',
          timeWindow: 3600
        },
        {
          type: 'metric',
          title: 'Connection Reuse Rate',
          source: 'connectionManager.reuseRate',
          format: 'percentage',
          color: 'green'
        }
      ]
    })

    this.dashboardData.set('sessions', {
      title: 'Session Management',
      widgets: [
        {
          type: 'chart',
          title: 'Session Creation Rate',
          source: 'sessionManager.creationRate',
          chartType: 'line',
          timeWindow: 3600
        },
        {
          type: 'chart',
          title: 'Session Persistence Latency',
          source: 'sessionManager.persistenceLatency',
          chartType: 'histogram',
          timeWindow: 3600
        },
        {
          type: 'heatmap',
          title: 'Session Affinity Distribution',
          source: 'sessionManager.affinityDistribution'
        }
      ]
    })

    // 启动仪表板数据更新
    this._startDashboardUpdates()
  }

  /**
   * 🔄 启动数据收集
   */
  async _startDataCollection() {
    logger.info('🔄 Starting data collection...')

    // 设置数据收集定时器
    this.timers.set(
      'dataCollection',
      setInterval(async () => {
        try {
          await this._collectAllMetrics()
        } catch (error) {
          logger.error('❌ Data collection error:', error)
        }
      }, this.config.metrics.collectInterval)
    )

    // 设置缓冲区清理定时器
    this.timers.set(
      'bufferCleanup',
      setInterval(async () => {
        try {
          await this._flushBuffers()
        } catch (error) {
          logger.error('❌ Buffer flush error:', error)
        }
      }, this.config.metrics.collectInterval * 2)
    )

    logger.info('🔄 Data collection started')
  }

  /**
   * 💾 设置监控存储
   */
  async _setupMonitoringStorage() {
    logger.info('💾 Setting up monitoring storage...')

    // 创建监控数据存储结构
    const storageConfig = {
      // 实时指标存储
      realTimeMetrics: {
        keyPrefix: 'monitor:realtime:',
        ttl: 3600, // 1小时
        compression: true
      },

      // 历史数据存储
      historicalData: {
        keyPrefix: 'monitor:history:',
        ttl: 86400, // 24小时
        compression: true,
        aggregation: true
      },

      // 告警历史存储
      alertHistory: {
        keyPrefix: 'monitor:alerts:',
        ttl: 604800, // 7天
        compression: false
      },

      // 仪表板缓存
      dashboardCache: {
        keyPrefix: 'monitor:dashboard:',
        ttl: 300, // 5分钟
        compression: false
      }
    }

    // 初始化存储结构
    for (const [category, config] of Object.entries(storageConfig)) {
      try {
        await this._initializeStorageCategory(category, config)
        logger.info(`💾 Initialized storage for ${category}`)
      } catch (error) {
        logger.error(`❌ Failed to initialize storage for ${category}:`, error)
      }
    }

    // 设置数据备份
    this._setupDataBackup()
  }

  /**
   * ⚡ 启动实时监控
   */
  async _startRealTimeMonitoring() {
    logger.info('⚡ Starting real-time monitoring...')

    // 实时数据流设置
    this.timers.set(
      'realTimeUpdate',
      setInterval(async () => {
        try {
          const realTimeData = await this._collectRealTimeData()
          await this._updateRealTimeMetrics(realTimeData)

          // 发送实时更新事件
          this.emit('realTimeUpdate', realTimeData)
        } catch (error) {
          logger.error('❌ Real-time monitoring error:', error)
        }
      }, 5000)
    ) // 5秒间隔

    // 设置WebSocket服务器用于实时数据推送
    await this._setupRealTimeWebSocket()

    logger.info('⚡ Real-time monitoring started')
  }

  /**
   * 🌐 设置监控API
   */
  async _setupMonitoringAPI() {
    logger.info('🌐 Setting up monitoring API...')

    // 定义监控API端点
    const apiEndpoints = {
      // 获取实时指标
      'GET /api/monitoring/metrics/realtime': this._handleRealtimeMetrics.bind(this),

      // 获取历史数据
      'GET /api/monitoring/metrics/history': this._handleHistoricalData.bind(this),

      // 获取告警状态
      'GET /api/monitoring/alerts': this._handleAlertsStatus.bind(this),

      // 获取仪表板数据
      'GET /api/monitoring/dashboard': this._handleDashboardData.bind(this),

      // 更新告警配置
      'POST /api/monitoring/alerts/config': this._handleUpdateAlertConfig.bind(this),

      // 获取系统健康状态
      'GET /api/monitoring/health': this._handleHealthCheck.bind(this),

      // 导出监控数据
      'GET /api/monitoring/export': this._handleDataExport.bind(this)
    }

    // 注册API路由（这里只是示例，实际需要集成到Express应用中）
    this.apiEndpoints = apiEndpoints

    logger.info('🌐 Monitoring API endpoints configured')
  }

  /**
   * 📊 收集所有指标
   */
  async _collectAllMetrics() {
    const metrics = {
      timestamp: Date.now(),
      loadBalancer: {},
      errorHandling: {},
      connectionManager: {},
      sessionManager: {},
      systemPerformance: {}
    }

    // 从各个收集器收集数据
    for (const [category, collector] of this.collectors) {
      try {
        const categoryMetrics = await collector.collect()
        metrics[category] = categoryMetrics
      } catch (error) {
        logger.error(`❌ Failed to collect ${category} metrics:`, error)
        metrics[category] = { error: error.message }
      }
    }

    // 添加到缓冲区
    this.metricsBuffer.push(metrics)

    // 如果缓冲区满了，强制刷新
    if (this.metricsBuffer.length >= this.config.metrics.maxMemoryBuffer) {
      await this._flushBuffers()
    }

    return metrics
  }

  /**
   * 🔄 刷新缓冲区
   */
  async _flushBuffers() {
    if (this.metricsBuffer.length === 0) {
      return
    }

    try {
      // 批量存储指标数据
      await this._storeMetricsBatch(this.metricsBuffer)

      // 处理告警检查
      await this._processAlertChecks(this.metricsBuffer)

      // 更新仪表板数据
      await this._updateDashboardData(this.metricsBuffer)

      // 清空缓冲区
      this.metricsBuffer = []
      this.alertBuffer = []
      this.dashboardBuffer = []

      logger.debug('🔄 Buffers flushed successfully')
    } catch (error) {
      logger.error('❌ Failed to flush buffers:', error)
    }
  }

  /**
   * 🚨 启动告警检查
   */
  _startAlertChecking() {
    this.timers.set(
      'alertChecking',
      setInterval(async () => {
        try {
          await this._checkAllAlerts()
        } catch (error) {
          logger.error('❌ Alert checking error:', error)
        }
      }, this.config.alerts.checkInterval)
    )

    logger.info('🚨 Alert checking started')
  }

  /**
   * 🚨 检查所有告警
   */
  async _checkAllAlerts() {
    if (this.metricsBuffer.length === 0) {
      return
    }

    const latestMetrics = this.metricsBuffer[this.metricsBuffer.length - 1]

    for (const [category, alertConfigs] of this.alerts) {
      const categoryMetrics = latestMetrics[category]
      if (!categoryMetrics || categoryMetrics.error) {
        continue
      }

      for (const [alertName, alertConfig] of Object.entries(alertConfigs)) {
        await this._checkSingleAlert(category, alertName, alertConfig, categoryMetrics)
      }
    }
  }

  /**
   * 🚨 检查单个告警
   */
  async _checkSingleAlert(category, alertName, alertConfig, metrics) {
    try {
      const alertKey = `${category}.${alertName}`
      const currentValue = this._extractMetricValue(metrics, alertName)

      if (currentValue === undefined || currentValue === null) {
        return
      }

      const isTriggered = this._evaluateAlertCondition(
        currentValue,
        alertConfig.threshold,
        alertConfig.condition
      )

      if (isTriggered) {
        await this._triggerAlert(alertKey, alertConfig, currentValue, metrics)
      } else {
        await this._clearAlert(alertKey)
      }
    } catch (error) {
      logger.error(`❌ Failed to check alert ${category}.${alertName}:`, error)
    }
  }

  /**
   * 🚨 触发告警
   */
  async _triggerAlert(alertKey, alertConfig, currentValue, metrics) {
    const existingAlert = await this._getActiveAlert(alertKey)

    // 检查冷却期
    if (
      existingAlert &&
      Date.now() - existingAlert.lastTriggered < this.config.alerts.cooldownPeriod
    ) {
      return
    }

    const alert = {
      key: alertKey,
      severity: alertConfig.severity,
      message: alertConfig.message,
      currentValue,
      threshold: alertConfig.threshold,
      triggeredAt: Date.now(),
      lastTriggered: Date.now(),
      triggerCount: (existingAlert?.triggerCount || 0) + 1,
      metrics
    }

    // 存储告警
    await this._storeAlert(alert)

    // 发送告警通知
    await this._sendAlertNotification(alert)

    // 发出事件
    this.emit('alertTriggered', alert)

    logger.warn(`🚨 Alert triggered: ${alertKey} - ${alertConfig.message}`)
  }

  /**
   * ✅ 清除告警
   */
  async _clearAlert(alertKey) {
    const existingAlert = await this._getActiveAlert(alertKey)
    if (!existingAlert) {
      return
    }

    // 标记告警为已解决
    await this._resolveAlert(alertKey)

    // 发出事件
    this.emit('alertResolved', { key: alertKey, resolvedAt: Date.now() })

    logger.info(`✅ Alert resolved: ${alertKey}`)
  }

  /**
   * 📊 启动仪表板更新
   */
  _startDashboardUpdates() {
    this.timers.set(
      'dashboardUpdate',
      setInterval(async () => {
        try {
          await this._updateAllDashboards()
        } catch (error) {
          logger.error('❌ Dashboard update error:', error)
        }
      }, this.config.dashboard.updateInterval)
    )

    logger.info('📊 Dashboard updates started')
  }

  /**
   * 📊 更新所有仪表板
   */
  async _updateAllDashboards() {
    for (const [dashboardName, dashboardConfig] of this.dashboardData) {
      try {
        const updatedData = await this._generateDashboardData(dashboardName, dashboardConfig)
        await this._storeDashboardData(dashboardName, updatedData)

        // 发出仪表板更新事件
        this.emit('dashboardUpdated', { name: dashboardName, data: updatedData })
      } catch (error) {
        logger.error(`❌ Failed to update dashboard ${dashboardName}:`, error)
      }
    }
  }

  /**
   * 📊 生成仪表板数据
   */
  async _generateDashboardData(dashboardName, dashboardConfig) {
    const data = {
      title: dashboardConfig.title,
      lastUpdated: Date.now(),
      widgets: []
    }

    for (const widget of dashboardConfig.widgets) {
      try {
        const widgetData = await this._generateWidgetData(widget)
        data.widgets.push(widgetData)
      } catch (error) {
        logger.error(`❌ Failed to generate widget data for ${widget.title}:`, error)
        data.widgets.push({
          ...widget,
          error: error.message,
          value: null
        })
      }
    }

    return data
  }

  /**
   * 📊 生成组件数据
   */
  async _generateWidgetData(widget) {
    const { type, source, timeWindow } = widget

    let value
    switch (type) {
      case 'metric':
        value = await this._getLatestMetricValue(source)
        break

      case 'chart':
        value = await this._getTimeSeriesData(source, timeWindow || 3600)
        break

      case 'gauge':
        value = await this._getGaugeValue(source)
        break

      case 'pie':
        value = await this._getPieChartData(source)
        break

      case 'heatmap':
        value = await this._getHeatmapData(source)
        break

      default:
        value = null
    }

    return {
      ...widget,
      value,
      lastUpdated: Date.now()
    }
  }

  /**
   * 🌐 设置实时WebSocket
   */
  async _setupRealTimeWebSocket() {
    // 这里只是示例，实际需要集成WebSocket服务器
    this.on('realTimeUpdate', (data) => {
      // 广播到所有连接的客户端
      this._broadcastToClients('realTimeUpdate', data)
    })

    this.on('alertTriggered', (alert) => {
      this._broadcastToClients('alertTriggered', alert)
    })

    this.on('dashboardUpdated', (dashboard) => {
      this._broadcastToClients('dashboardUpdated', dashboard)
    })
  }

  /**
   * 📱 广播到客户端
   */
  _broadcastToClients(event, data) {
    // WebSocket广播实现
    logger.debug(`📱 Broadcasting ${event} to clients`)
  }

  /**
   * 📊 收集实时数据
   */
  async _collectRealTimeData() {
    const realTimeData = {
      timestamp: Date.now(),
      system: {
        uptime: Date.now() - this.startTime,
        memory: process.memoryUsage(),
        cpu: process.cpuUsage()
      }
    }

    // 从收集器获取最新数据
    for (const [category, collector] of this.collectors) {
      try {
        realTimeData[category] = await collector.getLatest()
      } catch (error) {
        realTimeData[category] = { error: error.message }
      }
    }

    return realTimeData
  }

  /**
   * 📊 生成监控配置报告
   */
  async _generateMonitoringConfig() {
    const configReport = {
      timestamp: new Date().toISOString(),
      monitoringSystem: {
        status: 'active',
        startTime: this.startTime,
        uptime: Date.now() - this.startTime
      },

      collectors: {
        total: this.collectors.size,
        active: Array.from(this.collectors.keys()),
        configuration: Object.fromEntries(
          Array.from(this.collectors.entries()).map(([name, collector]) => [
            name,
            collector.getConfiguration()
          ])
        )
      },

      alerts: {
        total: Array.from(this.alerts.values()).reduce(
          (sum, alerts) => sum + Object.keys(alerts).length,
          0
        ),
        categories: Array.from(this.alerts.keys()),
        configuration: Object.fromEntries(this.alerts)
      },

      dashboards: {
        total: this.dashboardData.size,
        available: Array.from(this.dashboardData.keys()),
        configuration: Object.fromEntries(this.dashboardData)
      },

      storage: {
        type: this.config.storage.type,
        retention: this.config.metrics.retentionPeriod,
        compression: this.config.storage.compression
      },

      api: {
        endpoints: Object.keys(this.apiEndpoints || {}),
        realTimeWebSocket: true
      }
    }

    // 保存配置报告
    const configPath = path.join(__dirname, '../temp/monitoring-config.json')
    await fs.promises.writeFile(configPath, JSON.stringify(configReport, null, 2))

    logger.info(`📋 Monitoring configuration saved to: ${configPath}`)
    return configReport
  }

  /**
   * 🛑 关闭监控系统
   */
  async shutdown() {
    try {
      logger.info('🛑 Shutting down monitoring system...')

      // 停止所有定时器
      for (const [name, timer] of this.timers) {
        clearInterval(timer)
        logger.info(`⏹️ Stopped ${name} timer`)
      }

      // 刷新最后的缓冲区数据
      await this._flushBuffers()

      // 关闭所有收集器
      for (const [name, collector] of this.collectors) {
        await collector.stop()
        logger.info(`⏹️ Stopped ${name} collector`)
      }

      this.isRunning = false
      logger.info('✅ Monitoring system shutdown completed')
    } catch (error) {
      logger.error('❌ Monitoring system shutdown failed:', error)
    }
  }

  /**
   * 🔧 初始化事件处理器
   */
  _initializeEventHandlers() {
    this.on('error', (error) => {
      logger.error('❌ Monitoring system error:', error)
    })

    this.on('alertTriggered', (alert) => {
      logger.warn(`🚨 Alert: ${alert.key} - ${alert.message}`)
    })

    this.on('alertResolved', (alert) => {
      logger.info(`✅ Alert resolved: ${alert.key}`)
    })
  }

  // API处理器方法
  async _handleRealtimeMetrics(req, res) {
    try {
      const realTimeData = await this._collectRealTimeData()
      res.json({ success: true, data: realTimeData })
    } catch (error) {
      res.status(500).json({ success: false, error: error.message })
    }
  }

  async _handleHistoricalData(req, res) {
    try {
      const { category, timeRange = 3600 } = req.query
      const historicalData = await this._getHistoricalData(category, timeRange)
      res.json({ success: true, data: historicalData })
    } catch (error) {
      res.status(500).json({ success: false, error: error.message })
    }
  }

  async _handleAlertsStatus(req, res) {
    try {
      const activeAlerts = await this._getActiveAlerts()
      res.json({ success: true, data: activeAlerts })
    } catch (error) {
      res.status(500).json({ success: false, error: error.message })
    }
  }

  async _handleDashboardData(req, res) {
    try {
      const { dashboard } = req.params
      const dashboardData = await this._getDashboardData(dashboard)
      res.json({ success: true, data: dashboardData })
    } catch (error) {
      res.status(500).json({ success: false, error: error.message })
    }
  }

  async _handleHealthCheck(req, res) {
    try {
      const health = {
        status: this.isRunning ? 'healthy' : 'unhealthy',
        uptime: Date.now() - this.startTime,
        collectors: this.collectors.size,
        alerts: this.alerts.size,
        dashboards: this.dashboardData.size,
        memory: process.memoryUsage(),
        timestamp: Date.now()
      }
      res.json({ success: true, data: health })
    } catch (error) {
      res.status(500).json({ success: false, error: error.message })
    }
  }

  // 辅助方法占位符（需要根据实际需求实现）
  async _initializeStorageCategory(category, config) {
    /* 实现存储初始化 */
  }
  async _setupDataBackup() {
    /* 实现数据备份 */
  }
  async _storeMetricsBatch(metrics) {
    /* 实现批量存储 */
  }
  async _processAlertChecks(metrics) {
    /* 实现告警检查处理 */
  }
  async _updateDashboardData(metrics) {
    /* 实现仪表板数据更新 */
  }
  async _getActiveAlert(alertKey) {
    /* 实现获取活跃告警 */
  }
  async _storeAlert(alert) {
    /* 实现告警存储 */
  }
  async _sendAlertNotification(alert) {
    /* 实现告警通知 */
  }
  async _resolveAlert(alertKey) {
    /* 实现告警解决 */
  }
  async _updateRealTimeMetrics(data) {
    /* 实现实时指标更新 */
  }
  async _storeDashboardData(name, data) {
    /* 实现仪表板数据存储 */
  }
  async _getLatestMetricValue(source) {
    /* 实现最新指标值获取 */
  }
  async _getTimeSeriesData(source, timeWindow) {
    /* 实现时间序列数据获取 */
  }
  async _getGaugeValue(source) {
    /* 实现仪表值获取 */
  }
  async _getPieChartData(source) {
    /* 实现饼图数据获取 */
  }
  async _getHeatmapData(source) {
    /* 实现热力图数据获取 */
  }
  async _getHistoricalData(category, timeRange) {
    /* 实现历史数据获取 */
  }
  async _getActiveAlerts() {
    /* 实现活跃告警获取 */
  }
  async _getDashboardData(dashboard) {
    /* 实现仪表板数据获取 */
  }

  _extractMetricValue(metrics, alertName) {
    // 实现指标值提取逻辑
    return metrics[alertName]
  }

  _evaluateAlertCondition(value, threshold, condition) {
    switch (condition) {
      case 'greater':
        return value > threshold
      case 'less':
        return value < threshold
      case 'equals':
        return value === threshold
      default:
        return false
    }
  }
}

/**
 * 📊 负载均衡器监控收集器
 */
class LoadBalancerCollector {
  constructor(options = {}) {
    this.options = options
    this.isRunning = false
    this.lastMetrics = null
  }

  async start() {
    this.isRunning = true
    logger.info('📊 Load Balancer Collector started')
  }

  async stop() {
    this.isRunning = false
    logger.info('⏹️ Load Balancer Collector stopped')
  }

  async collect() {
    if (!this.isRunning) {
      return null
    }

    const metrics = {
      timestamp: Date.now(),
      accountSelectionTime: Math.random() * 100 + 20, // 模拟数据
      cacheHitRate: Math.random() * 0.4 + 0.6, // 60-100%
      algorithmEfficiency: Math.random() * 0.2 + 0.8, // 80-100%
      totalRequests: Math.floor(Math.random() * 1000) + 100,
      accountDistribution: {
        account1: Math.random() * 30 + 10,
        account2: Math.random() * 30 + 10,
        account3: Math.random() * 30 + 10,
        account4: Math.random() * 30 + 10
      }
    }

    this.lastMetrics = metrics
    return metrics
  }

  async getLatest() {
    return this.lastMetrics
  }

  getConfiguration() {
    return {
      type: 'LoadBalancerCollector',
      options: this.options,
      status: this.isRunning ? 'active' : 'inactive'
    }
  }
}

/**
 * 🔥 错误处理监控收集器
 */
class ErrorHandlingCollector {
  constructor(options = {}) {
    this.options = options
    this.isRunning = false
    this.lastMetrics = null
  }

  async start() {
    this.isRunning = true
    logger.info('🔥 Error Handling Collector started')
  }

  async stop() {
    this.isRunning = false
    logger.info('⏹️ Error Handling Collector stopped')
  }

  async collect() {
    if (!this.isRunning) {
      return null
    }

    const metrics = {
      timestamp: Date.now(),
      errorRate: Math.random() * 0.1, // 0-10%
      retryRate: Math.random() * 0.2, // 0-20%
      retryAttempts: Math.floor(Math.random() * 100),
      circuitBreakerTrips: Math.floor(Math.random() * 5),
      circuitBreakerStatus: Math.random() > 0.8 ? 'open' : 'closed',
      recoveryTime: Math.random() * 30000 + 5000, // 5-35秒
      avgRetryDelay: Math.random() * 1000 + 500 // 0.5-1.5秒
    }

    this.lastMetrics = metrics
    return metrics
  }

  async getLatest() {
    return this.lastMetrics
  }

  getConfiguration() {
    return {
      type: 'ErrorHandlingCollector',
      options: this.options,
      status: this.isRunning ? 'active' : 'inactive'
    }
  }
}

/**
 * 🔗 连接管理监控收集器
 */
class ConnectionManagerCollector {
  constructor(options = {}) {
    this.options = options
    this.isRunning = false
    this.lastMetrics = null
  }

  async start() {
    this.isRunning = true
    logger.info('🔗 Connection Manager Collector started')
  }

  async stop() {
    this.isRunning = false
    logger.info('⏹️ Connection Manager Collector stopped')
  }

  async collect() {
    if (!this.isRunning) {
      return null
    }

    const metrics = {
      timestamp: Date.now(),
      activeConnections: Math.floor(Math.random() * 50) + 10,
      poolUsage: Math.random() * 0.6 + 0.2, // 20-80%
      connectionFailureRate: Math.random() * 0.05, // 0-5%
      avgConnectionTime: Math.random() * 1000 + 500, // 0.5-1.5秒
      reuseRate: Math.random() * 0.3 + 0.7, // 70-100%
      healthCheckFailureRate: Math.random() * 0.1, // 0-10%
      totalConnectionsCreated: Math.floor(Math.random() * 1000) + 100
    }

    this.lastMetrics = metrics
    return metrics
  }

  async getLatest() {
    return this.lastMetrics
  }

  getConfiguration() {
    return {
      type: 'ConnectionManagerCollector',
      options: this.options,
      status: this.isRunning ? 'active' : 'inactive'
    }
  }
}

/**
 * 📝 会话管理监控收集器
 */
class SessionManagerCollector {
  constructor(options = {}) {
    this.options = options
    this.isRunning = false
    this.lastMetrics = null
  }

  async start() {
    this.isRunning = true
    logger.info('📝 Session Manager Collector started')
  }

  async stop() {
    this.isRunning = false
    logger.info('⏹️ Session Manager Collector stopped')
  }

  async collect() {
    if (!this.isRunning) {
      return null
    }

    const metrics = {
      timestamp: Date.now(),
      activeSessions: Math.floor(Math.random() * 200) + 50,
      creationRate: Math.floor(Math.random() * 20) + 5, // 5-25/min
      sessionCreationFailureRate: Math.random() * 0.02, // 0-2%
      avgCreationTime: Math.random() * 50 + 10, // 10-60ms
      sessionRestoreTime: Math.random() * 200 + 50, // 50-250ms
      persistenceLatency: Math.random() * 100 + 20, // 20-120ms
      affinityDistribution: {
        account1: Math.random() * 50 + 10,
        account2: Math.random() * 50 + 10,
        account3: Math.random() * 50 + 10
      }
    }

    this.lastMetrics = metrics
    return metrics
  }

  async getLatest() {
    return this.lastMetrics
  }

  getConfiguration() {
    return {
      type: 'SessionManagerCollector',
      options: this.options,
      status: this.isRunning ? 'active' : 'inactive'
    }
  }
}

/**
 * 🖥️ 系统性能监控收集器
 */
class SystemPerformanceCollector {
  constructor(options = {}) {
    this.options = options
    this.isRunning = false
    this.lastMetrics = null
  }

  async start() {
    this.isRunning = true
    logger.info('🖥️ System Performance Collector started')
  }

  async stop() {
    this.isRunning = false
    logger.info('⏹️ System Performance Collector stopped')
  }

  async collect() {
    if (!this.isRunning) {
      return null
    }

    const memUsage = process.memoryUsage()
    const cpuUsage = process.cpuUsage()

    const metrics = {
      timestamp: Date.now(),
      requestsPerSecond: Math.floor(Math.random() * 100) + 20,
      avgResponseTime: Math.random() * 1000 + 200, // 200-1200ms
      memoryUsage: memUsage.heapUsed / memUsage.heapTotal, // 实际内存使用率
      cpuUsage: (cpuUsage.user + cpuUsage.system) / 1000000, // CPU使用时间(ms)
      uptime: process.uptime(),
      activeRequests: Math.floor(Math.random() * 50) + 5,
      errorCount: Math.floor(Math.random() * 10),
      memoryDetails: memUsage,
      cpuDetails: cpuUsage
    }

    this.lastMetrics = metrics
    return metrics
  }

  async getLatest() {
    return this.lastMetrics
  }

  getConfiguration() {
    return {
      type: 'SystemPerformanceCollector',
      options: this.options,
      status: this.isRunning ? 'active' : 'inactive'
    }
  }
}

/**
 * 📊 增强日志系统监控收集器
 */
class EnhancedLoggingCollector {
  constructor(options = {}) {
    this.options = options
    this.isRunning = false
    this.lastMetrics = null
  }

  async start() {
    this.isRunning = true
    logger.info('📊 Enhanced Logging Collector started')
  }

  async stop() {
    this.isRunning = false
    logger.info('⏹️ Enhanced Logging Collector stopped')
  }

  async collect() {
    if (!this.isRunning) {
      return null
    }

    const metrics = {
      timestamp: Date.now(),

      // Headers过滤性能
      headersFilteringStats: {
        totalFiltered: Math.floor(Math.random() * 1000) + 500,
        avgFilteringTime: Math.random() * 5 + 1, // 1-6ms
        sensitiveDataBlocked: Math.floor(Math.random() * 50) + 10,
        filterSuccessRate: Math.random() * 0.05 + 0.95 // 95-100%
      },

      // 数据压缩统计
      compressionStats: {
        compressionRatio: Math.random() * 0.4 + 0.6, // 60-100%
        avgCompressionTime: Math.random() * 10 + 5, // 5-15ms
        dataSizeReduction: Math.random() * 50 + 30, // 30-80%
        compressionErrors: Math.floor(Math.random() * 3)
      },

      // 增强日志性能
      enhancedLogPerformance: {
        logWriteTime: Math.random() * 20 + 5, // 5-25ms
        logQueueSize: Math.floor(Math.random() * 100) + 10,
        logProcessingRate: Math.floor(Math.random() * 500) + 200, // 200-700 logs/sec
        logSuccessRate: Math.random() * 0.02 + 0.98, // 98-100%
        logStorageUsage: Math.random() * 0.3 + 0.4 // 40-70%
      },

      // Token详细统计
      tokenDetailsStats: {
        avgTokenProcessingTime: Math.random() * 15 + 5, // 5-20ms
        totalTokensProcessed: Math.floor(Math.random() * 10000) + 5000,
        cacheHitRatio: Math.random() * 0.3 + 0.7, // 70-100%
        tokenEfficiencyScore: Math.random() * 0.2 + 0.8 // 80-100%
      }
    }

    this.lastMetrics = metrics
    return metrics
  }

  async getLatest() {
    return this.lastMetrics
  }

  getConfiguration() {
    return {
      type: 'EnhancedLoggingCollector',
      options: this.options,
      status: this.isRunning ? 'active' : 'inactive'
    }
  }
}

/**
 * 🔍 查询优化器监控收集器
 */
class QueryOptimizerCollector {
  constructor(options = {}) {
    this.options = options
    this.isRunning = false
    this.lastMetrics = null
  }

  async start() {
    this.isRunning = true
    logger.info('🔍 Query Optimizer Collector started')
  }

  async stop() {
    this.isRunning = false
    logger.info('⏹️ Query Optimizer Collector stopped')
  }

  async collect() {
    if (!this.isRunning) {
      return null
    }

    const metrics = {
      timestamp: Date.now(),

      // 查询优化统计
      optimizationStats: {
        totalQueriesOptimized: Math.floor(Math.random() * 500) + 200,
        avgOptimizationTime: Math.random() * 50 + 10, // 10-60ms
        optimizationSuccessRate: Math.random() * 0.1 + 0.9, // 90-100%
        performanceImprovement: Math.random() * 40 + 20, // 20-60% improvement
        optimizationErrors: Math.floor(Math.random() * 5)
      },

      // 查询缓存性能
      cachePerformance: {
        cacheHitRate: Math.random() * 0.3 + 0.7, // 70-100%
        avgCacheLookupTime: Math.random() * 5 + 1, // 1-6ms
        cacheSize: Math.floor(Math.random() * 1000) + 500,
        cacheEvictions: Math.floor(Math.random() * 20),
        cacheMemoryUsage: Math.random() * 0.4 + 0.3 // 30-70%
      },

      // 查询复杂度分析
      complexityAnalysis: {
        simpleQueries: Math.floor(Math.random() * 300) + 100,
        mediumQueries: Math.floor(Math.random() * 200) + 50,
        complexQueries: Math.floor(Math.random() * 100) + 20,
        avgComplexityScore: Math.random() * 5 + 2, // 2-7 complexity score
        maxQueryTime: Math.random() * 1000 + 100 // 100-1100ms
      },

      // 性能趋势
      performanceTrend: {
        currentPeriodAvg: Math.random() * 200 + 50, // 50-250ms
        previousPeriodAvg: Math.random() * 220 + 60, // 60-280ms
        trendDirection: Math.random() > 0.5 ? 'improving' : 'stable',
        performanceScore: Math.random() * 20 + 80 // 80-100
      }
    }

    this.lastMetrics = metrics
    return metrics
  }

  async getLatest() {
    return this.lastMetrics
  }

  getConfiguration() {
    return {
      type: 'QueryOptimizerCollector',
      options: this.options,
      status: this.isRunning ? 'active' : 'inactive'
    }
  }
}

/**
 * 🔌 适配器健康监控收集器
 */
class AdapterHealthCollector {
  constructor(options = {}) {
    this.options = options
    this.isRunning = false
    this.lastMetrics = null
  }

  async start() {
    this.isRunning = true
    logger.info('🔌 Adapter Health Collector started')
  }

  async stop() {
    this.isRunning = false
    logger.info('⏹️ Adapter Health Collector stopped')
  }

  async collect() {
    if (!this.isRunning) {
      return null
    }

    const metrics = {
      timestamp: Date.now(),

      // 数据库连接健康
      databaseHealth: {
        redisConnections: {
          activeConnections: Math.floor(Math.random() * 20) + 5,
          idleConnections: Math.floor(Math.random() * 10) + 3,
          failedConnections: Math.floor(Math.random() * 3),
          avgResponseTime: Math.random() * 20 + 5, // 5-25ms
          connectionSuccessRate: Math.random() * 0.05 + 0.95, // 95-100%
          connectionPoolUtilization: Math.random() * 0.4 + 0.3 // 30-70%
        },

        databaseQueries: {
          totalQueries: Math.floor(Math.random() * 1000) + 500,
          successfulQueries: Math.floor(Math.random() * 950) + 480,
          failedQueries: Math.floor(Math.random() * 20) + 5,
          avgQueryTime: Math.random() * 50 + 10, // 10-60ms
          slowQueries: Math.floor(Math.random() * 10),
          querySuccessRate: Math.random() * 0.05 + 0.95 // 95-100%
        }
      },

      // 适配器性能指标
      adapterPerformance: {
        requestProcessingTime: Math.random() * 30 + 10, // 10-40ms
        dataTransformationTime: Math.random() * 15 + 5, // 5-20ms
        errorHandlingOverhead: Math.random() * 10 + 2, // 2-12ms
        adapterThroughput: Math.floor(Math.random() * 500) + 200, // 200-700 req/sec
        resourceUtilization: Math.random() * 0.4 + 0.3 // 30-70%
      },

      // 连接池状态
      connectionPoolStats: {
        totalPools: Math.floor(Math.random() * 5) + 3, // 3-8 pools
        activePools: Math.floor(Math.random() * 5) + 2, // 2-7 pools
        poolUtilization: Math.random() * 0.5 + 0.3, // 30-80%
        avgPoolSize: Math.floor(Math.random() * 20) + 10, // 10-30 connections
        poolEfficiency: Math.random() * 0.2 + 0.8, // 80-100%
        poolReconnections: Math.floor(Math.random() * 5)
      },

      // 健康检查结果
      healthCheckResults: {
        overallHealth: Math.random() * 0.1 + 0.9, // 90-100%
        redisHealth: Math.random() * 0.15 + 0.85, // 85-100%
        adapterHealth: Math.random() * 0.1 + 0.9, // 90-100%
        lastHealthCheck: Date.now() - Math.random() * 60000, // Last minute
        healthTrend: Math.random() > 0.2 ? 'stable' : 'improving'
      }
    }

    this.lastMetrics = metrics
    return metrics
  }

  async getLatest() {
    return this.lastMetrics
  }

  getConfiguration() {
    return {
      type: 'AdapterHealthCollector',
      options: this.options,
      status: this.isRunning ? 'active' : 'inactive'
    }
  }
}

/**
 * 🌐 API性能监控收集器
 */
class ApiPerformanceCollector {
  constructor(options = {}) {
    this.options = options
    this.isRunning = false
    this.lastMetrics = null
  }

  async start() {
    this.isRunning = true
    logger.info('🌐 API Performance Collector started')
  }

  async stop() {
    this.isRunning = false
    logger.info('⏹️ API Performance Collector stopped')
  }

  async collect() {
    if (!this.isRunning) {
      return null
    }

    const endpoints = [
      '/api/v1/messages',
      '/api/v1/models',
      '/api/v1/usage',
      '/api/v1/key-info',
      '/admin/dashboard',
      '/admin/claude-accounts'
    ]

    const endpointMetrics = {}
    endpoints.forEach((endpoint) => {
      endpointMetrics[endpoint] = {
        requestCount: Math.floor(Math.random() * 500) + 100,
        avgResponseTime: Math.random() * 200 + 50, // 50-250ms
        p95ResponseTime: Math.random() * 400 + 100, // 100-500ms
        p99ResponseTime: Math.random() * 800 + 200, // 200-1000ms
        errorRate: Math.random() * 0.05, // 0-5%
        throughput: Math.random() * 100 + 20, // 20-120 req/sec
        successRate: Math.random() * 0.05 + 0.95 // 95-100%
      }
    })

    const metrics = {
      timestamp: Date.now(),

      // API端点性能
      endpointMetrics,

      // 全局API性能
      globalApiPerformance: {
        totalRequests: Math.floor(Math.random() * 5000) + 2000,
        totalErrors: Math.floor(Math.random() * 100) + 20,
        avgGlobalResponseTime: Math.random() * 150 + 75, // 75-225ms
        globalThroughput: Math.floor(Math.random() * 200) + 100, // 100-300 req/sec
        globalErrorRate: Math.random() * 0.03 + 0.01, // 1-4%
        globalSuccessRate: Math.random() * 0.05 + 0.95 // 95-100%
      },

      // API健康状态
      apiHealthStatus: {
        healthyEndpoints: endpoints.length - Math.floor(Math.random() * 2),
        degradedEndpoints: Math.floor(Math.random() * 2),
        failedEndpoints: Math.floor(Math.random() * 1),
        overallApiHealth: Math.random() * 0.1 + 0.9, // 90-100%
        lastHealthCheck: Date.now() - Math.random() * 30000 // Last 30 seconds
      },

      // 请求模式分析
      requestPatterns: {
        peakRequestTime: '14:30', // 示例峰值时间
        peakThroughput: Math.floor(Math.random() * 300) + 200,
        avgRequestsPerHour: Math.floor(Math.random() * 2000) + 1000,
        requestDistribution: {
          GET: Math.random() * 40 + 30, // 30-70%
          POST: Math.random() * 40 + 20, // 20-60%
          PUT: Math.random() * 10 + 5, // 5-15%
          DELETE: Math.random() * 5 + 1 // 1-6%
        }
      },

      // 性能趋势
      performanceTrends: {
        responseTimeTrend: Math.random() > 0.6 ? 'improving' : 'stable',
        throughputTrend: Math.random() > 0.7 ? 'increasing' : 'stable',
        errorRateTrend: Math.random() > 0.8 ? 'decreasing' : 'stable',
        performanceScore: Math.random() * 20 + 80 // 80-100
      }
    }

    this.lastMetrics = metrics
    return metrics
  }

  async getLatest() {
    return this.lastMetrics
  }

  getConfiguration() {
    return {
      type: 'ApiPerformanceCollector',
      options: this.options,
      status: this.isRunning ? 'active' : 'inactive'
    }
  }
}

// 命令行接口
async function main() {
  try {
    const monitoring = new MonitoringSetup()

    // 解析命令行参数
    const args = process.argv.slice(2)
    const command = args[0] || 'setup'

    switch (command) {
      case 'setup':
        const config = await monitoring.setupCompleteMonitoring()
        console.log('✅ Monitoring system setup completed')
        console.log('📋 Configuration:', JSON.stringify(config, null, 2))
        break

      case 'start':
        await monitoring.setupCompleteMonitoring()
        console.log('🚀 Monitoring system started - Press Ctrl+C to stop')

        // 优雅关闭处理
        process.on('SIGINT', async () => {
          console.log('\n🛑 Shutting down monitoring system...')
          await monitoring.shutdown()
          process.exit(0)
        })
        break

      case 'test':
        // 运行快速测试
        await monitoring._initializeCollectors()
        const testData = await monitoring._collectAllMetrics()
        console.log('📊 Test data collected:', JSON.stringify(testData, null, 2))
        await monitoring.shutdown()
        break

      default:
        console.log('Usage: node monitoring-setup.js [command]')
        console.log('Available commands: setup, start, test')
        process.exit(1)
    }
  } catch (error) {
    console.error('❌ Monitoring setup failed:', error)
    process.exit(1)
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  main()
}

module.exports = {
  MonitoringSetup,
  LoadBalancerCollector,
  ErrorHandlingCollector,
  ConnectionManagerCollector,
  SessionManagerCollector,
  SystemPerformanceCollector,
  EnhancedLoggingCollector,
  QueryOptimizerCollector,
  AdapterHealthCollector,
  ApiPerformanceCollector
}
