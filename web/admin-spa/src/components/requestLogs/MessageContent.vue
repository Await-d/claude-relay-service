<template>
  <div class="message-content">
    <!-- 内容统计卡片 -->
    <div class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div class="stat-card bg-blue-50 dark:bg-blue-900/20">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-blue-700 dark:text-blue-300">请求体大小</p>
            <p class="text-2xl font-bold text-blue-900 dark:text-blue-100">
              {{ formatBytes(getContentSize(requestBody)) }}
            </p>
          </div>
          <i class="fas fa-upload text-2xl text-blue-500"></i>
        </div>
      </div>

      <div class="stat-card bg-green-50 dark:bg-green-900/20">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-green-700 dark:text-green-300">响应体大小</p>
            <p class="text-2xl font-bold text-green-900 dark:text-green-100">
              {{ formatBytes(getContentSize(responseBody)) }}
            </p>
          </div>
          <i class="fas fa-download text-2xl text-green-500"></i>
        </div>
      </div>

      <div class="stat-card bg-purple-50 dark:bg-purple-900/20">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-purple-700 dark:text-purple-300">消息数量</p>
            <p class="text-2xl font-bold text-purple-900 dark:text-purple-100">
              {{ getMessageCount() }}
            </p>
          </div>
          <i class="fas fa-comments text-2xl text-purple-500"></i>
        </div>
      </div>

      <div class="stat-card bg-orange-50 dark:bg-orange-900/20">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-orange-700 dark:text-orange-300">数据格式</p>
            <p class="text-lg font-bold text-orange-900 dark:text-orange-100">
              {{ getContentFormat() }}
            </p>
          </div>
          <i class="fas fa-file-code text-2xl text-orange-500"></i>
        </div>
      </div>
    </div>

    <!-- 内容切换和搜索 -->
    <div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex items-center gap-2">
        <button
          :class="[
            'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
            activeContent === 'request'
              ? 'bg-blue-500 text-white'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
          ]"
          @click="activeContent = 'request'"
        >
          <i class="fas fa-upload mr-1"></i>
          请求内容
        </button>

        <button
          :class="[
            'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
            activeContent === 'response'
              ? 'bg-green-500 text-white'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
          ]"
          @click="activeContent = 'response'"
        >
          <i class="fas fa-download mr-1"></i>
          响应内容
        </button>
      </div>

      <div class="flex items-center gap-2">
        <div class="relative">
          <input
            v-model="searchTerm"
            class="rounded-lg border border-gray-300 bg-white py-2 pl-8 pr-4 text-sm text-gray-900 focus:border-transparent focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            placeholder="搜索内容..."
            type="text"
          />
          <i class="fas fa-search absolute left-2.5 top-2.5 text-sm text-gray-400"></i>
        </div>

        <select
          v-model="viewMode"
          class="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-transparent focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        >
          <option value="formatted">格式化</option>
          <option value="raw">原始</option>
          <option value="pretty">美化</option>
        </select>
      </div>
    </div>

    <!-- 内容展示区域 -->
    <div class="space-y-6">
      <!-- 请求内容 -->
      <div v-if="activeContent === 'request'" class="rounded-lg bg-white shadow dark:bg-gray-800">
        <div class="border-b border-gray-200 px-6 py-4 dark:border-gray-700">
          <div class="flex items-center justify-between">
            <h4 class="flex items-center text-lg font-semibold text-gray-900 dark:text-gray-100">
              <i class="fas fa-upload mr-2 text-blue-500"></i>
              请求内容
              <span class="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">
                {{
                  getContentSize(requestBody) > 0
                    ? formatBytes(getContentSize(requestBody))
                    : '无内容'
                }}
              </span>
            </h4>

            <div class="flex items-center gap-2">
              <button
                v-if="requestBody"
                class="p-2 text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300"
                title="复制内容"
                @click="copyToClipboard(getDisplayContent(requestBody))"
              >
                <i class="fas fa-copy"></i>
              </button>

              <button
                v-if="requestBody"
                class="p-2 text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300"
                title="下载内容"
                @click="downloadContent(getDisplayContent(requestBody), 'request.json')"
              >
                <i class="fas fa-download"></i>
              </button>
            </div>
          </div>
        </div>

        <div class="p-6">
          <div v-if="!requestBody" class="py-12 text-center">
            <i class="fas fa-inbox mb-3 text-4xl text-gray-300 dark:text-gray-600"></i>
            <p class="text-gray-500 dark:text-gray-400">暂无请求内容</p>
          </div>

          <div v-else class="relative">
            <!-- 内容区域 -->
            <div class="content-container">
              <pre
                v-if="viewMode === 'raw'"
                class="content-block raw-content"
              ><code>{{ highlightSearch(getDisplayContent(requestBody)) }}</code></pre>

              <div
                v-else-if="viewMode === 'formatted'"
                class="content-block formatted-content"
                v-html="formatContent(requestBody, true)"
              ></div>

              <pre
                v-else
                class="content-block pretty-content"
              ><code>{{ highlightSearch(getPrettyContent(requestBody)) }}</code></pre>
            </div>

            <!-- 内容统计 -->
            <div class="mt-4 flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
              <span><i class="fas fa-align-left mr-1"></i>{{ getLineCount(requestBody) }} 行</span>
              <span><i class="fas fa-font mr-1"></i>{{ getCharacterCount(requestBody) }} 字符</span>
              <span v-if="isJsonContent(requestBody)">
                <i class="fas fa-code mr-1"></i>JSON 格式
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- 响应内容 -->
      <div v-if="activeContent === 'response'" class="rounded-lg bg-white shadow dark:bg-gray-800">
        <div class="border-b border-gray-200 px-6 py-4 dark:border-gray-700">
          <div class="flex items-center justify-between">
            <h4 class="flex items-center text-lg font-semibold text-gray-900 dark:text-gray-100">
              <i class="fas fa-download mr-2 text-green-500"></i>
              响应内容
              <span class="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">
                {{
                  getContentSize(responseBody) > 0
                    ? formatBytes(getContentSize(responseBody))
                    : '无内容'
                }}
              </span>
            </h4>

            <div class="flex items-center gap-2">
              <button
                v-if="responseBody"
                class="p-2 text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300"
                title="复制内容"
                @click="copyToClipboard(getDisplayContent(responseBody))"
              >
                <i class="fas fa-copy"></i>
              </button>

              <button
                v-if="responseBody"
                class="p-2 text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300"
                title="下载内容"
                @click="downloadContent(getDisplayContent(responseBody), 'response.json')"
              >
                <i class="fas fa-download"></i>
              </button>
            </div>
          </div>
        </div>

        <div class="p-6">
          <div v-if="!responseBody" class="py-12 text-center">
            <i class="fas fa-inbox mb-3 text-4xl text-gray-300 dark:text-gray-600"></i>
            <p class="text-gray-500 dark:text-gray-400">暂无响应内容</p>
          </div>

          <div v-else class="relative">
            <!-- 内容区域 -->
            <div class="content-container">
              <pre
                v-if="viewMode === 'raw'"
                class="content-block raw-content"
              ><code>{{ highlightSearch(getDisplayContent(responseBody)) }}</code></pre>

              <div
                v-else-if="viewMode === 'formatted'"
                class="content-block formatted-content"
                v-html="formatContent(responseBody, true)"
              ></div>

              <pre
                v-else
                class="content-block pretty-content"
              ><code>{{ highlightSearch(getPrettyContent(responseBody)) }}</code></pre>
            </div>

            <!-- 内容统计 -->
            <div class="mt-4 flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
              <span><i class="fas fa-align-left mr-1"></i>{{ getLineCount(responseBody) }} 行</span>
              <span
                ><i class="fas fa-font mr-1"></i>{{ getCharacterCount(responseBody) }} 字符</span
              >
              <span v-if="isJsonContent(responseBody)">
                <i class="fas fa-code mr-1"></i>JSON 格式
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 内容对比视图 -->
    <div v-if="requestBody && responseBody" class="mt-6">
      <div class="rounded-lg bg-white p-6 shadow dark:bg-gray-800">
        <h4 class="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
          <i class="fas fa-balance-scale mr-2"></i>
          内容对比
        </h4>

        <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <!-- 请求摘要 -->
          <div class="rounded-lg bg-blue-50 p-4 dark:bg-blue-900/20">
            <h5 class="mb-2 font-medium text-blue-900 dark:text-blue-100">请求摘要</h5>
            <div class="space-y-1 text-sm text-blue-800 dark:text-blue-200">
              <div>大小: {{ formatBytes(getContentSize(requestBody)) }}</div>
              <div>行数: {{ getLineCount(requestBody) }}</div>
              <div>格式: {{ isJsonContent(requestBody) ? 'JSON' : '文本' }}</div>
            </div>
          </div>

          <!-- 响应摘要 -->
          <div class="rounded-lg bg-green-50 p-4 dark:bg-green-900/20">
            <h5 class="mb-2 font-medium text-green-900 dark:text-green-100">响应摘要</h5>
            <div class="space-y-1 text-sm text-green-800 dark:text-green-200">
              <div>大小: {{ formatBytes(getContentSize(responseBody)) }}</div>
              <div>行数: {{ getLineCount(responseBody) }}</div>
              <div>格式: {{ isJsonContent(responseBody) ? 'JSON' : '文本' }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'

// Props
const props = defineProps({
  requestBody: {
    type: [String, Object],
    default: null
  },
  responseBody: {
    type: [String, Object],
    default: null
  }
})

// Data
const activeContent = ref('request')
const viewMode = ref('formatted')
const searchTerm = ref('')

// Methods
const formatBytes = (bytes) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const getContentSize = (content) => {
  if (!content) return 0
  if (typeof content === 'string') return content.length
  return JSON.stringify(content).length
}

const getDisplayContent = (content) => {
  if (!content) return ''
  if (typeof content === 'string') return content
  return JSON.stringify(content, null, 2)
}

const getPrettyContent = (content) => {
  if (!content) return ''
  try {
    if (typeof content === 'string') {
      const parsed = JSON.parse(content)
      return JSON.stringify(parsed, null, 2)
    }
    return JSON.stringify(content, null, 2)
  } catch (e) {
    return getDisplayContent(content)
  }
}

const formatContent = (content, highlightJson = false) => {
  if (!content) return ''

  let displayContent = getDisplayContent(content)

  if (highlightJson && isJsonContent(content)) {
    // 简单的JSON语法高亮
    displayContent = displayContent
      .replace(/(".*?")/g, '<span class="json-string">$1</span>')
      .replace(/(\b\d+\b)/g, '<span class="json-number">$1</span>')
      .replace(/(\btrue\b|\bfalse\b|\bnull\b)/g, '<span class="json-boolean">$1</span>')
      .replace(/([{}[\],])/g, '<span class="json-key">$1</span>')
  }

  return `<pre class="whitespace-pre-wrap"><code>${displayContent}</code></pre>`
}

const isJsonContent = (content) => {
  if (typeof content === 'object') return true
  if (typeof content === 'string') {
    try {
      JSON.parse(content)
      return true
    } catch (e) {
      return false
    }
  }
  return false
}

const getLineCount = (content) => {
  const displayContent = getDisplayContent(content)
  return displayContent.split('\n').length
}

const getCharacterCount = (content) => {
  return getDisplayContent(content).length
}

const getMessageCount = () => {
  let count = 0

  // 尝试从请求体中提取消息数量
  if (props.requestBody) {
    try {
      const requestData =
        typeof props.requestBody === 'string' ? JSON.parse(props.requestBody) : props.requestBody

      if (requestData.messages && Array.isArray(requestData.messages)) {
        count += requestData.messages.length
      }
    } catch (e) {
      // 忽略解析错误
    }
  }

  return count || '—'
}

const getContentFormat = () => {
  const hasJsonRequest = isJsonContent(props.requestBody)
  const hasJsonResponse = isJsonContent(props.responseBody)

  if (hasJsonRequest && hasJsonResponse) return 'JSON'
  if (hasJsonRequest || hasJsonResponse) return 'Mixed'
  if (props.requestBody || props.responseBody) return 'Text'
  return '—'
}

const highlightSearch = (content) => {
  if (!searchTerm.value || !content) return content

  const term = searchTerm.value
  const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
  return content.replace(regex, '<mark class="bg-yellow-200 dark:bg-yellow-800">$1</mark>')
}

const copyToClipboard = async (text) => {
  try {
    await navigator.clipboard.writeText(text)
    console.log('已复制到剪贴板')
  } catch (err) {
    console.error('复制失败:', err)
  }
}

const downloadContent = (content, filename) => {
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
</script>

<style scoped>
.stat-card {
  @apply rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800;
}

.content-container {
  @apply max-h-96 overflow-auto;
}

.content-block {
  @apply rounded-lg border border-gray-200 bg-gray-50 p-4 font-mono text-sm dark:border-gray-700 dark:bg-gray-900/50;
}

.raw-content {
  @apply whitespace-pre-wrap;
}

.formatted-content {
  @apply whitespace-pre-wrap;
}

.pretty-content {
  @apply whitespace-pre-wrap;
}

.content-block code {
  @apply text-gray-900 dark:text-gray-100;
}

/* 搜索高亮样式 */
:deep(mark) {
  @apply rounded bg-yellow-200 px-1 dark:bg-yellow-800;
}

/* JSON语法高亮样式 */
:deep(.json-string) {
  @apply text-green-600 dark:text-green-400;
}

:deep(.json-number) {
  @apply text-blue-600 dark:text-blue-400;
}

:deep(.json-boolean) {
  @apply text-purple-600 dark:text-purple-400;
}

:deep(.json-key) {
  @apply text-gray-600 dark:text-gray-400;
}
</style>
