// Pilot specs drive the UI only: no direct API calls from specs. Any
// page.request / request-fixture / APIRequestContext / fetch use, or a
// page.evaluate body that calls fetch, fails lint. DB checks go
// through ./ro.ts (SELECT-only, RO role). Pinned by
// tests/backend/eslint.pilot-ban.test.ts with one fixture per form.
import base from '../../../frontend/eslint.config.js'

export default [
  ...base,
  {
    files: ['**/*.spec.ts', '**/state.ts', '**/record.ts', '**/ro.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'MemberExpression[object.name="page"][property.name="request"]',
          message: 'pilot specs never use page.request (UI only)',
        },
        {
          selector: 'MemberExpression[object.name="request"]',
          message: 'pilot specs never use the request fixture (UI only)',
        },
        {
          selector: 'Identifier[name="APIRequestContext"]',
          message: 'pilot specs never use APIRequestContext (UI only)',
        },
        {
          selector: 'CallExpression[callee.name="fetch"]',
          message: 'pilot specs never call fetch (UI only; DB via ./ro.ts)',
        },
        {
          selector:
            'CallExpression[callee.object.name="page"][callee.property.name="evaluate"] CallExpression[callee.name="fetch"]',
          message: 'pilot specs never fetch inside page.evaluate (UI only)',
        },
      ],
    },
  },
]
