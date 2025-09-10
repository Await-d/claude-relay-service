<template>
  <div class="session-manager">
    <!-- Session Status Indicator (minimal UI) -->
    <div v-if="showIndicator" class="session-indicator" :class="sessionStatusClass">
      <i class="text-sm" :class="sessionStatusIcon" />
      <span v-if="showStatusText" class="ml-2 text-sm">{{ sessionStatusText }}</span>
    </div>

    <!-- Session Refresh Modal (when manual refresh is needed) -->
    <div
      v-if="showRefreshModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      @click.self="hideRefreshModal"
    >
      <div class="glass-strong w-full max-w-md rounded-2xl p-6 shadow-2xl">
        <div class="mb-4 text-center">
          <i class="fas fa-clock mb-3 text-3xl text-yellow-500" />
          <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">会话即将过期</h3>
          <p class="mt-2 text-sm text-gray-600 dark:text-gray-400">
            您的会话将在 <strong>{{ formatTime(timeUntilExpiry) }}</strong> 后过期。
            是否要刷新会话？
          </p>
        </div>

        <div class="flex space-x-3">
          <button class="btn btn-outline flex-1" :disabled="refreshing" @click="logout">
            <i class="fas fa-sign-out-alt mr-2" />
            登出
          </button>
          <button class="btn btn-primary flex-1" :disabled="refreshing" @click="manualRefresh">
            <div v-if="refreshing" class="loading-spinner mr-2" />
            <i v-else class="fas fa-refresh mr-2" />
            {{ refreshing ? '刷新中...' : '刷新会话' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Session Expired Modal -->
    <div
      v-if="showExpiredModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
    >
      <div class="glass-strong w-full max-w-md rounded-2xl p-6 shadow-2xl">
        <div class="mb-6 text-center">
          <i class="fas fa-exclamation-triangle mb-3 text-3xl text-red-500" />
          <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">会话已过期</h3>
          <p class="mt-2 text-sm text-gray-600 dark:text-gray-400">您的会话已过期，请重新登录。</p>
        </div>

        <button class="btn btn-primary w-full" @click="redirectToLogin">
          <i class="fas fa-sign-in-alt mr-2" />
          重新登录
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'

// Props
const props = defineProps({
  // Session token from auth store
  sessionToken: {
    type: String,
    default: ''
  },
  // Session expiry time (ISO string or timestamp)
  expiresAt: {
    type: [String, Number],
    default: null
  },
  // Auto-refresh settings
  autoRefresh: {
    type: Boolean,
    default: true
  },
  refreshThreshold: {
    type: Number,
    default: 5 * 60 * 1000 // 5 minutes in ms
  },
  // UI settings
  showIndicator: {
    type: Boolean,
    default: false
  },
  showStatusText: {
    type: Boolean,
    default: false
  }
})

// Emits
const emit = defineEmits(['sessionRefreshed', 'sessionExpired', 'refreshFailed', 'logout'])

// Router
const router = useRouter()

// State
const refreshing = ref(false)
const showRefreshModal = ref(false)
const showExpiredModal = ref(false)
const currentTime = ref(Date.now())
const refreshTimer = ref(null)
const clockTimer = ref(null)
const lastRefreshAttempt = ref(0)

// Computed
const expiryTimestamp = computed(() => {
  if (!props.expiresAt) return null

  if (typeof props.expiresAt === 'string') {
    return new Date(props.expiresAt).getTime()
  }

  return props.expiresAt
})

const timeUntilExpiry = computed(() => {
  if (!expiryTimestamp.value) return 0
  return Math.max(0, expiryTimestamp.value - currentTime.value)
})

const isExpired = computed(() => {
  return timeUntilExpiry.value <= 0
})

const needsRefresh = computed(() => {
  return timeUntilExpiry.value > 0 && timeUntilExpiry.value <= props.refreshThreshold
})

const sessionStatus = computed(() => {
  if (!props.sessionToken) return 'none'
  if (isExpired.value) return 'expired'
  if (needsRefresh.value) return 'expiring'
  return 'active'
})

const sessionStatusClass = computed(() => {
  const baseClass = 'session-indicator'
  switch (sessionStatus.value) {
    case 'active':
      return `${baseClass} text-green-600 dark:text-green-400`
    case 'expiring':
      return `${baseClass} text-yellow-600 dark:text-yellow-400`
    case 'expired':
      return `${baseClass} text-red-600 dark:text-red-400`
    default:
      return `${baseClass} text-gray-500`
  }
})

const sessionStatusIcon = computed(() => {
  switch (sessionStatus.value) {
    case 'active':
      return 'fas fa-check-circle'
    case 'expiring':
      return 'fas fa-clock'
    case 'expired':
      return 'fas fa-times-circle'
    default:
      return 'fas fa-question-circle'
  }
})

const sessionStatusText = computed(() => {
  switch (sessionStatus.value) {
    case 'active':
      return '会话正常'
    case 'expiring':
      return `${formatTime(timeUntilExpiry.value)}后过期`
    case 'expired':
      return '会话已过期'
    default:
      return '未登录'
  }
})

// Methods
const formatTime = (ms) => {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}小时${minutes % 60}分钟`
  } else if (minutes > 0) {
    return `${minutes}分钟${seconds % 60}秒`
  } else {
    return `${seconds}秒`
  }
}

const startClockTimer = () => {
  if (clockTimer.value) {
    clearInterval(clockTimer.value)
  }

  clockTimer.value = setInterval(() => {
    currentTime.value = Date.now()
  }, 1000)
}

const stopClockTimer = () => {
  if (clockTimer.value) {
    clearInterval(clockTimer.value)
    clockTimer.value = null
  }
}

const scheduleRefresh = () => {
  if (refreshTimer.value) {
    clearTimeout(refreshTimer.value)
  }

  if (!expiryTimestamp.value || !props.autoRefresh) return

  const timeUntilRefresh = Math.max(0, expiryTimestamp.value - Date.now() - props.refreshThreshold)

  if (timeUntilRefresh > 0) {
    refreshTimer.value = setTimeout(() => {
      handleAutoRefresh()
    }, timeUntilRefresh)
  }
}

const handleAutoRefresh = async () => {
  if (refreshing.value || isExpired.value) return

  // Prevent too frequent refresh attempts
  const now = Date.now()
  if (now - lastRefreshAttempt.value < 30000) {
    // 30 seconds cooldown
    return
  }

  lastRefreshAttempt.value = now

  try {
    refreshing.value = true
    await refreshSession()
  } catch (error) {
    console.error('Auto refresh failed:', error)
    // Show manual refresh modal
    showRefreshModal.value = true
  } finally {
    refreshing.value = false
  }
}

const refreshSession = async () => {
  if (!props.sessionToken) {
    throw new Error('No session token available')
  }

  // This should be implemented by the parent component (AuthStore)
  emit('sessionRefreshed')
}

const manualRefresh = async () => {
  try {
    refreshing.value = true
    await refreshSession()
    hideRefreshModal()
  } catch (error) {
    console.error('Manual refresh failed:', error)
    emit('refreshFailed', error)
  } finally {
    refreshing.value = false
  }
}

const hideRefreshModal = () => {
  showRefreshModal.value = false
}

const logout = () => {
  hideRefreshModal()
  emit('logout')
}

const redirectToLogin = () => {
  showExpiredModal.value = false
  router.push('/login')
}

// Watch for session changes
watch(
  () => props.sessionToken,
  (newToken, oldToken) => {
    if (newToken !== oldToken) {
      if (newToken) {
        scheduleRefresh()
        if (!clockTimer.value) {
          startClockTimer()
        }
      } else {
        stopClockTimer()
        if (refreshTimer.value) {
          clearTimeout(refreshTimer.value)
        }
      }
    }
  },
  { immediate: true }
)

watch(
  () => props.expiresAt,
  () => {
    scheduleRefresh()
  }
)

watch(isExpired, (expired) => {
  if (expired && props.sessionToken) {
    showExpiredModal.value = true
    emit('sessionExpired')
  }
})

watch(needsRefresh, (needs) => {
  if (needs && props.autoRefresh && !refreshing.value) {
    handleAutoRefresh()
  }
})

// Lifecycle
onMounted(() => {
  if (props.sessionToken) {
    startClockTimer()
    scheduleRefresh()
  }
})

onUnmounted(() => {
  stopClockTimer()
  if (refreshTimer.value) {
    clearTimeout(refreshTimer.value)
  }
})

// Expose methods
defineExpose({
  refreshSession,
  formatTime,
  timeUntilExpiry,
  sessionStatus
})
</script>

<style scoped>
.session-indicator {
  @apply inline-flex items-center rounded-lg px-2 py-1 text-sm font-medium;
}

.loading-spinner {
  @apply inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white;
}

/* Smooth transitions for modals */
.session-manager .fixed {
  animation: fadeIn 0.3s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
</style>
