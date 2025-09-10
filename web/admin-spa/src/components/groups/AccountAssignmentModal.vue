<template>
  <div
    v-if="visible"
    class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overflow-x-hidden outline-none focus:outline-none"
    @click.self="$emit('close')"
  >
    <!-- Backdrop -->
    <div class="fixed inset-0 bg-black bg-opacity-50 transition-opacity"></div>

    <!-- Modal -->
    <div class="relative z-50 mx-auto my-6 w-full max-w-6xl p-4">
      <div
        class="relative flex w-full flex-col rounded-lg border-0 bg-white shadow-lg outline-none focus:outline-none dark:bg-gray-800"
      >
        <!-- Header -->
        <div
          class="flex items-start justify-between rounded-t border-b border-solid border-gray-200 p-5 dark:border-gray-600"
        >
          <div class="flex items-center gap-3">
            <div
              class="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-r from-purple-500 to-pink-500"
            >
              <i class="fas fa-server text-white"></i>
            </div>
            <div>
              <h3 class="text-xl font-semibold text-gray-900 dark:text-gray-100">账户分配管理</h3>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                管理组 "{{ group?.name }}" 的AI账户分配和调度配置
              </p>
            </div>
          </div>
          <button
            class="float-right ml-auto border-0 bg-transparent p-1 text-3xl font-semibold leading-none text-gray-400 hover:text-gray-600 focus:outline-none dark:text-gray-500 dark:hover:text-gray-300"
            @click="$emit('close')"
          >
            <i class="fas fa-times"></i>
          </button>
        </div>

        <!-- Body -->
        <div class="relative flex-auto p-6">
          <!-- Platform Tabs -->
          <div class="mb-6">
            <div class="border-b border-gray-200 dark:border-gray-600">
              <nav class="-mb-px flex space-x-8">
                <button
                  v-for="platform in platforms"
                  :key="platform.key"
                  :class="[
                    'border-b-2 px-1 py-2 text-sm font-medium transition-colors',
                    activePlatform === platform.key
                      ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                      : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                  ]"
                  @click="activePlatform = platform.key"
                >
                  <i :class="[platform.icon, 'mr-2']"></i>
                  {{ platform.name }}
                  <span
                    v-if="getAssignedCount(platform.key) > 0"
                    class="ml-2 inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300"
                  >
                    {{ getAssignedCount(platform.key) }}
                  </span>
                </button>
              </nav>
            </div>
          </div>

          <!-- Platform Content -->
          <div class="space-y-6">
            <!-- Account Assignment Section -->
            <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <!-- Available Accounts -->
              <div class="space-y-4">
                <div class="flex items-center justify-between">
                  <h4 class="text-lg font-medium text-gray-900 dark:text-gray-100">
                    <i class="fas fa-server mr-2 text-green-500"></i>
                    可分配账户 ({{ activePlatform.toUpperCase() }})
                  </h4>
                  <button
                    class="text-sm text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                    :disabled="loadingAccounts"
                    @click="loadAvailableAccounts"
                  >
                    <i
                      :class="['fas mr-1', loadingAccounts ? 'fa-spinner fa-spin' : 'fa-sync-alt']"
                    ></i>
                    刷新
                  </button>
                </div>

                <!-- Account Search -->
                <div class="relative">
                  <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <i class="fas fa-search text-gray-400"></i>
                  </div>
                  <input
                    v-model="accountSearchTerm"
                    class="w-full rounded-lg border border-gray-200 bg-white py-2 pl-10 pr-4 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
                    placeholder="搜索账户..."
                    type="text"
                  />
                </div>

                <!-- Available Accounts List -->
                <div
                  class="max-h-80 overflow-y-auto rounded-lg border border-gray-200 bg-white dark:border-gray-600 dark:bg-gray-700"
                >
                  <div v-if="loadingAccounts" class="p-8 text-center">
                    <i class="fas fa-spinner fa-spin text-2xl text-gray-400"></i>
                    <p class="mt-2 text-gray-500 dark:text-gray-400">加载中...</p>
                  </div>

                  <div v-else-if="filteredAvailableAccounts.length === 0" class="p-8 text-center">
                    <i class="fas fa-server text-3xl text-gray-300 dark:text-gray-500"></i>
                    <p class="mt-2 text-gray-500 dark:text-gray-400">没有可分配的账户</p>
                  </div>

                  <div v-else class="divide-y divide-gray-200 dark:divide-gray-600">
                    <div
                      v-for="account in filteredAvailableAccounts"
                      :key="account.id"
                      class="flex items-center justify-between p-4 transition-colors hover:bg-gray-50 dark:hover:bg-gray-600"
                    >
                      <div class="flex items-center gap-3">
                        <div
                          :class="[
                            'flex h-8 w-8 items-center justify-center rounded-full text-sm text-white',
                            getPlatformColor(activePlatform)
                          ]"
                        >
                          <i :class="getPlatformIcon(activePlatform)"></i>
                        </div>
                        <div>
                          <div class="font-medium text-gray-900 dark:text-gray-100">
                            {{ account.name || account.username || account.id }}
                          </div>
                          <div class="text-sm text-gray-500 dark:text-gray-400">
                            {{ account.description || account.email || 'No description' }}
                          </div>
                          <div class="mt-1 flex items-center gap-2">
                            <span
                              :class="[
                                'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium',
                                account.isActive || account.status === 'active'
                                  ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                                  : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                              ]"
                            >
                              {{
                                account.isActive || account.status === 'active' ? '活跃' : '禁用'
                              }}
                            </span>
                            <span
                              v-if="account.accountType"
                              class="inline-flex items-center rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
                            >
                              {{ account.accountType }}
                            </span>
                          </div>
                        </div>
                      </div>
                      <button
                        class="flex items-center gap-1 rounded-md bg-purple-500 px-3 py-1.5 text-sm text-white transition-colors hover:bg-purple-600 disabled:cursor-not-allowed disabled:opacity-50"
                        :disabled="assigningAccount === account.id"
                        @click="assignAccount(account)"
                      >
                        <i
                          :class="[
                            'fas',
                            assigningAccount === account.id ? 'fa-spinner fa-spin' : 'fa-plus'
                          ]"
                        ></i>
                        分配
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Assigned Accounts -->
              <div class="space-y-4">
                <div class="flex items-center justify-between">
                  <h4 class="text-lg font-medium text-gray-900 dark:text-gray-100">
                    <i class="fas fa-link mr-2 text-purple-500"></i>
                    已分配账户 ({{ getAssignedCount(activePlatform) }})
                  </h4>
                  <button
                    class="text-sm text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                    :disabled="loadingAssigned"
                    @click="loadAssignedAccounts"
                  >
                    <i
                      :class="['fas mr-1', loadingAssigned ? 'fa-spinner fa-spin' : 'fa-sync-alt']"
                    ></i>
                    刷新
                  </button>
                </div>

                <!-- Assigned Accounts List -->
                <div
                  class="max-h-80 overflow-y-auto rounded-lg border border-gray-200 bg-white dark:border-gray-600 dark:bg-gray-700"
                >
                  <div v-if="loadingAssigned" class="p-8 text-center">
                    <i class="fas fa-spinner fa-spin text-2xl text-gray-400"></i>
                    <p class="mt-2 text-gray-500 dark:text-gray-400">加载中...</p>
                  </div>

                  <div v-else-if="currentAssignedAccounts.length === 0" class="p-8 text-center">
                    <i class="fas fa-unlink text-3xl text-gray-300 dark:text-gray-500"></i>
                    <p class="mt-2 text-gray-500 dark:text-gray-400">暂无分配的账户</p>
                  </div>

                  <div v-else class="divide-y divide-gray-200 dark:divide-gray-600">
                    <div
                      v-for="account in currentAssignedAccounts"
                      :key="account.id"
                      class="flex items-center justify-between p-4 transition-colors hover:bg-gray-50 dark:hover:bg-gray-600"
                    >
                      <div class="flex items-center gap-3">
                        <div
                          :class="[
                            'flex h-8 w-8 items-center justify-center rounded-full text-sm text-white',
                            getPlatformColor(activePlatform)
                          ]"
                        >
                          <i :class="getPlatformIcon(activePlatform)"></i>
                        </div>
                        <div>
                          <div class="font-medium text-gray-900 dark:text-gray-100">
                            {{ account.name || account.username || account.id }}
                          </div>
                          <div class="text-sm text-gray-500 dark:text-gray-400">
                            {{ account.description || account.email || 'No description' }}
                          </div>
                          <div class="mt-1 flex items-center gap-2">
                            <span
                              :class="[
                                'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium',
                                account.isActive || account.status === 'active'
                                  ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                                  : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                              ]"
                            >
                              {{
                                account.isActive || account.status === 'active' ? '活跃' : '禁用'
                              }}
                            </span>
                            <span
                              v-if="account.weight !== undefined"
                              class="inline-flex items-center rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-medium text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300"
                            >
                              权重: {{ account.weight }}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div class="flex items-center gap-2">
                        <!-- Weight adjustment -->
                        <div class="flex items-center gap-1">
                          <span class="text-xs text-gray-500">权重:</span>
                          <input
                            v-model.number="weightInputs[account.id]"
                            class="w-16 rounded border border-gray-300 px-2 py-1 text-xs focus:ring-1 focus:ring-indigo-500 dark:border-gray-500 dark:bg-gray-600 dark:text-gray-200"
                            max="1"
                            min="0"
                            step="0.1"
                            type="number"
                            @change="updateAccountWeight(account)"
                          />
                        </div>
                        <button
                          class="flex items-center gap-1 rounded-md bg-red-500 px-3 py-1.5 text-sm text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                          :disabled="unassigningAccount === account.id"
                          @click="unassignAccount(account)"
                        >
                          <i
                            :class="[
                              'fas',
                              unassigningAccount === account.id ? 'fa-spinner fa-spin' : 'fa-minus'
                            ]"
                          ></i>
                          移除
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Bulk Actions -->
                <div v-if="currentAssignedAccounts.length > 0" class="flex gap-2 pt-2">
                  <button
                    class="flex items-center gap-1 rounded-md bg-red-500 px-3 py-2 text-sm text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                    :disabled="unassigningAll"
                    @click="confirmUnassignAll"
                  >
                    <i :class="['fas', unassigningAll ? 'fa-spinner fa-spin' : 'fa-unlink']"></i>
                    移除所有账户
                  </button>
                </div>
              </div>
            </div>

            <!-- Scheduling Configuration -->
            <div class="mt-8 rounded-lg bg-gray-50 p-6 dark:bg-gray-700">
              <div class="mb-4 flex items-center gap-2">
                <i class="fas fa-cogs text-indigo-500"></i>
                <h4 class="text-lg font-medium text-gray-900 dark:text-gray-100">调度配置</h4>
              </div>

              <div class="grid grid-cols-1 gap-6 md:grid-cols-2">
                <!-- Strategy -->
                <div>
                  <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    调度策略
                  </label>
                  <select
                    v-model="schedulingConfig.strategy"
                    class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-gray-500 dark:bg-gray-600 dark:text-gray-200"
                    @change="updateSchedulingConfig"
                  >
                    <option value="round_robin">轮询 (Round Robin)</option>
                    <option value="random">随机 (Random)</option>
                    <option value="weighted">权重 (Weighted)</option>
                    <option value="priority">优先级 (Priority)</option>
                    <option value="least_recent">最少使用 (Least Recent)</option>
                  </select>
                </div>

                <!-- Options -->
                <div class="space-y-3">
                  <label class="flex items-center gap-3">
                    <input
                      v-model="schedulingConfig.fallbackToGlobal"
                      class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      type="checkbox"
                      @change="updateSchedulingConfig"
                    />
                    <span class="text-sm font-medium text-gray-700 dark:text-gray-300"
                      >回退到全局账户</span
                    >
                  </label>

                  <label class="flex items-center gap-3">
                    <input
                      v-model="schedulingConfig.healthCheckEnabled"
                      class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      type="checkbox"
                      @change="updateSchedulingConfig"
                    />
                    <span class="text-sm font-medium text-gray-700 dark:text-gray-300"
                      >启用健康检查</span
                    >
                  </label>
                </div>
              </div>
            </div>

            <!-- Summary -->
            <div class="rounded-lg bg-purple-50 p-4 dark:bg-purple-900/20">
              <div class="mb-2 flex items-center gap-2">
                <i class="fas fa-chart-bar text-purple-500"></i>
                <span class="font-medium text-purple-900 dark:text-purple-100">账户分配统计</span>
              </div>
              <div class="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                <div>
                  <span class="text-purple-600 dark:text-purple-300">Claude:</span>
                  <span class="font-medium text-purple-900 dark:text-purple-100">{{
                    getAssignedCount('claude')
                  }}</span>
                </div>
                <div>
                  <span class="text-purple-600 dark:text-purple-300">Gemini:</span>
                  <span class="font-medium text-purple-900 dark:text-purple-100">{{
                    getAssignedCount('gemini')
                  }}</span>
                </div>
                <div>
                  <span class="text-purple-600 dark:text-purple-300">OpenAI:</span>
                  <span class="font-medium text-purple-900 dark:text-purple-100">{{
                    getAssignedCount('openai')
                  }}</span>
                </div>
                <div>
                  <span class="text-purple-600 dark:text-purple-300">总计:</span>
                  <span class="font-medium text-purple-900 dark:text-purple-100">{{
                    totalAssigned
                  }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div
          class="flex items-center justify-end rounded-b border-t border-solid border-gray-200 p-6 dark:border-gray-600"
        >
          <button
            class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            type="button"
            @click="$emit('close')"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { apiClient } from '@/config/api'
import { ElMessage, ElMessageBox } from 'element-plus'

const props = defineProps({
  visible: {
    type: Boolean,
    required: true
  },
  group: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['close', 'updated'])

// Platform configuration
const platforms = [
  { key: 'claude', name: 'Claude', icon: 'fas fa-robot' },
  { key: 'gemini', name: 'Gemini', icon: 'fas fa-gem' },
  { key: 'openai', name: 'OpenAI', icon: 'fas fa-brain' }
]

// Reactive state
const activePlatform = ref('claude')
const loadingAccounts = ref(false)
const loadingAssigned = ref(false)
const assigningAccount = ref(null)
const unassigningAccount = ref(null)
const unassigningAll = ref(false)
const accountSearchTerm = ref('')

const availableAccounts = ref({
  claude: [],
  gemini: [],
  openai: []
})

const assignedAccounts = ref({
  claude: [],
  gemini: [],
  openai: []
})

const weightInputs = ref({})

const schedulingConfig = ref({
  strategy: 'round_robin',
  fallbackToGlobal: true,
  healthCheckEnabled: true,
  weights: {}
})

// Computed
const filteredAvailableAccounts = computed(() => {
  const accounts = availableAccounts.value[activePlatform.value] || []
  if (!accountSearchTerm.value) {
    return accounts
  }
  const term = accountSearchTerm.value.toLowerCase()
  return accounts.filter(
    (account) =>
      (account.name && account.name.toLowerCase().includes(term)) ||
      (account.username && account.username.toLowerCase().includes(term)) ||
      (account.description && account.description.toLowerCase().includes(term))
  )
})

const currentAssignedAccounts = computed(() => {
  return assignedAccounts.value[activePlatform.value] || []
})

const totalAssigned = computed(() => {
  return Object.values(assignedAccounts.value).reduce(
    (total, accounts) => total + accounts.length,
    0
  )
})

// Methods
const getAssignedCount = (platform) => {
  return (assignedAccounts.value[platform] || []).length
}

const getPlatformColor = (platform) => {
  const colors = {
    claude: 'bg-gradient-to-r from-blue-500 to-indigo-500',
    gemini: 'bg-gradient-to-r from-green-500 to-teal-500',
    openai: 'bg-gradient-to-r from-orange-500 to-red-500'
  }
  return colors[platform] || 'bg-gray-500'
}

const getPlatformIcon = (platform) => {
  const icons = {
    claude: 'fas fa-robot',
    gemini: 'fas fa-gem',
    openai: 'fas fa-brain'
  }
  return icons[platform] || 'fas fa-server'
}

const loadAvailableAccounts = async () => {
  if (!props.group) return

  loadingAccounts.value = true
  try {
    const endpoint = {
      claude: '/admin/claude-accounts',
      gemini: '/admin/gemini-accounts',
      openai: '/admin/openai-accounts'
    }[activePlatform.value]

    const response = await apiClient.get(endpoint, {
      params: { groupId: 'ungrouped' }
    })

    if (response.success) {
      availableAccounts.value[activePlatform.value] = response.data || []
    } else {
      throw new Error(response.message || '获取账户列表失败')
    }
  } catch (error) {
    console.error('Failed to load available accounts:', error)
    ElMessage.error(error.message || '加载可用账户失败')
    availableAccounts.value[activePlatform.value] = []
  } finally {
    loadingAccounts.value = false
  }
}

const loadAssignedAccounts = async () => {
  if (!props.group) return

  loadingAssigned.value = true
  try {
    const response = await apiClient.get(`/admin/groups/${props.group.id}/accounts`)

    if (response.success) {
      const accounts = response.data
      assignedAccounts.value = {
        claude: accounts.claudeAccounts || [],
        gemini: accounts.geminiAccounts || [],
        openai: accounts.openaiAccounts || []
      }

      // Initialize weight inputs
      Object.values(assignedAccounts.value)
        .flat()
        .forEach((account) => {
          weightInputs.value[account.id] = account.weight || 0.5
        })
    } else {
      throw new Error(response.message || '获取已分配账户失败')
    }
  } catch (error) {
    console.error('Failed to load assigned accounts:', error)
    ElMessage.error(error.message || '加载已分配账户失败')
  } finally {
    loadingAssigned.value = false
  }
}

const loadSchedulingConfig = async () => {
  if (!props.group) return

  try {
    const response = await apiClient.get(`/admin/groups/${props.group.id}`)

    if (response.success && response.data.schedulingConfig) {
      schedulingConfig.value = {
        strategy: response.data.schedulingConfig.strategy || 'round_robin',
        fallbackToGlobal: response.data.schedulingConfig.fallbackToGlobal !== false,
        healthCheckEnabled: response.data.schedulingConfig.healthCheckEnabled !== false,
        weights: response.data.schedulingConfig.weights || {}
      }
    }
  } catch (error) {
    console.error('Failed to load scheduling config:', error)
  }
}

const assignAccount = async (account) => {
  assigningAccount.value = account.id
  try {
    const accounts = {}
    accounts[`${activePlatform.value}Accounts`] = [account.id]

    const response = await apiClient.post(`/admin/groups/${props.group.id}/accounts`, { accounts })

    if (response.success) {
      ElMessage.success(`账户 ${account.name || account.id} 已分配到组`)
      // Move account from available to assigned
      availableAccounts.value[activePlatform.value] = availableAccounts.value[
        activePlatform.value
      ].filter((a) => a.id !== account.id)
      assignedAccounts.value[activePlatform.value].push(account)
      weightInputs.value[account.id] = 0.5
      emit('updated')
    } else {
      throw new Error(response.message || '分配账户失败')
    }
  } catch (error) {
    console.error('Failed to assign account:', error)
    ElMessage.error(error.message || '分配账户失败')
  } finally {
    assigningAccount.value = null
  }
}

const unassignAccount = async (account) => {
  unassigningAccount.value = account.id
  try {
    const accounts = {}
    accounts[`${activePlatform.value}Accounts`] = [account.id]

    const response = await apiClient.delete(`/admin/groups/${props.group.id}/accounts`, {
      data: { accounts }
    })

    if (response.success) {
      ElMessage.success(`账户 ${account.name || account.id} 已从组中移除`)
      // Move account from assigned to available
      assignedAccounts.value[activePlatform.value] = assignedAccounts.value[
        activePlatform.value
      ].filter((a) => a.id !== account.id)
      availableAccounts.value[activePlatform.value].push(account)
      delete weightInputs.value[account.id]
      emit('updated')
    } else {
      throw new Error(response.message || '移除账户失败')
    }
  } catch (error) {
    console.error('Failed to unassign account:', error)
    ElMessage.error(error.message || '移除账户失败')
  } finally {
    unassigningAccount.value = null
  }
}

const updateAccountWeight = async (account) => {
  try {
    const weight = weightInputs.value[account.id]
    if (weight < 0 || weight > 1) {
      ElMessage.warning('权重值必须在0-1之间')
      weightInputs.value[account.id] = account.weight || 0.5
      return
    }

    const weights = { ...schedulingConfig.value.weights }
    weights[account.id] = weight

    const response = await apiClient.put(`/admin/groups/${props.group.id}/scheduling`, {
      weights
    })

    if (response.success) {
      schedulingConfig.value.weights = weights
      account.weight = weight
      ElMessage.success('权重更新成功')
    } else {
      throw new Error(response.message || '更新权重失败')
    }
  } catch (error) {
    console.error('Failed to update account weight:', error)
    ElMessage.error(error.message || '更新权重失败')
    weightInputs.value[account.id] = account.weight || 0.5
  }
}

const updateSchedulingConfig = async () => {
  try {
    const response = await apiClient.put(
      `/admin/groups/${props.group.id}/scheduling`,
      schedulingConfig.value
    )

    if (response.success) {
      ElMessage.success('调度配置更新成功')
    } else {
      throw new Error(response.message || '更新调度配置失败')
    }
  } catch (error) {
    console.error('Failed to update scheduling config:', error)
    ElMessage.error(error.message || '更新调度配置失败')
  }
}

const confirmUnassignAll = async () => {
  try {
    await ElMessageBox.confirm(
      `确定要移除组中所有 ${currentAssignedAccounts.value.length} 个 ${activePlatform.value.toUpperCase()} 账户吗？`,
      '确认移除所有账户',
      {
        confirmButtonText: '确定移除',
        cancelButtonText: '取消',
        type: 'warning',
        confirmButtonClass: 'el-button--danger'
      }
    )

    await unassignAllAccounts()
  } catch (error) {
    if (error !== 'cancel') {
      console.error('Failed to confirm unassign all:', error)
    }
  }
}

const unassignAllAccounts = async () => {
  unassigningAll.value = true
  try {
    const accountIds = currentAssignedAccounts.value.map((a) => a.id)
    const accounts = {}
    accounts[`${activePlatform.value}Accounts`] = accountIds

    const response = await apiClient.delete(`/admin/groups/${props.group.id}/accounts`, {
      data: { accounts }
    })

    if (response.success) {
      ElMessage.success(`所有 ${activePlatform.value.toUpperCase()} 账户已从组中移除`)
      // Move all accounts back to available
      availableAccounts.value[activePlatform.value].push(
        ...assignedAccounts.value[activePlatform.value]
      )
      assignedAccounts.value[activePlatform.value] = []

      // Clear weight inputs
      accountIds.forEach((id) => delete weightInputs.value[id])

      emit('updated')
    } else {
      throw new Error(response.message || '移除所有账户失败')
    }
  } catch (error) {
    console.error('Failed to unassign all accounts:', error)
    ElMessage.error(error.message || '移除所有账户失败')
  } finally {
    unassigningAll.value = false
  }
}

// Watch for prop changes
watch(
  () => props.visible,
  (newVal) => {
    if (newVal && props.group) {
      loadAssignedAccounts()
      loadAvailableAccounts()
      loadSchedulingConfig()
    }
  },
  { immediate: true }
)

// Watch for platform change
watch(activePlatform, () => {
  if (props.visible) {
    loadAvailableAccounts()
  }
  accountSearchTerm.value = ''
})
</script>

<style scoped>
/* Custom scrollbar */
.max-h-80::-webkit-scrollbar {
  width: 6px;
}

.max-h-80::-webkit-scrollbar-track {
  @apply rounded bg-gray-100 dark:bg-gray-600;
}

.max-h-80::-webkit-scrollbar-thumb {
  @apply rounded bg-gray-300 dark:bg-gray-500;
}

.max-h-80::-webkit-scrollbar-thumb:hover {
  @apply bg-gray-400 dark:bg-gray-400;
}
</style>
