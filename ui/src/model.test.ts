import { describe, expect, it } from 'vitest'
import type { BoardConfig, Issue } from './api'
import type { Comment } from './api'
import {
  buildBoard,
  foldPoint,
  HEADLINE_MAX,
  latestNote,
  orderComments,
  projectOf,
  repliesAfterNote,
  sectionsHolding,
  step,
  subsOf,
  unreadNote,
} from './model'
import type { BoardOptions } from './model'

const FULL_CONFIG = {
  agentsview: 'http://127.0.0.1:8080',
  notesDir: 'docs/notes',
  lanes: [
    {
      label: 'product',
      note: 'customer-facing features',
      glyph: '*',
      color: '#a06a2c'
    },
    {
      label: 'bugs',
      note: 'defects and regressions',
      glyph: '!',
      color: '#2f6a60'
    },
    {
      label: 'infra',
      note: 'tooling, tests and maintenance',
      glyph: '#',
      color: '#47598a'
    },
    {
      label: 'docs',
      note: 'written for readers',
      glyph: '~',
      color: '#8b4a68'
    },
    {
      label: 'chores',
      note: 'small upkeep',
      glyph: '+',
      color: '#6b7040'
    }
  ],
  unlaned: {
    title: 'no lane',
    note: 'no lane label yet'
  },
  subLabels: [
    'frontend',
    'backend'
  ],
  waiting: {
    labels: [
      'needs-human',
      'discuss'
    ],
    title: 'waiting on you',
    note: 'a decision only you can give'
  },
  note: {
    addLabel: 'human-note',
    offerToClear: [
      'needs-human'
    ]
  },
  thoughts: {
    label: 'idea',
    title: 'ideas',
    note: 'not counted as backlog'
  },
  flags: [
    'blocked-external'
  ],
  capture: {
    labels: [
      'idea',
      'chores'
    ]
  }
}

function resolved(raw: typeof FULL_CONFIG): BoardConfig {
  const allFlags = [
    ...new Set([
      ...raw.waiting.labels,
      raw.note.addLabel,
      ...raw.note.offerToClear,
      raw.thoughts.label,
      ...raw.flags,
    ]),
  ]
  const hotChips = [...new Set([raw.note.addLabel, ...raw.note.offerToClear])]
  return { ...raw, human: null, inbox: { labels: [...raw.note.offerToClear] }, derived: { allFlags, hotChips } }
}

function emptyConfig(): BoardConfig {
  return {
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
    derived: { allFlags: [], hotChips: [] },
  }
}

const FULL = resolved(FULL_CONFIG)

const OPTS: BoardOptions = {
  config: FULL,
  repoName: 'repo',
  isFolded: () => false,
}

