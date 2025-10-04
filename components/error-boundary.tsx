"use client"

import React, { Component, ErrorInfo, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { RefreshCw, Bug, Home, AlertTriangle } from 'lucide-react'
import type { ID } from '@/types'

// ==================== 错误边界状态 ====================

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
  errorId: ID
  retryCount: number
}

// ==================== 错误边界属性 ====================

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
  onError?: (error: Error, errorInfo: ErrorInfo) => void
  resetOnPropsChange?: boolean
  resetKeys?: Array<string | number>
  showDetails?: boolean
  enableReporting?: boolean
}

// ==================== 错误报告接口 ====================

interface ErrorReport {
  id: ID
  message: string
  stack?: string
  componentStack?: string
  timestamp: string
  userAgent: string
  url: string
  userId?: string
  sessionId?: string
  retryCount: number
}

// ==================== 错误边界组件 ====================

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private resetTimeoutId: NodeJS.Timeout | null = null

  constructor(props: ErrorBoundaryProps) {
    super(props)
    
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: this.generateErrorId(),
      retryCount: 0,
    }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
      errorId: ErrorBoundary.generateErrorId(),
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const { onError, enableReporting = true } = this.props

    // 更新状态
    this.setState({
      error,
      errorInfo,
    })

    // 调用错误处理回调
    if (onError) {
      onError(error, errorInfo)
    }

    // 发送错误报告
    if (enableReporting) {
      this.reportError(error, errorInfo)
    }

    // 记录错误到控制台
    console.error('ErrorBoundary caught an error:', error, errorInfo)
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    const { resetOnPropsChange, resetKeys } = this.props
    const { hasError } = this.state

    // 如果启用了属性变化重置，并且属性发生变化
    if (resetOnPropsChange && hasError && this.shouldReset(prevProps)) {
      this.resetError()
    }
  }

  componentWillUnmount() {
    if (this.resetTimeoutId) {
      clearTimeout(this.resetTimeoutId)
    }
  }

  // ==================== 私有方法 ====================

  private static generateErrorId(): ID {
    return `error_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
  }

  private generateErrorId(): ID {
    return ErrorBoundary.generateErrorId()
  }

  private shouldReset(prevProps: ErrorBoundaryProps): boolean {
    const { resetKeys } = this.props
    
    if (!resetKeys) return true

    return resetKeys.some((key, index) => {
      const prevKey = prevProps.resetKeys?.[index]
      return prevKey !== key
    })
  }

  private async reportError(error: Error, errorInfo: ErrorInfo): Promise<void> {
    try {
      const report: ErrorReport = {
        id: this.state.errorId,
        message: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        url: window.location.href,
        userId: this.getCurrentUserId(),
        sessionId: this.getSessionId(),
        retryCount: this.state.retryCount,
      }

      // 这里可以发送到错误监控服务
      await this.sendErrorReport(report)
    } catch (reportError) {
      console.error('Failed to report error:', reportError)
    }
  }

  private async sendErrorReport(report: ErrorReport): Promise<void> {
    // 模拟发送错误报告
    // 在实际应用中，这里会发送到错误监控服务（如 Sentry, Bugsnag 等）
    console.log('Error report:', report)
    
    // 示例：发送到API
    // await fetch('/api/errors', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify(report),
    // })
  }

  private getCurrentUserId(): string | undefined {
    // 从localStorage或其他地方获取用户ID
    try {
      const user = localStorage.getItem('user')
      return user ? JSON.parse(user).id : undefined
    } catch {
      return undefined
    }
  }

  private getSessionId(): string | undefined {
    // 从sessionStorage获取会话ID
    try {
      return sessionStorage.getItem('sessionId') || undefined
    } catch {
      return undefined
    }
  }

  private resetError = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: this.generateErrorId(),
      retryCount: this.state.retryCount + 1,
    })
  }

  private handleRetry = (): void => {
    this.resetError()
  }

  private handleGoHome = (): void => {
    window.location.href = '/'
  }

  private handleReload = (): void => {
    window.location.reload()
  }

  // ==================== 渲染方法 ====================

  render() {
    const { hasError, error, errorInfo, retryCount } = this.state
    const { children, fallback, showDetails = false } = this.props

    if (hasError) {
      // 如果有自定义fallback，使用它
      if (fallback) {
        return fallback
      }

      // 否则渲染默认错误界面
      return this.renderErrorUI(error, errorInfo, retryCount, showDetails)
    }

    return children
  }

  private renderErrorUI(
    error: Error | null,
    errorInfo: ErrorInfo | null,
    retryCount: number,
    showDetails: boolean
  ): ReactNode {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-2xl">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/20">
              <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
            </div>
            <CardTitle className="text-xl font-semibold text-foreground">
              哎呀！出现了错误
            </CardTitle>
            <p className="text-muted-foreground">
              抱歉，应用程序遇到了一个意外错误。我们已经记录了这个问题，并会尽快修复。
            </p>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* 错误信息 */}
            <Alert>
              <Bug className="h-4 w-4" />
              <AlertDescription>
                <strong>错误ID:</strong> {this.state.errorId}
              </AlertDescription>
            </Alert>

            {/* 重试计数 */}
            {retryCount > 0 && (
              <div className="flex items-center justify-center">
                <Badge variant="secondary">
                  重试次数: {retryCount}
                </Badge>
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button onClick={this.handleRetry} className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4" />
                重试
              </Button>
              
              <Button 
                variant="outline" 
                onClick={this.handleGoHome}
                className="flex items-center gap-2"
              >
                <Home className="h-4 w-4" />
                返回首页
              </Button>
              
              <Button 
                variant="outline" 
                onClick={this.handleReload}
                className="flex items-center gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                刷新页面
              </Button>
            </div>

            {/* 错误详情 */}
            {showDetails && error && (
              <details className="mt-6">
                <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
                  显示错误详情
                </summary>
                <div className="mt-3 space-y-3">
                  <div className="rounded-md bg-muted p-3">
                    <h4 className="text-sm font-medium mb-2">错误消息:</h4>
                    <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-words">
                      {error.message}
                    </pre>
                  </div>
                  
                  {error.stack && (
                    <div className="rounded-md bg-muted p-3">
                      <h4 className="text-sm font-medium mb-2">错误堆栈:</h4>
                      <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-words">
                        {error.stack}
                      </pre>
                    </div>
                  )}
                  
                  {errorInfo?.componentStack && (
                    <div className="rounded-md bg-muted p-3">
                      <h4 className="text-sm font-medium mb-2">组件堆栈:</h4>
                      <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-words">
                        {errorInfo.componentStack}
                      </pre>
                    </div>
                  )}
                </div>
              </details>
            )}

            {/* 帮助信息 */}
            <div className="text-center text-sm text-muted-foreground">
              <p>
                如果问题持续存在，请联系我们的技术支持团队，
                并提供错误ID: <code className="bg-muted px-1 py-0.5 rounded text-xs">{this.state.errorId}</code>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }
}

// ==================== 高阶组件 ====================

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

// ==================== Hook ====================

export function useErrorHandler() {
  const handleError = (error: Error, errorInfo?: { componentStack?: string }) => {
    console.error('Error caught by useErrorHandler:', error, errorInfo)
    
    // 这里可以添加自定义错误处理逻辑
    // 例如：发送到错误监控服务、显示通知等
  }

  return { handleError }
}

// ==================== 导出 ====================

export default ErrorBoundary
