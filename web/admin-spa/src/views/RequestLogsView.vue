<template>
  <div class="request-logs-container">
    <!-- 页面标题和工具栏 -->
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-bold text-gray-900 dark:text-gray-100">请求日志</h2>
        <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">查看和管理 API 请求日志记录</p>
        <!-- 连接状态指示器 -->
        <div
          v-if="connectionError"
          class="mt-2 flex items-center text-sm text-red-600 dark:text-red-400"
        >
          <i class="fas fa-exclamation-triangle mr-1"></i>
          连接异常，数据可能不是最新的
        </div>
      </div>
      <div class="flex items-center space-x-3">
        <!-- 刷新按钮 -->
        <button
          :aria-label="loading ? '正在刷新数据' : '刷新日志数据'"
          class="btn btn-secondary"
          :disabled="loading"
          @click="refreshData"
        >
          <i class="fas fa-sync-alt mr-2" :class="{ 'animate-spin': loading }"></i>
          {{ loading ? '刷新中...' : '刷新' }}
        </button>
        <!-- 导出按钮 -->
        <div class="relative">
          <button
            :aria-label="exporting ? '正在导出数据' : '导出日志数据'"
            class="btn btn-primary"
            :disabled="exporting || (Array.isArray(logs) ? logs.length : 0) === 0"
            @click="showExportMenu = !showExportMenu"
          >
            <i class="fas fa-download mr-2" :class="{ 'animate-spin': exporting }"></i>
            {{ exporting ? '导出中...' : '导出' }}
          </button>
          <!-- 导出菜单 -->
          <div
            v-if="showExportMenu"
            aria-label="导出格式选择"
            class="absolute right-0 top-full z-50 mt-2 w-48 rounded-lg bg-white shadow-lg ring-1 ring-black ring-opacity-5 dark:bg-gray-800"
            role="menu"
          >
            <div class="py-1">
              <button
                class="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                role="menuitem"
                @click="exportData('json')"
              >
                <i class="fas fa-file-code mr-2"></i>
                导出为 JSON
              </button>
              <button
                class="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                role="menuitem"
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
        <div class="flex items-center space-x-2">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">筛选条件</h3>
          <button
            :aria-label="showMobileFilters ? '收起筛选面板' : '展开筛选面板'"
            class="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300 md:hidden"
            @click="showMobileFilters = !showMobileFilters"
          >
            <i class="fas" :class="showMobileFilters ? 'fa-chevron-up' : 'fa-chevron-down'"></i>
          </button>
        </div>
        <button
          v-if="hasFilters"
          class="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
          @click="clearAllFilters"
        >
          <i class="fas fa-times mr-1"></i>
          清除筛选
        </button>
      </div>

      <div
        class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4"
        :class="{ 'hidden md:grid': !showMobileFilters }"
      >
        <!-- 搜索框 -->
        <div class="relative">
          <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
            搜索
          </label>
          <div class="relative">
            <input
              v-model="filters.search"
              :aria-describedby="
                filters.search && (searchResults || []).length > 0
                  ? 'search-results-info'
                  : undefined
              "
              aria-label="搜索日志记录"
              class="form-input w-full pr-8"
              placeholder="API Key、IP、路径..."
              @input="debouncedSearch"
            />
            <div class="absolute right-2 top-1/2 -translate-y-1/2">
              <div v-if="searching" class="loading-spinner h-4 w-4"></div>
              <button
                v-else-if="filters.search"
                aria-label="清除搜索"
                class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                @click="clearSearch"
              >
                <i class="fas fa-times text-sm"></i>
              </button>
              <i v-else class="fas fa-search text-sm text-gray-400"></i>
            </div>
          </div>
          <!-- 搜索结果提示 -->
          <div
            v-if="filters.search && !searching"
            id="search-results-info"
            class="mt-1 text-xs text-gray-500 dark:text-gray-400"
          >
            <span v-if="filters.search && searchResults?.length > 0"
              >找到 {{ searchResults?.length || 0 }} 条结果</span
            >
            <span v-else>未找到匹配结果</span>
            <span class="ml-2">💡 试试搜索IP地址或完整路径</span>
          </div>
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
          <!-- 时间范围显示 -->
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {{ timeRangeDisplayText }}
          </p>
        </div>
      </div>

      <!-- 自定义时间范围 -->
      <div v-if="timeRange === 'custom'" class="mt-4">
        <!-- 时间范围输入 -->
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              开始时间
            </label>
            <input
              v-model="filters.startDate"
              class="form-input w-full"
              :class="{ 'border-red-300 focus:border-red-500 focus:ring-red-500': timeRangeError }"
              placeholder="选择开始时间"
              type="datetime-local"
            />
          </div>
          <div>
            <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              结束时间
            </label>
            <input
              v-model="filters.endDate"
              class="form-input w-full"
              :class="{ 'border-red-300 focus:border-red-500 focus:ring-red-500': timeRangeError }"
              placeholder="选择结束时间"
              type="datetime-local"
            />
          </div>
        </div>

        <!-- 错误提示 -->
        <div v-if="timeRangeError" class="mt-2 text-sm text-red-600 dark:text-red-400">
          <i class="fas fa-exclamation-circle mr-1"></i>
          {{ timeRangeError }}
        </div>

        <!-- 提示信息 -->
        <div v-else class="mt-2 text-xs text-gray-500 dark:text-gray-400">
          <i class="fas fa-info-circle mr-1"></i>
          支持最长90天的时间范围查询。修改时间后将自动查询。
        </div>
      </div>
    </div>

    <!-- 错误状态显示 -->
    <div v-if="error && !loading" class="card mb-6 p-6">
      <div class="text-center">
        <div
          class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900"
        >
          <i class="fas fa-exclamation-triangle text-2xl text-red-600 dark:text-red-400"></i>
        </div>
        <h3 class="mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100">加载失败</h3>
        <p class="mb-4 text-sm text-gray-600 dark:text-gray-400">{{ getErrorMessage(error) }}</p>
        <div
          class="flex flex-col items-center space-y-2 sm:flex-row sm:justify-center sm:space-x-4 sm:space-y-0"
        >
          <button class="btn btn-primary" @click="retryLoadData">
            <i class="fas fa-redo mr-2"></i>
            重试
          </button>
          <button class="btn btn-secondary" @click="showErrorDetails = true">
            <i class="fas fa-info-circle mr-2"></i>
            查看详情
          </button>
        </div>
      </div>
    </div>

    <!-- 日志表格 -->
    <div v-else class="card">
      <!-- 表格工具栏 -->
      <div
        class="flex flex-col space-y-3 border-b border-gray-200 p-4 dark:border-gray-700 sm:flex-row sm:items-center sm:justify-between sm:space-y-0"
      >
        <div class="flex items-center space-x-4">
          <span class="text-sm text-gray-600 dark:text-gray-400">
            {{ getResultsText() }}
          </span>
          <!-- 实时状态指示器 -->
          <div
            v-if="autoRefreshEnabled"
            class="flex items-center text-xs text-green-600 dark:text-green-400"
          >
            <div class="mr-1 h-2 w-2 animate-pulse rounded-full bg-green-500"></div>
            实时更新
          </div>
        </div>
        <div class="flex items-center space-x-2">
          <!-- 视图切换 -->
          <div
            class="hidden items-center space-x-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800 sm:flex"
          >
            <button
              class="rounded px-2 py-1 text-xs font-medium transition-colors"
              :class="
                viewMode === 'table'
                  ? 'bg-white text-blue-600 shadow-sm dark:bg-gray-700 dark:text-blue-400'
                  : 'text-gray-600 dark:text-gray-400'
              "
              @click="viewMode = 'table'"
            >
              <i class="fas fa-table mr-1"></i>
              表格
            </button>
            <button
              class="rounded px-2 py-1 text-xs font-medium transition-colors"
              :class="
                viewMode === 'cards'
                  ? 'bg-white text-blue-600 shadow-sm dark:bg-gray-700 dark:text-blue-400'
                  : 'text-gray-600 dark:text-gray-400'
              "
              @click="viewMode = 'cards'"
            >
              <i class="fas fa-th-large mr-1"></i>
              卡片
            </button>
          </div>
          <select
            v-model="filters.limit"
            aria-label="每页显示条数"
            class="form-select text-sm"
            @change="applyFilters"
          >
            <option value="25">25 条/页</option>
            <option value="50">50 条/页</option>
            <option value="100">100 条/页</option>
          </select>
        </div>
      </div>

      <!-- 加载状态 -->
      <div v-if="loading" class="p-8">
        <div class="space-y-3">
          <!-- 骨架屏 -->
          <div v-for="i in 5" :key="i" class="animate-pulse">
            <div class="flex items-center space-x-4">
              <div class="h-4 w-20 rounded bg-gray-200 dark:bg-gray-700"></div>
              <div class="h-4 w-16 rounded bg-gray-200 dark:bg-gray-700"></div>
              <div class="h-4 w-12 rounded bg-gray-200 dark:bg-gray-700"></div>
              <div class="h-4 flex-1 rounded bg-gray-200 dark:bg-gray-700"></div>
              <div class="h-4 w-16 rounded bg-gray-200 dark:bg-gray-700"></div>
              <div class="h-4 w-12 rounded bg-gray-200 dark:bg-gray-700"></div>
            </div>
          </div>
          <div class="mt-4 text-center">
            <div
              class="inline-flex items-center space-x-2 text-sm text-gray-500 dark:text-gray-400"
            >
              <div class="loading-spinner"></div>
              <span>正在加载日志数据...</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 无数据状态 -->
      <div v-else-if="displayedLogs.length === 0" class="py-12 text-center">
        <div
          class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800"
        >
          <i class="fas fa-inbox text-2xl text-gray-400"></i>
        </div>
        <h3 class="mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
          {{ filters.search ? '未找到匹配的日志' : '暂无日志记录' }}
        </h3>
        <div class="space-y-2 text-sm text-gray-600 dark:text-gray-400">
          <p v-if="filters.search">未找到包含 "{{ filters.search }}" 的日志记录</p>
          <p v-else>当前时间范围内没有日志记录</p>
          <div
            class="mt-4 flex flex-col items-center space-y-2 sm:flex-row sm:justify-center sm:space-x-4 sm:space-y-0"
          >
            <button v-if="hasFilters" class="btn btn-primary" @click="clearAllFilters">
              <i class="fas fa-filter mr-2"></i>
              清除所有筛选
            </button>
            <button class="btn btn-secondary" @click="refreshData">
              <i class="fas fa-sync-alt mr-2"></i>
              刷新数据
            </button>
          </div>
        </div>
      </div>

      <!-- 桌面端表格视图 -->
      <div v-else-if="viewMode === 'table'" class="hidden overflow-x-auto md:block">
        <table
          aria-label="请求日志列表"
          class="min-w-full divide-y divide-gray-200 dark:divide-gray-700"
          role="table"
        >
          <thead class="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th
                class="table-header cursor-pointer"
                role="columnheader"
                @click="sort('timestamp')"
              >
                <div class="flex items-center space-x-1">
                  <span>时间</span>
                  <i class="fas fa-sort text-gray-400" :class="getSortIcon('timestamp')"></i>
                </div>
              </th>
              <th class="table-header" role="columnheader">API Key</th>
              <th
                class="table-header cursor-pointer"
                role="columnheader"
                @click="sort('request.method')"
              >
                <div class="flex items-center space-x-1">
                  <span>方法</span>
                  <i class="fas fa-sort text-gray-400" :class="getSortIcon('request.method')"></i>
                </div>
              </th>
              <th class="table-header" role="columnheader">路径</th>
              <th
                class="table-header cursor-pointer"
                role="columnheader"
                @click="sort('response.statusCode')"
              >
                <div class="flex items-center space-x-1">
                  <span>状态码</span>
                  <i
                    class="fas fa-sort text-gray-400"
                    :class="getSortIcon('response.statusCode')"
                  ></i>
                </div>
              </th>
              <th
                class="table-header cursor-pointer"
                role="columnheader"
                @click="sort('response.duration')"
              >
                <div class="flex items-center space-x-1">
                  <span>响应时间</span>
                  <i
                    class="fas fa-sort text-gray-400"
                    :class="getSortIcon('response.duration')"
                  ></i>
                </div>
              </th>
              <th class="table-header" role="columnheader">IP 地址</th>
              <th class="table-header" role="columnheader">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900">
            <tr
              v-for="log in displayedLogs"
              :key="log.id"
              class="transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
              :class="{ 'animate-pulse bg-green-50 dark:bg-green-900/20': log._isNew }"
            >
              <td class="table-cell">
                <div class="text-sm text-gray-900 dark:text-gray-100">
                  {{ formatLogEntry(log).timestamp }}
                </div>
              </td>
              <td class="table-cell">
                <div class="flex items-center space-x-2">
                  <div
                    :aria-label="log.apiKey?.active ? 'API Key 活跃' : 'API Key 未活跃'"
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
                <div class="flex items-center space-x-1">
                  <span class="text-sm text-gray-900 dark:text-gray-100">
                    {{ formatLogEntry(log).duration }}
                  </span>
                  <i
                    v-if="log.response?.duration > 5000"
                    class="fas fa-exclamation-triangle text-xs text-yellow-500"
                    title="响应时间较慢"
                  ></i>
                </div>
              </td>
              <td class="table-cell">
                <span class="text-sm text-gray-600 dark:text-gray-400">
                  {{ log.request?.ip || 'N/A' }}
                </span>
              </td>
              <td class="table-cell">
                <button
                  :aria-label="`查看日志详情: ${log.apiKey?.name || 'Unknown'} ${log.request?.method} ${log.request?.path}`"
                  class="rounded p-1 text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-800 dark:text-blue-400 dark:hover:bg-blue-900/20 dark:hover:text-blue-300"
                  @click="showLogDetails(log)"
                >
                  <i class="fas fa-eye"></i>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 移动端卡片视图 -->
      <div v-else class="divide-y divide-gray-200 dark:divide-gray-700 md:hidden">
        <div
          v-for="log in displayedLogs"
          :key="log.id"
          class="p-4 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
          :class="{ 'animate-pulse bg-green-50 dark:bg-green-900/20': log._isNew }"
        >
          <div class="flex items-start justify-between">
            <div class="flex-1 space-y-2">
              <!-- 第一行：时间、API Key、查看按钮 -->
              <div class="flex items-center justify-between">
                <div class="flex items-center space-x-3">
                  <span class="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {{ formatLogEntry(log).timestamp.split(' ')[1] }}
                  </span>
                  <div class="flex items-center space-x-1">
                    <div
                      class="h-2 w-2 rounded-full"
                      :class="log.apiKey?.active ? 'bg-green-500' : 'bg-gray-400'"
                    ></div>
                    <span class="text-sm text-gray-600 dark:text-gray-400">
                      {{ log.apiKey?.name || 'Unknown' }}
                    </span>
                  </div>
                </div>
                <button
                  :aria-label="`查看详情`"
                  class="rounded p-2 text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-800 dark:text-blue-400 dark:hover:bg-blue-900/20 dark:hover:text-blue-300"
                  @click="showLogDetails(log)"
                >
                  <i class="fas fa-eye"></i>
                </button>
              </div>
              <!-- 第二行：方法、路径 -->
              <div class="flex items-center space-x-2">
                <span
                  class="inline-flex rounded-full px-2 py-1 text-xs font-semibold"
                  :class="getMethodClass(log.request?.method)"
                >
                  {{ log.request?.method || 'N/A' }}
                </span>
                <span class="truncate text-sm text-gray-900 dark:text-gray-100">
                  {{ log.request?.path || '/' }}
                </span>
              </div>
              <!-- 第三行：状态码、响应时间、IP -->
              <div class="flex items-center justify-between text-sm">
                <div class="flex items-center space-x-3">
                  <span
                    class="inline-flex rounded-full px-2 py-1 text-xs font-semibold"
                    :class="getStatusClass(log.response?.statusCode)"
                  >
                    {{ log.response?.statusCode || 'N/A' }}
                  </span>
                  <span class="text-gray-600 dark:text-gray-400">
                    ⏱️ {{ formatLogEntry(log).duration }}
                  </span>
                </div>
                <span class="text-gray-500 dark:text-gray-500">
                  🌐 {{ log.request?.ip || 'N/A' }}
                </span>
              </div>
            </div>
          </div>
        </div>
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

    <!-- 错误详情模态框 -->
    <div
      v-if="showErrorDetails"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
      @click.self="showErrorDetails = false"
    >
      <div
        class="max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-xl dark:bg-gray-800"
      >
        <div
          class="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-700"
        >
          <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">错误详情</h3>
          <button
            class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            @click="showErrorDetails = false"
          >
            <i class="fas fa-times text-xl"></i>
          </button>
        </div>
        <div class="max-h-[calc(90vh-120px)] overflow-y-auto p-6">
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                >错误类型</label
              >
              <p class="mt-1 text-sm text-gray-900 dark:text-gray-100">
                {{ error?.code || '未知错误' }}
              </p>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                >错误信息</label
              >
              <p class="mt-1 text-sm text-gray-900 dark:text-gray-100">
                {{ error?.message || '无详细信息' }}
              </p>
            </div>
            <div v-if="error?.status">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                >状态码</label
              >
              <p class="mt-1 text-sm text-gray-900 dark:text-gray-100">{{ error.status }}</p>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                >重试次数</label
              >
              <p class="mt-1 text-sm text-gray-900 dark:text-gray-100">{{ retryCount }}</p>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                >建议操作</label
              >
              <div class="mt-1 space-y-2 text-sm text-gray-600 dark:text-gray-400">
                <p v-if="error?.code === 'NETWORK_ERROR'">
                  • 检查网络连接是否正常<br />
                  • 检查VPN或代理设置<br />
                  • 尝试刷新页面
                </p>
                <p v-else-if="error?.status === 401">
                  • 重新登录系统<br />
                  • 检查登录凭据是否过期
                </p>
                <p v-else-if="error?.status >= 500">
                  • 稍后再试<br />
                  • 如问题持续，请联系技术支持
                </p>
                <p v-else>
                  • 检查网络连接<br />
                  • 刷新页面后重试
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import { useRequestLogsStore } from '@/stores/requestLogs'
import { showToast } from '@/utils/toast'

