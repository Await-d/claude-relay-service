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
              class="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-r from-blue-500 to-indigo-500"
            >
              <i class="fas fa-users text-white"></i>
            </div>
            <div>
              <h3 class="text-xl font-semibold text-gray-900 dark:text-gray-100">成员管理</h3>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                管理组 "{{ group?.name }}" 的成员
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
          <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <!-- Available Users -->
            <div class="space-y-4">
              <div class="flex items-center justify-between">
                <h4 class="text-lg font-medium text-gray-900 dark:text-gray-100">
                  <i class="fas fa-user-plus mr-2 text-green-500"></i>
                  可添加用户
                </h4>
                <button
                  class="text-sm text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                  :disabled="loadingUsers"
                  @click="loadAvailableUsers"
                >
                  <i :class="['fas mr-1', loadingUsers ? 'fa-spinner fa-spin' : 'fa-sync-alt']"></i>
                  刷新
                </button>
              </div>

              <!-- Search -->
              <div class="relative">
                <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <i class="fas fa-search text-gray-400"></i>
                </div>
                <input
                  v-model="searchTerm"
                  class="w-full rounded-lg border border-gray-200 bg-white py-2 pl-10 pr-4 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
                  placeholder="搜索用户..."
                  type="text"
                />
              </div>

              <!-- Available Users List -->
              <div
                class="max-h-80 overflow-y-auto rounded-lg border border-gray-200 bg-white dark:border-gray-600 dark:bg-gray-700"
              >
                <div v-if="loadingUsers" class="p-8 text-center">
                  <i class="fas fa-spinner fa-spin text-2xl text-gray-400"></i>
                  <p class="mt-2 text-gray-500 dark:text-gray-400">加载中...</p>
                </div>

                <div v-else-if="filteredAvailableUsers.length === 0" class="p-8 text-center">
                  <i class="fas fa-user-slash text-3xl text-gray-300 dark:text-gray-500"></i>
                  <p class="mt-2 text-gray-500 dark:text-gray-400">没有可添加的用户</p>
                </div>

                <div v-else class="divide-y divide-gray-200 dark:divide-gray-600">
                  <div
                    v-for="user in filteredAvailableUsers"
                    :key="user.id"
                    class="flex items-center justify-between p-4 transition-colors hover:bg-gray-50 dark:hover:bg-gray-600"
                  >
                    <div class="flex items-center gap-3">
                      <div
                        class="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-r from-blue-400 to-indigo-400 text-sm text-white"
                      >
                        {{ user.username?.charAt(0).toUpperCase() }}
                      </div>
                      <div>
                        <div class="font-medium text-gray-900 dark:text-gray-100">
                          {{ user.username }}
                        </div>
                        <div class="text-sm text-gray-500 dark:text-gray-400">
                          {{ user.fullName || user.email || 'No additional info' }}
                        </div>
                        <div class="mt-1 flex items-center gap-2">
                          <span
                            :class="[
                              'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium',
                              user.status === 'active'
                                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                                : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                            ]"
                          >
                            {{ user.status === 'active' ? '活跃' : '非活跃' }}
                          </span>
                          <span
                            class="inline-flex items-center rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
                          >
                            {{ user.role || '用户' }}
                          </span>
                        </div>
                      </div>
                    </div>
                    <button
                      class="flex items-center gap-1 rounded-md bg-green-500 px-3 py-1.5 text-sm text-white transition-colors hover:bg-green-600 disabled:cursor-not-allowed disabled:opacity-50"
                      :disabled="addingUser === user.id"
                      @click="addUserToGroup(user)"
                    >
                      <i
                        :class="['fas', addingUser === user.id ? 'fa-spinner fa-spin' : 'fa-plus']"
                      ></i>
                      添加
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Current Members -->
            <div class="space-y-4">
              <div class="flex items-center justify-between">
                <h4 class="text-lg font-medium text-gray-900 dark:text-gray-100">
                  <i class="fas fa-users mr-2 text-blue-500"></i>
                  当前成员 ({{ groupMembers.length }})
                </h4>
                <button
                  class="text-sm text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                  :disabled="loadingMembers"
                  @click="loadGroupMembers"
                >
                  <i
                    :class="['fas mr-1', loadingMembers ? 'fa-spinner fa-spin' : 'fa-sync-alt']"
                  ></i>
                  刷新
                </button>
              </div>

              <!-- Current Members List -->
              <div
                class="max-h-80 overflow-y-auto rounded-lg border border-gray-200 bg-white dark:border-gray-600 dark:bg-gray-700"
              >
                <div v-if="loadingMembers" class="p-8 text-center">
                  <i class="fas fa-spinner fa-spin text-2xl text-gray-400"></i>
                  <p class="mt-2 text-gray-500 dark:text-gray-400">加载中...</p>
                </div>

                <div v-else-if="groupMembers.length === 0" class="p-8 text-center">
                  <i class="fas fa-user-friends text-3xl text-gray-300 dark:text-gray-500"></i>
                  <p class="mt-2 text-gray-500 dark:text-gray-400">暂无成员</p>
                </div>

                <div v-else class="divide-y divide-gray-200 dark:divide-gray-600">
                  <div
                    v-for="member in groupMembers"
                    :key="member.id"
                    class="flex items-center justify-between p-4 transition-colors hover:bg-gray-50 dark:hover:bg-gray-600"
                  >
                    <div class="flex items-center gap-3">
                      <div
                        class="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-r from-indigo-400 to-purple-400 text-sm text-white"
                      >
                        {{ member.username?.charAt(0).toUpperCase() }}
                      </div>
                      <div>
                        <div class="font-medium text-gray-900 dark:text-gray-100">
                          {{ member.username }}
                        </div>
                        <div class="text-sm text-gray-500 dark:text-gray-400">
                          {{ member.fullName || member.email || 'No additional info' }}
                        </div>
                        <div class="mt-1 flex items-center gap-2">
                          <span
                            :class="[
                              'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium',
                              member.status === 'active'
                                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                                : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                            ]"
                          >
                            {{ member.status === 'active' ? '活跃' : '非活跃' }}
                          </span>
                          <span
                            class="inline-flex items-center rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
                          >
                            {{ member.role || '用户' }}
                          </span>
                          <span
                            v-if="member.authMethod"
                            class="inline-flex items-center rounded bg-purple-100 px-1.5 py-0.5 text-xs font-medium text-purple-800 dark:bg-purple-900/30 dark:text-purple-300"
                          >
                            {{ member.authMethod.toUpperCase() }}
                          </span>
                        </div>
                      </div>
                    </div>
                    <button
                      class="flex items-center gap-1 rounded-md bg-red-500 px-3 py-1.5 text-sm text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                      :disabled="removingUser === member.id"
                      @click="removeUserFromGroup(member)"
                    >
                      <i
                        :class="[
                          'fas',
                          removingUser === member.id ? 'fa-spinner fa-spin' : 'fa-minus'
                        ]"
                      ></i>
                      移除
                    </button>
                  </div>
                </div>
              </div>

              <!-- Bulk Actions -->
              <div v-if="groupMembers.length > 0" class="flex gap-2 pt-2">
                <button
                  class="flex items-center gap-1 rounded-md bg-red-500 px-3 py-2 text-sm text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                  :disabled="removingAll"
                  @click="confirmRemoveAllMembers"
                >
                  <i :class="['fas', removingAll ? 'fa-spinner fa-spin' : 'fa-users-slash']"></i>
                  移除所有成员
                </button>
              </div>
            </div>
          </div>

          <!-- Summary -->
          <div class="mt-6 rounded-lg bg-blue-50 p-4 dark:bg-blue-900/20">
            <div class="mb-2 flex items-center gap-2">
              <i class="fas fa-info-circle text-blue-500"></i>
              <span class="font-medium text-blue-900 dark:text-blue-100">成员统计</span>
            </div>
            <div class="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
              <div>
                <span class="text-blue-600 dark:text-blue-300">当前成员：</span>
                <span class="font-medium text-blue-900 dark:text-blue-100">{{
                  groupMembers.length
                }}</span>
              </div>
              <div>
                <span class="text-blue-600 dark:text-blue-300">活跃成员：</span>
                <span class="font-medium text-blue-900 dark:text-blue-100">{{
                  activeMembers
                }}</span>
              </div>
              <div>
                <span class="text-blue-600 dark:text-blue-300">可添加：</span>
                <span class="font-medium text-blue-900 dark:text-blue-100">{{
                  availableUsers.length
                }}</span>
              </div>
              <div>
                <span class="text-blue-600 dark:text-blue-300">最后更新：</span>
                <span class="font-medium text-blue-900 dark:text-blue-100">{{ lastUpdated }}</span>
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
import { ref, computed, watch, onMounted } from 'vue'
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

