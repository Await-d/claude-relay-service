<template>
  <div class="accounts-container">
    <div class="card p-4 sm:p-6">
      <div class="mb-4 flex flex-col gap-4 sm:mb-6">
        <div>
          <h3 class="mb-1 text-lg font-bold text-gray-900 dark:text-gray-100 sm:mb-2 sm:text-xl">
            账户管理
          </h3>
          <p class="text-sm text-gray-600 dark:text-gray-400 sm:text-base">
            管理您的 Claude、Gemini、OpenAI 和 Azure OpenAI 账户及代理配置
          </p>
        </div>
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <!-- 筛选器组 -->
          <div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
            <!-- 排序选择器 -->
            <div class="group relative min-w-[160px]">
              <div
                class="absolute -inset-0.5 rounded-lg bg-gradient-to-r from-indigo-500 to-blue-500 opacity-0 blur transition duration-300 group-hover:opacity-20"
              ></div>
              <CustomDropdown
                v-model="accountSortBy"
                icon="fa-sort-amount-down"
                icon-color="text-indigo-500"
                :options="sortOptions"
                placeholder="选择排序"
                @change="sortAccounts()"
              />
            </div>

            <!-- 平台筛选器 -->
            <div class="group relative min-w-[140px]">
              <div
                class="absolute -inset-0.5 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-500 opacity-0 blur transition duration-300 group-hover:opacity-20"
              ></div>
              <CustomDropdown
                v-model="platformFilter"
                icon="fa-server"
                icon-color="text-blue-500"
                :options="platformOptions"
                placeholder="选择平台"
                @change="filterByPlatform"
              />
            </div>

            <!-- 分组筛选器 -->
            <div class="group relative min-w-[160px]">
              <div
                class="absolute -inset-0.5 rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 opacity-0 blur transition duration-300 group-hover:opacity-20"
              ></div>
              <CustomDropdown
                v-model="groupFilter"
                icon="fa-layer-group"
                icon-color="text-purple-500"
                :options="groupOptions"
                placeholder="选择分组"
                @change="filterByGroup"
              />
            </div>

            <!-- 搜索框 -->
            <div class="group relative min-w-[200px]">
              <div
                class="absolute -inset-0.5 rounded-lg bg-gradient-to-r from-cyan-500 to-teal-500 opacity-0 blur transition duration-300 group-hover:opacity-20"
              ></div>
              <div class="relative flex items-center">
                <input
                  v-model="searchKeyword"
                  class="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 pl-9 text-sm text-gray-700 placeholder-gray-400 shadow-sm transition-all duration-200 hover:border-gray-300 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:placeholder-gray-500 dark:hover:border-gray-500"
                  placeholder="搜索账户名称或邮箱..."
                  type="text"
                />
                <i class="fas fa-search absolute left-3 text-sm text-cyan-500" />
                <button
                  v-if="searchKeyword"
                  class="absolute right-2 flex h-5 w-5 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                  @click="clearSearch"
                >
                  <i class="fas fa-times text-xs" />
                </button>
              </div>
            </div>

            <!-- 刷新按钮 -->
            <div class="relative">
              <el-tooltip
                content="刷新数据 (Ctrl/⌘+点击强制刷新所有缓存)"
                effect="dark"
                placement="bottom"
              >
                <button
                  class="group relative flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-all duration-200 hover:border-gray-300 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-gray-500 sm:w-auto"
                  :disabled="accountsLoading"
                  @click.ctrl.exact="loadAccounts(true)"
                  @click.exact="loadAccounts(false)"
                  @click.meta.exact="loadAccounts(true)"
                >
                  <div
                    class="absolute -inset-0.5 rounded-lg bg-gradient-to-r from-green-500 to-teal-500 opacity-0 blur transition duration-300 group-hover:opacity-20"
                  ></div>
                  <i
                    :class="[
                      'fas relative text-green-500',
                      accountsLoading ? 'fa-spinner fa-spin' : 'fa-sync-alt'
                    ]"
                  />
                  <span class="relative">刷新</span>
                </button>
              </el-tooltip>
            </div>
          </div>

          <!-- 操作按钮 -->
          <div class="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3">
            <button
              class="flex flex-1 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-all duration-200 hover:border-gray-300 hover:bg-gray-50 hover:shadow-md dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 sm:flex-none"
              @click="toggleSelectionMode"
            >
              <i :class="showCheckboxes ? 'fas fa-times' : 'fas fa-check-square'" />
              <span>{{ showCheckboxes ? '取消选择' : '选择' }}</span>
            </button>
            <button
              v-if="selectedCount > 0"
              class="flex flex-1 items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-5 py-2.5 text-sm font-medium text-red-600 shadow-sm transition-all duration-200 hover:border-red-300 hover:bg-red-100 hover:shadow-md dark:border-red-700 dark:bg-red-900/30 dark:text-red-300 sm:flex-none"
              @click="batchDeleteAccounts"
            >
              <i class="fas fa-trash"></i>
              <span>删除选中 ({{ selectedCount }})</span>
            </button>
            <button
              class="flex flex-1 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-purple-500 to-indigo-500 px-5 py-2.5 text-sm font-medium text-white shadow-md transition-all duration-200 hover:from-purple-600 hover:to-indigo-600 hover:shadow-lg sm:flex-none"
              @click.stop="showBulkImportModal = true"
            >
              <i class="fas fa-file-import"></i>
              <span>批量导入</span>
            </button>
            <button
              class="flex flex-1 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-green-500 to-green-600 px-5 py-2.5 text-sm font-medium text-white shadow-md transition-all duration-200 hover:from-green-600 hover:to-green-700 hover:shadow-lg sm:flex-none"
              @click.stop="openCreateAccountModal"
            >
              <i class="fas fa-plus"></i>
              <span>添加账户</span>
            </button>
          </div>
        </div>
      </div>

      <div v-if="accountsLoading" class="py-12 text-center">
        <div class="loading-spinner mx-auto mb-4" />
        <p class="text-gray-500 dark:text-gray-400">正在加载账户...</p>
      </div>

      <div v-else-if="sortedAccounts.length === 0" class="py-12 text-center">
        <div
          class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700"
        >
          <i class="fas fa-user-circle text-xl text-gray-400" />
        </div>
        <p class="text-lg text-gray-500 dark:text-gray-400">暂无账户</p>
        <p class="mt-2 text-sm text-gray-400 dark:text-gray-500">点击上方按钮添加您的第一个账户</p>
      </div>

      <!-- 桌面端表格视图 -->
      <div v-else class="table-container hidden md:block">
        <div class="table-scroll-wrapper relative overflow-x-auto">
          <table class="w-full table-fixed lg:min-w-[1100px] xl:min-w-full">
          <thead class="bg-gray-50/80 backdrop-blur-sm dark:bg-gray-700/80">
            <tr>
              <th
                v-if="showCheckboxes"
                class="w-12 px-3 py-4 text-left text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300"
              >
                <div class="flex items-center">
                  <input
                    type="checkbox"
                    class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    :checked="allVisibleSelected"
                    @change="toggleSelectAll($event.target.checked)"
                  />
                </div>
              </th>
              <th
                class="w-[20%] min-w-[180px] cursor-pointer px-3 py-4 text-left text-xs font-bold uppercase tracking-wider text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-600 lg:w-[25%] xl:w-[20%]"
                @click="sortAccounts('name')"
              >
                名称
                <i
                  v-if="accountsSortBy === 'name'"
                  :class="[
                    'fas',
                    accountsSortOrder === 'asc' ? 'fa-sort-up' : 'fa-sort-down',
                    'ml-1'
                  ]"
                />
                <i v-else class="fas fa-sort ml-1 text-gray-400" />
              </th>
              <th
                class="w-[14%] min-w-[120px] cursor-pointer px-3 py-4 text-left text-xs font-bold uppercase tracking-wider text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-600"
                @click="sortAccounts('platform')"
              >
                平台/类型
                <i
                  v-if="accountsSortBy === 'platform'"
                  :class="[
                    'fas',
                    accountsSortOrder === 'asc' ? 'fa-sort-up' : 'fa-sort-down',
                    'ml-1'
                  ]"
                />
                <i v-else class="fas fa-sort ml-1 text-gray-400" />
              </th>
              <th
                class="w-[12%] min-w-[100px] cursor-pointer px-3 py-4 text-left text-xs font-bold uppercase tracking-wider text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-600"
                @click="sortAccounts('status')"
              >
                状态
                <i
                  v-if="accountsSortBy === 'status'"
                  :class="[
                    'fas',
                    accountsSortOrder === 'asc' ? 'fa-sort-up' : 'fa-sort-down',
                    'ml-1'
                  ]"
                />
                <i v-else class="fas fa-sort ml-1 text-gray-400" />
              </th>
              <th
                class="hidden w-[8%] min-w-[80px] cursor-pointer px-3 py-4 text-left text-xs font-bold uppercase tracking-wider text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-600 xl:table-cell"
                @click="sortAccounts('priority')"
              >
                优先级
                <i
                  v-if="accountsSortBy === 'priority'"
                  :class="[
                    'fas',
                    accountsSortOrder === 'asc' ? 'fa-sort-up' : 'fa-sort-down',
                    'ml-1'
                  ]"
                />
                <i v-else class="fas fa-sort ml-1 text-gray-400" />
              </th>
              <th
                class="hidden w-[10%] min-w-[120px] px-3 py-4 text-left text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300 lg:table-cell"
              >
                <div class="flex items-center gap-1">
                  <i class="fas fa-route text-xs text-blue-500" />
                  调度策略
                </div>
              </th>
              <th
                class="w-[10%] min-w-[100px] px-3 py-4 text-left text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300"
              >
                代理
              </th>
              <th
                class="w-[10%] min-w-[90px] px-3 py-4 text-left text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300"
              >
                今日使用
              </th>
              <th
                class="hidden w-[10%] min-w-[100px] px-3 py-4 text-left text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300 xl:table-cell"
              >
                会话窗口
              </th>
              <th
                class="hidden w-[12%] min-w-[180px] px-3 py-4 text-left text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300 lg:table-cell"
              >
                <div class="flex items-center gap-1">
                  <i class="fas fa-chart-line text-xs text-blue-500" />
                  历史统计
                </div>
              </th>
              <th
                class="hidden w-[10%] min-w-[120px] px-3 py-4 text-left text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300 lg:table-cell"
              >
                <div class="flex items-center gap-1">
                  <i class="fas fa-dollar-sign text-xs text-green-500" />
                  费用统计
                </div>
              </th>
              <th
                class="hidden w-[8%] min-w-[80px] px-3 py-4 text-left text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300 xl:table-cell"
              >
                最后使用
              </th>
              <th
                class="w-[13%] min-w-[160px] px-3 py-4 text-left text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300 lg:w-[18%] xl:w-[13%]"
              >
                操作
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200/50 dark:divide-gray-600/50">
            <tr
              v-for="account in sortedAccounts"
              :key="account.id"
              :class="[
                'table-row',
                showCheckboxes && isAccountSelected(account.id)
                  ? 'bg-indigo-50/60 dark:bg-indigo-500/10'
                  : ''
              ]"
            >
              <td v-if="showCheckboxes" class="w-12 px-3 py-4 align-top">
                <input
                  type="checkbox"
                  class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  :checked="isAccountSelected(account.id)"
                  @change="handleAccountCheckboxChange(account, $event.target.checked)"
                />
              </td>
              <td class="px-3 py-4">
                <div class="flex items-center">
                  <div
                    class="mr-2 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-green-500 to-green-600"
                  >
                    <i class="fas fa-user-circle text-xs text-white" />
                  </div>
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <div
                        class="truncate text-sm font-semibold text-gray-900 dark:text-gray-100"
                        :title="account.name"
                      >
                        {{ account.name }}
                      </div>
                      <span
                        v-if="account.accountType === 'dedicated'"
                        class="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800"
                      >
                        <i class="fas fa-lock mr-1" />专属
                      </span>
                      <span
                        v-else-if="account.accountType === 'group'"
                        class="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800"
                      >
                        <i class="fas fa-layer-group mr-1" />分组调度
                      </span>
                      <span
                        v-else
                        class="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800"
                      >
                        <i class="fas fa-share-alt mr-1" />共享
                      </span>
                      <el-tooltip
                        v-if="account.groupInfo"
                        :content="`分组: ${account.groupInfo.name}\n调度策略: ${getStrategyName(account.groupInfo.schedulingStrategy || 'least_recent')}\n${getGroupSchedulingDetails(account.groupInfo)}\n成员数量: ${account.groupInfo.memberCount || 0} 个账户`"
                        effect="dark"
                        placement="top"
                        raw-content
                      >
                        <span
                          class="ml-1 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-400"
                        >
                          <i class="fas fa-layer-group mr-1" />{{ account.groupInfo.name }}
                          <div
                            :class="[
                              'ml-1 flex items-center gap-1 rounded px-1 text-xs',
                              getStrategyColorCompact(
                                account.groupInfo.schedulingStrategy || 'least_recent'
                              )
                            ]"
                            :title="
                              getStrategyName(
                                account.groupInfo.schedulingStrategy || 'least_recent'
                              )
                            "
                          >
                            <i
                              :class="
                                getStrategyIconCompact(
                                  account.groupInfo.schedulingStrategy || 'least_recent'
                                )
                              "
                            />
                          </div>
                        </span>
                      </el-tooltip>
                    </div>
                    <div
                      class="truncate text-xs text-gray-500 dark:text-gray-400"
                      :title="account.id"
                    >
                      {{ account.id }}
                    </div>
                  </div>
                </div>
              </td>
              <td class="px-3 py-4">
                <div class="flex items-center gap-1">
                  <!-- 平台图标和名称 -->
                  <div
                    v-if="account.platform === 'gemini'"
                    class="flex items-center gap-1.5 rounded-lg border border-yellow-200 bg-gradient-to-r from-yellow-100 to-amber-100 px-2.5 py-1"
                  >
                    <i class="fas fa-robot text-xs text-yellow-700" />
                    <span class="text-xs font-semibold text-yellow-800">Gemini</span>
                    <span class="mx-1 h-4 w-px bg-yellow-300" />
                    <span class="text-xs font-medium text-yellow-700">
                      {{ getGeminiAuthType() }}
                    </span>
                  </div>
                  <div
                    v-else-if="account.platform === 'claude-console'"
                    class="flex items-center gap-1.5 rounded-lg border border-purple-200 bg-gradient-to-r from-purple-100 to-pink-100 px-2.5 py-1"
                  >
                    <i class="fas fa-terminal text-xs text-purple-700" />
                    <span class="text-xs font-semibold text-purple-800">Console</span>
                    <span class="mx-1 h-4 w-px bg-purple-300" />
                    <span class="text-xs font-medium text-purple-700">API Key</span>
                  </div>
                  <div
                    v-else-if="account.platform === 'bedrock'"
                    class="flex items-center gap-1.5 rounded-lg border border-orange-200 bg-gradient-to-r from-orange-100 to-red-100 px-2.5 py-1"
                  >
                    <i class="fab fa-aws text-xs text-orange-700" />
                    <span class="text-xs font-semibold text-orange-800">Bedrock</span>
                    <span class="mx-1 h-4 w-px bg-orange-300" />
                    <span class="text-xs font-medium text-orange-700">AWS</span>
                  </div>
                  <div
                    v-else-if="account.platform === 'openai'"
                    class="flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-100 bg-gradient-to-r from-gray-100 to-gray-100 px-2.5 py-1"
                  >
                    <div class="fa-openai" />
                    <span class="text-xs font-semibold text-gray-950">OpenAi</span>
                    <span class="mx-1 h-4 w-px bg-gray-400" />
                    <span class="text-xs font-medium text-gray-950">{{ getOpenAIAuthType() }}</span>
                  </div>
                  <div
                    v-else-if="account.platform === 'azure_openai'"
                    class="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-gradient-to-r from-blue-100 to-cyan-100 px-2.5 py-1 dark:border-blue-700 dark:from-blue-900/20 dark:to-cyan-900/20"
                  >
                    <i class="fab fa-microsoft text-xs text-blue-700 dark:text-blue-400" />
                    <span class="text-xs font-semibold text-blue-800 dark:text-blue-300"
                      >Azure OpenAI</span
                    >
                    <span class="mx-1 h-4 w-px bg-blue-300 dark:bg-blue-600" />
                    <span class="text-xs font-medium text-blue-700 dark:text-blue-400"
                      >API Key</span
                    >
                  </div>
                  <div
                    v-else-if="account.platform === 'claude' || account.platform === 'claude-oauth'"
                    class="flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-gradient-to-r from-indigo-100 to-blue-100 px-2.5 py-1"
                  >
                    <i class="fas fa-brain text-xs text-indigo-700" />
                    <span class="text-xs font-semibold text-indigo-800">{{
                      getClaudeAccountType(account)
                    }}</span>
                    <span class="mx-1 h-4 w-px bg-indigo-300" />
                    <span class="text-xs font-medium text-indigo-700">
                      {{ getClaudeAuthType(account) }}
                    </span>
                  </div>
                  <div
                    v-else
                    class="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gradient-to-r from-gray-100 to-gray-200 px-2.5 py-1"
                  >
                    <i class="fas fa-question text-xs text-gray-700" />
                    <span class="text-xs font-semibold text-gray-800">未知</span>
                  </div>
                </div>
              </td>
              <td class="whitespace-nowrap px-3 py-4">
                <div class="flex flex-col gap-1">
                  <span
                    :class="[
                      'inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold',
                      account.status === 'blocked'
                        ? 'bg-orange-100 text-orange-800'
                        : account.status === 'unauthorized'
                          ? 'bg-red-100 text-red-800'
                          : account.isActive
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                    ]"
                  >
                    <div
                      :class="[
                        'mr-2 h-2 w-2 rounded-full',
                        account.status === 'blocked'
                          ? 'bg-orange-500'
                          : account.status === 'unauthorized'
                            ? 'bg-red-500'
                            : account.isActive
                              ? 'bg-green-500'
                              : 'bg-red-500'
                      ]"
                    />
                    {{
                      account.status === 'blocked'
                        ? '已封锁'
                        : account.status === 'unauthorized'
                          ? '异常'
                          : account.isActive
                            ? '正常'
                            : '异常'
                    }}
                  </span>
                  <RateLimitCountdown
                    v-if="
                      (account.rateLimitStatus && account.rateLimitStatus.isRateLimited) ||
                      account.rateLimitStatus === 'limited'
                    "
                    :rate-limit-info="account.rateLimitStatus"
                    @expired="handleRateLimitExpired(account)"
                    @update="handleRateLimitUpdate"
                  />
                  <ClaudeResetCountdown
                    v-if="account.platform === 'claude' || account.platform === 'claude-oauth'"
                    :account="account"
                    @update="handleClaudeResetUpdate"
                  />
                  <span
                    v-if="account.schedulable === false"
                    class="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700"
                  >
                    <i class="fas fa-pause-circle mr-1" />
                    不可调度
                  </span>
                  <span
                    v-if="account.status === 'blocked' && account.errorMessage"
                    class="mt-1 max-w-xs truncate text-xs text-gray-500 dark:text-gray-400"
                    :title="account.errorMessage"
                  >
                    {{ account.errorMessage }}
                  </span>
                  <span
                    v-if="account.accountType === 'dedicated'"
                    class="text-xs text-gray-500 dark:text-gray-400"
                  >
                    绑定: {{ account.boundApiKeysCount || 0 }} 个API Key
                  </span>
                </div>
              </td>
              <td class="hidden whitespace-nowrap px-3 py-4 xl:table-cell">
                <div
                  v-if="
                    account.platform === 'claude' ||
                    account.platform === 'claude-console' ||
                    account.platform === 'bedrock' ||
                    account.platform === 'gemini' ||
                    account.platform === 'openai'
                  "
                  class="flex items-center gap-2"
                >
                  <div class="h-2 w-16 rounded-full bg-gray-200">
                    <div
                      class="h-2 rounded-full bg-gradient-to-r from-green-500 to-blue-600 transition-all duration-300"
                      :style="{ width: 101 - (account.priority || 50) + '%' }"
                    />
                  </div>
                  <span class="min-w-[20px] text-xs font-medium text-gray-700 dark:text-gray-200">
                    {{ account.priority || 50 }}
                  </span>
                </div>
                <div v-else class="text-sm text-gray-400">
                  <span class="text-xs">N/A</span>
                </div>
              </td>
              <td class="hidden whitespace-nowrap px-3 py-4 lg:table-cell">
                <div class="flex flex-col gap-1">
                  <!-- 调度策略名称 -->
                  <div class="flex items-center gap-2">
                    <div
                      :class="[
                        'flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium',
                        getStrategyColor(account.schedulingStrategy || 'least_recent')
                      ]"
                    >
                      <i :class="getStrategyIcon(account.schedulingStrategy || 'least_recent')" />
                      <span>{{
                        getStrategyName(account.schedulingStrategy || 'least_recent')
                      }}</span>
                    </div>
                  </div>

                  <!-- 策略特殊参数 -->
                  <div
                    v-if="
                      account.schedulingStrategy === 'weighted_random' && account.schedulingWeight
                    "
                    class="text-xs text-gray-600 dark:text-gray-300"
                  >
                    <i class="fas fa-weight-hanging mr-1 text-orange-500" />
                    权重: {{ account.schedulingWeight }}
                  </div>
                  <div
                    v-else-if="
                      account.schedulingStrategy === 'sequential' && account.sequentialOrder
                    "
                    class="text-xs text-gray-600 dark:text-gray-300"
                  >
                    <i class="fas fa-sort-numeric-down mr-1 text-purple-500" />
                    顺序: {{ account.sequentialOrder }}
                  </div>
                </div>
              </td>
              <td class="px-3 py-4 text-sm text-gray-600">
                <div
                  v-if="formatProxyDisplay(account.proxy)"
                  class="break-all rounded bg-blue-50 px-2 py-1 font-mono text-xs"
                  :title="formatProxyDisplay(account.proxy)"
                >
                  {{ formatProxyDisplay(account.proxy) }}
                </div>
                <div v-else class="text-gray-400">无代理</div>
              </td>
              <td class="whitespace-nowrap px-3 py-4 text-sm">
                <div v-if="account.usage && account.usage.daily" class="space-y-1">
                  <div class="flex items-center gap-2">
                    <div class="h-2 w-2 rounded-full bg-green-500" />
                    <span class="text-sm font-medium text-gray-900 dark:text-gray-100"
                      >{{ account.usage.daily.requests || 0 }} 次</span
                    >
                  </div>
                  <div class="flex items-center gap-2">
                    <div class="h-2 w-2 rounded-full bg-blue-500" />
                    <span class="text-xs text-gray-600 dark:text-gray-300"
                      >{{ formatNumber(account.usage.daily.allTokens || 0) }} tokens</span
                    >
                  </div>
                  <div
                    v-if="account.usage.averages && account.usage.averages.rpm > 0"
                    class="text-xs text-gray-500 dark:text-gray-400"
                  >
                    平均 {{ account.usage.averages.rpm.toFixed(2) }} RPM
                  </div>
                </div>
                <div v-else class="text-xs text-gray-400">暂无数据</div>
              </td>
              <td class="hidden whitespace-nowrap px-3 py-4 xl:table-cell">
                <div
                  v-if="
                    ['claude', 'claude-console'].includes(account.platform) &&
                    account.sessionWindow &&
                    account.sessionWindow.hasActiveWindow
                  "
                  class="space-y-2"
                >
                  <div class="flex items-center gap-2">
                    <div class="h-2 w-24 rounded-full bg-gray-200">
                      <div
                        class="h-2 rounded-full bg-gradient-to-r from-blue-500 to-indigo-600 transition-all duration-300"
                        :style="{ width: account.sessionWindow.progress + '%' }"
                      />
                    </div>
                    <span class="min-w-[32px] text-xs font-medium text-gray-700 dark:text-gray-200">
                      {{ account.sessionWindow.progress }}%
                    </span>
                  </div>
                  <div class="text-xs text-gray-600 dark:text-gray-300">
                    <div>
                      {{
                        formatSessionWindow(
                          account.sessionWindow.windowStart,
                          account.sessionWindow.windowEnd
                        )
                      }}
                    </div>
                    <div
                      v-if="account.sessionWindow.remainingTime > 0"
                      class="font-medium text-indigo-600"
                    >
                      剩余 {{ formatRemainingTime(account.sessionWindow.remainingTime) }}
                    </div>
                  </div>
                </div>
                <div
                  v-else-if="['claude', 'claude-console'].includes(account.platform)"
                  class="flex items-center gap-1.5"
                >
                  <div
                    class="flex items-center gap-1.5 rounded-lg bg-gray-50 px-2.5 py-1.5 dark:bg-gray-700/50"
                  >
                    <i class="fas fa-clock text-xs text-gray-500 dark:text-gray-400" />
                    <span class="text-xs font-medium text-gray-600 dark:text-gray-300">未使用</span>
                  </div>
                </div>
                <div v-else class="flex items-center gap-1.5">
                  <div
                    class="flex items-center gap-1.5 rounded-lg bg-gray-50 px-2.5 py-1.5 dark:bg-gray-700/50"
                  >
                    <i class="fas fa-ban text-xs text-gray-400" />
                    <span class="text-xs font-medium text-gray-500 dark:text-gray-400">不适用</span>
                  </div>
                </div>
              </td>
              <td class="hidden whitespace-nowrap px-3 py-4 text-sm lg:table-cell">
                <div v-if="account.usage && account.usage.total" class="space-y-2">
                  <el-tooltip
                    :content="`详细统计：\n总Token使用量: ${formatNumber(account.usage.total.tokens || 0)} tokens\n总请求次数: ${formatNumber(account.usage.total.requests || 0)} 次\n平均每请求Token: ${formatAverageTokensPerRequest(account.usage.total.tokens, account.usage.total.requests)} tokens/次`"
                    effect="dark"
                    placement="left"
                    :show-after="800"
                  >
                    <div class="space-y-2">
                      <!-- 总Token使用量 -->
                      <div
                        class="flex items-center gap-2 rounded px-1 py-0.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50"
                      >
                        <i class="fas fa-coins text-xs text-yellow-600 dark:text-yellow-500" />
                        <span class="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {{ formatNumber(account.usage.total.tokens || 0) }}
                        </span>
                        <span class="text-xs text-gray-500 dark:text-gray-400">tokens</span>
                      </div>

                      <!-- 总请求次数 -->
                      <div
                        class="flex items-center gap-2 rounded px-1 py-0.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50"
                      >
                        <i class="fas fa-paper-plane text-xs text-blue-600 dark:text-blue-500" />
                        <span class="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {{ formatNumber(account.usage.total.requests || 0) }}
                        </span>
                        <span class="text-xs text-gray-500 dark:text-gray-400">次</span>
                      </div>

                      <!-- 平均每请求Token数 -->
                      <div
                        class="flex items-center gap-2 rounded px-1 py-0.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50"
                      >
                        <i class="fas fa-chart-bar text-xs text-green-600 dark:text-green-500" />
                        <span class="text-xs font-medium text-gray-600 dark:text-gray-300">
                          平均
                          {{
                            formatAverageTokensPerRequest(
                              account.usage.total.tokens,
                              account.usage.total.requests
                            )
                          }}/次
                        </span>
                      </div>
                    </div>
                  </el-tooltip>
                </div>
                <div
                  v-else
                  class="flex items-center justify-center text-gray-400 dark:text-gray-500"
                >
                  <div class="text-center">
                    <i class="fas fa-chart-line mb-1 text-lg opacity-50" />
                    <div class="text-xs">暂无统计</div>
                  </div>
                </div>
              </td>
              <!-- 费用统计列 -->
              <td class="hidden whitespace-nowrap px-3 py-4 text-sm lg:table-cell">
                <div v-if="account.costStats && account.costStats.hasCostStats" class="space-y-1">
                  <div class="flex items-center gap-2">
                    <div class="h-2 w-2 rounded-full bg-green-500" />
                    <span class="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {{ account.costStats.formatted?.totalCost || '$0.00' }}
                    </span>
                  </div>
                  <div
                    v-if="account.costStats.formatted?.dailyCost"
                    class="flex items-center gap-2"
                  >
                    <div class="h-2 w-2 rounded-full bg-blue-500" />
                    <span class="text-xs text-gray-600 dark:text-gray-300">
                      今日: {{ account.costStats.formatted.dailyCost }}
                    </span>
                  </div>
                  <div class="text-xs text-gray-500 dark:text-gray-400">
                    {{ account.costStats.platformName || account.platform }}
                  </div>
                </div>
                <div v-else-if="account.costStats && account.costStats.error" class="space-y-1">
                  <div class="flex items-center gap-2">
                    <div class="h-2 w-2 rounded-full bg-red-500" />
                    <span class="text-xs text-red-600 dark:text-red-400"> 加载失败 </span>
                  </div>
                </div>
                <div
                  v-else
                  class="flex items-center justify-center text-gray-400 dark:text-gray-500"
                >
                  <div class="text-center">
                    <i class="fas fa-dollar-sign mb-1 text-lg opacity-50" />
                    <div class="text-xs">暂无数据</div>
                  </div>
                </div>
              </td>
              <td class="hidden whitespace-nowrap px-3 py-4 text-sm text-gray-600 dark:text-gray-300 xl:table-cell">
                {{ formatLastUsed(account.lastUsedAt) }}
              </td>
              <td class="whitespace-nowrap px-3 py-4 text-sm font-medium">
                <div class="flex flex-wrap items-center gap-1">
                  <button
                    v-if="
                      ['claude', 'openai-responses'].includes(account.platform) &&
                      (account.status === 'unauthorized' ||
                        account.status !== 'active' ||
                        account.rateLimitStatus?.isRateLimited ||
                        account.rateLimitStatus === 'limited' ||
                        !account.isActive)
                    "
                    :class="[
                      'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                      account.isResetting
                        ? 'cursor-not-allowed bg-gray-100 text-gray-400'
                        : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                    ]"
                    :disabled="account.isResetting"
                    :title="account.isResetting ? '重置中...' : '重置所有异常状态'"
                    @click="resetAccountStatus(account)"
                  >
                    <i :class="['fas fa-redo', account.isResetting ? 'animate-spin' : '']" />
                    <span class="ml-1">重置状态</span>
                  </button>
                  <button
                    v-if="account.platform === 'openai-responses'"
                    :class="[
                      'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                      account.isResettingUsage
                        ? 'cursor-not-allowed bg-gray-100 text-gray-400'
                        : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                    ]"
                    :disabled="account.isResettingUsage"
                    :title="account.isResettingUsage ? '重置中...' : '清空每日使用量'"
                    @click="resetOpenAIResponsesUsage(account)"
                  >
                    <i :class="['fas fa-tachometer-alt', account.isResettingUsage ? 'animate-spin' : '']" />
                    <span class="ml-1">清空用量</span>
                  </button>
                  <button
                    :class="[
                      'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                      account.isTogglingSchedulable
                        ? 'cursor-not-allowed bg-gray-100 text-gray-400'
                        : account.schedulable
                          ? 'bg-green-100 text-green-700 hover:bg-green-200'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    ]"
                    :disabled="account.isTogglingSchedulable"
                    :title="account.schedulable ? '点击禁用调度' : '点击启用调度'"
                    @click="toggleSchedulable(account)"
                  >
                    <i :class="['fas', account.schedulable ? 'fa-toggle-on' : 'fa-toggle-off']" />
                    <span class="ml-1">{{ account.schedulable ? '调度' : '停用' }}</span>
                  </button>
                  <button
                    class="rounded bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-200"
                    :title="'编辑账户'"
                    @click="editAccount(account)"
                  >
                    <i class="fas fa-edit" />
                    <span class="ml-1">编辑</span>
                  </button>
                  <button
                    class="rounded bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-200"
                    :title="'删除账户'"
                    @click="deleteAccount(account)"
                  >
                    <i class="fas fa-trash" />
                    <span class="ml-1">删除</span>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        </div>
      </div>

      <!-- 移动端卡片视图 -->
      <div v-if="!accountsLoading && sortedAccounts.length > 0" class="space-y-3 md:hidden">
        <div
          v-for="account in sortedAccounts"
          :key="account.id"
          :class="[
            'card p-4 transition-shadow hover:shadow-lg',
            showCheckboxes && isAccountSelected(account.id) ? 'ring-2 ring-indigo-400' : ''
          ]"
        >
          <!-- 卡片头部 -->
          <div class="mb-3 flex items-start justify-between">
            <div class="flex items-center gap-3">
              <div
                :class="[
                  'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg',
                  account.platform === 'claude'
                    ? 'bg-gradient-to-br from-purple-500 to-purple-600'
                    : account.platform === 'bedrock'
                      ? 'bg-gradient-to-br from-orange-500 to-red-600'
                      : account.platform === 'azure_openai'
                        ? 'bg-gradient-to-br from-blue-500 to-cyan-600'
                        : account.platform === 'openai'
                          ? 'bg-gradient-to-br from-gray-600 to-gray-700'
                          : account.platform === 'openai-responses'
                            ? 'bg-gradient-to-br from-indigo-500 to-purple-600'
                            : 'bg-gradient-to-br from-blue-500 to-blue-600'
                ]"
              >
                <i
                  :class="[
                    'text-sm text-white',
                    account.platform === 'claude'
                      ? 'fas fa-brain'
                      : account.platform === 'bedrock'
                        ? 'fab fa-aws'
                        : account.platform === 'azure_openai'
                          ? 'fab fa-microsoft'
                          : account.platform === 'openai'
                            ? 'fas fa-openai'
                            : account.platform === 'openai-responses'
                              ? 'fas fa-comments'
                              : 'fas fa-robot'
                  ]"
                />
              </div>
              <div>
                <h4 class="text-sm font-semibold text-gray-900">
                  {{ account.name || account.email }}
                </h4>
                <div class="mt-0.5 flex items-center gap-2">
                  <span class="text-xs text-gray-500 dark:text-gray-400">{{
                    account.platform
                  }}</span>
                  <span class="text-xs text-gray-400">|</span>
                  <span class="text-xs text-gray-500 dark:text-gray-400">{{ account.type }}</span>
                </div>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <span
                :class="[
                  'inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold',
                  getAccountStatusClass(account)
                ]"
              >
                <div
                  :class="['mr-1.5 h-1.5 w-1.5 rounded-full', getAccountStatusDotClass(account)]"
                />
                {{ getAccountStatusText(account) }}
              </span>
              <input
                v-if="showCheckboxes"
                type="checkbox"
                class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                :checked="isAccountSelected(account.id)"
                @change="handleAccountCheckboxChange(account, $event.target.checked)"
              />
            </div>
          </div>

          <!-- 使用统计 -->
          <div class="mb-3 grid grid-cols-2 gap-3">
            <div>
              <p class="text-xs text-gray-500 dark:text-gray-400">今日使用</p>
              <p class="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {{ formatNumber(account.usage?.daily?.requests || 0) }} 次
              </p>
              <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {{ formatNumber(account.usage?.daily?.allTokens || 0) }} tokens
              </p>
            </div>
            <div>
              <p class="mb-2 flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                <i class="fas fa-chart-line text-xs" />
                历史统计
              </p>
              <div v-if="account.usage?.total" class="space-y-1.5">
                <!-- 总请求次数 -->
                <div
                  class="flex items-center gap-2 rounded-lg bg-blue-50 px-2 py-1.5 dark:bg-blue-900/20"
                >
                  <i class="fas fa-paper-plane text-xs text-blue-600 dark:text-blue-400" />
                  <span class="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {{ formatNumber(account.usage.total.requests || 0) }}
                  </span>
                  <span class="text-xs text-blue-600 dark:text-blue-400">次请求</span>
                </div>

                <!-- 总Token使用量 -->
                <div
                  class="flex items-center gap-2 rounded-lg bg-yellow-50 px-2 py-1.5 dark:bg-yellow-900/20"
                >
                  <i class="fas fa-coins text-xs text-yellow-600 dark:text-yellow-400" />
                  <span class="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {{ formatNumber(account.usage.total.tokens || 0) }}
                  </span>
                  <span class="text-xs text-yellow-600 dark:text-yellow-400">tokens</span>
                </div>

                <!-- 总使用费用 -->
                <div
                  class="flex items-center gap-2 rounded-lg bg-green-50 px-2 py-1.5 dark:bg-green-900/20"
                >
                  <i class="fas fa-dollar-sign text-xs text-green-600 dark:text-green-400" />
                  <span class="text-sm font-medium text-gray-900 dark:text-gray-100">
                    ${{ formatCost(account.costStats?.totalCost || 0) }}
                  </span>
                  <span class="text-xs text-green-600 dark:text-green-400">总费用</span>
                </div>

                <!-- 平均每请求Token数 -->
                <div
                  class="flex items-center gap-2 rounded-lg bg-purple-50 px-2 py-1.5 dark:bg-purple-900/20"
                >
                  <i class="fas fa-chart-bar text-xs text-purple-600 dark:text-purple-400" />
                  <span class="text-xs font-medium text-purple-600 dark:text-purple-400">
                    平均
                    {{
                      formatAverageTokensPerRequest(
                        account.usage.total.tokens,
                        account.usage.total.requests
                      )
                    }}/次
                  </span>
                </div>
              </div>
              <div
                v-else
                class="flex items-center justify-center py-4 text-gray-400 dark:text-gray-500"
              >
                <div class="text-center">
                  <i class="fas fa-chart-line mb-1 text-lg opacity-50" />
                  <div class="text-xs">暂无统计</div>
                </div>
              </div>
            </div>
          </div>

          <!-- 状态信息 -->
          <div class="mb-3 space-y-2">
            <!-- 限流状态 -->
            <RateLimitCountdown
              v-if="
                (account.rateLimitStatus && account.rateLimitStatus.isRateLimited) ||
                account.rateLimitStatus === 'limited'
              "
              :rate-limit-info="account.rateLimitStatus"
              @expired="handleRateLimitExpired(account)"
              @update="handleRateLimitUpdate"
            />

            <!-- Claude 5小时重置倒计时 -->
            <ClaudeResetCountdown
              v-if="account.platform === 'claude' || account.platform === 'claude-oauth'"
              :account="account"
              @update="handleClaudeResetUpdate"
            />

            <!-- 会话窗口 -->
            <div
              v-if="['claude', 'claude-console'].includes(account.platform)"
              class="space-y-1.5 rounded-lg bg-gray-50 p-2 dark:bg-gray-700"
            >
              <div class="flex items-center justify-between text-xs">
                <span class="font-medium text-gray-600 dark:text-gray-300">会话窗口</span>
                <span
                  v-if="
                    account.sessionWindow &&
                    account.sessionWindow.hasActiveWindow &&
                    account.sessionWindow.progress
                  "
                  class="font-medium text-gray-700 dark:text-gray-200"
                >
                  {{ account.sessionWindow.progress }}%
                </span>
                <span v-else class="font-medium text-gray-500 dark:text-gray-400"> 未使用 </span>
              </div>
              <div
                v-if="
                  account.sessionWindow &&
                  account.sessionWindow.hasActiveWindow &&
                  account.sessionWindow.progress
                "
                class="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-600"
              >
                <div
                  class="h-full bg-gradient-to-r from-blue-500 to-indigo-600 transition-all duration-300"
                  :style="{ width: account.sessionWindow.progress + '%' }"
                />
              </div>
              <div
                v-else
                class="flex items-center justify-center rounded-full bg-gray-200 py-2 dark:bg-gray-600"
              >
                <div class="flex items-center gap-1.5">
                  <i class="fas fa-clock text-xs text-gray-500 dark:text-gray-400" />
                  <span class="text-xs font-medium text-gray-500 dark:text-gray-400"
                    >等待首次使用</span
                  >
                </div>
              </div>
              <div
                v-if="
                  account.sessionWindow &&
                  account.sessionWindow.hasActiveWindow &&
                  account.sessionWindow.progress
                "
                class="flex items-center justify-between text-xs"
              >
                <span class="text-gray-500 dark:text-gray-400">
                  {{
                    formatSessionWindow(
                      account.sessionWindow.windowStart,
                      account.sessionWindow.windowEnd
                    )
                  }}
                </span>
                <span
                  v-if="account.sessionWindow.remainingTime > 0"
                  class="font-medium text-indigo-600"
                >
                  剩余 {{ formatRemainingTime(account.sessionWindow.remainingTime) }}
                </span>
                <span v-else class="text-gray-500"> 已结束 </span>
              </div>
              <div v-else class="text-center text-xs text-gray-400 dark:text-gray-500">
                Claude 账户会话窗口在首次使用后开始计时
              </div>
            </div>

            <!-- 最后使用时间 -->
            <div class="flex items-center justify-between text-xs">
              <span class="text-gray-500 dark:text-gray-400">最后使用</span>
              <span class="text-gray-700 dark:text-gray-200">
                {{ account.lastUsedAt ? formatRelativeTime(account.lastUsedAt) : '从未使用' }}
              </span>
            </div>

            <!-- 费用统计 -->
            <div class="flex items-center justify-between text-xs">
              <span class="text-gray-500 dark:text-gray-400">费用统计</span>
              <div
                v-if="account.costStats && account.costStats.hasCostStats"
                class="flex flex-col items-end gap-1"
              >
                <span class="font-medium text-green-600 dark:text-green-400">
                  {{ account.costStats.formatted?.totalCost || '$0.00' }}
                </span>
                <span
                  v-if="account.costStats.formatted?.dailyCost"
                  class="text-xs text-gray-600 dark:text-gray-400"
                >
                  今日: {{ account.costStats.formatted.dailyCost }}
                </span>
              </div>
              <div
                v-else-if="account.costStats && account.costStats.error"
                class="text-red-500 dark:text-red-400"
              >
                加载失败
              </div>
              <div v-else class="text-gray-400 dark:text-gray-500">暂无数据</div>
            </div>

            <!-- 代理配置 -->
            <div
              v-if="account.proxyConfig && account.proxyConfig.type !== 'none'"
              class="flex items-center justify-between text-xs"
            >
              <span class="text-gray-500 dark:text-gray-400">代理</span>
              <span class="text-gray-700 dark:text-gray-200">
                {{ account.proxyConfig.type.toUpperCase() }}
              </span>
            </div>

            <!-- 调度优先级 -->
            <div class="flex items-center justify-between text-xs">
              <span class="text-gray-500 dark:text-gray-400">优先级</span>
              <span class="font-medium text-gray-700 dark:text-gray-200">
                {{ account.priority || 50 }}
              </span>
            </div>

            <!-- 调度策略 -->
            <div class="flex items-center justify-between text-xs">
              <span class="text-gray-500 dark:text-gray-400">调度策略</span>
              <div class="flex flex-col items-end gap-1">
                <div
                  :class="[
                    'flex items-center gap-1 rounded px-2 py-1 text-xs font-medium',
                    getStrategyColor(account.schedulingStrategy || 'least_recent')
                  ]"
                >
                  <i :class="getStrategyIcon(account.schedulingStrategy || 'least_recent')" />
                  <span>{{ getStrategyName(account.schedulingStrategy || 'least_recent') }}</span>
                </div>
                <!-- 策略特殊参数 -->
                <div
                  v-if="
                    account.schedulingStrategy === 'weighted_random' && account.schedulingWeight
                  "
                  class="text-xs text-gray-600 dark:text-gray-300"
                >
                  权重: {{ account.schedulingWeight }}
                </div>
                <div
                  v-else-if="account.schedulingStrategy === 'sequential' && account.sequentialOrder"
                  class="text-xs text-gray-600 dark:text-gray-300"
                >
                  顺序: {{ account.sequentialOrder }}
                </div>
              </div>
            </div>
          </div>

          <!-- 操作按钮 -->
          <div class="mt-3 flex gap-2 border-t border-gray-100 pt-3">
            <button
              v-if="
                ['claude', 'openai-responses'].includes(account.platform) &&
                (account.status === 'unauthorized' ||
                  account.status !== 'active' ||
                  account.rateLimitStatus?.isRateLimited ||
                  account.rateLimitStatus === 'limited' ||
                  !account.isActive)
              "
              class="flex flex-1 items-center justify-center gap-1 rounded-lg bg-yellow-50 px-3 py-2 text-xs text-yellow-700 transition-colors hover:bg-yellow-100"
              :disabled="account.isResetting"
              @click="resetAccountStatus(account)"
            >
              <i :class="['fas fa-redo', account.isResetting ? 'animate-spin' : '']" />
              重置
            </button>
            <button
              v-if="account.platform === 'openai-responses'"
              class="flex flex-1 items-center justify-center gap-1 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700 transition-colors hover:bg-blue-100"
              :disabled="account.isResettingUsage"
              @click="resetOpenAIResponsesUsage(account)"
            >
              <i :class="['fas fa-tachometer-alt', account.isResettingUsage ? 'animate-spin' : '']" />
              清空
            </button>
            <button
              class="flex flex-1 items-center justify-center gap-1 rounded-lg px-3 py-2 text-xs transition-colors"
              :class="
                account.schedulable
                  ? 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                  : 'bg-green-50 text-green-600 hover:bg-green-100'
              "
              :disabled="account.isTogglingSchedulable"
              @click="toggleSchedulable(account)"
            >
              <i :class="['fas', account.schedulable ? 'fa-pause' : 'fa-play']" />
              {{ account.schedulable ? '暂停' : '启用' }}
            </button>

            <button
              class="flex-1 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 transition-colors hover:bg-gray-100"
              @click="editAccount(account)"
            >
              <i class="fas fa-edit mr-1" />
              编辑
            </button>

            <button
              class="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 transition-colors hover:bg-red-100"
              @click="deleteAccount(account)"
            >
              <i class="fas fa-trash" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 添加账户模态框 -->
    <AccountForm
      v-if="showCreateAccountModal"
      @close="showCreateAccountModal = false"
      @success="handleCreateSuccess"
    />

    <!-- 编辑账户模态框 -->
    <AccountForm
      v-if="showEditAccountModal"
      :account="editingAccount"
      @close="showEditAccountModal = false"
      @success="handleEditSuccess"
    />

    <BulkImportModal
      v-if="showBulkImportModal"
      :show="showBulkImportModal"
      @close="showBulkImportModal = false"
      @imported="handleBulkImportSuccess"
    />

    <!-- 确认弹窗 -->
    <ConfirmModal
      :cancel-text="confirmOptions.cancelText"
      :confirm-text="confirmOptions.confirmText"
      :message="confirmOptions.message"
      :show="showConfirmModal"
      :title="confirmOptions.title"
      @cancel="handleCancel"
      @confirm="handleConfirm"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { showToast } from '@/utils/toast'
