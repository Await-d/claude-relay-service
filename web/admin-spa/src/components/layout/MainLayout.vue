<template>
  <div class="min-h-screen p-3 sm:p-4 md:p-6">
    <!-- Session Manager for authenticated pages -->
    <SessionManager
      :sessionToken="authStore.sessionToken"
      :expiresAt="authStore.expiresAt"
      :autoRefresh="true"
      :showIndicator="true"
      :showStatusText="false"
      @sessionRefreshed="handleSessionRefresh"
      @sessionExpired="handleSessionExpired"
      @refreshFailed="handleRefreshFailed"
      @logout="handleLogout"
    />

    <!-- 顶部导航 -->
    <AppHeader />

    <!-- 主内容区域 -->
    <div
      class="glass-strong rounded-xl p-3 shadow-xl sm:rounded-2xl sm:p-4 md:rounded-3xl md:p-6"
      style="z-index: 1; min-height: calc(100vh - 120px)"
    >
      <!-- 标签栏 -->
      <TabBar :active-tab="activeTab" @tab-change="handleTabChange" />

      <!-- 内容区域 -->
      <div class="tab-content">
        <router-view />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import AppHeader from './AppHeader.vue'
import TabBar from './TabBar.vue'
import SessionManager from '@/components/auth/SessionManager.vue'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

// 根据路由设置当前激活的标签
const activeTab = ref('dashboard')

const tabRouteMap = {
  dashboard: '/dashboard',
  apiKeys: '/api-keys',
  accounts: '/accounts',
  users: '/users',
  groups: '/groups',
  'user-groups': '/user-groups',
  requestLogs: '/request-logs',
  tutorial: '/tutorial',
  settings: '/settings'
}

// 初始化当前激活的标签
const initActiveTab = () => {
  const currentPath = route.path
  const tabKey = Object.keys(tabRouteMap).find((key) => tabRouteMap[key] === currentPath)

  if (tabKey) {
    activeTab.value = tabKey
  } else {
    // 如果路径不匹配任何标签，尝试从路由名称获取
    const routeName = route.name
    const nameToTabMap = {
      Dashboard: 'dashboard',
      ApiKeys: 'apiKeys',
      Accounts: 'accounts',
      Users: 'users',
      Groups: 'groups',
      UserGroups: 'user-groups',
      DataManagement: 'data-management',
      Tutorial: 'tutorial',
      Settings: 'settings'
    }
    if (routeName && nameToTabMap[routeName]) {
      activeTab.value = nameToTabMap[routeName]
    } else {
      // 默认选中仪表板
      activeTab.value = 'dashboard'
    }
  }
}

// 初始化
initActiveTab()

// 监听路由变化，更新激活的标签
watch(
  () => route.path,
  (newPath) => {
    const tabKey = Object.keys(tabRouteMap).find((key) => tabRouteMap[key] === newPath)
    if (tabKey) {
      activeTab.value = tabKey
    } else {
      // 如果路径不匹配任何标签，尝试从路由名称获取
      const routeName = route.name
      const nameToTabMap = {
        Dashboard: 'dashboard',
        ApiKeys: 'apiKeys',
        Accounts: 'accounts',
        Users: 'users',
        Groups: 'groups',
        UserGroups: 'user-groups',
        DataManagement: 'data-management',
        Tutorial: 'tutorial',
        Settings: 'settings'
      }
      if (routeName && nameToTabMap[routeName]) {
        activeTab.value = nameToTabMap[routeName]
      }
    }
  }
)

// 处理标签切换
const handleTabChange = async (tabKey) => {
  // 如果已经在目标路由，不需要做任何事
  if (tabRouteMap[tabKey] === route.path) {
    return
  }

  // 先更新activeTab状态
  activeTab.value = tabKey

  // 使用 await 确保路由切换完成
  try {
    await router.push(tabRouteMap[tabKey])
    // 等待下一个DOM更新周期，确保组件正确渲染
    await nextTick()
  } catch (err) {
    // 如果路由切换失败，恢复activeTab状态
    if (err.name !== 'NavigationDuplicated') {
      console.error('路由切换失败:', err)
      // 恢复到当前路由对应的tab
      initActiveTab()
    }
  }
}

// Session management handlers
const handleSessionRefresh = async () => {
  try {
    const success = await authStore.refreshSession()
    if (!success) {
      console.warn('Session refresh failed in MainLayout')
    }
  } catch (error) {
    console.error('Session refresh error in MainLayout:', error)
  }
}

const handleSessionExpired = () => {
  console.warn('Session expired in MainLayout')
  authStore.clearAuthState()
}

const handleRefreshFailed = (error) => {
  console.error('Session refresh failed in MainLayout:', error)
  authStore.clearAuthState()
}

const handleLogout = () => {
  authStore.logout()
}

// OEM设置已在App.vue中加载，无需重复加载
</script>

<style scoped>
/* 使用全局定义的过渡样式 */
</style>
