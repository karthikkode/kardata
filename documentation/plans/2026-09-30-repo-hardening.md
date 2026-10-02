# Repo-wide hardening contract

Approved by the owner on 2026-09-30. Keep the existing stack and approval
boundaries. This change is developed on `codex/deep-checks-sector-hardening`.

Audit maintained agents, DB, telemetry, backend, MCP and frontend files.
The operational catalogue in `docs/deep-checks/` records stable feature
identities, review status, contracts, tests, failure cases and evidence.
Pending review is an acceptance gap, never implied verification.

Delivery order: isolated tests and contracts; persistence and telemetry;
agent/backend/MCP recovery; frontend reliability; integrated stress;
UI-driven Meta pilot. Every slice ships its area docs and regression tests.
Open-source adoption records source commit, license, pattern and measured
benefit in the existing third-party manifest before incorporation.

The pilot uses UI commands and Meta agents to discover 2,000 distinct
Australian SMEs. Validate 50 reproducibly sampled companies for identity,
geography, sector fit and fetched provenance. Do not run company deep
research or outreach. Preserve results, failures, steering and recovery
in visible app surfaces. No monetary cap; individual operations remain
bounded and resumable. Disruptive tests use isolated resources only.

One research parent per sector; test 1/10/100 discovery children and
1,000 queued items with bounded active concurrency. Publish measured
limits, correctness and recovery evidence rather than assuming capacity.

Postgres stores durable execution/evaluation records; the existing archive
stores large original bodies with hash-verified DB references. Logs carry
correlation and outcomes without secrets. Karbot can inspect/message/steer/
pause authorized work; owner approvals remain mandatory for protected
decisions, scope, budgets and destructive actions.

Acceptance requires mapped functionality, reviewed files, runnable module
and integration gates, browser state/transition evidence, isolated failure
drills, scale results, the Meta pilot, and independent verification.
No merges until the existing PR checklist carries proof for every item.
