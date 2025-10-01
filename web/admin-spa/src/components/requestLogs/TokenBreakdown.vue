<template>
  <div class="token-breakdown">
    <!-- Token使用总览卡片 -->
    <div class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div class="stat-card bg-blue-50 dark:bg-blue-900/20">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-blue-700 dark:text-blue-300">输入Token</p>
            <p class="text-2xl font-bold text-blue-900 dark:text-blue-100">
              {{ formatNumber(normalizedTokens.inputTokens || 0) }}
            </p>
          </div>
          <i class="fas fa-sign-in-alt text-2xl text-blue-500"></i>
        </div>
        <div class="mt-2 text-xs text-blue-600 dark:text-blue-400">
          费用: ${{ formatCost(costDetails?.inputCost || 0) }}
        </div>
      </div>

      <div class="stat-card bg-green-50 dark:bg-green-900/20">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-green-700 dark:text-green-300">输出Token</p>
            <p class="text-2xl font-bold text-green-900 dark:text-green-100">
              {{ formatNumber(normalizedTokens.outputTokens || 0) }}
            </p>
          </div>
          <i class="fas fa-sign-out-alt text-2xl text-green-500"></i>
        </div>
        <div class="mt-2 text-xs text-green-600 dark:text-green-400">
          费用: ${{ formatCost(costDetails?.outputCost || 0) }}
        </div>
      </div>

      <div class="stat-card bg-purple-50 dark:bg-purple-900/20">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-purple-700 dark:text-purple-300">缓存创建</p>
            <p class="text-2xl font-bold text-purple-900 dark:text-purple-100">
              {{ formatNumber(normalizedTokens.cacheCreateTokens || 0) }}
            </p>
          </div>
          <i class="fas fa-save text-2xl text-purple-500"></i>
        </div>
        <div class="mt-2 text-xs text-purple-600 dark:text-purple-400">
          费用: ${{ formatCost(costDetails?.cacheCreateCost || 0) }}
        </div>
      </div>

      <div class="stat-card bg-orange-50 dark:bg-orange-900/20">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-orange-700 dark:text-orange-300">缓存读取</p>
            <p class="text-2xl font-bold text-orange-900 dark:text-orange-100">
              {{ formatNumber(normalizedTokens.cacheReadTokens || 0) }}
            </p>
          </div>
          <i class="fas fa-download text-2xl text-orange-500"></i>
        </div>
        <div class="mt-2 text-xs text-orange-600 dark:text-orange-400">
          费用: ${{ formatCost(costDetails?.cacheReadCost || 0) }}
        </div>
      </div>
    </div>

    <!-- Token使用详细分析 -->
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <!-- Token分布饼图 -->
      <div class="rounded-lg bg-white p-6 shadow dark:bg-gray-800">
        <h4 class="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
          <i class="fas fa-chart-pie mr-2"></i>
          Token分布
        </h4>
        <div class="relative flex h-64 items-center justify-center">
          <canvas ref="tokenChart" class="max-h-full max-w-full"></canvas>
          <!-- 无数据时显示占位符 -->
          <div v-if="!hasTokenData" class="absolute inset-0 flex items-center justify-center">
            <div class="text-center text-gray-400 dark:text-gray-600">
              <i class="fas fa-chart-pie mb-2 text-4xl"></i>
              <p>暂无Token使用数据</p>
            </div>
          </div>
        </div>
      </div>

      <!-- 详细统计表格 -->
      <div class="rounded-lg bg-white p-6 shadow dark:bg-gray-800">
        <h4 class="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
          <i class="fas fa-table mr-2"></i>
          详细统计
        </h4>
        <div class="overflow-x-auto">
          <table class="min-w-full">
            <thead>
              <tr class="border-b border-gray-200 dark:border-gray-700">
                <th class="py-2 text-left text-sm font-medium text-gray-700 dark:text-gray-300">
                  类型
                </th>
                <th class="py-2 text-right text-sm font-medium text-gray-700 dark:text-gray-300">
                  Token数
                </th>
                <th class="py-2 text-right text-sm font-medium text-gray-700 dark:text-gray-300">
                  费用
                </th>
                <th class="py-2 text-right text-sm font-medium text-gray-700 dark:text-gray-300">
                  占比
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
              <tr>
                <td class="py-2 text-sm text-gray-900 dark:text-gray-100">输入Token</td>
                <td class="py-2 text-right text-sm text-gray-900 dark:text-gray-100">
                  {{ formatNumber(normalizedTokens.inputTokens || 0) }}
                </td>
                <td class="py-2 text-right text-sm text-gray-900 dark:text-gray-100">
                  ${{ formatCost(costDetails?.inputCost || 0) }}
                </td>
                <td class="py-2 text-right text-sm text-gray-900 dark:text-gray-100">
                  {{ getTokenPercentage('input') }}%
                </td>
              </tr>
              <tr>
                <td class="py-2 text-sm text-gray-900 dark:text-gray-100">输出Token</td>
                <td class="py-2 text-right text-sm text-gray-900 dark:text-gray-100">
                  {{ formatNumber(normalizedTokens.outputTokens || 0) }}
                </td>
                <td class="py-2 text-right text-sm text-gray-900 dark:text-gray-100">
                  ${{ formatCost(costDetails?.outputCost || 0) }}
                </td>
                <td class="py-2 text-right text-sm text-gray-900 dark:text-gray-100">
                  {{ getTokenPercentage('output') }}%
                </td>
              </tr>
              <tr>
                <td class="py-2 text-sm text-gray-900 dark:text-gray-100">缓存创建</td>
                <td class="py-2 text-right text-sm text-gray-900 dark:text-gray-100">
                  {{ formatNumber(normalizedTokens.cacheCreateTokens || 0) }}
                </td>
                <td class="py-2 text-right text-sm text-gray-900 dark:text-gray-100">
                  ${{ formatCost(costDetails?.cacheCreateCost || 0) }}
                </td>
                <td class="py-2 text-right text-sm text-gray-900 dark:text-gray-100">
                  {{ getTokenPercentage('cache_create') }}%
                </td>
              </tr>
              <tr>
                <td class="py-2 text-sm text-gray-900 dark:text-gray-100">缓存读取</td>
                <td class="py-2 text-right text-sm text-gray-900 dark:text-gray-100">
                  {{ formatNumber(normalizedTokens.cacheReadTokens || 0) }}
                </td>
                <td class="py-2 text-right text-sm text-gray-900 dark:text-gray-100">
                  ${{ formatCost(costDetails?.cacheReadCost || 0) }}
                </td>
                <td class="py-2 text-right text-sm text-gray-900 dark:text-gray-100">
                  {{ getTokenPercentage('cache_read') }}%
                </td>
              </tr>

              <!-- 详细缓存类型展示 -->
              <template v-if="tokenDetails?.cache_breakdown">
                <tr class="bg-gray-50 dark:bg-gray-700/50">
                  <td class="py-2 pl-4 text-sm text-gray-700 dark:text-gray-300">
                    <i class="fas fa-clock mr-1"></i>
                    5分钟缓存
                  </td>
                  <td class="py-2 text-right text-sm text-gray-700 dark:text-gray-300">
                    {{ formatNumber(tokenDetails.cache_breakdown.ephemeral_5m_input_tokens || 0) }}
                  </td>
                  <td class="py-2 text-right text-sm text-gray-700 dark:text-gray-300">-</td>
                  <td class="py-2 text-right text-sm text-gray-700 dark:text-gray-300">-</td>
                </tr>
                <tr class="bg-gray-50 dark:bg-gray-700/50">
                  <td class="py-2 pl-4 text-sm text-gray-700 dark:text-gray-300">
                    <i class="fas fa-hourglass-half mr-1"></i>
                    1小时缓存
                  </td>
                  <td class="py-2 text-right text-sm text-gray-700 dark:text-gray-300">
                    {{ formatNumber(tokenDetails.cache_breakdown.ephemeral_1h_input_tokens || 0) }}
                  </td>
                  <td class="py-2 text-right text-sm text-gray-700 dark:text-gray-300">-</td>
                  <td class="py-2 text-right text-sm text-gray-700 dark:text-gray-300">-</td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- 费用总计和效率分析 -->
    <div class="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
      <!-- 费用总计 -->
      <div class="rounded-lg bg-gradient-to-r from-blue-500 to-purple-600 p-6 text-white">
        <h4 class="mb-4 text-lg font-semibold">
          <i class="fas fa-dollar-sign mr-2"></i>
          费用总计
        </h4>
        <div class="mb-2 text-3xl font-bold">${{ formatCost(costDetails?.totalCost || 0) }}</div>
        <div class="text-sm opacity-90">
          平均每Token: ${{ formatCost(getAverageCostPerToken()) }}
        </div>
        <div class="text-sm opacity-90">货币: {{ costDetails?.currency || 'USD' }}</div>
      </div>

      <!-- 效率分析 -->
      <div class="rounded-lg bg-white p-6 shadow dark:bg-gray-800">
        <h4 class="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
          <i class="fas fa-chart-line mr-2"></i>
          效率分析
        </h4>
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-sm text-gray-700 dark:text-gray-300">总Token数</span>
            <span class="font-semibold text-gray-900 dark:text-gray-100">
              {{ formatNumber(getTotalTokens()) }}
            </span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-gray-700 dark:text-gray-300">缓存命中率</span>
            <span class="font-semibold text-gray-900 dark:text-gray-100">
              {{ getCacheHitRatio() }}%
            </span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-gray-700 dark:text-gray-300">Token效率</span>
            <span class="font-semibold" :class="getEfficiencyColor()">
              {{ getTokenEfficiency() }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import Chart from 'chart.js/auto'
import { normalizeTokenDetails } from '@/utils/tokenUtils'

// Props
const props = defineProps({
  tokenDetails: {
    type: Object,
    default: () => ({})
  },
  costDetails: {
    type: Object,
    default: () => ({})
  }
})

// Refs
const tokenChart = ref(null)
let chartInstance = null

// Computed
const normalizedTokens = computed(() => normalizeTokenDetails(props.tokenDetails))

const hasTokenData = computed(() => normalizedTokens.value.totalTokens > 0)

const getTotalTokens = () => normalizedTokens.value.totalTokens

// Methods
const formatNumber = (num) => {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M'
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K'
  }
  return num.toLocaleString()
}

