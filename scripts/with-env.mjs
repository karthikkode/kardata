#!/usr/bin/env node
// Run a command with agents/.env merged into its environment.
// Values may hold shell-special characters (|, spaces, quotes) that
// break `set -a; . agents/.env`; parsing here passes them byte-exact.
// Usage: node scripts/with-env.mjs [--file <path>] [--] <command...>
// (--env-file is taken: node itself consumes it before this script runs.)
// Explicit environment always wins. Values are never printed.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnvFile } from '../deployment/scripts/stack-lib.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const args = process.argv.slice(2)
let envFile = join(ROOT, 'agents', '.env')
let explicitFile = false
while (args[0] === '--file') {
  args.shift()
  const next = args.shift()
  if (!next) {
    console.error('with-env: --file needs a path')
    process.exit(2)
  }
  envFile = resolve(next)
  explicitFile = true
}
if (args[0] === '--') args.shift()
if (args.length === 0) {
  console.error('with-env: usage: node scripts/with-env.mjs [--file <path>] [--] <command...>')
  process.exit(2)
}

let fileEnv = {}
if (!existsSync(envFile)) {
  if (explicitFile) {
    console.error(`with-env: env file not found: ${envFile}`)
    process.exit(1)
  }
  console.error(`with-env: ${envFile} missing, running with current environment only`)
} else {
  fileEnv = parseEnvFile(readFileSync(envFile, 'utf8'))
}

const child = spawnSync(args[0], args.slice(1), {
  cwd: ROOT,
  env: { ...fileEnv, ...process.env },
  stdio: 'inherit',
})
if (child.error) {
  console.error(`with-env: cannot start ${args[0]}: ${child.error.message}`)
  process.exit(1)
}
process.exit(child.status ?? 0)