// 原生JavaScript实现debounce函数
const createDebounce = (func, delay) => {
  let timeoutId
  return (...args) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => func.apply(this, args), delay)
  }
}

// Store
const requestLogsStore = useRequestLogsStore()

// State
const showExportMenu = ref(false)
const selectedLog = ref(null)
const timeRange = ref('24h')
const timeRangeError = ref('')
const error = ref(null)
const connectionError = ref(false)
const searching = ref(false)
const showMobileFilters = ref(false)
const viewMode = ref('table')
const autoRefreshEnabled = ref(false)
const showErrorDetails = ref(false)
const retryCount = ref(0)

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

// Computed properties
const searchResults = computed(() => {
  // 确保 logs.value 是一个数组
  const logsList = Array.isArray(logs.value) ? logs.value : []

  if (!filters.search) return logsList
  // 确保 filters.search 是字符串
  const searchTerm = String(filters.search || '').toLowerCase()
  if (!searchTerm) return logsList

  return logsList.filter(
    (log) =>
      log?.apiKey?.name?.toLowerCase().includes(searchTerm) ||
      log?.request?.userAgent?.toLowerCase().includes(searchTerm) ||
      log?.request?.ip?.includes(searchTerm) ||
      log?.request?.path?.toLowerCase().includes(searchTerm)
  )
})

