<template>
  <!-- 顶部导航 -->
  <div
    class="glass-strong mb-4 rounded-xl p-3 shadow-xl sm:mb-6 sm:rounded-2xl sm:p-4 md:mb-8 md:rounded-3xl md:p-6"
    style="z-index: 10; position: relative"
  >
    <div class="flex flex-col items-center justify-between gap-3 sm:flex-row sm:gap-4">
      <div
        class="flex w-full items-center justify-center gap-2 sm:w-auto sm:justify-start sm:gap-3 md:gap-4"
      >
        <LogoTitle
          :loading="oemLoading"
          :logo-src="oemSettings.siteIconData || oemSettings.siteIcon"
          subtitle="管理后台"
          :title="oemSettings.siteName"
          title-class="text-white dark:text-gray-100"
        >
          <template #after-title>
            <!-- 版本信息 -->
            <div class="flex items-center gap-1 sm:gap-2">
              <span class="font-mono text-xs text-gray-400 dark:text-gray-500 sm:text-sm"
                >v{{ versionInfo.current || '...' }}</span
              >
              <!-- 更新提示 -->
              <a
                v-if="versionInfo.hasUpdate"
                class="inline-flex animate-pulse items-center gap-1 rounded-full border border-green-600 bg-green-500 px-2 py-0.5 text-xs text-white transition-colors hover:bg-green-600"
                :href="versionInfo.releaseInfo?.htmlUrl || '#'"
                target="_blank"
                title="有新版本可用"
              >
                <i class="fas fa-arrow-up text-[10px]" />
                <span>新版本</span>
              </a>
            </div>
          </template>
        </LogoTitle>
      </div>
      <!-- 主题切换和用户菜单 -->
      <div class="flex items-center gap-2 sm:gap-4">
        <!-- 主题切换按钮 -->
        <div class="flex items-center">
          <ThemeToggle mode="dropdown" />
        </div>

        <!-- Session 状态指示器 -->
        <div
          v-if="sessionToken"
          class="hidden items-center gap-1.5 rounded-lg px-2 py-1 sm:flex"
          :class="sessionStatusClass"
          :title="sessionStatusText"
        >
          <i class="text-xs" :class="sessionStatusIcon" />
          <span class="hidden text-xs font-medium md:inline">{{ sessionStatusShortText }}</span>
        </div>

        <!-- 分隔线 -->
        <div
          class="h-8 w-px bg-gradient-to-b from-transparent via-gray-300 to-transparent opacity-50 dark:via-gray-600"
        />

        <!-- 用户菜单 -->
        <div class="user-menu-container relative">
          <button
            class="user-menu-button flex items-center gap-2 rounded-2xl bg-gradient-to-r from-blue-500 to-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-lg transition-all duration-200 hover:scale-105 hover:shadow-xl active:scale-95 sm:px-4 sm:py-2.5"
            @click="userMenuOpen = !userMenuOpen"
          >
            <i class="fas fa-user-circle text-sm sm:text-base" />
            <span class="hidden sm:inline">{{ currentUser.username || 'Admin' }}</span>
            <span v-if="currentUser.role" class="hidden text-xs opacity-75 lg:inline">
              ({{ currentUser.role === 'admin' ? '管理员' : '用户' }})
            </span>
            <i
              class="fas fa-chevron-down ml-1 text-xs transition-transform duration-200"
              :class="{ 'rotate-180': userMenuOpen }"
            />
          </button>

          <!-- 悬浮菜单 -->
          <div
            v-if="userMenuOpen"
            class="user-menu-dropdown absolute right-0 top-full mt-2 w-48 rounded-xl border border-gray-200 bg-white py-2 shadow-xl dark:border-gray-700 dark:bg-gray-800 sm:w-56"
            style="z-index: 999999"
            @click.stop
          >
            <!-- 用户信息 -->
            <div class="border-b border-gray-100 px-4 py-3 dark:border-gray-700">
              <div class="mb-3 flex items-center gap-3">
                <div
                  class="flex h-10 w-10 items-center justify-center rounded-full"
                  :class="
                    currentUser.role === 'admin'
                      ? 'bg-gradient-to-br from-purple-500 to-pink-500'
                      : 'bg-gradient-to-br from-blue-500 to-indigo-500'
                  "
                >
                  <i class="fas fa-user text-sm text-white" />
                </div>
                <div>
                  <div class="font-semibold text-gray-900 dark:text-gray-100">
                    {{ currentUser.username || 'Admin' }}
                  </div>
                  <div class="text-xs text-gray-500 dark:text-gray-400">
                    {{ currentUser.role === 'admin' ? '系统管理员' : '普通用户' }}
                  </div>
                </div>
              </div>
            </div>

            <!-- 版本信息 -->
            <div class="border-b border-gray-100 px-4 py-3 dark:border-gray-700">
              <div class="flex items-center justify-between text-sm">
                <span class="text-gray-500 dark:text-gray-400">当前版本</span>
                <span class="font-mono text-gray-700 dark:text-gray-300"
                  >v{{ versionInfo.current || '...' }}</span
                >
              </div>
              <div v-if="versionInfo.hasUpdate" class="mt-2">
                <div class="mb-2 flex items-center justify-between text-sm">
                  <span class="font-medium text-green-600 dark:text-green-400">
                    <i class="fas fa-arrow-up mr-1" />有新版本
                  </span>
                  <span class="font-mono text-green-600 dark:text-green-400"
                    >v{{ versionInfo.latest }}</span
                  >
                </div>
                <a
                  class="block w-full rounded-lg bg-green-500 px-3 py-1.5 text-center text-sm text-white transition-colors hover:bg-green-600"
                  :href="versionInfo.releaseInfo?.htmlUrl || '#'"
                  target="_blank"
                >
                  <i class="fas fa-external-link-alt mr-1" />查看更新
                </a>
              </div>
              <div
                v-else-if="versionInfo.checkingUpdate"
                class="mt-2 text-center text-xs text-gray-500 dark:text-gray-400"
              >
                <i class="fas fa-spinner fa-spin mr-1" />检查更新中...
              </div>
              <div v-else class="mt-2 text-center">
                <!-- 已是最新版提醒 -->
                <transition mode="out-in" name="fade">
                  <div
                    v-if="versionInfo.noUpdateMessage"
                    key="message"
                    class="inline-block rounded-lg border border-green-200 bg-green-100 px-3 py-1.5 dark:border-green-800 dark:bg-green-900/30"
                  >
                    <p class="text-xs font-medium text-green-700 dark:text-green-400">
                      <i class="fas fa-check-circle mr-1" />当前已是最新版本
                    </p>
                  </div>
                  <button
                    v-else
                    key="button"
                    class="text-xs text-blue-500 transition-colors hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                    @click="checkForUpdates()"
                  >
                    <i class="fas fa-sync-alt mr-1" />检查更新
                  </button>
                </transition>
              </div>
            </div>

            <!-- 快捷导航菜单（仅管理员可见） -->
            <div
              v-if="currentUser.role === 'admin'"
              class="border-b border-gray-200 dark:border-gray-700"
            >
              <div class="px-4 py-2">
                <p class="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">管理功能</p>
                <div class="space-y-1">
                  <button
                    class="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700"
                    @click="navigateToUsers"
                  >
                    <i class="fas fa-user-friends w-4 text-xs text-blue-500" />
                    <span>用户管理</span>
                  </button>
                  <button
                    class="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700"
                    @click="navigateToUserGroups"
                  >
                    <i class="fas fa-users-cog w-4 text-xs text-purple-500" />
                    <span>用户组管理</span>
                  </button>
                  <button
                    class="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700"
                    @click="navigateToSettings"
                  >
                    <i class="fas fa-cogs w-4 text-xs text-gray-500" />
                    <span>系统设置</span>
                  </button>
                </div>
              </div>
            </div>

            <button
              class="flex w-full items-center gap-3 px-4 py-3 text-left text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700"
              @click="openChangePasswordModal"
            >
              <i class="fas fa-key text-blue-500" />
              <span>修改账户信息</span>
            </button>

            <hr class="my-2 border-gray-200 dark:border-gray-700" />

            <button
              class="flex w-full items-center gap-3 px-4 py-3 text-left text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700"
              @click="logout"
            >
              <i class="fas fa-sign-out-alt text-red-500" />
              <span>退出登录</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 修改账户信息模态框 -->
  <div
    v-if="showChangePasswordModal"
    class="modal fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4"
  >
    <div class="modal-content mx-auto flex max-h-[90vh] w-full max-w-md flex-col p-4 sm:p-6 md:p-8">
      <div class="mb-6 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div
            class="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-600"
          >
            <i class="fas fa-key text-white" />
          </div>
          <h3 class="text-xl font-bold text-gray-900 dark:text-gray-100">修改账户信息</h3>
        </div>
        <button
          class="text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300"
          @click="closeChangePasswordModal"
        >
          <i class="fas fa-times text-xl" />
        </button>
      </div>

      <form
        class="modal-scroll-content custom-scrollbar flex-1 space-y-6"
        @submit.prevent="changePassword"
      >
        <div>
          <label class="mb-3 block text-sm font-semibold text-gray-700 dark:text-gray-300"
            >当前用户名</label
          >
          <input
            class="form-input w-full cursor-not-allowed bg-gray-100 dark:bg-gray-700 dark:text-gray-300"
            disabled
            type="text"
            :value="currentUser.username || 'Admin'"
          />
          <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
            当前用户名，输入新用户名以修改
          </p>
        </div>

        <div>
          <label class="mb-3 block text-sm font-semibold text-gray-700 dark:text-gray-300"
            >新用户名</label
          >
          <input
            v-model="changePasswordForm.newUsername"
            class="form-input w-full"
            placeholder="输入新用户名（留空保持不变）"
            type="text"
          />
          <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">留空表示不修改用户名</p>
        </div>

        <div>
          <label class="mb-3 block text-sm font-semibold text-gray-700 dark:text-gray-300"
            >当前密码</label
          >
          <input
            v-model="changePasswordForm.currentPassword"
            class="form-input w-full"
            placeholder="请输入当前密码"
            required
            type="password"
          />
        </div>

        <div>
          <label class="mb-3 block text-sm font-semibold text-gray-700 dark:text-gray-300"
            >新密码</label
          >
          <input
            v-model="changePasswordForm.newPassword"
            class="form-input w-full"
            placeholder="请输入新密码"
            required
            type="password"
          />
          <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">密码长度至少8位</p>
        </div>

        <div>
          <label class="mb-3 block text-sm font-semibold text-gray-700 dark:text-gray-300"
            >确认新密码</label
          >
          <input
            v-model="changePasswordForm.confirmPassword"
            class="form-input w-full"
            placeholder="请再次输入新密码"
            required
            type="password"
          />
        </div>

        <div class="flex gap-3 pt-4">
          <button
            class="flex-1 rounded-xl bg-gray-100 px-6 py-3 font-semibold text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
            type="button"
            @click="closeChangePasswordModal"
          >
            取消
          </button>
          <button
            class="btn btn-primary flex-1 px-6 py-3 font-semibold"
            :disabled="changePasswordLoading"
            type="submit"
          >
            <div v-if="changePasswordLoading" class="loading-spinner mr-2" />
            <i v-else class="fas fa-save mr-2" />
            {{ changePasswordLoading ? '保存中...' : '保存修改' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { showToast } from '@/utils/toast'
import { apiClient } from '@/config/api'
import LogoTitle from '@/components/common/LogoTitle.vue'
import ThemeToggle from '@/components/common/ThemeToggle.vue'

// Props
const props = defineProps({
  sessionToken: {
    type: String,
    default: ''
  },
  expiresAt: {
    type: [String, Number],
    default: null
  }
})

// Emits
const emit = defineEmits(['logout'])

const router = useRouter()
const authStore = useAuthStore()

// 当前用户信息
const currentUser = computed(() => authStore.user || { username: 'Admin' })

// OEM设置
const oemSettings = computed(() => authStore.oemSettings || {})
const oemLoading = computed(() => authStore.oemLoading)

// Session 状态计算
const currentTime = ref(Date.now())
const refreshThreshold = 5 * 60 * 1000 // 5 minutes

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
  return timeUntilExpiry.value > 0 && timeUntilExpiry.value <= refreshThreshold
})

