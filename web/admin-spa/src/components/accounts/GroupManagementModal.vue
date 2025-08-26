<template>
  <Teleport to="body">
    <div v-if="show" class="modal fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <div
        class="modal-content custom-scrollbar mx-auto max-h-[90vh] w-full max-w-4xl overflow-y-auto p-4 sm:p-6 md:p-8"
      >
        <div class="mb-4 flex items-center justify-between sm:mb-6">
          <div class="flex items-center gap-2 sm:gap-3">
            <div
              class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-purple-600 sm:h-10 sm:w-10 sm:rounded-xl"
            >
              <i class="fas fa-layer-group text-sm text-white sm:text-base" />
            </div>
            <h3 class="text-lg font-bold text-gray-900 sm:text-xl">账户分组管理</h3>
          </div>
          <button
            class="p-1 text-gray-400 transition-colors hover:text-gray-600"
            @click="$emit('close')"
          >
            <i class="fas fa-times text-lg sm:text-xl" />
          </button>
        </div>

        <!-- 添加分组按钮 -->
        <div class="mb-6">
          <button class="btn btn-primary px-4 py-2" @click="showCreateForm = true">
            <i class="fas fa-plus mr-2" />
            创建新分组
          </button>
        </div>

        <!-- 创建分组表单 -->
        <div v-if="showCreateForm" class="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <h4 class="mb-4 text-lg font-semibold text-gray-900">创建新分组</h4>
          <div class="space-y-4">
            <div>
              <label class="mb-2 block text-sm font-semibold text-gray-700">分组名称 *</label>
              <input
                v-model="createForm.name"
                class="form-input w-full"
                placeholder="输入分组名称"
                type="text"
              />
            </div>

            <div>
              <label class="mb-2 block text-sm font-semibold text-gray-700">平台类型 *</label>
              <div class="flex gap-4">
                <label class="flex cursor-pointer items-center">
                  <input v-model="createForm.platform" class="mr-2" type="radio" value="claude" />
                  <span class="text-sm text-gray-700">Claude</span>
                </label>
                <label class="flex cursor-pointer items-center">
                  <input v-model="createForm.platform" class="mr-2" type="radio" value="gemini" />
                  <span class="text-sm text-gray-700">Gemini</span>
                </label>
                <label class="flex cursor-pointer items-center">
                  <input v-model="createForm.platform" class="mr-2" type="radio" value="openai" />
                  <span class="text-sm text-gray-700">OpenAI</span>
                </label>
              </div>
            </div>

            <div>
              <label class="mb-2 block text-sm font-semibold text-gray-700 dark:text-gray-300"
                >描述 (可选)</label
              >
              <textarea
                v-model="createForm.description"
                class="form-input w-full resize-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400"
                placeholder="分组描述..."
                rows="2"
              />
            </div>

            <!-- 调度策略配置 -->
            <div>
              <label class="mb-3 block text-sm font-semibold text-gray-700 dark:text-gray-300">
                <i class="fas fa-route mr-2 text-blue-500" />
                分组调度策略
              </label>
              <select
                v-model="createForm.schedulingStrategy"
                class="form-input w-full dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
              >
                <option value="round_robin">轮询调度 (Round Robin)</option>
                <option value="least_used">最少使用 (Least Used)</option>
                <option value="least_recent">最近最少使用 (Least Recent)</option>
                <option value="random">随机调度 (Random)</option>
                <option value="weighted_random">加权随机 (Weighted Random)</option>
                <option value="sequential">顺序调度 (Sequential)</option>
              </select>
              <div
                class="mt-2 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-700 dark:bg-blue-900/30"
              >
                <i class="fas fa-info-circle mt-0.5 text-blue-600 dark:text-blue-400" />
                <div class="text-xs text-blue-700 dark:text-blue-300">
                  <p class="mb-1 font-medium">策略说明：</p>
                  <div class="text-xs">
                    <div v-if="createForm.schedulingStrategy === 'round_robin'">
                      <strong>轮询调度：</strong>按顺序循环选择账户，确保每个账户被平均使用
                    </div>
                    <div v-else-if="createForm.schedulingStrategy === 'least_used'">
                      <strong>最少使用：</strong>优先选择使用次数最少的账户，实现负载均衡
                    </div>
                    <div v-else-if="createForm.schedulingStrategy === 'least_recent'">
                      <strong>最近最少使用：</strong>优先选择最长时间未被使用的账户（推荐）
                    </div>
                    <div v-else-if="createForm.schedulingStrategy === 'random'">
                      <strong>随机调度：</strong>随机选择可用账户，分布相对均匀
                    </div>
                    <div v-else-if="createForm.schedulingStrategy === 'weighted_random'">
                      <strong>加权随机：</strong>根据权重随机选择，权重越高被选中概率越大
                    </div>
                    <div v-else-if="createForm.schedulingStrategy === 'sequential'">
                      <strong>顺序调度：</strong>按配置顺序逐一使用账户，适合有优先级要求的场景
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 加权随机权重设置 -->
            <div v-if="createForm.schedulingStrategy === 'weighted_random'">
              <label class="mb-3 block text-sm font-semibold text-gray-700 dark:text-gray-300">
                <i class="fas fa-weight-hanging mr-2 text-amber-500" />
                默认权重 (1-10)
              </label>
              <input
                v-model.number="createForm.schedulingWeight"
                class="form-input w-full dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400"
                max="10"
                min="1"
                placeholder="默认权重值，建议5"
                type="number"
              />
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                权重越高的账户被选中的概率越大，建议范围：1-10
              </p>
            </div>

            <!-- 顺序调度顺序设置 -->
            <div v-if="createForm.schedulingStrategy === 'sequential'">
              <label class="mb-3 block text-sm font-semibold text-gray-700 dark:text-gray-300">
                <i class="fas fa-sort-numeric-down mr-2 text-indigo-500" />
                起始顺序位置
              </label>
              <input
                v-model.number="createForm.sequentialOrder"
                class="form-input w-full dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400"
                min="1"
                placeholder="顺序起始位置，从1开始"
                type="number"
              />
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                数字越小越优先被选择，分组内账户会按此顺序调度
              </p>
            </div>

            <div class="flex gap-3">
              <button
                class="btn btn-primary px-4 py-2"
                :disabled="!createForm.name || !createForm.platform || creating"
                @click="createGroup"
              >
                <div v-if="creating" class="loading-spinner mr-2" />
                {{ creating ? '创建中...' : '创建' }}
              </button>
              <button class="btn btn-secondary px-4 py-2" @click="cancelCreate">取消</button>
            </div>
          </div>
        </div>

        <!-- 分组列表 -->
        <div class="space-y-4">
          <div v-if="loading" class="py-8 text-center">
            <div class="loading-spinner-lg mx-auto mb-4" />
            <p class="text-gray-500">加载中...</p>
          </div>

          <div v-else-if="groups.length === 0" class="rounded-lg bg-gray-50 py-8 text-center">
            <i class="fas fa-layer-group mb-4 text-4xl text-gray-300" />
            <p class="text-gray-500">暂无分组</p>
          </div>

          <div v-else class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div
              v-for="group in groups"
              :key="group.id"
              class="rounded-lg border bg-white p-4 transition-shadow hover:shadow-md dark:border-gray-600 dark:bg-gray-800"
            >
              <div class="mb-3 flex items-start justify-between">
                <div class="flex-1">
                  <h4 class="font-semibold text-gray-900 dark:text-gray-100">
                    {{ group.name }}
                  </h4>
                  <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    {{ group.description || '暂无描述' }}
                  </p>
                  <!-- 显示调度策略信息 -->
                  <div class="mt-2 flex items-center gap-2">
                    <div
                      :class="[
                        'flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium',
                        getStrategyColor(group.schedulingStrategy || 'least_recent')
                      ]"
                    >
                      <i :class="getStrategyIcon(group.schedulingStrategy || 'least_recent')" />
                      <span>{{ getStrategyName(group.schedulingStrategy || 'least_recent') }}</span>
                    </div>
                    <span
                      v-if="
                        group.schedulingStrategy === 'weighted_random' && group.schedulingWeight
                      "
                      class="text-xs text-amber-600 dark:text-amber-400"
                    >
                      <i class="fas fa-weight-hanging mr-1" />
                      权重: {{ group.schedulingWeight }}
                    </span>
                    <span
                      v-else-if="group.schedulingStrategy === 'sequential' && group.sequentialOrder"
                      class="text-xs text-indigo-600 dark:text-indigo-400"
                    >
                      <i class="fas fa-sort-numeric-down mr-1" />
                      起始位置: {{ group.sequentialOrder }}
                    </span>
                  </div>
                </div>
                <div class="ml-4 flex items-center gap-2">
                  <span
                    :class="[
                      'rounded-full px-2 py-1 text-xs font-medium',
                      group.platform === 'claude'
                        ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                        : group.platform === 'gemini'
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                          : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                    ]"
                  >
                    {{
                      group.platform === 'claude'
                        ? 'Claude'
                        : group.platform === 'gemini'
                          ? 'Gemini'
                          : 'OpenAI'
                    }}
                  </span>
                </div>
              </div>

              <div class="flex items-center justify-between text-sm text-gray-600">
                <div class="flex items-center gap-4">
                  <span>
                    <i class="fas fa-users mr-1" />
                    {{ group.memberCount || 0 }} 个成员
                  </span>
                  <span>
                    <i class="fas fa-clock mr-1" />
                    {{ formatDate(group.createdAt) }}
                  </span>
                </div>
                <div class="flex items-center gap-2">
                  <button
                    class="text-blue-600 transition-colors hover:text-blue-800"
                    title="编辑"
                    @click="editGroup(group)"
                  >
                    <i class="fas fa-edit" />
                  </button>
                  <button
                    class="text-red-600 transition-colors hover:text-red-800"
                    :disabled="group.memberCount > 0"
                    title="删除"
                    @click="deleteGroup(group)"
                  >
                    <i class="fas fa-trash" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 编辑分组模态框 -->
    <div
      v-if="showEditForm"
      class="modal fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4"
    >
      <div class="modal-content w-full max-w-lg p-4 sm:p-6">
        <div class="mb-4 flex items-center justify-between">
          <h3 class="text-lg font-bold text-gray-900">编辑分组</h3>
          <button class="text-gray-400 transition-colors hover:text-gray-600" @click="cancelEdit">
            <i class="fas fa-times" />
          </button>
        </div>

        <div class="space-y-4">
          <div>
            <label class="mb-2 block text-sm font-semibold text-gray-700">分组名称 *</label>
            <input
              v-model="editForm.name"
              class="form-input w-full"
              placeholder="输入分组名称"
              type="text"
            />
          </div>

          <div>
            <label class="mb-2 block text-sm font-semibold text-gray-700">平台类型</label>
            <div class="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-600">
              {{
                editForm.platform === 'claude'
                  ? 'Claude'
                  : editForm.platform === 'gemini'
                    ? 'Gemini'
                    : 'OpenAI'
              }}
              <span class="ml-2 text-xs text-gray-500">(不可修改)</span>
            </div>
          </div>

          <div>
            <label class="mb-2 block text-sm font-semibold text-gray-700 dark:text-gray-300"
              >描述 (可选)</label
            >
            <textarea
              v-model="editForm.description"
              class="form-input w-full resize-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400"
              placeholder="分组描述..."
              rows="2"
            />
          </div>

          <!-- 编辑时的调度策略配置 -->
          <div>
            <label class="mb-3 block text-sm font-semibold text-gray-700 dark:text-gray-300">
              <i class="fas fa-route mr-2 text-blue-500" />
              分组调度策略
            </label>
            <select
              v-model="editForm.schedulingStrategy"
              class="form-input w-full dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
            >
              <option value="round_robin">轮询调度 (Round Robin)</option>
              <option value="least_used">最少使用 (Least Used)</option>
              <option value="least_recent">最近最少使用 (Least Recent)</option>
              <option value="random">随机调度 (Random)</option>
              <option value="weighted_random">加权随机 (Weighted Random)</option>
              <option value="sequential">顺序调度 (Sequential)</option>
            </select>
            <div
              class="mt-2 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-700 dark:bg-blue-900/30"
            >
              <i class="fas fa-info-circle mt-0.5 text-blue-600 dark:text-blue-400" />
              <div class="text-xs text-blue-700 dark:text-blue-300">
                <p class="mb-1 font-medium">策略说明：</p>
                <div class="text-xs">
                  <div v-if="editForm.schedulingStrategy === 'round_robin'">
                    <strong>轮询调度：</strong>按顺序循环选择账户，确保每个账户被平均使用
                  </div>
                  <div v-else-if="editForm.schedulingStrategy === 'least_used'">
                    <strong>最少使用：</strong>优先选择使用次数最少的账户，实现负载均衡
                  </div>
                  <div v-else-if="editForm.schedulingStrategy === 'least_recent'">
                    <strong>最近最少使用：</strong>优先选择最长时间未被使用的账户（推荐）
                  </div>
                  <div v-else-if="editForm.schedulingStrategy === 'random'">
                    <strong>随机调度：</strong>随机选择可用账户，分布相对均匀
                  </div>
                  <div v-else-if="editForm.schedulingStrategy === 'weighted_random'">
                    <strong>加权随机：</strong>根据权重随机选择，权重越高被选中概率越大
                  </div>
                  <div v-else-if="editForm.schedulingStrategy === 'sequential'">
                    <strong>顺序调度：</strong>按配置顺序逐一使用账户，适合有优先级要求的场景
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 编辑时的加权随机权重设置 -->
          <div v-if="editForm.schedulingStrategy === 'weighted_random'">
            <label class="mb-3 block text-sm font-semibold text-gray-700 dark:text-gray-300">
              <i class="fas fa-weight-hanging mr-2 text-amber-500" />
              默认权重 (1-10)
            </label>
            <input
              v-model.number="editForm.schedulingWeight"
              class="form-input w-full dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400"
              max="10"
              min="1"
              placeholder="默认权重值，建议5"
              type="number"
            />
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              权重越高的账户被选中的概率越大，建议范围：1-10
            </p>
          </div>

          <!-- 编辑时的顺序调度顺序设置 -->
          <div v-if="editForm.schedulingStrategy === 'sequential'">
            <label class="mb-3 block text-sm font-semibold text-gray-700 dark:text-gray-300">
              <i class="fas fa-sort-numeric-down mr-2 text-indigo-500" />
              起始顺序位置
            </label>
            <input
              v-model.number="editForm.sequentialOrder"
              class="form-input w-full dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400"
              min="1"
              placeholder="顺序起始位置，从1开始"
              type="number"
            />
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              数字越小越优先被选择，分组内账户会按此顺序调度
            </p>
          </div>

          <div class="flex gap-3 pt-4">
            <button
              class="btn btn-primary flex-1 px-4 py-2"
              :disabled="!editForm.name || updating"
              @click="updateGroup"
            >
              <div v-if="updating" class="loading-spinner mr-2" />
              {{ updating ? '更新中...' : '更新' }}
            </button>
            <button class="btn btn-secondary flex-1 px-4 py-2" @click="cancelEdit">取消</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { showToast } from '@/utils/toast'
