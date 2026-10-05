import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import { defineConfig } from 'eslint/config'

const allowlist = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'quality-allowlist.json')))
const allowFiles = (key) =>
  allowlist[key].map((entry) => entry.file).filter((file) => file.startsWith('backend/')).map((file) => file.slice('backend/'.length))

export default defineConfig([
  // Ignored test-evidence output is never linted: generated proof scripts
  // and captures live under test-results/ (also git-ignored).
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'test-results/**', 'var/**'] },
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
  // DB layer boundary (B7.1, enforced B7.8): only backend/src/db/**
  // may import 'pg'. Product code reaches the database through the
  // db/index.js barrel; tests keep direct access via their own helpers.
  // The pattern is relative to this config, so the tests/backend
  // re-export does not extend the ban to test files.
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'pg',
              message:
                "import the db layer barrel ('../db/index.js') instead of 'pg' directly.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/db/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      'max-lines': ['error', { max: 800 }],
      complexity: ['warn', 20],
      'max-depth': ['warn', 4],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='fetch']",
          message: 'use the backend retrieval transport, never global fetch',
        },
      ],
    },
  },
  ...allowFiles('maxLines').map((file) => ({ files: [file], rules: { 'max-lines': 'off' } })),
  ...allowFiles('globalFetch').map((file) => ({ files: [file], rules: { 'no-restricted-syntax': 'off' } })),
])
