/**
 * 错误处理工具函数
 * Error handling utility functions
 */

import { ERROR_CODES } from '@/constants'

// 错误类型定义
export interface AppError extends Error {
  code: string
  statusCode?: number
  details?: any
  timestamp: Date
  context?: string
}

export interface ErrorReport {
  errorId: string
  message: string
  stack?: string
  code: string
  statusCode?: number
  details?: any
  timestamp: Date
  context?: string
  userAgent?: string
  url?: string
  userId?: string
  sessionId?: string
}

// 创建应用错误
export function createAppError(
  message: string,
  code: string = ERROR_CODES.SERVER_ERROR,
  statusCode?: number,
  details?: any,
  context?: string
): AppError {
  const error = new Error(message) as AppError
  error.code = code
  error.statusCode = statusCode
  error.details = details
  error.timestamp = new Date()
  error.context = context
  return error
}

// 错误分类器
export function classifyError(error: any): {
  type: 'network' | 'validation' | 'auth' | 'permission' | 'notFound' | 'server' | 'unknown'
  severity: 'low' | 'medium' | 'high' | 'critical'
  recoverable: boolean
} {
  // 网络错误
  if (error.code === ERROR_CODES.NETWORK_ERROR || error.name === 'NetworkError') {
    return {
      type: 'network',
      severity: 'medium',
      recoverable: true,
    }
  }

  // 验证错误
  if (error.code === ERROR_CODES.VALIDATION_ERROR) {
    return {
      type: 'validation',
      severity: 'low',
      recoverable: true,
    }
  }

  // 认证错误
  if (error.code === ERROR_CODES.AUTHENTICATION_ERROR) {
    return {
      type: 'auth',
      severity: 'high',
      recoverable: true,
    }
  }

  // 权限错误
  if (error.code === ERROR_CODES.AUTHORIZATION_ERROR) {
    return {
      type: 'permission',
      severity: 'high',
      recoverable: false,
    }
  }

  // 未找到错误
  if (error.code === ERROR_CODES.NOT_FOUND) {
    return {
      type: 'notFound',
      severity: 'medium',
      recoverable: false,
    }
  }

  // 服务器错误
  if (error.code === ERROR_CODES.SERVER_ERROR || error.statusCode >= 500) {
    return {
      type: 'server',
      severity: 'critical',
      recoverable: true,
    }
  }

  // 速率限制错误
  if (error.code === ERROR_CODES.RATE_LIMIT) {
    return {
      type: 'server',
      severity: 'medium',
      recoverable: true,
    }
  }

  // 未知错误
  return {
    type: 'unknown',
    severity: 'high',
    recoverable: true,
  }
}

// 错误消息本地化
export function getErrorMessage(error: any, fallback?: string): string {
  const classification = classifyError(error)
  
  // 如果有自定义消息，使用它
  if (error.message && error.message !== 'Unknown error') {
    return error.message
  }

  // 根据错误类型返回本地化消息
  const messages = {
    network: '网络连接失败，请检查您的网络连接后重试',
    validation: '输入的数据格式不正确，请检查后重试',
    auth: '登录已过期，请重新登录',
    permission: '您没有权限执行此操作',
    notFound: '请求的资源不存在',
    server: '服务器暂时不可用，请稍后重试',
    unknown: '发生了未知错误，请稍后重试',
  }

  return messages[classification.type] || fallback || '发生了错误，请稍后重试'
}