const formatCost = (cost) => {
  if (typeof cost !== 'number' || isNaN(cost)) return '0.000000'
  return cost.toFixed(6)
}

const getTokenPercentage = (type) => {
  const total = getTotalTokens()
  if (total === 0) return '0.0'

  const tokens = normalizedTokens.value
  const valueMap = {
    input: tokens.inputTokens,
    output: tokens.outputTokens,
    cache_create: tokens.cacheCreateTokens,
    cache_read: tokens.cacheReadTokens
  }

  const value = valueMap[type] ?? 0
  return ((value / total) * 100).toFixed(1)
}

const getAverageCostPerToken = () => {
  const total = getTotalTokens()
  const totalCost = props.costDetails?.totalCost || 0
  if (total === 0) return 0
  return totalCost / total
}

const getCacheHitRatio = () => {
  const tokens = normalizedTokens.value
  const cacheTokens = tokens.cacheReadTokens || 0
  const totalInputTokens =
    (tokens.inputTokens || 0) + (tokens.cacheCreateTokens || 0) + cacheTokens
  if (totalInputTokens === 0) return '0.0'
  return ((cacheTokens / totalInputTokens) * 100).toFixed(1)
}

const getTokenEfficiency = () => {
  const tokens = normalizedTokens.value
  const inputTokens = tokens.inputTokens || 0
  const outputTokens = tokens.outputTokens || 0
  if (inputTokens === 0) return 'N/A'
  const ratio = outputTokens / inputTokens
  return ratio.toFixed(2)
}

