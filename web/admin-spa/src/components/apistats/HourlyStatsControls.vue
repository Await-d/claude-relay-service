<template>
  <div
    class="rounded-xl bg-gradient-to-r from-blue-50 to-indigo-50 p-4 dark:from-gray-800 dark:to-gray-700 md:p-6"
  >
    <div class="mb-4 flex items-center gap-2 md:gap-3">
      <i class="fas fa-clock text-base text-blue-500 md:text-lg" />
      <h4 class="text-base font-semibold text-gray-900 dark:text-gray-100 md:text-lg">
        小时统计配置
      </h4>
    </div>

    <div class="space-y-4">
      <!-- 日期选择行 -->
      <div class="flex flex-col gap-3 md:flex-row md:items-center">
        <label class="text-sm font-medium text-gray-700 dark:text-gray-300 md:w-20">
          查询日期
        </label>
        <div class="flex flex-1 gap-2">
          <!-- 日期输入框 -->
          <div class="relative flex-1">
            <input
              v-model="selectedDate"
              class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm transition-all duration-200 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:focus:border-blue-400"
              type="date"
              @change="updateDate"
            />
          </div>
          <!-- 快捷日期按钮 -->
          <div class="flex gap-1">
            <button
              v-for="preset in datePresets"
              :key="preset.key"
              class="quick-date-btn"
              :class="{ active: isSelectedDate(preset.date) }"
              @click="selectPresetDate(preset.date)"
            >
              {{ preset.label }}
            </button>
          </div>
        </div>
      </div>

      <!-- 小时范围选择行 -->
      <div class="flex flex-col gap-3 md:flex-row md:items-center">
        <label class="text-sm font-medium text-gray-700 dark:text-gray-300 md:w-20">
          时间范围
        </label>
        <div class="flex flex-1 gap-2">
          <button
            v-for="hours in hourOptions"
            :key="hours"
            class="hours-btn flex-1 md:flex-none"
            :class="{ active: selectedHours === hours }"
            @click="updateHours(hours)"
          >
            {{ hours }}小时
          </button>
        </div>
      </div>

      <!-- 加载状态和操作按钮 -->
      <div class="flex flex-col items-start justify-between gap-3 pt-2 md:flex-row md:items-center">
        <div class="flex items-center gap-2">
          <div
            v-if="hourlyLoading"
            class="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400"
          >
            <i class="fas fa-spinner loading-spinner" />
            <span>加载数据中...</span>
          </div>
          <div
            v-else-if="hourlyError"
            class="flex items-center gap-2 text-sm text-red-600 dark:text-red-400"
          >
            <i class="fas fa-exclamation-triangle" />
            <span>{{ hourlyError }}</span>
          </div>
          <div
            v-else-if="hourlyStats.length > 0"
            class="flex items-center gap-2 text-sm text-green-600 dark:text-green-400"
          >
            <i class="fas fa-check-circle" />
            <span>已加载 {{ hourlyStats.length }} 条数据</span>
          </div>
        </div>

        <div class="flex gap-2">
          <button
            class="refresh-btn flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200"
            :disabled="hourlyLoading || !apiKey"
            @click="refreshData"
          >
            <i class="fas fa-sync-alt" :class="{ 'animate-spin': hourlyLoading }" />
            刷新数据
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useApiStatsStore } from '@/stores/apistats'

const apiStatsStore = useApiStatsStore()

const { apiKey, hourlyLoading, hourlyError, hourlyStats, hourlyConfig } = storeToRefs(apiStatsStore)

const { updateHourlyConfig, loadHourlyStats } = apiStatsStore

// 小时选项
const hourOptions = [6, 12, 24, 48]

// 日期预设选项
const datePresets = [
  {
    key: 'today',
    label: '今天',
    date: new Date().toISOString().split('T')[0]
  },
  {
    key: 'yesterday',
    label: '昨天',
    date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  },
  {
    key: 'twoDaysAgo',
    label: '前天',
    date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  }
]

// 当前选择的值
const selectedDate = computed({
  get: () => hourlyConfig.value.selectedDate,
  set: (value) => {
    updateHourlyConfig({ selectedDate: value })
  }
})

const selectedHours = computed({
  get: () => hourlyConfig.value.selectedHours,
  set: (value) => {
    updateHourlyConfig({ selectedHours: value })
  }
})

// 方法
const updateDate = () => {
  // 由于使用了 computed 的 setter，不需要额外操作
}

const updateHours = (hours) => {
  selectedHours.value = hours
}

const selectPresetDate = (date) => {
  selectedDate.value = date
}

const isSelectedDate = (date) => {
  return selectedDate.value === date
}

const refreshData = () => {
  loadHourlyStats()
}
</script>

<style scoped>
/* 快捷日期按钮 */
.quick-date-btn {
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid rgba(209, 213, 219, 0.8);
  background: rgba(255, 255, 255, 0.8);
  color: #374151;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.quick-date-btn:hover {
  background: rgba(59, 130, 246, 0.1);
  border-color: rgba(59, 130, 246, 0.3);
  color: #2563eb;
}

.quick-date-btn.active {
  background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
  border-color: #3b82f6;
  color: white;
  box-shadow: 0 2px 4px rgba(59, 130, 246, 0.3);
}

/* 暗黑模式 */
:global(.dark) .quick-date-btn {
  border-color: rgba(75, 85, 99, 0.8);
  background: rgba(55, 65, 81, 0.8);
  color: #e5e7eb;
}

:global(.dark) .quick-date-btn:hover {
  background: rgba(59, 130, 246, 0.2);
  border-color: rgba(59, 130, 246, 0.4);
  color: #3b82f6;
}

/* 小时选择按钮 */
.hours-btn {
  padding: 8px 16px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 500;
  border: 1px solid rgba(209, 213, 219, 0.8);
  background: rgba(255, 255, 255, 0.8);
  color: #374151;
  cursor: pointer;
  transition: all 0.3s ease;
  text-align: center;
  min-width: 80px;
}

.hours-btn:hover {
  background: rgba(59, 130, 246, 0.1);
  border-color: rgba(59, 130, 246, 0.3);
  color: #2563eb;
  transform: translateY(-1px);
}

.hours-btn.active {
  background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
  border-color: #3b82f6;
  color: white;
  box-shadow: 0 4px 8px rgba(59, 130, 246, 0.3);
  transform: translateY(-2px);
}

/* 暗黑模式 */
:global(.dark) .hours-btn {
  border-color: rgba(75, 85, 99, 0.8);
  background: rgba(55, 65, 81, 0.8);
  color: #e5e7eb;
}

:global(.dark) .hours-btn:hover {
  background: rgba(59, 130, 246, 0.2);
  border-color: rgba(59, 130, 246, 0.4);
  color: #3b82f6;
}

/* 刷新按钮 */
.refresh-btn {
  border: 1px solid rgba(59, 130, 246, 0.3);
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(29, 78, 216, 0.05) 100%);
  color: #2563eb;
}

.refresh-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
  color: white;
  box-shadow: 0 4px 8px rgba(59, 130, 246, 0.3);
}

.refresh-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* 暗黑模式 */
:global(.dark) .refresh-btn {
  border-color: rgba(59, 130, 246, 0.4);
  background: rgba(59, 130, 246, 0.1);
  color: #3b82f6;
}

:global(.dark) .refresh-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
  color: white;
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
@media (max-width: 768px) {
  .quick-date-btn {
    padding: 4px 8px;
    font-size: 11px;
  }

  .hours-btn {
    padding: 6px 12px;
    font-size: 13px;
    min-width: 70px;
  }
}
</style>
