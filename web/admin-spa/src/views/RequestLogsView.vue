<template>
  <div class="request-logs-container">
    <!-- 页面标题和工具栏 -->
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-bold text-gray-900 dark:text-gray-100">请求日志</h2>
        <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">查看和管理 API 请求日志记录</p>
      </div>
      <div class="flex items-center space-x-3">
        <!-- 刷新按钮 -->
        <button class="btn btn-secondary" :disabled="loading" @click="refreshData">
          <i class="fas fa-sync-alt mr-2" :class="{ 'animate-spin': loading }"></i>
          刷新
        </button>
        <!-- 导出按钮 -->
        <div class="relative">
          <button
            class="btn btn-primary"
            :disabled="exporting || logs.length === 0"
            @click="showExportMenu = !showExportMenu"
          >
            <i class="fas fa-download mr-2"></i>
            {{ exporting ? '导出中...' : '导出' }}
          </button>
          <!-- 导出菜单 -->
          <div
            v-if="showExportMenu"
            class="absolute right-0 top-full z-50 mt-2 w-48 rounded-lg bg-white shadow-lg ring-1 ring-black ring-opacity-5 dark:bg-gray-800"
          >
            <div class="py-1">
              <button
                class="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                @click="exportData('json')"
              >
                <i class="fas fa-file-code mr-2"></i>
                导出为 JSON
              </button>
              <button
                class="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                @click="exportData('csv')"
              >
                <i class="fas fa-file-csv mr-2"></i>
                导出为 CSV
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 统计卡片 -->
    <div class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div class="stat-card">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-gray-600 dark:text-gray-400">总请求数</p>
            <p class="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {{ stats.totalRequests || 0 }}
            </p>
          </div>
          <i class="fas fa-chart-line text-2xl text-blue-500"></i>
        </div>
      </div>
      <div class="stat-card">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-gray-600 dark:text-gray-400">错误率</p>
            <p class="text-2xl font-bold text-red-600 dark:text-red-400">
              {{ formatPercentage(stats.errorRate || 0) }}
            </p>
          </div>
          <i class="fas fa-exclamation-triangle text-2xl text-red-500"></i>
        </div>
      </div>
      <div class="stat-card">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-gray-600 dark:text-gray-400">平均响应时间</p>
            <p class="text-2xl font-bold text-green-600 dark:text-green-400">
              {{ formatDuration(stats.averageResponseTime || 0) }}
            </p>
          </div>
          <i class="fas fa-clock text-2xl text-green-500"></i>
        </div>
      </div>
      <div class="stat-card">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-gray-600 dark:text-gray-400">活跃 API Keys</p>
            <p class="text-2xl font-bold text-purple-600 dark:text-purple-400">
              {{ stats.topApiKeys?.length || 0 }}
            </p>
          </div>
          <i class="fas fa-key text-2xl text-purple-500"></i>
        </div>
      </div>
    </div>

    <!-- 筛选面板 -->
    <div class="card mb-6 p-4">
      <div class="mb-4 flex items-center justify-between">
        <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">筛选条件</h3>
        <button
          v-if="hasFilters"
          class="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
          @click="clearFilters"
        >
          <i class="fas fa-times mr-1"></i>
          清除筛选
        </button>
      </div>

      <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <!-- 搜索框 -->
        <div>
          <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
            搜索
          </label>
          <input
            v-model="filters.search"
            class="form-input w-full"
            placeholder="API Key、IP、路径..."
            @input="debouncedSearch"
          />
        </div>

        <!-- API Key 选择 -->
        <div>
          <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
            API Key
          </label>
          <select v-model="filters.apiKeyId" class="form-select w-full" @change="applyFilters">
            <option value="">全部</option>
            <option v-for="apiKey in stats.topApiKeys" :key="apiKey.id" :value="apiKey.id">
              {{ apiKey.name }}
            </option>
          </select>
        </div>

        <!-- 状态码筛选 -->
        <div>
          <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
            状态码
          </label>
          <select v-model="filters.statusCode" class="form-select w-full" @change="applyFilters">
            <option value="">全部</option>
            <option value="200">200 (成功)</option>
            <option value="400">400 (请求错误)</option>
            <option value="401">401 (未授权)</option>
            <option value="403">403 (禁止访问)</option>
            <option value="429">429 (限流)</option>
            <option value="500">500 (服务器错误)</option>
          </select>
        </div>

        <!-- 时间范围 -->
        <div>
          <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
            时间范围
          </label>
          <select v-model="timeRange" class="form-select w-full" @change="applyTimeRange">
            <option value="1h">最近 1 小时</option>
            <option value="24h">最近 24 小时</option>
            <option value="7d">最近 7 天</option>
            <option value="30d">最近 30 天</option>
            <option value="custom">自定义</option>
          </select>
        </div>
      </div>

      <!-- 自定义时间范围 -->
      <div v-if="timeRange === 'custom'" class="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
            开始时间
          </label>
          <input
            v-model="filters.startDate"
            class="form-input w-full"
            type="datetime-local"
            @change="applyFilters"
          />
        </div>
        <div>
          <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
            结束时间
          </label>
          <input
            v-model="filters.endDate"
            class="form-input w-full"
            type="datetime-local"
            @change="applyFilters"
          />
        </div>
      </div>
    </div>

    <!-- 日志表格 -->
    <div class="card">
      <!-- 表格工具栏 -->
      <div
        class="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700"
      >
        <div class="flex items-center space-x-4">
          <span class="text-sm text-gray-600 dark:text-gray-400">
            显示 {{ logs.length }} 条记录，共 {{ pagination.total }} 条
          </span>
        </div>
        <div class="flex items-center space-x-2">
          <select v-model="filters.limit" class="form-select text-sm" @change="applyFilters">
            <option value="25">25 条/页</option>
            <option value="50">50 条/页</option>
            <option value="100">100 条/页</option>
          </select>
        </div>
      </div>

      <!-- 表格内容 -->
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead class="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th class="table-header cursor-pointer" @click="sort('timestamp')">
                <div class="flex items-center space-x-1">
                  <span>时间</span>
                  <i class="fas fa-sort text-gray-400" :class="getSortIcon('timestamp')"></i>
                </div>
              </th>
              <th class="table-header">API Key</th>
              <th class="table-header cursor-pointer" @click="sort('request.method')">
                <div class="flex items-center space-x-1">
                  <span>方法</span>
                  <i class="fas fa-sort text-gray-400" :class="getSortIcon('request.method')"></i>
                </div>
              </th>
              <th class="table-header">路径</th>
              <th class="table-header cursor-pointer" @click="sort('response.statusCode')">
                <div class="flex items-center space-x-1">
                  <span>状态码</span>
                  <i
                    class="fas fa-sort text-gray-400"
                    :class="getSortIcon('response.statusCode')"
                  ></i>
                </div>
              </th>
              <th class="table-header cursor-pointer" @click="sort('response.duration')">
                <div class="flex items-center space-x-1">
                  <span>响应时间</span>
                  <i
                    class="fas fa-sort text-gray-400"
                    :class="getSortIcon('response.duration')"
                  ></i>
                </div>
              </th>
              <th class="table-header">IP 地址</th>
              <th class="table-header">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900">
            <!-- 加载状态 -->
            <tr v-if="loading">
              <td class="py-8 text-center" colspan="8">
                <div class="flex items-center justify-center space-x-2">
                  <div class="loading-spinner"></div>
                  <span class="text-gray-500 dark:text-gray-400">加载中...</span>
                </div>
              </td>
            </tr>

            <!-- 无数据状态 -->
            <tr v-else-if="logs.length === 0">
              <td class="py-12 text-center" colspan="8">
                <div class="flex flex-col items-center space-y-2">
                  <i class="fas fa-inbox text-4xl text-gray-300 dark:text-gray-600"></i>
                  <p class="text-gray-500 dark:text-gray-400">暂无日志记录</p>
                  <p class="text-sm text-gray-400 dark:text-gray-500">
                    请检查筛选条件或确认日志功能已启用
                  </p>
                </div>
              </td>
            </tr>

            <!-- 日志记录 -->
            <tr
              v-for="log in filteredLogs"
              :key="log.id"
              class="hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              <td class="table-cell">
                <div class="text-sm text-gray-900 dark:text-gray-100">
                  {{ formatLogEntry(log).timestamp }}
                </div>
              </td>
              <td class="table-cell">
                <div class="flex items-center space-x-2">
                  <div
                    class="h-2 w-2 rounded-full"
                    :class="log.apiKey?.active ? 'bg-green-500' : 'bg-gray-400'"
                  ></div>
                  <span class="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {{ log.apiKey?.name || 'Unknown' }}
                  </span>
                </div>
              </td>
              <td class="table-cell">
                <span
                  class="inline-flex rounded-full px-2 py-1 text-xs font-semibold"
                  :class="getMethodClass(log.request?.method)"
                >
                  {{ log.request?.method || 'N/A' }}
                </span>
              </td>
              <td class="table-cell">
                <span
                  class="max-w-32 truncate text-sm text-gray-900 dark:text-gray-100"
                  :title="log.request?.path"
                >
                  {{ log.request?.path || '/' }}
                </span>
              </td>
              <td class="table-cell">
                <span
                  class="inline-flex rounded-full px-2 py-1 text-xs font-semibold"
                  :class="getStatusClass(log.response?.statusCode)"
                >
                  {{ log.response?.statusCode || 'N/A' }}
                </span>
              </td>
              <td class="table-cell">
                <span class="text-sm text-gray-900 dark:text-gray-100">
                  {{ formatLogEntry(log).duration }}
                </span>
              </td>
              <td class="table-cell">
                <span class="text-sm text-gray-600 dark:text-gray-400">
                  {{ log.request?.ip || 'N/A' }}
                </span>
              </td>
              <td class="table-cell">
                <button
                  class="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                  @click="showLogDetails(log)"
                >
                  <i class="fas fa-eye"></i>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 分页 -->
      <div
        v-if="pagination.totalPages > 1"
        class="flex items-center justify-between border-t border-gray-200 px-4 py-3 dark:border-gray-700"
      >
        <div class="flex items-center space-x-2">
          <button
            class="btn btn-secondary btn-sm"
            :disabled="pagination.page <= 1"
            @click="changePage(pagination.page - 1)"
          >
            <i class="fas fa-chevron-left"></i>
          </button>
          <span class="text-sm text-gray-600 dark:text-gray-400">
            第 {{ pagination.page }} 页，共 {{ pagination.totalPages }} 页
          </span>
          <button
            class="btn btn-secondary btn-sm"
            :disabled="pagination.page >= pagination.totalPages"
            @click="changePage(pagination.page + 1)"
          >
            <i class="fas fa-chevron-right"></i>
          </button>
        </div>
      </div>
    </div>

    <!-- 日志详情模态框 -->
    <div
      v-if="selectedLog"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
      @click.self="selectedLog = null"
    >
      <div
        class="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-lg bg-white shadow-xl dark:bg-gray-800"
      >
        <!-- 模态框头部 -->
        <div
          class="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-700"
        >
          <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">日志详情</h3>
          <button
            class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            @click="selectedLog = null"
          >
            <i class="fas fa-times text-xl"></i>
          </button>
        </div>

        <!-- 模态框内容 -->
        <div class="max-h-[calc(90vh-120px)] overflow-y-auto p-6">
          <div class="space-y-6">
            <!-- 基本信息 -->
            <div>
              <h4 class="text-md mb-3 font-semibold text-gray-900 dark:text-gray-100">基本信息</h4>
              <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                    >时间</label
                  >
                  <p class="mt-1 text-sm text-gray-900 dark:text-gray-100">
                    {{ formatLogEntry(selectedLog).timestamp }}
                  </p>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                    >API Key</label
                  >
                  <p class="mt-1 text-sm text-gray-900 dark:text-gray-100">
                    {{ selectedLog.apiKey?.name || 'Unknown' }}
                  </p>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                    >请求方法</label
                  >
                  <p class="mt-1 text-sm text-gray-900 dark:text-gray-100">
                    {{ selectedLog.request?.method || 'N/A' }}
                  </p>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                    >状态码</label
                  >
                  <p class="mt-1 text-sm text-gray-900 dark:text-gray-100">
                    {{ selectedLog.response?.statusCode || 'N/A' }}
                  </p>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                    >响应时间</label
                  >
                  <p class="mt-1 text-sm text-gray-900 dark:text-gray-100">
                    {{ formatLogEntry(selectedLog).duration }}
                  </p>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                    >IP 地址</label
                  >
                  <p class="mt-1 text-sm text-gray-900 dark:text-gray-100">
                    {{ selectedLog.request?.ip || 'N/A' }}
                  </p>
                </div>
              </div>
            </div>

            <!-- 请求信息 -->
            <div>
              <h4 class="text-md mb-3 font-semibold text-gray-900 dark:text-gray-100">请求信息</h4>
              <div class="space-y-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                    >请求路径</label
                  >
                  <p
                    class="mt-1 rounded bg-gray-100 p-2 text-sm text-gray-900 dark:bg-gray-700 dark:text-gray-100"
                  >
                    {{ selectedLog.request?.path || '/' }}
                  </p>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                    >User Agent</label
                  >
                  <p
                    class="mt-1 rounded bg-gray-100 p-2 text-sm text-gray-900 dark:bg-gray-700 dark:text-gray-100"
                  >
                    {{ selectedLog.request?.userAgent || 'N/A' }}
                  </p>
                </div>
                <div v-if="selectedLog.request?.headers">
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                    >请求头</label
                  >
                  <pre
                    class="mt-1 max-h-40 overflow-y-auto rounded bg-gray-100 p-2 text-xs text-gray-900 dark:bg-gray-700 dark:text-gray-100"
                    >{{ JSON.stringify(selectedLog.request.headers, null, 2) }}</pre
                  >
                </div>
                <div v-if="selectedLog.request?.body">
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                    >请求体</label
                  >
                  <pre
                    class="mt-1 max-h-40 overflow-y-auto rounded bg-gray-100 p-2 text-xs text-gray-900 dark:bg-gray-700 dark:text-gray-100"
                    >{{ JSON.stringify(selectedLog.request.body, null, 2) }}</pre
                  >
                </div>
              </div>
            </div>

            <!-- 响应信息 -->
            <div v-if="selectedLog.response">
              <h4 class="text-md mb-3 font-semibold text-gray-900 dark:text-gray-100">响应信息</h4>
              <div class="space-y-4">
                <div v-if="selectedLog.response.headers">
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                    >响应头</label
                  >
                  <pre
                    class="mt-1 max-h-40 overflow-y-auto rounded bg-gray-100 p-2 text-xs text-gray-900 dark:bg-gray-700 dark:text-gray-100"
                    >{{ JSON.stringify(selectedLog.response.headers, null, 2) }}</pre
                  >
                </div>
                <div v-if="selectedLog.response.body">
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                    >响应体</label
                  >
                  <pre
                    class="mt-1 max-h-40 overflow-y-auto rounded bg-gray-100 p-2 text-xs text-gray-900 dark:bg-gray-700 dark:text-gray-100"
                    >{{ JSON.stringify(selectedLog.response.body, null, 2) }}</pre
                  >
                </div>
              </div>
            </div>

            <!-- 使用统计 -->
            <div v-if="selectedLog.usage">
              <h4 class="text-md mb-3 font-semibold text-gray-900 dark:text-gray-100">使用统计</h4>
              <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                    >输入 Tokens</label
                  >
                  <p class="mt-1 text-sm text-gray-900 dark:text-gray-100">
                    {{ selectedLog.usage.inputTokens || 0 }}
                  </p>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                    >输出 Tokens</label
                  >
                  <p class="mt-1 text-sm text-gray-900 dark:text-gray-100">
                    {{ selectedLog.usage.outputTokens || 0 }}
                  </p>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                    >总 Tokens</label
                  >
                  <p class="mt-1 text-sm text-gray-900 dark:text-gray-100">
                    {{ selectedLog.usage.totalTokens || 0 }}
                  </p>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                    >模型</label
                  >
                  <p class="mt-1 text-sm text-gray-900 dark:text-gray-100">
                    {{ selectedLog.usage.model || 'N/A' }}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRequestLogsStore } from '@/stores/requestLogs'
