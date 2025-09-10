<template>
  <div class="space-y-6">
    <!-- 页面标题 -->
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100 sm:text-3xl">
        <i class="fas fa-user-friends mr-2 text-blue-500" />
        用户管理
      </h1>
      <button class="btn btn-primary flex items-center gap-2" @click="showCreateModal = true">
        <i class="fas fa-plus text-sm" />
        <span>添加用户</span>
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
              placeholder="搜索用户名、邮箱或角色..."
              type="text"
            />
          </div>
        </div>

        <!-- 角色筛选 -->
        <div class="flex items-center gap-2">
          <label class="text-sm font-medium text-gray-700 dark:text-gray-300">角色:</label>
          <select v-model="roleFilter" class="form-select">
            <option value="">全部角色</option>
            <option value="admin">管理员</option>
            <option value="user">普通用户</option>
          </select>
        </div>
      </div>
    </div>

    <!-- 用户列表 -->
    <div class="glass-strong overflow-hidden rounded-xl">
      <!-- 加载状态 -->
      <div v-if="loading" class="p-8 text-center">
        <div class="loading-spinner mx-auto mb-4" />
        <p class="text-gray-500 dark:text-gray-400">加载用户数据中...</p>
      </div>

      <!-- 用户表格 -->
      <div v-else-if="filteredUsers.length > 0" class="overflow-x-auto">
        <table class="w-full">
          <thead class="bg-gray-50/50 dark:bg-gray-700/50">
            <tr>
              <th
                class="px-6 py-4 text-left text-sm font-semibold text-gray-900 dark:text-gray-100"
              >
                用户信息
              </th>
              <th
                class="px-6 py-4 text-left text-sm font-semibold text-gray-900 dark:text-gray-100"
              >
                角色
              </th>
              <th
                class="px-6 py-4 text-left text-sm font-semibold text-gray-900 dark:text-gray-100"
              >
                状态
              </th>
              <th
                class="px-6 py-4 text-left text-sm font-semibold text-gray-900 dark:text-gray-100"
              >
                创建时间
              </th>
              <th
                class="px-6 py-4 text-right text-sm font-semibold text-gray-900 dark:text-gray-100"
              >
                操作
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
            <tr
              v-for="user in filteredUsers"
              :key="user.id"
              class="transition-colors hover:bg-gray-50/50 dark:hover:bg-gray-800/50"
            >
              <!-- 用户信息 -->
              <td class="px-6 py-4">
                <div class="flex items-center gap-3">
                  <div
                    class="flex h-10 w-10 items-center justify-center rounded-full"
                    :class="
                      user.role === 'admin'
                        ? 'bg-gradient-to-br from-purple-500 to-pink-500'
                        : 'bg-gradient-to-br from-blue-500 to-indigo-500'
                    "
                  >
                    <i class="fas fa-user text-sm text-white" />
                  </div>
                  <div>
                    <div class="font-medium text-gray-900 dark:text-gray-100">
                      {{ user.username }}
                    </div>
                    <div class="text-sm text-gray-500 dark:text-gray-400">
                      {{ user.email || '未设置邮箱' }}
                    </div>
                  </div>
                </div>
              </td>

              <!-- 角色 -->
              <td class="px-6 py-4">
                <span
                  class="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold"
                  :class="
                    user.role === 'admin'
                      ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400'
                      : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
                  "
                >
                  <i :class="user.role === 'admin' ? 'fas fa-crown' : 'fas fa-user'" />
                  {{ user.role === 'admin' ? '管理员' : '普通用户' }}
                </span>
              </td>

              <!-- 状态 -->
              <td class="px-6 py-4">
                <span
                  class="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold"
                  :class="
                    user.status === 'active'
                      ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                  "
                >
                  <i
                    :class="
                      user.status === 'active' ? 'fas fa-check-circle' : 'fas fa-times-circle'
                    "
                  />
                  {{ user.status === 'active' ? '活跃' : '禁用' }}
                </span>
              </td>

              <!-- 创建时间 -->
              <td class="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                {{ formatDate(user.createdAt) }}
              </td>

              <!-- 操作 -->
              <td class="px-6 py-4">
                <div class="flex items-center justify-end gap-2">
                  <button
                    class="btn-icon text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20"
                    title="编辑用户"
                    @click="editUser(user)"
                  >
                    <i class="fas fa-edit" />
                  </button>
                  <button
                    v-if="user.status === 'active'"
                    class="btn-icon text-orange-600 hover:bg-orange-50 dark:text-orange-400 dark:hover:bg-orange-900/20"
                    title="禁用用户"
                    @click="toggleUserStatus(user)"
                  >
                    <i class="fas fa-ban" />
                  </button>
                  <button
                    v-else
                    class="btn-icon text-green-600 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/20"
                    title="启用用户"
                    @click="toggleUserStatus(user)"
                  >
                    <i class="fas fa-check" />
                  </button>
                  <button
                    class="btn-icon text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                    title="删除用户"
                    @click="deleteUser(user)"
                  >
                    <i class="fas fa-trash" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 空状态 -->
      <div v-else class="p-8 text-center">
        <div
          class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700"
        >
          <i class="fas fa-users text-2xl text-gray-400" />
        </div>
        <h3 class="mb-2 text-lg font-medium text-gray-900 dark:text-gray-100">
          {{ searchQuery || roleFilter ? '未找到匹配的用户' : '暂无用户数据' }}
        </h3>
        <p class="text-gray-500 dark:text-gray-400">
          {{ searchQuery || roleFilter ? '请尝试调整搜索条件' : '点击上方按钮添加第一个用户' }}
        </p>
      </div>
    </div>

    <!-- 创建/编辑用户模态框 -->
    <div
      v-if="showCreateModal || showEditModal"
      class="modal fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div class="modal-content w-full max-w-md">
        <div class="mb-6 flex items-center justify-between">
          <h3 class="text-xl font-bold text-gray-900 dark:text-gray-100">
            <i class="fas fa-user-plus mr-2 text-blue-500" />
            {{ showEditModal ? '编辑用户' : '添加用户' }}
          </h3>
          <button
            class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            @click="closeModals"
          >
            <i class="fas fa-times text-xl" />
          </button>
        </div>

        <form class="space-y-4" @submit.prevent="saveUser">
          <div>
            <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              用户名 *
            </label>
            <input
              v-model="userForm.username"
              class="form-input w-full"
              placeholder="请输入用户名"
              required
              type="text"
            />
          </div>

          <div>
            <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              邮箱
            </label>
            <input
              v-model="userForm.email"
              class="form-input w-full"
              placeholder="请输入邮箱地址"
              type="email"
            />
          </div>

          <div v-if="!showEditModal">
            <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              密码 *
            </label>
            <input
              v-model="userForm.password"
              class="form-input w-full"
              placeholder="请输入密码"
              required
              type="password"
            />
          </div>

          <div>
            <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              角色 *
            </label>
            <select v-model="userForm.role" class="form-select w-full" required>
              <option value="">选择角色</option>
              <option value="admin">管理员</option>
              <option value="user">普通用户</option>
            </select>
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
  </div>
