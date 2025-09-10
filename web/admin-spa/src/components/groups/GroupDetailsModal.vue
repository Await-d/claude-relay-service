<template>
  <div
    v-if="visible"
    class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overflow-x-hidden outline-none focus:outline-none"
    @click.self="$emit('close')"
  >
    <!-- Backdrop -->
    <div class="fixed inset-0 bg-black bg-opacity-50 transition-opacity"></div>

    <!-- Modal -->
    <div class="relative z-50 mx-auto my-6 w-full max-w-4xl p-4">
      <div
        class="relative flex w-full flex-col rounded-lg border-0 bg-white shadow-lg outline-none focus:outline-none dark:bg-gray-800"
      >
        <!-- Header -->
        <div
          class="flex items-start justify-between rounded-t border-b border-solid border-gray-200 p-5 dark:border-gray-600"
        >
          <div class="flex items-center gap-3">
            <div
              class="flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-r from-indigo-500 to-purple-500"
            >
              <i class="fas fa-users text-lg text-white"></i>
            </div>
            <div>
              <h3 class="text-xl font-semibold text-gray-900 dark:text-gray-100">
                {{ group?.name }}
              </h3>
              <p class="text-sm text-gray-500 dark:text-gray-400">组详情和配置信息</p>
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
          <div v-if="!group" class="p-8 text-center">
            <i class="fas fa-spinner fa-spin text-2xl text-gray-400"></i>
            <p class="mt-2 text-gray-500 dark:text-gray-400">加载中...</p>
          </div>

          <div v-else class="space-y-6">
            <!-- Basic Information -->
            <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div class="space-y-4">
                <h4
                  class="border-b border-gray-200 pb-2 text-lg font-medium text-gray-900 dark:border-gray-600 dark:text-gray-100"
                >
                  <i class="fas fa-info-circle mr-2 text-blue-500"></i>
                  基本信息
                </h4>

                <div class="space-y-3">
                  <div class="flex items-start justify-between">
                    <span class="text-sm font-medium text-gray-600 dark:text-gray-400">组ID:</span>
                    <span class="font-mono text-sm text-gray-900 dark:text-gray-100">{{
                      group.id
                    }}</span>
                  </div>

                  <div class="flex items-start justify-between">
                    <span class="text-sm font-medium text-gray-600 dark:text-gray-400"
                      >组名称:</span
                    >
                    <span class="text-sm text-gray-900 dark:text-gray-100">{{ group.name }}</span>
                  </div>

                  <div v-if="group.description" class="flex items-start justify-between">
                    <span class="text-sm font-medium text-gray-600 dark:text-gray-400">描述:</span>
                    <span class="max-w-60 text-right text-sm text-gray-900 dark:text-gray-100">{{
                      group.description
                    }}</span>
                  </div>

                  <div class="flex items-start justify-between">
                    <span class="text-sm font-medium text-gray-600 dark:text-gray-400">状态:</span>
                    <span
                      :class="[
                        'inline-flex items-center rounded-full px-2 py-1 text-xs font-medium',
                        group.isActive
                          ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                          : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                      ]"
                    >
                      <i
                        :class="[
                          'fas mr-1',
                          group.isActive ? 'fa-check-circle' : 'fa-times-circle'
                        ]"
                      ></i>
                      {{ group.isActive ? '激活' : '禁用' }}
                    </span>
                  </div>

                  <div class="flex items-start justify-between">
                    <span class="text-sm font-medium text-gray-600 dark:text-gray-400"
                      >创建时间:</span
                    >
                    <span class="text-sm text-gray-900 dark:text-gray-100">{{
                      formatDate(group.createdAt)
                    }}</span>
                  </div>

                  <div class="flex items-start justify-between">
                    <span class="text-sm font-medium text-gray-600 dark:text-gray-400"
                      >更新时间:</span
                    >
                    <span class="text-sm text-gray-900 dark:text-gray-100">{{
                      formatDate(group.updatedAt)
                    }}</span>
                  </div>
                </div>
              </div>

              <!-- Hierarchy Information -->
              <div class="space-y-4">
                <h4
                  class="border-b border-gray-200 pb-2 text-lg font-medium text-gray-900 dark:border-gray-600 dark:text-gray-100"
                >
                  <i class="fas fa-sitemap mr-2 text-green-500"></i>
                  层级关系
                </h4>

                <div class="space-y-3">
                  <div v-if="group.parentId" class="rounded-lg bg-blue-50 p-3 dark:bg-blue-900/20">
                    <div class="mb-2 flex items-center gap-2">
                      <i class="fas fa-arrow-up text-blue-500"></i>
                      <span class="text-sm font-medium text-blue-900 dark:text-blue-100">父组</span>
                    </div>
                    <div class="text-sm text-blue-700 dark:text-blue-300">
                      {{ group.parentGroup?.name || '未知父组' }}
                    </div>
                  </div>

                  <div
                    v-if="group.childGroups && group.childGroups.length > 0"
                    class="rounded-lg bg-green-50 p-3 dark:bg-green-900/20"
                  >
                    <div class="mb-2 flex items-center gap-2">
                      <i class="fas fa-arrow-down text-green-500"></i>
                      <span class="text-sm font-medium text-green-900 dark:text-green-100"
                        >子组 ({{ group.childGroups.length }})</span
                      >
                    </div>
                    <div class="space-y-1">
                      <div
                        v-for="child in group.childGroups"
                        :key="child.id"
                        class="text-sm text-green-700 dark:text-green-300"
                      >
                        {{ child.name }}
                      </div>
                    </div>
                  </div>

                  <div
                    v-if="!group.parentId && (!group.childGroups || group.childGroups.length === 0)"
                    class="rounded-lg bg-gray-50 p-3 text-center dark:bg-gray-700"
                  >
                    <i class="fas fa-layer-group mb-2 text-lg text-gray-400"></i>
                    <div class="text-sm text-gray-500 dark:text-gray-400">独立组</div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Statistics -->
            <div class="grid grid-cols-1 gap-6 md:grid-cols-3">
              <!-- Members -->
              <div
                class="rounded-lg bg-gradient-to-r from-blue-50 to-indigo-50 p-4 dark:from-blue-900/20 dark:to-indigo-900/20"
              >
                <div class="flex items-center gap-3">
                  <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500">
                    <i class="fas fa-users text-white"></i>
                  </div>
                  <div>
                    <div class="text-2xl font-bold text-blue-900 dark:text-blue-100">
                      {{ group.memberCount || group.members?.length || 0 }}
                    </div>
                    <div class="text-sm text-blue-600 dark:text-blue-300">成员</div>
                  </div>
                </div>
              </div>

              <!-- Accounts -->
              <div
                class="rounded-lg bg-gradient-to-r from-purple-50 to-pink-50 p-4 dark:from-purple-900/20 dark:to-pink-900/20"
              >
                <div class="flex items-center gap-3">
                  <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500">
                    <i class="fas fa-server text-white"></i>
                  </div>
                  <div>
                    <div class="text-2xl font-bold text-purple-900 dark:text-purple-100">
                      {{ group.accountCount || getTotalAccounts() }}
                    </div>
                    <div class="text-sm text-purple-600 dark:text-purple-300">账户</div>
                  </div>
                </div>
              </div>

              <!-- Strategy -->
              <div
                class="rounded-lg bg-gradient-to-r from-green-50 to-teal-50 p-4 dark:from-green-900/20 dark:to-teal-900/20"
              >
                <div class="flex items-center gap-3">
                  <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500">
                    <i class="fas fa-cogs text-white"></i>
                  </div>
                  <div>
                    <div class="text-sm font-medium text-green-900 dark:text-green-100">
                      {{ formatSchedulingStrategy(group.schedulingConfig?.strategy) }}
                    </div>
                    <div class="text-sm text-green-600 dark:text-green-300">调度策略</div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Permissions -->
            <div class="space-y-4">
              <h4
                class="border-b border-gray-200 pb-2 text-lg font-medium text-gray-900 dark:border-gray-600 dark:text-gray-100"
              >
                <i class="fas fa-shield-alt mr-2 text-green-500"></i>
                权限配置
              </h4>

              <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                <div class="rounded-lg bg-gray-50 p-3 dark:bg-gray-700">
                  <h5 class="mb-2 font-medium text-gray-900 dark:text-gray-100">聊天权限</h5>
                  <div class="space-y-1 text-sm">
                    <div class="flex items-center gap-2">
                      <i
                        :class="[
                          'fas',
                          group.permissions?.['chat.create']
                            ? 'fa-check text-green-500'
                            : 'fa-times text-red-500'
                        ]"
                      ></i>
                      <span class="text-gray-700 dark:text-gray-300">创建聊天</span>
                    </div>
                    <div class="flex items-center gap-2">
                      <i
                        :class="[
                          'fas',
                          group.permissions?.['chat.history']
                            ? 'fa-check text-green-500'
                            : 'fa-times text-red-500'
                        ]"
                      ></i>
                      <span class="text-gray-700 dark:text-gray-300">查看历史</span>
                    </div>
                  </div>
                </div>

                <div class="rounded-lg bg-gray-50 p-3 dark:bg-gray-700">
                  <h5 class="mb-2 font-medium text-gray-900 dark:text-gray-100">模型权限</h5>
                  <div class="space-y-1 text-sm">
                    <div class="flex items-center gap-2">
                      <i
                        :class="[
                          'fas',
                          group.permissions?.['models.list']
                            ? 'fa-check text-green-500'
                            : 'fa-times text-red-500'
                        ]"
                      ></i>
                      <span class="text-gray-700 dark:text-gray-300">列出模型</span>
                    </div>
                  </div>
                </div>

                <div class="rounded-lg bg-gray-50 p-3 dark:bg-gray-700">
                  <h5 class="mb-2 font-medium text-gray-900 dark:text-gray-100">使用统计</h5>
                  <div class="space-y-1 text-sm">
                    <div class="flex items-center gap-2">
                      <i
                        :class="[
                          'fas',
                          group.permissions?.['usage.view']
                            ? 'fa-check text-green-500'
                            : 'fa-times text-red-500'
                        ]"
                      ></i>
                      <span class="text-gray-700 dark:text-gray-300">查看使用量</span>
                    </div>
                  </div>
                </div>

                <div class="rounded-lg bg-gray-50 p-3 dark:bg-gray-700">
                  <h5 class="mb-2 font-medium text-gray-900 dark:text-gray-100">管理权限</h5>
                  <div class="space-y-1 text-sm">
                    <div class="flex items-center gap-2">
                      <i
                        :class="[
                          'fas',
                          group.permissions?.['admin.read']
                            ? 'fa-check text-green-500'
                            : 'fa-times text-red-500'
                        ]"
                      ></i>
                      <span class="text-gray-700 dark:text-gray-300">只读管理</span>
                    </div>
                    <div class="flex items-center gap-2">
                      <i
                        :class="[
                          'fas',
                          group.permissions?.['admin.write']
                            ? 'fa-check text-green-500'
                            : 'fa-times text-red-500'
                        ]"
                      ></i>
                      <span class="text-gray-700 dark:text-gray-300">管理写入</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Account Distribution -->
            <div
              v-if="
                group.accounts &&
                (group.accounts.claudeAccounts?.length ||
                  group.accounts.geminiAccounts?.length ||
                  group.accounts.openaiAccounts?.length)
              "
              class="space-y-4"
            >
              <h4
                class="border-b border-gray-200 pb-2 text-lg font-medium text-gray-900 dark:border-gray-600 dark:text-gray-100"
              >
                <i class="fas fa-server mr-2 text-purple-500"></i>
                账户分配
              </h4>

              <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
                <!-- Claude Accounts -->
                <div
                  v-if="group.accounts.claudeAccounts?.length"
                  class="rounded-lg bg-blue-50 p-4 dark:bg-blue-900/20"
                >
                  <div class="mb-3 flex items-center gap-2">
                    <i class="fas fa-robot text-blue-500"></i>
                    <span class="font-medium text-blue-900 dark:text-blue-100"
                      >Claude ({{ group.accounts.claudeAccounts.length }})</span
                    >
                  </div>
                  <div class="space-y-1 text-sm">
                    <div
                      v-for="accountId in group.accounts.claudeAccounts.slice(0, 3)"
                      :key="accountId"
                      class="font-mono text-blue-700 dark:text-blue-300"
                    >
                      {{ accountId.slice(0, 8) }}...
                    </div>
                    <div
                      v-if="group.accounts.claudeAccounts.length > 3"
                      class="text-blue-600 dark:text-blue-400"
                    >
                      还有 {{ group.accounts.claudeAccounts.length - 3 }} 个...
                    </div>
                  </div>
                </div>

                <!-- Gemini Accounts -->
                <div
                  v-if="group.accounts.geminiAccounts?.length"
                  class="rounded-lg bg-green-50 p-4 dark:bg-green-900/20"
                >
                  <div class="mb-3 flex items-center gap-2">
                    <i class="fas fa-gem text-green-500"></i>
                    <span class="font-medium text-green-900 dark:text-green-100"
                      >Gemini ({{ group.accounts.geminiAccounts.length }})</span
                    >
                  </div>
                  <div class="space-y-1 text-sm">
                    <div
                      v-for="accountId in group.accounts.geminiAccounts.slice(0, 3)"
                      :key="accountId"
                      class="font-mono text-green-700 dark:text-green-300"
                    >
                      {{ accountId.slice(0, 8) }}...
                    </div>
                    <div
                      v-if="group.accounts.geminiAccounts.length > 3"
                      class="text-green-600 dark:text-green-400"
                    >
                      还有 {{ group.accounts.geminiAccounts.length - 3 }} 个...
                    </div>
                  </div>
                </div>

                <!-- OpenAI Accounts -->
                <div
                  v-if="group.accounts.openaiAccounts?.length"
                  class="rounded-lg bg-orange-50 p-4 dark:bg-orange-900/20"
                >
                  <div class="mb-3 flex items-center gap-2">
                    <i class="fas fa-brain text-orange-500"></i>
                    <span class="font-medium text-orange-900 dark:text-orange-100"
                      >OpenAI ({{ group.accounts.openaiAccounts.length }})</span
                    >
                  </div>
                  <div class="space-y-1 text-sm">
                    <div
                      v-for="accountId in group.accounts.openaiAccounts.slice(0, 3)"
                      :key="accountId"
                      class="font-mono text-orange-700 dark:text-orange-300"
                    >
                      {{ accountId.slice(0, 8) }}...
                    </div>
                    <div
                      v-if="group.accounts.openaiAccounts.length > 3"
                      class="text-orange-600 dark:text-orange-400"
                    >
                      还有 {{ group.accounts.openaiAccounts.length - 3 }} 个...
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Scheduling Configuration -->
            <div class="space-y-4">
              <h4
                class="border-b border-gray-200 pb-2 text-lg font-medium text-gray-900 dark:border-gray-600 dark:text-gray-100"
              >
                <i class="fas fa-cogs mr-2 text-indigo-500"></i>
                调度配置
              </h4>

              <div class="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div class="space-y-3">
                  <div class="flex items-center justify-between">
                    <span class="text-sm font-medium text-gray-600 dark:text-gray-400">策略:</span>
                    <span class="text-sm text-gray-900 dark:text-gray-100">
                      {{ formatSchedulingStrategy(group.schedulingConfig?.strategy) }}
                    </span>
                  </div>

                  <div class="flex items-center justify-between">
                    <span class="text-sm font-medium text-gray-600 dark:text-gray-400"
                      >回退到全局:</span
                    >
                    <span
                      :class="[
                        'inline-flex items-center rounded px-2 py-1 text-xs font-medium',
                        group.schedulingConfig?.fallbackToGlobal !== false
                          ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                          : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                      ]"
                    >
                      {{ group.schedulingConfig?.fallbackToGlobal !== false ? '启用' : '禁用' }}
                    </span>
                  </div>

                  <div class="flex items-center justify-between">
                    <span class="text-sm font-medium text-gray-600 dark:text-gray-400"
                      >健康检查:</span
                    >
                    <span
                      :class="[
                        'inline-flex items-center rounded px-2 py-1 text-xs font-medium',
                        group.schedulingConfig?.healthCheckEnabled !== false
                          ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                          : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                      ]"
                    >
                      {{ group.schedulingConfig?.healthCheckEnabled !== false ? '启用' : '禁用' }}
                    </span>
                  </div>
                </div>

                <div
                  v-if="
                    group.schedulingConfig?.weights &&
                    Object.keys(group.schedulingConfig.weights).length
                  "
                  class="space-y-2"
                >
                  <span class="text-sm font-medium text-gray-600 dark:text-gray-400"
                    >权重配置:</span
                  >
                  <div class="max-h-32 space-y-1 overflow-y-auto">
                    <div
                      v-for="(weight, accountId) in group.schedulingConfig.weights"
                      :key="accountId"
                      class="flex items-center justify-between rounded bg-gray-100 p-2 text-xs dark:bg-gray-600"
                    >
                      <span class="font-mono text-gray-600 dark:text-gray-400"
                        >{{ accountId.slice(0, 8) }}...</span
                      >
                      <span class="font-medium">{{ weight }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div
          class="flex items-center justify-between rounded-b border-t border-solid border-gray-200 p-6 dark:border-gray-600"
        >
          <div class="flex gap-3">
            <button
              class="flex items-center gap-2 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-600"
              @click="$emit('edit', group)"
            >
              <i class="fas fa-edit"></i>
              编辑组
            </button>

            <button
              class="flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600"
              @click="$emit('manage-members', group)"
            >
              <i class="fas fa-users"></i>
              管理成员
            </button>

            <button
              class="flex items-center gap-2 rounded-lg bg-purple-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-600"
              @click="$emit('assign-accounts', group)"
            >
              <i class="fas fa-server"></i>
              分配账户
            </button>
          </div>

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
import { computed } from 'vue'

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

const _emit = defineEmits(['close', 'edit', 'manage-members', 'assign-accounts'])

// Methods
const formatDate = (dateString) => {
  if (!dateString) return 'N/A'
  return new Date(dateString).toLocaleString('zh-CN')
}

const formatSchedulingStrategy = (strategy) => {
  const strategies = {
    round_robin: '轮询',
    random: '随机',
    weighted: '权重',
    priority: '优先级',
    least_recent: '最少使用'
  }
  return strategies[strategy] || strategy || '未配置'
}

const getTotalAccounts = () => {
  if (!props.group?.accounts) return 0
  return (
    (props.group.accounts.claudeAccounts?.length || 0) +
    (props.group.accounts.geminiAccounts?.length || 0) +
    (props.group.accounts.openaiAccounts?.length || 0)
  )
}
</script>

<style scoped>
/* Custom scrollbar for weights list */
.max-h-32::-webkit-scrollbar {
  width: 4px;
}

.max-h-32::-webkit-scrollbar-track {
  @apply rounded bg-gray-100 dark:bg-gray-600;
}

.max-h-32::-webkit-scrollbar-thumb {
  @apply rounded bg-gray-300 dark:bg-gray-500;
}

.max-h-32::-webkit-scrollbar-thumb:hover {
  @apply bg-gray-400 dark:bg-gray-400;
}
</style>