import { debounce } from 'lodash'

// Store
const requestLogsStore = useRequestLogsStore()

// State
const showExportMenu = ref(false)
const selectedLog = ref(null)
const timeRange = ref('24h')

// Computed
const { logs, loading, exporting, stats, filters, pagination, filteredLogs, hasFilters } =
  requestLogsStore

// Methods
const {
  fetchLogs,
  fetchStats,
  exportLogs,
  updateFilters,
  clearFilters,
  refreshLogs,
  formatLogEntry,
  getStatusClass,
  getMethodClass,
  formatDuration
} = requestLogsStore

// 防抖搜索
const debouncedSearch = debounce(() => {
  applyFilters()
}, 500)

// 格式化百分比
const formatPercentage = (value) => {
  return `${(value * 100).toFixed(1)}%`
}

// 应用筛选
const applyFilters = async () => {
  await fetchLogs()
}

// 应用时间范围
const applyTimeRange = () => {
  const now = new Date()
  let startDate = null
  let endDate = now.toISOString()

  switch (timeRange.value) {
    case '1h':
      startDate = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
      break
    case '24h':
      startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
      break
    case '7d':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
      break
    case '30d':
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
      break
    case 'custom':
      // 自定义时间范围由用户设置
      return
  }

  if (startDate) {
    updateFilters({
      startDate: startDate.slice(0, 16), // datetime-local format
      endDate: endDate.slice(0, 16)
    })
    applyFilters()
  }
}

