import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import { defineConfig } from 'eslint/config'

export default defineConfig([
  // Ignored test-evidence output is never linted: generated proof scripts
  // and captures live under test-results/ (also git-ignored).
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'test-results/**'] },
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
])