import { apiClient } from '@/config/api'
import { useConfirm } from '@/composables/useConfirm'
import { formatNumber, getAverageTokensPerRequest } from '@/utils/format'
import { useAccountsStore } from '@/stores/accounts'
import AccountForm from '@/components/accounts/AccountForm.vue'
import ConfirmModal from '@/components/common/ConfirmModal.vue'
import CustomDropdown from '@/components/common/CustomDropdown.vue'
import RateLimitCountdown from '@/components/common/RateLimitCountdown.vue'
import ClaudeResetCountdown from '@/components/common/ClaudeResetCountdown.vue'

// 使用确认弹窗
const { showConfirmModal, confirmOptions, showConfirm, handleConfirm, handleCancel } = useConfirm()

// 使用accounts store
const accountsStore = useAccountsStore()

// 数据状态
const accounts = ref([])
const accountsLoading = ref(false)
const accountSortBy = ref('name')
const accountsSortBy = ref('')
const accountsSortOrder = ref('asc')
const apiKeys = ref([])
const accountGroups = ref([])
const groupFilter = ref('all')
const platformFilter = ref('all')
const searchKeyword = ref('')
const showCheckboxes = ref(false)
const selectedAccountIds = ref([])

// 缓存状态标志
const apiKeysLoaded = ref(false)
const groupsLoaded = ref(false)
const groupMembersLoaded = ref(false)
const accountGroupMap = ref(new Map())

