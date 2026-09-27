// the only place in beadside that runs `bd`. every method maps to one fixed
// argument shape; nothing the client sends ever becomes a flag.
import { execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { extname, win32 } from 'node:path'

export type Status = 'open' | 'in_progress' | 'blocked' | 'deferred' | 'pinned' | 'closed'

export const STATUSES: readonly Status[] = ['open', 'in_progress', 'blocked', 'deferred', 'pinned', 'closed']

/** one record of `bd export` with `_type` (and the heavy embedded `comments`) dropped */
export interface Issue {
  id: string
  title: string
  description: string
  status: Status
  priority: 0 | 1 | 2 | 3 | 4
  issue_type: string
  labels: string[]
  owner?: string
  created_by?: string
  created_at: string
  updated_at: string
  closed_at?: string | null
  close_reason?: string
  notes?: string
  comment_count: number
  dependency_count: number
  dependent_count: number
  dependencies?: Dependency[]
  // bd carries more per-issue fields (assignee, design, acceptance_criteria, defer_until…);
  // they pass through untouched for the ui to use.
  [extra: string]: unknown
}

export interface Comment {
  id: string
  issue_id: string
  author: string
  text: string
  created_at: string
}

/** one issue with its full comment thread, the unit search reads */
/** one row of `bd history <id> --events --json`; only the fields the board reads */
export interface AuditEvent {
  event_type: string
  actor?: string
  /** `Removed label: <label>` on a label_removed row */
  comment?: string
  created_at: string
}

export interface IssueWithComments {
  issue: Issue
  comments: Comment[]
}

export interface RunResult {
  stdout: string
  stderr: string
  code: number
}

/** runs one `bd` invocation; injected in tests so no real `bd` is spawned */
export type Runner = (args: string[]) => Promise<RunResult>

/** an error whose message is safe to hand back over the local API */
export class BdError extends Error {
  readonly status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'BdError'
    this.status = status
  }
}

// the contract's pattern, minus a leading dash: ids go to bd positionally, and
// `--force` matches the contract pattern but would be read as a flag
const ID_PATTERN = /^[A-Za-z0-9_](?:[A-Za-z0-9_-]*)(\.[0-9]+)?$/
const MAX_TEXT = 32_000
const MAX_LABEL = 128
const RUN_TIMEOUT_MS = 30_000

/** throws unless the id matches the contract's id pattern */
export function assertId(id: unknown): string {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new BdError(`invalid issue id: ${String(id)}`)
  return id
}

/** throws unless the label is 1 to 128 characters with no whitespace */
export function assertLabel(label: unknown): string {
  if (typeof label !== 'string' || label.length < 1 || label.length > MAX_LABEL || /\s/.test(label)) {
    throw new BdError('labels must be 1-128 characters and contain no whitespace')
  }
  return label
}

// what bd's date flags take: +1w, tomorrow, next monday, 2026-10-20, an ISO timestamp
const WHEN_PATTERN = /^[A-Za-z0-9 +:._-]{1,64}$/

/** throws unless the value reads as one of bd's relative or absolute dates */
export function assertWhen(value: unknown, what: string): string {
  if (typeof value !== 'string' || !WHEN_PATTERN.test(value.trim())) throw new BdError(`invalid ${what} value`)
  return value.trim()
}

