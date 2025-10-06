/**
 * 验证相关工具函数
 * Validation related utility functions
 */

import { VALIDATION } from '@/constants'

// 基础验证规则
export const validators = {
  // 必填验证
  required: (value: any, message = '此字段为必填项'): string | null => {
    if (value === null || value === undefined || value === '') {
      return message
    }
    if (typeof value === 'string' && value.trim().length === 0) {
      return message
    }
    if (Array.isArray(value) && value.length === 0) {
      return message
    }
    return null
  },

  // 邮箱验证
  email: (value: string, message = '请输入有效的邮箱地址'): string | null => {
    if (!value) return null
    return VALIDATION.EMAIL_REGEX.test(value) ? null : message
  },

  // 最小长度验证
  minLength: (value: string, min: number, message?: string): string | null => {
    if (!value) return null
    const msg = message || `最少需要 ${min} 个字符`
    return value.length >= min ? null : msg
  },

  // 最大长度验证
  maxLength: (value: string, max: number, message?: string): string | null => {
    if (!value) return null
    const msg = message || `最多允许 ${max} 个字符`
    return value.length <= max ? null : msg
  },

  // 长度范围验证
  length: (value: string, min: number, max: number, message?: string): string | null => {
    if (!value) return null
    const msg = message || `长度必须在 ${min} 到 ${max} 个字符之间`
    return value.length >= min && value.length <= max ? null : msg
  },

  // 数字验证
  number: (value: any, message = '请输入有效的数字'): string | null => {
    if (value === null || value === undefined || value === '') return null
    const num = Number(value)
    return !isNaN(num) && isFinite(num) ? null : message
  },

  // 最小数值验证
  min: (value: number, min: number, message?: string): string | null => {
    if (value === null || value === undefined) return null
    const msg = message || `数值不能小于 ${min}`
    return value >= min ? null : msg
  },

  // 最大数值验证
  max: (value: number, max: number, message?: string): string | null => {
    if (value === null || value === undefined) return null
    const msg = message || `数值不能大于 ${max}`
    return value <= max ? null : msg
  },

  // 数值范围验证
  range: (value: number, min: number, max: number, message?: string): string | null => {
    if (value === null || value === undefined) return null
    const msg = message || `数值必须在 ${min} 到 ${max} 之间`
    return value >= min && value <= max ? null : msg
  },

  // 正则表达式验证
  pattern: (value: string, regex: RegExp, message = '格式不正确'): string | null => {
    if (!value) return null
    return regex.test(value) ? null : message
  },

  // 自定义验证
  custom: (value: any, validator: (value: any) => boolean | string, message?: string): string | null => {
    const result = validator(value)
    if (typeof result === 'boolean') {
      return result ? null : (message || '验证失败')
    }
    return result
  },

  // 数组最小长度验证
  minItems: (value: any[], min: number, message?: string): string | null => {
    if (!Array.isArray(value)) return null
    const msg = message || `至少需要 ${min} 个项目`
    return value.length >= min ? null : msg
  },

  // 数组最大长度验证
  maxItems: (value: any[], max: number, message?: string): string | null => {
    if (!Array.isArray(value)) return null
    const msg = message || `最多允许 ${max} 个项目`
    return value.length <= max ? null : msg
  },

  // 唯一性验证
  unique: (value: any[], message = '存在重复项'): string | null => {
    if (!Array.isArray(value)) return null
    const unique = new Set(value)
    return unique.size === value.length ? null : message
  },

  // 日期验证
  date: (value: any, message = '请输入有效的日期'): string | null => {
    if (!value) return null
    const date = new Date(value)
    return !isNaN(date.getTime()) ? null : message
  },

  // 未来日期验证
  futureDate: (value: any, message = '日期必须是未来时间'): string | null => {
    if (!value) return null
    const date = new Date(value)
    const now = new Date()
    return date > now ? null : message
  },

  // 过去日期验证
  pastDate: (value: any, message = '日期必须是过去时间'): string | null => {
    if (!value) return null
    const date = new Date(value)
    const now = new Date()
    return date < now ? null : message
  },

  // URL 验证
  url: (value: string, message = '请输入有效的 URL'): string | null => {
    if (!value) return null
    try {
      new URL(value)
      return null
    } catch {
      return message
    }
  },

  // 文件类型验证
  fileType: (file: File, allowedTypes: string[], message?: string): string | null => {
    const msg = message || `文件类型必须是: ${allowedTypes.join(', ')}`
    return allowedTypes.includes(file.type) ? null : msg
  },

  // 文件大小验证
  fileSize: (file: File, maxSize: number, message?: string): string | null => {
    const msg = message || `文件大小不能超过 ${Math.round(maxSize / 1024 / 1024)}MB`
    return file.size <= maxSize ? null : msg
  },
}

// 验证器组合器
export class Validator {
  private rules: Array<(value: any) => string | null> = []

  // 添加验证规则
  add(rule: (value: any) => string | null): Validator {
    this.rules.push(rule)
    return this
  }

  // 必填验证
  required(message?: string): Validator {
    return this.add((value) => validators.required(value, message))
  }

  // 邮箱验证
  email(message?: string): Validator {
    return this.add((value) => validators.email(value, message))
  }

  // 最小长度验证
  minLength(min: number, message?: string): Validator {
    return this.add((value) => validators.minLength(value, min, message))
  }

