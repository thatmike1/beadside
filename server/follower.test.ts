// nodeFollower against a stand-in `bd` script on PATH, so the real spawn loop runs
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nodeFollower, type FollowHandlers } from './bd'

// prints the records above --since up to the head in ./head, logs each argv, exits with ./code
const FAKE_BD = `#!/bin/sh
dir=$(dirname "$0")
echo "$*" >> "$dir/calls"
since=$4
head=$(cat "$dir/head")
i=$((since + 1))
while [ "$i" -le "$head" ]; do
  echo "{\\"seq\\":$i,\\"op\\":\\"update\\"}"
  i=$((i + 1))
done
exit $(cat "$dir/code")
`

describe('nodeFollower', () => {
  let dir: string
  let path: string | undefined

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'beadside-follow-'))
    writeFileSync(join(dir, 'bd'), FAKE_BD)
    chmodSync(join(dir, 'bd'), 0o755)
    writeFileSync(join(dir, 'head'), '2')
    writeFileSync(join(dir, 'code'), '0')
    path = process.env['PATH']
    process.env['PATH'] = `${dir}:${path}`
  })

  afterEach(() => {
    process.env['PATH'] = path
    rmSync(dir, { recursive: true, force: true })
  })

  const until = async (check: () => boolean) => {
    for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 10))
    expect(check()).toBe(true)
  }
  const calls = () =>
    existsSync(join(dir, 'calls')) ? readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n') : []

  it('reads one-shot, never --follow, and resumes from the highest seq seen', async () => {
    const lines: string[] = []
    const handlers: FollowHandlers = { line: (l) => lines.push(l), stderr: () => {}, exit: () => {} }
    const handle = nodeFollower(dir, 20)(0, handlers)
    await until(() => lines.length === 2)
    writeFileSync(join(dir, 'head'), '3')
    await until(() => lines.length === 3)
    handle.stop()
    expect(lines.map((l) => JSON.parse(l).seq)).toEqual([1, 2, 3])
    expect(calls()[0]).toBe('events tail --since 0')
    expect(calls()).toContain('events tail --since 2')
    expect(calls().every((c) => !c.includes('--follow'))).toBe(true)
  })

  it('ends the follow on a failed read and stops polling', async () => {
    writeFileSync(join(dir, 'code'), '3')
    const exits: (number | null)[] = []
    nodeFollower(dir, 20)(0, { line: () => {}, stderr: () => {}, exit: (code) => exits.push(code) })
    await until(() => exits.length === 1)
    await new Promise((r) => setTimeout(r, 100))
    expect(exits).toEqual([3])
    expect(calls()).toHaveLength(1)
  })

  it('stop() between reads cancels the next one', async () => {
    const lines: string[] = []
    const handle = nodeFollower(dir, 200)(0, { line: (l) => lines.push(l), stderr: () => {}, exit: () => {} })
    await until(() => lines.length === 2)
    handle.stop()
    await new Promise((r) => setTimeout(r, 400))
    expect(calls()).toHaveLength(1)
  })
})
