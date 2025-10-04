/**
 * 性能优化工具函数
 */

// ==================== 防抖和节流 ====================

export const performanceUtils = {
  /**
   * 防抖函数
   */
  debounce: <T extends (...args: any[]) => any>(
    func: T,
    delay: number
  ): ((...args: Parameters<T>) => void) => {
    let timeoutId: NodeJS.Timeout | null = null

    return (...args: Parameters<T>) => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      timeoutId = setTimeout(() => func(...args), delay)
    }
  },

  /**
   * 节流函数
   */
  throttle: <T extends (...args: any[]) => any>(
    func: T,
    delay: number
  ): ((...args: Parameters<T>) => void) => {
    let lastCall = 0
    let timeoutId: NodeJS.Timeout | null = null

    return (...args: Parameters<T>) => {
      const now = Date.now()
      
      if (now - lastCall >= delay) {
        lastCall = now
        func(...args)
      } else {
        if (timeoutId) {
          clearTimeout(timeoutId)
        }
        timeoutId = setTimeout(() => {
          lastCall = Date.now()
          func(...args)
        }, delay - (now - lastCall))
      }
    }
  },

  /**
   * 请求动画帧节流
   */
  rafThrottle: <T extends (...args: any[]) => any>(
    func: T
  ): ((...args: Parameters<T>) => void) => {
    let rafId: number | null = null

    return (...args: Parameters<T>) => {
      if (rafId) {
        cancelAnimationFrame(rafId)
      }
      rafId = requestAnimationFrame(() => func(...args))
    }
  },
}

// ==================== 懒加载 ====================

export const lazyLoadUtils = {
  /**
   * 创建Intersection Observer
   */
  createObserver: (
    callback: (entries: IntersectionObserverEntry[]) => void,
    options?: IntersectionObserverInit
  ): IntersectionObserver => {
    const defaultOptions: IntersectionObserverInit = {
      root: null,
      rootMargin: '50px',
      threshold: 0.1,
      ...options,
    }

    return new IntersectionObserver(callback, defaultOptions)
  },

  /**
   * 图片懒加载
   */
  lazyLoadImages: (selector = 'img[data-src]'): void => {
    const images = document.querySelectorAll<HTMLImageElement>(selector)
    
    if (!images.length) return

    const imageObserver = lazyLoadUtils.createObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const img = entry.target as HTMLImageElement
          const src = img.dataset.src
          
          if (src) {
            img.src = src
            img.removeAttribute('data-src')
            imageObserver.unobserve(img)
          }
        }
      })
    })

    images.forEach((img) => imageObserver.observe(img))
  },

  /**
   * 组件懒加载
   */
  lazyLoadComponents: (selector = '[data-lazy-component]'): void => {
    const components = document.querySelectorAll(selector)
    
    if (!components.length) return

    const componentObserver = lazyLoadUtils.createObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const component = entry.target as HTMLElement
          const componentName = component.dataset.lazyComponent
          
          if (componentName) {
            // 这里可以动态导入组件
            componentObserver.unobserve(component)
          }
        }
      })
    })

    components.forEach((component) => componentObserver.observe(component))
  },
}

// ==================== 虚拟滚动 ====================

export const virtualScrollUtils = {
  /**
   * 计算可见项目
   */
  calculateVisibleItems: (
    containerHeight: number,
    itemHeight: number,
    scrollTop: number,
    totalItems: number,
    overscan = 5
  ) => {
    const visibleCount = Math.ceil(containerHeight / itemHeight)
    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan)
    const endIndex = Math.min(totalItems - 1, startIndex + visibleCount + overscan * 2)

    return {
      startIndex,
      endIndex,
      visibleItems: endIndex - startIndex + 1,
    }
  },

  /**
   * 计算总高度
   */
  calculateTotalHeight: (totalItems: number, itemHeight: number): number => {
    return totalItems * itemHeight
  },

  /**
   * 计算偏移量
   */
  calculateOffset: (startIndex: number, itemHeight: number): number => {
    return startIndex * itemHeight
  },
}

// ==================== 内存管理 ====================

