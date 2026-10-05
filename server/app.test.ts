import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { createApp, createBoard, idsOriginAllowed } from './app'
import { BeadsClient, type Comment, type Follower, type FollowHandlers, type Issue, type RunResult, type Runner } from './bd'
import { resolveConfig, type ResolvedBoardConfig } from './config'
import type { NoteHit, SessionHit } from './joins'

interface SessionBody {
  token: string
  repo: { name: string; path: string }
  agentsview: string | null
  me: string
  human: { id: string; name: string }
  config: ResolvedBoardConfig
}
interface ListBody {
  issues: Issue[]
  fetchedAt: string
}
interface DetailBody {
  issue: Issue
  comments: Comment[]
  sessions: SessionHit[] | null
  notes: NoteHit[]
}
interface IssueBody {
  issue: Issue
}

/** reads a json response into the shape the contract promises */
async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

const TOKEN = 'test-token'

const issueRecord = (overrides: Record<string, unknown> = {}) => ({
  id: 'repo-abc',
  title: 'a bead',
  description: 'body',
  status: 'open',
  priority: 2,
  issue_type: 'task',
  labels: ['test-label', 'needs-human'],
  created_at: '2026-09-09T10:00:00Z',
  updated_at: '2026-09-09T10:00:00Z',
  comment_count: 1,
  dependency_count: 0,
  dependent_count: 0,
  ...overrides,
})

let repo: string
let testConfig: ResolvedBoardConfig

/** an app wired to a BeadsClient whose bd calls are canned and recorded */
function appFor(configOverrides?: Partial<ResolvedBoardConfig>) {
  const calls: string[][] = []
  const runner: Runner = async (args): Promise<RunResult> => {
    calls.push(args)
    if (args[0] === 'export') return ok(`${JSON.stringify({ _type: 'issue', ...issueRecord() })}\n`)
    if (args[0] === 'show') {
      if (args[1] === 'repo-missing') return { stdout: '', stderr: 'no issue found', code: 1 }
      return ok(JSON.stringify([issueRecord()]))
    }
    if (args[0] === 'comments') {
      return ok(
        JSON.stringify([
          { id: 'c1', issue_id: 'repo-abc', author: 'tester', text: 'hi', created_at: 'x' },
        ]),
      )
    }
    if (args[0] === 'q') return ok('repo-abc\n')
    return ok('')
  }
  const app = createApp({
    client: new BeadsClient(repo, runner, { actor: 'human:tester' }),
    repo: { name: 'repo', path: repo },
    agentsview: null,
    human: { id: 'human:tester', name: 'Tester' },
    token: TOKEN,
    config: { ...testConfig, ...configOverrides },
  })
  return { app, calls }
}

const ok = (stdout: string): RunResult => ({ stdout, stderr: '', code: 0 })
const post = (path: string, body: unknown, token: string | null = TOKEN) =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { 'x-bd-token': token } : {}) },
    body: JSON.stringify(body),
  })

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), 'beadside-test-'))
  await mkdir(join(repo, 'notes-folder'))
  await writeFile(
    join(repo, 'notes-folder', 'project_thing.md'),
    'unrelated\n- repo-abc is the bead for the thing\n',
  )
  testConfig = resolveConfig({
    notesDir: 'notes-folder',
    note: { addLabel: 'from-human', offerToClear: ['needs-human'] },
    capture: { labels: ['idea', 'fun-tag'] },
  })
})

