// light or dark: the system's preference until the toggle is used, then the stored choice

import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

/** keep in step with the boot script in index.html, which applies the theme before first paint */
const STORAGE_KEY = 'beadside:theme'
const PREFERS_DARK = '(prefers-color-scheme: dark)'
/** the browser chrome around the page, matched to --bg-index in styles.css */
export const CHROME: Record<Theme, string> = { light: '#e9e6df', dark: '#171614' }

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark'
}

function stored(): Theme | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return isTheme(value) ? value : null
  } catch {
    return null
  }
}

function systemTheme(): Theme {
  return window.matchMedia(PREFERS_DARK).matches ? 'dark' : 'light'
}

function apply(theme: Theme): void {
  document.documentElement.dataset['theme'] = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', CHROME[theme])
}

/** what the look menu offers: follow the system, or hold one theme */
export type ThemeMode = 'system' | Theme

export interface ThemeControl {
  theme: Theme
  /** system until a theme is chosen, then the chosen one */
  mode: ThemeMode
  /** flips the theme and remembers it, which stops following the system */
  toggle: () => void
  /** holds a theme, or forgets the choice and follows the system again */
  setMode: (mode: ThemeMode) => void
}

/** the board's theme, kept on <html data-theme> so the stylesheet can key off it */
export function useTheme(): ThemeControl {
  const [theme, setTheme] = useState<Theme>(() => stored() ?? systemTheme())
  const [chosen, setChosen] = useState<boolean>(() => stored() !== null)

  useEffect(() => apply(theme), [theme])

  // nobody has chosen yet: follow the system when it switches, at sunset for instance
  useEffect(() => {
    const query = window.matchMedia(PREFERS_DARK)
    const onChange = () => {
      if (stored() === null) setTheme(query.matches ? 'dark' : 'light')
    }
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  // another tab of the board flipped it
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return
      setChosen(isTheme(e.newValue))
      setTheme(isTheme(e.newValue) ? e.newValue : systemTheme())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark'
      try {
        window.localStorage.setItem(STORAGE_KEY, next)
      } catch {
        // storage full or blocked: the theme still holds for this page
      }
      return next
    })
    setChosen(true)
  }, [])

  const setMode = useCallback((mode: ThemeMode) => {
    try {
      if (mode === 'system') window.localStorage.removeItem(STORAGE_KEY)
      else window.localStorage.setItem(STORAGE_KEY, mode)
    } catch {
      // storage full or blocked: the theme still holds for this page
    }
    setChosen(mode !== 'system')
    setTheme(mode === 'system' ? systemTheme() : mode)
  }, [])

  return { theme, mode: chosen ? theme : 'system', toggle, setMode }
}