import { apiClient } from '@/config/api'

const emit = defineEmits(['close', 'refresh'])

const show = ref(true)
const loading = ref(false)
const groups = ref([])

// 创建表单
const showCreateForm = ref(false)
const creating = ref(false)
const createForm = ref({
  name: '',
  platform: 'claude',
  description: '',
  schedulingStrategy: 'least_recent',
  schedulingWeight: 5,
  sequentialOrder: 1
})

// 编辑表单
const showEditForm = ref(false)
const updating = ref(false)
const editingGroup = ref(null)
const editForm = ref({
  name: '',
  platform: '',
  description: '',
  schedulingStrategy: 'least_recent',
  schedulingWeight: 5,
  sequentialOrder: 1
})

// 格式化日期
const formatDate = (dateStr) => {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  return date.toLocaleDateString('zh-CN')
}

// 加载分组列表
const loadGroups = async () => {
  loading.value = true
  try {
    const response = await apiClient.get('/admin/account-groups')
    groups.value = response.data || []
  } catch (error) {
    showToast('加载分组列表失败', 'error')
  } finally {
    loading.value = false
  }
}

// 创建分组
const createGroup = async () => {
  if (!createForm.value.name || !createForm.value.platform) {
    showToast('请填写必填项', 'error')
    return
  }

  creating.value = true
  try {
    const data = {
      name: createForm.value.name,
      platform: createForm.value.platform,
      description: createForm.value.description,
      schedulingStrategy: createForm.value.schedulingStrategy || 'least_recent'
    }

    // 添加调度策略相关参数
    if (createForm.value.schedulingStrategy === 'weighted_random') {
      data.schedulingWeight = createForm.value.schedulingWeight || 5
    }
    if (createForm.value.schedulingStrategy === 'sequential') {
      data.sequentialOrder = createForm.value.sequentialOrder || 1
    }

    await apiClient.post('/admin/account-groups', data)

    showToast('分组创建成功', 'success')
    cancelCreate()
    await loadGroups()
    emit('refresh')
  } catch (error) {
    showToast(error.response?.data?.error || '创建分组失败', 'error')
  } finally {
    creating.value = false
  }
}

