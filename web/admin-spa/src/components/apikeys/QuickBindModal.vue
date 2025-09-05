<template>
  <Teleport to="body">
    <div v-if="show" class="modal fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <div class="modal-content mx-auto flex max-h-[90vh] w-full max-w-lg flex-col p-4 sm:p-6">
        <div class="mb-4 flex items-center justify-between sm:mb-6">
          <div class="flex items-center gap-2 sm:gap-3">
            <div
              class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-purple-600 sm:h-10 sm:w-10 sm:rounded-xl"
            >
              <i class="fas fa-link text-sm text-white sm:text-base" />
            </div>
            <h3 class="text-lg font-bold text-gray-900 dark:text-gray-100 sm:text-xl">
              快速绑定专属账号
            </h3>
          </div>
          <button
            class="p-1 text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
            @click="$emit('close')"
          >
            <i class="fas fa-times text-lg sm:text-xl" />
          </button>
        </div>

        <!-- API Key 信息 -->
        <div class="mb-4 rounded-lg bg-gray-50 p-3 dark:bg-gray-800 sm:mb-6">
          <div class="flex items-center gap-2">
            <i class="fas fa-key text-gray-400" />
            <span class="font-medium text-gray-700 dark:text-gray-300">{{
              apiKey?.name || 'API Key'
            }}</span>
          </div>
        </div>

        <form
          class="modal-scroll-content custom-scrollbar flex-1 space-y-4"
          @submit.prevent="saveBindings"
        >
          <!-- Claude 专属账号 -->
          <div>
            <div class="mb-2 flex items-center gap-2">
              <div class="flex h-5 w-5 items-center justify-center rounded bg-orange-500">
                <i class="fas fa-robot text-xs text-white" />
              </div>
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300">
                Claude 专属账号
              </label>
            </div>
            <select
              v-model="bindings.claudeAccountId"
              class="form-select w-full text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
              :disabled="loading || !hasClaudeAccounts"
            >
              <option value="">使用共享池</option>
              <!-- OAuth 账户 -->
              <optgroup v-if="claudeOAuthAccounts.length > 0" label="OAuth 账户">
                <option
                  v-for="account in claudeOAuthAccounts"
                  :key="account.id"
                  :value="account.id"
                >
                  {{ account.name }} (专属) - {{ getAccountStatus(account) }}
                </option>
              </optgroup>
              <!-- Console 账户 -->
              <optgroup v-if="claudeConsoleAccounts.length > 0" label="Console 账户">
                <option
                  v-for="account in claudeConsoleAccounts"
                  :key="account.id"
                  :value="`console:${account.id}`"
                >
                  {{ account.name }} (专属) - {{ getAccountStatus(account) }}
                </option>
              </optgroup>
            </select>
          </div>

          <!-- Gemini 专属账号 -->
          <div>
            <div class="mb-2 flex items-center gap-2">
              <div class="flex h-5 w-5 items-center justify-center rounded bg-blue-500">
                <i class="fas fa-gem text-xs text-white" />
              </div>
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300">
                Gemini 专属账号
              </label>
            </div>
            <select
              v-model="bindings.geminiAccountId"
              class="form-select w-full text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
              :disabled="loading || !hasGeminiAccounts"
            >
              <option value="">使用共享池</option>
              <option v-for="account in geminiAccounts" :key="account.id" :value="account.id">
                {{ account.name }} (专属) - {{ getAccountStatus(account) }}
              </option>
            </select>
          </div>

          <!-- OpenAI 专属账号 -->
          <div>
            <div class="mb-2 flex items-center gap-2">
              <div class="flex h-5 w-5 items-center justify-center rounded bg-green-500">
                <i class="fas fa-brain text-xs text-white" />
              </div>
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300">
                OpenAI 专属账号
              </label>
            </div>
            <select
              v-model="bindings.openaiAccountId"
              class="form-select w-full text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
              :disabled="loading || !hasOpenaiAccounts"
            >
              <option value="">使用共享池</option>
              <option v-for="account in openaiAccounts" :key="account.id" :value="account.id">
                {{ account.name }} (专属) - {{ getAccountStatus(account) }}
              </option>
            </select>
          </div>

          <!-- Bedrock 专属账号 -->
          <div>
            <div class="mb-2 flex items-center gap-2">
              <div class="flex h-5 w-5 items-center justify-center rounded bg-amber-500">
                <i class="fas fa-aws text-xs text-white" />
              </div>
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300">
                Bedrock 专属账号
              </label>
            </div>
            <select
              v-model="bindings.bedrockAccountId"
              class="form-select w-full text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
              :disabled="loading || !hasBedrockAccounts"
            >
              <option value="">使用共享池</option>
              <option v-for="account in bedrockAccounts" :key="account.id" :value="account.id">
                {{ account.name }} (专属) - {{ getAccountStatus(account) }}
              </option>
            </select>
          </div>

          <!-- 提示信息 -->
          <div class="rounded-lg bg-blue-50 p-3 dark:bg-blue-900/20">
            <div class="flex items-start gap-2">
              <i class="fas fa-info-circle mt-0.5 text-sm text-blue-500" />
              <div class="text-xs text-blue-700 dark:text-blue-300">
                <p class="font-medium">绑定说明：</p>
                <ul class="mt-1 space-y-0.5">
                  <li>• 绑定专属账号后，该API Key的请求将只使用指定账号</li>
                  <li>• 选择"使用共享池"则使用系统的共享账号池</li>
                  <li>• 只有"专属"类型的账号才会显示在选项中</li>
                </ul>
              </div>
            </div>
          </div>

          <!-- 操作按钮 -->
          <div class="flex gap-3 pt-4">
            <button
              class="flex-1 rounded-xl bg-gray-100 px-6 py-3 font-semibold text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
              type="button"
              @click="$emit('close')"
            >
              取消
            </button>
            <button
              class="btn btn-primary flex-1 px-6 py-3 font-semibold"
              :disabled="loading"
              type="submit"
            >
              <div v-if="loading" class="loading-spinner mr-2" />
              <i v-else class="fas fa-save mr-2" />
              {{ loading ? '保存中...' : '保存绑定' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { showToast } from '@/utils/toast'
import { apiClient } from '@/config/api'

const props = defineProps({
  apiKey: {
    type: Object,
    required: true
  },
  accounts: {
    type: Object,
    default: () => ({
      claude: [],
      gemini: [],
      openai: [],
      bedrock: []
    })
  },
  show: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close', 'success'])

const loading = ref(false)

// 绑定数据
const bindings = reactive({
  claudeAccountId: '',
  geminiAccountId: '',
  openaiAccountId: '',
  bedrockAccountId: ''
})

// 计算属性：分离不同类型的Claude账户
const claudeOAuthAccounts = computed(() => {
  return (props.accounts.claude || []).filter(
    (account) => account.accountType === 'dedicated' && account.platform === 'claude-oauth'
  )
})

const claudeConsoleAccounts = computed(() => {
  return (props.accounts.claude || []).filter(
    (account) => account.accountType === 'dedicated' && account.platform === 'claude-console'
  )
})

// 计算属性：其他平台的专属账户
const geminiAccounts = computed(() => {
  return (props.accounts.gemini || []).filter((account) => account.accountType === 'dedicated')
})

const openaiAccounts = computed(() => {
  return (props.accounts.openai || []).filter((account) => account.accountType === 'dedicated')
})

const bedrockAccounts = computed(() => {
  return (props.accounts.bedrock || []).filter((account) => account.accountType === 'dedicated')
})

// 计算属性：是否有可用账户
const hasClaudeAccounts = computed(() => {
  return claudeOAuthAccounts.value.length > 0 || claudeConsoleAccounts.value.length > 0
})

const hasGeminiAccounts = computed(() => {
  return geminiAccounts.value.length > 0
})

const hasOpenaiAccounts = computed(() => {
  return openaiAccounts.value.length > 0
})

const hasBedrockAccounts = computed(() => {
  return bedrockAccounts.value.length > 0
})

// 获取账户状态文本
const getAccountStatus = (account) => {
  if (!account) return '未知'

  // 优先使用 isActive 判断
  if (account.isActive === false) {
    // 根据 status 提供更详细的状态信息
    switch (account.status) {
      case 'unauthorized':
        return '未授权'
      case 'error':
        return 'Token错误'
      case 'created':
        return '待验证'
      case 'rate_limited':
        return '限流中'
      default:
        return '异常'
    }
  }

  return '正常'
}

// 初始化绑定数据
const initializeBindings = () => {
  if (!props.apiKey) return

  // 处理Claude账户绑定（区分OAuth和Console）
  if (props.apiKey.claudeConsoleAccountId) {
    bindings.claudeAccountId = `console:${props.apiKey.claudeConsoleAccountId}`
  } else {
    bindings.claudeAccountId = props.apiKey.claudeAccountId || ''
  }

  // 其他平台绑定
  bindings.geminiAccountId = props.apiKey.geminiAccountId || ''
  bindings.openaiAccountId = props.apiKey.openaiAccountId || ''
  bindings.bedrockAccountId = props.apiKey.bedrockAccountId || ''
}

// 保存绑定设置
const saveBindings = async () => {
  loading.value = true

  try {
    // 准备提交的数据
    const data = {}

    // 处理Claude账户绑定（区分OAuth和Console）
    if (bindings.claudeAccountId) {
      if (bindings.claudeAccountId.startsWith('console:')) {
        // Claude Console账户
        data.claudeConsoleAccountId = bindings.claudeAccountId.substring(8)
        data.claudeAccountId = null // 清空OAuth账号
      } else {
        // Claude OAuth账户
        data.claudeAccountId = bindings.claudeAccountId
        data.claudeConsoleAccountId = null // 清空Console账号
      }
    } else {
      // 使用共享池，清空所有Claude绑定
      data.claudeAccountId = null
      data.claudeConsoleAccountId = null
    }

    // 其他平台账户绑定
    data.geminiAccountId = bindings.geminiAccountId || null
    data.openaiAccountId = bindings.openaiAccountId || null
    data.bedrockAccountId = bindings.bedrockAccountId || null

    const result = await apiClient.put(`/admin/api-keys/${props.apiKey.id}`, data)

    if (result.success) {
      showToast('专属账号绑定已更新', 'success')
      emit('success')
      emit('close')
    } else {
      showToast(result.message || '更新失败', 'error')
    }
  } catch (error) {
    console.error('保存绑定失败:', error)
    showToast('保存失败，请稍后重试', 'error')
  } finally {
    loading.value = false
  }
}

// 监听show属性变化，初始化数据
watch(
  () => props.show,
  (newShow) => {
    if (newShow) {
      initializeBindings()
    }
  },
  { immediate: true }
)

// 监听apiKey变化，更新绑定数据
watch(
  () => props.apiKey,
  () => {
    if (props.show) {
      initializeBindings()
    }
  },
  { immediate: true }
)
</script>

<style scoped>
/* 表单样式由全局样式提供 */
.loading-spinner {
  @apply h-4 w-4 animate-spin rounded-full border-2 border-white border-r-transparent;
}
</style>
