<template>
  <div class="groups-container">
    <div class="card p-4 sm:p-6">
      <!-- Header Section -->
      <div class="mb-4 flex flex-col gap-4 sm:mb-6">
        <div>
          <h3 class="mb-1 text-lg font-bold text-gray-900 dark:text-gray-100 sm:mb-2 sm:text-xl">
            用户组管理
          </h3>
          <p class="text-sm text-gray-600 dark:text-gray-400 sm:text-base">
            管理用户组、成员分配、权限配置和账户调度策略
          </p>
        </div>

        <!-- Controls Section -->
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <!-- Filter and Search -->
          <div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
            <!-- Search Input -->
            <div class="relative min-w-[200px]">
              <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <i class="fas fa-search text-gray-400"></i>
              </div>
              <input
                v-model="searchTerm"
                class="w-full rounded-lg border border-gray-200 bg-white py-2 pl-10 pr-4 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:placeholder-gray-400"
                placeholder="搜索组名或描述..."
                type="text"
                @input="debouncedSearch"
              />
            </div>

            <!-- Parent Group Filter -->
            <div class="group relative min-w-[160px]">
              <div
                class="absolute -inset-0.5 rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 opacity-0 blur transition duration-300 group-hover:opacity-20"
              ></div>
              <select
                v-model="parentFilter"
                class="relative w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-gray-700 focus:border-purple-500 focus:ring-2 focus:ring-purple-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                @change="filterGroups"
              >
                <option value="all">所有组</option>
                <option value="root">顶级组</option>
                <option value="child">子组</option>
              </select>
            </div>

            <!-- Status Filter -->
            <div class="group relative min-w-[140px]">
              <div
                class="absolute -inset-0.5 rounded-lg bg-gradient-to-r from-green-500 to-teal-500 opacity-0 blur transition duration-300 group-hover:opacity-20"
              ></div>
              <select
                v-model="statusFilter"
                class="relative w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-gray-700 focus:border-green-500 focus:ring-2 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                @change="filterGroups"
              >
                <option value="all">所有状态</option>
                <option value="active">激活</option>
                <option value="inactive">禁用</option>
              </select>
            </div>

            <!-- Refresh Button -->
            <div class="relative">
              <button
                class="group relative flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-all duration-200 hover:border-gray-300 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-gray-500"
                :disabled="loading"
                @click="loadGroups"
              >
                <div
                  class="absolute -inset-0.5 rounded-lg bg-gradient-to-r from-indigo-500 to-blue-500 opacity-0 blur transition duration-300 group-hover:opacity-20"
                ></div>
                <i
                  :class="[
                    'fas relative text-indigo-500',
                    loading ? 'fa-spinner fa-spin' : 'fa-sync-alt'
                  ]"
                ></i>
                <span class="relative">刷新</span>
              </button>
            </div>
          </div>

          <!-- Create Group Button -->
          <button
            class="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-green-500 to-green-600 px-5 py-2.5 text-sm font-medium text-white shadow-md transition-all duration-200 hover:from-green-600 hover:to-green-700 hover:shadow-lg sm:w-auto"
            @click="openCreateModal"
          >
            <i class="fas fa-plus"></i>
            <span>创建组</span>
          </button>
        </div>
      </div>

      <!-- Groups Table -->
      <div
        class="overflow-hidden rounded-lg border border-gray-200 bg-white shadow dark:border-gray-600 dark:bg-gray-800"
      >
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-600">
            <thead class="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th
                  class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300"
                >
                  组信息
                </th>
                <th
                  class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300"
                >
                  层级关系
                </th>
                <th
                  class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300"
                >
                  成员统计
                </th>
                <th
                  class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300"
                >
                  账户配置
                </th>
                <th
                  class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300"
                >
                  调度策略
                </th>
                <th
                  class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300"
                >
                  状态
                </th>
                <th
                  class="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300"
                >
                  操作
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 bg-white dark:divide-gray-600 dark:bg-gray-800">
              <!-- Loading State -->
              <tr v-if="loading">
                <td class="px-6 py-12 text-center" colspan="7">
                  <div class="flex flex-col items-center gap-2">
                    <i class="fas fa-spinner fa-spin text-2xl text-gray-400"></i>
                    <span class="text-gray-500 dark:text-gray-400">加载中...</span>
                  </div>
                </td>
              </tr>
              <!-- Empty State -->
              <tr v-else-if="filteredGroups.length === 0">
                <td class="px-6 py-12 text-center" colspan="7">
                  <div class="flex flex-col items-center gap-2">
                    <i class="fas fa-users text-4xl text-gray-300 dark:text-gray-500"></i>
                    <span class="text-gray-500 dark:text-gray-400">暂无组数据</span>
                    <button
                      class="mt-2 text-sm text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                      @click="openCreateModal"
                    >
                      创建第一个组
                    </button>
                  </div>
                </td>
              </tr>
              <!-- Group Rows -->
              <tr
                v-for="group in filteredGroups"
                v-else
                :key="group.id"
                class="transition-colors hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                <!-- Group Info -->
                <td class="whitespace-nowrap px-6 py-4">
                  <div class="flex items-center">
                    <div class="h-10 w-10 flex-shrink-0">
                      <div
                        class="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-r from-indigo-500 to-purple-500"
                      >
                        <i class="fas fa-users text-sm text-white"></i>
                      </div>
                    </div>
                    <div class="ml-4">
                      <div class="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {{ group.name }}
                      </div>
                      <div
                        v-if="group.description"
                        class="text-sm text-gray-500 dark:text-gray-400"
                      >
                        {{ group.description }}
                      </div>
                      <div class="text-xs text-gray-400 dark:text-gray-500">
                        ID: {{ group.id.slice(0, 8) }}...
                      </div>
                    </div>
                  </div>
                </td>

                <!-- Hierarchy -->
                <td class="whitespace-nowrap px-6 py-4">
                  <div class="flex flex-col gap-1">
                    <div v-if="group.parentId" class="flex items-center gap-1 text-xs">
                      <i class="fas fa-arrow-up text-blue-500"></i>
                      <span class="text-gray-600 dark:text-gray-400"
                        >父组: {{ getParentGroupName(group.parentId) }}</span
                      >
                    </div>
                    <div v-if="group.childCount > 0" class="flex items-center gap-1 text-xs">
                      <i class="fas fa-arrow-down text-green-500"></i>
                      <span class="text-gray-600 dark:text-gray-400"
                        >{{ group.childCount }} 个子组</span
                      >
                    </div>
                    <span
                      v-if="!group.parentId && group.childCount === 0"
                      class="text-xs text-gray-400"
                    >
                      顶级组
                    </span>
                  </div>
                </td>

                <!-- Members -->
                <td class="whitespace-nowrap px-6 py-4">
                  <div class="flex items-center gap-2">
                    <i class="fas fa-user text-blue-500"></i>
                    <span class="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {{ group.memberCount || 0 }}
                    </span>
                    <span class="text-xs text-gray-500">成员</span>
                  </div>
                </td>

                <!-- Accounts -->
                <td class="whitespace-nowrap px-6 py-4">
                  <div class="flex flex-col gap-1">
                    <div class="flex items-center gap-2">
                      <i class="fas fa-server text-purple-500"></i>
                      <span class="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {{ group.accountCount || 0 }}
                      </span>
                      <span class="text-xs text-gray-500">账户</span>
                    </div>
                    <div class="flex gap-1">
                      <span
                        v-if="group.accounts?.claudeAccounts?.length"
                        class="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                      >
                        C:{{ group.accounts.claudeAccounts.length }}
                      </span>
                      <span
                        v-if="group.accounts?.geminiAccounts?.length"
                        class="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-300"
                      >
                        G:{{ group.accounts.geminiAccounts.length }}
                      </span>
                      <span
                        v-if="group.accounts?.openaiAccounts?.length"
                        class="rounded bg-orange-100 px-1.5 py-0.5 text-xs text-orange-700 dark:bg-orange-900/30 dark:text-orange-300"
                      >
                        O:{{ group.accounts.openaiAccounts.length }}
                      </span>
                    </div>
                  </div>
                </td>

                <!-- Scheduling Strategy -->
                <td class="whitespace-nowrap px-6 py-4">
                  <div class="flex items-center gap-2">
                    <i class="fas fa-cog text-indigo-500"></i>
                    <span class="text-sm text-gray-900 dark:text-gray-100">
                      {{ formatSchedulingStrategy(group.schedulingConfig?.strategy) }}
                    </span>
                  </div>
                </td>

                <!-- Status -->
                <td class="whitespace-nowrap px-6 py-4">
                  <span
                    :class="[
                      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                      group.isActive
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                        : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                    ]"
                  >
                    <i
                      :class="['fas mr-1', group.isActive ? 'fa-check-circle' : 'fa-times-circle']"
                    ></i>
                    {{ group.isActive ? '激活' : '禁用' }}
                  </span>
                </td>

                <!-- Actions -->
                <td class="whitespace-nowrap px-6 py-4 text-right text-sm font-medium">
                  <div class="flex items-center justify-end gap-2">
                    <!-- View Details -->
                    <button
                      class="text-indigo-600 transition-colors hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300"
                      title="查看详情"
                      @click="viewGroupDetails(group)"
                    >
                      <i class="fas fa-eye"></i>
                    </button>

                    <!-- Manage Members -->
                    <button
                      class="text-blue-600 transition-colors hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
                      title="管理成员"
                      @click="manageMembers(group)"
                    >
                      <i class="fas fa-users"></i>
                    </button>

                    <!-- Assign Accounts -->
                    <button
                      class="text-purple-600 transition-colors hover:text-purple-900 dark:text-purple-400 dark:hover:text-purple-300"
                      title="分配账户"
                      @click="assignAccounts(group)"
                    >
                      <i class="fas fa-server"></i>
                    </button>

                    <!-- Edit -->
                    <button
                      class="text-yellow-600 transition-colors hover:text-yellow-900 dark:text-yellow-400 dark:hover:text-yellow-300"
                      title="编辑"
                      @click="editGroup(group)"
                    >
                      <i class="fas fa-edit"></i>
                    </button>

                    <!-- Delete -->
                    <button
                      class="text-red-600 transition-colors hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                      :disabled="group.memberCount > 0 || group.childCount > 0"
                      title="删除"
                      @click="deleteGroup(group)"
                    >
                      <i class="fas fa-trash"></i>
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Pagination -->
        <div
          v-if="totalPages > 1"
          class="flex items-center justify-between border-t border-gray-200 bg-white px-4 py-3 dark:border-gray-600 dark:bg-gray-800 sm:px-6"
        >
          <div class="flex flex-1 justify-between sm:hidden">
            <button
              class="relative inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              :disabled="currentPage <= 1"
              @click="changePage(currentPage - 1)"
            >
              上一页
            </button>
            <button
              class="relative ml-3 inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              :disabled="currentPage >= totalPages"
              @click="changePage(currentPage + 1)"
            >
              下一页
            </button>
          </div>
          <div class="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
            <div>
              <p class="text-sm text-gray-700 dark:text-gray-300">
                显示 <span class="font-medium">{{ (currentPage - 1) * pageSize + 1 }}</span> 到
                <span class="font-medium">{{ Math.min(currentPage * pageSize, totalItems) }}</span>
                项， 共 <span class="font-medium">{{ totalItems }}</span> 项
              </p>
            </div>
            <div>
              <nav
                aria-label="Pagination"
                class="relative z-0 inline-flex -space-x-px rounded-md shadow-sm"
              >
                <button
                  class="relative inline-flex items-center rounded-l-md border border-gray-300 bg-white px-2 py-2 text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                  :disabled="currentPage <= 1"
                  @click="changePage(currentPage - 1)"
                >
                  <i class="fas fa-chevron-left"></i>
                </button>

                <button
                  v-for="page in visiblePages"
                  :key="page"
                  :class="[
                    'relative inline-flex items-center border px-4 py-2 text-sm font-medium transition-colors',
                    page === currentPage
                      ? 'z-10 border-indigo-500 bg-indigo-50 text-indigo-600 dark:border-indigo-400 dark:bg-indigo-900/30 dark:text-indigo-300'
                      : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                  ]"
                  @click="changePage(page)"
                >
                  {{ page }}
                </button>

                <button
                  class="relative inline-flex items-center rounded-r-md border border-gray-300 bg-white px-2 py-2 text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                  :disabled="currentPage >= totalPages"
                  @click="changePage(currentPage + 1)"
                >
                  <i class="fas fa-chevron-right"></i>
                </button>
              </nav>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Group Form Modal -->
    <GroupFormModal
      v-if="showGroupModal"
      :group="selectedGroup"
      :parent-groups="allGroups.filter((g) => g.id !== selectedGroup?.id)"
      :visible="showGroupModal"
      @close="closeGroupModal"
      @saved="handleGroupSaved"
    />

    <!-- Member Management Modal -->
    <MemberManagementModal
      v-if="showMemberModal"
      :group="selectedGroup"
      :visible="showMemberModal"
      @close="closeMemberModal"
      @updated="handleMembersUpdated"
    />

    <!-- Account Assignment Modal -->
    <AccountAssignmentModal
      v-if="showAccountModal"
      :group="selectedGroup"
      :visible="showAccountModal"
      @close="closeAccountModal"
      @updated="handleAccountsUpdated"
    />

    <!-- Group Details Modal -->
    <GroupDetailsModal
      v-if="showDetailsModal"
      :group="selectedGroup"
      :visible="showDetailsModal"
      @assign-accounts="assignAccountsFromDetails"
      @close="closeDetailsModal"
      @edit="editGroupFromDetails"
      @manage-members="manageMembersFromDetails"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'
