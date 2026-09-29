import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FollowHandlers } from './bd'
import { LiveFeed, type LiveState } from './live'

/** a scripted follower: every spawn is recorded, and the test drives its output */
function fakeFollower() {
  const spawns: { since: number; handlers: FollowHandlers; stopped: boolean }[] = []
  const follow = (since: number, handlers: FollowHandlers) => {
    const entry = { since, handlers, stopped: false }
    spawns.push(entry)
    return { stop: () => void (entry.stopped = true) }
  }
  const last = () => spawns[spawns.length - 1]!
  return { follow, spawns, last }
}

const record = (seq: number) => JSON.stringify({ seq, op: 'update', issue_id: 'repo-abc', issue: {} })

function feedWith(options: { healthyAfterMs?: number } = {}) {
  const follower = fakeFollower()
  const states: LiveState[] = []
  const onChange = vi.fn()
  const feed = new LiveFeed({
    follow: follower.follow,
    onChange,
    onState: (state) => states.push(state),
    debounceMs: 300,
    settleMs: 1_000,
    restartDelayMs: 1_000,
    maxFailures: 3,
    healthyAfterMs: options.healthyAfterMs ?? 60_000,
  })
  return { feed, follower, states, onChange }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('LiveFeed', () => {
  it('goes live once the follower settles, from checkpoint 0', () => {
    const { feed, follower, states } = feedWith()
    feed.start()
    expect(follower.spawns).toHaveLength(1)
    expect(follower.last().since).toBe(0)
    expect(feed.state).toBe('starting')
    vi.advanceTimersByTime(1_000)
    expect(feed.state).toBe('live')
    expect(states).toEqual(['starting', 'live'])
  })

  it('collapses a burst of records into one change and tracks the highest seq', () => {
    const { feed, follower, onChange } = feedWith()
    feed.start()
    const { handlers } = follower.last()
    handlers.line(record(4))
    vi.advanceTimersByTime(100)
    handlers.line(record(5))
    handlers.line('not json')
    handlers.line(record(6))
    vi.advanceTimersByTime(299)
    expect(onChange).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(feed.seq).toBe(6)
  })

  it('gives up for good when bd says the journal is off', () => {
    const { feed, follower, states } = feedWith()
    feed.start()
    follower.last().handlers.stderr('note: the events journal is disabled for this workspace (enable with …)\n')
    expect(follower.last().stopped).toBe(true)
    expect(feed.state).toBe('off')
    vi.advanceTimersByTime(60_000)
    expect(follower.spawns).toHaveLength(1)
    expect(states).toEqual(['starting', 'off'])
  })

  it('gives up at once on a bd without the events command', () => {
    const { feed, follower } = feedWith()
    feed.start()
    follower.last().handlers.stderr('Error: unknown command "events" for "bd"\n')
    expect(feed.state).toBe('off')
  })

  it('restarts from the last seq after an exit, backing off', () => {
    const { feed, follower } = feedWith()
    feed.start()
    vi.advanceTimersByTime(1_000)
    follower.last().handlers.line(record(9))
    follower.last().handlers.exit(1)
    expect(feed.state).toBe('starting')
    vi.advanceTimersByTime(999)
    expect(follower.spawns).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(follower.spawns).toHaveLength(2)
    expect(follower.last().since).toBe(9)
    follower.last().handlers.exit(1)
    vi.advanceTimersByTime(1_999)
    expect(follower.spawns).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(follower.spawns).toHaveLength(3)
  })

  it('stops restarting after three quick failures in a row', () => {
    const { feed, follower } = feedWith()
    feed.start()
    for (let i = 0; i < 3; i++) {
      follower.last().handlers.exit(1)
      vi.advanceTimersByTime(10_000)
    }
    expect(follower.spawns).toHaveLength(3)
    expect(feed.state).toBe('off')
  })

  it('forgives failures after a healthy run', () => {
    const { feed, follower } = feedWith({ healthyAfterMs: 5_000 })
    feed.start()
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(5_000)
      follower.last().handlers.exit(1)
      vi.advanceTimersByTime(1_000)
    }
    expect(feed.state).not.toBe('off')
    expect(follower.spawns).toHaveLength(6)
  })

  it('rebuilds from zero when the checkpoint fell off the journal', () => {
    const { feed, follower, onChange } = feedWith()
    feed.start()
    follower.last().handlers.line(record(40))
    vi.advanceTimersByTime(300)
    onChange.mockClear()
    follower.last().handlers.stderr('{"code":"events_journal_truncated","since":40,"floor":90,"head":120}\n')
    follower.last().handlers.exit(1)
    expect(onChange).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1_000)
    expect(follower.last().since).toBe(0)
  })

  it('stop kills the follower and ignores anything it says afterwards', () => {
    const { feed, follower, onChange } = feedWith()
    feed.start()
    const { handlers } = follower.last()
    feed.stop()
    expect(follower.last().stopped).toBe(true)
    handlers.line(record(3))
    handlers.exit(null)
    vi.advanceTimersByTime(60_000)
    expect(onChange).not.toHaveBeenCalled()
    expect(follower.spawns).toHaveLength(1)
  })
})
