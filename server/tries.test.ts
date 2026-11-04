import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from './app'
import { BeadsClient, type Comment, type IssueWithComments, type RunResult } from './bd'
import { resolveConfig } from './config'
import { assertVerdictNote, parseTry, tryEntries, verdictComment, withLast, MAX_NOTE_TEXT } from './tries'

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
    { type: 'qr', label: 'scan', text: 'https://read.example' },
    { type: 'image', src: '/home/x/shot.png', alt: 'the sheet' },
    { type: 'spec', label: 'phone', value: 'Galaxy S24' },
    { type: 'path', label: 'log', path: '~/log.txt', href: '/home/x/log.txt' },
    { type: 'bogus', label: 'dropped' },
  ],
  steps: [{ id: 'early', title: 'Start dragging as the sheet opens', note: 'right away' }, 'Then let go'],
}

const entry = (id: string, status: string, labels: string[], metadata?: Record<string, unknown>): IssueWithComments => ({
  issue: {
    id,
    title: `bead ${id}`,
    description: '',
    status: status as 'open',
    priority: 2,
    issue_type: 'task',
    labels,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    comment_count: 0,
    dependency_count: 0,
    dependent_count: 0,
    ...(metadata ? { metadata } : {}),
  },
  comments: [],
})

describe('parseTry', () => {
  it('reads every field, keeps known kit primitives and numbers bare steps', () => {
    const kit = parseTry({ try: KIT, quick: { x: 1 } }, 'try')
    expect(kit).toMatchObject({ title: KIT.title, app: 'reader', where: 'phone', minutes: 3, last: null })
    expect(kit?.kit.map((k) => k.type)).toEqual(['link', 'copy', 'qr', 'image', 'spec', 'path'])
    expect(kit?.steps).toEqual([
      { id: 'early', title: 'Start dragging as the sheet opens', note: 'right away' },
      { id: '2', title: 'Then let go', note: null },
    ])
  })

  it('reads a string-stored kit and a recorded verdict, and returns null without a title', () => {
    const last = { result: 'cant', at: '2026-11-01T10:00:00Z', note: 'no release' }
    expect(parseTry({ try: JSON.stringify({ ...KIT, last }) }, 'try')?.last).toEqual(last)
    expect(parseTry({ try: { ...KIT, last: { result: 'maybe', at: 'x' } } }, 'try')?.last).toBeNull()
    expect(parseTry({ try: { app: 'x' } }, 'try')).toBeNull()
    expect(parseTry(undefined, 'try')).toBeNull()
    expect(parseTry({ try: 'not json' }, 'try')).toBeNull()
  })
})

describe('verdict helpers', () => {
  it('needs a note for broken and cant, not for works', () => {
    expect(assertVerdictNote('works', undefined)).toBeNull()
    expect(assertVerdictNote('works', ' fine ')).toBe('fine')
    expect(() => assertVerdictNote('broken', '  ')).toThrowError(/needs a note/)
    expect(() => assertVerdictNote('cant', undefined)).toThrowError(/needs a note/)
    expect(() => assertVerdictNote('cant', 3)).toThrowError(/must be a string/)
  })

  it('writes the comment the spec asks for', () => {
    expect(verdictComment('works', 'Drag it', 'smooth', 'It follows.')).toBe('You tried Drag it: it works.\n\nExpected: It follows.\n\nsmooth')
    expect(verdictComment('broken', 'Drag it', 'flings shut', null)).toBe('You tried Drag it: still broken.\n\nflings shut')
    expect(verdictComment('cant', 'Drag it', 'link is dead', null)).toBe("You couldn't check Drag it.\n\nlink is dead")
  })

  it('keeps every stored field and cuts a long note', () => {
    const at = new Date('2026-11-04T10:00:00Z')
    const out = withLast({ ...KIT, extra: 1 }, { result: 'broken', at, note: 'x'.repeat(2000) })
    expect(out).toMatchObject({ extra: 1, title: KIT.title, last: { result: 'broken', at: at.toISOString() } })
    expect((out['last'] as { note: string }).note).toHaveLength(MAX_NOTE_TEXT)
  })
})