// 错误报告生成器
export function generateErrorReport(
  error: any,
  context?: string,
  userId?: string,
  sessionId?: string
): ErrorReport {
  const errorId = `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  
  return {
    errorId,
    message: error.message || 'Unknown error',
    stack: error.stack,
    code: error.code || ERROR_CODES.SERVER_ERROR,
    statusCode: error.statusCode,
    details: error.details,
    timestamp: new Date(),
    context,
    userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : undefined,
    url: typeof window !== 'undefined' ? window.location.href : undefined,
    userId,
    sessionId,
  }
}

// 错误报告发送器
export async function sendErrorReport(report: ErrorReport): Promise<void> {
  try {
    // 在开发环境中打印错误报告
    if (process.env.NODE_ENV === 'development') {
      console.group('🚨 Error Report')
      console.error('Error Report:', report)
      console.groupEnd()
    }

    // 在生产环境中发送到错误收集服务
    if (process.env.NODE_ENV === 'production') {
      await fetch('/api/errors', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(report),
      })
    }
  } catch (sendError) {
    // 静默处理错误报告发送失败
    console.warn('Failed to send error report:', sendError)
  }
}

// 全局错误处理器
export class GlobalErrorHandler {
  private static instance: GlobalErrorHandler
  private errorQueue: ErrorReport[] = []
  private maxQueueSize = 100
  private batchSize = 10
  private flushInterval = 30000 // 30 seconds

  private constructor() {
    this.setupGlobalErrorHandlers()
    this.startBatchProcessor()
  }

  static getInstance(): GlobalErrorHandler {
    if (!GlobalErrorHandler.instance) {
      GlobalErrorHandler.instance = new GlobalErrorHandler()
    }
    return GlobalErrorHandler.instance
  }

  private setupGlobalErrorHandlers(): void {
    // 捕获未处理的 JavaScript 错误
    window.addEventListener('error', (event) => {
      this.handleError(event.error, 'unhandled_error')
    })

    // 捕获未处理的 Promise 拒绝
    window.addEventListener('unhandledrejection', (event) => {
      this.handleError(event.reason, 'unhandled_promise_rejection')
    })

    // 捕获资源加载错误
    window.addEventListener('error', (event) => {
      if (event.target !== window) {
        this.handleError(
          new Error(`Resource loading error: ${(event.target as any).src || (event.target as any).href}`),
          'resource_loading_error'
        )
      }
    }, true)
  }

  private startBatchProcessor(): void {
    setInterval(() => {
      this.flushErrorQueue()
    }, this.flushInterval)
  }

  handleError(error: any, context?: string, userId?: string, sessionId?: string): void {
    const report = generateErrorReport(error, context, userId, sessionId)
    
    // 添加到队列
    this.errorQueue.push(report)
    
    // 如果队列满了，立即处理
    if (this.errorQueue.length >= this.maxQueueSize) {
      this.flushErrorQueue()
    }
  }

  private async flushErrorQueue(): Promise<void> {
    if (this.errorQueue.length === 0) return

    const batch = this.errorQueue.splice(0, this.batchSize)
    
    try {
      await Promise.all(batch.map(report => sendErrorReport(report)))
    } catch (error) {
      // 如果发送失败，将错误重新加入队列（最多重试一次）
      this.errorQueue.unshift(...batch.filter((_, index) => index < this.batchSize / 2))
    }
  }

  // 手动刷新错误队列
  async flush(): Promise<void> {
    await this.flushErrorQueue()
  }

  // 清空错误队列
  clear(): void {
    this.errorQueue = []
  }
}

// 错误重试机制
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries?: number
    delay?: number
    backoff?: 'linear' | 'exponential'
    retryCondition?: (error: any) => boolean
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    delay = 1000,
    backoff = 'exponential',
    retryCondition = (error) => classifyError(error).recoverable
  } = options

  let lastError: any

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error

      // 检查是否应该重试
      if (!retryCondition(error) || attempt === maxRetries) {
        throw error
      }

      // 计算延迟时间
      const currentDelay = backoff === 'exponential' 
        ? delay * Math.pow(2, attempt - 1)
        : delay * attempt

      // 等待后重试
      await new Promise(resolve => setTimeout(resolve, currentDelay))
    }
  }

  throw lastError
}

// 错误边界工具
export function createErrorBoundaryHandler() {
  return (error: Error, errorInfo: any) => {
    const globalHandler = GlobalErrorHandler.getInstance()
    globalHandler.handleError(error, 'error_boundary', undefined, undefined)
  }
}

// 初始化全局错误处理
export function initializeErrorHandling(): void {
  GlobalErrorHandler.getInstance()
}

// 导出所有错误处理工具
export {
  createAppError,
  classifyError,
  getErrorMessage,
  generateErrorReport,
  sendErrorReport,
  GlobalErrorHandler,
  withRetry,
  createErrorBoundaryHandler,
  initializeErrorHandling,
}