// 下拉选项数据
const sortOptions = ref([
  { value: 'name', label: '按名称排序', icon: 'fa-font' },
  { value: 'dailyTokens', label: '按今日Token排序', icon: 'fa-coins' },
  { value: 'dailyRequests', label: '按今日请求数排序', icon: 'fa-chart-line' },
  { value: 'totalTokens', label: '按总Token排序', icon: 'fa-database' },
  { value: 'totalRequests', label: '按总请求数排序', icon: 'fa-paper-plane' },
  { value: 'lastUsed', label: '按最后使用排序', icon: 'fa-clock' }
])

const platformOptions = ref([
  { value: 'all', label: '所有平台', icon: 'fa-globe' },
  { value: 'claude', label: 'Claude', icon: 'fa-brain' },
  { value: 'claude-console', label: 'Claude Console', icon: 'fa-terminal' },
  { value: 'gemini', label: 'Gemini', icon: 'fa-google' },
  { value: 'openai', label: 'OpenAi', icon: 'fa-openai' },
  { value: 'openai-responses', label: 'OpenAI Responses', icon: 'fa-comments' },
  { value: 'azure_openai', label: 'Azure OpenAI', icon: 'fab fa-microsoft' },
  { value: 'bedrock', label: 'Bedrock', icon: 'fab fa-aws' }
])

