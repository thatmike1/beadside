// keeps one `bd events tail --follow` running and turns its records into "the ledger
// changed" pings. records are a trigger only: the board re-reads everything with
// `bd export`, because a journal record carries no comment or dependency counts.
import type { FollowHandle, FollowHandlers } from './bd'

/** starting: follower spawned, not yet trusted; live: following; off: fall back to polling */
export type LiveState = 'starting' | 'live' | 'off'

export interface LiveFeedOptions {
  /** start the child at this checkpoint; spawns a `bd events tail` in production */
  follow: (since: number, handlers: FollowHandlers) => FollowHandle
  /** called once per burst of records, after the debounce */
  onChange: () => void
  onState?: (state: LiveState) => void
  /** logs why the feed gave up or restarted; silent when omitted */
  log?: (message: string) => void
  /** quiet time that closes a burst; a close emits several records at once */
  debounceMs?: number
  /** how long the follower must stay up without an error before the board trusts it */
  settleMs?: number
  /** first restart delay; doubles with every failure in a row */
  restartDelayMs?: number
  /** failures in a row before the feed gives up */
  maxFailures?: number
  /** a run at least this long clears the failure count */
  healthyAfterMs?: number
}

// bd keeps following with this note on stderr when the journal is off
const DISABLED = /events journal is disabled/i
// a checkpoint below the retained floor; the view is rebuilt from a full export anyway
const TRUNCATED = /events_journal_truncated|below the oldest retained|was pruned/i
// bd older than 1.3.0 has no `events` command
const UNSUPPORTED = /unknown command|unknown flag/i

/** a self-restarting journal follower; see LiveState for what callers can rely on */
export class LiveFeed {
  state: LiveState = 'off'
  /** the highest seq seen, handed back as `--since` on a restart */
  seq = 0

  private readonly opts: Required<Omit<LiveFeedOptions, 'onState' | 'log'>> &
    Pick<LiveFeedOptions, 'onState' | 'log'>
  private handle: FollowHandle | null = null
  private failures = 0
  private stopped = true
  private startedAt = 0
  private stderr = ''
  private debounce: ReturnType<typeof setTimeout> | null = null
  private settle: ReturnType<typeof setTimeout> | null = null
  private restart: ReturnType<typeof setTimeout> | null = null

  constructor(options: LiveFeedOptions) {
    this.opts = {
      debounceMs: 300,
      settleMs: 1_500,
      restartDelayMs: 1_000,
      maxFailures: 3,
      healthyAfterMs: 60_000,
      ...options,
    }
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.failures = 0
    this.spawn()
  }

  stop(): void {
    this.stopped = true
    this.clearTimers()
    this.kill()
  }

  private spawn(): void {
    this.stderr = ''
    this.startedAt = Date.now()
    this.setState('starting')
    let handle: FollowHandle | null = null
    const handlers: FollowHandlers = {
      line: (text) => {
        if (handle !== this.handle) return
        this.record(text)
      },
      stderr: (text) => {
        if (handle !== this.handle) return
        this.stderr += text
        if (DISABLED.test(this.stderr)) this.giveUp('the events journal is off; enable it with `bd config set events-journal true`')
        else if (UNSUPPORTED.test(this.stderr)) this.giveUp('this bd has no events journal (needs 1.3.0 or newer)')
      },
      exit: (code) => {
        if (handle !== this.handle) return
        this.handle = null
        this.exited(code)
      },
    }
    try {
      handle = this.opts.follow(this.seq, handlers)
    } catch (error) {
      this.giveUp(`could not start the journal follower (${error instanceof Error ? error.message : String(error)})`)
      return
    }
    this.handle = handle
    this.settle = setTimeout(() => {
      this.settle = null
      if (this.handle === handle && !this.stopped) this.setState('live')
    }, this.opts.settleMs)
  }

  private record(text: string): void {
    let seq: unknown
    try {
      seq = (JSON.parse(text) as { seq?: unknown }).seq
    } catch {
      return
    }
    if (typeof seq !== 'number' || !Number.isInteger(seq)) return
    if (seq > this.seq) this.seq = seq
    if (this.debounce) clearTimeout(this.debounce)
    this.debounce = setTimeout(() => {
      this.debounce = null
      this.opts.onChange()
    }, this.opts.debounceMs)
  }

  private exited(code: number | null): void {
    if (this.stopped) return
    if (this.settle) clearTimeout(this.settle)
    this.settle = null
    if (TRUNCATED.test(this.stderr)) {
      // the checkpoint fell off the retained journal; replay what is left and re-read everything
      this.seq = 0
      this.opts.onChange()
    }
    if (Date.now() - this.startedAt >= this.opts.healthyAfterMs) this.failures = 0
    this.failures += 1
    if (this.failures >= this.opts.maxFailures) {
      const detail = this.stderr.trim().split('\n').pop() || `exit ${code ?? 'signal'}`
      this.giveUp(`the journal follower keeps exiting (${detail})`)
      return
    }
    const delay = this.opts.restartDelayMs * 2 ** (this.failures - 1)
    this.opts.log?.(`journal follower exited (${code ?? 'signal'}), restarting in ${delay} ms`)
    // polling covers the gap until the new follower settles
    this.setState('starting')
    this.restart = setTimeout(() => {
      this.restart = null
      if (!this.stopped) this.spawn()
    }, delay)
  }

  private giveUp(reason: string): void {
    this.stopped = true
    this.clearTimers()
    this.kill()
    this.opts.log?.(`live updates off: ${reason}; polling instead`)
    this.setState('off')
  }

  private kill(): void {
    const handle = this.handle
    this.handle = null
    handle?.stop()
  }

  private clearTimers(): void {
    for (const timer of [this.debounce, this.settle, this.restart]) if (timer) clearTimeout(timer)
    this.debounce = this.settle = this.restart = null
  }

  private setState(state: LiveState): void {
    if (state === this.state) return
    this.state = state
    this.opts.onState?.(state)
  }
}
