import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app'
import { answeredAsk, askEntries, assertVia, MAX_ANSWER_TEXT, parseAsk } from './asks'
import { BeadsClient, type IssueWithComments, type RunResult } from './bd'
import { resolveConfig } from './config'

const ASK = {
  title: 'micro1 GitHub Specialist',
  question: 'apply or pass?',
  options: [
    { k: 'apply', sub: 'one AI interview' },
    { k: 'pass', sub: 'the country list says no' },
  ],
  lean: 'apply',
  why: 'worth one interview',
  first_raised: '2026-10-27',
  last_raised: '2026-10-28',
  days_raised: 2,
}

const entry = (id: string, status: string, metadata?: Record<string, unknown>): IssueWithComments => ({
  issue: {
    id,
    title: `bead ${id}`,
    description: '',
    status: status as 'open',
    priority: 2,
    issue_type: 'task',
    labels: [],
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    comment_count: 0,
    dependency_count: 0,
    dependent_count: 0,
    ...(metadata ? { metadata } : {}),
  },
  comments: [],
})

describe('parseAsk', () => {
  it('reads the stored question with every field', () => {
    const ask = parseAsk({ ask: ASK, quick: { x: 1 } }, 'ask')
    expect(ask).toEqual({
      ...ASK,
      due: null,
      answered: null,
    })
  })

  it('reads an answer, a string-stored value and bare option words', () => {
    const answered = parseAsk(
      { ask: { ...ASK, answered: { at: '2026-10-28T07:00:00Z', by: 'human:mike', via: 'hub', text: 'apply' } } },
      'ask',
    )
    expect(answered?.answered).toEqual({ at: '2026-10-28T07:00:00Z', by: 'human:mike', via: 'hub', text: 'apply' })
    expect(parseAsk({ ask: JSON.stringify({ question: 'go?', options: ['yes', 'no'] }) }, 'ask')?.options).toEqual([
      { k: 'yes', sub: null },
      { k: 'no', sub: null },
    ])
  })

  it('returns null for no metadata, another key, or a value with no question', () => {
    expect(parseAsk(undefined, 'ask')).toBeNull()
    expect(parseAsk({ quick: {} }, 'ask')).toBeNull()
    expect(parseAsk({ ask: { options: [] } }, 'ask')).toBeNull()
    expect(parseAsk({ ask: 'not json' }, 'ask')).toBeNull()
    expect(parseAsk({ ask: [1, 2] }, 'ask')).toBeNull()
  })
})

describe('answeredAsk', () => {
  it('keeps every stored field and fills the answer, cutting long text', () => {
    const at = new Date('2026-10-28T07:00:00Z')
    const out = answeredAsk({ ...ASK, extra: 'kept' }, { text: '  apply  ', by: 'human:mike', via: 'hub', at })
    expect(out).toMatchObject({ ...ASK, extra: 'kept', answered: { at: at.toISOString(), by: 'human:mike', via: 'hub', text: 'apply' } })
    const long = answeredAsk(ASK, { text: 'x'.repeat(2000), by: 'human:mike', via: 'beadside', at })
    expect((long['answered'] as { text: string }).text).toHaveLength(MAX_ANSWER_TEXT)
  })

  it('accepts only the known vias', () => {
    expect(assertVia(undefined)).toBe('beadside')
    expect(assertVia('hub')).toBe('hub')
    expect(() => assertVia('elsewhere')).toThrowError(/via must be/)
  })
})

describe('askEntries', () => {
  const corpus = [
    entry('repo-a1', 'open', { ask: ASK }),
    entry('repo-a2', 'closed', { ask: ASK }),
    entry('repo-a3', 'pinned', { ask: { ...ASK, answered: { at: 'x', by: 'human:mike' } } }),
    entry('repo-a4', 'open'),
    entry('repo-a5', 'closed'),
  ]

  it('lists live beads with a question, open or answered, and leaves closed ones out', () => {
    expect(askEntries(corpus, 'ask', 'repo').map((e) => e.id)).toEqual(['repo-a1', 'repo-a3'])
  })

  it('adds wanted ids in any state, short or full', () => {
    const out = askEntries(corpus, 'ask', 'repo', ['a2', 'repo-a5', 'a4'])
    expect(out.map((e) => [e.id, e.status, e.ask ? 'ask' : null])).toEqual([
      ['repo-a1', 'open', 'ask'],
      ['repo-a2', 'closed', 'ask'],
      ['repo-a3', 'pinned', 'ask'],
      ['repo-a4', 'open', null],
      ['repo-a5', 'closed', null],
    ])
  })
})

describe('asks config', () => {
  it('is off without a block and fills defaults with one', () => {
    expect(resolveConfig({}).asks).toBeNull()
    expect(resolveConfig({ asks: {} }).asks).toEqual({ key: 'ask', title: 'decisions', note: null })
    expect(resolveConfig({ asks: { key: 'hub.ask', title: 'asks', note: 'n' } }).asks).toEqual({
      key: 'hub.ask',
      title: 'asks',
      note: 'n',
    })
    expect(() => resolveConfig({ asks: { key: '-x' } })).toThrowError(/asks\.key/)
    expect(() => resolveConfig({ asks: { key: 'two words' } })).toThrowError(/asks\.key/)
    expect(() => resolveConfig({ asks: [] })).toThrowError(/asks must be an object/)
  })
})