const groupOptions = computed(() => {
  const options = [
    { value: 'all', label: '所有账户', icon: 'fa-globe' },
    { value: 'ungrouped', label: '未分组账户', icon: 'fa-user' }
  ]
  accountGroups.value.forEach((group) => {
    const strategyName = getStrategyNameShort(group.schedulingStrategy || 'least_recent')
    const platformName =
      group.platform === 'claude' ? 'Claude' : group.platform === 'gemini' ? 'Gemini' : 'OpenAI'
    options.push({
      value: group.id,
      label: `${group.name} (${platformName} | ${strategyName})`,
      icon:
        group.platform === 'claude'
          ? 'fa-brain'
          : group.platform === 'gemini'
            ? 'fa-robot'
            : 'fa-openai'
    })
  })
  return options
})

// 模态框状态
const showCreateAccountModal = ref(false)
const showEditAccountModal = ref(false)
const showBulkImportModal = ref(false)
const editingAccount = ref(null)

// 计算排序后的账户列表
const sortedAccounts = computed(() => {
  const keyword = searchKeyword.value.trim().toLowerCase()
  let sourceAccounts = accounts.value

  if (keyword) {
    sourceAccounts = sourceAccounts.filter((account) => {
      const fields = [
        account.name,
        account.email,
        account.username,
        account.platform,
        account.type,
        account.accountType,
        account.groupInfo?.name
      ]

      return fields.some((field) => {
        if (field === undefined || field === null) {
          return false
        }
        return field.toString().toLowerCase().includes(keyword)
      })
    })
  }

  if (!accountsSortBy.value) {
    return [...sourceAccounts]
  }

  const sorted = [...sourceAccounts].sort((a, b) => {
    let aVal = a[accountsSortBy.value]
    let bVal = b[accountsSortBy.value]

    // 处理统计数据
    if (accountsSortBy.value === 'dailyTokens') {
      aVal = a.usage?.daily?.allTokens || 0
      bVal = b.usage?.daily?.allTokens || 0
    } else if (accountsSortBy.value === 'dailyRequests') {
      aVal = a.usage?.daily?.requests || 0
      bVal = b.usage?.daily?.requests || 0
    } else if (accountsSortBy.value === 'totalTokens') {
      aVal = a.usage?.total?.tokens || 0
      bVal = b.usage?.total?.tokens || 0
    } else if (accountsSortBy.value === 'totalRequests') {
      aVal = a.usage?.total?.requests || 0
      bVal = b.usage?.total?.requests || 0
    }

    // 处理最后使用时间
    if (accountsSortBy.value === 'lastUsed') {
      aVal = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0
      bVal = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0
    }

    // 处理状态
    if (accountsSortBy.value === 'status') {
      aVal = a.isActive ? 1 : 0
      bVal = b.isActive ? 1 : 0
    }

    if (aVal < bVal) return accountsSortOrder.value === 'asc' ? -1 : 1
    if (aVal > bVal) return accountsSortOrder.value === 'asc' ? 1 : -1
    return 0
  })
  return sorted
})