// 排序
const sort = (field) => {
  const currentSort = filters.sortBy
  const currentOrder = filters.sortOrder

  if (currentSort === field) {
    updateFilters({
      sortOrder: currentOrder === 'asc' ? 'desc' : 'asc'
    })
  } else {
    updateFilters({
      sortBy: field,
      sortOrder: 'desc'
    })
  }
  applyFilters()
}

// 获取排序图标
const getSortIcon = (field) => {
  if (filters.sortBy !== field) return 'fa-sort'
  return filters.sortOrder === 'asc' ? 'fa-sort-up' : 'fa-sort-down'
}

// 切换页面
const changePage = (page) => {
  if (page >= 1 && page <= pagination.totalPages) {
    updateFilters({ page })
    applyFilters()
  }
}

// 显示日志详情
const showLogDetails = (log) => {
  selectedLog.value = log
}

// 导出数据
const exportData = async (format) => {
  showExportMenu.value = false
  await exportLogs(format)
}

// 刷新数据
const refreshData = async () => {
  await refreshLogs()
}

// 自动刷新定时器
let refreshInterval = null

// 页面挂载时加载数据
onMounted(async () => {
  // 应用默认时间范围
  applyTimeRange()

  // 加载统计数据
  await fetchStats()

  // 设置自动刷新
  refreshInterval = setInterval(async () => {
    await fetchStats()
  }, 30000) // 每30秒刷新统计数据
})

