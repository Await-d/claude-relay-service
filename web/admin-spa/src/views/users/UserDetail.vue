<template>
  <div class="user-detail-container">
    <div class="mb-6">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <nav aria-label="Breadcrumb" class="mb-2 flex">
            <ol class="inline-flex items-center space-x-1 md:space-x-3">
              <li class="inline-flex items-center">
                <button
                  class="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  @click="$router.back()"
                >
                  <i class="fas fa-arrow-left mr-2"></i>
                  返回
                </button>
              </li>
              <li>
                <div class="flex items-center">
                  <i class="fas fa-chevron-right mx-2 text-gray-400"></i>
                  <span class="text-sm font-medium text-gray-500 dark:text-gray-400">用户详情</span>
                </div>
              </li>
            </ol>
          </nav>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {{ user?.username || '用户详情' }}
          </h1>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <button
            v-if="!editMode"
            class="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-blue-600 px-4 py-2 text-sm font-medium text-white shadow-md transition-all duration-200 hover:from-blue-600 hover:to-blue-700 hover:shadow-lg"
            @click="toggleEditMode"
          >
            <i class="fas fa-edit"></i>
            编辑
          </button>

          <template v-if="editMode">
            <button
              class="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-green-500 to-green-600 px-4 py-2 text-sm font-medium text-white shadow-md transition-all duration-200 hover:from-green-600 hover:to-green-700 hover:shadow-lg disabled:opacity-50"
              :disabled="saving"
              @click="saveUser"
            >
              <i :class="['fas', saving ? 'fa-spinner fa-spin' : 'fa-save']"></i>
              {{ saving ? '保存中...' : '保存' }}
            </button>
            <button
              class="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              @click="cancelEdit"
            >
              <i class="fas fa-times"></i>
              取消
            </button>
          </template>
        </div>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="flex items-center justify-center py-12">
      <div class="text-center">
        <i class="fas fa-spinner fa-spin mb-4 text-3xl text-gray-400"></i>
        <p class="text-gray-500 dark:text-gray-400">加载中...</p>
      </div>
    </div>

    <!-- User not found -->
    <div v-else-if="!user" class="py-12 text-center">
      <div
        class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30"
      >
        <i class="fas fa-exclamation-triangle h-6 w-6 text-red-600 dark:text-red-400"></i>
      </div>
      <h3 class="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100">用户不存在</h3>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">指定的用户ID不存在或已被删除</p>
    </div>

    <!-- User Details -->
    <div v-else class="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <!-- Left Column - Basic Info -->
      <div class="space-y-6 lg:col-span-2">
        <!-- Basic Information -->
        <div class="card p-6">
          <div class="mb-4">
            <h3
              class="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-gray-100"
            >
              <i class="fas fa-user text-blue-500"></i>
              基本信息
            </h3>
          </div>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <!-- Username -->
            <div>
              <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                用户名
              </label>
              <input
                v-if="editMode"
                v-model="editForm.username"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                :class="{ 'border-red-300': errors.username }"
                type="text"
              />
              <p
                v-else
                class="rounded-lg bg-gray-50 p-2 text-sm text-gray-900 dark:bg-gray-700 dark:text-gray-100"
              >
                {{ user.username }}
              </p>
              <p v-if="errors.username" class="mt-1 text-xs text-red-600">{{ errors.username }}</p>
            </div>

            <!-- Email -->
            <div>
              <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                邮箱
              </label>
              <input
                v-if="editMode"
                v-model="editForm.email"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                :class="{ 'border-red-300': errors.email }"
                type="email"
              />
              <p
                v-else
                class="rounded-lg bg-gray-50 p-2 text-sm text-gray-900 dark:bg-gray-700 dark:text-gray-100"
              >
                {{ user.email || '未设置' }}
              </p>
              <p v-if="errors.email" class="mt-1 text-xs text-red-600">{{ errors.email }}</p>
            </div>

            <!-- Full Name -->
            <div>
              <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                全名
              </label>
              <input
                v-if="editMode"
                v-model="editForm.fullName"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                :class="{ 'border-red-300': errors.fullName }"
                type="text"
              />
              <p
                v-else
                class="rounded-lg bg-gray-50 p-2 text-sm text-gray-900 dark:bg-gray-700 dark:text-gray-100"
              >
                {{ user.fullName || '未设置' }}
              </p>
              <p v-if="errors.fullName" class="mt-1 text-xs text-red-600">{{ errors.fullName }}</p>
            </div>

            <!-- Role -->
            <div>
              <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                角色
              </label>
              <select
                v-if="editMode"
                v-model="editForm.role"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                :class="{ 'border-red-300': errors.role }"
              >
                <option value="user">普通用户</option>
                <option value="operator">操作员</option>
                <option value="admin">管理员</option>
              </select>
              <div v-else class="flex items-center gap-2">
                <span
                  :class="[
                    'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                    getRoleColorClass(user.role)
                  ]"
                >
                  <i :class="['fas mr-1', getRoleIcon(user.role)]"></i>
                  {{ formatRole(user.role) }}
                </span>
              </div>
              <p v-if="errors.role" class="mt-1 text-xs text-red-600">{{ errors.role }}</p>
            </div>
          </div>
        </div>

        <!-- Auth & Security -->
        <div class="card p-6">
          <div class="mb-4">
            <h3
              class="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-gray-100"
            >
              <i class="fas fa-shield-alt text-green-500"></i>
              认证与安全
            </h3>
          </div>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <!-- Auth Method -->
            <div>
              <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                认证方式
              </label>
              <div class="flex items-center gap-2">
                <span
                  :class="[
                    'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                    user.authMethod === 'local'
                      ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                      : 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300'
                  ]"
                >
                  <i
                    :class="['fas mr-1', user.authMethod === 'local' ? 'fa-key' : 'fa-server']"
                  ></i>
                  {{ user.authMethod === 'local' ? '本地认证' : 'LDAP认证' }}
                </span>
              </div>
            </div>

            <!-- Status -->
            <div>
              <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                状态
              </label>
              <select
                v-if="editMode"
                v-model="editForm.status"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
              >
                <option value="active">活跃</option>
                <option value="inactive">已禁用</option>
                <option value="pending">待激活</option>
              </select>
              <div v-else class="flex items-center gap-2">
                <span
                  :class="[
                    'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                    getStatusColorClass(user.status)
                  ]"
                >
                  <i :class="['fas mr-1', getStatusIcon(user.status)]"></i>
                  {{ formatStatus(user.status) }}
                </span>
              </div>
            </div>

            <!-- Password Actions -->
            <div v-if="user.authMethod === 'local'" class="sm:col-span-2">
              <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                密码管理
              </label>
              <div class="flex gap-2">
                <button
                  class="inline-flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-medium text-orange-600 hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-900/20 dark:text-orange-400 dark:hover:bg-orange-900/30"
                  @click="openPasswordResetModal"
                >
                  <i class="fas fa-key"></i>
                  重置密码
                </button>
                <button
                  class="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-600 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400 dark:hover:bg-blue-900/30"
                  @click="openPasswordChangeModal"
                >
                  <i class="fas fa-edit"></i>
                  修改密码
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Groups Management -->
        <div class="card p-6">
          <div class="mb-4 flex items-center justify-between">
            <h3
              class="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-gray-100"
            >
              <i class="fas fa-users text-indigo-500"></i>
              组成员关系
            </h3>
            <button
              class="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-400 dark:hover:bg-indigo-900/30"
              @click="openGroupManagementModal"
            >
              <i class="fas fa-edit"></i>
              管理组关系
            </button>
          </div>

          <div v-if="user.groups && user.groups.length > 0" class="space-y-3">
            <div
              v-for="group in user.groups"
              :key="group.id"
              class="flex items-center justify-between rounded-lg bg-gray-50 p-3 dark:bg-gray-700"
            >
              <div class="flex items-center gap-3">
                <div
                  class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-r from-indigo-500 to-purple-500"
                >
                  <i class="fas fa-users text-xs text-white"></i>
                </div>
                <div>
                  <p class="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {{ group.name }}
                  </p>
                  <p v-if="group.description" class="text-xs text-gray-500 dark:text-gray-400">
                    {{ group.description }}
                  </p>
                </div>
              </div>
              <div class="flex items-center gap-2">
                <span
                  v-if="group.isPrimary"
                  class="inline-flex items-center rounded bg-yellow-100 px-2 py-1 text-xs font-medium text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400"
                >
                  <i class="fas fa-star mr-1"></i>
                  主组
                </span>
                <span class="text-xs text-gray-500">{{ group.role || '成员' }}</span>
              </div>
            </div>
          </div>
          <div v-else class="py-8 text-center">
            <i class="fas fa-users mb-2 text-3xl text-gray-300 dark:text-gray-600"></i>
            <p class="text-sm text-gray-500 dark:text-gray-400">用户未加入任何组</p>
            <button
              class="mt-2 text-sm text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
              @click="openGroupManagementModal"
            >
              分配到组
            </button>
          </div>
        </div>
      </div>

      <!-- Right Column - Stats & Activities -->
      <div class="space-y-6">
        <!-- User Stats -->
        <div class="card p-6">
          <h3
            class="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-gray-100"
          >
            <i class="fas fa-chart-bar text-purple-500"></i>
            用户统计
          </h3>

          <div class="space-y-4">
            <div class="flex items-center justify-between">
              <span class="text-sm text-gray-600 dark:text-gray-400">登录次数</span>
              <span class="text-sm font-medium text-gray-900 dark:text-gray-100">{{
                user.loginCount || 0
              }}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm text-gray-600 dark:text-gray-400">创建时间</span>
              <span class="text-sm font-medium text-gray-900 dark:text-gray-100">{{
                formatDate(user.createdAt)
              }}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm text-gray-600 dark:text-gray-400">最后登录</span>
              <span class="text-sm font-medium text-gray-900 dark:text-gray-100">{{
                formatLastActive(user.lastActiveAt)
              }}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm text-gray-600 dark:text-gray-400">最后更新</span>
              <span class="text-sm font-medium text-gray-900 dark:text-gray-100">{{
                formatDate(user.updatedAt)
              }}</span>
            </div>
          </div>
        </div>

        <!-- Quick Actions -->
        <div class="card p-6">
          <h3
            class="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-gray-100"
          >
            <i class="fas fa-bolt text-yellow-500"></i>
            快速操作
          </h3>

          <div class="space-y-3">
            <button
              class="flex w-full items-center gap-3 rounded-lg bg-gray-50 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
              @click="sendNotification"
            >
              <i class="fas fa-bell text-blue-500"></i>
              发送通知
            </button>
            <button
              class="flex w-full items-center gap-3 rounded-lg bg-gray-50 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
              @click="viewUserSessions"
            >
              <i class="fas fa-history text-green-500"></i>
              查看会话
            </button>
            <button
              class="flex w-full items-center gap-3 rounded-lg bg-gray-50 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
              @click="viewUserLogs"
            >
              <i class="fas fa-file-alt text-purple-500"></i>
              查看日志
            </button>
            <button
              v-if="user.status === 'active'"
              class="flex w-full items-center gap-3 rounded-lg bg-red-50 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30"
              @click="disableUser"
            >
              <i class="fas fa-ban text-red-500"></i>
              禁用用户
            </button>
            <button
              v-else
              class="flex w-full items-center gap-3 rounded-lg bg-green-50 px-3 py-2 text-left text-sm text-green-600 hover:bg-green-100 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/30"
              @click="enableUser"
            >
              <i class="fas fa-check text-green-500"></i>
              启用用户
            </button>
          </div>
        </div>

        <!-- System Info -->
        <div class="card p-6">
          <h3
            class="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-gray-100"
          >
            <i class="fas fa-info-circle text-gray-500"></i>
            系统信息
          </h3>

          <div class="space-y-2 text-xs">
            <div class="flex justify-between">
              <span class="text-gray-600 dark:text-gray-400">用户ID</span>
              <span class="font-mono text-gray-900 dark:text-gray-100"
                >{{ user.id.slice(0, 12) }}...</span
              >
            </div>
            <div class="flex justify-between">
              <span class="text-gray-600 dark:text-gray-400">版本</span>
              <span class="text-gray-900 dark:text-gray-100">{{ user.version || 'v1.0' }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-600 dark:text-gray-400">数据源</span>
              <span class="text-gray-900 dark:text-gray-100">{{
                user.authMethod === 'ldap' ? 'LDAP' : 'Local'
              }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Password Reset Modal -->
    <PasswordResetModal
      v-if="showPasswordResetModal"
      :user="user"
      :visible="showPasswordResetModal"
      @close="closePasswordResetModal"
      @reset="handlePasswordReset"
    />

    <!-- Password Change Modal -->
    <PasswordChangeModal
      v-if="showPasswordChangeModal"
      :user="user"
      :visible="showPasswordChangeModal"
      @changed="handlePasswordChanged"
      @close="closePasswordChangeModal"
    />

    <!-- Group Management Modal -->
    <UserGroupManagementModal
      v-if="showGroupManagementModal"
      :user="user"
      :visible="showGroupManagementModal"
      @close="closeGroupManagementModal"
      @updated="handleGroupsUpdated"
    />
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiClient } from '@/config/api'
import { ElMessage, ElMessageBox } from 'element-plus'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

// Components
import PasswordResetModal from '@/components/users/PasswordResetModal.vue'
import PasswordChangeModal from '@/components/users/PasswordChangeModal.vue'
import UserGroupManagementModal from '@/components/users/UserGroupManagementModal.vue'

const route = useRoute()
const router = useRouter()

// Reactive state
const loading = ref(true)
const saving = ref(false)
const editMode = ref(false)
const user = ref(null)
const originalUser = ref(null)

// Modals
const showPasswordResetModal = ref(false)
const showPasswordChangeModal = ref(false)
const showGroupManagementModal = ref(false)

// Form data
const editForm = reactive({
  username: '',
  email: '',
  fullName: '',
  role: 'user',
  status: 'active'
})

// Validation errors
const errors = reactive({
  username: '',
  email: '',
  fullName: '',
  role: ''
})

// Computed
const userId = computed(() => route.params.id)

// Methods
const loadUser = async () => {
  loading.value = true
  try {
    const response = await apiClient.get(`/admin/users/${userId.value}`)

    if (response.success) {
      user.value = response.data
      originalUser.value = { ...response.data }

      // Initialize edit form
      editForm.username = user.value.username || ''
      editForm.email = user.value.email || ''
      editForm.fullName = user.value.fullName || ''
      editForm.role = user.value.role || 'user'
      editForm.status = user.value.status || 'active'
    } else {
      throw new Error(response.message || '获取用户详情失败')
    }
  } catch (error) {
    console.error('Failed to load user:', error)
    ElMessage.error(error.message || '获取用户详情失败')
  } finally {
    loading.value = false
  }
}

const toggleEditMode = () => {
  editMode.value = !editMode.value

  if (editMode.value) {
    // Reset form when entering edit mode
    editForm.username = user.value.username || ''
    editForm.email = user.value.email || ''
    editForm.fullName = user.value.fullName || ''
    editForm.role = user.value.role || 'user'
    editForm.status = user.value.status || 'active'

    // Clear errors
    Object.keys(errors).forEach((key) => {
      errors[key] = ''
    })
  }
}

const cancelEdit = () => {
  editMode.value = false
  // Reset form to original values
  if (user.value) {
    editForm.username = user.value.username || ''
    editForm.email = user.value.email || ''
    editForm.fullName = user.value.fullName || ''
    editForm.role = user.value.role || 'user'
    editForm.status = user.value.status || 'active'
  }

  // Clear errors
  Object.keys(errors).forEach((key) => {
    errors[key] = ''
  })
}

const validateForm = () => {
  // Clear previous errors
  Object.keys(errors).forEach((key) => {
    errors[key] = ''
  })

  let isValid = true

  // Username validation
  if (!editForm.username) {
    errors.username = '用户名不能为空'
    isValid = false
  } else if (editForm.username.length < 3) {
    errors.username = '用户名至少3个字符'
    isValid = false
  } else if (!/^[a-zA-Z0-9_-]+$/.test(editForm.username)) {
    errors.username = '用户名只能包含字母、数字、下划线和横线'
    isValid = false
  }

  // Email validation
  if (editForm.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editForm.email)) {
    errors.email = '请输入有效的邮箱地址'
    isValid = false
  }

  // Full name validation
  if (editForm.fullName && editForm.fullName.length > 100) {
    errors.fullName = '全名不能超过100个字符'
    isValid = false
  }

  return isValid
}

