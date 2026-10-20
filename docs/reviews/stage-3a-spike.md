# Stage 3a spike review — Muse agent runs

CLI 1.4.11 (plan said 1.4.10). Launcher `scripts/spike-muse.ts`; workspaces
`var/runs/<runId>/` (gitignored) with events.jsonl + arrivals.log + RSS peak.
Full suite 207 passed, 1 skipped (@live). No push.

Step 0: news queries the quoted name only (`news.ts`); domain still filters
locally. Test asserts the exact query. Zero live GDELT probes (still
throttled from Stage 2; news stays unverified-live).

1. Launch/events/exit: `muse exec --json` streams JSONL; every event carries
   `stream.id` (session; `--session-id` honored). Tool call =
   `task.lifecycle.proposed` + `side_effect_intent`; result = `tool.result`
   (+ `task.lifecycle.output`); final = `run.terminal.completed.text`; usage =
   `run.usage`. Exit 0 ok, 1 run/model failure, 2 usage error, 143 SIGTERM.
   `--session-id` conflicts with `--no-session-log` (exit 2).
2. Per-run MCP proven: kardata streamable-http with whole-value
   `${KARDATA_MCP_AUTH}` header (partial `Bearer ${VAR}` is refused; no header
   demands OAuth login) + Playwright stdio pinned `playwright-mcp@0.0.83`
   `--headless --isolated`. Evidence: company_context, browser_navigate +
   browser_snapshot runs, all success.
3. Lockdown proven: `--disable-shell --disable-write` removes the tools (agent
   reports disabled; no files created) while MCP/web_search/web_fetch/browser
   run unattended under default on-request. Global `:unrestricted` does not
   leak through the flags; no other profile exists to select; `-c` overrides
   individual global keys.
4. Subagents headless: `workflow` works under the repo path, no
   `--trust-workspace` needed (/tmp is untrusted). Child inherited kardata MCP
   (called company_context) and lockdown (no shell tool). Completion arrives
   as a second run with an empty prompt — take the LAST terminal text. Label
   is NOT in stdout JSONL (session log + `subagent/<id>/` only).
5. Web search: 21/30 hit (7/10 per query; S1,S4,S6–S10 sweep, S2 BELLA / S3
   Coriander / S5 Hope Pharmacy miss everything — ambiguous names lose to
   same-named entities). 9–10 results per call, zero rate limits/failures.
   Stage 3b needs domain-anchored queries for generic names.
6. Stop/cleanup: SIGTERM reaps muse + playwright-mcp + Chromium in <3 s (no
   SIGKILL needed). FDs flat at 38 over an 11.3-min / 141-call run — no leak.
7. Resources: muse-only peak ~300–480 MB; +browser ~1.45 GB/run (4 samples,
   3 concurrent all exit 0). Box has 92 GB. Recommend MAX_CONCURRENT_AGENTS=4
   (memory allows 20+; the unknown is subscription concurrency + politeness).
8. Usage: `run.usage` per run (per-model in/out/cached/reasoning + calls);
   `trace inspect` has structure only, no tokens. Subscription-limit error NOT
   tested (won't burn the owner's quota). `--max-model-steps` cap →
   `run.terminal.failed` "…within N step(s)" + exit 1.
9. Liveness: heartbeats are task transitions + `task.lifecycle.status` stream
   phases + tool results; pure-inference silence reached 21.9 s on the long
   run. Recommend stall timeout 120 s.

Recommended run config: `muse exec --json --max-model-steps N
--disable-shell --disable-write -c 'mcpServers.kardata={"url":"http://127.0.0.1:8787/mcp",
"headers":{"Authorization":"${KARDATA_MCP_AUTH}"}}' -c 'mcpServers.playwright=
{"command":"<repo>/node_modules/.bin/playwright-mcp","args":["--headless",
"--isolated"]}'`, cwd `var/runs/<runId>/`, `KARDATA_MCP_AUTH="Bearer $TOKEN"`.

Blockers/surprises for 3b: (a) tool-call ARGUMENTS are invisible in JSONL
(names + results only); (b) subagent labels likewise — attribution needs
session-log parsing; (c) ~100 K base input tokens/run before any work (tool
schemas are only ~3 K of it); prompt caching covers 97%+ on long runs;
(d) benign `task.lifecycle.failed` exists — key completion on
`run.terminal.*` only; (e) model parallelizes tool calls unless
`--no-parallel-tool-calls`; (f) Step 2 adapter (`src/harness/`) + @live test
(`npm run test:live`, hermetic test-DB server, asserts a note_add doc) pass.

Unfinished: subscription-limit error/event; news live verification (throttle).
