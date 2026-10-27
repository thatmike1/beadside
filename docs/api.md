# beadside API contract

The server is the only thing that runs `bd`. The UI talks to it over HTTP on the same origin (in dev, Vite proxies `/api` to the server port). This file is the contract both sides build against.

## Conventions

- JSON everywhere. Errors: status 4xx or 5xx with body `{ "error": "<message>" }`.
- Every POST and DELETE needs the header `x-bd-token: <token>` where the token comes from `GET /api/session`. The server binds to `127.0.0.1` only.
- Issue ids are full ids (`demo-9fz`). The UI shortens for display.
- Timestamps are ISO strings as `bd` emits them.

## Types

```ts
type Status = 'open' | 'in_progress' | 'blocked' | 'deferred' | 'pinned' | 'closed'

interface Issue {            // one record of `bd export` (JSONL, `_type === 'issue'`), `_type` dropped
  id: string
  title: string
  description: string
  status: Status
  priority: 0 | 1 | 2 | 3 | 4  // 0 highest
  issue_type: string           // task | epic | bug | feature | chore | decision
  labels: string[]
  owner?: string
  created_by?: string
  created_at: string
  updated_at: string
  closed_at?: string | null
  close_reason?: string
  notes?: string
  comment_count: number
  dependency_count: number
  dependent_count: number
  due_at?: string | null
  dependencies?: Dependency[]  // outgoing edges; `bd show`'s shape is rewritten to this one on the way out
  agent_reply?: AgentReply | null   // GET /api/issues only, see below
  note_at?: string | null          // GET /api/issues only: created_at of the human's own latest comment
}

interface Dependency {       // issue_id depends on depends_on_id, as `bd export` writes it
  issue_id: string
  depends_on_id: string
  type: string               // parent-child | blocks | related | relates-to | discovered-from | supersedes | ...
}

interface AgentReply {       // the newest agent comment written after the board human's latest comment
  at: string
  name: string               // Claude, Codex, Gemini, Agent
}

interface Author {           // the server's reading of a stored author string
  kind: 'human' | 'agent' | 'unknown'
  name: string               // Mike, Claude, Codex, Gemini, Agent, or the raw string when unknown
  self: boolean              // true only for the board's configured human; the ui shows "You"
}

interface Comment {
  id: string
  issue_id: string
  author: string             // canonical, as bd stores it: human:mike, agent:claude, agent:codex, agent:gemini
  text: string               // markdown
  created_at: string
  by: Author
}

type SearchScope = 'all' | 'open' | 'closed'   // open = everything not closed, deferred and parked ideas included
type SearchField = 'id' | 'title' | 'description' | 'notes' | 'comment'

interface SearchHit {
  id: string
  title: string
  status: Status
  priority: number
  labels: string[]
  updated_at: string
  field: SearchField         // where the strongest match is
  excerpt: string            // text around the match; the description lead for id and title hits
  comment: { id: string; author: string; by: Author; created_at: string } | null   // set for comment hits
  fields: SearchField[]      // every field any term was found in
  score: number
}

interface SearchResult { query: string; scope: SearchScope; terms: string[]; total: number; hits: SearchHit[] }

interface SessionHit {       // from AgentsView /api/v1/search?q=<id>&limit=<n>
  session_id: string
  title: string              // T3 thread title when matched, otherwise session name (first prompt)
  prompt?: string            // first prompt when title was replaced by T3 thread title
  day: string                // YYYY-MM-DD
  modified: string
  agent: string              // claude, codex, etc.
  url: string                // per-session deep link: {base}/sessions/{id}?msg={ordinal}
}

interface NoteHit { file: string; line: number; excerpt: string }   // recursive scan of <notesDir>/*.md for the id

interface IssueDetail {
  issue: Issue               // from `bd show <id> --json`; includes `notes` when present
  comments: Comment[]        // `bd comments <id> --json`
  sessions: SessionHit[] | null   // null when AgentsView is off or not reachable
  notes: NoteHit[]
  note_read: NoteRead | null // when the human's latest note was read; see below
}

// when a session read the human's latest note. null while the bead carries `note.addLabel`, when
// the human never commented, or when nothing says it was read.
// source `label`: the earliest removal of `note.addLabel` at or after the note, from
// `bd history <id> --events --json` (bd's audit events table; actor and time). that table is
// local to the clone that made the change and does not travel with `bd sync`.
// source `reply`: without such a row, the first agent comment after the note.
interface NoteRead {
  at: string
  actor: string              // the audit actor or the reply's stored author
  by: Author
  source: 'label' | 'reply'
}

interface LaneConfig { label: string; note: string | null; glyph: string; color: string }
interface UnlanedConfig { title: string; note: string | null }
interface WaitingConfig { labels: string[]; title: string; note: string | null }
interface NoteConfig { addLabel: string | null; offerToClear: string[] }
interface InboxConfig { labels: string[] }   // defaults to note.offerToClear when the config has no inbox block
interface ThoughtsConfig { label: string; title: string; note: string | null }
interface CaptureConfig { labels: string[] }
interface DerivedConfig { allFlags: string[]; hotChips: string[] }

interface BoardConfig {
  human: { id: string; name: string } | null   // in /api/session always the identity in use
  agentsview: string | null
  notesDir: string | null
  lanes: LaneConfig[]
  unlaned: UnlanedConfig
  subLabels: string[]
  waiting: WaitingConfig
  note: NoteConfig
  inbox: InboxConfig
  thoughts: ThoughtsConfig | null
  flags: string[]
  capture: CaptureConfig
  derived: DerivedConfig
}

interface StalePicks { day: string; ids: string[] }

interface InboxState {
  device: string                   // the name this board's kv keys carry, from the hostname
  seen: Record<string, string>     // bead id -> the newest answer time any device opened it at
  picks: StalePicks | null         // the day's picks of the device that drew first; null when none has
}

interface SessionInfo {
  token: string
  repo: { name: string; path: string }
  agentsview: string | null
  me: string                 // the author id board comments are written as
  human: { id: string; name: string }
  config: BoardConfig
}
```

