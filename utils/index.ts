/**
 * 通用工具函数
 * 提供项目中常用的工具函数和帮助方法
 */

// ==================== 字符串工具 ====================

export const stringUtils = {
  /**
   * 生成随机ID
   */
  generateId: (prefix = ''): string => {
    const timestamp = Date.now().toString(36)
    const randomStr = Math.random().toString(36).substring(2, 8)
    return prefix ? `${prefix}_${timestamp}_${randomStr}` : `${timestamp}_${randomStr}`
  },

  /**
   * 首字母大写
   */
  capitalize: (str: string): string => {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()
  },

  /**
   * 驼峰命名转横线命名
   */
  kebabCase: (str: string): string => {
    return str.replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, '$1-$2').toLowerCase()
  },

  /**
   * 横线命名转驼峰命名
   */
  camelCase: (str: string): string => {
    return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
  },

  /**
   * 截断字符串
   */
  truncate: (str: string, length: number, suffix = '...'): string => {
    if (str.length <= length) return str
    return str.substring(0, length - suffix.length) + suffix
  },

  /**
   * 移除HTML标签
   */
  stripHtml: (html: string): string => {
    return html.replace(/<[^>]*>/g, '')
  },

  /**
   * 高亮搜索关键词
   */
  highlightText: (text: string, keyword: string, className = 'highlight'): string => {
    if (!keyword) return text
    const regex = new RegExp(`(${keyword})`, 'gi')
    return text.replace(regex, `<span class="${className}">$1</span>`)
  },

  /**
   * 生成slug
   */
  slugify: (str: string): string => {
    return str
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
  },
}

// ==================== 日期工具 ====================

