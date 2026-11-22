import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Issue, Status } from '../api'
import { statusSegments, SWITCH_STATUSES, WriteRow } from './write-row'

const ISSUE: Issue = {
  id: 'repo-a1',
  title: 'a bead',
  description: '',
  status: 'open',
  priority: 2,
  issue_type: 'task',
  labels: ['product'],
  created_at: '2026-10-01T10:00:00Z',
  updated_at: '2026-10-16T17:35:00Z',
  comment_count: 0,
  dependency_count: 0,
  dependent_count: 0,
}

function render(status: Status): string {
  const noop = () => {}
  return renderToStaticMarkup(
    <WriteRow issue={{ ...ISSUE, status }} knownLabels={[]} onPriority={noop} onStatus={noop} onLabels={noop} />,
  )
}

describe('status switch', () => {
  it('offers every status one click sets, the current one pressed', () => {
    const html = render('in_progress')
    const pressed = html.match(/<button class="on st-in_progress" aria-pressed="true">in progress<\/button>/g)
    expect(pressed).toHaveLength(1)
    for (const status of ['open', 'pinned', 'deferred', 'closed']) {
      expect(html).toContain(`class="st-${status}" aria-pressed="false"`)
    }
    expect(html).not.toContain('st-blocked')
  })

  it('shows blocked only while it holds, and never as a click', () => {
    expect(statusSegments('open')).toEqual([...SWITCH_STATUSES])
    expect(statusSegments('blocked')).toEqual([...SWITCH_STATUSES, 'blocked'])
    expect(render('blocked')).toMatch(/class="on st-blocked" aria-pressed="true" disabled="">blocked</)
  })
})
