import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiClient } from '@/config/api'
import { showToast } from '@/utils/toast'

export const useRequestLogsStore = defineStore('requestLogs', () => {
  // State
  const logs = ref([])
  const loading = ref(false)
  const exporting = ref(false)
  const stats = ref({
    totalRequests: 0,
    errorRate: 0,
    averageResponseTime: 0,
    topApiKeys: []
  })

  // API Key 映射相关状态
  const apiKeyList = ref([])
  const apiKeyLoading = ref(false)
  const apiKeyError = ref(null)
  const apiKeyLoadTime = ref(null)
  const apiKeyRetryCount = ref(0)

  // 筛选和分页状态
  const filters = ref({
    apiKeyId: '',
    startDate: '',
    endDate: '',
    statusCode: '',
    method: '',
    search: '',
    page: 1,
    limit: 50,
    sortBy: 'timestamp',
    sortOrder: 'desc'
  })

  const pagination = ref({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0
  })

  // 请求日志配置状态
  const config = ref({
    enabled: false,
    mode: 'performance',
    sampling: {
      successRate: 0.1,
      errorRate: 1.0,
      slowRequestThreshold: 5000
    },
    retention: {
      days: 30,
      maxEntries: 100000
    },
    async: {
      batchSize: 50,
      flushInterval: 2000
    }
  })

  const configLoading = ref(false)
  const configSaving = ref(false)

  // 日志去重和合并工具函数
  const mergeLogsByRequest = (logsList) => {
    if (!Array.isArray(logsList) || logsList.length === 0) {
      return []
    }

    // 使用Map进行去重，基于多个字段组合生成唯一key
    const logMap = new Map()
    const TIME_WINDOW = 30 * 1000 // 30秒时间窗口

    logsList.forEach((log) => {
      // 生成去重键：优先使用requestId，否则使用keyId+路径+时间窗口
      let dedupeKey
      if (log.requestId) {
        dedupeKey = `req_${log.requestId}`
      } else {
        // 将时间戳舍入到30秒窗口
        const timestamp = new Date(log.timestamp || Date.now()).getTime()
        const timeWindow = Math.floor(timestamp / TIME_WINDOW) * TIME_WINDOW
        dedupeKey = `${log.keyId || 'unknown'}_${log.path || '/'}_${log.method || 'GET'}_${timeWindow}`
      }

      if (logMap.has(dedupeKey)) {
        // 合并现有记录
        const existingLog = logMap.get(dedupeKey)
        const mergedLog = mergeLogEntries(existingLog, log)
        logMap.set(dedupeKey, mergedLog)
      } else {
        // 新记录，确保有必要的默认值
        logMap.set(dedupeKey, {
          ...log,
          _mergedCount: 1,
          _originalIds: [log.id || log.logId || log.timestamp]
        })
      }
    })

    return Array.from(logMap.values()).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
  }

  // 合并两个日志条目
  const mergeLogEntries = (existing, newLog) => {
    const merged = { ...existing }

    // 使用最新的时间戳和状态
    if (new Date(newLog.timestamp) > new Date(existing.timestamp)) {
      merged.timestamp = newLog.timestamp
      merged.statusCode = newLog.statusCode || existing.statusCode
      merged.responseTime = newLog.responseTime || existing.responseTime
    }

    // 聚合token信息
    merged.tokens = (merged.tokens || 0) + (newLog.tokens || 0)
    merged.inputTokens = (merged.inputTokens || 0) + (newLog.inputTokens || 0)
    merged.outputTokens = (merged.outputTokens || 0) + (newLog.outputTokens || 0)
    merged.cacheCreateTokens = (merged.cacheCreateTokens || 0) + (newLog.cacheCreateTokens || 0)
    merged.cacheReadTokens = (merged.cacheReadTokens || 0) + (newLog.cacheReadTokens || 0)

    // 聚合费用信息
    merged.cost = (merged.cost || 0) + (newLog.cost || 0)

    // 聚合tokenDetails和costDetails
    if (newLog.tokenDetails || newLog.costDetails) {
      merged.tokenDetails = {
        totalTokens:
          (merged.tokenDetails?.totalTokens || 0) + (newLog.tokenDetails?.totalTokens || 0),
        inputTokens:
          (merged.tokenDetails?.inputTokens || 0) + (newLog.tokenDetails?.inputTokens || 0),
        outputTokens:
          (merged.tokenDetails?.outputTokens || 0) + (newLog.tokenDetails?.outputTokens || 0),
        cacheCreateTokens:
          (merged.tokenDetails?.cacheCreateTokens || 0) +
          (newLog.tokenDetails?.cacheCreateTokens || 0),
        cacheReadTokens:
          (merged.tokenDetails?.cacheReadTokens || 0) + (newLog.tokenDetails?.cacheReadTokens || 0),
        cacheHitRatio: Math.max(
          merged.tokenDetails?.cacheHitRatio || 0,
          newLog.tokenDetails?.cacheHitRatio || 0
        ),
        tokenEfficiency: Math.max(
          merged.tokenDetails?.tokenEfficiency || 0,
          newLog.tokenDetails?.tokenEfficiency || 0
        ),
        ephemeral5mTokens:
          (merged.tokenDetails?.ephemeral5mTokens || 0) +
          (newLog.tokenDetails?.ephemeral5mTokens || 0),
        ephemeral1hTokens:
          (merged.tokenDetails?.ephemeral1hTokens || 0) +
          (newLog.tokenDetails?.ephemeral1hTokens || 0)
      }

      merged.costDetails = {
        totalCost: (merged.costDetails?.totalCost || 0) + (newLog.costDetails?.totalCost || 0),
        costPerToken: newLog.costDetails?.costPerToken || merged.costDetails?.costPerToken || 0,
        currency: newLog.costDetails?.currency || merged.costDetails?.currency || 'USD'
      }
    }

    // 合并usage字段
    if (newLog.usage) {
      merged.usage = {
        input_tokens: (merged.usage?.input_tokens || 0) + (newLog.usage?.input_tokens || 0),
        output_tokens: (merged.usage?.output_tokens || 0) + (newLog.usage?.output_tokens || 0),
        cache_creation_input_tokens:
          (merged.usage?.cache_creation_input_tokens || 0) +
          (newLog.usage?.cache_creation_input_tokens || 0),
        cache_read_input_tokens:
          (merged.usage?.cache_read_input_tokens || 0) +
          (newLog.usage?.cache_read_input_tokens || 0)
      }
    }

    // 保持最完整的headers信息
    if (newLog.requestHeaders && Object.keys(newLog.requestHeaders).length > 0) {
      merged.requestHeaders = { ...merged.requestHeaders, ...newLog.requestHeaders }
    }
    if (newLog.responseHeaders && Object.keys(newLog.responseHeaders).length > 0) {
      merged.responseHeaders = { ...merged.responseHeaders, ...newLog.responseHeaders }
    }

    // 保持最完整的请求和响应体
    if (newLog.requestBody && !merged.requestBody) {
      merged.requestBody = newLog.requestBody
    }
    if (newLog.responseBody && !merged.responseBody) {
      merged.responseBody = newLog.responseBody
    }

    // 更新合并计数和ID列表
    merged._mergedCount = (merged._mergedCount || 1) + 1
    merged._originalIds = [
      ...(merged._originalIds || []),
      newLog.id || newLog.logId || newLog.timestamp
    ]

    return merged
  }

  // Computed
  const filteredLogs = computed(() => {
    // 确保 logs.value 是一个数组
    const logsList = Array.isArray(logs.value) ? logs.value : []

    // 先进行去重合并
    const mergedLogs = mergeLogsByRequest(logsList)

    // 完全依赖后端过滤，移除前端搜索逻辑避免双重过滤
    return mergedLogs
  })

  const hasFilters = computed(() => {
    const f = filters.value
    return f.apiKeyId || f.startDate || f.endDate || f.statusCode || f.method || f.search
  })

  // API Key 映射计算属性
  const apiKeyMap = computed(() => {
    const map = new Map()

    if (Array.isArray(apiKeyList.value)) {
      apiKeyList.value.forEach((apiKey) => {
        if (apiKey && apiKey.id) {
          const mappedKey = {
            id: apiKey.id,
            name: apiKey.name || `API Key ${apiKey.id}`,
            status: apiKey.status || 'unknown'
          }
          map.set(apiKey.id, mappedKey)
        }
      })
    }

    return map
  })

  // 工具函数：判断是否需要重新获取API Key数据
  const shouldRefreshApiKeys = () => {
    // 如果没有数据或发生错误，需要刷新
    if (!apiKeyList.value?.length || apiKeyError.value) {
      return true
    }

    // 如果超过5分钟没有更新，需要刷新
    const now = Date.now()
    const lastLoadTime = apiKeyLoadTime.value
    const CACHE_DURATION = 5 * 60 * 1000 // 5分钟

    return !lastLoadTime || now - lastLoadTime > CACHE_DURATION
  }

  // 带重试机制的API Key获取函数
  const fetchApiKeysWithRetry = async (retryCount = 0) => {
    const MAX_RETRIES = 3
    const RETRY_DELAYS = [1000, 2000, 4000] // 递增延迟：1秒，2秒，4秒

    try {
      console.log(`[fetchApiKeys] 尝试获取 API Keys，重试次数: ${retryCount}`)

      const result = await apiClient.get('/admin/api-keys')

      // 验证响应结构
      if (!result) {
        throw new Error('服务器响应为空')
      }

      if (!result.success) {
        throw new Error(result.message || `服务器返回错误状态: success=${result.success}`)
      }

      if (!result.data) {
        throw new Error('响应数据为空')
      }

      let processedData = []

      // 处理不同的数据格式
      if (Array.isArray(result.data)) {
        processedData = result.data
      } else if (result.data.apiKeys && Array.isArray(result.data.apiKeys)) {
        processedData = result.data.apiKeys
      } else if (typeof result.data === 'object' && Object.keys(result.data).length > 0) {
        // 尝试从对象中提取数组
        const possibleArrays = Object.values(result.data).filter(Array.isArray)
        if (possibleArrays.length > 0) {
          processedData = possibleArrays[0]
        } else {
          console.warn('[fetchApiKeys] API Key 数据格式异常，无法解析数组:', result.data)
          processedData = []
        }
      } else {
        console.warn('[fetchApiKeys] 未知的 API Key 数据格式:', result.data)
        processedData = []
      }

      // 验证数据格式
      processedData = processedData.filter((item) => {
        if (!item || typeof item !== 'object') {
          console.warn('[fetchApiKeys] 跳过无效的 API Key 项:', item)
          return false
        }
        return true
      })

      // 为每个 API Key 添加必要的默认值
      processedData = processedData.map((apiKey) => ({
        id: apiKey.id || apiKey.keyId || apiKey._id || null,
        name: apiKey.name || apiKey.keyName || `API Key ${apiKey.id || 'Unknown'}`,
        status: apiKey.status || 'active',
        ...apiKey
      }))

      // 更新状态
      apiKeyList.value = processedData
      apiKeyError.value = null
      apiKeyLoadTime.value = Date.now()
      apiKeyRetryCount.value = 0

      console.log(`[fetchApiKeys] 成功获取 ${processedData.length} 个 API Keys`)
      return { success: true, data: processedData }
    } catch (error) {
      console.error(`[fetchApiKeys] 获取失败 (重试 ${retryCount}/${MAX_RETRIES}):`, {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        code: error.code,
        stack: error.stack?.substring(0, 200)
      })

      // 如果还有重试机会
      if (retryCount < MAX_RETRIES) {
        const delay = RETRY_DELAYS[retryCount] || 4000
        console.log(`[fetchApiKeys] ${delay}ms 后进行第 ${retryCount + 1} 次重试...`)

        // 延迟后重试
        await new Promise((resolve) => setTimeout(resolve, delay))
        return fetchApiKeysWithRetry(retryCount + 1)
      }

      // 重试耗尽，设置错误状态
      apiKeyError.value = {
        message: error.message || '获取 API Key 列表失败',
        code: error.code || 'FETCH_ERROR',
        status: error.response?.status || null,
        timestamp: Date.now(),
        retryCount
      }

      apiKeyRetryCount.value = retryCount

      // 提供友好的错误提示
      let friendlyMessage = '获取 API Key 列表失败'
      if (error.code === 'NETWORK_ERROR' || !navigator.onLine) {
        friendlyMessage = '网络连接失败，请检查网络后重试'
      } else if (error.response?.status === 401) {
        friendlyMessage = '认证失败，请重新登录'
      } else if (error.response?.status === 403) {
        friendlyMessage = '无权限访问 API Key 列表'
      } else if (error.response?.status >= 500) {
        friendlyMessage = '服务器错误，请稍后重试'
      } else if (error.message?.includes('timeout')) {
        friendlyMessage = '请求超时，请稍后重试'
      }

      showToast(friendlyMessage, 'error')
      throw error
    }
  }

  // Actions - API Key 管理
  const fetchApiKeys = async (forceRefresh = false) => {
    // 如果不强制刷新且缓存仍有效，直接返回缓存数据
    if (!forceRefresh && !shouldRefreshApiKeys()) {
      console.log('[fetchApiKeys] 使用缓存的 API Key 数据')
      return { success: true, data: apiKeyList.value, fromCache: true }
    }

    // 避免重复加载
    if (apiKeyLoading.value) {
      console.log('[fetchApiKeys] 正在加载中，等待完成...')
      // 等待当前加载完成
      while (apiKeyLoading.value) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      return { success: true, data: apiKeyList.value, waited: true }
    }

    apiKeyLoading.value = true

    try {
      const result = await fetchApiKeysWithRetry(0)

      // 确保数据正确设置到响应式状态中
      if (result.success && result.data) {
        console.log('[fetchApiKeys] 设置API Key数据到响应式状态:', result.data.length)
        // 注意：fetchApiKeysWithRetry内部已经设置了apiKeyList.value，这里再次确认
        if (!apiKeyList.value || apiKeyList.value.length !== result.data.length) {
          console.log('[fetchApiKeys] 重新设置apiKeyList.value')
          apiKeyList.value = result.data
        }
      }

      return result
    } finally {
      apiKeyLoading.value = false
    }
  }

  // 清除API Key缓存
  const clearApiKeyCache = () => {
    apiKeyList.value = []
    apiKeyError.value = null
    apiKeyLoadTime.value = null
    apiKeyRetryCount.value = 0
    console.log('[clearApiKeyCache] API Key 缓存已清除')
  }

  // 手动重试API Key加载
  const retryFetchApiKeys = async () => {
    console.log('[retryFetchApiKeys] 手动重试获取 API Keys')
    apiKeyError.value = null
    return fetchApiKeys(true)
  }

  // Actions - 日志查询
  const fetchLogs = async (params = {}) => {
    console.log('🚀 fetchLogs方法被调用!', { params, filtersValue: filters.value })
    loading.value = true
    try {
      // 转换参数映射：前端 -> 后端
      const queryParams = { ...filters.value, ...params }
      const backendParams = {
        ...queryParams,
        // 参数名映射
        keyId: queryParams.apiKeyId, // apiKeyId -> keyId
        status: queryParams.statusCode, // statusCode -> status
        // 保留其他筛选参数
        startDate: queryParams.startDate,
        endDate: queryParams.endDate,
        method: queryParams.method,
        search: queryParams.search, // 保留搜索功能
        page: queryParams.page,
        limit: queryParams.limit,
        sortBy: queryParams.sortBy,
        sortOrder: queryParams.sortOrder,
        // 移除已映射的参数
        apiKeyId: undefined,
        statusCode: undefined
      }

      // 清理 undefined 值
      Object.keys(backendParams).forEach((key) => {
        if (backendParams[key] === undefined || backendParams[key] === '') {
          delete backendParams[key]
        }
      })

      // 调试：打印发送的参数
      console.log('🔍 fetchLogs发送的参数:', backendParams)
      console.log('🔍 原始filters状态:', filters.value)

      const result = await apiClient.get('/admin/request-logs', { params: backendParams })

      if (result && result.success && result.data) {
        logs.value = result.data.logs || []
        pagination.value = {
          page: result.data.page || 1,
          limit: result.data.limit || 50,
          total: result.data.total || 0,
          totalPages: result.data.totalPages || 0
        }
      }
      return result
    } catch (error) {
      console.error('Failed to fetch request logs:', error)
      showToast('获取请求日志失败', 'error')
      throw error
    } finally {
      loading.value = false
    }
  }

  // 获取特定API Key的日志
  const fetchLogsByApiKey = async (apiKeyId, params = {}) => {
    loading.value = true
    try {
      const queryParams = { ...params }
      const result = await apiClient.get(`/admin/request-logs/${apiKeyId}`, { params: queryParams })

      if (result && result.success && result.data) {
        logs.value = result.data.logs || []
        pagination.value = {
          page: result.data.page || 1,
          limit: result.data.limit || 50,
          total: result.data.total || 0,
          totalPages: result.data.totalPages || 0
        }
      }
      return result
    } catch (error) {
      console.error('Failed to fetch API key logs:', error)
      showToast('获取API Key日志失败', 'error')
      throw error
    } finally {
      loading.value = false
    }
  }

  // 获取单个日志的详细信息
  const fetchLogDetails = async (logId) => {
    if (!logId) {
      console.warn('fetchLogDetails: logId为空')
      return null
    }

    try {
      console.log(`[fetchLogDetails] 获取日志详情: ${logId}`)
      const result = await apiClient.get(`/admin/request-logs/${logId}/details`)

      if (result && result.success && result.data) {
        console.log(`[fetchLogDetails] 成功获取日志详情:`, result.data)
        return result.data
      } else {
        console.warn(`[fetchLogDetails] API返回失败:`, result)
        return null
      }
    } catch (error) {
      console.error('Failed to fetch log details:', error)
      // 根据错误类型提供友好的错误信息
      if (error.response?.status === 404) {
        showToast('日志记录不存在或已被删除', 'error')
      } else if (error.response?.status === 403) {
        showToast('无权限查看此日志详情', 'error')
      } else {
        showToast('获取日志详情失败，请稍后重试', 'error')
      }
      throw error
    }
  }

  // 获取统计信息
  const fetchStats = async (timeRange = '24h') => {
    try {
      // 构建查询参数
      const params = {}
      // 根据时间范围设置查询参数
      if (timeRange === '24h') {
        const now = new Date()
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
        params.startDate = yesterday.toISOString()
        params.endDate = now.toISOString()
      } else if (timeRange === '7d') {
        const now = new Date()
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        params.startDate = weekAgo.toISOString()
        params.endDate = now.toISOString()
      }
      const result = await apiClient.get('/admin/request-logs/stats', { params })
      if (result && result.success && result.data) {
        const backendStats = result.data
        // 将后端数据格式转换为前端期望的格式
        const formattedStats = {
          totalRequests: backendStats.totalRequests || 0,
          errorRate:
            backendStats.totalRequests > 0
              ? (Object.entries(backendStats.statusCodes || {})
                  .filter(([code]) => code.startsWith('4') || code.startsWith('5'))
                  .reduce((sum, [, count]) => sum + count, 0) /
                  backendStats.totalRequests) *
                100
              : 0,
          averageResponseTime:
            backendStats.totalRequests > 0
              ? (backendStats.totalResponseTime || 0) / backendStats.totalRequests
              : 0,
          totalTokens: backendStats.totalTokens || 0,
          statusCodes: backendStats.statusCodes || {},
          models: backendStats.models || {},
          topApiKeys: Object.entries(backendStats.apiKeys || {})
            .map(([keyId, count]) => ({ keyId, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5)
        }
        stats.value = formattedStats
        return { success: true, data: formattedStats }
      } else {
        const defaultStats = {
          totalRequests: 0,
          errorRate: 0,
          averageResponseTime: 0,
          totalTokens: 0,
          statusCodes: {},
          models: {},
          topApiKeys: []
        }
        stats.value = defaultStats
        return { success: true, data: defaultStats }
      }
    } catch (error) {
      console.error('Failed to fetch log stats:', error)
      showToast('获取统计信息失败', 'error')
      throw error
    }
  }

  // 删除日志
  const deleteLogsByApiKey = async (apiKeyId) => {
    try {
      const result = await apiClient.delete(`/admin/request-logs/${apiKeyId}`)

      if (result && result.success) {
        showToast('日志删除成功', 'success')
        // 刷新列表
        await fetchLogs()
      }
      return result
    } catch (error) {
      console.error('Failed to delete logs:', error)
      showToast('删除日志失败', 'error')
      throw error
    }
  }

  // 导出日志
  const exportLogs = async (format = 'json', params = {}) => {
    exporting.value = true
    try {
      // 转换参数映射用��导出
      const rawParams = { ...filters.value, ...params }
      const exportParams = {
        format,
        ...rawParams,
        // 参数名映射
        keyId: rawParams.apiKeyId, // apiKeyId -> keyId
        status: rawParams.statusCode, // statusCode -> status
        // 移除前端专用参数和已映射的参数
        search: undefined,
        apiKeyId: undefined,
        statusCode: undefined
      }

      // 清理 undefined 值
      Object.keys(exportParams).forEach((key) => {
        if (exportParams[key] === undefined || exportParams[key] === '') {
          delete exportParams[key]
        }
      })

      // 显示开始导出的提示
      showToast(`正在导出日志为 ${format.toUpperCase()} 格式...`, 'info')

      // 使用 apiClient 发起 GET 请求，这样可以自动携带认证信息
      const response = await apiClient.get('/admin/request-logs/export', {
        params: exportParams,
        responseType: 'blob' // 获取 blob 响应
      })

      // 获取文件名，优先使用响应头中的文件名
      let filename = `request-logs-${new Date().getTime()}.${format}`
      const contentDisposition = response.headers?.get?.('Content-Disposition')
      if (contentDisposition) {
        const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
        if (match && match[1]) {
          filename = match[1].replace(/['"]/g, '')
        }
      }

      // 创建下载链接并触发下载
      const blob = response.data
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      link.style.display = 'none'

      // 添加到DOM并触发下载
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      // 清理临时URL
      window.URL.revokeObjectURL(url)

      showToast(`日志已成功导出为 ${format.toUpperCase()} 格式`, 'success')

      return { success: true, filename }
    } catch (error) {
      console.error('Failed to export logs:', error)
      const errorMessage = error.message || '导出日志失败'
      showToast(errorMessage, 'error')
      throw error
    } finally {
      exporting.value = false
    }
  }

  // Actions - 配置管理
  const loadConfig = async () => {
    configLoading.value = true
    try {
      const result = await apiClient.get('/admin/request-logs/config')
      if (result && result.success && result.data) {
        // 将后端数据结构映射到前端期望的结构
        const backendConfig = result.data
        // 处理 retentionDays 的数据类型问题
        let retentionDaysValue = 30
        if (typeof backendConfig.retentionDays === 'number') {
          retentionDaysValue = backendConfig.retentionDays
        } else if (
          typeof backendConfig.retentionDays === 'object' &&
          backendConfig.retentionDays?.days
        ) {
          retentionDaysValue = backendConfig.retentionDays.days
        }
        const mappedConfig = {
          enabled: backendConfig.enabled || false,
          mode: backendConfig.level === 'debug' ? 'detailed' : 'performance',
          level: backendConfig.level || 'info',
          retentionDays: retentionDaysValue,
          maxFileSize: backendConfig.maxFileSize || 10,
          maxFiles: backendConfig.maxFiles || 10,
          includeHeaders:
            backendConfig.includeHeaders !== undefined ? backendConfig.includeHeaders : true,
          includeBody: backendConfig.includeBody !== undefined ? backendConfig.includeBody : true,
          includeResponse:
            backendConfig.includeResponse !== undefined ? backendConfig.includeResponse : true,
          includeErrors:
            backendConfig.includeErrors !== undefined ? backendConfig.includeErrors : true,
          filterSensitiveData:
            backendConfig.filterSensitiveData !== undefined
              ? backendConfig.filterSensitiveData
              : true,
          updatedAt: backendConfig.updatedAt,
          // 保持原有的嵌套结构以兼容现有代码
          sampling: {
            successRate: config.value.sampling?.successRate || 0.1,
            errorRate: config.value.sampling?.errorRate || 1.0,
            slowRequestThreshold: config.value.sampling?.slowRequestThreshold || 5000
          },
          retention: {
            days: retentionDaysValue,
            maxEntries: config.value.retention?.maxEntries || 100000
          },
          async: {
            batchSize: config.value.async?.batchSize || 50,
            flushInterval: config.value.async?.flushInterval || 2000
          }
        }
        config.value = mappedConfig
      }
      return result
    } catch (error) {
      showToast('加载配置失败', 'error')
      throw error
    } finally {
      configLoading.value = false
    }
  }

  const saveConfig = async (newConfig) => {
    configSaving.value = true
    try {
      const result = await apiClient.put('/admin/request-logs/config', newConfig)

      if (result && result.success) {
        config.value = { ...config.value, ...result.data }
        showToast('配置保存成功', 'success')
      }
      return result
    } catch (error) {
      console.error('Failed to save request logging config:', error)
      showToast('保存配置失败', 'error')
      throw error
    } finally {
      configSaving.value = false
    }
  }

  // 重置配置
  const resetConfig = async () => {
    const defaultConfig = {
      enabled: false,
      mode: 'performance',
      sampling: {
        successRate: 0.1,
        errorRate: 1.0,
        slowRequestThreshold: 5000
      },
      retention: {
        days: 30,
        maxEntries: 100000
      },
      async: {
        batchSize: 50,
        flushInterval: 2000
      }
    }

    return await saveConfig(defaultConfig)
  }

  // Utility functions
  const updateFilters = (newFilters) => {
    filters.value = { ...filters.value, ...newFilters }
  }

  const clearFilters = () => {
    filters.value = {
      apiKeyId: '',
      startDate: '',
      endDate: '',
      statusCode: '',
      method: '',
      search: '',
      page: 1,
      limit: 50,
      sortBy: 'timestamp',
      sortOrder: 'desc'
    }
  }

  const refreshLogs = async () => {
    await fetchLogs()
    await fetchStats()
  }

  // 格式化数据的辅助函数
  const formatLogEntry = (log) => {
    return {
      ...log,
      timestamp: new Date(log.timestamp).toLocaleString('zh-CN'),
      duration: log.responseTime ? `${log.responseTime}ms` : 'N/A',
      statusClass: getStatusClass(log.statusCode),
      methodClass: getMethodClass(log.method)
    }
  }

  const getStatusClass = (statusCode) => {
    const code = parseInt(statusCode)
    if (!code) return 'text-gray-500'
    if (code >= 200 && code < 300) return 'text-green-600'
    if (code >= 300 && code < 400) return 'text-yellow-600'
    if (code >= 400 && code < 500) return 'text-orange-600'
    if (code >= 500) return 'text-red-600'
    return 'text-gray-500'
  }

  const getMethodClass = (method) => {
    const classes = {
      GET: 'text-blue-600',
      POST: 'text-green-600',
      PUT: 'text-yellow-600',
      DELETE: 'text-red-600',
      PATCH: 'text-purple-600'
    }
    return classes[method] || 'text-gray-600'
  }

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const formatDuration = (ms) => {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${(ms / 60000).toFixed(1)}m`
  }

  return {
    // State
    logs,
    loading,
    exporting,
    stats,
    filters,
    pagination,
    config,
    configLoading,
    configSaving,

    // API Key 映射相关状态
    apiKeyList,
    apiKeyLoading,
    apiKeyError,
    apiKeyLoadTime,
    apiKeyRetryCount,

    // Computed
    filteredLogs,
    hasFilters,
    apiKeyMap,

    // Actions - API Key 管理
    fetchApiKeys,
    clearApiKeyCache,
    retryFetchApiKeys,
    shouldRefreshApiKeys,

    // Actions - 日志管理
    fetchLogs,
    fetchLogsByApiKey,
    fetchLogDetails,
    fetchStats,
    deleteLogsByApiKey,
    exportLogs,
    refreshLogs,

    // Actions - 配置管理
    loadConfig,
    saveConfig,
    resetConfig,

    // Utilities
    updateFilters,
    clearFilters,
    formatLogEntry,
    getStatusClass,
    getMethodClass,
    formatBytes,
    formatDuration
  }
})
