import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOCALE_KEY, storedLocale } from './use-locale'

const storage = (value: string | null) => ({ localStorage: { getItem: (key: string) => (key === LOCALE_KEY ? value : null) } })

afterEach(() => vi.unstubAllGlobals())

describe('storedLocale', () => {
  it('remembers czech only', () => {
    vi.stubGlobal('window', storage('cs'))
    expect(storedLocale()).toBe('cs')
    vi.stubGlobal('window', storage(null))
    expect(storedLocale()).toBe('en')
    vi.stubGlobal('window', storage('de'))
    expect(storedLocale()).toBe('en')
  })

  it('falls back to english when storage is blocked', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => { throw new Error('blocked') } } })
    expect(storedLocale()).toBe('en')
  })
})
