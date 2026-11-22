// the inbox and the stale filter: rows that carry their one-action verdicts on a second line

import type { CSSProperties, ReactNode } from 'react'
import type { BoardConfig, Issue } from '../api'
import type { Inbox, InboxKind } from '../inbox'
import { answerOf, daysUntouched, dueState, inboxFoldKey, isAnswerSection } from '../inbox'
import { askOf } from '../asks'
import { parseTry, type TryGroup } from '../tries'
import { axisOf } from '../model'
import { axisStyle } from '../format'
import { lastLine, raisedLine, tryFacts, useStrings, type Strings } from '../i18n'
import { Row } from './row'

/** the one-click verdicts the inbox and the stale filter offer */
export interface RowActions {
  onRedate: (issue: Issue, due: string) => void
  onKeep: (issue: Issue) => void
  onSnooze: (issue: Issue) => void
  onClose: (issue: Issue) => void
}

/** what bd is asked for by the snooze button */
export const SNOOZE_UNTIL = '+4w'

interface ListProps extends RowActions {
  /** the copy, handed down so the row helpers below stay plain functions */
  s: Strings
  repoName: string
  config: BoardConfig
  selected: string | null
  now: Date
  onSelect: (id: string) => void
}

function dueText(issue: Issue, now: Date, s: Strings): string {
  const state = dueState(issue, now)
  const when = s.shortDate(issue.due_at)
  if (state === 'overdue') return s.inbox.overdue(when)
  const due = new Date(issue.due_at ?? '')
  return due.toDateString() === now.toDateString() ? s.inbox.dueToday : s.inbox.dueOn(when)
}

/** who answered, then that it closed and why: "Claude replied 14 Oct, closed: replies sent" */
function closedText(issue: Issue, s: Strings): string {
  const answer = answerOf(issue)
  const reply = issue.agent_reply
  const closed = s.inbox.closedOn(s.shortDate(issue.closed_at))
  const head = answer?.name && reply ? `${s.inbox.replied(reply.name, s.shortDate(reply.at))}, ${closed}` : closed
  const reason = issue.close_reason?.trim()
  return reason ? `${head}: ${reason}` : head
}

function untouchedText(issue: Issue, now: Date, s: Strings): string {
  return s.inbox.untouched(daysUntouched(issue, now), s.shortDate(issue.updated_at))
}

/** a board row with a second line: why it is here, then the verdict buttons */
function ActionRow(props: {
  issue: Issue
  why: string
  /** the date the why line names, read back as "2 days ago" on hover */
  at?: string | null | undefined
  hot?: boolean
  /** a reply opened this visit: dimmed, with a read mark, until the list is rebuilt */
  read?: boolean
  /** dimmed with this mark instead of read: a question answered and waiting for a session */
  mark?: string
  actions?: ReactNode
  list: ListProps
}) {
  const { issue, why, hot, read, actions, list } = props
  const axis = axisOf(issue, list.config.lanes)
  const selected = issue.id === list.selected
  const mark = props.mark ?? (read ? list.s.inbox.read : null)
  const className = ['irow', selected ? 'sel' : '', mark ? 'seen' : ''].filter(Boolean).join(' ')
  return (
    // the whole item opens the bead; the title row is its own button, the verdicts keep their clicks
    <div
      className={className}
      style={axisStyle(axis, list.config) as CSSProperties}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button, input')) return
        list.onSelect(issue.id)
      }}
    >
      <Row
        row={{ issue, child: false, waiting: false }}
        axis={axis}
        repoName={list.repoName}
        config={list.config}
        selected={selected}
        showWaitDot={false}
        onSelect={list.onSelect}
      />
      {why || actions ? (
        <div className="iact">
          {mark ? <span className="readmark">{mark}</span> : null}
          {why ? (
            <span className={hot ? 'why hot' : 'why'} title={list.s.relative(props.at, list.now) || undefined}>
              {why}
            </span>
          ) : null}
          {actions}
        </div>
      ) : null}
    </div>
  )
}

