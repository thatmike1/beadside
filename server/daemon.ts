// background mode: `beadside start` detaches a board and `beadside stop` ends it,
// both keyed by the repo path through a small state file per repo.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface BoardState {
  pid: number
  port: number
  url: string
  repo: string
}

/** where the state and log files live; the runtime dir clears on reboot, so no board outlives its pid */
export function stateDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env['XDG_RUNTIME_DIR'] || tmpdir(), 'beadside')
}

/** the state dir from before the rename to beadside; a board started under the old name wrote here */
export function legacyStateDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env['XDG_RUNTIME_DIR'] || tmpdir(), 'bd-board')
}

/** one file stem per repo path, so any cwd resolving to the same repo finds the same board */
export function stateStem(repo: string, dir = stateDir()): string {
  return join(dir, createHash('sha1').update(repo).digest('hex').slice(0, 12))
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

/** the running board for this repo, or null; a state file left by a dead process is removed */
export function readState(repo: string, dir = stateDir()): BoardState | null {
  const file = `${stateStem(repo, dir)}.json`
  let state: BoardState
  try {
    state = JSON.parse(readFileSync(file, 'utf8')) as BoardState
  } catch {
    return null
  }
  if (alive(state.pid)) return state
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
  })
  child.unref()

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const state = readState(repo, dir)
    if (state && state.pid === child.pid) return state
    if (child.exitCode !== null || !alive(child.pid!)) break
    await new Promise((done) => setTimeout(done, 150))
  }
  if (child.pid && alive(child.pid)) process.kill(child.pid, 'SIGTERM')
  throw new Error(`the board did not start; see ${log}`)
}

/** sends SIGTERM and waits for the process to go away */
export async function stopBoard(state: BoardState, timeoutMs = 5000): Promise<boolean> {
  process.kill(state.pid, 'SIGTERM')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!alive(state.pid)) return true
    await new Promise((done) => setTimeout(done, 100))
  }
  return false
}
