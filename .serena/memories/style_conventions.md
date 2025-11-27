# 代码风格与规范
- 语言：Node.js/JS，模块 CommonJS；目标环境 Node 18+。
- ESLint：`eslint:recommended` + `plugin:prettier/recommended`; 关键规则：禁止未使用变量（允许前缀 `_` 忽略）、prefer-const/no-var、eqeqeq、curly 全部使用、no-shadow、prefer-template/object-shorthand、prefer-destructuring、箭头回调优先、no-path-concat；生产环境 debugger 报错；CLI 脚本允许 process.exit。
- Prettier：无分号 `semi: false`，单引号，printWidth 100，tabWidth 2，trailingComma none，LF 换行，箭头参数总带括号，bracketSpacing 开启。
- 日志/控制台：允许 console；使用 winston/日志文件在运行时。
- 测试：Jest（配置自动识别），测试文件 `*.test.js`/`*.spec.js`；Supertest 可用于接口测试。
- 其他：统一 UTF-8，无 BOM；保持文件结尾换行；尽量遵循 KISS/DRY/SOLID 原则，函数职责单一。