describe('reads', () => {
  it('hands out the token, repo, me, and resolved config', async () => {
    const { app } = appFor()
    const body = await json<SessionBody>(await app.request('/api/session'))
    expect(body.token).toBe(TOKEN)
    expect(body.repo).toEqual({ name: 'repo', path: repo })
    expect(body.agentsview).toBeNull()
    expect(body.me).toBe('human:tester')
    expect(body.human).toEqual({ id: 'human:tester', name: 'Tester' })
    expect(body.config.notesDir).toBe('notes-folder')
    expect(body.config.note.addLabel).toBe('from-human')
    expect(body.config.capture.labels).toEqual(['idea', 'fun-tag'])
  })

  it('lists issues with a fetch timestamp', async () => {
    const { app } = appFor()
    const body = await json<ListBody>(await app.request('/api/issues'))
    expect(body.issues).toHaveLength(1)
    expect(body.issues[0]).not.toHaveProperty('_type')
    expect(Number.isNaN(Date.parse(body.fetchedAt))).toBe(false)
  })

  it('lists bare ids, readable from the T3 renderer but not from a website', async () => {
    const { app } = appFor()
    const fromT3 = await app.request('/api/issue-ids', { headers: { origin: 't3code://app' } })
    expect(await json<{ ids: string[] }>(fromT3)).toEqual({ ids: ['repo-abc'] })
    expect(fromT3.headers.get('access-control-allow-origin')).toBe('t3code://app')
    const fromWeb = await app.request('/api/issue-ids', { headers: { origin: 'https://example.com' } })
    expect(fromWeb.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('allows only the T3 schemes and loopback http origins', () => {
    expect(idsOriginAllowed('t3code-dev://app')).toBe(true)
    expect(idsOriginAllowed('http://localhost:5733')).toBe(true)
    expect(idsOriginAllowed('http://127.0.0.1:3773')).toBe(true)
    expect(idsOriginAllowed('http://127.0.0.1.example.com')).toBe(false)
    expect(idsOriginAllowed('https://localhost.example.com')).toBe(false)
    expect(idsOriginAllowed('null')).toBe(false)
  })

  it('returns the detail shape: issue, comments, sessions, notes', async () => {
    const { app } = appFor()
    const body = await json<DetailBody>(await app.request('/api/issues/repo-abc'))
    expect(body.issue.id).toBe('repo-abc')
    expect(body.comments).toHaveLength(1)
    // agentsview is off in this app, so the panel is absent rather than empty
    expect(body.sessions).toBeNull()
    expect(body.notes).toEqual([
      { file: 'project_thing.md', line: 2, excerpt: '- repo-abc is the bead for the thing' },
    ])
  })

  it('404s a missing issue and an unknown api route', async () => {
    const { app } = appFor()
    expect((await app.request('/api/issues/repo-missing')).status).toBe(404)
    expect((await app.request('/api/nope')).status).toBe(404)
  })
})

describe('static ui', () => {
  it('serves ui/dist when it exists and falls back to the shell', async () => {
    const dist = await mkdtemp(join(tmpdir(), 'beadside-dist-'))
    await writeFile(join(dist, 'index.html'), '<!doctype html><title>board</title>')
    await writeFile(join(dist, 'app.js'), 'console.log(1)')
    const app = createApp({
      client: new BeadsClient(repo, async () => ({ stdout: '', stderr: '', code: 0 })),
      repo: { name: 'repo', path: repo },
      agentsview: null,
      token: TOKEN,
      uiDist: dist,
    })

    const index = await app.request('/')
    expect(index.status).toBe(200)
    expect(await index.text()).toContain('<title>board</title>')
    expect((await app.request('/app.js')).status).toBe(200)
    // an unknown non-api path is a client route, so it gets the shell
    const deep = await app.request('/issue/repo-abc')
    expect(deep.status).toBe(200)
    expect(await deep.text()).toContain('<title>board</title>')
    // the api keeps its own 404
    expect((await app.request('/api/nope')).status).toBe(404)
  })
})

describe('token', () => {
  it('rejects every post without the header', async () => {
    const { app, calls } = appFor()
    for (const request of [
      post('/api/issues', { title: 'x' }, null),
      post('/api/issues/repo-abc/comment', { text: 'x' }, 'wrong-token'),
      post('/api/issues/repo-abc/status', { status: 'closed' }, null),
      post('/api/issues/repo-abc/priority', { priority: 1 }, null),
      post('/api/issues/repo-abc/labels', { add: ['test-label'] }, null),
    ]) {
      const response = await app.request(request)
      expect(response.status).toBe(403)
    }
    expect(calls).toEqual([])
  })
})

describe('search', () => {
  it('searches the export, comments included, and labels comment authors', async () => {
    const { app, calls } = appFor()
    const body = await json<{ hits: { id: string; field: string; comment: { by: { name: string } } | null }[] }>(
      await app.request('/api/search?q=bead&scope=open'),
    )
    expect(body.hits.map((h) => h.id)).toEqual(['repo-abc'])
    expect(calls).toEqual([['export']])
  })

  it('rejects a bad scope and answers an empty query without reading bd', async () => {
    const { app, calls } = appFor()
    expect((await app.request('/api/search?q=x&scope=parked')).status).toBe(400)
    const empty = await json<{ hits: unknown[] }>(await app.request('/api/search?q=%20'))
    expect(empty.hits).toEqual([])
    expect(calls).toEqual([])
  })

  it('labels detail comments with who wrote them', async () => {
    const { app } = appFor()
    const body = await json<{ comments: { by: unknown }[] }>(await app.request('/api/issues/repo-abc'))
    expect(body.comments[0]!.by).toEqual({ kind: 'unknown', name: 'tester', self: false })
  })
})

describe('writes', () => {
  it('comments and returns the refreshed detail', async () => {
    const { app, calls } = appFor()
    const response = await app.request(
      post('/api/issues/repo-abc/comment', { text: 'do it', clear: true }),
    )
    expect(response.status).toBe(200)
    const body = await json<DetailBody>(response)
    expect(body.comments).toHaveLength(1)
    // the write is two bd runs, then one read of the issue and its comments
    expect(calls).toEqual([
      ['comments', 'add', 'repo-abc', '--author=human:tester', '--', 'do it'],
      ['update', 'repo-abc', '--add-label=from-human', '--remove-label=needs-human'],
      ['show', 'repo-abc', '--json'],
      ['comments', 'repo-abc', '--json'],
    ])
  })

  it('changes status, priority and labels', async () => {
    const { app, calls } = appFor()
    expect(
      (
        await app.request(
          post('/api/issues/repo-abc/status', { status: 'deferred', until: 'tomorrow' }),
        )
      ).status,
    ).toBe(200)
    expect((await app.request(post('/api/issues/repo-abc/priority', { priority: 0 }))).status).toBe(
      200,
    )
    expect(
      (await app.request(post('/api/issues/repo-abc/labels', { add: ['feat'], remove: ['bug'] })))
        .status,
    ).toBe(200)
    expect(calls.filter((args) => args[0] !== 'show')).toEqual([
      ['defer', 'repo-abc', '--until', 'tomorrow'],
      ['update', 'repo-abc', '--priority', '0'],
      ['update', 'repo-abc', '--add-label=feat', '--remove-label=bug'],
    ])
  })

  it('creates a capture and returns the issue using capture.labels', async () => {
    const { app, calls } = appFor()
    const body = await json<IssueBody>(
      await app.request(post('/api/issues', { title: 'new thing' })),
    )
    expect(body.issue.id).toBe('repo-abc')
    expect(calls[0]).toEqual(['q', '--labels=idea', '--labels=fun-tag', '--', 'new thing'])
  })

  it('rejects bad bodies with 400 and never spawns bd', async () => {
    const { app, calls } = appFor()
    expect((await app.request(post('/api/issues/repo-abc/priority', { priority: '0' }))).status).toBe(
      400,
    )
    expect((await app.request(post('/api/issues/repo-abc/labels', { add: 'feat' }))).status).toBe(
      400,
    )
    expect((await app.request(post('/api/issues/repo-abc/comment', { text: 42 }))).status).toBe(
      400,
    )
    expect((await app.request(post('/api/issues', { title: null }))).status).toBe(400)
    const bad = new Request('http://localhost/api/issues', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bd-token': TOKEN },
      body: '{',
    })
    expect((await app.request(bad)).status).toBe(400)
    expect(calls).toEqual([])
  })
})

describe('delete', () => {
  it('refuses ids the board did not create and removes ones it did', async () => {
    const calls: string[][] = []
    const ok = (stdout: string): RunResult => ({ stdout, stderr: '', code: 0 })
    const runner: Runner = async (args) => {
      calls.push(args)
      if (args[0] === 'q') return ok('repo-new\n')
      if (args[0] === 'show')
        return ok(
          JSON.stringify([
            {
              id: args[1],
              title: 't',
              status: 'open',
              priority: 2,
              issue_type: 'task',
              labels: [],
              created_at: '',
              updated_at: '',
              comment_count: 0,
              dependency_count: 0,
              dependent_count: 0,
            },
          ]),
        )
      return ok('')
    }
    const app = createApp({
      client: new BeadsClient('/tmp', runner),
      repo: { name: 'repo', path: '/tmp' },
      agentsview: null,
      token: 'tok',
    })
    const headers = { 'x-bd-token': 'tok', 'content-type': 'application/json' }
    expect((await app.request('/api/issues/repo-old', { method: 'DELETE', headers })).status).toBe(
      403,
    )
    const created = await app.request('/api/issues', {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'x' }),
    })
    expect(created.status).toBe(200)
    expect((await app.request('/api/issues/repo-new', { method: 'DELETE' })).status).toBe(403)
    const res = await app.request('/api/issues/repo-new', { method: 'DELETE', headers })
    expect(res.status).toBe(200)
    expect(
      calls.some((a) => a[0] === 'delete' && a[1] === 'repo-new' && a[2] === '--force'),
    ).toBe(true)
    expect((await app.request('/api/issues/repo-new', { method: 'DELETE', headers })).status).toBe(
      403,
    )
  })
})

