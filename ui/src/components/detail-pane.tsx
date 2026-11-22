// the right pane: one bead, always open, with the note box pinned at its foot

import { useEffect, useRef } from 'react'
import type { CSSProperties, RefObject } from 'react'
import type { BoardConfig, Comment, Issue, IssueDetail, NoteRead, SearchField, Status } from '../api'
import {
  axisOf,
  flagsOf,
  foldPoint,
  latestNote,
  orderComments,
  projectOf,
  repliesAfterNote,
  shortId,
  unreadNote,
  type LinkGroup,
} from '../model'
import { axisStyle } from '../format'
import { linkTitle, useStrings } from '../i18n'
import { useVisitFolds, type Folds } from '../use-folds'
import { useCommentOrder } from '../use-comment-order'
import { MarkdownText } from './markdown'
import { WriteRow } from './write-row'
import { NoteBox } from './note-box'
import { AskCard } from './ask-card'
import { askOf } from '../asks'
import { TryCard } from './try-card'
import { tryOf, type Verdict } from '../tries'

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
  /** answers the bead's stored question; resolves false when it failed */
  onAnswer: (text: string) => Promise<boolean>
  /** a verdict on the bead's ready-to-try check; resolves false when it failed */
  onVerdict: (verdict: Verdict, note: string) => Promise<boolean>
  /** copies a kit chip's text */
  onCopyText: (text: string, what: string) => void
}

/** fold key of the description, beside the index sections in the same store */
const DESCRIPTION_FOLD = 'detail:description'

/** fold key of a comment in the per-visit store */
const commentFold = (id: string) => `comment:${id}`

/** a date with its relative age on hover, so two days back does not read as old news */
function When({ iso, prefix = '', long = false }: { iso: string | null | undefined; prefix?: string; long?: boolean }) {
  const s = useStrings()
  return (
    <span title={s.relative(iso)}>
      {prefix}
      {long ? s.dateTime(iso) : s.date(iso)}
    </span>
  )
}

/** "read by Claude, 20 Oct 11:04" on the human's latest note, with where that came from on hover */
function ReadTag({ read, flag }: { read: NoteRead; flag: string | null }) {
  const s = useStrings()
  const who = read.by.self ? s.detail.youLower : read.by.name
  const ago = s.relative(read.at)
  const title =
    read.source === 'label'
      ? s.detail.readLabelTitle(read.actor, flag ?? s.detail.noteWord, ago)
      : s.detail.readGuessTitle(ago)
  const when = s.shortDateTime(read.at)
  return (
    <span className={read.source === 'label' ? 'readtag' : 'readtag guess'} title={title}>
      {read.source === 'label' ? s.detail.readBy(who, when) : s.detail.answeredBy(who, when)}
    </span>
  )
}

/** the comment header label: You for the board's human, the agent or human name, or a legacy marker */
function CommentHead({ comment, human }: { comment: Comment; human: string }) {
  const s = useStrings()
  const { by } = comment
  if (by.kind === 'unknown') {
    return (
      <>
        <b className="who unknown" title={s.detail.unknownTitle(comment.author)}>
          {comment.author}
        </b>
        <span className="whotag">{s.detail.authorUnknown}</span>
      </>
    )
  }
  const label = by.self ? s.detail.you : by.name
  const title = by.self ? `${human} (${comment.author})` : comment.author
  return (
    <>
      <b className={`who ${by.kind}`} title={title}>
        {label}
      </b>
      {by.kind === 'agent' ? <span className="whotag">{s.detail.agent}</span> : null}
    </>
  )
}

