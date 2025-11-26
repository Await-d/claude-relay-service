<template>
  <div class="space-y-4">
    <div>
      <label class="mb-3 block text-sm font-semibold text-gray-700 dark:text-gray-300"
        >限流机制</label
      >
      <div class="mb-3">
        <label class="inline-flex cursor-pointer items-center">
          <input
            :checked="enabled"
            class="mr-2 rounded border-gray-300 text-blue-600 focus:border-blue-500 focus:ring focus:ring-blue-200 dark:border-gray-600 dark:bg-gray-700"
            type="checkbox"
            @change="$emit('update:enabled', $event.target.checked)"
          />
          <span class="text-sm text-gray-700 dark:text-gray-300">启用限流机制</span>
        </label>
        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
          启用后，当账号返回429错误时将暂停调度一段时间
        </p>
      </div>

      <div v-if="enabled">
        <label class="mb-3 block text-sm font-semibold text-gray-700 dark:text-gray-300"
          >限流时间 (分钟)</label
        >
        <input
          class="form-input w-full border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400"
          min="1"
          placeholder="默认60分钟"
          type="number"
          :value="duration"
          @input="$emit('update:duration', parseInt($event.target.value) || 60)"
        />
        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
          账号被限流后暂停调度的时间（分钟）
        </p>
      </div>
    </div>
  </div>
</template>

<script setup>
// Props
defineProps({
  enabled: {
    type: Boolean,
    default: false
  },
  duration: {
    type: Number,
    default: 60
  }
})

// Emits
defineEmits(['update:enabled', 'update:duration'])
</script>
