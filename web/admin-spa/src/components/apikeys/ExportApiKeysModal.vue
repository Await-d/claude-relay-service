<template>
<!-- eslint-disable no-unused-vars -->
  <Teleport to="body">
    <div class="modal fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <div class="modal-content mx-auto flex max-h-[90vh] w-full max-w-2xl flex-col p-4 sm:p-6">
        <div class="mb-4 flex items-center justify-between">
          <div class="flex items-center gap-2 sm:gap-3">
            <div
              class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 sm:h-10 sm:w-10 sm:rounded-xl"
            >
              <i class="fas fa-download text-sm text-white sm:text-base" />
            </div>
            <h3 class="text-lg font-bold text-gray-900 dark:text-gray-100 sm:text-xl">
              导出 API Keys 数据
            </h3>
          </div>
          <button
            class="p-1 text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
            :disabled="exporting"
            @click="$emit('close')"
          >
            <i class="fas fa-times text-lg sm:text-xl" />
          </button>
        </div>

        <div class="modal-scroll-content custom-scrollbar flex-1 space-y-6">
          <!-- 导出进度 -->
          <div
            v-if="exporting"
            class="rounded-lg border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 p-4 dark:border-blue-700 dark:from-blue-900/20 dark:to-indigo-900/20"
          >
            <div class="mb-3 flex items-center justify-between">
              <span class="text-sm font-medium text-blue-700 dark:text-blue-300">
                {{ exportStatus }}
              </span>
              <span class="text-sm text-blue-600 dark:text-blue-400"> {{ exportProgress }}% </span>
            </div>
            <div class="h-2 w-full overflow-hidden rounded-full bg-blue-200 dark:bg-blue-800">
              <div
                class="h-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-300 ease-out"
                :style="{ width: `${exportProgress}%` }"
              ></div>
            </div>
          </div>

          <!-- 文件格式选择 -->
          <div class="space-y-3">
            <label class="text-sm font-medium text-gray-700 dark:text-gray-300"> 文件格式 </label>
            <div class="grid grid-cols-2 gap-3">
              <label
                v-for="format in fileFormats"
                :key="format.value"
                class="group relative cursor-pointer"
              >
                <input
                  v-model="exportConfig.format"
                  class="peer sr-only"
                  :disabled="exporting"
                  type="radio"
                  :value="format.value"
                />
                <div
                  class="flex items-center gap-3 rounded-lg border-2 border-gray-200 bg-white p-3 transition-all duration-200 hover:border-gray-300 peer-checked:border-emerald-500 peer-checked:bg-emerald-50 peer-checked:hover:border-emerald-600 dark:border-gray-600 dark:bg-gray-800 dark:hover:border-gray-500 dark:peer-checked:border-emerald-400 dark:peer-checked:bg-emerald-900/20"
                >
                  <i :class="[format.icon, 'text-lg', format.color]" />
                  <div class="flex-1">
                    <div class="font-medium text-gray-900 dark:text-gray-100">
                      {{ format.label }}
                    </div>
                    <div class="text-xs text-gray-500 dark:text-gray-400">
                      {{ format.description }}
                    </div>
                  </div>
                  <i
                    class="fas fa-check-circle text-emerald-500 opacity-0 transition-opacity peer-checked:opacity-100"
                  />
                </div>
              </label>
            </div>
          </div>

          <!-- 时间范围筛选 -->
          <div class="space-y-3">
            <label class="text-sm font-medium text-gray-700 dark:text-gray-300"> 时间范围 </label>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div class="space-y-2">
                <label class="text-xs text-gray-600 dark:text-gray-400">开始时间</label>
                <input
                  v-model="exportConfig.startDate"
                  class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm transition-all duration-200 hover:border-gray-300 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-gray-500"
                  :disabled="exporting"
                  type="date"
                />
              </div>
              <div class="space-y-2">
                <label class="text-xs text-gray-600 dark:text-gray-400">结束时间</label>
                <input
                  v-model="exportConfig.endDate"
                  class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm transition-all duration-200 hover:border-gray-300 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-gray-500"
                  :disabled="exporting"
                  type="date"
                />
              </div>
            </div>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="range in quickRanges"
                :key="range.value"
                class="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 transition-all duration-200 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400 dark:hover:border-gray-500 dark:hover:bg-gray-700"
                :disabled="exporting"
                type="button"
                @click="setQuickRange(range.value)"
              >
                {{ range.label }}
              </button>
            </div>
          </div>

          <!-- 状态过滤 -->
          <div class="space-y-3">
            <label class="text-sm font-medium text-gray-700 dark:text-gray-300">
              状态过滤 (可选)
            </label>
            <select
              v-model="exportConfig.status"
              class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm transition-all duration-200 hover:border-gray-300 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-gray-500"
              :disabled="exporting"
            >
              <option value="">全部状态</option>
              <option value="active">活跃</option>
              <option value="disabled">已禁用</option>
              <option value="suspended">已暂停</option>
            </select>
          </div>

          <!-- 使用量过滤 -->
          <div class="space-y-3">
            <label class="text-sm font-medium text-gray-700 dark:text-gray-300">
              使用量过滤 (可选)
            </label>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div class="space-y-2">
                <label class="text-xs text-gray-600 dark:text-gray-400">最小使用量 (Tokens)</label>
                <input
                  v-model="exportConfig.minUsage"
                  class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm transition-all duration-200 hover:border-gray-300 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-gray-500"
                  :disabled="exporting"
                  min="0"
                  placeholder="例如: 1000"
                  type="number"
                />
              </div>
              <div class="space-y-2">
                <label class="text-xs text-gray-600 dark:text-gray-400">最大使用量 (Tokens)</label>
                <input
                  v-model="exportConfig.maxUsage"
                  class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm transition-all duration-200 hover:border-gray-300 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-gray-500"
                  :disabled="exporting"
                  min="0"
                  placeholder="例如: 100000"
                  type="number"
                />
              </div>
            </div>
          </div>

          <!-- 搜索过滤 -->
          <div class="space-y-3">
            <label class="text-sm font-medium text-gray-700 dark:text-gray-300">
              搜索过滤 (可选)
            </label>
            <input
              v-model="exportConfig.search"
              class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm transition-all duration-200 hover:border-gray-300 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-gray-500"
              :disabled="exporting"
              placeholder="搜索API Key名称或描述..."
              type="text"
            />
          </div>
        </div>

        <!-- 底部按钮 -->
        <div class="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <button
            class="order-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-all duration-200 hover:border-gray-300 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-gray-500 dark:hover:bg-gray-700 sm:order-1"
            :disabled="exporting"
            type="button"
            @click="$emit('close')"
          >
            取消
          </button>
          <button
            class="group relative order-1 overflow-hidden rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-600 px-4 py-2 text-sm font-medium text-white transition-all duration-200 hover:from-emerald-600 hover:to-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 sm:order-2"
            :disabled="exporting"
            type="button"
            @click="startExport"
          >
            <div
              class="absolute -inset-0.5 rounded-lg bg-gradient-to-r from-emerald-400 to-emerald-500 opacity-0 blur transition duration-300 group-hover:opacity-30 group-disabled:opacity-0"
            ></div>
            <span class="relative flex items-center gap-2">
              <i :class="['fas text-sm', exporting ? 'fa-spinner fa-spin' : 'fa-download']" />
              {{ exporting ? '导出中...' : '开始导出' }}
            </span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import dayjs from 'dayjs'