/** the local calendar day, 2026-10-13, as a keep stamps it */
export function localDay(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

// keys the board writes to bd's key-value store, all under its own namespace
const KV_KEY_PATTERN = /^beadside\.[A-Za-z0-9_.-]{1,200}$/
const MAX_KV_VALUE = 4_000

// a metadata key the board writes: the asks key from config, checked there too
const METADATA_KEY_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/

/** throws unless the key sits in the board's `beadside.` namespace */
export function assertKvKey(key: unknown): string {
  if (typeof key !== 'string' || !KV_KEY_PATTERN.test(key)) throw new BdError(`invalid kv key: ${String(key)}`)
  return key
}

/** throws unless the text is a non-empty string within the body limit */
function assertText(text: unknown, what: string): string {
  if (typeof text !== 'string') throw new BdError(`${what} must be a string`)
  const trimmed = text.trim()
  if (!trimmed) throw new BdError(`${what} must not be empty`)
  if (trimmed.length > MAX_TEXT) throw new BdError(`${what} is too long`)
  return trimmed
}

/** the program and leading arguments that run `bd`; `prefix` carries the script when `file` is node */
export interface BdCommand {
  file: string
  prefix: string[]
}

/** filesystem reads resolveBd needs, injected in tests */
export interface BdLookupFs {
  exists(path: string): boolean
  read(path: string): string | null
}

const realFs: BdLookupFs = {
  exists: existsSync,
  read: (path) => {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return null
    }
  },
}

/** env var naming the bd executable (or a `bd.js`) to run instead of the one on PATH */
export const BD_OVERRIDE_ENV = 'BD_BOARD_BD'

/** reads an env var the way windows does, whatever the key's case in a copied env object */
function envValue(env: NodeJS.ProcessEnv, key: string, platform: NodeJS.Platform): string | undefined {
  if (platform !== 'win32') return env[key]
  const match = Object.keys(env).find((name) => name.toUpperCase() === key)
  return match === undefined ? undefined : env[match]
}

/** a `.js` entry runs through this node; anything else is spawned as it is */
function commandFor(path: string): BdCommand {
  return /^\.[cm]?js$/i.test(extname(path)) ? { file: process.execPath, prefix: [path] } : { file: path, prefix: [] }
}

/**
 * follows an npm `bd.cmd` shim to what it runs: the native `bd.exe` next to the shim's
 * script when there is one (the @beads/bd package ships it there), otherwise the script via node.
 */
function followCmdShim(shim: string, fs: BdLookupFs): BdCommand | null {
  const text = fs.read(shim)
  if (!text) return null
  const target = /"%dp0%\\([^"]+)"\s+%\*/.exec(text)?.[1]
  if (!target) return null
  const script = win32.join(win32.dirname(shim), target)
  const native = win32.join(win32.dirname(script), 'bd.exe')
  if (fs.exists(native)) return { file: native, prefix: [] }
  return fs.exists(script) ? commandFor(script) : null
}

/**
 * finds what to spawn for `bd` without a shell. linux and macos keep plain `bd` from PATH.
 * windows cannot spawn an npm `bd.cmd` shim without cmd.exe, so the shim is followed to the
 * real binary; a `bd.exe` found first on PATH is used directly. BD_BOARD_BD overrides both.
 */
export function resolveBd(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  fs: BdLookupFs = realFs,
): BdCommand {
  const override = envValue(env, BD_OVERRIDE_ENV, platform)?.trim()
  if (override) {
    if (platform === 'win32' && /\.(cmd|bat)$/i.test(override)) return followCmdShim(override, fs) ?? commandFor(override)
    return commandFor(override)
  }
  if (platform !== 'win32') return { file: 'bd', prefix: [] }
  for (const raw of (envValue(env, 'PATH', platform) ?? '').split(';')) {
    const dir = raw.trim().replace(/^"(.*)"$/, '$1')
    if (!dir) continue
    const exe = win32.join(dir, 'bd.exe')
    if (fs.exists(exe)) return { file: exe, prefix: [] }
    const shim = win32.join(dir, 'bd.cmd')
    if (fs.exists(shim)) {
      const followed = followCmdShim(shim, fs)
      if (followed) return followed
    }
  }
  return { file: 'bd', prefix: [] }
}

/**
 * spawns the real `bd` binary in the repo, never through a shell. `actor` pins BEADS_ACTOR so
 * a board started from inside an agent session still writes its audit trail as the human.
 */