import { apiClient } from '@/config/api'
import { debounce } from 'lodash-es'
import { ElMessage, ElMessageBox } from 'element-plus'

// Components
import GroupFormModal from '@/components/groups/GroupFormModal.vue'
import MemberManagementModal from '@/components/groups/MemberManagementModal.vue'
import AccountAssignmentModal from '@/components/groups/AccountAssignmentModal.vue'
import GroupDetailsModal from '@/components/groups/GroupDetailsModal.vue'

// Reactive state
const loading = ref(false)
const allGroups = ref([])
const searchTerm = ref('')
const parentFilter = ref('all')
const statusFilter = ref('all')

// Pagination
const currentPage = ref(1)
const pageSize = ref(20)
const totalItems = ref(0)

// Modals
const showGroupModal = ref(false)
const showMemberModal = ref(false)
const showAccountModal = ref(false)
const showDetailsModal = ref(false)
const selectedGroup = ref(null)

// Computed
const filteredGroups = computed(() => {
  let groups = [...allGroups.value]

  // Search filter
  if (searchTerm.value) {
    const term = searchTerm.value.toLowerCase()
    groups = groups.filter(
      (group) =>
        group.name.toLowerCase().includes(term) ||
        (group.description && group.description.toLowerCase().includes(term))
    )
  }

  // Parent filter
  if (parentFilter.value === 'root') {
    groups = groups.filter((group) => !group.parentId)
  } else if (parentFilter.value === 'child') {
    groups = groups.filter((group) => group.parentId)
  }

  // Status filter
  if (statusFilter.value === 'active') {
    groups = groups.filter((group) => group.isActive)
  } else if (statusFilter.value === 'inactive') {
    groups = groups.filter((group) => !group.isActive)
  }

  return groups
})

