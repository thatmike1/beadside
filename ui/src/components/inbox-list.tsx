// the inbox and the stale filter: rows that carry their one-action verdicts on a second line

import type { CSSProperties, ReactNode } from 'react'
import type { BoardConfig, Issue } from '../api'
import type { Inbox, InboxKind } from '../inbox'
import { daysUntouched, dueState } from '../inbox'
import { axisOf } from '../model'
import { axisStyle, formatShortDate } from '../format'
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
  repoName: string
  config: BoardConfig
  selected: string | null
  now: Date
  onSelect: (id: string) => void
}

function dueText(issue: Issue, now: Date): string {
  const state = dueState(issue, now)
  const when = formatShortDate(issue.due_at)
  if (state === 'overdue') return `overdue, was due ${when}`
  const due = new Date(issue.due_at ?? '')
  return due.toDateString() === now.toDateString() ? 'due today' : `due ${when}`
}

function untouchedText(issue: Issue, now: Date): string {
  return `untouched ${daysUntouched(issue, now)} days, since ${formatShortDate(issue.updated_at)}`
}

/** a board row with a second line: why it is here, then the verdict buttons */
function ActionRow(props: {
  issue: Issue
  why: string
  hot?: boolean
  /** a reply opened this visit: dimmed, with a read mark, until the list is rebuilt */
  read?: boolean
  actions?: ReactNode
  list: ListProps
}) {
  const { issue, why, hot, read, actions, list } = props
  const axis = axisOf(issue, list.config.lanes)
  const selected = issue.id === list.selected
  const className = ['irow', selected ? 'sel' : '', read ? 'seen' : ''].filter(Boolean).join(' ')
  return (
    <div className={className} style={axisStyle(axis, list.config) as CSSProperties}>
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
          {read ? <span className="readmark">read</span> : null}
          {why ? <span className={hot ? 'why hot' : 'why'}>{why}</span> : null}
          {actions}
        </div>
      ) : null}
    </div>
  )
}

function StaleActions({ issue, list }: { issue: Issue; list: ListProps }) {
  return (
    <span className="acts">
      <button onClick={() => list.onKeep(issue)} title="still wanted: stamp it kept, it leaves the stale list">
        keep
      </button>
      <button onClick={() => list.onSnooze(issue)} title={`defer until ${SNOOZE_UNTIL}`}>
        snooze 4w
      </button>
      <button onClick={() => list.onClose(issue)} title="close it as stale">
        close
      </button>
    </span>
  )
}

function DueActions({ issue, list }: { issue: Issue; list: ListProps }) {
  return (
    <span className="acts">
      <button onClick={() => list.onRedate(issue, '+1w')} title="due a week from now">
        +1w
      </button>
      <button onClick={() => list.onRedate(issue, '+2w')} title="due two weeks from now">
        +2w
      </button>
      <input
        type="date"
        aria-label={`new due date for ${issue.title}`}
        title="pick a date"
        onChange={(e) => {
          if (e.target.value) list.onRedate(issue, e.target.value)
        }}
      />
    </span>
  )
}

function rowFor(kind: InboxKind, issue: Issue, list: ListProps, read = false) {
  if (kind === 'reply') {
    const reply = issue.agent_reply
    const why = reply ? `${reply.name} replied ${formatShortDate(reply.at)}` : ''
    return <ActionRow key={issue.id} issue={issue} why={why} read={read} list={list} />
  }
  if (kind === 'due') {
    return (
      <ActionRow
        key={issue.id}
        issue={issue}
        why={dueText(issue, list.now)}
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
        why={untouchedText(issue, list.now)}
        actions={<StaleActions issue={issue} list={list} />}
        list={list}
      />
    )
  }
  return <ActionRow key={issue.id} issue={issue} why="" list={list} />
}

/** the landing view: only what clears in one action, and a finished state when that is nothing */
export function InboxList(props: ListProps & { inbox: Inbox; onBoard: () => void }) {
  const { inbox } = props
  // read replies keep the list up until it is rebuilt, even with nothing left to clear
  if (!inbox.order.length) {
    return (
      <div className="cleared">
        <b>Inbox clear.</b>
        <span>
          No replies to read, no calls to make, nothing due this week and today's stale beads have their verdicts.
        </span>
        <button onClick={props.onBoard}>
          the lanes <kbd>b</kbd>
        </button>
      </div>
    )
  }
  return (
    <>
      {inbox.sections.map((section) => (
        <div className="sec" key={section.key}>
          <div className={section.key === 'label' || section.key === 'due' ? 'sechead hot' : 'sechead'}>
            <span>{section.title}</span>
            <span className="n">{section.rows.filter((i) => !(section.key === 'reply' && inbox.read.has(i.id))).length}</span>
            <span className="note">{section.note}</span>
          </div>
          <div className="secrule" />
          {section.rows.map((issue) => rowFor(section.key, issue, props, inbox.read.has(issue.id)))}
        </div>
      ))}
    </>
  )
}

/** the stale filter: every open bead untouched 30+ days, oldest first, each with its verdicts */
export function StaleList(props: ListProps & { stale: Issue[] }) {
  const { stale } = props
  return (
    <div className="sec">
      <div className="sechead">
        <span>stale</span>
        <span className="n">{stale.length}</span>
        <span className="note">open, untouched 30+ days, oldest first</span>
      </div>
      <div className="secrule" />
      {stale.length ? (
        stale.map((issue) => rowFor('stale', issue, props))
      ) : (
        <div className="grouphead">
          <span className="gt">nothing stale. every open bead moved this month.</span>
        </div>
      )}
    </div>
  )
}
