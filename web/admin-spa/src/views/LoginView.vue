<template>
  <div class="flex min-h-screen items-center justify-center p-4 sm:p-6">
    <!-- 主题切换按钮 - 固定在右上角 -->
    <div class="fixed right-4 top-4 z-50">
      <ThemeToggle mode="dropdown" />
    </div>

    <!-- Session Manager for handling session logic -->
    <SessionManager
      :auto-refresh="true"
      :expires-at="authStore.expiresAt"
      :session-token="authStore.sessionToken"
      :show-indicator="false"
      @logout="handleLogout"
      @refresh-failed="handleRefreshFailed"
      @session-expired="handleSessionExpired"
      @session-refreshed="handleSessionRefresh"
    />

    <div
      class="glass-strong w-full max-w-md rounded-xl p-6 shadow-2xl sm:rounded-2xl sm:p-8 md:rounded-3xl md:p-10"
    >
      <!-- Login Form Component -->
      <LoginForm
        ref="loginFormRef"
        :error="authStore.loginError"
        :loading="authStore.loginLoading"
        :oem-loading="authStore.oemLoading"
        :oem-settings="authStore.oemSettings"
        @submit="handleLogin"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import ThemeToggle from '@/components/common/ThemeToggle.vue'
import LoginForm from '@/components/auth/LoginForm.vue'
import SessionManager from '@/components/auth/SessionManager.vue'

const authStore = useAuthStore()
const themeStore = useThemeStore()
const loginFormRef = ref(null)

onMounted(() => {
  // 初始化主题
  themeStore.initTheme()
  // 加载OEM设置
  authStore.loadOemSettings()
})

// 处理登录提交
const handleLogin = async (credentials) => {
  await authStore.login(credentials)
}

// 处理会话刷新
const handleSessionRefresh = async () => {
  try {
    const success = await authStore.refreshSession()
    if (!success) {
      console.warn('Session refresh failed')
    }
  } catch (error) {
    console.error('Session refresh error:', error)
  }
}

// 处理会话过期
const handleSessionExpired = () => {
  console.warn('Session expired')
  authStore.clearAuthState()

  // 重置登录表单
  if (loginFormRef.value) {
    loginFormRef.value.resetForm()
  }
}

// 处理刷新失败
const handleRefreshFailed = (error) => {
  console.error('Session refresh failed:', error)
  authStore.clearAuthState()

  // 重置登录表单
  if (loginFormRef.value) {
    loginFormRef.value.resetForm()
  }
}

// 处理登出
const handleLogout = () => {
  authStore.logout()

  // 重置登录表单
  if (loginFormRef.value) {
    loginFormRef.value.resetForm()
  }
}
</script>

<style scoped>
/* 组件特定样式已经在全局样式中定义 */
</style>
