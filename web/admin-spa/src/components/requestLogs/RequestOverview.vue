<template>
  <div class="request-overview">
    <!-- 基本信息卡片 -->
    <div class="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
      <!-- 请求基本信息 -->
      <div class="rounded-lg bg-white p-6 shadow dark:bg-gray-800">
        <h4 class="mb-4 flex items-center text-lg font-semibold text-gray-900 dark:text-gray-100">
          <i class="fas fa-info-circle mr-2 text-blue-500"></i>
          基本信息
        </h4>

        <div class="space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-400">
                请求时间
              </label>
              <div class="text-sm text-gray-900 dark:text-gray-100">
                {{ formatTimestamp(log.timestamp) }}
              </div>
              <div class="text-xs text-gray-500 dark:text-gray-400">
                {{ getRelativeTime(log.timestamp) }}
              </div>
            </div>

            <div>
              <label class="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-400">
                请求ID
              </label>
              <div class="break-all font-mono text-sm text-gray-900 dark:text-gray-100">
                {{ getLogId(log) }}
              </div>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-400">
                API Key
              </label>
              <div class="flex items-center gap-2">
                <span class="text-sm text-gray-900 dark:text-gray-100">
                  {{ getApiKeyName(log) }}
                </span>
                <span
                  v-if="getApiKeyStatus(log)"
                  class="rounded-full px-2 py-1 text-xs"
                  :class="getApiKeyStatusColor(log)"
                >
                  {{ getApiKeyStatus(log) }}
                </span>
              </div>
            </div>

            <div>
              <label class="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-400">
                使用模型
              </label>
              <div class="text-sm text-gray-900 dark:text-gray-100">
                {{ log.model || 'N/A' }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 请求详情 -->
      <div class="rounded-lg bg-white p-6 shadow dark:bg-gray-800">
        <h4 class="mb-4 flex items-center text-lg font-semibold text-gray-900 dark:text-gray-100">
          <i class="fas fa-network-wired mr-2 text-green-500"></i>
          请求详情
        </h4>

        <div class="space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-400">
                请求方法
              </label>
              <span
                class="inline-block rounded px-2 py-1 text-xs font-medium"
                :class="getMethodColor(log.method)"
              >
                {{ log.method || 'N/A' }}
              </span>
            </div>

            <div>
              <label class="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-400">
                状态码
              </label>
              <div class="flex items-center gap-2">
                <span
                  class="inline-block rounded px-2 py-1 text-xs font-medium"
                  :class="getStatusColor(log.status)"
                >
                  {{ log.status || 'N/A' }}
                </span>
                <span class="text-xs text-gray-500 dark:text-gray-400">
                  {{ getStatusText(log.status) }}
                </span>
              </div>
            </div>
          </div>

          <div>
            <label class="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-400">
              请求路径
            </label>
            <div
              class="break-all rounded border bg-gray-50 p-2 font-mono text-sm text-gray-900 dark:bg-gray-700/50 dark:text-gray-100"
            >
              {{ log.path || '/' }}
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-400">
                响应时间
              </label>
              <div class="flex items-center gap-2">
                <span class="text-lg font-semibold" :class="getPerformanceColor(log.responseTime)">
                  {{ formatDuration(log.responseTime) }}
                </span>
                <span
                  class="rounded-full px-2 py-1 text-xs"
                  :class="getPerformanceBadgeColor(log.responseTime)"
                >
                  {{ getPerformanceLevel(log.responseTime) }}
                </span>
              </div>
            </div>

            <div>
              <label class="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-400">
                客户端IP
              </label>
              <div class="font-mono text-sm text-gray-900 dark:text-gray-100">
                {{ log.request?.ip || log.clientIP || 'N/A' }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Token和费用概览 -->
    <div class="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
      <!-- Token使用概览 -->
      <div class="rounded-lg bg-gradient-to-r from-blue-500 to-purple-600 p-6 text-white">
        <h4 class="mb-4 flex items-center text-lg font-semibold">
          <i class="fas fa-coins mr-2"></i>
          Token使用概览
        </h4>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <div class="text-2xl font-bold">{{ getTokenSummary().total }}</div>
            <div class="text-sm opacity-90">总Token数</div>
          </div>
          <div>
            <div class="text-2xl font-bold">{{ getTokenSummary().efficiency }}</div>
            <div class="text-sm opacity-90">使用效率</div>
          </div>
        </div>

        <div class="mt-4 grid grid-cols-4 gap-2 text-xs">
          <div class="text-center">
            <div class="font-semibold">{{ getTokenSummary().input }}</div>
            <div class="opacity-75">输入</div>
          </div>
          <div class="text-center">
            <div class="font-semibold">{{ getTokenSummary().output }}</div>
            <div class="opacity-75">输出</div>
          </div>
          <div class="text-center">
            <div class="font-semibold">{{ getTokenSummary().cacheCreate }}</div>
            <div class="opacity-75">缓存创建</div>
          </div>
          <div class="text-center">
            <div class="font-semibold">{{ getTokenSummary().cacheRead }}</div>
            <div class="opacity-75">缓存读取</div>
          </div>
        </div>
      </div>

      <!-- 费用信息 -->
      <div class="rounded-lg bg-white p-6 shadow dark:bg-gray-800">
        <h4 class="mb-4 flex items-center text-lg font-semibold text-gray-900 dark:text-gray-100">
          <i class="fas fa-dollar-sign mr-2 text-green-500"></i>
          费用信息
        </h4>

        <div class="space-y-4">
          <div class="text-center">
            <div class="text-3xl font-bold text-green-600 dark:text-green-400">
              ${{ getCostSummary().total }}
            </div>
            <div class="text-sm text-gray-600 dark:text-gray-400">总费用</div>
          </div>

          <div class="grid grid-cols-2 gap-4 border-t border-gray-200 pt-4 dark:border-gray-700">
            <div class="text-center">
              <div class="text-lg font-semibold text-gray-900 dark:text-gray-100">
                ${{ getCostSummary().perToken }}
              </div>
              <div class="text-xs text-gray-600 dark:text-gray-400">每Token费用</div>
            </div>
            <div class="text-center">
              <div class="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {{ getCostSummary().currency }}
              </div>
              <div class="text-xs text-gray-600 dark:text-gray-400">货币单位</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 数据完整性和元信息 -->
    <div class="rounded-lg bg-white p-6 shadow dark:bg-gray-800">
      <h4 class="mb-4 flex items-center text-lg font-semibold text-gray-900 dark:text-gray-100">
        <i class="fas fa-chart-pie mr-2 text-purple-500"></i>
        数据完整性分析
      </h4>

      <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <!-- 数据可用性 -->
        <div>
          <h5 class="mb-3 font-medium text-gray-900 dark:text-gray-100">数据可用性</h5>
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-sm text-gray-600 dark:text-gray-400">基本信息</span>
              <div class="flex items-center gap-2">
                <div class="h-2 w-16 rounded-full bg-gray-200 dark:bg-gray-700">
                  <div
                    class="h-2 rounded-full bg-green-500"
                    :style="`width: ${getDataCompleteness().basic}%`"
                  ></div>
                </div>
                <span class="text-xs font-medium">{{ getDataCompleteness().basic }}%</span>
              </div>
            </div>

            <div class="flex items-center justify-between">
              <span class="text-sm text-gray-600 dark:text-gray-400">Token详情</span>
              <div class="flex items-center gap-2">
                <div class="h-2 w-16 rounded-full bg-gray-200 dark:bg-gray-700">
                  <div
                    class="h-2 rounded-full bg-blue-500"
                    :style="`width: ${getDataCompleteness().tokens}%`"
                  ></div>
                </div>
                <span class="text-xs font-medium">{{ getDataCompleteness().tokens }}%</span>
              </div>
            </div>

            <div class="flex items-center justify-between">
              <span class="text-sm text-gray-600 dark:text-gray-400">费用信息</span>
              <div class="flex items-center gap-2">
                <div class="h-2 w-16 rounded-full bg-gray-200 dark:bg-gray-700">
                  <div
                    class="h-2 rounded-full bg-purple-500"
                    :style="`width: ${getDataCompleteness().costs}%`"
                  ></div>
                </div>
                <span class="text-xs font-medium">{{ getDataCompleteness().costs }}%</span>
              </div>
            </div>

            <div class="flex items-center justify-between">
              <span class="text-sm text-gray-600 dark:text-gray-400">Headers信息</span>
              <div class="flex items-center gap-2">
                <div class="h-2 w-16 rounded-full bg-gray-200 dark:bg-gray-700">
                  <div
                    class="h-2 rounded-full bg-orange-500"
                    :style="`width: ${getDataCompleteness().headers}%`"
                  ></div>
                </div>
                <span class="text-xs font-medium">{{ getDataCompleteness().headers }}%</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 元信息 -->
        <div>
          <h5 class="mb-3 font-medium text-gray-900 dark:text-gray-100">日志元信息</h5>
          <div class="space-y-2 text-sm">
            <div class="flex justify-between">
              <span class="text-gray-600 dark:text-gray-400">日志版本</span>
              <span class="text-gray-900 dark:text-gray-100">{{ log.logVersion || '1.0' }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-600 dark:text-gray-400">数据优化</span>
              <span
                :class="log.dataOptimized ? 'text-green-600 dark:text-green-400' : 'text-gray-500'"
              >
                {{ log.dataOptimized ? '已优化' : '未优化' }}
              </span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-600 dark:text-gray-400">存储TTL</span>
              <span class="text-gray-900 dark:text-gray-100">7 天</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-600 dark:text-gray-400">检索时间</span>
              <span class="text-gray-900 dark:text-gray-100">{{ getCurrentTime() }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 整体完整性评分 -->
      <div class="mt-6 border-t border-gray-200 pt-4 dark:border-gray-700">
        <div class="flex items-center justify-between">
          <span class="text-lg font-medium text-gray-900 dark:text-gray-100">整体完整性评分</span>
          <div class="flex items-center gap-3">
            <div class="h-3 w-32 rounded-full bg-gray-200 dark:bg-gray-700">
              <div
                class="h-3 rounded-full transition-all duration-500"
                :class="getOverallCompletenessColor()"
                :style="`width: ${getOverallCompleteness()}%`"
              ></div>
            </div>
            <span class="text-xl font-bold" :class="getOverallCompletenessTextColor()">
              {{ getOverallCompleteness() }}%
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { normalizeTokenDetails } from '@/utils/tokenUtils'

// Props
const props = defineProps({
  log: {
    type: Object,
    required: true
  }
})

// Methods
const formatTimestamp = (timestamp) => {
  if (!timestamp) return 'N/A'
  const date = new Date(timestamp)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

const getRelativeTime = (timestamp) => {
  if (!timestamp) return ''
  const now = Date.now()
  const time = new Date(timestamp).getTime()
  const diff = now - time

  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  return `${Math.floor(diff / 86400000)} 天前`
}

const getLogId = (log) => {
  return log.id || log.logId || 'N/A'
}

const getApiKeyName = (log) => {
  return (
    log.formattedKeyName || log.apiKey?.name || (log.keyId ? `Key-${log.keyId.slice(-8)}` : 'N/A')
  )
}

const getApiKeyStatus = (log) => {
  const name = getApiKeyName(log)
  if (name.includes('(已删除)')) return '已删除'
  return '正常'
}

const getApiKeyStatusColor = (log) => {
  const status = getApiKeyStatus(log)
  return status === '已删除'
    ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
    : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
}

const getMethodColor = (method) => {
  const colors = {
    GET: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    POST: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    PUT: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
    DELETE: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    PATCH: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
  }
  return colors[method] || 'bg-gray-100 text-gray-700 dark:bg-gray-700/50 dark:text-gray-300'
}

const getStatusColor = (status) => {
  if (status >= 200 && status < 300)
    return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
  if (status >= 300 && status < 400)
    return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
  if (status >= 400 && status < 500)
    return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
  if (status >= 500)
    return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
  return 'bg-gray-100 text-gray-700 dark:bg-gray-700/50 dark:text-gray-300'
}

const getStatusText = (status) => {
  if (status >= 200 && status < 300) return '成功'
  if (status >= 300 && status < 400) return '重定向'
  if (status >= 400 && status < 500) return '客户端错误'
  if (status >= 500) return '服务器错误'
  return ''
}

const formatDuration = (ms) => {
  if (!ms) return 'N/A'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

const getPerformanceColor = (responseTime) => {
  if (!responseTime) return 'text-gray-500'
  if (responseTime < 1000) return 'text-green-600 dark:text-green-400'
  if (responseTime < 3000) return 'text-yellow-600 dark:text-yellow-400'
  if (responseTime < 5000) return 'text-orange-600 dark:text-orange-400'
  return 'text-red-600 dark:text-red-400'
}

const getPerformanceLevel = (responseTime) => {
  if (!responseTime) return 'N/A'
  if (responseTime < 1000) return '快速'
  if (responseTime < 3000) return '正常'
  if (responseTime < 5000) return '较慢'
  return '很慢'
}

const getPerformanceBadgeColor = (responseTime) => {
  if (!responseTime) return 'bg-gray-100 text-gray-700 dark:bg-gray-700/50 dark:text-gray-300'
  if (responseTime < 1000)
    return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
  if (responseTime < 3000)
    return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
  if (responseTime < 5000)
    return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
  return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
}

const getTokenSummary = () => {
  const tokenDetails = normalizeTokenDetails(props.log.tokenDetails || {})
  const input = tokenDetails.inputTokens || 0
  const output = tokenDetails.outputTokens || 0
  const cacheCreate = tokenDetails.cacheCreateTokens || 0
  const cacheRead = tokenDetails.cacheReadTokens || 0
  const total = tokenDetails.totalTokens || input + output + cacheCreate + cacheRead

  const efficiency = input > 0 ? (output / input).toFixed(2) : '0.00'

  return {
    total: total.toLocaleString(),
    input: input.toLocaleString(),
    output: output.toLocaleString(),
    cacheCreate: cacheCreate.toLocaleString(),
    cacheRead: cacheRead.toLocaleString(),
    efficiency
  }
}

const getCostSummary = () => {
  const costDetails = props.log.costDetails || {}
  const total = (costDetails.totalCost || 0).toFixed(6)
  const tokenSummary = getTokenSummary()
  const totalTokens = parseInt(tokenSummary.total.replace(/,/g, '')) || 0
  const perToken = totalTokens > 0 ? (costDetails.totalCost / totalTokens).toFixed(8) : '0.00000000'

  return {
    total,
    perToken,
    currency: costDetails.currency || 'USD'
  }
}

const getDataCompleteness = () => {
  const log = props.log

  // 基本信息完整性（必需字段）
  const basicFields = ['timestamp', 'keyId', 'method', 'path', 'status']
  const basicScore = basicFields.reduce((score, field) => {
    return score + (log[field] ? 20 : 0)
  }, 0)

  // Token详情完整性
  const hasTokenDetails = !!(log.tokenDetails && Object.keys(log.tokenDetails).length > 0)
  const tokenScore = hasTokenDetails ? 100 : 0

  // 费用信息完整性
  const hasCostDetails = !!(log.costDetails && log.costDetails.totalCost)
  const costScore = hasCostDetails ? 100 : 0

  // Headers信息完整性
  const hasHeaders = !!(log.requestHeaders || log.responseHeaders)
  const headerScore = hasHeaders ? 100 : 0

  return {
    basic: Math.min(basicScore, 100),
    tokens: tokenScore,
    costs: costScore,
    headers: headerScore
  }
}

const getOverallCompleteness = () => {
  const completeness = getDataCompleteness()
  return Math.round(
    (completeness.basic + completeness.tokens + completeness.costs + completeness.headers) / 4
  )
}

const getOverallCompletenessColor = () => {
  const score = getOverallCompleteness()
  if (score >= 80) return 'bg-green-500'
  if (score >= 60) return 'bg-yellow-500'
  if (score >= 40) return 'bg-orange-500'
  return 'bg-red-500'
}

const getOverallCompletenessTextColor = () => {
  const score = getOverallCompleteness()
  if (score >= 80) return 'text-green-600 dark:text-green-400'
  if (score >= 60) return 'text-yellow-600 dark:text-yellow-400'
  if (score >= 40) return 'text-orange-600 dark:text-orange-400'
  return 'text-red-600 dark:text-red-400'
}

const getCurrentTime = () => {
  return new Date().toLocaleTimeString('zh-CN')
}
</script>

<style scoped>
/* 自定义样式可以根据需要添加 */
</style>
