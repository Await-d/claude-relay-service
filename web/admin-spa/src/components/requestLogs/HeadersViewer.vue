<template>
  <div class="headers-viewer">
    <!-- 头部统计信息 -->
    <div class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div class="stat-card bg-blue-50 dark:bg-blue-900/20">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-blue-700 dark:text-blue-300">请求头数量</p>
            <p class="text-2xl font-bold text-blue-900 dark:text-blue-100">
              {{ Object.keys(requestHeaders || {}).length }}
            </p>
          </div>
          <i class="fas fa-arrow-up text-2xl text-blue-500"></i>
        </div>
      </div>

      <div class="stat-card bg-green-50 dark:bg-green-900/20">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-green-700 dark:text-green-300">响应头数量</p>
            <p class="text-2xl font-bold text-green-900 dark:text-green-100">
              {{ Object.keys(responseHeaders || {}).length }}
            </p>
          </div>
          <i class="fas fa-arrow-down text-2xl text-green-500"></i>
        </div>
      </div>

      <div class="stat-card bg-purple-50 dark:bg-purple-900/20">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-purple-700 dark:text-purple-300">总大小</p>
            <p class="text-2xl font-bold text-purple-900 dark:text-purple-100">
              {{ formatBytes(totalHeadersSize) }}
            </p>
          </div>
          <i class="fas fa-weight-hanging text-2xl text-purple-500"></i>
        </div>
      </div>
    </div>

    <!-- 搜索和过滤 -->
    <div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div class="max-w-md flex-1">
        <div class="relative">
          <input
            v-model="searchTerm"
            class="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-4 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            placeholder="搜索请求头或响应头..."
            type="text"
          />
          <i class="fas fa-search absolute left-3 top-3 text-gray-400"></i>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <button
          :class="[
            'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            showRequestHeaders
              ? 'bg-blue-500 text-white'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
          ]"
          @click="showRequestHeaders = !showRequestHeaders"
        >
          <i class="fas fa-arrow-up mr-1"></i>
          请求头
        </button>

        <button
          :class="[
            'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            showResponseHeaders
              ? 'bg-green-500 text-white'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
          ]"
          @click="showResponseHeaders = !showResponseHeaders"
        >
          <i class="fas fa-arrow-down mr-1"></i>
          响应头
        </button>
      </div>
    </div>

    <!-- Headers内容 -->
    <div class="space-y-6">
      <!-- 请求头部分 -->
      <div v-if="showRequestHeaders" class="rounded-lg bg-white shadow dark:bg-gray-800">
        <div class="border-b border-gray-200 px-6 py-4 dark:border-gray-700">
          <h4 class="flex items-center text-lg font-semibold text-gray-900 dark:text-gray-100">
            <i class="fas fa-arrow-up mr-2 text-blue-500"></i>
            请求头
            <span class="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">
              ({{ filteredRequestHeaders.length }} 个)
            </span>
          </h4>
        </div>

        <div class="p-6">
          <div v-if="filteredRequestHeaders.length === 0" class="py-8 text-center">
            <i class="fas fa-inbox mb-3 text-4xl text-gray-300 dark:text-gray-600"></i>
            <p class="text-gray-500 dark:text-gray-400">
              {{ searchTerm ? '没有找到匹配的请求头' : '暂无请求头信息' }}
            </p>
          </div>

          <div v-else class="space-y-3">
            <div
              v-for="[key, value] in filteredRequestHeaders"
              :key="`req-${key}`"
              class="header-item group"
            >
              <div
                class="flex items-start justify-between rounded-lg bg-gray-50 px-4 py-3 transition-colors duration-200 hover:bg-gray-100 dark:bg-gray-700/50 dark:hover:bg-gray-700"
              >
                <div class="min-w-0 flex-1">
                  <div class="mb-1 flex items-center gap-2">
                    <span class="font-medium text-gray-900 dark:text-gray-100">
                      {{ key }}
                    </span>
                    <span class="rounded-full px-2 py-1 text-xs" :class="getHeaderTypeColor(key)">
                      {{ getHeaderType(key) }}
                    </span>
                  </div>
                  <div class="break-all text-sm text-gray-600 dark:text-gray-400">
                    {{ formatHeaderValue(value) }}
                  </div>
                </div>

                <button
                  class="ml-3 p-2 text-gray-400 opacity-0 transition-all duration-200 hover:text-gray-600 group-hover:opacity-100 dark:hover:text-gray-300"
                  :title="`复制 ${key}`"
                  @click="copyToClipboard(`${key}: ${value}`)"
                >
                  <i class="fas fa-copy text-sm"></i>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 响应头部分 -->
      <div v-if="showResponseHeaders" class="rounded-lg bg-white shadow dark:bg-gray-800">
        <div class="border-b border-gray-200 px-6 py-4 dark:border-gray-700">
          <h4 class="flex items-center text-lg font-semibold text-gray-900 dark:text-gray-100">
            <i class="fas fa-arrow-down mr-2 text-green-500"></i>
            响应头
            <span class="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">
              ({{ filteredResponseHeaders.length }} 个)
            </span>
          </h4>
        </div>

        <div class="p-6">
          <div v-if="filteredResponseHeaders.length === 0" class="py-8 text-center">
            <i class="fas fa-inbox mb-3 text-4xl text-gray-300 dark:text-gray-600"></i>
            <p class="text-gray-500 dark:text-gray-400">
              {{ searchTerm ? '没有找到匹配的响应头' : '暂无响应头信息' }}
            </p>
          </div>

          <div v-else class="space-y-3">
            <div
              v-for="[key, value] in filteredResponseHeaders"
              :key="`res-${key}`"
              class="header-item group"
            >
              <div
                class="flex items-start justify-between rounded-lg bg-gray-50 px-4 py-3 transition-colors duration-200 hover:bg-gray-100 dark:bg-gray-700/50 dark:hover:bg-gray-700"
              >
                <div class="min-w-0 flex-1">
                  <div class="mb-1 flex items-center gap-2">
                    <span class="font-medium text-gray-900 dark:text-gray-100">
                      {{ key }}
                    </span>
                    <span class="rounded-full px-2 py-1 text-xs" :class="getHeaderTypeColor(key)">
                      {{ getHeaderType(key) }}
                    </span>
                  </div>
                  <div class="break-all text-sm text-gray-600 dark:text-gray-400">
                    {{ formatHeaderValue(value) }}
                  </div>
                </div>

                <button
                  class="ml-3 p-2 text-gray-400 opacity-0 transition-all duration-200 hover:text-gray-600 group-hover:opacity-100 dark:hover:text-gray-300"
                  :title="`复制 ${key}`"
                  @click="copyToClipboard(`${key}: ${value}`)"
                >
                  <i class="fas fa-copy text-sm"></i>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Header分析统计 -->
    <div v-if="hasAnyHeaders" class="mt-6">
      <div class="rounded-lg bg-white p-6 shadow dark:bg-gray-800">
        <h4 class="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
          <i class="fas fa-chart-bar mr-2"></i>
          Header分析
        </h4>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div class="rounded-lg bg-gray-50 p-3 text-center dark:bg-gray-700/50">
            <div class="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {{ getHeaderCategoryCount('security') }}
            </div>
            <div class="text-sm text-gray-600 dark:text-gray-400">安全相关</div>
          </div>

          <div class="rounded-lg bg-gray-50 p-3 text-center dark:bg-gray-700/50">
            <div class="text-2xl font-bold text-green-600 dark:text-green-400">
              {{ getHeaderCategoryCount('cache') }}
            </div>
            <div class="text-sm text-gray-600 dark:text-gray-400">缓存控制</div>
          </div>

          <div class="rounded-lg bg-gray-50 p-3 text-center dark:bg-gray-700/50">
            <div class="text-2xl font-bold text-purple-600 dark:text-purple-400">
              {{ getHeaderCategoryCount('content') }}
            </div>
            <div class="text-sm text-gray-600 dark:text-gray-400">内容类型</div>
          </div>

          <div class="rounded-lg bg-gray-50 p-3 text-center dark:bg-gray-700/50">
            <div class="text-2xl font-bold text-orange-600 dark:text-orange-400">
              {{ getHeaderCategoryCount('custom') }}
            </div>
            <div class="text-sm text-gray-600 dark:text-gray-400">自定义头</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

