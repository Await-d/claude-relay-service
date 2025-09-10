<template>
  <div class="space-y-6">
    <!-- 页面标题 -->
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100 sm:text-3xl">
        <i class="fas fa-users mr-2 text-purple-500" />
        用户组管理
      </h1>
      <button class="btn btn-primary flex items-center gap-2" @click="showCreateModal = true">
        <i class="fas fa-plus text-sm" />
        <span>创建用户组</span>
      </button>
    </div>

    <!-- 搜索和筛选 -->
    <div class="glass-strong rounded-xl p-4">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <!-- 搜索框 -->
        <div class="flex-1">
          <div class="relative">
            <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              v-model="searchQuery"
              class="form-input w-full pl-10"
              placeholder="搜索用户组名称或描述..."
              type="text"
            />
          </div>
        </div>

        <!-- 状态筛选 -->
        <div class="flex items-center gap-2">
          <label class="text-sm font-medium text-gray-700 dark:text-gray-300">状态:</label>
          <select v-model="statusFilter" class="form-select">
            <option value="">全部状态</option>
            <option value="active">活跃</option>
            <option value="inactive">不活跃</option>
          </select>
        </div>
      </div>
    </div>

    <!-- 用户组列表 -->
    <div class="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      <!-- 加载状态 -->
      <div v-if="loading" class="col-span-full">
        <div class="glass-strong rounded-xl p-8 text-center">
          <div class="loading-spinner mx-auto mb-4" />
          <p class="text-gray-500 dark:text-gray-400">加载用户组数据中...</p>
        </div>
      </div>

      <!-- 用户组卡片 -->
      <div
        v-for="group in filteredGroups"
        v-else-if="filteredGroups.length > 0"
        :key="group.id"
        class="glass-strong rounded-xl p-6 transition-all duration-300 hover:shadow-xl"
      >
        <!-- 用户组头部 -->
        <div class="mb-4 flex items-start justify-between">
          <div class="flex items-center gap-3">
            <div
              class="flex h-12 w-12 items-center justify-center rounded-xl"
              :class="
                group.status === 'active'
                  ? 'bg-gradient-to-br from-purple-500 to-blue-500'
                  : 'bg-gradient-to-br from-gray-400 to-gray-500'
              "
            >
              <i class="fas fa-users text-white" />
            </div>
            <div>
              <h3 class="font-bold text-gray-900 dark:text-gray-100">
                {{ group.name }}
              </h3>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                {{ group.memberCount || 0 }} 成员
              </p>
            </div>
          </div>

          <!-- 状态标识 -->
          <span
            class="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold"
            :class="
              group.status === 'active'
                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                : 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400'
            "
          >
            <i :class="group.status === 'active' ? 'fas fa-check-circle' : 'fas fa-pause-circle'" />
            {{ group.status === 'active' ? '活跃' : '不活跃' }}
          </span>
        </div>

        <!-- 用户组描述 -->
        <p class="mb-4 line-clamp-2 text-sm text-gray-600 dark:text-gray-400">
          {{ group.description || '暂无描述' }}
        </p>

        <!-- 权限列表 -->
        <div v-if="group.permissions && group.permissions.length > 0" class="mb-4">
          <p class="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">权限:</p>
          <div class="flex flex-wrap gap-1">
            <span
              v-for="permission in group.permissions.slice(0, 3)"
              :key="permission"
              class="inline-block rounded bg-blue-100 px-2 py-1 text-xs text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
            >
              {{ permission }}
            </span>
            <span
              v-if="group.permissions.length > 3"
              class="inline-block rounded bg-gray-100 px-2 py-1 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-400"
            >
              +{{ group.permissions.length - 3 }}
            </span>
          </div>
        </div>

        <!-- 创建时间 -->
        <p class="mb-4 text-xs text-gray-500 dark:text-gray-400">
          创建于 {{ formatDate(group.createdAt) }}
        </p>

        <!-- 操作按钮 -->
        <div class="flex gap-2">
          <button class="btn-secondary flex-1 text-xs" @click="editGroup(group)">
            <i class="fas fa-edit mr-1" />
            编辑
          </button>
          <button class="btn-secondary text-xs" @click="manageMembers(group)">
            <i class="fas fa-users-cog mr-1" />
            成员
          </button>
          <button
            class="btn-icon text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
            title="删除用户组"
            @click="deleteGroup(group)"
          >
            <i class="fas fa-trash text-xs" />
          </button>
        </div>
      </div>

      <!-- 空状态 -->
      <div v-else class="col-span-full">
        <div class="glass-strong rounded-xl p-8 text-center">
          <div
            class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700"
          >
            <i class="fas fa-users text-2xl text-gray-400" />
          </div>
          <h3 class="mb-2 text-lg font-medium text-gray-900 dark:text-gray-100">
            {{ searchQuery || statusFilter ? '未找到匹配的用户组' : '暂无用户组' }}
          </h3>
          <p class="text-gray-500 dark:text-gray-400">
            {{
              searchQuery || statusFilter ? '请尝试调整搜索条件' : '点击右上角按钮创建第一个用户组'
            }}
          </p>
        </div>
      </div>
    </div>

    <!-- 创建/编辑用户组模态框 -->
    <div
      v-if="showCreateModal || showEditModal"
      class="modal fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div class="modal-content w-full max-w-lg">
        <div class="mb-6 flex items-center justify-between">
          <h3 class="text-xl font-bold text-gray-900 dark:text-gray-100">
            <i class="fas fa-users mr-2 text-purple-500" />
            {{ showEditModal ? '编辑用户组' : '创建用户组' }}
          </h3>
          <button
            class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            @click="closeModals"
          >
            <i class="fas fa-times text-xl" />
          </button>
        </div>

        <form class="space-y-4" @submit.prevent="saveGroup">
          <div>
            <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              用户组名称 *
            </label>
            <input
              v-model="groupForm.name"
              class="form-input w-full"
              placeholder="请输入用户组名称"
              required
              type="text"
            />
          </div>

          <div>
            <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              描述
            </label>
            <textarea
              v-model="groupForm.description"
              class="form-input w-full resize-none"
              placeholder="请输入用户组描述（可选）"
              rows="3"
            />
          </div>

          <div>
            <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              状态 *
            </label>
            <select v-model="groupForm.status" class="form-select w-full" required>
              <option value="">选择状态</option>
              <option value="active">活跃</option>
              <option value="inactive">不活跃</option>
            </select>
          </div>

          <div>
            <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              权限设置
            </label>
            <div class="grid grid-cols-2 gap-2">
              <label
                v-for="permission in availablePermissions"
                :key="permission.value"
                class="flex cursor-pointer items-center gap-2 rounded border border-gray-200 p-2 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800/50"
              >
                <input
                  v-model="groupForm.permissions"
                  class="rounded border-gray-300 text-blue-600 focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50 dark:border-gray-600 dark:bg-gray-700"
                  type="checkbox"
                  :value="permission.value"
                />
                <span class="text-sm text-gray-700 dark:text-gray-300">
                  {{ permission.label }}
                </span>
              </label>
            </div>
          </div>

          <div class="flex gap-3 pt-4">
            <button class="btn btn-secondary flex-1" type="button" @click="closeModals">
              取消
            </button>
            <button class="btn btn-primary flex-1" :disabled="saving" type="submit">
              <div v-if="saving" class="loading-spinner mr-2" />
              {{ saving ? '保存中...' : '保存' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- 成员管理模态框 -->
    <div
      v-if="showMembersModal"
      class="modal fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div class="modal-content w-full max-w-2xl">
        <div class="mb-6 flex items-center justify-between">
          <h3 class="text-xl font-bold text-gray-900 dark:text-gray-100">
            <i class="fas fa-users-cog mr-2 text-purple-500" />
            管理成员 - {{ selectedGroup?.name }}
          </h3>
          <button
            class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            @click="showMembersModal = false"
          >
            <i class="fas fa-times text-xl" />
          </button>
        </div>

        <div class="space-y-4">
          <!-- 添加成员 -->
          <div>
            <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              添加成员
            </label>
            <div class="flex gap-2">
              <select v-model="selectedUserId" class="form-select flex-1">
                <option value="">选择用户</option>
                <option v-for="user in availableUsers" :key="user.id" :value="user.id">
                  {{ user.username }} ({{ user.role === 'admin' ? '管理员' : '普通用户' }})
                </option>
              </select>
              <button
                class="btn btn-primary"
                :disabled="!selectedUserId || addingMember"
                @click="addMember"
              >
                <div v-if="addingMember" class="loading-spinner mr-2" />
                添加
              </button>
            </div>
          </div>

          <!-- 成员列表 -->
          <div class="rounded-lg border border-gray-200 dark:border-gray-700">
            <div
              class="border-b border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800"
            >
              <h4 class="font-medium text-gray-900 dark:text-gray-100">
                当前成员 ({{ groupMembers.length }})
              </h4>
            </div>
            <div v-if="loadingMembers" class="p-4 text-center">
              <div class="loading-spinner mx-auto mb-2" />
              <p class="text-sm text-gray-500">加载成员中...</p>
            </div>
            <div
              v-else-if="groupMembers.length > 0"
              class="divide-y divide-gray-200 dark:divide-gray-700"
            >
              <div
                v-for="member in groupMembers"
                :key="member.id"
                class="flex items-center justify-between p-4"
              >
                <div class="flex items-center gap-3">
                  <div
                    class="flex h-8 w-8 items-center justify-center rounded-full"
                    :class="member.role === 'admin' ? 'bg-purple-500' : 'bg-blue-500'"
                  >
                    <i class="fas fa-user text-xs text-white" />
                  </div>
                  <div>
                    <p class="font-medium text-gray-900 dark:text-gray-100">
                      {{ member.username }}
                    </p>
                    <p class="text-xs text-gray-500 dark:text-gray-400">
                      {{ member.role === 'admin' ? '管理员' : '普通用户' }}
                    </p>
                  </div>
                </div>
                <button
                  class="btn-icon text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                  title="移除成员"
                  @click="removeMember(member.id)"
                >
                  <i class="fas fa-times" />
                </button>
              </div>
            </div>
            <div v-else class="p-4 text-center text-gray-500 dark:text-gray-400">暂无成员</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, reactive } from 'vue'
import { showToast } from '@/utils/toast'
import { apiClient } from '@/config/api'

// 响应式数据
const loading = ref(false)
const saving = ref(false)
const groups = ref([])
const searchQuery = ref('')
const statusFilter = ref('')
const showCreateModal = ref(false)
const showEditModal = ref(false)
const showMembersModal = ref(false)
const editingGroup = ref(null)
const selectedGroup = ref(null)
const groupMembers = ref([])
const availableUsers = ref([])
const selectedUserId = ref('')
const loadingMembers = ref(false)
const addingMember = ref(false)

// 用户组表单
const groupForm = reactive({
  name: '',
  description: '',
  status: 'active',
  permissions: []
})

// 可用权限列表
const availablePermissions = [
  { value: 'read_users', label: '查看用户' },
  { value: 'write_users', label: '管理用户' },
  { value: 'read_groups', label: '查看用户组' },
  { value: 'write_groups', label: '管理用户组' },
  { value: 'read_api_keys', label: '查看API密钥' },
  { value: 'write_api_keys', label: '管理API密钥' },
  { value: 'read_accounts', label: '查看账户' },
  { value: 'write_accounts', label: '管理账户' },
  { value: 'system_admin', label: '系统管理' }
]

// 计算属性 - 筛选用户组
const filteredGroups = computed(() => {
  let filtered = groups.value

  // 搜索筛选
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    filtered = filtered.filter(
      (group) =>
        group.name.toLowerCase().includes(query) ||
        (group.description && group.description.toLowerCase().includes(query))
    )
  }

  // 状态筛选
  if (statusFilter.value) {
    filtered = filtered.filter((group) => group.status === statusFilter.value)
  }

  return filtered
})

