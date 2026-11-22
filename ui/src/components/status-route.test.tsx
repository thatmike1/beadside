import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Issue } from '../api'
import { EN, StringsContext, stringsFor } from '../i18n'
import { StatusRoute, stopsFor } from './status-route'
import { keyRows } from './keys-help'

const created = new Date(2026, 8, 3, 12).toISOString()
const closedAt = new Date(2026, 9, 1, 12).toISOString()

function bead(over: Partial<Issue> = {}): Issue {
  return {
    id: 'repo-a1',
    title: 'a bead',
    description: '',
    status: 'open',
    priority: 2,
    issue_type: 'task',
    labels: [],
    created_at: created,
    updated_at: created,
    comment_count: 0,
    dependency_count: 0,
    dependent_count: 0,
    ...over,
  }
}

describe('status route', () => {
  it('stands at the first stop while the bead is open', () => {
    const stops = stopsFor(bead(), EN)
    expect(stops.map((s) => s.state)).toEqual(['here', 'ahead', 'ahead'])
    expect(stops[0]).toMatchObject({ label: 'opened', date: '3 Sep 2026' })
  })

  it('names the middle stop after the status that holds the bead', () => {
    expect(stopsFor(bead({ status: 'in_progress' }), EN)[1]).toMatchObject({ label: 'in progress', state: 'here' })
    expect(stopsFor(bead({ status: 'blocked' }), EN)[1]).toMatchObject({ label: 'blocked', state: 'here' })
    expect(stopsFor(bead({ status: 'deferred' }), EN)[1]).toMatchObject({ label: 'deferred', state: 'here' })
    expect(stopsFor(bead({ status: 'pinned' }), EN)[1]).toMatchObject({ label: 'pinned', state: 'here' })
  })

  it('ends at the close with its date, every leg done', () => {
    const stops = stopsFor(bead({ status: 'closed', closed_at: closedAt }), stringsFor('cs'))
    expect(stops.map((s) => s.state)).toEqual(['done', 'done', 'here'])
    expect(stops[2]).toMatchObject({ label: 'uzavřeno', date: '1. 10. 2026' })
  })

  it('renders an ordered list with the current stop marked', () => {
    const html = renderToStaticMarkup(
      <StringsContext.Provider value={stringsFor('cs')}>
        <StatusRoute issue={bead({ status: 'in_progress' })} />
      </StringsContext.Provider>,
    )
    expect(html).toContain('<ol class="route route-in_progress" aria-label="kam bead došel">')
    expect(html).toMatch(/<li class="stop here" aria-current="step">.*v řešení/)
    expect(html.match(/class="leg done"/g)).toHaveLength(1)
  })
})

describe('key list', () => {
  const keys = (options: Parameters<typeof keyRows>[1]) => keyRows(EN, options).map((r) => r.keys.join(' '))

  it('lists upstream keys plus ctrl+enter, r only when try-it is on', () => {
    const rows = keys({ tries: false, fixedLook: false })
    expect(rows).toEqual(expect.arrayContaining(['ctrl ⏎', 's', 't', 'T', 'f', '?', 'i b o']))
    expect(rows).not.toContain('r')
    expect(keys({ tries: true, fixedLook: false })).toContain('r')
  })

  it('moves f to search and drops the theme and font keys when the look is fixed', () => {
    const rows = keyRows(EN, { tries: false, fixedLook: true })
    expect(rows.find((r) => r.what === EN.keys.search)?.keys).toEqual(['s', 'f'])
    expect(rows.some((r) => r.what === EN.keys.theme || r.what === EN.keys.font)).toBe(false)
    expect(rows.find((r) => r.what === EN.keys.skin)?.keys).toEqual(['T'])
  })
})