describe('live updates', () => {
  /** a live board over a scripted journal; `exports` counts every `bd export` */
  function liveBoard(options: { reconcileMs?: number } = {}) {
    let exports = 0
    let title = 'a bead'
    let handlers: FollowHandlers | null = null
    const runner: Runner = async (args) => {
      if (args[0] === 'export') {
        exports += 1
        return ok(`${JSON.stringify({ _type: 'issue', ...issueRecord({ title }) })}\n`)
      }
      return ok('')
    }
    const follower: Follower = (_since, h) => {
      handlers = h
      return { stop: () => undefined }
    }
    const board = createBoard({
      client: new BeadsClient(repo, runner, { actor: 'human:tester', follower }),
      repo: { name: 'repo', path: repo },
      agentsview: null,
      human: { id: 'human:tester', name: 'Tester' },
      token: TOKEN,
      config: testConfig,
      live: { debounceMs: 5, settleMs: 10, reconcileMs: options.reconcileMs ?? 60_000 },
    })
    return {
      board,
      exports: () => exports,
      setTitle: (next: string) => void (title = next),
      journal: (seq: number) => handlers!.line(JSON.stringify({ seq, op: 'update', issue_id: 'repo-abc' })),
    }
  }

  /** reads an SSE response until `event` arrives, returning every event name seen */
  async function readUntil(response: Response, event: string, timeoutMs = 1_000): Promise<string[]> {
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let text = ''
    const deadline = Date.now() + timeoutMs
    try {
      while (Date.now() < deadline) {
        const chunk = await Promise.race([
          reader.read(),
          new Promise<null>((done) => setTimeout(() => done(null), deadline - Date.now())),
        ])
        if (!chunk || chunk.done) break
        text += decoder.decode(chunk.value, { stream: true })
        const seen = [...text.matchAll(/^event: (\w+)$/gm)].map((match) => match[1]!)
        if (seen.includes(event)) return seen
      }
      return [...text.matchAll(/^event: (\w+)$/gm)].map((match) => match[1]!)
    } finally {
      await reader.cancel()
    }
  }

  const settle = (ms = 40) => new Promise((done) => setTimeout(done, ms))

  it('announces a journal record on /api/events after one re-export', async () => {
    const { board, exports, journal } = liveBoard()
    await settle()
    const response = await board.app.request('/api/events')
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const before = exports()
    const reading = readUntil(response, 'changed')
    await settle(10)
    journal(1)
    journal(2)
    expect(await reading).toEqual(['state', 'changed'])
    expect(exports()).toBe(before + 1)
    board.close()
  })

  it('serves list reads from the cache while live', async () => {
    const { board, exports } = liveBoard()
    await settle()
    await board.app.request('/api/issues')
    const before = exports()
    await board.app.request('/api/issues')
    await board.app.request('/api/issue-ids')
    expect(exports()).toBe(before)
    board.close()
  })

  it('reconciles on a timer and announces only a real change', async () => {
    const { board, exports, setTitle } = liveBoard({ reconcileMs: 30 })
    await settle()
    const quiet = await readUntil(await board.app.request('/api/events'), 'changed', 80)
    expect(quiet).toEqual(['state'])
    expect(exports()).toBeGreaterThan(2)
    setTitle('synced in from another clone')
    expect(await readUntil(await board.app.request('/api/events'), 'changed', 200)).toContain('changed')
    const body = await json<ListBody>(await board.app.request('/api/issues'))
    expect(body.issues[0]!.title).toBe('synced in from another clone')
    board.close()
  })

  it('re-exports on every list read when the feed is off', async () => {
    const { app, calls } = appFor()
    await app.request('/api/issues')
    await app.request('/api/issues')
    expect(calls.filter((args) => args[0] === 'export')).toHaveLength(2)
  })
})