const selectedAccountSet = computed(() => new Set(selectedAccountIds.value))
const selectedCount = computed(() => selectedAccountIds.value.length)
const allVisibleSelected = computed(() => {
  if (!showCheckboxes.value) return false
  const visibleAccounts = sortedAccounts.value
  if (visibleAccounts.length === 0) {
    return false
  }
  const currentSelected = selectedAccountSet.value
  return visibleAccounts.every((account) => currentSelected.has(account.id))
})

// 加载账户列表
const loadAccounts = async (forceReload = false) => {
  accountsLoading.value = true
  try {
    // 构建查询参数
    const params = {}
    if (platformFilter.value !== 'all') {
      params.platform = platformFilter.value
    }
    if (groupFilter.value !== 'all') {
      params.groupId = groupFilter.value
    }

    // 根据平台筛选决定需要请求哪些接口
    const requests = []

    if (platformFilter.value === 'all') {
      // 请求所有平台
      requests.push(
        apiClient.get('/admin/claude-accounts', { params }),
        apiClient.get('/admin/claude-console-accounts', { params }),
        apiClient.get('/admin/bedrock-accounts', { params }),
        apiClient.get('/admin/gemini-accounts', { params }),
        apiClient.get('/admin/openai-accounts', { params }),
        apiClient.get('/admin/azure-openai-accounts', { params }),
        apiClient.get('/admin/openai-responses-accounts', { params })
      )
    } else {
      // 只请求指定平台，其他平台设为null占位
      switch (platformFilter.value) {
        case 'claude':
          requests.push(
            apiClient.get('/admin/claude-accounts', { params }),
            Promise.resolve({ success: true, data: [] }), // claude-console 占位
            Promise.resolve({ success: true, data: [] }), // bedrock 占位
            Promise.resolve({ success: true, data: [] }), // gemini 占位
            Promise.resolve({ success: true, data: [] }), // openai 占位
            Promise.resolve({ success: true, data: [] }), // azure-openai 占位
            Promise.resolve({ success: true, data: [] }) // openai-responses 占位
          )
          break
        case 'claude-console':
          requests.push(
            Promise.resolve({ success: true, data: [] }), // claude 占位
            apiClient.get('/admin/claude-console-accounts', { params }),
            Promise.resolve({ success: true, data: [] }), // bedrock 占位
            Promise.resolve({ success: true, data: [] }), // gemini 占位
            Promise.resolve({ success: true, data: [] }), // openai 占位
            Promise.resolve({ success: true, data: [] }), // azure-openai 占位
            Promise.resolve({ success: true, data: [] }) // openai-responses 占位
          )
          break
        case 'bedrock':
          requests.push(
            Promise.resolve({ success: true, data: [] }), // claude 占位
            Promise.resolve({ success: true, data: [] }), // claude-console 占位
            apiClient.get('/admin/bedrock-accounts', { params }),
            Promise.resolve({ success: true, data: [] }), // gemini 占位
            Promise.resolve({ success: true, data: [] }), // openai 占位
            Promise.resolve({ success: true, data: [] }), // azure-openai 占位
            Promise.resolve({ success: true, data: [] }) // openai-responses 占位
          )
          break
        case 'gemini':
          requests.push(
            Promise.resolve({ success: true, data: [] }), // claude 占位
            Promise.resolve({ success: true, data: [] }), // claude-console 占位
            Promise.resolve({ success: true, data: [] }), // bedrock 占位
            apiClient.get('/admin/gemini-accounts', { params }),
            Promise.resolve({ success: true, data: [] }), // openai 占位
            Promise.resolve({ success: true, data: [] }), // azure-openai 占位
            Promise.resolve({ success: true, data: [] }) // openai-responses 占位
          )
          break
        case 'openai':
          requests.push(
            Promise.resolve({ success: true, data: [] }), // claude 占位
            Promise.resolve({ success: true, data: [] }), // claude-console 占位
            Promise.resolve({ success: true, data: [] }), // bedrock 占位
            Promise.resolve({ success: true, data: [] }), // gemini 占位
            apiClient.get('/admin/openai-accounts', { params }),
            Promise.resolve({ success: true, data: [] }), // azure-openai 占位
            Promise.resolve({ success: true, data: [] }) // openai-responses 占位
          )
          break
        case 'azure_openai':
          requests.push(
            Promise.resolve({ success: true, data: [] }), // claude 占位
            Promise.resolve({ success: true, data: [] }), // claude-console 占位
            Promise.resolve({ success: true, data: [] }), // bedrock 占位
            Promise.resolve({ success: true, data: [] }), // gemini 占位
            Promise.resolve({ success: true, data: [] }), // openai 占位
            apiClient.get('/admin/azure-openai-accounts', { params }),
            Promise.resolve({ success: true, data: [] }) // openai-responses 占位
          )
          break
        case 'openai-responses':
          requests.push(
            Promise.resolve({ success: true, data: [] }), // claude 占位
            Promise.resolve({ success: true, data: [] }), // claude-console 占位
            Promise.resolve({ success: true, data: [] }), // bedrock 占位
            Promise.resolve({ success: true, data: [] }), // gemini 占位
            Promise.resolve({ success: true, data: [] }), // openai 占位
            Promise.resolve({ success: true, data: [] }), // azure-openai 占位
            apiClient.get('/admin/openai-responses-accounts', { params })
          )
          break
      }
    }

    // 使用缓存机制加载 API Keys 和分组数据
    await Promise.all([loadApiKeys(forceReload), loadAccountGroups(forceReload)])

    // 加载分组成员关系（需要在分组数据加载完成后）
    await loadGroupMembers(forceReload)

    const [
      claudeData,
      claudeConsoleData,
      bedrockData,
      geminiData,
      openaiData,
      azureOpenaiData,
      openaiResponsesData
    ] = await Promise.all(requests)

    const allAccounts = []

    if (claudeData.success) {
      const claudeAccounts = (claudeData.data || []).map((acc) => {
        // 计算每个Claude账户绑定的API Key数量
        const boundApiKeysCount = apiKeys.value.filter(
          (key) => key.claudeAccountId === acc.id
        ).length
        // 检查是否属于某个分组
        const groupInfo = accountGroupMap.value.get(acc.id) || null
        return { ...acc, platform: 'claude', boundApiKeysCount, groupInfo }
      })
      allAccounts.push(...claudeAccounts)
    }

    if (claudeConsoleData.success) {
      const claudeConsoleAccounts = (claudeConsoleData.data || []).map((acc) => {
        // Claude Console账户暂时不支持直接绑定
        const groupInfo = accountGroupMap.value.get(acc.id) || null
        return { ...acc, platform: 'claude-console', boundApiKeysCount: 0, groupInfo }
      })
      allAccounts.push(...claudeConsoleAccounts)
    }

    if (bedrockData.success) {
      const bedrockAccounts = (bedrockData.data || []).map((acc) => {
        // Bedrock账户暂时不支持直接绑定
        const groupInfo = accountGroupMap.value.get(acc.id) || null
        return { ...acc, platform: 'bedrock', boundApiKeysCount: 0, groupInfo }
      })
      allAccounts.push(...bedrockAccounts)
    }

    if (geminiData.success) {
      const geminiAccounts = (geminiData.data || []).map((acc) => {
        // 计算每个Gemini账户绑定的API Key数量
        const boundApiKeysCount = apiKeys.value.filter(
          (key) => key.geminiAccountId === acc.id
        ).length
        const groupInfo = accountGroupMap.value.get(acc.id) || null
        return { ...acc, platform: 'gemini', boundApiKeysCount, groupInfo }
      })
      allAccounts.push(...geminiAccounts)
    }
    if (openaiData.success) {
      const openaiAccounts = (openaiData.data || []).map((acc) => {
        // 计算每个OpenAI账户绑定的API Key数量
        const boundApiKeysCount = apiKeys.value.filter(
          (key) => key.openaiAccountId === acc.id
        ).length
        const groupInfo = accountGroupMap.value.get(acc.id) || null
        return { ...acc, platform: 'openai', boundApiKeysCount, groupInfo }
      })
      allAccounts.push(...openaiAccounts)
    }
    if (azureOpenaiData && azureOpenaiData.success) {
      const azureOpenaiAccounts = (azureOpenaiData.data || []).map((acc) => {
        // 计算每个Azure OpenAI账户绑定的API Key数量
        const boundApiKeysCount = apiKeys.value.filter(
          (key) => key.azureOpenaiAccountId === acc.id
        ).length
        const groupInfo = accountGroupMap.value.get(acc.id) || null
        return { ...acc, platform: 'azure_openai', boundApiKeysCount, groupInfo }
      })
      allAccounts.push(...azureOpenaiAccounts)
    }

    if (openaiResponsesData && openaiResponsesData.success) {
      const responsesAccounts = (openaiResponsesData.data || []).map((acc) => {
        const groupInfo = accountGroupMap.value.get(acc.id) || null
        return { ...acc, platform: 'openai-responses', boundApiKeysCount: 0, groupInfo }
      })
      allAccounts.push(...responsesAccounts)
    }

    // 为Claude账户加载费用统计信息
    await loadCostStatsForAccounts(allAccounts)

    accounts.value = allAccounts
  } catch (error) {
    showToast('加载账户失败', 'error')
  } finally {
    accountsLoading.value = false
  }
}

