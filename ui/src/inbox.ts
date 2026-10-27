// derives the inbox (what the human can clear in one action) and the stale filter from the flat issue list

import type { BoardConfig, Issue, StalePicks } from './api'
import { askOf } from './asks'
import { isThought } from './model'

/** a bead untouched this many days is stale */
export const STALE_DAYS = 30
/** a due date before this many days from the start of today puts a bead in the inbox */
export const DUE_WITHIN_DAYS = 7
/** stale beads the inbox asks a verdict on each day */
export const STALE_PER_DAY = 3
/** a closed bead's answer older than this many days stays out of the inbox, read or not */
export const CLOSED_ANSWER_DAYS = 14

const DAY_MS = 86_400_000

export type InboxKind = 'ask' | 'reply' | 'closed' | 'label' | 'due' | 'stale'

export interface InboxSection {
  key: InboxKind
  title: string
  note: string
  rows: Issue[]
  folded: boolean
}

/** fold key of an inbox section, kept apart from the board's section keys in the same store */
export function inboxFoldKey(kind: InboxKind): string {
  return `inbox:${kind}`
}

export interface Inbox {
  /** only the sections that hold something, in render order */
  sections: InboxSection[]
  /** ids on screen in visual order, each once, for keyboard movement; folded sections left out */
  order: string[]
  /** every id in visual order, folded sections included, so movement can step off a folded row */
  layout: string[]
  /** distinct beads in the inbox, replies read this visit left out */
  count: number
  /** reply rows shown as read: opened this visit, kept until the list is rebuilt */
  read: Set<string>
  /** question rows already answered, waiting for a session to act; listed dimmed, not counted */
  answered: Set<string>
}

// the stale beads picked for one day, kept so the pick holds when one of them leaves
export type { StalePicks }

export interface InboxOptions {
  config: BoardConfig
  now: Date
  /** per bead, the answer's `at` it was last opened at */
  seen: Record<string, string>
  /** today's stale picks */
  picks: string[]
  /**
   * replies opened this visit, in the order they were read. each stays listed, at the bottom of
   * replies and marked read, until a reload or a view switch rebuilds the list
   */
  read: string[]
  /** the open bead whose reply opening it marked: it holds its place until the selection moves on */
  holding: string | null
  /** stored fold state per section key; every section is open without it */
  isFolded?: (sectionKey: string, fallback: boolean) => boolean
}

/** the local calendar day, 2026-10-13 */
export function localDay(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function startOfDay(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
}

const time = (iso: string | null | undefined): number => {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isNaN(t) ? NaN : t
}

/** open work: what can go stale or be asked about */
function isWorkable(issue: Issue): boolean {
  return issue.status === 'open' || issue.status === 'in_progress' || issue.status === 'blocked'
}

/** open work nobody touched for STALE_DAYS; parked, pinned and captured thoughts never go stale */
export function isStale(issue: Issue, now: Date, config: BoardConfig): boolean {
  if (!isWorkable(issue) || isThought(issue, config)) return false
  const touched = time(issue.updated_at)
  return !Number.isNaN(touched) && now.getTime() - touched >= STALE_DAYS * DAY_MS
}

/** every stale bead, oldest touch first */
export function staleBeads(issues: Issue[], now: Date, config: BoardConfig): Issue[] {
  return issues
    .filter((i) => isStale(i, now, config))
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at) || a.id.localeCompare(b.id))
}

/** whole days since the bead was last touched */
export function daysUntouched(issue: Issue, now: Date): number {
  return Math.floor((now.getTime() - time(issue.updated_at)) / DAY_MS)
}

/** overdue once the due time has passed, soon when due before the same weekday next week */
export function dueState(issue: Issue, now: Date): 'overdue' | 'soon' | null {
  if (issue.status === 'closed') return null
  const due = time(issue.due_at)
  if (Number.isNaN(due)) return null
  if (due < now.getTime()) return 'overdue'
  return due < startOfDay(now) + DUE_WITHIN_DAYS * DAY_MS ? 'soon' : null
}

/** what answered the human's latest note; `name` is null when the bead closed with no agent comment after it */
export interface Answer {
  at: string
  name: string | null
}

/**
 * the answer to the human's latest note. on open work it is the agent reply. a closed bead has
 * one only when the human commented on it and an agent replied or the bead closed after that
 * note; `at` is the later of the two, so a reply followed by the close is one answer, read once
 */
export function answerOf(issue: Issue): Answer | null {
  const reply = issue.agent_reply ?? null
  if (issue.status !== 'closed') return reply
  const note = time(issue.note_at)
  if (Number.isNaN(note)) return null
  const closedAt = issue.closed_at && time(issue.closed_at) > note ? issue.closed_at : null
  if (!closedAt) return reply
  return { at: reply && time(reply.at) > time(closedAt) ? reply.at : closedAt, name: reply?.name ?? null }
}

/** an answer to the human's latest note that the human has not opened since */
export function hasUnseenReply(issue: Issue, seen: Record<string, string>): boolean {
  const answer = answerOf(issue)
  if (!answer) return false
  const at = seen[issue.id]
  return !at || time(at) < time(answer.at)
}

/** the sections whose rows clear by being opened, and stay listed as read until a rebuild */
export function isAnswerSection(kind: InboxKind): boolean {
  return kind === 'reply' || kind === 'closed'
}

/** fnv-1a, enough to shuffle ids by day without a dependency */
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * the day's stale picks. a pick stored for today holds, so a bead that leaves (kept, snoozed,
 * closed) is not replaced until tomorrow and an emptied inbox stays empty. a new day draws
 * `count` beads in an order seeded by the date, so one ignored bead does not come back every
 * morning while older ones wait.
 */
