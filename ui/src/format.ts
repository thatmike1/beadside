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

/** 3 Sep, for tight columns */
export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getDate()} ${MONTHS[d.getMonth()] ?? ''}`
}

/** clock time on the day the list was fetched */
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
      at = folded.indexOf(term, at + term.length)
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
