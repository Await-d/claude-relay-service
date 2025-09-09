<template>
  <div
    v-if="visible"
    class="fixed inset-0 z-50 overflow-y-auto"
    aria-labelledby="modal-title"
    role="dialog"
    aria-modal="true"
  >
    <!-- Backdrop -->
    <div class="flex min-h-screen items-end justify-center px-4 pt-4 pb-20 text-center sm:block sm:p-0">
      <div
        class="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity dark:bg-gray-900 dark:bg-opacity-80"
        aria-hidden="true"
        @click="closeModal"
      ></div>

      <!-- Modal positioning -->
      <span class="hidden sm:inline-block sm:h-screen sm:align-middle" aria-hidden="true">&#8203;</span>

      <!-- Modal content -->
      <div class="relative inline-block transform overflow-hidden rounded-lg bg-white text-left align-bottom shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg sm:align-middle dark:bg-gray-800">
        <!-- Header -->
        <div class="bg-white px-6 pt-6 pb-4 dark:bg-gray-800">
          <div class="flex items-center justify-between">
            <div class="flex items-center">
              <div class="mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-orange-100 sm:mx-0 sm:h-10 sm:w-10 dark:bg-orange-900/30">
                <i class="fas fa-key h-6 w-6 text-orange-600 dark:text-orange-400"></i>
              </div>
              <div class="ml-4">
                <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100" id="modal-title">
                  重置密码
                </h3>
                <p class="text-sm text-gray-500 dark:text-gray-400">
                  为用户 "{{ user?.username }}" 重置密码
                </p>
              </div>
            </div>
            <button
              type="button"
              class="rounded-md text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-gray-500 dark:hover:text-gray-400"
              @click="closeModal"
            >
              <span class="sr-only">关闭</span>
              <i class="fas fa-times h-6 w-6"></i>
            </button>
          </div>
        </div>

        <!-- Content -->
        <form @submit.prevent="resetPassword">
          <div class="bg-white px-6 pb-6 dark:bg-gray-800">
            <!-- Warning message -->
            <div class="mb-6 rounded-md bg-yellow-50 p-4 dark:bg-yellow-900/20">
              <div class="flex">
                <div class="flex-shrink-0">
                  <i class="fas fa-exclamation-triangle h-5 w-5 text-yellow-400"></i>
                </div>
                <div class="ml-3">
                  <h3 class="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                    密码重置警告
                  </h3>
                  <div class="mt-2 text-sm text-yellow-700 dark:text-yellow-300">
                    <ul class="list-disc space-y-1 pl-5">
                      <li>重置后用户需要使用新密码重新登录</li>
                      <li>所有现有会话将被终止</li>
                      <li>建议立即通知用户新密码</li>
                      <li v-if="user?.authMethod === 'ldap'">LDAP用户无法重置本地密码</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            <!-- LDAP User Warning -->
            <div v-if="user?.authMethod === 'ldap'" class="mb-6 rounded-md bg-red-50 p-4 dark:bg-red-900/20">
              <div class="flex">
                <div class="flex-shrink-0">
                  <i class="fas fa-ban h-5 w-5 text-red-400"></i>
                </div>
                <div class="ml-3">
                  <h3 class="text-sm font-medium text-red-800 dark:text-red-200">
                    无法重置LDAP用户密码
                  </h3>
                  <div class="mt-2 text-sm text-red-700 dark:text-red-300">
                    该用户使用LDAP认证，密码需要在LDAP服务器上进行管理。
                  </div>
                </div>
              </div>
            </div>

            <!-- Reset options for local users -->
            <div v-if="user?.authMethod === 'local'">
              <!-- Reset method -->
              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  重置方式
                </label>
                <div class="space-y-2">
                  <label class="flex items-center">
                    <input
                      v-model="resetMethod"
                      type="radio"
                      value="generate"
                      class="h-4 w-4 text-indigo-600 border-gray-300 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700"
                    />
                    <span class="ml-2 text-sm text-gray-700 dark:text-gray-300">生成随机密码</span>
                  </label>
                  <label class="flex items-center">
                    <input
                      v-model="resetMethod"
                      type="radio"
                      value="custom"
                      class="h-4 w-4 text-indigo-600 border-gray-300 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700"
                    />
                    <span class="ml-2 text-sm text-gray-700 dark:text-gray-300">设置自定义密码</span>
                  </label>
                </div>
              </div>

              <!-- Generated password preview -->
              <div v-if="resetMethod === 'generate'" class="mb-4">
                <div class="flex items-center justify-between mb-2">
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    新密码（预览）
                  </label>
                  <button
                    type="button"
                    @click="generatePassword"
                    class="text-sm text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                  >
                    <i class="fas fa-sync-alt mr-1"></i>
                    重新生成
                  </button>
                </div>
                <div class="relative">
                  <input
                    v-model="generatedPassword"
                    :type="showPassword ? 'text' : 'password'"
                    readonly
                    class="w-full px-3 py-2 pr-20 border border-gray-300 rounded-lg shadow-sm bg-gray-50 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
                  />
                  <div class="absolute inset-y-0 right-0 flex items-center">
                    <button
                      type="button"
                      class="px-3 py-2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                      @click="showPassword = !showPassword"
                    >
                      <i :class="['fas', showPassword ? 'fa-eye-slash' : 'fa-eye']"></i>
                    </button>
                    <button
                      type="button"
                      class="px-3 py-2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                      @click="copyPassword"
                      title="复制密码"
                    >
                      <i class="fas fa-copy"></i>
                    </button>
                  </div>
                </div>
                <p class="mt-1 text-xs text-gray-500">系统会生成包含字母、数字和特殊字符的安全密码</p>
              </div>

              <!-- Custom password input -->
              <div v-if="resetMethod === 'custom'">
                <div class="mb-4">
                  <label for="customPassword" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    新密码 <span class="text-red-500">*</span>
                  </label>
                  <div class="relative">
                    <input
                      id="customPassword"
                      v-model="form.password"
                      :type="showPassword ? 'text' : 'password'"
                      required
                      class="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400"
                      :class="{ 'border-red-300 focus:border-red-500 focus:ring-red-500': errors.password }"
                      placeholder="输入新密码"
                    />
                    <button
                      type="button"
                      class="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                      @click="showPassword = !showPassword"
                    >
                      <i :class="['fas', showPassword ? 'fa-eye-slash' : 'fa-eye']"></i>
                    </button>
                  </div>
                  <p v-if="errors.password" class="mt-1 text-xs text-red-600">{{ errors.password }}</p>
                  <p class="mt-1 text-xs text-gray-500">密码至少8个字符，建议包含字母、数字和特殊字符</p>
                </div>

                <div class="mb-4">
                  <label for="confirmPassword" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    确认密码 <span class="text-red-500">*</span>
                  </label>
                  <input
                    id="confirmPassword"
                    v-model="form.confirmPassword"
                    :type="showPassword ? 'text' : 'password'"
                    required
                    class="w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400"
                    :class="{ 'border-red-300 focus:border-red-500 focus:ring-red-500': errors.confirmPassword }"
                    placeholder="再次输入新密码"
                  />
                  <p v-if="errors.confirmPassword" class="mt-1 text-xs text-red-600">{{ errors.confirmPassword }}</p>
                </div>
              </div>

              <!-- Options -->
              <div class="mb-4">
                <div class="flex items-center">
                  <input
                    id="forceLogout"
                    v-model="form.forceLogout"
                    type="checkbox"
                    class="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700"
                  />
                  <label for="forceLogout" class="ml-2 text-sm text-gray-700 dark:text-gray-300">
                    强制用户退出所有会话
                  </label>
                </div>
              </div>

              <div class="mb-4">
                <div class="flex items-center">
                  <input
                    id="requireChange"
                    v-model="form.requireChange"
                    type="checkbox"
                    class="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700"
                  />
                  <label for="requireChange" class="ml-2 text-sm text-gray-700 dark:text-gray-300">
                    要求用户首次登录时修改密码
                  </label>
                </div>
              </div>
            </div>

            <!-- Contact info for notification -->
            <div v-if="user?.authMethod === 'local' && user?.email" class="mb-4">
              <div class="flex items-center">
                <input
                  id="sendEmail"
                  v-model="form.sendEmail"
                  type="checkbox"
                  class="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700"
                />
                <label for="sendEmail" class="ml-2 text-sm text-gray-700 dark:text-gray-300">
                  发送邮件通知到 {{ user.email }}
                </label>
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div class="bg-gray-50 px-6 py-3 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end dark:bg-gray-700">
            <button
              type="button"
              class="inline-flex justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 sm:w-auto dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              @click="closeModal"
            >
              取消
            </button>
            <button
              v-if="user?.authMethod === 'local'"
              type="submit"
              :disabled="resetting"
              class="inline-flex justify-center rounded-md border border-transparent bg-gradient-to-r from-orange-500 to-orange-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:from-orange-600 hover:to-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed sm:w-auto"
            >
              <i v-if="resetting" class="fas fa-spinner fa-spin mr-2"></i>
              {{ resetting ? '重置中...' : '确认重置' }}
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
const emit = defineEmits(['close', 'reset'])

