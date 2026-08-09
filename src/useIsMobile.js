import { useState, useEffect } from 'react'

export function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < breakpoint)
  useEffect(() => {
    let frame = null
    const handler = () => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = null
        const next = window.innerWidth < breakpoint
        setIsMobile(current => current === next ? current : next)
      })
    }
    window.addEventListener('resize', handler)
    return () => {
      window.removeEventListener('resize', handler)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [breakpoint])
  return isMobile
}
