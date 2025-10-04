/**
 * DOM操作工具函数
 */

// ==================== 元素查询 ====================

export const domUtils = {
  /**
   * 查询元素
   */
  query: <T extends Element>(selector: string): T | null => {
    return document.querySelector<T>(selector)
  },

  /**
   * 查询所有元素
   */
  queryAll: <T extends Element>(selector: string): NodeListOf<T> => {
    return document.querySelectorAll<T>(selector)
  },

  /**
   * 根据ID获取元素
   */
  getById: <T extends Element>(id: string): T | null => {
    return document.getElementById(id) as T | null
  },

  /**
   * 根据类名获取元素
   */
  getByClass: <T extends Element>(className: string): NodeListOf<T> => {
    return document.getElementsByClassName(className) as NodeListOf<T>
  },

  /**
   * 根据标签名获取元素
   */
  getByTag: <T extends Element>(tagName: string): NodeListOf<T> => {
    return document.getElementsByTagName(tagName) as NodeListOf<T>
  },

  /**
   * 创建元素
   */
  create: <T extends keyof HTMLElementTagNameMap>(
    tagName: T,
    attributes?: Record<string, string>,
    content?: string
  ): HTMLElementTagNameMap[T] => {
    const element = document.createElement(tagName)
    
    if (attributes) {
      Object.entries(attributes).forEach(([key, value]) => {
        element.setAttribute(key, value)
      })
    }

    if (content) {
      element.textContent = content
    }

    return element
  },
}

// ==================== 样式操作 ====================

export const styleUtils = {
  /**
   * 获取元素样式
   */
  getStyle: (element: Element, property: string): string => {
    const computedStyle = window.getComputedStyle(element)
    return computedStyle.getPropertyValue(property)
  },

  /**
   * 设置元素样式
   */
  setStyle: (element: HTMLElement, property: string, value: string): void => {
    element.style.setProperty(property, value)
  },

  /**
   * 批量设置样式
   */
  setStyles: (element: HTMLElement, styles: Record<string, string>): void => {
    Object.entries(styles).forEach(([property, value]) => {
      element.style.setProperty(property, value)
    })
  },

  /**
   * 添加类名
   */
  addClass: (element: Element, className: string): void => {
    element.classList.add(className)
  },

  /**
   * 移除类名
   */
  removeClass: (element: Element, className: string): void => {
    element.classList.remove(className)
  },

  /**
   * 切换类名
   */
  toggleClass: (element: Element, className: string): boolean => {
    return element.classList.toggle(className)
  },

  /**
   * 检查是否有类名
   */
  hasClass: (element: Element, className: string): boolean => {
    return element.classList.contains(className)
  },

  /**
   * 替换类名
   */
  replaceClass: (element: Element, oldClass: string, newClass: string): void => {
    element.classList.replace(oldClass, newClass)
  },
}

// ==================== 事件操作 ====================

export const eventUtils = {
  /**
   * 添加事件监听器
   */
  on: <K extends keyof HTMLElementEventMap>(
    element: Element,
    event: K,
    handler: (event: HTMLElementEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions
  ): void => {
    element.addEventListener(event, handler as EventListener, options)
  },

  /**
   * 移除事件监听器
   */
  off: <K extends keyof HTMLElementEventMap>(
    element: Element,
    event: K,
    handler: (event: HTMLElementEventMap[K]) => void,
    options?: boolean | EventListenerOptions
  ): void => {
    element.removeEventListener(event, handler as EventListener, options)
  },

  /**
   * 添加一次性事件监听器
   */
  once: <K extends keyof HTMLElementEventMap>(
    element: Element,
    event: K,
    handler: (event: HTMLElementEventMap[K]) => void
  ): void => {
    element.addEventListener(event, handler as EventListener, { once: true })
  },

  /**
   * 触发事件
   */
  trigger: (element: Element, eventType: string, detail?: any): void => {
    const event = new CustomEvent(eventType, { detail })
    element.dispatchEvent(event)
  },

  /**
   * 阻止事件默认行为
   */
  preventDefault: (event: Event): void => {
    event.preventDefault()
  },

  /**
   * 阻止事件冒泡
   */
  stopPropagation: (event: Event): void => {
    event.stopPropagation()
  },

  /**
   * 阻止事件默认行为和冒泡
   */
  stopEvent: (event: Event): void => {
    event.preventDefault()
    event.stopPropagation()
  },
}

// ==================== 位置和尺寸 ====================

export const positionUtils = {
  /**
   * 获取元素位置
   */
  getPosition: (element: Element): { x: number; y: number } => {
    const rect = element.getBoundingClientRect()
    return {
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
    }
  },

  /**
   * 获取元素尺寸
   */
  getSize: (element: Element): { width: number; height: number } => {
    const rect = element.getBoundingClientRect()
    return {
      width: rect.width,
      height: rect.height,
    }
  },

  /**
   * 获取视口尺寸
   */
  getViewportSize: (): { width: number; height: number } => {
    return {
      width: window.innerWidth,
      height: window.innerHeight,
    }
  },

  /**
   * 检查元素是否在视口中
   */
  isInViewport: (element: Element): boolean => {
    const rect = element.getBoundingClientRect()
    const viewport = positionUtils.getViewportSize()
    
    return (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= viewport.height &&
      rect.right <= viewport.width
    )
  },

  /**
   * 滚动到元素
   */
  scrollTo: (element: Element, options?: ScrollIntoViewOptions): void => {
    element.scrollIntoView(options)
  },

  /**
   * 平滑滚动到顶部
   */
  scrollToTop: (options?: ScrollToOptions): void => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
      ...options,
    })
  },

  /**
   * 平滑滚动到底部
   */
  scrollToBottom: (options?: ScrollToOptions): void => {
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: 'smooth',
      ...options,
    })
  },
}