function StaleActions({ issue, list }: { issue: Issue; list: ListProps }) {
  const t = list.s.inbox
  return (
    <span className="acts">
      <button onClick={() => list.onKeep(issue)} title={t.keepTitle}>
        {t.keep}
      </button>
      <button onClick={() => list.onSnooze(issue)} title={t.snoozeTitle(SNOOZE_UNTIL)}>
        {t.snooze}
      </button>
      <button onClick={() => list.onClose(issue)} title={t.closeTitle}>
        {t.close}
      </button>
    </span>
  )
}

function DueActions({ issue, list }: { issue: Issue; list: ListProps }) {
  const t = list.s.inbox
  return (
    <span className="acts">
      <button onClick={() => list.onRedate(issue, '+1w')} title={t.weekTitle}>
        +1w
      </button>
      <button onClick={() => list.onRedate(issue, '+2w')} title={t.twoWeeksTitle}>
        +2w
      </button>
      <input
        type="date"
        aria-label={t.newDue(issue.title)}
        title={t.pickDate}
        onChange={(e) => {
          if (e.target.value) list.onRedate(issue, e.target.value)
        }}
      />
    </span>
  )
}

/** an open question reads as itself; an answered one says so and that a session has it next */
function askRow(issue: Issue, list: ListProps) {
  const ask = askOf(issue, list.config)
  if (!ask) return <ActionRow key={issue.id} issue={issue} why="" list={list} />
  if (ask.answered) {
    const text = ask.answered.text.trim()
    return (
      <ActionRow
        key={issue.id}
        issue={issue}
        why={list.s.inbox.youAnswered(list.s.shortDate(ask.answered.at), text)}
        at={ask.answered.at}
        mark={list.s.inbox.answered}
        list={list}
      />
    )
  }
  const raised = raisedLine(list.s, ask)
  return (
    <ActionRow
      key={issue.id}
      issue={issue}
      why={raised ? `${ask.question} · ${raised}` : ask.question}
      at={ask.first_raised}
      hot={(ask.days_raised ?? 0) >= 3}
      list={list}
    />
  )
}

function rowFor(kind: InboxKind, issue: Issue, list: ListProps, read = false) {
  if (kind === 'ask') return askRow(issue, list)
  if (kind === 'reply') {
    const reply = issue.agent_reply
    const why = reply ? list.s.inbox.replied(reply.name, list.s.shortDate(reply.at)) : ''
    return <ActionRow key={issue.id} issue={issue} why={why} at={reply?.at} read={read} list={list} />
  }
  if (kind === 'closed') {
    return (
      <ActionRow key={issue.id} issue={issue} why={closedText(issue, list.s)} at={answerOf(issue)?.at} read={read} list={list} />
    )
  }
  if (kind === 'due') {
    return (
      <ActionRow
        key={issue.id}
        issue={issue}
        why={dueText(issue, list.now, list.s)}
        at={issue.due_at}
        hot={dueState(issue, list.now) === 'overdue'}
        actions={<DueActions issue={issue} list={list} />}
        list={list}
      />
    )
  }
  if (kind === 'stale') {
    return (
      <ActionRow
        key={issue.id}
        issue={issue}
        why={untouchedText(issue, list.now, list.s)}
        at={issue.updated_at}
        actions={<StaleActions issue={issue} list={list} />}
        list={list}
      />
    )
  }
  return <ActionRow key={issue.id} issue={issue} why="" list={list} />
}

