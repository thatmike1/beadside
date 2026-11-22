import { describe, expect, it } from 'vitest'
import type { Comment, Issue, IssueWithComments } from './bd'
import { excerptAround, parseQuery, searchIssues } from './search'

const human = { id: 'human:mike', name: 'Mike' }

function entry(id: string, fields: Partial<Issue> = {}, comments: Partial<Comment>[] = []): IssueWithComments {
  return {
    issue: {
      id,
      title: 'untitled',
      description: '',
      status: 'open',
      priority: 2,
      issue_type: 'task',
      labels: [],
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
      comment_count: comments.length,
      dependency_count: 0,
      dependent_count: 0,
      ...fields,
    },
    comments: comments.map((c, i) => ({
      id: `c${i}`,
      issue_id: id,
      author: 'agent:codex',
      text: '',
      created_at: '2026-09-02T00:00:00Z',
      ...c,
    })),
  }
}

const corpus = [
  entry('repo-a1', { title: 'Search board for words', description: 'unrelated lead text' }),
  entry('repo-b2', { title: 'Other', description: 'we need to search board contents somewhere' }),
  entry('repo-c3', { title: 'Notes only', notes: 'the cooler swap happens monday' }),
  entry('repo-d4', { title: 'Buried', status: 'closed' }, [{ text: 'first' }, { text: 'image attachments were discussed', author: 'human:mike' }]),
  entry('repo-e5', { title: 'Parked idea', status: 'deferred', description: 'Česká pošta letters' }),
  entry('repo-e5.1', { title: 'child of e5' }),
]

describe('parseQuery', () => {
  it('folds case and diacritics and keeps quoted phrases whole', () => {
    expect(parseQuery('Pošta "Cooler  Swap" pošta')).toEqual(['posta', 'cooler swap'])
  })
})

describe('searchIssues', () => {
  it('ranks a title match above a description-only match', () => {
    const { hits } = searchIssues(corpus, 'search board', { human })
    expect(hits.map((h) => h.id)).toEqual(['repo-a1', 'repo-b2'])
    expect(hits[0]!.field).toBe('title')
    expect(hits[0]!.excerpt).toBe('unrelated lead text')
    expect(hits[1]!.field).toBe('description')
    expect(hits[1]!.excerpt).toContain('search board contents')
  })

  it('finds a phrase that lives only in notes', () => {
    const { hits } = searchIssues(corpus, 'cooler swap', { human })
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ id: 'repo-c3', field: 'notes' })
  })

  it('points a comment hit at the comment with its author', () => {
    const { hits } = searchIssues(corpus, 'attachments', { human })
    expect(hits[0]).toMatchObject({ id: 'repo-d4', field: 'comment', status: 'closed' })
    expect(hits[0]!.comment).toMatchObject({ id: 'c1', author: 'human:mike', by: { kind: 'human', self: true } })
  })

  it('puts an exact short id first', () => {
    const { hits } = searchIssues(corpus, 'e5', { human })
    expect(hits[0]).toMatchObject({ id: 'repo-e5', field: 'id', score: 1000 })
    expect(hits.map((h) => h.id)).toContain('repo-e5.1')
  })

  it('matches without diacritics and honours scope', () => {
    expect(searchIssues(corpus, 'ceska posta', { human }).hits.map((h) => h.id)).toEqual(['repo-e5'])
    expect(searchIssues(corpus, 'attachments', { human, scope: 'open' }).hits).toEqual([])
    expect(searchIssues(corpus, 'attachments', { human, scope: 'closed' }).hits).toHaveLength(1)
    expect(searchIssues(corpus, 'parked', { human, scope: 'open' }).hits).toHaveLength(1)
  })

  it('requires every term somewhere in the issue', () => {
    expect(searchIssues(corpus, 'cooler attachments', { human }).hits).toEqual([])
    const spread = searchIssues(corpus, 'buried first', { human }).hits
    expect(spread[0]).toMatchObject({ id: 'repo-d4', fields: ['title', 'comment'] })
  })

  it('returns nothing for an empty query and applies the limit after counting', () => {
    expect(searchIssues(corpus, '   ', { human })).toMatchObject({ total: 0, hits: [] })
    const limited = searchIssues(corpus, 'repo', { human, limit: 2 })
    expect(limited.total).toBe(6)
    expect(limited.hits).toHaveLength(2)
  })
})

describe('label matches', () => {
  const tagged = [
    entry('repo-l1', { title: 'Detekce dopravních značek', labels: ['znacky', 'needs-human'], description: 'lead' }),
    entry('repo-l2', { title: 'LiDAR', labels: ['lokalizace'], description: 'mentions znacky in passing' }),
    entry('repo-l3', { title: 'Značky v Brně', labels: ['detekce'] }),
  ]

  it('finds a bead by its label and leads with the description', () => {
    const { hits } = searchIssues(tagged, 'needs-human', { human })
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ id: 'repo-l1', field: 'label', excerpt: 'lead', fields: ['label'] })
  })

  it('ranks a label above a body mention and below a title', () => {
    const { hits } = searchIssues(tagged, 'znacky', { human })
    expect(hits.map((h) => h.id)).toEqual(['repo-l3', 'repo-l1', 'repo-l2'])
    expect(hits[0]).toMatchObject({ field: 'title' })
    expect(hits[1]).toMatchObject({ field: 'label', fields: ['label'] })
    expect(hits[2]).toMatchObject({ field: 'description' })
  })

  it('lets a term in a label and a term in the title match together, accents ignored', () => {
    expect(searchIssues(tagged, 'brne DETEKCE', { human }).hits.map((h) => h.id)).toEqual(['repo-l3'])
    expect(searchIssues(tagged, 'lidar lokalizace', { human }).hits.map((h) => h.id)).toEqual(['repo-l2'])
  })
})

describe('excerptAround', () => {
  it('cuts around the match on word boundaries with ellipses', () => {
    const text = `${'lead '.repeat(40)}the needle is here ${'tail '.repeat(60)}`
    const excerpt = excerptAround(text, ['needle'], 'needle')
    expect(excerpt.startsWith('…')).toBe(true)
    expect(excerpt.endsWith('…')).toBe(true)
    expect(excerpt).toContain('the needle is here')
  })
})
