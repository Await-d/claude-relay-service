<template>
  <div class="mb-4 sm:mb-6">
    <!-- 移动端下拉选择器 -->
    <div class="block rounded-xl bg-white/10 p-2 backdrop-blur-sm dark:bg-gray-800/20 sm:hidden">
      <select
        class="focus:ring-primary-color w-full rounded-lg bg-white/90 px-4 py-3 font-semibold text-gray-700 focus:outline-none focus:ring-2 dark:bg-gray-800/90 dark:text-gray-200 dark:focus:ring-indigo-400"
        :value="activeTab"
        @change="$emit('tab-change', $event.target.value)"
      >
        <option v-for="tab in tabs" :key="tab.key" :value="tab.key">
          {{ tab.name }}
        </option>
      </select>
    </div>

    <!-- 桌面端标签栏 -->
    <div
      class="hidden flex-wrap gap-2 rounded-2xl bg-white/10 p-2 backdrop-blur-sm dark:bg-gray-800/20 sm:flex"
    >
      <button
        v-for="tab in tabs"
        :key="tab.key"
        :class="[
          'tab-btn flex-1 px-3 py-2 text-xs font-semibold transition-all duration-300 sm:px-4 sm:py-3 sm:text-sm md:px-6',
          activeTab === tab.key
            ? 'active'
            : 'text-gray-700 hover:bg-white/10 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700/30 dark:hover:text-gray-100'
        ]"
        @click="$emit('tab-change', tab.key)"
      >
        <i :class="tab.icon + ' mr-1 sm:mr-2'" />
        <span class="hidden md:inline">{{ tab.name }}</span>
        <span class="md:hidden">{{ tab.shortName || tab.name }}</span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useAuthStore } from '@/stores/auth'

defineProps({
  activeTab: {
    type: String,
    required: true
  }
})

defineEmits(['tab-change'])

const authStore = useAuthStore()

// 所有可能的标签
const allTabs = [
  {
    key: 'dashboard',
    name: '仪表板',
    shortName: '仪表板',
    icon: 'fas fa-tachometer-alt',
    requiredRole: null
  },
  { key: 'apiKeys', name: 'API Keys', shortName: 'API', icon: 'fas fa-key', requiredRole: null },
  {
    key: 'accounts',
    name: '账户管理',
    shortName: '账户',
    icon: 'fas fa-user-circle',
    requiredRole: null
  },
  {
    key: 'users',
    name: '用户管理',
    shortName: '用户',
    icon: 'fas fa-user-friends',
    requiredRole: 'admin'
  },
  { key: 'groups', name: '用户组', shortName: '组', icon: 'fas fa-users', requiredRole: 'admin' },
  {
    key: 'user-groups',
    name: '用户组管理',
    shortName: '组管理',
    icon: 'fas fa-users-cog',
    requiredRole: 'admin'
  },
  {
    key: 'requestLogs',
    name: '请求日志',
    shortName: '日志',
    icon: 'fas fa-file-alt',
    requiredRole: null
  },
  {
    key: 'tutorial',
    name: '使用教程',
    shortName: '教程',
    icon: 'fas fa-graduation-cap',
    requiredRole: null
  },
  {
    key: 'settings',
    name: '系统设置',
    shortName: '设置',
    icon: 'fas fa-cogs',
    requiredRole: 'admin'
  }
]

// 根据用户权限过滤显示的标签
const tabs = computed(() => {
  const user = authStore.user
  const userRole = user?.role || 'user'

  return allTabs.filter((tab) => {
    // 如果标签不需要特殊权限，或者用户是管理员，则显示
    if (!tab.requiredRole || userRole === 'admin') {
      return true
    }

    // 检查用户角色是否满足标签要求
    return userRole === tab.requiredRole
  })
})
</script>

<style scoped>
/* 使用全局样式中定义的 .tab-btn 类 */
</style>
