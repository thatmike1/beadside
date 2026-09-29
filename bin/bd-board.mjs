#!/usr/bin/env node
// deprecated alias: bd-board is now beadside. says so once on stderr (stdout stays clean
// for `search --json`), then runs the same cli.
process.stderr.write('bd-board: renamed to beadside; this alias still works, call `beadside` instead\n')
await import('./beadside.mjs')