// Reactive state
const resetting = ref(false)
const showPassword = ref(false)
const resetMethod = ref('generate')
const generatedPassword = ref('')

// Form data
const form = reactive({
  password: '',
  confirmPassword: '',
  forceLogout: true,
  requireChange: false,
  sendEmail: false
})

// Validation errors
const errors = reactive({
  password: '',
  confirmPassword: ''
})

// Methods
const generatePassword = () => {
  // Generate a secure random password
  const length = 12
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*'
  let password = ''
  
  // Ensure at least one character from each type
  password += 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)]
  password += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(Math.random() * 26)]
  password += '0123456789'[Math.floor(Math.random() * 10)]
  password += '!@#$%^&*'[Math.floor(Math.random() * 8)]
  
  // Fill the rest randomly
  for (let i = 4; i < length; i++) {
    password += charset[Math.floor(Math.random() * charset.length)]
  }
  
  // Shuffle the password
  generatedPassword.value = password.split('').sort(() => 0.5 - Math.random()).join('')
}

const copyPassword = async () => {
  try {
    await navigator.clipboard.writeText(generatedPassword.value)
    ElMessage.success('密码已复制到剪贴板')
  } catch (error) {
    console.error('Failed to copy password:', error)
    ElMessage.error('复制失败，请手动选择复制')
  }
}