export const memoryUtils = {
  /**
   * 弱引用缓存
   */
  createWeakCache: <K extends object, V>() => {
    const cache = new WeakMap<K, V>()
    
    return {
      get: (key: K): V | undefined => cache.get(key),
      set: (key: K, value: V): void => cache.set(key, value),
      has: (key: K): boolean => cache.has(key),
      delete: (key: K): boolean => cache.delete(key),
    }
  },

  /**
   * LRU缓存
   */
  createLRUCache: <K, V>(maxSize: number = 100) => {
    const cache = new Map<K, V>()
    
    return {
      get: (key: K): V | undefined => {
        if (cache.has(key)) {
          const value = cache.get(key)!
          cache.delete(key)
          cache.set(key, value)
          return value
        }
        return undefined
      },
      
      set: (key: K, value: V): void => {
        if (cache.has(key)) {
          cache.delete(key)
        } else if (cache.size >= maxSize) {
          const firstKey = cache.keys().next().value
          cache.delete(firstKey)
        }
        cache.set(key, value)
      },
      
      has: (key: K): boolean => cache.has(key),
      delete: (key: K): boolean => cache.delete(key),
      clear: (): void => cache.clear(),
      size: (): number => cache.size,
    }
  },

  /**
   * 清理定时器
   */
  clearTimers: (timers: Set<NodeJS.Timeout | number>): void => {
    timers.forEach((timer) => {
      clearTimeout(timer)
      clearInterval(timer)
    })
    timers.clear()
  },

  /**
   * 清理事件监听器
   */
  clearEventListeners: (listeners: Array<{
    element: Element
    event: string
    handler: EventListener
  }>): void => {
    listeners.forEach(({ element, event, handler }) => {
      element.removeEventListener(event, handler)
    })
    listeners.length = 0
  },
}

// ==================== 批量操作 ====================

export const batchUtils = {
  /**
   * 批量DOM操作
   */
  batchDOMUpdates: (updates: (() => void)[]): void => {
    // 使用DocumentFragment减少重排
    const fragment = document.createDocumentFragment()
    
    // 批量执行更新
    updates.forEach(update => update())
  },

  /**
   * 批量状态更新
   */
  batchStateUpdates: <T>(
    updates: Array<(prevState: T) => T>,
    initialState: T
  ): T => {
    return updates.reduce((state, update) => update(state), initialState)
  },

  /**
   * 批量API请求
   */
  batchAPIRequests: async <T>(
    requests: Array<() => Promise<T>>,
    batchSize: number = 5
  ): Promise<T[]> => {
    const results: T[] = []
    
    for (let i = 0; i < requests.length; i += batchSize) {
      const batch = requests.slice(i, i + batchSize)
      const batchResults = await Promise.all(batch.map(request => request()))
      results.push(...batchResults)
    }
    
    return results
  },
}

// ==================== 性能监控 ====================

export const performanceMonitor = {
  /**
   * 测量函数执行时间
   */
  measure: <T extends (...args: any[]) => any>(
    func: T,
    name?: string
  ): T => {
    return ((...args: Parameters<T>) => {
      const start = performance.now()
      const result = func(...args)
      const end = performance.now()
      
      if (name) {
        console.log(`${name} took ${end - start} milliseconds`)
      }
      
      return result
    }) as T
  },

  /**
   * 测量异步函数执行时间
   */
  measureAsync: <T extends (...args: any[]) => Promise<any>>(
    func: T,
    name?: string
  ): T => {
    return (async (...args: Parameters<T>) => {
      const start = performance.now()
      const result = await func(...args)
      const end = performance.now()
      
      if (name) {
        console.log(`${name} took ${end - start} milliseconds`)
      }
      
      return result
    }) as T
  },

  /**
   * 获取性能指标
   */
  getMetrics: (): {
    memory?: PerformanceMemory
    navigation?: PerformanceNavigationTiming
    paint?: PerformancePaintTiming[]
  } => {
    const metrics: any = {}
    
    // 内存使用情况
    if ('memory' in performance) {
      metrics.memory = (performance as any).memory
    }
    
    // 导航时间
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
    if (navigation) {
      metrics.navigation = navigation
    }
    
    // 绘制时间
    const paint = performance.getEntriesByType('paint') as PerformancePaintTiming[]
    if (paint.length > 0) {
      metrics.paint = paint
    }
    
    return metrics
  },

  /**
   * 监听长任务
   */
  observeLongTasks: (callback: (entries: PerformanceEntry[]) => void): void => {
    if ('PerformanceObserver' in window) {
      try {
        const observer = new PerformanceObserver((list) => {
          const entries = list.getEntries()
          callback(entries)
        })
        
        observer.observe({ entryTypes: ['longtask'] })
      } catch (error) {
        console.warn('Long task observer not supported:', error)
      }
    }
  },
}

// ==================== 导出所有工具 ====================

export {
  performanceUtils as debounce,
  performanceUtils as throttle,
  lazyLoadUtils as lazyLoad,
  virtualScrollUtils as virtualScroll,
  memoryUtils as memory,
  batchUtils as batch,
  performanceMonitor as monitor,
}
