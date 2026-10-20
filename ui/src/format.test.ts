import { describe, expect, it } from 'vitest'
import { formatDateTime } from './format'

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
