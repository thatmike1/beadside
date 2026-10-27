import { afterEach, describe, expect, it, vi } from 'vitest'
import { beadFromHash, isReadingState, openReading, writeSelectionHash } from './navigation'

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

describe('beadFromHash', () => {
  const ids = ['repo-76w7', 'repo-abc']

  it('waits for the repo name before reading a short id, instead of giving up', () => {
    // the issues landed before the session: this used to come back as no bead, an empty pane
    expect(beadFromHash('#76w7', ids, null)).toEqual({ wait: true })
    expect(beadFromHash('#76w7', ids, 'repo')).toEqual({ wait: false, id: 'repo-76w7' })
  })

  it('reads a full id at once, and an empty or unknown hash as no bead', () => {
    expect(beadFromHash('#repo-abc', ids, null)).toEqual({ wait: false, id: 'repo-abc' })
    expect(beadFromHash('', ids, null)).toEqual({ wait: false, id: null })
    expect(beadFromHash('#zzz', ids, 'repo')).toEqual({ wait: false, id: null })
    expect(beadFromHash('#repo%2Dabc', ids, 'repo')).toEqual({ wait: false, id: 'repo-abc' })
  })
})
