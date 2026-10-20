// when a session read the human's latest note. the best record is bd's audit events table
// (`bd history <id> --events`): removing the note flag writes a `label_removed` row with the
// actor and time. that table is local to the clone that made the change, so a board over a
// clone that only pulled the change (`bd sync`) has no row, and the first agent comment after
// the note stands in.

import { classifyAuthor, type Author, type HumanIdentity } from './authors'
import type { AuditEvent } from './bd'

export interface NoteRead {
  /** when the flag came off, or when the first agent reply landed */
  at: string
  /** the stored identity: the audit actor or the comment author */
  actor: string
  by: Author
  /** label: the flag's removal in the audit table; reply: the first agent comment after the note */
  source: 'label' | 'reply'
}

const REMOVED = /^Removed label: (.+)$/

const time = (iso: string): number => {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? NaN : t
}

/**
 * the read marker for the human's latest note, or null. nothing while the bead still carries
 * the note flag (the note is unread) or when the human never commented. the earliest removal of
 * the flag at or after the note wins; without one, the first agent comment after the note.
 */
export function noteRead(input: {
  comments: readonly { author: string; created_at: string }[]
  events: readonly AuditEvent[]
  labels: readonly string[]
  flag: string | null
  human: HumanIdentity
}): NoteRead | null {
  const { comments, events, labels, flag, human } = input
  if (flag && labels.includes(flag)) return null
  let note = NaN
  for (const comment of comments) {
    const at = time(comment.created_at)
    if (classifyAuthor(comment.author, human).self && !(at <= note)) note = at
  }
  if (Number.isNaN(note)) return null

  const earliest = <T extends { at: number }>(rows: T[]): T | undefined =>
    rows.filter((row) => !Number.isNaN(row.at)).sort((a, b) => a.at - b.at)[0]

  if (flag) {
    // bd stamps events in whole seconds, so a removal in the note's own second still counts
    const since = Math.floor(note / 1000) * 1000
    const removal = earliest(
      events
        .filter((e) => e.event_type === 'label_removed' && REMOVED.exec(e.comment ?? '')?.[1]?.trim() === flag)
        .map((e) => ({ at: time(e.created_at), event: e }))
        .filter((row) => row.at >= since),
    )
    if (removal) {
      const actor = removal.event.actor ?? ''
      return { at: removal.event.created_at, actor, by: classifyAuthor(actor, human), source: 'label' }
    }
  }

  const reply = earliest(
    comments
      .filter((c) => classifyAuthor(c.author, human).kind === 'agent')
      .map((c) => ({ at: time(c.created_at), comment: c }))
      .filter((row) => row.at > note),
  )
  if (!reply) return null
  const { author, created_at } = reply.comment
  return { at: created_at, actor: author, by: classifyAuthor(author, human), source: 'reply' }
}
