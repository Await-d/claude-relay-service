import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiStatsClient } from '@/config/apiStats'

export const useApiStatsStore = defineStore('apistats', () => {
  // 状态
  const apiKey = ref('')
  const apiId = ref(null)
  const loading = ref(false)
  const modelStatsLoading = ref(false)
  const oemLoading = ref(true)
  const error = ref('')
  const statsPeriod = ref('daily')
  const statsData = ref(null)
  const modelStats = ref([])
  const dailyStats = ref(null)
  const monthlyStats = ref(null)
  
  // 小时统计相关状态
  const hourlyStats = ref([])
  const hourlyLoading = ref(false)
  const hourlyError = ref('')
  const hourlyConfig = ref({
    selectedHours: 24,
    selectedDate: new Date().toISOString().split('T')[0]
  })
  
  const oemSettings = ref({
    siteName: '',
    siteIcon: '',
    siteIconData: ''
  })

  // 计算属性
  const currentPeriodData = computed(() => {
    const defaultData = {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreateTokens: 0,
      cacheReadTokens: 0,
      allTokens: 0,
      cost: 0,
      formattedCost: '$0.000000'
    }

    if (statsPeriod.value === 'daily') {
      return dailyStats.value || defaultData
    } else if (statsPeriod.value === 'monthly') {
      return monthlyStats.value || defaultData
    } else if (statsPeriod.value === 'hourly') {
      return hourlyStatsSummary.value || defaultData
    }
    return defaultData
  })

  // 小时统计汇总数据
  const hourlyStatsSummary = computed(() => {
    if (!hourlyStats.value || hourlyStats.value.length === 0) {
      return null
    }

    const summary = {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreateTokens: 0,
      cacheReadTokens: 0,
      allTokens: 0,
      cost: 0,
      formattedCost: '$0.000000'
    }

    hourlyStats.value.forEach((item) => {
      summary.requests += item.requests || 0
      summary.inputTokens += item.inputTokens || 0
      summary.outputTokens += item.outputTokens || 0
      summary.cacheCreateTokens += item.cacheCreateTokens || 0
      summary.cacheReadTokens += item.cacheReadTokens || 0
      summary.allTokens += item.allTokens || 0
      summary.cost += item.costs?.total || 0
    })

    summary.formattedCost = formatCost(summary.cost)
    return summary
  })

  const usagePercentages = computed(() => {
    if (!statsData.value || !currentPeriodData.value) {
      return {
        tokenUsage: 0,
        costUsage: 0,
        requestUsage: 0
      }
    }

    const current = currentPeriodData.value
    const limits = statsData.value.limits

    return {
      tokenUsage:
        limits.tokenLimit > 0 ? Math.min((current.allTokens / limits.tokenLimit) * 100, 100) : 0,
      costUsage:
        limits.dailyCostLimit > 0 ? Math.min((current.cost / limits.dailyCostLimit) * 100, 100) : 0,
      requestUsage:
        limits.rateLimitRequests > 0
          ? Math.min((current.requests / limits.rateLimitRequests) * 100, 100)
          : 0
    }
  })

  // Actions

  // 查询统计数据
  async function queryStats() {
    if (!apiKey.value.trim()) {
      error.value = '请输入 API Key'
      return
    }

    loading.value = true
    error.value = ''
    statsData.value = null
    modelStats.value = []
    apiId.value = null

    try {
      // 获取 API Key ID
      const idResult = await apiStatsClient.getKeyId(apiKey.value)

      if (idResult.success) {
        apiId.value = idResult.data.id

        // 使用 apiId 查询统计数据
        const statsResult = await apiStatsClient.getUserStats(apiId.value)

        if (statsResult.success) {
          statsData.value = statsResult.data

          // 同时加载今日和本月的统计数据
          await loadAllPeriodStats()

          // 清除错误信息
          error.value = ''

          // 更新 URL
          updateURL()
        } else {
          throw new Error(statsResult.message || '查询失败')
        }
      } else {
        throw new Error(idResult.message || '获取 API Key ID 失败')
      }
    } catch (err) {
      console.error('Query stats error:', err)
      error.value = err.message || '查询统计数据失败，请检查您的 API Key 是否正确'
      statsData.value = null
      modelStats.value = []
      apiId.value = null
    } finally {
      loading.value = false
    }
  }

  // 加载所有时间段的统计数据
  async function loadAllPeriodStats() {
    if (!apiId.value) return

    // 并行加载今日和本月的数据
    await Promise.all([loadPeriodStats('daily'), loadPeriodStats('monthly')])

    // 加载当前选择时间段的模型统计
    await loadModelStats(statsPeriod.value)
  }

  // 加载指定时间段的统计数据
  async function loadPeriodStats(period) {
    try {
      const result = await apiStatsClient.getUserModelStats(apiId.value, period)

      if (result.success) {
        // 计算汇总数据
        const modelData = result.data || []
        const summary = {
          requests: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheCreateTokens: 0,
          cacheReadTokens: 0,
          allTokens: 0,
          cost: 0,
          formattedCost: '$0.000000'
        }

        modelData.forEach((model) => {
          summary.requests += model.requests || 0
          summary.inputTokens += model.inputTokens || 0
          summary.outputTokens += model.outputTokens || 0
          summary.cacheCreateTokens += model.cacheCreateTokens || 0
          summary.cacheReadTokens += model.cacheReadTokens || 0
          summary.allTokens += model.allTokens || 0
          summary.cost += model.costs?.total || 0
        })

        summary.formattedCost = formatCost(summary.cost)

        // 存储到对应的时间段数据
        if (period === 'daily') {
          dailyStats.value = summary
        } else {
          monthlyStats.value = summary
        }
      } else {
        console.warn(`Failed to load ${period} stats:`, result.message)
      }
    } catch (err) {
      console.error(`Load ${period} stats error:`, err)
    }
  }

  // 加载模型统计数据
  async function loadModelStats(period = 'daily') {
    if (!apiId.value) return

    modelStatsLoading.value = true

    try {
      const result = await apiStatsClient.getUserModelStats(apiId.value, period)

      if (result.success) {
        modelStats.value = result.data || []
      } else {
        throw new Error(result.message || '加载模型统计失败')
      }
    } catch (err) {
      console.error('Load model stats error:', err)
      modelStats.value = []
    } finally {
      modelStatsLoading.value = false
    }
  }

  // 切换时间范围
  async function switchPeriod(period) {
    if (statsPeriod.value === period || modelStatsLoading.value) {
      return
    }

    statsPeriod.value = period

    // 如果对应时间段的数据还没有加载，则加载它
    if (
      (period === 'daily' && !dailyStats.value) ||
      (period === 'monthly' && !monthlyStats.value)
    ) {
      await loadPeriodStats(period)
    } else if (period === 'hourly') {
      // 小时统计需要重新加载，因为参数可能变化
      await loadHourlyStats()
    }

    // 加载对应的模型统计
    await loadModelStats(period)
  }

  // 加载小时统计数据
  async function loadHourlyStats() {
    if (!apiKey.value) {
      hourlyError.value = '请先输入 API Key'
      return
    }

    hourlyLoading.value = true
    hourlyError.value = ''

    try {
      const result = await apiStatsClient.getUserHourlyStats(
        apiKey.value,
        hourlyConfig.value.selectedDate,
        hourlyConfig.value.selectedHours
      )

      if (result.success) {
        hourlyStats.value = result.data || []
        hourlyError.value = ''
      } else {
        throw new Error(result.message || '加载小时统计失败')
      }
    } catch (err) {
      console.error('Load hourly stats error:', err)
      hourlyError.value = err.message || '加载小时统计失败'
      hourlyStats.value = []
    } finally {
      hourlyLoading.value = false
    }
  }

  // 更新小时配置并重新加载数据
  async function updateHourlyConfig(config) {
    hourlyConfig.value = { ...hourlyConfig.value, ...config }
    if (statsPeriod.value === 'hourly') {
      await loadHourlyStats()
    }
  }

  // 使用 apiId 直接加载数据
  async function loadStatsWithApiId() {
    if (!apiId.value) return

    loading.value = true
    error.value = ''
    statsData.value = null
    modelStats.value = []

    try {
      const result = await apiStatsClient.getUserStats(apiId.value)

      if (result.success) {
        statsData.value = result.data

        // 同时加载今日和本月的统计数据
        await loadAllPeriodStats()

        // 清除错误信息
        error.value = ''
      } else {
        throw new Error(result.message || '查询失败')
      }
    } catch (err) {
      console.error('Load stats with apiId error:', err)
      error.value = err.message || '查询统计数据失败'
      statsData.value = null
      modelStats.value = []
    } finally {
      loading.value = false
    }
  }

  // 加载 OEM 设置
  async function loadOemSettings() {
    oemLoading.value = true
    try {
      const result = await apiStatsClient.getOemSettings()
      if (result && result.success && result.data) {
        oemSettings.value = { ...oemSettings.value, ...result.data }
      }
    } catch (err) {
      console.error('Error loading OEM settings:', err)
      // 失败时使用默认值
      oemSettings.value = {
        siteName: 'Claude Relay Service',
        siteIcon: '',
        siteIconData: ''
      }
    } finally {
      oemLoading.value = false
    }
  }

  // 工具函数

  // 格式化费用
  function formatCost(cost) {
    if (typeof cost !== 'number' || cost === 0) {
      return '$0.000000'
    }

    // 根据数值大小选择精度
    if (cost >= 1) {
      return '$' + cost.toFixed(2)
    } else if (cost >= 0.01) {
      return '$' + cost.toFixed(4)
    } else {
      return '$' + cost.toFixed(6)
    }
  }

  // 更新 URL
  function updateURL() {
    if (apiId.value) {
      const url = new URL(window.location)
      url.searchParams.set('apiId', apiId.value)
      window.history.pushState({}, '', url)
    }
  }

  // 清除数据
  function clearData() {
    statsData.value = null
    modelStats.value = []
    dailyStats.value = null
    monthlyStats.value = null
    hourlyStats.value = []
    hourlyError.value = ''
    error.value = ''
    statsPeriod.value = 'daily'
    apiId.value = null
  }

  // 重置
  function reset() {
    apiKey.value = ''
    clearData()
  }

  return {
    // State
    apiKey,
    apiId,
    loading,
    modelStatsLoading,
    oemLoading,
    error,
    statsPeriod,
    statsData,
    modelStats,
    dailyStats,
    monthlyStats,
    hourlyStats,
    hourlyLoading,
    hourlyError,
    hourlyConfig,
    oemSettings,

    // Computed
    currentPeriodData,
    hourlyStatsSummary,
    usagePercentages,

    // Actions
    queryStats,
    loadAllPeriodStats,
    loadPeriodStats,
    loadModelStats,
    switchPeriod,
    loadHourlyStats,
    updateHourlyConfig,
    loadStatsWithApiId,
    loadOemSettings,
    clearData,
    reset
  }
})
