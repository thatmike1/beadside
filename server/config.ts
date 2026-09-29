// types, defaults, validation and loader for .beadside.json (.bd-board.json, the pre-rename name, still loads)
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { HumanIdentity } from './authors'
import { assertLabel, BdError } from './bd'

export interface LaneConfig {
  label: string
  note?: string | null
  glyph?: string | null
  color?: string | null
}

export interface ResolvedLaneConfig {
  label: string
  note: string | null
  glyph: string
  color: string
}

export interface UnlanedConfig {
  title?: string | null
  note?: string | null
}

export interface ResolvedUnlanedConfig {
  title: string
  note: string | null
}

export interface WaitingConfig {
  labels?: string[]
  title?: string | null
  note?: string | null
}

export interface ResolvedWaitingConfig {
  labels: string[]
  title: string
  note: string | null
}

export interface NoteConfig {
  addLabel?: string | null
  offerToClear?: string[]
}

export interface ResolvedNoteConfig {
  addLabel: string | null
  offerToClear: string[]
}

export interface ThoughtsConfig {
  label: string
  title?: string | null
  note?: string | null
}

export interface ResolvedThoughtsConfig {
  label: string
  title: string
  note: string | null
}

export interface CaptureConfig {
  labels?: string[]
}

export interface ResolvedCaptureConfig {
  labels: string[]
}

export interface ResolvedDerivedConfig {
  allFlags: string[]
  hotChips: string[]
}

export interface HumanConfig {
  id: string
  name?: string | null
}

export interface BoardConfig {
  human?: HumanConfig | null
  agentsview?: string | null
  notesDir?: string | null
  lanes?: LaneConfig[]
  unlaned?: UnlanedConfig
  subLabels?: string[]
  waiting?: WaitingConfig
  note?: NoteConfig
  thoughts?: ThoughtsConfig
  flags?: string[]
  capture?: CaptureConfig
}

export interface ResolvedBoardConfig {
  /** null means main.ts falls back to `human:<git user.name>` */
  human: HumanIdentity | null
  agentsview: string | null
  notesDir: string | null
  lanes: ResolvedLaneConfig[]
  unlaned: ResolvedUnlanedConfig
  subLabels: string[]
  waiting: ResolvedWaitingConfig
  note: ResolvedNoteConfig
  thoughts: ResolvedThoughtsConfig | null
  flags: string[]
  capture: ResolvedCaptureConfig
  derived: ResolvedDerivedConfig
}

export class ConfigError extends Error {
  readonly field?: string
  constructor(message: string, field?: string) {
    super(message)
    this.name = 'ConfigError'
    this.field = field
  }
}

export const BUILTIN_PALETTE: readonly string[] = [
  '#a06a2c',
  '#2f6a60',
  '#47598a',
  '#8b4a68',
  '#6b7040',
  '#8c5e58',
  '#556b82',
  '#7a627a',
]

function validateString(val: unknown, field: string): string {
  if (typeof val !== 'string') throw new ConfigError(`${field} must be a string`, field)
  return val
}

function validateOptionalString(val: unknown, field: string): string | null {
  if (val === undefined || val === null) return null
  if (typeof val !== 'string') throw new ConfigError(`${field} must be a string`, field)
  return val
}

function validateLabel(val: unknown, field: string): string {
  try {
    return assertLabel(val)
  } catch (err) {
    const msg = err instanceof BdError ? err.message : String(err)
    throw new ConfigError(`${field}: ${msg}`, field)
  }
}

function validateLabelArray(val: unknown, field: string): string[] {
  if (val === undefined || val === null) return []
  if (!Array.isArray(val)) throw new ConfigError(`${field} must be an array`, field)
  return val.map((item, i) => {
    try {
      return assertLabel(item)
    } catch (err) {
      const msg = err instanceof BdError ? err.message : String(err)
      throw new ConfigError(`${field}[${i}]: ${msg}`, `${field}[${i}]`)
    }
  })
}