const saveUser = async () => {
  if (!validateForm()) {
    return
  }

  saving.value = true
  try {
    const response = await apiClient.put(`/admin/users/${userId.value}`, editForm)

    if (response.success) {
      user.value = { ...user.value, ...editForm, updatedAt: new Date().toISOString() }
      originalUser.value = { ...user.value }
      editMode.value = false
      ElMessage.success('用户信息更新成功')
    } else {
      throw new Error(response.message || '保存失败')
    }
  } catch (error) {
    console.error('Failed to save user:', error)
    ElMessage.error(error.message || '保存用户信息失败')
  } finally {
    saving.value = false
  }
}

// Formatting methods
const formatRole = (role) => {
  const roles = {
    admin: '管理员',
    user: '普通用户',
    operator: '操作员'
  }
  return roles[role] || role
}

const formatStatus = (status) => {
  const statuses = {
    active: '活跃',
    inactive: '已禁用',
    pending: '待激活'
  }
  return statuses[status] || status
}

const formatDate = (dateString) => {
  if (!dateString) return '未知'
  try {
    return dayjs(dateString).format('YYYY-MM-DD HH:mm:ss')
  } catch (error) {
    return '未知'
  }
}

const formatLastActive = (lastActiveAt) => {
  if (!lastActiveAt) return '从未登录'
  try {
    return dayjs(lastActiveAt).fromNow()
  } catch (error) {
    return '未知'
  }
}

