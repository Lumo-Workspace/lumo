/**
 * 表单相关的类型定义
 */

import type { ValidationRule } from './index'

// ==================== 表单基础类型 ====================

export interface FormFieldConfig<T = unknown> {
  name: string
  label: string
  type: FormFieldType
  placeholder?: string
  required?: boolean
  disabled?: boolean
  defaultValue?: T
  validation?: ValidationRule<T>[]
  options?: FormFieldOption[]
  multiple?: boolean
  accept?: string // for file inputs
  maxLength?: number
  minLength?: number
  min?: number
  max?: number
  step?: number
}

export type FormFieldType = 
  | 'text'
  | 'email'
  | 'password'
  | 'number'
  | 'tel'
  | 'url'
  | 'textarea'
  | 'select'
  | 'multiselect'
  | 'checkbox'
  | 'radio'
  | 'date'
  | 'datetime-local'
  | 'time'
  | 'file'
  | 'hidden'

export interface FormFieldOption {
  value: string | number
  label: string
  disabled?: boolean
}

// ==================== 表单状态 ====================

export interface FormFieldState<T = unknown> {
  value: T
  error?: string
  touched: boolean
  dirty: boolean
  valid: boolean
  required: boolean
}

export interface FormState<T extends Record<string, unknown> = Record<string, unknown>> {
  fields: Record<keyof T, FormFieldState<T[keyof T]>>
  isValid: boolean
  isSubmitting: boolean
  isDirty: boolean
  isTouched: boolean
  submitCount: number
  errors: Record<string, string>
}

// ==================== 表单验证 ====================

export interface ValidationResult {
  isValid: boolean
  errors: Record<string, string>
}

export interface ValidationConfig<T = unknown> {
  rules: ValidationRule<T>[]
  validateOnChange?: boolean
  validateOnBlur?: boolean
  validateOnSubmit?: boolean
}

// ==================== 表单步骤 ====================

export interface FormStep {
  id: string
  title: string
  description?: string
  fields: string[]
  validation?: ValidationConfig
  isOptional?: boolean
}

export interface MultiStepFormState<T extends Record<string, unknown> = Record<string, unknown>> {
  currentStep: number
  steps: FormStep[]
  formState: FormState<T>
  canProceed: boolean
  canGoBack: boolean
}

// ==================== 动态表单 ====================

export interface DynamicFormConfig {
  fields: FormFieldConfig[]
  layout?: 'vertical' | 'horizontal' | 'grid'
  columns?: number
  spacing?: 'tight' | 'normal' | 'loose'
}

export interface ConditionalField {
  fieldName: string
  condition: (values: Record<string, unknown>) => boolean
  show: boolean
}

// ==================== 表单提交 ====================

export interface FormSubmission<T = unknown> {
  data: T
  isValid: boolean
  errors?: Record<string, string>
  timestamp: string
}

export interface FormSubmitHandler<T = unknown> {
  (data: T): Promise<void> | void
}

// ==================== 特定表单类型 ====================

export interface LoginForm {
  email: string
  password: string
  rememberMe: boolean
}

export interface RegisterForm {
  name: string
  email: string
  password: string
  confirmPassword: string
  agreeToTerms: boolean
}

export interface ProfileForm {
  name: string
  email: string
  avatar?: File
  bio?: string
  preferences: {
    theme: 'light' | 'dark' | 'system'
    language: 'en' | 'zh'
    notifications: boolean
  }
}

export interface StoryForm {
  title: string
  asA: string
  iWant: string
  soThat: string
  acceptanceCriteria: string[]
  priority: 'low' | 'medium' | 'high'
  estimatedPoints: number
  dependencies: string[]
  tags: string[]
  businessValue: string
  technicalNotes: string
}

export interface TaskForm {
  title: string
  description: string
  status: 'todo' | 'in-progress' | 'review' | 'done'
  priority: 'low' | 'medium' | 'high'
  assignee?: string
  dueDate?: string
  estimatedHours?: number
  tags: string[]
}

export interface TeamForm {
  name: string
  description: string
  members: string[]
}

export interface ProjectForm {
  name: string
  description: string
  teamId: string
}