const validateForm = () => {
  // Clear previous errors
  Object.keys(errors).forEach(key => {
    errors[key] = ''
  })
  
  if (resetMethod.value === 'custom') {
    let isValid = true
    
    // Password validation
    if (!form.password) {
      errors.password = '密码不能为空'
      isValid = false
    } else if (form.password.length < 8) {
      errors.password = '密码至少8个字符'
      isValid = false
    }
    
    // Confirm password validation
    if (!form.confirmPassword) {
      errors.confirmPassword = '请确认密码'
      isValid = false
    } else if (form.password !== form.confirmPassword) {
      errors.confirmPassword = '两次输入的密码不一致'
      isValid = false
    }
    
    return isValid
  }
  
  return true
}

const resetPassword = async () => {
  if (props.user?.authMethod === 'ldap') {
    ElMessage.error('无法重置LDAP用户密码')
    return
  }
  
  if (!validateForm()) {
    return
  }
  
  resetting.value = true
  try {
    const resetData = {
      method: resetMethod.value,
      password: resetMethod.value === 'custom' ? form.password : generatedPassword.value,
      forceLogout: form.forceLogout,
      requireChange: form.requireChange,
      sendEmail: form.sendEmail && !!props.user?.email
    }
    
    const response = await apiClient.post(`/admin/users/${props.user.id}/reset-password`, resetData)
    
    if (response.success) {
      ElMessage.success('密码重置成功')
      
      // Show the new password if generated
      if (resetMethod.value === 'generate') {
        ElMessage({
          message: `新密码: ${generatedPassword.value}`,
          type: 'info',
          duration: 0,
          showClose: true,
          dangerouslyUseHTMLString: false
        })
      }
      
      emit('reset', {
        userId: props.user.id,
        newPassword: resetMethod.value === 'generate' ? generatedPassword.value : null
      })
    } else {
      throw new Error(response.message || '重置失败')
    }
  } catch (error) {
    console.error('Failed to reset password:', error)
    ElMessage.error(error.message || '密码重置失败')
  } finally {
    resetting.value = false
  }
}

const resetForm = () => {
  form.password = ''
  form.confirmPassword = ''
  form.forceLogout = true
  form.requireChange = false
  form.sendEmail = false
  
  // Clear errors
  Object.keys(errors).forEach(key => {
    errors[key] = ''
  })
  
  resetMethod.value = 'generate'
  showPassword.value = false
  generatePassword()
}

const closeModal = () => {
  emit('close')
}

// Watch for user changes
watch(
  () => props.user,
  () => {
    if (props.visible && props.user) {
      resetForm()
    }
  },
  { immediate: true }
)

// Watch for modal visibility
watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      resetForm()
    }
  }
)

// Lifecycle
onMounted(() => {
  if (props.visible) {
    resetForm()
  }
})
</script>

<style scoped>
/* Custom styles for the modal */
</style>