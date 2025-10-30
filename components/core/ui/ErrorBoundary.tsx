/**
 * 错误边界组件
 * Error Boundary Component
 */

'use client'

import {
  Component,
  ErrorInfo,
  ReactNode,
  useCallback,
  useState,
  useEffect,
} from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertTriangle, RefreshCw, Bug, Home } from 'lucide-react'

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
  errorId: string | null
}

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
  onError?: (error: Error, errorInfo: ErrorInfo) => void
  resetKeys?: Array<string | number>
  resetOnPropsChange?: boolean
  isolate?: boolean
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  private resetTimeoutId: number | null = null

  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: null,
    }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
      errorId: `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    }
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const { onError } = this.props

    this.setState({
      error,
      errorInfo,
    })

    // 记录错误
    this.logError(error, errorInfo)

    // 调用自定义错误处理函数
    if (onError) {
      onError(error, errorInfo)
    }
  }

  override componentDidUpdate(prevProps: ErrorBoundaryProps) {
    const { resetKeys, resetOnPropsChange } = this.props
    const { hasError } = this.state

    if (hasError && prevProps.resetKeys !== resetKeys) {
      if (resetOnPropsChange && resetKeys) {
        this.resetErrorBoundary()
      }
    }
  }

  override componentWillUnmount() {
    if (this.resetTimeoutId) {
      clearTimeout(this.resetTimeoutId)
    }
  }

  private logError = (error: Error, errorInfo: ErrorInfo) => {
    const { errorId } = this.state

    const errorLog = {
      errorId,
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href,
    }

    // 在开发环境中打印详细错误信息
    if (process.env.NODE_ENV === 'development') {
      console.group('🚨 Error Boundary Caught Error')
      console.error('Error:', error)
      console.error('Error Info:', errorInfo)
      console.error('Error Log:', errorLog)
      console.groupEnd()
    }

    // 在生产环境中发送错误报告
    if (process.env.NODE_ENV === 'production') {
      this.reportError(errorLog)
    }
  }

  private reportError = async (errorLog: any) => {
    try {
      // 这里可以集成错误报告服务，如 Sentry、LogRocket 等
      await fetch('/api/errors', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(errorLog),
      })
    } catch (reportError) {
      // 静默处理错误报告失败
    }
  }

  private resetErrorBoundary = () => {
    if (this.resetTimeoutId) {
      clearTimeout(this.resetTimeoutId)
    }

    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: null,
    })
  }

  private handleRetry = () => {
    this.resetErrorBoundary()
  }

  private handleReload = () => {
    window.location.reload()
  }

  private handleGoHome = () => {
    window.location.href = '/'
  }

  override render() {
    const { hasError, error, errorInfo, errorId } = this.state
    const { children, fallback, isolate } = this.props

    if (hasError) {
      // 如果提供了自定义 fallback，使用它
      if (fallback) {
        return fallback
      }

      // 隔离模式：只显示简单的错误信息
      if (isolate) {
        return (
          <div className='flex items-center justify-center min-h-[200px] p-4'>
            <Alert className='max-w-md'>
              <AlertTriangle className='h-4 w-4' />
              <AlertDescription>
                出现了一个错误。请刷新页面重试。
              </AlertDescription>
            </Alert>
          </div>
        )
      }

      // 完整的错误界面
      return (
        <div className='min-h-screen bg-gray-50 flex items-center justify-center p-4'>
          <Card className='w-full max-w-2xl'>
            <CardHeader className='text-center'>
              <div className='mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100'>
                <Bug className='h-6 w-6 text-red-600' />
              </div>
              <CardTitle className='text-xl font-semibold text-gray-900'>
                出现了意外错误
              </CardTitle>
              <CardDescription>
                很抱歉，应用程序遇到了一个意外错误。我们已经记录了这个问题。
              </CardDescription>
            </CardHeader>

            <CardContent className='space-y-6'>
              {/* 错误信息 */}
              <div className='rounded-lg bg-red-50 p-4'>
                <h3 className='text-sm font-medium text-red-800 mb-2'>
                  错误详情
                </h3>
                <p className='text-sm text-red-700 font-mono'>
                  {error?.message || '未知错误'}
                </p>
                {errorId && (
                  <p className='text-xs text-red-600 mt-2'>
                    错误 ID: {errorId}
                  </p>
                )}
              </div>

              {/* 开发环境显示详细错误信息 */}
              {process.env.NODE_ENV === 'development' && error && (
                <details className='rounded-lg bg-gray-100 p-4'>
                  <summary className='cursor-pointer text-sm font-medium text-gray-700 mb-2'>
                    开发模式：详细错误信息
                  </summary>
                  <div className='space-y-3'>
                    <div>
                      <h4 className='text-xs font-medium text-gray-600 mb-1'>
                        错误堆栈:
                      </h4>
                      <pre className='text-xs text-gray-700 whitespace-pre-wrap bg-white p-2 rounded border overflow-auto max-h-32'>
                        {error.stack}
                      </pre>
                    </div>
                    {errorInfo?.componentStack && (
                      <div>
                        <h4 className='text-xs font-medium text-gray-600 mb-1'>
                          组件堆栈:
                        </h4>
                        <pre className='text-xs text-gray-700 whitespace-pre-wrap bg-white p-2 rounded border overflow-auto max-h-32'>
                          {errorInfo.componentStack}
                        </pre>
                      </div>
                    )}
                  </div>
                </details>
              )}

              {/* 操作按钮 */}
              <div className='flex flex-col sm:flex-row gap-3'>
                <Button
                  onClick={this.handleRetry}
                  className='flex-1'
                  variant='default'
                >
                  <RefreshCw className='h-4 w-4 mr-2' />
                  重试
                </Button>
                <Button
                  onClick={this.handleReload}
                  className='flex-1'
                  variant='outline'
                >
                  刷新页面
                </Button>
                <Button
                  onClick={this.handleGoHome}
                  className='flex-1'
                  variant='ghost'
                >
                  <Home className='h-4 w-4 mr-2' />
                  返回首页
                </Button>
              </div>

              {/* 帮助信息 */}
              <div className='text-center'>
                <p className='text-sm text-gray-500'>
                  如果问题持续存在，请联系技术支持并提供错误 ID。
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )
    }

    return children
  }
}

// 高阶组件：为组件添加错误边界
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  errorBoundaryProps?: Omit<ErrorBoundaryProps, 'children'>
) {
  const WrappedComponent = (props: P) => (
    <ErrorBoundary {...errorBoundaryProps}>
      <Component {...props} />
    </ErrorBoundary>
  )

  WrappedComponent.displayName = `withErrorBoundary(${Component.displayName || Component.name})`

  return WrappedComponent
}

// Hook：用于在函数组件中处理错误
export function useErrorHandler() {
  const [error, setError] = useState<Error | null>(null)

  const resetError = useCallback(() => {
    setError(null)
  }, [])

  const captureError = useCallback((error: Error) => {
    setError(error)
  }, [])

  // 如果有错误，抛出它
  useEffect(() => {
    if (error) {
      throw error
    }
  }, [error])

  return { captureError, resetError }
}

// 异步错误边界 Hook
export function useAsyncError() {
  const [, setError] = useState()

  return useCallback((error: Error) => {
    setError(() => {
      throw error
    })
  }, [])
}

export default ErrorBoundary