const sessionStatus = computed(() => {
  if (!props.sessionToken) return 'none'
  if (isExpired.value) return 'expired'
  if (needsRefresh.value) return 'expiring'
  return 'active'
})

const sessionStatusClass = computed(() => {
  switch (sessionStatus.value) {
    case 'active':
      return 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400'
    case 'expiring':
      return 'bg-yellow-50 text-yellow-600 dark:bg-yellow-900/20 dark:text-yellow-400'
    case 'expired':
      return 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400'
    default:
      return 'bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
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
      return `会话即将过期 (${formatTime(timeUntilExpiry.value)})`
    case 'expired':
      return '会话已过期'
    default:
      return '未登录'
  }
})

const sessionStatusShortText = computed(() => {
  switch (sessionStatus.value) {
    case 'active':
      return '已连接'
    case 'expiring':
      return '即将过期'
    case 'expired':
      return '已过期'
    default:
      return '离线'
  }
})

// 格式化时间
const formatTime = (ms) => {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}小时${minutes % 60}分钟`
  } else if (minutes > 0) {
    return `${minutes}分钟`
  } else {
    return `${seconds}秒`
  }
}

// 版本信息
const versionInfo = ref({
  current: '...',
  latest: '',
  hasUpdate: false,
  checkingUpdate: false,
  lastChecked: null,
  releaseInfo: null,
  noUpdateMessage: false
})

// 用户菜单状态
const userMenuOpen = ref(false)

// 修改密码模态框
const showChangePasswordModal = ref(false)
const changePasswordLoading = ref(false)
const changePasswordForm = reactive({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
  newUsername: ''
})

// 检查更新（同时获取版本信息）
const checkForUpdates = async () => {
  if (versionInfo.value.checkingUpdate) {
    return
  }

  versionInfo.value.checkingUpdate = true

  try {
    const result = await apiClient.get('/admin/check-updates')

    if (result.success) {
      const data = result.data

      versionInfo.value.current = data.current
      versionInfo.value.latest = data.latest
      versionInfo.value.hasUpdate = data.hasUpdate
      versionInfo.value.releaseInfo = data.releaseInfo
      versionInfo.value.lastChecked = new Date()

      // 保存到localStorage
      localStorage.setItem(
        'versionInfo',
        JSON.stringify({
          current: data.current,
          latest: data.latest,
          lastChecked: versionInfo.value.lastChecked,
          hasUpdate: data.hasUpdate,
          releaseInfo: data.releaseInfo
        })
      )

      // 如果没有更新，显示提醒
      if (!data.hasUpdate) {
        versionInfo.value.noUpdateMessage = true
        // 3秒后自动隐藏提醒
        setTimeout(() => {
          versionInfo.value.noUpdateMessage = false
        }, 3000)
      }
    }
  } catch (error) {
    console.error('Error checking for updates:', error)

    // 尝试从localStorage读取缓存的版本信息
    const cached = localStorage.getItem('versionInfo')
    if (cached) {
      const cachedInfo = JSON.parse(cached)
      versionInfo.value.current = cachedInfo.current || versionInfo.value.current
      versionInfo.value.latest = cachedInfo.latest
      versionInfo.value.hasUpdate = cachedInfo.hasUpdate
      versionInfo.value.releaseInfo = cachedInfo.releaseInfo
      versionInfo.value.lastChecked = new Date(cachedInfo.lastChecked)
    }
  } finally {
    versionInfo.value.checkingUpdate = false
  }
}

// 打开修改密码弹窗
const openChangePasswordModal = () => {
  changePasswordForm.currentPassword = ''
  changePasswordForm.newPassword = ''
  changePasswordForm.confirmPassword = ''
  changePasswordForm.newUsername = ''
  showChangePasswordModal.value = true
  userMenuOpen.value = false
}

// 关闭修改密码弹窗
const closeChangePasswordModal = () => {
  showChangePasswordModal.value = false
}

// 修改密码
const changePassword = async () => {
  if (changePasswordForm.newPassword !== changePasswordForm.confirmPassword) {
    showToast('两次输入的密码不一致', 'error')
    return
  }

  if (changePasswordForm.newPassword.length < 8) {
    showToast('新密码长度至少8位', 'error')
    return
  }

  changePasswordLoading.value = true

  try {
    const data = await apiClient.post('/web/auth/change-password', {
      currentPassword: changePasswordForm.currentPassword,
      newPassword: changePasswordForm.newPassword,
      newUsername: changePasswordForm.newUsername || undefined
    })

    if (data.success) {
      const message = changePasswordForm.newUsername
        ? '账户信息修改成功，请重新登录'
        : '密码修改成功，请重新登录'
      showToast(message, 'success')
      closeChangePasswordModal()

      // 延迟后退出登录
      setTimeout(() => {
        authStore.logout()
        router.push('/login')
      }, 1500)
    } else {
      showToast(data.message || '修改失败', 'error')
    }
  } catch (error) {
    showToast('修改密码失败', 'error')
  } finally {
    changePasswordLoading.value = false
  }
}

// 退出登录
const logout = () => {
  if (confirm('确定要退出登录吗？')) {
    authStore.logout()
    router.push('/login')
    showToast('已安全退出', 'success')
    // 通知父组件
    emit('logout')
  }
  userMenuOpen.value = false
}

// 导航到用户管理
const navigateToUsers = () => {
  router.push('/users')
  userMenuOpen.value = false
}

// 导航到用户组管理
const navigateToUserGroups = () => {
  router.push('/user-groups')
  userMenuOpen.value = false
}

// 导航到系统设置
const navigateToSettings = () => {
  router.push('/settings')
  userMenuOpen.value = false
}

// 点击外部关闭菜单
const handleClickOutside = (event) => {
  const userMenuContainer = event.target.closest('.user-menu-container')
  if (!userMenuContainer && userMenuOpen.value) {
    userMenuOpen.value = false
  }
}

// Session 时钟定时器
let clockTimer = null

const startClock = () => {
  if (clockTimer) return
  clockTimer = setInterval(() => {
    currentTime.value = Date.now()
  }, 1000)
}

const stopClock = () => {
  if (clockTimer) {
    clearInterval(clockTimer)
    clockTimer = null
  }
}

onMounted(() => {
  checkForUpdates()

  // 设置自动检查更新（每小时检查一次）
  setInterval(() => {
    checkForUpdates()
  }, 3600000) // 1小时

  // 启动 session 时钟
  if (props.sessionToken) {
    startClock()
  }

  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  // 清理时钟定时器
  stopClock()

  document.removeEventListener('click', handleClickOutside)
})

watch(
  () => props.sessionToken,
  (newToken) => {
    if (newToken) {
      startClock()
    } else {
      stopClock()
    }
  }
)

watch(
  () => props.expiresAt,
  () => {
    if (props.sessionToken) {
      currentTime.value = Date.now()
    }
  }
)
</script>

<style scoped>
/* 用户菜单按钮样式 */
.user-menu-button {
  position: relative;
  overflow: hidden;
  min-height: 38px;
}

/* 添加光泽效果 */
.user-menu-button::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
  transition: left 0.5s;
}

.user-menu-button:hover::before {
  left: 100%;
}

/* 用户菜单样式优化 */
.user-menu-dropdown {
  margin-top: 8px;
  animation: slideDown 0.3s ease-out;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* fade过渡动画 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
