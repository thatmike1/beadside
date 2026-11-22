// the look: the warm ledger or atlas, kept on <html data-skin> apart from data-theme (light or dark).
// a pick in the look menu wins and is remembered per browser; without one the config's "theme"
// holds, and is remembered too so the boot script in index.html paints it before the session lands

import { useCallback, useEffect, useState } from 'react'
import type { Theme as Skin } from './api'
import { CHROME } from './use-theme'

export type { Skin }

/** every look, in the order the menu lists them and `T` steps through them */
export const SKINS: readonly Skin[] = ['default', 'atlas']

/** keep both in step with the boot script in index.html */
export const SKIN_KEY = 'beadside:skin'
/** the config's look as last seen, for first paint only; a pick under SKIN_KEY outranks it */
export const SKIN_DEFAULT_KEY = 'beadside:skin-default'
/** the browser chrome around the page in atlas, matched to its index panel */
const ATLAS_CHROME = '#161d5a'

export function isSkin(value: unknown): value is Skin {
  return typeof value === 'string' && (SKINS as readonly string[]).includes(value)
}

function read(key: string): Skin | null {
  try {
    const value = window.localStorage.getItem(key)
    return isSkin(value) ? value : null
  } catch {
    return null
  }
}

function write(key: string, skin: Skin | null): void {
  try {
    if (skin === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, skin)
  } catch {
    // storage blocked: the look still holds for this page
  }
}

/** the look in force: the browser's pick, else the config's, else the one last seen, else default */
export function resolveSkin(picked: Skin | null, configured: Skin | null, remembered: Skin | null): Skin {
  return picked ?? configured ?? remembered ?? 'default'
}

/** the next look for `T` */
export function nextSkin(skin: Skin): Skin {
  return SKINS[(SKINS.indexOf(skin) + 1) % SKINS.length] ?? 'default'
}

export interface SkinControl {
  skin: Skin
  /** the browser picked this look rather than inheriting the config's */
  picked: boolean
  /** picks a look and remembers it; null drops the pick and follows the config again */
  setSkin: (skin: Skin | null) => void
  /** steps to the next look */
  cycle: () => void
}

/** `configured` is the config's theme once the session is in, null until then */
export function useSkin(configured: Skin | null): SkinControl {
  const [picked, setPicked] = useState<Skin | null>(() => read(SKIN_KEY))
  const [remembered] = useState<Skin | null>(() => read(SKIN_DEFAULT_KEY))
  const skin = resolveSkin(picked, configured, remembered)

  // the config's look, kept for the next first paint
  useEffect(() => {
    if (configured !== null) write(SKIN_DEFAULT_KEY, configured === 'default' ? null : configured)
  }, [configured])

  useEffect(() => {
    const root = document.documentElement
    if (skin === 'default') delete root.dataset['skin']
    else root.dataset['skin'] = skin
    // atlas always wears navy; the default look takes back the light or dark chrome
    const chrome = skin === 'atlas' ? ATLAS_CHROME : CHROME[root.dataset['theme'] === 'dark' ? 'dark' : 'light']
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', chrome)
  }, [skin])

  // another tab of the board picked a look
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SKIN_KEY) setPicked(isSkin(e.newValue) ? e.newValue : null)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const setSkin = useCallback((next: Skin | null) => {
    setPicked(next)
    write(SKIN_KEY, next)
  }, [])

  const cycle = useCallback(() => setSkin(nextSkin(skin)), [setSkin, skin])

  return { skin, picked: picked !== null, setSkin, cycle }
}
