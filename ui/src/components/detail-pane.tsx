// the right pane: one bead, always open, with the note box pinned at its foot

import { useEffect, useRef } from 'react'
import type { CSSProperties, RefObject } from 'react'
import type { BoardConfig, Comment, Issue, IssueDetail, SearchField, Status } from '../api'
import { axisOf, flagsOf, orderComments, projectOf, shortId, unreadNote, type LinkGroup } from '../model'
import { axisStyle, formatDate, formatDateTime, formatShortDate, statusLabel } from '../format'
import type { Folds } from '../use-folds'
import { useCommentOrder } from '../use-comment-order'
import { MarkdownText } from './markdown'
import { WriteRow } from './write-row'
import { NoteBox } from './note-box'

/** where a search hit points inside the open bead */
export interface RevealTarget {
  id: string
  field: SearchField
  commentId: string | null
  /** bumps on every pick, so choosing the same hit again scrolls again */
  seq: number
}

interface DetailPaneProps {
  issue: Issue | undefined
  detail: IssueDetail | undefined
  repoName: string
  config: BoardConfig
  /** display name of the board's human, for the You tooltip */
  human: string
  knownLabels: string[]
  reveal: RevealTarget | null
  noteRef: RefObject<HTMLTextAreaElement | null>
  note: string
  onNoteChange: (value: string) => void
  clear: boolean
  onClearChange: (value: boolean) => void
  onSend: () => void
  sending: boolean
  onPriority: (priority: number) => void
  onStatus: (status: Status) => void
  onLabels: (change: { add?: string[]; remove?: string[] }) => void
  onCopyId: (id: string) => void
  /** phone only: back to the list */
  onBack: () => void
  /** dependencies and dependents by kind */
  links: LinkGroup[]
  byId: Map<string, Issue>
  onOpenLink: (id: string) => void
  /** the index's fold store; the description folds through it too */
  folds: Folds
}

/** fold key of the description, beside the index sections in the same store */
const DESCRIPTION_FOLD = 'detail:description'

/** the comment header label: You for the board's human, the agent or human name, or a legacy marker */
function CommentHead({ comment, human }: { comment: Comment; human: string }) {
  const { by } = comment
  if (by.kind === 'unknown') {
    return (
      <>
        <b className="who unknown" title={`stored author "${comment.author}" does not say whether a person or an agent wrote it`}>
          {comment.author}
        </b>
        <span className="whotag">author unknown</span>
      </>
    )
  }
  const label = by.self ? 'You' : by.name
  const title = by.self ? `${human} (${comment.author})` : comment.author
  return (
    <>
      <b className={`who ${by.kind}`} title={title}>
        {label}
      </b>
      {by.kind === 'agent' ? <span className="whotag">agent</span> : null}
    </>
  )
}

function CommentRow(props: { comment: Comment; human: string; flash: boolean; unread: boolean }) {
  const { comment, human, flash, unread } = props
  const cls = ['comment', comment.by.self ? 'mine' : '', comment.by.kind, unread ? 'unread' : '', flash ? 'flash' : '']
  return (
    <div className={cls.filter(Boolean).join(' ')} id={`comment-${comment.id}`}>
      <div className="chead">
        <CommentHead comment={comment} human={human} />
        <span>{formatDateTime(comment.created_at)}</span>
        {unread ? (
          <span className="unreadtag" title="no agent has read this note yet">
            unread
          </span>
        ) : null}
      </div>
      <MarkdownText text={comment.text} className="ctext" />
    </div>
  )
}

