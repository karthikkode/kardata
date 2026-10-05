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
    ignores: ['src/test/**', 'src/**/*.test.{ts,tsx}'],
    rules: {
      'max-lines': ['error', { max: 800 }],
      complexity: ['warn', 20],
      'max-depth': ['warn', 4],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='fetch']",
          message: 'use the frontend data client (single client lands in Phase 2)',
        },
      ],
    },
  },
  ...allowFiles('maxLines').map((file) => ({ files: [file], rules: { 'max-lines': 'off' } })),
  ...allowFiles('globalFetch').map((file) => ({ files: [file], rules: { 'no-restricted-syntax': 'off' } })),
])
