// serves docs/api.md-shaped responses from scripts/demo for ui development without bd
// usage: npm run mock [-- port]   (default 1338; runs through tsx for the shared config loader)
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { classifyAuthor } from '../server/authors.ts'
import { resolveConfig } from '../server/config.ts'
import { searchIssues } from '../server/search.ts'

const here = dirname(fileURLToPath(import.meta.url))
const issues = JSON.parse(readFileSync(join(here, 'demo/beads.json'), 'utf8'))
const config = resolveConfig(JSON.parse(readFileSync(join(here, 'demo/beadside.json'), 'utf8')))

const comments = {
  'demo-wait-1': [
    {
      id: 'c-wait-1',
      issue_id: 'demo-wait-1',
      author: 'alice',
      text: 'Need decision on whether we want to support bring-your-own-cert or ACME only.',
      created_at: '2026-09-08T12:00:00Z',
    },
  ],
  'demo-note-1': [
    {
      id: 'c-note-1',
      issue_id: 'demo-note-1',
      author: 'agent:claude',
      text: 'Stripe retries on 500 errors but we need to guard against concurrent handling.',
      created_at: '2026-09-10T10:00:00Z',
    },
    {
      id: 'c-note-2',
      issue_id: 'demo-note-1',
      author: 'human:demo',
      text: 'Verified Redis SETNX idempotency pattern works well here.',
      created_at: '2026-09-12T16:00:00Z',
    },
  ],
}

const human = { id: 'human:demo', name: 'Demo' }
const withBy = (list) => (list ?? []).map((c) => ({ ...c, by: classifyAuthor(c.author, human) }))

const createdHere = new Set()
const port = Number(process.argv[2] ?? 1338)
const token = 'mock-token'

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

const body = (req) =>
  new Promise((ok) => {
    let s = ''
    req.on('data', (c) => (s += c))
    req.on('end', () => ok(s ? JSON.parse(s) : {}))
  })

const find = (id) => issues.find((i) => i.id === id)

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const m = url.pathname.match(/^\/api\/issues\/([^/]+)(?:\/(comment|status|priority|labels))?$/)

  if (req.method === 'GET' && url.pathname === '/api/session') {
    return json(res, 200, {
      token,
      repo: { name: 'demo', path: '/demo' },
      agentsview: config.agentsview,
      me: human.id,
      human,
      config: { ...config, human },
    })
  }

  if (req.method === 'GET' && url.pathname === '/api/issues') {
    return json(res, 200, { issues, fetchedAt: new Date().toISOString() })
  }

  if (req.method === 'GET' && url.pathname === '/api/search') {
    const corpus = issues.map((issue) => ({ issue, comments: comments[issue.id] ?? [] }))
    const scope = url.searchParams.get('scope') ?? 'all'
    return json(res, 200, searchIssues(corpus, url.searchParams.get('q') ?? '', { scope, human }))
  }

  if (req.method === 'GET' && url.pathname === '/api/issue-ids') {
    return json(res, 200, { ids: issues.map((i) => i.id) })
  }

  if (req.method === 'GET' && m && !m[2]) {
    const issue = find(m[1])
    if (!issue) return json(res, 404, { error: 'not found' })
    return json(res, 200, {
      issue,
      comments: withBy(comments[m[1]]),
      sessions: null,
      notes: [],
    })
  }

  if (req.method === 'DELETE' && m && !m[2]) {
    if (req.headers['x-bd-token'] !== token) return json(res, 403, { error: 'bad token' })
    const id = m[1]
    if (!createdHere.has(id)) return json(res, 403, { error: 'only created here can be deleted' })
    const idx = issues.findIndex((i) => i.id === id)
    if (idx >= 0) issues.splice(idx, 1)
    createdHere.delete(id)
    return json(res, 200, { deleted: id })
  }

  if (req.method === 'POST') {
    if (req.headers['x-bd-token'] !== token) return json(res, 403, { error: 'bad token' })
    const b = await body(req)

    if (url.pathname === '/api/issues') {
      const issue = {
        id: 'demo-' + Math.random().toString(36).slice(2, 6),
        title: b.title,
        description: '',
        status: 'open',
        priority: 2,
        issue_type: 'task',
        labels: b.labels?.length ? b.labels : [...config.capture.labels],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        comment_count: 0,
        dependency_count: 0,
        dependent_count: 0,
      }
      issues.push(issue)
      createdHere.add(issue.id)
      return json(res, 200, { issue })
    }

    const issue = m && find(m[1])
    if (!issue) return json(res, 404, { error: 'not found' })
    const add = (l) => {
      if (!issue.labels.includes(l)) issue.labels.push(l)
    }
    const rm = (l) => {
      issue.labels = issue.labels.filter((x) => x !== l)
    }

    if (m[2] === 'comment') {
      const comment = {
        id: String(Date.now()),
        issue_id: issue.id,
        author: human.id,
        text: b.text,
        created_at: new Date().toISOString(),
      }
      ;(comments[issue.id] ??= []).push(comment)
      issue.comment_count++
      if (config.note.addLabel) add(config.note.addLabel)
      if (b.clear) {
        for (const clearLabel of config.note.offerToClear) rm(clearLabel)
      }
      return json(res, 200, {
        issue,
        comments: withBy(comments[issue.id]),
        sessions: null,
        notes: [],
      })
    }

    if (m[2] === 'status') {
      issue.status = b.status
      return json(res, 200, { issue })
    }

    if (m[2] === 'priority') {
      issue.priority = b.priority
      return json(res, 200, { issue })
    }

    if (m[2] === 'labels') {
      ;(b.add ?? []).forEach(add)
      ;(b.remove ?? []).forEach(rm)
      return json(res, 200, { issue })
    }
  }

  json(res, 404, { error: 'no route' })
}).listen(port, '127.0.0.1', () => console.log(`mock api on http://127.0.0.1:${port}`))
