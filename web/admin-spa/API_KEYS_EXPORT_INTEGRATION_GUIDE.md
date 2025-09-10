# API Keys 导出功能集成指南

## 功能概述

API Keys导出功能为用户提供了完整的数据导出解决方案，支持多种文件格式、灵活的时间筛选和字段选择。

### 核心特性

- 🗂️ **多格式支持**: Excel (.xlsx) 和 CSV 格式
- 📅 **时间范围筛选**: 支持自定义日期范围和快速选择
- 🏷️ **字段自定义**: 可选择导出的数据字段
- 📊 **高级选项**: 包含使用统计和成本分析
- 📈 **进度显示**: 实时显示导出进度
- 🎨 **响应式设计**: 完全适配手机、平板、桌面
- 🌙 **暗黑模式**: 完整支持明亮/暗黑主题切换
- 🚀 **玻璃态效果**: 保持现有设计风格

## 文件结构

```
src/
├── components/
│   └── apikeys/
│       └── ExportApiKeysModal.vue        # 导出模态框组件
├── utils/
│   └── ExcelExporter.js                  # 导出工具类
└── views/
    └── ApiKeysView.vue                   # 已集成导出功能
```

## 组件使用

### 1. ExportApiKeysModal 组件

```vue
<template>
  <ExportApiKeysModal
    v-if="showExportModal"
    :api-keys="apiKeys"
    @close="showExportModal = false"
    @export-complete="handleExportComplete"
  />
</template>

<script setup>
import ExportApiKeysModal from '@/components/apikeys/ExportApiKeysModal.vue'

const showExportModal = ref(false)
const apiKeys = ref([]) // 你的API Keys数据

const handleExportComplete = () => {
  showExportModal.value = false
  // 处理导出完成逻辑
}
</script>
```

### 2. 组件 Props

| 属性 | 类型 | 默认值 | 描述 |
|------|------|---------|------|
| `api-keys` | Array | `[]` | 要导出的API Keys数据数组 |

### 3. 组件 Events

| 事件 | 参数 | 描述 |
|------|------|------|
| `close` | - | 关闭模态框时触发 |
| `export-complete` | - | 导出完成时触发 |

## ExcelExporter 工具类

### 基本使用

```javascript
import { excelExporter } from '@/utils/ExcelExporter'

// 设置进度回调
excelExporter.setProgressCallback((progress, status) => {
  console.log(`进度: ${progress}%, 状态: ${status}`)
})

// 导出配置
const config = {
  format: 'xlsx',           // 'xlsx' | 'csv'
  startDate: '2024-01-01',
  endDate: '2024-12-31',
  fields: ['id', 'name', 'createdAt', 'totalTokens'],
  includeUsageStats: true,
  includeCostAnalysis: false
}

// 执行导出
await excelExporter.exportApiKeys(config, apiKeysData)
```

### 配置选项

```javascript
const exportConfig = {
  // 文件格式
  format: 'xlsx',              // 'xlsx' | 'csv'
  
  // 时间范围
  startDate: '2024-01-01',     // YYYY-MM-DD
  endDate: '2024-12-31',       // YYYY-MM-DD
  
  // 导出字段
  fields: [
    'id',           // API Key ID
    'name',         // 名称
    'description',  // 描述
    'createdAt',    // 创建时间
    'lastUsed',     // 最后使用
    'status',       // 状态
    'limit',        // 使用限额
    'totalTokens',  // 总Token数
    'totalCost',    // 总成本
    'requestCount', // 请求次数
    'tags',         // 标签
    'expiresAt'     // 过期时间
  ],
  
  // 高级选项
  includeUsageStats: true,     // 包含使用统计
  includeCostAnalysis: false   // 包含成本分析
}
```

## 数据格式要求

### API Keys 数据结构

```javascript
const apiKey = {
  id: 'cr_xxxxxxxxxx',         // API Key ID
  name: 'My API Key',          // 名称
  description: 'Description',   // 描述
  createdAt: '2024-01-01T00:00:00Z',  // 创建时间 (ISO 8601)
  lastUsed: '2024-01-15T10:30:00Z',   // 最后使用时间
  status: 'active',            // 状态: active | inactive | expired | disabled
  limit: 1000,                 // 使用限额 (-1 表示无限制)
  totalTokens: 50000,          // 总Token数
  totalCost: 10.5,             // 总成本 (USD)
  requestCount: 150,           // 请求次数
  tags: ['production', 'web'],  // 标签数组
  expiresAt: '2024-12-31T23:59:59Z',  // 过期时间
  
  // 可选的使用统计数据
  usageStats: {
    inputTokens: 30000,
    outputTokens: 20000,
    cacheCreateTokens: 1000,
    cacheReadTokens: 500
  },
  
  // 可选的成本分析数据
  costAnalysis: {
    avgCostPerToken: 0.00021,
    efficiency: 85.5
  }
}
```

## 样式定制

### CSS 变量