const totalPages = computed(() => Math.ceil(filteredGroups.value.length / pageSize.value))

const visiblePages = computed(() => {
  const total = totalPages.value
  const current = currentPage.value
  const delta = 2

  let range = []
  let rangeWithDots = []

  for (let i = Math.max(2, current - delta); i <= Math.min(total - 1, current + delta); i++) {
    range.push(i)
  }

  if (current - delta > 2) {
    rangeWithDots.push(1, '...')
  } else {
    rangeWithDots.push(1)
  }

  rangeWithDots.push(...range)

  if (current + delta < total - 1) {
    rangeWithDots.push('...', total)
  } else {
    rangeWithDots.push(total)
  }

  return rangeWithDots.filter((page) => typeof page === 'number')
})

// Methods
const loadGroups = async () => {
  loading.value = true
  try {
    const response = await apiClient.get('/admin/groups', {
      params: {
        page: currentPage.value,
        limit: pageSize.value,
        includeInactive: true
      }
    })

    if (response.success) {
      allGroups.value = response.data.groups
      totalItems.value = response.data.pagination.total
    } else {
      throw new Error(response.message || '获取组列表失败')
    }
  } catch (error) {
    console.error('Failed to load groups:', error)
    ElMessage.error(error.message || '获取组列表失败')
  } finally {
    loading.value = false
  }
}

