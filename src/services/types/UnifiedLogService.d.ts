/**
 * @fileoverview UnifiedLogService类型定义
 * 
 * 为UnifiedLogService和相关服务提供完整的TypeScript类型定义
 * 确保类型安全和IDE智能提示支持
 * 
 * @author Claude Code
 * @version 1.0.0
 */

/**
 * 日志数据接口
 */
export interface LogData {
  /** API Key ID */
  keyId?: string
  /** 时间戳 */
  timestamp?: number
  /** 请求路径 */
  path?: string
  /** HTTP方法 */
  method?: string
  /** 响应状态码 */
  status?: number
  /** 使用的AI模型 */
  model?: string
  /** 总Token数 */
  tokens?: number
  /** 总Token数（别名） */
  totalTokens?: number
  /** 输入Token数 */
  inputTokens?: number
  /** 输出Token数 */
  outputTokens?: number
  /** 缓存创建Token数 */
  cacheCreateTokens?: number
  /** 缓存读取Token数 */
  cacheReadTokens?: number
  /** 响应时间（毫秒） */
  responseTime?: number
  /** 用户代理 */
  userAgent?: string
  /** IP地址 */
  ipAddress?: string
  /** 错误信息 */
  error?: string
  /** 账户ID */
  accountId?: string
  /** 是否流式请求 */
  isStreaming?: boolean
  /** 费用信息 */
  cost?: number
  /** 费用信息（别名） */
  totalCost?: number
  /** 5分钟缓存Token */
  ephemeral5mTokens?: number
  /** 1小时缓存Token */
  ephemeral1hTokens?: number
  /** 5分钟缓存Token（下划线格式） */
  ephemeral_5m_input_tokens?: number
  /** 1小时缓存Token（下划线格式） */
  ephemeral_1h_input_tokens?: number
  /** 请求头 */
  requestHeaders?: Record<string, string | string[]>
  /** 响应头 */
  responseHeaders?: Record<string, string | string[]>
  /** 日志版本 */
  logVersion?: string
  /** 日志来源 */
  source?: string
}

/**
 * Token详情接口
 */
export interface TokenDetails {
  /** 总Token数 */
  totalTokens: number
  /** 输入Token数 */
  inputTokens: number
  /** 输出Token数 */
  outputTokens: number
  /** 缓存创建Token数 */
  cacheCreateTokens: number
  /** 缓存读取Token数 */
  cacheReadTokens: number
  /** 使用的模型 */
  model?: string
  /** 5分钟缓存Token */
  ephemeral5mTokens?: number
  /** 1小时缓存Token */
  ephemeral1hTokens?: number
  /** 缓存命中率（百分比） */
  cacheHitRatio: number
  /** Token效率 */
  tokenEfficiency: number
  /** 记录时间 */
  recordedAt?: string
}

/**
 * 费用详情接口
 */
export interface CostDetails {
  /** 总费用 */
  totalCost: number
  /** 输入费用 */
  inputCost?: number
  /** 输出费用 */
  outputCost?: number
  /** 缓存费用 */
  cacheCost?: number
  /** 每Token费用 */
  costPerToken: number
  /** 货币单位 */
  currency: string
  /** 使用的模型 */
  model?: string
  /** 输入Token单价 */
  inputTokenPrice?: number
  /** 输出Token单价 */
  outputTokenPrice?: number
  /** 汇率 */
  exchangeRate?: number
  /** 计费周期 */
  billingPeriod?: string
  /** 是否计算失败 */
  calculationFailed?: boolean
  /** 计算错误信息 */
  calculationError?: string
  /** 记录时间 */
  recordedAt?: string
}

/**
 * 日志记录选项接口
 */
export interface LogOptions {
  /** 是否同步记录 */
  sync?: boolean
  /** 是否启用压缩 */
  enableCompression?: boolean
  /** 生存时间（TTL） */
  ttl?: number
  /** 最大值长度 */
  maxValueLength?: number
  /** 是否包含IP信息 */
  includeIpInfo?: boolean
}

/**
 * UnifiedLogService配置接口
 */
export interface UnifiedLogServiceConfig {
  /** 合并窗口时间（毫秒） */
  mergeWindowMs?: number
  /** 最大重试次数 */
  maxRetries?: number
  /** 重试延迟时间（毫秒） */
  retryDelayMs?: number
  /** 是否启用异步处理 */
  enableAsync?: boolean
  /** 是否启用Headers捕获 */
  enableHeadersCapture?: boolean
  /** 是否启用Token详情记录 */
  enableTokenDetails?: boolean
  /** 是否启用费用详情记录 */
  enableCostDetails?: boolean
  /** 是否启用数据压缩 */
  enableDataCompression?: boolean
  /** 是否启用性能监控 */
  enablePerformanceMonitoring?: boolean
  /** 最大日志大小 */
  maxLogSize?: number
  /** 是否启用降级日志 */
  enableFallbackLogging?: boolean
}

/**
 * 服务依赖接口
 */
export interface ServiceDependencies {
  /** 数据库适配器 */
  database: DatabaseAdapter
  /** Headers过滤服务 */
  headersFilter: HeadersFilterService
  /** 日志记录器 */
  logger?: Logger
}

/**
 * 数据库适配器接口
 */
export interface DatabaseAdapter {
  /** 记录日志请求 */
  logRequest(keyId: string, logData: LogData, ttl?: number): Promise<string>
  /** 连接数据库 */
  connect?(): Promise<void>
  /** 断开数据库连接 */
  disconnect?(): Promise<void>
  /** 健康检查 */
  ping?(): Promise<boolean>
}