```css
:root {
  /* 导出按钮颜色 */
  --export-primary: theme('colors.emerald.500');
  --export-primary-hover: theme('colors.emerald.600');
  
  /* 进度条颜色 */
  --export-progress: theme('colors.blue.500');
  --export-progress-bg: theme('colors.blue.200');
}

.dark {
  --export-progress-bg: theme('colors.blue.800');
}
```

### 自定义样式

```css
/* 导出按钮样式调整 */
.export-button {
  @apply rounded-lg border-2 border-emerald-200 bg-emerald-50 
         px-4 py-2 text-sm font-medium text-emerald-700 
         transition-all duration-200 hover:border-emerald-300 
         hover:bg-emerald-100 hover:shadow-md;
}

.dark .export-button {
  @apply border-emerald-700 bg-emerald-900/20 text-emerald-300 
         hover:border-emerald-600 hover:bg-emerald-800/30;
}
```

## 依赖安装

### 必需依赖

项目已包含的依赖：
- Vue 3
- Element Plus
- Tailwind CSS
- Day.js

### 可选依赖（增强Excel支持）

```bash
# 安装 SheetJS 库以获得完整 Excel 支持
npm install xlsx
```

安装后更新 `ExcelExporter.js`:

```javascript
// 在文件顶部添加导入
import * as XLSX from 'xlsx'

// 取消注释 exportToExcel 方法中的实现代码
async exportToExcel(data, config) {
  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'API Keys')
  
  // 设置列宽
  const cols = Object.keys(data[0] || {}).map(() => ({ wch: 15 }))
  ws['!cols'] = cols
  
  const filename = this.generateFilename('xlsx')
  XLSX.writeFile(wb, filename)
}
```

## 使用示例

### 基础导出

```vue
<template>
  <div>
    <!-- 导出按钮 -->
    <button @click="openExport" class="export-button">
      <i class="fas fa-download"></i>
      导出数据
    </button>
    
    <!-- 导出模态框 -->
    <ExportApiKeysModal
      v-if="showExport"
      :api-keys="apiKeys"
      @close="showExport = false"
      @export-complete="onExportComplete"
    />
  </div>
</template>

<script setup>
import { ref } from 'vue'
import ExportApiKeysModal from '@/components/apikeys/ExportApiKeysModal.vue'
import { ElMessage } from 'element-plus'

const showExport = ref(false)
const apiKeys = ref([
  {
    id: 'cr_1234567890',
    name: 'Production API',
    createdAt: '2024-01-01T00:00:00Z',
    status: 'active',
    totalTokens: 50000,
    totalCost: 10.5,
    // ... 其他字段
  }
])

const openExport = () => {
  if (apiKeys.value.length === 0) {
    ElMessage.warning('没有可导出的数据')
    return
  }
  showExport.value = true
}

const onExportComplete = () => {
  showExport.value = false
  ElMessage.success('数据导出完成！')
}
</script>
```

### 高级用法

```javascript
// 自定义导出逻辑
import { excelExporter } from '@/utils/ExcelExporter'

const customExport = async () => {
  const config = {
    format: 'xlsx',
    startDate: '2024-01-01',
    endDate: '2024-03-31',
    fields: ['id', 'name', 'totalTokens', 'totalCost'],
    includeUsageStats: true,
    includeCostAnalysis: true
  }
  
  // 过滤数据
  const filteredApiKeys = apiKeys.value.filter(key => 
    key.status === 'active' && key.totalCost > 1.0
  )
  
  try {
    await excelExporter.exportApiKeys(config, filteredApiKeys)
  } catch (error) {
    console.error('导出失败:', error)
  }
}
```

## 故障排除

### 常见问题

1. **导出文件为空**
   - 检查 `api-keys` prop 是否正确传递
   - 确认数据格式符合要求

2. **Excel文件打不开**
   - 确保安装了 `xlsx` 依赖
   - 检查浏览器是否支持文件下载

3. **中文字符乱码**
   - CSV文件已自动添加UTF-8 BOM
   - 使用Excel打开CSV时选择UTF-8编码

4. **进度显示不正常**
   - 检查 `setProgressCallback` 是否正确调用
   - 确认回调函数没有异常

### 调试模式

```javascript
// 启用调试日志
const debug = true

if (debug) {
  excelExporter.setProgressCallback((progress, status) => {
    console.log(`[导出调试] ${progress}% - ${status}`)
  })
}
```

## 浏览器兼容性

- ✅ Chrome 80+
- ✅ Firefox 75+
- ✅ Safari 13+
- ✅ Edge 80+

## 性能优化建议

1. **大数据集处理**
   ```javascript
   // 分批处理大量数据
   const batchSize = 1000
   const batches = []
   for (let i = 0; i < apiKeys.length; i += batchSize) {
     batches.push(apiKeys.slice(i, i + batchSize))
   }
   ```

2. **内存优化**
   ```javascript
   // 及时清理大对象引用
   const exportData = null // 导出完成后清理
   ```

## 未来扩展

- 支持更多文件格式 (PDF, JSON)
- 添加导出模板功能
- 支持自定义字段映射
- 添加导出历史记录
- 支持定时自动导出

## 联系支持

如有问题或建议，请联系开发团队或提交 Issue。