// Reactive state
const loadingUsers = ref(false)
const loadingMembers = ref(false)
const addingUser = ref(null)
const removingUser = ref(null)
const removingAll = ref(false)
const searchTerm = ref('')
const availableUsers = ref([])
const groupMembers = ref([])

// Computed
const filteredAvailableUsers = computed(() => {
  if (!searchTerm.value) {
    return availableUsers.value
  }
  const term = searchTerm.value.toLowerCase()
  return availableUsers.value.filter(
    (user) =>
      user.username.toLowerCase().includes(term) ||
      (user.fullName && user.fullName.toLowerCase().includes(term)) ||
      (user.email && user.email.toLowerCase().includes(term))
  )
})

const activeMembers = computed(() => {
  return groupMembers.value.filter((member) => member.status === 'active').length
})

const lastUpdated = computed(() => {
  return new Date().toLocaleTimeString('zh-CN')
})

// Methods
const loadAvailableUsers = async () => {
  if (!props.group) return

  loadingUsers.value = true
  try {
    // Get all users
    const usersResponse = await apiClient.get('/admin/users')
    if (!usersResponse.success) {
      throw new Error(usersResponse.message || '获取用户列表失败')
    }

    // Get current group members
    const membersResponse = await apiClient.get(`/admin/groups/${props.group.id}/members`)
    if (!membersResponse.success) {
      throw new Error(membersResponse.message || '获取组成员失败')
    }

    const allUsers = usersResponse.data.users || usersResponse.data || []
    const currentMemberIds = new Set(membersResponse.data.members?.map((m) => m.id) || [])

    // Filter out users who are already members
    availableUsers.value = allUsers.filter((user) => !currentMemberIds.has(user.id))
  } catch (error) {
    console.error('Failed to load available users:', error)
    ElMessage.error(error.message || '加载可添加用户失败')
    availableUsers.value = []
  } finally {
    loadingUsers.value = false
  }
}

