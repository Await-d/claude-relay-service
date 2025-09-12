<template>
  <div class="w-full max-w-md space-y-6">
    <!-- Logo and Header -->
    <div class="text-center">
      <div
        class="mx-auto mb-6 flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-gray-300/30 bg-gradient-to-br from-blue-500/20 to-purple-500/20 backdrop-blur-sm"
      >
        <template v-if="!oemLoading">
          <img
            v-if="oemSettings.siteIconData || oemSettings.siteIcon"
            alt="Logo"
            class="h-12 w-12 object-contain"
            :src="oemSettings.siteIconData || oemSettings.siteIcon"
            @error="(e) => (e.target.style.display = 'none')"
          />
          <i v-else class="fas fa-cloud text-3xl text-gray-700 dark:text-gray-300" />
        </template>
        <div v-else class="h-12 w-12 animate-pulse rounded bg-gray-300/50" />
      </div>

      <h1 class="header-title mb-2 text-3xl font-bold text-white">
        {{ oemSettings.siteName || 'Claude Relay Service' }}
      </h1>
      <p class="text-lg text-gray-600 dark:text-gray-400">管理后台</p>
    </div>

    <!-- Login Form -->
    <form class="space-y-6" @submit.prevent="handleSubmit">
      <!-- Username Field -->
      <div>
        <label class="mb-3 block text-sm font-semibold text-gray-900 dark:text-gray-100">
          用户名
        </label>
        <input
          v-model="form.username"
          class="form-input w-full"
          :disabled="loading"
          placeholder="请输入用户名"
          required
          type="text"
          @blur="validateUsername"
        />
        <div v-if="errors.username" class="mt-2 text-sm text-red-500 dark:text-red-400">
          <i class="fas fa-exclamation-triangle mr-1" />
          {{ errors.username }}
        </div>
      </div>

      <!-- Password Field -->
      <div>
        <label class="mb-3 block text-sm font-semibold text-gray-900 dark:text-gray-100">
          密码
        </label>
        <div class="relative">
          <input
            v-model="form.password"
            class="form-input w-full pr-12"
            :disabled="loading"
            placeholder="请输入密码"
            required
            :type="showPassword ? 'text' : 'password'"
            @blur="validatePassword"
          />
          <button
            class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            :disabled="loading"
            type="button"
            @click="showPassword = !showPassword"
          >
            <i :class="showPassword ? 'fas fa-eye-slash' : 'fas fa-eye'" />
          </button>
        </div>
        <div v-if="errors.password" class="mt-2 text-sm text-red-500 dark:text-red-400">
          <i class="fas fa-exclamation-triangle mr-1" />
          {{ errors.password }}
        </div>
      </div>

      <!-- Auth Method Selection (optional) -->
      <div v-if="showAuthMethod">
        <label class="mb-3 block text-sm font-semibold text-gray-900 dark:text-gray-100">
          认证方式
        </label>
        <select v-model="form.authMethod" class="form-input w-full" :disabled="loading">
          <option value="auto">自动检测</option>
          <option value="local">本地认证</option>
          <option value="ldap">LDAP认证</option>
        </select>
      </div>

      <!-- Submit Button -->
      <button
        class="btn btn-primary w-full px-6 py-4 text-lg font-semibold"
        :disabled="loading || !isFormValid"
        type="submit"
      >
        <div v-if="loading" class="loading-spinner mr-2" />
        <i v-else class="fas fa-sign-in-alt mr-2" />
        {{ loading ? '登录中...' : '登录' }}
      </button>
    </form>

    <!-- Error Message -->
    <div
      v-if="error"
      class="mt-6 rounded-xl border border-red-500/30 bg-red-500/20 p-4 text-center text-sm text-red-800 backdrop-blur-sm dark:text-red-400"
    >
      <i class="fas fa-exclamation-triangle mr-2" />
      {{ error }}
    </div>

    <!-- Advanced Options Toggle -->
    <div class="text-center">
      <button
        class="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        type="button"
        @click="showAuthMethod = !showAuthMethod"
      >
        <i class="fas fa-cog mr-1" />
        {{ showAuthMethod ? '隐藏高级选项' : '显示高级选项' }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'

// Props
// eslint-disable-next-line no-unused-vars
const props = defineProps({
  loading: {
    type: Boolean,
    default: false
  },
  error: {
    type: String,
    default: ''
  },
  oemSettings: {
    type: Object,
    default: () => ({
      siteName: 'Claude Relay Service',
      siteIcon: '',
      siteIconData: ''
    })
  },
  oemLoading: {
    type: Boolean,
    default: false
  }
})

// Emits
const emit = defineEmits(['submit'])

// Reactive state
const form = ref({
  username: '',
  password: '',
  authMethod: 'auto'
})

const showPassword = ref(false)
const showAuthMethod = ref(false)
const errors = ref({
  username: '',
  password: ''
})

// Computed
const isFormValid = computed(() => {
  return (
    form.value.username.length >= 3 &&
    form.value.password.length >= 1 &&
    !errors.value.username &&
    !errors.value.password
  )
})

// Validation functions
const validateUsername = () => {
  errors.value.username = ''

  if (!form.value.username) {
    errors.value.username = '用户名不能为空'
    return false
  }

  if (form.value.username.length < 3 || form.value.username.length > 50) {
    errors.value.username = '用户名长度必须在 3-50 个字符之间'
    return false
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(form.value.username)) {
    errors.value.username = '用户名只能包含字母、数字、下划线和连字符'
    return false
  }

  return true
}

const validatePassword = () => {
  errors.value.password = ''

  if (!form.value.password) {
    errors.value.password = '密码不能为空'
    return false
  }

  return true
}

// Form submission
const handleSubmit = () => {
  // Validate all fields
  const isUsernameValid = validateUsername()
  const isPasswordValid = validatePassword()

  if (isUsernameValid && isPasswordValid) {
    emit('submit', {
      username: form.value.username.trim(),
      password: form.value.password,
      authMethod: form.value.authMethod
    })
  }
}

// Clear errors when form values change
watch(
  () => form.value.username,
  () => {
    if (errors.value.username) {
      errors.value.username = ''
    }
  }
)

watch(
  () => form.value.password,
  () => {
    if (errors.value.password) {
      errors.value.password = ''
    }
  }
)

// Auto-focus on username field
onMounted(() => {
  // Focus on first input after a short delay to ensure DOM is ready
  setTimeout(() => {
    const usernameInput = document.querySelector('input[type="text"]')
    if (usernameInput) {
      usernameInput.focus()
    }
  }, 100)
})

// Expose methods for parent component
defineExpose({
  resetForm: () => {
    form.value = {
      username: '',
      password: '',
      authMethod: 'auto'
    }
    errors.value = {
      username: '',
      password: ''
    }
    showPassword.value = false
  },
  focusUsername: () => {
    const usernameInput = document.querySelector('input[type="text"]')
    if (usernameInput) {
      usernameInput.focus()
    }
  }
})
</script>

<style scoped>
/* Component-specific styles are inherited from global styles */
</style>