## Endpoints

| method | path | body | returns |
|---|---|---|---|
| GET | `/api/session` | | `SessionInfo` |
| GET | `/api/issues` | | `{ issues: Issue[], fetchedAt: string }` all statuses, the UI filters. Each issue carries `agent_reply`, null unless an agent commented after the human's latest comment; a bead the human never commented on has none. `note_at` is that latest comment's time, null when there is none; the inbox reads a close after it as an answer too |
| GET | `/api/issue-ids` | | `{ ids: string[] }` all statuses; readable cross-origin from the T3 Code renderer and loopback pages, which link short ids in chat |
| GET | `/api/issues/:id` | | `IssueDetail` |
| GET | `/api/inbox-state?day=<YYYY-MM-DD>` | | `InboxState`: the seen markers merged over every device and the day's stale picks. See Inbox state |
| GET | `/api/search?q=<words>&scope=all\|open\|closed&limit=<1-500>` | | `SearchResult`, the same ranking `beadside search` prints |
| GET | `/api/events` | | Server-sent events, same-origin only. `state` (`{ live: boolean }`) on connect and whenever live updates start or stop; `changed` (`{}`) when the ledger moved and lists should be refetched. See Live updates |
| GET | `/api/asks?ids=<id,id>` | | `{ key: string, asks: AskEntry[] }`: every bead that is not closed and carries a question under `asks.key`, plus each id in `ids` (full or short, at most 200) whatever its state, so a page that raised a question can tell it closed. `AskEntry` is `{ id, title, status, closed_at, ask: Ask \| null }`, `Ask` as in `server/asks.ts`. 404 without an `asks` block in the config |
| POST | `/api/issues/:id/comment` | `{ text: string, clear?: boolean }` | `IssueDetail` |
| POST | `/api/issues/:id/ask/answer` | `{ text: string, via?: 'beadside' \| 'hub', clear?: boolean, raised?: string }` | `IssueDetail`; answers the stored question. 409 when the bead has none, 404 without an `asks` block, 412 when `raised` (the day the page showed the question) is older than the question's `last_raised`. A retry finds the human's identical note from the last 15 minutes and only stamps the question |
| POST | `/api/issues/:id/status` | `{ status: Status, reason?: string, until?: string }` | `{ issue }` |
| POST | `/api/issues/:id/priority` | `{ priority: number }` | `{ issue }` |
| POST | `/api/issues/:id/labels` | `{ add?: string[], remove?: string[] }` | `{ issue }` |
| POST | `/api/issues/:id/keep` | `{}` | `{ issue }`; a stale bead stays as it is and leaves the stale filter |
| POST | `/api/issues/:id/due` | `{ due: string }` | `{ issue }`; `due` is anything bd's `--due` reads: `+1w`, `next monday`, `2026-10-20`, an ISO timestamp |
| POST | `/api/issues/:id/seen` | `{ at: string }` | `{ id, at }`; marks the bead's answer seen. `at` is the answer's own time, an ISO timestamp: `agent_reply.at`, or on a closed bead the later of that and `closed_at` |
| POST | `/api/stale-picks` | `{ day: string, ids: string[] }` | `InboxState`; stores this device's picks for `day` (at most 10 ids) and answers with the picks that hold, another device's when it drew first |
| POST | `/api/issues` | `{ title: string, labels?: string[] }` | `{ issue }` quick capture via `bd q` |
| DELETE | `/api/issues/:id` | | `{ deleted }`; only ids this server process created, otherwise 403. Undo for quick capture |

