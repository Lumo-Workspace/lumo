/**
 * 优化的状态管理 Hook
 * Optimized state management hooks
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react'

// 优化的 useState Hook
export function useOptimizedState<T>(initialState: T | (() => T)) {
  const [state, setState] = useState(initialState)
  const stateRef = useRef(state)

  // 更新 ref 以保持最新值
  useEffect(() => {
    stateRef.current = state
  }, [state])

  const setOptimizedState = useCallback((newState: T | ((prev: T) => T)) => {
    if (typeof newState === 'function') {
      setState(prev => {
        const nextState = (newState as (prev: T) => T)(prev)
        // 深度比较，避免不必要的更新
        if (JSON.stringify(prev) === JSON.stringify(nextState)) {
          return prev
        }
        return nextState
      })
    } else {
      // 深度比较，避免不必要的更新
      if (JSON.stringify(stateRef.current) === JSON.stringify(newState)) {
        return
      }
      setState(newState)
    }
  }, [])

  return [state, setOptimizedState, stateRef] as const
}

// 对象状态管理 Hook
export function useObjectState<T extends Record<string, any>>(initialState: T) {
  const [state, setState] = useState<T>(initialState)

  const updateState = useCallback((updates: Partial<T>) => {
    setState(prev => {
      const newState = { ...prev, ...updates }
      // 如果没有任何变化，返回原状态
      if (Object.keys(updates).every(key => prev[key] === updates[key])) {
        return prev
      }
      return newState
    })
  }, [])

  const setField = useCallback(<K extends keyof T>(field: K, value: T[K]) => {
    setState(prev => {
      if (prev[field] === value) return prev
      return { ...prev, [field]: value }
    })
  }, [])

  const resetState = useCallback(() => {
    setState(initialState)
  }, [initialState])

  return {
    state,
    updateState,
    setField,
    resetState,
    setState,
  }
}

// 数组状态管理 Hook
export function useArrayState<T>(initialArray: T[] = []) {
  const [array, setArray] = useState<T[]>(initialArray)

  const add = useCallback((item: T) => {
    setArray(prev => [...prev, item])
  }, [])

  const remove = useCallback((index: number) => {
    setArray(prev => prev.filter((_, i) => i !== index))
  }, [])

  const update = useCallback((index: number, item: T) => {
    setArray(prev =>
      prev.map((existingItem, i) => (i === index ? item : existingItem))
    )
  }, [])

  const insert = useCallback((index: number, item: T) => {
    setArray(prev => {
      const newArray = [...prev]
      newArray.splice(index, 0, item)
      return newArray
    })
  }, [])

  const move = useCallback((fromIndex: number, toIndex: number) => {
    setArray(prev => {
      const newArray = [...prev]
      const item = newArray.splice(fromIndex, 1)[0]
      if (item !== undefined) {
        newArray.splice(toIndex, 0, item)
      }
      return newArray
    })
  }, [])

  const clear = useCallback(() => {
    setArray([])
  }, [])

  const reset = useCallback(() => {
    setArray(initialArray)
  }, [initialArray])

  // 计算属性
  const length = useMemo(() => array.length, [array.length])
  const isEmpty = useMemo(() => array.length === 0, [array.length])

  return {
    array,
    add,
    remove,
    update,
    insert,
    move,
    clear,
    reset,
    setArray,
    length,
    isEmpty,
  }
}

// 表单状态管理 Hook
export function useFormState<T extends Record<string, any>>(
  initialData: T,
  validationSchema?: Record<keyof T, (value: any) => string | null>
) {
  const [data, setData] = useState<T>(initialData)
  const [errors, setErrors] = useState<Record<keyof T, string>>(
    {} as Record<keyof T, string>
  )
  const [touched, setTouched] = useState<Record<keyof T, boolean>>(
    {} as Record<keyof T, boolean>
  )
  const [isSubmitting, setIsSubmitting] = useState(false)

  const setField = useCallback(
    <K extends keyof T>(field: K, value: T[K]) => {
      setData(prev => ({ ...prev, [field]: value }))

      // 清除该字段的错误
      if (errors[field]) {
        setErrors(prev => ({ ...prev, [field]: '' }))
      }
    },
    [errors]
  )

  const setFieldTouched = useCallback(
    <K extends keyof T>(field: K, isTouched = true) => {
      setTouched(prev => ({ ...prev, [field]: isTouched }))

      // 如果字段被触摸且有验证规则，立即验证
      if (isTouched && validationSchema?.[field]) {
        const error = validationSchema[field](data[field])
        setErrors(prev => ({ ...prev, [field]: error || '' }))
      }
    },
    [data, validationSchema]
  )

  const validateField = useCallback(
    <K extends keyof T>(field: K): string | null => {
      if (!validationSchema?.[field]) return null
      return validationSchema[field](data[field])
    },
    [data, validationSchema]
  )

  const validateForm = useCallback((): boolean => {
    if (!validationSchema) return true

    const newErrors = {} as Record<keyof T, string>
    let isValid = true

    for (const field in validationSchema) {
      const error = validationSchema[field](data[field])
      if (error) {
        newErrors[field] = error
        isValid = false
      }
    }

    setErrors(newErrors)
    return isValid
  }, [data, validationSchema])

  const resetForm = useCallback(() => {
    setData(initialData)
    setErrors({} as Record<keyof T, string>)
    setTouched({} as Record<keyof T, boolean>)
    setIsSubmitting(false)
  }, [initialData])

  const submitForm = useCallback(
    async (onSubmit: (data: T) => Promise<void> | void) => {
      setIsSubmitting(true)
      try {
        const isValid = validateForm()
        if (isValid) {
          await onSubmit(data)
        }
      } finally {
        setIsSubmitting(false)
      }
    },
    [data, validateForm]
  )

  // 计算属性
  const isValid = useMemo(() => {
    if (!validationSchema) return true
    return Object.values(errors).every(error => !error)
  }, [errors, validationSchema])

  const isDirty = useMemo(() => {
    return JSON.stringify(data) !== JSON.stringify(initialData)
  }, [data, initialData])

  return {
    data,
    errors,
    touched,
    isSubmitting,
    isValid,
    isDirty,
    setField,
    setFieldTouched,
    validateField,
    validateForm,
    resetForm,
    submitForm,
    setData,
  }
}

// 异步状态管理 Hook
export function useAsyncState<T>(
  asyncFunction: () => Promise<T>,
  initialData?: T
) {
  const [data, setData] = useState<T | undefined>(initialData)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const execute = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const result = await asyncFunction()
      setData(result)
      return result
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error')
      setError(error)
      throw error
    } finally {
      setLoading(false)
    }
  }, [asyncFunction])

  const reset = useCallback(() => {
    setData(initialData)
    setError(null)
    setLoading(false)
  }, [initialData])

  return {
    data,
    loading,
    error,
    execute,
    reset,
  }
}

// 缓存状态管理 Hook
export function useCachedState<T>(
  key: string,
  initialValue: T,
  ttl: number = 5 * 60 * 1000 // 5 minutes
) {
  const [state, setState] = useState<T>(() => {
    if (typeof window === 'undefined') return initialValue

    try {
      const cached = localStorage.getItem(key)
      if (cached) {
        const { value, timestamp } = JSON.parse(cached)
        if (Date.now() - timestamp < ttl) {
          return value
        }
      }
    } catch (error) {
      console.warn('Failed to load cached state:', error)
    }

    return initialValue
  })

  const setCachedState = useCallback(
    (newValue: T) => {
      setState(newValue)

      if (typeof window !== 'undefined') {
        try {
          const cacheData = {
            value: newValue,
            timestamp: Date.now(),
          }
          localStorage.setItem(key, JSON.stringify(cacheData))
        } catch (error) {
          console.warn('Failed to cache state:', error)
        }
      }
    },
    [key]
  )

  const clearCache = useCallback(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem(key)
      } catch (error) {
        console.warn('Failed to clear cache:', error)
      }
    }
    setState(initialValue)
  }, [key, initialValue])

  return [state, setCachedState, clearCache] as const
}

// 防抖状态管理 Hook
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

// 节流状态管理 Hook
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
