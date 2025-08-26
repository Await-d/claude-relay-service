<template>
  <div class="claude-reset-countdown">
    <div class="flex items-center gap-2">
      <i class="fas fa-clock text-blue-600 dark:text-blue-400" />
      <div class="flex flex-col">
        <span class="text-xs font-medium text-blue-800 dark:text-blue-200">
          {{ remainingTime }}后重置
        </span>
        <span class="text-xs text-gray-600 dark:text-gray-400">
          {{ formatNextResetTime(nextResetTime) }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'

const props = defineProps({
  account: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['update'])

const now = ref(new Date())
let timer = null

// 计算下次5小时重置时间
const nextResetTime = computed(() => {
  if (!props.account) return new Date()

  const currentTime = now.value
  const currentHour = currentTime.getHours()

  // Claude的5小时重置时间点: 0:00, 5:00, 10:00, 15:00, 20:00
  const resetHours = [0, 5, 10, 15, 20]
  let nextResetHour = resetHours.find((hour) => hour > currentHour)

  // 如果当天没有下一个重置点，则取明天的第一个重置点
  if (!nextResetHour) {
    nextResetHour = resetHours[0] // 明天的0:00
  }

  const nextReset = new Date(currentTime)

  if (nextResetHour === 0 && currentHour >= 20) {
    // 明天的0:00
    nextReset.setDate(nextReset.getDate() + 1)
  }

  nextReset.setHours(nextResetHour, 0, 0, 0)

  return nextReset
})

// 计算剩余时间
const remainingTime = computed(() => {
  const remaining = Math.max(0, Math.floor((nextResetTime.value - now.value) / 1000))

  const hours = Math.floor(remaining / 3600)
  const minutes = Math.floor((remaining % 3600) / 60)
  const seconds = remaining % 60

  if (hours > 0) {
    return `${hours}小时${minutes}分钟`
  } else if (minutes > 0) {
    return `${minutes}分钟${seconds}秒`
  } else {
    return `${seconds}秒`
  }
})

// 格式化重置时间显示
const formatNextResetTime = (timeDate) => {
  if (!timeDate) return '--'

  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)

  const isToday = timeDate.toDateString() === today.toDateString()
  const isTomorrow = timeDate.toDateString() === tomorrow.toDateString()

  const timeStr = timeDate.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })

  if (isToday) {
    return `今天 ${timeStr}`
  } else if (isTomorrow) {
    return `明天 ${timeStr}`
  } else {
    return `${timeDate.toLocaleDateString('zh-CN')} ${timeStr}`
  }
}

// 启动定时器
const startTimer = () => {
  if (timer) {
    clearInterval(timer)
  }

  timer = setInterval(() => {
    now.value = new Date()
    emit('update')
  }, 1000)
}

// 停止定时器
const stopTimer = () => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

onMounted(() => {
  startTimer()
})

onUnmounted(() => {
  stopTimer()
})

// 监听account变化
watch(
  () => props.account,
  (newVal) => {
    if (newVal) {
      if (!timer) {
        startTimer()
      }
    } else {
      stopTimer()
    }
  }
)
</script>

<style scoped>
.claude-reset-countdown {
  @apply rounded-lg border border-blue-200 bg-blue-50 px-3 py-2;
}

.dark .claude-reset-countdown {
  @apply border-blue-700/50 bg-blue-900/20;
}
</style>