import axios from 'axios'

// Props & Emits
// eslint-disable-next-line no-unused-vars
const props = defineProps({
  apiKeys: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['close', 'export-complete'])

// 响应式数据
const exporting = ref(false)
const exportProgress = ref(0)
const exportStatus = ref('')

// 导出配置
const exportConfig = ref({
  format: 'csv',
  startDate: dayjs().subtract(30, 'day').format('YYYY-MM-DD'),
  endDate: dayjs().format('YYYY-MM-DD'),
  status: '',
  minUsage: '',
  maxUsage: '',
  search: ''
})

// 文件格式选项
const fileFormats = [
  {
    value: 'csv',
    label: 'CSV 文件',
    description: '纯文本格式，兼容性强',
    icon: 'fas fa-file-csv',
    color: 'text-blue-600'
  },
  {
    value: 'xlsx',
    label: 'Excel 文件',
    description: '支持多表格和格式化',
    icon: 'fas fa-file-excel',
    color: 'text-green-600'
  }
]

// 快速时间范围
const quickRanges = [
  { label: '最近7天', value: 7 },
  { label: '最近30天', value: 30 },
  { label: '最近90天', value: 90 },
  { label: '全部', value: 0 }
]

// 计算属性
// eslint-disable-next-line no-unused-vars
const canExport = computed(() => {
  return (
    exportConfig.value.startDate &&
    exportConfig.value.endDate &&
    dayjs(exportConfig.value.startDate).isBefore(dayjs(exportConfig.value.endDate))
  )
})

// 方法
const setQuickRange = (days) => {
  if (days === 0) {
    // 全部数据，设置一个很早的开始日期
    exportConfig.value.startDate = '2020-01-01'
    exportConfig.value.endDate = dayjs().format('YYYY-MM-DD')
  } else {
    exportConfig.value.startDate = dayjs().subtract(days, 'day').format('YYYY-MM-DD')
    exportConfig.value.endDate = dayjs().format('YYYY-MM-DD')
  }
}

const startExport = async () => {
  try {
    exporting.value = true
    exportProgress.value = 0
    exportStatus.value = '准备导出数据...'

    // 模拟进度更新
    const progressTimer = setInterval(() => {
      if (exportProgress.value < 90) {
        exportProgress.value += 10
      }
    }, 200)

    // 构建请求参数
    const requestData = {
      format: exportConfig.value.format,
      dateFrom: exportConfig.value.startDate,
      dateTo: exportConfig.value.endDate
    }

    // 添加可选过滤条件
    if (exportConfig.value.status) {
      requestData.status = exportConfig.value.status
    }
    if (exportConfig.value.minUsage) {
      requestData.minUsage = parseInt(exportConfig.value.minUsage)
    }
    if (exportConfig.value.maxUsage) {
      requestData.maxUsage = parseInt(exportConfig.value.maxUsage)
    }
    if (exportConfig.value.search) {
      requestData.search = exportConfig.value.search
    }

    exportStatus.value = '正在导出数据...'

    // 调用后端API
    const response = await axios.post('/admin/api-keys/export', requestData, {
      responseType: 'blob',
      timeout: 120000 // 2分钟超时
    })

    clearInterval(progressTimer)
    exportProgress.value = 100
    exportStatus.value = '导出完成！'

    // 获取文件名（从Content-Disposition header或使用默认值）
    const contentDisposition = response.headers['content-disposition']
    let filename = `api_keys_export_${Date.now()}.${exportConfig.value.format}`

    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
      if (filenameMatch) {
        filename = filenameMatch[1].replace(/['"]/g, '')
      }
    }

    // 创建下载链接
    const blob = new Blob([response.data])
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.style.display = 'none'

    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)

    // 清理URL对象
    window.URL.revokeObjectURL(url)

    ElMessage.success('数据导出完成！')

    // 通知父组件导出完成
    emit('export-complete')

    // 延迟关闭模态框以显示完成状态
    setTimeout(() => {
      emit('close')
    }, 1500)
  } catch (error) {
    console.error('导出失败:', error)

    let errorMessage = '导出失败，请重试'
    if (error.response) {
      // 服务器响应错误
      if (error.response.status === 404) {
        errorMessage = '没有找到符合条件的数据'
      } else if (error.response.status === 403) {
        errorMessage = '没有权限执行此操作'
      } else if (error.response.data && error.response.data.message) {
        errorMessage = error.response.data.message
      }
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = '导出超时，请尝试缩小导出范围'
    }

    ElMessage.error(errorMessage)
    exporting.value = false
    exportProgress.value = 0
    exportStatus.value = ''
  }
}

// 组件挂载
onMounted(() => {
  // 设置默认时间范围为最近30天
  setQuickRange(30)
})
</script>

<style scoped>
.modal {
  background-color: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.modal-content {
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 16px;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
}

.dark .modal-content {
  background: rgba(31, 41, 55, 0.95);
  border-color: rgba(55, 65, 81, 0.3);
}

.modal-scroll-content {
  overflow-y: auto;
}

.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.1);
  border-radius: 3px;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.3);
  border-radius: 3px;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.5);
}

.dark .custom-scrollbar::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.1);
}

.dark .custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.3);
}

.dark .custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.5);
}
</style>
