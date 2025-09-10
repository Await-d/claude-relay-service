<template>
  <div
    v-if="visible"
    aria-labelledby="modal-title"
    aria-modal="true"
    class="fixed inset-0 z-50 overflow-y-auto"
    role="dialog"
  >
    <!-- Backdrop -->
    <div
      class="flex min-h-screen items-end justify-center px-4 pb-20 pt-4 text-center sm:block sm:p-0"
    >
      <div
        aria-hidden="true"
        class="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity dark:bg-gray-900 dark:bg-opacity-80"
        @click="closeModal"
      ></div>

      <!-- Modal positioning -->
      <span aria-hidden="true" class="hidden sm:inline-block sm:h-screen sm:align-middle"
        >&#8203;</span
      >

      <!-- Modal content -->
      <div
        class="relative inline-block transform overflow-hidden rounded-lg bg-white text-left align-bottom shadow-xl transition-all dark:bg-gray-800 sm:my-8 sm:w-full sm:max-w-2xl sm:align-middle"
      >
        <!-- Header -->
        <div class="bg-white px-6 pb-4 pt-6 dark:bg-gray-800">
          <div class="flex items-center justify-between">
            <h3 id="modal-title" class="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {{ user ? '编辑用户' : '创建用户' }}
            </h3>
            <button
              class="rounded-md text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-gray-500 dark:hover:text-gray-400"
              type="button"
              @click="closeModal"
            >
              <span class="sr-only">关闭</span>
              <i class="fas fa-times h-6 w-6"></i>
            </button>
          </div>
        </div>

        <!-- Form content -->
        <form @submit.prevent="saveUser">
          <div class="bg-white px-6 pb-6 dark:bg-gray-800">
            <div class="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <!-- Username -->
              <div class="sm:col-span-1">
                <label
                  class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  for="username"
                >
                  用户名 <span class="text-red-500">*</span>
                </label>
                <input
                  id="username"
                  v-model="form.username"
                  class="w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400"
                  :class="{
                    'border-red-300 focus:border-red-500 focus:ring-red-500': errors.username
                  }"
                  :disabled="!!user && user.authMethod === 'ldap'"
                  placeholder="输入用户名"
                  required
                  type="text"
                />
                <p v-if="errors.username" class="mt-1 text-xs text-red-600">
                  {{ errors.username }}
                </p>
                <p v-if="!!user && user.authMethod === 'ldap'" class="mt-1 text-xs text-gray-500">
                  LDAP用户的用户名不能修改
                </p>
              </div>

              <!-- Email -->
              <div class="sm:col-span-1">
                <label
                  class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  for="email"
                >
                  邮箱
                </label>
                <input
                  id="email"
                  v-model="form.email"
                  class="w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400"
                  :class="{
                    'border-red-300 focus:border-red-500 focus:ring-red-500': errors.email
                  }"
                  placeholder="输入邮箱地址"
                  type="email"
                />
                <p v-if="errors.email" class="mt-1 text-xs text-red-600">{{ errors.email }}</p>
              </div>

              <!-- Full Name -->
              <div class="sm:col-span-2">
                <label
                  class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  for="fullName"
                >
                  全名
                </label>
                <input
                  id="fullName"
                  v-model="form.fullName"
                  class="w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400"
                  :class="{
                    'border-red-300 focus:border-red-500 focus:ring-red-500': errors.fullName
                  }"
                  placeholder="输入用户全名"
                  type="text"
                />
                <p v-if="errors.fullName" class="mt-1 text-xs text-red-600">
                  {{ errors.fullName }}
                </p>
              </div>

              <!-- Role -->
              <div class="sm:col-span-1">
                <label
                  class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  for="role"
                >
                  角色 <span class="text-red-500">*</span>
                </label>
                <select
                  id="role"
                  v-model="form.role"
                  class="w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
                  :class="{ 'border-red-300 focus:border-red-500 focus:ring-red-500': errors.role }"
                  required
                >
                  <option value="">请选择角色</option>
                  <option value="user">普通用户</option>
                  <option value="operator">操作员</option>
                  <option value="admin">管理员</option>
                </select>
                <p v-if="errors.role" class="mt-1 text-xs text-red-600">{{ errors.role }}</p>
              </div>

              <!-- Status -->
              <div class="sm:col-span-1">
                <label
                  class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  for="status"
                >
                  状态
                </label>
                <select
                  id="status"
                  v-model="form.status"
                  class="w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
                >
                  <option value="active">活跃</option>
                  <option value="inactive">已禁用</option>
                  <option value="pending">待激活</option>
                </select>
              </div>

              <!-- Password (only for new local users) -->
              <div v-if="!user" class="sm:col-span-1">
                <label
                  class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  for="password"
                >
                  密码 <span class="text-red-500">*</span>
                </label>
                <div class="relative">
                  <input
                    id="password"
                    v-model="form.password"
                    class="w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 shadow-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400"
                    :class="{
                      'border-red-300 focus:border-red-500 focus:ring-red-500': errors.password
                    }"
                    placeholder="输入密码"
                    required
                    :type="showPassword ? 'text' : 'password'"
                  />
                  <button
                    class="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                    type="button"
                    @click="showPassword = !showPassword"
                  >
                    <i :class="['fas', showPassword ? 'fa-eye-slash' : 'fa-eye']"></i>
                  </button>
                </div>
                <p v-if="errors.password" class="mt-1 text-xs text-red-600">
                  {{ errors.password }}
                </p>
                <p class="mt-1 text-xs text-gray-500">密码至少8个字符</p>
              </div>

              <!-- Confirm Password (only for new local users) -->
              <div v-if="!user" class="sm:col-span-1">
                <label
                  class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  for="confirmPassword"
                >
                  确认密码 <span class="text-red-500">*</span>
                </label>
                <input
                  id="confirmPassword"
                  v-model="form.confirmPassword"
                  class="w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400"
                  :class="{
                    'border-red-300 focus:border-red-500 focus:ring-red-500': errors.confirmPassword
                  }"
                  placeholder="再次输入密码"
                  required
                  :type="showPassword ? 'text' : 'password'"
                />
                <p v-if="errors.confirmPassword" class="mt-1 text-xs text-red-600">
                  {{ errors.confirmPassword }}
                </p>
              </div>

              <!-- Auth Method (only for new users) -->
              <div v-if="!user" class="sm:col-span-2">
                <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  认证方式
                </label>
                <div class="flex gap-4">
                  <label class="flex items-center">
                    <input
                      v-model="form.authMethod"
                      class="h-4 w-4 border-gray-300 text-indigo-600 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700"
                      type="radio"
                      value="local"
                    />
                    <span class="ml-2 text-sm text-gray-700 dark:text-gray-300">本地认证</span>
                  </label>
                  <label class="flex items-center">
                    <input
                      v-model="form.authMethod"
                      class="h-4 w-4 border-gray-300 text-indigo-600 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700"
                      type="radio"
                      value="ldap"
                    />
                    <span class="ml-2 text-sm text-gray-700 dark:text-gray-300">LDAP认证</span>
                  </label>
                </div>
              </div>

              <!-- Description -->
              <div class="sm:col-span-2">
                <label
                  class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  for="description"
                >
                  备注
                </label>
                <textarea
                  id="description"
                  v-model="form.description"
                  class="w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400"
                  placeholder="输入用户备注信息（可选）"
                  rows="3"
                ></textarea>
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div
            class="flex flex-col-reverse gap-3 bg-gray-50 px-6 py-3 dark:bg-gray-700 sm:flex-row sm:justify-end"
          >
            <button
              class="inline-flex justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 sm:w-auto"
              type="button"
              @click="closeModal"
            >
              取消
            </button>
            <button
              class="inline-flex justify-center rounded-md border border-transparent bg-gradient-to-r from-indigo-500 to-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:from-indigo-600 hover:to-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              :disabled="saving"
              type="submit"
            >
              <i v-if="saving" class="fas fa-spinner fa-spin mr-2"></i>
              {{ saving ? '保存中...' : user ? '更新' : '创建' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, watch, onMounted } from 'vue'
import { apiClient } from '@/config/api'
import { ElMessage } from 'element-plus'

// Props
const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  user: {
    type: Object,
    default: null
  }
})

