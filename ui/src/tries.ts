// checks only the human can make (tryIt in .beadside.json): the kit an agent stored on a bead
// labelled ready to try, read from the issue's metadata as the list carries it. the same lenient
// reading as server/tries.ts

import qrcode from 'qrcode-generator'
import type { BoardConfig, Issue } from './api'

export type Verdict = 'works' | 'broken' | 'cant'

export type KitItem =
  | { type: 'spec'; label: string; value: string }
  | { type: 'copy'; label: string; text: string }
  | { type: 'link'; label: string; href: string }
  | { type: 'path'; label: string; path: string; href: string | null }
  | { type: 'qr'; label: string; text: string }
  | { type: 'image'; src: string; alt: string }

export interface TryStep {
  id: string
  title: string
  note: string | null
}

export interface TryLast {
  result: Verdict
  at: string
  note: string | null
}

export interface TryKit {
  title: string
  app: string | null
  where: string | null
  why: string | null
  verified: string | null
  expect: string | null
  shipped: string | null
  minutes: number | null
  kit: KitItem[]
  steps: TryStep[]
  last: TryLast | null
}

const VERDICTS: readonly string[] = ['works', 'broken', 'cant']

const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null)

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function kitItem(value: unknown): KitItem | null {
  const r = record(value)
  if (!r) return null
  const label = str(r['label'])
  if (r['type'] === 'spec') {
    const v = str(r['value'])
    return label && v ? { type: 'spec', label, value: v } : null
  }
  if (r['type'] === 'copy' || r['type'] === 'qr') {
    const text = str(r['text'])
    return text ? { type: r['type'], label: label ?? text, text } : null
  }
  if (r['type'] === 'link') {
    const href = str(r['href'])
    return href ? { type: 'link', label: label ?? href, href } : null
  }
  if (r['type'] === 'path') {
    const path = str(r['path'])
    return path ? { type: 'path', label: label ?? path, path, href: str(r['href']) } : null
  }
  if (r['type'] === 'image') {
    const src = str(r['src'])
    return src ? { type: 'image', src, alt: str(r['alt']) ?? '' } : null
  }
  return null
}

/** the kit stored under `key`, or null when there is none the board can read */
export function parseTry(metadata: unknown, key: string): TryKit | null {
  const meta = record(metadata)
  const r = meta ? record(meta[key]) : null
  if (!r) return null
  const title = str(r['title'])
  if (!title) return null
  const steps: TryStep[] = []
  ;(Array.isArray(r['steps']) ? r['steps'] : []).forEach((item, i) => {
    if (typeof item === 'string' && item.trim()) {
      steps.push({ id: String(i + 1), title: item.trim(), note: null })
      return
    }
    const s = record(item)
    const stepTitle = s ? str(s['title']) : null
    if (s && stepTitle) steps.push({ id: str(s['id']) ?? String(i + 1), title: stepTitle, note: str(s['note']) })
  })
  const l = record(r['last'])
  const lastAt = l ? str(l['at']) : null
  const result = l?.['result']
  const minutes = r['minutes']
  return {
    title,
    app: str(r['app']),
    where: str(r['where']),
    why: str(r['why']),
    verified: str(r['verified']),
    expect: str(r['expect']),
    shipped: str(r['shipped']),
    minutes: typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0 ? minutes : null,
    kit: (Array.isArray(r['kit']) ? r['kit'] : []).map(kitItem).filter((k): k is KitItem => k !== null),
    steps,
    last:
      l && lastAt && typeof result === 'string' && VERDICTS.includes(result)
        ? { result: result as Verdict, at: lastAt, note: str(l['note']) }
        : null,
  }
}

/** true when try-it is on and the open bead carries its label */
export function isReadyToTry(issue: Issue, config: BoardConfig): boolean {
  return !!config.tryIt && issue.status !== 'closed' && issue.labels.includes(config.tryIt.label)
}

/** the bead's check when it is ready to try; null otherwise, or when it carries the label with no readable kit */
export function tryOf(issue: Issue, config: BoardConfig): TryKit | null {
  if (!config.tryIt || !isReadyToTry(issue, config)) return null
  return parseTry(issue.metadata, config.tryIt.key)
}

export interface TryGroup {
  /** the app name, or null for checks that name none */
  app: string | null
  issues: Issue[]
}

/** every bead ready to try, grouped by `try.app` (alphabetical, unnamed last), titles sorted within */
export function readyToTry(issues: Issue[], config: BoardConfig): TryGroup[] {
  if (!config.tryIt) return []
  const key = config.tryIt.key
  const groups = new Map<string | null, { issue: Issue; title: string }[]>()
  for (const issue of issues) {
    if (!isReadyToTry(issue, config)) continue
    const kit = parseTry(issue.metadata, key)
    const app = kit?.app ?? null
    const list = groups.get(app) ?? []
    list.push({ issue, title: kit?.title ?? issue.title })
    groups.set(app, list)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)))
    .map(([app, list]) => ({
      app,
      issues: list.sort((a, b) => a.title.localeCompare(b.title) || a.issue.id.localeCompare(b.issue.id)).map((x) => x.issue),
    }))
}

/** the short facts beside a check: where it happens, how many minutes */
export function tryMeta(kit: TryKit): string[] {
  const out: string[] = []
  if (kit.where) out.push(kit.where)
  if (kit.minutes) out.push(`${kit.minutes} min`)
  return out
}

/** what the last verdict says, for a check that came back */
export function lastText(last: TryLast): string {
  if (last.result === 'cant') return `you couldn't check it${last.note ? `: ${last.note}` : ''}`
  if (last.result === 'broken') return `you found it still broken${last.note ? `: ${last.note}` : ''}`
  return 'you said it works'
}

/** the qr code's dark cells as one svg path, in cells; size is the side length with the quiet zone */
export function qrPath(text: string, margin = 2): { size: number; d: string } {
  const qr = qrcode(0, 'M')
  // utf-8, so a link with diacritics scans as typed
  qr.addData(String.fromCharCode(...new TextEncoder().encode(text)), 'Byte')
  qr.make()
  const n = qr.getModuleCount()
  let d = ''
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (qr.isDark(row, col)) d += `M${col + margin} ${row + margin}h1v1h-1z`
    }
  }
  return { size: n + margin * 2, d }
}
