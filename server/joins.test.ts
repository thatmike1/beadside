import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { clearT3TitleCache, getT3Titles, notesFor, sessionsFor } from './joins'

describe('getT3Titles', () => {
  let tmpDir: string
  let dbPath: string

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 't3-title-test-'))
    dbPath = join(tmpDir, 'state.sqlite')

    const db = new DatabaseSync(dbPath)
    db.exec(`
      CREATE TABLE projection_threads (
        thread_id TEXT PRIMARY KEY,
        title TEXT,
        deleted_at TEXT
      );
      CREATE TABLE provider_session_runtime (
        thread_id TEXT,
        resume_cursor_json TEXT,
        last_seen_at TEXT
      );
    `)

    // thread 1
    db.exec(`
      INSERT INTO projection_threads VALUES ('t1', 'First Thread', NULL);
      INSERT INTO provider_session_runtime VALUES ('t1', '{"resume":"sess-1"}', '2026-09-01T10:00:00Z');
    `)

    // thread 2 resumes sess-1 later with updated title
    db.exec(`
      INSERT INTO projection_threads VALUES ('t2', 'Updated Thread Title', NULL);
      INSERT INTO provider_session_runtime VALUES ('t2', '{"resume":"sess-1"}', '2026-09-02T10:00:00Z');
    `)

    // thread 3 with sessionId (non-claude / antigravity)
    db.exec(`
      INSERT INTO projection_threads VALUES ('t3', 'Antigravity Thread', NULL);
      INSERT INTO provider_session_runtime VALUES ('t3', '{"sessionId":"sess-2"}', '2026-09-03T10:00:00Z');
    `)

    // thread 4 is deleted
    db.exec(`
      INSERT INTO projection_threads VALUES ('t4', 'Deleted Thread', '2026-09-04T10:00:00Z');
      INSERT INTO provider_session_runtime VALUES ('t4', '{"resume":"sess-deleted"}', '2026-09-04T10:00:00Z');
    `)

    db.close()
  })

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    clearT3TitleCache()
  })

  it('extracts session_id to title map, with later rows overriding earlier ones', () => {
    const titles = getT3Titles(dbPath)
    expect(titles.get('sess-1')).toBe('Updated Thread Title')
    expect(titles.get('sess-2')).toBe('Antigravity Thread')
    expect(titles.has('sess-deleted')).toBe(false)
  })

  it('returns an empty map for a missing database', () => {
    const titles = getT3Titles(join(tmpDir, 'nonexistent.sqlite'))
    expect(titles.size).toBe(0)
  })
})