// Props
const props = defineProps({
  requestHeaders: {
    type: Object,
    default: () => ({})
  },
  responseHeaders: {
    type: Object,
    default: () => ({})
  }
})

// Data
const searchTerm = ref('')
const showRequestHeaders = ref(true)
const showResponseHeaders = ref(true)

// Computed
const hasAnyHeaders = computed(() => {
  return (
    Object.keys(props.requestHeaders || {}).length > 0 ||
    Object.keys(props.responseHeaders || {}).length > 0
  )
})

const totalHeadersSize = computed(() => {
  let size = 0
  Object.entries(props.requestHeaders || {}).forEach(([key, value]) => {
    size += key.length + String(value).length
  })
  Object.entries(props.responseHeaders || {}).forEach(([key, value]) => {
    size += key.length + String(value).length
  })
  return size
})

const filteredRequestHeaders = computed(() => {
  const headers = props.requestHeaders || {}
  const entries = Object.entries(headers)

  if (!searchTerm.value) return entries

  const term = searchTerm.value.toLowerCase()
  return entries.filter(
    ([key, value]) => key.toLowerCase().includes(term) || String(value).toLowerCase().includes(term)
  )
})

const filteredResponseHeaders = computed(() => {
  const headers = props.responseHeaders || {}
  const entries = Object.entries(headers)

  if (!searchTerm.value) return entries

  const term = searchTerm.value.toLowerCase()
  return entries.filter(
    ([key, value]) => key.toLowerCase().includes(term) || String(value).toLowerCase().includes(term)
  )
})

