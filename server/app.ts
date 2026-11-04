// the http surface described in docs/api.md. every route maps to one fixed bd
// argument shape; the client never gets to name a command or a flag.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, isAbsolute } from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { agentReply, classifyAuthor, humanNoteAt, defaultHuman, type HumanIdentity } from './authors'
import { answeredAsk, askEntries, assertVia, parseAsk, postedAlready, raisedSince, rawAsk } from './asks'
import { assertId, BdError, type BeadsClient, type Issue, type IssueWithComments, type Status } from './bd'
import { resolveConfig, type ResolvedBoardConfig } from './config'
import {
  assertDay,
  assertPickIds,
  assertTimestamp,
  deviceName,
  KV_PREFIX,
  picksKey,
  picksValue,
  readInboxState,
  seenKey,
} from './inbox-state'
import { notesFor, sessionsFor } from './joins'
import { LiveFeed, type LiveFeedOptions, type LiveState } from './live'
import { noteRead } from './note-read'
import { DEFAULT_LIMIT, SCOPES, searchIssues, type SearchScope } from './search'
import {
  assertVerdict,
  assertVerdictNote,
  parseTry,
  rawTry,
  tryEntries,
  unfinishedWorks,
  verdictComment,
  verdictPosted,
  withLast,
  withPending,
  type TryLast,
} from './tries'

export interface AppConfig {
  client: BeadsClient
  repo: { name: string; path: string }
  agentsview: string | null
  /** who the board writes comments as; defaults to `human:$USER` */
  human?: HumanIdentity
  /** per-launch token; generated when omitted */
  token?: string
  config?: ResolvedBoardConfig
  /** absolute path to the built ui, served at / when it exists */
  uiDist?: string | null
  /** names this board's keys in bd's kv store; defaults to the hostname */
  device?: string
  /** follow the events journal and push changes; off unless given (tests stay spawn-free) */
  live?: LiveOptions | false
}

export type LiveOptions = Partial<Omit<LiveFeedOptions, 'follow' | 'onChange' | 'onState'>> & {
  /** how often a live board re-exports anyway, for changes the journal never sees (a sync) */
  reconcileMs?: number
}

/** a message on `/api/events` */
export type BoardEvent = { type: 'state'; live: boolean } | { type: 'changed' }

export interface Board {
  app: Hono
  /** stops the journal follower and the timers; the http server is the caller's */
  close(): void
}

/** a fresh per-launch token for the x-bd-token header */
export function newToken(): string {
  return randomBytes(24).toString('hex')
}

/**
 * origins allowed to read `/api/issue-ids` cross-origin: the T3 Code desktop
 * renderer, and loopback pages, which are local processes that could run `bd`
 * themselves. anything else still gets a response, just not a readable one.
 */
export function idsOriginAllowed(origin: string): boolean {
  if (origin === 't3code://app' || origin === 't3code-dev://app') return true
  try {
    const url = new URL(origin)
    return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
  } catch {
    return false
  }
}

const LOOPBACK_NAMES = new Set(['127.0.0.1', 'localhost', '[::1]'])

/** a Host value's hostname, lowercased, with any port dropped; `[::1]:1338` keeps its brackets */
function hostnameOf(host: string): string {
  const h = host.trim().toLowerCase()
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1)
  const colon = h.lastIndexOf(':')
  return colon === -1 ? h : h.slice(0, colon)
}

/**
 * whether a request's Host names this board: a loopback name on any port (the board, or the vite
 * dev server proxying to it), or an entry of `hosts` in the config, which matches its hostname on
 * any port, or only that port when it names one. anything else is a page that resolved its own
 * name to this machine (dns rebinding), which must not read the session token or the data
 */
export function hostAllowed(host: string | undefined, hosts: readonly string[]): boolean {
  if (!host) return false
  const h = host.trim().toLowerCase()
  const name = hostnameOf(h)
  if (LOOPBACK_NAMES.has(name)) return true
  return hosts.some((entry) => (entry.includes(':') && !entry.startsWith('[') ? entry === h : entry === name || entry === h))
}

/** whether a write's Origin is one of this board's own pages: http(s) on an allowed host */
export function originAllowed(origin: string, hosts: readonly string[]): boolean {
  try {
    const url = new URL(origin)
    return (url.protocol === 'http:' || url.protocol === 'https:') && hostAllowed(url.host, hosts)
  } catch {
    return false
  }
}

function tokenMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** reads a JSON object body, rejecting anything else */
async function readBody(c: Context): Promise<Record<string, unknown>> {
  let payload: unknown
  try {
    payload = await c.req.json()
  } catch {
    throw new BdError('request body must be valid JSON')
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new BdError('request body must be a JSON object')
  }
  return payload as Record<string, unknown>
}

function stringArray(value: unknown, what: string): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new BdError(`${what} must be an array of strings`)
  }
  return value as string[]
}

/** what a check's kit image may be, by extension */
const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
}

/** how long a search may reuse the last `bd export` before reading the ledger again */
const CORPUS_MAX_AGE_MS = 5_000
const MAX_SEARCH_LIMIT = 500
// a reconcile on an unchanged local store costs a file read, not a bd run; see storeStamp
const RECONCILE_MS = 30_000
const KEEPALIVE_MS = 25_000
const SETTLE_RETRY_MS = 60_000

interface CorpusEntry {
  at: number
  corpus: IssueWithComments[]
  fingerprint: string
}

/** builds the Hono app alone, for callers that never turn the live feed on */
export function createApp(config: AppConfig): Hono {
  return createBoard(config).app
}

/** builds the Hono app and its live feed; `serve` in main.ts binds the app to 127.0.0.1 */
export function createBoard(config: AppConfig): Board {
  const { client, repo, agentsview } = config
  const token = config.token ?? newToken()
  const boardConfig = config.config ?? resolveConfig({})
  const human = config.human ?? defaultHuman(process.env['USER'] ?? process.env['USERNAME'] ?? 'unknown')
  const uiDist = config.uiDist ?? null
  const device = config.device ?? deviceName()

  // one export serves the list, search and ids. without the live feed a list read always
  // re-exports; with it the cache holds until the feed, a write or the reconcile says otherwise.
  // `generation` keeps an export that started before an invalidation from landing after it.
  let cache: CorpusEntry | null = null
  let inflight: { generation: number; promise: Promise<CorpusEntry> } | null = null
  let generation = 0
  // the store as the last finished export saw it, so a reconcile can skip an export that would match
  let exportedStamp: string | null = null
  const invalidate = () => {
    generation += 1
    cache = null
  }
  const exportCorpus = (): Promise<CorpusEntry> => {
    if (inflight && inflight.generation === generation) return inflight.promise
    const started = generation
    const stamp = client.stamp()
    const promise = client
      .corpus()
      .then((corpus) => {
        const entry = { at: Date.now(), corpus, fingerprint: fingerprintOf(corpus) }
        exportedStamp = stamp
        if (started === generation) cache = entry
        settleUnfinished(corpus)
        return entry
      })
      .finally(() => {
        if (inflight?.promise === promise) inflight = null
      })
    inflight = { generation: started, promise }
    return promise
  }
  const loadCorpus = async (maxAgeMs: number): Promise<IssueWithComments[]> => {
    if (cache && Date.now() - cache.at < maxAgeMs) return cache.corpus
    return (await exportCorpus()).corpus
  }

  // browsers on /api/events
  const listeners = new Set<(event: BoardEvent) => void>()
  const broadcast = (event: BoardEvent) => {
    for (const listener of listeners) listener(event)
  }

  // live feed: journal records re-export and announce; the reconcile catches what the journal
  // cannot see (a sync lands rows as data) and announces only when the ledger really moved
  const liveOptions = config.live === undefined || config.live === false ? null : config.live
  let announced: string | null = null
  const refresh = async (always: boolean) => {
    if (!always && announced !== null) {
      // nothing written since the last export: a sync or another clone's work would have moved it
      const stamp = client.stamp()
      if (stamp !== null && stamp === exportedStamp) return
    }
    invalidate()
    try {
      const { fingerprint } = await exportCorpus()
      if (!always && fingerprint === announced) return
      announced = fingerprint
      broadcast({ type: 'changed' })
    } catch (error) {
      liveOptions?.log?.(`re-export failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  let reconcile: ReturnType<typeof setInterval> | null = null
  const feed = liveOptions
    ? new LiveFeed({
        ...liveOptions,
        follow: (since, handlers) => client.follow(since, handlers),
        onChange: () => void refresh(true),
        onState: (state: LiveState) => {
          if (reconcile) clearInterval(reconcile)
          reconcile = null
          if (state === 'live') {
            reconcile = setInterval(() => void refresh(false), liveOptions.reconcileMs ?? RECONCILE_MS)
            // whatever changed while the feed was down or starting
            void refresh(true)
          }
          if (state !== 'starting') broadcast({ type: 'state', live: state === 'live' })
        },
      })
    : null
  const isLive = () => feed?.state === 'live'
  // how stale a cached export may be for a read: a live board trusts the cache
  const listAge = () => (isLive() ? Infinity : 0)
  const searchAge = () => (isLive() ? Infinity : CORPUS_MAX_AGE_MS)

  // bd writes go through one dolt working set; keep them one at a time. a kv write leaves
  // the issues alone, so it keeps the cached export
  let writeChain: Promise<unknown> = Promise.resolve()
  const serialise = <T>(work: () => Promise<T>, touchesIssues = true): Promise<T> => {
    if (touchesIssues) invalidate()
    const next = writeChain.then(work, work).finally(() => {
      if (touchesIssues) invalidate()
    })
    writeChain = next.catch(() => undefined)
    return next
  }

  // a works verdict that closed its bead and failed to take the label off leaves a bead nothing
  // lists any more; every export finds those and finishes them, each at most once a minute
  const settleTried = new Map<string, number>()
  const settleUnfinished = (corpus: IssueWithComments[]) => {
    const tries = boardConfig.tryIt
    if (!tries) return
    for (const { issue } of corpus) {
      if (!unfinishedWorks(issue, tries.label, tries.key)) continue
      if (Date.now() - (settleTried.get(issue.id) ?? 0) < SETTLE_RETRY_MS) continue
      settleTried.set(issue.id, Date.now())
      void serialise(async () => {
        // read fresh: a session may have reopened or relabelled it meanwhile
        const fresh = await client.issue(issue.id)
        const unfinished = unfinishedWorks(fresh, tries.label, tries.key)
        if (!unfinished) return
        const outcome = await finishWorks(issue.id, rawTry(fresh['metadata'], tries.key) ?? {}, unfinished)
        if (outcome.failed) throw new Error(outcome.failed.error)
      }).catch((error: unknown) => {
        liveOptions?.log?.(`finishing ${issue.id} failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
  }

  const app = new Hono()
  const createdHere = new Set<string>()

  app.onError((error, c) => {
    if (error instanceof BdError) return c.json({ error: error.message }, error.status as ContentfulStatusCode)
    const message = error instanceof Error ? error.message : 'server error'
    return c.json({ error: message }, 500)
  })

  // every request must name this board in its Host, so a rebound dns name gets nothing, the
  // session token least of all
  app.use('*', async (c, next) => {
    const host = c.req.header('host') ?? new URL(c.req.url).host
    if (!hostAllowed(host, boardConfig.hosts)) {
      return c.json({ error: `unknown host ${host}: add it to hosts in .beadside.json to reach the board under it` }, 403)
    }
    return next()
  })

  // every write needs the per-launch token, and a browser's write must come from the board's own
  // pages; a server forwarding a write sends no Origin and needs only the token
  app.use('/api/*', async (c, next) => {
    if (c.req.method !== 'POST' && c.req.method !== 'DELETE') return next()
    const origin = c.req.header('origin')
    if (origin !== undefined && !originAllowed(origin, boardConfig.hosts)) {
      return c.json({ error: `writes from ${origin} are refused` }, 403)
    }
    if (!tokenMatches(c.req.header('x-bd-token') ?? '', token)) {
      return c.json({ error: 'invalid or missing x-bd-token' }, 403)
    }
    return next()
  })

  app.get('/api/session', (c) =>
    // config.human is filled with the identity in use, so the ui never has to guess the default
    c.json({ token, repo, agentsview, me: human.id, human, config: { ...boardConfig, human } }),
  )

  // each issue carries `agent_reply`: the newest agent comment after the human's latest note,
  // and `note_at`, that note's time, which the export has and the issue record does not
  app.get('/api/issues', async (c) => {
    const issues = (await loadCorpus(listAge())).map(({ issue, comments }) => ({
      ...issue,
      agent_reply: agentReply(comments, human),
      note_at: humanNoteAt(comments, human),
    }))
    return c.json({ issues, fetchedAt: new Date().toISOString() })
  })

  // same ranking as `beadside search`; reads comments from the export, not per issue
  app.get('/api/search', async (c) => {
    const query = c.req.query('q') ?? ''
    const scope = (c.req.query('scope') ?? 'all') as SearchScope
    if (!SCOPES.includes(scope)) throw new BdError('scope must be all, open or closed')
    const rawLimit = c.req.query('limit')
    const limit = rawLimit === undefined ? DEFAULT_LIMIT : Number(rawLimit)
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SEARCH_LIMIT) {
      throw new BdError(`limit must be an integer between 1 and ${MAX_SEARCH_LIMIT}`)
    }
    if (!query.trim()) return c.json(searchIssues([], query, { scope, limit, human }))
    const corpus = await loadCorpus(searchAge())
    return c.json(searchIssues(corpus, query, { scope, limit, human }))
  })

  // server-sent events: `state` on connect and whenever live updates start or stop, `changed`
  // when the ledger moved. same-origin only, like every route but /api/issue-ids
  app.get('/api/events', (c) =>
    streamSSE(c, async (stream) => {
      let closed = false
      const send = (event: BoardEvent) => {
        if (closed) return
        const { type, ...data } = event
        void stream.writeSSE({ event: type, data: JSON.stringify(data) }).catch(() => undefined)
      }
      listeners.add(send)
      stream.onAbort(() => {
        closed = true
        listeners.delete(send)
      })
      send({ type: 'state', live: isLive() })
      while (!closed) {
        await stream.sleep(KEEPALIVE_MS)
        if (!closed) await stream.write(': keepalive\n\n').catch(() => undefined)
      }
    }),
  )

  // ids only, so a page that is allowed to read it cross-origin learns nothing else
  app.get('/api/issue-ids', async (c) => {
    const origin = c.req.header('origin')
    if (origin && idsOriginAllowed(origin)) {
      c.header('Access-Control-Allow-Origin', origin)
      c.header('Vary', 'Origin')
    }
    const corpus = await loadCorpus(searchAge())
    return c.json({ ids: corpus.map((entry) => entry.issue.id) })
  })

  app.get('/api/issues/:id', async (c) => c.json(await detail(c.req.param('id'))))

  app.post('/api/issues', async (c) => {
    const body = await readBody(c)
    const title = body['title']
    if (typeof title !== 'string') throw new BdError('title must be a string')
    const hasLabels = body['labels'] !== undefined && body['labels'] !== null
    const wanted = hasLabels ? stringArray(body['labels'], 'labels') : boardConfig.capture.labels
    const issue = await serialise(() => client.create(title, wanted))
    createdHere.add(issue.id)
    return c.json({ issue })
  })

  // undo for quick capture: only beads this process filed can be removed
  app.delete('/api/issues/:id', async (c) => {
    const id = c.req.param('id')
    if (!createdHere.has(id)) throw new BdError('only beads created from this board session can be deleted', 403)
    await serialise(() => client.remove(id))
    createdHere.delete(id)
    return c.json({ deleted: id })
  })

  app.post('/api/issues/:id/comment', async (c) => {
    const id = c.req.param('id')
    const body = await readBody(c)
    const text = body['text']
    if (typeof text !== 'string') throw new BdError('text must be a string')
    const clear = body['clear']
    if (clear !== undefined && typeof clear !== 'boolean') throw new BdError('clear must be a boolean')
    const clearLabels = clear === true ? boardConfig.note.offerToClear : []
    await serialise(() => client.comment(id, text, { addLabel: boardConfig.note.addLabel, clearLabels }))
    return c.json(await detail(id))
  })

  app.post('/api/issues/:id/status', async (c) => {
    const id = c.req.param('id')
    const body = await readBody(c)
    const status = body['status']
    if (typeof status !== 'string') throw new BdError('status must be a string')
    const reason = body['reason']
    const until = body['until']
    if (reason !== undefined && typeof reason !== 'string') throw new BdError('reason must be a string')
    if (until !== undefined && typeof until !== 'string') throw new BdError('until must be a string')
    const issue = await serialise(() => client.setStatus(id, status as Status, reason, until))
    return c.json({ issue })
  })

  app.post('/api/issues/:id/priority', async (c) => {
    const id = c.req.param('id')
    const body = await readBody(c)
    const priority = body['priority']
    if (typeof priority !== 'number') throw new BdError('priority must be a number')
    const issue = await serialise(() => client.setPriority(id, priority))
    return c.json({ issue })
  })

  app.post('/api/issues/:id/labels', async (c) => {
    const id = c.req.param('id')
    const body = await readBody(c)
    const add = stringArray(body['add'], 'add')
    const remove = stringArray(body['remove'], 'remove')
    const issue = await serialise(() => client.setLabels(id, add, remove))
    return c.json({ issue })
  })

  // keep: a stale bead stays as it is and leaves the stale filter
  app.post('/api/issues/:id/keep', async (c) => {
    const id = c.req.param('id')
    const issue = await serialise(() => client.keep(id))
    return c.json({ issue })
  })

  app.post('/api/issues/:id/due', async (c) => {
    const id = c.req.param('id')
    const body = await readBody(c)
    const due = body['due']
    if (typeof due !== 'string') throw new BdError('due must be a string')
    const issue = await serialise(() => client.setDue(id, due))
    return c.json({ issue })
  })

  // questions stored on beads (asks in .beadside.json): every open one, plus the wanted ids in any
  // state. a page on another local port reads this through its own server, never cross-origin
  app.get('/api/asks', async (c) => {
    const asks = boardConfig.asks
    if (!asks) throw new BdError('asks are off: no asks block in the board config', 404)
    const wanted = (c.req.query('ids') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
    if (wanted.length > 200) throw new BdError('at most 200 ids')
    for (const id of wanted) assertId(id)
    const corpus = await loadCorpus(searchAge())
    return c.json({ key: asks.key, asks: askEntries(corpus, asks.key, repo.name, wanted) })
  })

  // answers a stored question: the note the note box would send (author, note flag), then the
  // question rewritten with its answer, read fresh so nothing an agent wrote meanwhile is lost
  app.post('/api/issues/:id/ask/answer', async (c) => {
    const asks = boardConfig.asks
    if (!asks) throw new BdError('asks are off: no asks block in the board config', 404)
    const id = assertId(c.req.param('id'))
    const body = await readBody(c)
    const text = body['text']
    if (typeof text !== 'string' || !text.trim()) throw new BdError('text must be a non-empty string')
    const via = assertVia(body['via'])
    // like the note box, an answer clears the waiting labels unless told not to: it is the call
    const clear = body['clear']
    if (clear !== undefined && typeof clear !== 'boolean') throw new BdError('clear must be a boolean')
    const clearLabels = clear === false ? [] : boardConfig.note.offerToClear
    await serialise(async () => {
      const { issue, comments } = await client.issueWithComments(id)
      const raw = rawAsk(issue['metadata'], asks.key)
      if (!raw || !parseAsk({ [asks.key]: raw }, asks.key)) throw new BdError(`${id} has no question stored`, 409)
      // a page from an older day may show a question a later hub reworded; it answers on that day's page
      const later = raisedSince(raw, body['raised'])
      if (later) throw new BdError(`${id}: a later hub raised this question again on ${later}, answer it there`, 412)
      const now = new Date()
      // a retry finishes the note flags and answer stamp without duplicating its comment
      const answered = answeredAsk(raw, { text, by: human.id, via, at: now })
      if (!postedAlready(comments, human.id, text, now)) {
        await client.comment(id, text, {
          addLabel: boardConfig.note.addLabel,
          clearLabels,
          metadata: { key: asks.key, value: answered },
        })
      } else {
        await client.setLabels(id, boardConfig.note.addLabel ? [boardConfig.note.addLabel] : [], clearLabels)
        await client.setMetadata(id, asks.key, answered)
      }
    })
    return c.json(await detail(id))
  })

  // checks only the human can make (tryIt in .beadside.json): every open bead carrying the label,
  // with its kit. home base reads this through its own server, never cross-origin
  app.get('/api/tries', async (c) => {
    const tries = boardConfig.tryIt
    if (!tries) throw new BdError('try-it is off: no tryIt block in the board config', 404)
    const corpus = await loadCorpus(searchAge())
    return c.json({ label: tries.label, key: tries.key, tries: tryEntries(corpus, tries.label, tries.key) })
  })

  // the n-th image of a check's kit, when it is a local file: the page cannot load file urls. only
  // images a ready-to-try bead's kit names are served, so this never reads an arbitrary path
  app.get('/api/tries/:id/image/:n', async (c) => {
    const tries = boardConfig.tryIt
    if (!tries) throw new BdError('try-it is off: no tryIt block in the board config', 404)
    const id = assertId(c.req.param('id'))
    const n = Number(c.req.param('n'))
    if (!Number.isInteger(n) || n < 0) throw new BdError('image index must be a whole number')
    const issue = await client.issue(id)
    const kit = issue.labels.includes(tries.label) ? parseTry(issue['metadata'], tries.key) : null
    const image = kit?.kit.filter((item) => item.type === 'image')[n]
    const src = image?.type === 'image' ? image.src : null
    const type = src ? IMAGE_TYPES[extname(src).toLowerCase()] : undefined
    if (!src || !isAbsolute(src) || !type) throw new BdError(`${id} has no local image ${n} in its check`, 404)
    let data: Buffer
    try {
      data = await readFile(src)
    } catch {
      throw new BdError(`image not readable: ${src}`, 404)
    }
    return c.body(new Uint8Array(data), 200, {
      'content-type': type,
      'cache-control': 'no-store',
      // an svg opened on its own runs nothing
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
      'x-content-type-options': 'nosniff',
    })
  })

  // the human's verdict on a check: works closes the bead, broken hands it back to agents, cant
  // keeps it ready to try and flags the obstacle. read fresh, refused once the label is gone, so a
  // double click or an old tab never settles a bead twice
  app.post('/api/issues/:id/try/verdict', async (c) => {
    const tries = boardConfig.tryIt
    if (!tries) throw new BdError('try-it is off: no tryIt block in the board config', 404)
    const id = assertId(c.req.param('id'))
    const body = await readBody(c)
    const verdict = assertVerdict(body['verdict'])
    const note = assertVerdictNote(verdict, body['note'])
    const flag = boardConfig.note.addLabel
    const outcome = await serialise(async (): Promise<{ last: TryLast; failed: { state: string; error: string } | null }> => {
      const { issue, comments } = await client.issueWithComments(id)
      if (!issue.labels.includes(tries.label)) {
        throw new BdError(`${id} no longer carries ${tries.label}: the check is already settled`, 409)
      }
      const raw = rawTry(issue['metadata'], tries.key) ?? {}
      if (issue.status === 'closed') {
        // only a works whose close landed and whose label did not: finish it, the comment is there
        const unfinished = unfinishedWorks(issue, tries.label, tries.key)
        if (verdict !== 'works' || !unfinished) throw new BdError(`${id} is closed: the check is already settled`, 409)
        return finishWorks(id, raw, unfinished)
      }
      const kit = parseTry(issue['metadata'], tries.key)
      const text = verdictComment(verdict, kit?.title ?? issue.title, note, kit?.expect ?? null)
      // a retry, at any later time, finishes the rest under its first marker without a second comment
      const seen = verdictPosted(raw, comments, human.id, verdict, note, text)
      const at = seen ? new Date(seen.at) : new Date()
      if (!seen) await client.amend(id, { metadata: { key: tries.key, value: withPending(raw, { result: verdict, at, note }) } })
      if (!seen?.posted) await client.comment(id, text)
      const value = withLast(raw, { result: verdict, at, note })
      const metadata = { key: tries.key, value }
      const last = value['last'] as TryLast
      // from here the comment is on the bead; a failure says what state it left
      let state = verdict === 'works' ? 'the bead is still open' : `its labels and ${tries.key}.last did not change`
      try {
        if (verdict === 'works') {
          // the label comes off last, with the marker: a failed close leaves both on, so a retry can
          // finish the job, and a closed bead still carrying them is finished on the next read
          await client.setStatus(id, 'closed', 'tried on the real thing: it works')
          state = `the bead is closed but still carries ${tries.label}; the board finishes that on its next read`
          await client.amend(id, { remove: [tries.label], metadata })
        } else {
          await client.amend(id, {
            add: flag ? [flag] : [],
            remove: verdict === 'broken' ? [tries.label] : [],
            metadata,
          })
        }
      } catch (error) {
        return { last, failed: { state, error: error instanceof Error ? error.message : String(error) } }
      }
      return { last, failed: null }
    })
    if (outcome.failed) {
      const { state, error } = outcome.failed
      return c.json(
        {
          error: `your verdict comment is saved on ${id}, but ${state} (${error}). send the same verdict again to finish`,
          commented: true,
        },
        502,
      )
    }
    return c.json({ ...(await detail(id)), verdict: outcome.last })
  })

  // the inbox's memory, shared by every board on this beads database through `bd kv`
  app.get('/api/inbox-state', async (c) => {
    const day = assertDay(c.req.query('day'))
    return c.json(readInboxState(await client.kvList(KV_PREFIX), day, device))
  })

  // opening a bead marks its agent reply seen, under this device's key only
  app.post('/api/issues/:id/seen', async (c) => {
    const id = c.req.param('id')
    const key = seenKey(device, id)
    const at = assertTimestamp((await readBody(c))['at'])
    const stored = await serialise(async () => {
      const current = (await client.kvList(key))[key]
      if (current && Date.parse(current) >= Date.parse(at)) return current
      await client.kvSet(key, at)
      return at
    }, false)
    return c.json({ id, at: stored })
  })

  // stores a day's stale picks for this device, then answers with the picks that hold:
  // another device's when it drew first
  app.post('/api/stale-picks', async (c) => {
    const body = await readBody(c)
    const day = assertDay(body['day'])
    const ids = assertPickIds(body['ids'])
    const stored = await serialise(async () => {
      const current = readInboxState(await client.kvList(KV_PREFIX), day, device)
      if (current.picks) return current
      await client.kvSet(picksKey(device), picksValue({ day, ids }, new Date()))
      return readInboxState(await client.kvList(KV_PREFIX), day, device)
    }, false)
    return c.json(stored)
  })

  app.all('/api/*', (c) => c.json({ error: 'not found' }, 404))

  if (uiDist && existsSync(uiDist)) {
    app.use('/*', serveStatic({ root: uiDist }))
    // client-side routes fall back to the spa shell
    app.get('/*', serveStatic({ path: `${uiDist}/index.html` }))
  }

  /** the last write of a works verdict: the label off, `last` from the marker, the marker gone */
  async function finishWorks(id: string, raw: Record<string, unknown>, unfinished: TryLast) {
    const tries = boardConfig.tryIt!
    const value = withLast(raw, { result: 'works', at: new Date(unfinished.at), note: unfinished.note })
    try {
      await client.amend(id, { remove: [tries.label], metadata: { key: tries.key, value } })
    } catch (error) {
      return {
        last: value['last'] as TryLast,
        failed: { state: `the bead is closed but still carries ${tries.label}`, error: error instanceof Error ? error.message : String(error) },
      }
    }
    return { last: value['last'] as TryLast, failed: null }
  }

  /** issue plus its comments, the two joins, and when the human's latest note was read */
  async function detail(id: string) {
    // one bd read for the issue and its thread: bd processes queue on the store's lock, so
    // running them side by side is slower than one after the other
    const { issue, comments } = await client.issueWithComments(id)
    const [sessions, notes, events] = await Promise.all([
      sessionsFor(id, agentsview),
      notesFor(id, repo.path, boardConfig.notesDir),
      // a bd without `history --events` only costs the marker its best source
      client.auditEvents(id).catch(() => []),
    ])
    return {
      issue,
      comments: comments.map((comment) => ({ ...comment, by: classifyAuthor(comment.author, human) })),
      sessions,
      notes,
      note_read: noteRead({ comments, events, labels: issue.labels, flag: boardConfig.note.addLabel, human }),
    }
  }

  feed?.start()
  return {
    app,
    close: () => {
      feed?.stop()
      if (reconcile) clearInterval(reconcile)
      reconcile = null
      listeners.clear()
    },
  }
}

/** a cheap identity for a whole export, to tell a real change from a no-op reconcile */
function fingerprintOf(corpus: IssueWithComments[]): string {
  return createHash('sha1').update(JSON.stringify(corpus)).digest('hex')
}
