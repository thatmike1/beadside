import { describe, expect, it } from 'vitest'
import { agentReply, classifyAuthor, defaultHuman } from './authors'

const mike = { id: 'human:mike', name: 'Mike' }

describe('classifyAuthor', () => {
  it('marks the configured human as self', () => {
    expect(classifyAuthor('human:mike', mike)).toEqual({ kind: 'human', name: 'Mike', self: true })
  })

  it('names agents by provider, with Agent for an unknown provider', () => {
    expect(classifyAuthor('agent:claude', mike)).toEqual({ kind: 'agent', name: 'Claude', self: false })
    expect(classifyAuthor('agent:codex', mike).name).toBe('Codex')
    expect(classifyAuthor('agent:gemini', mike).name).toBe('Gemini')
    expect(classifyAuthor('agent', mike)).toEqual({ kind: 'agent', name: 'Agent', self: false })
    expect(classifyAuthor('agent:cursor', mike).name).toBe('Cursor')
  })

  it('reads a bare provider name as that agent', () => {
    expect(classifyAuthor('Codex', mike)).toEqual({ kind: 'agent', name: 'Codex', self: false })
  })

  it('keeps the shared git username unknown instead of guessing Mike', () => {
    expect(classifyAuthor('michal.psencik', mike)).toEqual({ kind: 'unknown', name: 'michal.psencik', self: false })
  })

  it('reads another human: id as a human who is not self', () => {
    expect(classifyAuthor('human:jindra', mike)).toEqual({ kind: 'human', name: 'Jindra', self: false })
  })

  it('builds a default human from a user name', () => {
    expect(defaultHuman('alice')).toEqual({ id: 'human:alice', name: 'alice' })
  })
})

describe('agentReply', () => {
  const c = (author: string, created_at: string) => ({ author, created_at })

  it('is the newest agent comment after the human\'s latest note', () => {
    const comments = [
      c('human:mike', '2026-10-01T10:00:00Z'),
      c('agent:claude', '2026-10-02T10:00:00Z'),
      c('agent:codex', '2026-10-03T10:00:00Z'),
    ]
    expect(agentReply(comments, mike)).toEqual({ at: '2026-10-03T10:00:00Z', name: 'Codex' })
  })

  it('is null once the human wrote again, or never wrote at all', () => {
    expect(
      agentReply([c('agent:claude', '2026-10-02T10:00:00Z'), c('human:mike', '2026-10-03T10:00:00Z')], mike),
    ).toBeNull()
    expect(agentReply([c('agent:claude', '2026-10-02T10:00:00Z')], mike)).toBeNull()
  })

  it('reads a legacy unknown author as neither a note nor a reply', () => {
    const comments = [c('human:mike', '2026-10-01T10:00:00Z'), c('michal.psencik', '2026-10-05T10:00:00Z')]
    expect(agentReply(comments, mike)).toBeNull()
  })
})