describe('asks routes', () => {
  const TOKEN = 'test-token'
  let repo: string
  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'beadside-asks-'))
  })

  const ok = (stdout: string): RunResult => ({ stdout, stderr: '', code: 0 })

  /** an app over one bead whose metadata the canned bd keeps, so a write shows on the next read */
  function appFor(asks: unknown, metadata: Record<string, unknown> | null = { ask: ASK }) {
    const calls: string[][] = []
    let meta = metadata
    let labels = ['needs-human']
    const record = () => ({
      ...entry('repo-abc', 'open', meta ?? undefined).issue,
      labels,
    })
    const runner = async (args: string[]): Promise<RunResult> => {
      calls.push(args)
      if (args[0] === 'export') return ok(`${JSON.stringify({ _type: 'issue', ...record() })}\n`)
      if (args[0] === 'show') return ok(JSON.stringify([record()]))
      if (args[0] === 'comments' && args[1] !== 'add') return ok('[]')
      if (args[0] === 'update') {
        for (const arg of args) {
          if (arg.startsWith('--metadata=')) meta = { ...meta, ...(JSON.parse(arg.slice('--metadata='.length)) as object) }
          if (arg.startsWith('--add-label=')) labels = [...labels, arg.slice('--add-label='.length)]
          if (arg.startsWith('--remove-label=')) labels = labels.filter((l) => l !== arg.slice('--remove-label='.length))
        }
      }
      return ok('')
    }
    const app = createApp({
      client: new BeadsClient(repo, runner, { actor: 'human:tester' }),
      repo: { name: 'repo', path: repo },
      agentsview: null,
      human: { id: 'human:tester', name: 'Tester' },
      token: TOKEN,
      config: resolveConfig({ note: { addLabel: 'from-human', offerToClear: ['needs-human'] }, asks }),
    })
    return { app, calls, meta: () => meta, labels: () => labels }
  }

  const answer = (body: unknown, token: string | null = TOKEN) =>
    new Request('http://localhost/api/issues/repo-abc/ask/answer', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { 'x-bd-token': token } : {}) },
      body: JSON.stringify(body),
    })

  it('404s both routes when asks are off', async () => {
    const { app, calls } = appFor(undefined)
    expect((await app.request('/api/asks')).status).toBe(404)
    expect((await app.request(answer({ text: 'apply' }))).status).toBe(404)
    expect(calls).toEqual([])
  })

  it('lists the open questions with their key', async () => {
    const { app } = appFor({})
    const body = (await (await app.request('/api/asks?ids=abc')).json()) as { key: string; asks: { id: string; ask: unknown }[] }
    expect(body.key).toBe('ask')
    expect(body.asks).toHaveLength(1)
    expect(body.asks[0]).toMatchObject({ id: 'repo-abc', status: 'open', ask: { question: 'apply or pass?' } })
  })

  it('refuses a bad id in the list', async () => {
    const { app } = appFor({})
    expect((await app.request('/api/asks?ids=--force')).status).toBe(400)
  })

  it('needs the token to answer', async () => {
    const { app, calls } = appFor({})
    expect((await app.request(answer({ text: 'apply' }, null))).status).toBe(403)
    expect(calls).toEqual([])
  })

  it('answers: the note as the human with the note flag, waiting labels cleared, then the stamped question', async () => {
    const { app, calls, meta, labels } = appFor({})
    const res = await app.request(answer({ text: 'apply, after Friday', via: 'hub' }))
    expect(res.status).toBe(200)
    const writes = calls.filter((a) => a[0] === 'comments' && a[1] === 'add' || a[0] === 'update')
    expect(writes[0]).toEqual(['comments', 'add', 'repo-abc', '--author=human:tester', '--', 'apply, after Friday'])
    expect(writes[1]).toEqual(['update', 'repo-abc', '--add-label=from-human', '--remove-label=needs-human'])
    expect(writes[2]?.[2]).toMatch(/^--metadata=/)
    const stored = meta()?.['ask'] as Record<string, unknown>
    expect(stored).toMatchObject({ ...ASK, answered: { by: 'human:tester', via: 'hub', text: 'apply, after Friday' } })
    expect(labels()).toEqual(['from-human'])
    const detail = (await res.json()) as { issue: { metadata: Record<string, unknown> } }
    expect((detail.issue.metadata['ask'] as { answered: unknown }).answered).toBeTruthy()
  })

  it('keeps the waiting labels when asked to', async () => {
    const { app, calls } = appFor({})
    await app.request(answer({ text: 'pass', clear: false }))
    expect(calls.find((a) => a[0] === 'update' && a.some((x) => x.startsWith('--add-label')))).toEqual([
      'update',
      'repo-abc',
      '--add-label=from-human',
    ])
  })

  it('writes the question under the configured key', async () => {
    const { app, meta } = appFor({ key: 'hubask' }, { hubask: ASK, quick: { a: 1 } })
    expect((await app.request(answer({ text: 'pass' }))).status).toBe(200)
    expect(meta()).toMatchObject({ quick: { a: 1 }, hubask: { answered: { text: 'pass', via: 'beadside' } } })
  })

  it('refuses a bead with no question, an empty answer and an unknown via, writing nothing', async () => {
    const none = appFor({}, null)
    expect((await none.app.request(answer({ text: 'apply' }))).status).toBe(409)
    expect(none.calls.some((a) => a[0] === 'update' || a[1] === 'add')).toBe(false)
    const { app, calls } = appFor({})
    expect((await app.request(answer({ text: '   ' }))).status).toBe(400)
    expect((await app.request(answer({ text: 'x', via: 'mail' }))).status).toBe(400)
    expect((await app.request(answer({ text: 'x', clear: 'yes' }))).status).toBe(400)
    expect(calls.some((a) => a[0] === 'update' || a[1] === 'add')).toBe(false)
  })
})