function CommentRow(props: {
  comment: Comment
  human: string
  flash: boolean
  unread: boolean
  /** an agent comment after the human's latest note */
  reply: boolean
  /** on the human's latest note, once a session read it */
  read: NoteRead | null
  flag: string | null
  /** the headline the comment folds to, null when it reads whole */
  head: string | null
  open: boolean
  onFold: (open: boolean) => void
}) {
  const s = useStrings()
  const { comment, human, flash, unread, reply, read, head, open } = props
  const cls = [
    'comment',
    comment.by.self ? 'mine' : '',
    comment.by.kind,
    unread ? 'unread' : '',
    reply ? 'reply' : '',
    flash ? 'flash' : '',
  ]
  const folded = head !== null && !open
  return (
    <div className={cls.filter(Boolean).join(' ')} id={`comment-${comment.id}`}>
      <div className="chead">
        <CommentHead comment={comment} human={human} />
        <When iso={comment.created_at} long />
        {unread ? (
          <span className="unreadtag" title={s.detail.unreadTitle}>
            {s.detail.unread}
          </span>
        ) : null}
        {reply ? (
          <span className="replytag" title={s.detail.replyTitle}>
            {s.detail.reply}
          </span>
        ) : null}
        {read ? <ReadTag read={read} flag={props.flag} /> : null}
      </div>
      <MarkdownText text={folded ? head : comment.text} className="ctext" />
      {head !== null ? (
        <button className="cmore" aria-expanded={open} onClick={() => props.onFold(!open)}>
          {open ? s.detail.less : s.detail.more}
        </button>
      ) : null}
    </div>
  )
}

