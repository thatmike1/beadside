// the configured language, remembered per browser: the session comes from the api, so without it
// (first paint, server down) a czech board would otherwise speak english. only a non-default locale
// is stored, so a board that never said `cs` stays english. it lives on <html lang> so the browser
// hyphenates, spells and reads aloud in it

import { useEffect, useState } from 'react'
import type { Locale } from './api'

/** keep in step with the boot script in index.html */
export const LOCALE_KEY = 'beadside:locale'

export function storedLocale(): Locale {
  try {
    return window.localStorage.getItem(LOCALE_KEY) === 'cs' ? 'cs' : 'en'
  } catch {
    return 'en'
  }
}

/** the language in force: the config's once the session is in, the remembered one until then */
export function useLocale(configured: Locale | null | undefined): Locale {
  const [remembered] = useState<Locale>(storedLocale)
  const locale = configured ?? remembered

  useEffect(() => {
    if (configured === undefined || configured === null) return
    try {
      if (configured === 'cs') window.localStorage.setItem(LOCALE_KEY, 'cs')
      else window.localStorage.removeItem(LOCALE_KEY)
    } catch {
      // storage blocked: this page still has the session's language
    }
  }, [configured])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  return locale
}
