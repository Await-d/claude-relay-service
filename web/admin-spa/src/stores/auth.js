import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import router from '@/router'
import { apiClient } from '@/config/api'

export const useAuthStore = defineStore('auth', () => {
  // 状态
  const isLoggedIn = ref(false)
  const authToken = ref(localStorage.getItem('authToken') || '')
  const sessionToken = ref(localStorage.getItem('sessionToken') || '')
  const sessionId = ref('')
  const expiresAt = ref(null)
  const user = ref(null)
  const loginError = ref('')
  const loginLoading = ref(false)
  const refreshing = ref(false)
  const oemSettings = ref({
    siteName: 'Claude Relay Service',
    siteIcon: '',
    siteIconData: '',
    faviconData: ''
  })
  const oemLoading = ref(true)
  
  // 向后兼容
  const username = computed(() => user.value?.username || '')

  // 计算属性
  const isAuthenticated = computed(() => !!sessionToken.value && !!user.value)
  const token = computed(() => sessionToken.value) // 主要使用sessionToken
  const legacyToken = computed(() => authToken.value) // 向后兼容旧的authToken

  // 方法
  async function login(credentials) {
    loginLoading.value = true
    loginError.value = ''

    try {
      // 使用新的认证API端点
      const result = await apiClient.post('/auth/login', credentials)

      if (result.success && result.data) {
        const { sessionToken: token, sessionId: id, expiresAt: expiry, user: userData } = result.data
        
        // 更新状态
        sessionToken.value = token
        sessionId.value = id
        expiresAt.value = expiry
        user.value = userData
        isLoggedIn.value = true
        
        // 保存到localStorage
        localStorage.setItem('sessionToken', token)
        localStorage.setItem('sessionId', id)
        if (expiry) {
          localStorage.setItem('expiresAt', expiry)
        }
        
        // 向后兼容：同时保存到authToken
        authToken.value = token
        localStorage.setItem('authToken', token)

        await router.push('/dashboard')
      } else {
        loginError.value = result.message || '登录失败'
      }
    } catch (error) {
      loginError.value = error.message || '登录失败，请检查用户名和密码'
    } finally {
      loginLoading.value = false
    }
  }

  async function logout() {
    try {
      // 调用后端登出API
      if (sessionToken.value) {
        await apiClient.post('/auth/logout')
      }
    } catch (error) {
      console.warn('Logout API call failed:', error.message)
    }
    
    // 清理本地状态
    clearAuthState()
    
    // 跳转到登录页
    router.push('/login')
  }
  
  function clearAuthState() {
    isLoggedIn.value = false
    authToken.value = ''
    sessionToken.value = ''
    sessionId.value = ''
    expiresAt.value = null
    user.value = null
    
    // 清理localStorage
    localStorage.removeItem('authToken')
    localStorage.removeItem('sessionToken')
    localStorage.removeItem('sessionId')
    localStorage.removeItem('expiresAt')
  }

  function checkAuth() {
    // 从localStorage恢复会话状态
    const storedSessionToken = localStorage.getItem('sessionToken')
    const storedSessionId = localStorage.getItem('sessionId')
    const storedExpiresAt = localStorage.getItem('expiresAt')
    
    if (storedSessionToken) {
      sessionToken.value = storedSessionToken
      sessionId.value = storedSessionId || ''
      expiresAt.value = storedExpiresAt
      
      // 向后兼容
      authToken.value = storedSessionToken
      
      // 检查会话是否过期
      if (storedExpiresAt && new Date(storedExpiresAt) <= new Date()) {
        clearAuthState()
        return
      }
      
      isLoggedIn.value = true
      // 验证token有效性
      verifySession()
    } else if (authToken.value) {
      // 向后兼容旧的authToken
      sessionToken.value = authToken.value
      isLoggedIn.value = true
      verifySession()
    }
  }

  async function verifySession() {
    try {
      // 使用新的会话验证端点
      const result = await apiClient.get('/auth/validate')
      
      if (result.success && result.data) {
        user.value = result.data.user
        // 会话有效，更新状态
        isLoggedIn.value = true
      } else {
        throw new Error('Session validation failed')
      }
    } catch (error) {
      console.warn('Session validation failed:', error.message)
      clearAuthState()
      router.push('/login')
    }
  }

  // 刷新会话
  async function refreshSession() {
    if (refreshing.value || !sessionToken.value) {
      return false
    }
    
    refreshing.value = true
    
    try {
      const result = await apiClient.post('/auth/refresh')
      
      if (result.success && result.data) {
        const { sessionToken: newToken, sessionId: newId, expiresAt: newExpiry, user: userData } = result.data
        
        // 更新状态
        sessionToken.value = newToken
        sessionId.value = newId
        expiresAt.value = newExpiry
        user.value = userData
        
        // 更新localStorage
        localStorage.setItem('sessionToken', newToken)
        localStorage.setItem('sessionId', newId)
        if (newExpiry) {
          localStorage.setItem('expiresAt', newExpiry)
        }
        
        // 向后兼容
        authToken.value = newToken
        localStorage.setItem('authToken', newToken)
        
        return true
      } else {
        throw new Error(result.message || 'Session refresh failed')
      }
    } catch (error) {
      console.error('Session refresh failed:', error.message)
      clearAuthState()
      router.push('/login')
      return false
    } finally {
      refreshing.value = false
    }
  }
  
  // 修改密码
  async function changePassword(oldPassword, newPassword) {
    try {
      const result = await apiClient.post('/auth/change-password', {
        oldPassword,
        newPassword
      })
      
      if (result.success) {
        return { success: true, message: result.message }
      } else {
        throw new Error(result.message || 'Password change failed')
      }
    } catch (error) {
      throw new Error(error.message || 'Password change failed')
    }
  }

  async function loadOemSettings() {
    oemLoading.value = true
    try {
      const result = await apiClient.get('/admin/oem-settings')
      if (result.success && result.data) {
        oemSettings.value = { ...oemSettings.value, ...result.data }

        // 设置favicon
        if (result.data.siteIconData || result.data.siteIcon) {
          const link = document.querySelector("link[rel*='icon']") || document.createElement('link')
          link.type = 'image/x-icon'
          link.rel = 'shortcut icon'
          link.href = result.data.siteIconData || result.data.siteIcon
          document.getElementsByTagName('head')[0].appendChild(link)
        }

        // 设置页面标题
        if (result.data.siteName) {
          document.title = `${result.data.siteName} - 管理后台`
        }
      }
    } catch (error) {
      console.error('加载OEM设置失败:', error)
    } finally {
      oemLoading.value = false
    }
  }
  
  return {
    // 状态
    isLoggedIn,
    authToken,
    sessionToken,
    sessionId,
    expiresAt,
    user,
    username, // 计算属性
    loginError,
    loginLoading,
    refreshing,
    oemSettings,
    oemLoading,

    // 计算属性
    isAuthenticated,
    token,
    legacyToken,

    // 方法
    login,
    logout,
    checkAuth,
    verifySession,
    refreshSession,
    changePassword,
    clearAuthState,
    loadOemSettings
  }
})