// 监听点击外部关闭导出菜单的处理函数
const handleClickOutside = (e) => {
  if (!e.target.closest('.relative')) {
    showExportMenu.value = false
  }
}

// 页面挂载时添加全局点击监听器
onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

// 组件卸载时清理所有资源
onUnmounted(() => {
  // 清理定时器
  if (refreshInterval) {
    clearInterval(refreshInterval)
    refreshInterval = null
  }
  // 清理事件监听器
  document.removeEventListener('click', handleClickOutside)
})
</script>

<style scoped>
.request-logs-container {
  min-height: calc(100vh - 200px);
}

.card {
  @apply rounded-lg bg-white shadow-sm ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-800;
}

.stat-card {
  @apply rounded-lg bg-white p-6 shadow-sm ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-800;
}

.btn {
  @apply inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2;
}

.btn-sm {
  @apply px-3 py-1 text-xs;
}

.btn-primary {
  @apply bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500;
}

.btn-secondary {
  @apply bg-gray-200 text-gray-900 hover:bg-gray-300 focus:ring-gray-500 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600;
}

.form-input,
.form-select {
  @apply w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-blue-400;
}

.table-header {
  @apply bg-gray-50 px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:bg-gray-800 dark:text-gray-400;
}

.table-cell {
  @apply whitespace-nowrap px-6 py-4 text-sm;
}

.loading-spinner {
  @apply h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600;
}

/* 状态码样式 */
.status-success {
  @apply bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200;
}

.status-error {
  @apply bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200;
}

.status-warning {
  @apply bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200;
}

/* 方法样式 */
.method-get {
  @apply bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200;
}

.method-post {
  @apply bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200;
}

.method-put {
  @apply bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200;
}

.method-delete {
  @apply bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200;
}
</style>
