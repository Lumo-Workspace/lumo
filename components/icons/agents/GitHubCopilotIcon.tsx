interface Props {
  size?: number
  className?: string
}

export function GitHubCopilotIcon({
  size = 14,
  className,
}: Props): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 16 16'
      fill='currentColor'
      xmlns='http://www.w3.org/2000/svg'
      className={className}
      aria-hidden='true'
    >
      <path d='M8 2c2.2 0 3 1.2 3 3 1.1 0 2 .9 2 2v2.5c0 2-2.2 3.5-5 3.5s-5-1.5-5-3.5V7c0-1.1.9-2 2-2 0-1.8.8-3 3-3zM6 8.2a.9.9 0 100 1.8.9.9 0 000-1.8zm4 0a.9.9 0 100 1.8.9.9 0 000-1.8z' />
    </svg>
  )
}