describe('tryEntries', () => {
  it('lists open beads with the label, kit or not, grouped by app; closed beads stay out', () => {
    const corpus = [
      entry('r-1', 'open', ['try-it'], { try: { ...KIT, app: 'spotify', title: 'b' } }),
      entry('r-2', 'open', ['try-it'], { try: { ...KIT, app: 'reader', title: 'z' } }),
      entry('r-3', 'closed', ['try-it'], { try: KIT }),
      entry('r-4', 'open', ['infra'], { try: KIT }),
      entry('r-5', 'open', ['try-it']),
      entry('r-6', 'open', ['try-it'], { try: { ...KIT, app: 'reader', title: 'a' } }),
    ]
    const out = tryEntries(corpus, 'try-it', 'try')
    expect(out.map((e) => e.id)).toEqual(['r-6', 'r-2', 'r-1', 'r-5'])
    expect(out[3]?.try).toBeNull()
  })
})

describe('tryIt config', () => {
  it('is off without a block, fills defaults, and joins the flags', () => {
    expect(resolveConfig({}).tryIt).toBeNull()
    const on = resolveConfig({ tryIt: {} })
    expect(on.tryIt).toEqual({ label: 'try-it', key: 'try', title: 'ready to try', note: null })
    expect(on.derived.allFlags).toContain('try-it')
    expect(on.inbox.labels).not.toContain('try-it')
    expect(on.waiting.labels).not.toContain('try-it')
    expect(resolveConfig({ tryIt: { label: 'check', key: 'hub.try', title: 't' } }).tryIt).toMatchObject({ label: 'check', key: 'hub.try' })
    expect(() => resolveConfig({ tryIt: { key: '-x' } })).toThrowError(/tryIt\.key/)
    expect(() => resolveConfig({ tryIt: { label: 'two words' } })).toThrowError(/tryIt\.label/)
    expect(() => resolveConfig({ asks: {}, tryIt: { key: 'ask' } })).toThrowError(/differ from asks/)
    expect(() => resolveConfig({ tryIt: [] })).toThrowError(/tryIt must be an object/)
  })
})

