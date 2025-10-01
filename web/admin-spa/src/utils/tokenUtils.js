const toNumber = (value) => {
  if (value === undefined || value === null || value === '') {
    return 0
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * 归一化 token 统计结构，兼容旧版下划线命名及新版驼峰命名。
 * 返回对象同时包含两种命名方式，便于前端组件渐进迁移。
 *
 * @param {Record<string, any>} rawTokenDetails 原始 token 统计
 * @returns {{
 *  totalTokens: number,
 *  inputTokens: number,
 *  outputTokens: number,
 *  cacheCreateTokens: number,
 *  cacheReadTokens: number,
 *  total_tokens: number,
 *  input_tokens: number,
 *  output_tokens: number,
 *  cache_creation_input_tokens: number,
 *  cache_read_input_tokens: number
 * }}
 */
export const normalizeTokenDetails = (rawTokenDetails = {}) => {
  if (!rawTokenDetails || typeof rawTokenDetails !== 'object') {
    return {
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreateTokens: 0,
      cacheReadTokens: 0,
      total_tokens: 0,
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0
    }
  }

  const input = toNumber(
    rawTokenDetails.inputTokens ?? rawTokenDetails.input_tokens ?? rawTokenDetails.promptTokens ?? rawTokenDetails.prompt_tokens
  )
  const output = toNumber(
    rawTokenDetails.outputTokens ?? rawTokenDetails.output_tokens ?? rawTokenDetails.completionTokens ?? rawTokenDetails.completion_tokens
  )
  const cacheCreate = toNumber(
    rawTokenDetails.cacheCreateTokens ??
      rawTokenDetails.cache_creation_input_tokens ??
      rawTokenDetails.cacheCreate ??
      rawTokenDetails.cache_create_tokens
  )
  const cacheRead = toNumber(
    rawTokenDetails.cacheReadTokens ??
      rawTokenDetails.cache_read_input_tokens ??
      rawTokenDetails.cacheRead ??
      rawTokenDetails.cache_read_tokens
  )

  let total = toNumber(
    rawTokenDetails.totalTokens ??
      rawTokenDetails.total_tokens ??
      rawTokenDetails.total ??
      rawTokenDetails.tokens
  )

  if (!total) {
    total = input + output + cacheCreate + cacheRead
  }

  const normalized = {
    ...rawTokenDetails,
    totalTokens: total,
    inputTokens: input,
    outputTokens: output,
    cacheCreateTokens: cacheCreate,
    cacheReadTokens: cacheRead,
    total_tokens: total,
    input_tokens: input,
    output_tokens: output,
    cache_creation_input_tokens: cacheCreate,
    cache_read_input_tokens: cacheRead
  }

  return normalized
}
