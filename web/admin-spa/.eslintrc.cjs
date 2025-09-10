/* eslint-env node */
module.exports = {
  root: true,
  extends: [
    'plugin:vue/vue3-essential',
    'eslint:recommended',
    '@vue/eslint-config-prettier/skip-formatting'
  ],
  parserOptions: {
    ecmaVersion: 'latest'
  },
  rules: {
    // 将未使用变量错误降级为警告，避免阻塞构建
    'no-unused-vars': 'warn',
    'vue/no-unused-vars': 'warn',
    // 完全禁用console检查，避免构建阻塞
    'no-console': 'off',
    // Vue属性顺序问题降级为警告  
    'vue/attributes-order': 'warn',
    // 禁用未定义变量检查，避免Node.js环境变量问题
    'no-undef': 'off'
  }
}
