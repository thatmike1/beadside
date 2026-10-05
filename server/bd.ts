// the only place in beadside that runs `bd`. every method maps to one fixed
// argument shape; nothing the client sends ever becomes a flag.
import { execFile, spawn } from 'node:child_process'

export type Status = 'open' | 'in_progress' | 'blocked' | 'deferred' | 'closed'

export const STATUSES: readonly Status[] = ['open', 'in_progress', 'blocked', 'deferred', 'closed']

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

/** throws unless the text is a non-empty string within the body limit */
function assertText(text: unknown, what: string): string {
  if (typeof text !== 'string') throw new BdError(`${what} must be a string`)
  const trimmed = text.trim()
  if (!trimmed) throw new BdError(`${what} must not be empty`)
  if (trimmed.length > MAX_TEXT) throw new BdError(`${what} is too long`)
  return trimmed
}

/**
 * spawns the real `bd` binary in the repo, never through a shell. `actor` pins BEADS_ACTOR so
 * a board started from inside an agent session still writes its audit trail as the human.
 */
export function nodeRunner(repo: string, actor?: string): Runner {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' }
  if (actor) env['BEADS_ACTOR'] = actor
  return (args) =>
    new Promise((resolve, reject) => {
      execFile(
        'bd',
        args,
        { cwd: repo, timeout: RUN_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, env },
        (error, stdout, stderr) => {
          if (!error) return resolve({ stdout, stderr, code: 0 })
          const failure = error as NodeJS.ErrnoException & { code?: number | string; killed?: boolean }
          if (failure.code === 'ENOENT') return reject(new BdError('bd was not found on PATH', 500))
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
export function nodeFollower(repo: string, pollMs = FOLLOW_POLL_MS): Follower {
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
      const run = spawn('bd', ['events', 'tail', '--since', String(seq)], {
        cwd: repo,
        env: { ...process.env, NO_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
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
    if (until && !/^[A-Za-z0-9 +:_-]{1,64}$/.test(until)) throw new BdError('invalid until value')

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

/** drops the export-only keys and fills the fields the contract promises */
function normalise(record: Record<string, unknown>): Issue {
  const { _type, comments, ...rest } = record
  void _type
  void comments
  return {
    ...rest,
    id: String(rest['id'] ?? ''),
    title: String(rest['title'] ?? ''),
    description: typeof rest['description'] === 'string' ? rest['description'] : '',
    labels: Array.isArray(rest['labels']) ? (rest['labels'] as string[]) : [],
    comment_count: typeof rest['comment_count'] === 'number' ? rest['comment_count'] : 0,
    dependency_count: typeof rest['dependency_count'] === 'number' ? rest['dependency_count'] : 0,
    dependent_count: typeof rest['dependent_count'] === 'number' ? rest['dependent_count'] : 0,
  } as Issue
}
