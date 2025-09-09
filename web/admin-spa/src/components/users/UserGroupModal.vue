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
      <div class="relative inline-block transform overflow-hidden rounded-lg bg-white text-left align-bottom shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-4xl sm:align-middle dark:bg-gray-800">
        <!-- Header -->
        <div class="bg-white px-6 pt-6 pb-4 border-b border-gray-200 dark:bg-gray-800 dark:border-gray-700">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100" id="modal-title">
                管理组关系
              </h3>
              <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
                为用户 "{{ user?.username }}" 配置组成员关系
              </p>
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

        <!-- Loading state -->
        <div v-if="loading" class="px-6 py-12 text-center">
          <i class="fas fa-spinner fa-spin text-2xl text-gray-400 mb-4"></i>
          <p class="text-gray-500 dark:text-gray-400">加载中...</p>
        </div>

        <!-- Content -->
        <div v-else class="bg-white px-6 py-6 dark:bg-gray-800">
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <!-- Available Groups -->
            <div>
              <div class="flex items-center justify-between mb-4">
                <h4 class="text-md font-medium text-gray-900 dark:text-gray-100">
                  可用组
                </h4>
                <div class="relative">
                  <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <i class="fas fa-search text-gray-400"></i>
                  </div>
                  <input
                    v-model="searchTerm"
                    type="text"
                    placeholder="搜索组..."
                    class="pl-10 pr-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400"
                  />
                </div>
              </div>
              
              <div class="border border-gray-200 rounded-lg dark:border-gray-600 max-h-80 overflow-y-auto">
                <div v-if="filteredAvailableGroups.length === 0" class="p-8 text-center">
                  <i class="fas fa-users text-gray-300 dark:text-gray-600 text-3xl mb-2"></i>
                  <p class="text-gray-500 dark:text-gray-400 text-sm">暂无可用组</p>
                </div>
                
                <div
                  v-else
                  v-for="group in filteredAvailableGroups"
                  :key="group.id"
                  class="flex items-center justify-between p-3 border-b border-gray-200 last:border-b-0 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700"
                >
                  <div class="flex items-center gap-3">
                    <div class="h-8 w-8 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-500 flex items-center justify-center">
                      <i class="fas fa-users text-white text-xs"></i>
                    </div>
                    <div>
                      <p class="text-sm font-medium text-gray-900 dark:text-gray-100">{{ group.name }}</p>
                      <p v-if="group.description" class="text-xs text-gray-500 dark:text-gray-400">{{ group.description }}</p>
                    </div>
                  </div>
                  <button
                    @click="addUserToGroup(group)"
                    class="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded-md text-white bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 focus:outline-none focus:ring-2 focus:ring-green-500"
                  >
                    <i class="fas fa-plus mr-1"></i>
                    添加
                  </button>
                </div>
              </div>
            </div>

            <!-- User's Groups -->
            <div>
              <div class="flex items-center justify-between mb-4">
                <h4 class="text-md font-medium text-gray-900 dark:text-gray-100">
                  已加入组 ({{ userGroups.length }})
                </h4>
                <button
                  v-if="userGroups.length > 0"
                  @click="saveChanges"
                  :disabled="saving"
                  class="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-md text-white bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                >
                  <i v-if="saving" class="fas fa-spinner fa-spin mr-1"></i>
                  <i v-else class="fas fa-save mr-1"></i>
                  {{ saving ? '保存中...' : '保存' }}
                </button>
              </div>
              
              <div class="border border-gray-200 rounded-lg dark:border-gray-600 max-h-80 overflow-y-auto">
                <div v-if="userGroups.length === 0" class="p-8 text-center">
                  <i class="fas fa-users text-gray-300 dark:text-gray-600 text-3xl mb-2"></i>
                  <p class="text-gray-500 dark:text-gray-400 text-sm">用户未加入任何组</p>
                </div>
                
                <div
                  v-else
                  v-for="group in userGroups"
                  :key="group.id"
                  class="flex items-center justify-between p-3 border-b border-gray-200 last:border-b-0 dark:border-gray-600"
                >
                  <div class="flex items-center gap-3">
                    <div class="h-8 w-8 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-500 flex items-center justify-center">
                      <i class="fas fa-users text-white text-xs"></i>
                    </div>
                    <div>
                      <div class="flex items-center gap-2">
                        <p class="text-sm font-medium text-gray-900 dark:text-gray-100">{{ group.name }}</p>
                        <span v-if="group.isPrimary" class="inline-flex items-center px-2 py-0.5 text-xs font-medium text-yellow-600 bg-yellow-100 rounded dark:bg-yellow-900/30 dark:text-yellow-400">
                          <i class="fas fa-star mr-1"></i>
                          主组
                        </span>
                      </div>
                      <p v-if="group.description" class="text-xs text-gray-500 dark:text-gray-400">{{ group.description }}</p>
                    </div>
                  </div>
                  <div class="flex items-center gap-2">
                    <!-- Role selector -->
                    <select
                      v-model="group.role"
                      class="text-xs px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
                      @change="markGroupAsModified(group)"
                    >
                      <option value="member">成员</option>
                      <option value="admin">管理员</option>
                    </select>
                    
                    <!-- Primary group toggle -->
                    <button
                      @click="togglePrimaryGroup(group)"
                      :class="[
                        'inline-flex items-center px-2 py-1 text-xs font-medium rounded',
                        group.isPrimary
                          ? 'text-yellow-600 bg-yellow-100 hover:bg-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400'
                          : 'text-gray-600 bg-gray-100 hover:bg-gray-200 dark:bg-gray-600 dark:text-gray-400'
                      ]"
                      :title="group.isPrimary ? '取消主组' : '设为主组'"
                    >
                      <i class="fas fa-star"></i>
                    </button>
                    
                    <!-- Remove button -->
                    <button
                      @click="removeUserFromGroup(group)"
                      class="inline-flex items-center px-2 py-1 text-xs font-medium rounded text-white bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
                    >
                      <i class="fas fa-times"></i>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Batch Operations -->
          <div v-if="userGroups.length > 0" class="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
            <h4 class="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">批量操作</h4>
            <div class="flex flex-wrap gap-3">
              <button
                @click="removeAllGroups"
                class="inline-flex items-center px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/30"
              >
                <i class="fas fa-times mr-2"></i>
                移除所有组
              </button>
              <button
                @click="setAllAsMembers"
                class="inline-flex items-center px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-900/30"
              >
                <i class="fas fa-user mr-2"></i>
                全部设为成员
              </button>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="bg-gray-50 px-6 py-3 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end border-t border-gray-200 dark:bg-gray-700 dark:border-gray-600">
          <button
            type="button"
            class="inline-flex justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 sm:w-auto dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            @click="closeModal"
          >
            关闭
          </button>
          <button
            @click="saveChanges"
            :disabled="saving || !hasChanges"
            class="inline-flex justify-center rounded-md border border-transparent bg-gradient-to-r from-indigo-500 to-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:from-indigo-600 hover:to-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed sm:w-auto"
          >
            <i v-if="saving" class="fas fa-spinner fa-spin mr-2"></i>
            {{ saving ? '保存中...' : '保存更改' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { apiClient } from '@/config/api'
import { ElMessage, ElMessageBox } from 'element-plus'

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
const emit = defineEmits(['close', 'updated'])

// Reactive state
const loading = ref(false)
const saving = ref(false)
const searchTerm = ref('')
const allGroups = ref([])
const userGroups = ref([])
const originalUserGroups = ref([])
const modifiedGroups = ref(new Set())

// Computed
const filteredAvailableGroups = computed(() => {
  const userGroupIds = new Set(userGroups.value.map(g => g.id))
  let available = allGroups.value.filter(group => !userGroupIds.has(group.id))
  
  if (searchTerm.value) {
    const term = searchTerm.value.toLowerCase()
    available = available.filter(group => 
      group.name.toLowerCase().includes(term) ||
      (group.description && group.description.toLowerCase().includes(term))
    )
  }
  
  return available
})

const hasChanges = computed(() => {
  return modifiedGroups.value.size > 0 || 
         userGroups.value.length !== originalUserGroups.value.length ||
         userGroups.value.some(group => {
           const original = originalUserGroups.value.find(og => og.id === group.id)
           return !original || 
                  original.role !== group.role || 
                  original.isPrimary !== group.isPrimary
         })
})

// Methods
const loadGroups = async () => {
  loading.value = true
  try {
    const response = await apiClient.get('/admin/groups', {
      params: { includeInactive: false }
    })
    
    if (response.success) {
      allGroups.value = response.data.groups || []
    } else {
      throw new Error(response.message || '获取组列表失败')
    }
  } catch (error) {
    console.error('Failed to load groups:', error)
    ElMessage.error(error.message || '获取组列表失败')
  } finally {
    loading.value = false
  }
}

const loadUserGroups = async () => {
  if (!props.user?.id) return
  
  try {
    const response = await apiClient.get(`/admin/users/${props.user.id}/groups`)
    
    if (response.success) {
      userGroups.value = response.data.groups || []
      originalUserGroups.value = JSON.parse(JSON.stringify(userGroups.value))
      modifiedGroups.value.clear()
    } else {
      throw new Error(response.message || '获取用户组信息失败')
    }
  } catch (error) {
    console.error('Failed to load user groups:', error)
    ElMessage.error(error.message || '获取用户组信息失败')
  }
}

const addUserToGroup = (group) => {
  // Check if group already exists
  if (userGroups.value.find(g => g.id === group.id)) {
    ElMessage.warning('用户已在该组中')
    return
  }
  
  const newGroupMembership = {
    ...group,
    role: 'member',
    isPrimary: userGroups.value.length === 0 // First group becomes primary
  }
  
  userGroups.value.push(newGroupMembership)
  modifiedGroups.value.add(group.id)
}

const removeUserFromGroup = async (group) => {
  try {
    await ElMessageBox.confirm(
      `确定要将用户从组 "${group.name}" 中移除吗？`,
      '确认移除',
      {
        confirmButtonText: '确定移除',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
    
    const index = userGroups.value.findIndex(g => g.id === group.id)
    if (index > -1) {
      const wasRemoved = userGroups.value.splice(index, 1)[0]
      modifiedGroups.value.add(group.id)
      
      // If removed group was primary, make the first remaining group primary
      if (wasRemoved.isPrimary && userGroups.value.length > 0) {
        userGroups.value[0].isPrimary = true
        modifiedGroups.value.add(userGroups.value[0].id)
      }
    }
  } catch (error) {
    if (error !== 'cancel') {
      console.error('Failed to remove group:', error)
    }
  }
}

const togglePrimaryGroup = (group) => {
  // Remove primary status from all groups first
  userGroups.value.forEach(g => {
    if (g.isPrimary && g.id !== group.id) {
      g.isPrimary = false
      modifiedGroups.value.add(g.id)
    }
  })
  
  // Toggle primary status for selected group
  group.isPrimary = !group.isPrimary
  modifiedGroups.value.add(group.id)
  
  // If no group is primary now, make this one primary
  if (!userGroups.value.some(g => g.isPrimary)) {
    group.isPrimary = true
  }
}

const markGroupAsModified = (group) => {
  modifiedGroups.value.add(group.id)
}

const removeAllGroups = async () => {
  if (userGroups.value.length === 0) return
  
  try {
    await ElMessageBox.confirm(
      `确定要将用户从所有 ${userGroups.value.length} 个组中移除吗？`,
      '确认批量移除',
      {
        confirmButtonText: '确定移除',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
    
    userGroups.value.forEach(group => modifiedGroups.value.add(group.id))
    userGroups.value = []
  } catch (error) {
    if (error !== 'cancel') {
      console.error('Failed to remove all groups:', error)
    }
  }
}

const setAllAsMembers = () => {
  userGroups.value.forEach(group => {
    if (group.role !== 'member') {
      group.role = 'member'
      modifiedGroups.value.add(group.id)
    }
  })
}

const saveChanges = async () => {
  saving.value = true
  try {
    const groupData = userGroups.value.map(group => ({
      groupId: group.id,
      role: group.role || 'member',
      isPrimary: group.isPrimary || false
    }))
    
    const response = await apiClient.put(`/admin/users/${props.user.id}/groups`, {
      groups: groupData
    })
    
    if (response.success) {
      ElMessage.success('组关系更新成功')
      originalUserGroups.value = JSON.parse(JSON.stringify(userGroups.value))
      modifiedGroups.value.clear()
      emit('updated')
    } else {
      throw new Error(response.message || '保存失败')
    }
  } catch (error) {
    console.error('Failed to save group changes:', error)
    ElMessage.error(error.message || '保存组关系失败')
  } finally {
    saving.value = false
  }
}

const closeModal = () => {
  if (hasChanges.value) {
    ElMessageBox.confirm(
      '有未保存的更改，确定要关闭吗？',
      '确认关闭',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    ).then(() => {
      emit('close')
    }).catch(() => {
      // User cancelled, do nothing
    })
  } else {
    emit('close')
  }
}

// Watch for user changes
watch(
  () => props.user,
  () => {
    if (props.visible && props.user) {
      loadUserGroups()
    }
  },
  { immediate: true }
)

// Watch for modal visibility
watch(
  () => props.visible,
  (visible) => {
    if (visible && props.user) {
      loadGroups()
      loadUserGroups()
      searchTerm.value = ''
    }
  }
)

// Lifecycle
onMounted(() => {
  if (props.visible && props.user) {
    loadGroups()
    loadUserGroups()
  }
})
</script>

<style scoped>
/* Custom styles for the modal */
</style>