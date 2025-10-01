<template>
  <Teleport to="body">
    <div
      v-if="show"
      class="modal fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 sm:p-4"
    >
      <div
        class="modal-content custom-scrollbar mx-auto max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-gray-900 sm:p-6 md:p-8"
      >
        <div class="mb-4 flex items-center justify-between sm:mb-6">
          <div class="flex items-center gap-3">
            <div
              class="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500"
            >
              <i class="fas fa-layer-group text-lg text-white" />
            </div>
            <div>
              <h3 class="text-lg font-bold text-gray-900 dark:text-gray-100 sm:text-xl">
                批量导入第三方账户
              </h3>
              <p class="text-xs text-gray-500 dark:text-gray-400 sm:text-sm">
                支持一次性导入多个 OpenAI / Claude / Gemini 手动凭证账户
              </p>
            </div>
          </div>
          <button
            class="rounded-lg p-1 text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-200"
            @click="close"
          >
            <i class="fas fa-times text-lg" />
          </button>
        </div>

        <div class="grid gap-6 lg:grid-cols-[220px_1fr]">
          <div class="space-y-6 rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/70">
            <div>
              <h4 class="mb-2 text-sm font-semibold text-gray-800 dark:text-gray-200">选择平台</h4>
              <CustomDropdown
                v-model="selectedPlatform"
                :options="platformOptions"
                icon="fa-server"
                icon-color="text-blue-500"
              />
            </div>

            <div v-if="selectedPlatform === 'gemini'">
              <h4 class="mb-2 text-sm font-semibold text-gray-800 dark:text-gray-200">账户类型</h4>
              <CustomDropdown
                v-model="geminiIntegration"
                :options="integrationOptions"
                icon="fa-plug"
                icon-color="text-purple-500"
              />
              <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
                第三方模式需要填写自定义 API 地址与密钥；OAuth 模式需提供 accessToken/refreshToken。
              </p>
            </div>

            <div>
              <h4 class="mb-2 text-sm font-semibold text-gray-800 dark:text-gray-200">输入说明</h4>
              <p class="text-xs leading-5 text-gray-600 dark:text-gray-400">
                {{ instructions }}
              </p>
            </div>

            <div>
              <h4 class="mb-2 text-sm font-semibold text-gray-800 dark:text-gray-200">示例</h4>
              <pre
                class="custom-scrollbar max-h-48 overflow-auto rounded-xl bg-gray-900/90 p-3 text-xs text-emerald-200"
              ><code>{{ sampleSnippet }}</code></pre>
            </div>
          </div>

          <div class="flex flex-col gap-4">
            <div>
              <label class="mb-2 block text-sm font-semibold text-gray-800 dark:text-gray-200">
                粘贴 JSON 数据
              </label>
              <textarea
                v-model="rawInput"
                class="custom-scrollbar form-input h-64 w-full font-mono text-xs dark:bg-gray-800 dark:text-gray-100"
                placeholder="支持 JSON 数组，或每行使用 key=value 形式"
              />
              <p v-if="parsingError" class="mt-2 text-xs text-red-500">
                {{ parsingError }}
              </p>
            </div>

            <div v-if="results" class="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/60">
              <div class="mb-2 flex items-center gap-2">
                <span
                  class="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-600 dark:bg-blue-900/40 dark:text-blue-200"
                >
                  总计 {{ results.summary.total }}
                </span>
                <span
                  class="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-600 dark:bg-green-900/40 dark:text-green-200"
                >
                  成功 {{ results.summary.success }}
                </span>
                <span
                  class="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-600 dark:bg-red-900/40 dark:text-red-200"
                >
                  失败 {{ results.summary.failed }}
                </span>
              </div>
              <ul class="space-y-2 text-xs text-gray-600 dark:text-gray-300">
                <li
                  v-for="item in results.results"
                  :key="`${item.index}-${item.name || item.platform}`"
                  class="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900"
                >
                  <span>
                    <i
                      :class="[
                        'mr-2',
                        item.success ? 'fa-solid fa-circle-check text-green-500' : 'fa-solid fa-circle-xmark text-red-500'
                      ]"
                    />
                    {{ item.name || '未命名账户' }}
                    <span class="ml-2 text-[11px] uppercase text-gray-400">{{ item.platform }}</span>
                  </span>
                  <span v-if="!item.success" class="text-[11px] text-red-500">{{ item.message }}</span>
                </li>
              </ul>
            </div>

            <div class="flex flex-col gap-3 sm:flex-row sm:justify-end">
              <button
                class="btn btn-secondary w-full sm:w-auto"
                :disabled="loading"
                @click="close"
              >
                取消
              </button>
              <button
                class="btn btn-primary w-full sm:w-auto"
                :disabled="loading"
                @click="handleImport"
              >
                <span v-if="loading" class="mr-2 flex items-center">
                  <i class="fas fa-spinner fa-spin" />
                </span>
                {{ loading ? '导入中...' : '开始导入' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { showToast } from '@/utils/toast'
import { useAccountsStore } from '@/stores/accounts'
import CustomDropdown from '@/components/common/CustomDropdown.vue'

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close', 'imported'])

const accountsStore = useAccountsStore()

const selectedPlatform = ref('openai')
const geminiIntegration = ref('third_party')
const rawInput = ref('')
const parsingError = ref('')
const loading = ref(false)
const results = ref(null)

const platformOptions = [
  { value: 'openai', label: 'OpenAI', icon: 'fa-openai' },
  { value: 'claude', label: 'Claude', icon: 'fa-brain' },
  { value: 'gemini', label: 'Gemini', icon: 'fa-robot' }
]

const integrationOptions = [
  { value: 'third_party', label: '第三方 (自定义 API)', icon: 'fa-plug' },
  { value: 'oauth', label: 'OAuth/手动 Token', icon: 'fa-lock' }
]

const instructions = computed(() => {
  const baseTips =
    '每行一条记录，使用 key=value 形式（使用分号或逗号分隔）。也可粘贴 JSON 对象。'

  switch (selectedPlatform.value) {
    case 'openai':
      return `${baseTips} 必填字段：name 以及 accessToken 或 refreshToken。可选：idToken、description、priority、groupId。`
    case 'claude':
      return `${baseTips} 必填字段：name 和 refreshToken（或 claudeAiOauth）。可选：email、priority、groupId、subscriptionInfo。`
    case 'gemini':
      if (geminiIntegration.value === 'third_party') {
        return `${baseTips} 必填字段：name、baseUrl、apiKey。可选：userAgent、supportedModels、priority、groupId。`
      }
      return `${baseTips} 必填字段：name 以及 accessToken 或 refreshToken。可选：projectId、supportedModels、priority、groupId。`
    default:
      return baseTips
  }
})

const sampleSnippet = computed(() => {
  switch (selectedPlatform.value) {
    case 'openai':
      return `name=OpenAI-Manual-01; accessToken=sk-xxxx; refreshToken=rt-xxxx; priority=40
name=OpenAI-Manual-02; accessToken=sk-yyyy`
    case 'claude':
      return `name=Claude-Refresh-01; refreshToken=rtm-xxx; priority=45
name=Claude-OAuth; claudeAiOauth={"accessToken":"at-xxx","refreshToken":"rt-xxx","scopes":["user:profile"]}`
    case 'gemini':
      if (geminiIntegration.value === 'third_party') {
        return `name=Gemini-EU; baseUrl=https://gemini-proxy.example.com/v1; apiKey=gm-xxxxx; userAgent=CustomRelay/1.0
name=Gemini-Backup; baseUrl=https://backup.example.com/v1; apiKey=gm-yyyy`
      }
      return `name=Gemini-OAuth-01; accessToken=ya29....; refreshToken=1//0g...; projectId=cloud-ai-project`
    default:
      return ''
  }
})

const resetState = () => {
  rawInput.value = ''
  parsingError.value = ''
  results.value = null
  loading.value = false
}

watch(
  () => props.show,
  (visible) => {
    if (!visible) {
      resetState()
    }
  }
)

const close = () => {
  emit('close')
}

const parseInput = () => {
  const text = rawInput.value.trim()
  if (!text) {
    return []
  }

  let payload
  try {
    if (text.startsWith('[')) {
      payload = JSON.parse(text)
    } else {
      const lines = text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line)
      payload = lines.map((line) => {
        try {
          if (line.startsWith('{')) {
            return JSON.parse(line)
          }
        } catch (error) {
          // fall through to key=value parsing
        }
        return parseKeyValueLine(line)
      })
    }
  } catch (error) {
    throw new Error('JSON 解析失败，请确认格式是否正确')
  }

  if (!Array.isArray(payload)) {
    payload = [payload]
  }

  return payload.map((item, idx) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`第 ${idx + 1} 条记录无效`)
    }
    if (!item.name || typeof item.name !== 'string') {
      throw new Error(`第 ${idx + 1} 条记录缺少 name 字段`)
    }
    if (selectedPlatform.value === 'gemini' && geminiIntegration.value === 'third_party') {
      if (!item.baseUrl) {
        throw new Error(`第 ${idx + 1} 条 Gemini 记录缺少 baseUrl`)
      }
      if (!item.apiKey) {
        throw new Error(`第 ${idx + 1} 条 Gemini 记录缺少 apiKey`)
      }
    }
    if (selectedPlatform.value === 'openai') {
      if (!item.accessToken && !item.refreshToken && !item.openaiOauth) {
        throw new Error(`第 ${idx + 1} 条 OpenAI 记录缺少令牌信息`)
      }
    }
    if (selectedPlatform.value === 'claude') {
      if (!item.refreshToken && !item.claudeAiOauth) {
        throw new Error(`第 ${idx + 1} 条 Claude 记录缺少 refreshToken 或 claudeAiOauth`)
      }
    }

    return item
  })
}