// ==================== 动画工具 ====================

export const animationUtils = {
  /**
   * 淡入动画
   */
  fadeIn: (element: HTMLElement, duration = 300): Promise<void> => {
    return new Promise((resolve) => {
      element.style.opacity = '0'
      element.style.display = 'block'
      
      const start = performance.now()
      
      const animate = (timestamp: number) => {
        const elapsed = timestamp - start
        const progress = Math.min(elapsed / duration, 1)
        
        element.style.opacity = String(progress)
        
        if (progress < 1) {
          requestAnimationFrame(animate)
        } else {
          resolve()
        }
      }
      
      requestAnimationFrame(animate)
    })
  },

  /**
   * 淡出动画
   */
  fadeOut: (element: HTMLElement, duration = 300): Promise<void> => {
    return new Promise((resolve) => {
      const start = performance.now()
      
      const animate = (timestamp: number) => {
        const elapsed = timestamp - start
        const progress = Math.min(elapsed / duration, 1)
        
        element.style.opacity = String(1 - progress)
        
        if (progress < 1) {
          requestAnimationFrame(animate)
        } else {
          element.style.display = 'none'
          resolve()
        }
      }
      
      requestAnimationFrame(animate)
    })
  },

  /**
   * 滑动显示动画
   */
  slideDown: (element: HTMLElement, duration = 300): Promise<void> => {
    return new Promise((resolve) => {
      element.style.height = '0'
      element.style.overflow = 'hidden'
      element.style.display = 'block'
      
      const targetHeight = element.scrollHeight
      const start = performance.now()
      
      const animate = (timestamp: number) => {
        const elapsed = timestamp - start
        const progress = Math.min(elapsed / duration, 1)
        
        element.style.height = `${targetHeight * progress}px`
        
        if (progress < 1) {
          requestAnimationFrame(animate)
        } else {
          element.style.height = ''
          element.style.overflow = ''
          resolve()
        }
      }
      
      requestAnimationFrame(animate)
    })
  },

  /**
   * 滑动隐藏动画
   */
  slideUp: (element: HTMLElement, duration = 300): Promise<void> => {
    return new Promise((resolve) => {
      const startHeight = element.offsetHeight
      element.style.height = `${startHeight}px`
      element.style.overflow = 'hidden'
      
      const start = performance.now()
      
      const animate = (timestamp: number) => {
        const elapsed = timestamp - start
        const progress = Math.min(elapsed / duration, 1)
        
        element.style.height = `${startHeight * (1 - progress)}px`
        
        if (progress < 1) {
          requestAnimationFrame(animate)
        } else {
          element.style.height = ''
          element.style.overflow = ''
          element.style.display = 'none'
          resolve()
        }
      }
      
      requestAnimationFrame(animate)
    })
  },
}

// ==================== 表单工具 ====================

export const formUtils = {
  /**
   * 获取表单数据
   */
  getFormData: (form: HTMLFormElement): Record<string, any> => {
    const formData = new FormData(form)
    const data: Record<string, any> = {}
    
    for (const [key, value] of formData.entries()) {
      data[key] = value
    }
    
    return data
  },

  /**
   * 设置表单数据
   */
  setFormData: (form: HTMLFormElement, data: Record<string, any>): void => {
    Object.entries(data).forEach(([key, value]) => {
      const element = form.querySelector(`[name="${key}"]`) as HTMLInputElement
      if (element) {
        if (element.type === 'checkbox') {
          element.checked = Boolean(value)
        } else if (element.type === 'radio') {
          element.checked = element.value === value
        } else {
          element.value = String(value)
        }
      }
    })
  },

  /**
   * 重置表单
   */
  resetForm: (form: HTMLFormElement): void => {
    form.reset()
  },

  /**
   * 验证表单
   */
  validateForm: (form: HTMLFormElement): boolean => {
    return form.checkValidity()
  },

  /**
   * 获取表单验证错误
   */
  getFormErrors: (form: HTMLFormElement): Record<string, string> => {
    const errors: Record<string, string> = {}
    const elements = form.querySelectorAll('input, select, textarea')
    
    elements.forEach((element) => {
      const input = element as HTMLInputElement
      if (!input.checkValidity()) {
        errors[input.name] = input.validationMessage
      }
    })
    
    return errors
  },
}

// ==================== 导出所有工具 ====================

export {
  domUtils as $,
  styleUtils as styles,
  eventUtils as events,
  positionUtils as position,
  animationUtils as animation,
  formUtils as form,
}
