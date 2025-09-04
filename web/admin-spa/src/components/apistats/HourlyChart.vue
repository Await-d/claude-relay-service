<template>
  <div class="card p-4 md:p-6">
    <div class="mb-4 md:mb-6">
      <h3
        class="flex flex-col text-lg font-bold text-gray-900 dark:text-gray-100 sm:flex-row sm:items-center md:text-xl"
      >
        <span class="flex items-center">
          <i class="fas fa-chart-line mr-2 text-sm text-blue-500 md:mr-3 md:text-base" />
          小时使用趋势图
        </span>
        <span class="text-xs font-normal text-gray-600 dark:text-gray-400 sm:ml-2 md:text-sm">
          ({{ hourlyConfig.selectedHours }}小时内)
        </span>
      </h3>
    </div>

    <!-- 图表加载状态 -->
    <div v-if="hourlyLoading" class="py-8 text-center md:py-12">
      <i
        class="fas fa-spinner loading-spinner mb-2 text-xl text-gray-600 dark:text-gray-400 md:text-2xl"
      />
      <p class="text-sm text-gray-600 dark:text-gray-400 md:text-base">加载图表数据中...</p>
    </div>

    <!-- 简化的图表展示 -->
    <div v-else-if="chartData.length > 0" class="space-y-4">
      <!-- 峰值使用时段提示 -->
      <div v-if="peakHour" class="rounded-lg bg-blue-50 p-3 dark:bg-blue-900/20">
        <div class="flex items-center gap-2 text-sm">
          <i class="fas fa-chart-line text-blue-500" />
          <span class="font-medium text-blue-800 dark:text-blue-200">
            峰值时段: {{ peakHour.time }} ({{ peakHour.requests }} 次请求, {{ peakHour.cost }})
          </span>
        </div>
      </div>

      <!-- 简化的柱状图 -->
      <div class="space-y-2">
        <div class="flex justify-between text-xs text-gray-600 dark:text-gray-400">
          <span>使用量分布</span>
          <span>{{ chartData.length }} 个时段</span>
        </div>

        <div class="grid gap-1" :class="gridCols">
          <div
            v-for="(item, index) in chartData"
            :key="index"
            class="chart-bar group relative"
            :style="{ height: `${getBarHeight(item)}px` }"
            @mouseenter="showTooltip(item, $event)"
            @mouseleave="hideTooltip"
          >
            <!-- 柱状条 -->
            <div
              class="h-full w-full rounded-t transition-all duration-200"
              :class="getBarColor(item)"
            />

            <!-- 时间标签 -->
            <div
              class="absolute -bottom-6 left-1/2 -translate-x-1/2 text-xs text-gray-500 dark:text-gray-400"
            >
              {{ formatTimeLabel(item.time) }}
            </div>
          </div>
        </div>
      </div>

      <!-- 统计摘要 -->
      <div class="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div class="stat-card">
          <div class="text-xs text-gray-600 dark:text-gray-400">总请求</div>
          <div class="text-lg font-bold text-blue-600">{{ summary.totalRequests }}</div>
        </div>
        <div class="stat-card">
          <div class="text-xs text-gray-600 dark:text-gray-400">总费用</div>
          <div class="text-lg font-bold text-green-600">{{ summary.totalCost }}</div>
        </div>
        <div class="stat-card">
          <div class="text-xs text-gray-600 dark:text-gray-400">平均/小时</div>
          <div class="text-lg font-bold text-purple-600">{{ summary.avgPerHour }}</div>
        </div>
        <div class="stat-card">
          <div class="text-xs text-gray-600 dark:text-gray-400">活跃时段</div>
          <div class="text-lg font-bold text-orange-600">{{ summary.activeHours }}</div>
        </div>
      </div>
    </div>

    <!-- 无数据状态 -->
    <div v-else class="py-8 text-center text-gray-500 dark:text-gray-400 md:py-12">
      <i class="fas fa-chart-line mb-3 text-3xl opacity-50" />
      <p class="text-sm md:text-base">暂无小时统计数据</p>
      <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">请选择日期和时间范围后查询</p>
    </div>

    <!-- 工具提示 -->
    <div
      v-if="tooltip.show"
      class="tooltip"
      :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }"
    >
      <div class="rounded-lg bg-black p-2 text-xs text-white shadow-lg">
        <div class="font-medium">{{ tooltip.data.time }}</div>
        <div>请求: {{ tooltip.data.requests }} 次</div>
        <div>费用: {{ tooltip.data.cost }}</div>
        <div v-if="tooltip.data.model">模型: {{ tooltip.data.model }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useApiStatsStore } from '@/stores/apistats'

const apiStatsStore = useApiStatsStore()
const { hourlyStats, hourlyLoading, hourlyConfig } = storeToRefs(apiStatsStore)

// 工具提示状态
const tooltip = ref({
  show: false,
  x: 0,
  y: 0,
  data: {}
})

// 处理图表数据
const chartData = computed(() => {
  if (!hourlyStats.value || hourlyStats.value.length === 0) {
    return []
  }

  // 按小时汇总数据
  const hourMap = new Map()

  hourlyStats.value.forEach((item) => {
    const timeKey = item.hour || item.time || '00:00'
    const existing = hourMap.get(timeKey) || {
      time: timeKey,
      requests: 0,
      cost: 0,
      models: new Set()
    }

    existing.requests += item.requests || 0
    existing.cost += item.costs?.total || 0
    if (item.model) {
      existing.models.add(item.model)
    }

    hourMap.set(timeKey, existing)
  })

  return Array.from(hourMap.values())
    .sort((a, b) => a.time.localeCompare(b.time))
    .map((item) => ({
      ...item,
      cost: formatCost(item.cost),
      models: Array.from(item.models)
    }))
})