// Emits
const emit = defineEmits(['close', 'saved'])

// Reactive state
const saving = ref(false)
const showPassword = ref(false)

// Form data
const form = reactive({
  username: '',
  email: '',
  fullName: '',
  role: 'user',
  status: 'active',
  password: '',
  confirmPassword: '',
  authMethod: 'local',
  description: ''
})

// Validation errors
const errors = reactive({
  username: '',
  email: '',
  fullName: '',
  role: '',
  password: '',
  confirmPassword: ''
})

// Methods
const resetForm = () => {
  form.username = ''
  form.email = ''
  form.fullName = ''
  form.role = 'user'
  form.status = 'active'
  form.password = ''
  form.confirmPassword = ''
  form.authMethod = 'local'
  form.description = ''

  // Clear errors
  Object.keys(errors).forEach((key) => {
    errors[key] = ''
  })
}

const loadUserData = () => {
  if (props.user) {
    form.username = props.user.username || ''
    form.email = props.user.email || ''
    form.fullName = props.user.fullName || ''
    form.role = props.user.role || 'user'
    form.status = props.user.status || 'active'
    form.description = props.user.description || ''
    // Don't load password fields for existing users
  } else {
    resetForm()
  }
}

const validateForm = () => {
  // Clear previous errors
  Object.keys(errors).forEach((key) => {
    errors[key] = ''
  })

  let isValid = true

  // Username validation
  if (!form.username) {
    errors.username = '用户名不能为空'
    isValid = false
  } else if (form.username.length < 3) {
    errors.username = '用户名至少3个字符'
    isValid = false
  } else if (!/^[a-zA-Z0-9_-]+$/.test(form.username)) {
    errors.username = '用户名只能包含字母、数字、下划线和横线'
    isValid = false
  }

  // Email validation
  if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
    errors.email = '请输入有效的邮箱地址'
    isValid = false
  }

  // Full name validation
  if (form.fullName && form.fullName.length > 100) {
    errors.fullName = '全名不能超过100个字符'
    isValid = false
  }

  // Role validation
  if (!form.role) {
    errors.role = '请选择用户角色'
    isValid = false
  }

  // Password validation (only for new users)
  if (!props.user) {
    if (!form.password) {
      errors.password = '密码不能为空'
      isValid = false
    } else if (form.password.length < 8) {
      errors.password = '密码至少8个字符'
      isValid = false
    }

    if (!form.confirmPassword) {
      errors.confirmPassword = '请确认密码'
      isValid = false
    } else if (form.password !== form.confirmPassword) {
      errors.confirmPassword = '两次输入的密码不一致'
      isValid = false
    }
  }

  return isValid
}

