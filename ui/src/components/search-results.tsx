// the index while a search is active: ranked hits with where each matched and an excerpt

import type { SearchField, SearchHit, SearchResult, SearchScope } from '../api'
import { shortId } from '../model'
import { highlightRuns, statusLabel } from '../format'

const FIELD_LABEL: Record<SearchField, string> = {
  id: 'id',
  title: 'title',
  label: 'label',
  description: 'description',
  notes: 'notes',
  comment: 'comment',
}

function Marked({ text, terms }: { text: string; terms: string[] }) {
  return (
    <>
      {highlightRuns(text, terms).map((run, i) => (run.hit ? <mark key={i}>{run.text}</mark> : run.text))}
    </>
  )
}

function where(hit: SearchHit): string {
  if (hit.field === 'comment' && hit.comment) {
    const by = hit.comment.by
    const name = by.self ? 'you' : by.kind === 'unknown' ? 'author unknown' : by.name
    return `comment · ${name}`
  }
  return FIELD_LABEL[hit.field]
}

interface SearchResultsProps {
  query: string
  scope: SearchScope
  result: SearchResult | undefined
  loading: boolean
  error: string | null
  repoName: string
  selected: string | null
  onPick: (hit: SearchHit) => void
}

/** replaces the sections while the search box holds a query */
export function SearchResults(props: SearchResultsProps) {
  const { query, scope, result, loading, error, repoName, selected, onPick } = props
  const kind = scope === 'all' ? '' : `${scope} `

  let status: string
  if (error) status = `search failed: ${error}`
  else if (loading && !result) status = 'searching…'
  else if (!result) status = ''
  else if (!result.total) status = `no ${kind}bead matches “${query.trim()}”`
  else {
    const shown = result.hits.length < result.total ? `, top ${result.hits.length} shown` : ''
    status = `${result.total} ${kind}${result.total === 1 ? 'bead' : 'beads'}${shown}${loading ? ' · updating…' : ''}`
  }

  return (
    <div className="results" aria-busy={loading}>
      <div className={error ? 'rstatus err' : 'rstatus'} role="status">
        {status}
      </div>
      {!error && result
        ? result.hits.map((hit) => {
            const dim = hit.status === 'closed' || hit.status === 'deferred'
            const cls = ['hit', hit.id === selected ? 'sel' : '', dim ? 'dim' : '', hit.status === 'closed' ? 'struck' : '']
            return (
              <button key={hit.id} className={cls.filter(Boolean).join(' ')} data-id={hit.id} onClick={() => onPick(hit)}>
                <span className="hline">
                  <span className="mono rid">
                    <Marked text={shortId(hit.id, repoName)} terms={result.terms} />
                  </span>
                  <span className="rt">
                    <Marked text={hit.title} terms={result.terms} />
                  </span>
                  {hit.status !== 'open' ? <span className="chip">{statusLabel(hit.status)}</span> : null}
                  <span className="mono rp">p{hit.priority}</span>
                </span>
                <span className="hwhere">{where(hit)}</span>
                {hit.excerpt ? (
                  <span className="hex">
                    <Marked text={hit.excerpt} terms={result.terms} />
                  </span>
                ) : null}
              </button>
            )
          })
        : null}
    </div>
  )
}