/** the landing view: only what clears in one action, and a finished state when that is nothing */
export function InboxList(
  props: Omit<ListProps, 's'> & { inbox: Inbox; onBoard: () => void; onToggleSection: (sectionKey: string) => void },
) {
  const s = useStrings()
  const list: ListProps = { ...props, s }
  const { inbox } = props
  // read replies keep the list up until it is rebuilt, even with nothing left to clear
  if (!inbox.sections.length) {
    return (
      <div className="cleared">
        <b>{s.inbox.clearedTitle}</b>
        <span>{s.inbox.clearedBody}</span>
        <button onClick={props.onBoard}>
          {s.inbox.lanes} <kbd>b</kbd>
        </button>
      </div>
    )
  }
  return (
    <>
      {inbox.sections.map((section) => (
        <div className={section.folded ? 'sec folded' : 'sec'} key={section.key}>
          <button
            className={section.key === 'ask' || section.key === 'label' || section.key === 'due' ? 'sechead hot' : 'sechead'}
            aria-expanded={!section.folded}
            onClick={() => props.onToggleSection(inboxFoldKey(section.key))}
          >
            <span>{section.title}</span>
            <span className="n">
              {
                section.rows.filter(
                  (i) =>
                    !(isAnswerSection(section.key) && inbox.read.has(i.id)) &&
                    !(section.key === 'ask' && inbox.answered.has(i.id)),
                ).length
              }
            </span>
            <span className="note">{section.note}</span>
          </button>
          <div className="secrule" />
          {/* always rendered so the fold can animate; inert while folded so nothing inside takes focus */}
          <div className="secbody" inert={section.folded}>
            <div className="secbody-in">
              {section.rows.map((issue) => rowFor(section.key, issue, list, inbox.read.has(issue.id)))}
            </div>
          </div>
        </div>
      ))}
    </>
  )
}

/** the stale filter: every open bead untouched 30+ days, oldest first, each with its verdicts */
export function StaleList(props: Omit<ListProps, 's'> & { stale: Issue[] }) {
  const s = useStrings()
  const list: ListProps = { ...props, s }
  const { stale } = props
  return (
    <div className="sec">
      <div className="sechead">
        <span>{s.inbox.stale}</span>
        <span className="n">{stale.length}</span>
        <span className="note">{s.inbox.staleNoteList}</span>
      </div>
      <div className="secrule" />
      {stale.length ? (
        stale.map((issue) => rowFor('stale', issue, list))
      ) : (
        <div className="grouphead">
          <span className="gt">{s.inbox.nothingStale}</span>
        </div>
      )}
    </div>
  )
}

/** one check: the action to try, where and how long, and what came back last time */
function tryRow(issue: Issue, list: ListProps) {
  const kit = list.config.tryIt ? parseTry(issue.metadata, list.config.tryIt.key) : null
  if (!kit) return <ActionRow key={issue.id} issue={issue} why={list.s.inbox.noKit} list={list} />
  const why = [kit.title, ...tryFacts(list.s, kit)].join(' · ')
  return (
    <ActionRow
      key={issue.id}
      issue={issue}
      why={kit.last ? `${why} · ${lastLine(list.s, kit.last)}` : why}
      at={kit.last?.at}
      list={list}
    />
  )
}

/** checks only the human can make, grouped by the app they happen in; age never counts here */
export function TryList(props: Omit<ListProps, 's'> & { groups: TryGroup[] }) {
  const s = useStrings()
  const list: ListProps = { ...props, s }
  const { groups, config } = props
  const title = config.tryIt?.title ?? s.inbox.tryTitle
  const total = groups.reduce((n, g) => n + g.issues.length, 0)
  return (
    <div className="sec">
      <div className="sechead">
        <span>{title}</span>
        <span className="n">{total}</span>
        <span className="note">{config.tryIt?.note ?? s.inbox.tryNote}</span>
      </div>
      <div className="secrule" />
      {groups.map((group) => (
        <div className="group" key={group.app ?? ''}>
          <div className="row caption">
            <span />
            <span className="mono rid" />
            <span className="rt">
              <span className="chip">{group.app ?? s.inbox.noApp}</span>
              <span className="gn">{group.issues.length}</span>
            </span>
          </div>
          <div className="kids">{group.issues.map((issue) => tryRow(issue, list))}</div>
        </div>
      ))}
      {total === 0 ? (
        <div className="grouphead">
          <span className="gt">{s.inbox.nothingToTry}</span>
        </div>
      ) : null}
    </div>
  )
}
