// body font: figtree or ubuntu, the stored choice from the first visit on

import { useCallback, useEffect, useState } from 'react'

export type BodyFont = 'figtree' | 'ubuntu'

/** keep in step with the boot script in index.html, which applies the font before first paint */
const STORAGE_KEY = 'beadside:font'

function isBodyFont(value: unknown): value is BodyFont {
  return value === 'figtree' || value === 'ubuntu'
}

function stored(): BodyFont | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return isBodyFont(value) ? value : null
  } catch {
    return null
  }
}

function apply(font: BodyFont): void {
  document.documentElement.dataset['font'] = font
}

export interface FontControl {
  font: BodyFont
  /** flips the body font and remembers it */
  toggle: () => void
}

/** the board's body font, kept on <html data-font> so the stylesheet can key off it */
export function useFont(): FontControl {
  const [font, setFont] = useState<BodyFont>(() => stored() ?? 'figtree')

  useEffect(() => apply(font), [font])

  // another tab of the board flipped it
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && isBodyFont(e.newValue)) setFont(e.newValue)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const toggle = useCallback(() => {
    setFont((prev) => {
      const next: BodyFont = prev === 'ubuntu' ? 'figtree' : 'ubuntu'
      try {
        window.localStorage.setItem(STORAGE_KEY, next)
      } catch {
        // storage full or blocked: the font still holds for this page
      }
      return next
    })
  }, [])

  return { font, toggle }
}
