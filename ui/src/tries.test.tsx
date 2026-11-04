import { createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { BoardConfig, Issue } from './api'
import { DetailPane } from './components/detail-pane'
import { TryList } from './components/inbox-list'
import { buildInbox, isStale } from './inbox'
import { isReadyToTry, parseTry, qrPath, readyToTry, tryOf } from './tries'

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
  asks: null,
  tryIt: { label: 'try-it', key: 'try', title: 'ready to try', note: null },
  derived: { allFlags: ['needs-human', 'human-note', 'try-it'], hotChips: ['human-note'] },
}

const KIT = {
  title: 'Drag the reader sheet on your Galaxy',
  app: 'reader',
  where: 'phone',
  why: 'Real touch gestures cannot be checked headless.',
  verified: 'Playwright drag tests on the deployed build.',
  expect: 'The sheet follows an early drag.',
  shipped: '2026-10-27',
  minutes: 3,
  kit: [
    { type: 'link', label: 'open the reader', href: 'https://read.example' },
    { type: 'copy', label: 'build id', text: 'abc123' },
    { type: 'qr', label: 'scan on the phone', text: 'https://read.example' },
    { type: 'image', src: '/home/x/shot.png', alt: 'the sheet' },
    { type: 'spec', label: 'phone', value: 'Galaxy S24' },
    { type: 'path', label: 'log', path: '~/log.txt', href: '/home/x/log.txt' },
  ],
  steps: [{ id: 'early', title: 'Start dragging as the sheet opens', note: 'right away' }, 'Then let go'],
}

const NOW = new Date(2026, 10, 4, 8, 0)

function bead(id: string, over: Partial<Issue> = {}): Issue {
  return {
    id: `repo-${id}`,
    title: id,
    description: '',
    status: 'open',
    priority: 2,
    issue_type: 'task',
    labels: ['try-it'],
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    comment_count: 0,
    dependency_count: 0,
    dependent_count: 0,
    metadata: { try: KIT },
    ...over,
  }
}

describe('the try model', () => {
  it('reads the kit and nothing with try-it off, on a closed bead or without the label', () => {
    expect(tryOf(bead('a'), CONFIG)).toMatchObject({ title: KIT.title, app: 'reader', minutes: 3 })
    expect(parseTry({ try: KIT }, 'try')?.steps.map((s) => s.id)).toEqual(['early', '2'])
    expect(tryOf(bead('a'), { ...CONFIG, tryIt: null })).toBeNull()
    expect(tryOf(bead('a', { status: 'closed' }), CONFIG)).toBeNull()
    expect(tryOf(bead('a', { labels: [] }), CONFIG)).toBeNull()
    expect(isReadyToTry(bead('a', { metadata: {} }), CONFIG)).toBe(true)
  })

  it('groups by app, alphabetical, beads with no app last, titles sorted within', () => {
    const issues = [
      bead('s', { metadata: { try: { ...KIT, app: 'spotify', title: 'play' } } }),
      bead('r2', { metadata: { try: { ...KIT, title: 'zoom in' } } }),
      bead('none', { metadata: {} }),
      bead('r1', { metadata: { try: { ...KIT, title: 'drag' } } }),
      bead('closed', { status: 'closed' }),
      bead('other', { labels: ['infra'] }),
    ]
    const groups = readyToTry(issues, CONFIG)
    expect(groups.map((g) => [g.app, g.issues.map((i) => i.id)])).toEqual([
      ['reader', ['repo-r1', 'repo-r2']],
      ['spotify', ['repo-s']],
      [null, ['repo-none']],
    ])
    expect(readyToTry(issues, { ...CONFIG, tryIt: null })).toEqual([])
  })

  it('leaves deferred checks out of the list until they wake', () => {
    const day = 86_400_000
    const ahead = new Date(NOW.getTime() + 7 * day).toISOString()
    const behind = new Date(NOW.getTime() - day).toISOString()
    const issues = [
      bead('iced', { status: 'deferred' }),
      bead('snoozed', { status: 'deferred', defer_until: ahead }),
      bead('dated', { defer_until: ahead }),
      bead('woke', { status: 'deferred', defer_until: behind }),
      bead('open', { defer_until: behind }),
    ]
    expect(readyToTry(issues, CONFIG, NOW).flatMap((g) => g.issues.map((i) => i.id))).toEqual(['repo-open', 'repo-woke'])
    // its own page still shows the check, so a verdict can be given while it sleeps
    expect(tryOf(issues[0]!, CONFIG)).not.toBeNull()
  })

  it('a due date a check kept from before never puts it in the inbox', () => {
    const due = (at: Date) => buildInbox([bead('due', { due_at: at.toISOString() })], { config: CONFIG, now: NOW, seen: {}, picks: [], read: [], holding: null })
    const overdue = due(new Date(2026, 9, 1))
    expect(overdue.sections.find((s) => s.key === 'due')).toBeUndefined()
    expect(overdue.count).toBe(0)
    expect(due(new Date(NOW.getTime() + 86_400_000)).count).toBe(0)
    // the same bead without the label is due as before
    const plain = buildInbox([bead('due', { labels: ['infra'], due_at: new Date(2026, 9, 1).toISOString() })], {
      config: CONFIG,
      now: NOW,
      seen: {},
      picks: [],
      read: [],
      holding: null,
    })
    expect(plain.sections.find((s) => s.key === 'due')?.rows.map((i) => i.id)).toEqual(['repo-due'])
  })

  it('never calls a check stale and keeps it out of the inbox', () => {
    const old = bead('old')
    expect(isStale(old, NOW, CONFIG)).toBe(false)
    expect(isStale(old, NOW, { ...CONFIG, tryIt: null })).toBe(true)
    const inbox = buildInbox([old], { config: CONFIG, now: NOW, seen: {}, picks: ['repo-old'], read: [], holding: null })
    expect(inbox.count).toBe(0)
  })

  it('draws a square qr code', () => {
    const { size, d } = qrPath('https://read.example/č')
    expect(size).toBeGreaterThan(20)
    expect(d).toMatch(/^M\d+ \d+h1v1h-1z/)
  })
})

