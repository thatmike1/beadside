import { describe, expect, it } from 'vitest'
import type { AuditEvent } from './bd'
import { noteRead } from './note-read'

const human = { id: 'human:mike', name: 'Mike' }
const note = { author: 'human:mike', created_at: '2026-10-20T10:58:25Z' }
const removed = (label: string, at: string, actor = 'agent:claude'): AuditEvent => ({
  event_type: 'label_removed',
  actor,
  comment: `Removed label: ${label}`,
  created_at: at,
})
const base = { labels: ['income'], flag: 'from-mike', human }

describe('noteRead', () => {
  it('reads the flag removal after the note from the audit events', () => {
    const read = noteRead({
      ...base,
      comments: [note, { author: 'agent:codex', created_at: '2026-10-20T11:10:00Z' }],
      events: [
        removed('from-mike', '2026-10-20T11:02:40Z'),
        { event_type: 'label_added', actor: 'human:mike', comment: 'Added label: from-mike', created_at: '2026-10-20T10:58:26Z' },
      ],
    })
    expect(read).toEqual({
      at: '2026-10-20T11:02:40Z',
      actor: 'agent:claude',
      by: { kind: 'agent', name: 'Claude', self: false },
      source: 'label',
    })
  })

  it('takes the earliest removal after the note, ignoring removals of other labels and older rounds', () => {
    const read = noteRead({
      ...base,
      comments: [note],
      events: [
        removed('from-mike', '2026-10-20T12:00:00Z', 'agent:codex'),
        removed('needs-mike', '2026-10-20T11:00:00Z'),
        removed('from-mike', '2026-10-20T11:30:00Z', 'agent:gemini'),
        removed('from-mike', '2026-10-19T09:00:00Z'),
      ],
    })
    expect(read?.at).toBe('2026-10-20T11:30:00Z')
    expect(read?.by.name).toBe('Gemini')
  })

  it('counts a removal in the same second as the note, since bd stamps events in whole seconds', () => {
    const read = noteRead({
      ...base,
      comments: [{ author: 'human:mike', created_at: '2026-10-20T10:58:25.400Z' }],
      events: [removed('from-mike', '2026-10-20T10:58:25Z')],
    })
    expect(read?.source).toBe('label')
  })

  it('shows nothing while the bead still carries the flag', () => {
    expect(
      noteRead({ ...base, labels: ['from-mike'], comments: [note], events: [removed('from-mike', '2026-10-20T11:02:40Z')] }),
    ).toBeNull()
  })

  it('shows nothing when the human never commented', () => {
    expect(
      noteRead({
        ...base,
        comments: [{ author: 'agent:claude', created_at: '2026-10-20T11:00:00Z' }],
        events: [removed('from-mike', '2026-10-20T11:02:40Z')],
      }),
    ).toBeNull()
  })

  it('falls back to the first agent comment after the note when the clone has no audit row', () => {
    const read = noteRead({
      ...base,
      comments: [
        { author: 'agent:codex', created_at: '2026-10-20T09:00:00Z' },
        note,
        { author: 'agent:gemini', created_at: '2026-10-20T12:00:00Z' },
        { author: 'agent:claude', created_at: '2026-10-20T11:05:00Z' },
        { author: 'michal.psencik', created_at: '2026-10-20T11:00:00Z' },
      ],
      events: [],
    })
    expect(read).toMatchObject({ at: '2026-10-20T11:05:00Z', actor: 'agent:claude', source: 'reply' })
  })

  it('falls back to the reply when the latest note was sent without the flag', () => {
    const read = noteRead({
      ...base,
      comments: [note, { author: 'agent:claude', created_at: '2026-10-20T11:05:00Z' }],
      events: [removed('from-mike', '2026-10-19T09:00:00Z')],
    })
    expect(read?.source).toBe('reply')
  })

  it('reads the latest note, not an earlier one', () => {
    const read = noteRead({
      ...base,
      comments: [
        { author: 'human:mike', created_at: '2026-10-18T10:00:00Z' },
        { author: 'agent:claude', created_at: '2026-10-18T11:00:00Z' },
        note,
      ],
      events: [],
    })
    expect(read).toBeNull()
  })

  it('works on a board with no note flag configured', () => {
    const read = noteRead({
      ...base,
      flag: null,
      comments: [note, { author: 'agent:claude', created_at: '2026-10-20T11:05:00Z' }],
      events: [removed('from-mike', '2026-10-20T11:02:40Z')],
    })
    expect(read?.source).toBe('reply')
  })
})