## Live updates

With the beads events journal on (`bd config set events-journal true`, bd 1.3.0 or newer), the server reads the journal with a one-shot `bd events tail --since <n>` every 3 seconds. Not `--follow`: that child holds the embedded Dolt lock almost without a break and starves `bd sync`. A burst of journal records triggers one `bd export`, and `/api/events` sends `changed`. Records are only a trigger: they carry no comment or dependency counts, so the export stays the one source of truth. While live, `/api/issues`, `/api/search` and `/api/issue-ids` read that cached export instead of exporting per request.

The journal does not see rows that arrive by `bd dolt pull` or `bd sync`, so a live server also re-exports every 2 minutes and sends `changed` only when the export differs from the last one it announced.

With the journal off, a bd without it, or a follower that keeps exiting, `state` reports `live: false`, lists re-export on every read, and the UI polls every 20 seconds as before.

## Server behaviour per write

- comment: `bd comments add <id> --author=<human id> -- <text>`, with `BEADS_ACTOR` pinned to the same id so an inherited agent actor never leaks in; if `config.note.addLabel` is configured, runs `bd label add <id> <addLabel>`; if `clear` is true, removes any `config.note.offerToClear` labels the issue carries.
- status: `closed` runs `bd close <id> --reason <reason|"closed from beadside">`; `deferred` runs `bd defer <id> [--until <until>]`; `open` from `closed` runs `bd reopen <id>`; `open` from `deferred` runs `bd undefer <id>`; anything else runs `bd update <id> --status <status>`.
- priority: `bd update <id> --priority <n>`.
- labels: one `bd update <id> --add-label a --remove-label b` call. Labels: 1 to 128 chars, no whitespace.
- keep: `bd update <id> --set-metadata kept_at=<local YYYY-MM-DD>`. bd merges the key into the bead's metadata and moves `updated_at`, which is what takes the bead out of the stale filter; nothing else changes.
- due: `bd update <id> --due=<due>`, the value validated against `^[A-Za-z0-9 +:._-]{1,64}$` (the same check `until` gets).
- create: `bd q <title> -l <label>...`; defaults to `config.capture.labels` when none given.
- ask answer: reads the bead's metadata fresh, then the comment write above (author, `note.addLabel`, and `note.offerToClear` removed unless `clear` is false), then `bd update <id> --metadata={"<asks.key>": {...}}` with the stored question as it was plus `answered: { at, by, via, text }`, `text` cut at 500 characters. bd merges metadata at the top level, so the question key is replaced whole and every other key stays.

The server never accepts a raw argument list from the client. Every route maps to a fixed argument shape; ids are validated against `^[A-Za-z0-9_-]+(\.[0-9]+)?$` before use. Every `bd` call runs with `cwd` set to the repo path and `--no-color` where supported; output is parsed, never echoed to the client on success.

## Inbox state