// 格式化日期
const formatDate = (dateString) => {
  if (!dateString) return '未知'
  return new Date(dateString).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
}

// 加载用户组列表
const loadGroups = async () => {
  loading.value = true
  try {
    const result = await apiClient.get('/admin/user-groups')
    if (result.success) {
      groups.value = result.data || []
    } else {
      showToast('加载用户组列表失败', 'error')
    }
  } catch (error) {
    console.error('Error loading groups:', error)
    showToast('加载用户组列表失败', 'error')
  } finally {
    loading.value = false
  }
}

// 加载可用用户列表
const loadAvailableUsers = async () => {
  try {
    const result = await apiClient.get('/admin/users')
    if (result.success) {
      availableUsers.value = result.data || []
    }
  } catch (error) {
    console.error('Error loading users:', error)
  }
}

// 重置表单
const resetForm = () => {
  groupForm.name = ''
  groupForm.description = ''
  groupForm.status = 'active'
  groupForm.permissions = []
}

// 关闭模态框
const closeModals = () => {
  showCreateModal.value = false
  showEditModal.value = false
  editingGroup.value = null
  resetForm()
}

// 编辑用户组
const editGroup = (group) => {
  editingGroup.value = group
  groupForm.name = group.name
  groupForm.description = group.description || ''
  groupForm.status = group.status
  groupForm.permissions = group.permissions || []
  showEditModal.value = true
}