export function dailyPicks(
  stale: Issue[],
  day: string,
  stored: StalePicks | null,
  count = STALE_PER_DAY,
): StalePicks {
  if (stored && stored.day === day) return stored
  const ids = stale
    .map((i) => i.id)
    .sort((a, b) => hash(`${day}:${a}`) - hash(`${day}:${b}`) || a.localeCompare(b))
    .slice(0, count)
  return { day, ids }
}

/**
 * the inbox: agent replies the human has not opened, closed beads that answered the human's
 * note, beads carrying an inbox label, beads overdue or due within the week, and today's stale
 * picks. a bead can sit in more than one section; keyboard movement visits it once.
 */
export function buildInbox(issues: Issue[], opts: InboxOptions): Inbox {
  const { config, now, seen, holding } = opts
  const live = issues.filter((i) => i.status !== 'closed')
  const touchedFirst = (a: Issue, b: Issue) => b.updated_at.localeCompare(a.updated_at)
  const byId = new Map(issues.map((i) => [i.id, i]))

  // open replies and closed answers read the same way: unread first, newest answer on top, then
  // the ones read this visit. a closed answer older than CLOSED_ANSWER_DAYS is history, not news
  const answered = (i: Issue) => {
    const answer = answerOf(i)
    if (!answer) return null
    if (i.status === 'closed' && now.getTime() - time(answer.at) > CLOSED_ANSWER_DAYS * DAY_MS) return null
    return answer
  }
  const answerAt = (i: Issue) => answerOf(i)?.at ?? ''
  const unread = issues
    .filter((i) => answered(i) && (hasUnseenReply(i, seen) || i.id === holding))
    .sort((a, b) => answerAt(b).localeCompare(answerAt(a)))
  // a read bead that got a newer answer since is unread again, back in the list above
  const readRows = [...new Set(opts.read)]
    .filter((id) => id !== holding)
    .map((id) => byId.get(id))
    .filter((i): i is Issue => !!i && !!answered(i) && !hasUnseenReply(i, seen))
  const answers = [...unread, ...readRows]
  const replies = answers.filter((i) => i.status !== 'closed')
  const closedAnswers = answers.filter((i) => i.status === 'closed')
  const read = new Set(readRows.map((i) => i.id))
  if (holding && unread.some((i) => i.id === holding) && !hasUnseenReply(byId.get(holding)!, seen)) read.add(holding)

  const labels = config.inbox.labels
  const asked = labels.length
    ? live
        .filter((i) => i.status !== 'deferred' && !isThought(i, config))
        .filter((i) => labels.some((l) => i.labels.includes(l)))
        .sort((a, b) => a.priority - b.priority || touchedFirst(a, b))
    : []

  const due = live
    .filter((i) => dueState(i, now) !== null)
    .sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? ''))

  const staleIds = new Set(staleBeads(issues, now, config).map((i) => i.id))
  const picked = opts.picks
    .filter((id) => staleIds.has(id))
    .map((id) => byId.get(id))
    .filter((i): i is Issue => i !== undefined && i.status !== 'closed')

  // stored questions: open ones first, the longest asked on top; answered ones after them,
  // dimmed, until the session that acts on the answer removes the question
  const withAsk = live.flatMap((i) => {
    const ask = askOf(i, config)
    return ask ? [{ issue: i, ask }] : []
  })
  const openAsks = withAsk
    .filter((x) => !x.ask.answered)
    .sort(
      (a, b) =>
        (b.ask.days_raised ?? 0) - (a.ask.days_raised ?? 0) ||
        a.issue.priority - b.issue.priority ||
        a.issue.id.localeCompare(b.issue.id),
    )
  const answeredAsks = withAsk
    .filter((x) => x.ask.answered)
    .sort((a, b) => (b.ask.answered?.at ?? '').localeCompare(a.ask.answered?.at ?? ''))
  const answeredIds = new Set(answeredAsks.map((x) => x.issue.id))

  const sections: InboxSection[] = []
  const push = (key: InboxKind, title: string, note: string, rows: Issue[]) => {
    if (rows.length) sections.push({ key, title, note, rows, folded: opts.isFolded?.(inboxFoldKey(key), false) ?? false })
  }
  if (config.asks) {
    push(
      'ask',
      config.asks.title,
      config.asks.note ?? 'a question stored on the bead, answer it there',
      [...openAsks, ...answeredAsks].map((x) => x.issue),
    )
  }
  push('reply', 'replies', 'an agent answered your note', replies)
  push('closed', 'answered, closed', 'your note got its answer and the bead closed', closedAnswers)
  push('label', labels.join(' / '), 'a call only you can make', asked)
  push('due', 'due', `overdue or due within ${DUE_WITHIN_DAYS} days`, due)
  push('stale', 'stale', `untouched ${STALE_DAYS}+ days, keep, snooze or close`, picked)

  const order: string[] = []
  const layout: string[] = []
  const onScreen = new Set<string>()
  const laidOut = new Set<string>()
  const counted = new Set<string>()
  for (const section of sections) {
    for (const issue of section.rows) {
      const quiet = (isAnswerSection(section.key) && read.has(issue.id)) || (section.key === 'ask' && answeredIds.has(issue.id))
      if (!quiet) counted.add(issue.id)
      if (!laidOut.has(issue.id)) {
        laidOut.add(issue.id)
        layout.push(issue.id)
      }
      if (section.folded || onScreen.has(issue.id)) continue
      onScreen.add(issue.id)
      order.push(issue.id)
    }
  }
  return { sections, order, layout, count: counted.size, read, answered: answeredIds }
}