What the inbox remembers lives in bd's key-value store (`bd kv`), which sits in the Dolt database, so it travels with `bd sync` between clones and never writes to a bead (a bead write would move `updated_at` and break the stale filter). Each board writes only keys that carry its own device name, the hostname lowercased to `[a-z0-9-]`:

- `beadside.seen.<device>.<bead id>` = the answer time the bead was opened at (`agent_reply.at`, or on a closed bead the later of that and `closed_at`)
- `beadside.picks.<device>` = `{"day":"2026-10-13","ids":[...],"at":"<ISO time of the draw>"}`

Two clones that set the same key to different values between syncs make `bd sync` halt with a merge conflict that needs a hand to resolve; keys per device never collide. Reading merges them: a bead is seen at the newest marker any device wrote, and a day's picks are the ones with the earliest `at` for that day, so every board settles on the same three once the syncs meet. A board draws and stores picks only when no device has any for the day yet.

- seen: `bd kv set -- beadside.seen.<device>.<id> <at>`, the id validated like every other, `at` an ISO timestamp.
- stale picks: `bd kv set -- beadside.picks.<device> <json>`, `day` as `YYYY-MM-DD`, each id validated.
- inbox state: one `bd kv list --json`, keys outside `beadside.` ignored.

These writes go through the same one-at-a-time queue as the others but keep the cached export, since no issue changed. kv writes are not in the events journal, so another device's markers show on the next read of `/api/inbox-state`; the UI rereads it when the window regains focus.

## Comment authors

bd stores whatever author a comment is written with. The board writes as its configured human (`"human": { "id": "human:mike", "name": "Mike" }` in `.beadside.json`; without it, `human:<git user.name>`). Agents write as `agent:<provider>` by running bd with `BEADS_ACTOR` set, which bd uses as the default comment author. Reading an author:

- the configured human id: human, `self`, shown as You
- `agent:<provider>`, or a bare `Claude` / `Codex` / `Gemini`: agent, named after the provider; plain `agent` is Agent
- `human:<name>`: another human
- anything else, including the shared git username older comments carry: unknown. It is never guessed to be the human.

When the note label is on a bead, the pinned note is the newest comment from the board's human, falling back to the newest unknown-author comment; an agent reply is never shown as the note.

## Search

One implementation, `server/search.ts`, serves both the http route and the cli. It reads the whole ledger from one `bd export` (comments included), so closed, deferred and parked beads are searchable and a new comment shows up on the next read (the route reuses an export for at most 5 seconds; board writes drop it).

- terms are split on whitespace, `"quoted words"` stay one term; matching ignores case and diacritics
- a bead matches when every term appears somewhere in it
- ranking: exact id (full or short) first, then the whole query in the title, all terms in the title, an id containing the term, the phrase or all terms in one body field, and last terms spread across fields; ties go to the most recently updated bead
- a comment hit points at the newest matching comment

For agents, no server or browser needed:

```bash
beadside search <words> [--scope all|open|closed] [--limit <n>] [--json] [--repo <path>] [--config <path>]
```

`--json` prints a `SearchResult`. Without it, one block per hit: id, status, priority and title, then where it matched and the excerpt. Exit code 0 with or without matches, 2 for bad arguments, 1 when bd fails.

## Config and launch

`beadside [--repo <path>] [--port <n>] [--config <path>] [--agentsview <url>|--no-agentsview] [--no-open]`

Defaults: repo = cwd, port = the first free port from 1338 up (an explicit `--port` fails if taken), agentsview = from config or off (`null`), opens the browser. Repo name = the `bd` issue prefix (derived from the first exported id, or the folder name when the export is empty).

`beadside start [same flags]` runs the board detached and returns once it listens; if one already runs for the repo it prints that url instead. `beadside stop [--repo <path>]` sends SIGTERM to the board for the repo, whether it was started with `start` or in the foreground. `beadside status [--repo <path>]` prints the url, exit 1 when none runs. A running board writes `{ pid, port, url, repo }` to `$XDG_RUNTIME_DIR/beadside/<sha1(repo)[:12]>.json` (tmpdir when unset) and removes it on exit; a detached board logs to the matching `.log`.