describe('sessionsFor', () => {
  let server: Server
  let baseUrl: string
  let searchResults: unknown[] = []
  let statusToReturn = 200

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname === '/api/v1/search') {
        if (statusToReturn !== 200) {
          res.writeHead(statusToReturn, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'server error' }))
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ query: url.searchParams.get('q'), results: searchResults }))
        return
      }
      res.writeHead(404)
      res.end()
    })

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const addr = server.address()
    if (addr && typeof addr === 'object') {
      baseUrl = `http://127.0.0.1:${addr.port}`
    }
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  beforeEach(() => {
    statusToReturn = 200
    searchResults = []
    clearT3TitleCache()
  })

  it('returns null when url is null or server is unreachable', async () => {
    expect(await sessionsFor('issue-1', null)).toBeNull()
    statusToReturn = 500
    expect(await sessionsFor('issue-1', baseUrl, join(tmpdir(), 'beadside-missing-test-titles.sqlite'))).toBeNull()
    expect(await sessionsFor('issue-1', 'http://127.0.0.1:59999')).toBeNull()
  })

  it('dedupes multiple results by session_id, keeping the lowest ordinal', async () => {
    searchResults = [
      {
        session_id: 's1',
        name: 'First prompt for s1',
        ordinal: 42,
        session_ended_at: '2026-09-07T12:00:00Z',
        agent: 'claude',
      },
      {
        session_id: 's2',
        name: 'First prompt for s2',
        ordinal: 15,
        session_ended_at: '2026-09-08T14:30:00Z',
        agent: 'codex',
      },
      {
        session_id: 's1',
        name: 'First prompt for s1',
        ordinal: 5, // lower than 42
        session_ended_at: '2026-09-07T12:00:00Z',
        agent: 'claude',
      },
    ]

    const hits = await sessionsFor('issue-1', baseUrl, join(tmpdir(), 'beadside-missing-test-titles.sqlite'))
    expect(hits).not.toBeNull()
    expect(hits).toHaveLength(2)

    // s1 should have lowest ordinal 5
    expect(hits![0]).toEqual({
      session_id: 's1',
      title: 'First prompt for s1',
      prompt: undefined,
      day: '2026-09-07',
      modified: '2026-09-07T12:00:00Z',
      agent: 'claude',
      url: `${baseUrl}/sessions/s1?msg=5`,
    })

    // s2 should have ordinal 15
    expect(hits![1]).toEqual({
      session_id: 's2',
      title: 'First prompt for s2',
      prompt: undefined,
      day: '2026-09-08',
      modified: '2026-09-08T14:30:00Z',
      agent: 'codex',
      url: `${baseUrl}/sessions/s2?msg=15`,
    })
  })

  it('incorporates T3 thread title and places first prompt underneath', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 't3-join-test-'))
    const dbPath = join(tmpDir, 'state.sqlite')
    const db = new DatabaseSync(dbPath)
    db.exec(`
      CREATE TABLE projection_threads (thread_id TEXT PRIMARY KEY, title TEXT, deleted_at TEXT);
      CREATE TABLE provider_session_runtime (thread_id TEXT, resume_cursor_json TEXT, last_seen_at TEXT);
      INSERT INTO projection_threads VALUES ('t1', 'Human Thread Title', NULL);
      INSERT INTO provider_session_runtime VALUES ('t1', '{"resume":"s-t3"}', '2026-09-01T10:00:00Z');
    `)
    db.close()

    searchResults = [
      {
        session_id: 's-t3',
        name: 'First user prompt',
        ordinal: 8,
        session_ended_at: '2026-09-09T18:00:00Z',
        agent: 'claude',
      },
    ]

    const hits = await sessionsFor('issue-1', baseUrl, dbPath)
    expect(hits).not.toBeNull()
    expect(hits![0]).toEqual({
      session_id: 's-t3',
      title: 'Human Thread Title',
      prompt: 'First user prompt',
      day: '2026-09-09',
      modified: '2026-09-09T18:00:00Z',
      agent: 'claude',
      url: `${baseUrl}/sessions/s-t3?msg=8`,
    })

    await rm(tmpDir, { recursive: true, force: true })
  })
})

describe('notesFor', () => {
  let tmpRepo: string

  beforeAll(async () => {
    tmpRepo = await mkdtemp(join(tmpdir(), 'notes-test-repo-'))
    const notesBase = join(tmpRepo, 'docs-notes')
    await mkdir(join(notesBase, 'sub'), { recursive: true })

    await writeFile(join(notesBase, 'root.md'), 'overview\nline with demo-123 in root\nother line')
    await writeFile(join(notesBase, 'sub', 'nested.md'), 'first\nsecond with demo-123 in nested')
    await writeFile(join(notesBase, 'unrelated.txt'), 'not markdown demo-123')
  })

  afterAll(async () => {
    await rm(tmpRepo, { recursive: true, force: true })
  })

  it('returns empty array when notesDir is null or empty', async () => {
    expect(await notesFor('demo-123', tmpRepo, null)).toEqual([])
    expect(await notesFor('demo-123', tmpRepo, '')).toEqual([])
  })

  it('returns empty array when notes directory does not exist', async () => {
    expect(await notesFor('demo-123', tmpRepo, 'nonexistent')).toEqual([])
  })

  it('finds hits in root and subdirectories with relative file paths', async () => {
    const hits = await notesFor('demo-123', tmpRepo, 'docs-notes')
    expect(hits).toHaveLength(2)
    expect(hits[0]).toEqual({
      file: 'root.md',
      line: 2,
      excerpt: 'line with demo-123 in root',
    })
    expect(hits[1]).toEqual({
      file: 'sub/nested.md',
      line: 2,
      excerpt: 'second with demo-123 in nested',
    })
  })
})