/** validates and resolves a raw config object against schema and defaults */
export function resolveConfig(raw: unknown): ResolvedBoardConfig {
  if (raw === undefined || raw === null) raw = {}
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ConfigError('config must be an object', 'config')
  }
  const obj = raw as Record<string, unknown>

  let human: HumanIdentity | null = null
  if (obj['human'] !== undefined && obj['human'] !== null) {
    if (typeof obj['human'] !== 'object' || Array.isArray(obj['human'])) {
      throw new ConfigError('human must be an object', 'human')
    }
    const h = obj['human'] as Record<string, unknown>
    const id = validateString(h['id'], 'human.id').trim()
    // stored as the bd comment author: an agent-looking or flag-looking id would misread
    if (!id || id.length > 128 || /\s/.test(id) || id.startsWith('-') || /^agent(:|$)/i.test(id)) {
      throw new ConfigError('human.id must be 1-128 characters, no whitespace, not starting with - or agent', 'human.id')
    }
    const name = validateOptionalString(h['name'], 'human.name')?.trim() || id.replace(/^human:/i, '')
    human = { id, name }
  }

  const agentsview = validateOptionalString(obj['agentsview'], 'agentsview')
  const notesDir = validateOptionalString(obj['notesDir'], 'notesDir')

  let lanes: ResolvedLaneConfig[] = []
  if (obj['lanes'] !== undefined && obj['lanes'] !== null) {
    if (!Array.isArray(obj['lanes'])) {
      throw new ConfigError('lanes must be an array', 'lanes')
    }
    lanes = obj['lanes'].map((lane, i): ResolvedLaneConfig => {
      if (!lane || typeof lane !== 'object' || Array.isArray(lane)) {
        throw new ConfigError(`lanes[${i}] must be an object`, `lanes[${i}]`)
      }
      const l = lane as Record<string, unknown>
      const label = validateLabel(l['label'], `lanes[${i}].label`)
      const note = validateOptionalString(l['note'], `lanes[${i}].note`)
      const glyph =
        l['glyph'] !== undefined && l['glyph'] !== null
          ? validateString(l['glyph'], `lanes[${i}].glyph`)
          : '\u00b7'
      const color =
        l['color'] !== undefined && l['color'] !== null
          ? validateString(l['color'], `lanes[${i}].color`)
          : BUILTIN_PALETTE[i % BUILTIN_PALETTE.length]!

      return { label, note, glyph, color }
    })
  }

  let unlaned: ResolvedUnlanedConfig
  if (obj['unlaned'] !== undefined && obj['unlaned'] !== null) {
    if (typeof obj['unlaned'] !== 'object' || Array.isArray(obj['unlaned'])) {
      throw new ConfigError('unlaned must be an object', 'unlaned')
    }
    const u = obj['unlaned'] as Record<string, unknown>
    const defaultTitle = lanes.length === 0 ? 'open' : 'no lane'
    const title =
      u['title'] !== undefined && u['title'] !== null
        ? validateString(u['title'], 'unlaned.title')
        : defaultTitle
    const note = validateOptionalString(u['note'], 'unlaned.note')
    unlaned = { title, note }
  } else {
    unlaned = {
      title: lanes.length === 0 ? 'open' : 'no lane',
      note: null,
    }
  }

  const subLabels = validateLabelArray(obj['subLabels'], 'subLabels')

  let waiting: ResolvedWaitingConfig
  if (obj['waiting'] !== undefined && obj['waiting'] !== null) {
    if (typeof obj['waiting'] !== 'object' || Array.isArray(obj['waiting'])) {
      throw new ConfigError('waiting must be an object', 'waiting')
    }
    const w = obj['waiting'] as Record<string, unknown>
    const labels = validateLabelArray(w['labels'], 'waiting.labels')
    const title =
      w['title'] !== undefined && w['title'] !== null
        ? validateString(w['title'], 'waiting.title')
        : 'waiting on you'
    const note = validateOptionalString(w['note'], 'waiting.note')
    waiting = { labels, title, note }
  } else {
    waiting = { labels: [], title: 'waiting on you', note: null }
  }

  let noteConfig: ResolvedNoteConfig
  if (obj['note'] !== undefined && obj['note'] !== null) {
    if (typeof obj['note'] !== 'object' || Array.isArray(obj['note'])) {
      throw new ConfigError('note must be an object', 'note')
    }
    const n = obj['note'] as Record<string, unknown>
    const addLabel =
      n['addLabel'] !== undefined && n['addLabel'] !== null
        ? validateLabel(n['addLabel'], 'note.addLabel')
        : null
    const offerToClear = validateLabelArray(n['offerToClear'], 'note.offerToClear')
    noteConfig = { addLabel, offerToClear }
  } else {
    noteConfig = { addLabel: null, offerToClear: [] }
  }

  let thoughts: ResolvedThoughtsConfig | null = null
  if (obj['thoughts'] !== undefined && obj['thoughts'] !== null) {
    if (typeof obj['thoughts'] !== 'object' || Array.isArray(obj['thoughts'])) {
      throw new ConfigError('thoughts must be an object', 'thoughts')
    }
    const t = obj['thoughts'] as Record<string, unknown>
    const label = validateLabel(t['label'], 'thoughts.label')
    const title =
      t['title'] !== undefined && t['title'] !== null
        ? validateString(t['title'], 'thoughts.title')
        : 'thoughts'
    const note = validateOptionalString(t['note'], 'thoughts.note')
    thoughts = { label, title, note }
  }

  const flags = validateLabelArray(obj['flags'], 'flags')

  let capture: ResolvedCaptureConfig
  if (obj['capture'] !== undefined && obj['capture'] !== null) {
    if (typeof obj['capture'] !== 'object' || Array.isArray(obj['capture'])) {
      throw new ConfigError('capture must be an object', 'capture')
    }
    const c = obj['capture'] as Record<string, unknown>
    const labels = validateLabelArray(c['labels'], 'capture.labels')
    capture = { labels }
  } else {
    capture = { labels: [] }
  }

  const allFlagsSet = new Set<string>([
    ...waiting.labels,
    ...(noteConfig.addLabel ? [noteConfig.addLabel] : []),
    ...noteConfig.offerToClear,
    ...(thoughts ? [thoughts.label] : []),
    ...flags,
  ])
  // hot chips are the labels the note box writes or offers to clear
  const hotChipsSet = new Set<string>([
    ...(noteConfig.addLabel ? [noteConfig.addLabel] : []),
    ...noteConfig.offerToClear,
  ])

  const derived: ResolvedDerivedConfig = {
    allFlags: Array.from(allFlagsSet),
    hotChips: Array.from(hotChipsSet),
  }

  return {
    human,
    agentsview,
    notesDir,
    lanes,
    unlaned,
    subLabels,
    waiting,
    note: noteConfig,
    thoughts,
    flags,
    capture,
    derived,
  }
}

