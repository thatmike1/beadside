import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { clearState, findState, legacyStateDir, readState, repoKey, runsNode, stateDir, stateStem, stopBoard, writeState } from './daemon'

describe('board state files', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'beadside-state-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const board = (pid: number) => ({ pid, port: 1338, url: 'http://127.0.0.1:1338/', repo: '/repo/a' })

  it('prefers the runtime dir and falls back to tmp', () => {
    expect(stateDir({ XDG_RUNTIME_DIR: '/run/user/1' }, 'linux')).toBe(join('/run/user/1', 'beadside'))
    expect(stateDir({}, 'linux')).toBe(join(tmpdir(), 'beadside'))
    expect(legacyStateDir({ XDG_RUNTIME_DIR: '/run/user/1' }, 'linux')).toBe(join('/run/user/1', 'bd-board'))
  })

  it('keeps windows state under local app data, whatever temp dir the shell set', () => {
    expect(stateDir({ LOCALAPPDATA: '/appdata' }, 'win32')).toBe(join('/appdata', 'beadside'))
    expect(legacyStateDir({ LOCALAPPDATA: '/appdata' }, 'win32')).toBe(join('/appdata', 'bd-board'))
    expect(stateDir({ LOCALAPPDATA: '/appdata' }, 'linux')).toBe(join(tmpdir(), 'beadside'))
    expect(stateDir({}, 'win32')).toBe(join(tmpdir(), 'beadside'))
  })

  it('matches windows repo paths regardless of case, and only there', () => {
    expect(repoKey('I:/Git/Repo', 'win32')).toBe(repoKey('i:/git/repo', 'win32'))
    expect(repoKey('/repo/A', 'linux')).not.toBe(repoKey('/repo/a', 'linux'))
  })

  it('recognises its own pid as a node process', () => {
    expect(runsNode(process.pid)).toBe(true)
  })

  it('stops a board and clears its state file', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true })
    const state = { ...board(child.pid!) }
    writeState(state, dir)
    expect(readState('/repo/a', dir)).toEqual(state)
    expect(await stopBoard(state, 5000, dir)).toBe(true)
    expect(readdirSync(dir)).toEqual([])
  })

  it('finds a board started under the old bd-board state dir', () => {
    const legacy = mkdtempSync(join(tmpdir(), 'bd-board-state-'))
    try {
      writeState(board(process.pid), legacy)
      expect(findState('/repo/a', [dir, legacy])).toEqual(board(process.pid))
      expect(findState('/repo/b', [dir, legacy])).toBeNull()
    } finally {
      rmSync(legacy, { recursive: true, force: true })
    }
  })

  it('keys each repo path to its own file', () => {
    expect(stateStem('/repo/a', dir)).not.toBe(stateStem('/repo/b', dir))
    expect(stateStem('/repo/a', dir)).toBe(stateStem('/repo/a', dir))
  })

  it('reads back a live board and ignores other repos', () => {
    writeState(board(process.pid), dir)
    expect(readState('/repo/a', dir)).toEqual(board(process.pid))
    expect(readState('/repo/b', dir)).toBeNull()
  })

  it('drops a state file whose process is gone', () => {
    writeState(board(2 ** 22 + 7), dir)
    expect(readState('/repo/a', dir)).toBeNull()
    expect(readdirSync(dir)).toEqual([])
  })

  it('clears only the file that names the exiting pid', () => {
    writeState(board(process.pid), dir)
    clearState('/repo/a', process.pid + 1, dir)
    expect(readState('/repo/a', dir)).not.toBeNull()
    clearState('/repo/a', process.pid, dir)
    expect(readdirSync(dir)).toEqual([])
  })
})
