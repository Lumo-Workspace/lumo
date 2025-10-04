/**
 * API相关工具函数
 */

import type { ApiRequest, ApiResponse, ApiError } from '@/types/api'

// ==================== API请求工具 ====================

export const apiUtils = {
  /**
   * 发送API请求
   */
  request: async <T = unknown>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> => {
    try {
      const response = await fetch(endpoint, {
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        ...options,
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()
      return {
        success: true,
        data,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  },

  /**
   * GET请求
   */
  get: async <T = unknown>(
    endpoint: string,
    params?: Record<string, unknown>
  ): Promise<ApiResponse<T>> => {
    const url = params ? `${endpoint}?${new URLSearchParams(params as Record<string, string>)}` : endpoint
    return apiUtils.request<T>(url, { method: 'GET' })
  },

  /**
   * POST请求
   */
  post: async <T = unknown>(
    endpoint: string,
    data?: unknown
  ): Promise<ApiResponse<T>> => {
    return apiUtils.request<T>(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    })
  },

  /**
   * PUT请求
   */
  put: async <T = unknown>(
    endpoint: string,
    data?: unknown
  ): Promise<ApiResponse<T>> => {
    return apiUtils.request<T>(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    })
  },

  /**
   * DELETE请求
   */
  delete: async <T = unknown>(endpoint: string): Promise<ApiResponse<T>> => {
    return apiUtils.request<T>(endpoint, { method: 'DELETE' })
  },

  /**
   * 带重试的请求
   */
  requestWithRetry: async <T = unknown>(
    endpoint: string,
    options: RequestInit = {},
    maxRetries = 3,
    delay = 1000
  ): Promise<ApiResponse<T>> => {
    let lastError: Error | null = null

    for (let i = 0; i < maxRetries; i++) {
      try {
        const result = await apiUtils.request<T>(endpoint, options)
        if (result.success) {
          return result
        }
        lastError = new Error(result.error || 'Request failed')
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error')
      }

      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)))
      }
    }

    return {
      success: false,
      error: lastError?.message || 'Request failed after retries',
    }
  },

  /**
   * 并行请求
   */
  parallel: async <T extends unknown[]>(
    requests: Array<() => Promise<ApiResponse<T[number]>>>
  ): Promise<ApiResponse<T>> => {
    try {
      const results = await Promise.all(requests.map(request => request()))
      
      // 检查是否有失败的请求
      const failedRequest = results.find(result => !result.success)
      if (failedRequest) {
        return {
          success: false,
          error: failedRequest.error || 'One or more requests failed',
        }
      }

      return {
        success: true,
        data: results.map(result => result.data) as T,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Parallel requests failed',
      }
    }
  },
}

// ==================== 请求拦截器 ====================

export class ApiInterceptor {
  private requestInterceptors: Array<(config: ApiRequest) => ApiRequest> = []
  private responseInterceptors: Array<(response: ApiResponse) => ApiResponse> = []
  private errorInterceptors: Array<(error: ApiError) => ApiError> = []

  /**
   * 添加请求拦截器
   */
  addRequestInterceptor(interceptor: (config: ApiRequest) => ApiRequest): void {
    this.requestInterceptors.push(interceptor)
  }

  /**
   * 添加响应拦截器
   */
  addResponseInterceptor(interceptor: (response: ApiResponse) => ApiResponse): void {
    this.responseInterceptors.push(interceptor)
  }

  /**
   * 添加错误拦截器
   */
  addErrorInterceptor(interceptor: (error: ApiError) => ApiError): void {
    this.errorInterceptors.push(interceptor)
  }

  /**
   * 移除请求拦截器
   */
  removeRequestInterceptor(interceptor: (config: ApiRequest) => ApiRequest): void {
    const index = this.requestInterceptors.indexOf(interceptor)
    if (index > -1) {
      this.requestInterceptors.splice(index, 1)
    }
  }

  /**
   * 移除响应拦截器
   */
  removeResponseInterceptor(interceptor: (response: ApiResponse) => ApiResponse): void {
    const index = this.responseInterceptors.indexOf(interceptor)
    if (index > -1) {
      this.responseInterceptors.splice(index, 1)
    }
  }