export const dateUtils = {
  /**
   * 格式化日期
   */
  format: (date: Date | string, format = 'YYYY-MM-DD'): string => {
    const d = new Date(date)
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const hours = String(d.getHours()).padStart(2, '0')
    const minutes = String(d.getMinutes()).padStart(2, '0')
    const seconds = String(d.getSeconds()).padStart(2, '0')

    return format
      .replace('YYYY', String(year))
      .replace('MM', month)
      .replace('DD', day)
      .replace('HH', hours)
      .replace('mm', minutes)
      .replace('ss', seconds)
  },

  /**
   * 相对时间
   */
  timeAgo: (date: Date | string): string => {
    const now = new Date()
    const past = new Date(date)
    const diffInSeconds = Math.floor((now.getTime() - past.getTime()) / 1000)

    if (diffInSeconds < 60) return '刚刚'
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}分钟前`
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}小时前`
    if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)}天前`
    if (diffInSeconds < 31536000) return `${Math.floor(diffInSeconds / 2592000)}个月前`
    return `${Math.floor(diffInSeconds / 31536000)}年前`
  },

  /**
   * 检查是否为今天
   */
  isToday: (date: Date | string): boolean => {
    const today = new Date()
    const targetDate = new Date(date)
    return (
      today.getFullYear() === targetDate.getFullYear() &&
      today.getMonth() === targetDate.getMonth() &&
      today.getDate() === targetDate.getDate()
    )
  },

  /**
   * 检查是否为本周
   */
  isThisWeek: (date: Date | string): boolean => {
    const today = new Date()
    const targetDate = new Date(date)
    const startOfWeek = new Date(today.setDate(today.getDate() - today.getDay()))
    const endOfWeek = new Date(today.setDate(today.getDate() - today.getDay() + 6))
    return targetDate >= startOfWeek && targetDate <= endOfWeek
  },

  /**
   * 获取日期范围
   */
  getDateRange: (start: Date | string, end: Date | string): Date[] => {
    const startDate = new Date(start)
    const endDate = new Date(end)
    const dates: Date[] = []

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      dates.push(new Date(d))
    }

    return dates
  },
}

// ==================== 数组工具 ====================

export const arrayUtils = {
  /**
   * 数组去重
   */
  unique: <T>(arr: T[], key?: keyof T): T[] => {
    if (!key) return [...new Set(arr)]
    const seen = new Set()
    return arr.filter(item => {
      const value = item[key]
      if (seen.has(value)) return false
      seen.add(value)
      return true
    })
  },

  /**
   * 数组分组
   */
  groupBy: <T, K extends string | number>(
    arr: T[],
    key: keyof T | ((item: T) => K)
  ): Record<K, T[]> => {
    return arr.reduce((groups, item) => {
      const groupKey = typeof key === 'function' ? key(item) : (item[key] as K)
      if (!groups[groupKey]) groups[groupKey] = []
      groups[groupKey].push(item)
      return groups
    }, {} as Record<K, T[]>)
  },

  /**
   * 数组排序
   */
  sortBy: <T>(arr: T[], key: keyof T, order: 'asc' | 'desc' = 'asc'): T[] => {
    return [...arr].sort((a, b) => {
      const aVal = a[key]
      const bVal = b[key]
      if (aVal < bVal) return order === 'asc' ? -1 : 1
      if (aVal > bVal) return order === 'asc' ? 1 : -1
      return 0
    })
  },

  /**
   * 数组分页
   */
  paginate: <T>(arr: T[], page: number, limit: number): T[] => {
    const startIndex = (page - 1) * limit
    return arr.slice(startIndex, startIndex + limit)
  },

  /**
   * 数组扁平化
   */
  flatten: <T>(arr: (T | T[])[]): T[] => {
    return arr.reduce<T[]>((flat, item) => {
      return flat.concat(Array.isArray(item) ? arrayUtils.flatten(item) : item)
    }, [])
  },

  /**
   * 数组交集
   */
  intersection: <T>(arr1: T[], arr2: T[]): T[] => {
    return arr1.filter(item => arr2.includes(item))
  },

  /**
   * 数组差集
   */
  difference: <T>(arr1: T[], arr2: T[]): T[] => {
    return arr1.filter(item => !arr2.includes(item))
  },
}

// ==================== 对象工具 ====================

export const objectUtils = {
  /**
   * 深度克隆对象
   */
  deepClone: <T>(obj: T): T => {
    if (obj === null || typeof obj !== 'object') return obj
    if (obj instanceof Date) return new Date(obj.getTime()) as unknown as T
    if (obj instanceof Array) return obj.map(item => objectUtils.deepClone(item)) as unknown as T
    if (typeof obj === 'object') {
      const clonedObj = {} as T
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          clonedObj[key] = objectUtils.deepClone(obj[key])
        }
      }
      return clonedObj
    }
    return obj
  },

  /**
   * 深度合并对象
   */
  deepMerge: <T extends Record<string, any>>(target: T, source: Partial<T>): T => {
    const result = { ...target }
    for (const key in source) {
      if (source.hasOwnProperty(key)) {
        if (
          source[key] &&
          typeof source[key] === 'object' &&
          !Array.isArray(source[key]) &&
          result[key] &&
          typeof result[key] === 'object' &&
          !Array.isArray(result[key])
        ) {
          result[key] = objectUtils.deepMerge(result[key], source[key])
        } else {
          result[key] = source[key]
        }
      }
    }
    return result
  },

  /**
   * 获取嵌套属性值
   */
  get: <T>(obj: any, path: string, defaultValue?: T): T | undefined => {
    const keys = path.split('.')
    let result = obj
    for (const key of keys) {
      if (result == null || typeof result !== 'object') return defaultValue
      result = result[key]
    }
    return result !== undefined ? result : defaultValue
  },

  /**
   * 设置嵌套属性值
   */
  set: (obj: any, path: string, value: any): void => {
    const keys = path.split('.')
    let current = obj
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i]
      if (!(key in current) || typeof current[key] !== 'object') {
        current[key] = {}
      }
      current = current[key]
    }
    current[keys[keys.length - 1]] = value
  },

  /**
   * 检查对象是否为空
   */
  isEmpty: (obj: any): boolean => {
    if (obj == null) return true
    if (Array.isArray(obj) || typeof obj === 'string') return obj.length === 0
    if (typeof obj === 'object') return Object.keys(obj).length === 0
    return false
  },

  /**
   * 选择对象的指定属性
   */
  pick: <T, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> => {
    const result = {} as Pick<T, K>
    keys.forEach(key => {
      if (key in obj) {
        result[key] = obj[key]
      }
    })
    return result
  },

  /**
   * 排除对象的指定属性
   */
  omit: <T, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> => {
    const result = { ...obj }
    keys.forEach(key => {
      delete result[key]
    })
    return result
  },
}

// ==================== 验证工具 ====================

export const validationUtils = {
  /**
   * 验证邮箱
   */
  isEmail: (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return emailRegex.test(email)
  },

  /**
   * 验证URL
   */
  isUrl: (url: string): boolean => {
    try {
      new URL(url)
      return true
    } catch {
      return false
    }
  },

  /**
   * 验证手机号
   */
  isPhone: (phone: string): boolean => {
    const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/
    return phoneRegex.test(phone.replace(/\s/g, ''))
  },

  /**
   * 验证密码强度
   */
  isStrongPassword: (password: string): boolean => {
    // 至少8位，包含大小写字母、数字
    const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d@$!%*?&]{8,}$/
    return strongPasswordRegex.test(password)
  },

  /**
   * 验证用户名
   */
  isUsername: (username: string): boolean => {
    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/
    return usernameRegex.test(username)
  },

  /**
   * 验证身份证号
   */
  isIdCard: (idCard: string): boolean => {
    const idCardRegex = /(^\d{15}$)|(^\d{18}$)|(^\d{17}(\d|X|x)$)/
    return idCardRegex.test(idCard)
  },
}

// ==================== 存储工具 ====================

export const storageUtils = {
  /**
   * 设置本地存储
   */
  set: (key: string, value: any): void => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch (error) {
      console.error('Failed to save to localStorage:', error)
    }
  },

  /**
   * 获取本地存储
   */
  get: <T>(key: string, defaultValue?: T): T | null => {
    try {
      const item = localStorage.getItem(key)
      return item ? JSON.parse(item) : defaultValue || null
    } catch (error) {
      console.error('Failed to read from localStorage:', error)
      return defaultValue || null
    }
  },

  /**
   * 删除本地存储
   */
  remove: (key: string): void => {
    try {
      localStorage.removeItem(key)
    } catch (error) {
      console.error('Failed to remove from localStorage:', error)
    }
  },

  /**
   * 清空本地存储
   */
  clear: (): void => {
    try {
      localStorage.clear()
    } catch (error) {
      console.error('Failed to clear localStorage:', error)
    }
  },

  /**
   * 设置会话存储
   */
  setSession: (key: string, value: any): void => {
    try {
      sessionStorage.setItem(key, JSON.stringify(value))
    } catch (error) {
      console.error('Failed to save to sessionStorage:', error)
    }
  },

  /**
   * 获取会话存储
   */
  getSession: <T>(key: string, defaultValue?: T): T | null => {
    try {
      const item = sessionStorage.getItem(key)
      return item ? JSON.parse(item) : defaultValue || null
    } catch (error) {
      console.error('Failed to read from sessionStorage:', error)
      return defaultValue || null
    }
  },
}

// ==================== 格式化工具 ====================

export const formatUtils = {
  /**
   * 格式化文件大小
   */
  formatFileSize: (bytes: number): string => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  },

  /**
   * 格式化数字
   */
  formatNumber: (num: number, decimals = 0): string => {
    return new Intl.NumberFormat('zh-CN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(num)
  },

  /**
   * 格式化货币
   */
  formatCurrency: (amount: number, currency = 'CNY'): string => {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency,
    }).format(amount)
  },

  /**
   * 格式化百分比
   */
  formatPercent: (value: number, decimals = 1): string => {
    return new Intl.NumberFormat('zh-CN', {
      style: 'percent',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value / 100)
  },

  /**
   * 格式化时长
   */
  formatDuration: (seconds: number): string => {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = seconds % 60

    if (hours > 0) {
      return `${hours}小时${minutes}分钟`
    } else if (minutes > 0) {
      return `${minutes}分钟${secs}秒`
    } else {
      return `${secs}秒`
    }
  },
}

// ==================== 导出所有工具 ====================

export * from './api'
export * from './dom'
export * from './performance'