/** a minimal open bead; overrides win */
function bead(id: string, over: Partial<Issue> = {}): Issue {
  return {
    id: `repo-${id}`,
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

describe('no-config board', () => {
  it('builds a single open section, no waiting section, and no drawer', () => {
    const issues = [
      bead('a'),
      bead('b', { status: 'deferred' }),
      bead('c', { status: 'closed', closed_at: '2026-09-02T00:00:00Z' }),
    ]
    const board = buildBoard(issues, {
      config: emptyConfig(),
      repoName: 'repo',
      isFolded: () => false,
    })

    expect(board.sections.map((s) => s.key)).toEqual(['lane:none', 'deferred', 'closed'])
    expect(board.sections[0]?.title).toBe('open')
    expect(board.sections[0]?.note).toBeNull()
    expect(board.sections[0]?.count).toBe(1)
    expect(board.counts.open).toBe(1)
    expect(board.counts.deferred).toBe(1)
    expect(board.counts.waiting).toBe(0)
    expect(board.counts.unread).toBe(0)
  })
})

describe('full config board', () => {
  const lane1 = FULL.lanes[0]!.label
  const lane4 = FULL.lanes[3]!.label
  const waitFlag = FULL.waiting.labels[0]!

  it('builds sections, notes, and titles from the config', () => {
    const issues = [
      bead('w', { labels: [lane1, waitFlag], priority: 1 }),
      bead('i', { labels: [lane1], priority: 2 }),
      bead('f', { labels: [lane4], priority: 2 }),
      bead('d', { labels: [lane4], status: 'deferred' }),
      bead('c', { labels: [lane4], status: 'closed', closed_at: '2026-09-02T00:00:00Z' }),
    ]
    const board = buildBoard(issues, OPTS)

    expect(board.sections.map((s) => s.key)).toEqual([
      'waiting',
      `lane:${lane1}`,
      `lane:${lane4}`,
      'deferred',
      'closed',
    ])
    expect(board.sections[0]?.title).toBe('waiting on you')
    expect(board.sections[0]?.note).toBe('a decision only you can give')
    expect(board.sections[1]?.title).toBe(lane1)
    expect(board.sections[1]?.note).toBe('customer-facing features')
    expect(board.sections[2]?.title).toBe(lane4)
    expect(board.sections[2]?.note).toBe('written for readers')
  })
})

describe('labels', () => {
  it('never takes a sub-label for a project', () => {
    const sub1 = FULL.subLabels[0]!
    const sub2 = FULL.subLabels[1]!
    const lane5 = FULL.lanes[4]!.label

    const issue = bead('a', { labels: [lane5, sub1, sub2] })
    expect(projectOf(issue, FULL)).toBeNull()
    expect(subsOf(issue, FULL.subLabels)).toEqual([sub1, sub2])

    const withProject = bead('b', { labels: [sub1, lane5, 'custom-proj'] })
    expect(projectOf(withProject, FULL)).toBe('custom-proj')
  })
})

describe('lane grouping', () => {
  const lane3 = FULL.lanes[2]!.label
  const issues = [
    bead('low', { labels: [lane3], priority: 3 }),
    bead('top', { labels: [lane3], priority: 0 }),
    bead('ep', { labels: [lane3], priority: 2, issue_type: 'epic' }),
    bead('ep.1', { labels: [lane3], priority: 1 }),
    bead('ep.2', { labels: [lane3], priority: 3 }),
    bead('p1', { labels: [lane3, 'subproject'], priority: 2 }),
    bead('p2', { labels: [lane3, 'subproject'], priority: 4 }),
  ]
  const board = buildBoard(issues, OPTS)
  const lane = board.sections.find((s) => s.key === `lane:${lane3}`)

  it('heads an epic group with the epic as a row and sorts groups by best priority', () => {
    expect(lane?.groups.map((g) => g.key)).toEqual([
      'loose:repo-top',
      'repo-ep',
      'project:subproject',
      'loose:repo-low',
    ])
    const epic = lane?.groups[1]
    expect(epic?.head?.issue.id).toBe('repo-ep')
    expect(epic?.rows.map((r) => r.issue.id)).toEqual(['repo-ep.1', 'repo-ep.2'])
    expect(lane?.count).toBe(7)
  })

  it('walks the epic before its children', () => {
    expect(board.order).toEqual([
      'repo-top',
      'repo-ep',
      'repo-ep.1',
      'repo-ep.2',
      'repo-p1',
      'repo-p2',
      'repo-low',
    ])
  })
})

describe('bottom sections', () => {
  it('always ends with deferred then recently closed, deferred out of the lanes', () => {
    const lane4 = FULL.lanes[3]!.label
    const board = buildBoard(
      [
        bead('a', { labels: [lane4] }),
        bead('b', { labels: [lane4], status: 'deferred' }),
        bead('c', { labels: [lane4], status: 'closed', closed_at: '2026-09-02T00:00:00Z' }),
      ],
      OPTS,
    )
    expect(board.sections.map((s) => s.key)).toEqual(['waiting', `lane:${lane4}`, 'deferred', 'closed'])
    expect(board.sections[1]?.count).toBe(1)
    expect(board.sections[2]?.groups[0]?.rows.map((r) => r.issue.id)).toEqual(['repo-b'])
    expect(board.sections[3]?.groups[0]?.rows.map((r) => r.issue.id)).toEqual(['repo-c'])
  })
})

describe('pinned strip', () => {
  const lane1 = FULL.lanes[0]!.label
  const waitFlag = FULL.waiting.labels[0]!

  it('leads the board, keeps pinned beads out of the lanes and open by default', () => {
    const board = buildBoard(
      [bead('p', { labels: [lane1], status: 'pinned' }), bead('a', { labels: [lane1] })],
      { ...OPTS, isFolded: (_key, fallback) => fallback },
    )
    expect(board.sections.map((s) => [s.key, s.folded])).toEqual([
      ['pinned', false],
      ['waiting', false],
      [`lane:${lane1}`, true],
      ['deferred', true],
      ['closed', true],
    ])
    expect(board.sections[0]?.groups[0]?.rows.map((r) => r.issue.id)).toEqual(['repo-p'])
    expect(board.sections[2]?.count).toBe(1)
    expect(board.counts.open).toBe(1)
  })

  it('still lists a pinned bead that waits on you', () => {
    const board = buildBoard([bead('p', { labels: [lane1, waitFlag], status: 'pinned' })], OPTS)
    expect(sectionsHolding(board, 'repo-p').map((s) => s.key)).toEqual(['pinned', 'waiting'])
  })

  it('is absent when nothing is pinned', () => {
    const board = buildBoard([bead('a', { labels: [lane1] })], OPTS)
    expect(board.sections.some((s) => s.key === 'pinned')).toBe(false)
  })
})

describe('folding', () => {
  const lane1 = FULL.lanes[0]!.label
  const lane4 = FULL.lanes[3]!.label
  const waitFlag = FULL.waiting.labels[0]!

  const issues = [
    bead('w', { labels: [lane1, waitFlag], priority: 1 }),
    bead('i', { labels: [lane1], priority: 2 }),
    bead('f', { labels: [lane4], priority: 2 }),
    bead('g', { labels: [lane4], priority: 3 }),
  ]

  it('drops rows of folded sections from the order and keeps the layout', () => {
    const board = buildBoard(issues, { ...OPTS, isFolded: (key) => key === `lane:${lane1}` })
    expect(board.sections.find((s) => s.key === `lane:${lane1}`)?.folded).toBe(true)
    expect(board.order).toEqual(['repo-w', 'repo-f', 'repo-g'])
    expect(board.layout).toEqual(['repo-w', 'repo-i', 'repo-f', 'repo-g'])
  })

  it('steps off a folded-away row to the nearest row on screen', () => {
    const board = buildBoard(issues, { ...OPTS, isFolded: (key) => key === `lane:${lane1}` })
    expect(step(board, 'repo-i', 1)).toBe('repo-f')
    expect(step(board, 'repo-i', -1)).toBe('repo-w')
    expect(step(board, 'repo-g', 1)).toBe('repo-g')
    expect(step(board, null, 1)).toBe('repo-w')
  })

  it('finds every section a waiting bead shows in', () => {
    const board = buildBoard(issues, OPTS)
    expect(sectionsHolding(board, 'repo-w').map((s) => s.key)).toEqual(['waiting', `lane:${lane1}`])
  })
})

describe('default folds', () => {
  it('opens only the first section when nothing is stored', () => {
    const lane1 = FULL.lanes[0]!.label
    const board = buildBoard([bead('a', { labels: [lane1] })], {
      ...OPTS,
      isFolded: (_key, fallback) => fallback,
    })
    expect(board.sections.map((s) => [s.key, s.folded])).toEqual([
      ['waiting', false],
      [`lane:${lane1}`, true],
      ['deferred', true],
      ['closed', true],
    ])
  })

  it('opens the open section on a board with no config', () => {
    const board = buildBoard([bead('a')], {
      config: emptyConfig(),
      repoName: 'repo',
      isFolded: (_key, fallback) => fallback,
    })
    expect(board.sections[0]?.key).toBe('lane:none')
    expect(board.sections[0]?.folded).toBe(false)
  })
})

describe('unreadNote', () => {
  const comment = (id: string, kind: 'human' | 'agent' | 'unknown', self = false): Comment => ({
    id,
    issue_id: 'x',
    author: id,
    text: id,
    created_at: '2026-09-16T00:00:00Z',
    by: { kind, name: id, self },
  })

  it('is the newest note from the board human, skipping a later agent reply', () => {
    const notes = [comment('old', 'human', true), comment('mine', 'human', true), comment('reply', 'agent')]
    expect(unreadNote(notes)?.id).toBe('mine')
  })

  it('falls back to the newest unknown-author comment, never to an agent', () => {
    expect(unreadNote([comment('legacy', 'unknown'), comment('reply', 'agent')])?.id).toBe('legacy')
    expect(unreadNote([comment('reply', 'agent')])).toBeUndefined()
  })
})

describe('orderComments', () => {
  const at = (id: string, created_at: string): Comment => ({
    id,
    issue_id: 'x',
    author: 'agent:claude',
    text: id,
    created_at,
    by: { kind: 'agent', name: 'Claude', self: false },
  })
  const thread = [
    at('b', '2026-10-16T17:35:00Z'),
    at('a', '2026-10-16T09:00:00Z'),
    at('tie-1', '2026-10-17T08:00:00Z'),
    at('tie-2', '2026-10-17T08:00:00Z'),
  ]

  it('reads oldest first by time, ties in the order bd gave them', () => {
    expect(orderComments(thread, 'oldest').map((c) => c.id)).toEqual(['a', 'b', 'tie-1', 'tie-2'])
  })

  it('reads newest first as the exact reverse', () => {
    expect(orderComments(thread, 'newest').map((c) => c.id)).toEqual(['tie-2', 'tie-1', 'b', 'a'])
  })

  it('leaves the input alone', () => {
    orderComments(thread, 'newest')
    expect(thread.map((c) => c.id)).toEqual(['b', 'a', 'tie-1', 'tie-2'])
  })
})

describe('repliesAfterNote', () => {
  const c = (id: string, kind: 'human' | 'agent' | 'unknown', created_at: string, self = kind === 'human'): Comment => ({
    id,
    issue_id: 'x',
    author: id,
    text: id,
    created_at,
    by: { kind, name: id, self },
  })

  it('tags agent comments newer than the latest note, not older status updates', () => {
    const thread = [
      c('status', 'agent', '2026-10-18T09:00:00Z'),
      c('first-note', 'human', '2026-10-18T10:00:00Z'),
      c('old-answer', 'agent', '2026-10-18T11:00:00Z'),
      c('note', 'human', '2026-10-20T10:00:00Z'),
      c('answer', 'agent', '2026-10-20T11:00:00Z'),
      c('legacy', 'unknown', '2026-10-20T11:30:00Z'),
      c('follow-up', 'agent', '2026-10-20T12:00:00Z'),
    ]
    expect(latestNote(thread)?.id).toBe('note')
    expect([...repliesAfterNote(thread)]).toEqual(['answer', 'follow-up'])
  })

  it('finds the latest note by time whatever order the thread is in', () => {
    const thread = [
      c('answer', 'agent', '2026-10-20T11:00:00Z'),
      c('note', 'human', '2026-10-20T10:00:00Z'),
      c('first-note', 'human', '2026-10-18T10:00:00Z'),
    ]
    expect([...repliesAfterNote(thread)]).toEqual(['answer'])
  })

  it('tags nothing when the human never commented, or wrote last', () => {
    expect(repliesAfterNote([c('a', 'agent', '2026-10-20T11:00:00Z')]).size).toBe(0)
    expect(
      repliesAfterNote([c('a', 'agent', '2026-10-20T11:00:00Z'), c('note', 'human', '2026-10-20T12:00:00Z')]).size,
    ).toBe(0)
    // another human's comment is no note from the board's human
    expect(
      repliesAfterNote([c('jan', 'human', '2026-10-20T10:00:00Z', false), c('a', 'agent', '2026-10-20T11:00:00Z')]).size,
    ).toBe(0)
  })
})

describe('foldPoint', () => {
  const detail = 'The full detail, with ids, paths and commands, runs on for the next session. '.repeat(4)

  it('folds a conventional comment to its headline line', () => {
    expect(foldPoint(`Shipped the folded comments; nothing for you to do.\n\n${detail}`)).toBe(
      'Shipped the folded comments; nothing for you to do.',
    )
  })

  it('leaves a short comment whole', () => {
    expect(foldPoint('all done, works great')).toBeNull()
    expect(foldPoint('headline\n\ntwo short lines of detail')).toBeNull()
  })

  it('gives the first sentence of a long single paragraph', () => {
    const text = `11 Sep: v2 job prompts written, runbook in v2-runbook.md. ${detail}`
    expect(foldPoint(text)).toBe('11 Sep: v2 job prompts written, runbook in v2-runbook.md.')
  })

  it('does not end a sentence at an abbreviation, a version or inside code', () => {
    const text = `Bumped to v1.3.0 e.g. for the journal, see \`a. b\` too. ${detail}`
    expect(foldPoint(text)).toBe('Bumped to v1.3.0 e.g. for the journal, see `a. b` too.')
  })

  it('cuts a run-on first sentence at a word, inside about two rows', () => {
    const text = `${'word '.repeat(80)}end. ${detail}`
    const head = foldPoint(text)
    expect(head?.endsWith('\u2026')).toBe(true)
    expect(head!.length).toBeLessThanOrEqual(HEADLINE_MAX + 1)
  })

  it('takes a long first line as a sentence even when more lines follow', () => {
    const text = `First sentence of a long opening line. ${'more of it '.repeat(30)}\n\n${detail}`
    expect(foldPoint(text)).toBe('First sentence of a long opening line.')
  })

  it('does not fold a comment that opens with a code fence or a table', () => {
    expect(foldPoint(`\`\`\`\ncode\n\`\`\`\n${detail}`)).toBeNull()
    expect(foldPoint(`| a | b |\n|---|---|\n${detail}`)).toBeNull()
  })

  it('does not cut a link open', () => {
    const text = `See [the page (draft)](https://example.com/a. b) for it. ${detail}`
    expect(foldPoint(text)).toBe('See [the page (draft)](https://example.com/a. b) for it.')
  })
})