  // 最大长度验证
  maxLength(max: number, message?: string): Validator {
    return this.add((value) => validators.maxLength(value, max, message))
  }

  // 长度范围验证
  length(min: number, max: number, message?: string): Validator {
    return this.add((value) => validators.length(value, min, max, message))
  }

  // 数字验证
  number(message?: string): Validator {
    return this.add((value) => validators.number(value, message))
  }

  // 最小数值验证
  min(min: number, message?: string): Validator {
    return this.add((value) => validators.min(value, min, message))
  }

  // 最大数值验证
  max(max: number, message?: string): Validator {
    return this.add((value) => validators.max(value, max, message))
  }

  // 数值范围验证
  range(min: number, max: number, message?: string): Validator {
    return this.add((value) => validators.range(value, min, max, message))
  }

  // 正则表达式验证
  pattern(regex: RegExp, message?: string): Validator {
    return this.add((value) => validators.pattern(value, regex, message))
  }

  // 自定义验证
  custom(validator: (value: any) => boolean | string, message?: string): Validator {
    return this.add((value) => validators.custom(value, validator, message))
  }

  // URL 验证
  url(message?: string): Validator {
    return this.add((value) => validators.url(value, message))
  }

  // 日期验证
  date(message?: string): Validator {
    return this.add((value) => validators.date(value, message))
  }

  // 未来日期验证
  futureDate(message?: string): Validator {
    return this.add((value) => validators.futureDate(value, message))
  }

  // 过去日期验证
  pastDate(message?: string): Validator {
    return this.add((value) => validators.pastDate(value, message))
  }

  // 文件类型验证
  fileType(allowedTypes: string[], message?: string): Validator {
    return this.add((value) => validators.fileType(value, allowedTypes, message))
  }

  // 文件大小验证
  fileSize(maxSize: number, message?: string): Validator {
    return this.add((value) => validators.fileSize(value, maxSize, message))
  }

  // 验证值
  validate(value: any): string | null {
    for (const rule of this.rules) {
      const error = rule(value)
      if (error) return error
    }
    return null
  }
}

// 创建验证器实例
export function createValidator(): Validator {
  return new Validator()
}

// 表单验证工具
export interface ValidationResult {
  isValid: boolean
  errors: Record<string, string>
}

export interface ValidationSchema {
  [key: string]: Validator
}

export function validateForm(data: Record<string, any>, schema: ValidationSchema): ValidationResult {
  const errors: Record<string, string> = {}

  for (const [field, validator] of Object.entries(schema)) {
    const error = validator.validate(data[field])
    if (error) {
      errors[field] = error
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  }
}

// 异步验证工具
export interface AsyncValidator {
  (value: any): Promise<string | null>
}

export class AsyncValidatorClass {
  private rules: Array<AsyncValidator> = []

  add(rule: AsyncValidator): AsyncValidatorClass {
    this.rules.push(rule)
    return this
  }

  async validate(value: any): Promise<string | null> {
    for (const rule of this.rules) {
      const error = await rule(value)
      if (error) return error
    }
    return null
  }
}

export function createAsyncValidator(): AsyncValidatorClass {
  return new AsyncValidatorClass()
}

// 常用验证规则
export const commonValidators = {
  // 用户名验证
  username: createValidator()
    .required('用户名不能为空')
    .minLength(VALIDATION.USERNAME_MIN_LENGTH, `用户名至少需要 ${VALIDATION.USERNAME_MIN_LENGTH} 个字符`)
    .maxLength(VALIDATION.USERNAME_MAX_LENGTH, `用户名最多 ${VALIDATION.USERNAME_MAX_LENGTH} 个字符`),

  // 邮箱验证
  email: createValidator()
    .required('邮箱不能为空')
    .email('请输入有效的邮箱地址'),

  // 密码验证
  password: createValidator()
    .required('密码不能为空')
    .minLength(VALIDATION.PASSWORD_MIN_LENGTH, `密码至少需要 ${VALIDATION.PASSWORD_MIN_LENGTH} 个字符`),

  // 标题验证
  title: createValidator()
    .required('标题不能为空')
    .maxLength(VALIDATION.TITLE_MAX_LENGTH, `标题最多 ${VALIDATION.TITLE_MAX_LENGTH} 个字符`),

  // 描述验证
  description: createValidator()
    .maxLength(VALIDATION.DESCRIPTION_MAX_LENGTH, `描述最多 ${VALIDATION.DESCRIPTION_MAX_LENGTH} 个字符`),

  // 内容验证
  content: createValidator()
    .maxLength(VALIDATION.CONTENT_MAX_LENGTH, `内容最多 ${VALIDATION.CONTENT_MAX_LENGTH} 个字符`),

  // URL 验证
  url: createValidator()
    .required('URL 不能为空')
    .url('请输入有效的 URL'),

  // 数字验证
  number: createValidator()
    .required('数值不能为空')
    .number('请输入有效的数字'),

  // 正整数验证
  positiveInteger: createValidator()
    .required('数值不能为空')
    .number('请输入有效的数字')
    .min(1, '数值必须大于 0')
    .custom((value) => Number.isInteger(Number(value)), '请输入整数'),
}

// 导出验证工具
export default {
  validators,
  Validator,
  createValidator,
  validateForm,
  AsyncValidatorClass,
  createAsyncValidator,
  commonValidators,
}
