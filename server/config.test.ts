import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILTIN_PALETTE, ConfigError, loadConfig, resolveConfig } from './config'

// a config using every key, shaped like a real board with lanes, flags and a drawer
const FULL_CONFIG = {
  agentsview: 'http://127.0.0.1:8080',
  notesDir: 'docs/notes',
  lanes: [
    {
      label: 'product',
      note: 'customer-facing features',
      glyph: '*',
      color: '#a06a2c'
    },
    {
      label: 'bugs',
      note: 'defects and regressions',
      glyph: '!',
      color: '#2f6a60'
    },
    {
      label: 'infra',
      note: 'tooling, tests and maintenance',
      glyph: '#',
      color: '#47598a'
    },
    {
      label: 'docs',
      note: 'written for readers',
      glyph: '~',
      color: '#8b4a68'
    },
    {
      label: 'chores',
      note: 'small upkeep',
      glyph: '+',
      color: '#6b7040'
    }
  ],
  unlaned: {
    title: 'no lane',
    note: 'no lane label yet'
  },
  subLabels: [
    'frontend',
    'backend'
  ],
  waiting: {
    labels: [
      'needs-human',
      'discuss'
    ],
    title: 'waiting on you',
    note: 'a decision only you can give'
  },
  note: {
    addLabel: 'human-note',
    offerToClear: [
      'needs-human'
    ]
  },
  thoughts: {
    label: 'idea',
    title: 'ideas',
    note: 'not counted as backlog'
  },
  flags: [
    'blocked-external'
  ],
  capture: {
    labels: [
      'idea',
      'chores'
    ]
  }
}

describe('human identity config', () => {
  it('resolves id and name, defaulting the name from the id', () => {
    expect(resolveConfig({ human: { id: 'human:mike', name: 'Mike' } }).human).toEqual({ id: 'human:mike', name: 'Mike' })
    expect(resolveConfig({ human: { id: 'human:mike' } }).human).toEqual({ id: 'human:mike', name: 'mike' })
  })

  it('rejects ids that would read as an agent, a flag or nothing', () => {
    expect(() => resolveConfig({ human: { id: 'agent:claude' } })).toThrow(/human.id/)
    expect(() => resolveConfig({ human: { id: '-x' } })).toThrow(/human.id/)
    expect(() => resolveConfig({ human: { id: 'two words' } })).toThrow(/human.id/)
  })
})

describe('resolveConfig defaults', () => {
  it('returns all defaults when given empty object or null', () => {
    const config = resolveConfig({})
    expect(config.human).toBeNull()
    expect(config.agentsview).toBeNull()
    expect(config.notesDir).toBeNull()
    expect(config.lanes).toEqual([])
    expect(config.unlaned).toEqual({ title: 'open', note: null })
    expect(config.subLabels).toEqual([])
    expect(config.waiting).toEqual({ labels: [], title: 'waiting on you', note: null })
    expect(config.note).toEqual({ addLabel: null, offerToClear: [] })
    expect(config.thoughts).toBeNull()
    expect(config.flags).toEqual([])
    expect(config.capture).toEqual({ labels: [] })
    expect(config.derived.allFlags).toEqual([])
    expect(config.derived.hotChips).toEqual([])
  })

  it('sets unlaned title to "no lane" when lanes are present', () => {
    const config = resolveConfig({
      lanes: [{ label: 'p1' }],
    })
    expect(config.unlaned.title).toBe('no lane')
  })
})

describe('full config', () => {
  it('parses and resolves every key', () => {
    const config = resolveConfig(FULL_CONFIG)

    expect(config.agentsview).toBe('http://127.0.0.1:8080')
    expect(config.notesDir).toBe('docs/notes')
    expect(config.lanes).toHaveLength(5)
    expect(config.lanes[0]?.color).toBe('#a06a2c')
    expect(config.lanes[0]?.glyph).toBe('*')
    expect(config.unlaned).toEqual({ title: 'no lane', note: 'no lane label yet' })
    expect(config.subLabels).toEqual(['frontend', 'backend'])
    expect(config.waiting.labels).toHaveLength(2)
    expect(config.note.addLabel).toBeTruthy()
    expect(config.note.offerToClear).toHaveLength(1)
    expect(config.thoughts?.title).toBe('ideas')
    expect(config.flags).toEqual(['blocked-external'])
    expect(config.capture.labels).toHaveLength(2)

    // derived sets
    expect(config.derived.hotChips).toEqual(['human-note', 'needs-human'])
    expect(config.derived.allFlags).toEqual(
      expect.arrayContaining([...config.waiting.labels, ...config.flags]),
    )
  })
})