/** config file names looked up in the repo root, in order; `.bd-board.json` is the name from before the rename */
export const CONFIG_NAMES = ['.beadside.json', '.bd-board.json'] as const

/** the config path to read in `repoPath`: the first name that exists, else the current name */
export function configPath(repoPath: string): string {
  for (const name of CONFIG_NAMES) {
    const candidate = join(repoPath, name)
    if (existsSync(candidate)) return candidate
  }
  return join(repoPath, CONFIG_NAMES[0])
}

/** loads and resolves .beadside.json (or the older .bd-board.json) from the repo, or an explicit path */
export function loadConfig(repoPath: string, explicitPath?: string): ResolvedBoardConfig {
  const filePath = explicitPath ? resolve(explicitPath) : configPath(repoPath)
  if (!existsSync(filePath)) {
    if (explicitPath) {
      throw new ConfigError(`config file not found: ${explicitPath}`, 'config')
    }
    return resolveConfig({})
  }

  let text: string
  try {
    text = readFileSync(filePath, 'utf8')
  } catch (err) {
    throw new ConfigError(
      `could not read config file: ${err instanceof Error ? err.message : String(err)}`,
      'config',
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new ConfigError(
      `invalid JSON in config file: ${err instanceof Error ? err.message : String(err)}`,
      'config',
    )
  }

  return resolveConfig(parsed)
}
