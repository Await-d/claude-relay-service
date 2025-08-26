<template>
  <div v-if="rateLimitInfo && rateLimitInfo.isRateLimited" class="rate-limit-info">
    <div class="flex items-center gap-2">
      <i class="fas fa-clock text-yellow-600 dark:text-yellow-400" />
      <div class="flex flex-col">
        <span class="text-xs font-medium text-yellow-800 dark:text-yellow-200">
          限流中，{{ remainingTime }}
        </span>
        <span v-if="resetTime" class="text-xs text-gray-600 dark:text-gray-400">
          重置时间: {{ formatResetTime(resetTime) }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  rateLimitInfo: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['update', 'expired'])

const now = ref(new Date())
let timer = null

// 计算剩余时间
const remainingTime = computed(() => {
  if (!props.rateLimitInfo || !props.rateLimitInfo.rateLimitEndAt) {
    return '计算中...'
  }

  const endTime = new Date(props.rateLimitInfo.rateLimitEndAt)
  const remaining = Math.max(0, Math.floor((endTime - now.value) / 1000))

  if (remaining === 0) {
    emit('expired')
    return '已重置'
  }

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

// 重置时间
const resetTime = computed(() => {
  return props.rateLimitInfo?.rateLimitEndAt
})

// 格式化重置时间显示
const formatResetTime = (timeString) => {
  if (!timeString) return '--'

  const date = new Date(timeString)
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)

  const isToday = date.toDateString() === today.toDateString()
  const isTomorrow = date.toDateString() === tomorrow.toDateString()

  const timeStr = date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })

  if (isToday) {
    return `今天 ${timeStr}`
  } else if (isTomorrow) {
    return `明天 ${timeStr}`
  } else {
    return `${date.toLocaleDateString('zh-CN')} ${timeStr}`
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
  if (props.rateLimitInfo && props.rateLimitInfo.isRateLimited) {
    startTimer()
  }
})

onUnmounted(() => {
  stopTimer()
})

// 监听 props 变化
import { watch } from 'vue'
watch(
  () => props.rateLimitInfo,
  (newVal) => {
    if (newVal && newVal.isRateLimited) {
      startTimer()
    } else {
      stopTimer()
    }
  }
)
</script>

<style scoped>
.rate-limit-info {
  @apply rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2;
}

.dark .rate-limit-info {
  @apply border-yellow-700/50 bg-yellow-900/20;
}
</style>
