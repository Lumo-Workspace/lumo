/**
 * API 相关工具函数
 * API related utility functions
 */

// import type { ApiResponse } from '@/types/api'

// 临时定义 ApiResponse 类型
interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

// API 基础配置
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '/api'
const DEFAULT_TIMEOUT = 10000 // 10 seconds

// 创建 API 客户端
class ApiClient {
  private baseURL: string
  private timeout: number
  private defaultHeaders: Record<string, string>

  constructor(baseURL: string = API_BASE_URL, timeout: number = DEFAULT_TIMEOUT) {
    this.baseURL = baseURL
    this.timeout = timeout
    this.defaultHeaders = {
      'Content-Type': 'application/json',
    }
  }

  // 设置认证头
  setAuthToken(token: string): void {
    this.defaultHeaders['Authorization'] = `Bearer ${token}`
  }

  // 移除认证头
  removeAuthToken(): void {
    delete this.defaultHeaders['Authorization']
  }

  // 设置自定义头
  setHeader(key: string, value: string): void {
    this.defaultHeaders[key] = value
  }

  // 移除自定义头
  removeHeader(key: string): void {
    delete this.defaultHeaders[key]
  }

  // 通用请求方法
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseURL}${endpoint}`
    
    const config: RequestInit = {
      ...options,
      headers: {
        ...this.defaultHeaders,
        ...options.headers,
      },
    }

    // 设置超时
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await fetch(url, {
        ...config,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      const data = await response.json()

      if (!response.ok) {
        throw new ApiError({
          code: data.code || 'API_ERROR',
          message: data.message || 'An error occurred',
          details: data.details,
          timestamp: new Date(),
        })
      }

      return {
        success: true,
        data: data.data || data,
        message: data.message,
      }
    } catch (error) {
      clearTimeout(timeoutId)
      
      if (error instanceof ApiError) {
        throw error
      }

      const errorObj = error as Error
      if (errorObj.name === 'AbortError') {
        throw new ApiError({
          code: 'TIMEOUT',
          message: 'Request timeout',
          timestamp: new Date(),
        })
      }

      throw new ApiError({
        code: 'NETWORK_ERROR',
        message: errorObj.message || 'Network error',
        timestamp: new Date(),
      })
    }
  }

  // GET 请求
  async get<T>(endpoint: string, params?: Record<string, any>): Promise<ApiResponse<T>> {
    const url = params ? `${endpoint}?${new URLSearchParams(params).toString()}` : endpoint
    return this.request<T>(url, { method: 'GET' })
  }

  // POST 请求
  async post<T>(endpoint: string, data?: any): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : null,
    })
  }

  // PUT 请求
  async put<T>(endpoint: string, data?: any): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : null,
    })
  }

  // PATCH 请求
  async patch<T>(endpoint: string, data?: any): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'PATCH',
      body: data ? JSON.stringify(data) : null,
    })
  }

  // DELETE 请求
  async delete<T>(endpoint: string): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'DELETE' })
  }

  // 文件上传
  async upload<T>(endpoint: string, file: File, additionalData?: Record<string, any>): Promise<ApiResponse<T>> {
    const formData = new FormData()
    formData.append('file', file)
    
    if (additionalData) {
      Object.entries(additionalData).forEach(([key, value]) => {
        formData.append(key, String(value))
      })
    }

    return this.request<T>(endpoint, {
      method: 'POST',
      body: formData,
      headers: {
        // 不设置 Content-Type，让浏览器自动设置
        ...Object.fromEntries(
          Object.entries(this.defaultHeaders).filter(([key]) => key !== 'Content-Type')
        ),
      },
    })
  }

  // 下载文件
  async download(endpoint: string, filename?: string): Promise<void> {
    const response = await fetch(`${this.baseURL}${endpoint}`, {
      headers: this.defaultHeaders,
    })

    if (!response.ok) {
      throw new Error('Download failed')
    }

    const blob = await response.blob()
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename || 'download'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
  }
}

// 创建默认 API 客户端实例
export const apiClient = new ApiClient()

// API 错误类
export class ApiError extends Error {
  public readonly code: string
  public readonly details?: Record<string, any> | undefined
  public readonly timestamp: Date

  constructor({ code, message, details, timestamp }: {
    code: string
    message: string
    details?: Record<string, any> | undefined
    timestamp: Date
  }) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.details = details
    this.timestamp = timestamp
  }
}

// API 响应处理工具
export function handleApiResponse<T>(response: ApiResponse<T>): T {
  if (!response.success) {
    throw new ApiError({
      code: 'API_ERROR',
      message: response.error || 'Unknown error',
      timestamp: new Date(),
    })
  }

  if (response.data === undefined) {
    throw new ApiError({
      code: 'NO_DATA',
      message: 'No data returned from API',
      timestamp: new Date(),
    })
  }

  return response.data
}

// 请求重试工具
export async function withRetry<T>(
  apiCall: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 1000
): Promise<T> {
  let lastError: Error

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await apiCall()
    } catch (error) {
      lastError = error as Error
      
      // 如果是最后一次尝试或者是非网络错误，直接抛出
      if (attempt === maxRetries || !isRetryableError(error)) {
        throw error
      }

      // 等待后重试
      await new Promise(resolve => setTimeout(resolve, delay * attempt))
    }
  }

  throw lastError!
}

// 判断错误是否可重试
function isRetryableError(error: any): boolean {
  if (error instanceof ApiError) {
    return ['NETWORK_ERROR', 'TIMEOUT', 'SERVER_ERROR'].includes(error.code)
  }
  return false
}

// 请求缓存工具
class RequestCache {
  private cache = new Map<string, { data: any; timestamp: number; ttl: number }>()

  set(key: string, data: any, ttl: number = 5 * 60 * 1000): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    })
  }

  get(key: string): any | null {
    const item = this.cache.get(key)
    if (!item) return null

    if (Date.now() - item.timestamp > item.ttl) {
      this.cache.delete(key)
      return null
    }

    return item.data
  }

  clear(): void {
    this.cache.clear()
  }

  delete(key: string): void {
    this.cache.delete(key)
  }
}

export const requestCache = new RequestCache()

// 带缓存的 API 请求
export async function cachedRequest<T>(
  key: string,
  apiCall: () => Promise<T>,
  ttl?: number
): Promise<T> {
  const cached = requestCache.get(key)
  if (cached) {
    return cached
  }

  const data = await apiCall()
  requestCache.set(key, data, ttl)
  return data
}

// 批量请求工具
export async function batchRequest<T>(
  requests: Array<() => Promise<T>>,
  concurrency: number = 5
): Promise<T[]> {
  const results: T[] = []
  const executing: Promise<void>[] = []

  for (const request of requests) {
    const promise = request().then(result => {
      results.push(result)
    })

    executing.push(promise)

    if (executing.length >= concurrency) {
      await Promise.race(executing)
      executing.splice(executing.findIndex(p => p === promise), 1)
    }
  }

  await Promise.all(executing)
  return results
}

// 请求取消工具
export class RequestCanceller {
  private controllers = new Map<string, AbortController>()

  create(key: string): AbortController {
    // 取消之前的请求
    this.cancel(key)

    const controller = new AbortController()
    this.controllers.set(key, controller)
    return controller
  }

  cancel(key: string): void {
    const controller = this.controllers.get(key)
    if (controller) {
      controller.abort()
      this.controllers.delete(key)
    }
  }

  cancelAll(): void {
    this.controllers.forEach(controller => controller.abort())
    this.controllers.clear()
  }
}

export const requestCanceller = new RequestCanceller()

// 导出 API 客户端实例和工具函数
export { ApiClient }
export default apiClient