</template>

<script setup>
import { ref, computed, onMounted, reactive } from 'vue'
import { showToast } from '@/utils/toast'
import { apiClient } from '@/config/api'

// 响应式数据
const loading = ref(false)
const saving = ref(false)
const users = ref([])
const searchQuery = ref('')
const roleFilter = ref('')
const showCreateModal = ref(false)
const showEditModal = ref(false)
const editingUser = ref(null)

// 用户表单
const userForm = reactive({
  username: '',
  email: '',
  password: '',
  role: ''
})

// 计算属性 - 筛选用户
const filteredUsers = computed(() => {
  let filtered = users.value

  // 搜索筛选
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    filtered = filtered.filter(
      (user) =>
        user.username.toLowerCase().includes(query) ||
        (user.email && user.email.toLowerCase().includes(query)) ||
        (user.role === 'admin' ? '管理员' : '普通用户').includes(query)
    )
  }

  // 角色筛选
  if (roleFilter.value) {
    filtered = filtered.filter((user) => user.role === roleFilter.value)
  }

  return filtered
})

// 格式化日期
const formatDate = (dateString) => {
  if (!dateString) return '未知'
  return new Date(dateString).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// 加载用户列表
const loadUsers = async () => {
  loading.value = true
  try {
    const result = await apiClient.get('/admin/users')
    if (result.success) {
      users.value = result.data || []
    } else {
      showToast('加载用户列表失败', 'error')
    }
  } catch (error) {
    console.error('Error loading users:', error)
    showToast('加载用户列表失败', 'error')
  } finally {
    loading.value = false
  }
}

// 重置表单
const resetForm = () => {
  userForm.username = ''
  userForm.email = ''
  userForm.password = ''
  userForm.role = ''
}

// 关闭模态框
const closeModals = () => {
  showCreateModal.value = false
  showEditModal.value = false
  editingUser.value = null
  resetForm()
}

// 编辑用户
const editUser = (user) => {
  editingUser.value = user
  userForm.username = user.username
  userForm.email = user.email || ''
  userForm.role = user.role
  showEditModal.value = true
}

// 保存用户
const saveUser = async () => {
  saving.value = true
  try {
    let result
    if (showEditModal.value) {
      // 编辑用户
      result = await apiClient.put(`/admin/users/${editingUser.value.id}`, {
        username: userForm.username,
        email: userForm.email || null,
        role: userForm.role
      })
    } else {
      // 创建用户
      result = await apiClient.post('/admin/users', {
        username: userForm.username,
        email: userForm.email || null,
        password: userForm.password,
        role: userForm.role
      })
    }

    if (result.success) {
      showToast(showEditModal.value ? '用户更新成功' : '用户创建成功', 'success')
      closeModals()
      loadUsers() // 重新加载用户列表
    } else {
      showToast(result.message || '操作失败', 'error')
    }
  } catch (error) {
    console.error('Error saving user:', error)
    showToast('操作失败', 'error')
  } finally {
    saving.value = false
  }
}

// 切换用户状态
const toggleUserStatus = async (user) => {
  const newStatus = user.status === 'active' ? 'disabled' : 'active'
  const action = newStatus === 'active' ? '启用' : '禁用'

  if (!confirm(`确定要${action}用户 "${user.username}" 吗？`)) {
    return
  }

  try {
    const result = await apiClient.patch(`/admin/users/${user.id}/status`, {
      status: newStatus
    })

    if (result.success) {
      showToast(`用户${action}成功`, 'success')
      user.status = newStatus // 更新本地状态
    } else {
      showToast(result.message || `用户${action}失败`, 'error')
    }
  } catch (error) {
    console.error(`Error ${action} user:`, error)
    showToast(`用户${action}失败`, 'error')
  }
}

// 删除用户
const deleteUser = async (user) => {
  if (!confirm(`确定要删除用户 "${user.username}" 吗？此操作不可恢复。`)) {
    return
  }

  try {
    const result = await apiClient.delete(`/admin/users/${user.id}`)

    if (result.success) {
      showToast('用户删除成功', 'success')
      loadUsers() // 重新加载用户列表
    } else {
      showToast(result.message || '用户删除失败', 'error')
    }
  } catch (error) {
    console.error('Error deleting user:', error)
    showToast('用户删除失败', 'error')
  }
}

// 页面加载时获取用户列表
onMounted(() => {
  loadUsers()
})
</script>

<style scoped>
/* 按钮图标样式 */
.btn-icon {
  @apply rounded-lg p-2 transition-colors duration-200;
}
</style>
