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

  // Computed
  const filteredLogs = computed(() => {
    if (!filters.value.search) return logs.value

    const searchTerm = filters.value.search.toLowerCase()
    return logs.value.filter(
      (log) =>
        log.apiKey?.name?.toLowerCase().includes(searchTerm) ||
        log.request?.userAgent?.toLowerCase().includes(searchTerm) ||
        log.request?.ip?.includes(searchTerm) ||
        log.request?.path?.toLowerCase().includes(searchTerm)
    )
  })

  const hasFilters = computed(() => {
    const f = filters.value
    return f.apiKeyId || f.startDate || f.endDate || f.statusCode || f.method || f.search
  })

  // Actions - 日志查询
  const fetchLogs = async (params = {}) => {
    loading.value = true
    try {
      const queryParams = { ...filters.value, ...params }
      const result = await apiClient.get('/admin/request-logs', { params: queryParams })

      if (result && result.success) {
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

      if (result && result.success) {
        logs.value = result.data.logs || []
        pagination.value = result.data.pagination || {}
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

  // 获取统计信息
  const fetchStats = async (timeRange = '24h') => {
    try {
      const result = await apiClient.get('/admin/request-logs/stats', {
        params: { timeRange }
      })

      if (result && result.success) {
        stats.value = result.data || {}
      }
      return result
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
      const exportParams = { format, ...filters.value, ...params }
      const result = await apiClient.post('/admin/request-logs/export', exportParams)

      if (result && result.success) {
        // 创建下载链接
        const blob = new Blob([result.data.content], {
          type: format === 'csv' ? 'text/csv' : 'application/json'
        })
        const url = window.URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = result.data.filename || `request-logs-${new Date().getTime()}.${format}`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        window.URL.revokeObjectURL(url)

        showToast(`日志已导出为 ${format.toUpperCase()} 格式`, 'success')
      }
      return result
    } catch (error) {
      console.error('Failed to export logs:', error)
      showToast('导出日志失败', 'error')
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

      if (result && result.success) {
        config.value = { ...config.value, ...result.data }
      }
      return result
    } catch (error) {
      console.error('Failed to load request logging config:', error)
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
      duration: log.response?.duration ? `${log.response.duration}ms` : 'N/A',
      statusClass: getStatusClass(log.response?.statusCode),
      methodClass: getMethodClass(log.request?.method)
    }
  }

  const getStatusClass = (statusCode) => {
    if (!statusCode) return 'text-gray-500'
    if (statusCode >= 200 && statusCode < 300) return 'text-green-600'
    if (statusCode >= 300 && statusCode < 400) return 'text-yellow-600'
    if (statusCode >= 400 && statusCode < 500) return 'text-orange-600'
    if (statusCode >= 500) return 'text-red-600'
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

    // Computed
    filteredLogs,
    hasFilters,

    // Actions - 日志管理
    fetchLogs,
    fetchLogsByApiKey,
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
