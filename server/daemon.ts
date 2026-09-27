// background mode: `beadside start` detaches a board and `beadside stop` ends it,
// both keyed by the repo path through a small state file per repo.
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

export interface BoardState {
  pid: number
  port: number
  url: string
  repo: string
}

/**
 * the parent of the state dir; the runtime dir clears on reboot, so no board outlives its pid.
 * windows has none, and its temp dir depends on the shell, so it uses the local app data dir.
 */
function stateRoot(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  const fallback = platform === 'win32' && env['LOCALAPPDATA'] ? env['LOCALAPPDATA'] : tmpdir()
  return env['XDG_RUNTIME_DIR'] || fallback
}

/** where the state and log files live */
export function stateDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  return join(stateRoot(env, platform), 'beadside')
}

/** the state dir from before the rename to beadside; a board started under the old name wrote here */
export function legacyStateDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  return join(stateRoot(env, platform), 'bd-board')
}

/** the repo path as the state key; windows paths are case-insensitive, so a drive letter or folder typed in another case finds the same board */
export function repoKey(repo: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? repo.toLowerCase() : repo
}

/** one file stem per repo path, so any cwd resolving to the same repo finds the same board */
export function stateStem(repo: string, dir = stateDir()): string {
  return join(dir, createHash('sha1').update(repoKey(repo)).digest('hex').slice(0, 12))
}

/** true when a process with this pid exists */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * false when the pid now belongs to something other than node. windows hands out pids again
 * quickly and its state dir survives a reboot, so a stale file could name an unrelated process
 * that `stop` would then kill. elsewhere, and when tasklist cannot answer, the pid is trusted.
 */
export function runsNode(pid: number, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== 'win32') return true
  try {
    const row = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    })
    const image = /^"([^"]*)"/.exec(row.trim())?.[1]
    return image === undefined || image.toLowerCase() === basename(process.execPath).toLowerCase()
  } catch {
    return true
  }
}

/** the state file's contents as written, without checking the process */
function readStateFile(file: string): BoardState | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as BoardState
  } catch {
    return null
  }
}

/** the running board for this repo, or null; a state file left by a dead process is removed */
export function readState(repo: string, dir = stateDir()): BoardState | null {
  const file = `${stateStem(repo, dir)}.json`
  const state = readStateFile(file)
  if (!state) return null
  if (alive(state.pid) && runsNode(state.pid)) return state
  rmSync(file, { force: true })
  return null
}

/** the running board for this repo from any of `dirs`, so stop and status still find a board started as bd-board */
export function findState(repo: string, dirs: string[] = [stateDir(), legacyStateDir()]): BoardState | null {
  for (const dir of dirs) {
    const state = readState(repo, dir)
    if (state) return state
  }
  return null
}

export function writeState(state: BoardState, dir = stateDir()): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(`${stateStem(state.repo, dir)}.json`, JSON.stringify(state))
}

/** removes the state file only when it still names this process, so a newer board's file survives */
export function clearState(repo: string, pid: number, dir = stateDir()): void {
  const file = `${stateStem(repo, dir)}.json`
  try {
    const state = JSON.parse(readFileSync(file, 'utf8')) as BoardState
    if (state.pid === pid) rmSync(file, { force: true })
  } catch {
    // already gone
  }
}

/**
 * spawns this same entry point detached, with output going to a log file next to the
 * state, and waits for the server to write its state file. resolves with the state,
 * or rejects with the log path when the board exits or does not come up in time.
 */
export async function startDetached(repo: string, serverArgs: string[], timeoutMs = 20000): Promise<BoardState> {
  const dir = stateDir()
  mkdirSync(dir, { recursive: true })
  const log = `${stateStem(repo, dir)}.log`
  const out = openSync(log, 'w')
  const child = spawn(process.execPath, [...process.execArgv, process.argv[1]!, ...serverArgs], {
    detached: true,
    stdio: ['ignore', out, out],
    // no console window on windows; detached already leaves the child without one
    windowsHide: true,
  })
  child.unref()

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    // the child's own pid is known, so the file is read without the slower process check
    const state = readStateFile(`${stateStem(repo, dir)}.json`)
    if (state && state.pid === child.pid) return state
    if (child.exitCode !== null || !alive(child.pid!)) break
    await new Promise((done) => setTimeout(done, 150))
  }
  if (child.pid && alive(child.pid)) process.kill(child.pid, 'SIGTERM')
  throw new Error(`the board did not start; see ${log}`)
}

/**
 * sends SIGTERM and waits for the process to go away. on windows SIGTERM ends the process
 * outright, so it cannot clear its own state file; the file is cleared here instead.
 */
export async function stopBoard(state: BoardState, timeoutMs = 5000, dir = stateDir()): Promise<boolean> {
  process.kill(state.pid, 'SIGTERM')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!alive(state.pid)) {
      clearState(state.repo, state.pid, dir)
      return true
    }
    await new Promise((done) => setTimeout(done, 100))
  }
  return false
}
