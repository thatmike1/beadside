import { describe, expect, it } from 'vitest'
import type { BoardConfig, Issue } from './api'
import { buildInbox, dailyPicks, dueState, isStale, localDay, staleBeads } from './inbox'
import type { InboxOptions } from './inbox'
import { linksOf } from './model'

const CONFIG: BoardConfig = {
  human: { id: 'human:tester', name: 'Tester' },
  agentsview: null,
  notesDir: null,
  lanes: [{ label: 'infra', note: null, glyph: '#', color: '#47598a' }],
  unlaned: { title: 'no lane', note: null },
  subLabels: [],
  waiting: { labels: ['needs-human', 'discuss'], title: 'waiting on you', note: null },
  note: { addLabel: 'human-note', offerToClear: ['needs-human'] },
  inbox: { labels: ['needs-human'] },
  thoughts: { label: 'idea', title: 'ideas', note: null },
  flags: [],
  capture: { labels: [] },
  derived: { allFlags: ['needs-human', 'discuss', 'human-note', 'idea'], hotChips: ['human-note', 'needs-human'] },
}

// a tuesday afternoon, local time
const NOW = new Date(2026, 9, 13, 15, 0)
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()

const OPTS: InboxOptions = { config: CONFIG, now: NOW, seen: {}, picks: [], read: [], holding: null }

/** a minimal open bead touched today; overrides win */
function bead(id: string, over: Partial<Issue> = {}): Issue {
  return {
    id: `repo-${id}`,
    title: id,
    description: '',
    status: 'open',
    priority: 2,
    issue_type: 'task',
    labels: ['infra'],
    created_at: daysAgo(90),
    updated_at: daysAgo(0),
    comment_count: 0,
    dependency_count: 0,
    dependent_count: 0,
    ...over,
  }
}

const ids = (issues: Issue[]) => issues.map((i) => i.id)