const displayedLogs = computed(() => {
  if (filters.search) {
    return searchResults.value
  }
  // 确保 filteredLogs.value 是一个数组
  return Array.isArray(filteredLogs.value) ? filteredLogs.value : []
})

// 防抖搜索
const debouncedSearch = createDebounce(async () => {
  searching.value = true
  try {
    await applyFilters()
  } finally {
    searching.value = false
  }
}, 500)

// 计算属性：时间范围显示文本
const timeRangeDisplayText = computed(() => {
  if (timeRange.value !== 'custom') {
    const rangeTexts = {
      '1h': '最近 1 小时',
      '24h': '最近 24 小时',
      '7d': '最近 7 天',
      '30d': '最近 30 天'
    }
    return rangeTexts[timeRange.value] || ''
  }

  if (filters.startDate && filters.endDate) {
    return `${filters.startDate} 至 ${filters.endDate}`
  }

  return '请设置时间范围'
})

// 监听自定义时间范围的变化
watch(
  () => [filters.startDate, filters.endDate],
  ([newStart, newEnd]) => {
    if (timeRange.value === 'custom' && newStart && newEnd) {
      // 清除之前的错误信息
      timeRangeError.value = ''

      // 防抖验证和查询
      debouncedCustomTimeUpdate()
    }
  }
)

