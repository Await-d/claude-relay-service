<template>
  <div class="settings-container">
    <div class="card p-4 sm:p-6">
      <!-- 页面标题 -->
      <div class="mb-4 sm:mb-6">
        <h3 class="mb-1 text-lg font-bold text-gray-900 dark:text-gray-100 sm:mb-2 sm:text-xl">
          系统设置
        </h3>
        <p class="text-sm text-gray-600 dark:text-gray-400 sm:text-base">网站定制和通知配置</p>
      </div>

      <!-- 设置分类导航 -->
      <div class="mb-6">
        <nav class="flex space-x-8">
          <button
            :class="[
              'border-b-2 pb-2 text-sm font-medium transition-colors',
              activeSection === 'branding'
                ? 'border-blue-500 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
            ]"
            @click="activeSection = 'branding'"
          >
            <i class="fas fa-palette mr-2"></i>
            品牌设置
          </button>
          <button
            :class="[
              'border-b-2 pb-2 text-sm font-medium transition-colors',
              activeSection === 'scheduling'
                ? 'border-blue-500 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
            ]"
            @click="activeSection = 'scheduling'"
          >
            <i class="fas fa-route mr-2"></i>
            调度策略配置
          </button>
          <button
            :class="[
              'border-b-2 pb-2 text-sm font-medium transition-colors',
              activeSection === 'webhook'
                ? 'border-blue-500 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
            ]"
            @click="activeSection = 'webhook'"
          >
            <i class="fas fa-bell mr-2"></i>
            通知设置
          </button>
          <button
            :class="[
              'border-b-2 pb-2 text-sm font-medium transition-colors',
              activeSection === 'data-management'
                ? 'border-blue-500 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
            ]"
            @click="activeSection = 'data-management'"
          >
            <i class="fas fa-database mr-2"></i>
            数据管理
          </button>
        </nav>
      </div>

      <!-- 加载状态 -->
      <div v-if="loading" class="py-12 text-center">
        <div class="loading-spinner mx-auto mb-4">
          <p class="text-gray-500 dark:text-gray-400">正在加载设置...</p>
        </div>
      </div>

      <!-- 内容区域 -->
      <div v-else>
        <!-- 品牌设置部分 -->
        <div v-show="activeSection === 'branding'">
          <!-- 品牌设置内容保持不变 -->
          <!-- 桌面端表格视图 -->
          <div class="table-container hidden sm:block">
            <table class="min-w-full">
              <tbody class="divide-y divide-gray-200/50 dark:divide-gray-600/50">
                <!-- 网站名称 -->
                <tr class="table-row">
                  <td class="w-48 whitespace-nowrap px-6 py-4">
                    <div class="flex items-center">
                      <div
                        class="mr-3 flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-blue-600"
                      >
                        <i class="fas fa-font text-xs text-white" />
                      </div>
                      <div>
                        <div class="text-sm font-semibold text-gray-900 dark:text-gray-100">
                          网站名称
                        </div>
                        <div class="text-xs text-gray-500 dark:text-gray-400">品牌标识</div>
                      </div>
                    </div>
                  </td>
                  <td class="px-6 py-4">
                    <input
                      v-model="oemSettings.siteName"
                      class="form-input w-full max-w-md dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
                      maxlength="100"
                      placeholder="Claude Relay Service"
                      type="text"
                    />
                    <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      将显示在浏览器标题和页面头部
                    </p>
                  </td>
                </tr>

                <!-- 网站图标 -->
                <tr class="table-row">
                  <td class="w-48 whitespace-nowrap px-6 py-4">
                    <div class="flex items-center">
                      <div
                        class="mr-3 flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-purple-600"
                      >
                        <i class="fas fa-image text-xs text-white" />
                      </div>
                      <div>
                        <div class="text-sm font-semibold text-gray-900 dark:text-gray-100">
                          网站图标
                        </div>
                        <div class="text-xs text-gray-500 dark:text-gray-400">Favicon</div>
                      </div>
                    </div>
                  </td>
                  <td class="px-6 py-4">
                    <div class="space-y-3">
                      <!-- 图标预览 -->
                      <div
                        v-if="oemSettings.siteIconData || oemSettings.siteIcon"
                        class="inline-flex items-center gap-3 rounded-lg bg-gray-50 p-3 dark:bg-gray-700"
                      >
                        <img
                          alt="图标预览"
                          class="h-8 w-8"
                          :src="oemSettings.siteIconData || oemSettings.siteIcon"
                          @error="handleIconError"
                        />
                        <span class="text-sm text-gray-600 dark:text-gray-400">当前图标</span>
                        <button
                          class="rounded-lg px-3 py-1 font-medium text-red-600 transition-colors hover:bg-red-50 hover:text-red-900"
                          @click="removeIcon"
                        >
                          <i class="fas fa-trash mr-1" />删除
                        </button>
                      </div>

                      <!-- 文件上传 -->
                      <div>
                        <input
                          ref="iconFileInput"
                          accept=".ico,.png,.jpg,.jpeg,.svg"
                          class="hidden"
                          type="file"
                          @change="handleIconUpload"
                        />
                        <button
                          class="btn btn-success px-4 py-2"
                          @click="$refs.iconFileInput.click()"
                        >
                          <i class="fas fa-upload mr-2" />
                          上传图标
                        </button>
                        <span class="ml-3 text-xs text-gray-500 dark:text-gray-400"
                          >支持 .ico, .png, .jpg, .svg 格式，最大 350KB</span
                        >
                      </div>
                    </div>
                  </td>
                </tr>

                <!-- 操作按钮 -->
                <tr>
                  <td class="px-6 py-6" colspan="2">
                    <div class="flex items-center justify-between">
                      <div class="flex gap-3">
                        <button
                          class="btn btn-primary px-6 py-3"
                          :class="{ 'cursor-not-allowed opacity-50': saving }"
                          :disabled="saving"
                          @click="saveOemSettings"
                        >
                          <div v-if="saving" class="loading-spinner mr-2"></div>
                          <i v-else class="fas fa-save mr-2" />
                          {{ saving ? '保存中...' : '保存设置' }}
                        </button>

                        <button
                          class="btn bg-gray-100 px-6 py-3 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                          :disabled="saving"
                          @click="resetOemSettings"
                        >
                          <i class="fas fa-undo mr-2" />
                          重置为默认
                        </button>
                      </div>

                      <div
                        v-if="oemSettings.updatedAt"
                        class="text-sm text-gray-500 dark:text-gray-400"
                      >
                        <i class="fas fa-clock mr-1" />
                        最后更新：{{ formatDateTime(oemSettings.updatedAt) }}
                      </div>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- 移动端卡片视图 -->
          <div class="space-y-4 sm:hidden">
            <!-- 省略移动端视图代码... -->
          </div>
        </div>

        <!-- 调度策略配置部分 -->
        <div v-show="activeSection === 'scheduling'">
          <!-- 全局默认策略设置 -->
          <div
            class="mb-6 rounded-lg bg-white/80 p-6 shadow-lg backdrop-blur-sm dark:bg-gray-800/80"
          >
            <div class="mb-4 flex items-center justify-between">
              <div>
                <h2 class="text-lg font-semibold text-gray-800 dark:text-gray-200">
                  <i class="fas fa-route mr-2 text-blue-500" />
                  全局默认调度策略
                </h2>
                <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  设置系统的默认调度策略，影响所有未单独配置的账户和分组
                </p>
              </div>
              <div class="text-xs text-gray-500 dark:text-gray-400">
                当前生效：{{ getCurrentEffectiveStrategy() }}
              </div>
            </div>

            <div class="space-y-4">
              <div>
                <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  默认策略
                </label>
                <select
                  v-model="schedulingConfig.globalDefaultStrategy"
                  class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  @change="saveSchedulingConfig"
                >
                  <option value="round_robin">轮询调度 (Round Robin)</option>
                  <option value="least_used">最少使用 (Least Used)</option>
                  <option value="least_recent">最近最少使用 (Least Recent)</option>
                  <option value="random">随机调度 (Random)</option>
                  <option value="weighted_random">加权随机 (Weighted Random)</option>
                  <option value="sequential">顺序调度 (Sequential)</option>
                </select>
              </div>

              <!-- 策略说明 -->
              <div
                class="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-700 dark:bg-blue-900/30"
              >
                <div class="flex items-start gap-2">
                  <i :class="getStrategyIcon(schedulingConfig.globalDefaultStrategy)" />
                  <div class="text-sm text-blue-700 dark:text-blue-300">
                    <p class="mb-1 font-medium">
                      {{ getStrategyName(schedulingConfig.globalDefaultStrategy) }}策略说明：
                    </p>
                    <p>{{ getStrategyDescription(schedulingConfig.globalDefaultStrategy) }}</p>
                  </div>
                </div>
              </div>

              <!-- 全局权重/顺序配置 -->
              <div
                v-if="schedulingConfig.globalDefaultStrategy === 'weighted_random'"
                class="space-y-2"
              >
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  <i class="fas fa-weight-hanging mr-2 text-amber-500" />
                  全局默认权重 (1-10)
                </label>
                <input
                  v-model.number="schedulingConfig.globalDefaultWeight"
                  class="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  max="10"
                  min="1"
                  type="number"
                  @change="saveSchedulingConfig"
                />
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  权重越高的账户被选中的概率越大
                </p>
              </div>

              <div
                v-else-if="schedulingConfig.globalDefaultStrategy === 'sequential'"
                class="space-y-2"
              >
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  <i class="fas fa-sort-numeric-down mr-2 text-indigo-500" />
                  全局默认起始位置
                </label>
                <input
                  v-model.number="schedulingConfig.globalDefaultOrder"
                  class="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  min="1"
                  type="number"
                  @change="saveSchedulingConfig"
                />
                <p class="text-xs text-gray-500 dark:text-gray-400">数字越小的账户优先被选择</p>
              </div>
            </div>
          </div>

          <!-- 覆盖设置 -->
          <div
            class="mb-6 rounded-lg bg-white/80 p-6 shadow-lg backdrop-blur-sm dark:bg-gray-800/80"
          >
            <h2 class="mb-4 text-lg font-semibold text-gray-800 dark:text-gray-200">
              <i class="fas fa-cogs mr-2 text-green-500" />
              策略覆盖设置
            </h2>
            <div class="space-y-4">
              <div class="flex items-center justify-between">
                <div>
                  <h3 class="font-medium text-gray-700 dark:text-gray-300">账户级别覆盖</h3>
                  <p class="text-sm text-gray-500 dark:text-gray-400">
                    允许单个账户覆盖全局调度策略
                  </p>
                </div>
                <label class="relative inline-flex cursor-pointer items-center">
                  <input
                    v-model="schedulingConfig.enableAccountOverride"
                    class="peer sr-only"
                    type="checkbox"
                    @change="saveSchedulingConfig"
                  />
                  <div
                    class="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:border-gray-600 dark:bg-gray-700 dark:peer-focus:ring-blue-800"
                  ></div>
                </label>
              </div>

              <div class="flex items-center justify-between">
                <div>
                  <h3 class="font-medium text-gray-700 dark:text-gray-300">分组级别覆盖</h3>
                  <p class="text-sm text-gray-500 dark:text-gray-400">允许分组覆盖全局调度策略</p>
                </div>
                <label class="relative inline-flex cursor-pointer items-center">
                  <input
                    v-model="schedulingConfig.enableGroupOverride"
                    class="peer sr-only"
                    type="checkbox"
                    @change="saveSchedulingConfig"
                  />
                  <div
                    class="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:border-gray-600 dark:bg-gray-700 dark:peer-focus:ring-blue-800"
                  ></div>
                </label>
              </div>
            </div>
          </div>

          <!-- 使用统计 -->
          <div
            class="mb-6 rounded-lg bg-white/80 p-6 shadow-lg backdrop-blur-sm dark:bg-gray-800/80"
          >
            <h2 class="mb-4 text-lg font-semibold text-gray-800 dark:text-gray-200">
              <i class="fas fa-chart-pie mr-2 text-purple-500" />
              当前使用统计
            </h2>
            <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div class="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-sm font-medium text-gray-600 dark:text-gray-400">使用全局策略</p>
                    <p class="text-2xl font-bold text-blue-600 dark:text-blue-400">
                      {{ schedulingStats.globalStrategyCount || 0 }}
                    </p>
                  </div>
                  <i class="fas fa-globe text-xl text-blue-500" />
                </div>
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">账户数量</p>
              </div>

              <div class="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-sm font-medium text-gray-600 dark:text-gray-400">自定义策略</p>
                    <p class="text-2xl font-bold text-green-600 dark:text-green-400">
                      {{ schedulingStats.customStrategyCount || 0 }}
                    </p>
                  </div>
                  <i class="fas fa-cog text-xl text-green-500" />
                </div>
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">账户数量</p>
              </div>

              <div class="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-sm font-medium text-gray-600 dark:text-gray-400">分组策略</p>
                    <p class="text-2xl font-bold text-purple-600 dark:text-purple-400">
                      {{ schedulingStats.groupStrategyCount || 0 }}
                    </p>
                  </div>
                  <i class="fas fa-layer-group text-xl text-purple-500" />
                </div>
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">分组数量</p>
              </div>
            </div>
          </div>

          <!-- 保存重置按钮 -->
          <div class="flex items-center justify-between">
            <div class="flex gap-3">
              <button
                class="btn btn-primary px-6 py-3"
                :class="{ 'cursor-not-allowed opacity-50': savingScheduling }"
                :disabled="savingScheduling"
                @click="saveSchedulingConfig"
              >
                <div v-if="savingScheduling" class="loading-spinner mr-2"></div>
                <i v-else class="fas fa-save mr-2" />
                {{ savingScheduling ? '保存中...' : '保存配置' }}
              </button>

              <button
                class="btn bg-gray-100 px-6 py-3 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                :disabled="savingScheduling"
                @click="resetSchedulingConfig"
              >
                <i class="fas fa-undo mr-2" />
                重置为默认
              </button>
            </div>

            <div v-if="schedulingConfig.updatedAt" class="text-sm text-gray-500 dark:text-gray-400">
              <i class="fas fa-clock mr-1" />
              最后更新：{{ formatDateTime(schedulingConfig.updatedAt) }}
            </div>
          </div>
        </div>

        <!-- Webhook 设置部分 -->
        <div v-show="activeSection === 'webhook'">
          <!-- 主开关 -->
          <div
            class="mb-6 rounded-lg bg-white/80 p-6 shadow-lg backdrop-blur-sm dark:bg-gray-800/80"
          >
            <div class="flex items-center justify-between">
              <div>
                <h2 class="text-lg font-semibold text-gray-800 dark:text-gray-200">
                  启用 Webhook 通知
                </h2>
                <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  开启后，系统将按配置发送通知到指定平台
                </p>
              </div>
              <label class="relative inline-flex cursor-pointer items-center">
                <input
                  v-model="webhookConfig.enabled"
                  class="peer sr-only"
                  type="checkbox"
                  @change="saveWebhookConfig"
                />
                <div
                  class="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:border-gray-600 dark:bg-gray-700 dark:peer-focus:ring-blue-800"
                ></div>
              </label>
            </div>
          </div>

          <!-- 通知类型设置 -->
          <div
            class="mb-6 rounded-lg bg-white/80 p-6 shadow-lg backdrop-blur-sm dark:bg-gray-800/80"
          >
            <h2 class="mb-4 text-lg font-semibold text-gray-800 dark:text-gray-200">通知类型</h2>
            <div class="space-y-3">
              <div
                v-for="(enabled, type) in webhookConfig.notificationTypes"
                :key="type"
                class="flex items-center justify-between"
              >
                <div>
                  <span class="font-medium text-gray-700 dark:text-gray-300">
                    {{ getNotificationTypeName(type) }}
                  </span>
                  <span class="ml-2 text-sm text-gray-500 dark:text-gray-400">
                    {{ getNotificationTypeDescription(type) }}
                  </span>
                </div>
                <label class="relative inline-flex cursor-pointer items-center">
                  <input
                    v-model="webhookConfig.notificationTypes[type]"
                    class="peer sr-only"
                    type="checkbox"
                    @change="saveWebhookConfig"
                  />
                  <div
                    class="peer h-5 w-9 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-green-600 peer-checked:after:translate-x-full peer-checked:after:border-white dark:border-gray-600 dark:bg-gray-700"
                  ></div>
                </label>
              </div>
            </div>
          </div>

          <!-- 平台列表 -->
          <div
            class="mb-6 rounded-lg bg-white/80 p-6 shadow-lg backdrop-blur-sm dark:bg-gray-800/80"
          >
            <div class="mb-4 flex items-center justify-between">
              <h2 class="text-lg font-semibold text-gray-800 dark:text-gray-200">通知平台</h2>
              <button
                class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                @click="showAddPlatformModal = true"
              >
                <i class="fas fa-plus mr-2"></i>
                添加平台
              </button>
            </div>

            <!-- 平台卡片列表 -->
            <div
              v-if="webhookConfig.platforms && webhookConfig.platforms.length > 0"
              class="space-y-4"
            >
              <div
                v-for="platform in webhookConfig.platforms"
                :key="platform.id"
                class="rounded-lg border border-gray-200 p-4 dark:border-gray-700"
              >
                <div class="flex items-start justify-between">
                  <div class="flex-1">
                    <div class="flex items-center">
                      <i class="mr-3 text-xl" :class="getPlatformIcon(platform.type)"></i>
                      <div>
                        <h3 class="font-semibold text-gray-800 dark:text-gray-200">
                          {{ platform.name || getPlatformName(platform.type) }}
                        </h3>
                        <p class="text-sm text-gray-500 dark:text-gray-400">
                          {{ getPlatformName(platform.type) }}
                        </p>
                      </div>
                    </div>
                    <div class="mt-3 space-y-1 text-sm">
                      <div class="flex items-center text-gray-600 dark:text-gray-400">
                        <i class="fas fa-link mr-2"></i>
                        <span class="truncate">{{ platform.url }}</span>
                      </div>
                      <div
                        v-if="platform.enableSign"
                        class="flex items-center text-gray-600 dark:text-gray-400"
                      >
                        <i class="fas fa-shield-alt mr-2"></i>
                        <span>已启用签名验证</span>
                      </div>
                    </div>
                  </div>
                  <div class="ml-4 flex items-center space-x-2">
                    <!-- 启用/禁用开关 -->
                    <label class="relative inline-flex cursor-pointer items-center">
                      <input
                        :checked="platform.enabled"
                        class="peer sr-only"
                        type="checkbox"
                        @change="togglePlatform(platform.id)"
                      />
                      <div
                        class="peer h-5 w-9 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-green-600 peer-checked:after:translate-x-full peer-checked:after:border-white dark:border-gray-600 dark:bg-gray-700"
                      ></div>
                    </label>
                    <!-- 测试按钮 -->
                    <button
                      class="rounded-lg bg-blue-100 p-2 text-blue-600 transition-colors hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-400 dark:hover:bg-blue-800"
                      title="测试连接"
                      @click="testPlatform(platform)"
                    >
                      <i class="fas fa-vial"></i>
                    </button>
                    <!-- 编辑按钮 -->
                    <button
                      class="rounded-lg bg-gray-100 p-2 text-gray-600 transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600"
                      title="编辑"
                      @click="editPlatform(platform)"
                    >
                      <i class="fas fa-edit"></i>
                    </button>
                    <!-- 删除按钮 -->
                    <button
                      class="rounded-lg bg-red-100 p-2 text-red-600 transition-colors hover:bg-red-200 dark:bg-red-900 dark:text-red-400 dark:hover:bg-red-800"
                      title="删除"
                      @click="deletePlatform(platform.id)"
                    >
                      <i class="fas fa-trash"></i>
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="py-8 text-center text-gray-500 dark:text-gray-400">
              暂无配置的通知平台，请点击"添加平台"按钮添加
            </div>
          </div>

          <!-- 高级设置 -->
          <div class="rounded-lg bg-white/80 p-6 shadow-lg backdrop-blur-sm dark:bg-gray-800/80">
            <h2 class="mb-4 text-lg font-semibold text-gray-800 dark:text-gray-200">高级设置</h2>
            <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  最大重试次数
                </label>
                <input
                  v-model.number="webhookConfig.retrySettings.maxRetries"
                  class="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white sm:text-sm"
                  max="10"
                  min="0"
                  type="number"
                  @change="saveWebhookConfig"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  重试延迟 (毫秒)
                </label>
                <input
                  v-model.number="webhookConfig.retrySettings.retryDelay"
                  class="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white sm:text-sm"
                  max="10000"
                  min="100"
                  step="100"
                  type="number"
                  @change="saveWebhookConfig"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  超时时间 (毫秒)
                </label>
                <input
                  v-model.number="webhookConfig.retrySettings.timeout"
                  class="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white sm:text-sm"
                  max="30000"
                  min="1000"
                  step="1000"
                  type="number"
                  @change="saveWebhookConfig"
                />
              </div>
            </div>
          </div>

          <!-- 测试通知按钮 -->
          <div class="mt-6 text-center">
            <button
              class="rounded-lg bg-green-600 px-6 py-3 text-white shadow-lg transition-all hover:bg-green-700 hover:shadow-xl"
              @click="sendTestNotification"
            >
              <i class="fas fa-paper-plane mr-2"></i>
              发送测试通知
            </button>
          </div>
        </div>

        <!-- 数据管理部分 -->
        <div v-show="activeSection === 'data-management'">
          <!-- 数据概览 -->
          <div class="overview-section mb-6 rounded-lg bg-white p-6 dark:bg-gray-800">
            <h2 class="mb-4 text-lg font-semibold text-gray-800 dark:text-gray-200">数据概览</h2>

            <div class="grid grid-cols-2 gap-4 md:grid-cols-4">
              <div class="stat-card">
                <div class="text-2xl font-bold text-blue-600">{{ dataOverview.apiKeys }}</div>
                <div class="text-sm text-gray-600 dark:text-gray-400">API Keys</div>
              </div>
              <div class="stat-card">
                <div class="text-2xl font-bold text-green-600">
                  {{ dataOverview.claudeAccounts }}
                </div>
                <div class="text-sm text-gray-600 dark:text-gray-400">Claude账户</div>
              </div>
              <div class="stat-card">
                <div class="text-2xl font-bold text-purple-600">
                  {{ dataOverview.openaiAccounts }}
                </div>
                <div class="text-sm text-gray-600 dark:text-gray-400">OpenAI账户</div>
              </div>
              <div class="stat-card">
                <div class="text-2xl font-bold text-orange-600">
                  {{ dataOverview.systemConfig }}
                </div>
                <div class="text-sm text-gray-600 dark:text-gray-400">系统配置</div>
              </div>
            </div>

            <div class="mt-4 border-t border-gray-200 pt-4 dark:border-gray-700">
              <div class="flex items-center justify-between">
                <div class="flex items-center space-x-4">
                  <div class="flex items-center">
                    <div
                      class="mr-2 h-3 w-3 rounded-full"
                      :class="dataOverview.is2FAEnabled ? 'bg-green-500' : 'bg-red-500'"
                    ></div>
                    <span class="text-sm text-gray-600 dark:text-gray-400">
                      2FA状态: {{ dataOverview.is2FAEnabled ? '已启用' : '未启用' }}
                    </span>
                  </div>
                </div>
                <div v-if="dataOverview.lastExport" class="text-sm text-gray-500">
                  最后导出: {{ formatDate(dataOverview.lastExport) }}
                </div>
              </div>
            </div>
          </div>

          <!-- 2FA设置提醒 -->
          <div v-if="!dataOverview.is2FAEnabled" class="mb-6">
            <div
              class="rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-900/20"
            >
              <div class="flex items-center">
                <svg class="mr-3 h-5 w-5 text-yellow-600" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    clip-rule="evenodd"
                    d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                    fill-rule="evenodd"
                  />
                </svg>
                <div>
                  <h3 class="font-medium text-yellow-800 dark:text-yellow-200">需要启用2FA</h3>
                  <p class="mt-1 text-sm text-yellow-700 dark:text-yellow-300">
                    数据导出等敏感操作需要双因素认证保护，请先设置2FA。
                  </p>
                </div>
              </div>
              <div class="mt-3">
                <button
                  class="rounded-md bg-yellow-600 px-4 py-2 text-sm font-medium text-white hover:bg-yellow-700"
                  @click="showSetup2FA"
                >
                  设置2FA
                </button>
              </div>
            </div>
          </div>

          <!-- 主功能区域 -->
          <div class="grid grid-cols-1 gap-6 md:grid-cols-3">
            <!-- 数据导出 -->
            <div class="feature-card">
              <div class="mb-4 flex items-center">
                <svg
                  class="mr-3 h-8 w-8 text-blue-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                  />
                </svg>
                <h3 class="text-lg font-semibold text-gray-800 dark:text-gray-200">数据导出</h3>
              </div>
              <p class="mb-4 text-sm text-gray-600 dark:text-gray-400">
                将当前数据库中的所有数据导出为加密的ZIP文件
              </p>

              <div class="mb-4 space-y-3">
                <label class="flex items-center">
                  <input
                    v-model="exportOptions.includeStats"
                    class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    type="checkbox"
                  />
                  <span class="ml-2 text-sm text-gray-700 dark:text-gray-300">包含使用统计</span>
                </label>
              </div>

              <button
                class="w-full rounded-md bg-blue-600 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-700 disabled:bg-gray-400"
                :disabled="!dataOverview.is2FAEnabled || exporting"
                @click="initiateExport"
              >
                <span v-if="exporting">导出中...</span>
                <span v-else>开始导出</span>
              </button>
            </div>

            <!-- 数据导入 -->
            <div class="feature-card">
              <div class="mb-4 flex items-center">
                <svg
                  class="mr-3 h-8 w-8 text-green-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                  />
                </svg>
                <h3 class="text-lg font-semibold text-gray-800 dark:text-gray-200">数据导入</h3>
              </div>
              <p class="mb-4 text-sm text-gray-600 dark:text-gray-400">
                从导出的ZIP文件恢复数据到当前数据库
              </p>

              <div class="mb-4 space-y-3">
                <div>
                  <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    冲突处理策略
                  </label>
                  <select
                    v-model="importOptions.conflictStrategy"
                    class="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  >
                    <option value="skip">跳过已存在的记录</option>
                    <option value="overwrite">覆盖已存在的记录</option>
                    <option value="merge">智能合并记录</option>
                  </select>
                </div>

                <div>
                  <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    选择文件
                  </label>
                  <input
                    ref="importFileInput"
                    accept=".zip,.json"
                    class="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    type="file"
                    @change="handleImportFileSelect"
                  />
                </div>
              </div>

              <button
                class="w-full rounded-md bg-green-600 px-4 py-2 font-medium text-white transition-colors hover:bg-green-700 disabled:bg-gray-400"
                :disabled="!dataOverview.is2FAEnabled || !importFile || importing"
                @click="initiateImport"
              >
                <span v-if="importing">导入中...</span>
                <span v-else>开始导入</span>
              </button>
            </div>

            <!-- 数据库迁移 -->
            <div class="feature-card">
              <div class="mb-4 flex items-center">
                <svg
                  class="mr-3 h-8 w-8 text-purple-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                  />
                </svg>
                <h3 class="text-lg font-semibold text-gray-800 dark:text-gray-200">数据库迁移</h3>
              </div>
              <p class="mb-4 text-sm text-gray-600 dark:text-gray-400">
                将数据迁移到其他数据库系统（MongoDB、MySQL、PostgreSQL）
              </p>

              <div class="mb-4 space-y-3">
                <label class="flex items-center">
                  <input
                    v-model="migrationOptions.validateOnly"
                    class="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                    type="checkbox"
                  />
                  <span class="ml-2 text-sm text-gray-700 dark:text-gray-300"
                    >仅验证（不执行迁移）</span
                  >
                </label>

                <div>
                  <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    目标数据库配置文件
                  </label>
                  <input
                    ref="migrationConfigInput"
                    accept=".json"
                    class="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    type="file"
                    @change="handleMigrationConfigSelect"
                  />
                </div>
              </div>

              <button
                class="w-full rounded-md bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-700 disabled:bg-gray-400"
                :disabled="!dataOverview.is2FAEnabled || !migrationConfig || migrating"
                @click="initiateMigration"
              >
                <span v-if="migrating">迁移中...</span>
                <span v-else>开始迁移</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 添加/编辑平台模态框 -->
  <div
    v-if="showAddPlatformModal"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm transition-all duration-300 ease-out"
    @click="closePlatformModal"
  >
    <div
      class="relative mx-4 w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl transition-all duration-300 ease-out dark:bg-gray-800"
      @click.stop
    >
      <!-- 头部 -->
      <div
        class="dark:to-gray-750 relative border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50 px-6 py-5 dark:border-gray-700 dark:from-gray-800"
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-3">
            <div
              class="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg"
            >
              <i class="fas fa-bell"></i>
            </div>
            <div>
              <h3 class="text-xl font-semibold text-gray-900 dark:text-white">
                {{ editingPlatform ? '编辑' : '添加' }}通知平台
              </h3>
              <p class="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
                配置{{ editingPlatform ? '并更新' : '新的' }}Webhook通知渠道
              </p>
            </div>
          </div>
          <button
            class="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
            @click="closePlatformModal"
          >
            <i class="fas fa-times text-lg"></i>
          </button>
        </div>
      </div>

      <!-- 内容区域 -->
      <div class="p-6">
        <div class="space-y-5">
          <!-- 平台类型选择 -->
          <div>
            <label
              class="mb-2 flex items-center text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              <i class="fas fa-layer-group mr-2 text-gray-400"></i>
              平台类型
            </label>
            <div class="relative">
              <select
                v-model="platformForm.type"
                class="w-full appearance-none rounded-xl border border-gray-300 bg-white px-4 py-3 pr-10 text-gray-900 shadow-sm transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                :disabled="editingPlatform"
              >
                <option value="wechat_work">🟢 企业微信</option>
                <option value="dingtalk">🔵 钉钉</option>
                <option value="feishu">🟦 飞书</option>
                <option value="slack">🟣 Slack</option>
                <option value="discord">🟪 Discord</option>
                <option value="custom">⚙️ 自定义</option>
              </select>
              <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                <i class="fas fa-chevron-down text-gray-400"></i>
              </div>
            </div>
            <p v-if="editingPlatform" class="mt-1 text-xs text-amber-600 dark:text-amber-400">
              <i class="fas fa-info-circle mr-1"></i>
              编辑模式下不能更改平台类型
            </p>
          </div>

          <!-- 平台名称 -->
          <div>
            <label
              class="mb-2 flex items-center text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              <i class="fas fa-tag mr-2 text-gray-400"></i>
              名称
              <span class="ml-2 text-xs text-gray-500">(可选)</span>
            </label>
            <input
              v-model="platformForm.name"
              class="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm transition-all placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder:text-gray-500"
              placeholder="例如：运维群通知、开发测试群"
              type="text"
            />
          </div>

          <!-- Webhook URL -->
          <div>
            <label
              class="mb-2 flex items-center text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              <i class="fas fa-link mr-2 text-gray-400"></i>
              Webhook URL
              <span class="ml-1 text-xs text-red-500">*</span>
            </label>
            <div class="relative">
              <input
                v-model="platformForm.url"
                class="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 pr-10 font-mono text-sm text-gray-900 shadow-sm transition-all placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder:text-gray-500"
                :class="{
                  'border-red-500 focus:border-red-500 focus:ring-red-500/20': urlError,
                  'border-green-500 focus:border-green-500 focus:ring-green-500/20': urlValid
                }"
                placeholder="https://..."
                required
                type="url"
                @input="validateUrl"
              />
              <div v-if="urlValid" class="absolute inset-y-0 right-0 flex items-center pr-3">
                <i class="fas fa-check-circle text-green-500"></i>
              </div>
              <div v-if="urlError" class="absolute inset-y-0 right-0 flex items-center pr-3">
                <i class="fas fa-exclamation-circle text-red-500"></i>
              </div>
            </div>
            <div
              v-if="getWebhookHint(platformForm.type)"
              class="mt-2 flex items-start rounded-lg bg-blue-50 p-3 dark:bg-blue-900/20"
            >
              <i class="fas fa-info-circle mr-2 mt-0.5 text-blue-600 dark:text-blue-400"></i>
              <p class="text-sm text-blue-700 dark:text-blue-300">
                {{ getWebhookHint(platformForm.type) }}
              </p>
            </div>
          </div>

          <!-- 签名设置（钉钉/飞书） -->
          <div
            v-if="platformForm.type === 'dingtalk' || platformForm.type === 'feishu'"
            class="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/50"
          >
            <div class="space-y-4">
              <div class="flex items-center justify-between">
                <label class="flex cursor-pointer items-center" for="enableSign">
                  <input
                    id="enableSign"
                    v-model="platformForm.enableSign"
                    class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0"
                    type="checkbox"
                  />
                  <span
                    class="ml-3 flex items-center text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    <i class="fas fa-shield-alt mr-2 text-gray-400"></i>
                    启用签名验证
                  </span>
                </label>
                <span
                  v-if="platformForm.enableSign"
                  class="rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700 dark:bg-green-900/50 dark:text-green-400"
                >
                  已启用
                </span>
              </div>
              <transition
                enter-active-class="transition-all duration-200 ease-out"
                enter-from-class="opacity-0 -translate-y-2"
                enter-to-class="opacity-100 translate-y-0"
                leave-active-class="transition-all duration-150 ease-in"
                leave-from-class="opacity-100 translate-y-0"
                leave-to-class="opacity-0 -translate-y-2"
              >
                <div v-if="platformForm.enableSign">
                  <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    签名密钥
                  </label>
                  <input
                    v-model="platformForm.secret"
                    class="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 font-mono text-sm text-gray-900 shadow-sm transition-all placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-500"
                    placeholder="SEC..."
                    type="text"
                  />
                </div>
              </transition>
            </div>
          </div>
        </div>
      </div>

      <!-- 底部按钮 -->
      <div
        class="border-t border-gray-200 bg-gray-50 px-6 py-4 dark:border-gray-700 dark:bg-gray-900/50"
      >
        <div class="flex items-center justify-between">
          <div class="text-xs text-gray-500 dark:text-gray-400">
            <i class="fas fa-asterisk mr-1 text-red-500"></i>
            必填项
          </div>
          <div class="flex space-x-3">
            <button
              class="group flex items-center rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-all hover:bg-gray-50 hover:shadow-md dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              @click="closePlatformModal"
            >
              <i class="fas fa-times mr-2 transition-transform group-hover:scale-110"></i>
              取消
            </button>
            <button
              class="group flex items-center rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-700 shadow-sm transition-all hover:bg-blue-100 hover:shadow-md dark:border-blue-800 dark:bg-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-900/70"
              :disabled="testingConnection"
              @click="testPlatformForm"
            >
              <i
                class="mr-2 transition-transform"
                :class="
                  testingConnection ? 'fas fa-spinner fa-spin' : 'fas fa-vial group-hover:scale-110'
                "
              ></i>
              {{ testingConnection ? '测试中...' : '测试连接' }}
            </button>
            <button
              class="group flex items-center rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-2.5 text-sm font-medium text-white shadow-md transition-all hover:from-blue-700 hover:to-indigo-700 hover:shadow-lg disabled:cursor-not-allowed disabled:from-gray-400 disabled:to-gray-500"
              :disabled="!platformForm.url || savingPlatform"
              @click="savePlatform"
            >
              <i
                class="mr-2 transition-transform"
                :class="
                  savingPlatform ? 'fas fa-spinner fa-spin' : 'fas fa-save group-hover:scale-110'
                "
              ></i>
              {{ savingPlatform ? '保存中...' : editingPlatform ? '保存修改' : '添加平台' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 2FA设置模态框 -->
  <div
    v-if="show2FASetup"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
  >
    <div class="mx-4 w-full max-w-md rounded-lg bg-white p-6 dark:bg-gray-800">
      <div class="mb-4 flex items-center justify-between">
        <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">设置双因素认证</h3>
        <button
          class="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          @click="show2FASetup = false"
        >
          <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              d="M6 18L18 6M6 6l12 12"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
            />
          </svg>
        </button>
      </div>

      <div v-if="setup2FAStep === 1">
        <p class="mb-4 text-gray-600 dark:text-gray-400">
          使用Google Authenticator或Authy扫描二维码：
        </p>
        <div v-if="twoFAQRCode" class="mb-4 text-center">
          <img alt="2FA QR Code" class="mx-auto rounded border" :src="twoFAQRCode" />
        </div>
        <div v-if="twoFASecret" class="mb-4">
          <p class="mb-2 text-sm text-gray-600 dark:text-gray-400">手动输入密钥：</p>
          <code class="rounded bg-gray-100 px-2 py-1 text-sm dark:bg-gray-700">{{
            twoFASecret
          }}</code>
        </div>
        <button
          class="w-full rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          @click="setup2FAStep = 2"
        >
          下一步
        </button>
      </div>

      <div v-if="setup2FAStep === 2">
        <p class="mb-4 text-gray-600 dark:text-gray-400">输入应用显示的6位验证码：</p>
        <input
          v-model="setup2FAToken"
          class="mb-4 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-center font-mono text-2xl text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
          maxlength="6"
          placeholder="000000"
          type="text"
        />
        <div class="flex space-x-3">
          <button
            class="flex-1 rounded-md bg-gray-500 px-4 py-2 text-white hover:bg-gray-600"
            @click="setup2FAStep = 1"
          >
            上一步
          </button>
          <button
            class="flex-1 rounded-md bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:bg-gray-400"
            :disabled="!setup2FAToken || setup2FAToken.length !== 6"
            @click="enable2FA"
          >
            启用2FA
          </button>
        </div>
      </div>

      <div v-if="setup2FAStep === 3 && twoFABackupCodes">
        <p class="mb-4 text-gray-600 dark:text-gray-400">2FA设置成功！请保存以下备份码：</p>
        <div class="mb-4 rounded-md bg-gray-100 p-4 dark:bg-gray-700">
          <div class="grid grid-cols-2 gap-2 font-mono text-sm">
            <div v-for="code in twoFABackupCodes" :key="code" class="text-center">
              {{ code }}
            </div>
          </div>
        </div>
        <button
          class="w-full rounded-md bg-green-600 px-4 py-2 text-white hover:bg-green-700"
          @click="complete2FASetup"
        >
          完成设置
        </button>
      </div>
    </div>
  </div>

  <!-- 敏感操作验证模态框 -->
  <div
    v-if="showSensitiveAuth"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
  >
    <div class="mx-4 w-full max-w-md rounded-lg bg-white p-6 dark:bg-gray-800">
      <div class="mb-4 flex items-center justify-between">
        <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">敏感操作验证</h3>
        <button
          class="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          @click="showSensitiveAuth = false"
        >
          <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              d="M6 18L18 6M6 6l12 12"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
            />
          </svg>
        </button>
      </div>

      <div class="space-y-4">
        <div>
          <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
            管理员密码
          </label>
          <input
            v-model="sensitiveAuth.password"
            class="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            type="password"
          />
        </div>

        <div>
          <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
            2FA验证码
          </label>
          <input
            v-model="sensitiveAuth.token"
            class="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-center font-mono text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            maxlength="8"
            placeholder="6位验证码或8位备份码"
            type="text"
          />
        </div>

        <div class="flex space-x-3 pt-4">
          <button
            class="flex-1 rounded-md bg-gray-500 px-4 py-2 text-white hover:bg-gray-600"
            @click="showSensitiveAuth = false"
          >
            取消
          </button>
          <button
            class="flex-1 rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:bg-gray-400"
            :disabled="!sensitiveAuth.password || !sensitiveAuth.token || verifying"
            @click="verifySensitiveAuth"
          >
            <span v-if="verifying">验证中...</span>
            <span v-else>验证</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { showToast } from '@/utils/toast'
import { useSettingsStore } from '@/stores/settings'
import { apiClient } from '@/config/api'

// 定义组件名称，用于keep-alive排除
defineOptions({
  name: 'SettingsView'
})

// 使用settings store
const settingsStore = useSettingsStore()
const { loading, saving, oemSettings } = storeToRefs(settingsStore)

// 组件refs
const iconFileInput = ref()

// 当前激活的设置部分
const activeSection = ref('branding')

// 组件挂载状态
const isMounted = ref(true)

// API请求取消控制器
const abortController = ref(new AbortController())

// URL 验证状态
const urlError = ref(false)
const urlValid = ref(false)
const testingConnection = ref(false)
const savingPlatform = ref(false)

// Webhook 配置
const webhookConfig = ref({
  enabled: false,
  platforms: [],
  notificationTypes: {
    accountAnomaly: true,
    quotaWarning: true,
    systemError: true,
    securityAlert: true
  },
  retrySettings: {
    maxRetries: 3,
    retryDelay: 1000,
    timeout: 10000
  }
})

// 平台表单相关
const showAddPlatformModal = ref(false)
const editingPlatform = ref(null)
const platformForm = ref({
  type: 'wechat_work',
  name: '',
  url: '',
  enableSign: false,
  secret: ''
})

// 调度策略配置
const schedulingConfig = ref({
  globalDefaultStrategy: 'least_recent',
  globalDefaultWeight: 5,
  globalDefaultOrder: 1,
  enableAccountOverride: true,
  enableGroupOverride: true,
  updatedAt: null
})

const schedulingStats = ref({
  globalStrategyCount: 0,
  customStrategyCount: 0,
  groupStrategyCount: 0
})

const savingScheduling = ref(false)

// 监听activeSection变化，加载对应配置
const sectionWatcher = watch(activeSection, async (newSection) => {
  if (!isMounted.value) return
  if (newSection === 'webhook') {
    await loadWebhookConfig()
  } else if (newSection === 'scheduling') {
    await loadSchedulingConfig()
  } else if (newSection === 'data-management') {
    await loadDataOverview()
  }
})

// 页面加载时获取设置
onMounted(async () => {
  try {
    await settingsStore.loadOemSettings()
    if (activeSection.value === 'webhook') {
      await loadWebhookConfig()
    } else if (activeSection.value === 'scheduling') {
      await loadSchedulingConfig()
    } else if (activeSection.value === 'data-management') {
      await loadDataOverview()
    }
  } catch (error) {
    showToast('加载设置失败', 'error')
  }
})

// 组件卸载前清理
onBeforeUnmount(() => {
  // 设置组件未挂载状态
  isMounted.value = false

  // 取消所有API请求
  if (abortController.value) {
    abortController.value.abort()
  }

  // 停止watch监听器
  if (sectionWatcher) {
    sectionWatcher()
  }

  // 安全关闭模态框
  if (showAddPlatformModal.value) {
    showAddPlatformModal.value = false
    editingPlatform.value = null
  }
})

// Webhook 相关函数

// 获取webhook配置
const loadWebhookConfig = async () => {
  if (!isMounted.value) return
  try {
    const response = await apiClient.get('/admin/webhook/config', {
      signal: abortController.value.signal
    })
    if (response.success && isMounted.value) {
      webhookConfig.value = response.config
    }
  } catch (error) {
    if (error.name === 'AbortError') return
    if (!isMounted.value) return
    showToast('获取webhook配置失败', 'error')
    console.error(error)
  }
}

// 保存webhook配置
const saveWebhookConfig = async () => {
  if (!isMounted.value) return
  try {
    const response = await apiClient.post('/admin/webhook/config', webhookConfig.value, {
      signal: abortController.value.signal
    })
    if (response.success && isMounted.value) {
      showToast('配置已保存', 'success')
    }
  } catch (error) {
    if (error.name === 'AbortError') return
    if (!isMounted.value) return
    showToast('保存配置失败', 'error')
    console.error(error)
  }
}

// 验证 URL
const validateUrl = () => {
  const url = platformForm.value.url
  if (!url) {
    urlError.value = false
    urlValid.value = false
    return
  }

  try {
    new URL(url)
    if (url.startsWith('http://') || url.startsWith('https://')) {
      urlError.value = false
      urlValid.value = true
    } else {
      urlError.value = true
      urlValid.value = false
    }
  } catch {
    urlError.value = true
    urlValid.value = false
  }
}

// 添加/更新平台
const savePlatform = async () => {
  if (!isMounted.value) return

  if (!platformForm.value.url) {
    showToast('请输入Webhook URL', 'error')
    return
  }

  if (urlError.value) {
    showToast('请输入有效的Webhook URL', 'error')
    return
  }

  savingPlatform.value = true
  try {
    let response
    if (editingPlatform.value) {
      // 更新平台
      response = await apiClient.put(
        `/admin/webhook/platforms/${editingPlatform.value.id}`,
        platformForm.value,
        { signal: abortController.value.signal }
      )
    } else {
      // 添加平台
      response = await apiClient.post('/admin/webhook/platforms', platformForm.value, {
        signal: abortController.value.signal
      })
    }

    if (response.success && isMounted.value) {
      showToast(editingPlatform.value ? '平台已更新' : '平台已添加', 'success')
      await loadWebhookConfig()
      closePlatformModal()
    }
  } catch (error) {
    if (error.name === 'AbortError') return
    if (!isMounted.value) return
    showToast(error.message || '操作失败', 'error')
    console.error(error)
  } finally {
    if (isMounted.value) {
      savingPlatform.value = false
    }
  }
}

// 编辑平台
const editPlatform = (platform) => {
  editingPlatform.value = platform
  platformForm.value = { ...platform }
  showAddPlatformModal.value = true
}

// 删除平台
const deletePlatform = async (id) => {
  if (!isMounted.value) return

  if (!confirm('确定要删除这个平台吗？')) {
    return
  }

  try {
    const response = await apiClient.delete(`/admin/webhook/platforms/${id}`, {
      signal: abortController.value.signal
    })
    if (response.success && isMounted.value) {
      showToast('平台已删除', 'success')
      await loadWebhookConfig()
    }
  } catch (error) {
    if (error.name === 'AbortError') return
    if (!isMounted.value) return
    showToast('删除失败', 'error')
    console.error(error)
  }
}

// 切换平台状态
const togglePlatform = async (id) => {
  if (!isMounted.value) return

  try {
    const response = await apiClient.post(
      `/admin/webhook/platforms/${id}/toggle`,
      {},
      {
        signal: abortController.value.signal
      }
    )
    if (response.success && isMounted.value) {
      showToast(response.message, 'success')
      await loadWebhookConfig()
    }
  } catch (error) {
    if (error.name === 'AbortError') return
    if (!isMounted.value) return
    showToast('操作失败', 'error')
    console.error(error)
  }
}

// 测试平台
const testPlatform = async (platform) => {
  if (!isMounted.value) return

  try {
    const response = await apiClient.post(
      '/admin/webhook/test',
      {
        url: platform.url,
        type: platform.type,
        secret: platform.secret,
        enableSign: platform.enableSign
      },
      {
        signal: abortController.value.signal
      }
    )
    if (response.success && isMounted.value) {
      showToast('测试成功，webhook连接正常', 'success')
    }
  } catch (error) {
    if (error.name === 'AbortError') return
    if (!isMounted.value) return
    showToast(error.error || error.message || '测试失败', 'error')
    console.error(error)
  }
}

// 测试表单中的平台
const testPlatformForm = async () => {
  if (!isMounted.value) return

  if (!platformForm.value.url) {
    showToast('请先输入Webhook URL', 'error')
    return
  }

  if (urlError.value) {
    showToast('请输入有效的Webhook URL', 'error')
    return
  }

  testingConnection.value = true
  try {
    const response = await apiClient.post('/admin/webhook/test', platformForm.value, {
      signal: abortController.value.signal
    })
    if (response.success && isMounted.value) {
      showToast('测试成功，webhook连接正常', 'success')
    }
  } catch (error) {
    if (error.name === 'AbortError') return
    if (!isMounted.value) return
    showToast(error.error || error.message || '测试失败', 'error')
    console.error(error)
  } finally {
    if (isMounted.value) {
      testingConnection.value = false
    }
  }
}

// 发送测试通知
const sendTestNotification = async () => {
  if (!isMounted.value) return

  try {
    const response = await apiClient.post(
      '/admin/webhook/test-notification',
      {},
      {
        signal: abortController.value.signal
      }
    )
    if (response.success && isMounted.value) {
      showToast('测试通知已发送', 'success')
    }
  } catch (error) {
    if (error.name === 'AbortError') return
    if (!isMounted.value) return
    showToast('发送失败', 'error')
    console.error(error)
  }
}

// 关闭模态框
const closePlatformModal = () => {
  if (!isMounted.value) return

  showAddPlatformModal.value = false

  // 使用 setTimeout 确保 DOM 更新完成后再重置状态
  setTimeout(() => {
    if (!isMounted.value) return
    editingPlatform.value = null
    platformForm.value = {
      type: 'wechat_work',
      name: '',
      url: '',
      enableSign: false,
      secret: ''
    }
    urlError.value = false
    urlValid.value = false
    testingConnection.value = false
    savingPlatform.value = false
  }, 0)
}

// 辅助函数
const getPlatformName = (type) => {
  const names = {
    wechat_work: '企业微信',
    dingtalk: '钉钉',
    feishu: '飞书',
    slack: 'Slack',
    discord: 'Discord',
    custom: '自定义'
  }
  return names[type] || type
}

const getPlatformIcon = (type) => {
  const icons = {
    wechat_work: 'fab fa-weixin text-green-600',
    dingtalk: 'fas fa-comment-dots text-blue-500',
    feishu: 'fas fa-dove text-blue-600',
    slack: 'fab fa-slack text-purple-600',
    discord: 'fab fa-discord text-indigo-600',
    custom: 'fas fa-webhook text-gray-600'
  }
  return icons[type] || 'fas fa-bell'
}

const getWebhookHint = (type) => {
  const hints = {
    wechat_work: '请在企业微信群机器人设置中获取Webhook地址',
    dingtalk: '请在钉钉群机器人设置中获取Webhook地址',
    feishu: '请在飞书群机器人设置中获取Webhook地址',
    slack: '请在Slack应用的Incoming Webhooks中获取地址',
    discord: '请在Discord服务器的集成设置中创建Webhook',
    custom: '请输入完整的Webhook接收地址'
  }
  return hints[type] || ''
}

const getNotificationTypeName = (type) => {
  const names = {
    accountAnomaly: '账号异常',
    quotaWarning: '配额警告',
    systemError: '系统错误',
    securityAlert: '安全警报'
  }
  return names[type] || type
}

const getNotificationTypeDescription = (type) => {
  const descriptions = {
    accountAnomaly: '账号状态异常、认证失败等',
    quotaWarning: 'API调用配额不足警告',
    systemError: '系统运行错误和故障',
    securityAlert: '安全相关的警报通知'
  }
  return descriptions[type] || ''
}

// 保存OEM设置
const saveOemSettings = async () => {
  try {
    const settings = {
      siteName: oemSettings.value.siteName,
      siteIcon: oemSettings.value.siteIcon,
      siteIconData: oemSettings.value.siteIconData
    }
    const result = await settingsStore.saveOemSettings(settings)
    if (result && result.success) {
      showToast('OEM设置保存成功', 'success')
    } else {
      showToast(result?.message || '保存失败', 'error')
    }
  } catch (error) {
    showToast('保存OEM设置失败', 'error')
  }
}

// 重置OEM设置
const resetOemSettings = async () => {
  if (!confirm('确定要重置为默认设置吗？\n\n这将清除所有自定义的网站名称和图标设置。')) return

  try {
    const result = await settingsStore.resetOemSettings()
    if (result && result.success) {
      showToast('已重置为默认设置', 'success')
    } else {
      showToast('重置失败', 'error')
    }
  } catch (error) {
    showToast('重置失败', 'error')
  }
}

// 处理图标上传
const handleIconUpload = async (event) => {
  const file = event.target.files[0]
  if (!file) return

  // 验证文件
  const validation = settingsStore.validateIconFile(file)
  if (!validation.isValid) {
    validation.errors.forEach((error) => showToast(error, 'error'))
    return
  }

  try {
    // 转换为Base64
    const base64Data = await settingsStore.fileToBase64(file)
    oemSettings.value.siteIconData = base64Data
  } catch (error) {
    showToast('文件读取失败', 'error')
  }

  // 清除input的值，允许重复选择同一文件
  event.target.value = ''
}

// 删除图标
const removeIcon = () => {
  oemSettings.value.siteIcon = ''
  oemSettings.value.siteIconData = ''
}

// 处理图标加载错误
const handleIconError = () => {
  console.warn('Icon failed to load')
}

// 调度策略相关函数

// 加载调度配置
const loadSchedulingConfig = async () => {
  if (!isMounted.value) return
  try {
    const response = await apiClient.get('/admin/scheduling/config', {
      signal: abortController.value.signal
    })
    if (response.success && isMounted.value) {
      const config = response.data
      schedulingConfig.value = {
        globalDefaultStrategy: config?.defaultStrategy || 'least_recent',
        globalDefaultWeight: parseInt(config?.globalDefaultWeight || 5),
        globalDefaultOrder: parseInt(config?.globalDefaultOrder || 1),
        enableAccountOverride: config?.enableAccountOverride === 'true',
        enableGroupOverride: config?.enableGroupOverride === 'true',
        updatedAt: config?.updatedAt
      }
      // 加载使用统计
      await loadSchedulingStats()
    }
  } catch (error) {
    if (error.name === 'AbortError') return
    if (!isMounted.value) return
    console.error('加载调度配置失败:', error)
  }
}

// 保存调度配置
const saveSchedulingConfig = async () => {
  if (!isMounted.value) return
  savingScheduling.value = true
  try {
    const response = await apiClient.post('/admin/scheduling/config', schedulingConfig.value, {
      signal: abortController.value.signal
    })
    if (response.success && isMounted.value) {
      schedulingConfig.value.updatedAt = new Date().toISOString()
      showToast('调度策略配置已保存', 'success')
      await loadSchedulingStats()
    }
  } catch (error) {
    if (error.name === 'AbortError') return
    if (!isMounted.value) return
    showToast('保存配置失败', 'error')
    console.error(error)
  } finally {
    if (isMounted.value) {
      savingScheduling.value = false
    }
  }
}

// 重置调度配置
const resetSchedulingConfig = async () => {
  if (!confirm('确定要重置调度策略配置为默认设置吗？')) return

  savingScheduling.value = true
  try {
    const response = await apiClient.post(
      '/admin/scheduling/config/reset',
      {},
      {
        signal: abortController.value.signal
      }
    )
    if (response.success && isMounted.value) {
      schedulingConfig.value = {
        globalDefaultStrategy: 'least_recent',
        globalDefaultWeight: 5,
        globalDefaultOrder: 1,
        enableAccountOverride: true,
        enableGroupOverride: true,
        updatedAt: new Date().toISOString()
      }
      showToast('调度策略配置已重置', 'success')
      await loadSchedulingStats()
    }
  } catch (error) {
    if (error.name === 'AbortError') return
    if (!isMounted.value) return
    showToast('重置配置失败', 'error')
    console.error(error)
  } finally {
    if (isMounted.value) {
      savingScheduling.value = false
    }
  }
}

// 加载使用统计
const loadSchedulingStats = async () => {
  if (!isMounted.value) return
  try {
    const response = await apiClient.get('/admin/scheduling/stats', {
      signal: abortController.value.signal
    })
    if (response.success && isMounted.value) {
      schedulingStats.value = response.stats
    }
  } catch (error) {
    if (error.name === 'AbortError') return
    if (!isMounted.value) return
    console.error('加载使用统计失败:', error)
  }
}

// 获取当前生效策略
const getCurrentEffectiveStrategy = () => {
  return getStrategyName(schedulingConfig.value.globalDefaultStrategy)
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
    round_robin: '轮询调度',
    least_used: '最少使用',
    least_recent: '最近最少使用',
    random: '随机调度',
    weighted_random: '加权随机',
    sequential: '顺序调度'
  }
  return names[strategy] || '最近最少使用'
}

const getStrategyDescription = (strategy) => {
  const descriptions = {
    round_robin: '按顺序循环选择账户，确保每个账户被平均使用',
    least_used: '优先选择使用次数最少的账户，实现负载均衡',
    least_recent: '优先选择最长时间未被使用的账户，适合大部分场景',
    random: '随机选择可用账户，分布相对均匀',
    weighted_random: '根据权重随机选择，权重越高被选中概率越大',
    sequential: '按配置顺序逐一使用账户，适合有优先级要求的场景'
  }
  return descriptions[strategy] || '优先选择最长时间未被使用的账户'
}

// 数据管理相关变量
const dataOverview = ref({
  apiKeys: 0,
  claudeAccounts: 0,
  openaiAccounts: 0,
  systemConfig: 0,
  is2FAEnabled: false,
  lastExport: null
})

// 2FA设置相关
const show2FASetup = ref(false)
const setup2FAStep = ref(1)
const twoFAQRCode = ref('')
const twoFASecret = ref('')
const twoFABackupCodes = ref(null)
const setup2FAToken = ref('')

// 敏感操作验证相关
const showSensitiveAuth = ref(false)
const sensitiveAuth = ref({
  password: '',
  token: '',
  sessionToken: ''
})
const verifying = ref(false)
let pendingOperation = null

// 导出相关
const exportOptions = ref({
  includeStats: true
})
const exporting = ref(false)

// 导入相关
const importOptions = ref({
  conflictStrategy: 'skip'
})
const importing = ref(false)
const importFile = ref(null)
const importFileInput = ref()

// 迁移相关
const migrationOptions = ref({
  validateOnly: false
})
const migrating = ref(false)
const migrationConfig = ref(null)
const migrationConfigInput = ref()

// 数据管理相关函数

// 获取数据概览
const loadDataOverview = async () => {
  try {
    const response = await apiClient.get('/admin/data/overview')
    Object.assign(dataOverview.value, response.data)
  } catch (error) {
    showToast('获取数据概览失败: ' + (error.response?.data?.error || error.message), 'error')
  }
}

// 显示2FA设置
const showSetup2FA = async () => {
  try {
    const response = await apiClient.post('/admin/data/2fa/generate')
    const data = response.data

    twoFAQRCode.value = data.qrCode
    twoFASecret.value = data.manualEntryKey
    twoFABackupCodes.value = data.backupCodes

    show2FASetup.value = true
    setup2FAStep.value = 1
  } catch (error) {
    showToast('生成2FA密钥失败: ' + (error.response?.data?.error || error.message), 'error')
  }
}

// 启用2FA
const enable2FA = async () => {
  try {
    await apiClient.post('/admin/data/2fa/enable', {
      token: setup2FAToken.value
    })

    setup2FAStep.value = 3
    showToast('2FA启用成功', 'success')
  } catch (error) {
    showToast('2FA启用失败: ' + (error.response?.data?.error || error.message), 'error')
  }
}

// 完成2FA设置
const complete2FASetup = () => {
  show2FASetup.value = false
  setup2FAStep.value = 1
  setup2FAToken.value = ''
  dataOverview.value.is2FAEnabled = true
}

// 验证敏感操作
const verifySensitiveAuth = async () => {
  verifying.value = true
  try {
    const response = await apiClient.post('/admin/data/2fa/verify', {
      password: sensitiveAuth.value.password,
      token: sensitiveAuth.value.token
    })

    sensitiveAuth.value.sessionToken = response.data.sessionToken
    showSensitiveAuth.value = false

    // 执行待处理的操作
    if (pendingOperation) {
      await pendingOperation()
      pendingOperation = null
    }

    // 清空敏感信息
    sensitiveAuth.value.password = ''
    sensitiveAuth.value.token = ''
  } catch (error) {
    showToast('验证失败: ' + (error.response?.data?.error || error.message), 'error')
  } finally {
    verifying.value = false
  }
}

// 发起导出
const initiateExport = () => {
  if (!sensitiveAuth.value.sessionToken) {
    pendingOperation = performExport
    showSensitiveAuth.value = true
    return
  }
  performExport()
}

// 执行导出
const performExport = async () => {
  exporting.value = true
  try {
    const response = await apiClient.post(
      '/admin/data/export',
      {
        sessionToken: sensitiveAuth.value.sessionToken,
        includeStats: exportOptions.value.includeStats
      },
      {
        responseType: 'blob',
        timeout: 60000 // 60秒超时
      }
    )
    // 验证响应是否为有效的ZIP文件
    if (!response.data || response.data.size === 0) {
      throw new Error('下载的文件为空')
    }
    // 检查响应内容类型
    const contentType = response.headers['content-type'] || response.headers.get?.('content-type')
    if (contentType && !contentType.includes('application/zip')) {
      // 如果不是ZIP文件，可能是错误响应，尝试读取文本内容
      const text = await response.data.text()
      try {
        const errorData = JSON.parse(text)
        throw new Error(errorData.error || '导出失败')
      } catch (jsonError) {
        throw new Error('导出文件格式错误')
      }
    }
    // 创建下载链接
    const blob = new Blob([response.data], { type: 'application/zip' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `claude-relay-data-${Date.now()}.zip`
    // 添加到DOM并触发下载
    document.body.appendChild(link)
    link.click()
    // 清理
    setTimeout(() => {
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    }, 100)

    showToast('数据导出成功', 'success')
    loadDataOverview() // 刷新概览
  } catch (error) {
    console.error('导出错误:', error)
    let errorMessage = '导出失败'
    if (error.response) {
      // HTTP错误响应
      if (error.response.data) {
        try {
          // 尝试读取blob中的错误���息
          if (error.response.data instanceof Blob) {
            const text = await error.response.data.text()
            const errorData = JSON.parse(text)
            errorMessage = errorData.error || '导出失败'
          } else {
            errorMessage = error.response.data.error || '导出失败'
          }
        } catch (parseError) {
          errorMessage = `导出失败 (状态码: ${error.response.status})`
        }
      }
    } else if (error.message) {
      errorMessage = error.message
    }
    showToast('数据导出失败: ' + errorMessage, 'error')
  } finally {
    exporting.value = false
    sensitiveAuth.value.sessionToken = ''
  }
}

// 处理导入文件选择
const handleImportFileSelect = (event) => {
  importFile.value = event.target.files[0]
}

// 发起导入
const initiateImport = () => {
  if (!sensitiveAuth.value.sessionToken) {
    pendingOperation = performImport
    showSensitiveAuth.value = true
    return
  }
  performImport()
}

// 执行导入
const performImport = async () => {
  importing.value = true
  try {
    const formData = new FormData()
    formData.append('dataFile', importFile.value)
    formData.append('sessionToken', sensitiveAuth.value.sessionToken)
    formData.append('conflictStrategy', importOptions.value.conflictStrategy)

    const response = await apiClient.post('/admin/data/import', formData)

    const result = response.data
    showToast(
      `数据导入成功: 导入${result.importedRecords}条记录，跳过${result.skippedRecords}条记录`,
      'success'
    )
    loadDataOverview() // 刷新概览
  } catch (error) {
    showToast('数据导入失败: ' + (error.response?.data?.error || error.message), 'error')
  } finally {
    importing.value = false
    sensitiveAuth.value.sessionToken = ''
    importFile.value = null
  }
}

// 处理迁移配置文件选择
const handleMigrationConfigSelect = (event) => {
  migrationConfig.value = event.target.files[0]
}

// 发起迁移
const initiateMigration = () => {
  if (!sensitiveAuth.value.sessionToken) {
    pendingOperation = performMigration
    showSensitiveAuth.value = true
    return
  }
  performMigration()
}

// 执行迁移
const performMigration = async () => {
  migrating.value = true
  try {
    const formData = new FormData()
    formData.append('configFile', migrationConfig.value)
    formData.append('sessionToken', sensitiveAuth.value.sessionToken)
    formData.append('validateOnly', migrationOptions.value.validateOnly)

    const response = await apiClient.post('/admin/data/migrate', formData)

    const result = response.data
    const message = migrationOptions.value.validateOnly
      ? `迁移验证完成: ${result.sourceDatabase} → ${result.targetDatabase}`
      : `数据库迁移完成: ${result.totalRecords}条记录`

    showToast(message, 'success')
  } catch (error) {
    showToast('迁移操作失败: ' + (error.response?.data?.error || error.message), 'error')
  } finally {
    migrating.value = false
    sensitiveAuth.value.sessionToken = ''
    migrationConfig.value = null
  }
}

// 格式化日期
const formatDate = (dateString) => {
  return new Date(dateString).toLocaleString('zh-CN')
}

// 格式化日期时间
const formatDateTime = settingsStore.formatDateTime
</script>

<style scoped>
.settings-container {
  min-height: calc(100vh - 300px);
}

.card {
  background: white;
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  border: 1px solid #e5e7eb;
}

:root.dark .card {
  background: #1f2937;
  border: 1px solid #374151;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
}

.table-container {
  overflow: hidden;
  border-radius: 8px;
  border: 1px solid #f3f4f6;
}

:root.dark .table-container {
  border: 1px solid #4b5563;
}

.table-row {
  transition: background-color 0.2s ease;
}

.table-row:hover {
  background-color: #f9fafb;
}

:root.dark .table-row:hover {
  background-color: #374151;
}

.form-input {
  @apply w-full rounded-lg border border-gray-300 px-4 py-2 transition-all duration-200 focus:border-transparent focus:ring-2 focus:ring-blue-500;
}

.btn {
  @apply inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2;
}

.btn-primary {
  @apply bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500;
}

.btn-success {
  @apply bg-green-600 text-white hover:bg-green-700 focus:ring-green-500;
}

.loading-spinner {
  @apply h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600;
}

/* 数据管理相关样式 */
.stat-card {
  @apply rounded-lg bg-gray-50 p-4 text-center dark:bg-gray-700;
}

.feature-card {
  @apply rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800;
}

.feature-card h3 {
  @apply text-lg font-semibold text-gray-800 dark:text-gray-200;
}
</style>
