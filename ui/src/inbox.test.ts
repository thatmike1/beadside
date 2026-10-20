import { describe, expect, it } from 'vitest'
import type { BoardConfig, Issue } from './api'
import { answerOf, buildInbox, dailyPicks, dueState, inboxFoldKey, isStale, localDay, staleBeads } from './inbox'
import type { InboxOptions } from './inbox'
import { linksOf, step } from './model'

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

  describe('closed beads that answered a note', () => {
    // the 13 Oct pass: Mike noted, an agent replied and closed in the same minute
    const zkcf = bead('zkcf', {
      status: 'closed',
      note_at: '2026-10-13T15:23:35Z',
      agent_reply: { at: '2026-10-14T06:30:59Z', name: 'Claude' },
      closed_at: '2026-10-14T06:31:00Z',
      close_reason: 'replies sent; mobile/PWA ask lives in nexiflow-ypn',
    })
    // the reply came after the close
    const b4ci = bead('b4ci', {
      status: 'closed',
      note_at: '2026-10-13T15:56:49Z',
      agent_reply: { at: '2026-10-13T16:03:51Z', name: 'Claude' },
      closed_at: '2026-10-13T16:01:00Z',
    })
    // closed after the note with no agent comment after it
    const quiet = bead('quiet', { status: 'closed', note_at: daysAgo(3), closed_at: daysAgo(2), close_reason: 'done' })
    const at = new Date(2026, 9, 15, 18, 0)
    const closedRows = (inbox: ReturnType<typeof buildInbox>) => ids(inbox.sections.find((s) => s.key === 'closed')?.rows ?? [])

    it('lists them in their own section after replies, newest answer first', () => {
      const open = bead('open', { agent_reply: { at: daysAgo(0), name: 'Codex' } })
      const inbox = buildInbox([zkcf, b4ci, quiet, open], { ...OPTS, now: at })
      expect(inbox.sections.map((s) => s.key)).toEqual(['reply', 'closed'])
      expect(closedRows(inbox)).toEqual(['repo-zkcf', 'repo-b4ci', 'repo-quiet'])
      expect(inbox.sections[1]?.title).toBe('answered, closed')
      expect(inbox.count).toBe(4)
    })

    it('takes the later of reply and close as the answer, unnamed when no agent spoke', () => {
      expect(answerOf(zkcf)).toEqual({ at: '2026-10-14T06:31:00Z', name: 'Claude' })
      expect(answerOf(b4ci)).toEqual({ at: '2026-10-13T16:03:51Z', name: 'Claude' })
      expect(answerOf(quiet)).toEqual({ at: daysAgo(2), name: null })
    })

    it('leaves out a closed bead the human never noted on, or that closed before the note with no reply', () => {
      const noNote = bead('nonote', { status: 'closed', closed_at: daysAgo(1), agent_reply: { at: daysAgo(1), name: 'Claude' } })
      const before = bead('before', { status: 'closed', note_at: daysAgo(1), closed_at: daysAgo(2) })
      expect(buildInbox([noNote, before], OPTS).count).toBe(0)
      // a note on an already closed bead that an agent then answers does come in
      const reopened = { ...before, agent_reply: { at: daysAgo(0), name: 'Codex' } }
      expect(buildInbox([reopened], OPTS).order).toEqual(['repo-before'])
    })

    it('clears like a reply: opened holds read, a rebuild drops it, a seen marker keeps it out', () => {
      const seen = { 'repo-zkcf': '2026-10-14T06:31:00Z' }
      const holding = buildInbox([zkcf, b4ci], { ...OPTS, now: at, seen, read: ['repo-zkcf'], holding: 'repo-zkcf' })
      expect(closedRows(holding)).toEqual(['repo-zkcf', 'repo-b4ci'])
      expect([...holding.read]).toEqual(['repo-zkcf'])
      expect(holding.count).toBe(1)
      const moved = buildInbox([zkcf, b4ci], { ...OPTS, now: at, seen, read: ['repo-zkcf'] })
      expect(closedRows(moved)).toEqual(['repo-b4ci', 'repo-zkcf'])
      expect(buildInbox([zkcf, b4ci], { ...OPTS, now: at, seen }).order).toEqual(['repo-b4ci'])
      // a marker at the reply but before the close still owes the close
      expect(buildInbox([zkcf], { ...OPTS, now: at, seen: { 'repo-zkcf': '2026-10-14T06:30:59Z' } }).count).toBe(1)
    })

    it('lets an answer older than two weeks stay history', () => {
      const old = bead('old', { status: 'closed', note_at: daysAgo(20), closed_at: daysAgo(15), agent_reply: { at: daysAgo(15), name: 'Claude' } })
      expect(buildInbox([old], OPTS).count).toBe(0)
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

describe('inbox folds', () => {
  const issues = [
    bead('r', { agent_reply: { at: daysAgo(1), name: 'Claude' } }),
    bead('n', { labels: ['infra', 'needs-human'] }),
    bead('d', { due_at: daysAgo(2) }),
  ]
  const folded = (keys: string[]) => (key: string, fallback: boolean) => (keys.includes(key) ? true : fallback)

  it('opens every section when nothing is stored', () => {
    const inbox = buildInbox(issues, OPTS)
    expect(inbox.sections.map((s) => s.folded)).toEqual([false, false, false])
    expect(inbox.order).toEqual(inbox.layout)
  })

  it('leaves a folded section out of keyboard order but keeps it laid out and counted', () => {
    const inbox = buildInbox(issues, { ...OPTS, isFolded: folded([inboxFoldKey('label')]) })
    expect(inbox.sections.find((s) => s.key === 'label')?.folded).toBe(true)
    expect(inbox.order).toEqual(['repo-r', 'repo-d'])
    expect(inbox.layout).toEqual(['repo-r', 'repo-n', 'repo-d'])
    expect(inbox.count).toBe(3)
  })

  it('steps off a row folded away to the next one on screen', () => {
    const inbox = buildInbox(issues, { ...OPTS, isFolded: folded([inboxFoldKey('label')]) })
    expect(step(inbox, 'repo-n', 1)).toBe('repo-d')
    expect(step(inbox, 'repo-n', -1)).toBe('repo-r')
  })

  it('keeps a bead listed twice on screen while one of its sections is open', () => {
    const twice = [bead('both', { labels: ['infra', 'needs-human'], due_at: daysAgo(1) })]
    const inbox = buildInbox(twice, { ...OPTS, isFolded: folded([inboxFoldKey('label')]) })
    expect(inbox.order).toEqual(['repo-both'])
  })
})