export function nodeRunner(repo: string, actor?: string, bd: BdCommand = resolveBd()): Runner {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' }
  if (actor) env['BEADS_ACTOR'] = actor
  return (args) =>
    new Promise((resolve, reject) => {
      execFile(
        bd.file,
        [...bd.prefix, ...args],
        // windowsHide keeps a board with no console (bd-board start) from flashing a window per call
        { cwd: repo, timeout: RUN_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, env, windowsHide: true },
        (error, stdout, stderr) => {
          if (!error) return resolve({ stdout, stderr, code: 0 })
          const failure = error as NodeJS.ErrnoException & { code?: number | string; killed?: boolean }
          if (failure.code === 'ENOENT') {
            return reject(new BdError(`bd was not found on PATH; set ${BD_OVERRIDE_ENV} to its path`, 500))
          }
          if (failure.killed) return reject(new BdError('bd command timed out', 504))
          resolve({ stdout, stderr, code: typeof failure.code === 'number' ? failure.code : 1 })
        },
      )
    })
}

/** what a running journal follower reports back, one callback per kind */
export interface FollowHandlers {
  /** one complete stdout line, a JSON record when the journal is on */
  line(text: string): void
  /** a stderr chunk; bd prints its notes and errors here */
  stderr(text: string): void
  /** the child ended; `code` is null when it was killed by a signal */
  exit(code: number | null): void
}

export interface FollowHandle {
  stop(): void
}

/** starts one journal follower from a checkpoint; injected in tests so no real `bd` is spawned */
export type Follower = (since: number, handlers: FollowHandlers) => FollowHandle

/** quiet time between two reads of the journal */
export const FOLLOW_POLL_MS = 3_000

/**
 * follows the journal with one `bd events tail --since <n>` at a time, each started
 * `pollMs` after the last one exits, and splits stdout into lines. not `--follow`: that
 * child holds the embedded dolt lock almost without a break, and `bd sync` (or any other
 * bd) waits on it until its timeout. a read takes about 0.2 s and waits its turn behind a
 * sync. a read that exits nonzero ends the follow, as a `--follow` child dying would.
 */