/** detail of the selected bead; the list record paints the header before the join lands */
export function DetailPane(props: DetailPaneProps) {
  const s = useStrings()
  const { issue, detail, repoName, config, human, knownLabels, reveal, folds } = props
  const { order, toggle: toggleOrder } = useCommentOrder()
  // comments open for this visit; every long one starts folded to its headline
  const commentFolds = useVisitFolds()
  const descriptionFolded = folds.isFolded(DESCRIPTION_FOLD, false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const readRef = useRef<HTMLElement>(null)
  const revealed = reveal && issue && reveal.id === issue.id ? reveal : null
  const detailReady = detail?.issue.id === issue?.id

  // a search hit in a folded description or comment opens it first, and it stays open
  const { setFolded } = folds
  const { setFolded: setCommentFolded } = commentFolds
  useEffect(() => {
    if (revealed?.field === 'description') setFolded(DESCRIPTION_FOLD, false)
    if (revealed?.field === 'comment' && revealed.commentId) setCommentFolded(commentFold(revealed.commentId), false)
  }, [revealed, setFolded, setCommentFolded])

  // a search hit scrolls its field or comment into view once the detail has landed and a hit
  // comment has opened; once per pick, so folding it again afterwards does not scroll back
  const revealComment = revealed?.field === 'comment' ? revealed.commentId : null
  const revealOpen = revealComment ? !commentFolds.isFolded(commentFold(revealComment), true) : true
  const scrolledSeq = useRef<number | null>(null)
  useEffect(() => {
    if (!revealed || !detailReady || !bodyRef.current || !revealOpen) return
    if (scrolledSeq.current === revealed.seq) return
    scrolledSeq.current = revealed.seq
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
  }, [revealed, detailReady, revealOpen])

  // on a phone the whole pane scrolls, so a new bead starts at its top
  const openId = issue?.id
  useEffect(() => {
    if (readRef.current) readRef.current.scrollTop = 0
  }, [openId])

  if (!issue) {
    return (
      <main className="read">
        <div className="loading">{s.detail.none}</div>
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
  const replies = repliesAfterNote(comments)
  const note = latestNote(comments)
  const noteRead = detailReady && !unread ? (detail?.note_read ?? null) : null
  const ask = askOf(full, config)
  const check = tryOf(full, config)

  return (
    <main className="read" ref={readRef} style={axisStyle(axis, config) as CSSProperties}>
      <div className="rhead">
        <div className="rline">
          <button className="back" onClick={props.onBack} aria-label={s.detail.back}>
            &#8249; {s.detail.list}
          </button>
          <span className="dot" />
          <button
            className="mono copyid"
            style={{ color: 'var(--ink-2)' }}
            title={s.detail.copyId}
            onClick={() => props.onCopyId(full.id)}
          >
            {short}
          </button>
          {config.lanes.length ? <span className="axis">{axis ?? config.unlaned.title}</span> : null}
          <span className={`stat st-${full.status}`}>{s.status[full.status]}</span>
          <span className="right">
            <span>{s.detail.comments(full.comment_count)}</span>
            <When iso={full.updated_at} prefix={s.detail.touched} />
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
            <When iso={full.created_at} prefix={s.detail.opened} />
            <span className="s">/</span>
            <When iso={full.updated_at} prefix={s.detail.updated} />
            {full.closed_at ? (
              <>
                <span className="s">/</span>
                <When iso={full.closed_at} prefix={s.detail.closed} />
              </>
            ) : null}
            {full.due_at && full.status !== 'closed' ? (
              <>
                <span className="s">/</span>
                <When iso={full.due_at} prefix={s.detail.due} />
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

          {ask ? <AskCard key={full.id} ask={ask} short={short} config={config} onAnswer={props.onAnswer} /> : null}
          {check ? (
            <TryCard
              key={`try:${full.id}`}
              kit={check}
              id={full.id}
              short={short}
              onCopy={props.onCopyText}
              onVerdict={props.onVerdict}
            />
          ) : null}

          {unread ? (
            <button
              className="unreadjump"
              onClick={() => {
                setCommentFolded(commentFold(unread.id), false)
                bodyRef.current
                  ?.querySelector(`#comment-${CSS.escape(unread.id)}`)
                  ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
              }}
            >
              {unread.by.self ? s.detail.unreadMine : s.detail.unreadLegacy}
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
                {s.detail.description}
                {descriptionFolded ? <span className="note">{s.detail.folded}</span> : null}
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
                    <p className="empty">{s.detail.noDescription}</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {issue.notes ? (
            <>
              <h2 className="sub">{s.detail.notes}</h2>
              <div className={revealed?.field === 'notes' ? 'notes flash' : 'notes'} data-field="notes">
                <MarkdownText text={issue.notes} />
              </div>
            </>
          ) : null}

          {props.links.length ? (
            <>
              <h2 className="sub">{s.detail.links}</h2>
              <div className="links">
                {props.links.map((group) => (
                  <div className="lgroup" key={group.key}>
                    <span className="lkind">{linkTitle(s, group)}</span>
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
                            <span className="lt">{other?.title ?? s.detail.notInLedger}</span>
                            {other && other.status !== 'open' ? (
                              <span className="chip">{s.status[other.status]}</span>
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
            <span>{s.detail.commentsHeading}</span>
            {thread.length > 1 ? (
              <button
                className="corder"
                onClick={toggleOrder}
                aria-label={`${s.detail.orderNow(order)}, ${s.detail.orderSwitch(order)}`}
                title={s.detail.orderSwitch(order)}
              >
                {s.detail.orderNow(order)} <span aria-hidden="true">{order === 'oldest' ? '\u2193' : '\u2191'}</span>
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
                reply={replies.has(c.id)}
                read={c === note ? noteRead : null}
                flag={config.note.addLabel}
                head={foldPoint(c.text)}
                open={!commentFolds.isFolded(commentFold(c.id), true)}
                onFold={(open) => setCommentFolded(commentFold(c.id), !open)}
                key={c.id}
              />
            ))
          ) : detailReady || full.comment_count === 0 ? (
            <div className="empty">{s.detail.noComments}</div>
          ) : (
            <div className="empty">{s.detail.readingComments}</div>
          )}

          {detail && detail.sessions !== null ? (
            <>
              <h2 className="sub">{s.detail.sessions}</h2>
              {detail.sessions.length ? (
                detail.sessions.map((sess) => (
                  <div className="srow" key={sess.session_id}>
                    <span className="sd mono">{s.shortDate(sess.day)}</span>
                    <div className="smain">
                      <a href={sess.url} target="_blank" rel="noreferrer">
                        {sess.title}
                      </a>
                      {sess.prompt ? <div className="sprompt">{sess.prompt}</div> : null}
                    </div>
                    {sess.agent ? <span className="chip">{sess.agent}</span> : <span />}
                  </div>
                ))
              ) : (
                <div className="empty">{s.detail.noSessions}</div>
              )}
            </>
          ) : null}

          {detail && detail.notes.length ? (
            <>
              <h2 className="sub">{s.detail.inNotes}</h2>
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
