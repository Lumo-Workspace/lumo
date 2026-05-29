interface Props {
  size?: number
  className?: string
}

export function GeminiIcon({
  size = 14,
  className,
}: Props): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 16 16'
      xmlns='http://www.w3.org/2000/svg'
      className={className}
      aria-hidden='true'
    >
      <path
        d='M8 0c.3 4.2 3.8 7.7 8 8-4.2.3-7.7 3.8-8 8-.3-4.2-3.8-7.7-8-8 4.2-.3 7.7-3.8 8-8z'
        fill='#3186FF'
      />
    </svg>
  )
}
