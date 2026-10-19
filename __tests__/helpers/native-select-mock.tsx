/**
 * LUM-1265: a stand-in for `@/components/ui/select` that renders a native
 * `<select>`, for suites whose subject is the form's logic (which value is
 * saved, which warning shows), not the dropdown itself. The trigger's `id`
 * and `aria-label` move onto the `<select>`, so label lookups keep working.
 *
 *   jest.mock('@/components/ui/select', () =>
 *     require('./helpers/native-select-mock').nativeSelectMock()
 *   )
 *
 * Suites about the control's own behaviour use the real Radix Select with
 * `./radix-select` instead.
 */
import * as React from 'react'

interface SelectProps {
  value?: string
  onValueChange?: (value: string) => void
  disabled?: boolean
  children?: React.ReactNode
}

export function nativeSelectMock() {
  const SelectTrigger = ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  )
  const SelectValue = (_: { placeholder?: string }) => null
  const SelectContent = ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  )
  const SelectItem = ({
    value,
    children,
  }: {
    value: string
    children?: React.ReactNode
  }) => <option value={value}>{children}</option>

  function Select({ value, onValueChange, disabled, children }: SelectProps) {
    let trigger: Record<string, unknown> = {}
    let placeholder: string | undefined
    let options: React.ReactNode = null
    React.Children.forEach(children, child => {
      if (!React.isValidElement(child)) return
      const props = child.props as Record<string, unknown> & {
        children?: React.ReactNode
      }
      if (child.type === SelectTrigger) {
        trigger = props
        React.Children.forEach(props.children, inner => {
          if (React.isValidElement(inner) && inner.type === SelectValue)
            placeholder = (inner.props as { placeholder?: string }).placeholder
        })
      }
      if (child.type === SelectContent) options = props.children
    })
    return (
      <select
        id={trigger.id as string | undefined}
        aria-label={trigger['aria-label'] as string | undefined}
        value={value ?? ''}
        disabled={disabled}
        onChange={e => onValueChange?.(e.target.value)}
      >
        {value === '' || value === undefined ? (
          <option value=''>{placeholder ?? ''}</option>
        ) : null}
        {options}
      </select>
    )
  }

  return {
    __esModule: true,
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
    SelectGroup: ({ children }: { children?: React.ReactNode }) => (
      <>{children}</>
    ),
    SelectLabel: () => null,
    SelectSeparator: () => null,
  }
}
