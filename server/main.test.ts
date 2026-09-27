import { describe, expect, it } from 'vitest'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { resolveConfig } from './config'
import { firstFreePort, formatSearch, parseOptions, parseSearchOptions, repoNameFromId, resolveHuman } from './main'

describe('cli flags', () => {
  it('defaults port and opening the browser, leaving agentsview undefined', () => {
    const options = parseOptions([])
    expect(options.port).toBeUndefined()
    expect(options.agentsview).toBeUndefined()
    expect(options.open).toBe(true)
    expect(options.repo).toBe(process.cwd())
  })

  it('reads every flag from the contract including --config', () => {
    const options = parseOptions([
      '--repo',
      '/tmp',
      '--port',
      '4198',
      '--config',
      '/tmp/custom.json',
      '--agentsview',
      'http://x:1',
      '--no-open',
    ])
    expect(options).toEqual({
      repo: resolve('/tmp'),
      port: 4198,
      config: '/tmp/custom.json',
      agentsview: 'http://x:1',
      open: false,
    })
  })

  it('turns the session join off with --no-agentsview', () => {
    expect(parseOptions(['--no-agentsview']).agentsview).toBeNull()
  })

  it('rejects a port outside the range and an unknown flag', () => {
    expect(() => parseOptions(['--port', '99999'])).toThrow()
    expect(() => parseOptions(['--wat'])).toThrow()
  })
})

describe('port pick', () => {
  it('skips a port that is already taken', async () => {
    const taken = createServer()
    await new Promise<void>((done) => taken.listen(0, '127.0.0.1', done))
    const address = taken.address()
    const port = typeof address === 'object' && address ? address.port : 0
    try {
      expect(await firstFreePort(port, 2)).toBe(port + 1)
      expect(await firstFreePort(port, 1)).toBeNull()
    } finally {
      taken.close()
    }
  })
})

describe('repo name', () => {
  it('is the bd prefix of an exported id', () => {
    expect(repoNameFromId('demo-project-9fz')).toBe('demo-project')
    expect(repoNameFromId('demo-project-zf8.4')).toBe('demo-project')
    expect(repoNameFromId('bd-123')).toBe('bd')
    expect(repoNameFromId('lonely')).toBeNull()
  })
})

describe('human identity', () => {
  it('ignores an inherited agent BEADS_ACTOR', () => {
    const prev = process.env['BEADS_ACTOR']
    try {
      process.env['BEADS_ACTOR'] = 'agent:claude'
      const human = resolveHuman(resolveConfig({}), process.cwd())
      expect(human.id.startsWith('human:')).toBe(true)
      expect(human.id).not.toContain('agent')
    } finally {
      if (prev === undefined) delete process.env['BEADS_ACTOR']
      else process.env['BEADS_ACTOR'] = prev
    }
  })

  it('prefers the configured human', () => {
    const config = resolveConfig({ human: { id: 'human:mike', name: 'Mike' } })
    expect(resolveHuman(config, process.cwd())).toEqual({ id: 'human:mike', name: 'Mike' })
  })
})

describe('search cli', () => {
  it('joins positionals into the query and reads the flags', () => {
    expect(parseSearchOptions(['comment', 'author', '--scope', 'closed', '--json', '--limit', '5', '--repo', '/tmp'])).toEqual({
      repo: resolve('/tmp'),
      config: undefined,
      query: 'comment author',
      scope: 'closed',
      limit: 5,
      json: true,
    })
  })

  it('rejects an empty query and an unknown scope', () => {
    expect(() => parseSearchOptions([])).toThrow(/needs a query/)
    expect(() => parseSearchOptions(['x', '--scope', 'parked'])).toThrow(/scope/)
  })

  it('prints a no-match line', () => {
    expect(formatSearch({ query: 'zzz', scope: 'all', terms: ['zzz'], total: 0, hits: [] })).toBe(
      'no issues match "zzz" (scope all)',
    )
  })
})
