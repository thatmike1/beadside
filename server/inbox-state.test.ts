import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import { BeadsClient, type RunResult, type Runner } from './bd'
import { deviceName, readInboxState, type InboxState } from './inbox-state'

const TOKEN = 'test-token'
const ok = (stdout: string): RunResult => ({ stdout, stderr: '', code: 0 })
const post = (path: string, body: unknown, token: string | null = TOKEN) =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { 'x-bd-token': token } : {}) },
    body: JSON.stringify(body),
  })

/** one beads database's kv table, shared by every board built on it, as two synced replicas are */
function store() {
  const kv: Record<string, string> = { schema_version: '1' }
  const calls: string[][] = []
  const runner: Runner = async (args) => {
    calls.push(args)
    if (args[0] === 'kv' && args[1] === 'list') return ok(JSON.stringify(kv, null, 2))
    if (args[0] === 'kv' && args[1] === 'set' && args[2] === '--') {
      kv[args[3]!] = args[4]!
      return ok(`Set ${args[3]} = ${args[4]}`)
    }
    if (args[0] === 'export') return ok('')
    return { stdout: '', stderr: `unexpected bd ${args.join(' ')}`, code: 1 }
  }
  const board = (device: string) =>
    createApp({
      client: new BeadsClient('/tmp/none', runner, { actor: 'human:tester' }),
      repo: { name: 'repo', path: '/tmp/none' },
      agentsview: null,
      token: TOKEN,
      device,
    })
  return { kv, calls, board }
}

const state = async (response: Response) => (await response.json()) as InboxState

describe('device names', () => {
  it('turns a hostname into one key segment', () => {
    expect(deviceName('thatmike1-MS-7B86')).toBe('thatmike1-ms-7b86')
    expect(deviceName('box.example.org')).toBe('box-example-org')
    expect(deviceName('...')).toBe('board')
  })
})

describe('readInboxState', () => {
  it('counts a bead seen at the newest reply any device opened it at', () => {
    const kv = {
      'beadside.seen.desk.repo-a': '2026-10-09T10:00:00Z',
      'beadside.seen.phone.repo-a': '2026-10-11T10:00:00Z',
      'beadside.seen.phone.repo-b.1': '2026-10-01T08:00:00Z',
      'beadside.seen.desk.--force': '2026-10-01T08:00:00Z',
      'beadside.seen.desk.repo-c': 'not a date',
    }
    expect(readInboxState(kv, '2026-10-13', 'desk').seen).toEqual({
      'repo-a': '2026-10-11T10:00:00Z',
      'repo-b.1': '2026-10-01T08:00:00Z',
    })
  })

  it("holds the day's picks of the device that drew first, ignoring other days", () => {
    const kv = {
      'beadside.picks.phone': JSON.stringify({ day: '2026-10-13', ids: ['repo-p'], at: '2026-10-13T09:00:00.000Z' }),
      'beadside.picks.desk': JSON.stringify({ day: '2026-10-13', ids: ['repo-d'], at: '2026-10-13T07:00:00.000Z' }),
      'beadside.picks.old': JSON.stringify({ day: '2026-10-12', ids: ['repo-o'], at: '2026-10-12T05:00:00.000Z' }),
      'beadside.picks.bad': '{nope',
    }
    expect(readInboxState(kv, '2026-10-13', 'phone').picks).toEqual({ day: '2026-10-13', ids: ['repo-d'] })
    expect(readInboxState(kv, '2026-10-14', 'phone').picks).toBeNull()
  })
})

describe('kv-backed inbox state over the api', () => {
  it('a reply seen on one board counts as seen on another board over the same database', async () => {
    const { kv, board } = store()
    const desk = board('desk')
    const phone = board('phone')
    const at = '2026-10-09T12:30:00Z'
    const marked = await desk.request(post('/api/issues/repo-abc/seen', { at }))
    expect(marked.status).toBe(200)
    expect(kv['beadside.seen.desk.repo-abc']).toBe(at)

    const fromPhone = await state(await phone.request('/api/inbox-state?day=2026-10-13'))
    expect(fromPhone.device).toBe('phone')
    expect(fromPhone.seen).toEqual({ 'repo-abc': at })
  })

  it('each board writes only its own keys, so two replicas never set one key differently', async () => {
    const { kv, board } = store()
    await board('desk').request(post('/api/issues/repo-abc/seen', { at: '2026-10-09T12:30:00Z' }))
    await board('phone').request(post('/api/issues/repo-abc/seen', { at: '2026-10-10T12:30:00Z' }))
    expect(Object.keys(kv).filter((k) => k.startsWith('beadside.')).sort()).toEqual([
      'beadside.seen.desk.repo-abc',
      'beadside.seen.phone.repo-abc',
    ])
  })

  it("stores the day's picks and answers with the first device's when another drew earlier", async () => {
    const { board } = store()
    const first = await state(await board('desk').request(post('/api/stale-picks', { day: '2026-10-13', ids: ['repo-a', 'repo-b'] })))
    expect(first.picks).toEqual({ day: '2026-10-13', ids: ['repo-a', 'repo-b'] })
    const second = await state(await board('phone').request(post('/api/stale-picks', { day: '2026-10-13', ids: ['repo-c'] })))
    expect(second.picks).toEqual({ day: '2026-10-13', ids: ['repo-a', 'repo-b'] })
  })

  it('validates before bd runs and needs the token', async () => {
    const { calls, board } = store()
    const app = board('desk')
    expect((await app.request(post('/api/issues/repo-abc/seen', { at: 'yesterday' }))).status).toBe(400)
    expect((await app.request(post('/api/issues/--force/seen', { at: '2026-10-09T12:30:00Z' }))).status).toBe(400)
    expect((await app.request(post('/api/issues/repo-abc/seen', { at: '2026-10-09T12:30:00Z' }, null))).status).toBe(403)
    expect((await app.request(post('/api/stale-picks', { day: '13.10.2026', ids: [] }))).status).toBe(400)
    expect((await app.request(post('/api/stale-picks', { day: '2026-10-13', ids: ['$(x)'] }))).status).toBe(400)
    expect((await app.request('/api/inbox-state')).status).toBe(400)
    expect(calls.filter((args) => args[0] === 'kv')).toEqual([])
  })

  it('passes the key and value after `--`', async () => {
    const { calls, board } = store()
    await board('desk').request(post('/api/issues/repo-abc/seen', { at: '2026-10-09T12:30:00Z' }))
    expect(calls).toContainEqual(['kv', 'set', '--', 'beadside.seen.desk.repo-abc', '2026-10-09T12:30:00Z'])
  })
})