/**
 * Headers过滤服务接口
 */
export interface HeadersFilterService {
  /** 过滤Headers */
  filterHeaders(headers: Record<string, any>, type: 'request' | 'response'): Promise<Record<string, any>>
}

/**
 * 日志记录器接口
 */
export interface Logger {
  /** 调试日志 */
  debug(message: string, ...args: any[]): void
  /** 信息日志 */
  info(message: string, ...args: any[]): void
  /** 警告日志 */
  warn(message: string, ...args: any[]): void
  /** 错误日志 */
  error(message: string, ...args: any[]): void
}

/**
 * 服务统计信息接口
 */
export interface ServiceStats {
  /** 总请求数 */
  totalRequests: number
  /** 成功日志数 */
  successfulLogs: number
  /** 失败日志数 */
  failedLogs: number
  /** 平均处理时间 */
  averageProcessingTime: number
  /** 成功率 */
  successRate: string
  /** 缓存大小 */
  cacheSize: number
  /** 运行时间 */
  uptime: number
  /** 最后重置时间 */
  lastResetTime: number
  /** 配置信息 */
  config: UnifiedLogServiceConfig
}

/**
 * 工厂统计信息接口
 */
export interface FactoryStats {
  /** 是否已创建单例 */
  singletonCreated: boolean
  /** 命名实例数量 */
  namedInstancesCount: number
  /** 命名实例名称列表 */
  namedInstanceNames: string[]
  /** 是否已初始化 */
  isInitialized: boolean
  /** 是否已加载配置 */
  configurationLoaded: boolean
}

/**
 * 健康检查结果接口
 */
export interface HealthCheckResult {
  /** 整体状态 */
  status: 'healthy' | 'degraded' | 'unhealthy'
  /** 各依赖状态 */
  dependencies: Record<string, {
    status: 'healthy' | 'unhealthy'
    error?: string
  }>
  /** 检查时间戳 */
  timestamp: string
  /** 错误信息（如果有） */
  error?: string
}

/**
 * UnifiedLogService类接口
 */
export interface IUnifiedLogService {
  /** 记录日志请求 */
  logRequest(keyId: string, logData: LogData, options?: LogOptions): Promise<string | null>
  /** 更新配置 */
  updateConfig(newConfig: Partial<UnifiedLogServiceConfig>): void
  /** 获取统计信息 */
  getStats(): ServiceStats
  /** 重置统计信息 */
  resetStats(): void
  /** 优雅关闭 */
  shutdown(): Promise<void>
}

/**
 * UnifiedLogServiceFactory类接口
 */
export interface IUnifiedLogServiceFactory {
  /** 创建服务实例 */
  create(
    customConfig?: Partial<UnifiedLogServiceConfig>,
    customDependencies?: Partial<ServiceDependencies>,
    instanceName?: string
  ): Promise<IUnifiedLogService>
  
  /** 获取或创建单例 */
  getSingleton(
    customConfig?: Partial<UnifiedLogServiceConfig>,
    customDependencies?: Partial<ServiceDependencies>
  ): Promise<IUnifiedLogService>
  
  /** 获取命名实例 */
  getNamedInstance(instanceName: string): IUnifiedLogService | null
  
  /** 健康检查 */
  healthCheck(): Promise<HealthCheckResult>
  
  /** 获取工厂统计信息 */
  getFactoryStats(): FactoryStats
  
  /** 重置单例实例 */
  resetSingleton(): Promise<void>
  
  /** 移除命名实例 */
  removeNamedInstance(instanceName: string): Promise<boolean>
  
  /** 优雅关闭 */
  shutdown(): Promise<void>
}

/**
 * 使用数据接口（用于API集成）
 */
export interface UsageData {
  /** 输入Token数 */
  input_tokens?: number
  /** 输出Token数 */
  output_tokens?: number
  /** 缓存创建输入Token数 */
  cache_creation_input_tokens?: number
  /** 缓存读取输入Token数 */
  cache_read_input_tokens?: number
  /** 模型名称 */
  model?: string
  /** 缓存创建详情 */
  cache_creation?: {
    ephemeral_5m_input_tokens?: number
    ephemeral_1h_input_tokens?: number
  }
}

/**
 * API Key接口
 */
export interface ApiKey {
  /** API Key ID */
  id: string
  /** API Key名称 */
  name?: string
  /** 是否活跃 */
  active?: boolean
}

/**
 * 请求参数接口（用于集成服务）
 */
export interface RequestParams {
  /** API Key对象 */
  apiKey: ApiKey
  /** 请求体 */
  requestBody?: any
  /** 请求头 */
  requestHeaders?: Record<string, string | string[]>
  /** 响应头 */
  responseHeaders?: Record<string, string | string[]>
  /** 使用数据 */
  usageData?: UsageData
  /** 账户ID */
  accountId?: string
  /** 响应时间 */
  responseTime?: number
  /** 状态码 */
  statusCode?: number
  /** HTTP方法 */
  method?: string
  /** 请求路径 */
  path?: string
  /** 用户代理 */
  userAgent?: string
  /** IP地址 */
  ipAddress?: string
  /** 是否流式请求 */
  isStreaming?: boolean
}

// 导出主要类型
export type {
  LogData,
  TokenDetails,
  CostDetails,
  LogOptions,
  UnifiedLogServiceConfig,
  ServiceDependencies,
  ServiceStats,
  FactoryStats,
  HealthCheckResult,
  IUnifiedLogService,
  IUnifiedLogServiceFactory,
  UsageData,
  ApiKey,
  RequestParams
}