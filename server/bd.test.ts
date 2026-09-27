import { describe, expect, it } from 'vitest'
import { assertId, assertLabel, BdError, BeadsClient, resolveBd, type BdLookupFs, type Issue, type RunResult, type Runner } from './bd'

const issueRecord = (overrides: Record<string, unknown> = {}) => ({
  id: 'repo-abc',
  title: 'a bead',
  description: 'body',
  status: 'open',
  priority: 2,
  issue_type: 'task',
  labels: ['test-label'],
  created_at: '2026-09-09T10:00:00Z',
  updated_at: '2026-09-09T10:00:00Z',
  comment_count: 0,
  dependency_count: 0,
  dependent_count: 0,
  ...overrides,
})

/** a runner that records every argv and answers from a canned handler */
function fake(handler: (args: string[]) => string | RunResult = () => '') {
  const calls: string[][] = []
  const runner: Runner = async (args) => {
    calls.push(args)
    const out = handler(args)
    return typeof out === 'string' ? { stdout: out, stderr: '', code: 0 } : out
  }
  return { runner, calls }
}

/** a client whose `show` always answers with one record, with the given status */
function clientFor(status = 'open', overrides: Record<string, unknown> = {}, actor?: string) {
  const { runner, calls } = fake((args) =>
    args[0] === 'show' ? JSON.stringify([issueRecord({ status, ...overrides })]) : '',
  )
  return { client: new BeadsClient('/repo', runner, actor ? { actor } : {}), calls }
}

describe('validation', () => {
  it('accepts plain and sub-issue ids', () => {
    expect(assertId('demo-9fz')).toBe('demo-9fz')
    expect(assertId('demo-zf8.4')).toBe('demo-zf8.4')
  })

  it('rejects ids with shell or flag shapes', () => {
    for (const bad of ['a b', 'a;b', '--flag', 'a/b', '', 'a.b', 'a-1.2.3']) {
      expect(() => assertId(bad)).toThrow(BdError)
    }
  })

  it('rejects labels that are empty, long or contain whitespace', () => {
    expect(assertLabel('needs-review')).toBe('needs-review')
    expect(() => assertLabel('')).toThrow(BdError)
    expect(() => assertLabel('two words')).toThrow(BdError)
    expect(() => assertLabel('x'.repeat(129))).toThrow(BdError)
  })

  it('never spawns bd for an invalid id', async () => {
    const { runner, calls } = fake()
    const client = new BeadsClient('/repo', runner)
    await expect(client.issue('bad id')).rejects.toThrow(BdError)
    await expect(client.comment('bad id', 'hi')).rejects.toThrow(BdError)
    await expect(client.setPriority('bad id', 1)).rejects.toThrow(BdError)
    expect(calls).toEqual([])
  })

  it('never spawns bd for an invalid label or empty comment', async () => {
    const { client, calls } = clientFor()
    await expect(client.setLabels('repo-abc', ['two words'])).rejects.toThrow(BdError)
    await expect(client.comment('repo-abc', '   ')).rejects.toThrow(BdError)
    expect(calls).toEqual([])
  })
})