export function nodeFollower(repo: string, pollMs = FOLLOW_POLL_MS, bd: BdCommand = resolveBd()): Follower {
  return (since, handlers) => {
    let seq = since
    let stopped = false
    let child: ReturnType<typeof spawn> | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    const emit = (line: string) => {
      if (stopped) return
      try {
        const record = JSON.parse(line) as { seq?: unknown }
        if (typeof record.seq === 'number' && record.seq > seq) seq = record.seq
      } catch {
        // not a record; the feed ignores it too
      }
      handlers.line(line)
    }
    const read = () => {
      timer = null
      if (stopped) return
      const run = spawn(bd.file, [...bd.prefix, 'events', 'tail', '--since', String(seq)], {
        cwd: repo,
        env: { ...process.env, NO_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      child = run
      let pending = ''
      let ended = false
      const end = (code: number | null) => {
        if (ended) return
        ended = true
        child = null
        if (pending.trim()) emit(pending)
        if (stopped) return
        if (code !== 0) {
          stopped = true
          handlers.exit(code)
          return
        }
        timer = setTimeout(read, pollMs)
      }
      run.stdout!.setEncoding('utf8')
      run.stdout!.on('data', (chunk: string) => {
        pending += chunk
        const lines = pending.split('\n')
        pending = lines.pop() ?? ''
        for (const line of lines) if (line.trim()) emit(line)
      })
      run.stderr!.setEncoding('utf8')
      run.stderr!.on('data', (chunk: string) => {
        if (!stopped) handlers.stderr(chunk)
      })
      // ENOENT and friends arrive here instead of as an exit
      run.on('error', () => end(127))
      run.on('close', (code) => end(code))
    }
    read()
    return {
      stop: () => {
        stopped = true
        if (timer) clearTimeout(timer)
        timer = null
        child?.kill('SIGTERM')
      },
    }
  }
}

function parseJson<T>(raw: string, what: string): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    throw new BdError(`${what} returned invalid JSON`)
  }
}

/** the narrow set of beads operations the board is allowed to perform */
export class BeadsClient {
  readonly repo: string
  /** stored as the author of every comment this client writes; unset leaves bd's own default */
  readonly actor: string | undefined
  private readonly runner: Runner
  private readonly follower: Follower

  constructor(repo: string, runner?: Runner, options: { actor?: string; follower?: Follower } = {}) {
    this.repo = repo
    this.actor = options.actor
    this.runner = runner ?? nodeRunner(repo, options.actor)
    this.follower = options.follower ?? nodeFollower(repo)
  }

  /** follows the events journal from a checkpoint; the only bd the board runs on a timer */
  follow(since: number, handlers: FollowHandlers): FollowHandle {
    if (!Number.isInteger(since) || since < 0) throw new BdError('since must be a non-negative integer')
    return this.follower(since, handlers)
  }

  /** runs one allowlisted command and returns stdout, turning a failure into a BdError */
  async run(args: string[]): Promise<string> {
    const result = await this.runner(args)
    if (result.code !== 0) {
      const message = result.stderr.trim() || result.stdout.trim() || 'bd command failed'
      throw new BdError(message.split('\n')[0]!)
    }
    return result.stdout
  }

  /** every issue in the repo, from `bd export` (JSONL) */
  async issues(): Promise<Issue[]> {
    return (await this.corpus()).map((entry) => entry.issue)
  }

  /** every issue with its embedded comment thread, from one `bd export` */
  async corpus(): Promise<IssueWithComments[]> {
    const raw = await this.run(['export'])
    const out: IssueWithComments[] = []
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const record = parseJson<Record<string, unknown>>(trimmed, 'bd export')
      if (record['_type'] !== 'issue') continue
      const comments = Array.isArray(record['comments']) ? (record['comments'] as Comment[]) : []
      out.push({ issue: normalise(record), comments })
    }
    return out
  }

  /** one issue, from `bd show <id> --json` (which returns an array) */
  async issue(id: string): Promise<Issue> {
    assertId(id)
    const raw = await this.run(['show', id, '--json']).catch((error: unknown) => {
      // bd exits 1 with "no issue found matching …"; that is a 404, not a bad request
      if (error instanceof BdError && /no issue/i.test(error.message)) throw new BdError(`issue not found: ${id}`, 404)
      throw error
    })
    const payload = parseJson<unknown>(raw, 'bd show')
    const record = Array.isArray(payload) ? payload[0] : payload
    if (!record || typeof record !== 'object' || (record as { id?: unknown }).id !== id) {
      throw new BdError(`issue not found: ${id}`, 404)
    }
    return normalise(record as Record<string, unknown>)
  }

  /** the comment thread, from `bd comments <id> --json` */
  async comments(id: string): Promise<Comment[]> {
    assertId(id)
    const raw = (await this.run(['comments', id, '--json'])).trim()
    if (!raw) return []
    const payload = parseJson<unknown>(raw, 'bd comments')
    return Array.isArray(payload) ? (payload as Comment[]) : []
  }

  /**
   * the bead's audit trail, from `bd history <id> --events --json`, newest first. bd prints
   * `null` for a bead with none. the table is local to each clone; see note-read.ts
   */
  async auditEvents(id: string): Promise<AuditEvent[]> {
    assertId(id)
    const raw = (await this.run(['history', id, '--events', '--json'])).trim()
    if (!raw) return []
    const payload = parseJson<unknown>(raw, 'bd history')
    if (!Array.isArray(payload)) return []
    return payload.filter(
      (row): row is AuditEvent =>
        !!row && typeof row === 'object' && typeof row.event_type === 'string' && typeof row.created_at === 'string',
    )
  }

  /**
   * adds a note comment, then one `bd update` that adds addLabel and removes clearLabels.
   * removing a label the issue lacks is a no-op in bd, so nothing is read first; the caller
   * reads the issue once afterwards. two bd runs, each about half a second.
   */
  async comment(
    id: string,
    text: string,
    options: { addLabel?: string | null; clearLabels?: string[] } = {},
  ): Promise<void> {
    assertId(id)
    const body = assertText(text, 'comment text')
    // `--` stops bd's flag parsing, so a note may start with a dash; an explicit author wins
    // over whatever BEADS_ACTOR the process inherited
    const author = this.actor ? [`--author=${this.actor}`] : []
    await this.run(['comments', 'add', id, ...author, '--', body])
    const add = options.addLabel ? [assertLabel(options.addLabel)] : []
    const remove = [...new Set(options.clearLabels ?? [])].map(assertLabel).filter((label) => !add.includes(label))
    if (!add.length && !remove.length) return
    const args = ['update', id]
    for (const label of add) args.push(`--add-label=${label}`)
    for (const label of remove) args.push(`--remove-label=${label}`)
    await this.run(args)
  }

  /** moves the issue with the semantic bd command for that transition */
  async setStatus(id: string, status: Status, reason?: string, until?: string): Promise<Issue> {
    assertId(id)
    if (!STATUSES.includes(status)) throw new BdError(`unsupported status: ${status}`)
    if (reason !== undefined && typeof reason !== 'string') throw new BdError('reason must be a string')
    if (until !== undefined && typeof until !== 'string') throw new BdError('until must be a string')
    if (until) assertWhen(until, 'until')

    const current = await this.issue(id)
    // no-op unless a defer is re-dated
    if (current.status === status && !(status === 'deferred' && until)) return current

    if (status === 'closed') {
      await this.run(['close', id, '--reason', reason?.trim() || 'closed from beadside'])
    } else if (status === 'deferred') {
      const args = ['defer', id]
      if (until) args.push('--until', until)
      if (reason?.trim()) args.push('--reason', reason.trim())
      await this.run(args)
    } else if (status === 'open' && current.status === 'closed') {
      await this.run(['reopen', id])
    } else if (status === 'open' && current.status === 'deferred') {
      await this.run(['undefer', id])
    } else {
      await this.run(['update', id, '--status', status])
    }
    return this.issue(id)
  }

  /** `bd update <id> --priority <n>`, 0 highest */
  async setPriority(id: string, priority: number): Promise<Issue> {
    assertId(id)
    if (!Number.isInteger(priority) || priority < 0 || priority > 4) {
      throw new BdError('priority must be an integer between 0 and 4')
    }
    await this.run(['update', id, '--priority', String(priority)])
    return this.issue(id)
  }

  /** one `bd update` carrying every add and remove */
  async setLabels(id: string, add: string[] = [], remove: string[] = []): Promise<Issue> {
    assertId(id)
    const toAdd = [...new Set(add)].map(assertLabel)
    const toRemove = [...new Set(remove)].map(assertLabel).filter((label) => !toAdd.includes(label))
    if (!toAdd.length && !toRemove.length) return this.issue(id)
    const args = ['update', id]
    // `--flag=value` form so a label can never be read as a flag of its own
    for (const label of toAdd) args.push(`--add-label=${label}`)
    for (const label of toRemove) args.push(`--remove-label=${label}`)
    await this.run(args)
    return this.issue(id)
  }

  /**
   * keeps a stale bead without changing it: one metadata stamp, `kept_at=<day>`, which moves
   * `updated_at` so the bead leaves the stale filter and leaves a trace of why it moved
   */
  async keep(id: string, now = new Date()): Promise<Issue> {
    assertId(id)
    await this.run(['update', id, '--set-metadata', `kept_at=${localDay(now)}`])
    return this.issue(id)
  }

  /**
   * writes one metadata key whole with `bd update <id> --metadata <json>`. bd merges metadata at
   * the top level, so the other keys stay and this one is replaced, never merged into
   */
  async setMetadata(id: string, key: string, value: Record<string, unknown>): Promise<void> {
    assertId(id)
    if (!METADATA_KEY_PATTERN.test(key)) throw new BdError(`invalid metadata key: ${key}`)
    const payload = JSON.stringify({ [key]: value })
    if (payload.length > MAX_TEXT) throw new BdError('metadata value is too long')
    // `--flag=value` form; the value is a JSON object, so it could not read as a flag anyway
    await this.run(['update', id, `--metadata=${payload}`])
  }

  /** `bd update <id> --due=<when>`; bd reads +1w, next monday, a date or an ISO timestamp */
  async setDue(id: string, due: string): Promise<Issue> {
    assertId(id)
    // `--flag=value` form so a value can never be read as a flag of its own
    await this.run(['update', id, `--due=${assertWhen(due, 'due')}`])
    return this.issue(id)
  }

  /**
   * the key-value pairs under a prefix, from `bd kv list --json`. bd keeps them in the dolt
   * database, so they travel with `bd sync` and never touch a bead's `updated_at`
   */
  async kvList(prefix: string): Promise<Record<string, string>> {
    const raw = (await this.run(['kv', 'list', '--json'])).trim()
    const payload = raw ? parseJson<unknown>(raw, 'bd kv list') : {}
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {}
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(payload)) {
      if (key.startsWith(prefix) && typeof value === 'string') out[key] = value
    }
    return out
  }

  /** `bd kv set -- <key> <value>`, the key held to the board's namespace */
  async kvSet(key: string, value: string): Promise<void> {
    assertKvKey(key)
    if (typeof value !== 'string' || !value || value.length > MAX_KV_VALUE) throw new BdError('invalid kv value')
    // `--` so a value can never be read as a flag
    await this.run(['kv', 'set', '--', key, value])
  }

  /** quick capture through `bd q`, which prints the new id and nothing else */
  async create(title: string, labels: string[] = []): Promise<Issue> {
    const clean = assertText(title, 'title')
    const wanted = [...new Set(labels)].map(assertLabel)
    const args = ['q']
    for (const label of wanted) args.push(`--labels=${label}`)
    args.push('--', clean)
    const id = (await this.run(args)).trim().split('\n').pop()?.trim() ?? ''
    if (!ID_PATTERN.test(id)) throw new BdError('bd q did not return an issue id')
    return this.issue(id)
  }

  /** removes a bead outright with `bd delete --force`; the app limits this to beads it created itself */
  async remove(id: string): Promise<void> {
    await this.run(['delete', assertId(id), '--force'])
  }
}