// 排序账户
const sortAccounts = (field) => {
  if (field) {
    if (accountsSortBy.value === field) {
      accountsSortOrder.value = accountsSortOrder.value === 'asc' ? 'desc' : 'asc'
    } else {
      accountsSortBy.value = field
      accountsSortOrder.value = 'asc'
    }
  }
}

const clearSearch = () => {
  if (!searchKeyword.value) return
  searchKeyword.value = ''
}

// 计算平均每请求Token数（使用优化的工具函数）
const formatAverageTokensPerRequest = (totalTokens, totalRequests) => {
  const usage = {
    tokens: totalTokens || 0,
    requests: totalRequests || 0
  }
  return getAverageTokensPerRequest(usage)
}

// 格式化费用显示
const formatCost = (cost) => {
  if (cost == null || cost === undefined || isNaN(cost)) return '0.00'
  const numCost = parseFloat(cost)
  if (numCost === 0) return '0.00'
  if (numCost < 0.01) return '<0.01'
  return numCost.toFixed(2)
}

// 格式化最后使用时间
const formatLastUsed = (dateString) => {
  if (!dateString) return '从未使用'

  const date = new Date(dateString)
  const now = new Date()
  const diff = now - date

  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`

  return date.toLocaleDateString('zh-CN')
}

// 加载API Keys列表（缓存版本）
const loadApiKeys = async (forceReload = false) => {
  if (!forceReload && apiKeysLoaded.value) {
    return // 使用缓存数据
  }

  try {
    const response = await apiClient.get('/admin/api-keys')
    if (response.success) {
      apiKeys.value = response.data || []
      apiKeysLoaded.value = true
    }
  } catch (error) {
    console.error('Failed to load API keys:', error)
  }
}

// 加载账户分组列表（缓存版本）
const loadAccountGroups = async (forceReload = false) => {
  if (!forceReload && groupsLoaded.value) {
    return // 使用缓存数据
  }

  try {
    const response = await apiClient.get('/admin/account-groups')
    if (response.success) {
      accountGroups.value = response.data || []
      groupsLoaded.value = true
    }
  } catch (error) {
    console.error('Failed to load account groups:', error)
  }
}

// 加载分组成员关系（缓存版本）
const loadGroupMembers = async (forceReload = false) => {
  if (!forceReload && groupMembersLoaded.value) {
    return // 使用缓存数据
  }

  try {
    // 重置映射
    accountGroupMap.value.clear()

    // 获取所有分组的成员信息
    for (const group of accountGroups.value) {
      try {
        const membersResponse = await apiClient.get(`/admin/account-groups/${group.id}/members`)
        if (membersResponse.success) {
          const members = membersResponse.data || []
          members.forEach((member) => {
            accountGroupMap.value.set(member.id, group)
          })
        }
      } catch (error) {
        console.error(`Failed to load members for group ${group.id}:`, error)
      }
    }
    groupMembersLoaded.value = true
  } catch (error) {
    console.error('Failed to load group members:', error)
  }
}

// 清空缓存的函数
const clearCache = () => {
  apiKeysLoaded.value = false
  groupsLoaded.value = false
  groupMembersLoaded.value = false
  accountGroupMap.value.clear()
}

// 按平台筛选账户
const filterByPlatform = () => {
  loadAccounts()
}

// 按分组筛选账户
const filterByGroup = () => {
  loadAccounts()
}

// 格式化代理信息显示
const formatProxyDisplay = (proxy) => {
  if (!proxy || !proxy.host || !proxy.port) return null

  // 缩短类型名称
  const typeShort = proxy.type === 'socks5' ? 'S5' : proxy.type.toUpperCase()

  // 缩短主机名（如果太长）
  let host = proxy.host
  if (host.length > 15) {
    host = host.substring(0, 12) + '...'
  }

  let display = `${typeShort}://${host}:${proxy.port}`

  // 如果有用户名密码，添加认证信息（部分隐藏）
  if (proxy.username) {
    display = `${typeShort}://***@${host}:${proxy.port}`
  }

  return display
}

// 格式化会话窗口时间
const formatSessionWindow = (windowStart, windowEnd) => {
  if (!windowStart || !windowEnd) return '--'

  const start = new Date(windowStart)
  const end = new Date(windowEnd)

  const startHour = start.getHours().toString().padStart(2, '0')
  const startMin = start.getMinutes().toString().padStart(2, '0')
  const endHour = end.getHours().toString().padStart(2, '0')
  const endMin = end.getMinutes().toString().padStart(2, '0')

  return `${startHour}:${startMin} - ${endHour}:${endMin}`
}

// 格式化剩余时间
const formatRemainingTime = (minutes) => {
  if (!minutes || minutes <= 0) return '已结束'

  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60

  if (hours > 0) {
    return `${hours}小时${mins}分钟`
  }
  return `${mins}分钟`
}

// 打开创建账户模态框
const openCreateAccountModal = () => {
  showCreateAccountModal.value = true
}

// 编辑账户
const editAccount = (account) => {
  editingAccount.value = account
  showEditAccountModal.value = true
}

const getBoundKeysCount = (account) => {
  return apiKeys.value.filter((key) => {
    return (
      key.claudeAccountId === account.id ||
      key.geminiAccountId === account.id ||
      key.openaiAccountId === account.id ||
      key.azureOpenaiAccountId === account.id
    )
  }).length
}

