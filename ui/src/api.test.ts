import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const response = (body: unknown, status = 200, statusText = '') =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, statusText })

let api: typeof import('./api')
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>

beforeEach(async () => {
  // Each case begins as a fresh page, with no cached session token.
  vi.resetModules()
  fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchMock)
  api = await import('./api')
})
afterEach(() => vi.unstubAllGlobals())

describe('board API requests and recovery', () => {
  it('loads the session before the first write and sends the note as JSON', async () => {
    fetchMock.mockResolvedValueOnce(response({ token: 'first-token' }))
      .mockResolvedValueOnce(response({ issue: { id: 'repo-a' } }))
    await expect(api.postComment('repo-a', 'Keep the newline.\nAnd this line.')).resolves.toEqual({ issue: { id: 'repo-a' } })
    expect(fetchMock.mock.calls).toEqual([
      ['/api/session', undefined],
      ['/api/issues/repo-a/comment', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-bd-token': 'first-token' },
        body: JSON.stringify({ text: 'Keep the newline.\nAnd this line.' }),
      }],
    ])
  })

  it('reuses the session token for subsequent writes on the same page', async () => {
    fetchMock.mockResolvedValueOnce(response({ token: 'cached-token' }))
      .mockImplementation(async () => response({ issue: { id: 'repo-a' } }))
    await api.getSession()
    await api.keepIssue('repo-a')
    await api.setPriority('repo-a', 0)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[2]).toEqual(['/api/issues/repo-a/priority', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-bd-token': 'cached-token' },
      body: '{"priority":0}',
    }])
  })

  it('refreshes an expired write token and retries the original operation', async () => {
    fetchMock.mockResolvedValueOnce(response({ token: 'old-token' }))
      .mockResolvedValueOnce(response({ error: 'invalid x-bd-token' }, 403))
      .mockResolvedValueOnce(response({ token: 'new-token' }))
      .mockResolvedValueOnce(response({ issue: { id: 'repo-a' } }))
    await expect(api.setDue('repo-a', '+1w')).resolves.toEqual({ issue: { id: 'repo-a' } })
    expect(fetchMock).toHaveBeenCalledTimes(4)
    const original = fetchMock.mock.calls[1]!
    const retry = fetchMock.mock.calls[3]!
    expect(retry).toEqual([original[0], {
      ...original[1], headers: { 'content-type': 'application/json', 'x-bd-token': 'new-token' },
    }])
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/session')
  })

  it('stops after one token refresh if the retry is also rejected', async () => {
    fetchMock.mockResolvedValueOnce(response({ token: 'old-token' }))
      .mockResolvedValueOnce(response({ error: 'old x-bd-token' }, 403))
      .mockResolvedValueOnce(response({ token: 'new-token' }))
      .mockResolvedValue(response({ error: 'new x-bd-token rejected' }, 403))
    await expect(api.keepIssue('repo-a')).rejects.toThrow('new x-bd-token rejected')
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('surfaces ordinary write errors without retrying a possibly completed write', async () => {
    fetchMock.mockResolvedValueOnce(response({ token: 'valid-token' }))
      .mockResolvedValueOnce(response({ error: 'bd command timed out' }, 504))
    await expect(api.postComment('repo-a', 'hello')).rejects.toThrow('bd command timed out')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('explains a non-JSON response with the endpoint that failed', async () => {
    fetchMock.mockResolvedValue(new Response('<html>proxy error</html>', { status: 502 }))
    await expect(api.getIssues()).rejects.toThrow('/api/issues: response was not json')
  })

  it('uses HTTP status when an error response has no JSON error field', async () => {
    fetchMock.mockResolvedValueOnce(response(undefined, 503, 'Service Unavailable'))
      .mockResolvedValueOnce(response({ detail: 'private diagnostic' }, 502, 'Bad Gateway'))
    await expect(api.getIssues()).rejects.toThrow('503 Service Unavailable')
    await expect(api.getIssue('repo-a')).rejects.toThrow('502 Bad Gateway')
  })

  it('accepts an empty successful DELETE response with the write token', async () => {
    fetchMock.mockResolvedValueOnce(response({ token: 'delete-token' }))
      .mockResolvedValueOnce(response(undefined, 204))
    await expect(api.deleteIssue('repo-a')).resolves.toBeNull()
    expect(fetchMock.mock.calls[1]).toEqual(['/api/issues/repo-a', {
      method: 'DELETE', headers: { 'x-bd-token': 'delete-token' },
    }])
  })

  it('encodes an issue ID as one URL segment', async () => {
    fetchMock.mockResolvedValue(response({ issue: { id: 'repo/a?#b' } }))
    await api.getIssue('repo/a?#b')
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/issues/repo%2Fa%3F%23b', undefined)
  })

  it('preserves search phrases, scope and cancellation in the request', async () => {
    const controller = new AbortController()
    fetchMock.mockResolvedValue(response({ hits: [], total: 0 }))
    await api.search('"Příliš žluťoučký" & notes?', 'closed', controller.signal)
    const [url, init] = fetchMock.mock.calls[0]!
    const parsed = new URL(String(url), 'http://board.test')
    expect(parsed.pathname).toBe('/api/search')
    expect(Object.fromEntries(parsed.searchParams)).toEqual({ q: '"Příliš žluťoučký" & notes?', scope: 'closed' })
    expect(init?.signal).toBe(controller.signal)
  })

  it('preserves an explicit false clear choice while omitting an unspecified choice', async () => {
    fetchMock.mockResolvedValueOnce(response({ token: 'token' })).mockImplementation(async () => response({}))
    await api.postComment('repo-a', 'leave the flag', false)
    await api.postComment('repo-a', 'default handling')
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ text: 'leave the flag', clear: false })
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({ text: 'default handling' })
  })
})
