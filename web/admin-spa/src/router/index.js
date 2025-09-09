import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { APP_CONFIG } from '@/config/app'

// 路由懒加载
const LoginView = () => import('@/views/LoginView.vue')
const MainLayout = () => import('@/components/layout/MainLayout.vue')
const DashboardView = () => import('@/views/DashboardView.vue')
const ApiKeysView = () => import('@/views/ApiKeysView.vue')
const AccountsView = () => import('@/views/AccountsView.vue')
const GroupListView = () => import('@/views/groups/GroupList.vue')
const UserListView = () => import('@/views/users/UserList.vue')
const UserGroupsView = () => import('@/views/users/UserGroups.vue')
const TutorialView = () => import('@/views/TutorialView.vue')
const SettingsView = () => import('@/views/SettingsView.vue')
const ApiStatsView = () => import('@/views/ApiStatsView.vue')
const RequestLogsView = () => import('@/views/RequestLogsView.vue')

const routes = [
  {
    path: '/',
    redirect: () => {
      // 智能重定向：避免循环
      const currentPath = window.location.pathname
      const basePath = APP_CONFIG.basePath.replace(/\/$/, '') // 移除末尾斜杠

      // 如果当前路径已经是 basePath 或 basePath/，重定向到 api-stats
      if (currentPath === basePath || currentPath === basePath + '/') {
        return '/api-stats'
      }

      // 否则保持默认重定向
      return '/api-stats'
    }
  },
  {
    path: '/login',
    name: 'Login',
    component: LoginView,
    meta: { requiresAuth: false }
  },
  {
    path: '/api-stats',
    name: 'ApiStats',
    component: ApiStatsView,
    meta: { requiresAuth: false }
  },
  {
    path: '/dashboard',
    component: MainLayout,
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'Dashboard',
        component: DashboardView
      }
    ]
  },
  {
    path: '/api-keys',
    component: MainLayout,
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'ApiKeys',
        component: ApiKeysView
      }
    ]
  },
  {
    path: '/accounts',
    component: MainLayout,
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'Accounts',
        component: AccountsView
      }
    ]
  },
  {
    path: '/groups',
    component: MainLayout,
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'Groups',
        component: GroupListView
      }
    ]
  },
  {
    path: '/users',
    component: MainLayout,
    meta: { requiresAuth: true, requiresRole: 'admin' },
    children: [
      {
        path: '',
        name: 'Users',
        component: UserListView
      }
    ]
  },
  {
    path: '/user-groups',
    component: MainLayout,
    meta: { requiresAuth: true, requiresRole: 'admin' },
    children: [
      {
        path: '',
        name: 'UserGroups',
        component: UserGroupsView
      }
    ]
  },
  {
    path: '/tutorial',
    component: MainLayout,
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'Tutorial',
        component: TutorialView
      }
    ]
  },
  {
    path: '/settings',
    component: MainLayout,
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'Settings',
        component: SettingsView
      }
    ]
  },
  {
    path: '/request-logs',
    component: MainLayout,
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'RequestLogs',
        component: RequestLogsView
      }
    ]
  },
  // 捕获所有未匹配的路由
  {
    path: '/:pathMatch(.*)*',
    redirect: '/api-stats'
  }
]

const router = createRouter({
  history: createWebHistory(APP_CONFIG.basePath),
  routes
})

// 路由守卫
router.beforeEach((to, from, next) => {
  const authStore = useAuthStore()

  console.log('路由导航:', {
    to: to.path,
    from: from.path,
    fullPath: to.fullPath,
    requiresAuth: to.meta.requiresAuth,
    requiresRole: to.meta.requiresRole,
    isAuthenticated: authStore.isAuthenticated,
    userRole: authStore.user?.role
  })

  // 防止重定向循环：如果已经在目标路径，直接放行
  if (to.path === from.path && to.fullPath === from.fullPath) {
    return next()
  }

  // API Stats 页面不需要认证，直接放行
  if (to.path === '/api-stats' || to.path.startsWith('/api-stats')) {
    next()
  } else if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    next('/login')
  } else if (to.path === '/login' && authStore.isAuthenticated) {
    next('/dashboard')
  } else if (to.meta.requiresRole) {
    // 检查角色权限
    const userRole = authStore.user?.role || 'user'
    if (userRole !== to.meta.requiresRole) {
      // 权限不足，重定向到仪表板
      next('/dashboard')
      return
    }
    next()
  } else {
    next()
  }
})

export default router
