import { afterEach, describe, expect, it, vi } from 'vitest'
import { isReadingState, openReading, writeSelectionHash } from './navigation'

afterEach(() => vi.unstubAllGlobals())

describe('bead selection history', () => {
  it('pushes user changes and replaces automatic or repeated selections', () => {
    let hash = ''
    const pushState = vi.fn((_state: unknown, _title: string, url: string) => { hash = url })
    const replaceState = vi.fn((_state: unknown, _title: string, url: string) => { hash = url })
    vi.stubGlobal('window', {
      location: { get hash() { return hash } },
      history: { pushState, replaceState },
    })

    writeSelectionHash('repo-a', null, 'repo', false)
    writeSelectionHash('repo-b', 'repo-a', 'repo', true)
    writeSelectionHash('repo-b', 'repo-b', 'repo', true)
    hash = '#stale'
    writeSelectionHash('repo-b', 'repo-b', 'repo', true)
    writeSelectionHash('repo-c', 'repo-b', 'repo', false)

    expect(pushState).toHaveBeenCalledExactlyOnceWith(null, '', '#b')
    expect(replaceState.mock.calls.map((call) => call[2])).toEqual(['#a', '#b', '#c'])
  })
})

describe('phone reading view', () => {
  it('stacks a reading entry on a list entry with the same hash', () => {
    const entries: { state: unknown; url: string }[] = [{ state: null, url: '#a' }]
    vi.stubGlobal('window', {
      history: {
        replaceState: (state: unknown, _title: string, url: string) => {
          entries[entries.length - 1] = { state, url }
        },
        pushState: (state: unknown, _title: string, url: string) => {
          entries.push({ state, url })
        },
      },
    })

    openReading('repo-b', 'repo')

    expect(entries.map((e) => e.url)).toEqual(['#b', '#b'])
    expect(entries.map((e) => isReadingState(e.state))).toEqual([false, true])
    expect(isReadingState({ other: 'reading' })).toBe(false)
  })
})