describe('inbox', () => {
  it('holds replies, inbox labels, due beads and the stale picks, in that order', () => {
    const issues = [
      bead('r', { agent_reply: { at: daysAgo(1), name: 'Claude' } }),
      bead('n', { labels: ['infra', 'needs-human'] }),
      bead('d', { due_at: daysAgo(2) }),
      bead('s', { updated_at: daysAgo(45) }),
      bead('plain'),
    ]
    const inbox = buildInbox(issues, { ...OPTS, picks: ['repo-s'] })
    expect(inbox.sections.map((s) => [s.key, ids(s.rows)])).toEqual([
      ['reply', ['repo-r']],
      ['label', ['repo-n']],
      ['due', ['repo-d']],
      ['stale', ['repo-s']],
    ])
    expect(inbox.sections[1]?.title).toBe('needs-human')
    expect(inbox.order).toEqual(['repo-r', 'repo-n', 'repo-d', 'repo-s'])
    expect(inbox.count).toBe(4)
  })

  it('leaves the other waiting labels, deferred and closed beads in the lanes', () => {
    const issues = [
      bead('talk', { labels: ['infra', 'discuss'] }),
      bead('parked', { labels: ['infra', 'needs-human'], status: 'deferred' }),
      bead('done', { status: 'closed', due_at: daysAgo(3), agent_reply: { at: daysAgo(1), name: 'Codex' } }),
    ]
    expect(buildInbox(issues, OPTS).count).toBe(0)
  })

  it('drops a reply once opened, but not while it is still the open bead', () => {
    const reply = bead('r', { agent_reply: { at: daysAgo(1), name: 'Claude' } })
    const seen = { 'repo-r': daysAgo(1) }
    expect(buildInbox([reply], { ...OPTS, seen }).count).toBe(0)
    expect(buildInbox([reply], { ...OPTS, seen, holding: 'repo-r', read: ['repo-r'] }).order).toEqual(['repo-r'])
    // a newer reply than the one opened comes back
    const newer = { ...reply, agent_reply: { at: daysAgo(0), name: 'Codex' } }
    expect(buildInbox([newer], { ...OPTS, seen }).order).toEqual(['repo-r'])
  })

  describe('replies read this visit', () => {
    const replies = [
      bead('a', { agent_reply: { at: daysAgo(1), name: 'Claude' } }),
      bead('b', { agent_reply: { at: daysAgo(2), name: 'Claude' } }),
      bead('c', { agent_reply: { at: daysAgo(3), name: 'Codex' } }),
      bead('d', { agent_reply: { at: daysAgo(4), name: 'Codex' } }),
    ]
    const replyRows = (inbox: ReturnType<typeof buildInbox>) => ids(inbox.sections[0]?.rows ?? [])
    // opening a reply writes its seen marker at the reply's own time
    const seenFor = (...letters: string[]) =>
      Object.fromEntries(letters.map((l) => [`repo-${l}`, replies.find((r) => r.id === `repo-${l}`)!.agent_reply!.at]))

    it('the open one holds its place, marked read, until the selection moves on', () => {
      const inbox = buildInbox(replies, { ...OPTS, seen: seenFor('a'), read: ['repo-a'], holding: 'repo-a' })
      expect(replyRows(inbox)).toEqual(['repo-a', 'repo-b', 'repo-c', 'repo-d'])
      expect([...inbox.read]).toEqual(['repo-a'])
      expect(inbox.count).toBe(3)
    })

    it('three opened in a row stay listed, at the bottom in the order read', () => {
      // a, b, c read; c is still the open bead
      const reading = buildInbox(replies, { ...OPTS, seen: seenFor('a', 'b', 'c'), read: ['repo-a', 'repo-b', 'repo-c'], holding: 'repo-c' })
      expect(replyRows(reading)).toEqual(['repo-c', 'repo-d', 'repo-a', 'repo-b'])
      // the selection moves to d: c drops below a and b
      const moved = buildInbox(replies, { ...OPTS, seen: seenFor('a', 'b', 'c'), read: ['repo-a', 'repo-b', 'repo-c'], holding: null })
      expect(replyRows(moved)).toEqual(['repo-d', 'repo-a', 'repo-b', 'repo-c'])
      expect([...moved.read]).toEqual(['repo-a', 'repo-b', 'repo-c'])
      expect(moved.order).toEqual(['repo-d', 'repo-a', 'repo-b', 'repo-c'])
      expect(moved.count).toBe(1)
      expect(moved.sections[0]?.title).toBe('replies')
    })

    it('a rebuilt list, after a reload or a view switch, leaves them out', () => {
      const rebuilt = buildInbox(replies, { ...OPTS, seen: seenFor('a', 'b', 'c') })
      expect(replyRows(rebuilt)).toEqual(['repo-d'])
      expect(rebuilt.read.size).toBe(0)
    })

    it('a read reply that gets a newer answer is unread again, back above', () => {
      const answered = replies.map((r) => (r.id === 'repo-a' ? { ...r, agent_reply: { at: daysAgo(0), name: 'Claude' } } : r))
      const inbox = buildInbox(answered, { ...OPTS, seen: seenFor('a', 'b'), read: ['repo-a', 'repo-b'] })
      expect(replyRows(inbox)).toEqual(['repo-a', 'repo-c', 'repo-d', 'repo-b'])
      expect([...inbox.read]).toEqual(['repo-b'])
    })

    it('a read reply that also carries an inbox label still counts for that label', () => {
      const labelled = replies.map((r) => (r.id === 'repo-a' ? { ...r, labels: ['infra', 'needs-human'] } : r))
      const inbox = buildInbox(labelled, { ...OPTS, seen: seenFor('a', 'b', 'c', 'd'), read: ['repo-a'] })
      expect(inbox.count).toBe(1)
    })
  })

  it('lists a bead once in keyboard order though it sits in two sections', () => {
    const both = bead('b', { labels: ['infra', 'needs-human'], due_at: daysAgo(1) })
    const inbox = buildInbox([both], OPTS)
    expect(inbox.sections.map((s) => s.key)).toEqual(['label', 'due'])
    expect(inbox.order).toEqual(['repo-b'])
  })

  it('sorts due beads by date and counts a week ahead from the start of today', () => {
    const issues = [
      bead('later', { due_at: new Date(2026, 9, 19, 23, 0).toISOString() }),
      bead('over', { due_at: new Date(2026, 9, 13, 0, 0).toISOString() }),
      bead('week', { due_at: new Date(2026, 9, 20, 9, 0).toISOString() }),
    ]
    expect(issues.map((i) => dueState(i, NOW))).toEqual(['soon', 'overdue', null])
    const due = buildInbox(issues, OPTS).sections.find((s) => s.key === 'due')
    expect(ids(due?.rows ?? [])).toEqual(['repo-over', 'repo-later'])
  })

  it('shows only the picks that are still stale', () => {
    const issues = [bead('kept'), bead('old', { updated_at: daysAgo(40) })]
    const inbox = buildInbox(issues, { ...OPTS, picks: ['repo-kept', 'repo-old', 'repo-gone'] })
    expect(inbox.order).toEqual(['repo-old'])
  })
})

