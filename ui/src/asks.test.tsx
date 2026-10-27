import { createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { BoardConfig, Issue } from './api'
import { askOf, parseAsk, raisedText } from './asks'
import { DetailPane } from './components/detail-pane'
import { InboxList } from './components/inbox-list'
import { buildInbox, type InboxOptions } from './inbox'

const CONFIG: BoardConfig = {
  human: { id: 'human:tester', name: 'Tester' },
  agentsview: null,
  notesDir: null,
  lanes: [],
  unlaned: { title: 'no lane', note: null },
  subLabels: [],
  waiting: { labels: ['needs-human'], title: 'waiting on you', note: null },
  note: { addLabel: 'human-note', offerToClear: ['needs-human'] },
  inbox: { labels: ['needs-human'] },
  thoughts: null,
  flags: [],
  capture: { labels: [] },
  asks: { key: 'ask', title: 'decisions', note: null },
  derived: { allFlags: ['needs-human', 'human-note'], hotChips: ['human-note'] },
}

const NOW = new Date(2026, 9, 28, 8, 0)
const OPTS: InboxOptions = { config: CONFIG, now: NOW, seen: {}, picks: [], read: [], holding: null }

const ASK = {
  title: 'GitHub Specialist',
  question: 'apply or pass?',
  options: [
    { k: 'apply', sub: 'one AI interview' },
    { k: 'pass', sub: 'the country list says no' },
  ],
  lean: 'apply',
  why: 'worth one interview',
  first_raised: '2026-10-26',
  last_raised: '2026-10-28',
  days_raised: 3,
}
const ANSWERED = { ...ASK, answered: { at: '2026-10-28T07:00:00Z', by: 'human:tester', via: 'hub', text: 'pass, not this one' } }

function bead(id: string, over: Partial<Issue> = {}): Issue {
  return {
    id: `repo-${id}`,
    title: id,
    description: '',
    status: 'open',
    priority: 2,
    issue_type: 'task',
    labels: [],
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-27T00:00:00Z',
    comment_count: 0,
    dependency_count: 0,
    dependent_count: 0,
    ...over,
  }
}

describe('parseAsk', () => {
  it('reads the stored question and its answer', () => {
    expect(parseAsk({ ask: ASK }, 'ask')).toMatchObject({ question: 'apply or pass?', lean: 'apply', answered: null })
    expect(parseAsk({ ask: ANSWERED }, 'ask')?.answered).toEqual(ANSWERED.answered)
    expect(parseAsk({ ask: { options: [] } }, 'ask')).toBeNull()
    expect(parseAsk({ other: ASK }, 'ask')).toBeNull()
  })

  it('reads nothing with asks off or on a closed bead', () => {
    expect(askOf(bead('a', { metadata: { ask: ASK } }), { ...CONFIG, asks: null })).toBeNull()
    expect(askOf(bead('a', { status: 'closed', metadata: { ask: ASK } }), CONFIG)).toBeNull()
    expect(askOf(bead('a', { status: 'pinned', metadata: { ask: ASK } }), CONFIG)).not.toBeNull()
  })

  it('counts the days raised', () => {
    expect(raisedText({ ...parseAsk({ ask: ASK }, 'ask')!, days_raised: 1 })).toBe('raised once')
    expect(raisedText(parseAsk({ ask: ASK }, 'ask')!)).toBe('raised 3 days')
    expect(raisedText({ ...parseAsk({ ask: ASK }, 'ask')!, days_raised: null })).toBe('')
  })
})

describe('the decisions section', () => {
  const issues = [
    bead('reply', { agent_reply: { at: '2026-10-27T10:00:00Z', name: 'Claude' } }),
    bead('once', { metadata: { ask: { ...ASK, days_raised: 1 } } }),
    bead('thrice', { metadata: { ask: ASK } }),
    bead('done', { metadata: { ask: ANSWERED } }),
    bead('gone', { status: 'closed', metadata: { ask: ASK } }),
  ]

  it('sits at the top: open questions longest asked first, answered ones after, closed beads out', () => {
    const inbox = buildInbox(issues, OPTS)
    expect(inbox.sections.map((s) => s.key)).toEqual(['ask', 'reply'])
    expect(inbox.sections[0]?.title).toBe('decisions')
    expect(inbox.sections[0]?.rows.map((i) => i.id)).toEqual(['repo-thrice', 'repo-once', 'repo-done'])
    expect([...inbox.answered]).toEqual(['repo-done'])
    // the answered question waits for a session and is not counted
    expect(inbox.count).toBe(3)
  })

  it('is absent with asks off', () => {
    const inbox = buildInbox(issues, { ...OPTS, config: { ...CONFIG, asks: null } })
    expect(inbox.sections.map((s) => s.key)).toEqual(['reply'])
  })

  it('renders the question on open rows and the answer, dimmed, on answered ones', () => {
    const inbox = buildInbox(issues, OPTS)
    const noop = () => {}
    const html = renderToStaticMarkup(
      <InboxList
        inbox={inbox}
        repoName="repo"
        config={CONFIG}
        selected={null}
        now={NOW}
        onSelect={noop}
        onBoard={noop}
        onToggleSection={noop}
        onRedate={noop}
        onKeep={noop}
        onSnooze={noop}
        onClose={noop}
      />,
    )
    expect(html).toContain('apply or pass? · raised 3 days')
    expect(html).toContain('you answered 28 Oct: pass, not this one, waiting for a session')
    expect(html).toMatch(/class="irow seen"[^>]*>.*?answered/)
    // two open questions counted in the head, not three
    expect(html).toMatch(/<span>decisions<\/span><span class="n">2<\/span>/)
  })
})

describe('the ask card', () => {
  const render = (issue: Issue) => {
    const noop = () => {}
    return renderToStaticMarkup(
      <DetailPane
        issue={issue}
        detail={{ issue, comments: [], sessions: null, notes: [], note_read: null }}
        repoName="repo"
        config={CONFIG}
        human="Tester"
        knownLabels={[]}
        reveal={null}
        noteRef={createRef()}
        note=""
        onNoteChange={noop}
        clear
        onClearChange={noop}
        onSend={noop}
        sending={false}
        onPriority={noop}
        onStatus={noop}
        onLabels={noop}
        onCopyId={noop}
        onBack={noop}
        links={[]}
        byId={new Map()}
        onOpenLink={noop}
        folds={{ isFolded: (_key, fallback) => fallback, setFolded: noop }}
        onAnswer={async () => true}
      />,
    )
  }

  it('pins an open question above the description with its options and an answer box', () => {
    const html = render(bead('a1', { metadata: { ask: ASK } }))
    expect(html.indexOf('class="ask"')).toBeGreaterThan(-1)
    expect(html.indexOf('class="ask"')).toBeLessThan(html.indexOf('description'))
    expect(html).toContain('apply or pass?')
    expect(html).toContain('<b>apply</b><span class="asklean">lean</span>')
    expect(html).toContain('aria-label="answer for a1"')
    expect(html).toContain('raised 3 days')
  })

  it('shows an answered question as waiting for a session, with no box', () => {
    const html = render(bead('a1', { metadata: { ask: ANSWERED } }))
    expect(html).toContain('class="ask answered"')
    expect(html).toContain('waiting for a session to act on it')
    expect(html).toContain('pass, not this one')
    expect(html).not.toContain('aria-label="answer for a1"')
  })

  it('shows nothing without a question', () => {
    expect(render(bead('a1'))).not.toContain('class="ask')
  })
})