describe('palette assignment', () => {
  it('cycles through palette when lane colors are omitted', () => {
    const lanes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => ({ label: `lane-${i}` }))
    const config = resolveConfig({ lanes })

    for (let i = 0; i < lanes.length; i++) {
      expect(config.lanes[i]?.color).toBe(BUILTIN_PALETTE[i % BUILTIN_PALETTE.length])
      expect(config.lanes[i]?.glyph).toBe('\u00b7')
    }
  })

  it('preserves explicitly defined lane colors', () => {
    const config = resolveConfig({
      lanes: [{ label: 'custom', color: '#123456', glyph: '*' }],
    })
    expect(config.lanes[0]?.color).toBe('#123456')
    expect(config.lanes[0]?.glyph).toBe('*')
  })
})

describe('validation errors', () => {
  it('rejects non-object config', () => {
    expect(() => resolveConfig('string')).toThrow(ConfigError)
    expect(() => resolveConfig([])).toThrow(ConfigError)
  })

  it('rejects invalid lanes shape and names the bad field', () => {
    expect(() => resolveConfig({ lanes: 'not-array' })).toThrowError(/lanes must be an array/)
    expect(() => resolveConfig({ lanes: [{ label: '' }] })).toThrowError(/lanes\[0\]\.label/)
    expect(() => resolveConfig({ lanes: [{ label: 'has space' }] })).toThrowError(/lanes\[0\]\.label/)
  })

  it('rejects invalid subLabels and names the bad field', () => {
    expect(() => resolveConfig({ subLabels: 'invalid' })).toThrowError(/subLabels must be an array/)
    expect(() => resolveConfig({ subLabels: ['valid', 'has space'] })).toThrowError(/subLabels\[1\]/)
  })

  it('rejects invalid waiting shape and names the bad field', () => {
    expect(() => resolveConfig({ waiting: 'invalid' })).toThrowError(/waiting must be an object/)
    expect(() => resolveConfig({ waiting: { labels: ['with space'] } })).toThrowError(
      /waiting\.labels\[0\]/,
    )
  })

  it('rejects invalid note shape and names the bad field', () => {
    expect(() => resolveConfig({ note: 'invalid' })).toThrowError(/note must be an object/)
    expect(() => resolveConfig({ note: { addLabel: 'with space' } })).toThrowError(/note\.addLabel/)
    expect(() => resolveConfig({ note: { offerToClear: ['invalid label'] } })).toThrowError(
      /note\.offerToClear\[0\]/,
    )
  })

  it('rejects invalid thoughts shape and names the bad field', () => {
    expect(() => resolveConfig({ thoughts: 'invalid' })).toThrowError(/thoughts must be an object/)
    expect(() => resolveConfig({ thoughts: { label: 'with space' } })).toThrowError(
      /thoughts\.label/,
    )
  })

  it('rejects invalid flags and capture shape', () => {
    expect(() => resolveConfig({ flags: ['with space'] })).toThrowError(/flags\[0\]/)
    expect(() => resolveConfig({ capture: { labels: ['with space'] } })).toThrowError(
      /capture\.labels\[0\]/,
    )
  })
})

describe('loadConfig', () => {
  let tmpDir: string

  it('returns defaults when file does not exist', () => {
    const config = loadConfig('/tmp/nonexistent-repo-path-xyz')
    expect(config.lanes).toEqual([])
  })

  it('loads and parses file when present', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'bd-cfg-test-'))
    const cfgPath = join(tmpDir, '.beadside.json')
    await writeFile(cfgPath, JSON.stringify({ lanes: [{ label: 'test-lane' }] }))

    const config = loadConfig(tmpDir)
    expect(config.lanes).toHaveLength(1)
    expect(config.lanes[0]?.label).toBe('test-lane')

    await rm(tmpDir, { recursive: true, force: true })
  })

  it('falls back to the pre-rename .bd-board.json, and prefers .beadside.json when both exist', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'bd-cfg-test-'))
    await writeFile(join(tmpDir, '.bd-board.json'), JSON.stringify({ lanes: [{ label: 'old-lane' }] }))
    expect(loadConfig(tmpDir).lanes[0]?.label).toBe('old-lane')

    await writeFile(join(tmpDir, '.beadside.json'), JSON.stringify({ lanes: [{ label: 'new-lane' }] }))
    expect(loadConfig(tmpDir).lanes[0]?.label).toBe('new-lane')

    await rm(tmpDir, { recursive: true, force: true })
  })

  it('throws ConfigError on invalid json', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'bd-cfg-test-'))
    const cfgPath = join(tmpDir, '.beadside.json')
    await writeFile(cfgPath, '{ invalid json')

    expect(() => loadConfig(tmpDir)).toThrowError(/invalid JSON in config file/)

    await rm(tmpDir, { recursive: true, force: true })
  })

  it('throws ConfigError if explicit config file is missing', () => {
    expect(() => loadConfig('/tmp', '/tmp/nonexistent-file.json')).toThrowError(
      /config file not found/,
    )
  })
})