// 取消创建
const cancelCreate = () => {
  showCreateForm.value = false
  createForm.value = {
    name: '',
    platform: 'claude',
    description: '',
    schedulingStrategy: 'least_recent',
    schedulingWeight: 5,
    sequentialOrder: 1
  }
}

// 编辑分组
const editGroup = (group) => {
  editingGroup.value = group
  editForm.value = {
    name: group.name,
    platform: group.platform,
    description: group.description || '',
    schedulingStrategy: group.schedulingStrategy || 'least_recent',
    schedulingWeight: group.schedulingWeight || 5,
    sequentialOrder: group.sequentialOrder || 1
  }
  showEditForm.value = true
}

// 更新分组
const updateGroup = async () => {
  if (!editForm.value.name) {
    showToast('请填写分组名称', 'error')
    return
  }

  updating.value = true
  try {
    const data = {
      name: editForm.value.name,
      description: editForm.value.description,
      schedulingStrategy: editForm.value.schedulingStrategy || 'least_recent'
    }

    // 添加调度策略相关参数
    if (editForm.value.schedulingStrategy === 'weighted_random') {
      data.schedulingWeight = editForm.value.schedulingWeight || 5
    }
    if (editForm.value.schedulingStrategy === 'sequential') {
      data.sequentialOrder = editForm.value.sequentialOrder || 1
    }

    await apiClient.put(`/admin/account-groups/${editingGroup.value.id}`, data)

    showToast('分组更新成功', 'success')
    cancelEdit()
    await loadGroups()
    emit('refresh')
  } catch (error) {
    showToast(error.response?.data?.error || '更新分组失败', 'error')
  } finally {
    updating.value = false
  }
}

