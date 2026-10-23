import { describe, expect, it } from 'vitest'
import type { BoardConfig } from './api'
import { axisStyle, highlightRuns, laneColor, laneGlyph, relativeTime } from './format'

const config: BoardConfig = {
  human: null, agentsview: null, notesDir: null,
  lanes: [{ label: 'infra', color: '#123456', glyph: '#', note: null }],
  unlaned: { title: 'no lane', note: null }, subLabels: [],
  waiting: { labels: [], title: 'waiting', note: null },
  note: { addLabel: null, offerToClear: [] }, inbox: { labels: [] },
  thoughts: null, flags: [], capture: { labels: [] },
  derived: { allFlags: [], hotChips: [] },
}

describe('search result highlighting and lane presentation', () => {
  it('highlights case- and accent-insensitive matches without rewriting the displayed text', () => {
    expect(highlightRuns('Příliš ŽLUŤOUČKÝ kůň', ['zlutoucky'])).toEqual([
      { text: 'Příliš ', hit: false }, { text: 'ŽLUŤOUČKÝ', hit: true }, { text: ' kůň', hit: false },
    ])
  })

  // ccChat-general-2ymv: advancing by term length skips overlapping occurrences.
  it.fails('highlights overlapping occurrences of the same search term', () => {
    expect(highlightRuns('banana banana', ['ana', 'ban'])).toEqual([
      { text: 'banana', hit: true }, { text: ' ', hit: false }, { text: 'banana', hit: true },
    ])
  })

  it('finds repeated terms and merges adjacent highlights', () => {
    expect(highlightRuns('beadbead bead', ['bead'])).toEqual([
      { text: 'beadbead', hit: true }, { text: ' ', hit: false }, { text: 'bead', hit: true },
    ])
  })

  it('ignores empty search terms while still highlighting the other terms', () => {
    expect(highlightRuns('a bead', ['', 'bead'])).toEqual([
      { text: 'a ', hit: false }, { text: 'bead', hit: true },
    ])
  })

  it('leaves an unmatched or empty result readable', () => {
    expect(highlightRuns('no match', ['xyz'])).toEqual([{ text: 'no match', hit: false }])
    expect(highlightRuns('', ['xyz'])).toEqual([])
  })

  it('uses the configured lane color consistently in the row and detail header', () => {
    const color = 'color-mix(in srgb, #123456 var(--lane-keep), var(--ink))'
    expect(axisStyle('infra', config)).toEqual({
      '--axis': color, '--fill-row': `color-mix(in srgb, ${color} 14%, transparent)`,
    })
    expect(laneColor('infra', config)).toBe(color)
    expect(laneGlyph('infra', config)).toBe('#')
    expect(axisStyle('missing', config)).toEqual({ '--axis': 'var(--none)', '--fill-row': 'var(--none-fill)' })
    expect(laneColor('missing', config)).toBeUndefined()
    expect(laneGlyph('missing', config)).toBe('·')
  })

  it('switches from just now at exactly 45 seconds, including future timestamps', () => {
    const now = new Date('2026-10-23T10:00:00Z')
    expect(relativeTime(new Date(now.getTime() - 44_999).toISOString(), now)).toBe('just now')
    expect(relativeTime(new Date(now.getTime() - 45_000).toISOString(), now)).toBe('1 minute ago')
    expect(relativeTime(new Date(now.getTime() + 45_000).toISOString(), now)).toBe('in 1 minute')
  })

  it('keeps 59 days in weeks and switches to months at 60 days', () => {
    const now = new Date('2026-10-23T10:00:00Z')
    const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString()
    expect(relativeTime(ago(59), now)).toBe('8 weeks ago')
    expect(relativeTime(ago(60), now)).toBe('2 months ago')
  })
})
