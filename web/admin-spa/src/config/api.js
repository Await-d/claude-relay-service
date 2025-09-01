// API 配置
import { APP_CONFIG, getLoginUrl } from './app'

// 开发环境使用 /webapi 前缀，生产环境不使用前缀
export const API_PREFIX = APP_CONFIG.apiPrefix

// 创建完整的 API URL
export function createApiUrl(path) {
  // 确保路径以 / 开头
  if (!path.startsWith('/')) {
    path = '/' + path
  }
  return API_PREFIX + path
}

// API 请求的基础配置
export function getRequestConfig(token) {
  const config = {
    headers: {
      'Content-Type': 'application/json'
    }
  }

  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`
  }

  return config
}

// 统一的 API 请求类
class ApiClient {
  constructor() {
    this.baseURL = API_PREFIX
  }

  // 获取认证 token
  getAuthToken() {
    const authToken = localStorage.getItem('authToken')
    return authToken || null
  }

  // 构建请求配置
  buildConfig(options = {}) {
    const config = {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    }

    // 添加认证 token
    const token = this.getAuthToken()
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`
    }

    return config
  }

  // 处理响应
  async handleResponse(response, responseType = 'json') {
    // 401 未授权，需要重新登录
    if (response.status === 401) {
      // 如果当前已经在登录页面，不要再次跳转
      const currentPath = window.location.pathname + window.location.hash
      const isLoginPage = currentPath.includes('/login') || currentPath.endsWith('/')

      if (!isLoginPage) {
        localStorage.removeItem('authToken')
        // 使用统一的登录URL
        window.location.href = getLoginUrl()
      }
      throw new Error('Unauthorized')
    }

    // 如果响应不成功，先处理错误
    if (!response.ok) {
      // 尝试解析错误信息
      const contentType = response.headers.get('content-type')
      if (contentType && contentType.includes('application/json')) {
        try {
          const errorData = await response.json()
          throw new Error(errorData.error || errorData.message || `HTTP ${response.status}`)
        } catch (jsonError) {
          // JSON 解析失败，使用默认错误信息
        }
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    // 根据 responseType 处理成功响应
    if (responseType === 'blob') {
      return {
        data: await response.blob(),
        headers: response.headers,
        status: response.status,
        statusText: response.statusText
      }
    }

    // 尝试解析 JSON
    const contentType = response.headers.get('content-type')
    if (contentType && contentType.includes('application/json')) {
      const data = await response.json()
      return data
    }

    // 其他响应类型
    return response
  }

  // GET 请求
  async get(url, options = {}) {
    let fullUrl = createApiUrl(url)
    const { responseType, params, ...fetchOptions } = options
    // 处理查询参数
    if (params && Object.keys(params).length > 0) {
      const searchParams = new URLSearchParams()
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          searchParams.append(key, value)
        }
      })
      const queryString = searchParams.toString()
      if (queryString) {
        fullUrl += (fullUrl.includes('?') ? '&' : '?') + queryString
      }
    }
    const config = this.buildConfig({
      ...fetchOptions,
      method: 'GET'
    })
    try {
      console.log('🌐 API GET请求:', { fullUrl, params, config })
      const response = await fetch(fullUrl, config)
      return await this.handleResponse(response, responseType)
    } catch (error) {
      console.error('API GET Error:', error)
      throw error
    }
  }

  // POST 请求
  async post(url, data = null, options = {}) {
    const fullUrl = createApiUrl(url)
    const { responseType, ...fetchOptions } = options
    // 处理 FormData - 不要 JSON 序列化，也不要设置 Content-Type
    let body = undefined
    let headers = {}
    if (data) {
      if (data instanceof FormData) {
        body = data
        // FormData 会自动设置正确的 Content-Type (multipart/form-data)
        // 所以我们不设置 Content-Type header
      } else {
        body = JSON.stringify(data)
        headers['Content-Type'] = 'application/json'
      }
    }
    const config = this.buildConfig({
      ...fetchOptions,
      method: 'POST',
      body,
      headers: {
        ...headers,
        ...fetchOptions.headers
      }
    })

    try {
      const response = await fetch(fullUrl, config)
      return await this.handleResponse(response, responseType)
    } catch (error) {
      console.error('API POST Error:', error)
      throw error
    }
  }

  // PUT 请求
  async put(url, data = null, options = {}) {
    const fullUrl = createApiUrl(url)
    const { responseType, ...fetchOptions } = options
    const config = this.buildConfig({
      ...fetchOptions,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined
    })

    try {
      const response = await fetch(fullUrl, config)
      return await this.handleResponse(response, responseType)
    } catch (error) {
      console.error('API PUT Error:', error)
      throw error
    }
  }

  // DELETE 请求
  async delete(url, options = {}) {
    const fullUrl = createApiUrl(url)
    const { data, responseType, ...restOptions } = options

    const config = this.buildConfig({
      ...restOptions,
      method: 'DELETE',
      body: data ? JSON.stringify(data) : undefined
    })

    try {
      const response = await fetch(fullUrl, config)
      return await this.handleResponse(response, responseType)
    } catch (error) {
      console.error('API DELETE Error:', error)
      throw error
    }
  }
}

// 导出单例实例
export const apiClient = new ApiClient()