const saveUser = async () => {
  if (!validateForm()) {
    return
  }

  saving.value = true
  try {
    let response
    const userData = {
      username: form.username,
      email: form.email || null,
      fullName: form.fullName || null,
      role: form.role,
      status: form.status,
      description: form.description || null
    }

    if (props.user) {
      // Update existing user
      response = await apiClient.put(`/admin/users/${props.user.id}`, userData)
    } else {
      // Create new user
      userData.password = form.password
      userData.authMethod = form.authMethod
      response = await apiClient.post('/admin/users', userData)
    }

    if (response.success) {
      ElMessage.success(props.user ? '用户更新成功' : '用户创建成功')
      emit('saved', response.data)
    } else {
      throw new Error(response.message || '保存失败')
    }
  } catch (error) {
    console.error('Failed to save user:', error)
    ElMessage.error(error.message || '保存用户失败')
  } finally {
    saving.value = false
  }
}

const closeModal = () => {
  emit('close')
}

// Watch for user prop changes
watch(
  () => props.user,
  () => {
    if (props.visible) {
      loadUserData()
    }
  },
  { immediate: true }
)

// Watch for modal visibility
watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      loadUserData()
    }
  }
)

// Lifecycle
onMounted(() => {
  if (props.visible) {
    loadUserData()
  }
})
</script>

<style scoped>
/* Custom styles for the modal */
</style>
