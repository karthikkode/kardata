import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import { defineConfig } from 'eslint/config'

const allowlist = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'quality-allowlist.json')))
const allowFiles = (key) =>
  allowlist[key].map((entry) => entry.file).filter((file) => file.startsWith('frontend/')).map((file) => file.slice('frontend/'.length))

export default defineConfig([
  { ignores: ['dist/**', 'node_modules/**', 'test-results/**', 'var/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/test/**', 'src/**/*.test.{ts,tsx}', 'src/data/api/client.ts'],
    rules: {
      'max-lines': ['error', { max: 800 }],
      complexity: ['warn', 20],
      'max-depth': ['warn', 4],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='fetch']",
          message: 'use the frontend data client (src/data/api/client.ts)',
        },
      ],
    },
  },
  // Seams expose real hooks, not re-exported api calls (P6-M3). Value
  // re-exports from api/ are banned here; `export type` still passes.
  // Excepted: useThreads/useFiles (live-tail and file-pipeline
  // orchestration still unwinding), useApi (error plumbing, not calls:
  // api/ internals import the same helpers, so they cannot move).
  // NOTE: this block re-states the fetch ban because a later block's
  // rule setting replaces the src/** one for these files.
  {
    files: ['src/data/use*.ts'],
    ignores: ['src/data/useThreads.ts', 'src/data/useFiles.ts', 'src/data/useApi.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='fetch']",
          message: 'use the frontend data client (src/data/api/client.ts)',
        },
        {
          selector: "ExportNamedDeclaration[source.value=/\\/api\\//][exportKind!='type']",
          message: 'data/use*.ts must expose real hooks, not re-exported api calls (export type only)',
        },
        {
          selector: 'ExportAllDeclaration[source.value=/\\/api\\//]',
          message: 'data/use*.ts must expose real hooks, not re-exported api calls (export type only)',
        },
      ],
    },
  },
  ...allowFiles('maxLines').map((file) => ({ files: [file], rules: { 'max-lines': 'off' } })),
  ...allowFiles('globalFetch').map((file) => ({ files: [file], rules: { 'no-restricted-syntax': 'off' } })),
])
