// small display helpers shared by the panes

import type { BoardConfig } from './api'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** 3 Sep 2026 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getDate()} ${MONTHS[d.getMonth()] ?? ''} ${d.getFullYear()}`
}

/** 3 Sep 2026 17:35, local time, for comments where the hour matters */
export function formatDateTime(iso: string | null | undefined): string {
  const day = formatDate(iso)
  return day ? `${day} ${formatTime(iso)}` : ''
}

/** 3 Sep 17:35, for tight spots where the hour matters */
export function formatShortDateTime(iso: string | null | undefined): string {
  const day = formatShortDate(iso)
  return day ? `${day} ${formatTime(iso)}` : ''
}

const RELATIVE_STEPS: { unit: string; ms: number }[] = [
  { unit: 'year', ms: 365 * 86_400_000 },
  { unit: 'month', ms: 30 * 86_400_000 },
  { unit: 'week', ms: 7 * 86_400_000 },
  { unit: 'day', ms: 86_400_000 },
  { unit: 'hour', ms: 3_600_000 },
  { unit: 'minute', ms: 60_000 },
]

/**
 * "2 days ago", "in 3 hours", "just now": elapsed time in whole units, for the hover title on a
 * date. weeks start at 14 days and months at 60, so "10 days ago" stays exact
 */
export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const diff = now.getTime() - t
  const abs = Math.abs(diff)
  if (abs < 45_000) return 'just now'
  const step =
    RELATIVE_STEPS.find((s) => {
      if (s.unit === 'week') return abs >= 14 * 86_400_000
      if (s.unit === 'month') return abs >= 60 * 86_400_000
      return abs >= s.ms
    }) ?? RELATIVE_STEPS[RELATIVE_STEPS.length - 1]!
  const n = Math.max(1, Math.floor(abs / step.ms))
  const phrase = `${n} ${step.unit}${n === 1 ? '' : 's'}`
  return diff >= 0 ? `${phrase} ago` : `in ${phrase}`
}

/** 3 Sep, for tight columns */
export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getDate()} ${MONTHS[d.getMonth()] ?? ''}`
}

/** 17:35, local 24h clock */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toTimeString().slice(0, 5)
}

/** status as it reads in the ui */
export function statusLabel(status: string): string {
  return status === 'in_progress' ? 'in progress' : status
}

/**
 * a lane's configured colour as it reads in the current theme: untouched in light, lifted toward
 * the ink in dark, where colours picked for paper would sink into the background
 */
function themed(color: string): string {
  return `color-mix(in srgb, ${color} var(--lane-keep), var(--ink))`
}

/** the css custom properties that tint a row or the detail header for an axis */
export function axisStyle(axis: string | null, config?: BoardConfig): Record<string, string> {
  if (axis && config) {
    const lane = config.lanes.find((l) => l.label === axis)
    if (lane) {
      const color = themed(lane.color)
      return {
        '--axis': color,
        '--fill-row': `color-mix(in srgb, ${color} 14%, transparent)`,
      }
    }
  }
  return { '--axis': 'var(--none)', '--fill-row': 'var(--none-fill)' }
}

/** the mono glyph that marks a lane, so lanes read without colour */
export function laneGlyph(axis: string | null, config?: BoardConfig): string {
  if (axis && config) {
    const lane = config.lanes.find((l) => l.label === axis)
    if (lane) return lane.glyph
  }
  return '\u00b7'
}

/** the color configured for a lane, as a css value that follows the theme */
export function laneColor(axis: string | null, config?: BoardConfig): string | undefined {
  if (axis && config) {
    const lane = config.lanes.find((l) => l.label === axis)
    if (lane) return themed(lane.color)
  }
  return undefined
}

/** lowercase with diacritics stripped, one utf-16 unit per unit, matching the server's search fold */
export function fold(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!
    const base = ch.normalize('NFD')[0] ?? ch
    out += base.toLowerCase()[0] ?? ch
  }
  return out
}

/** splits text into plain and matched runs for the search terms */
export function highlightRuns(text: string, terms: string[]): { text: string; hit: boolean }[] {
  const folded = fold(text)
  const marks = new Array<boolean>(text.length).fill(false)
  for (const term of terms) {
    if (!term) continue
    let at = folded.indexOf(term)
    while (at >= 0) {
      marks.fill(true, at, at + term.length)
      // step one unit so overlapping occurrences (ana in banana) are all marked
      at = folded.indexOf(term, at + 1)
    }
  }
  const runs: { text: string; hit: boolean }[] = []
  for (let i = 0; i < text.length; i += 1) {
    const last = runs[runs.length - 1]
    if (last && last.hit === marks[i]) last.text += text[i]
    else runs.push({ text: text[i]!, hit: marks[i]! })
  }
  return runs
}