// 网格列数 - 根据数据量动态调整
const gridCols = computed(() => {
  const count = chartData.value.length
  if (count <= 6) return 'grid-cols-6'
  if (count <= 12) return 'grid-cols-12'
  if (count <= 24) return 'grid-cols-12 md:grid-cols-24'
  return 'grid-cols-12 md:grid-cols-24'
})

// 峰值时段
const peakHour = computed(() => {
  if (chartData.value.length === 0) return null

  const peak = chartData.value.reduce((max, current) =>
    current.requests > max.requests ? current : max
  )

  return {
    time: peak.time,
    requests: peak.requests,
    cost: peak.cost
  }
})

// 统计摘要
const summary = computed(() => {
  if (chartData.value.length === 0) {
    return {
      totalRequests: 0,
      totalCost: '$0.00',
      avgPerHour: '0',
      activeHours: 0
    }
  }

  const totalRequests = chartData.value.reduce((sum, item) => sum + item.requests, 0)
  const totalCost = chartData.value.reduce(
    (sum, item) => sum + (parseFloat(item.cost.replace('$', '')) || 0),
    0
  )
  const activeHours = chartData.value.filter((item) => item.requests > 0).length

  return {
    totalRequests: totalRequests.toLocaleString(),
    totalCost: formatCost(totalCost),
    avgPerHour: Math.round(totalRequests / Math.max(activeHours, 1)).toLocaleString(),
    activeHours: activeHours
  }
})

// 计算柱状图高度
const getBarHeight = (item) => {
  if (chartData.value.length === 0) return 0

  const maxRequests = Math.max(...chartData.value.map((d) => d.requests))
  if (maxRequests === 0) return 2

  const minHeight = 2
  const maxHeight = 60
  const ratio = item.requests / maxRequests

  return Math.max(minHeight, ratio * maxHeight)
}

// 获取柱状图颜色
const getBarColor = (item) => {
  const requests = item.requests
  if (requests === 0) return 'bg-gray-200 dark:bg-gray-700'
  if (requests < 5) return 'bg-blue-300 dark:bg-blue-600'
  if (requests < 20) return 'bg-blue-500 dark:bg-blue-500'
  return 'bg-blue-600 dark:bg-blue-400'
}

// 格式化时间标签
const formatTimeLabel = (time) => {
  if (!time) return ''

  // 只显示小时，去掉分钟
  if (time.includes(':')) {
    return time.split(':')[0] + 'h'
  }

  return time
}

// 格式化费用
const formatCost = (cost) => {
  if (typeof cost !== 'number' || cost === 0) {
    return '$0.00'
  }

  if (cost >= 1) {
    return '$' + cost.toFixed(2)
  } else if (cost >= 0.01) {
    return '$' + cost.toFixed(4)
  } else {
    return '$' + cost.toFixed(6)
  }
}

// 显示工具提示
const showTooltip = (item, event) => {
  tooltip.value = {
    show: true,
    x: event.clientX + 10,
    y: event.clientY - 60,
    data: item
  }
}

// 隐藏工具提示
const hideTooltip = () => {
  tooltip.value.show = false
}
</script>

<style scoped>
/* 卡片样式 */
.card {
  background: var(--surface-color);
  border-radius: 16px;
  border: 1px solid var(--border-color);
  box-shadow:
    0 10px 15px -3px rgba(0, 0, 0, 0.1),
    0 4px 6px -2px rgba(0, 0, 0, 0.05);
  overflow: hidden;
  position: relative;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.card:hover {
  transform: translateY(-2px);
  box-shadow:
    0 20px 25px -5px rgba(0, 0, 0, 0.15),
    0 10px 10px -5px rgba(0, 0, 0, 0.08);
}

/* 图表柱状条 */
.chart-bar {
  min-height: 2px;
  display: flex;
  align-items: end;
  cursor: pointer;
}

.chart-bar:hover div {
  transform: scaleY(1.1);
}

/* 统计卡片 */
.stat-card {
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 8px;
  padding: 12px;
  text-align: center;
  transition: all 0.2s ease;
}

.stat-card:hover {
  background: rgba(255, 255, 255, 0.8);
  transform: translateY(-1px);
}

:global(.dark) .stat-card {
  background: rgba(55, 65, 81, 0.5);
  border-color: rgba(255, 255, 255, 0.1);
}

:global(.dark) .stat-card:hover {
  background: rgba(55, 65, 81, 0.8);
}

/* 工具提示 */
.tooltip {
  position: fixed;
  z-index: 1000;
  pointer-events: none;
}

/* 24列网格支持 */
@media (min-width: 768px) {
  .grid-cols-24 {
    grid-template-columns: repeat(24, minmax(0, 1fr));
  }
}

/* 加载动画 */
.loading-spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* 响应式优化 */
@media (max-width: 480px) {
  .chart-bar {
    min-width: 8px;
  }

  .stat-card {
    padding: 8px;
  }
}
</style>