// 防抖的自定义时间更新
const debouncedCustomTimeUpdate = createDebounce(async () => {
  if (timeRange.value === 'custom') {
    await applyCustomTimeFilters()
  }
}, 1000) // 1秒防抖

// 新增方法
const getResultsText = () => {
  const total = pagination.total
  const current = displayedLogs.value.length

  if (filters.search) {
    return `找到 ${searchResults.value ? searchResults.value.length : 0} 条匹配结果，共 ${total} 条记录`
  }
  return `显示 ${current} 条记录，共 ${total} 条`
}

const getErrorMessage = (err) => {
  if (!err) return '未知错误'

  if (err.code === 'NETWORK_ERROR') {
    return '网络连接失败，请检查网络连接后重试'
  }
  if (err.code === 'TIMEOUT') {
    return '请求超时，服务器响应缓慢'
  }
  if (err.status === 401) {
    return '认证失败，请重新登录'
  }
  if (err.status === 403) {
    return '没有权限访问此资源'
  }
  if (err.status >= 500) {
    return '服务器内部错误，请稍后重试或联系技术支持'
  }

  return err.message || '请求失败，请重试'
}

const clearSearch = () => {
  updateFilters({ search: '' })
  applyFilters()
}

const clearAllFilters = () => {
  clearFilters()
  applyFilters()
}