describe('finding bd', () => {
  const NPM = String.raw`C:\nvm4w\nodejs`
  const SHIM = String.raw`@ECHO off
endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\node_modules\@beads\bd\bin\bd.js" %*
`
  const SCRIPT = String.raw`${NPM}\node_modules\@beads\bd\bin\bd.js`
  const NATIVE = String.raw`${NPM}\node_modules\@beads\bd\bin\bd.exe`
  const CMD = String.raw`${NPM}\bd.cmd`

  /** a filesystem holding exactly these files */
  const files = (entries: Record<string, string>): BdLookupFs => ({
    exists: (path) => path in entries,
    read: (path) => entries[path] ?? null,
  })

  it('keeps plain bd from PATH off windows', () => {
    expect(resolveBd({ PATH: '/usr/bin' }, 'linux', files({}))).toEqual({ file: 'bd', prefix: [] })
  })

  it('follows the npm bd.cmd shim to the native bd.exe', () => {
    const fs = files({ [CMD]: SHIM, [SCRIPT]: '', [NATIVE]: '' })
    expect(resolveBd({ Path: String.raw`C:\Windows;${NPM}` }, 'win32', fs)).toEqual({ file: NATIVE, prefix: [] })
  })

  it('runs the shim script through node when no native binary sits next to it', () => {
    const fs = files({ [CMD]: SHIM, [SCRIPT]: '' })
    expect(resolveBd({ PATH: NPM }, 'win32', fs)).toEqual({ file: process.execPath, prefix: [SCRIPT] })
  })

  it('takes a bd.exe on PATH as it is', () => {
    const tool = String.raw`C:\tools\bd.exe`
    const fs = files({ [tool]: '', [CMD]: SHIM, [NATIVE]: '' })
    expect(resolveBd({ PATH: String.raw`"C:\tools";${NPM}` }, 'win32', fs)).toEqual({ file: tool, prefix: [] })
  })

  it('falls back to plain bd when nothing on PATH resolves', () => {
    expect(resolveBd({ PATH: NPM }, 'win32', files({}))).toEqual({ file: 'bd', prefix: [] })
  })

  it('lets BD_BOARD_BD override the lookup', () => {
    const fs = files({ [CMD]: SHIM, [NATIVE]: '' })
    const exe = String.raw`D:\bd\bd.exe`
    expect(resolveBd({ BD_BOARD_BD: '/opt/bd/bd', PATH: '/usr/bin' }, 'linux', fs)).toEqual({ file: '/opt/bd/bd', prefix: [] })
    expect(resolveBd({ BD_BOARD_BD: exe, PATH: NPM }, 'win32', fs)).toEqual({ file: exe, prefix: [] })
    expect(resolveBd({ BD_BOARD_BD: SCRIPT, PATH: NPM }, 'win32', fs)).toEqual({ file: process.execPath, prefix: [SCRIPT] })
    expect(resolveBd({ BD_BOARD_BD: CMD }, 'win32', fs)).toEqual({ file: NATIVE, prefix: [] })
  })
})

describe('reads', () => {
  it('parses bd export, keeping issues and dropping _type and embedded comments', async () => {
    const lines = [
      JSON.stringify({ _type: 'issue', ...issueRecord({ comments: [{ id: 'c1' }] }) }),
      '',
      JSON.stringify({ _type: 'memory', id: 'mem-1' }),
      JSON.stringify({
        _type: 'issue',
        ...issueRecord({ id: 'repo-def', labels: undefined, description: undefined }),
      }),
    ].join('\n')
    const { runner, calls } = fake(() => lines)
    const issues = await new BeadsClient('/repo', runner).issues()

    expect(calls).toEqual([['export']])
    expect(issues.map((i) => i.id)).toEqual(['repo-abc', 'repo-def'])
    expect(issues[0]).not.toHaveProperty('_type')
    expect(issues[0]).not.toHaveProperty('comments')
    expect(issues[1]!.labels).toEqual([])
    expect(issues[1]!.description).toBe('')
  })

  it('raises on invalid export json', async () => {
    const { runner } = fake(() => '{not json}')
    await expect(new BeadsClient('/repo', runner).issues()).rejects.toThrow(/invalid JSON/)
  })

  it('takes the first element of the bd show array', async () => {
    const { runner, calls } = fake(() =>
      JSON.stringify([issueRecord({ notes: 'n' }), issueRecord({ id: 'other' })]),
    )
    const issue = await new BeadsClient('/repo', runner).issue('repo-abc')
    expect(calls).toEqual([['show', 'repo-abc', '--json']])
    expect(issue.notes).toBe('n')
  })

  it('reports a missing issue as 404', async () => {
    const { runner } = fake(() => ({
      stdout: '',
      stderr: 'no issue found matching "repo-zzz"',
      code: 1,
    }))
    const error = await new BeadsClient('/repo', runner).issue('repo-zzz').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(BdError)
    expect((error as BdError).status).toBe(404)
    expect((error as BdError).message).toBe('issue not found: repo-zzz')
  })

  it('reads comments and treats empty output as no comments', async () => {
    const withComments = fake(() =>
      JSON.stringify([
        { id: 'c1', issue_id: 'repo-abc', author: 'tester', text: 't', created_at: 'x' },
      ]),
    )
    expect(await new BeadsClient('/repo', withComments.runner).comments('repo-abc')).toHaveLength(1)
    expect(withComments.calls).toEqual([['comments', 'repo-abc', '--json']])

    const empty = fake(() => '\n')
    expect(await new BeadsClient('/repo', empty.runner).comments('repo-abc')).toEqual([])
  })

  it('reads the audit events, treating null and malformed rows as none', async () => {
    const rows = fake(() =>
      JSON.stringify([
        { event_type: 'label_removed', actor: 'agent:claude', comment: 'Removed label: x', created_at: '2026-10-20T11:00:00Z' },
        { event_type: 'updated' },
        null,
      ]),
    )
    expect(await new BeadsClient('/repo', rows.runner).auditEvents('repo-abc')).toHaveLength(1)
    expect(rows.calls).toEqual([['history', 'repo-abc', '--events', '--json']])
    // bd prints null for a bead with no audit rows
    expect(await new BeadsClient('/repo', fake(() => 'null\n').runner).auditEvents('repo-abc')).toEqual([])
  })
})

