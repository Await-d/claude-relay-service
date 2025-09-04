<template>
  <div class="card p-4 md:p-6">
    <div class="mb-4 md:mb-6">
      <h3
        class="flex flex-col text-lg font-bold text-gray-900 dark:text-gray-100 sm:flex-row sm:items-center md:text-xl"
      >
        <span class="flex items-center">
          <i class="fas fa-robot mr-2 text-sm text-indigo-500 md:mr-3 md:text-base" />
          模型使用统计
        </span>
        <span class="text-xs font-normal text-gray-600 dark:text-gray-400 sm:ml-2 md:text-sm"
          >({{ periodDisplayName }})</span
        >
      </h3>
    </div>

    <!-- 模型统计加载状态 -->
    <div v-if="isLoading" class="py-6 text-center md:py-8">
      <i
        class="fas fa-spinner loading-spinner mb-2 text-xl text-gray-600 dark:text-gray-400 md:text-2xl"
      />
      <p class="text-sm text-gray-600 dark:text-gray-400 md:text-base">加载模型统计数据中...</p>
    </div>

    <!-- 模型统计数据 -->
    <div v-else-if="displayStats.length > 0" class="space-y-3 md:space-y-4">
      <div v-for="(model, index) in displayStats" :key="index" class="model-usage-item">
        <div class="mb-2 flex items-start justify-between md:mb-3">
          <div class="min-w-0 flex-1">
            <h4 class="break-all text-base font-bold text-gray-900 dark:text-gray-100 md:text-lg">
              {{ model.model }}
              <!-- 小时统计显示时间信息 -->
              <span
                v-if="statsPeriod === 'hourly' && model.hour"
                class="ml-2 text-sm font-normal text-blue-600 dark:text-blue-400"
              >
                {{ formatHourTime(model.hour) }}
              </span>
            </h4>
            <p class="text-xs text-gray-600 dark:text-gray-400 md:text-sm">
              {{ model.requests }} 次请求
              <span v-if="statsPeriod === 'hourly' && model.date" class="ml-2">
                · {{ formatDate(model.date) }}
              </span>
            </p>
          </div>
          <div class="ml-3 flex-shrink-0 text-right">
            <div class="text-base font-bold text-green-600 md:text-lg">
              {{ model.formatted?.total || '$0.000000' }}
            </div>
            <div class="text-xs text-gray-600 dark:text-gray-400 md:text-sm">总费用</div>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2 text-xs md:grid-cols-4 md:gap-3 md:text-sm">
          <div class="rounded bg-gray-50 p-2 dark:bg-gray-700">
            <div class="text-gray-600 dark:text-gray-400">输入 Token</div>
            <div class="font-medium text-gray-900 dark:text-gray-100">
              {{ formatNumber(model.inputTokens) }}
            </div>
          </div>
          <div class="rounded bg-gray-50 p-2 dark:bg-gray-700">
            <div class="text-gray-600 dark:text-gray-400">输出 Token</div>
            <div class="font-medium text-gray-900 dark:text-gray-100">
              {{ formatNumber(model.outputTokens) }}
            </div>
          </div>
          <div class="rounded bg-gray-50 p-2 dark:bg-gray-700">
            <div class="text-gray-600 dark:text-gray-400">缓存创建</div>
            <div class="font-medium text-gray-900 dark:text-gray-100">
              {{ formatNumber(model.cacheCreateTokens) }}
            </div>
          </div>
          <div class="rounded bg-gray-50 p-2 dark:bg-gray-700">
            <div class="text-gray-600 dark:text-gray-400">缓存读取</div>
            <div class="font-medium text-gray-900 dark:text-gray-100">
              {{ formatNumber(model.cacheReadTokens) }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 无模型数据 -->
    <div v-else class="py-6 text-center text-gray-500 dark:text-gray-400 md:py-8">
      <i class="fas fa-chart-pie mb-3 text-2xl md:text-3xl" />
      <p class="text-sm md:text-base">暂无{{ periodDisplayName }}模型使用数据</p>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useApiStatsStore } from '@/stores/apistats'

