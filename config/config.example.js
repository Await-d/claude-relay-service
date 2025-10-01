const path = require('path')
require('dotenv').config()

const config = {
  // 🌐 服务器配置
  server: {
    port: parseInt(process.env.PORT) || 3000,
    host: process.env.HOST || '0.0.0.0',
    nodeEnv: process.env.NODE_ENV || 'development',
    trustProxy: process.env.TRUST_PROXY === 'true'
  },

  // 🔐 安全配置
  security: {
    jwtSecret: process.env.JWT_SECRET || 'CHANGE-THIS-JWT-SECRET-IN-PRODUCTION',
    adminSessionTimeout: parseInt(process.env.ADMIN_SESSION_TIMEOUT) || 86400000, // 24小时
    apiKeyPrefix: process.env.API_KEY_PREFIX || 'cr_',
    encryptionKey: process.env.ENCRYPTION_KEY || 'CHANGE-THIS-32-CHARACTER-KEY-NOW'
  },

  // 🗄️ 数据库配置 (Database Configuration)
  database: {
    // 数据库类型选择：redis, mongodb, postgresql, mysql
    // Database type selection: redis, mongodb, postgresql, mysql
    type: process.env.DATABASE_TYPE || 'redis',

    // 默认数据库（当前为Redis，保持向后兼容）
    // Default database (currently Redis for backward compatibility)
    defaultAdapter: 'redis',

    // Redis 配置（当前默认数据库）
    // Redis configuration (current default database)
    redis: {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD || '',
      db: parseInt(process.env.REDIS_DB) || 0,
      connectTimeout: 10000,
      commandTimeout: 5000,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      enableTLS: process.env.REDIS_ENABLE_TLS === 'true'
    }

    // MongoDB 配置模板（未来支持）
    // MongoDB configuration template (future support)
    // mongodb: {
    //   uri: process.env.MONGODB_URI || 'mongodb://localhost:27017',
    //   database: process.env.MONGODB_DATABASE || 'claude_relay',
    //   options: {
    //     useNewUrlParser: true,
    //     useUnifiedTopology: true,
    //     maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE) || 10,
    //     serverSelectionTimeoutMS: parseInt(process.env.MONGODB_SERVER_SELECTION_TIMEOUT) || 5000,
    //     socketTimeoutMS: parseInt(process.env.MONGODB_SOCKET_TIMEOUT) || 45000,
    //     family: 4 // Use IPv4, skip trying IPv6
    //   },
    //   // 集合名称映射
    //   collections: {
    //     apiKeys: process.env.MONGODB_COLLECTION_API_KEYS || 'api_keys',
    //     claudeAccounts: process.env.MONGODB_COLLECTION_CLAUDE_ACCOUNTS || 'claude_accounts',
    //     openaiAccounts: process.env.MONGODB_COLLECTION_OPENAI_ACCOUNTS || 'openai_accounts',
    //     sessions: process.env.MONGODB_COLLECTION_SESSIONS || 'sessions',
    //     usageStats: process.env.MONGODB_COLLECTION_USAGE_STATS || 'usage_stats',
    //     systemStats: process.env.MONGODB_COLLECTION_SYSTEM_STATS || 'system_stats',
    //     concurrency: process.env.MONGODB_COLLECTION_CONCURRENCY || 'concurrency'
    //   }
    // },

    // PostgreSQL 配置模板（未来支持）
    // PostgreSQL configuration template (future support)
    // postgresql: {
    //   host: process.env.POSTGRES_HOST || 'localhost',
    //   port: parseInt(process.env.POSTGRES_PORT) || 5432,
    //   database: process.env.POSTGRES_DATABASE || 'claude_relay',
    //   username: process.env.POSTGRES_USERNAME || 'claude_relay_user',
    //   password: process.env.POSTGRES_PASSWORD || '',
    //   ssl: process.env.POSTGRES_SSL === 'true',
    //   // 连接池配置
    //   pool: {
    //     max: parseInt(process.env.POSTGRES_POOL_MAX) || 20,
    //     min: parseInt(process.env.POSTGRES_POOL_MIN) || 5,
    //     acquire: parseInt(process.env.POSTGRES_POOL_ACQUIRE) || 30000,
    //     idle: parseInt(process.env.POSTGRES_POOL_IDLE) || 10000
    //   },
    //   // 表名映射
    //   tables: {
    //     apiKeys: process.env.POSTGRES_TABLE_API_KEYS || 'api_keys',
    //     claudeAccounts: process.env.POSTGRES_TABLE_CLAUDE_ACCOUNTS || 'claude_accounts',
    //     openaiAccounts: process.env.POSTGRES_TABLE_OPENAI_ACCOUNTS || 'openai_accounts',
    //     sessions: process.env.POSTGRES_TABLE_SESSIONS || 'sessions',
    //     usageStats: process.env.POSTGRES_TABLE_USAGE_STATS || 'usage_stats',
    //     systemStats: process.env.POSTGRES_TABLE_SYSTEM_STATS || 'system_stats'
    //   }
    // },

    // MySQL 配置模板（未来支持）
    // MySQL configuration template (future support)
    // mysql: {
    //   host: process.env.MYSQL_HOST || 'localhost',
    //   port: parseInt(process.env.MYSQL_PORT) || 3306,
    //   database: process.env.MYSQL_DATABASE || 'claude_relay',
    //   username: process.env.MYSQL_USERNAME || 'claude_relay_user',
    //   password: process.env.MYSQL_PASSWORD || '',
    //   charset: process.env.MYSQL_CHARSET || 'utf8mb4',
    //   // 连接池配置
    //   pool: {
    //     max: parseInt(process.env.MYSQL_POOL_MAX) || 20,
    //     min: parseInt(process.env.MYSQL_POOL_MIN) || 5,
    //     acquire: parseInt(process.env.MYSQL_POOL_ACQUIRE) || 30000,
    //     idle: parseInt(process.env.MYSQL_POOL_IDLE) || 10000
    //   },
    //   // 表名映射
    //   tables: {
    //     apiKeys: process.env.MYSQL_TABLE_API_KEYS || 'api_keys',
    //     claudeAccounts: process.env.MYSQL_TABLE_CLAUDE_ACCOUNTS || 'claude_accounts',
    //     openaiAccounts: process.env.MYSQL_TABLE_OPENAI_ACCOUNTS || 'openai_accounts',
    //     sessions: process.env.MYSQL_TABLE_SESSIONS || 'sessions',
    //     usageStats: process.env.MYSQL_TABLE_USAGE_STATS || 'usage_stats',
    //     systemStats: process.env.MYSQL_TABLE_SYSTEM_STATS || 'system_stats'
    //   }
    // }
  },

  // 📊 Redis配置（保持向后兼容性）
  // Redis configuration (maintained for backward compatibility)
  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || '',
    db: parseInt(process.env.REDIS_DB) || 0,
    connectTimeout: 10000,
    commandTimeout: 5000,
    retryDelayOnFailover: 100,
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    enableTLS: process.env.REDIS_ENABLE_TLS === 'true'
  },

  // 🎯 Claude API配置
  claude: {
    apiUrl: process.env.CLAUDE_API_URL || 'https://api.anthropic.com/v1/messages',
    apiVersion: process.env.CLAUDE_API_VERSION || '2023-06-01',
    betaHeader:
      process.env.CLAUDE_BETA_HEADER ||
      'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14',
    unifiedUserAgent: {
      enabled: process.env.CLAUDE_USE_UNIFIED_UA === 'true',
      cacheTTLSeconds: parseInt(process.env.CLAUDE_UA_CACHE_TTL) || 90000,
      cacheKey: process.env.CLAUDE_UA_CACHE_KEY || 'claude_code_user_agent:daily',
      defaultValue: process.env.CLAUDE_UA_DEFAULT || 'claude-cli/1.0.119 (external, cli)'
    }
  },

  // ☁️ Bedrock API配置
  bedrock: {
    enabled: process.env.CLAUDE_CODE_USE_BEDROCK === '1',
    defaultRegion: process.env.AWS_REGION || 'us-east-1',
    smallFastModelRegion: process.env.ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION,
    defaultModel: process.env.ANTHROPIC_MODEL || 'us.anthropic.claude-sonnet-4-20250514-v1:0',
    smallFastModel:
      process.env.ANTHROPIC_SMALL_FAST_MODEL || 'us.anthropic.claude-3-5-haiku-20241022-v1:0',
    maxOutputTokens: parseInt(process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS) || 4096,
    maxThinkingTokens: parseInt(process.env.MAX_THINKING_TOKENS) || 1024,
    enablePromptCaching: process.env.DISABLE_PROMPT_CACHING !== '1'
  },

  // 🌐 代理配置
  proxy: {
    timeout: parseInt(process.env.DEFAULT_PROXY_TIMEOUT) || 30000,
    maxRetries: parseInt(process.env.MAX_PROXY_RETRIES) || 3,
    // IP协议族配置：true=IPv4, false=IPv6, 默认IPv4（兼容性更好）
    useIPv4: process.env.PROXY_USE_IPV4 !== 'false' // 默认 true，只有明确设置为 'false' 才使用 IPv6
  },

  // 📈 使用限制
  limits: {
    defaultTokenLimit: parseInt(process.env.DEFAULT_TOKEN_LIMIT) || 1000000
  },

  // 🎯 调度策略配置
  scheduling: {
    defaultStrategy: process.env.DEFAULT_SCHEDULING_STRATEGY || 'least_recent',
    enableAccountOverride: process.env.ENABLE_ACCOUNT_OVERRIDE !== 'false',
    enableGroupOverride: process.env.ENABLE_GROUP_OVERRIDE !== 'false'
  },

  // 📝 日志配置
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    dirname: path.join(__dirname, '..', 'logs'),
    maxSize: process.env.LOG_MAX_SIZE || '10m',
    maxFiles: parseInt(process.env.LOG_MAX_FILES) || 5
  },

  // 📊 API Key 请求日志记录配置
  // 记录所有请求（简化版本）
  requestLogging: {
    // 基础开关控制
    enabled: process.env.REQUEST_LOGGING_ENABLED === 'true', // 默认禁用，确保向后兼容

    // 记录模式：'basic' | 'detailed' | 'debug'
    // basic: 记录基础信息（时间、状态码、响应时间）
    // detailed: 记录详细信息（包括 User-Agent、IP、错误信息）
    // debug: 记录调试信息（包括请求头、响应头摘要）
    mode: process.env.REQUEST_LOGGING_MODE || 'basic',

    // 异步批量处理配置 - 确保零阻塞关键路径
    async: {
      // 批量大小：积累多少条日志后批量写入（默认5条，更快写入）
      batchSize: parseInt(process.env.REQUEST_LOGGING_BATCH_SIZE) || 5,

      // 批量超时：即使未达到批量大小，多长时间后强制写入（毫秒，默认2秒）
      batchTimeout: parseInt(process.env.REQUEST_LOGGING_BATCH_TIMEOUT) || 2000,

      // 队列最大长度：防止内存溢出，超过此长度丢弃最旧的日志
      maxQueueSize: parseInt(process.env.REQUEST_LOGGING_MAX_QUEUE_SIZE) || 1000,

      // 队列满时的策略：'drop_oldest' | 'drop_newest' | 'block'
      // drop_oldest: 丢弃最旧的日志（推荐）
      // drop_newest: 丢弃最新的日志
      // block: 阻塞直到有空间（不推荐生产环境）
      queueFullStrategy: process.env.REQUEST_LOGGING_QUEUE_FULL_STRATEGY || 'drop_oldest',

      // 写入失败重试次数
      maxRetries: parseInt(process.env.REQUEST_LOGGING_MAX_RETRIES) || 3,

      // 重试间隔（毫秒）
      retryDelay: parseInt(process.env.REQUEST_LOGGING_RETRY_DELAY) || 1000
    },

    // 数据保留和清理配置
    retention: {
      // 日志数据保留时间（毫秒），默认7天
      maxAge:
        parseInt(process.env.REQUEST_LOGGING_RETENTION_DAYS) * 24 * 60 * 60 * 1000 ||
        7 * 24 * 60 * 60 * 1000
    },

    // Redis 存储配置
    storage: {
      // 日志条目键前缀
      keyPrefix: process.env.REQUEST_LOGGING_KEY_PREFIX || 'request_log',

      // 索引键前缀（用于快速查询）
      indexKeyPrefix: process.env.REQUEST_LOGGING_INDEX_KEY_PREFIX || 'request_log_index'
    },

    // 数据过滤配置 - 保护敏感信息
    filtering: {
      // 自动过滤敏感头信息
      sensitiveHeaders: ['authorization', 'x-api-key', 'cookie', 'x-session-token'],

      // IP 地址脱敏（保留前三段）
      maskIpAddress: process.env.REQUEST_LOGGING_MASK_IP === 'true',

      // User-Agent 截断长度
      maxUserAgentLength: parseInt(process.env.REQUEST_LOGGING_MAX_UA_LENGTH) || 200
    },

    // 性能监控配置
    monitoring: {
      // 启用内部性能监控
      enabled: process.env.REQUEST_LOGGING_MONITORING_ENABLED === 'true',

      // 监控指标收集间隔（毫秒）
      metricsInterval: parseInt(process.env.REQUEST_LOGGING_METRICS_INTERVAL) || 60000, // 1分钟

      // 性能警告阈值
      warningThresholds: {
        // 队列长度警告阈值
        queueLength: parseInt(process.env.REQUEST_LOGGING_QUEUE_WARNING_THRESHOLD) || 800,

        // 批量写入延迟警告阈值（毫秒）
        batchWriteDelay: parseInt(process.env.REQUEST_LOGGING_WRITE_WARNING_THRESHOLD) || 1000,

        // 内存使用警告阈值（MB）
        memoryUsage: parseInt(process.env.REQUEST_LOGGING_MEMORY_WARNING_THRESHOLD) || 100
      }
    }
  },
  // 🔧 系统配置
  system: {
    cleanupInterval: parseInt(process.env.CLEANUP_INTERVAL) || 3600000, // 1小时
    tokenUsageRetention: parseInt(process.env.TOKEN_USAGE_RETENTION) || 2592000000, // 30天
    healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL) || 60000, // 1分钟
    timezone: process.env.SYSTEM_TIMEZONE || 'Asia/Shanghai', // 默认UTC+8（中国时区）
    timezoneOffset: parseInt(process.env.TIMEZONE_OFFSET) || 8 // UTC偏移小时数，默认+8
  },

  // 🎨 Web界面配置
  web: {
    title: process.env.WEB_TITLE || 'Claude Relay Service',
    description:
      process.env.WEB_DESCRIPTION ||
      'Multi-account Claude API relay service with beautiful management interface',
    logoUrl: process.env.WEB_LOGO_URL || '/assets/logo.png',
    enableCors: process.env.ENABLE_CORS === 'true',
    sessionSecret: process.env.WEB_SESSION_SECRET || 'CHANGE-THIS-SESSION-SECRET'
  },

  // 🔒 客户端限制配置
  clientRestrictions: {
    // 预定义的客户端列表
    predefinedClients: [
      {
        id: 'claude_code',
        name: 'ClaudeCode',
        description: 'Official Claude Code CLI',
        // 匹配 Claude CLI 的 User-Agent
        // 示例: claude-cli/1.0.58 (external, cli)
        userAgentPattern: /^claude-cli\/[\d.]+\s+\(/i
      },
      {
        id: 'gemini_cli',
        name: 'Gemini-CLI',
        description: 'Gemini Command Line Interface',
        // 匹配 GeminiCLI 的 User-Agent
        // 示例: GeminiCLI/v18.20.8 (darwin; arm64)
        userAgentPattern: /^GeminiCLI\/v?[\d.]+\s+\(/i
      }
      // 添加自定义客户端示例：
      // {
      //   id: 'custom_client',
      //   name: 'My Custom Client',
      //   description: 'My custom API client',
      //   userAgentPattern: /^MyClient\/[\d\.]+/i
      // }
    ],
    // 是否允许自定义客户端（未来功能）
    allowCustomClients: process.env.ALLOW_CUSTOM_CLIENTS === 'true'
  },

  // 📢 Webhook通知配置
  webhook: {
    enabled: process.env.WEBHOOK_ENABLED !== 'false', // 默认启用
    urls: process.env.WEBHOOK_URLS
      ? process.env.WEBHOOK_URLS.split(',').map((url) => url.trim())
      : [],
    timeout: parseInt(process.env.WEBHOOK_TIMEOUT) || 10000, // 10秒超时
    retries: parseInt(process.env.WEBHOOK_RETRIES) || 3 // 重试3次
  },

  // 🧠 智能负载均衡配置
  loadBalancing: {
    // 启用智能负载均衡
    enabled: process.env.LOAD_BALANCING_ENABLED !== 'false',
    
    // 默认调度策略: 'least_used', 'least_recent', 'lowest_cost', 'balanced', 'weighted_random'
    defaultStrategy: process.env.LOAD_BALANCING_STRATEGY || 'balanced',
    
    // 账户选择超时时间（毫秒）
    selectionTimeout: parseInt(process.env.LOAD_BALANCING_SELECTION_TIMEOUT) || 5000,
    
    // 健康检查配置
    healthCheck: {
      // 检查间隔（秒）
      interval: parseInt(process.env.LOAD_BALANCING_HEALTH_CHECK_INTERVAL) || 30,
      // 响应时间阈值（毫秒）
      responseTimeThreshold: parseInt(process.env.LOAD_BALANCING_RESPONSE_TIME_THRESHOLD) || 5000,
      // 成功率阈值（0-1）
      successRateThreshold: parseFloat(process.env.LOAD_BALANCING_SUCCESS_RATE_THRESHOLD) || 0.95,
      // 错误率阈值（0-1）
      errorRateThreshold: parseFloat(process.env.LOAD_BALANCING_ERROR_RATE_THRESHOLD) || 0.05
    },
    
    // 故障恢复配置
    failureRecovery: {
      // 连续失败次数阈值
      failureThreshold: parseInt(process.env.LOAD_BALANCING_FAILURE_THRESHOLD) || 5,
      // 临时故障重试延迟（秒）
      temporaryFailureDelay: parseInt(process.env.LOAD_BALANCING_TEMPORARY_FAILURE_DELAY) || 300,
      // 最大退避时间（秒）
      maxBackoffTime: parseInt(process.env.LOAD_BALANCING_MAX_BACKOFF_TIME) || 3600,
      // 启用熔断器
      enableCircuitBreaker: process.env.LOAD_BALANCING_ENABLE_CIRCUIT_BREAKER !== 'false'
    },
    
    // 算法权重配置
    algorithmWeights: {
      costPriority: parseFloat(process.env.LOAD_BALANCING_COST_PRIORITY_WEIGHT) || 0.4,
      performance: parseFloat(process.env.LOAD_BALANCING_PERFORMANCE_WEIGHT) || 0.3,
      loadBalance: parseFloat(process.env.LOAD_BALANCING_LOAD_BALANCE_WEIGHT) || 0.2,
      reliability: parseFloat(process.env.LOAD_BALANCING_RELIABILITY_WEIGHT) || 0.1
    }
  },

  // 📤 API导出配置
  apiExport: {
    // 启用API导出功能
    enabled: process.env.API_EXPORT_ENABLED !== 'false',
    
    // 导出文件存储目录
    outputDir: process.env.API_EXPORT_OUTPUT_DIR || './temp/exports',
    
    // 默认启用敏感数据脱敏
    sanitizeData: process.env.API_EXPORT_SANITIZE_DATA !== 'false',
    
    // 批处理大小
    batchSize: parseInt(process.env.API_EXPORT_BATCH_SIZE) || 100,
    
    // 支持的导出格式
    supportedFormats: process.env.API_EXPORT_SUPPORTED_FORMATS 
      ? process.env.API_EXPORT_SUPPORTED_FORMATS.split(',').map(f => f.trim())
      : ['json', 'csv'],
    
    // 文件自动清理配置
    autoCleanup: {
      enabled: process.env.API_EXPORT_AUTO_CLEANUP_ENABLED !== 'false',
      // 文件保留时间（小时）
      maxAgeHours: parseInt(process.env.API_EXPORT_MAX_AGE_HOURS) || 24,
      // 清理检查间隔（小时）
      checkInterval: parseInt(process.env.API_EXPORT_CLEANUP_CHECK_INTERVAL) || 6
    }
  },

  // 🚀 查询优化配置
  queryOptimizer: {
    // 启用查询优化
    enabled: process.env.QUERY_OPTIMIZER_ENABLED !== 'false',
    
    // 批量查询大小
    batchSize: parseInt(process.env.QUERY_OPTIMIZER_BATCH_SIZE) || 100,
    // 管道大小
    pipelineSize: parseInt(process.env.QUERY_OPTIMIZER_PIPELINE_SIZE) || 50,
    // 最大并发数
    maxConcurrency: parseInt(process.env.QUERY_OPTIMIZER_MAX_CONCURRENCY) || 10,
    
    // 缓存配置
    cache: {
      enabled: process.env.QUERY_CACHE_ENABLED !== 'false',
      ttl: parseInt(process.env.QUERY_CACHE_TTL) || 300,           // 5分钟
      prefix: process.env.QUERY_CACHE_PREFIX || 'query_cache:',
      maxSize: parseInt(process.env.QUERY_CACHE_MAX_SIZE) || 1000  // 最大缓存条目数
    },
    
    // 性能监控
    performance: {
      enableProfiling: process.env.QUERY_OPTIMIZER_ENABLE_PROFILING === 'true',
      queryTimeout: parseInt(process.env.QUERY_OPTIMIZER_QUERY_TIMEOUT) || 30000,      // 30秒
      memoryLimit: parseInt(process.env.QUERY_OPTIMIZER_MEMORY_LIMIT) || 104857600     // 100MB
    }
  },

  // 🛠️ 开发配置
  development: {
    debug: process.env.DEBUG === 'true',
    hotReload: process.env.HOT_RELOAD === 'true'
  }
}

module.exports = config
