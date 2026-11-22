// the bead's way from filed to closed, drawn as a route: done legs solid, the rest dashed

import type { Issue } from '../api'
import { useStrings, type Strings } from '../i18n'

export interface Stop {
  label: string
  date: string | null
  state: 'done' | 'here' | 'ahead'
}

/** three stops from the issue's own status and dates, nothing guessed */
export function stopsFor(issue: Issue, s: Strings): Stop[] {
  const created = s.date(issue.created_at) || null
  const closed = s.date(issue.closed_at) || null
  const first: Stop = { label: s.route.created, date: created, state: 'done' }
  const end: Stop = { label: s.route.closed, date: null, state: 'ahead' }
  switch (issue.status) {
    case 'closed':
      return [first, { label: s.route.working, date: null, state: 'done' }, { ...end, date: closed, state: 'here' }]
    case 'in_progress':
    case 'blocked':
      return [first, { label: issue.status === 'blocked' ? s.status.blocked : s.route.working, date: null, state: 'here' }, end]
    case 'deferred':
      return [first, { label: s.route.deferred, date: null, state: 'here' }, end]
    case 'pinned':
      return [first, { label: s.route.pinned, date: null, state: 'here' }, end]
    default:
      return [{ ...first, state: 'here' }, { label: s.route.working, date: null, state: 'ahead' }, end]
  }
}

/** a leg between two stops; it bends once, like a street */
function Leg({ done, flip }: { done: boolean; flip: boolean }) {
  return (
    <svg className={done ? 'leg done' : 'leg'} viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
      <path
        d={flip ? 'M0 12 C 30 22, 70 2, 100 12' : 'M0 12 C 30 2, 70 22, 100 12'}
        fill="none"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

/** the status route under the bead's title; the atlas theme draws it, the default theme hides it */
export function StatusRoute({ issue }: { issue: Issue }) {
  const s = useStrings()
  return (
    <ol className={`route route-${issue.status}`} aria-label={s.route.label}>
      {stopsFor(issue, s).map((stop, i) => (
        <li key={i} className={`stop ${stop.state}`} aria-current={stop.state === 'here' ? 'step' : undefined}>
          {i > 0 ? <Leg done={stop.state !== 'ahead'} flip={i % 2 === 0} /> : null}
          <span className="pin">
            <span className="node" aria-hidden="true" />
            <span className="slabel">
              {stop.label}
              {stop.date ? <span className="sdate">{stop.date}</span> : null}
            </span>
          </span>
        </li>
      ))}
    </ol>
  )
}
