// the right pane: one bead, always open, with the note box pinned at its foot

import { useEffect, useRef } from 'react'
import type { CSSProperties, RefObject } from 'react'
import type { BoardConfig, Comment, Issue, IssueDetail, SearchField, Status } from '../api'
import { axisOf, flagsOf, projectOf, shortId, unreadNote } from '../model'
import { axisStyle, formatDate, formatShortDate, statusLabel } from '../format'
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
}

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

function CommentRow({ comment, human, flash }: { comment: Comment; human: string; flash: boolean }) {
  const cls = ['comment', comment.by.self ? 'mine' : '', comment.by.kind, flash ? 'flash' : '']
  return (
    <div className={cls.filter(Boolean).join(' ')} id={`comment-${comment.id}`}>
      <div className="chead">
        <CommentHead comment={comment} human={human} />
        <span>{formatDate(comment.created_at)}</span>
      </div>
      <MarkdownText text={comment.text} className="ctext" />
    </div>
  )
}

/** detail of the selected bead; the list record paints the header before the join lands */
export function DetailPane(props: DetailPaneProps) {
  const { issue, detail, repoName, config, human, knownLabels, reveal } = props
  const bodyRef = useRef<HTMLDivElement>(null)
  const readRef = useRef<HTMLElement>(null)
  const revealed = reveal && issue && reveal.id === issue.id ? reveal : null
  const detailReady = detail?.issue.id === issue?.id

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
        <div className="loading">no bead selected.</div>
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
  // the unread note is shown on its own above, so it does not repeat in the list
  const earlier = unread ? comments.filter((c) => c !== unread) : comments
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
            {full.dependency_count ? (
              <>
                <span className="s">/</span>
                <span>{full.dependency_count} blocked by</span>
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
            <>
              <h2 className="sub">
                {unread.by.self ? 'your note, still unread' : 'unread note, written before authors were recorded'}
              </h2>
              <CommentRow comment={unread} human={human} flash={flashComment === unread.id} />
            </>
          ) : null}

          <h2 className="sub">description</h2>
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

          {issue.notes ? (
            <>
              <h2 className="sub">notes</h2>
              <div className={revealed?.field === 'notes' ? 'notes flash' : 'notes'} data-field="notes">
                <MarkdownText text={issue.notes} />
              </div>
            </>
          ) : null}

          <h2 className="sub">{unread ? 'other comments' : 'comments'}</h2>
          {earlier.length ? (
            earlier.map((c) => (
              <CommentRow comment={c} human={human} flash={flashComment === c.id} key={c.id} />
            ))
          ) : detailReady || full.comment_count === 0 ? (
            <div className="empty">{unread ? 'nothing else.' : 'no comments yet.'}</div>
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
