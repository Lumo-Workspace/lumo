/**
 * React 19 Optimized Hooks
 * Enhanced with React 19 features and performance optimizations
 */

import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useTransition,
  useDeferredValue,
} from 'react'

// Enhanced useState with React 19 optimizations
export function useOptimizedState<T>(initialState: T | (() => T)) {
  const [state, setState] = useState(initialState)
  const stateRef = useRef(state)

  // Update ref to maintain latest value
  useEffect(() => {
    stateRef.current = state
  }, [state])

  const setOptimizedState = useCallback((newState: T | ((prev: T) => T)) => {
    if (typeof newState === 'function') {
      setState(prev => {
        const nextState = (newState as (prev: T) => T)(prev)
        // Shallow comparison for better performance
        if (Object.is(prev, nextState)) {
          return prev
        }
        return nextState
      })
    } else {
      // Shallow comparison for better performance
      if (Object.is(stateRef.current, newState)) {
        return
      }
      setState(newState)
    }
  }, [])

  return [state, setOptimizedState, stateRef] as const
}

// Object state management with React 19 optimizations
export function useObjectState<T extends Record<string, any>>(initialState: T) {
  const [state, setState] = useState<T>(initialState)

  const updateState = useCallback((updates: Partial<T>) => {
    setState(prev => {
      const newState = { ...prev, ...updates }
      // Check if any values actually changed
      const hasChanges = Object.keys(updates).some(
        key => !Object.is(prev[key], updates[key])
      )
      return hasChanges ? newState : prev
    })
  }, [])

  const resetState = useCallback(() => {
    setState(initialState)
  }, [initialState])

  return [state, updateState, resetState] as const
}

// Array state management with React 19 optimizations
export function useArrayState<T>(initialArray: T[] = []) {
  const [array, setArray] = useState<T[]>(initialArray)

  const addItem = useCallback((item: T) => {
    setArray(prev => [...prev, item])
  }, [])

  const removeItem = useCallback((index: number) => {
    setArray(prev => prev.filter((_, i) => i !== index))
  }, [])

  const updateItem = useCallback((index: number, item: T) => {
    setArray(prev => {
      if (index < 0 || index >= prev.length) return prev
      const newArray = [...prev]
      newArray[index] = item
      return newArray
    })
  }, [])

  const moveItem = useCallback((fromIndex: number, toIndex: number) => {
    setArray(prev => {
      if (
        fromIndex < 0 ||
        fromIndex >= prev.length ||
        toIndex < 0 ||
        toIndex >= prev.length
      ) {
        return prev
      }
      const newArray = [...prev]
      const item = newArray.splice(fromIndex, 1)[0]
      if (item !== undefined) {
        newArray.splice(toIndex, 0, item)
      }
      return newArray
    })
  }, [])

  const clearArray = useCallback(() => {
    setArray([])
  }, [])

  return [
    array,
    { addItem, removeItem, updateItem, moveItem, clearArray },
  ] as const
}

// Debounced state with React 19 optimizations
export function useDebouncedState<T>(initialValue: T, delay: number = 300) {
  const [state, setState] = useState<T>(initialValue)
  const [debouncedState, setDebouncedState] = useState<T>(initialValue)
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)

  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    timeoutRef.current = setTimeout(() => {
      setDebouncedState(state)
    }, delay)

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [state, delay])

  return [state, setState, debouncedState] as const
}

// Throttled state with React 19 optimizations
export function useThrottledState<T>(initialValue: T, limit: number = 1000) {
  const [state, setState] = useState<T>(initialValue)
  const [throttledState, setThrottledState] = useState<T>(initialValue)
  const lastRun = useRef<number>(Date.now())

  useEffect(() => {
    if (Date.now() - lastRun.current >= limit) {
      setThrottledState(state)
      lastRun.current = Date.now()
      return undefined
    } else {
      const timer = setTimeout(
        () => {
          setThrottledState(state)
          lastRun.current = Date.now()
        },
        limit - (Date.now() - lastRun.current)
      )

      return () => clearTimeout(timer)
    }
  }, [state, limit])

  return [state, setState, throttledState] as const
}

// React 19 useTransition integration
export function useOptimizedTransition() {
  const [isPending, startTransition] = useTransition()

  const updateState = useCallback(
    <T>(updater: () => T) => {
      startTransition(() => {
        updater()
      })
    },
    [startTransition]
  )

  return [isPending, updateState] as const
}

// React 19 useDeferredValue integration
export function useDeferredState<T>(value: T) {
  const deferredValue = useDeferredValue(value)
  const [isPending] = useTransition()

  return [deferredValue, isPending] as const
}

