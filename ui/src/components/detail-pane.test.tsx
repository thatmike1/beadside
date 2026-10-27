import { createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { BoardConfig, Comment, Issue, NoteRead } from '../api'
import { DetailPane } from './detail-pane'

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
  thoughts: { label: 'idea', title: 'ideas', note: null },
  flags: [],
  capture: { labels: [] },
  asks: null,
  derived: { allFlags: ['needs-human', 'human-note', 'idea'], hotChips: ['human-note'] },
}

const ISSUE: Issue = {
  id: 'repo-a1',
  title: 'a bead',
  description: 'the description',
  status: 'open',
  priority: 2,
  issue_type: 'task',
  labels: ['human-note'],
  created_at: '2026-10-01T10:00:00Z',
  updated_at: '2026-10-16T17:35:00Z',
  comment_count: 3,
  dependency_count: 0,
  dependent_count: 0,
}

const comment = (id: string, created_at: string, self: boolean): Comment => ({
  id,
  issue_id: ISSUE.id,
  author: self ? 'human:tester' : 'agent:claude',
  text: `text of ${id}`,
  created_at,
  by: self ? { kind: 'human', name: 'Tester', self: true } : { kind: 'agent', name: 'Claude', self: false },
})

const COMMENTS = [
  comment('first', '2026-10-15T08:00:00Z', false),
  comment('mine', '2026-10-16T17:35:00Z', true),
  comment('later', '2026-10-17T09:00:00Z', false),
]

function render(
  issue: Issue = ISSUE,
  comments: Comment[] = COMMENTS,
  noteRead: NoteRead | null = null,
): string {
  const noop = () => {}
  return renderToStaticMarkup(
    <DetailPane
      issue={issue}
      detail={{ issue, comments, sessions: null, notes: [], note_read: noteRead }}
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

describe('detail pane comments', () => {
  it('keeps the unread note in its place in one thread, marked unread', () => {
    const html = render()
    expect(html).not.toContain('other comments')
    expect(html.match(/id="comment-mine"/g)).toHaveLength(1)
    const order = ['first', 'mine', 'later'].map((id) => html.indexOf(`id="comment-${id}"`))
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(html).toMatch(/class="comment mine human unread"[^>]*id="comment-mine"/)
    expect(html).toContain('class="unreadtag"')
    // the pointer above the description sits before it and repeats no note text
    expect(html.indexOf('your note is still unread')).toBeLessThan(html.indexOf('data-field="description"'))
    expect(html.match(/text of mine/g)).toHaveLength(1)
  })

  it('marks nothing unread once the note flag is gone', () => {
    const html = render({ ...ISSUE, labels: [] })
    expect(html).not.toContain('unreadtag')
    expect(html).not.toContain('still unread')
  })

  it('shows each comment with its day and time', () => {
    const local = new Date('2026-10-16T17:35:00Z')
    const hhmm = local.toTimeString().slice(0, 5)
    expect(render()).toContain(`${local.getDate()} Oct 2026 ${hhmm}`)
  })

  it('heads the comments with the order they read in', () => {
    expect(render()).toContain('oldest first')
  })
})

describe('detail pane replies, read marker and folds', () => {
  const READ: NoteRead = {
    at: '2026-10-16T18:04:00Z',
    actor: 'agent:claude',
    by: { kind: 'agent', name: 'Claude', self: false },
    source: 'label',
  }

  it('tags agent comments after the latest note as replies, not the ones before it', () => {
    const html = render()
    expect(html).toMatch(/id="comment-later"[\s\S]*?class="replytag"/)
    const first = html.slice(html.indexOf('id="comment-first"'), html.indexOf('id="comment-mine"'))
    expect(first).not.toContain('replytag')
  })

  it('shows who read the note and when, only once the flag is gone', () => {
    const html = render({ ...ISSUE, labels: [] }, COMMENTS, READ)
    const mine = html.slice(html.indexOf('id="comment-mine"'), html.indexOf('id="comment-later"'))
    expect(mine).toMatch(/class="readtag"[^>]*>read by Claude, \d+ Oct \d\d:\d\d</)
    // still flagged: the note is unread, whatever the server sent
    expect(render(ISSUE, COMMENTS, READ)).not.toContain('class="readtag')
  })

  it('marks a read guessed from the first reply as a guess', () => {
    const html = render({ ...ISSUE, labels: [] }, COMMENTS, { ...READ, source: 'reply' })
    expect(html).toContain('class="readtag guess"')
    expect(html).toContain('answered by Claude')
  })

  it('folds a long comment to its headline behind more', () => {
    const long = {
      ...comment('long', '2026-10-17T10:00:00Z', false),
      text: `Shipped it; nothing for you to do.\n\n${'The full detail for the next session. '.repeat(12)}`,
    }
    const html = render(ISSUE, [...COMMENTS, long])
    const row = html.slice(html.indexOf('id="comment-long"'))
    expect(row).toContain('Shipped it; nothing for you to do.')
    expect(row).not.toContain('The full detail')
    expect(row).toMatch(/class="cmore" aria-expanded="false">more</)
    // short comments carry no toggle
    expect(html.match(/class="cmore"/g)).toHaveLength(1)
  })

  it('puts the relative age of every comment date on hover', () => {
    expect(render()).toMatch(/<span title="[^"]+ ago">\d+ Oct 2026 \d\d:\d\d<\/span>/)
  })
})
