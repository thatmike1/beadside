// the index while a search is active: ranked hits with where each matched and an excerpt

import type { SearchHit, SearchResult, SearchScope } from '../api'
import { shortId } from '../model'
import { highlightRuns } from '../format'
import { useStrings, type Strings } from '../i18n'

function Marked({ text, terms }: { text: string; terms: string[] }) {
  return (
    <>
      {highlightRuns(text, terms).map((run, i) => (run.hit ? <mark key={i}>{run.text}</mark> : run.text))}
    </>
  )
}

function where(hit: SearchHit, s: Strings): string {
  if (hit.field === 'comment' && hit.comment) {
    const by = hit.comment.by
    const name = by.self ? s.search.you : by.kind === 'unknown' ? s.search.authorUnknown : by.name
    return `${s.search.fields.comment} · ${name}`
  }
  return s.search.fields[hit.field]
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
  const s = useStrings()
  const { query, scope, result, loading, error, repoName, selected, onPick } = props

  let status: string
  if (error) status = s.search.failed(error)
  else if (loading && !result) status = s.search.searching
  else if (!result) status = ''
  else if (!result.total) status = s.search.none(scope, query.trim())
  else status = s.search.found(result.total, scope, result.hits.length, loading)

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
                  {hit.status !== 'open' ? <span className="chip">{s.status[hit.status]}</span> : null}
                  <span className="mono rp">p{hit.priority}</span>
                </span>
                <span className="hwhere">{where(hit, s)}</span>
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