/** detail of the selected bead; the list record paints the header before the join lands */
export function DetailPane(props: DetailPaneProps) {
  const { issue, detail, repoName, config, human, knownLabels, reveal, folds } = props
  const { order, toggle: toggleOrder } = useCommentOrder()
  const descriptionFolded = folds.isFolded(DESCRIPTION_FOLD, false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const readRef = useRef<HTMLElement>(null)
  const revealed = reveal && issue && reveal.id === issue.id ? reveal : null
  const detailReady = detail?.issue.id === issue?.id

  // a search hit in a folded description opens it first
  const { setFolded } = folds
  useEffect(() => {
    if (revealed?.field === 'description') setFolded(DESCRIPTION_FOLD, false)
  }, [revealed, setFolded])

  // a search hit scrolls its field or comment into view once the detail has landed
  useEffect(() => {
    if (!revealed || !detailReady || !bodyRef.current) return
    const selector =
      revealed.field === 'comment' && revealed.commentId
        ? `#comment-${CSS.escape(revealed.commentId)}`
        : revealed.field === 'description' || revealed.field === 'notes'
          ? `[data-field="${revealed.field}"]`
          : null
    if (!selector) {
      bodyRef.current.scrollTop = 0
      return
    }
    const el = bodyRef.current.querySelector(selector)
    el?.scrollIntoView({ block: 'center' })
  }, [revealed, detailReady])

  // on a phone the whole pane scrolls, so a new bead starts at its top
  const openId = issue?.id
  useEffect(() => {
    if (readRef.current) readRef.current.scrollTop = 0
  }, [openId])

  if (!issue) {
    return (
      <main className="read">
        <div className="loading">no bead open.</div>
      </main>
    )
  }

  const full = issue
  const short = shortId(full.id, repoName)
  const axis = axisOf(full, config.lanes)
  const project = projectOf(full, config)
  const flags = flagsOf(full, config.derived.allFlags)
  // detail from a previous selection must not paint under this bead's header
  const comments = detailReady ? (detail?.comments ?? []) : []
  const unread =
    config.note.addLabel && full.labels.includes(config.note.addLabel) ? unreadNote(comments) : undefined
  const thread = orderComments(comments, order)
  const flashComment = revealed?.field === 'comment' ? revealed.commentId : null

  return (
    <main className="read" ref={readRef} style={axisStyle(axis, config) as CSSProperties}>
      <div className="rhead">
        <div className="rline">
          <button className="back" onClick={props.onBack} aria-label="back to the list">
            &#8249; list
          </button>
          <span className="dot" />
          <button
            className="mono copyid"
            style={{ color: 'var(--ink-2)' }}
            title="copy id"
            onClick={() => props.onCopyId(full.id)}
          >
            {short}
          </button>
          {config.lanes.length ? <span className="axis">{axis ?? config.unlaned.title}</span> : null}
          <span>{statusLabel(full.status)}</span>
          <span className="right">
            <span>
              {full.comment_count} {full.comment_count === 1 ? 'comment' : 'comments'}
            </span>
            <span>touched {formatDate(full.updated_at)}</span>
          </span>
        </div>
        <WriteRow
          issue={full}
          knownLabels={knownLabels}
          onPriority={props.onPriority}
          onStatus={props.onStatus}
          onLabels={props.onLabels}
        />
      </div>

      <div className="rbody" key={full.id} ref={bodyRef}>
        <div className="rwrap">
          <h1>{full.title}</h1>
          <div className="meta">
            <span>p{full.priority}</span>
            <span className="s">/</span>
            <span>{full.issue_type}</span>
            <span className="s">/</span>
            <span>opened {formatDate(full.created_at)}</span>
            <span className="s">/</span>
            <span>updated {formatDate(full.updated_at)}</span>
            {full.closed_at ? (
              <>
                <span className="s">/</span>
                <span>closed {formatDate(full.closed_at)}</span>
              </>
            ) : null}
            {full.due_at && full.status !== 'closed' ? (
              <>
                <span className="s">/</span>
                <span>due {formatDate(full.due_at)}</span>
              </>
            ) : null}
            {project ? (
              <>
                <span className="s">/</span>
                <span>{project}</span>
              </>
            ) : null}
            {flags.length ? (
              <span className="chips">
                {flags.map((flag) => (
                  <span
                    key={flag}
                    className={config.derived.hotChips.includes(flag) ? 'chip hot' : 'chip'}
                  >
                    {flag}
                  </span>
                ))}
              </span>
            ) : null}
          </div>

          {unread ? (
            <button
              className="unreadjump"
              onClick={() =>
                bodyRef.current
                  ?.querySelector(`#comment-${CSS.escape(unread.id)}`)
                  ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
              }
            >
              {unread.by.self ? 'your note is still unread' : 'an unread note, written before authors were recorded'}
              <span aria-hidden="true"> &#8595;</span>
            </button>
          ) : null}

          <div className={descriptionFolded ? 'dsec folded' : 'dsec'}>
            <h2 className="sub">
              <button
                className="dfold"
                aria-expanded={!descriptionFolded}
                onClick={() => setFolded(DESCRIPTION_FOLD, !descriptionFolded)}
              >
                description
                {descriptionFolded ? <span className="note">folded</span> : null}
              </button>
            </h2>
            {/* always rendered so the fold can animate; inert while folded so nothing inside takes focus */}
            <div className="secbody" inert={descriptionFolded}>
              <div className="secbody-in">
                <div
                  className={revealed?.field === 'description' ? 'prose flash' : 'prose'}
                  data-field="description"
                >
                  {full.description ? (
                    <MarkdownText text={full.description} />
                  ) : (
                    <p className="empty">no description on this bead.</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {issue.notes ? (
            <>
              <h2 className="sub">notes</h2>
              <div className={revealed?.field === 'notes' ? 'notes flash' : 'notes'} data-field="notes">
                <MarkdownText text={issue.notes} />
              </div>
            </>
          ) : null}

          {props.links.length ? (
            <>
              <h2 className="sub">links</h2>
              <div className="links">
                {props.links.map((group) => (
                  <div className="lgroup" key={group.key}>
                    <span className="lkind">{group.title}</span>
                    <div className="lrows">
                      {group.ids.map((id) => {
                        const other = props.byId.get(id)
                        const closed = other?.status === 'closed'
                        return (
                          <button
                            className={closed ? 'lrow struck' : 'lrow'}
                            key={id}
                            onClick={() => props.onOpenLink(id)}
                            style={axisStyle(other ? axisOf(other, config.lanes) : null, config) as CSSProperties}
                          >
                            <span className="mono lid">{shortId(id, repoName)}</span>
                            <span className="lt">{other?.title ?? 'not in this ledger'}</span>
                            {other && other.status !== 'open' ? (
                              <span className="chip">{statusLabel(other.status)}</span>
                            ) : null}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          <h2 className="sub chsub">
            <span>comments</span>
            {thread.length > 1 ? (
              <button
                className="corder"
                onClick={toggleOrder}
                aria-label={`${order} first, switch to ${order === 'oldest' ? 'newest' : 'oldest'} first`}
                title={`switch to ${order === 'oldest' ? 'newest' : 'oldest'} first`}
              >
                {order} first <span aria-hidden="true">{order === 'oldest' ? '\u2193' : '\u2191'}</span>
              </button>
            ) : null}
          </h2>
          {thread.length ? (
            thread.map((c) => (
              <CommentRow
                comment={c}
                human={human}
                flash={flashComment === c.id}
                unread={c === unread}
                key={c.id}
              />
            ))
          ) : detailReady || full.comment_count === 0 ? (
            <div className="empty">no comments yet.</div>
          ) : (
            <div className="empty">reading comments…</div>
          )}

          {detail && detail.sessions !== null ? (
            <>
              <h2 className="sub">sessions that touched it</h2>
              {detail.sessions.length ? (
                detail.sessions.map((s) => (
                  <div className="srow" key={s.session_id}>
                    <span className="sd mono">{formatShortDate(s.day)}</span>
                    <div className="smain">
                      <a href={s.url} target="_blank" rel="noreferrer">
                        {s.title}
                      </a>
                      {s.prompt ? <div className="sprompt">{s.prompt}</div> : null}
                    </div>
                    {s.agent ? <span className="chip">{s.agent}</span> : <span />}
                  </div>
                ))
              ) : (
                <div className="empty">no session mentions this id.</div>
              )}
            </>
          ) : null}

          {detail && detail.notes.length ? (
            <>
              <h2 className="sub">in notes</h2>
              {detail.notes.map((m, i) => (
                <div className="memrow" key={`${m.file}:${m.line}:${i}`}>
                  <span className="mono">
                    {m.file}:{m.line}
                  </span>
                  <div className="ex">{m.excerpt}</div>
                </div>
              ))}
            </>
          ) : null}
        </div>
      </div>

      <NoteBox
        issue={full}
        short={short}
        config={config}
        noteRef={props.noteRef}
        value={props.note}
        onChange={props.onNoteChange}
        clear={props.clear}
        onClearChange={props.onClearChange}
        onSend={props.onSend}
        sending={props.sending}
      />
    </main>
  )
}
