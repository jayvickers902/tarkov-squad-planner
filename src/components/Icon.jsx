const ICON_SIZES = {
  sm: 'var(--icon-sm)',
  md: 'var(--icon-md)',
  lg: 'var(--icon-lg)',
}

const ICON_PATHS = {
  'arrow-left': (
    <>
      <path d="m15 18-6-6 6-6" />
      <path d="M9 12h11" />
    </>
  ),
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" strokeLinecap="round" />,
  play: <path d="m8 5 11 7-11 7V5Z" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.64 8.9a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6h.01A1.7 1.7 0 0 0 10 3.05V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.01A1.7 1.7 0 0 0 20.95 10H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15Z" />
    </>
  ),
  star: <path d="m12 3 2.7 5.47 6.04.88-4.37 4.26 1.03 6.01L12 16.78l-5.4 2.84 1.03-6.01-4.37-4.26 6.04-.88L12 3Z" />,
  tent: (
    <>
      <path d="M3 20 12 4l9 16H3Z" />
      <path d="m8.5 20 3.5-6 3.5 6M7 13h10" />
    </>
  ),
}

export default function Icon({ name, size = 'md', title, className = '' }) {
  const paths = ICON_PATHS[name]
  if (!paths) return null

  const dimension = ICON_SIZES[size] || ICON_SIZES.md
  const accessible = Boolean(title)

  return (
    <svg
      className={`icon${className ? ` ${className}` : ''}`}
      width={dimension}
      height={dimension}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={accessible ? undefined : 'true'}
      role={accessible ? 'img' : undefined}
    >
      {accessible && <title>{title}</title>}
      {paths}
    </svg>
  )
}