/** one edge as `bd export` writes it: issue_id depends on depends_on_id, of a kind */
export interface Dependency {
  issue_id: string
  depends_on_id: string
  type: string
}

/**
 * `bd export` lists edges; `bd show --json` lists the issues behind them with a
 * `dependency_type`. both come out in the export's shape, so a write's read-back
 * matches the list it replaces.
 */
function edges(id: string, raw: unknown): Dependency[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: Dependency[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const edge = item as Record<string, unknown>
    if (typeof edge['depends_on_id'] === 'string') {
      out.push({
        issue_id: typeof edge['issue_id'] === 'string' ? edge['issue_id'] : id,
        depends_on_id: edge['depends_on_id'],
        type: String(edge['type'] ?? ''),
      })
    } else if (typeof edge['id'] === 'string') {
      out.push({ issue_id: id, depends_on_id: edge['id'], type: String(edge['dependency_type'] ?? '') })
    }
  }
  return out
}

/** drops the export-only keys and fills the fields the contract promises */
function normalise(record: Record<string, unknown>): Issue {
  const { _type, comments, ...rest } = record
  void _type
  void comments
  const dependencies = edges(String(rest['id'] ?? ''), rest['dependencies'])
  return {
    ...rest,
    ...(dependencies ? { dependencies } : {}),
    id: String(rest['id'] ?? ''),
    title: String(rest['title'] ?? ''),
    description: typeof rest['description'] === 'string' ? rest['description'] : '',
    labels: Array.isArray(rest['labels']) ? (rest['labels'] as string[]) : [],
    comment_count: typeof rest['comment_count'] === 'number' ? rest['comment_count'] : 0,
    dependency_count: typeof rest['dependency_count'] === 'number' ? rest['dependency_count'] : 0,
    dependent_count: typeof rest['dependent_count'] === 'number' ? rest['dependent_count'] : 0,
  } as Issue
}