const debouncedSearch = debounce(() => {
  currentPage.value = 1
}, 300)

const filterGroups = () => {
  currentPage.value = 1
}

const changePage = (page) => {
  if (page >= 1 && page <= totalPages.value) {
    currentPage.value = page
  }
}

const getParentGroupName = (parentId) => {
  const parent = allGroups.value.find((group) => group.id === parentId)
  return parent ? parent.name : 'Unknown'
}

const formatSchedulingStrategy = (strategy) => {
  const strategies = {
    round_robin: '轮询',
    random: '随机',
    weighted: '权重',
    priority: '优先级',
    least_recent: '最少使用'
  }
  return strategies[strategy] || strategy
}

// Modal handlers
const openCreateModal = () => {
  selectedGroup.value = null
  showGroupModal.value = true
}

const editGroup = (group) => {
  selectedGroup.value = { ...group }
  showGroupModal.value = true
}

const closeGroupModal = () => {
  showGroupModal.value = false
  selectedGroup.value = null
}

const handleGroupSaved = () => {
  closeGroupModal()
  loadGroups()
}

const viewGroupDetails = (group) => {
  selectedGroup.value = group
  showDetailsModal.value = true
}

const closeDetailsModal = () => {
  showDetailsModal.value = false
  selectedGroup.value = null
}