describe('the ready to try list and card', () => {
  const noop = () => {}

  it('lists checks under their app with the action, where and minutes', () => {
    const groups = readyToTry([bead('a'), bead('b', { metadata: {} })], CONFIG)
    const html = renderToStaticMarkup(
      <TryList
        groups={groups}
        repoName="repo"
        config={CONFIG}
        selected={null}
        now={NOW}
        onSelect={noop}
        onRedate={noop}
        onKeep={noop}
        onSnooze={noop}
        onClose={noop}
      />,
    )
    expect(html).toMatch(/<span>ready to try<\/span><span class="n">2<\/span>/)
    expect(html).toContain('<span class="chip">reader</span>')
    expect(html).toContain('Drag the reader sheet on your Galaxy · phone · 3 min')
    expect(html).toContain('no check kit stored on this bead yet')
  })

  const render = (issue: Issue) =>
    renderToStaticMarkup(
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
        onVerdict={async () => true}
        onCopyText={noop}
      />,
    )

  it('pins the check above the description with the kit, the steps and the three verdicts', () => {
    const html = render(bead('a'))
    expect(html.indexOf('class="ask try"')).toBeGreaterThan(-1)
    expect(html.indexOf('class="ask try"')).toBeLessThan(html.indexOf('description'))
    expect(html).toContain('Drag the reader sheet on your Galaxy')
    expect(html).toContain('The sheet follows an early drag.')
    expect(html).toContain('href="https://read.example"')
    expect(html).toContain('<b>build id</b><span class="asklean">copy</span>')
    expect(html).toContain('aria-label="qr code: scan on the phone"')
    expect(html).toContain('src="/api/tries/repo-a/image/0"')
    expect(html).toContain('<b>Galaxy S24</b>')
    expect(html).toContain('~/log.txt')
    expect(html).toMatch(/<ol class="trysteps"><li>Start dragging as the sheet opens<span class="trynote"> right away<\/span><\/li><li>Then let go<\/li><\/ol>/)
    for (const word of ['Works', 'Still broken', 'Couldn&#x27;t check']) expect(html).toContain(`>${word}</button>`)
  })

  it('says what came back last time', () => {
    const html = render(bead('a', { metadata: { try: { ...KIT, last: { result: 'cant', at: '2026-11-01T10:00:00Z', note: 'no release' } } } }))
    expect(html).toContain("you couldn&#x27;t check it: no release")
  })

  it('shows no check once the label is gone', () => {
    expect(render(bead('a', { labels: [] }))).not.toContain('class="ask try"')
  })
})