const getAccountDeleteEndpoint = (account) => {
  switch (account.platform) {
    case 'claude':
      return `/admin/claude-accounts/${account.id}`
    case 'claude-console':
      return `/admin/claude-console-accounts/${account.id}`
    case 'bedrock':
      return `/admin/bedrock-accounts/${account.id}`
    case 'gemini':
      return `/admin/gemini-accounts/${account.id}`
    case 'openai':
      return `/admin/openai-accounts/${account.id}`
    case 'azure_openai':
      return `/admin/azure-openai-accounts/${account.id}`
    case 'openai-responses':
      return `/admin/openai-responses-accounts/${account.id}`
    default:
      return null
  }
}

const toggleSelectionMode = () => {
  showCheckboxes.value = !showCheckboxes.value
  if (!showCheckboxes.value) {
    selectedAccountIds.value = []
  }
}

const handleAccountCheckboxChange = (account, checked) => {
  if (!showCheckboxes.value) {
    return
  }

  const ids = selectedAccountIds.value
  if (checked) {
    if (!selectedAccountSet.value.has(account.id)) {
      selectedAccountIds.value = [...ids, account.id]
    }
  } else if (selectedAccountSet.value.has(account.id)) {
    selectedAccountIds.value = ids.filter((id) => id !== account.id)
  }
}

const toggleSelectAll = (checked) => {
  if (!showCheckboxes.value) return
  if (checked) {
    selectedAccountIds.value = sortedAccounts.value.map((account) => account.id)
  } else {
    selectedAccountIds.value = []
  }
}

const isAccountSelected = (accountId) => selectedAccountSet.value.has(accountId)

const cleanupSelectedAccounts = () => {
  if (!selectedAccountIds.value.length) return
  const availableIds = new Set(accounts.value.map((account) => account.id))
  selectedAccountIds.value = selectedAccountIds.value.filter((id) => availableIds.has(id))
}

const batchDeleteAccounts = async () => {
  if (!selectedAccountIds.value.length) {
    return
  }

  const accountMap = new Map(accounts.value.map((account) => [account.id, account]))
  const targets = selectedAccountIds.value
    .map((id) => accountMap.get(id))
    .filter((account) => !!account)

  if (!targets.length) {
    showToast('未找到选中的账户', 'warning')
    return
  }

  const blocked = targets.filter((account) => getBoundKeysCount(account) > 0)
  if (blocked.length > 0) {
    const names = blocked.map((account) => account.name || account.id).join(', ')
    showToast(`请先解绑以下账户的 API Key: ${names}`, 'error')
    return
  }

  const confirmed = await showConfirm(
    '批量删除账户',
    `确定要删除选中的 ${targets.length} 个账户吗？此操作不可恢复。`,
    '删除',
    '取消'
  )

  if (!confirmed) return

  try {
    for (const account of targets) {
      const endpoint = getAccountDeleteEndpoint(account)
      if (!endpoint) continue
      const response = await apiClient.delete(endpoint)
      if (!response?.success) {
        throw new Error(response?.message || `删除账户 ${account.name || account.id} 失败`)
      }
    }

    showToast(`已删除 ${targets.length} 个账户`, 'success')
    selectedAccountIds.value = []
    showCheckboxes.value = false
    groupMembersLoaded.value = false
    await loadAccounts(true)
  } catch (error) {
    console.error(error)
    showToast(error.message || '批量删除失败', 'error')
  }
}

// 删除账户
const deleteAccount = async (account) => {
  // 检查是否有API Key绑定到此账号
  const boundKeysCount = getBoundKeysCount(account)

  if (boundKeysCount > 0) {
    showToast(
      `无法删除此账号，有 ${boundKeysCount} 个API Key绑定到此账号，请先解绑所有API Key`,
      'error'
    )
    return
  }

  const confirmed = await showConfirm(
    '删除账户',
    `确定要删除账户 "${account.name}" 吗？\n\n此操作不可恢复。`,
    '删除',
    '取消'
  )

  if (!confirmed) return

  try {
    const endpoint = getAccountDeleteEndpoint(account)
    if (!endpoint) {
      showToast('当前账户类型暂不支持删除', 'warning')
      return
    }

    const data = await apiClient.delete(endpoint)

    if (data.success) {
      showToast('账户已删除', 'success')
      // 清空分组成员缓存，因为账户可能从分组中移除
      groupMembersLoaded.value = false
      loadAccounts()
    } else {
      showToast(data.message || '删除失败', 'error')
    }
  } catch (error) {
    showToast('删除失败', 'error')
  }
}

// 重置账户状态
const resetAccountStatus = async (account) => {
  if (account.isResetting) return

  let confirmed = false
  if (window.showConfirm) {
    confirmed = await window.showConfirm(
      '重置账户状态',
      '确定要重置此账户的所有异常状态吗？这将清除限流状态、401错误计数等所有异常标记。',
      '确定重置',
      '取消'
    )
  } else {
    confirmed = confirm('确定要重置此账户的所有异常状态吗？')
  }

  if (!confirmed) return

  try {
    account.isResetting = true
    let endpoint = null
    if (account.platform === 'claude') {
      endpoint = `/admin/claude-accounts/${account.id}/reset-status`
    } else if (account.platform === 'openai-responses') {
      endpoint = `/admin/openai-responses-accounts/${account.id}/reset-status`
    }

    if (!endpoint) {
      showToast('当前账户类型暂不支持状态重置', 'warning')
      return
    }

    const data = await apiClient.post(endpoint)

    if (data.success) {
      showToast('账户状态已重置', 'success')
      loadAccounts()
    } else {
      showToast(data.message || '状态重置失败', 'error')
    }
  } catch (error) {
    showToast('状态重置失败', 'error')
  } finally {
    account.isResetting = false
  }
}

const resetOpenAIResponsesUsage = async (account) => {
  if (account.platform !== 'openai-responses' || account.isResettingUsage) {
    return
  }

  let confirmed = false
  if (window.showConfirm) {
    confirmed = await window.showConfirm(
      '重置每日用量',
      '确定要清空该账户的每日使用量吗？',
      '确定重置',
      '取消'
    )
  } else {
    confirmed = confirm('确定要清空该账户的每日使用量吗？')
  }

  if (!confirmed) return

  try {
    account.isResettingUsage = true
    const response = await apiClient.post(
      `/admin/openai-responses-accounts/${account.id}/reset-usage`
    )

    if (response.success) {
      showToast('每日使用量已重置', 'success')
      loadAccounts()
    } else {
      showToast(response.message || '每日使用量重置失败', 'error')
    }
  } catch (error) {
    showToast('每日使用量重置失败', 'error')
  } finally {
    account.isResettingUsage = false
  }
}

// 切换调度状态
const toggleSchedulable = async (account) => {
  if (account.isTogglingSchedulable) return

  try {
    account.isTogglingSchedulable = true

    let endpoint
    if (account.platform === 'claude') {
      endpoint = `/admin/claude-accounts/${account.id}/toggle-schedulable`
    } else if (account.platform === 'claude-console') {
      endpoint = `/admin/claude-console-accounts/${account.id}/toggle-schedulable`
    } else if (account.platform === 'bedrock') {
      endpoint = `/admin/bedrock-accounts/${account.id}/toggle-schedulable`
    } else if (account.platform === 'gemini') {
      endpoint = `/admin/gemini-accounts/${account.id}/toggle-schedulable`
    } else if (account.platform === 'openai') {
      endpoint = `/admin/openai-accounts/${account.id}/toggle-schedulable`
    } else if (account.platform === 'azure_openai') {
      endpoint = `/admin/azure-openai-accounts/${account.id}/toggle-schedulable`
    } else {
      showToast('该账户类型暂不支持调度控制', 'warning')
      return
    }

    const data = await apiClient.put(endpoint)

    if (data.success) {
      account.schedulable = data.schedulable
      showToast(data.schedulable ? '已启用调度' : '已禁用调度', 'success')
    } else {
      showToast(data.message || '操作失败', 'error')
    }
  } catch (error) {
    showToast('切换调度状态失败', 'error')
  } finally {
    account.isTogglingSchedulable = false
  }
}

// 处理创建成功
const handleCreateSuccess = () => {
  showCreateAccountModal.value = false
  showToast('账户创建成功', 'success')
  // 清空缓存，因为可能涉及分组关系变化
  clearCache()
  loadAccounts()
}

// 处理编辑成功
const handleEditSuccess = () => {
  showEditAccountModal.value = false
  showToast('账户更新成功', 'success')
  // 清空分组成员缓存，因为账户类型和分组可能发生变化
  groupMembersLoaded.value = false
  loadAccounts()
}

const handleBulkImportSuccess = () => {
  // 导入完成后刷新列表，保持分组状态一致
  clearCache()
  loadAccounts()
}

// 获取 Claude 账号的添加方式
const getClaudeAuthType = (account) => {
  // 基于 lastRefreshAt 判断：如果为空说明是 Setup Token（不能刷新），否则是 OAuth
  if (!account.lastRefreshAt || account.lastRefreshAt === '') {
    return 'Setup' // 缩短显示文本
  }
  return 'OAuth'
}

// 获取 Gemini 账号的添加方式
const getGeminiAuthType = () => {
  // Gemini 统一显示 OAuth
  return 'OAuth'
}

// 获取 OpenAI 账号的添加方式
const getOpenAIAuthType = () => {
  // OpenAI 统一显示 OAuth
  return 'OAuth'
}

// 获取 Claude 账号类型显示
const getClaudeAccountType = (account) => {
  // 如果有订阅信息
  if (account.subscriptionInfo) {
    try {
      // 如果 subscriptionInfo 是字符串，尝试解析
      const info =
        typeof account.subscriptionInfo === 'string'
          ? JSON.parse(account.subscriptionInfo)
          : account.subscriptionInfo

      // 添加调试日志
      console.log('Account subscription info:', {
        accountName: account.name,
        subscriptionInfo: info,
        hasClaudeMax: info.hasClaudeMax,
        hasClaudePro: info.hasClaudePro
      })

      // 根据 has_claude_max 和 has_claude_pro 判断
      if (info.hasClaudeMax === true) {
        return 'Claude Max'
      } else if (info.hasClaudePro === true) {
        return 'Claude Pro'
      } else {
        return 'Claude Free'
      }
    } catch (e) {
      // 解析失败，返回默认值
      console.error('Failed to parse subscription info:', e)
      return 'Claude'
    }
  }

  // 没有订阅信息，保持原有显示
  console.log('No subscription info for account:', account.name)
  return 'Claude'
}

// 获取账户状态文本
const getAccountStatusText = (account) => {
  // 检查是否被封锁
  if (account.status === 'blocked') return '已封锁'
  // 检查是否未授权（401错误）
  if (account.status === 'unauthorized') return '异常'
  // 检查是否限流
  if (
    account.isRateLimited ||
    account.status === 'rate_limited' ||
    (account.rateLimitStatus && account.rateLimitStatus.isRateLimited) ||
    account.rateLimitStatus === 'limited'
  )
    return '限流中'
  // 检查是否错误
  if (account.status === 'error' || !account.isActive) return '错误'
  // 检查是否可调度
  if (account.schedulable === false) return '已暂停'
  // 否则正常
  return '正常'
}