const apiStatsStore = useApiStatsStore()
const { statsPeriod, modelStats, modelStatsLoading, hourlyStats, hourlyLoading, hourlyConfig } =
  storeToRefs(apiStatsStore)

// 时间段显示名称
const periodDisplayName = computed(() => {
  switch (statsPeriod.value) {
    case 'daily':
      return '今日'
    case 'monthly':
      return '本月'
    case 'hourly':
      return `${hourlyConfig.value.selectedHours}小时内`
    default:
      return '当前时段'
  }
})

// 获取要显示的统计数据
const displayStats = computed(() => {
  if (statsPeriod.value === 'hourly') {
    return hourlyStats.value || []
  }
  return modelStats.value || []
})

// 加载状态
const isLoading = computed(() => {
  if (statsPeriod.value === 'hourly') {
    return hourlyLoading.value
  }
  return modelStatsLoading.value
})

// 格式化数字
const formatNumber = (num) => {
  if (typeof num !== 'number') {
    num = parseInt(num) || 0
  }

  if (num === 0) return '0'

  // 大数字使用简化格式
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M'
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K'
  } else {
    return num.toLocaleString()
  }
}

// 格式化小时时间
const formatHourTime = (hour) => {
  if (typeof hour === 'string' && hour.includes(':')) {
    return hour
  }
  // 如果是数字，转换为 HH:00 格式
  const hourNum = parseInt(hour)
  if (!isNaN(hourNum)) {
    return `${hourNum.toString().padStart(2, '0')}:00`
  }
  return hour
}

// 格式化日期
const formatDate = (dateStr) => {
  if (!dateStr) return ''

  try {
    const date = new Date(dateStr)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)

    if (date.toDateString() === today.toDateString()) {
      return '今天'
    } else if (date.toDateString() === yesterday.toDateString()) {
      return '昨天'
    } else {
      return date.toLocaleDateString('zh-CN', {
        month: 'short',
        day: 'numeric'
      })
    }
  } catch (e) {
    return dateStr
  }
}
</script>

<style scoped>
/* 卡片样式 - 使用CSS变量 */
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

.card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.5), transparent);
}

.card:hover {
  transform: translateY(-2px);
  box-shadow:
    0 20px 25px -5px rgba(0, 0, 0, 0.15),
    0 10px 10px -5px rgba(0, 0, 0, 0.08);
}

:global(.dark) .card:hover {
  box-shadow:
    0 20px 25px -5px rgba(0, 0, 0, 0.5),
    0 10px 10px -5px rgba(0, 0, 0, 0.35);
}

/* 模型使用项样式 - 使用CSS变量 */
.model-usage-item {
  background: var(--surface-color);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 12px;
  transition: all 0.3s ease;
  position: relative;
  overflow: hidden;
}

@media (min-width: 768px) {
  .model-usage-item {
    padding: 16px;
  }
}

.model-usage-item::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.5), transparent);
}

.model-usage-item:hover {
  transform: translateY(-2px);
  box-shadow:
    0 10px 15px -3px rgba(0, 0, 0, 0.1),
    0 4px 6px -2px rgba(0, 0, 0, 0.05);
  border-color: rgba(255, 255, 255, 0.3);
}

:global(.dark) .model-usage-item:hover {
  box-shadow:
    0 10px 15px -3px rgba(0, 0, 0, 0.4),
    0 4px 6px -2px rgba(0, 0, 0, 0.25);
  border-color: rgba(75, 85, 99, 0.6);
}

/* 加载动画 */
.loading-spinner {
  animation: spin 1s linear infinite;
  filter: drop-shadow(0 0 4px rgba(255, 255, 255, 0.5));
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
@media (max-width: 768px) {
  .model-usage-item .grid {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 480px) {
  .model-usage-item {
    padding: 10px;
  }

  .model-usage-item .grid {
    grid-template-columns: 1fr;
  }
}
</style>
