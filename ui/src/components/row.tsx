// one dense index row: lane glyph, short id, title, chips, priority

import type { CSSProperties } from 'react'
import type { BoardConfig, Issue } from '../api'
import type { BoardRow } from '../model'
import { shortId, subsOf } from '../model'
import { axisStyle, laneGlyph } from '../format'

export interface RowProps {
  row: BoardRow
  axis: string | null
  repoName: string
  config: BoardConfig
  selected: boolean
  showWaitDot: boolean
  onSelect: (id: string) => void
}

function chipsFor(issue: Issue, config: BoardConfig): { text: string; hot: boolean }[] {
  const out: { text: string; hot: boolean }[] = []
  if (issue.status === 'in_progress') out.push({ text: 'in progress', hot: false })
  if (issue.status === 'deferred') out.push({ text: 'deferred', hot: false })
  if (issue.status === 'closed') out.push({ text: 'closed', hot: false })
  for (const flag of config.derived.allFlags) {
    if (config.thoughts && flag === config.thoughts.label) continue
    if (!issue.labels.includes(flag)) continue
    out.push({ text: flag, hot: config.derived.hotChips.includes(flag) })
  }
  for (const sub of subsOf(issue, config.subLabels)) out.push({ text: sub, hot: false })
  return out
}

export function Row({
  row,
  axis,
  repoName,
  config,
  selected,
  showWaitDot,
  onSelect,
}: RowProps) {
  const { issue } = row
  const dim = issue.status === 'deferred' || issue.status === 'closed'
  const unread = config.note.addLabel ? issue.labels.includes(config.note.addLabel) : false
  const cls = [
    'row',
    row.child ? 'child' : '',
    selected ? 'sel' : '',
    unread ? 'unread' : '',
    dim ? 'dim' : '',
    issue.status === 'closed' ? 'struck' : '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <button
      className={cls}
      data-id={issue.id}
      style={axisStyle(axis, config) as CSSProperties}
      onClick={() => onSelect(issue.id)}
    >
      <span className="mono mark" aria-hidden="true">
        {laneGlyph(axis, config)}
      </span>
      <span className="mono rid">{shortId(issue.id, repoName)}</span>
      <span className="rt">{issue.title}</span>
      <span className="chips">
        {showWaitDot && row.waiting ? <span className="waitdot" title="waiting on you" /> : null}
        {chipsFor(issue, config).map((chip) => (
          <span key={chip.text} className={chip.hot ? 'chip hot' : 'chip'}>
            {chip.text}
          </span>
        ))}
      </span>
      <span className="mono rp">p{issue.priority}</span>
    </button>
  )
}
