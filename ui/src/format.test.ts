import { describe, expect, it } from 'vitest'
import { formatDateTime, relativeTime } from './format'

describe('formatDateTime', () => {
  it('gives the day and the local 24h time', () => {
    expect(formatDateTime(new Date(2026, 9, 16, 17, 35).toISOString())).toBe('16 Oct 2026 17:35')
    expect(formatDateTime(new Date(2026, 0, 3, 7, 5).toISOString())).toBe('3 Jan 2026 07:05')
  })

  it('is empty for a missing or unreadable time', () => {
    expect(formatDateTime(null)).toBe('')
    expect(formatDateTime('not a date')).toBe('')
  })
})

describe('relativeTime', () => {
  const now = new Date('2026-10-20T12:00:00Z')
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()
  const MIN = 60_000
  const HOUR = 60 * MIN
  const DAY = 24 * HOUR

  it('reads elapsed time in whole units', () => {
    expect(relativeTime(ago(10_000), now)).toBe('just now')
    expect(relativeTime(ago(MIN), now)).toBe('1 minute ago')
    expect(relativeTime(ago(59 * MIN), now)).toBe('59 minutes ago')
    expect(relativeTime(ago(3 * HOUR + 20 * MIN), now)).toBe('3 hours ago')
    expect(relativeTime(ago(DAY + HOUR), now)).toBe('1 day ago')
    expect(relativeTime(ago(2 * DAY), now)).toBe('2 days ago')
    expect(relativeTime(ago(13 * DAY), now)).toBe('13 days ago')
    expect(relativeTime(ago(15 * DAY), now)).toBe('2 weeks ago')
    expect(relativeTime(ago(70 * DAY), now)).toBe('2 months ago')
    expect(relativeTime(ago(400 * DAY), now)).toBe('1 year ago')
  })

  it('reads a future time as in', () => {
    expect(relativeTime(new Date(now.getTime() + 3 * DAY).toISOString(), now)).toBe('in 3 days')
  })

  it('is empty for a missing or unreadable time', () => {
    expect(relativeTime(null, now)).toBe('')
    expect(relativeTime('soon', now)).toBe('')
  })
})
