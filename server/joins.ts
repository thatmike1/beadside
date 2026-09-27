// the two joins the bd cli cannot make: sessions that mention an issue id
// (AgentsView, optional) and notes files that mention it (local files).
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export interface SessionHit {
  session_id: string
  title: string
  prompt?: string
  day: string
  modified: string
  agent: string
  url: string
}

export interface NoteHit {
  file: string
  line: number
  excerpt: string
}

const SESSION_TIMEOUT_MS = 4_000
const SESSION_LIMIT = 8
const SEARCH_FETCH_LIMIT = 30
const MEMORY_LIMIT = 20
const EXCERPT_CHARS = 200

interface AgentsViewResult {
  session_id?: unknown
  project?: unknown
  agent?: unknown
  name?: unknown
  ordinal?: unknown
  session_ended_at?: unknown
  snippet?: unknown
  rank?: unknown
}

const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0)
const str = (value: unknown): string => (typeof value === "string" ? value : "")

let t3TitleCache: { expiresAt: number; titles: Map<string, string> } | null = null
const T3_TITLE_CACHE_TTL_MS = 5_000

export function clearT3TitleCache(): void {
  t3TitleCache = null
}

/**
 * reads session_id -> thread title from ~/.t3/userdata/state.sqlite
 * tolerates missing, corrupt or locked db by returning an empty map
 */
export function getT3Titles(customDbPath?: string): Map<string, string> {
  const now = Date.now()
  if (!customDbPath && t3TitleCache && t3TitleCache.expiresAt > now) {
    return t3TitleCache.titles
  }

  const titles = new Map<string, string>()
  const dbPath = customDbPath ?? join(homedir(), ".t3/userdata/state.sqlite")

  try {
    const db = new DatabaseSync(`file:${dbPath}?mode=ro`, { open: true, readOnly: true })
    try {
      const rows = db
        .prepare(
          `SELECT r.resume_cursor_json, t.title
           FROM provider_session_runtime r
           JOIN projection_threads t ON t.thread_id = r.thread_id
           WHERE t.deleted_at IS NULL
           ORDER BY r.last_seen_at ASC`,
        )
        .all() as Array<{ resume_cursor_json: unknown; title: unknown }>

      for (const row of rows) {
        if (typeof row.resume_cursor_json !== "string" || typeof row.title !== "string") continue
        try {
          const parsed = JSON.parse(row.resume_cursor_json)
          const sid =
            typeof parsed.resume === "string"
              ? parsed.resume
              : typeof parsed.sessionId === "string"
                ? parsed.sessionId
                : null
          const title = row.title.trim()
          if (sid && title) {
            titles.set(sid, title)
          }
        } catch {
          // ignore parse error
        }
      }
    } finally {
      db.close()
    }
  } catch {
    // missing or locked db; return empty map
  }

  if (!customDbPath) {
    t3TitleCache = { expiresAt: now + T3_TITLE_CACHE_TTL_MS, titles }
  }
  return titles
}

/**
 * sessions mentioning the issue id, from AgentsView search.
 * returns null when AgentsView is not configured or not reachable, which the ui
 * reads as "no session panel" rather than "no sessions".
 */
export async function sessionsFor(
  id: string,
  agentsviewUrl: string | null,
  t3DbPath?: string,
): Promise<SessionHit[] | null> {
  if (!agentsviewUrl) return null
  const base = agentsviewUrl.replace(/\/+$/, "")
  const url = `${base}/api/v1/search?q=${encodeURIComponent(id)}&limit=${SEARCH_FETCH_LIMIT}`

  let results: unknown[]
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(SESSION_TIMEOUT_MS) })
    if (!response.ok) return null
    const payload: unknown = await response.json()
    const rawResults = (payload as { results?: unknown })?.results
    if (!Array.isArray(rawResults)) return null
    results = rawResults
  } catch {
    return null
  }

  interface DedupedHit {
    sessionId: string
    name: string
    day: string
    modified: string
    agent: string
    ordinal: number
  }

  const deduped = new Map<string, DedupedHit>()

  for (const raw of results) {
    if (!raw || typeof raw !== "object") continue
    const r = raw as AgentsViewResult
    const sid = str(r.session_id)
    if (!sid) continue
    const ord = num(r.ordinal)
    const existing = deduped.get(sid)
    if (!existing) {
      const endedAt = str(r.session_ended_at)
      deduped.set(sid, {
        sessionId: sid,
        name: str(r.name),
        day: endedAt ? endedAt.slice(0, 10) : "",
        modified: endedAt,
        agent: str(r.agent),
        ordinal: ord,
      })
    } else if (ord < existing.ordinal) {
      existing.ordinal = ord
    }
  }

  const hits = Array.from(deduped.values()).slice(0, SESSION_LIMIT)
  const t3Titles = getT3Titles(t3DbPath)

  return hits.map((hit): SessionHit => {
    const t3Title = t3Titles.get(hit.sessionId)
    const title = t3Title || hit.name || hit.sessionId
    const prompt = t3Title && hit.name && hit.name !== t3Title ? hit.name : undefined
    return {
      session_id: hit.sessionId,
      title,
      prompt,
      day: hit.day,
      modified: hit.modified,
      agent: hit.agent,
      url: `${base}/sessions/${encodeURIComponent(hit.sessionId)}?msg=${hit.ordinal}`,
    }
  })
}

/** lines in markdown files under notesDir that mention the issue id */
export async function notesFor(
  id: string,
  repo: string,
  notesDir: string | null | undefined,
): Promise<NoteHit[]> {
  if (!notesDir) return []
  const baseDir = join(repo, notesDir)

  const mdFiles: string[] = []
  async function walk(dir: string): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue
        await walk(full)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        // forward slashes on every platform, so the api reports the same path everywhere
        mdFiles.push(relative(baseDir, full).split(sep).join('/'))
      }
    }
  }

  await walk(baseDir)
  mdFiles.sort()

  const hits: NoteHit[] = []
  for (const relFile of mdFiles) {
    if (hits.length >= MEMORY_LIMIT) break
    let content: string
    try {
      content = await readFile(join(baseDir, relFile), 'utf8')
    } catch {
      continue
    }
    if (!content.includes(id)) continue
    const lines = content.split('\n')
    for (let index = 0; index < lines.length && hits.length < MEMORY_LIMIT; index += 1) {
      const line = lines[index]!
      if (!line.includes(id)) continue
      const excerpt = line.trim()
      hits.push({
        file: relFile,
        line: index + 1,
        excerpt: excerpt.length > EXCERPT_CHARS ? `${excerpt.slice(0, EXCERPT_CHARS - 1)}…` : excerpt,
      })
    }
  }
  return hits
}
