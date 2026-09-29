// entry point: parses the cli flags from docs/api.md, loads config, binds the
// board to 127.0.0.1 and opens it.
import { execFileSync, spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { createServer } from 'node:net'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { serve } from '@hono/node-server'
import { createBoard, newToken } from './app'
import { defaultHuman, type HumanIdentity } from './authors'
import { BdError, BeadsClient } from './bd'
import { loadConfig, type ResolvedBoardConfig } from './config'
import { clearState, findState, startDetached, stopBoard, writeState } from './daemon'
import { DEFAULT_LIMIT, SCOPES, searchIssues, type SearchResult, type SearchScope } from './search'

const DEFAULT_PORT = 1338
/** how many ports past the default to try when no --port is given */
const PORT_TRIES = 20

export interface Options {
  repo: string
  /** undefined means the first free port from 1338 up */
  port: number | undefined
  agentsview: string | null | undefined
  config?: string
  open: boolean
}

/** parses `beadside [--repo <path>] [--port <n>] [--config <path>] [--agentsview <url>|--no-agentsview] [--no-open]` */
export function parseOptions(argv: string[]): Options {
  const { values } = parseArgs({
    args: argv,
    options: {
      repo: { type: 'string' },
      port: { type: 'string' },
      config: { type: 'string' },
      'agentsview': { type: 'string' },
      'no-agentsview': { type: 'boolean' },
      'no-open': { type: 'boolean' },
    },
    allowPositionals: false,
  })

  const port = values.port === undefined ? undefined : Number(values.port)
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
    throw new Error('--port must be between 0 and 65535')
  }

  let agentsview: string | null | undefined = undefined
  if (values['no-agentsview']) {
    agentsview = null
  } else if (values['agentsview']) {
    agentsview = values['agentsview']
  }

  return {
    repo: resolve(values.repo ?? process.cwd()),
    port,
    agentsview,
    config: values.config,
    open: !values['no-open'],
  }
}

/**
 * the bd issue prefix, taken off an exported id: `demo-9fz` and
 * `demo-zf8.4` both give `demo`.
 */
export function repoNameFromId(id: string): string | null {
  const withoutSuffix = id.replace(/\.\d+$/, '')
  const cut = withoutSuffix.lastIndexOf('-')
  return cut > 0 ? withoutSuffix.slice(0, cut) : null
}

/**
 * the local user's name: git user.name, then $USER. BEADS_ACTOR is deliberately ignored,
 * because agent sessions set it and a board started from one must still write as the human.
 */
export function resolveUserName(repoPath: string): string {
  try {
    const gitUser = execFileSync('git', ['config', 'user.name'], {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (gitUser) return gitUser
  } catch {
    // git config not found or failed
  }
  const envUser = process.env['USER']?.trim()
  if (envUser) return envUser
  return 'unknown'
}

/** the configured human, or `human:<git user.name>` when the config names none */
export function resolveHuman(config: ResolvedBoardConfig, repoPath: string): HumanIdentity {
  return config.human ?? defaultHuman(resolveUserName(repoPath))
}

export interface SearchOptions {
  repo: string
  config?: string
  query: string
  scope: SearchScope
  limit: number
  json: boolean
}

/** parses `beadside search <query…> [--scope all|open|closed] [--limit <n>] [--json] [--repo <path>] [--config <path>]` */
export function parseSearchOptions(argv: string[]): SearchOptions {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      repo: { type: 'string' },
      config: { type: 'string' },
      scope: { type: 'string' },
      limit: { type: 'string' },
      json: { type: 'boolean' },
    },
    allowPositionals: true,
  })
  const query = positionals.join(' ').trim()
  if (!query) throw new Error('search needs a query: beadside search <words> [--scope all|open|closed] [--json]')
  const scope = (values.scope ?? 'all') as SearchScope
  if (!SCOPES.includes(scope)) throw new Error('--scope must be all, open or closed')
  const limit = values.limit === undefined ? DEFAULT_LIMIT : Number(values.limit)
  if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit must be a positive integer')
  return { repo: resolve(values.repo ?? process.cwd()), config: values.config, query, scope, limit, json: values.json === true }
}