describe('try routes', () => {
  const TOKEN = 'test-token'
  let repo: string
  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'beadside-tries-'))
  })

  const ok = (stdout: string): RunResult => ({ stdout, stderr: '', code: 0 })
  const fail = (stderr: string): RunResult => ({ stdout: '', stderr, code: 1 })

  /** an app over one bead the canned bd keeps state for: labels, metadata, status and comments */
  function appFor(
    opts: {
      tryIt?: unknown
      labels?: string[]
      failClose?: boolean
      failRemove?: boolean
      meta?: Record<string, unknown>
      status?: string
      comments?: Comment[]
      extra?: Record<string, unknown>
      hosts?: string[]
    } = {},
  ) {
    const calls: string[][] = []
    let meta: Record<string, unknown> = opts.meta ?? { try: KIT, quick: { kept: true } }
    let labels = opts.labels ?? ['infra', 'try-it']
    let status = opts.status ?? 'open'
    let failClose = opts.failClose ?? false
    let failRemove = opts.failRemove ?? false
    const comments: Comment[] = [...(opts.comments ?? [])]
    const record = () => ({ ...entry('repo-abc', status, labels, meta).issue, ...opts.extra, comment_count: comments.length })
    const runner = async (args: string[]): Promise<RunResult> => {
      calls.push(args)
      if (args[0] === 'export') return ok(`${JSON.stringify({ _type: 'issue', ...record() })}\n`)
      if (args[0] === 'show') return ok(JSON.stringify([{ ...record(), ...(args.includes('--include-comments') ? { comments } : {}) }]))
      if (args[0] === 'comments' && args[1] === 'add') {
        const author = args.find((a) => a.startsWith('--author='))?.slice('--author='.length) ?? 'unknown'
        comments.push({ id: `c${comments.length + 1}`, issue_id: 'repo-abc', author, text: args[args.length - 1]!, created_at: new Date().toISOString() })
        return ok('')
      }
      if (args[0] === 'comments') return ok(JSON.stringify(comments))
      if (args[0] === 'close') {
        if (failClose) return fail('dolt lock busy')
        status = 'closed'
        return ok('')
      }
      if (args[0] === 'update') {
        if (failRemove && args.includes('--remove-label=try-it')) return fail('dolt lock busy')
        for (const arg of args) {
          if (arg.startsWith('--metadata=')) meta = { ...meta, ...(JSON.parse(arg.slice('--metadata='.length)) as object) }
          if (arg.startsWith('--add-label=')) labels = [...new Set([...labels, arg.slice('--add-label='.length)])]
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
      config: resolveConfig({
        note: { addLabel: 'from-human', offerToClear: ['needs-human'] },
        ...(opts.tryIt === undefined ? { tryIt: {} } : opts.tryIt === null ? {} : { tryIt: opts.tryIt }),
        ...(opts.hosts ? { hosts: opts.hosts } : {}),
      }),
    })
    return {
      app,
      calls,
      meta: () => meta,
      labels: () => labels,
      status: () => status,
      comments,
      healClose: () => {
        failClose = false
      },
      healRemove: () => {
        failRemove = false
      },
    }
  }

  const verdict = (body: unknown, token: string | null = TOKEN) =>
    new Request('http://localhost/api/issues/repo-abc/try/verdict', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { 'x-bd-token': token } : {}) },
      body: JSON.stringify(body),
    })
  const writes = (calls: string[][]) => calls.filter((a) => (a[0] === 'comments' && a[1] === 'add') || a[0] === 'update' || a[0] === 'close')

  it('404s both routes when try-it is off', async () => {
    const { app, calls } = appFor({ tryIt: null })
    expect((await app.request('/api/tries')).status).toBe(404)
    expect((await app.request(verdict({ verdict: 'works' }))).status).toBe(404)
    expect(calls).toEqual([])
  })

  it('lists the open checks with their kit', async () => {
    const { app } = appFor()
    const body = (await (await app.request('/api/tries')).json()) as { label: string; key: string; tries: { id: string; try: { app: string } }[] }
    expect(body).toMatchObject({ label: 'try-it', key: 'try' })
    expect(body.tries).toHaveLength(1)
    expect(body.tries[0]).toMatchObject({ id: 'repo-abc', try: { app: 'reader' } })
  })

  it('needs the token', async () => {
    const { app, calls } = appFor()
    expect((await app.request(verdict({ verdict: 'works' }, null))).status).toBe(403)
    expect(calls).toEqual([])
  })

  it('works: the pending marker, the human comment, the close, then the label off with the stamp; from-human stays off', async () => {
    const { app, calls, meta, labels, status, comments } = appFor()
    const res = await app.request(verdict({ verdict: 'works', note: 'smooth on the S24' }))
    expect(res.status).toBe(200)
    const w = writes(calls)
    expect(w[0]).toEqual(['update', 'repo-abc', expect.stringMatching(/^--metadata=.*"pending":\{"result":"works"/)])
    expect(w[1]).toEqual(['comments', 'add', 'repo-abc', '--author=human:tester', '--', expect.stringMatching(/^You tried Drag the reader sheet on your Galaxy: it works\.\n\nExpected: The sheet follows an early drag\.\n\nsmooth on the S24$/)])
    expect(w[2]?.[0]).toBe('close')
    expect(w[3]).toEqual(['update', 'repo-abc', '--remove-label=try-it', expect.stringMatching(/^--metadata=/)])
    expect(w).toHaveLength(4)
    expect(status()).toBe('closed')
    expect(labels()).toEqual(['infra'])
    expect(meta()).toMatchObject({ quick: { kept: true }, try: { title: KIT.title, last: { result: 'works', note: 'smooth on the S24' } } })
    expect(meta()['try']).not.toHaveProperty('pending')
    expect(comments).toHaveLength(1)
    const body = (await res.json()) as { verdict: { result: string }; issue: { status: string } }
    expect(body.verdict.result).toBe('works')
    expect(body.issue.status).toBe('closed')
  })

  it('broken: the observation, from-human added and try-it removed in one update, the bead stays open', async () => {
    const { app, calls, meta, labels, status } = appFor()
    const res = await app.request(verdict({ verdict: 'broken', note: 'it flings shut' }))
    expect(res.status).toBe(200)
    const w = writes(calls)
    expect(w).toHaveLength(3)
    expect(w[0]).toEqual(['update', 'repo-abc', expect.stringMatching(/^--metadata=.*"pending"/)])
    expect(w[1]?.at(-1)).toBe('You tried Drag the reader sheet on your Galaxy: still broken.\n\nit flings shut')
    expect(w[2]).toEqual(['update', 'repo-abc', '--add-label=from-human', '--remove-label=try-it', expect.stringMatching(/^--metadata=/)])
    expect(status()).toBe('open')
    expect(labels()).toEqual(['infra', 'from-human'])
    expect(meta()['try']).toMatchObject({ last: { result: 'broken', note: 'it flings shut' } })
  })

  it("cant: what stopped the human, from-human added, try-it kept", async () => {
    const { app, calls, labels, status, meta } = appFor()
    const res = await app.request(verdict({ verdict: 'cant', note: 'the link is dead' }))
    expect(res.status).toBe(200)
    const w = writes(calls)
    expect(w[1]?.at(-1)).toBe("You couldn't check Drag the reader sheet on your Galaxy.\n\nthe link is dead")
    expect(w[2]).toEqual(['update', 'repo-abc', '--add-label=from-human', expect.stringMatching(/^--metadata=/)])
    expect(meta()['try']).not.toHaveProperty('pending')
    expect(status()).toBe('open')
    expect(labels()).toEqual(['infra', 'try-it', 'from-human'])
    expect(meta()['try']).toMatchObject({ last: { result: 'cant', note: 'the link is dead' } })
  })

  it('refuses broken and cant without a note, an unknown verdict and a bad note, writing nothing', async () => {
    const { app, calls } = appFor()
    expect((await app.request(verdict({ verdict: 'broken' }))).status).toBe(400)
    expect((await app.request(verdict({ verdict: 'cant', note: '   ' }))).status).toBe(400)
    expect((await app.request(verdict({ verdict: 'meh' }))).status).toBe(400)
    expect((await app.request(verdict({ verdict: 'works', note: 5 }))).status).toBe(400)
    expect(writes(calls)).toEqual([])
  })

  it('409s a bead that no longer carries the label, writing nothing', async () => {
    const { app, calls } = appFor({ labels: ['infra'] })
    const res = await app.request(verdict({ verdict: 'works' }))
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toMatch(/already settled/)
    expect(writes(calls)).toEqual([])
  })

  it('a double click settles once: the second works is refused, the bead closed once', async () => {
    const { app, calls, comments } = appFor()
    const [a, b] = await Promise.all([app.request(verdict({ verdict: 'works' })), app.request(verdict({ verdict: 'works' }))])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect(comments).toHaveLength(1)
    expect(calls.filter((x) => x[0] === 'close')).toHaveLength(1)
  })

  it("a repeated cant with the same note leaves one comment", async () => {
    const { app, comments, labels } = appFor()
    expect((await app.request(verdict({ verdict: 'cant', note: 'no release yet' }))).status).toBe(200)
    expect((await app.request(verdict({ verdict: 'cant', note: 'no release yet' }))).status).toBe(200)
    expect(comments).toHaveLength(1)
    expect(labels().filter((l) => l === 'from-human')).toHaveLength(1)
  })

  it('a failed close says the comment is saved and the bead still open; the retry finishes without a second comment', async () => {
    const { app, comments, status, labels, healClose } = appFor({ failClose: true })
    const res = await app.request(verdict({ verdict: 'works' }))
    expect(res.status).toBe(502)
    const body = (await res.json()) as { error: string; commented: boolean }
    expect(body.commented).toBe(true)
    expect(body.error).toMatch(/verdict comment is saved on repo-abc, but the bead is still open/)
    expect(status()).toBe('open')
    expect(labels()).toContain('try-it')
    healClose()
    expect((await app.request(verdict({ verdict: 'works' }))).status).toBe(200)
    expect(comments).toHaveLength(1)
    expect(status()).toBe('closed')
    expect(labels()).not.toContain('try-it')
  })

  it('a failure after the close: closed but labelled, listed nowhere; the next read finishes it, one comment', async () => {
    const { app, comments, status, labels, meta, healRemove } = appFor({ failRemove: true })
    const res = await app.request(verdict({ verdict: 'works' }))
    expect(res.status).toBe(502)
    expect(((await res.json()) as { error: string }).error).toMatch(/closed but still carries try-it/)
    expect(status()).toBe('closed')
    expect(labels()).toContain('try-it')
    expect(meta()['try']).toMatchObject({ pending: { result: 'works' } })
    healRemove()
    const listed = (await (await app.request('/api/tries')).json()) as { tries: unknown[] }
    expect(listed.tries).toEqual([])
    await vi.waitFor(() => expect(labels()).not.toContain('try-it'))
    expect(comments).toHaveLength(1)
    expect(meta()['try']).toMatchObject({ last: { result: 'works' } })
    expect(meta()['try']).not.toHaveProperty('pending')
  })

  it('a failure after the close: the retry the 502 asks for finishes it, one comment', async () => {
    const { app, comments, status, labels, healRemove } = appFor({ failRemove: true })
    expect((await app.request(verdict({ verdict: 'works' }))).status).toBe(502)
    healRemove()
    const res = await app.request(verdict({ verdict: 'works' }))
    expect(res.status).toBe(200)
    expect(comments).toHaveLength(1)
    expect(status()).toBe('closed')
    expect(labels()).not.toContain('try-it')
    // a broken or cant on that closed bead is refused
    const again = appFor({ failRemove: true })
    expect((await again.app.request(verdict({ verdict: 'works' }))).status).toBe(502)
    expect((await again.app.request(verdict({ verdict: 'broken', note: 'x' }))).status).toBe(409)
  })

  it('finishes a closed, labelled bead an earlier version left with last=works', async () => {
    const { app, labels, calls } = appFor({ status: 'closed', meta: { try: { ...KIT, last: { result: 'works', at: '2026-11-01T10:00:00Z', note: null } } } })
    await app.request('/api/issues')
    await vi.waitFor(() => expect(labels()).not.toContain('try-it'))
    expect(calls.filter((a) => a[0] === 'comments' && a[1] === 'add')).toEqual([])
    // a closed labelled bead with no works marker is left alone
    const other = appFor({ status: 'closed', meta: { try: KIT } })
    await other.app.request('/api/issues')
    await new Promise((r) => setTimeout(r, 20))
    expect(other.labels()).toContain('try-it')
  })

  it('a retry hours after a partial save still leaves one comment: the pending marker, not a time window', async () => {
    const at = '2026-11-01T08:00:00.000Z'
    const text = "You couldn't check Drag the reader sheet on your Galaxy.\n\nno release yet"
    const { app, comments, labels, meta } = appFor({
      meta: { try: { ...KIT, pending: { result: 'cant', at, note: 'no release yet' } } },
      comments: [{ id: 'c0', issue_id: 'repo-abc', author: 'human:tester', text, created_at: '2026-11-01T08:00:01Z' }],
    })
    expect((await app.request(verdict({ verdict: 'cant', note: 'no release yet' }))).status).toBe(200)
    expect(comments).toHaveLength(1)
    expect(labels()).toContain('from-human')
    expect(meta()['try']).toMatchObject({ last: { result: 'cant', at } })
    expect(meta()['try']).not.toHaveProperty('pending')
  })

  it('a pending marker whose comment never landed gets its comment on the retry', async () => {
    const { app, comments } = appFor({
      meta: { try: { ...KIT, pending: { result: 'works', at: '2026-11-01T08:00:00.000Z', note: null } } },
    })
    expect((await app.request(verdict({ verdict: 'works' }))).status).toBe(200)
    expect(comments).toHaveLength(1)
  })

  it('a repeated cant after an agent replied is a new round with its own comment', async () => {
    const { app, comments } = appFor()
    expect((await app.request(verdict({ verdict: 'cant', note: 'no release yet' }))).status).toBe(200)
    comments.push({ id: 'cx', issue_id: 'repo-abc', author: 'agent:claude', text: 'released, try again', created_at: new Date().toISOString() })
    expect((await app.request(verdict({ verdict: 'cant', note: 'no release yet' }))).status).toBe(200)
    expect(comments.filter((c) => c.author === 'human:tester')).toHaveLength(2)
  })

  it('leaves deferred checks out of the list until they wake', async () => {
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString()
    const past = new Date(Date.now() - 86_400_000).toISOString()
    const ids = async (opts: Parameters<typeof appFor>[0]) =>
      ((await (await appFor(opts).app.request('/api/tries')).json()) as { tries: { id: string }[] }).tries.map((t) => t.id)
    expect(await ids({ status: 'deferred' })).toEqual([])
    expect(await ids({ status: 'deferred', extra: { defer_until: future } })).toEqual([])
    expect(await ids({ status: 'open', extra: { defer_until: future } })).toEqual([])
    expect(await ids({ status: 'deferred', extra: { defer_until: past } })).toEqual(['repo-abc'])
    expect(await ids({ status: 'open', extra: { defer_until: past } })).toEqual(['repo-abc'])
  })

  describe('host and origin', () => {
    const session = (host: string) => new Request(`http://${host}/api/session`, { headers: { host } })

    it('serves the session to loopback hosts and configured ones, and refuses a foreign Host', async () => {
      const { app } = appFor({ hosts: ['box.tailnet.ts.net'] })
      for (const host of ['127.0.0.1:1338', 'localhost:5173', '[::1]:1338', 'box.tailnet.ts.net:1338', 'BOX.tailnet.ts.net']) {
        expect((await app.request(session(host))).status, host).toBe(200)
      }
      for (const host of ['attacker.example', 'attacker.example:1338', '127.0.0.1.attacker.example:1338', 'box.tailnet.ts.net.evil:1338']) {
        const res = await app.request(session(host))
        expect(res.status, host).toBe(403)
        expect(JSON.stringify(await res.json())).not.toContain(TOKEN)
      }
    })

    it('reads hosts from the config, lowercased, and refuses anything that is not a host name', () => {
      expect(resolveConfig({}).hosts).toEqual([])
      expect(resolveConfig({ hosts: ['Box.Tailnet.ts.net', 'proxy.lan:8443', '[fd7a::1]'] }).hosts).toEqual(['box.tailnet.ts.net', 'proxy.lan:8443', '[fd7a::1]'])
      for (const bad of [['two words'], ['http://box'], ['box/path'], [3], 'box']) {
        expect(() => resolveConfig({ hosts: bad }), JSON.stringify(bad)).toThrowError(/hosts/)
      }
    })

    it('a configured host:port matches that port only', async () => {
      const { app } = appFor({ hosts: ['box.ts.net:1338'] })
      expect((await app.request(session('box.ts.net:1338'))).status).toBe(200)
      expect((await app.request(session('box.ts.net:9999'))).status).toBe(403)
    })

    it('refuses the kit image under a foreign Host', async () => {
      const png = join(repo, 'host.png')
      await writeFile(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      const { app } = appFor({ meta: { try: { ...KIT, kit: [{ type: 'image', src: png }] } } })
      const url = (host: string) => new Request(`http://${host}/api/tries/repo-abc/image/0`, { headers: { host } })
      expect((await app.request(url('127.0.0.1:1338'))).status).toBe(200)
      expect((await app.request(url('attacker.example:1338'))).status).toBe(403)
    })

    const posted = (headers: Record<string, string>) =>
      new Request('http://127.0.0.1:1338/api/issues/repo-abc/try/verdict', {
        method: 'POST',
        headers: { host: '127.0.0.1:1338', 'content-type': 'application/json', 'x-bd-token': TOKEN, ...headers },
        body: JSON.stringify({ verdict: 'works' }),
      })

    it('refuses a verdict from a foreign Origin or Host even with the token, writing nothing', async () => {
      const { app, calls } = appFor()
      expect((await app.request(posted({ origin: 'http://attacker.example:1338' }))).status).toBe(403)
      expect((await app.request(posted({ origin: 'null' }))).status).toBe(403)
      expect((await app.request(posted({ host: 'attacker.example:1338', origin: 'http://attacker.example:1338' }))).status).toBe(403)
      expect(writes(calls)).toEqual([])
    })

    it("accepts the board's own page and an originless server-to-server verdict", async () => {
      const page = appFor({ hosts: ['box.tailnet.ts.net'] })
      expect((await page.app.request(posted({ origin: 'https://box.tailnet.ts.net:1338' }))).status).toBe(200)
      const local = appFor()
      expect((await local.app.request(posted({ origin: 'http://127.0.0.1:1338' }))).status).toBe(200)
      // home base forwards from its own server: no Origin, only the token
      const forwarded = appFor()
      expect((await forwarded.app.request(posted({}))).status).toBe(200)
      expect(forwarded.status()).toBe('closed')
    })
  })

  it('serves a local kit image by its index, and nothing a kit does not name', async () => {
    const png = join(repo, 'shot.png')
    await writeFile(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const kit = { ...KIT, kit: [{ type: 'image', src: '/etc/passwd' }, { type: 'image', src: png, alt: 'x' }] }
    const { app } = appFor({ meta: { try: kit } })
    const res = await app.request('/api/tries/repo-abc/image/1')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('content-security-policy')).toMatch(/default-src 'none'/)
    expect((await app.request('/api/tries/repo-abc/image/0')).status).toBe(404)
    expect((await app.request('/api/tries/repo-abc/image/2')).status).toBe(404)
    expect((await app.request('/api/tries/repo-abc/image/x')).status).toBe(400)
    const gone = appFor({ meta: { try: kit }, labels: ['infra'] })
    expect((await gone.app.request('/api/tries/repo-abc/image/1')).status).toBe(404)
  })
})
