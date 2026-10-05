import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import { defineConfig } from 'eslint/config'

const allowlist = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'quality-allowlist.json')))
const allowFiles = (key) =>
  allowlist[key].map((entry) => entry.file).filter((file) => file.startsWith('agents/')).map((file) => file.slice('agents/'.length))

export default defineConfig([
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'var/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts', 'src/fixtures/**'],
    rules: {
      'max-lines': ['error', { max: 800 }],
      complexity: ['warn', 20],
      'max-depth': ['warn', 4],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='fetch']",
          message: 'use the workspace HTTP client (agents/src/http.ts lands in Phase 2)',
        },
      ],
    },
  },
  ...allowFiles('maxLines').map((file) => ({ files: [file], rules: { 'max-lines': 'off' } })),
  ...allowFiles('globalFetch').map((file) => ({ files: [file], rules: { 'no-restricted-syntax': 'off' } })),
])