const getRoleColorClass = (role) => {
  const colors = {
    admin: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    user: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    operator: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
  }
  return colors[role] || 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300'
}

const getRoleIcon = (role) => {
  const icons = {
    admin: 'fa-crown',
    user: 'fa-user',
    operator: 'fa-cog'
  }
  return icons[role] || 'fa-user'
}

const getStatusColorClass = (status) => {
  const colors = {
    active: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    inactive: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'
  }
  return colors[status] || 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300'
}

const getStatusIcon = (status) => {
  const icons = {
    active: 'fa-check-circle',
    inactive: 'fa-times-circle',
    pending: 'fa-clock'
  }
  return icons[status] || 'fa-question-circle'
}

// Modal handlers
const openPasswordResetModal = () => {
  showPasswordResetModal.value = true
}

const closePasswordResetModal = () => {
  showPasswordResetModal.value = false
}

const handlePasswordReset = () => {
  closePasswordResetModal()
  ElMessage.success('密码重置成功')
  loadUser() // Reload user data
}

const openPasswordChangeModal = () => {
  showPasswordChangeModal.value = true
}

const closePasswordChangeModal = () => {
  showPasswordChangeModal.value = false
}

const handlePasswordChanged = () => {
  closePasswordChangeModal()
  ElMessage.success('密码修改成功')
}

