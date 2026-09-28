# Common

Shared contracts (types, validation) used by more than one area. No
business logic.

Current contents:

- HTTP envelopes live in `backend/src/app.ts`
  (`{ ok: true, data }` / `{ ok: false, error: { code, message } }`).
- The OpenAPI spec lives in `backend/openapi/v1.yaml`; the parity table
  in `backend/src/contract.ts` maps every mock/UI shape to it.
- Layer contract errors are `DbContractError` (`backend/src/db/errors.ts`).

New shared contracts go here by reference (define once, link everywhere),
never by duplication.