// Enhanced performance measurement hook
export function usePerformanceMeasure(label: string) {
  const startTimeRef = useRef<number | undefined>(undefined)
  const endTimeRef = useRef<number | undefined>(undefined)

  const start = useCallback(() => {
    startTimeRef.current = performance.now()
  }, [])

  const end = useCallback(() => {
    if (startTimeRef.current) {
      endTimeRef.current = performance.now()
      const duration = endTimeRef.current - startTimeRef.current

      // Use React 19's improved console logging
      if (process.env.NODE_ENV === 'development') {
        console.log(`${label}: ${duration.toFixed(2)}ms`)
      }

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

  return { start, end, measure } as const
}

// React 19 optimized mount time hook
export function useMountTime() {
  const mountTimeRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    mountTimeRef.current = performance.now()
  }, [])

  const getMountTime = useCallback(() => {
    return mountTimeRef.current
  }, [])

  return getMountTime
}

// React 19 optimized intersection observer hook
export function useInfiniteScroll(
  onLoadMore: () => void,
  hasNextPage: boolean = true,
  threshold: number = 100
) {
  const [isIntersecting, setIsIntersecting] = useState(false)
  const observerRef = useRef<IntersectionObserver | undefined>(undefined)

  const lastElementRef = useCallback(
    (node: HTMLElement | null) => {
      if (observerRef.current) {
        observerRef.current.disconnect()
      }

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

      if (node) {
        observerRef.current.observe(node)
      }
    },
    [onLoadMore, hasNextPage, threshold]
  )

  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect()
      }
    }
  }, [])

  return [lastElementRef, isIntersecting] as const
}

// React 19 optimized batch updates hook
export function useBatchUpdates<T>() {
  const batchRef = useRef<T[]>([])
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)

  const addUpdate = useCallback((update: T) => {
    batchRef.current.push(update)

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    timeoutRef.current = setTimeout(() => {
      const updates = [...batchRef.current]
      batchRef.current = []
      // Process updates here
      console.log('Processing batch updates:', updates)
    }, 16) // ~60fps
  }, [])

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  return addUpdate
}

// React 19 optimized cache hook
export function createWeakCache<K extends object, V>() {
  const cache = new WeakMap<K, V>()

  return {
    get: (key: K): V | undefined => cache.get(key),
    set: (key: K, value: V): void => {
      cache.set(key, value)
    },
    has: (key: K): boolean => cache.has(key),
    delete: (key: K): boolean => cache.delete(key),
  }
}

// React 19 optimized LRU cache hook
export function createLRUCache<K, V>(maxSize: number = 100) {
  const cache = new Map<K, V>()

  return {
    get: (key: K): V | undefined => {
      const value = cache.get(key)
      if (value !== undefined) {
        // Move to end (most recently used)
        cache.delete(key)
        cache.set(key, value)
      }
      return value
    },
    set: (key: K, value: V): void => {
      if (cache.has(key)) {
        cache.delete(key)
      } else if (cache.size >= maxSize) {
        // Remove least recently used (first item)
        const firstKey = cache.keys().next().value
        if (firstKey !== undefined) {
          cache.delete(firstKey)
        }
      }
      cache.set(key, value)
    },
    has: (key: K): boolean => cache.has(key),
    delete: (key: K): boolean => cache.delete(key),
    clear: (): void => cache.clear(),
    size: (): number => cache.size,
  }
}

// React 19 optimized metrics hook
export function usePerformanceMetrics() {
  const [metrics, setMetrics] = useState<Record<string, number>>({})

  useEffect(() => {
    const updateMetrics = () => {
      const newMetrics: Record<string, number> = {}

      // Navigation timing
      if (typeof window !== 'undefined' && window.performance) {
        const navigation = window.performance.getEntriesByType(
          'navigation'
        )[0] as PerformanceNavigationTiming
        if (navigation) {
          newMetrics.domContentLoaded =
            navigation.domContentLoadedEventEnd -
            navigation.domContentLoadedEventStart
          newMetrics.loadComplete =
            navigation.loadEventEnd - navigation.loadEventStart
        }

        // Paint timing
        const paintEntries = window.performance.getEntriesByType(
          'paint'
        ) as PerformancePaintTiming[]
        paintEntries.forEach(entry => {
          newMetrics[entry.name] = entry.startTime
        })

        // Memory info (if available)
        const memory = (window.performance as any).memory
        if (memory) {
          newMetrics.usedJSHeapSize = memory.usedJSHeapSize
          newMetrics.totalJSHeapSize = memory.totalJSHeapSize
        }
      }

      setMetrics(newMetrics)
    }

    updateMetrics()
    const interval = setInterval(updateMetrics, 5000)

    return () => clearInterval(interval)
  }, [])

  return metrics
}
