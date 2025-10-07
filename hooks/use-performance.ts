/**
 * 性能优化相关的 Hooks
 * Performance optimization related hooks
 */

import { useCallback, useMemo, useRef, useEffect, useState } from 'react'

// 性能测量 Hook
export function usePerformanceMeasure(label: string) {
  const startTimeRef = useRef<number>()
  const endTimeRef = useRef<number>()

  const start = useCallback(() => {
    startTimeRef.current = performance.now()
  }, [])

  const end = useCallback(() => {
    if (startTimeRef.current) {
      endTimeRef.current = performance.now()
      const duration = endTimeRef.current - startTimeRef.current
      console.log(`${label}: ${duration.toFixed(2)}ms`)
      return duration
    }
    return 0
  }, [label])

  const measure = useCallback(
    <T>(fn: () => T): T => {
      start()
      const result = fn()
      end()
      return result
    },
    [start, end]
  )

  const measureAsync = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T> => {
      start()
      try {
        const result = await fn()
        end()
        return result
      } catch (error) {
        end()
        throw error
      }
    },
    [start, end]
  )

  return {
    start,
    end,
    measure,
    measureAsync,
  }
}

// 渲染计数 Hook
export function useRenderCount(componentName?: string) {
  const renderCountRef = useRef(0)
  renderCountRef.current += 1

  useEffect(() => {
    if (componentName) {
      console.log(`${componentName} rendered ${renderCountRef.current} times`)
    }
  })

  return renderCountRef.current
}

// 组件挂载时间 Hook
export function useMountTime() {
  const mountTimeRef = useRef<number>()

  useEffect(() => {
    mountTimeRef.current = performance.now()
  }, [])

  return mountTimeRef.current
}

// 内存使用监控 Hook
export function useMemoryUsage() {
  const [memoryUsage, setMemoryUsage] = useState<{
    used: number
    total: number
    percentage: number
  } | null>(null)

  const updateMemoryUsage = useCallback(() => {
    if ('memory' in performance) {
      const memory = (performance as any).memory
      setMemoryUsage({
        used: memory.usedJSHeapSize,
        total: memory.totalJSHeapSize,
        percentage: (memory.usedJSHeapSize / memory.totalJSHeapSize) * 100,
      })
    }
  }, [])

  useEffect(() => {
    const interval = setInterval(updateMemoryUsage, 1000)
    return () => clearInterval(interval)
  }, [updateMemoryUsage])

  return memoryUsage
}

// 网络状态监控 Hook
export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [connectionType, setConnectionType] = useState<string>('unknown')

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    // 获取连接类型
    if ('connection' in navigator) {
      const connection = (navigator as any).connection
      setConnectionType(connection.effectiveType || 'unknown')

      const handleConnectionChange = () => {
        setConnectionType(connection.effectiveType || 'unknown')
      }

      connection.addEventListener('change', handleConnectionChange)

      return () => {
        window.removeEventListener('online', handleOnline)
        window.removeEventListener('offline', handleOffline)
        connection.removeEventListener('change', handleConnectionChange)
      }
    }

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return {
    isOnline,
    connectionType,
  }
}

// 虚拟滚动 Hook
export function useVirtualScroll<T>(
  items: T[],
  itemHeight: number,
  containerHeight: number,
  overscan: number = 5
) {
  const [scrollTop, setScrollTop] = useState(0)

  const visibleRange = useMemo(() => {
    const startIndex = Math.floor(scrollTop / itemHeight)
    const endIndex = Math.min(
      startIndex + Math.ceil(containerHeight / itemHeight),
      items.length - 1
    )

    return {
      startIndex: Math.max(0, startIndex - overscan),
      endIndex: Math.min(items.length - 1, endIndex + overscan),
    }
  }, [scrollTop, itemHeight, containerHeight, items.length, overscan])

  const visibleItems = useMemo(() => {
    return items.slice(visibleRange.startIndex, visibleRange.endIndex + 1)
  }, [items, visibleRange])

  const totalHeight = items.length * itemHeight
  const offsetY = visibleRange.startIndex * itemHeight

  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop)
  }, [])

  return {
    visibleItems,
    totalHeight,
    offsetY,
    handleScroll,
    visibleRange,
  }
}