describe('comment', () => {
  it('comments then labels addLabel when set, passing text after --', async () => {
    const { client, calls } = clientFor()
    await client.comment('repo-abc', '-leading dash note', { addLabel: 'from-human' })
    expect(calls).toEqual([
      ['comments', 'add', 'repo-abc', '--', '-leading dash note'],
      ['update', 'repo-abc', '--add-label=from-human'],
    ])
  })

  it('adds and clears labels in one update, without reading the issue first', async () => {
    const { client, calls } = clientFor('open', { labels: ['needs-human', 'other'] }, 'human:mike')
    await client.comment('repo-abc', 'verdict', {
      addLabel: 'from-human',
      clearLabels: ['needs-human', 'non-existent'],
    })
    expect(calls).toEqual([
      ['comments', 'add', 'repo-abc', '--author=human:mike', '--', 'verdict'],
      ['update', 'repo-abc', '--add-label=from-human', '--remove-label=needs-human', '--remove-label=non-existent'],
    ])
  })

  it('runs only the comment when there is no label to change', async () => {
    const { client, calls } = clientFor()
    await client.comment('repo-abc', 'plain')
    expect(calls).toEqual([['comments', 'add', 'repo-abc', '--', 'plain']])
  })
})

describe('status transitions', () => {
  const write = (calls: string[][]) => calls.filter((args) => args[0] !== 'show')

  it('closes with a reason, defaulting the reason', async () => {
    const a = clientFor('open')
    await a.client.setStatus('repo-abc', 'closed')
    expect(write(a.calls)).toEqual([['close', 'repo-abc', '--reason', 'closed from beadside']])

    const b = clientFor('open')
    await b.client.setStatus('repo-abc', 'closed', 'done')
    expect(write(b.calls)).toEqual([['close', 'repo-abc', '--reason', 'done']])
  })

  it('defers, with --until when given', async () => {
    const a = clientFor('open')
    await a.client.setStatus('repo-abc', 'deferred')
    expect(write(a.calls)).toEqual([['defer', 'repo-abc']])

    const b = clientFor('open')
    await b.client.setStatus('repo-abc', 'deferred', undefined, 'next monday')
    expect(write(b.calls)).toEqual([['defer', 'repo-abc', '--until', 'next monday']])
  })

  it('re-dates an already deferred issue but no-ops otherwise', async () => {
    const same = clientFor('open')
    await same.client.setStatus('repo-abc', 'open')
    expect(write(same.calls)).toEqual([])

    const redate = clientFor('deferred')
    await redate.client.setStatus('repo-abc', 'deferred', undefined, '+1w')
    expect(write(redate.calls)).toEqual([['defer', 'repo-abc', '--until', '+1w']])
  })

  it('reopens from closed and undefers from deferred', async () => {
    const closed = clientFor('closed')
    await closed.client.setStatus('repo-abc', 'open')
    expect(write(closed.calls)).toEqual([['reopen', 'repo-abc']])

    const deferred = clientFor('deferred')
    await deferred.client.setStatus('repo-abc', 'open')
    expect(write(deferred.calls)).toEqual([['undefer', 'repo-abc']])
  })

  it('falls back to bd update for the plain statuses', async () => {
    const { client, calls } = clientFor('open')
    await client.setStatus('repo-abc', 'in_progress')
    expect(write(calls)).toEqual([['update', 'repo-abc', '--status', 'in_progress']])
  })

  it('rejects an unknown status and a hostile until', async () => {
    const { client } = clientFor('open')
    await expect(client.setStatus('repo-abc', 'wontfix' as never)).rejects.toThrow(
      /unsupported status/,
    )
    await expect(client.setStatus('repo-abc', 'deferred', undefined, 'a; rm -rf /')).rejects.toThrow(
      /invalid until/,
    )
  })
})