const loadGroupMembers = async () => {
  if (!props.group) return

  loadingMembers.value = true
  try {
    const response = await apiClient.get(`/admin/groups/${props.group.id}/members`)
    if (response.success) {
      groupMembers.value = response.data.members || []
    } else {
      throw new Error(response.message || '获取组成员失败')
    }
  } catch (error) {
    console.error('Failed to load group members:', error)
    ElMessage.error(error.message || '加载组成员失败')
    groupMembers.value = []
  } finally {
    loadingMembers.value = false
  }
}

const addUserToGroup = async (user) => {
  addingUser.value = user.id
  try {
    const response = await apiClient.post(`/admin/groups/${props.group.id}/members`, {
      userId: user.id
    })

    if (response.success) {
      ElMessage.success(`用户 ${user.username} 已添加到组`)
      // Move user from available to members
      availableUsers.value = availableUsers.value.filter((u) => u.id !== user.id)
      groupMembers.value.push(user)
      emit('updated')
    } else {
      throw new Error(response.message || '添加用户失败')
    }
  } catch (error) {
    console.error('Failed to add user to group:', error)
    ElMessage.error(error.message || '添加用户到组失败')
  } finally {
    addingUser.value = null
  }
}

const removeUserFromGroup = async (member) => {
  removingUser.value = member.id
  try {
    const response = await apiClient.delete(`/admin/groups/${props.group.id}/members/${member.id}`)

    if (response.success) {
      ElMessage.success(`用户 ${member.username} 已从组中移除`)
      // Move user from members to available
      groupMembers.value = groupMembers.value.filter((m) => m.id !== member.id)
      availableUsers.value.push(member)
      emit('updated')
    } else {
      throw new Error(response.message || '移除用户失败')
    }
  } catch (error) {
    console.error('Failed to remove user from group:', error)
    ElMessage.error(error.message || '从组中移除用户失败')
  } finally {
    removingUser.value = null
  }
}

const confirmRemoveAllMembers = async () => {
  try {
    await ElMessageBox.confirm(
      `确定要移除组 "${props.group.name}" 中的所有 ${groupMembers.value.length} 个成员吗？`,
      '确认移除所有成员',
      {
        confirmButtonText: '确定移除',
        cancelButtonText: '取消',
        type: 'warning',
        confirmButtonClass: 'el-button--danger'
      }
    )

    await removeAllMembers()
  } catch (error) {
    if (error !== 'cancel') {
      console.error('Failed to confirm remove all members:', error)
    }
  }
}

const removeAllMembers = async () => {
  removingAll.value = true
  try {
    const response = await apiClient.delete(`/admin/groups/${props.group.id}/members`)

    if (response.success) {
      ElMessage.success('所有成员已从组中移除')
      // Move all members back to available
      availableUsers.value.push(...groupMembers.value)
      groupMembers.value = []
      emit('updated')
    } else {
      throw new Error(response.message || '移除所有成员失败')
    }
  } catch (error) {
    console.error('Failed to remove all members:', error)
    ElMessage.error(error.message || '移除所有成员失败')
  } finally {
    removingAll.value = false
  }
}

// Watch for prop changes
watch(
  () => props.visible,
  (newVal) => {
    if (newVal && props.group) {
      loadGroupMembers()
      loadAvailableUsers()
    }
  },
  { immediate: true }
)

// Reset search when modal opens
watch(
  () => props.visible,
  (newVal) => {
    if (newVal) {
      searchTerm.value = ''
    }
  }
)
</script>

<style scoped>
/* Custom scrollbar for member lists */
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
