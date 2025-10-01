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

        <div class="grid gap-6 lg:grid-cols-[260px_1fr]">
          <div class="space-y-4 rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/70">
            <div>
              <h4 class="mb-2 text-sm font-semibold text-gray-800 dark:text-gray-200">简易批量格式</h4>
              <ul class="space-y-1 text-xs leading-5 text-gray-600 dark:text-gray-400">
                <li>每行一条记录，使用空格分隔；首个单词为平台（openai / claude / gemini）。</li>
                <li>OpenAI：<code class="rounded bg-gray-200 px-1 text-[11px] dark:bg-gray-700">openai 名称 accessToken</code>，可追加 <code>refresh=</code>、<code>priority=</code> 等键值。</li>
                <li>Claude：<code class="rounded bg-gray-200 px-1 text-[11px] dark:bg-gray-700">claude 名称 refreshToken</code>。</li>
                <li>Gemini 第三方：<code class="rounded bg-gray-200 px-1 text-[11px] dark:bg-gray-700">gemini 名称 baseUrl apiKey</code>。</li>
                <li>Gemini OAuth：<code class="rounded bg-gray-200 px-1 text-[11px] dark:bg-gray-700">gemini 名称 accessToken refreshToken</code>，可追加 <code>projectId=</code> 等。</li>
                <li>可选字段以 <code>key=value</code> 形式继续追加；以 <code>#</code> 开头的行会被忽略。</li>
              </ul>
            </div>

            <div>
              <h4 class="mb-2 text-sm font-semibold text-gray-800 dark:text-gray-200">示例</h4>
              <pre
                class="custom-scrollbar max-h-56 overflow-auto rounded-xl bg-gray-900/90 p-3 text-xs text-emerald-200"
              ><code>{{ sampleSnippet }}</code></pre>
            </div>
          </div>

          <div class="flex flex-col gap-4">
            <div>
              <label class="mb-2 block text-sm font-semibold text-gray-800 dark:text-gray-200">
                粘贴批量数据
              </label>
              <textarea
                v-model="rawInput"
                class="custom-scrollbar form-input h-64 w-full font-mono text-xs dark:bg-gray-800 dark:text-gray-100"
                placeholder="例如：openai my-openai sk-xxxxxx refresh=rt-xxxx"
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

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close', 'imported'])

const accountsStore = useAccountsStore()

const rawInput = ref('')
const parsingError = ref('')
const loading = ref(false)
const results = ref(null)
const sampleSnippet = computed(
  () => `# OpenAI 示例
openai my-openai sk-xxxxxxxx refresh=rt-xxxxxxxx priority=40

# Claude 示例
claude claude-01 rtm-xxxxxxxx email=me@example.com

# Gemini 第三方
gemini gemini-eu https://proxy.example.com/v1 gm-xxxxxxxx

# Gemini OAuth
gemini gemini-oauth ya29-xxxxxxxx 1//0g-xxxxxxxx projectId=cloud-ai-project`
)

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

const normalizeValue = (value) => {
  if (value === undefined) {
    return ''
  }
  const trimmed = value.trim()
  if (trimmed === '') {
    return ''
  }
  const lower = trimmed.toLowerCase()
  if (lower === 'true') {
    return true
  }
  if (lower === 'false') {
    return false
  }
  if (!Number.isNaN(Number(trimmed)) && trimmed.length > 0 && /^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed)
  }
  return trimmed
}

const allowedPlatforms = ['openai', 'claude', 'gemini']