// 无限滚动 Hook
export function useInfiniteScroll(
  hasNextPage: boolean,
  isLoading: boolean,
  onLoadMore: () => void,
  threshold: number = 100
) {
  const [isIntersecting, setIsIntersecting] = useState(false)
  const observerRef = useRef<IntersectionObserver>()

  const lastElementRef = useCallback(
    (node: HTMLElement | null) => {
      if (isLoading) return
      if (observerRef.current) observerRef.current.disconnect()

      observerRef.current = new IntersectionObserver(
        entries => {
          if (entries[0] && entries[0].isIntersecting && hasNextPage) {
            setIsIntersecting(true)
            onLoadMore()
          }
        },
        {
          rootMargin: `${threshold}px`,
        }
      )

      if (node) observerRef.current.observe(node)
    },
    [isLoading, hasNextPage, onLoadMore, threshold]
  )

  return {
    lastElementRef,
    isIntersecting,
  }
}

// 懒加载 Hook
export function useLazyLoad<T>(
  loadFunction: () => Promise<T>,
  dependencies: any[] = []
) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const loadedRef = useRef(false)

  const load = useCallback(async () => {
    if (loadedRef.current || loading) return

    setLoading(true)
    setError(null)

    try {
      const result = await loadFunction()
      setData(result)
      loadedRef.current = true
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
    } finally {
      setLoading(false)
    }
  }, [loadFunction, loading])

  // 重置加载状态
  const reset = useCallback(() => {
    loadedRef.current = false
    setData(null)
    setError(null)
    setLoading(false)
  }, [])

  // 当依赖项变化时重置
  useEffect(() => {
    reset()
  }, dependencies)

  return {
    data,
    loading,
    error,
    load,
    reset,
    isLoaded: loadedRef.current,
  }
}

// 缓存 Hook
export function useCache<T>(
  key: string,
  fetchFunction: () => Promise<T>,
  ttl: number = 5 * 60 * 1000 // 5 minutes
) {
  const cacheRef = useRef<Map<string, { data: T; timestamp: number }>>(
    new Map()
  )
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const getCachedData = useCallback(() => {
    const cached = cacheRef.current.get(key)
    if (cached && Date.now() - cached.timestamp < ttl) {
      return cached.data
    }
    return null
  }, [key, ttl])

  const fetchData = useCallback(async () => {
    // 先检查缓存
    const cached = getCachedData()
    if (cached) {
      setData(cached)
      return cached
    }

    setLoading(true)
    setError(null)

    try {
      const result = await fetchFunction()

      // 缓存结果
      cacheRef.current.set(key, {
        data: result,
        timestamp: Date.now(),
      })

      setData(result)
      return result
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error')
      setError(error)
      throw error
    } finally {
      setLoading(false)
    }
  }, [key, fetchFunction, getCachedData])

  const clearCache = useCallback(() => {
    cacheRef.current.delete(key)
    setData(null)
  }, [key])

  const clearAllCache = useCallback(() => {
    cacheRef.current.clear()
    setData(null)
  }, [])

  return {
    data,
    loading,
    error,
    fetchData,
    clearCache,
    clearAllCache,
    isCached: !!getCachedData(),
  }
}

// 批量更新 Hook
export function useBatchUpdate<T>(
  updateFunction: (updates: T[]) => void,
  batchSize: number = 10,
  delay: number = 100
) {
  const batchRef = useRef<T[]>([])
  const timeoutRef = useRef<NodeJS.Timeout>()

  const addUpdate = useCallback(
    (update: T) => {
      batchRef.current.push(update)

      if (batchRef.current.length >= batchSize) {
        flushUpdates()
      } else {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
        }
        timeoutRef.current = setTimeout(flushUpdates, delay)
      }
    },
    [batchSize, delay]
  )

  const flushUpdates = useCallback(() => {
    if (batchRef.current.length > 0) {
      updateFunction([...batchRef.current])
      batchRef.current = []
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
  }, [updateFunction])

  const clearBatch = useCallback(() => {
    batchRef.current = []
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
  }, [])

  // 组件卸载时刷新批次
  useEffect(() => {
    return () => {
      flushUpdates()
    }
  }, [flushUpdates])

  return {
    addUpdate,
    flushUpdates,
    clearBatch,
  }
}