/** plain-text rendering of search hits for a terminal or an agent that skips --json */
export function formatSearch(result: SearchResult): string {
  if (!result.hits.length) return `no issues match "${result.query}" (scope ${result.scope})`
  const lines = [`${result.total} match${result.total === 1 ? '' : 'es'} for "${result.query}" (scope ${result.scope})`]
  for (const hit of result.hits) {
    lines.push('', `${hit.id}  [${hit.status} p${hit.priority}]  ${hit.title}`)
    let where: string = hit.field
    if (hit.comment) {
      const by = hit.comment.by.kind === 'unknown' ? `${hit.comment.author} (author unknown)` : hit.comment.by.name
      where = `comment ${hit.comment.id} by ${by}, ${hit.comment.created_at.slice(0, 10)}`
    }
    lines.push(`  ${where}: ${hit.excerpt || '(no description)'}`)
  }
  if (result.total > result.hits.length) lines.push('', `${result.total - result.hits.length} more; raise --limit`)
  return lines.join('\n')
}

async function runSearch(argv: string[]): Promise<void> {
  let options: SearchOptions
  try {
    options = parseSearchOptions(argv)
  } catch (error) {
    console.error(`beadside: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(2)
  }
  try {
    const config = loadConfig(options.repo, options.config)
    const human = resolveHuman(config, options.repo)
    const corpus = await new BeadsClient(options.repo).corpus()
    const result = searchIssues(corpus, options.query, { scope: options.scope, limit: options.limit, human })
    console.log(options.json ? JSON.stringify(result, null, 2) : formatSearch(result))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (options.json) console.log(JSON.stringify({ error: message }))
    console.error(`beadside: search failed: ${message}`)
    process.exit(1)
  }
}

/** true when nothing is listening on 127.0.0.1:<port> */
export function portFree(port: number): Promise<boolean> {
  return new Promise((done) => {
    const probe = createServer()
    probe.once('error', () => done(false))
    probe.once('listening', () => probe.close(() => done(true)))
    probe.listen(port, '127.0.0.1')
  })
}

/** the first free port from `start` up, so a second board next to a running one just works */
export async function firstFreePort(start: number, tries: number): Promise<number | null> {
  for (let port = start; port < start + tries; port += 1) {
    if (await portFree(port)) return port
  }
  return null
}

/** opens the url in the platform's default browser */
export function openBrowser(url: string): void {
  let cmd: string
  let args: string[]
  if (process.platform === 'darwin') {
    cmd = 'open'
    args = [url]
  } else if (process.platform === 'win32') {
    cmd = 'cmd'
    args = ['/c', 'start', '', url]
  } else {
    cmd = 'xdg-open'
    args = [url]
  }
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
  child.on('error', () => console.error(`beadside: could not run ${cmd}; open the url yourself`))
  child.unref()
}

/** parses the `--repo <path>` that `beadside stop` and `beadside status` take */
export function parseRepoOnly(argv: string[]): string {
  const { values } = parseArgs({ args: argv, options: { repo: { type: 'string' } }, allowPositionals: false })
  return resolve(values.repo ?? process.cwd())
}

function failUsage(error: unknown): never {
  console.error(`beadside: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(2)
}

/** `beadside start [server flags]`: runs the board in the background, or reports the one already running */
async function runStart(argv: string[]): Promise<void> {
  let options: Options
  try {
    options = parseOptions(argv)
  } catch (error) {
    failUsage(error)
  }
  const running = findState(options.repo)
  if (running) {
    console.log(`beadside: already running for ${running.repo} at ${running.url} (pid ${running.pid})`)
    if (options.open) openBrowser(running.url)
    return
  }
  try {
    const state = await startDetached(options.repo, argv)
    console.log(`beadside: started for ${state.repo} at ${state.url} (pid ${state.pid})`)
    console.log('stop it with: beadside stop')
  } catch (error) {
    console.error(`beadside: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

/** `beadside stop`: ends the board running for this repo, background or foreground */
async function runStop(argv: string[]): Promise<void> {
  let repo: string
  try {
    repo = parseRepoOnly(argv)
  } catch (error) {
    failUsage(error)
  }
  const state = findState(repo)
  if (!state) {
    console.log(`beadside: no board running for ${repo}`)
    return
  }
  if (await stopBoard(state)) {
    console.log(`beadside: stopped ${state.url} (pid ${state.pid})`)
  } else {
    console.error(`beadside: pid ${state.pid} did not exit after SIGTERM`)
    process.exit(1)
  }
}

/** `beadside status`: prints the running board's url, exits 1 when none runs */
function runStatus(argv: string[]): void {
  let repo: string
  try {
    repo = parseRepoOnly(argv)
  } catch (error) {
    failUsage(error)
  }
  const state = findState(repo)
  if (!state) {
    console.log(`beadside: no board running for ${repo}`)
    process.exit(1)
  }
  console.log(`beadside: running for ${state.repo} at ${state.url} (pid ${state.pid})`)
}

async function main(): Promise<void> {
  const command = process.argv[2]
  if (command === 'search') return runSearch(process.argv.slice(3))
  if (command === 'start') return runStart(process.argv.slice(3))
  if (command === 'stop') return runStop(process.argv.slice(3))
  if (command === 'status') return runStatus(process.argv.slice(3))
  let options: Options
  try {
    options = parseOptions(process.argv.slice(2))
  } catch (error) {
    console.error(`beadside: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(2)
  }

  try {
    if (!statSync(options.repo).isDirectory()) throw new Error('not a directory')
  } catch {
    console.error(`beadside: repo is not a directory: ${options.repo}`)
    process.exit(2)
  }

  let config: ResolvedBoardConfig
  try {
    config = loadConfig(options.repo, options.config)
  } catch (error) {
    console.error(`beadside: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(2)
  }

  const agentsview =
    options.agentsview !== undefined ? options.agentsview : config.agentsview
  const human = resolveHuman(config, options.repo)

  const client = new BeadsClient(options.repo, undefined, { actor: human.id })
  let name = basename(options.repo)
  try {
    const issues = await client.issues()
    const derived = issues.length ? repoNameFromId(issues[0]!.id) : null
    if (derived) name = derived
  } catch (error) {
    const message = error instanceof BdError ? error.message : String(error)
    console.error(`beadside: could not read the backlog (${message})`)
    process.exit(1)
  }

  const uiDist = resolve(dirname(fileURLToPath(import.meta.url)), '../ui/dist')
  const board = createBoard({
    client,
    repo: { name, path: options.repo },
    agentsview,
    human,
    config,
    token: newToken(),
    uiDist,
    live: { log: (message) => console.error(`beadside: ${message}`) },
  })
  const app = board.app

  const port = options.port ?? (await firstFreePort(DEFAULT_PORT, PORT_TRIES))
  if (port === null) {
    console.error(`beadside: no free port between ${DEFAULT_PORT} and ${DEFAULT_PORT + PORT_TRIES - 1}; pass --port`)
    process.exit(1)
  }

  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, (info) => {
    const url = `http://127.0.0.1:${info.port}/`
    console.log(`beadside: ${name} (${options.repo}), writing as ${human.id}`)
    console.log(`open: ${url}`)
    if (agentsview) console.log(`agentsview: ${agentsview}`)
    console.log('press Ctrl-C or run `beadside stop` to stop')
    writeState({ pid: process.pid, port: info.port, url, repo: options.repo })
    if (options.open) {
      openBrowser(url)
    }
  })

  // the follower is a child process; never leave it behind
  process.on('exit', () => board.close())
  const stop = () => {
    board.close()
    clearState(options.repo, process.pid)
    server.close(() => process.exit(0))
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  process.on('SIGHUP', stop)
}

// only run when executed, so tests can import the helpers
if (
  process.argv[1] &&
  import.meta.url.startsWith('file:') &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  void main()
}