// 保存用户组
const saveGroup = async () => {
  saving.value = true
  try {
    let result
    if (showEditModal.value) {
      // 编辑用户组
      result = await apiClient.put(`/admin/user-groups/${editingGroup.value.id}`, {
        name: groupForm.name,
        description: groupForm.description || null,
        status: groupForm.status,
        permissions: groupForm.permissions
      })
    } else {
      // 创建用户组
      result = await apiClient.post('/admin/user-groups', {
        name: groupForm.name,
        description: groupForm.description || null,
        status: groupForm.status,
        permissions: groupForm.permissions
      })
    }

    if (result.success) {
      showToast(showEditModal.value ? '用户组更新成功' : '用户组创建成功', 'success')
      closeModals()
      loadGroups() // 重新加载用户组列表
    } else {
      showToast(result.message || '操作失败', 'error')
    }
  } catch (error) {
    console.error('Error saving group:', error)
    showToast('操作失败', 'error')
  } finally {
    saving.value = false
  }
}

// 删除用户组
const deleteGroup = async (group) => {
  if (!confirm(`确定要删除用户组 "${group.name}" 吗？此操作不可恢复。`)) {
    return
  }

  try {
    const result = await apiClient.delete(`/admin/user-groups/${group.id}`)

    if (result.success) {
      showToast('用户组删除成功', 'success')
      loadGroups() // 重新加载用户组列表
    } else {
      showToast(result.message || '用户组删除失败', 'error')
    }
  } catch (error) {
    console.error('Error deleting group:', error)
    showToast('用户组删除失败', 'error')
  }
}