describe('keep and due', () => {
  it('keeps with one metadata stamp of the local day, then reads the issue back', async () => {
    const { client, calls } = clientFor()
    await client.keep('repo-abc', new Date(2026, 9, 3, 9, 30))
    expect(calls).toEqual([
      ['update', 'repo-abc', '--set-metadata', 'kept_at=2026-10-03'],
      ['show', 'repo-abc', '--json'],
    ])
  })

  it('re-dates with --due= and rejects a hostile value before spawning bd', async () => {
    const { client, calls } = clientFor()
    await client.setDue('repo-abc', 'next monday')
    await client.setDue('repo-abc', '2026-10-10T22:00:00Z')
    expect(calls.filter((args) => args[0] !== 'show')).toEqual([
      ['update', 'repo-abc', '--due=next monday'],
      ['update', 'repo-abc', '--due=2026-10-10T22:00:00Z'],
    ])
    const fresh = clientFor()
    await expect(fresh.client.setDue('repo-abc', 'x; rm -rf /')).rejects.toThrow(/invalid due/)
    await expect(fresh.client.setDue('repo-abc', '')).rejects.toThrow(/invalid due/)
    await expect(fresh.client.keep('--force')).rejects.toThrow(/invalid issue id/)
    expect(fresh.calls).toEqual([])
  })

  it('reads bd show dependencies into the export edge shape', async () => {
    const { client } = clientFor('open', {
      dependencies: [{ id: 'repo-hu8', title: 'x', status: 'open', dependency_type: 'supersedes' }],
    })
    const issue = await client.issue('repo-abc')
    expect(issue.dependencies).toEqual([{ issue_id: 'repo-abc', depends_on_id: 'repo-hu8', type: 'supersedes' }])
  })
})

describe('priority, labels and create', () => {
  it('updates priority and rejects anything outside 0-4', async () => {
    const { client, calls } = clientFor()
    await client.setPriority('repo-abc', 0)
    expect(calls[0]).toEqual(['update', 'repo-abc', '--priority', '0'])
    await expect(client.setPriority('repo-abc', 5)).rejects.toThrow(BdError)
    await expect(client.setPriority('repo-abc', 1.5)).rejects.toThrow(BdError)
  })

  it('sends one update carrying every add and remove', async () => {
    const { client, calls } = clientFor()
    await client.setLabels('repo-abc', ['feat', 'feat'], ['bug'])
    expect(calls[0]).toEqual(['update', 'repo-abc', '--add-label=feat', '--remove-label=bug'])
  })

  it('skips the update when there is nothing to change', async () => {
    const { client, calls } = clientFor()
    await client.setLabels('repo-abc', [], [])
    expect(calls).toEqual([['show', 'repo-abc', '--json']])
  })

  it('creates through bd q and reads back the printed id', async () => {
    const { runner, calls } = fake((args) =>
      args[0] === 'q' ? 'repo-new\n' : JSON.stringify([issueRecord({ id: 'repo-new' })]),
    )
    const issue = await new BeadsClient('/repo', runner).create('capture this', ['feat'])
    expect(calls[0]).toEqual(['q', '--labels=feat', '--', 'capture this'])
    expect(issue.id).toBe('repo-new')
  })

  it('creates through bd q with no labels when none given', async () => {
    const { runner, calls } = fake((args) =>
      args[0] === 'q' ? 'repo-new' : JSON.stringify([issueRecord({ id: 'repo-new' })]),
    )
    await new BeadsClient('/repo', runner).create('  capture this  ')
    expect(calls[0]).toEqual(['q', '--', 'capture this'])
  })

  it('surfaces bd stderr as the error message', async () => {
    const { runner } = fake(() => ({ stdout: '', stderr: 'bd exploded\ndetail line', code: 1 }))
    await expect(new BeadsClient('/repo', runner).issues()).rejects.toThrow('bd exploded')
  })
})