const getEfficiencyColor = () => {
  const efficiency = parseFloat(getTokenEfficiency())
  if (isNaN(efficiency)) return 'text-gray-500'
  if (efficiency > 0.5) return 'text-green-600 dark:text-green-400'
  if (efficiency > 0.2) return 'text-yellow-600 dark:text-yellow-400'
  return 'text-red-600 dark:text-red-400'
}

const createTokenChart = () => {
  if (!tokenChart.value) {
    return
  }

  if (chartInstance) {
    chartInstance.destroy()
    chartInstance = null
  }

  if (!hasTokenData.value) {
    return
  }

  const tokens = normalizedTokens.value
  const data = {
    labels: ['输入Token', '输出Token', '缓存创建', '缓存读取'],
    datasets: [
      {
        data: [
          tokens.inputTokens || 0,
          tokens.outputTokens || 0,
          tokens.cacheCreateTokens || 0,
          tokens.cacheReadTokens || 0
        ],
        backgroundColor: [
          '#3B82F6', // blue
          '#10B981', // green
          '#8B5CF6', // purple
          '#F59E0B' // orange
        ],
        borderWidth: 0
      }
    ]
  }

  // 过滤掉值为0的数据
  const filteredData = {
    labels: [],
    datasets: [
      {
        data: [],
        backgroundColor: [],
        borderWidth: 0
      }
    ]
  }

  data.labels.forEach((label, index) => {
    if (data.datasets[0].data[index] > 0) {
      filteredData.labels.push(label)
      filteredData.datasets[0].data.push(data.datasets[0].data[index])
      filteredData.datasets[0].backgroundColor.push(data.datasets[0].backgroundColor[index])
    }
  })

  chartInstance = new Chart(tokenChart.value, {
    type: 'doughnut',
    data: filteredData,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            padding: 20,
            usePointStyle: true
          }
        }
      }
    }
  })
}

// Lifecycle
onMounted(() => {
  nextTick(() => {
    if (hasTokenData.value) {
      createTokenChart()
    }
  })
})

watch(
  () => normalizedTokens.value,
  () => {
    nextTick(() => {
      createTokenChart()
    })
  },
  { deep: true }
)
</script>

<style scoped>
.stat-card {
  @apply rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800;
}
</style>