describe('stale filter', () => {
  it('takes open work untouched 30+ days, oldest first', () => {
    const issues = [
      bead('a', { updated_at: daysAgo(31) }),
      bead('b', { updated_at: daysAgo(60), status: 'in_progress' }),
      bead('fresh', { updated_at: daysAgo(29) }),
      bead('parked', { updated_at: daysAgo(90), status: 'deferred' }),
      bead('pinned', { updated_at: daysAgo(90), status: 'pinned' }),
      bead('closed', { updated_at: daysAgo(90), status: 'closed' }),
      bead('thought', { updated_at: daysAgo(90), labels: ['idea'] }),
    ]
    expect(ids(staleBeads(issues, NOW, CONFIG))).toEqual(['repo-b', 'repo-a'])
    expect(isStale(bead('edge', { updated_at: daysAgo(30) }), NOW, CONFIG)).toBe(true)
  })
})

describe('daily stale picks', () => {
  const stale = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => bead(id, { updated_at: daysAgo(40) }))
  const day = localDay(NOW)

  it('draws three, the same three all day', () => {
    const first = dailyPicks(stale, day, null)
    expect(first.day).toBe('2026-10-13')
    expect(first.ids).toHaveLength(3)
    expect(dailyPicks([...stale].reverse(), day, null)).toEqual(first)
  })

  it('keeps a stored pick for today even when its beads left, and redraws tomorrow', () => {
    const stored = { day, ids: ['repo-gone'] }
    expect(dailyPicks(stale, day, stored)).toBe(stored)
    const tomorrow = dailyPicks(stale, '2026-10-14', stored)
    expect(tomorrow.day).toBe('2026-10-14')
    expect(tomorrow.ids).toHaveLength(3)
  })

  it('takes what there is when fewer than three are stale', () => {
    expect(dailyPicks(stale.slice(0, 2), day, null).ids).toHaveLength(2)
    expect(dailyPicks([], day, null).ids).toEqual([])
  })
})

describe('links', () => {
  const edge = (from: string, to: string, type: string) => ({
    issue_id: `repo-${from}`,
    depends_on_id: `repo-${to}`,
    type,
  })

  it('groups both directions by kind, headed like bd show, related under one name', () => {
    const issues = [
      bead('x', {
        dependencies: [
          edge('x', 'epic', 'parent-child'),
          edge('x', 'gate', 'blocks'),
          edge('x', 'r1', 'related'),
          edge('x', 'old', 'supersedes'),
        ],
      }),
      bead('kid', { dependencies: [edge('kid', 'x', 'parent-child')] }),
      bead('r2', { dependencies: [edge('r2', 'x', 'relates-to')] }),
      bead('found', { dependencies: [edge('found', 'x', 'discovered-from')] }),
      bead('waiter', { dependencies: [edge('waiter', 'x', 'blocks')] }),
    ]
    expect(linksOf('repo-x', issues).map((g) => [g.title, g.ids])).toEqual([
      ['parent', ['repo-epic']],
      ['children', ['repo-kid']],
      ['depends on', ['repo-gate']],
      ['blocks', ['repo-waiter']],
      ['related', ['repo-r1', 'repo-r2']],
      ['discovered', ['repo-found']],
      ['superseded by', ['repo-old']],
    ])
  })

  it('is empty for a bead with no edges and keeps an unknown kind by name', () => {
    expect(linksOf('repo-a', [bead('a')])).toEqual([])
    const odd = [bead('a', { dependencies: [edge('a', 'b', 'waits-for')] })]
    expect(linksOf('repo-a', odd).map((g) => g.title)).toEqual(['waits-for'])
    expect(linksOf('repo-b', odd).map((g) => g.title)).toEqual(['waits-for (inbound)'])
  })
})
