import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { BoardConfig, Issue } from './api'
import { formatDate, formatDateTime, formatShortDate, relativeTime } from './format'
import { csPlural, EN, lastLine, linkTitle, raisedLine, stringsFor, tryFacts } from './i18n'
import { buildBoard } from './model'
import { buildInbox } from './inbox'
import type { Ask } from './asks'
import type { TryKit } from './tries'

const cs = stringsFor('cs')

const CONFIG: BoardConfig = {
  human: null,
  agentsview: null,
  notesDir: null,
  lanes: [],
  unlaned: { title: 'open', note: null },
  subLabels: [],
  waiting: { labels: [], title: 'waiting on you', note: null },
  note: { addLabel: null, offerToClear: [] },
  inbox: { labels: [] },
  thoughts: null,
  flags: [],
  capture: { labels: [] },
  asks: null,
  derived: { allFlags: [], hotChips: [] },
}

function bead(id: string, over: Partial<Issue> = {}): Issue {
  return {
    id,
    title: id,
    description: '',
    status: 'open',
    priority: 2,
    issue_type: 'task',
    labels: [],
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    comment_count: 0,
    dependency_count: 0,
    dependent_count: 0,
    ...over,
  }
}

describe('czech plurals', () => {
  it('picks one, few or many', () => {
    expect([0, 1, 2, 4, 5, 11, 22].map((n) => csPlural(n, 'komentář', 'komentáře', 'komentářů'))).toEqual([
      'komentářů',
      'komentář',
      'komentáře',
      'komentáře',
      'komentářů',
      'komentářů',
      'komentářů',
    ])
    expect(cs.detail.comments(1)).toBe('1 komentář')
    expect(cs.detail.comments(3)).toBe('3 komentáře')
    expect(cs.detail.comments(7)).toBe('7 komentářů')
    expect(EN.detail.comments(1)).toBe('1 comment')
  })
})

describe('dates', () => {
  const iso = new Date(2026, 8, 3, 17, 35).toISOString()

  it('writes czech dates day first with dots and keeps english as the default', () => {
    expect(formatDate(iso, 'cs')).toBe('3. 9. 2026')
    expect(formatShortDate(iso, 'cs')).toBe('3. 9.')
    expect(formatDateTime(iso, 'cs')).toBe('3. 9. 2026 17:35')
    expect(formatDate(iso)).toBe('3 Sep 2026')
    expect(cs.date(iso)).toBe('3. 9. 2026')
    expect(EN.shortDate(iso)).toBe('3 Sep')
  })

  it('declines relative time after před and za', () => {
    const now = new Date('2026-10-20T12:00:00Z')
    const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()
    const day = 86_400_000
    expect(relativeTime(ago(10_000), now, 'cs')).toBe('právě teď')
    expect(relativeTime(ago(day), now, 'cs')).toBe('před 1 dnem')
    expect(relativeTime(ago(3 * day), now, 'cs')).toBe('před 3 dny')
    expect(relativeTime(ago(3 * 3_600_000), now, 'cs')).toBe('před 3 hodinami')
    expect(relativeTime(ago(400 * day), now, 'cs')).toBe('před 1 rokem')
    expect(relativeTime(ago(-5 * day), now, 'cs')).toBe('za 5 dní')
    expect(relativeTime(ago(-2 * 3_600_000), now, 'cs')).toBe('za 2 hodiny')
    expect(relativeTime(ago(-60_000), now, 'cs')).toBe('za 1 minutu')
    expect(relativeTime(ago(3 * day), now)).toBe('3 days ago')
  })
})

describe('copy for the model', () => {
  it('titles the board sections the model writes itself', () => {
    const issues = [
      bead('repo-o'),
      bead('repo-a', { status: 'pinned' }),
      bead('repo-b', { status: 'deferred' }),
      bead('repo-c', { status: 'closed', closed_at: '2026-09-03T00:00:00Z' }),
    ]
    const board = buildBoard(issues, { config: CONFIG, repoName: 'repo', isFolded: () => false, strings: cs.sections })
    const titles = Object.fromEntries(board.sections.map((s) => [s.key, s.title]))
    expect(titles).toMatchObject({ pinned: 'připnuté', deferred: 'odložené', closed: 'nedávno uzavřené' })
    // config titles stay as written
    expect(titles['lane:none']).toBe('open')
    const english = buildBoard(issues, { config: CONFIG, repoName: 'repo', isFolded: () => false })
    expect(english.sections.find((s) => s.key === 'closed')?.title).toBe('recently closed')
  })

  it('titles the inbox sections and fills in the day counts', () => {
    const now = new Date(2026, 9, 13, 15, 0)
    const issues = [bead('repo-d', { due_at: new Date(2026, 9, 14).toISOString(), updated_at: now.toISOString() })]
    const opts = { config: CONFIG, now, seen: {}, picks: [], read: [], holding: null }
    const czech = buildInbox(issues, { ...opts, strings: cs.inbox })
    expect(czech.sections[0]).toMatchObject({ key: 'due', title: 'termíny', note: 'po termínu nebo do 7 dnů' })
    expect(buildInbox(issues, opts).sections[0]).toMatchObject({ title: 'due', note: 'overdue or due within 7 days' })
  })
})

describe('copy helpers', () => {
  it('heads a known link kind in the locale and keeps an unknown one as bd names it', () => {
    expect(linkTitle(cs, { key: 'blocks:in', title: 'blocks' })).toBe('blokuje')
    expect(linkTitle(cs, { key: 'tracks:out', title: 'tracks' })).toBe('tracks')
    expect(linkTitle(EN, { key: 'parent:in', title: 'children' })).toBe('children')
  })

  it('counts a raised question and words a verdict', () => {
    const ask = { days_raised: 3 } as Ask
    expect(raisedLine(cs, ask)).toBe('vzneseno 3 dny')
    expect(raisedLine(EN, { days_raised: 1 } as Ask)).toBe('raised once')
    expect(raisedLine(cs, { days_raised: null } as Ask)).toBe('')
    expect(lastLine(cs, { result: 'broken', at: '', note: 'pořád padá' })).toBe('pořád to bylo rozbité: pořád padá')
    expect(lastLine(EN, { result: 'works', at: '', note: null })).toBe('you said it works')
    expect(tryFacts(cs, { where: 'telefon', minutes: 3 } as TryKit)).toEqual(['telefon', '3 min'])
  })

  it('falls back to english for a missing or unknown locale', () => {
    expect(stringsFor(undefined)).toBe(EN)
    expect(stringsFor('de' as never)).toBe(EN)
  })

  it('writes no em dash in either locale', () => {
    const source = readFileSync(new URL('./i18n.ts', import.meta.url), 'utf8')
    expect(source).not.toContain(String.fromCharCode(0x2014))
  })
})