const editGroupFromDetails = (group) => {
  closeDetailsModal()
  nextTick(() => {
    editGroup(group)
  })
}

const manageMembers = (group) => {
  selectedGroup.value = group
  showMemberModal.value = true
}

const manageMembersFromDetails = (group) => {
  closeDetailsModal()
  nextTick(() => {
    manageMembers(group)
  })
}

const closeMemberModal = () => {
  showMemberModal.value = false
  selectedGroup.value = null
}

const handleMembersUpdated = () => {
  closeMemberModal()
  loadGroups()
}

const assignAccounts = (group) => {
  selectedGroup.value = group
  showAccountModal.value = true
}

const assignAccountsFromDetails = (group) => {
  closeDetailsModal()
  nextTick(() => {
    assignAccounts(group)
  })
}

const closeAccountModal = () => {
  showAccountModal.value = false
  selectedGroup.value = null
}

const handleAccountsUpdated = () => {
  closeAccountModal()
  loadGroups()
}

const deleteGroup = async (group) => {
  if (group.memberCount > 0) {
    ElMessage.warning('该组还有成员，无法删除')
    return
  }

  if (group.childCount > 0) {
    ElMessage.warning('该组还有子组，无法删除')
    return
  }

  try {
    await ElMessageBox.confirm(`确定要删除组 "${group.name}" 吗？此操作不可逆。`, '确认删除', {
      confirmButtonText: '确定删除',
      cancelButtonText: '取消',
      type: 'warning',
      confirmButtonClass: 'el-button--danger'
    })

    const response = await apiClient.delete(`/admin/groups/${group.id}`)

    if (response.success) {
      ElMessage.success('组删除成功')
      loadGroups()
    } else {
      throw new Error(response.message || '删除失败')
    }
  } catch (error) {
    if (error !== 'cancel') {
      console.error('Failed to delete group:', error)
      ElMessage.error(error.message || '删除组失败')
    }
  }
}

// Lifecycle
onMounted(() => {
  loadGroups()
})
</script>

<style scoped>
.groups-container {
  @apply space-y-6;
}

.card {
  @apply rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800;
}
</style>