const openGroupManagementModal = () => {
  showGroupManagementModal.value = true
}

const closeGroupManagementModal = () => {
  showGroupManagementModal.value = false
}

const handleGroupsUpdated = () => {
  closeGroupManagementModal()
  loadUser() // Reload user data to get updated groups
}

// Quick actions
const sendNotification = () => {
  ElMessage.info('通知功能正在开发中')
}

const viewUserSessions = () => {
  // Navigate to user sessions view
  router.push({ name: 'UserSessions', params: { userId: user.value.id } })
}

const viewUserLogs = () => {
  // Navigate to user logs view
  router.push({ name: 'UserLogs', params: { userId: user.value.id } })
}

const disableUser = async () => {
  try {
    await ElMessageBox.confirm(`确定要禁用用户 "${user.value.username}" 吗？`, '确认禁用', {
      confirmButtonText: '确定禁用',
      cancelButtonText: '取消',
      type: 'warning'
    })

    const response = await apiClient.put(`/admin/users/${user.value.id}/status`, {
      status: 'inactive'
    })

    if (response.success) {
      user.value.status = 'inactive'
      ElMessage.success('用户已禁用')
    } else {
      throw new Error(response.message || '禁用失败')
    }
  } catch (error) {
    if (error !== 'cancel') {
      console.error('Failed to disable user:', error)
      ElMessage.error(error.message || '禁用用户失败')
    }
  }
}

const enableUser = async () => {
  try {
    await ElMessageBox.confirm(`确定要启用用户 "${user.value.username}" 吗？`, '确认启用', {
      confirmButtonText: '确定启用',
      cancelButtonText: '取消',
      type: 'warning'
    })

    const response = await apiClient.put(`/admin/users/${user.value.id}/status`, {
      status: 'active'
    })

    if (response.success) {
      user.value.status = 'active'
      ElMessage.success('用户已启用')
    } else {
      throw new Error(response.message || '启用失败')
    }
  } catch (error) {
    if (error !== 'cancel') {
      console.error('Failed to enable user:', error)
      ElMessage.error(error.message || '启用用户失败')
    }
  }
}

// Lifecycle
onMounted(() => {
  loadUser()
})
</script>

<style scoped>
.user-detail-container {
  @apply mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8;
}

.card {
  @apply rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800;
}
</style>