// 获取账户状态样式类
const getAccountStatusClass = (account) => {
  if (account.status === 'blocked') {
    return 'bg-red-100 text-red-800'
  }
  if (account.status === 'unauthorized') {
    return 'bg-red-100 text-red-800'
  }
  if (
    account.isRateLimited ||
    account.status === 'rate_limited' ||
    (account.rateLimitStatus && account.rateLimitStatus.isRateLimited) ||
    account.rateLimitStatus === 'limited'
  ) {
    return 'bg-orange-100 text-orange-800'
  }
  if (account.status === 'error' || !account.isActive) {
    return 'bg-red-100 text-red-800'
  }
  if (account.schedulable === false) {
    return 'bg-gray-100 text-gray-800'
  }
  return 'bg-green-100 text-green-800'
}

// 获取账户状态点样式类
const getAccountStatusDotClass = (account) => {
  if (account.status === 'blocked') {
    return 'bg-red-500'
  }
  if (account.status === 'unauthorized') {
    return 'bg-red-500'
  }
  if (
    account.isRateLimited ||
    account.status === 'rate_limited' ||
    (account.rateLimitStatus && account.rateLimitStatus.isRateLimited) ||
    account.rateLimitStatus === 'limited'
  ) {
    return 'bg-orange-500'
  }
  if (account.status === 'error' || !account.isActive) {
    return 'bg-red-500'
  }
  if (account.schedulable === false) {
    return 'bg-gray-500'
  }
  return 'bg-green-500'
}

// 获取会话窗口百分比
// const getSessionWindowPercentage = (account) => {
//   if (!account.sessionWindow) return 100
//   const { remaining, total } = account.sessionWindow
//   if (!total || total === 0) return 100
//   return Math.round((remaining / total) * 100)
// }

// 格式化相对时间
const formatRelativeTime = (dateString) => {
  return formatLastUsed(dateString)
}

// 切换调度状态
// const toggleDispatch = async (account) => {
//   await toggleSchedulable(account)
// }

// 监听排序选择变化
watch(accountSortBy, (newVal) => {
  const fieldMap = {
    name: 'name',
    dailyTokens: 'dailyTokens',
    dailyRequests: 'dailyRequests',
    totalTokens: 'totalTokens',
    totalRequests: 'totalRequests',
    lastUsed: 'lastUsed'
  }

  if (fieldMap[newVal]) {
    sortAccounts(fieldMap[newVal])
  }
})

watch(accounts, () => {
  cleanupSelectedAccounts()
})

watch(sortedAccounts, () => {
  if (!showCheckboxes.value) return
  cleanupSelectedAccounts()
})

onMounted(() => {
  // 首次加载时强制刷新所有数据
  loadAccounts(true)
})

// 调度策略相关辅助函数
const getStrategyName = (strategy) => {
  const strategyNames = {
    round_robin: '轮询',
    least_used: '最少使用',
    least_recent: '最近最少',
    random: '随机',
    weighted_random: '加权随机',
    sequential: '顺序'
  }
  return strategyNames[strategy] || '未知'
}

const getStrategyIcon = (strategy) => {
  const strategyIcons = {
    round_robin: 'fas fa-sync-alt text-blue-500',
    least_used: 'fas fa-chart-bar text-green-500',
    least_recent: 'fas fa-clock text-orange-500',
    random: 'fas fa-random text-purple-500',
    weighted_random: 'fas fa-weight-hanging text-orange-600',
    sequential: 'fas fa-sort-numeric-down text-indigo-500'
  }
  return strategyIcons[strategy] || 'fas fa-question text-gray-400'
}

// 分组调度策略相关辅助函数
const getStrategyNameShort = (strategy) => {
  const names = {
    round_robin: '轮询',
    least_used: '最少使用',
    least_recent: '最近最少',
    random: '随机',
    weighted_random: '加权随机',
    sequential: '顺序'
  }
  return names[strategy] || '最近最少'
}

const getStrategyIconCompact = (strategy) => {
  const icons = {
    round_robin: 'fas fa-sync-alt',
    least_used: 'fas fa-chart-bar',
    least_recent: 'fas fa-clock',
    random: 'fas fa-random',
    weighted_random: 'fas fa-balance-scale',
    sequential: 'fas fa-list-ol'
  }
  return icons[strategy] || 'fas fa-clock'
}

const getStrategyColorCompact = (strategy) => {
  const colors = {
    round_robin: 'bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400',
    least_used: 'bg-green-100 text-green-600 dark:bg-green-900/50 dark:text-green-400',
    least_recent: 'bg-orange-100 text-orange-600 dark:bg-orange-900/50 dark:text-orange-400',
    random: 'bg-purple-100 text-purple-600 dark:bg-purple-900/50 dark:text-purple-400',
    weighted_random: 'bg-amber-100 text-amber-600 dark:bg-amber-900/50 dark:text-amber-400',
    sequential: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/50 dark:text-indigo-400'
  }
  return (
    colors[strategy] || 'bg-orange-100 text-orange-600 dark:bg-orange-900/50 dark:text-orange-400'
  )
}

const getGroupSchedulingDetails = (groupInfo) => {
  if (!groupInfo.schedulingStrategy) return ''

  let details = ''
  if (groupInfo.schedulingStrategy === 'weighted_random' && groupInfo.schedulingWeight) {
    details = `默认权重: ${groupInfo.schedulingWeight}`
  } else if (groupInfo.schedulingStrategy === 'sequential' && groupInfo.sequentialOrder) {
    details = `起始位置: ${groupInfo.sequentialOrder}`
  }
  return details
}

const getStrategyColor = (strategy) => {
  const strategyColors = {
    round_robin:
      'bg-blue-100 text-blue-800 border border-blue-200 dark:bg-blue-900/30 dark:text-blue-200 dark:border-blue-700',
    least_used:
      'bg-green-100 text-green-800 border border-green-200 dark:bg-green-900/30 dark:text-green-200 dark:border-green-700',
    least_recent:
      'bg-orange-100 text-orange-800 border border-orange-200 dark:bg-orange-900/30 dark:text-orange-200 dark:border-orange-700',
    random:
      'bg-purple-100 text-purple-800 border border-purple-200 dark:bg-purple-900/30 dark:text-purple-200 dark:border-purple-700',
    weighted_random:
      'bg-amber-100 text-amber-800 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-700',
    sequential:
      'bg-indigo-100 text-indigo-800 border border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-200 dark:border-indigo-700'
  }
  return (
    strategyColors[strategy] ||
    'bg-gray-100 text-gray-800 border border-gray-200 dark:bg-gray-900/30 dark:text-gray-200 dark:border-gray-700'
  )
}

// 处理限流过期
const handleRateLimitExpired = (account) => {
  // 限流已过期，刷新该账户的状态
  loadAccounts()
  showToast(`账户 ${account.name} 的限流状态已重置`, 'success')
}

// 处理限流时间更新
const handleRateLimitUpdate = async () => {
  try {
    // 每分钟检查一次是否需要刷新账户状态
    const now = Date.now()
    const lastRefresh = handleRateLimitUpdate._lastRefresh || 0
    const refreshInterval = 60 * 1000 // 60秒

    if (now - lastRefresh > refreshInterval) {
      handleRateLimitUpdate._lastRefresh = now

      // 检查是否有限流状态即将过期的账户（5分钟内）
      const accountsNearExpiry = accounts.value.filter((account) => {
        if (!account.rateLimitStatus || !account.rateLimitStatus.isRateLimited) {
          return false
        }

        const endTime = new Date(account.rateLimitStatus.rateLimitEndAt)
        const remaining = endTime - new Date()
        return remaining > 0 && remaining < 5 * 60 * 1000 // 5分钟
      })

      if (accountsNearExpiry.length > 0) {
        console.info(`即将有 ${accountsNearExpiry.length} 个账户解除限流`)

        // 可以在这里添加更多的预处理逻辑
        // 比如预加载下一批可用账户等
      }

      // 如果有账户限流状态变化，考虑局部刷新
      const hasStatusChanges = accounts.value.some(
        (account) =>
          account.rateLimitStatus &&
          account.rateLimitStatus.isRateLimited &&
          account.rateLimitStatus.minutesRemaining <= 1
      )

      if (hasStatusChanges) {
        // 静默刷新账户数据，不显示loading状态
        await loadAccounts(false)
      }
    }
  } catch (error) {
    console.error('处理限流更新时出错:', error)
  }
}

// 处理Claude重置时间更新
const handleClaudeResetUpdate = () => {
  // Claude 5小时重置倒计时更新，暂时无需特殊处理
  // 可以在这里添加日志或其他逻辑
}

// 为账户加载费用统计信息
const loadCostStatsForAccounts = async (allAccounts) => {
  try {
    // 筛选支持费用统计的账户
    const accountsWithCostStats = allAccounts.filter((account) => {
      // 目前所有平台都支持费用统计
      return ['claude', 'claude-console', 'gemini', 'openai', 'azure_openai', 'bedrock'].includes(
        account.platform
      )
    })

    if (accountsWithCostStats.length === 0) {
      return
    }

    // 并行获取所有账户的费用统计
    const costStatsPromises = accountsWithCostStats.map(async (account) => {
      try {
        const costStats = await accountsStore.getAccountCostStats(
          account.id,
          account.platform,
          'all'
        )
        return { accountId: account.id, costStats }
      } catch (error) {
        console.warn(`获取账户 ${account.id} (${account.platform}) 的费用统计失败:`, error)
        return {
          accountId: account.id,
          costStats: {
            totalCost: 0,
            hasCostStats: false,
            error: error.message
          }
        }
      }
    })

    const results = await Promise.all(costStatsPromises)

    // 将费用统计数据附加到账户对象上
    results.forEach(({ accountId, costStats }) => {
      const account = allAccounts.find((acc) => acc.id === accountId)
      if (account) {
        account.costStats = costStats
      }
    })
  } catch (error) {
    console.error('加载账户费用统计失败:', error)
  }
}
</script>

<style scoped>
.table-container {
  overflow-x: auto;
  border-radius: 12px;
}

/* 表格水平滚动优化 */
.table-scroll-wrapper {
  scrollbar-width: thin;
  scrollbar-color: rgba(156, 163, 175, 0.5) transparent;
}

.table-scroll-wrapper::-webkit-scrollbar {
  height: 6px;
}

.table-scroll-wrapper::-webkit-scrollbar-track {
  background: transparent;
}

.table-scroll-wrapper::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.5);
  border-radius: 3px;
}

.table-scroll-wrapper::-webkit-scrollbar-thumb:hover {
  background-color: rgba(156, 163, 175, 0.7);
}

/* 1024px分辨率专项优化 */
@media (min-width: 1024px) and (max-width: 1279px) {
  .table-container table {
    font-size: 0.8rem;
  }
  
  .table-container th,
  .table-container td {
    padding-left: 0.5rem;
    padding-right: 0.5rem;
  }
}

.table-row {
  transition: all 0.2s ease;
}

.table-row:hover {
  background-color: rgba(0, 0, 0, 0.02);
}

.loading-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid #e5e7eb;
  border-top: 2px solid #3b82f6;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
.accounts-container {
  min-height: calc(100vh - 300px);
}

.table-container {
  overflow-x: auto;
  border-radius: 12px;
  border: 1px solid rgba(0, 0, 0, 0.05);
}

.table-row {
  transition: all 0.2s ease;
}

.table-row:hover {
  background-color: rgba(0, 0, 0, 0.02);
}
</style>
