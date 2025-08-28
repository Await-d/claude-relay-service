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
      'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14'
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
  // 基于性能优先设计，采用异步批量处理和智能采样策略
  requestLogging: {
    // 基础开关控制
    enabled: process.env.REQUEST_LOGGING_ENABLED === 'true', // 默认禁用，确保向后兼容

    // 记录模式：'basic' | 'detailed' | 'debug'
    // basic: 记录基础信息（时间、状态码、响应时间）
    // detailed: 记录详细信息（包括 User-Agent、IP、错误信息）
    // debug: 记录调试信息（包括请求头、响应头摘要）
    mode: process.env.REQUEST_LOGGING_MODE || 'basic',

    // 智能采样配置 - 优化性能，避免记录所有请求
    sampling: {
      // 采样率：0.0-1.0，0.1 表示记录 10% 的请求
      rate: parseFloat(process.env.REQUEST_LOGGING_SAMPLING_RATE) || 0.1,

      // 错误请求优先记录（覆盖采样率限制）
      alwaysLogErrors: process.env.REQUEST_LOGGING_ALWAYS_LOG_ERRORS !== 'false', // 默认启用

      // 慢请求优先记录（响应时间超过阈值的请求）
      slowRequestThreshold: parseInt(process.env.REQUEST_LOGGING_SLOW_THRESHOLD) || 5000, // 5秒
      alwaysLogSlowRequests: process.env.REQUEST_LOGGING_ALWAYS_LOG_SLOW !== 'false', // 默认启用

      // 基于 API Key 的采样控制（未来功能）
      perKeyRateLimit: parseInt(process.env.REQUEST_LOGGING_PER_KEY_RATE_LIMIT) || 100, // 每个 API Key 每小时最多记录 100 条

      // 动态采样：基于系统负载自动调整采样率（未来功能）
      enableDynamicSampling: process.env.REQUEST_LOGGING_DYNAMIC_SAMPLING === 'true' // 默认禁用
    },

    // 异步批量处理配置 - 确保零阻塞关键路径
    async: {
      // 批量大小：积累多少条日志后批量写入
      batchSize: parseInt(process.env.REQUEST_LOGGING_BATCH_SIZE) || 50,

      // 批量超时：即使未达到批量大小，多长时间后强制写入（毫秒）
      batchTimeout: parseInt(process.env.REQUEST_LOGGING_BATCH_TIMEOUT) || 5000, // 5秒

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

  // 🛠️ 开发配置
  development: {
    debug: process.env.DEBUG === 'true',
    hotReload: process.env.HOT_RELOAD === 'true'
  }
}

module.exports = config