  /**
   * 移除错误拦截器
   */
  removeErrorInterceptor(interceptor: (error: ApiError) => ApiError): void {
    const index = this.errorInterceptors.indexOf(interceptor)
    if (index > -1) {
      this.errorInterceptors.splice(index, 1)
    }
  }

  /**
   * 应用请求拦截器
   */
  applyRequestInterceptors(config: ApiRequest): ApiRequest {
    return this.requestInterceptors.reduce((acc, interceptor) => interceptor(acc), config)
  }

  /**
   * 应用响应拦截器
   */
  applyResponseInterceptors(response: ApiResponse): ApiResponse {
    return this.responseInterceptors.reduce((acc, interceptor) => interceptor(acc), response)
  }

  /**
   * 应用错误拦截器
   */
  applyErrorInterceptors(error: ApiError): ApiError {
    return this.errorInterceptors.reduce((acc, interceptor) => interceptor(acc), error)
  }
}

// ==================== 缓存工具 ====================

export class ApiCache {
  private cache = new Map<string, { data: any; timestamp: number; ttl: number }>()

  /**
   * 设置缓存
   */
  set<T>(key: string, data: T, ttl: number = 300000): void { // 默认5分钟
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    })
  }

  /**
   * 获取缓存
   */
  get<T>(key: string): T | null {
    const item = this.cache.get(key)
    if (!item) return null

    if (Date.now() - item.timestamp > item.ttl) {
      this.cache.delete(key)
      return null
    }

    return item.data
  }

  /**
   * 删除缓存
   */
  delete(key: string): void {
    this.cache.delete(key)
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * 生成缓存键
   */
  generateKey(endpoint: string, params?: Record<string, unknown>): string {
    const paramStr = params ? JSON.stringify(params) : ''
    return `${endpoint}:${paramStr}`
  }
}

// ==================== 上传工具 ====================

export const uploadUtils = {
  /**
   * 上传文件
   */
  upload: async (
    file: File,
    endpoint: string,
    onProgress?: (progress: number) => void
  ): Promise<ApiResponse<{ url: string; fileId: string }>> => {
    return new Promise((resolve) => {
      const formData = new FormData()
      formData.append('file', file)

      const xhr = new XMLHttpRequest()

      // 监听上传进度
      if (onProgress) {
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            const progress = (event.loaded / event.total) * 100
            onProgress(progress)
          }
        })
      }

      // 监听上传完成
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText)
            resolve({
              success: true,
              data: response,
            })
          } catch (error) {
            resolve({
              success: false,
              error: 'Failed to parse response',
            })
          }
        } else {
          resolve({
            success: false,
            error: `Upload failed with status ${xhr.status}`,
          })
        }
      })

      // 监听上传错误
      xhr.addEventListener('error', () => {
        resolve({
          success: false,
          error: 'Upload failed',
        })
      })

      xhr.open('POST', endpoint)
      xhr.send(formData)
    })
  },

  /**
   * 批量上传文件
   */
  uploadMultiple: async (
    files: File[],
    endpoint: string,
    onProgress?: (progress: number) => void
  ): Promise<ApiResponse<Array<{ url: string; fileId: string }>>> => {
    const results: Array<{ url: string; fileId: string }> = []
    let completed = 0

    const uploadPromises = files.map(async (file, index) => {
      const result = await uploadUtils.upload(file, endpoint, (progress) => {
        if (onProgress) {
          const totalProgress = ((completed + progress / 100) / files.length) * 100
          onProgress(totalProgress)
        }
      })

      completed++
      
      if (result.success && result.data) {
        results[index] = result.data
      }

      return result
    })

    const uploadResults = await Promise.all(uploadPromises)
    const hasError = uploadResults.some(result => !result.success)

    if (hasError) {
      return {
        success: false,
        error: 'One or more files failed to upload',
      }
    }

    return {
      success: true,
      data: results,
    }
  },

  /**
   * 验证文件
   */
  validateFile: (file: File, maxSize: number, allowedTypes: string[]): string | null => {
    if (file.size > maxSize) {
      return `文件大小不能超过 ${Math.round(maxSize / 1024 / 1024)}MB`
    }

    if (!allowedTypes.includes(file.type)) {
      return `不支持的文件类型: ${file.type}`
    }

    return null
  },
}

// ==================== 导出 ====================

export const apiInterceptor = new ApiInterceptor()
export const apiCache = new ApiCache()