// Methods
const formatBytes = (bytes) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const formatHeaderValue = (value) => {
  if (typeof value !== 'string') return String(value)

  // 如果值太长，截断并显示省略号
  if (value.length > 100) {
    return value.substring(0, 97) + '...'
  }

  return value
}

const getHeaderType = (key) => {
  const lowerKey = key.toLowerCase()

  // 安全相关
  if (
    [
      'authorization',
      'cookie',
      'set-cookie',
      'x-csrf-token',
      'x-frame-options',
      'x-content-type-options'
    ].includes(lowerKey)
  ) {
    return '安全'
  }

  // 缓存相关
  if (
    [
      'cache-control',
      'expires',
      'etag',
      'if-none-match',
      'if-modified-since',
      'last-modified'
    ].includes(lowerKey)
  ) {
    return '缓存'
  }

  // 内容相关
  if (
    [
      'content-type',
      'content-length',
      'content-encoding',
      'accept',
      'accept-encoding',
      'accept-language'
    ].includes(lowerKey)
  ) {
    return '内容'
  }

  // 自定义头
  if (lowerKey.startsWith('x-') || lowerKey.startsWith('anthropic-')) {
    return '自定义'
  }

  return '标准'
}

const getHeaderTypeColor = (key) => {
  const type = getHeaderType(key)
  const colors = {
    安全: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    缓存: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    内容: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
    自定义: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
    标准: 'bg-gray-100 text-gray-700 dark:bg-gray-700/50 dark:text-gray-300'
  }
  return colors[type] || colors['标准']
}

const getHeaderCategoryCount = (category) => {
  const allHeaders = { ...props.requestHeaders, ...props.responseHeaders }
  let count = 0

  Object.keys(allHeaders).forEach((key) => {
    const type = getHeaderType(key)
    if (
      (category === 'security' && type === '安全') ||
      (category === 'cache' && type === '缓存') ||
      (category === 'content' && type === '内容') ||
      (category === 'custom' && type === '自定义')
    ) {
      count++
    }
  })

  return count
}

const copyToClipboard = async (text) => {
  try {
    await navigator.clipboard.writeText(text)
    // 这里可以添加一个简单的提示
    console.log('已复制到剪贴板')
  } catch (err) {
    console.error('复制失败:', err)
  }
}
</script>

<style scoped>
.stat-card {
  @apply rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800;
}

.header-item {
  @apply transition-all duration-200;
}

.header-item:hover {
  @apply scale-[1.02] transform;
}
</style>