const retryLoadData = async () => {
  error.value = null
  connectionError.value = false
  retryCount.value++

  try {
    await refreshData()
    showToast('数据加载成功', 'success')
  } catch (err) {
    error.value = err
    showToast('重试失败，请检查网络连接', 'error')
  }
}

// 格式化百分比
const formatPercentage = (value) => {
  return `${(value * 100).toFixed(1)}%`
}

// 应用筛选（不含时间范围处理）
const applyFilters = async () => {
  try {
    error.value = null
    connectionError.value = false

    // 如果是自定义时间范围，需要验证和转换时间格式
    if (timeRange.value === 'custom') {
      await applyCustomTimeFilters()
    } else {
      await fetchLogs()
    }
  } catch (err) {
    console.error('Apply filters failed:', err)
    error.value = err
    connectionError.value = true
  }
}

// 应用自定义时间筛选
const applyCustomTimeFilters = async () => {
  const startDateLocal = filters.startDate
  const endDateLocal = filters.endDate

  if (!startDateLocal || !endDateLocal) {
    timeRangeError.value = '请设置完整的时间范围'
    return
  }

  // 简化验证：确保结束时间大于开始时间
  const startTime = new Date(startDateLocal)
  const endTime = new Date(endDateLocal)

  if (startTime >= endTime) {
    timeRangeError.value = '结束时间必须大于开始时间'
    return
  }

  // 检查时间范围不超过90天
  const diffDays = (endTime - startTime) / (1000 * 60 * 60 * 24)
  if (diffDays > 90) {
    timeRangeError.value = '时间范围不能超过90天'
    return
  }

  timeRangeError.value = ''
  await applyFiltersWithTimeRange(startTime.toISOString(), endTime.toISOString())
}