const parseSimpleLine = (line, lineNumber) => {
  const parts = line.split(/\s+/).filter(Boolean)
  if (parts.length < 3) {
    throw new Error(`第 ${lineNumber} 行格式不正确，至少需要平台、名称和凭证`)
  }

  const platform = parts[0].toLowerCase()
  if (!allowedPlatforms.includes(platform)) {
    throw new Error(`第 ${lineNumber} 行的平台 "${parts[0]}" 暂不支持`)
  }

  const name = parts[1]

  const positional = []
  const keyValues = []
  parts.slice(2).forEach((token) => {
    if (token.includes('=')) {
      keyValues.push(token)
    } else {
      positional.push(token)
    }
  })

  const extra = {}
  keyValues.forEach((token) => {
    const [rawKey, rawValue = ''] = token.split('=', 2)
    if (!rawKey) {
      return
    }
    const key = rawKey.trim()
    extra[key] = normalizeValue(rawValue)
  })

  const takeExtraValue = (...keys) => {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(extra, key)) {
        const value = extra[key]
        delete extra[key]
        return value
      }
    }
    return undefined
  }

  const peekExtraValue = (...keys) => {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(extra, key)) {
        return extra[key]
      }
    }
    return undefined
  }

  const record = { platform, name }

  if (platform === 'openai') {
    const remaining = [...positional]

    const accessToken =
      remaining.shift() || takeExtraValue('accessToken', 'access_token', 'token')
    const refreshToken =
      remaining.shift() || takeExtraValue('refreshToken', 'refresh_token', 'refresh', 'rt')

    if (!accessToken) {
      throw new Error(`第 ${lineNumber} 行缺少 OpenAI accessToken`)
    }
    record.accessToken = accessToken
    if (refreshToken) {
      record.refreshToken = refreshToken
    }

    if (remaining.length > 0) {
      throw new Error(`第 ${lineNumber} 行的 OpenAI 多余字段：${remaining.join(' ')}`)
    }
  } else if (platform === 'claude') {
    const remaining = [...positional]
    const refreshToken =
      remaining.shift() || takeExtraValue('refreshToken', 'refresh_token', 'refresh', 'rt')
    if (!refreshToken) {
      throw new Error(`第 ${lineNumber} 行缺少 Claude refreshToken`)
    }
    record.refreshToken = refreshToken

    if (remaining.length > 0) {
      throw new Error(`第 ${lineNumber} 行的 Claude 多余字段：${remaining.join(' ')}`)
    }
  } else if (platform === 'gemini') {
    const looksLikeUrl = (value) => typeof value === 'string' && /^https?:/i.test(value)

    const extraBaseCandidate = peekExtraValue('baseUrl', 'base_url', 'endpoint', 'url')
    const treatAsThirdParty = looksLikeUrl(positional[0]) || !!extraBaseCandidate

    if (treatAsThirdParty) {
      const remaining = [...positional]

      const baseUrl = looksLikeUrl(remaining[0])
        ? remaining.shift()
        : takeExtraValue('baseUrl', 'base_url', 'endpoint', 'url')
      const apiKey = remaining.shift() || takeExtraValue('apiKey', 'api_key', 'key', 'token')

      if (!baseUrl) {
        throw new Error(`第 ${lineNumber} 行缺少 Gemini baseUrl`)
      }
      if (!apiKey) {
        throw new Error(`第 ${lineNumber} 行缺少 Gemini apiKey`)
      }

      record.integrationType = 'third_party'
      record.baseUrl = baseUrl
      record.apiKey = apiKey

      if (remaining.length > 0) {
        throw new Error(`第 ${lineNumber} 行的 Gemini 第三方多余字段：${remaining.join(' ')}`)
      }
    } else {
      const remaining = [...positional]

      const accessToken =
        remaining.shift() || takeExtraValue('accessToken', 'access_token', 'token')
      const refreshToken =
        remaining.shift() || takeExtraValue('refreshToken', 'refresh_token', 'refresh', 'rt')

      if (!accessToken || !refreshToken) {
        throw new Error(`第 ${lineNumber} 行缺少 Gemini accessToken 或 refreshToken`)
      }

      record.integrationType = 'oauth'
      record.accessToken = accessToken
      record.refreshToken = refreshToken

      if (remaining.length > 0) {
        if (remaining.length === 1) {
          record.projectId = remaining.shift()
        } else {
          throw new Error(`第 ${lineNumber} 行的 Gemini OAuth 多余字段：${remaining.join(' ')}`)
        }
      }
    }
  }

  const groupId = takeExtraValue('groupId', 'group', 'group_id')
  if (groupId !== undefined) {
    record.groupId = groupId
  }

  const projectFromExtra = takeExtraValue('projectId', 'project', 'project_id')
  if (projectFromExtra !== undefined && record.projectId === undefined) {
    record.projectId = projectFromExtra
  }

  const priority = takeExtraValue('priority')
  if (priority !== undefined) {
    record.priority = priority
  }

  const schedulable = takeExtraValue('schedulable')
  if (schedulable !== undefined) {
    record.schedulable = schedulable
  }

  Object.entries(extra).forEach(([key, value]) => {
    record[key] = value
  })

  return record
}

const parseInput = () => {
  const raw = rawInput.value
  if (!raw.trim()) {
    return []
  }

  const lines = raw
    .split('\n')
    .map((text, index) => ({ lineNumber: index + 1, text: text.trim() }))
    .filter(({ text }) => text && !text.startsWith('#'))

  return lines.map(({ text, lineNumber }) => parseSimpleLine(text, lineNumber))
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

  loading.value = true
  try {
    const response = await accountsStore.bulkImportAccounts(entries)
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
</script>