const handleImport = async () => {
  parsingError.value = ''
  results.value = null

  let entries
  try {
    entries = parseInput()
  } catch (error) {
    parsingError.value = error.message
    return
  }

  if (entries.length === 0) {
    parsingError.value = '请输入至少一条账户记录'
    return
  }

  const payload = entries.map((entry) => {
    const base = {
      platform: selectedPlatform.value,
      ...entry
    }
    if (selectedPlatform.value === 'gemini') {
      base.integrationType = geminiIntegration.value
    }
    return base
  })

  loading.value = true
  try {
    const response = await accountsStore.bulkImportAccounts(payload)
    results.value = response
    emit('imported', response)
    showToast('批量导入完成', response.summary.failed > 0 ? 'warning' : 'success')
    if (response.summary.failed === 0) {
      rawInput.value = ''
    }
  } catch (error) {
    const message = error.message || '批量导入失败'
    parsingError.value = message
    showToast(message, 'error')
  } finally {
    loading.value = false
  }
}

const parseKeyValueLine = (line) => {
  const record = {}

  const delimiter = line.includes(';') ? ';' : ','
  const segments = line
    .split(delimiter)
    .map((segment) => segment.trim())
    .filter((segment) => segment)

  segments.forEach((segment) => {
    const [rawKey, ...rest] = segment.split('=')
    if (!rawKey || rest.length === 0) {
      return
    }
    const key = rawKey.trim()
    const valueRaw = rest.join('=').trim()

    let value = valueRaw
    if (valueRaw === '') {
      value = ''
    } else if (valueRaw.toLowerCase() === 'true') {
      value = true
    } else if (valueRaw.toLowerCase() === 'false') {
      value = false
    } else if (!Number.isNaN(Number(valueRaw)) && valueRaw !== '') {
      value = Number(valueRaw)
    } else if (
      (valueRaw.startsWith('{') && valueRaw.endsWith('}')) ||
      (valueRaw.startsWith('[') && valueRaw.endsWith(']'))
    ) {
      try {
        value = JSON.parse(valueRaw)
      } catch (error) {
        value = valueRaw
      }
    }

    record[key] = value
  })

  if (!record.name) {
    throw new Error('缺少 name 字段')
  }

  return record
}
</script>