// 使用指定时间范围应用筛选
const applyFiltersWithTimeRange = async (startDateISO, endDateISO) => {
  // 临时保存原始时间格式
  const originalStart = filters.startDate
  const originalEnd = filters.endDate

  // 使用ISO格式进行查询
  updateFilters({
    startDate: startDateISO,
    endDate: endDateISO
  })

  await fetchLogs()

  // 恢复显示格式（如果需要的话）
  if (timeRange.value !== 'custom') {
    updateFilters({
      startDate: originalStart,
      endDate: originalEnd
    })
  }
}

// 获取时间范围的开始时间
const getTimeRangeStart = (range, endTime) => {
  const end = new Date(endTime)
  switch (range) {
    case '1h':
      return new Date(end.getTime() - 60 * 60 * 1000)
    case '24h':
      return new Date(end.getTime() - 24 * 60 * 60 * 1000)
    case '7d':
      return new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000)
    case '30d':
      return new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000)
    default:
      return new Date(end.getTime() - 24 * 60 * 60 * 1000)
  }
}

// 转换为datetime-local格式
const toDatetimeLocal = (date) => {
  const d = new Date(date)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

// 应用时间范围
const applyTimeRange = () => {
  timeRangeError.value = ''

  if (timeRange.value === 'custom') {
    // 自定义时间范围需要用户设置，不自动更新
    return
  }

  try {
    const now = new Date()
    const startTime = getTimeRangeStart(timeRange.value, now)
    const endTime = now

    // 转换为ISO字符串供后端使用
    const startDateISO = startTime.toISOString()
    const endDateISO = endTime.toISOString()

    // 转换为datetime-local格式供前端表单显示
    const startDateLocal = toDatetimeLocal(startTime)
    const endDateLocal = toDatetimeLocal(endTime)

    updateFilters({
      startDate: startDateLocal,
      endDate: endDateLocal
    })

    // 实际查询使用ISO格式
    applyFiltersWithTimeRange(startDateISO, endDateISO)
  } catch (error) {
    console.error('时间范围设置错误:', error)
    timeRangeError.value = error.message
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
  try {
    error.value = null
    connectionError.value = false
    await refreshLogs()
  } catch (err) {
    console.error('Refresh failed:', err)
    error.value = err
    connectionError.value = true
    throw err
  }
}

// 自动刷新定时器
let refreshInterval = null

// 页面挂载时加载数据
onMounted(async () => {
  try {
    // 应用默认时间范围
    applyTimeRange()

    // 加载统计数据
    await fetchStats()

    // 设置自动刷新
    if (autoRefreshEnabled.value) {
      refreshInterval = setInterval(async () => {
        try {
          await fetchStats()
        } catch (err) {
          console.warn('Auto refresh failed:', err)
          connectionError.value = true
        }
      }, 30000) // 每30秒刷新统计数据
    }
  } catch (err) {
    console.error('Initial load failed:', err)
    error.value = err
  }
})

// 监听点击外部关闭导出菜单的处理函数
const handleClickOutside = (e) => {
  if (!e.target.closest('.relative')) {
    showExportMenu.value = false
  }
}

// 检测网络状态
const handleOnline = () => {
  connectionError.value = false
  // 网络恢复时自动刷新数据
  if (error.value) {
    retryLoadData()
  }
}

const handleOffline = () => {
  connectionError.value = true
}

// 页面挂载时添加全局点击监听器和网络状态监听器
onMounted(() => {
  document.addEventListener('click', handleClickOutside)
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)

  // 检测初始网络状态
  if (!navigator.onLine) {
    connectionError.value = true
  }
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
  window.removeEventListener('online', handleOnline)
  window.removeEventListener('offline', handleOffline)
})
</script>

<style scoped>
.request-logs-container {
  min-height: calc(100vh - 200px);
}

.card {
  @apply rounded-lg bg-white shadow-sm ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-800;
  transition: all 0.2s ease;
}

.card:hover {
  @apply shadow-md ring-gray-300 dark:ring-gray-700;
}

.stat-card {
  @apply rounded-lg bg-white p-6 shadow-sm ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-800;
  transition: all 0.3s ease;
}

.stat-card:hover {
  @apply -translate-y-1 shadow-lg;
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

/* 搜索状态动画 */
.search-indicator {
  @apply transition-all duration-200 ease-in-out;
}

.search-indicator.searching {
  @apply scale-110 text-blue-500;
}

/* 新数据动画 */
@keyframes highlight {
  0% {
    @apply bg-green-100 dark:bg-green-900/30;
  }
  100% {
    @apply bg-transparent;
  }
}

.new-entry {
  animation: highlight 2s ease-out;
}

/* 错误状态样式 */
.error-container {
  @apply relative overflow-hidden;
}

.error-container::before {
  content: '';
  @apply absolute inset-0 bg-gradient-to-br from-red-50 to-red-100 dark:from-red-900/20 dark:to-red-800/20;
  animation: pulse 3s ease-in-out infinite;
}

/* 连接状态指示器 */
.connection-indicator {
  @apply flex items-center space-x-1 text-xs;
}

.connection-indicator.online {
  @apply text-green-600 dark:text-green-400;
}

.connection-indicator.offline {
  @apply text-red-600 dark:text-red-400;
}

.connection-pulse {
  @apply h-2 w-2 rounded-full;
  animation: pulse 1s ease-in-out infinite;
}

/* 响应式表格对比度优化 */
@media (max-width: 768px) {
  .table-row-mobile {
    @apply rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800;
    box-shadow:
      0 1px 3px 0 rgba(0, 0, 0, 0.1),
      0 1px 2px 0 rgba(0, 0, 0, 0.06);
  }

  .table-row-mobile:hover {
    @apply border-blue-200 shadow-md dark:border-blue-700;
  }
}

/* 状态指示器样式 */
.status-indicator {
  @apply relative inline-flex;
}

.status-indicator::after {
  content: '';
  @apply absolute -right-1 -top-1 h-3 w-3 rounded-full;
}

.status-indicator.success::after {
  @apply bg-green-500;
  animation: pulse 2s ease-in-out infinite;
}

.status-indicator.error::after {
  @apply bg-red-500;
}

.status-indicator.warning::after {
  @apply bg-yellow-500;
}

/* 日志级别颜色 */
.log-level-info {
  @apply bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200;
}

.log-level-warn {
  @apply bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200;
}

.log-level-error {
  @apply bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200;
}

.log-level-success {
  @apply bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200;
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

/* 滑入动画 */
.slide-fade-enter-active {
  transition: all 0.3s ease;
}

.slide-fade-leave-active {
  transition: all 0.3s ease;
}

.slide-fade-enter-from,
.slide-fade-leave-to {
  transform: translateX(20px);
  opacity: 0;
}

/* 无险访问改进 */
.focus-ring {
  @apply focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-blue-400;
}

.focus-ring:focus {
  @apply ring-opacity-50;
}

/* 高亮显示搜索结果 */
.highlight {
  @apply bg-yellow-200 text-yellow-900 dark:bg-yellow-800 dark:text-yellow-100;
  padding: 0 2px;
  border-radius: 2px;
}

/* 动画优化 */
@media (prefers-reduced-motion: reduce) {
  .loading-spinner,
  .animate-pulse,
  .animate-spin {
    animation: none;
  }

  .transition-all,
  .transition-colors,
  .transition-transform {
    transition: none;
  }
}

/* 打印样式 */
@media print {
  .btn,
  .loading-spinner,
  .modal {
    display: none;
  }

  .card {
    box-shadow: none;
    border: 1px solid #ccc;
  }
}
</style>
