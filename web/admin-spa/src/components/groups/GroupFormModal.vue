<template>
  <div
    v-if="visible"
    class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overflow-x-hidden outline-none focus:outline-none"
    @click.self="$emit('close')"
  >
    <!-- Backdrop -->
    <div class="fixed inset-0 bg-black bg-opacity-50 transition-opacity"></div>

    <!-- Modal -->
    <div class="relative z-50 mx-auto my-6 w-full max-w-2xl p-4">
      <div
        class="relative flex w-full flex-col rounded-lg border-0 bg-white shadow-lg outline-none focus:outline-none dark:bg-gray-800"
      >
        <!-- Header -->
        <div
          class="flex items-start justify-between rounded-t border-b border-solid border-gray-200 p-5 dark:border-gray-600"
        >
          <div class="flex items-center gap-3">
            <div
              class="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-r from-indigo-500 to-purple-500"
            >
              <i class="fas fa-users text-white"></i>
            </div>
            <div>
              <h3 class="text-xl font-semibold text-gray-900 dark:text-gray-100">
                {{ isEdit ? '编辑组' : '创建组' }}
              </h3>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                {{ isEdit ? '修改组信息和配置' : '创建新的用户组' }}
              </p>
            </div>
          </div>
          <button
            class="float-right ml-auto border-0 bg-transparent p-1 text-3xl font-semibold leading-none text-gray-400 hover:text-gray-600 focus:outline-none dark:text-gray-500 dark:hover:text-gray-300"
            @click="$emit('close')"
          >
            <i class="fas fa-times"></i>
          </button>
        </div>

        <!-- Body -->
        <div class="relative flex-auto p-6">
          <form class="space-y-6" @submit.prevent="saveGroup">
            <!-- Basic Info Section -->
            <div class="space-y-4">
              <h4
                class="border-b border-gray-200 pb-2 text-lg font-medium text-gray-900 dark:border-gray-600 dark:text-gray-100"
              >
                <i class="fas fa-info-circle mr-2 text-blue-500"></i>
                基本信息
              </h4>

              <!-- Group Name -->
              <div>
                <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  组名称 <span class="text-red-500">*</span>
                </label>
                <input
                  v-model="formData.name"
                  class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
                  maxlength="100"
                  placeholder="输入组名称"
                  required
                  type="text"
                />
                <p class="mt-1 text-xs text-gray-500">最多100个字符</p>
              </div>

              <!-- Description -->
              <div>
                <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  描述
                </label>
                <textarea
                  v-model="formData.description"
                  class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
                  maxlength="500"
                  placeholder="输入组描述"
                  rows="3"
                ></textarea>
                <p class="mt-1 text-xs text-gray-500">最多500个字符</p>
              </div>

              <!-- Parent Group -->
              <div>
                <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  父组
                </label>
                <select
                  v-model="formData.parentId"
                  class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
                >
                  <option value="">无父组（顶级组）</option>
                  <option
                    v-for="parentGroup in parentGroups"
                    :key="parentGroup.id"
                    :value="parentGroup.id"
                  >
                    {{ parentGroup.name }}
                  </option>
                </select>
                <p class="mt-1 text-xs text-gray-500">选择父组来创建层级结构</p>
              </div>

              <!-- Status -->
              <div>
                <label class="flex items-center gap-3">
                  <input
                    v-model="formData.isActive"
                    class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    type="checkbox"
                  />
                  <span class="text-sm font-medium text-gray-700 dark:text-gray-300">激活组</span>
                </label>
                <p class="ml-6 mt-1 text-xs text-gray-500">只有激活的组才能分配成员和账户</p>
              </div>
            </div>

            <!-- Permissions Section -->
            <div class="space-y-4">
              <h4
                class="border-b border-gray-200 pb-2 text-lg font-medium text-gray-900 dark:border-gray-600 dark:text-gray-100"
              >
                <i class="fas fa-shield-alt mr-2 text-green-500"></i>
                权限配置
              </h4>

              <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                <!-- Chat Permissions -->
                <div class="space-y-3 rounded-lg bg-gray-50 p-4 dark:bg-gray-700">
                  <h5 class="font-medium text-gray-900 dark:text-gray-100">聊天权限</h5>
                  <div class="space-y-2">
                    <label class="flex items-center gap-2">
                      <input
                        v-model="formData.permissions['chat.create']"
                        class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        type="checkbox"
                      />
                      <span class="text-sm text-gray-700 dark:text-gray-300">创建聊天</span>
                    </label>
                    <label class="flex items-center gap-2">
                      <input
                        v-model="formData.permissions['chat.history']"
                        class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        type="checkbox"
                      />
                      <span class="text-sm text-gray-700 dark:text-gray-300">查看历史</span>
                    </label>
                  </div>
                </div>

                <!-- Model Permissions -->
                <div class="space-y-3 rounded-lg bg-gray-50 p-4 dark:bg-gray-700">
                  <h5 class="font-medium text-gray-900 dark:text-gray-100">模型权限</h5>
                  <div class="space-y-2">
                    <label class="flex items-center gap-2">
                      <input
                        v-model="formData.permissions['models.list']"
                        class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        type="checkbox"
                      />
                      <span class="text-sm text-gray-700 dark:text-gray-300">列出模型</span>
                    </label>
                  </div>
                </div>

                <!-- Usage Permissions -->
                <div class="space-y-3 rounded-lg bg-gray-50 p-4 dark:bg-gray-700">
                  <h5 class="font-medium text-gray-900 dark:text-gray-100">使用统计</h5>
                  <div class="space-y-2">
                    <label class="flex items-center gap-2">
                      <input
                        v-model="formData.permissions['usage.view']"
                        class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        type="checkbox"
                      />
                      <span class="text-sm text-gray-700 dark:text-gray-300">查看使用量</span>
                    </label>
                  </div>
                </div>

                <!-- Admin Permissions -->
                <div class="space-y-3 rounded-lg bg-gray-50 p-4 dark:bg-gray-700">
                  <h5 class="font-medium text-gray-900 dark:text-gray-100">管理权限</h5>
                  <div class="space-y-2">
                    <label class="flex items-center gap-2">
                      <input
                        v-model="formData.permissions['admin.read']"
                        class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        type="checkbox"
                      />
                      <span class="text-sm text-gray-700 dark:text-gray-300">只读管理</span>
                    </label>
                    <label class="flex items-center gap-2">
                      <input
                        v-model="formData.permissions['admin.write']"
                        class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        type="checkbox"
                      />
                      <span class="text-sm text-gray-700 dark:text-gray-300">管理写入</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>

            <!-- Scheduling Configuration -->
            <div class="space-y-4">
              <h4
                class="border-b border-gray-200 pb-2 text-lg font-medium text-gray-900 dark:border-gray-600 dark:text-gray-100"
              >
                <i class="fas fa-cogs mr-2 text-purple-500"></i>
                调度配置
              </h4>

              <!-- Scheduling Strategy -->
              <div>
                <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  调度策略
                </label>
                <select
                  v-model="formData.schedulingConfig.strategy"
                  class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
                >
                  <option value="round_robin">轮询 (Round Robin)</option>
                  <option value="random">随机 (Random)</option>
                  <option value="weighted">权重 (Weighted)</option>
                  <option value="priority">优先级 (Priority)</option>
                  <option value="least_recent">最少使用 (Least Recent)</option>
                </select>
              </div>

              <!-- Scheduling Options -->
              <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label class="flex items-center gap-3">
                  <input
                    v-model="formData.schedulingConfig.fallbackToGlobal"
                    class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    type="checkbox"
                  />
                  <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
                    回退到全局账户
                  </span>
                </label>

                <label class="flex items-center gap-3">
                  <input
                    v-model="formData.schedulingConfig.healthCheckEnabled"
                    class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    type="checkbox"
                  />
                  <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
                    启用健康检查
                  </span>
                </label>
              </div>
            </div>
          </form>
        </div>

        <!-- Footer -->
        <div
          class="flex items-center justify-end rounded-b border-t border-solid border-gray-200 p-6 dark:border-gray-600"
        >
          <div class="flex gap-3">
            <button
              class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              type="button"
              @click="$emit('close')"
            >
              取消
            </button>
            <button
              class="flex items-center gap-2 rounded-lg bg-gradient-to-r from-indigo-500 to-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:from-indigo-600 hover:to-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="saving"
              type="submit"
              @click="saveGroup"
            >
              <i v-if="saving" class="fas fa-spinner fa-spin"></i>
              <i v-else class="fas fa-save"></i>
              {{ saving ? '保存中...' : isEdit ? '更新' : '创建' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { apiClient } from '@/config/api'
import { ElMessage } from 'element-plus'

const props = defineProps({
  visible: {
    type: Boolean,
    required: true
  },
  group: {
    type: Object,
    default: null
  },
  parentGroups: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['close', 'saved'])

// Reactive state
const saving = ref(false)
const formData = ref({
  name: '',
  description: '',
  parentId: '',
  isActive: true,
  permissions: {
    'chat.create': false,
    'chat.history': false,
    'models.list': false,
    'usage.view': false,
    'admin.read': false,
    'admin.write': false
  },
  schedulingConfig: {
    strategy: 'round_robin',
    fallbackToGlobal: true,
    healthCheckEnabled: true,
    weights: {}
  }
})

// Computed
const isEdit = computed(() => !!props.group)

// Methods
const resetForm = () => {
  if (props.group) {
    // Edit mode - populate with existing data
    formData.value = {
      name: props.group.name || '',
      description: props.group.description || '',
      parentId: props.group.parentId || '',
      isActive: props.group.isActive !== false,
      permissions: {
        'chat.create': props.group.permissions?.['chat.create'] || false,
        'chat.history': props.group.permissions?.['chat.history'] || false,
        'models.list': props.group.permissions?.['models.list'] || false,
        'usage.view': props.group.permissions?.['usage.view'] || false,
        'admin.read': props.group.permissions?.['admin.read'] || false,
        'admin.write': props.group.permissions?.['admin.write'] || false
      },
      schedulingConfig: {
        strategy: props.group.schedulingConfig?.strategy || 'round_robin',
        fallbackToGlobal: props.group.schedulingConfig?.fallbackToGlobal !== false,
        healthCheckEnabled: props.group.schedulingConfig?.healthCheckEnabled !== false,
        weights: props.group.schedulingConfig?.weights || {}
      }
    }
  } else {
    // Create mode - reset to defaults
    formData.value = {
      name: '',
      description: '',
      parentId: '',
      isActive: true,
      permissions: {
        'chat.create': false,
        'chat.history': false,
        'models.list': false,
        'usage.view': false,
        'admin.read': false,
        'admin.write': false
      },
      schedulingConfig: {
        strategy: 'round_robin',
        fallbackToGlobal: true,
        healthCheckEnabled: true,
        weights: {}
      }
    }
  }
}

const validateForm = () => {
  if (!formData.value.name || !formData.value.name.trim()) {
    ElMessage.error('组名称不能为空')
    return false
  }

  if (formData.value.name.length > 100) {
    ElMessage.error('组名称不能超过100个字符')
    return false
  }

  if (formData.value.description && formData.value.description.length > 500) {
    ElMessage.error('组描述不能超过500个字符')
    return false
  }

  return true
}

const saveGroup = async () => {
  if (!validateForm()) {
    return
  }

  saving.value = true

  try {
    const payload = {
      name: formData.value.name.trim(),
      description: formData.value.description.trim(),
      parentId: formData.value.parentId || null,
      isActive: formData.value.isActive,
      permissions: formData.value.permissions,
      schedulingConfig: formData.value.schedulingConfig
    }

    let response
    if (isEdit.value) {
      response = await apiClient.put(`/admin/groups/${props.group.id}`, payload)
    } else {
      response = await apiClient.post('/admin/groups', payload)
    }

    if (response.success) {
      ElMessage.success(isEdit.value ? '组更新成功' : '组创建成功')
      emit('saved', response.data)
    } else {
      throw new Error(response.message || '保存失败')
    }
  } catch (error) {
    console.error('Failed to save group:', error)
    ElMessage.error(error.message || '保存组失败')
  } finally {
    saving.value = false
  }
}

// Watch for prop changes
watch(
  () => props.visible,
  (newVal) => {
    if (newVal) {
      nextTick(() => {
        resetForm()
      })
    }
  },
  { immediate: true }
)

watch(
  () => props.group,
  () => {
    if (props.visible) {
      resetForm()
    }
  },
  { deep: true }
)
</script>

<style scoped>
/* Modal backdrop animation */
.modal-backdrop-enter-active,
.modal-backdrop-leave-active {
  transition: opacity 0.3s ease;
}

.modal-backdrop-enter-from,
.modal-backdrop-leave-to {
  opacity: 0;
}

/* Modal content animation */
.modal-enter-active,
.modal-leave-active {
  transition:
    transform 0.3s ease,
    opacity 0.3s ease;
}

.modal-enter-from,
.modal-leave-to {
  transform: scale(0.9) translateY(-10px);
  opacity: 0;
}
</style>