// 管理成员
const manageMembers = async (group) => {
  selectedGroup.value = group
  showMembersModal.value = true
  await loadGroupMembers(group.id)
  await loadAvailableUsers()
}

// 加载用户组成员
const loadGroupMembers = async (groupId) => {
  loadingMembers.value = true
  try {
    const result = await apiClient.get(`/admin/user-groups/${groupId}/members`)
    if (result.success) {
      groupMembers.value = result.data || []
    }
  } catch (error) {
    console.error('Error loading group members:', error)
    showToast('加载用户组成员失败', 'error')
  } finally {
    loadingMembers.value = false
  }
}

// 添加成员
const addMember = async () => {
  if (!selectedUserId.value) return

  addingMember.value = true
  try {
    const result = await apiClient.post(`/admin/user-groups/${selectedGroup.value.id}/members`, {
      userId: selectedUserId.value
    })

    if (result.success) {
      showToast('成员添加成功', 'success')
      selectedUserId.value = ''
      await loadGroupMembers(selectedGroup.value.id)
    } else {
      showToast(result.message || '添加成员失败', 'error')
    }
  } catch (error) {
    console.error('Error adding member:', error)
    showToast('添加成员失败', 'error')
  } finally {
    addingMember.value = false
  }
}

// 移除成员
const removeMember = async (userId) => {
  if (!confirm('确定要移除这个成员吗？')) {
    return
  }

  try {
    const result = await apiClient.delete(
      `/admin/user-groups/${selectedGroup.value.id}/members/${userId}`
    )

    if (result.success) {
      showToast('成员移除成功', 'success')
      await loadGroupMembers(selectedGroup.value.id)
    } else {
      showToast(result.message || '移除成员失败', 'error')
    }
  } catch (error) {
    console.error('Error removing member:', error)
    showToast('移除成员失败', 'error')
  }
}

// 页面加载时获取用户组列表
onMounted(() => {
  loadGroups()
})
</script>

<style scoped>
/* 按钮图标样式 */
.btn-icon {
  @apply rounded-lg p-2 transition-colors duration-200;
}

/* 文本截取 */
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