// 取消编辑
const cancelEdit = () => {
  showEditForm.value = false
  editingGroup.value = null
  editForm.value = {
    name: '',
    platform: '',
    description: '',
    schedulingStrategy: 'least_recent',
    schedulingWeight: 5,
    sequentialOrder: 1
  }
}

// 删除分组
const deleteGroup = async (group) => {
  if (group.memberCount > 0) {
    showToast('分组内还有成员，无法删除', 'error')
    return
  }

  if (!confirm(`确定要删除分组 "${group.name}" 吗？`)) {
    return
  }

  try {
    await apiClient.delete(`/admin/account-groups/${group.id}`)
    showToast('分组删除成功', 'success')
    await loadGroups()
    emit('refresh')
  } catch (error) {
    showToast(error.response?.data?.error || '删除分组失败', 'error')
  }
}

// 调度策略相关辅助函数
const getStrategyIcon = (strategy) => {
  const icons = {
    round_robin: 'fas fa-sync-alt text-blue-500',
    least_used: 'fas fa-chart-bar text-green-500',
    least_recent: 'fas fa-clock text-orange-500',
    random: 'fas fa-random text-purple-500',
    weighted_random: 'fas fa-balance-scale text-amber-500',
    sequential: 'fas fa-list-ol text-indigo-500'
  }
  return icons[strategy] || 'fas fa-clock text-orange-500'
}

const getStrategyName = (strategy) => {
  const names = {
    round_robin: '轮询',
    least_used: '最少使用',
    least_recent: '最近最少使用',
    random: '随机',
    weighted_random: '加权随机',
    sequential: '顺序'
  }
  return names[strategy] || '最近最少使用'
}

const getStrategyColor = (strategy) => {
  const colors = {
    round_robin: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    least_used: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    least_recent: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    random: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    weighted_random: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    sequential: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400'
  }
  return (
    colors[strategy] || 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
  )
}

// 组件挂载时加载数据
onMounted(() => {
  loadGroups()
})
</script>
